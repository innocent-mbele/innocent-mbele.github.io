"""Generate the static portfolio from data/site.json and data/projects.json.

usage: python3 tools/build_site.py

Writes index.html (one page: home, projects, contact), projects/<slug>/index.html,
short redirect pages for /projects/, /contact/ and /inno/, 404.html and sitemap.xml.
Only the Python standard library is used. GitHub Actions runs this after every
change to data/ (for example a save from the admin page) and commits the result.
"""
import json
from datetime import date
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))
DATA = json.loads((ROOT / "data/projects.json").read_text(encoding="utf-8"))
BASE = SITE["base_url"].rstrip("/")
GH = f"https://github.com/{SITE['github_user']}"
CATS = {c["id"]: c["label"] for c in DATA["categories"]}
PROJECTS = DATA["projects"]
ASSET_V = "5"  # bump to make browsers fetch changed CSS, JS and icons
MASK_NOTE = "I painted over my Azure subscription ID in red. Everything else is as I captured it."

PHOTO_SHAPES = {"square": "1 / 1", "portrait": "4 / 5", "landscape": "4 / 3"}
PHOTO_SIZES = {"small": 170, "medium": 220, "large": 280}
PHOTO_FOCUS = {"center": "50% 50%", "top": "50% 0%", "bottom": "50% 100%", "left": "0% 50%", "right": "100% 50%"}

for p in PROJECTS:
    if p["category"] not in CATS:
        raise SystemExit(f"Unknown category {p['category']!r} in {p['slug']}")
    if not p.get("screenshots"):
        raise SystemExit(f"Project {p['slug']} has no screenshots")


def e(s):
    return escape(str(s), quote=True)


def repo_url(p):
    if p.get("repo_url"):
        return p["repo_url"]
    url = f"{GH}/{p['repo']}"
    return f"{url}/tree/main/{p['folder']}" if p.get("folder") else url


def cover(p):
    imgs = p["screenshots"]
    n = p.get("cover") or len(imgs)
    return imgs[min(max(int(n), 1), len(imgs)) - 1]


def in_progress(p):
    return p["status"].lower().startswith("in progress")


def page(title, description, path, body, active="", scripts=("main.js",), extra_head="", noindex=False):
    canonical = f"{BASE}{path}"
    home = path == "/"
    nav = "".join(
        f'<li><a href="{"" if home else "/"}#{key}" data-nav="{key}"{" aria-current=\"page\"" if key == active else ""}>{label}</a></li>'
        for key, label in (("home", "Home"), ("projects", "Projects"), ("contact", "Contact me"))
    )
    js = "".join(f'<script src="/assets/js/{s}?v={ASSET_V}" defer></script>' for s in scripts)
    full_title = title if title.startswith(SITE["name"]) else f"{title} | {SITE['name']}"
    def short(l):  # footer keeps short names
        u = l["url"].lower()
        return "GitHub" if "github.com" in u else "LinkedIn" if "linkedin.com" in u else l["label"]
    links = "".join(f'<li><a href="{e(l["url"])}" rel="noopener">{e(short(l))}</a></li>' for l in SITE.get("links", []))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(canonical)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta name="author" content="{e(SITE['name'])}">
<meta name="theme-color" content="#ffffff">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{e(SITE['name'])}">
<meta property="og:title" content="{e(full_title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(canonical)}">
<meta property="og:image" content="{BASE}/assets/icons/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icons/favicon.svg?v={ASSET_V}" type="image/svg+xml">
<link rel="icon" href="/assets/icons/favicon-32.png?v={ASSET_V}" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png?v={ASSET_V}">
<link rel="stylesheet" href="/assets/css/main.css?v={ASSET_V}">
{extra_head}</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container">
    <a class="brand" href="/">{e(SITE['name'])}</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Main"><ul>{nav}</ul></nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="site-footer">
  <div class="container">
    <p>&copy; {date.today().year} {e(SITE['name'])}. {e(SITE['footer'])}</p>
    <ul>{links}</ul>
  </div>
</footer>
{js}
</body>
</html>
"""


def redirect_page(target, title, js_target=None):
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>{e(title)} | {e(SITE['name'])}</title>
<meta name="robots" content="noindex"><link rel="canonical" href="{e(BASE + target)}">
<meta http-equiv="refresh" content="0; url={e(target)}"><script>location.replace({js_target or json.dumps(target)})</script></head>
<body><p><a href="{e(target)}">Continue to {e(title)}</a></p></body></html>
"""


