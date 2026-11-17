"""Generate the static portfolio from data/*.json.

usage: python3 tools/build_site.py

Reads data/site.json, data/projects.json and data/evidence.json and writes:
  index.html, projects/index.html, projects/<slug>/index.html,
  contact/index.html, 404.html, sitemap.xml
Only the Python standard library is used.
"""
import json
from datetime import date
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))
DATA = json.loads((ROOT / "data/projects.json").read_text(encoding="utf-8"))
EVIDENCE = json.loads((ROOT / "data/evidence.json").read_text(encoding="utf-8"))
BASE = SITE["base_url"].rstrip("/")
GH = f"https://github.com/{SITE['github_user']}"
CATS = {c["id"]: c["label"] for c in DATA["categories"]}
PROJECTS = DATA["projects"]
MASK_NOTE = ("Personal account details visible in the original Azure screenshots "
             "(sign-in email addresses, tenant names and subscription identifiers) are masked in these copies.")

for p in PROJECTS:
    if p["category"] not in CATS:
        raise SystemExit(f"Unknown category {p['category']!r} in {p['slug']}")
    if p["slug"] not in EVIDENCE or not EVIDENCE[p["slug"]]:
        raise SystemExit(f"No evidence images for {p['slug']}; run tools/import_evidence.py")


def e(s):
    return escape(str(s), quote=True)


def repo_url(p):
    url = f"{GH}/{p['repo']}"
    return f"{url}/tree/main/{p['folder']}" if p["folder"] else url


def cover(p):
    imgs = EVIDENCE[p["slug"]]
    return imgs[p.get("cover", len(imgs)) - 1]


def status_html(p):
    cls = "status in-progress" if p["status"].lower().startswith("in progress") else "status"
    return f'<span class="{cls}">{e(p["status"])}</span>'


def page(title, description, path, body, active="", extra_head="", scripts=("main.js",)):
    canonical = f"{BASE}{path}"
    nav = "".join(
        f'<li><a href="{href}"{" aria-current=\"page\"" if key == active else ""}>{label}</a></li>'
        for key, href, label in (("home", "/", "Home"), ("projects", "/projects/", "Projects"), ("contact", "/contact/", "Contact"))
    )
    js = "".join(f'<script src="/assets/js/{s}" defer></script>' for s in scripts)
    full_title = title if title.startswith(SITE["name"]) else f"{title} | {SITE['name']}"
    return f"""<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(canonical)}">
<meta name="author" content="{e(SITE['name'])}">
<meta name="theme-color" content="#0b1626">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{e(SITE['name'])}">
<meta property="og:title" content="{e(full_title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(canonical)}">
<meta property="og:image" content="{BASE}/assets/icons/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/main.css">
{extra_head}</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container">
    <a class="brand" href="/" aria-label="{e(SITE['name'])}, home"><span class="brand-mark" aria-hidden="true">IM</span><span>{e(SITE['name'])}</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Main"><ul>{nav}</ul></nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="site-footer">
  <div class="container">
    <p>&copy; {date.today().year} {e(SITE['name'])}. Project evidence is drawn from public GitHub repositories.</p>
    <ul><li><a href="/projects/">Projects</a></li><li><a href="/contact/">Contact</a></li><li><a href="{GH}" rel="noopener">GitHub</a></li></ul>
  </div>
</footer>
{js}
</body>
</html>
"""


def tags(items, limit=None):
    shown = items[:limit] if limit else items
    more = f'<li class="tag">+{len(items) - limit}</li>' if limit and len(items) > limit else ""
    return '<ul class="card-tech" aria-label="Technologies">' + "".join(
        f'<li class="tag">{e(t)}</li>' for t in shown) + more + "</ul>"


