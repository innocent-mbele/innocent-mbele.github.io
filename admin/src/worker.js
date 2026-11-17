// Admin service for innocent-mbele.github.io, running as a Cloudflare Worker.
//
// Everything lives under /inno:
//   GET  /inno                 admin page (HTML, CSS and JS bundled into this file)
//   GET  /inno/auth/login      start Microsoft Entra ID sign-in (OpenID Connect, code flow + PKCE)
//   GET  /inno/auth/callback   finish sign-in, run the access checks, set the session cookie
//   POST /inno/auth/logout     end the session
//   GET  /inno/api/session     who is signed in
//   GET  /inno/api/content     current data/site.json and data/projects.json from GitHub
//   POST /inno/api/publish     validate changes and commit them (plus any new images) in one commit
//
// Access checks at sign-in (all must pass):
//   1. Microsoft's ID token is genuine: RS256 signature from the tenant's keys, issuer, audience,
//      expiry, nonce, state and PKCE.
//   2. The user's Entra Object ID is on ENTRA_ALLOWED_USERS.
//   3. Multifactor authentication was used: the token's amr claim contains "mfa"
//      (turn off only by setting REQUIRE_MFA=false, not recommended).
//   4. The request comes from an allowed country (ADMIN_ALLOWED_COUNTRIES, e.g. "AE,ZW").
// The session cookie is HttpOnly, Secure, SameSite=Strict, limited to /inno, lasts
// SESSION_HOURS (default 2) and is tied to the country and browser it was issued to.
// Every request re-checks the session; every change must come from this origin.
// Microsoft Entra Conditional Access policies (if your tenant has them) apply before all of this.

const BASE = "/inno";
const SESSION_COOKIE = "inno_session";
const FLOW_COOKIE = "inno_flow";
const FLOW_MINUTES = 10;
const enc = new TextEncoder();
const dec = new TextDecoder();

const APP_HTML = __APP_HTML__;

// ------------------------------------------------------------------ small helpers

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers },
  });
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function siteOrigin(env) {
  try { return new URL(env.SITE_URL || "https://innocent-mbele.github.io").origin; } catch { return "https://innocent-mbele.github.io"; }
}

function csp(env) {
  return "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    `img-src 'self' data: blob: ${siteOrigin(env)}; connect-src 'self'; ` +
    "form-action 'self' https://login.microsoftonline.com; frame-ancestors 'none'; base-uri 'none'";
}

function html(status, body, headers = {}, env = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": csp(env), ...SECURITY_HEADERS, ...headers },
  });
}

