"""Render a contact sheet of every armour / shield / weapon base, composited the
same way sprite_animator.js does, so gear changes can be eyeballed without
launching the game.

    python scripts/preview_gear.py [out.png]

Mirrors buildLayerPaths + layerTint from src/game/sprite_animator.js. Draws the
south-facing standing frame (walk sheet, row 2, column 0).
"""
from __future__ import annotations

import colorsys
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LPC = ROOT / "public" / "lpc"
ITEMS = json.loads((ROOT / "src" / "game" / "items.json").read_text(encoding="utf-8"))

LAYER_ORDER = [
    "cape_behind", "shield_behind", "weapon_behind", "body", "head", "eyes",
    "legs", "torso", "sleeves", "feet", "belt", "shoulders", "bracers", "gloves",
    "cape", "shield", "weapon",
]
SHIELDS_WITH_BACK = {"crusader/fg", "scutum", "spartan", "plus", "two_engrailed"}
CAPES_WITH_BACK = {"solid", "tattered"}

SKIN = "#c98d63"
CELL = 96  # rendered size per figure


def tint(img: Image.Image, hex_color: str) -> Image.Image:
    """HSL recolor: keep each pixel's lightness, take the target hue/saturation."""
    r = int(hex_color[1:3], 16) / 255
    g = int(hex_color[3:5], 16) / 255
    b = int(hex_color[5:7], 16) / 255
    th, _, ts = colorsys.rgb_to_hls(r, g, b)
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            cr, cg, cb, ca = px[x, y]
            if ca == 0:
                continue
            _, li, _ = colorsys.rgb_to_hls(cr / 255, cg / 255, cb / 255)
            nr, ng, nb = colorsys.hls_to_rgb(th, li, ts)
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), ca)
    return out


def frame(path: Path) -> Image.Image | None:
    """South-facing standing frame from a walk sheet, normalised to 64px."""
    if not path.is_file():
        return None
    sheet = Image.open(path).convert("RGBA")
    fs = sheet.height // 4
    cell = sheet.crop((0, fs * 2, fs, fs * 3))
    if fs != 64:  # oversize weapon sheet — centre-crop back to the body frame
        off = (fs - 64) // 2
        cell = cell.crop((off, off, off + 64, off + 64))
    return cell


def layer_paths(armor=None, shield=None, weapon=None, body="male"):
    t = armor.get("visualTorso") if armor else None
    legs = (armor.get("visualLegs") or "pants") if armor else "pants"
    sl = armor.get("visualSleeves") if armor else None
    sh_l = armor.get("visualShoulders") if armor else None
    br = armor.get("visualBracers") if armor else None
    cp = armor.get("visualCape") if armor else None
    bl = armor.get("visualBelt") if armor else None
    sv = shield.get("visualShield") if shield else None
    wv = weapon.get("visualWeapon") if weapon else None
    thin = "male" if body == "male" else "thin"
    return {
        "cape_behind": f"cape_behind/{cp}" if cp in CAPES_WITH_BACK else None,
        "shield_behind": f"shield_behind/{sv}/{body}" if sv in SHIELDS_WITH_BACK else None,
        "weapon_behind": f"weapon_behind/{wv}" if wv else None,
        "body": f"body/bodies/{body}",
        "head": f"head/heads/human/{body}",
        "eyes": "eyes/human/adult/default",
        "legs": None if legs == "none" else f"legs/{legs}/{'male' if legs == 'armour/plate' else body}",
        "torso": f"torso/{t}/{body}" if t and t != "none" else None,
        "sleeves": f"torso/{sl}/{body}" if sl else None,
        "feet": f"feet/shoes/basic/{thin}",
        "shoulders": f"shoulders/{sh_l}/{body if sh_l == 'legion' else thin}" if sh_l else None,
        "bracers": f"arms/{br}/{thin}" if br else None,
        "belt": f"waist/{bl}/{body}" if bl else None,
        "gloves": None,
        "cape": f"cape/{cp}" if cp else None,
        "shield": (f"shield/{sv}" if sv == "round" else f"shield/{sv}/{body}") if sv else None,
        "weapon": f"weapon/{wv}" if wv else None,
    }


def compose(armor=None, shield=None, weapon=None, body="male") -> Image.Image:
    out = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    paths = layer_paths(armor, shield, weapon, body)
    for layer in LAYER_ORDER:
        rel = paths.get(layer)
        if not rel:
            continue
        img = frame(LPC / rel / "walk.png")
        if img is None:
            continue
        color = None
        if layer in ("body", "head"):
            color = SKIN
        elif layer in ("legs", "torso", "sleeves", "shoulders", "bracers", "cape", "cape_behind"):
            color = armor.get("visualColor") if armor else None
        elif layer in ("shield", "shield_behind"):
            color = shield.get("visualColor") if shield else None
        elif layer in ("weapon", "weapon_behind"):
            color = weapon.get("visualColor") if weapon else None
        out.alpha_composite(tint(img, color) if color else img)
    return out


def grid(entries, cols, title, font):
    rows = (len(entries) + cols - 1) // cols
    pad = 22
    sheet = Image.new("RGBA", (cols * CELL, 30 + rows * (CELL + pad)), (28, 26, 32, 255))
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), title, fill=(235, 225, 200, 255), font=font)
    for i, (label, img) in enumerate(entries):
        cx = (i % cols) * CELL
        cy = 30 + (i // cols) * (CELL + pad)
        sheet.alpha_composite(img.resize((CELL, CELL), Image.NEAREST), (cx, cy))
        w = d.textlength(label, font=font)
        d.text((cx + (CELL - w) / 2, cy + CELL + 4), label,
               fill=(200, 195, 185, 255), font=font)
    return sheet


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scratch" / "gear_preview.png"
    try:
        font = ImageFont.truetype("arial.ttf", 11)
    except OSError:
        font = ImageFont.load_default()

    bases = ITEMS["bases"]
    plain = next(b for b in bases["armor"] if b["name"] == "Leather Armor")

    armors = [(a["name"], compose(armor=a)) for a in bases["armor"]]
    shields = [(s["name"], compose(armor=plain, shield=s)) for s in bases["shield"]]
    focus = ["Club", "Greatclub", "Shortsword", "Arming Sword", "Longsword",
             "Wooden Wand", "Wand", "Staff", "Cracked Staff", "Mace"]
    weapons = [(w["name"], compose(armor=plain, weapon=w))
               for w in bases["weapon"] if w["name"] in focus]

    parts = [grid(armors, 7, "ARMOUR", font),
             grid(shields, 7, "SHIELDS  (on Leather Armor)", font),
             grid(weapons, 7, "WEAPONS  (changed + reference)", font)]
    width = max(p.width for p in parts)
    sheet = Image.new("RGBA", (width, sum(p.height for p in parts)), (28, 26, 32, 255))
    y = 0
    for p in parts:
        sheet.alpha_composite(p, (0, y))
        y += p.height

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out_path)
    print("Wrote", out_path)


if __name__ == "__main__":
    main()
