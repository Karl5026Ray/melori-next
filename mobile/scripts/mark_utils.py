"""Correctly isolate the Melori M from its flat navy field.

WHY THIS EXISTS
---------------
Global colour-distance keying (ImageMagick's `-transparent`, PIL's
`getcolor`-style masks) is wrong for this artwork. The mark contains dark teal
shadow tones that sit within any usable tolerance of the #061826 background, so
keying by COLOUR punches them out and leaves holes straight through the middle
of the glyph.

Only the background REGION should be removed -- the flat-navy area that is
connected to the image border. Interior pixels of the same colour belong to the
artwork and must be kept. So: flood-fill inwards from the border across pixels
within tolerance, and treat only that connected component as background.

TOLERANCE
---------
Distance is the sum of absolute per-channel differences from NAVY. Measured on
mobile/resources/icon-1024.png:

    tol  6  -> 545,337 px kept
    tol 12  -> 540,958 px kept   <- DEFAULT_TOLERANCE, clean, no halo
    tol 20  -> 531,911 px kept   (visible nibbling of the mark starts)
    tol 30  -> 505,633 px kept   (clearly damaged)

12 removes the navy field and its anti-aliased fringe without eating the mark.

USED BY
-------
    scripts/configure-android.sh   adaptive launcher foreground (all densities)
    scripts/make_feature_graphic.py  the 1024x500 Play feature graphic

CLI
---
    python3 mark_utils.py report <src.png> [--tol N]
    python3 mark_utils.py trim <src.png> <out.png> [--tol N]
    python3 mark_utils.py assert-no-holes <rendered.png>

Requires Pillow and numpy. scipy is used when present and falls back to a pure
Python BFS otherwise.
"""
import numpy as np
from PIL import Image

NAVY = (6, 24, 38)
DEFAULT_TOLERANCE = 12


def _border_connected(mask):
    """Boolean array of the True pixels in `mask` reachable from its border."""
    try:
        from scipy import ndimage
    except ImportError:
        pass
    else:
        lab, _ = ndimage.label(mask)
        border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
        border.discard(0)
        return np.isin(lab, list(border))

    h, w = mask.shape
    reached = np.zeros_like(mask)
    stack = []
    for x in range(w):
        stack.append((0, x))
        stack.append((h - 1, x))
    for y in range(h):
        stack.append((y, 0))
        stack.append((y, w - 1))
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= h or x >= w:
            continue
        if reached[y, x] or not mask[y, x]:
            continue
        reached[y, x] = True
        stack.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    return reached


def background_alpha(path, tol=DEFAULT_TOLERANCE):
    """RGBA copy of `path` with only the border-connected navy field cleared."""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    dist = np.abs(a - np.array(NAVY, dtype=np.int16)).sum(axis=2)
    outside = _border_connected(dist <= tol)
    alpha = np.where(outside, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([np.asarray(im), alpha]), "RGBA")


def trimmed_mark(path, tol=DEFAULT_TOLERANCE):
    """RGBA mark, holes preserved, cropped to its bounding box."""
    m = background_alpha(path, tol)
    return m.crop(m.getbbox())


def enclosed_transparent_pixels(path):
    """Fully-transparent pixels inside the mark's bbox that a flood fill from
    the bbox border cannot reach -- i.e. holes punched through the glyph.

    Zero for a region-keyed mark by construction: every cleared pixel belongs to
    the one component that touches the source image border, so a path out of the
    bbox always exists. Non-zero means something keyed by colour instead.
    """
    alpha = np.asarray(Image.open(path).convert("RGBA"))[:, :, 3]
    bbox = Image.fromarray(alpha).getbbox()
    if bbox is None:
        raise SystemExit(f"error: {path} is fully transparent")
    x0, y0, x1, y1 = bbox
    hole = alpha[y0:y1, x0:x1] == 0
    return int((hole & ~_border_connected(hole)).sum())


def report(path, tol=DEFAULT_TOLERANCE):
    m = background_alpha(path, tol)
    a = np.asarray(m)[:, :, 3]
    return {"bbox": m.getbbox(), "mark_px": int((a > 0).sum()), "tol": tol}


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    tol = DEFAULT_TOLERANCE
    if "--tol" in argv:
        i = argv.index("--tol")
        tol = int(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    command, args = argv[0], argv[1:]

    if command == "report":
        print(report(args[0], tol))
    elif command == "trim":
        src, out = args
        trimmed_mark(src, tol).save(out, "PNG")
        print(f"    keyed the M out of {src} by border flood-fill at tolerance {tol}")
    elif command == "assert-no-holes":
        for path in args:
            holes = enclosed_transparent_pixels(path)
            if holes:
                raise SystemExit(
                    f"error: {path} has {holes} fully-transparent pixels enclosed by "
                    f"the mark's bounding box. The adaptive foreground has holes "
                    f"punched through the glyph, which launcher parallax will expose. "
                    f"This is what keying by colour instead of by region looks like."
                )
    else:
        raise SystemExit(f"error: unknown command {command!r}")


if __name__ == "__main__":
    import sys

    main(sys.argv[1:])