function messagePage(title, text, status = 403) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return html(status, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:#201f1e;background:#faf9f8;margin:0;padding:48px 20px}main{max-width:520px;margin:auto;background:#fff;border:1px solid #e1dfdd;padding:24px}a{color:#0e7a6d}</style></head>
<body><main><h1 style="font-size:20px;font-weight:600">${esc(title)}</h1><p>${esc(text)}</p><p><a href="${BASE}">Back to sign in</a></p></main></body></html>`);
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const toB64url = (bytes) => bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const randomB64url = (n) => toB64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256b64url(text) {
  return toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

function cookie(name, value, { path, maxAge, sameSite }) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

function country(request) {
  return String((request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "XX").toUpperCase();
}

const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const sessionHours = (env) => Math.min(Math.max(Number(env.SESSION_HOURS) || 2, 0.25), 8);

// ------------------------------------------------------------------ signed values

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signValue(purpose, data, ttlMs, env, now = Date.now()) {
  const payload = toB64url(enc.encode(JSON.stringify({ ...data, exp: now + ttlMs })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), enc.encode(`${purpose}.${payload}`));
  return `${payload}.${toB64url(new Uint8Array(sig))}`;
}

async function verifyValue(purpose, token, env, now = Date.now()) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromB64url(sig), enc.encode(`${purpose}.${payload}`));
    if (!ok) return null;
    const data = JSON.parse(dec.decode(fromB64url(payload)));
    if (typeof data.exp !== "number" || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}

async function browserTag(request) {
  return (await sha256b64url(request.headers.get("User-Agent") || "")).slice(0, 16);
}

/** Returns the session if it is valid and still matches the country and browser it was issued to. */
async function readSession(request, env) {
  const s = await verifyValue("session", readCookie(request, SESSION_COOKIE), env);
  if (!s) return null;
  if (s.ctry !== country(request)) return null;
  if (s.ua !== (await browserTag(request))) return null;
  if (!list(env.ENTRA_ALLOWED_USERS).map((x) => x.toLowerCase()).includes(String(s.oid).toLowerCase())) return null;
  return s;
}

// ------------------------------------------------------------------ Microsoft Entra ID

function configured(env) {
  return !!(env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET && env.ENTRA_ALLOWED_USERS &&
    env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 && env.GITHUB_TOKEN);
}

function authorityHost(env) {
  const h = env.ENTRA_AUTHORITY_HOST; // tests only: a local fake identity provider
  if (h && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)) return h;
  return "https://login.microsoftonline.com";
}

function entraUrls(env) {
  const base = `${authorityHost(env)}/${encodeURIComponent(env.ENTRA_TENANT_ID || "")}`;
  return {
    authorize: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    keys: `${base}/discovery/v2.0/keys`,
    issuer: `${base}/v2.0`,
  };
}

const redirectUri = (request) => `${new URL(request.url).origin}${BASE}/auth/callback`;

async function beginSignIn(request, env) {
  const state = randomB64url(24);
  const nonce = randomB64url(24);
  const verifier = randomB64url(48);
  const params = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(request),
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
    prompt: "login", // always ask again: no silent single sign-on into the admin
  });
  const flow = await signValue("flow", { state, nonce, verifier }, FLOW_MINUTES * 60_000, env);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${entraUrls(env).authorize}?${params}`,
      // Lax: Microsoft's redirect back to us is a cross-site top-level navigation
      "Set-Cookie": cookie(FLOW_COOKIE, flow, { path: `${BASE}/auth`, maxAge: FLOW_MINUTES * 60, sameSite: "Lax" }),
      "Cache-Control": "no-store",
    },
  });
}

let keyCache = null;
async function signingKeys(env, refresh = false) {
  const url = entraUrls(env).keys;
  if (!refresh && keyCache && keyCache.url === url && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not fetch Microsoft signing keys");
  const data = await res.json();
  keyCache = { url, at: Date.now(), keys: data.keys };
  return data.keys;
}

async function verifyIdToken(idToken, nonce, env, now = Date.now()) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(dec.decode(fromB64url(parts[0])));
    const claims = JSON.parse(dec.decode(fromB64url(parts[1])));
    if (header.alg !== "RS256" || !header.kid) return null;
    let jwk = (await signingKeys(env)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await signingKeys(env, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const skew = 120;
    const nowS = Math.floor(now / 1000);
    if (claims.iss !== entraUrls(env).issuer) return null;
    if (claims.aud !== env.ENTRA_CLIENT_ID) return null;
    if (!claims.exp || claims.exp + skew < nowS) return null;
    if (claims.nbf && claims.nbf - skew > nowS) return null;
    if (!claims.nonce || claims.nonce !== nonce) return null;
    return claims;
  } catch {
    return null;
  }
}

async function redeemCode(code, verifier, request, env) {
  const res = await fetch(entraUrls(env).token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      client_secret: env.ENTRA_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request),
      code_verifier: verifier,
      scope: "openid profile email",
    }),
  });
  if (!res.ok) {
    console.log("admin: token request failed", res.status);
    return null;
  }
  return (await res.json()).id_token || null;
}

/** The access checks. Returns null when allowed, or a reason when not. */
function accessDecision(claims, request, env) {
  const allowed = list(env.ENTRA_ALLOWED_USERS).map((x) => x.toLowerCase());
  if (!claims.oid || !allowed.includes(String(claims.oid).toLowerCase())) return "user";
  if (String(env.REQUIRE_MFA || "true").toLowerCase() !== "false") {
    const amr = Array.isArray(claims.amr) ? claims.amr : [];
    if (!amr.includes("mfa")) return "mfa";
  }
  const countries = list(env.ADMIN_ALLOWED_COUNTRIES).map((c) => c.toUpperCase());
  if (countries.length && !countries.includes(country(request))) return "country";
  return null;
}