def card(p, heading="h3", lazy=True):
    c = cover(p)
    url = f"/projects/{p['slug']}/"
    return f"""<article class="card reveal" data-category="{e(p['category'])}">
  <a class="card-media" href="{url}" tabindex="-1" aria-hidden="true"><img src="/{c['thumb']}" alt="" width="{c['thumb_width']}" height="{c['thumb_height']}"{' loading="lazy"' if lazy else ''} decoding="async"></a>
  <div class="card-body">
    <div class="card-meta"><span class="badge">{e(CATS[p['category']])}</span>{status_html(p)}</div>
    <{heading}><a href="{url}">{e(p['title'])}</a></{heading}>
    <p>{e(p['summary'])}</p>
    {tags(p['technologies'], 5)}
    <div class="card-actions"><a href="{url}">View project <span aria-hidden="true">→</span><span class="visually-hidden">: {e(p['title'])}</span></a><a href="{repo_url(p)}" rel="noopener">GitHub repository<span class="visually-hidden"> for {e(p['title'])}</span></a></div>
  </div>
</article>"""


def build_home():
    featured = [p for p in PROJECTS if p.get("featured")]
    counts = {cid: sum(1 for p in PROJECTS if p["category"] == cid) for cid in CATS}
    areas = "".join(
        f'<li><a href="/projects/?category={cid}"><span class="count">{counts[cid]}</span>'
        f'<span class="label">{e(label)}</span><span class="src">{"project" if counts[cid] == 1 else "projects"}</span></a></li>'
        for cid, label in CATS.items() if counts[cid])
    body = f"""<section class="hero" aria-labelledby="hero-title">
  <div class="container">
    <p class="eyebrow">Project portfolio</p>
    <h1 id="hero-title">{e(SITE['name'])}</h1>
    <p class="role">{e(SITE['role'])}</p>
    <p class="tagline">{e(SITE['tagline'])}</p>
    <p class="intro">{e(SITE['intro'])}</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="/projects/">Explore Projects</a>
      <a class="btn btn-ghost" href="/contact/">Get in touch</a>
    </div>
  </div>
</section>
<section class="section" aria-labelledby="featured-title">
  <div class="container">
    <div class="section-head">
      <div><h2 id="featured-title">Featured projects</h2>
      <p>A selection of documented implementations, each with screenshots and verification steps.</p></div>
      <a class="btn btn-outline" href="/projects/">All {len(PROJECTS)} projects</a>
    </div>
    <div class="grid">{''.join(card(p, lazy=i > 2) for i, p in enumerate(featured))}</div>
  </div>
</section>
<section class="section" style="padding-top:0" aria-labelledby="areas-title">
  <div class="container">
    <div class="section-head"><div><h2 id="areas-title">Areas of work</h2>
    <p>Categories are drawn from the projects themselves. Choose one to open the filtered catalogue.</p></div></div>
    <ul class="area-list">{areas}</ul>
  </div>
</section>"""
    desc = f"{SITE['name']}: {SITE['role']}. Documented projects in Microsoft Azure, Linux administration and network automation."
    return page(f"{SITE['name']} | {SITE['role']}", desc, "/", body, active="home")


def build_catalogue():
    counts = {cid: sum(1 for p in PROJECTS if p["category"] == cid) for cid in CATS}
    buttons = f'<li><button type="button" class="filter-btn" data-filter="all" aria-pressed="true">All<span class="n">{len(PROJECTS)}</span></button></li>' + "".join(
        f'<li><button type="button" class="filter-btn" data-filter="{cid}" aria-pressed="false">{e(label)}<span class="n">{counts[cid]}</span></button></li>'
        for cid, label in CATS.items() if counts[cid])
    repos = "".join(
        f'<li><a href="{GH}/{r["name"]}" rel="noopener">{e(r["title"])}</a><span>{e(r["description"])} '
        f'{sum(1 for p in PROJECTS if p["repo"] == r["name"])} project(s).</span></li>'
        for r in SITE["repositories"])
    body = f"""<section class="page-head">
  <div class="container">
    <h1>Projects</h1>
    <p>{len(PROJECTS)} documented projects from {len(SITE['repositories'])} public GitHub repositories. Filter by area, open a project for screenshots and verification, or go straight to its repository.</p>
  </div>
</section>
<section class="section">
  <div class="container">
    <h2 class="visually-hidden">Filter by category</h2>
    <ul class="filters" data-filters role="list">{buttons}</ul>
    <p class="result-count" data-result-count aria-live="polite">{len(PROJECTS)} projects shown</p>
    <div class="grid">{''.join(card(p, lazy=i > 2) for i, p in enumerate(PROJECTS))}</div>
    <div class="collections">
      <h2>Source repositories</h2>
      <ul>{repos}</ul>
    </div>
  </div>
</section>"""
    return page("Projects", f"Catalogue of {len(PROJECTS)} documented technology projects by {SITE['name']}, filterable by category.", "/projects/", body, active="projects")


