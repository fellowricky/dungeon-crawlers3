"""Bake 32px pixel-art tiles into a 2x2 atlas for the instanced floor/wall materials.

The renderer packs four tile variants into one texture and picks a quadrant per
instance via the `aUvO` attribute (see dungeon_materials.js `atlasPatch`), so an
atlas is always exactly four source tiles.

Instance colour multiplies the map, and that per-cell colour is what carries the
dungeon theme (THEMES.<key>.floor / .corridor plus room tint, moss, wall-shadow
darkening). So the baked atlas is normalised toward neutral grey: mostly
desaturated, mean brightness pulled to a fixed target. The tile supplies the
pattern and the theme supplies the hue.

Usage (from the project root):
  python tools/build_tile_atlas.py \
      --tiles "Sprites/Dungeon Crawl Stone Soup Full/dungeon/floor/rect_gray_{0,1,2,3}.png" \
      --out public/art/tiles/ancient_floor.png

Sources so far are DCSS tiles (CC0, see CREDITS.md).
"""
import argparse
import os
from PIL import Image, ImageChops

DEFAULT_TARGET = 0.68   # mean brightness of the baked atlas, 0..1
DEFAULT_SAT = 0.35      # how much of the source hue survives, 0..1
DEFAULT_SCALE = 4       # nearest-neighbour upscale, keeps mip chains usable


def load_tile(path):
    im = Image.open(path).convert('RGBA')
    if im.size[0] != im.size[1]:
        raise SystemExit(f'{path}: tiles must be square, got {im.size}')
    # flatten any alpha onto the tile's own average colour so edges don't go black
    if im.getchannel('A').getextrema()[0] < 255:
        avg = tuple(int(c) for c in im.convert('RGB').resize((1, 1)).getpixel((0, 0)))
        bg = Image.new('RGBA', im.size, avg + (255,))
        im = Image.alpha_composite(bg, im)
    return im.convert('RGB')


def desaturate(im, keep):
    grey = im.convert('L').convert('RGB')
    return Image.blend(grey, im, keep)


def chunkify(im, px):
    """Drop the tile to `px` resolution (box filter) for a chunkier pixel grid."""
    if not px or px >= im.size[0]:
        return im
    return im.resize((px, px), Image.BOX)


def posterize(im, levels):
    """Quantise each channel to `levels` steps — the flat-shading pixel-art look."""
    if not levels or levels >= 256:
        return im
    step = 255.0 / (levels - 1)
    return im.point(lambda v: int(round(v / step) * step))


def normalise(tiles, target):
    """Scale all tiles by one factor so their combined mean hits `target`."""
    total = 0.0
    count = 0
    for im in tiles:
        hist = im.convert('L').histogram()
        total += sum(v * i for i, v in enumerate(hist))
        count += sum(hist)
    mean = total / count / 255.0
    k = (target / mean) if mean > 0 else 1.0
    return [im.point(lambda v, k=k: min(255, int(v * k + 0.5))) for im in tiles], mean, k


def normalise_gamma(tiles, target):
    """Lift all tiles onto `target` with a gamma curve instead of a linear gain.

    Very dark sources (volcanic_floor sits at a mean of 0.03) need gains of 20x
    or more, which clips the dominant channel flat and throws away the detail
    that makes the tile readable. A gamma lift can't clip and it opens up the
    shadows, at the cost of compressing the highlights.
    """
    hist = [0] * 256
    for im in tiles:
        for i, v in enumerate(im.convert('L').histogram()):
            hist[i] += v
    total = sum(hist)
    mean = sum(v * i for i, v in enumerate(hist)) / total / 255.0

    def mean_at(g):
        return sum(v * (i / 255.0) ** g for i, v in enumerate(hist)) / total

    lo, hi = 0.02, 1.0
    if mean >= target:                       # already bright enough, push down
        lo, hi = 1.0, 8.0
    for _ in range(40):                      # bisect on a monotonic function
        mid = (lo + hi) / 2
        if mean_at(mid) > target:
            lo = mid
        else:
            hi = mid
    g = (lo + hi) / 2
    lut = [min(255, int(round(255 * (i / 255.0) ** g))) for i in range(256)]
    return [im.point(lut * len(im.getbands())) for im in tiles], mean, g


