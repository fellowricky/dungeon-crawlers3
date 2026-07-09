# Dungeon Crawlers

Idle party-based dungeon crawler (Clickpocalypse-inspired) using SRD 5.1 mechanics, built on **Dungeon Forge** by Majid Manzarpour (MIT).

Watch your party explore procedural Three.js dungeons, fight themed monsters, loot gear, and descend floor after floor.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build
npm run preview    # production build on :4173
```

Requires Node 18+.

## Project map

```
src/
  main.js              # Dungeon Forge: procgen + Three.js render
  game/                # Game systems (see game/README.md)
    game.js            # Orchestrator (boot, load, tick)
    pathfinding.js     # Paths & movement
    fog.js             # Fog of war
    combat.js          # Fights & abilities
    explore.js         # Party AI & interactables
    inventory.js       # Gear, potions, saves
    srd.js / items.js  # Rules & loot
    skills.js          # Skill challenges
    ...
  ui/                  # CSS
public/                # Runtime assets (LPC, DCSS sprites)
```

## Play loop (dev)

1. Pick or continue a party on the setup screen.
2. Party auto-explores; click the map to redirect them.
3. Use potions from the HUD; open menus for gear/skills.
4. Clear the boss → merchant camp → next floor.

## Credits / licenses

- **Dungeon Forge** — Majid Manzarpour (MIT) — procedural dungeon core
- **SRD 5.1** — Wizards of the Coast (CC-BY-4.0) — mechanics reference
- **LPC** (Liberated Pixel Cup) — layered character sprites (see `lpc_repo` / credits)
- **DCSS** tiles — monster/item/effect icons (see asset licenses in upstream sources)

Game code in this repo: MIT (see `LICENSE`).
