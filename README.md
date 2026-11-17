# innocent-mbele.github.io

Source for **https://innocent-mbele.github.io**, the project portfolio of Innocent Mbele.

The site is plain HTML, CSS and JavaScript served by GitHub Pages. There is no framework, no database and no paid backend. Pages are generated from JSON data by a small Python script, and the generated HTML is committed, so GitHub Pages serves the repository as it is.

## Structure

```text
index.html                 Home (generated)
projects/index.html        Project catalogue with category filters (generated)
projects/<slug>/index.html Project detail pages (generated)
contact/index.html         Contact form (generated)
404.html                   Not-found page (generated)
assets/css/main.css        Styles
assets/js/main.js          Navigation, filters, screenshot viewer
assets/js/contact.js       Contact form validation and submission
assets/images/projects/    Optimised WebP screenshots (full size + thumbnails)
assets/icons/              Favicons and social preview image
data/site.json             Name, intro, repositories, contact form key
data/projects.json         Categories and project write-ups
data/evidence.json         Screenshot list with captions (generated)
tools/build_site.py        Generates every page from data/
tools/import_evidence.py   Imports screenshots + captions from project READMEs
tools/make_icons.py        Renders the PNG icons
.github/workflows/check.yml  CI: rebuilds the site and checks links and images
```

## Content rules

* Only public, documented projects are shown. Every project links back to its original repository.
* Text describes only what the repository documents. Planned work is not presented as done.
* Screenshots come from the project repositories. Personal account details in Azure portal screenshots (sign-in emails, tenant names, subscription IDs, browser tab titles and address bars) are masked or cropped before publishing.

## Adding a new public project

1. Publish the project in its own GitHub repository (or a folder of one), with a README that uses `### Heading`, a caption paragraph and `![alt](screenshots/file.png)` for each screenshot.
2. Add an entry to `data/projects.json`: `slug`, `repo`, `folder` (empty string for a repository root), `title`, `category` (an existing category `id`, or add a new category), `status`, `summary`, `overview`, `technologies`, and optional `objectives`, `implementation`, `verification`, `results`, `architecture`, `video`, `featured`, `cover` (1-based screenshot number for the card image).
3. Clone the source repositories into one folder and import the screenshots. Review every screenshot for personal or sensitive details first. Put masked copies in a mirror folder and pass it as the second argument:
   ```bash
   python3 tools/import_evidence.py ~/src ~/src-masked
   ```
4. Build and preview:
   ```bash
   python3 tools/build_site.py
   python3 -m http.server 8000   # open http://localhost:8000
   ```
5. Commit and push to `main`. GitHub Pages republishes within a minute or two.

Category filters are generated from `data/projects.json`, so a new category appears automatically once a project uses it.

## Contact form

The form posts to [Web3Forms](https://web3forms.com) (free plan, no backend needed). To activate it:

1. Request an access key at web3forms.com using the email address that should receive messages.
2. Put the key in `data/site.json` → `"web3forms_access_key"` and run `python3 tools/build_site.py`.
3. Commit, push, then send a test message from the live Contact page.

The access key is a public form identifier rather than a secret. It can only deliver messages to the inbox it was issued for. Spam protection uses a hidden honeypot field, a minimum fill time and Web3Forms' own filtering.

## Requirements

Python 3.12+. `tools/import_evidence.py` and `tools/make_icons.py` also need Pillow (`pip install pillow`). `tools/build_site.py` uses only the standard library.
