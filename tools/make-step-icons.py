#!/usr/bin/env python3
"""
make-step-icons.py — render the welcome-email step icons to PNG.

WHY PNG. The three steps in the new-actor welcome email used emoji (📸 ✍️ 🎬).
Emoji are a font: Windows, Android, macOS and older Outlook each draw them
differently, and some clients show a tofu box instead. Gmail also strips inline
SVG. A PNG is the only thing that looks identical everywhere, which is the same
reason email/type-icons/*.png exist for casting types.

HOUSE STYLE, copied from ProjectTypeTile() in swipecast-full.jsx:
  tile corner radius = 29% of the tile
  glyph drawn at     = 54% of the tile, on a 24x24 grid
  glyph colour       = the ink; knockout details are painted in the tile tint
Everything is drawn at SS× and downsampled, so the curves come out clean.

    python3 tools/make-step-icons.py

Writes email/step-icons/*.png at 3× the 52px display size.
"""
import os
from PIL import Image, ImageDraw

SIZE = 156                 # 3x of the 52px the email renders them at
SS   = 4                   # supersampling factor
OUT  = os.path.join(os.path.dirname(__file__), "..", "email", "step-icons")

# Palettes. "" is the original teal set; the others were added 2026-09-20 when
# the owner asked for colours that read as acceptance rather than as a brand
# colour. Add a palette here and re-run rather than recolouring the PNGs.
PALETTES = {
    "":          ((226, 238, 238), ( 55, 105, 106)),   # teal    #E2EEEE / #37696A
    "-clay":     ((247, 226, 216), (154,  65,  39)),   # F: terracotta #F7E2D8 / #9A4127
    "-sand":     ((244, 234, 223), (156, 114,  80)),   # G: sand+clay  #F4EADF / #9C7250
}
TINT, INK = PALETTES[""]

S = SIZE * SS
G = round(SIZE * 0.54) * SS          # glyph box
PAD = (S - G) // 2
U = G / 24.0                         # one unit of the 24x24 grid


def px(v):
    """24-grid coordinate -> canvas pixel."""
    return PAD + v * U


def rrect(d, x0, y0, x1, y1, r, fill):
    d.rounded_rectangle([px(x0), px(y0), px(x1), px(y1)], radius=r * U, fill=fill)


def circle(d, cx, cy, r, fill):
    d.ellipse([px(cx - r), px(cy - r), px(cx + r), px(cy + r)], fill=fill)


def shoulders(d, cx, cy, w, top, bottom, fill):
    """Rounded 'bust' shape: a half-disc that reads as shoulders."""
    d.pieslice([px(cx - w), px(top), px(cx + w), px(top + 2 * (bottom - top))],
               start=180, end=360, fill=fill)
    d.rectangle([px(cx - w), px((top + bottom) / 2), px(cx + w), px(bottom)], fill=fill)


def headshot(d):
    """A portrait card: head and shoulders knocked out of a filled frame."""
    rrect(d, 2.6, 2.6, 21.4, 21.4, 3.4, INK)
    circle(d, 12, 9.5, 3.15, TINT)
    shoulders(d, 12, 0, 6.2, 13.4, 19.6, TINT)


def basics(d):
    """An ID card: small portrait plus two data lines."""
    rrect(d, 2.2, 4.2, 21.8, 19.8, 2.6, INK)
    circle(d, 8.3, 10.3, 2.5, TINT)
    shoulders(d, 8.3, 0, 3.85, 13.2, 17.0, TINT)
    rrect(d, 13.9, 8.7, 19.8, 10.5, 0.9, TINT)
    rrect(d, 13.9, 12.3, 19.8, 14.1, 0.9, TINT)


def submission(d):
    """The clapperboard, matching the app's own 'Feature Film' glyph."""
    rrect(d, 2.6, 9.4, 21.4, 21.2, 2.6, INK)
    d.rectangle([px(2.6), px(9.4), px(21.4), px(14.0)], fill=INK)
    rrect(d, 2.6, 3.2, 21.4, 8.1, 1.3, INK)
    for x in (7.4, 12.4, 17.4):
        d.polygon([(px(x), px(3.2)), (px(x + 1.9), px(3.2)),
                   (px(x - 1.7 + 1.9), px(8.1)), (px(x - 1.7), px(8.1))], fill=TINT)


ICONS = {
    "step-headshot":   headshot,
    "step-basics":     basics,
    "step-submission": submission,
}


def build(suffix):
    global TINT, INK
    TINT, INK = PALETTES[suffix]
    for name, draw_glyph in ICONS.items():
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=SIZE * 0.29 * SS, fill=TINT)
        draw_glyph(d)
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        path = os.path.normpath(os.path.join(OUT, name + suffix + ".png"))
        im.save(path, optimize=True)
        print(f"{name+suffix+'.png':30} {os.path.getsize(path):6} bytes  {im.size}")


def main():
    os.makedirs(OUT, exist_ok=True)
    for suffix in PALETTES:
        build(suffix)


if __name__ == "__main__":
    main()
