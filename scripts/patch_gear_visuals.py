"""One-shot patch of src/game/items.json for the armour/gear visual pass.

Gives every armour base themed legs plus its differentiating layer (shoulders,
bracers, cape), points each shield base at its own sprite, and swaps the weapon
sprites that were sharing art. Re-runnable — it sets values rather than nudging
them.

    python scripts/patch_gear_visuals.py
"""
from __future__ import annotations

import json
from pathlib import Path

ITEMS = Path(__file__).resolve().parent.parent / "src" / "game" / "items.json"

# name -> fields to set. `None` clears a field.
# Every base gets themed legs plus at least one differentiating layer on top
# (belt / shoulders / bracers / cape), so no two armour types read the same.
# Belts render untinted, so they stay leather-or-iron against the torso colour.
ARMOR = {
    # --- cloth ---------------------------------------------------------
    "Torn Robe":        {"visualLegs": "hose",            "visualColor": "#7c6858",
                         "visualBelt": "sash"},
    "Peasant Shirt":    {"visualLegs": "pants_walnut",    "visualBelt": "belt_loose"},
    "Tabard":           {"visualLegs": "pants_walnut",    "visualBelt": "belt_double"},
    "Robe":             {"visualLegs": "hose",            "visualColor": "#3a66b2",
                         "visualBelt": "belt_mage"},
    "Sleeveless Tunic": {"visualLegs": "pants2",          "visualBelt": "belt_leather"},
    # --- light ---------------------------------------------------------
    "Padded Armor":     {"visualTorso": "jacket/trench",  "visualColor": "#3a3a3a",
                         "visualLegs": "pants_charcoal",  "visualBelt": "belt_double"},
    "Leather Armor":    {"visualLegs": "pants_leather",   "visualBracers": "bracers",
                         "visualBelt": "belt_leather"},
    "Studded Leather":  {"visualLegs": "cuffed",          "visualBracers": "bracers",
                         "visualBelt": "belt_double"},
    "Leather Vest":     {"visualLegs": "pants2",          "visualBracers": "bracers",
                         "visualBelt": "belt_leather"},
    # --- medium --------------------------------------------------------
    "Hide Armor":       {"visualLegs": "fur",             "visualBracers": "bracers",
                         "visualBelt": "sash"},
    "Chain Shirt":      {"visualLegs": "pants_charcoal",  "visualBelt": "belt_leather"},
    "Scale Mail":       {"visualLegs": "pants_charcoal",  "visualShoulders": "bauldron",
                         "visualBelt": "belt_leather"},
    "Breastplate":      {"visualLegs": "pants_slate",     "visualBracers": "armour/plate",
                         "visualBelt": "buckles"},
    "Half Plate":       {"visualLegs": "armour/plate",    "visualBracers": "armour/plate",
                         "visualShoulders": "epaulets"},
    "Legion Armor":     {"visualLegs": "pants_tan",       "visualShoulders": "legion",
                         "visualBelt": "belt_leather"},
    "Dragonscale Mail": {"visualLegs": "pants_black",     "visualShoulders": "pauldrons",
                         "visualCape": "solid",           "visualBelt": "buckles"},
    # --- heavy ---------------------------------------------------------
    "Ring Mail":        {"visualLegs": "pants_charcoal",  "visualShoulders": "pauldrons",
                         "visualBelt": "belt_double"},
    "Chain Mail":       {"visualLegs": "pants_charcoal",  "visualShoulders": "epaulets",
                         "visualBelt": "belt_double"},
    "Splint Armor":     {"visualLegs": "armour/plate",    "visualShoulders": "pauldrons",
                         "visualBracers": "armour/plate"},
    "Plate Armor":      {"visualLegs": "armour/plate",    "visualBracers": "armour/plate"},
}

# One sprite per shield base — previously three bases shared `round` and two
# shared `heater`.
SHIELD = {
    "Buckler":         "round",
    "Spiked Buckler":  "plus",
    "Dwarven Buckler": "two_engrailed",
    "Round Shield":    "spartan",
    "Kite Shield":     "kite",
    "Heater Shield":   "heater",
    "Tower Shield":    "scutum",
}

WEAPON = {
    # Shortsword was drawing the full longsword sprite.
    "Shortsword":   {"visualWeapon": "sword/arming"},
    # Clubs were drawing a mace.
    "Club":         {"visualWeapon": "blunt/club", "visualColor": "#7a5c33"},
    "Greatclub":    {"visualWeapon": "blunt/club", "visualColor": "#42301a"},
    # `magic/wand` is actually the simple staff sheet; `magic/truewand` is the
    # real hand wand. Staves keep the staff art, wands get the wand.
    "Wooden Wand":  {"visualWeapon": "magic/truewand", "visualColor": "#8b6b3a"},
    "Wand":         {"visualWeapon": "magic/truewand"},
    "Staff":        {"visualWeapon": "magic/simple"},
    "Cracked Staff": {"visualWeapon": "magic/gnarled"},
}


def apply(bases: list[dict], patches: dict[str, dict], label: str) -> None:
    seen = set()
    for base in bases:
        patch = patches.get(base.get("name"))
        if not patch:
            continue
        seen.add(base["name"])
        for key, value in patch.items():
            if value is None:
                base.pop(key, None)
            else:
                base[key] = value
    missing = set(patches) - seen
    if missing:
        raise SystemExit(f"{label}: no base named {sorted(missing)}")


def main() -> None:
    data = json.loads(ITEMS.read_text(encoding="utf-8"))
    apply(data["bases"]["armor"], ARMOR, "armor")
    apply(data["bases"]["weapon"], WEAPON, "weapon")

    seen = set()
    for base in data["bases"]["shield"]:
        if base["name"] in SHIELD:
            base["visualShield"] = SHIELD[base["name"]]
            seen.add(base["name"])
    missing = set(SHIELD) - seen
    if missing:
        raise SystemExit(f"shield: no base named {sorted(missing)}")

    ITEMS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                     encoding="utf-8")
    print(f"Patched {len(ARMOR)} armour, {len(SHIELD)} shield, {len(WEAPON)} weapon bases.")


if __name__ == "__main__":
    main()
