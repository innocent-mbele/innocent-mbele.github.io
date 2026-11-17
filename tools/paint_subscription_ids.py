"""Paint over Azure subscription IDs with a natural red marker stroke.

Each ID gets one solid marker stroke that covers the whole ID (including short
leftover characters at its ends), then one or two shorter passes on top, as if
drawn twice by hand: smooth but slightly wavy edges, a little tilt, rounded
ends, slightly different reds and faint brush streaks. Drawn at 4x and scaled
down so the edges are smooth. Everything is fully opaque, so nothing
underneath shows through.

usage: python3 -I tools/paint_subscription_ids.py SRC_ROOT LIST_FILE OUT_ROOT REPORT_JSON
  SRC_ROOT     folder the paths in LIST_FILE are relative to
  LIST_FILE    one image path per line
  OUT_ROOT     where painted copies are written (same relative paths)
  REPORT_JSON  which OCR words were painted in each image
Used for all screenshot redaction, by hand and by the weekly task. Add any new
subscription ID to SUBS below. Needs tesseract, pytesseract and Pillow.
"""
import json
import math
import random
import re
import sys
from pathlib import Path

import pytesseract
from PIL import Image, ImageDraw, ImageFilter

SUBS = ["da5a388d-549c-4eff-9d56-e27896817af3", "d92ad34f-cbb2-4fb1-867a-2a655ef705ed"]
PIECES = sorted({p for s in SUBS for p in s.split("-")} | {s.replace("-", "")[i:i + 8] for s in SUBS for i in range(0, 25, 4)}, key=len, reverse=True)
PIECE_RE = re.compile("|".join(re.escape(p) for p in PIECES if len(p) >= 4), re.I)
HEXISH = re.compile(r"^[0-9a-fA-F%/\-_.]{2,}$")
SS = 4  # supersampling


def smooth_noise(rng, n, scale):
    """A few low-frequency sine waves: gentle, natural wobble."""
    waves = [(rng.uniform(0.5, 1.6), rng.uniform(0, 6.3), rng.uniform(0.3, 1.0)) for _ in range(3)]
    tot = sum(a for _, _, a in waves)
    return [scale * sum(a * math.sin(f * 2 * math.pi * i / max(n - 1, 1) + p) for f, p, a in waves) / tot for i in range(n)]


def stroke(draw, x0, x1, yc, thick, tilt, rng, color):
    n = max(12, int((x1 - x0) / (thick * 0.25)))
    top_n = smooth_noise(rng, n, thick * 0.10)
    bot_n = smooth_noise(rng, n, thick * 0.10)
    mid_n = smooth_noise(rng, n, thick * 0.12)
    top, bot = [], []
    for i in range(n):
        t = i / (n - 1)
        x = x0 + (x1 - x0) * t
        y = yc + tilt * (t - 0.5) + mid_n[i]
        # slightly thinner towards the ends, a touch heavier where the stroke starts
        w = thick * (0.80 + 0.20 * math.sin(math.pi * min(1, t * 1.15))) * (1.04 - 0.08 * t)
        top.append((x, y - w / 2 + top_n[i]))
        bot.append((x, y + w / 2 + bot_n[i]))
    poly = top + bot[::-1]
    draw.polygon(poly, fill=color)
    # rounded, slightly uneven ends
    for (xa, ya), (xb, yb) in ((top[0], bot[0]), (top[-1], bot[-1])):
        r = abs(yb - ya) / 2 * rng.uniform(0.9, 1.05)
        cx, cy = xa + rng.uniform(-r * 0.15, r * 0.15), (ya + yb) / 2
        draw.ellipse([cx - r * 1.05, cy - r, cx + r * 1.05, cy + r], fill=color)
    return top, bot


