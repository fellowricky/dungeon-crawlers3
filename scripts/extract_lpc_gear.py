"""Pull the armor/shield/weapon layers this game uses out of lpc_repo/spritesheets
and into public/lpc, in the flat `<layer-dir>/<action>.png` shape the sprite
animator expects.

Companion to scratch/extract_assets.js, which handles the body/hair/helmet set.
This one covers the gear-differentiation pass: capes, the trench coat, extra
sleeve and pant variants, one sprite per shield type, and the club/wand weapons.

    python scripts/extract_lpc_gear.py

Idempotent — safe to re-run.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "lpc_repo" / "spritesheets"
DST = ROOT / "public" / "lpc"

ACTIONS = ["walk", "slash", "thrust", "spellcast", "shoot", "hurt"]

# Some LPC sheets live in a per-colour subdirectory instead of a bare
# `<action>.png`. These are the palette entries we prefer, in order.
COLOR_PREFERENCE = ["steel.png", "gray.png", "grey.png", "teal.png", "white.png",
                    "brown.png", "black.png", "blue.png", "red.png"]

# `slash`/`thrust` are sometimes filed under the generator's attack_* names.
ACTION_ALIASES = {
    "slash": ["slash", "attack_slash"],
    "thrust": ["thrust", "attack_thrust"],
}

_missing: list[str] = []


def find_sheet(src_dir: Path, action: str) -> Path | None:
    """Resolve one action's PNG inside an LPC layer directory.

    Handles the three shapes in the repo: `<action>.png`, `<action>/<colour>.png`,
    and `<action>/<variant>.png` (weapons, where the variant is named after the
    item rather than a palette)."""
    for name in ACTION_ALIASES.get(action, [action]):
        direct = src_dir / f"{name}.png"
        if direct.is_file():
            return direct
        sub = src_dir / name
        if sub.is_dir():
            for pref in COLOR_PREFERENCE:
                cand = sub / pref
                if cand.is_file():
                    return cand
            pngs = sorted(p for p in sub.iterdir() if p.suffix == ".png")
            if pngs:
                return pngs[0]
    return None


def copy_palette_layer(src_rel: str, dst_rel: str, palette: str) -> None:
    """Copy one specific colourway of a layer that ships as `<action>/<colour>.png`.

    Armour with no visualColor leaves its legs untinted, so those bases need a
    pant sheet whose native palette already matches the armour."""
    src_dir = SRC / src_rel
    if not src_dir.is_dir():
        _missing.append(src_rel)
        return
    dst_dir = DST / dst_rel
    dst_dir.mkdir(parents=True, exist_ok=True)
    for action in ACTIONS:
        for name in ACTION_ALIASES.get(action, [action]):
            cand = src_dir / name / f"{palette}.png"
            if cand.is_file():
                shutil.copyfile(cand, dst_dir / f"{action}.png")
                break


def copy_layer(src_rel: str, dst_rel: str, overlays: list[str] = ()) -> None:
    """Copy every action sheet from one source dir to a destination layer dir.

    `overlays` are extra source dirs composited on top frame-for-frame — LPC
    splits some shields into base/paint/trim sheets that must be flattened."""
    src_dir = SRC / src_rel
    if not src_dir.is_dir():
        _missing.append(src_rel)
        return
    dst_dir = DST / dst_rel
    dst_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for action in ACTIONS:
        base = find_sheet(src_dir, action)
        if base is None:
            continue
        dst_file = dst_dir / f"{action}.png"
        extra = [find_sheet(SRC / o, action) for o in overlays]
        extra = [e for e in extra if e is not None]
        if not extra:
            shutil.copyfile(base, dst_file)
        else:
            img = Image.open(base).convert("RGBA")
            for e in extra:
                over = Image.open(e).convert("RGBA")
                if over.size != img.size:
                    continue  # mismatched variant sheet — skip rather than smear
                img = Image.alpha_composite(img, over)
            img.save(dst_file)
        copied += 1
    if copied == 0:
        _missing.append(src_rel)


def reverse_columns(img: Image.Image, rows: int) -> Image.Image:
    """Mirror the frame order within each row of an attack sheet.

    Upstream files a couple of weapons (the club) under the generator's
    `slash_reverse_*` animation: the frames sit in the normal grid but are meant
    to play last-to-first, so the swing is a backhand. Our animator only plays
    forwards, so bake the reversal into the sheet."""
    fs = img.height // rows
    cols = img.width // fs
    out = Image.new("RGBA", img.size)
    for r in range(rows):
        for c in range(cols):
            frame = img.crop((c * fs, r * fs, (c + 1) * fs, (r + 1) * fs))
            out.paste(frame, ((cols - 1 - c) * fs, r * fs))
    return out


def hold_pose(src_rel: str, dst_rel: str, variant_action: str = "slash",
              reverse: bool = False) -> None:
    """Build a full action set for a weapon that only ships an attack sheet.

    Crops column 0 of the attack sheet — the ready pose, already offset per
    facing — into a single-column sheet. blitLayer repeats the last available
    column, so a 1-wide sheet reads as "weapon held still" for walk/thrust/etc.
    `hurt` is a single-row animation, so it gets the south-facing pose only."""
    src_dir = SRC / src_rel
    sheet = find_sheet(src_dir, variant_action)
    if sheet is None and src_dir.is_dir():
        # Single-animation weapons (club) file the sheet at the directory root,
        # named after the variant rather than the action.
        pngs = sorted(p for p in src_dir.iterdir() if p.suffix == ".png")
        sheet = pngs[0] if pngs else None
    if sheet is None:
        _missing.append(src_rel)
        return
    dst_dir = DST / dst_rel
    dst_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(sheet).convert("RGBA")
    if reverse:
        img = reverse_columns(img, 4)
    fs = img.height // 4  # attack sheets are 4 rows (n, w, s, e)

    img.save(dst_dir / "slash.png")

    col0 = img.crop((0, 0, fs, fs * 4))
    for action in ["walk", "thrust", "spellcast", "shoot"]:
        col0.save(dst_dir / f"{action}.png")

    # hurt is rows=1 and always faces the camera -> south row (index 2)
    img.crop((0, fs * 2, fs, fs * 3)).save(dst_dir / "hurt.png")


def main() -> None:
    # ---- capes (foreground over the body, background behind it) ----------
    for cape in ["solid", "tattered"]:
        copy_layer(f"cape/{cape}/fg", f"cape/{cape}")
        copy_layer(f"cape/{cape}/bg", f"cape_behind/{cape}")
    copy_layer("cape/trim", "cape/trim")  # trim ships foreground-only

    # ---- torso: trench coat for padded armour ----------------------------
    # Only a male sheet exists upstream; reuse it for both body types.
    copy_layer("torso/jacket/trench/male", "torso/jacket/trench/male")
    copy_layer("torso/jacket/trench/male", "torso/jacket/trench/female")

    # ---- sleeve variants for robes ---------------------------------------
    for sleeve in ["longsleeves", "longsleeves_cuffed", "laced", "scoop",
                   "longsleeve2_cardigan"]:
        for body in ["male", "female"]:
            src = f"torso/clothes/longsleeve/{sleeve}/{body}"
            fallback = f"torso/clothes/longsleeve/{sleeve}/male"
            src_dir = SRC / src
            copy_layer(src if src_dir.is_dir() else fallback,
                       f"torso/clothes/longsleeve/{sleeve}/{body}")

    # ---- pant variants so every armour can carry matching legs -----------
    # `pants` is already extracted; these give heavier/lighter themes.
    for pant in ["pants2", "cuffed", "hose", "leggings", "fur"]:
        copy_layer(f"legs/{pant}/male", f"legs/{pant}/male")
        copy_layer(f"legs/{pant}/thin", f"legs/{pant}/female")

    # Themed colourways for armour that carries no visualColor of its own —
    # without these the legs render in whatever palette happened to be copied.
    for palette in ["leather", "charcoal", "slate", "walnut", "tan", "black"]:
        copy_palette_layer("legs/pants/male", f"legs/pants_{palette}/male", palette)
        copy_palette_layer("legs/pants/female", f"legs/pants_{palette}/female", palette)

    # ---- belts -----------------------------------------------------------
    # Belts render untinted (they are not in the armour tint slot), so pull the
    # leather colourway rather than whatever palette sorts first.
    for belt, palette in [("belt_leather", "leather"), ("belt_double", "leather"),
                          ("belt_loose", "leather"), ("belt_robe", "white"),
                          ("sash", "leather")]:
        for body in ["male", "female"]:
            copy_palette_layer(f"torso/waist/{belt}/{body}",
                               f"waist/{belt}/{body}", palette)
    # buckles is metal (and ships female-only); belt_mage is unisex flat sheets.
    for body in ["male", "female"]:
        copy_palette_layer("torso/waist/buckles/female", f"waist/buckles/{body}", "iron")
        copy_layer("torso/waist/belt_mage", f"waist/belt_mage/{body}")

    # ---- arms: full plate arms for the heavy bases ------------------------
    copy_layer("arms/armour/plate/male", "arms/armour/plate/male")
    copy_layer("arms/armour/plate/thin", "arms/armour/plate/thin")

    # ---- shields: one distinct sprite per shield base --------------------
    # kite / heater / round / crusader are already extracted by the older
    # script; these fill out the rest so no two bases share a sprite.
    for body in ["male", "female"]:
        copy_layer(f"shield/crusader2/{body}/fg", f"shield/crusader2/{body}")
        copy_layer(f"shield/scutum/paint/fg/{body}",
                   f"shield/scutum/{body}", overlays=[f"shield/scutum/trim/fg/{body}"])
        copy_layer(f"shield/two_engrailed/fg/{body}",
                   f"shield/two_engrailed/{body}",
                   overlays=[f"shield/two_engrailed/paint/fg/{body}"])
        copy_layer(f"shield/plus/fg/{body}", f"shield/plus/{body}")
        # spartan ships unisex
        copy_layer("shield/spartan/fg", f"shield/spartan/{body}")

        copy_layer("shield/scutum/paint/bg", f"shield_behind/scutum/{body}",
                   overlays=["shield/scutum/trim/bg"])
        copy_layer("shield/two_engrailed/bg", f"shield_behind/two_engrailed/{body}",
                   overlays=["shield/two_engrailed/paint/bg"])
        copy_layer("shield/plus/bg", f"shield_behind/plus/{body}")
        copy_layer("shield/spartan/bg", f"shield_behind/spartan/{body}")

    # ---- weapons ---------------------------------------------------------
    # Club and wand only ship an attack sheet upstream, so the rest of the
    # action set is synthesised from their ready pose.
    hold_pose("weapon/blunt/club", "weapon/blunt/club", reverse=True)
    hold_pose("weapon/blunt/club/background", "weapon_behind/blunt/club", reverse=True)
    hold_pose("weapon/magic/wand/male", "weapon/magic/truewand")
    hold_pose("weapon/magic/wand/male", "weapon_behind/magic/truewand")

    if _missing:
        print("Skipped (no source found):")
        for m in sorted(set(_missing)):
            print("  ", m)
    print("Done.")


if __name__ == "__main__":
    main()
