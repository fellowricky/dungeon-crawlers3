"""Contact sheet of candidate pixel tiles, baked and tinted like the game does.

Each panel is one four-variant tile family run through the same normalise/tint
path as build_tile_atlas.py + preview_tile_atlas.py, so families can be compared
at the brightness and hue they would actually have in a dungeon.

  python tools/tile_candidates.py --dir "Sprites/.../dungeon/floor" \
      --families rect_gray sandstone_floor limestone --out scratch/floor_candidates.png
"""
import argparse
import os
import random
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_tile_atlas import (load_tile, desaturate, normalise, chunkify, posterize,
                              DEFAULT_SAT, DEFAULT_TARGET)

CELLS = 4
CELL = 64


def variants(d, family):
    """First four numbered variants of a family (skipping _new/_old duplicates)."""
    out = []
    for i in range(64):
        p = os.path.join(d, f'{family}_{i}.png')
        if os.path.exists(p):
            out.append(p)
        if len(out) == 4:
            return out
    return out


def panel(paths, tint, sat, target, seed, px=0, levels=0):
    tiles, _, _ = normalise([chunkify(load_tile(p), px) for p in paths], target)
    tiles = [posterize(desaturate(t, sat), levels) for t in tiles]
    rng = random.Random(seed)
    img = Image.new('RGB', (CELLS * CELL, CELLS * CELL))
    for y in range(CELLS):
        for x in range(CELLS):
            t = tiles[rng.randrange(len(tiles))].rotate(90 * rng.randrange(4))
            t = t.resize((CELL, CELL), Image.NEAREST)
            k = rng.uniform(0.94, 1.06) * (0.965 if (x + y) & 1 else 1.0)
            c = [min(255, int(v * k)) for v in tint]
            t = Image.merge('RGB', [ch.point(lambda v, cc=c[i]: int(v * cc / 255))
                                    for i, ch in enumerate(t.split())])
            img.paste(t, (x * CELL, y * CELL))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--families', nargs='+', required=True)
    ap.add_argument('--color', default='0x646a78')
    ap.add_argument('--sat', type=float, default=DEFAULT_SAT)
    ap.add_argument('--target', type=float, default=DEFAULT_TARGET)
    ap.add_argument('--cols', type=int, default=4)
    ap.add_argument('--px', type=int, default=0)
    ap.add_argument('--posterize', type=int, default=0)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    col = int(args.color, 16)
    tint = ((col >> 16) & 255, (col >> 8) & 255, col & 255)

    panels = []
    for f in args.families:
        paths = variants(args.dir, f)
        if len(paths) < 2:
            print(f'skip {f}: found {len(paths)} variants')
            continue
        while len(paths) < 4:
            paths.append(paths[len(paths) % len(paths[:1] or paths)])
        panels.append((f, panel(paths, tint, args.sat, args.target, 7,
                                args.px, args.posterize)))

    cols = min(args.cols, len(panels))
    rows = (len(panels) + cols - 1) // cols
    pw, ph = CELLS * CELL, CELLS * CELL + 18
    sheet = Image.new('RGB', (cols * pw, rows * ph), (18, 18, 22))
    dr = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(panels):
        x, y = (i % cols) * pw, (i // cols) * ph
        sheet.paste(img, (x, y))
        dr.text((x + 4, y + pw + 4), name, fill=(220, 220, 210))

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    sheet.save(args.out)
    print(args.out, sheet.size, f'{len(panels)} families')


if __name__ == '__main__':
    main()
