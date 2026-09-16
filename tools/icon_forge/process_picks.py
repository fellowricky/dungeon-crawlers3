r"""Turn reviewed picks into game-ready 32px icons with transparent backgrounds.

    "G:\Data\Packages\ComfyUI\venv\Scripts\python.exe" process_picks.py

Reads picks.json (written by icon_picker.html), and for each chosen variant:
crop to the ink bbox -> pixel-fixer downscale to 32px -> transparent PNG, into
public/art/icons/<category>/<key>.png.

Crop happens BEFORE the downscale on purpose. Krea2 leaves the glyph small in a
big white field; fixing at 32px first spends most of the budget on margin and
the icon reads as a speck at the ~20px a status pip actually uses.
"""
import glob, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageChops
from scipy import ndimage

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.abspath(os.path.join(ROOT, "..", "..", "public", "art", "icons"))
TMP = os.path.join(ROOT, "_cropped")
FIX = r"C:\Users\fello\.claude\skills\pixel-art-assets-generator\scripts\fix_pixel_art.py"
MARGIN, INK, SPECK = 0.04, 18, 0.005
# Background threshold. 200 was too aggressive: deliberately pale art (the ghosted
# figures of Mirror Image, the Moonbeam crescent, the Blinded eye) sits in the
# 200-235 band, touches the border, and was cut away as background. 240 keeps it.
BG_THRESHOLD = 240
# Icons touched up by hand after the batch -- never overwrite these.
try:
    KEEP_MANUAL = set(json.load(open(os.path.join(ROOT, "keep_manual.json"), encoding="utf-8")))
except Exception:
    KEEP_MANUAL = set()
# Shapes whose middle is meant to be see-through (rings, crosshairs, spirals).
# Border-flood removal keeps enclosed white, so these need the hole re-opened.
try:
    DONUT_IDS = set(json.load(open(os.path.join(ROOT, "donuts.json"), encoding="utf-8")))
except Exception:
    DONUT_IDS = set()


def crop_to_art(src, dst):
    im = Image.open(src).convert("RGB")
    diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255)))
    mask = np.array(diff.convert("L")) > INK
    if not mask.any():
        im.save(dst)
        return
    # Drop faint haloes and stray specks before measuring -- a soft glow can
    # stretch the bbox ~80%, which silently shrinks the glyph again.
    lab, k = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    keep = [i + 1 for i, sz in enumerate(sizes) if sz >= SPECK * sizes.max()]
    ys, xs = np.where(np.isin(lab, keep))
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    side = max(x1 - x0, y1 - y0)
    side += int(side * MARGIN) * 2
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    l, t = cx - side // 2, cy - side // 2
    cl, ct = max(0, l), max(0, t)
    cr, cb = min(im.width, l + side), min(im.height, t + side)
    out = Image.new("RGB", (side, side), (255, 255, 255))
    # clamp the read and re-centre the paste; an unclamped crop() back-fills black
    out.paste(im.crop((cl, ct, cr, cb)), (cl - l, ct - t))
    out.save(dst)


def cut_background(path):
    """Make only the border-connected white transparent, and keep enclosed white.

    The fixer's own removal is colour-based, which cannot work here: measured on
    the sources, the white *fill* of a glyph and the white background are the
    same values (min 237, mean 254). Removing by colour therefore hollowed out
    every white-filled icon -- radiant, sunburst, wish and sacredFlame all came
    back as bare outlines. Flooding from the border instead keeps interior white,
    because it asks "is this reachable from outside" rather than "is this white".

    Shapes that genuinely want a transparent middle (rings, crosshairs) are the
    trade-off: their hole is enclosed, so it survives as white and needs the
    hole punched separately. `donut_ids` handles those.
    """
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    white = (a[..., :3].min(axis=2) > BG_THRESHOLD)

    # Seed the flood from the border and keep only what it reaches.
    lab, n = ndimage.label(white)
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    outside = np.isin(lab, list(border))

    a[..., 3] = np.where(outside, 0, 255)
    Image.fromarray(a).save(path)
    return int((~outside & white).sum())


def punch_hole(path):
    """Re-open the largest enclosed white region -- for ring and crosshair shapes."""
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    enclosed = (a[..., :3].min(axis=2) > BG_THRESHOLD) & (a[..., 3] > 0)
    if not enclosed.any():
        return 0
    lab, n = ndimage.label(enclosed)
    sizes = ndimage.sum(enclosed, lab, range(1, n + 1))
    biggest = int(np.argmax(sizes)) + 1
    a[..., 3] = np.where(lab == biggest, 0, a[..., 3])
    Image.fromarray(a).save(path)
    return int(sizes.max())


def main():
    picks = json.load(open(os.path.join(ROOT, "picks.json"), encoding="utf-8"))
    manifest = {i["id"]: i for i in
                json.load(open(os.path.join(ROOT, "icons.json"), encoding="utf-8"))}
    os.makedirs(TMP, exist_ok=True)
    done = skipped = 0
    for icon_id, pick in sorted(picks.items()):
        if not pick.get("file"):
            skipped += 1
            continue
        ic = manifest.get(icon_id)
        if not ic:
            print("no manifest entry:", icon_id)
            continue
        if icon_id in KEEP_MANUAL:
            skipped += 1
            continue
        dest_dir = os.path.join(OUT, ic["category"])
        os.makedirs(dest_dir, exist_ok=True)
        mid = os.path.join(TMP, icon_id + ".png")
        dst = os.path.join(dest_dir, ic["key"] + ".png")
        crop_to_art(os.path.join(RAW, pick["file"]), mid)
        # --no-bg-remove: the fixer only downscales; the cut is done topologically
        # below, because colour cannot separate art-white from background-white.
        subprocess.run([sys.executable, FIX, "--size", "32", "--no-bg-remove", mid, dst],
                       check=True, stdout=subprocess.DEVNULL)
        cut_background(dst)
        if icon_id in DONUT_IDS:
            punch_hole(dst)
        done += 1
        print("%-34s -> art/icons/%s/%s.png" % (icon_id, ic["category"], ic["key"]))
    print("\n%d written, %d skipped (hand-edited, or awaiting a pick)" % (done, skipped))

    # Index every icon actually on disk -- including hand-edited ones this run
    # skipped -- so src/game/icons.js can tell "missing" from "present" without a
    # network probe, and fall back to the old emoji instead of a broken image.
    paths = sorted(
        "%s/%s" % (os.path.basename(d), f[:-4])
        for d in glob.glob(os.path.join(OUT, "*")) if os.path.isdir(d)
        for f in os.listdir(d) if f.endswith(".png"))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(paths, fh, indent=1)
    print("indexed %d icons -> art/icons/index.json" % len(paths))


if __name__ == "__main__":
    main()
