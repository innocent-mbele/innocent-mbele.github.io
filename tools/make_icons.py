"""Render PNG favicons and the social preview image (run once; needs Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/icons"
BLUE, NAVY, WHITE, MUTED = "#7a45b5", "#faf9f8", "#ffffff", "#605e5c"


def font(size, weight="ExtraBold"):
    for path in (f"/usr/share/fonts/opentype/inter/Inter-{weight}.otf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def mark(size):
    scale = 4
    im = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size * scale - 1, size * scale - 1], radius=size * scale * 0.1, fill=BLUE)
    d.text((size * scale / 2, size * scale / 2), "IM", font=font(int(size * scale * 0.46)), fill=WHITE, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
mark(32).save(OUT / "favicon-32.png")
mark(180).save(OUT / "apple-touch-icon.png")
mark(512).save(OUT / "icon-512.png")

og = Image.new("RGB", (1200, 630), NAVY)
d = ImageDraw.Draw(og)
og.paste(mark(120), (90, 90), mark(120))
d.text((90, 280), "Innocent Mbele", font=font(84), fill="#201f1e")
d.text((90, 385), "Technology | Innovation | Digital Transformation", font=font(40, "SemiBold"), fill="#323130")
d.text((90, 450), "Azure · Linux · Network Automation projects", font=font(32, "Medium"), fill=MUTED)
d.rectangle([0, 0, 1200, 630], outline="#e1dfdd", width=2)
d.rectangle([90, 540, 290, 544], fill=BLUE)
og.save(OUT / "og-image.png", optimize=True)
print("icons written")
