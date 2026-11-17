"""Static checks: every internal link and image reference resolves to a file.

usage: python3 tools/check_site.py   (exit code 1 on problems)
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src", "data-full") and v:
                self.refs.append(v)


problems = []
pages = [p for p in ROOT.rglob("*.html") if ".git" not in p.parts]
for page in pages:
    parser = Refs()
    parser.feed(page.read_text(encoding="utf-8"))
    for ref in parser.refs:
        if re.match(r"^(https?:|mailto:|data:|#)", ref):
            continue
        path = ref.split("#")[0].split("?")[0]
        target = ROOT / path.lstrip("/") if path.startswith("/") else page.parent / path
        if path.endswith("/") or target.is_dir():
            target = target / "index.html"
        if not target.exists():
            problems.append(f"{page.relative_to(ROOT)}: missing {ref}")
    if "@" in re.sub(r"<[^>]+>", "", page.read_text(encoding="utf-8")).replace("&#x27;", ""):
        text = re.sub(r"<[^>]+>", " ", page.read_text(encoding="utf-8"))
        if re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text):
            problems.append(f"{page.relative_to(ROOT)}: visible email address")

print(f"Checked {len(pages)} pages.")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print("All internal links and images resolve.")
