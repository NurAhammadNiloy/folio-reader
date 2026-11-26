"""Generate Folio's original app icons (sage tile with an open-book mark)."""
from PIL import Image, ImageDraw
import sys, os

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/icons"
SAGE, IVORY, DEEP = (65, 108, 87), (255, 252, 245), (46, 79, 63)

def icon(size, maskable=False):
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, s, s], fill=SAGE)
        pad = s * 0.24
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=SAGE)
        pad = s * 0.18
    w = s - 2 * pad
    cx, top, bot = s / 2, pad + w * 0.16, pad + w * 0.86
    # two pages that meet at a spine, slightly lifted at the outer corners
    left = [(cx, top + w * 0.06), (pad, top), (pad, bot - w * 0.06), (cx, bot)]
    right = [(cx, top + w * 0.06), (s - pad, top), (s - pad, bot - w * 0.06), (cx, bot)]
    d.polygon(left, fill=IVORY)
    d.polygon(right, fill=IVORY)
    d.line([(cx, top + w * 0.06), (cx, bot)], fill=DEEP, width=int(s * 0.018))
    for i in range(3):
        y = top + w * (0.2 + i * 0.14)
        d.line([(pad + w * 0.08, y), (cx - w * 0.07, y + w * 0.03)], fill=(200, 200, 190), width=int(s * 0.014))
        d.line([(cx + w * 0.07, y + w * 0.03), (s - pad - w * 0.08, y)], fill=(200, 200, 190), width=int(s * 0.014))
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
icon(192).save(f"{OUT}/icon-192.png")
icon(512).save(f"{OUT}/icon-512.png")
icon(512, True).save(f"{OUT}/maskable-512.png")
icon(180).save(f"{OUT}/apple-touch-icon.png")
icon(32).save(f"{OUT}/favicon-32.png")
print("icons written to", OUT)
