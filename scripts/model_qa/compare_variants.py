"""
Score each optimized variant against the raw render and build a contact sheet.

    python compare_variants.py <render_dir> <stats.json>

stats.json: [{"label": ..., "tris": ..., "kb": ...}, ...], reference first.

Metrics, per grey view, against the reference:
  iou    silhouette overlap (alpha mask). Drops when limbs, spikes or thin
         parts are eaten. Below ~0.97 something visible is usually gone.
  shade  mean absolute grey difference (0-255) inside the shared silhouette.
         Rises with faceting and lost surface relief.
Writes sheet.png and metrics.json into render_dir.
"""
import json, os, sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

render_dir, stats_path = sys.argv[1], sys.argv[2]
stats = json.load(open(stats_path))
VIEWS = ["grey_game", "grey_front", "grey_side", "grey_back", "grey_top"]
CELL = 256
GAME_PX = 96   # roughly how tall a one-tile prop is on a 1080p screen


def load(label, view):
    return Image.open(os.path.join(render_dir, label, f"{view}.png")).convert("RGBA")


def mask(img):
    return img.getchannel("A").point(lambda a: 255 if a > 127 else 0)


def iou(a, b):
    inter = ImageChops.multiply(a, b).histogram()[255]
    union = ImageChops.lighter(a, b).histogram()[255]
    return inter / union if union else 1.0


def shade_diff(a_img, b_img, both):
    la, lb = a_img.convert("L"), b_img.convert("L")
    diff = ImageChops.difference(la, lb)
    hist = ImageChops.multiply(diff, both).histogram()
    n = both.histogram()[255]
    return (sum(i * c for i, c in enumerate(hist)) / n if n else 0.0), diff


def on_bg(img, bg=(40, 42, 48)):
    base = Image.new("RGBA", img.size, bg + (255,))
    base.alpha_composite(img)
    return base.convert("RGB")


def heat(diff, both, size):
    """Differences above 24 grey levels painted red over a dim silhouette."""
    hot = ImageChops.multiply(diff.point(lambda v: 255 if v > 24 else 0), both)
    out = Image.new("RGB", diff.size, (40, 42, 48))
    out.paste((90, 92, 100), mask=both)
    out.paste((255, 60, 40), mask=hot)
    return out.resize((size, size), Image.LANCZOS)


ref = stats[0]["label"]
ref_imgs = {v: load(ref, v) for v in VIEWS}
ref_masks = {v: mask(ref_imgs[v]) for v in VIEWS}

metrics = []
rows = []
for s in stats:
    label = s["label"]
    row = {"label": label, "tris": s["tris"], "kb": s["kb"], "views": {}}
    cells = []
    tex = on_bg(load(label, "tex_game"))
    cells.append(tex.resize((CELL, CELL), Image.LANCZOS))
    # in-game size: shrink to the on-screen size, then blow up 2x so it is readable
    small = tex.resize((GAME_PX, GAME_PX), Image.LANCZOS).resize((GAME_PX * 2, GAME_PX * 2), Image.NEAREST)
    cell = Image.new("RGB", (CELL, CELL), (40, 42, 48))
    cell.paste(small, ((CELL - GAME_PX * 2) // 2, (CELL - GAME_PX * 2) // 2))
    cells.append(cell)
    front_heat = None
    for v in VIEWS:
        img = load(label, v)
        m = mask(img)
        both = ImageChops.multiply(m, ref_masks[v])
        sd, diff = shade_diff(ref_imgs[v], img, both)
        row["views"][v] = {"iou": round(iou(m, ref_masks[v]), 4), "shade": round(sd, 2)}
        cells.append(on_bg(img).resize((CELL, CELL), Image.LANCZOS))
        if v == "grey_front":
            front_heat = heat(diff, both, CELL)
    cells.append(front_heat)
    row["min_iou"] = min(x["iou"] for x in row["views"].values())
    row["max_shade"] = max(x["shade"] for x in row["views"].values())
    metrics.append(row)
    rows.append(cells)

try:
    font = ImageFont.truetype("arial.ttf", 18)
    small_font = ImageFont.truetype("arial.ttf", 15)
except OSError:
    font = small_font = ImageFont.load_default()

LABEL_W = 230
HEAD_H = 30
cols = ["textured (game cam)", "in-game size ~96px", "grey game cam", "grey front",
        "grey side", "grey back", "grey top", "front diff vs raw"]
sheet = Image.new("RGB", (LABEL_W + CELL * len(cols), HEAD_H + CELL * len(rows)), (24, 25, 29))
d = ImageDraw.Draw(sheet)
for i, c in enumerate(cols):
    d.text((LABEL_W + i * CELL + 8, 6), c, fill=(220, 220, 220), font=small_font)
for r, (cells, m) in enumerate(zip(rows, metrics)):
    y = HEAD_H + r * CELL
    for i, c in enumerate(cells):
        sheet.paste(c, (LABEL_W + i * CELL, y))
    d.text((10, y + 10), m["label"], fill=(255, 210, 120), font=font)
    d.text((10, y + 40), f"{m['tris']:,} tris", fill=(220, 220, 220), font=small_font)
    d.text((10, y + 62), f"{m['kb']:,} KB", fill=(220, 220, 220), font=small_font)
    if r > 0:
        d.text((10, y + 92), f"min IoU   {m['min_iou']:.3f}", fill=(220, 220, 220), font=small_font)
        d.text((10, y + 114), f"max shade {m['max_shade']:.1f}", fill=(220, 220, 220), font=small_font)
sheet.save(os.path.join(render_dir, "sheet.png"))
json.dump(metrics, open(os.path.join(render_dir, "metrics.json"), "w"), indent=2)
print(json.dumps([{k: m[k] for k in ("label", "tris", "kb", "min_iou", "max_shade")} for m in metrics]))
