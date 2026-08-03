"""Flat top-down preview of a baked tile atlas with the theme tint applied.

Mimics what dungeon_scene.js does per floor cell: pick one of the four atlas
quadrants, rotate it by a random multiple of 90 degrees, and multiply by the
per-cell instance colour (theme floor colour with the checkerboard and random
jitter). Lighting, fog and post-processing are not simulated, so this is a
texture/tint sanity check, not a render.

  python tools/preview_tile_atlas.py --atlas public/art/tiles/ancient_floor.png \
      --color 0x646a78 --out scratch/ancient_floor_preview.png
"""
import argparse
import os
import random
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--atlas', required=True)
    ap.add_argument('--color', default='0x646a78', help='theme floor colour')
    ap.add_argument('--cells', type=int, default=10)
    ap.add_argument('--cell', type=int, default=64, help='pixels per cell in the preview')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    atlas = Image.open(args.atlas).convert('RGB')
    q = atlas.size[0] // 2
    quads = [atlas.crop(((i & 1) * q, (i >> 1) * q, (i & 1) * q + q, (i >> 1) * q + q))
             for i in range(4)]

    col = int(args.color, 16)
    base = ((col >> 16) & 255, (col >> 8) & 255, col & 255)

    n, cs = args.cells, args.cell
    out = Image.new('RGB', (n * cs, n * cs))
    for y in range(n):
        for x in range(n):
            t = quads[rng.randrange(4)].rotate(90 * rng.randrange(4))
            t = t.resize((cs, cs), Image.NEAREST)
            k = rng.uniform(0.94, 1.06) * (0.965 if (x + y) & 1 else 1.0)
            tint = tuple(min(255, int(c * k)) for c in base)
            t = Image.merge('RGB', [
                ch.point(lambda v, c=tint[i]: int(v * c / 255))
                for i, ch in enumerate(t.split())])
            out.paste(t, (x * cs, y * cs))

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    out.save(args.out)
    print(args.out, out.size)


if __name__ == '__main__':
    main()
