"""
Turn a pixel-fixed, background-keyed panel render into a compact 9-slice sheet
plus the numbers CSS needs to mount it with `border-image`.

Everything is measured from the image itself, nothing is hand-entered:
  * interior fill  - median colour of the centre region. It is keyed OUT of
                     the sheet (centre cell and any interior pixels an edge
                     slice reaches into), so the game's own panel colour shows
                     through; the value is recorded in the JSON for reference.
  * thickness      - per side, scanning from the middle of each edge inward
                     until the interior fill is reached.
  * corner extent  - per side, how far the corner ornament reaches ALONG the
                     edge before the edge settles into its repeating pattern.
                     The slice is the max of thickness and ornament reach, so
                     ornaments land in the corner cells and never get tiled.
  * edge period    - autocorrelation of the edge band between the corners; one
                     period becomes the edge tile so `border-image-repeat:
                     repeat` tiles it seamlessly.

  python tools/ui_kit/slice_frame.py IN.png OUT_DIR NAME [--fill-override #rrggbb] [--no-polish]

By default the frame is polished first (see polish()): the dotted outer
outline the grid-snap leaves behind is replaced with a continuous 1px one and
near-black mortar is lifted to dark slate.

Writes OUT_DIR/NAME.png (the sheet) and OUT_DIR/NAME.json (slice/fill/tile).
"""
import argparse
import json
import os

import numpy as np
from PIL import Image


def crop_alpha(img):
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > 8)
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def near(px, ref, tol):
    return np.abs(px.astype(int) - ref.astype(int)).max(axis=-1) <= tol