def neutralize(im, hexcol, amount=1.0):
    """Pre-divide the tile by a tint's hue so tile x tint lands neutral.

    The per-cell instance colour is often a warm or cool grey (molten walls are
    0x3e3028), and multiplying a neutral texture by it tints the whole surface.
    Scaling the texture channels by the inverse of the tint's hue — luminance
    left alone — cancels that, so the surface reads as stone at the tint's
    brightness rather than as its colour.
    """
    if not hexcol:
        return im
    c = int(hexcol, 16)
    rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    avg = sum(rgb) / 3.0
    if avg <= 0:
        return im
    # amount 0 = leave the tint's colour alone, 1 = cancel it completely
    ratios = [max(0.25, 1.0 + (v / avg - 1.0) * amount) for v in rgb]
    return Image.merge('RGB', [
        ch.point(lambda v, r=ratios[i]: min(255, int(v / r + 0.5)))
        for i, ch in enumerate(im.split())])


def bump_from(im, contrast=1.5):
    """Height map from luminance, contrast-stretched around its own mean."""
    grey = im.convert('L')
    hist = grey.histogram()
    mean = sum(v * i for i, v in enumerate(hist)) / max(1, sum(hist))
    return grey.point(lambda v: max(0, min(255, int((v - mean) * contrast + mean))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', nargs=4, required=True,
                    help='four 32px source tiles; may mix families for variety')
    ap.add_argument('--out', required=True, help='atlas PNG path')
    ap.add_argument('--target', type=float, default=DEFAULT_TARGET)
    ap.add_argument('--sat', type=float, default=DEFAULT_SAT)
    ap.add_argument('--scale', type=int, default=DEFAULT_SCALE)
    ap.add_argument('--px', type=int, default=0, help='downsample tiles to N px first')
    ap.add_argument('--rotate', type=int, default=0, choices=[0, 90, 180, 270],
                    help='rotate each tile; walls need 90 because boxUV maps the '
                         'side faces u=horizontal / v=vertical')
    ap.add_argument('--posterize', type=int, default=0, help='colour levels per channel')
    ap.add_argument('--stack', type=int, default=1,
                    help='tiles stacked vertically per quadrant. Wall boxes are '
                         '~2 world units tall but 1 wide, and their UVs span the '
                         'whole quadrant, so --stack 2 keeps tiles square instead '
                         'of stretched. Makes the atlas twice as tall.')
    ap.add_argument('--curve', choices=['gain', 'gamma'], default='gain',
                    help='how to hit --target: linear gain (default) or a gamma '
                         'lift, which suits very dark sources that would clip')
    ap.add_argument('--neutralize', default=None, metavar='HEX',
                    help="cancel a theme colour's hue (e.g. 0x3e3028) so the "
                         'tinted surface reads neutral instead of warm/cool')
    ap.add_argument('--neutralize-amt', type=float, default=1.0, metavar='0..1',
                    help='how much of the tint hue to cancel (default full)')
    ap.add_argument('--no-bump', action='store_true')
    args = ap.parse_args()

    tiles = [chunkify(load_tile(p), args.px) for p in args.tiles]
    size = tiles[0].size[0]
    if any(t.size[0] != size for t in tiles):
        raise SystemExit('all four tiles must share the same size')
    # normalise first: the brightness gain would otherwise amplify the source
    # chroma right back after desaturation
    fn = normalise_gamma if args.curve == 'gamma' else normalise
    tiles, mean, k = fn(tiles, args.target)
    tiles = [posterize(desaturate(t, args.sat), args.posterize) for t in tiles]
    tiles = [neutralize(t, args.neutralize, args.neutralize_amt) for t in tiles]
    if args.rotate:
        tiles = [t.rotate(args.rotate) for t in tiles]

    q = size * args.scale
    n = max(1, args.stack)
    qh = q * n                      # quadrant height
    atlas = Image.new('RGB', (q * 2, qh * 2))
    for i, t in enumerate(tiles):
        t = t.resize((q, q), Image.NEAREST)
        for s in range(n):
            atlas.paste(t, ((i & 1) * q, (i >> 1) * qh + s * q))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    atlas.save(args.out)
    print(f'{args.out}  {atlas.size[0]}x{atlas.size[1]}  '
          f'(source mean {mean:.3f} -> {args.target:.2f}, {args.curve} {k:.2f})')

    if not args.no_bump:
        bump_path = args.out.replace('.png', '_bump.png')
        bump_from(atlas).save(bump_path)
        print(f'{bump_path}  height map')


if __name__ == '__main__':
    main()