def card(p, lazy=True):
    c = cover(p)
    url = f"/projects/{p['slug']}/"
    note = '<p class="state-note">Still in progress</p>' if in_progress(p) else ""
    tech = ", ".join(p["technologies"][:5]) + (" and more" if len(p["technologies"]) > 5 else "")
    return f"""<article class="card" data-category="{e(p['category'])}">
  <a class="card-media" href="{url}" tabindex="-1" aria-hidden="true"><img src="/{c['thumb']}" alt="" width="{c['thumb_width']}" height="{c['thumb_height']}"{' loading="lazy"' if lazy else ''} decoding="async"></a>
  <div class="card-body">
    <div class="card-cat">{e(CATS[p['category']])}</div>
    <h3><a href="{url}">{e(p['title'])}</a></h3>
    <p>{e(p['summary'])}</p>
    {note}<div class="tech">{e(tech)}</div>
    <div class="card-links"><a href="{url}">View project<span class="visually-hidden">: {e(p['title'])}</span></a><a href="{repo_url(p)}" rel="noopener">GitHub repository<span class="visually-hidden"> for {e(p['title'])}</span></a></div>
  </div>
</article>"""


def photo_html():
    ph = SITE.get("profile_photo") or {}
    if not ph.get("src"):
        return ""
    ratio = PHOTO_SHAPES.get(ph.get("shape"), "1 / 1")
    width = PHOTO_SIZES.get(ph.get("size"), 220)
    focus = PHOTO_FOCUS.get(ph.get("focus"), "50% 50%")
    return (f'<figure class="profile-photo" style="width:{width}px;aspect-ratio:{ratio}">'
            f'<img src="/{e(ph["src"])}" alt="{e(ph.get("alt", SITE["name"]))}" style="object-position:{focus}" width="{width}" height="{width}"></figure>')


def contact_form():
    key = SITE.get("web3forms_access_key", "")
    return f"""<form id="contact-form" novalidate data-access-key="{e(key)}" action="https://api.web3forms.com/submit" method="post">
        <div class="row-2">
          <div class="field">
            <label for="name">Preferred name <span class="req" aria-hidden="true">*</span></label>
            <input id="name" name="name" type="text" autocomplete="name" required minlength="2" maxlength="100" aria-describedby="name-error">
            <p class="error" id="name-error" aria-live="polite"></p>
          </div>
          <div class="field">
            <label for="email">Email address <span class="req" aria-hidden="true">*</span></label>
            <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="150" aria-describedby="email-error">
            <p class="error" id="email-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="field">
          <label for="subject">Subject <span class="req" aria-hidden="true">*</span></label>
          <input id="subject" name="subject" type="text" required minlength="3" maxlength="150" aria-describedby="subject-error">
          <p class="error" id="subject-error" aria-live="polite"></p>
        </div>
        <div class="field">
          <label for="message">Message <span class="req" aria-hidden="true">*</span></label>
          <textarea id="message" name="message" required minlength="10" maxlength="5000" aria-describedby="message-error"></textarea>
          <p class="error" id="message-error" aria-live="polite"></p>
        </div>
        <div class="hp" aria-hidden="true">
          <label for="website">Leave this field empty</label>
          <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
          <input type="checkbox" name="botcheck" tabindex="-1">
        </div>
        <div class="form-foot">
          <button class="btn btn-primary" type="submit"><span class="spinner" aria-hidden="true"></span><span class="label">Send message</span></button>
          <p class="small-note">Please fill in every field. I only use your details to reply to you.</p>
        </div>
        <div id="form-status" class="form-status" role="status" aria-live="polite"></div>
      </form>"""


