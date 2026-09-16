"""
Seamless dark-slate flagstone tile for panel interiors.

Drawn procedurally rather than generated: a diffusion tile is never truly
seamless, and the whole point here is a texture that sits far below the text
in contrast -- every value is a small offset from the base, so it can be tuned
with numbers instead of rerolls. Courses of staggered blocks whose widths and
heights sum exactly to the tile, so it wraps in both axes.

  python tools/ui_kit/make_bg_tile.py

Writes src/ui/kit/bg_slate.png (opaque, menus) and bg_slate_hud.png (90%
alpha, HUD panels over the live dungeon).
"""
import os
import random

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'src', 'ui', 'kit')

W = H = 128                      # 1x pixels; displayed at 2x = 256 css px
BASE = np.array([13, 16, 20])    # #0d1014 — a hair above --dc-frame-bg
MORTAR = np.array([8, 10, 12])
# per-block tints: tiny offsets around the base, cool and neutral
TINTS = [(-1, -1, -1), (0, 0, 0), (1, 1, 1), (2, 2, 1), (0, 1, 2), (-2, -1, 0)]
CHIP = np.array([4, 4, 3])       # rare lighter fleck inside a block
PIT = np.array([-3, -3, -3])     # rare darker pit
EDGE = np.array([2, 2, 2])       # 1px top-left bevel (most blocks, not all)
STAIN = np.array([-2, -2, -1])   # damp patch: a few levels darker, dithered


def split(total, lo, hi, rng):
    """Random segment lengths in [lo,hi] summing exactly to total."""
    out = []
    left = total
    while left > 0:
        if left <= hi:
            if left >= lo or not out:
                out.append(left)
            else:
                out[-1] += left
            break
        n = rng.randint(lo, hi)
        if left - n < lo:
            n = left - lo
        out.append(n)
        left -= n
    return out


def draw(seed=7):
    rng = random.Random(seed)
    img = np.tile(MORTAR, (H, W, 1)).astype(np.int16)
    rows = split(H, 11, 18, rng)
    y = 0
    offset = 0
    blocks = []
    for rh in rows:
        widths = split(W, 12, 30, rng)
        x = -offset % W
        for bw in widths:
            tint = np.array(rng.choice(TINTS))
            # an occasional block is a slightly different stone altogether
            if rng.random() < 0.08:
                tint = tint + np.array(rng.choice([(-2, -2, -2), (2, 1, 0), (0, 2, 2)]))
            for yy in range(y + 1, y + rh):
                for xx in range(x + 1, x + bw):
                    img[yy % H, xx % W] = BASE + tint
                    r = rng.random()
                    if r < 0.012:
                        img[yy % H, xx % W] += CHIP
                    elif r < 0.02:
                        img[yy % H, xx % W] += PIT
            # bevel on most blocks; some have worn it off, some only on top
            if rng.random() < 0.8:
                for xx in range(x + 1, x + bw):
                    img[(y + 1) % H, xx % W] = BASE + tint + EDGE
            if rng.random() < 0.6:
                for yy in range(y + 1, y + rh):
                    img[yy % H, (x + 1) % W] = BASE + tint + EDGE
            blocks.append((x, y, bw, rh))
            x += bw
        y += rh
        offset += rng.randint(5, 14)

    # chipped corners: knock a small triangle off one corner of some blocks
    for (x, y, bw, rh) in blocks:
        if rng.random() < 0.35:
            n = rng.randint(2, 4)
            cx, cy = rng.choice([(x + 1, y + 1), (x + bw - 1, y + 1), (x + 1, y + rh - 1), (x + bw - 1, y + rh - 1)])
            dx = 1 if cx == x + 1 else -1
            dy = 1 if cy == y + 1 else -1
            for i in range(n):
                for j in range(n - i):
                    img[(cy + dy * i) % H, (cx + dx * j) % W] = MORTAR + np.array([1, 1, 1])

    # cracks: a few random walks in mortar colour, mostly diagonal
    for _ in range(9):
        cx, cy = rng.randrange(W), rng.randrange(H)
        dx = rng.choice([-1, 1])
        for _ in range(rng.randint(6, 22)):
            img[cy % H, cx % W] = MORTAR + np.array([2, 2, 2])
            cx += dx if rng.random() < 0.7 else 0
            cy += 1 if rng.random() < 0.75 else 0
            if rng.random() < 0.08:
                dx = -dx

    # damp stains: irregular blobs, dithered so they stay soft at 2x
    for _ in range(4):
        cx, cy = rng.randrange(W), rng.randrange(H)
        rx, ry = rng.randint(9, 20), rng.randint(6, 14)
        for yy in range(cy - ry, cy + ry + 1):
            for xx in range(cx - rx, cx + rx + 1):
                d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
                if d < 1 and rng.random() < (1 - d) * 0.85:
                    img[yy % H, xx % W] += STAIN
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    rgb = draw()
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(rgb, 'RGB').save(os.path.join(OUT, 'bg_slate.png'))
    a = np.full((H, W, 1), 230, np.uint8)
    Image.fromarray(np.concatenate([rgb, a], axis=2), 'RGBA').save(os.path.join(OUT, 'bg_slate_hud.png'))
    lum = rgb.mean(axis=2)
    print(f'tile {W}x{H}  lum min {lum.min():.0f} max {lum.max():.0f} mean {lum.mean():.1f}')


if __name__ == '__main__':
    main()
