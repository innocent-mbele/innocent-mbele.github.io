"""Paint over Azure subscription IDs in screenshots with a red freehand brush.
Nothing else in the image is changed. Used by the weekly redaction task.

usage: python3 -I tools/paint_subscription_ids.py SRC_ROOT LIST_FILE OUT_ROOT REPORT_JSON
  SRC_ROOT   folder the paths in LIST_FILE are relative to
  LIST_FILE  one image path per line
  OUT_ROOT   where painted copies are written (same relative paths)
  REPORT_JSON  which OCR words were painted in each image
Add any new subscription ID to SUBS below. Needs tesseract, pytesseract and Pillow.
"""
import json
import random
import re
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageDraw

SUBS = ["da5a388d-549c-4eff-9d56-e27896817af3", "d92ad34f-cbb2-4fb1-867a-2a655ef705ed"]
# Distinctive pieces of each ID; OCR often splits or garbles the full string.
PIECES = sorted({p for s in SUBS for p in s.split("-")} | {s.replace("-", "")[i:i + 8] for s in SUBS for i in range(0, 25, 4)}, key=len, reverse=True)
PIECE_RE = re.compile("|".join(re.escape(p) for p in PIECES if len(p) >= 4), re.I)
RED = (200, 32, 32)


def brush(draw, x0, y0, x1, y1, rng):
    """Freehand paint: overlapping round dabs along a wobbly path, with varying
    width, ragged ends and slight colour changes, like a quick brush stroke."""
    h = max(8, y1 - y0)
    import math
    passes = [0.33, 0.67] if h < 26 else [0.25, 0.5, 0.75]
    for k, frac in enumerate(passes):
        forward = k % 2 == 0
        xs, xe = (x0 - rng.uniform(3, 7), x1 + rng.uniform(3, 7))
        if not forward:
            xs, xe = xe, xs
        length = abs(xe - xs)
        y = y0 + h * frac + rng.uniform(-h * 0.06, h * 0.06)
        drift = rng.uniform(-0.04, 0.04) * h
        phase = rng.uniform(0, 6.28)
        r_base = h * rng.uniform(0.46, 0.56)
        t = 0.0
        while t <= 1.0:
            x = xs + (xe - xs) * t
            wob = math.sin(phase + t * length / max(h, 1) * 0.9) * h * 0.09 + rng.uniform(-h * 0.03, h * 0.03)
            taper = min(1.0, 0.55 + 4 * min(t, 1 - t))        # thinner at both ends
            r = r_base * taper * rng.uniform(0.9, 1.08)
            cy = y + wob + drift * t
            shade = rng.randint(-14, 10)
            col = (min(255, 200 + shade), max(0, 32 + shade // 2), max(0, 32 + shade // 2))
            draw.ellipse([x - r, cy - r, x + r, cy + r], fill=col)
            t += max(0.004, (r * 0.3) / max(length, 1))
        # a few bristle flecks at the end of each pass
        for _ in range(rng.randint(2, 4)):
            fx = xe + rng.uniform(-3, 3) * (1 if forward else -1)
            fy = y + rng.uniform(-h * 0.35, h * 0.35)
            fr = h * rng.uniform(0.08, 0.16)
            draw.ellipse([fx - fr, fy - fr, fx + fr, fy + fr], fill=RED)


def find_boxes(img):
    boxes = []
    for scale in (1, 2, 3):
        big = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
        for psm in (3, 6, 11):
            d = pytesseract.image_to_data(big, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
            for i, w in enumerate(d["text"]):
                if w and PIECE_RE.search(w.replace("—", "-")):
                    x, y, bw, bh = (d[k][i] // scale for k in ("left", "top", "width", "height"))
                    boxes.append((x, y, x + bw, y + bh, w))
    return boxes


src_root, lst, out_root, report = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
result = {}
for rel in lst.read_text().split():
    img = Image.open(src_root / rel).convert("RGB")
    rng = random.Random(rel)
    found = []
    for _ in range(3):  # paint, look again, paint what is left
        boxes = find_boxes(img)
        if not boxes:
            break
        draw = ImageDraw.Draw(img)
        for x0, y0, x1, y1, w in boxes:
            brush(draw, x0, y0, x1, y1, rng)
            found.append(w)
    out = out_root / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    result[rel] = sorted(set(found))
report.write_text(json.dumps(result, indent=1))
print(sum(1 for v in result.values() if v), "of", len(result), "images painted")