def ul(items):
    return '<ul class="list">' + "".join(f"<li>{e(i)}</li>" for i in items) + "</ul>"


def build_detail(i, p):
    imgs = EVIDENCE[p["slug"]]
    sections = [("Project overview", f"<p>{e(p['overview'])}</p>")]
    if p.get("objectives"):
        sections.append(("Objectives", ul(p["objectives"])))
    if p.get("architecture"):
        sections.append(("Architecture and design",
                         f'<pre role="img" aria-label="Architecture diagram for {e(p["title"])} from the repository README">{e(p["architecture"])}</pre>'
                         '<p class="note">Diagram reproduced from the project README.</p>'))
    if p.get("implementation"):
        sections.append(("Implementation", ul(p["implementation"])))
    gallery = "".join(
        f'<li><figure><button type="button" data-full="/{im["src"]}" data-caption="{e(im["title"] + ": " + im["caption"] if im["caption"] else im["title"])}" aria-label="Enlarge screenshot {n}: {e(im["title"])}">'
        f'<img src="/{im["thumb"]}" alt="{e(im["alt"] + (" — " + im["caption"] if im["caption"] else ""))}" width="{im["thumb_width"]}" height="{im["thumb_height"]}" loading="lazy" decoding="async"></button>'
        f'<figcaption><strong><span class="num">{n}.</span>{e(im["title"])}</strong>{e(im["caption"])}</figcaption></figure></li>'
        for n, im in enumerate(imgs, 1))
    note = f'<p class="note">{e(MASK_NOTE)}</p>' if p["repo"].startswith("azure") else ""
    sections.append(("Screenshots and evidence",
                     f'<p>{len(imgs)} screenshots from the repository, in the order documented. Select an image to view it full size.</p>{note}<ul class="gallery">{gallery}</ul>'))
    if p.get("verification"):
        sections.append(("Testing and verification", ul(p["verification"])))
    if p.get("results"):
        sections.append(("Results and observations", ul(p["results"])))
    if p.get("video"):
        sections.append(("Demonstration video", f'<p><a href="{e(p["video"])}" rel="noopener">Watch the demonstration on YouTube</a>, recorded by the author for this project.</p>'))
    sections.append(("Original GitHub repository",
                     f'<p>The full documentation and original screenshots are in <a href="{repo_url(p)}" rel="noopener">{e(p["repo"])}{"/" + e(p["folder"]) if p["folder"] else ""}</a>.</p>'))

    body_sections = "".join(
        f'<section aria-labelledby="s{k}"><h2 id="s{k}">{title}</h2>{html}</section>'
        for k, (title, html) in enumerate(sections))
    prev_p = PROJECTS[i - 1] if i > 0 else None
    next_p = PROJECTS[i + 1] if i < len(PROJECTS) - 1 else None
    pager = '<nav class="pager" aria-label="More projects">' + (
        f'<a href="/projects/{prev_p["slug"]}/"><span>Previous</span>{e(prev_p["title"])}</a>' if prev_p else "<span></span>") + (
        f'<a href="/projects/{next_p["slug"]}/" style="text-align:right"><span>Next</span>{e(next_p["title"])}</a>' if next_p else "") + "</nav>"
    body = f"""<section class="page-head">
  <div class="container">
    <p class="breadcrumb"><a href="/projects/">Projects</a> / <a href="/projects/?category={p['category']}">{e(CATS[p['category']])}</a></p>
    <div class="card-meta"><span class="badge">{e(CATS[p['category']])}</span>{status_html(p)}</div>
    <h1>{e(p['title'])}</h1>
    <p>{e(p['summary'])}</p>
  </div>
</section>
<div class="section">
  <div class="container detail">
    <article>{body_sections}{pager}</article>
    <aside class="facts" aria-label="Project facts">
      <dl>
        <dt>Category</dt><dd>{e(CATS[p['category']])}</dd>
        <dt>Status</dt><dd>{e(p['status'])}</dd>
        <dt>Technologies used</dt><dd>{tags(p['technologies'])}</dd>
        <dt>Evidence</dt><dd>{len(imgs)} screenshots{' + demo video' if p.get('video') else ''}</dd>
        <dt>Repository</dt><dd>{e(p['repo'])}</dd>
      </dl>
      <a class="btn btn-primary" href="{repo_url(p)}" rel="noopener">View on GitHub</a>
      <a class="btn btn-outline" href="/projects/">All projects</a>
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


def build_contact():
    key = SITE.get("web3forms_access_key", "")
    body = f"""<section class="page-head">
  <div class="container">
    <h1>Contact</h1>
    <p>Questions about a project or an opportunity? Send a message and I will reply by email.</p>
  </div>
