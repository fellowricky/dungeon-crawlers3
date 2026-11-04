"""Import a pixelfx sprite sheet into the game's VFX sheet library.

pixelfx (G:\\ClaudesFolder\\pixelfx) exports `<name>.png` + an Aseprite-style
`<name>.json` at 30 fps with a lot of empty canvas around the effect. This
keeps the frames up to --end seconds, takes every --step'th one, crops all of
them to the union of their opaque pixels, repacks them into a near-square grid
under public/fx/spells/, and prints the vfx_animations.json `sheets` entry.

The entry carries fw/fh (frames are not square; spawnSheetEffect keeps the
aspect) and pivot as [u, v] measured from the frame's bottom-left (three.js
Sprite.center), so the effect's own origin - an explosion's floor line, a
bolt's head - sits on the spawn point.

  python scripts/pixelfx_import.py <pixelfx json> <out name> [--end 1.9] [--step 2] [--once]
      [--ranges 0-1.2,2.45-3.3]   keep only these spans (seconds), spliced in order
      [--span]   crop for a caster->target span layer: the origin (a breath's
                 mouth) on the left edge, centred vertically, so the art keeps
                 its angle when laid along the line
"""
import argparse
import json
import math
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'public', 'fx', 'spells')
# combat plays every sheet at 0.70 x its fps (entities.js), so this fps plays
# the frames back at the speed pixelfx authored them.
PLAYBACK_SLOWDOWN = 0.70


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json_path')
    ap.add_argument('name')
    ap.add_argument('--end', type=float, default=None, help='keep frames before this many seconds')
    ap.add_argument('--ranges', default=None, help='comma-separated start-end spans in seconds to keep')
    ap.add_argument('--step', type=int, default=2, help='keep every Nth 30 fps frame')
    ap.add_argument('--once', action='store_true', help='one-shot: hold the last frame, no fade-in')
    ap.add_argument('--pad', type=int, default=2)
    ap.add_argument('--span', action='store_true', help='origin on the left edge, centred vertically')
    a = ap.parse_args()

    meta = json.load(open(a.json_path))
    pfx = meta['meta']['pixelfx']
    sheet = Image.open(os.path.join(os.path.dirname(a.json_path), meta['meta']['image'])).convert('RGBA')
    frames = meta['frames'] if isinstance(meta['frames'], list) else list(meta['frames'].values())
    src_fps = pfx['fps']
    fw0, fh0 = pfx['frameSize']

    spans = [tuple(float(v) for v in r.split('-')) for r in a.ranges.split(',')] if a.ranges else None
    picked = []
    for i in range(0, len(frames), a.step):
        t = i / src_fps
        if a.end is not None and t >= a.end:
            break
        if spans and not any(lo <= t < hi for lo, hi in spans):
            continue
        r = frames[i]['frame']
        picked.append(sheet.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h'])))
    if not picked:
        sys.exit('no frames picked')

    # Union of opaque pixels across every kept frame, so the effect never
    # shifts inside its cell.
    box = None
    for f in picked:
        b = f.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    px, py = pfx['pivot']
    x0 = max(0, min(box[0], px) - a.pad)
    y0 = max(0, min(box[1], py) - a.pad)
    x1 = min(fw0, max(box[2], px + 1) + a.pad)
    y1 = min(fh0, max(box[3], py + 1) + a.pad)
    if a.span:
        half = max(py - y0, y1 - py)
        x0, y0, y1 = px, py - half, py + half
    fw, fh = x1 - x0, y1 - y0

    n = len(picked)
    cols = max(1, round(math.sqrt(n * fh / fw)))
    rows = math.ceil(n / cols)
    out = Image.new('RGBA', (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, f in enumerate(picked):
        out.paste(f.crop((x0, y0, x1, y1)), ((i % cols) * fw, (i // cols) * fh))
    os.makedirs(OUT_DIR, exist_ok=True)
    out.save(os.path.join(OUT_DIR, a.name + '.png'), optimize=True)

    content_fps = src_fps / a.step
    entry = {
        'url': f'fx/spells/{a.name}.png',
        'cols': cols, 'rows': rows, 'frames': n,
        'fps': round(content_fps / PLAYBACK_SLOWDOWN, 2),
        'w': cols * fw, 'h': rows * fh, 'fw': fw, 'fh': fh,
        'pivot': [round((px - x0) / fw, 4), round(1 - (py - y0) / fh, 4)],
        'source': f"pixelfx:{pfx['id']}",
    }
    if a.once:
        entry['once'] = True
    print(json.dumps({a.name: entry}))
    print(f'{n} frames {fw}x{fh}, sheet {cols * fw}x{rows * fh}, plays {n / content_fps:.2f}s', file=sys.stderr)


if __name__ == '__main__':
    main()
