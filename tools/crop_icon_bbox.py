"""Crop a Krea2 icon render down to its ink, before the pixel-fix downscale.

Krea2 centres a glyph in roughly the middle 45% of a 1024px canvas. Feeding
that straight to the pixel fixer spends most of the target resolution on empty
white, so a 32px icon ends up with a ~14px glyph floating in it. Crop to the
ink bounding box first, pad it back out to a square with a small margin, and
the downscale spends every pixel on the artwork.

Usage:
    crop_icon_bbox.py IN.png OUT.png [--pad 0.06] [--thresh 238]
"""
import argparse
import sys

from PIL import Image


def ink_bbox(img, thresh):
    """Bounding box of everything darker than `thresh` on the white ground."""
    grey = img.convert('L')
    # point() -> 255 where it is ink, 0 where it is background; getbbox() then
    # measures the ink rather than the (full-frame) white.
    mask = grey.point(lambda p: 255 if p < thresh else 0)
    return mask.getbbox()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--pad', type=float, default=0.06,
                    help='margin to leave around the ink, as a share of the crop')
    ap.add_argument('--thresh', type=int, default=238,
                    help='luminance below which a pixel counts as ink')
    a = ap.parse_args()

    img = Image.open(a.src).convert('RGB')
    box = ink_bbox(img, a.thresh)
    if box is None:
        print(f'{a.src}: no ink found', file=sys.stderr)
        return 1

    l, t, r, b = box
    w, h = r - l, b - t
    # square it off around the ink's centre so the glyph keeps its proportions
    side = max(w, h)
    side = int(side * (1 + 2 * a.pad))
    cx, cy = (l + r) // 2, (t + b) // 2
    half = side // 2

    out = Image.new('RGB', (side, side), (255, 255, 255))
    crop = img.crop((cx - half, cy - half, cx - half + side, cy - half + side))
    out.paste(crop, (0, 0))
    out.save(a.dst)

    fill = max(w, h) / img.width
    print(f'{a.src} -> {a.dst}  ink {w}x{h} ({fill:.0%} of source)  out {side}x{side}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