const DENIED = {
  user: "This account is not allowed to use the admin.",
  mfa: "Multifactor authentication is required. Sign in again and approve the request in Microsoft Authenticator or with your security key.",
  country: "Admin sign-in is not allowed from your current location.",
};

async function finishSignIn(request, env) {
  const url = new URL(request.url);
  const clearFlow = cookie(FLOW_COOKIE, "", { path: `${BASE}/auth`, maxAge: 0, sameSite: "Lax" });
  if (url.searchParams.get("error")) {
    return messagePage("Sign-in stopped", "Microsoft did not complete the sign-in. Please try again.");
  }
  const flow = await verifyValue("flow", readCookie(request, FLOW_COOKIE), env);
  const code = url.searchParams.get("code");
  if (!flow || !code || url.searchParams.get("state") !== flow.state) {
    return messagePage("Sign-in expired", "The sign-in took too long or was started in another window. Please try again.", 400);
  }
  const idToken = await redeemCode(code, flow.verifier, request, env);
  const claims = idToken && (await verifyIdToken(idToken, flow.nonce, env));
  if (!claims) return messagePage("Sign-in failed", "The sign-in could not be verified. Please try again.");
  const reason = accessDecision(claims, request, env);
  if (reason) {
    console.log("admin: access denied", reason, claims.oid || "-", country(request));
    const res = messagePage("Access denied", DENIED[reason]);
    res.headers.append("Set-Cookie", clearFlow);
    return res;
  }
  const session = await signValue("session", {
    oid: claims.oid,
    name: claims.name || "",
    email: claims.preferred_username || claims.email || "",
    ctry: country(request),
    ua: await browserTag(request),
  }, sessionHours(env) * 3600_000, env);
  console.log("admin: signed in", claims.oid, country(request));
  const headers = new Headers({ Location: BASE, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearFlow);
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, { path: BASE, maxAge: Math.round(sessionHours(env) * 3600), sameSite: "Strict" }));
  return new Response(null, { status: 302, headers });
}

// ------------------------------------------------------------------ GitHub

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function gh(env) {
  const repo = env.GITHUB_REPO || "innocent-mbele/innocent-mbele.github.io";
  const branch = env.GITHUB_BRANCH || "main";
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "innocent-mbele-admin",
  };
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      console.log("admin: GitHub", method, path, res.status, text.slice(0, 200));
      throw new HttpError(res.status === 422 || res.status === 409 ? 409 : 502, `GitHub request failed (${res.status})`);
    }
    return res.status === 204 ? null : res.json();
  };
  return { api, repo, branch };
}

