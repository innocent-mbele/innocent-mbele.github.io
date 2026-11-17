# innocent-mbele.github.io

Source for **https://innocent-mbele.github.io**, my project portfolio.

The site is plain HTML, CSS and JavaScript on GitHub Pages. The pages are generated from two data files by a small Python script. GitHub Actions rebuilds and publishes the site on every push to `main`. A private admin page lets me edit the content without touching code.

## How it fits together

```text
data/site.json        name, introduction, photo settings, links, repositories, contact key
data/projects.json    project areas and projects, with their screenshots
assets/               CSS, JavaScript, icons, profile photo, screenshots (WebP)
tools/build_site.py   makes index.html, projects/<slug>/index.html, redirects, 404, sitemap
tools/check_site.py   checks every internal link and image
admin/src/            admin service (Cloudflare Worker) and admin page
admin/worker.js       the same, bundled into one file to paste into Cloudflare
admin/test/           tests for the admin service
docs/ADMIN.md         how to set up the admin (Microsoft sign-in, MFA, Cloudflare)
.github/workflows/deploy.yml   build, check, test and publish
```

The home page is one long page: introduction, my projects with area filters, then the contact form. The menu scrolls to each part. Each project also has its own page with screenshots.

## Editing content

**Admin page:** open https://innocent-mbele.github.io/inno, sign in with Microsoft and press **Publish changes** when done. Setup is in [docs/ADMIN.md](docs/ADMIN.md).

**By hand:** edit `data/site.json` or `data/projects.json`, then:
```powershell
python tools/build_site.py
python tools/check_site.py
python -m http.server 8000   # open http://localhost:8000 to look
```
Commit and push. The Actions workflow publishes it.

## Content rules

- Only my own public, documented work. Every project links to its repository.
- Text says only what the repository shows. Planned work is never shown as done.
- Screenshots are checked before publishing. In Azure screenshots I cover my sign-in email, tenant name and subscription ID.

## Contact form

The form sends through [Web3Forms](https://web3forms.com). Get a free access key with the email that should receive messages, then put it in the admin under **Settings** (or in `data/site.json` → `web3forms_access_key`). Until then the form tells visitors it is not connected. The key is a public form ID, not a secret. Spam protection is a hidden honeypot field, a minimum fill time and Web3Forms' own filtering.

## Requirements

Python 3.12+ for the build. Pillow (`pip install pillow`) only for `tools/import_evidence.py` and `tools/make_icons.py`. Node.js 22+ only to test the admin service.
