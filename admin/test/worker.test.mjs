// Tests for the admin Worker. Run: node --test admin/test/
// Microsoft Entra ID and GitHub are replaced by local fakes; nothing leaves the machine.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.js";

const ORIGIN = "https://admin.example.workers.dev";
const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OID = "99999999-8888-7777-6666-555555555555";
const UA = "Mozilla/5.0 test";
const env = {
  ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: "secret",
  ENTRA_ALLOWED_USERS: OID, SESSION_SECRET: "x".repeat(48), GITHUB_TOKEN: "github_pat_test",
  GITHUB_REPO: "innocent-mbele/innocent-mbele.github.io", ADMIN_ALLOWED_COUNTRIES: "AE,ZW",
};

// ---------------------------------------------------------------- fake Microsoft
const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
const b64u = (b) => Buffer.from(b).toString("base64url");
let nextClaims = {};
let lastNonce = "";
async function idToken(claims) {
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`;
}

// ---------------------------------------------------------------- fake GitHub
const SITE = JSON.parse(readFileSync(new URL("../../data/site.json", import.meta.url)));
const PROJECTS = JSON.parse(readFileSync(new URL("../../data/projects.json", import.meta.url)));
let repo, commits;
beforeEach(() => {
  repo = { head: "c0", files: { "data/site.json": JSON.stringify(SITE), "data/projects.json": JSON.stringify(PROJECTS) } };
  commits = [];
  nextClaims = {};
});

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || "GET";
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/discovery/v2.0/keys")) return reply(200, { keys: [jwk] });
  if (url.endsWith("/oauth2/v2.0/token")) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, exp: now + 600, nbf: now - 10, nonce: lastNonce,
      oid: OID, tid: TENANT, name: "Innocent Mbele", preferred_username: "admin@example.onmicrosoft.com", amr: ["pwd", "mfa"], ...nextClaims };
    return reply(200, { id_token: await idToken(claims) });
  }
  const m = url.match(/^https:\/\/api\.github\.com\/repos\/innocent-mbele\/innocent-mbele\.github\.io(\/.*)$/);
  if (!m) throw new Error("unexpected fetch " + url);
  const path = m[1];
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === "GET" && path === "/git/ref/heads/main") return reply(200, { object: { sha: repo.head } });
  if (method === "GET" && path.startsWith("/contents/")) {
    const file = path.slice(10).split("?")[0];
    if (!(file in repo.files)) return reply(404, {});
    return reply(200, { content: Buffer.from(repo.files[file]).toString("base64") });
  }
  if (method === "GET" && path.startsWith("/git/commits/")) return reply(200, { tree: { sha: "t0" } });
  if (method === "POST" && path === "/git/blobs") { const sha = "b" + Math.random(); repo.blobs = { ...(repo.blobs || {}), [sha]: body.content }; return reply(201, { sha }); }
  if (method === "POST" && path === "/git/trees") { repo.pendingTree = body.tree; return reply(201, { sha: "t1" }); }
  if (method === "POST" && path === "/git/commits") { commits.push({ message: body.message, tree: repo.pendingTree }); return reply(201, { sha: "c" + commits.length }); }
  if (method === "PATCH" && path === "/git/refs/heads/main") {
    for (const t of repo.pendingTree) {
      if (t.sha === null) delete repo.files[t.path];
      else repo.files[t.path] = Buffer.from(repo.blobs[t.sha], "base64").toString("utf8");
    }
    repo.head = body.sha;
    return reply(200, {});
  }
  throw new Error(`unexpected GitHub call ${method} ${path}`);
};

// ---------------------------------------------------------------- helpers
function req(path, { method = "GET", headers = {}, body, country = "AE", ua = UA } = {}) {
  return new Request(ORIGIN + path, { method, headers: { "User-Agent": ua, "CF-IPCountry": country, ...headers }, body });
}
function setCookies(res) {
  return (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("Set-Cookie")]).filter(Boolean);
}
function cookieValue(res, name) {
  const c = setCookies(res).find((x) => x.startsWith(name + "="));
  return c ? c.split(";")[0] : null;
}
async function signIn({ claims = {}, country = "AE" } = {}) {
  const start = await worker.fetch(req("/inno/auth/login", { country }), env);
  const loc = new URL(start.headers.get("Location"));
  lastNonce = loc.searchParams.get("nonce");
  nextClaims = claims;
  const flow = cookieValue(start, "inno_flow");
  const res = await worker.fetch(req(`/inno/auth/callback?code=abc&state=${loc.searchParams.get("state")}`, { headers: { Cookie: flow }, country }), env);
  return { res, session: cookieValue(res, "inno_session") };
}
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([8, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]).toString("base64");

// ---------------------------------------------------------------- tests
test("refuses to run without its settings", async () => {
  const res = await worker.fetch(req("/inno"), {});
  assert.equal(res.status, 503);
});

test("serves the admin page with strict security headers", async () => {
  const res = await worker.fetch(req("/inno"), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.match(await res.text(), /Sign in with Microsoft/);
});

test("API needs a session", async () => {
  assert.equal((await worker.fetch(req("/inno/api/content"), env)).status, 401);
  assert.equal((await worker.fetch(req("/inno/api/session", { headers: { Cookie: "inno_session=forged.value" } }), env)).status, 401);
});

test("sign-in starts with state, nonce, PKCE and a forced fresh login", async () => {
  const res = await worker.fetch(req("/inno/auth/login"), env);
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("Location"));
  assert.equal(loc.origin + loc.pathname, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("prompt"), "login");
  assert.ok(loc.searchParams.get("state") && loc.searchParams.get("nonce"));
  assert.match(setCookies(res)[0], /HttpOnly; Secure; SameSite=Lax/);
});

test("allowed user with MFA from an allowed country gets a strict session", async () => {
  const { res, session } = await signIn();
  assert.equal(res.status, 302);
  assert.ok(session);
  assert.match(setCookies(res).find((c) => c.startsWith("inno_session")), /Path=\/inno; Max-Age=7200; HttpOnly; Secure; SameSite=Strict/);
  const who = await worker.fetch(req("/inno/api/session", { headers: { Cookie: session } }), env);
  assert.equal(who.status, 200);
  assert.equal((await who.json()).name, "Innocent Mbele");
});

test("sign-in without MFA is refused", async () => {
  const { res, session } = await signIn({ claims: { amr: ["pwd"] } });
  assert.equal(res.status, 403);
  assert.equal(session, null);
  assert.match(await res.text(), /Multifactor authentication is required/);
});

test("sign-in when the token has no amr claim is refused", async () => {
  const { res, session } = await signIn({ claims: { amr: undefined } });
  assert.equal(res.status, 403);
  assert.equal(session, null);
});

test("another Microsoft user is refused", async () => {
  const { res, session } = await signIn({ claims: { oid: "00000000-0000-0000-0000-000000000000" } });
  assert.equal(res.status, 403);
  assert.equal(session, null);
});

test("sign-in from a country that is not allowed is refused", async () => {
  const { res, session } = await signIn({ country: "US" });
  assert.equal(res.status, 403);
  assert.equal(session, null);
  assert.match(await res.text(), /not allowed from your current location/);
});

test("token for another app, wrong issuer or expired is refused", async () => {
  for (const claims of [{ aud: "other-app" }, { iss: "https://evil.example/v2.0" }, { exp: 1000 }]) {
    const { session } = await signIn({ claims });
    assert.equal(session, null, JSON.stringify(claims));
  }
});

test("state mismatch is refused", async () => {
  const start = await worker.fetch(req("/inno/auth/login"), env);
  const res = await worker.fetch(req("/inno/auth/callback?code=abc&state=wrong", { headers: { Cookie: cookieValue(start, "inno_flow") } }), env);
  assert.equal(res.status, 400);
});

test("a session copied to another country or browser stops working", async () => {
  const { session } = await signIn();
  assert.equal((await worker.fetch(req("/inno/api/session", { headers: { Cookie: session }, country: "ZW" }), env)).status, 401);
  assert.equal((await worker.fetch(req("/inno/api/session", { headers: { Cookie: session }, ua: "curl/8" }), env)).status, 401);
});

test("removing the user from the allow-list ends their session", async () => {
  const { session } = await signIn();
  const res = await worker.fetch(req("/inno/api/session", { headers: { Cookie: session } }), { ...env, ENTRA_ALLOWED_USERS: "someone-else" });
  assert.equal(res.status, 401);
});

async function publish(session, body, headers = {}) {
  return worker.fetch(req("/inno/api/publish", { method: "POST", headers: { Cookie: session, Origin: ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), env);
}

test("changes from another website are refused", async () => {
  const { session } = await signIn();
  const res = await publish(session, {}, { Origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("publishing commits the data and new images in one commit", async () => {
  const { session } = await signIn();
  const content = await (await worker.fetch(req("/inno/api/content", { headers: { Cookie: session } }), env)).json();
  assert.equal(content.head, "c0");
  const site = structuredClone(content.site);
  site.intro = "New introduction written by me.";
  site.links.push({ label: "Blog", url: "https://example.com" });
  site.profile_photo.src = "assets/images/profile/profile-new.webp";
  const res = await publish(session, { head: "c0", site, projects: content.projects, message: "new intro",
    images: [{ path: "assets/images/profile/profile-new.webp", base64: webp() }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(commits.length, 1);
  assert.match(commits[0].message, /^Admin: new intro/);
  const paths = commits[0].tree.map((t) => t.path).sort();
  assert.deepEqual(paths, ["assets/images/profile/profile-new.webp", "assets/images/profile/profile.webp", "data/site.json"]);
  assert.equal(commits[0].tree.find((t) => t.path === "assets/images/profile/profile.webp").sha, null, "old photo removed");
  assert.equal(JSON.parse(repo.files["data/site.json"]).intro, "New introduction written by me.");
});

test("publishing on top of a newer version is refused", async () => {
  const { session } = await signIn();
  const res = await publish(session, { head: "old", site: SITE, projects: PROJECTS });
  assert.equal(res.status, 409);
});

test("bad input is refused", async () => {
  const { session } = await signIn();
  const cases = [
    [{ images: [{ path: "../../.github/workflows/x.yml", base64: webp() }] }, /path is not allowed/],
    [{ images: [{ path: "assets/images/profile/x.webp", base64: Buffer.from("<script>").toString("base64") }] }, /must be WebP/],
    [{ site: { ...SITE, links: [{ label: "x", url: "javascript:alert(1)" }] } }, /must start with https/],
    [{ projects: { ...PROJECTS, projects: [{ ...PROJECTS.projects[0], slug: "Bad Slug" }] } }, /web address/],
    [{ projects: { ...PROJECTS, projects: [{ ...PROJECTS.projects[0], screenshots: [{ ...PROJECTS.projects[0].screenshots[0], src: "assets/images/projects/x/missing.webp" }] }] } }, /missing/],
    [{ projects: { ...PROJECTS, projects: [{ ...PROJECTS.projects[0], category: "nope" }] } }, /unknown area/],
  ];
  for (const [patch, msg] of cases) {
    const res = await publish(session, { head: "c0", site: SITE, projects: PROJECTS, ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch).slice(0, 80));
    assert.match((await res.json()).error, msg);
  }
  assert.equal(commits.length, 0);
});

test("adding a project with an uploaded screenshot works", async () => {
  const { session } = await signIn();
  const projects = structuredClone(PROJECTS);
  const shot = { title: "Result", caption: "It works", alt: "Terminal output", src: "assets/images/projects/new-lab/01-result.webp", thumb: "assets/images/projects/new-lab/01-result-thumb.webp", width: 1600, height: 900, thumb_width: 720, thumb_height: 405 };
  projects.projects.push({ slug: "new-lab", repo: "linux-projects", folder: "14-new", title: "New lab", category: "linux-administration", status: "Completed",
    summary: "I did a new lab.", overview: "I did a new lab and tested it.", technologies: ["Ubuntu"], screenshots: [shot] });
  const res = await publish(session, { head: "c0", site: SITE, projects, images: [{ path: shot.src, base64: webp() }, { path: shot.thumb, base64: webp() }] });
  assert.equal(res.status, 200, await res.clone().text());
  const saved = JSON.parse(repo.files["data/projects.json"]);
  assert.equal(saved.projects.at(-1).slug, "new-lab");
});

// ---------------------------------------------------------------- personal Microsoft account (outlook.com)
const MSA = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MSA_OID = "00000000-0000-0000-1234-56789abcdef0";
const msaEnv = { ...env, ENTRA_TENANT_ID: "consumers", ENTRA_ALLOWED_USERS: "", ENTRA_ALLOWED_EMAILS: "Owner@Outlook.com" };
const msaClaims = { iss: `https://login.microsoftonline.com/${MSA}/v2.0`, tid: MSA, oid: MSA_OID, preferred_username: "owner@outlook.com" };
async function signInWith(e, claims, country = "AE") {
  const start = await worker.fetch(req("/inno/auth/login", { country }), e);
  const loc = new URL(start.headers.get("Location"));
  lastNonce = loc.searchParams.get("nonce");
  nextClaims = claims;
  const res = await worker.fetch(req(`/inno/auth/callback?code=abc&state=${loc.searchParams.get("state")}`, { headers: { Cookie: cookieValue(start, "inno_flow") }, country }), e);
  return { start, res, session: cookieValue(res, "inno_session") };
}

test("personal account: sign-in goes to the consumers endpoint and an allowed address gets a session", async () => {
  const { start, res, session } = await signInWith(msaEnv, msaClaims);
  assert.equal(new URL(start.headers.get("Location")).pathname, "/consumers/oauth2/v2.0/authorize");
  assert.equal(res.status, 302);
  assert.ok(session);
  const who = await worker.fetch(req("/inno/api/session", { headers: { Cookie: session } }), msaEnv);
  assert.equal((await who.json()).email, "owner@outlook.com");
});

test("personal account: another address, a work-tenant token or a missing MFA claim is refused", async () => {
  for (const claims of [{ ...msaClaims, preferred_username: "someone@outlook.com" },
    { ...msaClaims, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT },
    { ...msaClaims, tid: TENANT },
    { ...msaClaims, amr: ["pwd"] }]) {
    const { session } = await signInWith(msaEnv, claims);
    assert.equal(session, null, JSON.stringify(claims));
  }
});

test("personal account: when both lists are set, both must match", async () => {
  const e = { ...msaEnv, ENTRA_ALLOWED_USERS: MSA_OID };
  assert.ok((await signInWith(e, msaClaims)).session);
  assert.equal((await signInWith(e, { ...msaClaims, oid: "00000000-0000-0000-9999-000000000000" })).session, null);
});

test("the MFA refusal says which sign-in methods Microsoft reported", async () => {
  const { res } = await signIn({ claims: { amr: ["pwd"] } });
  assert.match(await res.text(), /Microsoft reported: pwd/);
});

test("Microsoft errors are shown with their code", async () => {
  const res = await worker.fetch(req("/inno/auth/callback?error=invalid_request&error_description=AADSTS700016%3A+Application+not+found"), env);
  assert.match(await res.text(), /invalid_request AADSTS700016/);
});

test("no allow-list at all means not set up", async () => {
  const res = await worker.fetch(req("/inno"), { ...env, ENTRA_ALLOWED_USERS: "" });
  assert.equal(res.status, 503);
});