</section>
<section class="section">
  <div class="container contact-wrap">
    <div class="form-card">
      <form id="contact-form" novalidate data-access-key="{e(key)}" action="https://api.web3forms.com/submit" method="post">
        <div class="field">
          <label for="name">Full name <span class="req" aria-hidden="true">*</span></label>
          <input id="name" name="name" type="text" autocomplete="name" required minlength="2" maxlength="100" aria-describedby="name-error">
          <p class="error" id="name-error" aria-live="polite"></p>
        </div>
        <div class="field">
          <label for="email">Email address <span class="req" aria-hidden="true">*</span></label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="150" aria-describedby="email-error">
          <p class="error" id="email-error" aria-live="polite"></p>
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
        <button class="btn btn-primary" type="submit"><span class="spinner" aria-hidden="true"></span><span class="label">Send message</span></button>
        <p class="field hint" style="margin-top:.75rem">All fields are required. Your details are used only to reply to your message.</p>
        <div id="form-status" class="form-status" role="status" aria-live="polite"></div>
      </form>
    </div>
    <div class="side-note">
      <h2>Before you write</h2>
      <p>Every project on this site links to its public GitHub repository, where the full documentation and original screenshots can be reviewed.</p>
      <p><a href="/projects/">Browse the projects</a></p>
    </div>
  </div>
</section>"""
    return page("Contact", f"Contact {SITE['name']} through the portfolio contact form.", "/contact/", body,
                active="contact", scripts=("main.js", "contact.js"))


def build_404():
    body = """<section class="section"><div class="container notfound">
  <p class="code">404</p>
  <h1>Page not found</h1>
  <p>The page you were looking for does not exist or has moved.</p>
  <div class="hero-actions"><a class="btn btn-primary" href="/projects/">Browse projects</a><a class="btn btn-outline" href="/">Home</a></div>
</div></section>"""
    return page("Page not found", "The requested page could not be found.", "/404.html", body)


def write(rel, html):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


def main():
    write("index.html", build_home())
    write("projects/index.html", build_catalogue())
    for i, p in enumerate(PROJECTS):
        write(f"projects/{p['slug']}/index.html", build_detail(i, p))
    write("contact/index.html", build_contact())
    write("404.html", build_404())
    urls = ["/", "/projects/", "/contact/"] + [f"/projects/{p['slug']}/" for p in PROJECTS]
    today = date.today().isoformat()
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "".join(f"  <url><loc>{BASE}{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n")
    print(f"Built {len(urls) + 1} pages ({len(PROJECTS)} projects).")


if __name__ == "__main__":
    main()