def build_home():
    n = {cid: sum(1 for p in PROJECTS if p["category"] == cid) for cid in CATS}
    buttons = f'<li><button type="button" class="filter-btn" data-filter="all" aria-pressed="true">All<span class="n">{len(PROJECTS)}</span></button></li>' + "".join(
        f'<li><button type="button" class="filter-btn" data-filter="{cid}" aria-pressed="false">{e(label)}<span class="n">{n[cid]}</span></button></li>'
        for cid, label in CATS.items() if n[cid])
    rows = "".join(
        f'<tr><td><a href="{e(r.get("url") or GH + "/" + r["name"])}" rel="noopener">{e(r["name"])}</a></td><td>{e(r.get("description", ""))}</td>'
        f'<td class="num">{sum(1 for p in PROJECTS if p["repo"] == r["name"])}</td></tr>'
        for r in SITE.get("repositories", []))
    links = "".join(f'<a class="btn btn-secondary" href="{e(l["url"])}" rel="noopener">{e(l["label"])}</a>' for l in SITE.get("links", []))
    body = f"""<section id="home" class="intro" aria-labelledby="hero-title">
  <div class="container intro-grid">
    <div>
      <h1 id="hero-title">{e(SITE['name'])}</h1>
      <p class="role">{e(SITE['role'])}</p>
      {f'<p class="tagline">{e(SITE["tagline"])}</p>' if SITE.get('tagline') else ''}
      <p class="lead">{e(SITE['intro'])}</p>
      <div class="actions">
        <a class="btn btn-primary" href="#projects">Explore my portfolio projects</a>
        <a class="btn btn-secondary" href="#contact">Contact me</a>
        {links}
      </div>
    </div>
    {photo_html()}
  </div>
</section>
<section id="projects" class="section anchor" aria-labelledby="projects-title">
  <div class="container">
    <div class="section-head">
      <h2 id="projects-title">My projects</h2>
      <p>Pick an area to see only those projects. Open any project to see my screenshots and how I tested it.</p>
    </div>
    <ul class="filters" data-filters>{buttons}</ul>
    <p class="result-count" data-result-count aria-live="polite">{len(PROJECTS)} projects</p>
    <div class="grid">{''.join(card(p, lazy=i > 2) for i, p in enumerate(PROJECTS))}</div>
    <div class="repos">
      <h3>Where the projects come from</h3>
      <table><thead><tr><th scope="col">Repository</th><th scope="col">What is in it</th><th scope="col" class="num">Projects</th></tr></thead><tbody>{rows}</tbody></table>
    </div>
  </div>
</section>
<section id="contact" class="section anchor contact-section" aria-labelledby="contact-title">
  <div class="container">
    <h2 id="contact-title">Contact me</h2>
    <p class="intro-text">If you would like to talk about my work or an opportunity, send me a message here and I will reply by email.</p>
    <div class="form-card">
      {contact_form()}
    </div>
  </div>
</section>"""
    desc = f"{SITE['name']}: {SITE['role']}. My hands-on projects in Microsoft Azure, Linux administration and network automation."
    return page(f"{SITE['name']} | {SITE['role']}", desc, "/", body, active="home", scripts=("main.js", "contact.js"))


def ul(items):
    return '<ul class="list">' + "".join(f"<li>{e(i)}</li>" for i in items) + "</ul>"


