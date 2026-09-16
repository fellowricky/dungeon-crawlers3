"""
Single-image prompt iteration loop.

One render, one review, one prompt change, repeat. Prompts live in plain text
files so a change is an edit rather than a code change, and the seed is held
fixed so successive renders are actually comparable — changing prompt and seed
at once tells you nothing about which caused the difference.

  python tools/iter_prompt.py --n 01            # render iteration 01
  python tools/iter_prompt.py --n 02 --seed 4242

Files:
  scratch/guild_art/iter_pos.txt   positive prompt (edit between runs)
  scratch/guild_art/iter_neg.txt   negative prompt
  scratch/guild_art/iter_<n>.png   full-res result, background keyed
  scratch/guild_art/iter_<n>.jpg   downscaled, for review
"""
import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import guild_art_bench as bench   # noqa: E402

POS = os.path.join(bench.REVIEW, 'iter_pos.txt')
NEG = os.path.join(bench.REVIEW, 'iter_neg.txt')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', required=True, help='iteration label, e.g. 01')
    ap.add_argument('--seed', type=int, default=910000)
    ap.add_argument('--keep-bg', action='store_true',
                    help='skip keying — useful when judging composition only')
    args = ap.parse_args()

    pos = open(POS, encoding='utf-8').read().strip()
    neg = open(NEG, encoding='utf-8').read().strip()

    prefix = f'guild/iter_{args.n}'
    g = bench.zimage_graph(pos, neg, args.seed, prefix)
    pid = bench.queue(g)
    print(f'iter {args.n}  seed {args.seed}  ({len(pos)} chars pos)')
    bench.wait_idle()

    raws = bench.outputs_for(pid)
    if not raws:
        sys.exit('no output')

    out = os.path.join(bench.REVIEW, f'iter_{args.n}.png')
    if args.keep_bg:
        from PIL import Image
        Image.open(bench.precrop(raws[0])).save(out)
    else:
        bench.fix_placeholder(raws[0], out)

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(out)
    w, h = im.size

    # Review copy over magenta so any keying failure is unmissable, downscaled
    # so it is quick to look at.
    flat = Image.new('RGBA', im.size, (255, 0, 255, 255))
    flat.alpha_composite(im.convert('RGBA'))
    flat.thumbnail((900, 900), Image.LANCZOS)
    jpg = os.path.join(bench.REVIEW, f'iter_{args.n}.jpg')
    flat.convert('RGB').save(jpg, quality=92)
    print(f'  {w}x{h} -> {jpg}')


if __name__ == '__main__':
    main()