def thickness(rgb, fill, tol, run=6):
    """Distance from each edge to the interior fill along the middle row/col."""
    h, w = rgb.shape[:2]
    row = rgb[h // 2]
    col = rgb[:, w // 2]

    def scan(line):
        m = near(line, fill, tol)
        for i in range(len(m) - run):
            if m[i:i + run].all():
                return i
        return len(m) // 4
    return (scan(col), scan(row[::-1]), scan(col[::-1]), scan(row))  # T R B L


def ornament_reach(band, axis_len):
    """How far from each end a band stays 'different' from its own repeating
    middle. band is (thickness, length, 3) with length along the edge."""
    n = band.shape[1]
    mid = band[:, n // 3: 2 * n // 3].astype(float)
    ref = np.median(mid, axis=1, keepdims=True)                 # typical column
    diff = np.abs(band.astype(float) - ref).mean(axis=(0, 2))    # per column
    base = np.median(diff[n // 3: 2 * n // 3])
    thr = base * 2.0 + 10
    k = 4

    def reach(d):
        for i in range(0, len(d) - k):
            if (d[i:i + k] < thr).all():
                return i
        return len(d) // 4
    return reach(diff), reach(diff[::-1])


def period(band):
    """Dominant repeat along the band (length axis = 1). Returns None if the
    pattern is essentially flat/unrepeating, in which case any span tiles."""
    n = band.shape[1]
    sig = band.astype(float).mean(axis=(0, 2))
    sig = sig - sig.mean()
    if np.abs(sig).max() < 1:
        return None
    ac = np.correlate(sig, sig, 'full')[n - 1:]
    ac /= max(ac[0], 1e-9)
    best = None
    for p in range(4, n // 2):
        if ac[p] > ac[p - 1] and ac[p] >= ac[p + 1] and ac[p] > 0.35:
            best = p
            break
    return best


def polish(img, outline=(10, 12, 15), mortar_floor=(26, 30, 36), dark_lum=40):
    """Clean up the model's dark outline and mortar.

    The render carries a near-black outline around the outside of the frame,
    but grid-snapping leaves it dotted (about half the rim pixels), which reads
    as noise at 2x. Replace it: drop the outer ring, then draw a continuous 1px
    outline around the silhouette. Inside, lift near-black mortar to a dark
    slate floor so gaps between blocks read as recessed stone, not holes.
    """
    from scipy import ndimage
    a = np.array(img)
    op = a[:, :, 3] > 0
    inner = ndimage.binary_erosion(op, iterations=1, border_value=0)
    lum = a[:, :, :3].mean(axis=2)
    # lift mortar (interior dark pixels) to the floor; the shadow lip on the
    # panel side is kept -- it is the bevel, and it is continuous.
    dark = inner & (lum < dark_lum)
    a[dark, :3] = np.maximum(a[dark, :3], np.array(mortar_floor, dtype=np.uint8))
    # continuous outline: the pixels of `op` that are not in `inner`
    ring = op & ~inner
    a[ring, :3] = outline
    a[ring, 3] = 255
    return Image.fromarray(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out_dir')
    ap.add_argument('name')
    ap.add_argument('--tol', type=int, default=10, help='fill match tolerance')
    ap.add_argument('--fill-override')
    ap.add_argument('--no-polish', action='store_true', help='keep the raw outline/mortar')
    ap.add_argument('--slice', nargs=4, type=int, metavar=('T', 'R', 'B', 'L'),
                    help='override the measured slice (when the heuristics disagree with your eye)')
    ap.add_argument('--keep-fill', action='store_true',
                    help='leave the interior opaque (e.g. a button whose face is the stone itself)')
    args = ap.parse_args()

    img = crop_alpha(Image.open(args.src).convert('RGBA'))
    if not args.no_polish:
        img = polish(img)
    arr = np.asarray(img)
    rgb = arr[:, :, :3]
    H, W = rgb.shape[:2]

    c = rgb[H * 2 // 5: H * 3 // 5, W * 2 // 5: W * 3 // 5].reshape(-1, 3)
    fill = np.median(c, axis=0).astype(np.uint8)

    T, R, B, L = thickness(rgb, fill, args.tol)

    # ornament reach along each edge band
    top_l, top_r = ornament_reach(rgb[:T], W)
    bot_l, bot_r = ornament_reach(rgb[H - B:], W)
    lef_t, lef_b = ornament_reach(np.transpose(rgb[:, :L], (1, 0, 2)), H)
    rig_t, rig_b = ornament_reach(np.transpose(rgb[:, W - R:], (1, 0, 2)), H)

    # A real corner piece reaches at most a couple of thicknesses along the
    # edge. Anything further is the reach detector tripping on texture noise
    # in a plain edge, so ignore it rather than fattening the slice.
    def cap(reach, t):
        return reach if reach <= 2.5 * t else 0
    sL = max(L, cap(top_l, T), cap(bot_l, B)) + 1
    sR = max(R, cap(top_r, T), cap(bot_r, B)) + 1
    sT = max(T, cap(lef_t, L), cap(rig_t, R)) + 1
    sB = max(B, cap(lef_b, L), cap(rig_b, R)) + 1
    if args.slice:
        sT, sR, sB, sL = args.slice

    # edge tiles: one period each, phase-locked to the first corner
    hspan = rgb[:, sL:W - sR]
    vspan = rgb[sT:H - sB]
    ph = period(np.concatenate([hspan[:T], hspan[H - B:]], axis=0))
    pv = period(np.transpose(np.concatenate([vspan[:, :L], vspan[:, W - R:]], axis=1), (1, 0, 2)))
    Pw = ph or (W - sL - sR)
    Ph = pv or (H - sT - sB)

    sheet = Image.new('RGBA', (sL + Pw + sR, sT + Ph + sB), (0, 0, 0, 0))
    src = img
    sheet.paste(src.crop((0, 0, sL, sT)), (0, 0))                          # TL
    sheet.paste(src.crop((W - sR, 0, W, sT)), (sL + Pw, 0))                # TR
    sheet.paste(src.crop((0, H - sB, sL, H)), (0, sT + Ph))                # BL
    sheet.paste(src.crop((W - sR, H - sB, W, H)), (sL + Pw, sT + Ph))      # BR
    sheet.paste(src.crop((sL, 0, sL + Pw, sT)), (sL, 0))                   # top
    sheet.paste(src.crop((sL, H - sB, sL + Pw, H)), (sL, sT + Ph))         # bottom
    sheet.paste(src.crop((0, sT, sL, sT + Ph)), (0, sT))                   # left
    sheet.paste(src.crop((W - sR, sT, W, sT + Ph)), (sL + Pw, sT))         # right
    fill_hex = args.fill_override or '#%02x%02x%02x' % tuple(int(v) for v in fill)
    # Interior is left transparent so the game's own panel colour shows
    # through: the centre cell, and any edge/corner pixel that is really the
    # source's flat interior (ornament reach can pull a little of it in).
    if not args.keep_fill:
        sa = np.array(sheet)
        interior = near(sa[:, :, :3], fill, args.tol) & (sa[:, :, 3] > 0)
        sa[interior] = 0
        sa[sT:sT + Ph, sL:sL + Pw] = 0
        sheet = Image.fromarray(sa)

    os.makedirs(args.out_dir, exist_ok=True)
    png = os.path.join(args.out_dir, args.name + '.png')
    sheet.save(png)
    meta = {
        'sheet': [sheet.width, sheet.height],
        'slice': [sT, sR, sB, sL],
        'thickness': [T, R, B, L],
        'tile': [Pw, Ph],
        'period_detected': [ph, pv],
        'fill': fill_hex,
        'keep_fill': bool(args.keep_fill),
        'source': os.path.basename(args.src),
    }
    with open(os.path.join(args.out_dir, args.name + '.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    print(args.name, json.dumps(meta))


if __name__ == '__main__':
    main()
