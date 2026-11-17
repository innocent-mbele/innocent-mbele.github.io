"""Import screenshots and captions from the source project repositories.

For each project in data/projects.json this reads the project's README in a
local clone of its repository, collects every screenshot in README order with
its heading and caption, writes optimised WebP copies (full size and
thumbnail) under assets/images/projects/<slug>/, and records the result in
data/evidence.json.

usage:
  python3 tools/import_evidence.py SOURCE_DIR [IMAGE_DIR]

SOURCE_DIR  folder holding clones of the project repositories
IMAGE_DIR   optional folder with reviewed/masked copies of the screenshots,
            laid out like SOURCE_DIR (repo/folder/screenshots/x.png). When a
            masked copy exists it is used instead of the original.
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FULL_WIDTH = 1600
THUMB_WIDTH = 720
IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def parse_readme(text):
    """Return [(heading, caption, alt, path)] in document order."""
    items, heading, para = [], "", []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            heading = re.sub(r"^#+\s*(\d+\.\s*)?", "", s).strip()
            para = []
            continue
        m = IMG_RE.search(s)
        if m:
            alt, path = m.groups()
            if path.startswith("http"):
                continue
            items.append((heading, " ".join(para).strip(), alt.strip(), path.strip()))
            para = []
        elif s and not s.startswith(("---", "```", "[!")):
            para.append(s)
        elif not s:
            pass
    return items


def save_webp(src, dest, width):
    im = Image.open(src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=82, method=6)
    return im.size


def main():
    source = Path(sys.argv[1])
    masked = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    data = json.loads((ROOT / "data/projects.json").read_text())
    evidence = {}
    for p in data["projects"]:
        base = source / p["repo"] / p["folder"] if p["folder"] else source / p["repo"]
        items = parse_readme((base / "README.md").read_text(encoding="utf-8"))
        out = []
        for i, (heading, caption, alt, rel) in enumerate(items, 1):
            rel_path = (Path(p["repo"]) / p["folder"] / rel) if p["folder"] else Path(p["repo"]) / rel
            src = (masked / rel_path) if masked and (masked / rel_path).exists() else source / rel_path
            name = f"{i:02d}-" + re.sub(r"[^a-z0-9]+", "-", Path(rel).stem.lower()).strip("-")
            img_dir = ROOT / "assets/images/projects" / p["slug"]
            w, h = save_webp(src, img_dir / f"{name}.webp", FULL_WIDTH)
            tw, th = save_webp(src, img_dir / f"{name}-thumb.webp", THUMB_WIDTH)
            out.append({
                "title": heading or alt,
                "caption": caption,
                "alt": alt if alt and not alt.lower().startswith("screenshot") else heading,
                "src": f"assets/images/projects/{p['slug']}/{name}.webp",
                "thumb": f"assets/images/projects/{p['slug']}/{name}-thumb.webp",
                "width": w, "height": h, "thumb_width": tw, "thumb_height": th,
                "original": f"https://github.com/innocent-mbele/{rel_path.as_posix()}".replace(
                    f"innocent-mbele/{p['repo']}/", f"innocent-mbele/{p['repo']}/blob/main/"),
            })
        evidence[p["slug"]] = out
        print(f"{p['slug']}: {len(out)} images")
    (ROOT / "data/evidence.json").write_text(json.dumps(evidence, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