async function readContent(env) {
  const { api, branch } = gh(env);
  const ref = await api("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = ref.object.sha;
  const read = async (path) => {
    const f = await api("GET", `/contents/${path}?ref=${head}`);
    return JSON.parse(dec.decode(base64ToBytes(f.content)));
  };
  const [site, projects] = await Promise.all([read("data/site.json"), read("data/projects.json")]);
  return { head, site, projects };
}

async function commitFiles(env, head, files, message) {
  const { api, branch } = gh(env);
  const ref = await api("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
  if (ref.object.sha !== head) throw new HttpError(409, "The site changed on GitHub since you opened the admin. Reload the page and make your changes again.");
  const base = await api("GET", `/git/commits/${head}`);
  const tree = [];
  for (const f of files) {
    if (f.delete) {
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await api("POST", "/git/blobs", { content: f.base64, encoding: "base64" });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await api("POST", "/git/trees", { base_tree: base.tree.sha, tree });
  const commit = await api("POST", "/git/commits", { message, tree: newTree.sha, parents: [head] });
  await api("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
  return commit.sha;
}

// ------------------------------------------------------------------ validation

const IMG_PATH = /^assets\/images\/(projects\/[a-z0-9-]{1,80}|profile)\/[a-z0-9][a-z0-9-]{0,120}\.webp$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const FOLDER = /^[A-Za-z0-9._\/-]{0,200}$/;
const HTTPS = /^https:\/\/[^\s"<>]{3,500}$/;

function str(v, max, field, { required = true, multiline = false } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  if (required && !v.trim()) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  if (!multiline && /[\r\n]/.test(v)) throw new HttpError(400, `${field} must be on one line`);
  return v.trim();
}
function strList(v, maxItems, maxLen, field) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems) throw new HttpError(400, `${field} must be a list of up to ${maxItems} items`);
  return v.map((x, i) => str(x, maxLen, `${field} item ${i + 1}`)).filter(Boolean);
}
function url(v, field, required = false) {
  const s = str(v, 500, field, { required });
  if (s && !HTTPS.test(s)) throw new HttpError(400, `${field} must start with https://`);
  return s;
}
function int(v, field, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
  return n;
}

function validateSite(s) {
  if (!s || typeof s !== "object") throw new HttpError(400, "Site settings are missing");
  const photo = s.profile_photo || {};
  const out = {
    name: str(s.name, 80, "Name"),
    role: str(s.role, 120, "Role"),
    tagline: str(s.tagline, 160, "Tagline", { required: false }),
    intro: str(s.intro, 1200, "Introduction", { multiline: true }),
    footer: str(s.footer, 400, "Footer text", { required: false }),
    base_url: url(s.base_url, "Site address", true),
    github_user: str(s.github_user, 60, "GitHub user"),
    admin_url: url(s.admin_url, "Admin address"),
    web3forms_access_key: str(s.web3forms_access_key, 64, "Contact form key", { required: false }),
    profile_photo: {
      src: str(photo.src, 200, "Photo file", { required: false }),
      alt: str(photo.alt, 300, "Photo description", { required: false }),
      shape: ["square", "portrait", "landscape"].includes(photo.shape) ? photo.shape : "square",
      size: ["small", "medium", "large"].includes(photo.size) ? photo.size : "medium",
      focus: ["center", "top", "bottom", "left", "right"].includes(photo.focus) ? photo.focus : "center",
    },
    links: [],
    repositories: [],
  };
  if (out.web3forms_access_key && !/^[A-Za-z0-9-]{8,64}$/.test(out.web3forms_access_key)) throw new HttpError(400, "Contact form key looks wrong");
  if (out.profile_photo.src && !IMG_PATH.test(out.profile_photo.src)) throw new HttpError(400, "Photo file path is not allowed");
  if (!Array.isArray(s.links) || s.links.length > 12) throw new HttpError(400, "Links must be a list of up to 12");
  out.links = s.links.map((l, i) => ({ label: str(l.label, 40, `Link ${i + 1} label`), url: url(l.url, `Link ${i + 1} address`, true) }));
  if (!Array.isArray(s.repositories) || s.repositories.length > 40) throw new HttpError(400, "Repositories must be a list of up to 40");
  out.repositories = s.repositories.map((r, i) => {
    const name = str(r.name, 100, `Repository ${i + 1} name`);
    if (!REPO.test(name)) throw new HttpError(400, `Repository ${i + 1} name has characters GitHub does not allow`);
    const o = { name, description: str(r.description, 300, `Repository ${i + 1} description`, { required: false }) };
    if (r.url) o.url = url(r.url, `Repository ${i + 1} address`);
    return o;
  });
  return out;
}

function validateProjects(d, allowedImages) {
  if (!d || !Array.isArray(d.categories) || !Array.isArray(d.projects)) throw new HttpError(400, "Projects data is missing");
  if (d.categories.length < 1 || d.categories.length > 20) throw new HttpError(400, "Keep between 1 and 20 areas");
  const categories = d.categories.map((c, i) => {
    const id = str(c.id, 60, `Area ${i + 1} id`);
    if (!SLUG.test(id)) throw new HttpError(400, `Area ${i + 1} id may only use a-z, 0-9 and -`);
    return { id, label: str(c.label, 60, `Area ${i + 1} name`) };
  });
  const catIds = new Set(categories.map((c) => c.id));
  if (catIds.size !== categories.length) throw new HttpError(400, "Two areas have the same id");
  if (d.projects.length < 1 || d.projects.length > 200) throw new HttpError(400, "Keep between 1 and 200 projects");
  const seen = new Set();
  const projects = d.projects.map((p, i) => {
    const label = `Project ${i + 1}`;
    const slug = str(p.slug, 80, `${label} web address`);
    if (!SLUG.test(slug)) throw new HttpError(400, `${label} web address may only use a-z, 0-9 and -`);
    if (seen.has(slug)) throw new HttpError(400, `Two projects use the web address ${slug}`);
    seen.add(slug);
    if (!catIds.has(p.category)) throw new HttpError(400, `${label} has an unknown area`);
    const repo = str(p.repo, 100, `${label} repository`);
    if (!REPO.test(repo)) throw new HttpError(400, `${label} repository name is not valid`);
    const folder = str(p.folder, 200, `${label} folder`, { required: false });
    if (!FOLDER.test(folder) || folder.includes("..")) throw new HttpError(400, `${label} folder is not valid`);
    if (!Array.isArray(p.screenshots) || p.screenshots.length < 1 || p.screenshots.length > 60) throw new HttpError(400, `${label} needs 1 to 60 screenshots`);
    const screenshots = p.screenshots.map((s, k) => {
      const sl = `${label} screenshot ${k + 1}`;
      for (const key of ["src", "thumb"]) {
        if (!IMG_PATH.test(String(s[key] || ""))) throw new HttpError(400, `${sl} file path is not allowed`);
        if (!allowedImages.has(s[key])) throw new HttpError(400, `${sl} image file is missing. Upload it again.`);
      }
      return {
        title: str(s.title, 200, `${sl} title`),
        caption: str(s.caption, 1000, `${sl} caption`, { required: false }),
        alt: str(s.alt, 300, `${sl} description`, { required: false }),
        src: s.src, thumb: s.thumb,
        width: int(s.width, `${sl} width`, 1, 4000), height: int(s.height, `${sl} height`, 1, 8000),
        thumb_width: int(s.thumb_width, `${sl} thumbnail width`, 1, 4000), thumb_height: int(s.thumb_height, `${sl} thumbnail height`, 1, 8000),
      };
    });
    const out = {
      slug, repo, folder,
      title: str(p.title, 120, `${label} title`),
      category: p.category,
      featured: p.featured === true,
      status: str(p.status, 200, `${label} status`),
      summary: str(p.summary, 600, `${label} summary`, { multiline: true }),
      overview: str(p.overview, 4000, `${label} overview`, { multiline: true }),
      objectives: strList(p.objectives, 30, 600, `${label} aims`),
      technologies: strList(p.technologies, 30, 80, `${label} tools`),
      implementation: strList(p.implementation, 40, 600, `${label} steps`),
      verification: strList(p.verification, 30, 600, `${label} tests`),
      screenshots,
    };
    const results = strList(p.results, 20, 600, `${label} problems`);
    if (results.length) out.results = results;
    if (p.repo_url) out.repo_url = url(p.repo_url, `${label} repository address`);
    if (p.video) out.video = url(p.video, `${label} video address`);
    if (p.architecture) out.architecture = str(p.architecture, 3000, `${label} diagram`, { multiline: true });
    if (p.cover !== undefined && p.cover !== null && p.cover !== "") out.cover = int(p.cover, `${label} card picture`, 1, screenshots.length);
    if (p.masked === true) out.masked = true;
    return out;
  });
  return { categories, projects };
}

function imagesIn(site, projects) {
  const set = new Set();
  if (site && site.profile_photo && site.profile_photo.src) set.add(site.profile_photo.src);
  for (const p of (projects && projects.projects) || []) for (const s of p.screenshots || []) { set.add(s.src); set.add(s.thumb); }
  return set;
}

function isWebp(bytes) {
  return bytes.length > 12 && dec.decode(bytes.subarray(0, 4)) === "RIFF" && dec.decode(bytes.subarray(8, 12)) === "WEBP";
}

async function publish(request, env, user) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > 40 * 1024 * 1024) throw new HttpError(413, "Too much at once. Publish fewer images at a time.");
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "The request was not valid");
  }
  const current = await readContent(env);
  if (body.head !== current.head) throw new HttpError(409, "The site changed on GitHub since you opened the admin. Reload the page and make your changes again.");

  const uploads = Array.isArray(body.images) ? body.images : [];
  if (uploads.length > 80) throw new HttpError(400, "Too many images at once (max 80)");
  const files = [];
  let total = 0;
  for (const img of uploads) {
    if (!IMG_PATH.test(String(img.path || ""))) throw new HttpError(400, "An image path is not allowed");
    const bytes = base64ToBytes(img.base64 || "");
    if (!isWebp(bytes)) throw new HttpError(400, "Images must be WebP (the admin converts them for you)");
    if (bytes.length > 3 * 1024 * 1024) throw new HttpError(400, "An image is larger than 3 MB");
    total += bytes.length;
    files.push({ path: img.path, base64: img.base64 });
  }
  if (total > 30 * 1024 * 1024) throw new HttpError(413, "Images add up to more than 30 MB. Publish them in smaller groups.");

  const allowedImages = new Set([...imagesIn(current.site, current.projects), ...uploads.map((u) => u.path)]);
  const site = validateSite(body.site);
  if (site.profile_photo.src && !allowedImages.has(site.profile_photo.src)) throw new HttpError(400, "The profile photo file is missing. Upload it again.");
  const projects = validateProjects(body.projects, allowedImages);

  const siteText = JSON.stringify(site, null, 2) + "\n";
  const projectsText = JSON.stringify(projects, null, 2) + "\n";
  if (siteText !== JSON.stringify(current.site, null, 2) + "\n") files.push({ path: "data/site.json", base64: bytesToBase64(enc.encode(siteText)) });
  if (projectsText !== JSON.stringify(current.projects, null, 2) + "\n") files.push({ path: "data/projects.json", base64: bytesToBase64(enc.encode(projectsText)) });

  // Remove image files that nothing uses any more
  const used = imagesIn(site, projects);
  for (const path of imagesIn(current.site, current.projects)) {
    if (!used.has(path)) files.push({ path, delete: true });
  }
  if (!files.length) return json(200, { ok: true, unchanged: true });

  const note = str(body.message || "", 120, "Change note", { required: false });
  const message = `Admin: ${note || "update site content"}\n\nPublished from the admin page by ${user.name || user.oid}.`;
  const commit = await commitFiles(env, current.head, files, message);
  console.log("admin: published", commit, user.oid, files.length);
  return json(200, { ok: true, commit, url: `https://github.com/${gh(env).repo}/commit/${commit}` });
}

