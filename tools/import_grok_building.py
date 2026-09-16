"""
Import a hand-authored building upgrade set (e.g. Grok's 10-level blacksmith)
into game-ready sprites.

  python tools/import_grok_building.py --src Sprites/guild/blacksmith --id blacksmith

What it does, and why each step is needed:

  1. KEY the white background with a border-connected flood fill. A global
     colour threshold would eat pale stone walls wherever they appear; only
     background reachable from the image edge is removed.

  2. DROP FLOATING PROPS. Several levels have an anvil or workbench drawn
     detached *below* the building. Left in, they set the bottom of the bounding
     box, so the building would float above the ground line and shrink when
     scaled to its plot. Anything entirely below the main mass goes.

  3. DESPECKLE relative to the building, not the canvas — JPEG edge noise.

  4. NORMALISE SCALE ACROSS LEVELS. This is the real work. Each level is drawn
     at a different size in a different canvas, so cropping each independently
     would make the building lurch about as it upgrades instead of growing. One
     pixels-per-world-unit is derived from the LARGEST level and applied to all,
     so every level's world size is measured on the same ruler.

  5. Emit a manifest entry with per-level world width, so guild_scene can index
     levels 1-10 directly instead of collapsing them into three visual tiers.
"""
import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guild_art_bench as bench   # noqa: E402

FINAL = os.path.join(bench.REPO, 'public', 'art', 'guild')


