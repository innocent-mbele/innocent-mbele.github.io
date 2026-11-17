"""Find and paint over Azure subscription IDs and secrets in repository screenshots.

Used by the weekly screenshot check on azure-basic-labs and azure-administrator-labs.
Account names, emails, tenant names and fictional lab users are left as they are.

What gets a red brush stroke:
  - Azure subscription IDs: any ID listed in KNOWN_SUBSCRIPTIONS, plus any GUID that the
    screenshot labels as a subscription ("Subscription ID", "SubscriptionId", ".../subscriptions/<id>").
  - Secrets: GitHub tokens, Azure storage keys and SAS signatures, AWS access keys, JWTs,
    private key blocks, and the value after password= / secret= / key= / token=.

usage:
  python3 tools/screenshot_check.py REPO_DIR [REPO_DIR ...] [--days 8 | --all] [--dry-run] [--report out.json]

--days N  only images added or changed in the last N days of git history (default 8)
--all     every image in the repository
Needs tesseract and Pillow. Prints a JSON report; never prints the IDs or secrets themselves.
"""
import json
import random
import re
import subprocess
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageDraw

KNOWN_SUBSCRIPTIONS = [
    "da5a388d-549c-4eff-9d56-e27896817af3",
    "d92ad34f-cbb2-4fb1-867a-2a655ef705ed",
]
GUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
SUB_LABEL = re.compile(r"subscription\s*id|subscriptionid|subscriptions[/%]2?f?", re.I)
SECRET_PATTERNS = [
    ("GitHub token", re.compile(r"(github_pat_|ghp_|gho_|ghs_)[A-Za-z0-9_]{10,}")),
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{12,}")),
    ("JWT or bearer token", re.compile(r"eyJ[A-Za-z0-9_-]{15,}")),
    ("private key", re.compile(r"-----BEGIN[A-Z ]*PRIVATE|PRIVATE KEY-----")),
    ("storage key or SAS", re.compile(r"AccountKey=|SharedAccessSignature|[?&]sig=[A-Za-z0-9%]{10,}", re.I)),
    ("long key value", re.compile(r"^[A-Za-z0-9+/]{40,}={0,2}$")),
]
VALUE_AFTER = re.compile(r"(password|passwd|pwd|secret|api[_-]?key|token)[:=]$", re.I)
OCR_FIX = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "—": "-", "–": "-"})
RED = (200, 32, 32)
IMAGE_EXT = (".png", ".jpg", ".jpeg")


def pieces(ids):
    out = set()
    for s in ids:
        out.update(p for p in s.split("-") if len(p) >= 4)
        flat = s.replace("-", "")
        out.update(flat[i:i + 8] for i in range(0, 25, 4))
    return re.compile("|".join(sorted((re.escape(p) for p in out), key=len, reverse=True)), re.I)


def changed_images(repo, days):
    if days is None:
        files = subprocess.run(["git", "-C", repo, "ls-files"], capture_output=True, text=True).stdout.split("\n")
    else:
        files = subprocess.run(["git", "-C", repo, "log", f"--since={days} days ago", "--name-only", "--diff-filter=AM", "--format="],
                               capture_output=True, text=True).stdout.split("\n")
    return sorted({f for f in files if f.lower().endswith(IMAGE_EXT) and (Path(repo) / f).exists()})


def ocr_words(img):
    words = []
    for scale in (1, 2, 3):
        big = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
        for psm in (3, 6, 11):
            d = pytesseract.image_to_data(big, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
            for i, w in enumerate(d["text"]):
                if w.strip():
                    box = tuple(d[k][i] // scale for k in ("left", "top", "width", "height"))
                    words.append((w.replace("—", "-"), box, (d["block_num"][i], d["par_num"][i], d["line_num"][i], scale, psm)))
    return words


def find(img, known_re, known):
    words = ocr_words(img)
    hits = []
    lines = {}
    for w, box, line in words:
        lines.setdefault(line, []).append((w, box))
    for line_words in lines.values():
        text = " ".join(w for w, _ in line_words)
        labelled = bool(SUB_LABEL.search(text))
        for idx, (w, box) in enumerate(line_words):
            if known_re.search(w):
                hits.append(("subscription ID", box))
                continue
            g = GUID.search(w.translate(OCR_FIX))
            if g and labelled:
                known.add(g.group(0).lower())
                hits.append(("subscription ID", box))
                continue
            for label, rx in SECRET_PATTERNS:
                if rx.search(w):
                    hits.append((label, box))
                    break
            else:
                before = "".join(x for x, _ in line_words[max(0, idx - 2):idx])
                if idx > 0 and VALUE_AFTER.search(before) and len(w) >= 4:
                    hits.append(("password or secret value", box))
    return hits


def brush(draw, box, rng):
    x, y, w, h = box
    h = max(8, h)
    width = int(h * 0.75) + 2
    for k in range(3):
        yy = y + h * (0.2 + 0.3 * k)
        pts, xx = [], x - 3
        while xx <= x + w + 3:
            pts.append((xx, yy + rng.uniform(-h * 0.12, h * 0.12)))
            xx += max(6, h * 0.6)
        pts.append((x + w + 3, yy))
        draw.line(pts, fill=RED, width=width, joint="curve")
        for px, py in (pts[0], pts[-1]):
            r = width / 2
            draw.ellipse([px - r, py - r, px + r, py + r], fill=RED)


def main():
    args = sys.argv[1:]
    days = 8
    dry = "--dry-run" in args
    report_path = None
    if "--all" in args:
        days = None
    if "--days" in args:
        days = int(args[args.index("--days") + 1])
    if "--report" in args:
        report_path = args[args.index("--report") + 1]
    repos = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--days", "--report"))]
    known = {s.lower() for s in KNOWN_SUBSCRIPTIONS}
    report = {"checked": 0, "painted": []}
    for repo in repos:
        for rel in changed_images(repo, days):
            path = Path(repo) / rel
            img = Image.open(path).convert("RGB")
            rng = random.Random(rel)
            found = []
            for _ in range(3):
                hits = find(img, pieces(known), known)
                if not hits:
                    break
                draw = ImageDraw.Draw(img)
                for label, box in hits:
                    brush(draw, box, rng)
                    found.append(label)
            report["checked"] += 1
            if found:
                kinds = sorted(set(found))
                report["painted"].append({"repo": Path(repo).name, "file": rel, "what": kinds})
                if not dry:
                    img.save(path, optimize=True)
    report["new_subscription_ids_found"] = len(known - {s.lower() for s in KNOWN_SUBSCRIPTIONS})
    out = json.dumps(report, indent=1)
    if report_path:
        Path(report_path).write_text(out)
    print(out)


if __name__ == "__main__":
    main()