// ------------------------------------------------------------------ router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path === "") return Response.redirect(`${url.origin}${BASE}`, 302);
    if (!path.startsWith(BASE)) return messagePage("Not found", "There is nothing here.", 404);
    if (!configured(env)) return messagePage("Admin not set up", "The admin service is missing its settings. See docs/ADMIN.md in the website repository.", 503);

    try {
      if (path === BASE && request.method === "GET") return html(200, APP_HTML, {}, env);
      if (path === `${BASE}/auth/login` && request.method === "GET") return beginSignIn(request, env);
      if (path === `${BASE}/auth/callback` && request.method === "GET") return finishSignIn(request, env);
      if (path === `${BASE}/auth/logout` && request.method === "POST") {
        if (!sameOrigin(request)) return json(403, { error: "Not allowed" });
        return json(200, { ok: true }, { "Set-Cookie": cookie(SESSION_COOKIE, "", { path: BASE, maxAge: 0, sameSite: "Strict" }) });
      }
      if (path.startsWith(`${BASE}/api/`)) {
        const user = await readSession(request, env);
        if (!user) return json(401, { error: "Please sign in" });
        if (request.method !== "GET" && !sameOrigin(request)) return json(403, { error: "Not allowed" });
        if (path === `${BASE}/api/session` && request.method === "GET") {
          return json(200, { name: user.name, email: user.email, expires: user.exp, site: siteOrigin(env) });
        }
        if (path === `${BASE}/api/content` && request.method === "GET") return json(200, await readContent(env));
        if (path === `${BASE}/api/publish` && request.method === "POST") return await publish(request, env, user);
      }
      return json(404, { error: "Not found" });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.log("admin: error", err && err.stack);
      return json(500, { error: "Something went wrong. Please try again." });
    }
  },
};

export const _test = { validateSite, validateProjects, accessDecision, signValue, verifyValue, IMG_PATH };