def key_and_clean(src_path, dst_path):
    """White-key, drop floating props and speckle, crop to the building."""
    from PIL import Image
    import numpy as np
    from scipy import ndimage

    Image.MAX_IMAGE_PIXELS = None
    Image.open(src_path).convert('RGB').save(dst_path)
    bench.keyout(dst_path, tol=60)          # JPEG needs a looser tolerance

    im = Image.open(dst_path).convert('RGBA')
    arr = np.asarray(im).copy()
    opaque = arr[:, :, 3] > 0
    lbl, n = ndimage.label(opaque)
    if n == 0:
        return None

    sizes = ndimage.sum(opaque, lbl, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    main_mask = lbl == main
    rows = main_mask.any(axis=1).nonzero()[0]
    cols = main_mask.any(axis=0).nonzero()[0]
    main_bottom, main_top = rows[-1], rows[0]
    main_w = int(cols[-1] - cols[0] + 1)

    main_h = int(main_bottom - main_top + 1)

    dropped = 0
    for i, sz in enumerate(sizes):
        cid = i + 1
        if cid == main:
            continue
        m = lbl == cid
        r = m.any(axis=1).nonzero()[0]
        # A prop standing on the ground IN FRONT of the building legitimately
        # sits below its base: in a three-quarter view nearer means lower, and
        # the sprite is stood on the ground by its lowest pixel, so that crate
        # or forge IS the ground line. Only discard what floats clear of the
        # composition; the tolerance keeps props that rest against the plinth.
        detached = r[0] > main_bottom + 0.06 * main_h
        if detached or sz < 0.004 * sizes[main - 1]:
            arr[m, 3] = 0
            dropped += 1

    im = Image.fromarray(arr, 'RGBA')
    im.save(dst_path)

    # Strip the pale anti-aliased rim before anything downstream sees it.
    fringe = bench.defringe(dst_path)

    # Crop and centre LAST. Defringe eats a pixel or two off the silhouette, so
    # cropping before it would leave a stale margin, and centring before it
    # would be undone by the re-crop.
    im = Image.open(dst_path).convert('RGBA')
    bb = im.split()[3].getbbox()
    if bb:
        im = im.crop(bb)
    im.save(dst_path)
    return dict(px=im.size, main_w=main_w, dropped=dropped, fringe=fringe,
                main_h=main_h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--world-w', type=float,
                    help='world width of the TOP level (default: layout w)')
    ap.add_argument('--px-per-unit', type=float,
                    help='SHARED ruler: art pixels per world unit, used as-is '
                         'instead of stretching this set to fit a target width. '
                         'Use when the source art was already drawn to one scale '
                         'across every building (matching doorway sizes).')
    args = ap.parse_args()

    if args.world_w is None:
        spec = bench.SUBJECTS.get(args.id)
        args.world_w = spec['w'] if spec else 9.0

    files = sorted(glob.glob(os.path.join(args.src, 'lvl*.*')),
                   key=lambda p: int(re.search(r'lvl(\d+)', p).group(1)))

    # Single-image set. The tavern and merchant are alwaysBuilt town structures
    # with no upgrade track, so one sprite is the whole set — it is imported as
    # a lone tier and the level index clamps onto it at every level.
    single = False
    if not files:
        files = [f for f in sorted(glob.glob(os.path.join(args.src, '*.*')))
                 if os.path.splitext(f)[1].lower() in ('.png', '.jpg', '.jpeg', '.webp')]
        single = bool(files)
        files = files[:1]
    if not files:
        sys.exit(f'no lvl*.* or image files in {args.src}')

    out_dir = os.path.join(FINAL, args.id)
    os.makedirs(out_dir, exist_ok=True)

    info = []
    for f in files:
        m = re.search(r'lvl(\d+)', f)
        lvl = int(m.group(1)) if m else 1
        dst = os.path.join(out_dir, f'lvl{lvl}.png')
        r = key_and_clean(f, dst)
        if not r:
            print(f'  lvl{lvl}: FAILED')
            continue
        r['lvl'] = lvl
        r['file'] = f'./art/guild/{args.id}/lvl{lvl}.png'
        info.append(r)
        print('  lvl%-3d %-12s building %dpx  dropped %d parts  defringed %d px  holes %.1f%%'
              % (lvl, f'{r["px"][0]}x{r["px"][1]}', r['main_w'], r['dropped'],
                 r['fringe'], bench.alpha_report(dst)))

    # One ruler for the whole set, anchored on the TOP level.
    #
    # Anchoring on the widest level was wrong: this set's lvl5 has a broad
    # lean-to that makes it wider than the grander lvl10, so the building
    # visibly SHRANK when upgrading past 5. Pinning the ruler to the final level
    # means the finished building fills its plot and everything below it reads
    # as smaller — which is what an upgrade path should look like. A mid-level
    # that happens to be wider just overhangs its plot slightly, which is fine
    # for a building with a porch.
    top = max(i['lvl'] for i in info)
    top_w = next(i['main_w'] for i in info if i['lvl'] == top)
    if args.px_per_unit:
        # The set was authored against a SHARED ruler: every building drawn so a
        # doorway is the same number of pixels everywhere. Rescaling each
        # building to hit its own target width would throw that away and give
        # neighbouring buildings different-sized doors, so the supplied ruler is
        # used verbatim and the art itself decides how big the building is.
        px_per_unit = args.px_per_unit
        print(f'\nscale: shared ruler {px_per_unit:.1f} px/unit '
              f'(level {top} measures {top_w}px -> {top_w / px_per_unit:.1f} units)')
    else:
        px_per_unit = top_w / args.world_w
        print(f'\nscale: level {top} ({top_w}px) -> {args.world_w} world units '
              f'({px_per_unit:.1f} px/unit)')

    # Preserve hand-tuned data across a re-import.
    #
    # This used to replace the manifest entry wholesale, which would silently
    # destroy the per-level dx/dz/scale nudges made in the preview editor and
    # the building's click-volume config — hours of tuning gone because the art
    # was re-imported to fix an edge artifact. Re-importing must only refresh
    # what the import actually owns: file paths and measured geometry.
    prev = {}
    prev_hitbox = None
    if os.path.exists(os.path.join(FINAL, 'manifest.json')):
        try:
            old = json.load(open(os.path.join(FINAL, 'manifest.json'), encoding='utf-8'))
            entry = old.get(args.id, {})
            prev_hitbox = entry.get('hitbox')
            for n, t in enumerate(entry.get('tiers', []), 1):
                if isinstance(t, dict):
                    prev[n] = {k: t[k] for k in ('dx', 'dz', 'scale') if k in t}
        except Exception:
            pass

    tiers = []
    for i in info:
        # The sprite's world width is its FULL cropped width on the shared ruler,
        # so props beside the building keep their true proportion.
        world_w = round(i['px'][0] / px_per_unit, 3)
        tier = {'file': i['file'], 'worldW': world_w,
                'aspect': round(i['px'][1] / i['px'][0], 4)}
        tier.update(prev.get(i['lvl'], {}))       # keep editor nudges
        tiers.append(tier)
        print('  lvl%-3d world %.2f x %.2f units' % (i['lvl'], world_w, world_w * tiers[-1]['aspect']))

    mpath = os.path.join(FINAL, 'manifest.json')
    manifest = {}
    if os.path.exists(mpath):
        try:
            manifest = json.load(open(mpath, encoding='utf-8'))
        except Exception:
            manifest = {}
    manifest[args.id] = {'tiers': tiers, 'perLevel': True}
    if prev_hitbox:
        manifest[args.id]['hitbox'] = prev_hitbox
    kept = sum(1 for t in tiers if 'dx' in t)
    if kept or prev_hitbox:
        print(f'preserved {kept} per-level nudge(s)'
              f'{" + hitbox" if prev_hitbox else ""}')
    json.dump(manifest, open(mpath, 'w', encoding='utf-8'), indent=2, sort_keys=True)
    print(f'\nmanifest updated: {args.id} with {len(tiers)} levels')


if __name__ == '__main__':
    main()