def paint(img, x0, y0, x1, y1, rng):
    h = max(8, y1 - y0)
    pad = h * 0.5
    bx0, by0 = int(max(0, x0 - pad * 2)), int(max(0, y0 - pad * 2))
    bx1, by1 = int(min(img.width, x1 + pad * 2)), int(min(img.height, y1 + pad * 2))
    W, H = (bx1 - bx0) * SS, (by1 - by0) * SS
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    sx0, sx1 = (x0 - bx0 - rng.uniform(3, 6)) * SS, (x1 - bx0 + rng.uniform(4, 8)) * SS
    yc = ((y0 + y1) / 2 - by0) * SS
    hS = h * SS
    base = rng.randint(188, 206)
    # 1) one solid base stroke that fully covers the text
    col = (base, rng.randint(26, 38), rng.randint(28, 40), 255)
    top, bot = stroke(d, sx0, sx1, yc + rng.uniform(-hS * 0.04, hS * 0.04), hS * rng.uniform(1.45, 1.55),
                      rng.uniform(-0.10, 0.10) * hS, rng, col)
    # 2) one or two lighter passes on top, slightly shorter and tilted, like going over it again
    for k in range(rng.randint(1, 2)):
        shade = base + rng.randint(-14, 6)
        c2 = (shade, rng.randint(22, 40), rng.randint(24, 42), 255)
        off = rng.choice([-1, 1]) * hS * rng.uniform(0.12, 0.26)
        a = sx0 + rng.uniform(hS * 0.1, hS * 0.7)
        b = sx1 - rng.uniform(hS * 0.1, hS * 0.9)
        stroke(d, a, b, yc + off, hS * rng.uniform(0.55, 0.75), rng.uniform(-0.12, 0.12) * hS, rng, c2)
    # 3) faint dry-brush streaks inside the base stroke
    for _ in range(rng.randint(2, 4)):
        f = rng.uniform(0.2, 0.8)
        pts = [(tx, ty + (by - ty) * (f + rng.uniform(-0.02, 0.02))) for (tx, ty), (_, by) in zip(top, bot)]
        cut = rng.randint(0, len(pts) // 3)
        pts = pts[cut: len(pts) - rng.randint(0, len(pts) // 3)]
        if len(pts) > 1:
            d.line(pts, fill=(min(255, base + 16), 52, 52, 255), width=max(1, int(hS * 0.03)))
    layer = layer.resize((bx1 - bx0, by1 - by0), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
    img.alpha_composite(layer, (bx0, by0))


def find_boxes(img):
    found = []
    rgb = img.convert("RGB")
    for scale in (1, 2, 3):
        big = rgb.resize((rgb.width * scale, rgb.height * scale), Image.LANCZOS)
        for psm in (3, 6, 11):
            d = pytesseract.image_to_data(big, config=f"--psm {psm}", output_type=pytesseract.Output.DICT)
            words = [(d["text"][i], *(d[k][i] // scale for k in ("left", "top", "width", "height")))
                     for i in range(len(d["text"])) if d["text"][i].strip()]
            for i, (w, x, y, bw, bh) in enumerate(words):
                if not PIECE_RE.search(w):
                    continue
                X0, Y0, X1, Y1 = x, y, x + bw, y + bh
                # swallow short hex-looking leftovers on the same line (e.g. the "af3" tail)
                for (w2, x2, y2, bw2, bh2) in words:
                    same_line = abs((y2 + bh2 / 2) - (y + bh / 2)) < bh * 0.6
                    near = -bh * 2.5 < x2 - X1 < bh * 1.2 or -bh * 2.5 < X0 - (x2 + bw2) < bh * 1.2
                    if same_line and near and HEXISH.match(w2) and len(w2) <= 12:
                        X0, X1 = min(X0, x2), max(X1, x2 + bw2)
                        Y0, Y1 = min(Y0, y2), max(Y1, y2 + bh2)
                found.append((X0, Y0, X1, Y1, w))
    # merge overlapping boxes so each ID gets one stroke
    found.sort()
    merged = []
    for b in found:
        if merged:
            m = merged[-1]
            if b[0] <= m[2] + 4 and not (b[3] < m[1] - 2 or b[1] > m[3] + 2):
                merged[-1] = (min(m[0], b[0]), min(m[1], b[1]), max(m[2], b[2]), max(m[3], b[3]), m[4])
                continue
        merged.append(b)
    return merged


if __name__ == "__main__":
    src_root, lst, out_root, report = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
    result = {}
    for rel in lst.read_text().split():
        img = Image.open(src_root / rel).convert("RGBA")
        rng = random.Random(rel)
        words = []
        for _ in range(3):
            boxes = find_boxes(img)
            if not boxes:
                break
            for x0, y0, x1, y1, w in boxes:
                paint(img, x0, y0, x1, y1, rng)
                words.append(w)
        out = out_root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        img.convert("RGB").save(out)
        result[rel] = sorted(set(words))
    report.write_text(json.dumps(result, indent=1))
    print(sum(1 for v in result.values() if v), "of", len(result), "images painted")