def build_detail(i, p):
    imgs = p["screenshots"]
    sections = [("Overview", f"<p>{e(p['overview'])}</p>")]
    if p.get("objectives"):
        sections.append(("What I set out to do", ul(p["objectives"])))
    if p.get("architecture"):
        sections.append(("Layout",
                         f'<pre role="img" aria-label="Diagram of {e(p["title"])}">{e(p["architecture"])}</pre>'
                         '<p class="small-note">This diagram comes from my project README.</p>'))
    if p.get("implementation"):
        sections.append(("What I did", ul(p["implementation"])))
    gallery = "".join(
        f'<li><figure><button type="button" data-full="/{im["src"]}" data-caption="{e(im["title"] + (". " + im["caption"] if im.get("caption") else ""))}" aria-label="Open screenshot {k}: {e(im["title"])}">'
        f'<img src="/{im["thumb"]}" alt="{e(im.get("alt") or im["title"])}" width="{im["thumb_width"]}" height="{im["thumb_height"]}" loading="lazy" decoding="async"></button>'
        f'<figcaption><strong>{k}. {e(im["title"])}</strong>{e(im.get("caption", ""))}</figcaption></figure></li>'
        for k, im in enumerate(imgs, 1))
    note = f'<p class="small-note">{e(MASK_NOTE)}</p>' if p.get("masked") or p["repo"].startswith("azure") else ""
    sections.append(("Screenshots",
                     f'<p class="small-note">They are in the same order as in my repository. Click one to see it full size.</p>{note}<ul class="gallery">{gallery}</ul>'))
    if p.get("verification"):
        sections.append(("How I tested it", ul(p["verification"])))
    if p.get("results"):
        sections.append(("Problems I hit", ul(p["results"])))
    if p.get("video"):
        sections.append(("Video", f'<p>I recorded a short <a href="{e(p["video"])}" rel="noopener">demonstration on YouTube</a>.</p>'))
    sections.append(("Repository",
                     f'<p>My full notes and the original screenshots are on GitHub: <a href="{repo_url(p)}" rel="noopener">{e(p["repo"])}{"/" + e(p["folder"]) if p.get("folder") else ""}</a></p>'))
    body_sections = "".join(
        f'<section aria-labelledby="s{k}"><h2 id="s{k}">{title}</h2>{html}</section>'
        for k, (title, html) in enumerate(sections))
    prev_p = PROJECTS[i - 1] if i > 0 else None
    next_p = PROJECTS[i + 1] if i < len(PROJECTS) - 1 else None
    pager = '<nav class="pager" aria-label="More projects">' + (
        f'<a href="/projects/{prev_p["slug"]}/"><span>Previous</span>{e(prev_p["title"])}</a>' if prev_p else "<span></span>") + (
        f'<a href="/projects/{next_p["slug"]}/" style="text-align:right"><span>Next</span>{e(next_p["title"])}</a>' if next_p else "") + "</nav>"
    status = f'<span class="state-note">{e(p["status"])}</span>' if in_progress(p) else e(p["status"])
    body = f"""<section class="page-head">
  <div class="container">
    <p class="breadcrumb"><a href="/#projects">My projects</a> / {e(CATS[p['category']])}</p>
    <h1>{e(p['title'])}</h1>
    <p>{e(p['summary'])}</p>
  </div>
</section>
<div class="section">
  <div class="container detail">
    <article>{body_sections}{pager}</article>
    <aside class="facts" aria-label="Project details">
      <dl>
        <dt>Area</dt><dd>{e(CATS[p['category']])}</dd>
        <dt>Status</dt><dd>{status}</dd>
        <dt>Tools and services</dt><dd>{e(", ".join(p['technologies']))}</dd>
        <dt>Screenshots</dt><dd>{len(imgs)}{' and a demo video' if p.get('video') else ''}</dd>
        <dt>Repository</dt><dd>{e(p['repo'])}</dd>
      </dl>
      <a class="btn btn-primary" href="{repo_url(p)}" rel="noopener">View on GitHub</a>
      <a class="btn btn-secondary" href="/#projects">Back to my projects</a>
    </aside>
  </div>
</div>
<dialog id="lightbox" class="lightbox" aria-label="Screenshot viewer">
  <div class="lightbox-inner">
    <button type="button" class="lb-btn lb-close" aria-label="Close">×</button>
    <button type="button" class="lb-btn lb-prev" aria-label="Previous screenshot">‹</button>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
    <p></p>
    <button type="button" class="lb-btn lb-next" aria-label="Next screenshot">›</button>
  </div>
</dialog>"""
    return page(p["title"], p["summary"], f"/projects/{p['slug']}/", body, active="projects")


def build_admin_redirect():
    url = SITE.get("admin_url", "").strip()
    if url:
        return redirect_page(url, "Admin")
    body = """<section class="section"><div class="container notfound">
  <h1>Admin</h1>
  <p>The admin service is not connected yet.</p>
</div></section>"""
    return page("Admin", "Admin", "/inno/", body, noindex=True)


def build_404():
    body = """<section class="section"><div class="container notfound">
  <h1>Page not found</h1>
  <p>Sorry, this page does not exist or it has moved.</p>
  <div class="actions"><a class="btn btn-primary" href="/#projects">See my projects</a><a class="btn btn-secondary" href="/">Home</a></div>
</div></section>"""
    return page("Page not found", "The page could not be found.", "/404.html", body, noindex=True)


def write(rel, html):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


def main():
    write("index.html", build_home())
    slugs = {p["slug"] for p in PROJECTS}
    for old in (ROOT / "projects").glob("*/"):
        if old.name not in slugs and (old / "index.html").exists():
            (old / "index.html").unlink()
            old.rmdir()
    for i, p in enumerate(PROJECTS):
        write(f"projects/{p['slug']}/index.html", build_detail(i, p))
    write("projects/index.html", redirect_page("/#projects", "Projects", '"/" + location.search + "#projects"'))
    write("contact/index.html", redirect_page("/#contact", "Contact me"))
    write("inno/index.html", build_admin_redirect())
    write("404.html", build_404())
    urls = ["/"] + [f"/projects/{p['slug']}/" for p in PROJECTS]
    today = date.today().isoformat()
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n")
    print(f"Built home page, {len(PROJECTS)} project pages and redirects.")


if __name__ == "__main__":
    main()
