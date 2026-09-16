"""
GUILD BUILDING SPRITE GENERATOR — production path for compound art.

This is a thin wrapper over `guild_art_bench.py`, which owns the prompt, the
recipe table and the fix pipeline. Deliberately no duplicated prompt text: the
whole point of the exercise is that ~14 buildings x 3 tiers come out as one
consistent set, and two scripts with two copies of the style stem would drift
apart within a week.

THE RECIPE (chosen by benching 5 model/LoRA stacks against the same tavern)
--------------------------------------------------------------------------
  model    pixelArtDiffusionXL_spriteShaper, 1024x1024, 28 steps, cfg 6,
           dpmpp_2m / karras, no LoRA
  prompt   variant v3 = weighted front-on lock + weighted white-background
           isolation + steep-overhead composition wording
  fix      pre-crop the raw to the subject, then the Retro-Diffusion pixel
           fixer at (world width x 32) px, then crop to the alpha box

Why not the others:
  z_image            respects isolation and framing but is softer, and leaves
                     speckle around the silhouette after the fixer
  hyperpixel_v10     drew isometric wall fragments, not buildings
  illu_pixelcore     eye-level, and drew full scenes with sky and ground
  illu_skormino3     same scenery problem, weaker silhouette

Known failure mode: roughly 1 render in 6 still leaks background (trees, grass,
a white card behind the building). It is obvious on the contact sheet's dark
band — reroll that seed rather than trying to salvage it.

USAGE
  python tools/gen_guild_building.py --list
  python tools/gen_guild_building.py --subject tavern --seeds 6
  python tools/gen_guild_building.py --subject tavern --pick 760004   # promote
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guild_art_bench as bench   # noqa: E402

RECIPE = 'z_image'
VARIANT = 'zdark'
FINAL_DIR = os.path.join(bench.REPO, 'public', 'art', 'guild')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--subject')
    ap.add_argument('--seeds', type=int, default=6)
    ap.add_argument('--seed-base', type=int, default=760000)
    ap.add_argument('--pick', type=int,
                    help='promote an already-generated seed to public/art/guild')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()

    if args.list:
        for k, v in bench.SUBJECTS.items():
            print(f'{k:18} w={v["w"]:>3} world units -> {v["w"] * bench.PX_PER_UNIT}px sprite')
        return

    if not args.subject:
        sys.exit('need --subject (or --list)')
    if args.subject not in bench.SUBJECTS:
        sys.exit(f'unknown subject {args.subject!r}; try --list')

    if args.pick is not None:
        src = os.path.join(bench.REVIEW,
                           f'bench_{args.subject}_{RECIPE}.{VARIANT}_{args.pick}.png')
        if not os.path.exists(src):
            sys.exit(f'no such candidate: {src}')
        os.makedirs(FINAL_DIR, exist_ok=True)
        dst = os.path.join(FINAL_DIR, f'{args.subject}_t1.png')
        shutil.copy2(src, dst)
        print(f'promoted -> {dst}')
        print('now point the layout entry at it:')
        print(f"  art: {{ type: 'sprite', tiers: ['./art/guild/{args.subject}_t1.png'] }}")
        return

    sys.argv = ['bench',
                '--subject', args.subject,
                '--seeds', str(args.seeds),
                '--recipes', RECIPE,
                '--variants', VARIANT,
                '--seed-base', str(args.seed_base)]
    bench.main()
    print(f'\nreview the sheet, then promote one:\n'
          f'  python tools/gen_guild_building.py --subject {args.subject} --pick <seed>')


if __name__ == '__main__':
    main()
