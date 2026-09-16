"""Knock the leftover white out of a fixed pixel icon.

The pixel-fixer's background removal works inward from the frame edge, so an
outline glyph that fully encloses an area -- a satchel flap, a scroll body, a
cuirass torso -- keeps that area as opaque white. On a light background you
never notice; dropped into the game's near-black tiles it is a white blob.

These glyphs are drawn in one bronze ink on white, so "white" is unambiguous:
clear every near-white, near-neutral pixel regardless of where it sits, then
harden the alpha so nothing is left semi-transparent to fringe later.

Usage:
    clear_icon_white.py IN.png OUT.png [--lum 232] [--sat 26]
"""
import argparse

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--lum', type=int, default=232,
                    help='clear pixels at or above this luminance')
    ap.add_argument('--sat', type=int, default=26,
                    help='...but only if max-min channel spread is below this, '
                         'so pale bronze highlights survive')
    ap.add_argument('--dark', type=int, default=60,
                    help='also clear pixels whose brightest channel is below '
                         'this. The model fills some outlines with a near-black '
                         'brown; the tile should show through instead. Well '
                         'clear of the gold ink (~255,193,26). 0 disables.')
    a = ap.parse_args()

    img = Image.open(a.src).convert('RGBA')
    px = img.load()
    w, h = img.size
    cleared = 0
    for y in range(h):
        for x in range(w):
            r, g, b, al = px[x, y]
            if al == 0:
                continue
            if min(r, g, b) >= a.lum and (max(r, g, b) - min(r, g, b)) <= a.sat:
                px[x, y] = (r, g, b, 0)
                cleared += 1
            elif a.dark and max(r, g, b) < a.dark:
                px[x, y] = (r, g, b, 0)
                cleared += 1
            elif al < 250:
                # no half-transparent pixels: they are what shows up as a pale
                # rim once the icon sits on a dark tile
                px[x, y] = (r, g, b, 255)
    img.save(a.dst)
    print(f'{a.dst}  cleared {cleared}px of enclosed white')


if __name__ == '__main__':
    raise SystemExit(main())
