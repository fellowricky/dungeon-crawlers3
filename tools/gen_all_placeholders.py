"""
Generate placeholder sprites for every guild building in one pass.

Renders N seeds per subject with the locked recipe, auto-picks the most
plausible candidate, promotes it to public/art/guild/, and prints the layout
`art:` lines to paste into guild_layout.js.

Auto-pick is a rough heuristic, not taste — these are placeholders. It rejects
candidates with interior holes, an implausible aspect, or a tiny pixel count,
then takes the largest survivor. Every candidate is left in scratch/guild_art
with a magenta review sheet so a human can override any of them later.

  python tools/gen_all_placeholders.py --seeds 3
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guild_art_bench as bench   # noqa: E402

RECIPE, VARIANT = 'z_image', 'zdusk'
FINAL = os.path.join(bench.REPO, 'public', 'art', 'guild')


def score(path):
    """Higher is better; None rejects the candidate outright."""
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    alpha = np.asarray(im)[:, :, 3]
    opaque = int((alpha > 0).sum())

    if bench.alpha_report(path) > 3.0:      # holes punched through the walls
        return None

    # Background never got keyed out. Happens when the model fills the canvas
    # edge to edge, so the flood fill finds no border-connected background to
    # remove and the sprite ships as an opaque rectangle — it renders in the
    # compound as a white box. Cheap to detect, and always worth a reroll.
    frac_opaque = opaque / float(w * h)
    near_white = 0.0
    if frac_opaque > 0.80:
        px = np.asarray(im)[:, :, :3][np.asarray(im)[:, :, 3] > 0]
        if len(px):
            near_white = (px.min(axis=1) > 235).mean()
        if near_white > 0.15:
            return None
    if w < 48 or h < 40:                    # collapsed to nothing
        return None
    aspect = h / w
    if not (0.45 <= aspect <= 1.9):         # a strip or a tower of noise
        return None
    return opaque


def body_fraction(path):
    """What fraction of the sprite's width the BUILDING actually occupies.

    The model keeps drawing a strip of ground under the building, and that strip
    is wider than the building itself. Cropping to the alpha box therefore
    produces a sprite whose widest part is grass, so scaling the quad to the
    layout width renders the building too small — it looked half the size of its
    procedural neighbours.

    Measuring the opaque span across the upper part of the image samples the
    building and not its apron. guild_scene divides by this so the BUILDING, not
    the turf, matches the layout footprint.
    """
    from PIL import Image
    import numpy as np
    a = np.asarray(Image.open(path).convert('RGBA'))[:, :, 3] > 0
    h, w = a.shape
    upper = a[:int(h * 0.60), :]
    cols = upper.any(axis=0)
    if not cols.any():
        return 1.0
    span = int(cols.nonzero()[0][-1] - cols.nonzero()[0][0] + 1)
    return round(max(0.35, min(1.0, span / w)), 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seeds', type=int, default=3)
    ap.add_argument('--seed-base', type=int, default=800000)
    ap.add_argument('--only', help='comma-separated subset of subjects')
    args = ap.parse_args()

    subjects = list(bench.SUBJECTS)
    if args.only:
        subjects = [s.strip() for s in args.only.split(',') if s.strip()]

    os.makedirs(FINAL, exist_ok=True)
    if not bench.comfy_up() if hasattr(bench, 'comfy_up') else False:
        pass

    picked, sheet_entries = {}, []
    for subj in subjects:
        print(f'\n=== {subj} ===')
        sys.argv = ['bench', '--subject', subj, '--seeds', str(args.seeds),
                    '--recipes', RECIPE, '--variants', VARIANT,
                    '--seed-base', str(args.seed_base)]
        try:
            bench.main()
        except Exception as e:
            print('  generation failed:', e)
            continue

        cands = []
        for i in range(args.seeds):
            seed = args.seed_base + i
            p = os.path.join(bench.REVIEW,
                             f'bench_{subj}_{RECIPE}.{VARIANT}_{seed}.png')
            if not os.path.exists(p):
                continue
            sc = score(p)
            print(f'   seed {seed}: {"reject" if sc is None else sc}')
            if sc is not None:
                cands.append((sc, p))

        if not cands:
            print(f'  !! no usable candidate for {subj}')
            continue
        cands.sort(reverse=True)
        best = cands[0][1]

        from PIL import Image
        w, h = Image.open(best).size
        dst = os.path.join(FINAL, f'{subj}_t1.png')
        shutil.copy2(best, dst)
        picked[subj] = (w, h)
        sheet_entries.append((f'{subj} {w}x{h}', dst))
        print(f'  -> {os.path.basename(dst)}  {w}x{h}')

    bench.sheet(sheet_entries, os.path.join(bench.REVIEW, '_placeholders.png'))

    # Manifest: guild_scene.js reads this and uses any sprite listed here with
    # no edit to guild_layout.js. Merged with whatever is already on disk so a
    # partial run never drops previously generated buildings.
    import json
    mpath = os.path.join(FINAL, 'manifest.json')
    manifest = {}
    if os.path.exists(mpath):
        try:
            manifest = json.load(open(mpath, encoding='utf-8'))
        except Exception:
            manifest = {}
    for subj, (w, h) in picked.items():
        manifest[subj] = {'tiers': [f'./art/guild/{subj}_t1.png'],
                          'aspect': round(h / w, 4), 'px': [w, h],
                          'bodyFrac': body_fraction(os.path.join(FINAL, f'{subj}_t1.png'))}
    json.dump(manifest, open(mpath, 'w', encoding='utf-8'), indent=2, sort_keys=True)
    print(f'manifest -> {mpath} ({len(manifest)} buildings)')

    print('\n\n--- paste into guild_layout.js ---')
    for subj, (w, h) in picked.items():
        print(f"    // {subj}: {w}x{h}px native")
        print(f"    art: {{ type: 'sprite', tiers: ['./art/guild/{subj}_t1.png'], "
              f"aspect: {round(h / w, 3)} }},")


if __name__ == '__main__':
    main()
