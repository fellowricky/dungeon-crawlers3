"""
Snap guild building sprites to a true pixel grid WITHOUT losing resolution.

The Retro-Diffusion fixer reconstructs an image at the grid the art was really
drawn on — typically a few hundred pixels across. Used directly that would
shrink every asset. Here the small grid-true result is scaled back up with
NEAREST, so the file keeps its original dimensions but every pixel is now a
real, square, uniform block instead of a smoothly interpolated one.

Alpha is handled separately and deliberately. The fixer works on RGB, so the
cutout is downsampled to the same grid, thresholded back to hard 0/255, and
recombined — otherwise the pass would either destroy the transparency or leave
soft anti-aliased edges, which is exactly what pixel art must not have.

  python tools/pixelfix_assets.py                      # every guild sprite
  python tools/pixelfix_assets.py --only blacksmith
  python tools/pixelfix_assets.py --dry-run
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guild_art_bench as bench   # noqa: E402

GUILD = os.path.join(bench.REPO, 'public', 'art', 'guild')

# Art pixels per world unit. 32 matches the DCSS ground tiles in
# guild_ground.js, so building pixels and ground pixels stay the same size at
# every zoom level.
PPU = 32

# Edge handling: 'strip' removes the pale rim, 'outline' darkens the border,
# 'both' does each in turn, 'none' leaves edges alone.
EDGE_MODE = 'outline'
EDGE_OUTLINE = 0.55


def treat_edges(rgba, mode='outline', margin=40, outline=0.55, passes=1):
    """Kill the pale rim, then lay a dark outline — at ART-PIXEL granularity.

    Two things defeated the earlier attempts:

    1. An ABSOLUTE brightness test (`> 225`) only catches near-pure-white. Real
       fringe pixels are a blend of white background and subject, so plenty land
       at 180-220 and survive. The test here is RELATIVE: an edge pixel is
       fringe if it is markedly brighter than the interior it borders, which
       adapts to a dark slate roof and a pale stone wall alike.

    2. Running it on the full-size image is too late. After the fixer upscales,
       one art pixel is an NxN block, so removing a pixel carves a notch out of
       a block. This runs on the small grid where 1 px == 1 art pixel.

    `outline` then darkens the surviving edge ring, which both masks any residual
    blend and gives the sprites the crisp dark border pixel art wants — they read
    much better against the compound's grass.
    """
    import numpy as np
    from scipy import ndimage

    a = rgba.astype(np.int16)
    alpha = a[:, :, 3]

    if mode in ('strip', 'both'):
        for _ in range(passes):
            opaque = alpha > 0
            if not opaque.any():
                break
            inner = ndimage.binary_erosion(opaque, np.ones((3, 3), bool))
            edge = opaque & ~inner
            if not edge.any() or not inner.any():
                break
            rgb = a[:, :, :3]
            lum = rgb.mean(axis=2)
            # Brightness of the interior each edge pixel actually borders.
            local = ndimage.uniform_filter(np.where(inner, lum, 0).astype(float), size=7)
            cover = ndimage.uniform_filter(inner.astype(float), size=7)
            ref = np.divide(local, np.maximum(cover, 1e-6))

            # "Brighter than its interior" ALONE is not enough to identify
            # fringe, and using it alone chewed the art badly: a pale stone
            # chimney cap against dark slate is legitimately much brighter than
            # what it borders, so roof ridges, chimney tops and finials were
            # eaten. Real fringe is a blend with a WHITE background, so it is
            # also near-white and almost colourless — building highlights are
            # tinted (warm stone, blue slate). All three must hold.
            near_white = rgb.min(axis=2) > 212
            colourless = (rgb.max(axis=2) - rgb.min(axis=2)) < 20
            kill = edge & near_white & colourless & (cover > 0.05) & (lum > ref + margin)
            if not kill.any():
                break
            alpha[kill] = 0

    if mode in ('outline', 'both') and outline > 0:
        opaque = alpha > 0
        inner = ndimage.binary_erosion(opaque, np.ones((3, 3), bool))
        ring = opaque & ~inner
        if ring.any():
            a[:, :, :3][ring] = (a[:, :, :3][ring] * (1.0 - outline)).astype(np.int16)

    a[:, :, 3] = alpha
    return np.clip(a, 0, 255).astype(np.uint8)


def target_cols_for(path):
    """How many art pixels this sprite should have across, from the manifest.

    Auto-detection cannot be trusted for a SET. Run on the blacksmith levels it
    reported grids from 35x30 to 385x309 — every level a different pixel size,
    which would read as ten unrelated assets rather than one building upgrading.

    Instead the target comes from the shared ruler already in the manifest:
    art pixels = world width x PPU. Every level of every building then has
    identical pixel density, matching the DCSS ground tiles at 32 px/unit.
    """
    rel = os.path.relpath(path, GUILD).replace(os.sep, '/')
    mpath = os.path.join(GUILD, 'manifest.json')
    if not os.path.exists(mpath):
        return None
    try:
        man = json.load(open(mpath, encoding='utf-8'))
    except Exception:
        return None
    for entry in man.values():
        for t in entry.get('tiers', []):
            if isinstance(t, dict) and t.get('file', '').endswith('/' + rel):
                return max(24, int(round(t['worldW'] * PPU)))
    return None


def pixelfix_keep_size(path, dry_run=False):
    """Grid-snap in place, preserving the original pixel dimensions."""
    from PIL import Image
    import numpy as np
    from scipy import ndimage
    Image.MAX_IMAGE_PIXELS = None

    src = Image.open(path).convert('RGBA')
    W, H = src.size
    arr = np.asarray(src)
    alpha = arr[:, :, 3]

    # Bleed subject colour outward into the transparent region before the fixer
    # sees it.
    #
    # The fixer only looks at RGB. Under alpha=0 the RGB is still the original
    # white background, so its block averaging mixes white into every edge cell
    # and RE-CREATES the halo — defringing beforehand made almost no difference
    # and on some levels made it worse. Filling the transparent area with the
    # nearest opaque colour means an edge cell averages subject with subject.
    # The bled pixels are discarded afterwards by the alpha mask anyway.
    opaque = alpha > 0
    if opaque.any() and not opaque.all():
        _, idx = ndimage.distance_transform_edt(~opaque, return_indices=True)
        bled = arr[:, :, :3][idx[0], idx[1]]
    else:
        bled = arr[:, :, :3]
    rgb = Image.fromarray(bled.astype(np.uint8), 'RGB')

    tmpdir = tempfile.mkdtemp(prefix='pxfix_')
    try:
        tin = os.path.join(tmpdir, 'in.png')
        tout = os.path.join(tmpdir, 'out.png')
        rgb.save(tin)

        cmd = [bench.VENV_PY, bench.FIXER, tin, tout, '--no-bg-remove', '--json']
        cols = target_cols_for(path)
        if cols:
            # Force the cell size so the whole set shares one pixel density.
            cmd += ['--force-step', str(max(1, round(W / cols)))]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(tout):
            return None, f'fixer failed: {r.stderr.strip()[:160]}'

        meta = {}
        try:
            meta = json.loads(r.stdout)
        except Exception:
            pass

        small = Image.open(tout).convert('RGB')
        w2, h2 = small.size
        if w2 < 8 or h2 < 8:
            return None, f'grid too small ({w2}x{h2}) — refusing'

        # Alpha onto the same grid. Area-average then threshold keeps the
        # silhouette faithful; plain NEAREST on a large downscale drops thin
        # detail like sign brackets and chimney stacks.
        a_small = Image.fromarray(alpha, 'L').resize((w2, h2), Image.BOX)
        a_small = a_small.point(lambda v: 255 if v >= 128 else 0)

        merged = Image.merge('RGBA', (*small.split(), a_small))

        # Edge treatment happens HERE — on the grid, before upscaling.
        merged = Image.fromarray(
            treat_edges(np.asarray(merged), mode=EDGE_MODE, outline=EDGE_OUTLINE), 'RGBA')

        out = merged.resize((W, H), Image.NEAREST)   # back to original size

        if not dry_run:
            out.save(path)
        return dict(grid=(w2, h2), cell=round(W / w2, 2),
                    detected=meta.get('confidence')), None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='substring filter on path')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--ppu', type=int, help='override art pixels per world unit')
    ap.add_argument('--edge', choices=['both', 'strip', 'outline', 'none'], default='outline',
                    help="default 'outline': darken the border only. 'strip' also "
                         "removes near-white fringe, which risks eating pale detail.")
    ap.add_argument('--outline', type=float, default=0.55,
                    help='0 = none, 1 = black (default 0.55)')
    args = ap.parse_args()
    if args.ppu:
        globals()['PPU'] = args.ppu
    globals()['EDGE_MODE'] = args.edge
    globals()['EDGE_OUTLINE'] = args.outline

    files = sorted(glob.glob(os.path.join(GUILD, '**', '*.png'), recursive=True))
    files = [f for f in files if os.path.basename(f) != 'manifest.json']
    if args.only:
        files = [f for f in files if args.only in f.replace('\\', '/')]
    if not files:
        sys.exit('no sprites found')

    print(f'{len(files)} sprite(s){"  [dry run]" if args.dry_run else ""}\n')
    ok = fail = 0
    for f in files:
        rel = os.path.relpath(f, GUILD).replace('\\', '/')
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        W, H = Image.open(f).size
        info, err = pixelfix_keep_size(f, args.dry_run)
        if err:
            print(f'  {rel:<34} {W}x{H}  SKIPPED — {err}')
            fail += 1
            continue
        print(f'  {rel:<34} {W}x{H}  grid {info["grid"][0]}x{info["grid"][1]}'
              f'  cell {info["cell"]}px  ({info["detected"]})')
        ok += 1
    print(f'\n{ok} fixed, {fail} skipped')


if __name__ == '__main__':
    main()
