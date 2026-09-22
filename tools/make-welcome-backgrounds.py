#!/usr/bin/env python3
"""
make-welcome-backgrounds.py — render the backdrops behind the two welcome emails.

    python3 tools/make-welcome-backgrounds.py

Writes email/backgrounds/*.jpg. Approved 2026-09-22:
  welcome-free-gels.jpg          "Stage gels" (day)   behind newActorWelcomeHtml
  welcome-premium-projector.jpg  "Projector beam"     behind premiumWelcomeHtml

HOW THEY ARE USED. Each image is the background of the outermost table of its
email, anchored centre-top, no-repeat, on the usual cream (CS_CREAM). The card
is 600px wide and centred, so on desktop the image shows on both sides of it;
on a phone only the gutter shows. The fallback colour is cream, so a client
that drops background images (Outlook on Windows) shows the old flat cream.

THE FADE. Every image fades to exactly CS_CREAM a little above where its card
ends, so the shared footer ("footer A") still sits on plain cream and never
needs a dark variant. The fade points below are measured card bottoms at
desktop width (free 1417px, premium 2883px, both including the 40px top
padding). If either email gains or loses a section, re-measure the card and
move FADE_START / FADE_END, or the colour will stop short of the card bottom
or run into the footer.

WIDTH. 2400px wide so a 1920px desktop never reaches the edge; the outer
160px on each side also fade to cream, so a wider screen meets cream rather
than a hard edge.
"""
import os
import random
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "email", "backgrounds")
W = 2400
CREAM = (243, 238, 230)          # CS_CREAM #F3EEE6 — the fade target

FREE    = dict(H=1500, FADE_START=950,  FADE_END=1420)
PREMIUM = dict(H=2950, FADE_START=2300, FADE_END=2870)


def fade_mask(H, f0, f1, edge=160):
    """Opaque above f0, smoothstep to clear at f1; side edges fade too."""
    col = []
    for y in range(H):
        if y <= f0:
            a = 1.0
        elif y >= f1:
            a = 0.0
        else:
            t = (y - f0) / (f1 - f0)
            a = 1 - t * t * (3 - 2 * t)
        col.append(int(255 * a))
    row = [int(255 * min(1.0, min(x, W - 1 - x) / edge)) for x in range(W)]
    c = Image.new("L", (1, H)); c.putdata(col); c = c.resize((W, H))
    r = Image.new("L", (W, 1)); r.putdata(row); r = r.resize((W, H))
    return ImageChops.multiply(c, r)


def save(img, name, spec):
    out = Image.composite(img, Image.new("RGB", img.size, CREAM),
                          fade_mask(spec["H"], spec["FADE_START"], spec["FADE_END"]))
    path = os.path.normpath(os.path.join(OUT, name))
    out.save(path, quality=78, optimize=True, progressive=True)
    print(f"{name:34} {os.path.getsize(path)//1024:4} KB  {out.size}")


def stage_gels(spec, base, blobs):
    """Soft washes of lighting-gel colour. Drawn at 1/8 scale and blurred,
    so the result is a colour field with no edges."""
    H, s = spec["H"], 8
    c = Image.new("RGB", (W // s, H // s), base)
    for cx, cy, rx, ry, col, a in blobs:
        m = Image.new("L", c.size, 0)
        ImageDraw.Draw(m).ellipse([(cx - rx) / s, (cy - ry) / s, (cx + rx) / s, (cy + ry) / s],
                                  fill=int(255 * a))
        c = Image.composite(Image.new("RGB", c.size, col), c, m.filter(ImageFilter.GaussianBlur(28)))
    return c.filter(ImageFilter.GaussianBlur(6)).resize((W, H), Image.BICUBIC)


def projector_beam(spec, top, bottom, beam, beam_alpha, dust):
    """A dark room with one warm cone of light from above the card, plus a
    few dust motes caught in it. The card covers the beam's core, so what
    shows is the light spilling past its edges."""
    H, s = spec["H"], 4
    w, h = W // s, H // s
    grad = Image.new("RGB", (1, h))
    grad.putdata([tuple(int(top[i] + (bottom[i] - top[i]) * y / h) for i in range(3)) for y in range(h)])
    c = grad.resize((w, h))
    m = Image.new("L", (w, h), 0)
    sx = W / 2 / s
    ImageDraw.Draw(m).polygon([(sx - 18, -40), (sx + 18, -40), (sx + 190, 375), (sx - 190, 375)],
                              fill=int(255 * beam_alpha))
    m = m.filter(ImageFilter.GaussianBlur(48))
    hot = Image.new("L", (w, h), 0)
    ImageDraw.Draw(hot).ellipse([sx - 90, -80, sx + 90, 70], fill=255)
    m = ImageChops.lighter(m, hot.filter(ImageFilter.GaussianBlur(30)))
    c = Image.composite(Image.new("RGB", (w, h), beam), c, m).resize((W, H), Image.BICUBIC)
    random.seed(7)                     # fixed, so a re-run gives the same motes
    dm = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(dm)
    for _ in range(dust):
        y = random.uniform(40, 1400)
        half = 36 + (760 - 36) * y / 1500
        x = W / 2 + random.uniform(-half, half) * 0.85
        r = random.choice((1, 1, 1.5, 2))
        dd.ellipse([x - r, y - r, x + r, y + r], fill=random.randint(60, 150))
    return Image.composite(Image.new("RGB", (W, H), (255, 236, 205)), c,
                           dm.filter(ImageFilter.GaussianBlur(0.8)))


def main():
    os.makedirs(OUT, exist_ok=True)
    # Free: daytime gels — terracotta, honey, soft teal, a touch of plum.
    save(stage_gels(FREE, (246, 236, 226), [
        (620, 260, 620, 420, (214, 120, 86), 0.85),
        (1820, 300, 640, 440, (234, 192, 128), 0.90),
        (480, 1000, 560, 420, (111, 168, 156), 0.70),
        (1900, 1050, 520, 400, (176, 122, 160), 0.55),
        (1200, 650, 420, 300, (240, 205, 170), 0.60),
    ]), "welcome-free-gels.jpg", FREE)
    # Premium: near-black screening room, gold beam.
    save(projector_beam(PREMIUM, (16, 14, 22), (30, 24, 30), (250, 212, 140), 0.38, 420),
         "welcome-premium-projector.jpg", PREMIUM)


if __name__ == "__main__":
    main()
