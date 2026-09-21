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

Writes email/step-icons/*.png at 3× the 52px display size. The pw-*-foil.png
set is the six premium-welcome feature icons (same grid, champagne + gold).
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


# ── Premium welcome: the six membership features ──────────────────────────
# Added 2026-09-20 when the boxed lavender cards in premiumWelcomeHtml became
# open rows like the free welcome's steps. Same grid and same house style; the
# only difference is the palette below (champagne tile, terracotta ink, a thin
# gold ring) so the paid email reads as the dressed-up sibling of the free one.
PREMIUM_TILE = (250, 238, 218)     # champagne  #FAEEDA
PREMIUM_INK  = (154,  65,  39)     # terracotta #9A4127 — same as the free set
PREMIUM_RING = (214, 170,  96)     # gold       #D6AA60


def calendar(d):
    """Weekly check-in: a calendar with a tick in it."""
    rrect(d, 2.6, 4.6, 21.4, 21.4, 2.8, INK)
    d.rectangle([px(2.6), px(9.2), px(21.4), px(10.6)], fill=TINT)
    rrect(d, 6.6, 2.2, 8.8, 7.2, 1.1, INK)
    rrect(d, 15.2, 2.2, 17.4, 7.2, 1.1, INK)
    d.line([(px(8.2), px(15.6)), (px(11), px(18.2)), (px(16.2), px(13))],
           fill=TINT, width=int(2.1 * U), joint="curve")
    for x, y in ((8.2, 15.6), (11, 18.2), (16.2, 13)):
        circle(d, x, y, 1.05, TINT)


def upload(d):
    """Upload everything: an arrow rising out of a tray."""
    rrect(d, 2.6, 12.4, 21.4, 21.4, 2.6, INK)
    rrect(d, 5.2, 10.0, 18.8, 18.8, 1.4, TINT)
    rrect(d, 10.7, 6.5, 13.3, 16.4, 1.2, INK)
    d.polygon([(px(12), px(2.2)), (px(5.9), px(8.6)), (px(18.1), px(8.6))], fill=INK)


def reel(d):
    """Unlimited storage: a film reel."""
    circle(d, 12, 12, 9.6, INK)
    for x, y in ((12, 6.6), (12, 17.4), (6.6, 12), (17.4, 12)):
        circle(d, x, y, 2.5, TINT)
    circle(d, 12, 12, 1.2, TINT)


def message(d):
    """Message casting directors: a speech bubble with a play triangle."""
    rrect(d, 2.4, 3.2, 21.6, 17.2, 3.6, INK)
    d.polygon([(px(5.6), px(16)), (px(11), px(16)), (px(5.6), px(21.4))], fill=INK)
    d.polygon([(px(9.8), px(6.6)), (px(9.8), px(13.8)), (px(15.8), px(10.2))], fill=TINT)


def directory(d):
    """Agency directory: a columned building."""
    d.polygon([(px(12), px(2.2)), (px(2.2), px(8.2)), (px(21.8), px(8.2))], fill=INK)
    rrect(d, 2.2, 8.6, 21.8, 10.0, 0.4, INK)
    for x in (4.1, 8.6, 13.4, 17.9):
        rrect(d, x, 10.8, x + 2, 18.2, 0.5, INK)
    rrect(d, 2.2, 19.0, 21.8, 21.6, 0.9, INK)
    circle(d, 12, 6.2, 1.05, TINT)


def bizcard(d):
    """Business card + QR: a portrait beside a scannable square."""
    rrect(d, 1.8, 4.8, 22.2, 19.2, 2.4, INK)
    circle(d, 7.2, 9.8, 2.2, TINT)
    shoulders(d, 7.2, 0, 3.4, 12.4, 15.6, TINT)
    rrect(d, 12.6, 7.6, 20.0, 15.0, 0.9, TINT)
    for x, y in ((13.4, 8.4), (17.1, 8.4), (13.4, 12.1)):
        rrect(d, x, y, x + 2.1, y + 2.1, 0.35, INK)
    rrect(d, 17.4, 12.4, 19.2, 14.2, 0.3, INK)
    rrect(d, 16.0, 11.1, 16.9, 12.0, 0.1, INK)


PREMIUM_ICONS = {
    "pw-calendar":  calendar,
    "pw-upload":    upload,
    "pw-reel":      reel,
    "pw-message":   message,
    "pw-directory": directory,
    "pw-bizcard":   bizcard,
}


def build_premium():
    global TINT, INK
    TINT, INK = PREMIUM_TILE, PREMIUM_INK
    for name, draw_glyph in PREMIUM_ICONS.items():
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=SIZE * 0.29 * SS, fill=TINT)
        # The ring is inset by 3px (at display size) so it reads as a foil edge
        # rather than a border on the tile.
        d.rounded_rectangle([SS * 3, SS * 3, S - 1 - SS * 3, S - 1 - SS * 3],
                            radius=SIZE * 0.27 * SS, outline=PREMIUM_RING, width=SS * 4)
        draw_glyph(d)
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        path = os.path.normpath(os.path.join(OUT, name + "-foil.png"))
        im.save(path, optimize=True)
        print(f"{name+'-foil.png':30} {os.path.getsize(path):6} bytes  {im.size}")


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
    build_premium()


if __name__ == "__main__":
    main()
