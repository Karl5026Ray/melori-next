#!/usr/bin/env python3
"""Generate the Google Play feature graphic (1024x500) for Melori Music.

Play will not let you publish a listing without a feature graphic, and it is
cropped differently across Play surfaces, so the layout keeps everything well
inside the edges. Achieved layout, asserted at the bottom of main():
mark at x 74-360, text 418-918, right margin 106px, top/bottom margin 148px.

    python3 make_feature_graphic.py

Writes mobile/resources/play-feature-graphic-1024x500.png. Committed rather
than generated at build time, because it is uploaded by hand in Play Console
and needs to be reviewable in a diff -- the script exists so the asset is
reproducible, not because CI builds it.

Requires Pillow, numpy and Roboto. On Debian/Ubuntu: apt-get install
fonts-roboto; on macOS the Google Fonts Roboto install lands in ~/Library/Fonts.
"""
import os

from PIL import Image, ImageDraw, ImageFont

from mark_utils import trimmed_mark

W, H = 1024, 500
NAVY = (6, 24, 38)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "resources", "icon-1024.png")
OUT = os.path.join(HERE, "..", "resources", "play-feature-graphic-1024x500.png")

FONT_DIRS = [
    "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF",
    "/usr/share/fonts/truetype/roboto/hinted",
    "/usr/share/fonts/truetype/roboto",
    os.path.expanduser("~/Library/Fonts"),
    "/Library/Fonts",
]


def font(name, size):
    for d in FONT_DIRS:
        path = os.path.join(d, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit(
        f"error: {name} not found in any of {FONT_DIRS}. Install Roboto "
        f"(Debian/Ubuntu: apt-get install fonts-roboto)."
    )


def bg():
    """Navy base with two soft brand-coloured radial glows."""
    base = Image.new("RGB", (W, H), NAVY)
    glow = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(glow)
    # warm glow behind the mark, cyan glow trailing right
    for cx, cy, rad, col in ((250, 250, 300, (196, 72, 30)), (830, 300, 300, (16, 128, 140))):
        for i in range(rad, 0, -4):
            t = 1 - i / rad
            a = t * t * 0.85
            c = tuple(int(NAVY[k] + (col[k] - NAVY[k]) * a) for k in range(3))
            d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=c)
    return Image.blend(base, glow, 0.55)


def main():
    img = bg()
    draw = ImageDraw.Draw(img)

    # --- mark, left, vertically centred ---
    # Keyed by region, not by colour, so the dark teal inside the M survives.
    # See mark_utils.py.
    mark = trimmed_mark(SRC, tol=12)
    mh = 296
    mw = int(mark.width * mh / mark.height)
    mark = mark.resize((mw, mh), Image.LANCZOS)
    mx, my = 74, (H - mh) // 2
    img.paste(mark, (mx, my), mark)

    # --- text block, right of the mark ---
    tx = mx + mw + 58
    f_title = font("Roboto-Bold.ttf", 76)
    f_tag = font("Roboto-Medium.ttf", 30)
    f_sub = font("Roboto-Regular.ttf", 25)

    title = "Melori Music"
    tag = "Stream freely. Support directly."
    sub = "Independent artists. Zero fee on music sales."

    h_title = draw.textbbox((0, 0), title, font=f_title)[3]
    h_tag = draw.textbbox((0, 0), tag, font=f_tag)[3]
    h_sub = draw.textbbox((0, 0), sub, font=f_sub)[3]
    gap1, gap2, rule_gap = 26, 16, 22
    rule_h = 5
    total = h_title + gap1 + rule_h + rule_gap + h_tag + gap2 + h_sub
    ty = (H - total) // 2

    draw.text((tx, ty), title, font=f_title, fill=(255, 255, 255))
    y = ty + h_title + gap1

    # brand gradient rule
    rw = 210
    for i in range(rw):
        t = i / (rw - 1)
        if t < 0.5:
            u = t / 0.5
            c = (int(224 + (247 - 224) * u), int(58 + (166 - 58) * u), int(38 + (32 - 38) * u))
        else:
            u = (t - 0.5) / 0.5
            c = (int(247 + (34 - 247) * u), int(166 + (190 - 166) * u), int(32 + (206 - 32) * u))
        draw.rectangle([tx + i, y, tx + i + 1, y + rule_h], fill=c)
    y += rule_h + rule_gap

    draw.text((tx, y), tag, font=f_tag, fill=(233, 240, 245))
    y += h_tag + gap2
    draw.text((tx, y), sub, font=f_sub, fill=(150, 172, 188))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.convert("RGB").save(OUT, "PNG")

    # report widest text extent so we can confirm safe margins
    widest = max(draw.textbbox((tx, 0), s, font=f)[2]
                 for s, f in ((title, f_title), (tag, f_tag), (sub, f_sub)))
    margin = W - widest
    print(f"saved {OUT} {img.size}")
    print(f"mark x:{mx}-{mx+mw} y:{my}-{my+mh}  left margin {mx}px")
    print(f"text x:{tx}-{widest}  right margin: {margin}px")
    print(f"vertical text band: {ty}-{ty+total}  top/bottom margin {ty}/{H-(ty+total)}px")
    assert margin >= 55, f"right margin too tight: {margin}px"
    assert ty >= 40, f"top margin too tight: {ty}px"


if __name__ == "__main__":
    main()
