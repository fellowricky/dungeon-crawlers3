# World Map — Improvement Plan

Status: **proposal, nothing built yet.** Written 2026-10-26 for Zenu to review.
Each section ends with the decisions that are Zenu's to make. The Suggestions
section at the end is separate, so each item there can be accepted or rejected on its own.

Order of work (details in §6): **fix marker drift first** (small, independent),
then the region data, then the guild hub, then distance → overland legs.

---

## 0. How the world map works today (short version)

| Piece | Where | What it does |
|---|---|---|
| Markup | [index.html:290-294](../index.html:290) | `.wm-map-container` holds `<img id="wm-map-bg" src="./world_map.jpg">` and an empty `#wm-quest-nodes` div |
| Art | `public/world_map.jpg` | **1024 × 1024**, square |
| Offers | [worldmap.js:206-224](../src/game/worldmap.js:206) | 6 quests per visit with a level-band contract (1 below / 4 at / 1 above), up to 2 chain sequels first |
| Generator | [quests.js:320-401](../src/game/quests.js:320) | theme from a shuffled pool of the 5 dungeon themes (`:322`, `:331`), position from 8 fixed `MAP_POSITIONS` (`:105-114`, `:325-332`), floors `3 + rand*8` (`:347`) |
| Pins | [worldmap.js:338-363](../src/game/worldmap.js:338) | each quest becomes a `.quest-node` with `left:x%; top:y%` |
| Overland prologue | [overland_prologue.js](../src/game/overland_prologue.js) | the first 1–2 of `q.floors` are overland: an **approach** biome picked by seed from `APPROACH_POOLS[q.theme]` (`:42-48`, `:89-93`), then a **threshold** biome fixed per dungeon theme (`:51-57`). Derived on the fly, nothing stored on the quest (`:10-13`) |
| Floor load | [game.js:608-629](../src/game/game.js:608) | `q.floorPlan` (story) or `autoProloguePlan(q, floor)` decides overland vs dungeon. Overland floors go through `engine.reforgeOverland` at `overlandSpawnLevel(q.level)` (half strength) |
| Save | [inventory.js:413](../src/game/inventory.js:413), [game.js:370](../src/game/game.js:370) | `activeQuest` is saved whole. The **offer board is not saved**: it rerolls on every `showWorldMap({refresh:true})` |

Location has **no gameplay meaning** today: the pin position is cosmetic, the
theme is picked independently of it, and the overland country you cross is
picked from the theme, not from the map.

---

## 1. Marker drift (item 4): root cause and fix

### Root cause

Two different coordinate frames are mixed:

1. **The art** is scaled with `object-fit: cover`, filling the whole container:
   [game.css:2072-2075](../src/ui/game.css:2072)
   (`#wm-map-bg { width:100%; height:100%; object-fit:cover; }`). The image is
   square, the container almost never is, so `cover` scales the art up until the
   *longer* side fits and **crops the overflow on the shorter side, centred**.
2. **The pins** are positioned in percent of the **container**, not the image.
   `#wm-quest-nodes` has no CSS rule at all, so it is a static, zero-height div.
   The absolutely positioned `.quest-node`s ([game.css:2118-2121](../src/ui/game.css:2118))
   therefore resolve `left:x%; top:y%` ([worldmap.js:349](../src/game/worldmap.js:349))
   against the nearest positioned ancestor, `.wm-map-container` (`position:relative`,
   [game.css:2068-2071](../src/ui/game.css:2068)).

So a pin at `y: 18%` is at 18% of the container height, while the art under it
has been shifted by the crop. How far it shifts depends on the container's aspect ratio:

| Window | Map container (approx.) | Art rendered | Cropped | Pin `y:18%` lands on art at |
|---|---|---|---|---|
| 1920×1080 | 1540 × 1010 | 1540 × 1540 | 265 px top + bottom | **29%** |
| 1280×720 | 900 × 650 | 900 × 900 | 125 px top + bottom | **27%** |
| 800×1000 (≤900 px layout, [game.css:2165](../src/ui/game.css:2165)) | 800 × 710 | 800 × 800 | 45 px top + bottom | **21%** |
| Portrait / very narrow | taller than wide | width cropped instead | left + right | x drifts instead of y |

Pins drift toward the centre of the art on the cropped axis, and the amount changes
with the window shape. That matches what Zenu sees. It also matters for item 3:
**at 16:9 roughly the top and bottom 17% of the art are not visible at all**
(the northern snow range and the southern jungle), so regions there would have no visible art.

### Fix: one map-space stage

Put the art, the pins, and any future overlays (route line, guild hub, region
debug view) inside **one square stage whose size is the art's size**, so 0–100%
always means 0–100% of the art.

```html
<div class="wm-map-container" id="wm-map-container">
  <div class="wm-map-stage" id="wm-map-stage">
    <img id="wm-map-bg" src="./world_map.jpg" alt="World Map" />
    <svg id="wm-route-layer" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
    <div id="wm-quest-nodes"></div>
  </div>
</div>
```

```css
.wm-map-container { container-type: size; display: flex;
                    align-items: center; justify-content: center; }
.wm-map-stage     { position: relative; aspect-ratio: 1 / 1;          /* = art */
                    width: min(100cqw, 100cqh); }
#wm-map-bg        { position: absolute; inset: 0; width: 100%; height: 100%;
                    object-fit: fill; }                                 /* no crop */
#wm-quest-nodes,
#wm-route-layer   { position: absolute; inset: 0; }
```

- Container query units (`cqw`/`cqh`) fit the stage inside the container at any
  size without JS. Electron 33 (Chromium 130) and every current browser on
  itch support them. Fallback if ever needed: a `ResizeObserver` that sets the
  stage's width/height to `min(container w, h)`.
- The art is **contained**, not cropped, so there are empty bands beside it on
  wide windows. Fill them with a blurred, darkened copy of the map
  (`.wm-map-container::before` with the same image at `background-size: cover`
  and `filter: blur(…) brightness(.35)`). It reads as part of the map, not as black bars.
- Move the pixel-grid wash ([game.css:3448-3454](../src/ui/game.css:3448)) from
  the container to the stage, so the wash only covers the art.
- Pin markup in `renderNodes` stays the same. It only moves into the stage.
- If the art is ever replaced with a non-square image, set `aspect-ratio` from a
  `--map-aspect` variable (the region data in §2 stores the art's width and height).

**Why not keep `cover` and correct the pins in JS?** It can be done (compute the
cover scale and offset, transform the pin layer to match), but quests would
still sit in the cropped-off parts of the art on some window shapes, which then
needs clamping or panning. Contain is simpler and shows the whole map. If Zenu
wants the map larger on small windows, pan and zoom (Suggestion S6) works
inside the stage without bringing the drift back.

**Files:** `index.html`, `src/ui/game.css` (base block `:2068-2075`, restyle block `:3439-3454`,
media query `:2165-2170`), `src/game/worldmap.js` (no logic change; the fallback
grid at `:344` stays).

**Verify:**
- Headless: a vitest DOM test cannot check layout, so add a small check to
  `electron/smoke.cjs` that opens the map at 1920×1080, 1280×720 and 800×1000.
  At each size it compares a pin's `getBoundingClientRect()` centre with
  `stageRect.left + x% × stageRect.width` (tolerance 1 px).
- Zenu, in game: resize the window between wide, square and narrow, and confirm a
  pin stays on the same landmark.

**Open questions for Zenu**
- Letterbox fill: blurred map copy (recommended), parchment texture, or plain dark?

---

## 2. Map regions match overland styles (item 3)

### Today
- `q.theme` is always one of the 5 dungeon themes ([quests.js:16-21](../src/game/quests.js:16)).
  The 9 overland biomes are floor themes only ([dungeon_generator.js:414-599](../src/dungeon/dungeon_generator.js:414),
  each with an `accent` colour; families in [srd.js:993-1005](../src/game/srd.js:993)).
- The approach biome is a seeded pick from a per-theme pool; the threshold is fixed
  per theme ([overland_prologue.js:42-57](../src/game/overland_prologue.js:42)).
  Nothing ties either one to the map.
- All 9 overland biomes already have monster rosters across the CR range
  (counted from `monsters.json` `dungeons` whitelists: 118–150 entries each,
  top CR 13 (snowfield) to 21 (ashfield)). Since overland floors spawn at
  half strength, no biome runs out of monsters.

### Revised 2026-10-27: painted biome map (supersedes the text grid below)

**New art.** Zenu chose round 19 `zimg_desim` from `scratch/worldmap_campaign/`. It is a Z-Image refine of
`lc_orig_s0`, **3072 × 2048 (3:2)**, so the §1 stage uses `--map-aspect: 3 / 2`. The geography is all new, so
the region table further down no longer applies. Reading the new map from left to right: sea on the left edge
with one island, dark conifer forest across the top left, open grass and heath through the centre around one
settlement, mottled moor and scrub on the right, three modest ranges, lakes, and an ash-ringed volcano beside an
ochre desert in the lower right.

**Zenu wants to paint the areas by hand.** The data stays a grid, but authoring moves from typed characters to
a brush tool.

#### Data: `src/game/world_biomes.json`

```json
{
  "art":  { "src": "world_map.jpg", "w": 3072, "h": 2048 },
  "cols": 96, "rows": 64,
  "legend": { "F": "forest", "M": "moor", "X": "mire", "H": "holdfast", "B": "boneyard",
              "R": "ruinfield", "A": "ashfield", "S": "snowfield", "P": "sporewood",
              "~": "sea", "o": "lake", "^": "peaks" },
  "cells": [ "96 chars", "... 64 rows" ]
}
```

- **96 × 64 cells, each 32 × 32 art px.** That is fine enough to follow interleaved terrain, a river valley or a
  strip of forest edge, and still small enough to diff as text. `cols`/`rows` are data, so a resample
  script can change them later.
- One character per cell. The nine overland biomes are their THEMES keys. **Water and peaks are
  impassable**: `sea`, `lake`, `peaks` are never a travel leg and never a pin.
- The legend lives in the file, so adding a biome later needs no format change.

#### What a painted cell decides

| Painted as | Quest placement | Travel legs |
|---|---|---|
| a **threshold biome** (ruinfield, sporewood, snowfield, boneyard, ashfield) | a dungeon of the theme whose `THRESHOLD_THEME` is that biome can sit here, e.g. ashfield → molten. The doorstep floor already *is* that biome, so the pin's ground and the threshold floor match | the leg is that biome |
| forest, moor, mire, holdfast | no dungeons (approach country only) | the leg is that biome |
| sea, lake, peaks | never | skipped |

This replaces the per-region `dungeons` weights: **where a dungeon can be is wherever its doorstep biome is
painted.** It needs no separate region table to keep in sync, and the painter shows it directly. Weighting
then follows painted area: a large ashfield gets molten quests more often than a small one.
`cellsFor(theme)` returns the passable cells painted as `THRESHOLD_THEME[theme]`.

#### Painter: `world_map_editor.html` + `src/world_map_editor.js` (dev only, linked from `devhub.html`)

It follows the existing editor pattern: a Vite middleware endpoint writes JSON into the repo, as
`/api/save-loot-budget` and the others do.

- The art underneath, with the cell layer drawn over it in each biome's `accent` colour at adjustable
  opacity. There are toggles to hide the layer, show grid lines, and highlight one biome only.
- **Brushes:** round brush (size 1–8 cells), flood fill (fills connected cells of the same value), eyedropper
  (right-click), and rectangle. The palette lists the 12 legend entries with hotkeys 1–9, 0, -, =.
- **Undo/redo** (ctrl+Z / ctrl+Y, a stroke is one step). Hovering shows the cell coordinate, the art %, and
  the biome.
- **Coverage panel:** cell count per biome, plus a red warning for any dungeon theme whose doorstep biome
  covers fewer than `MIN_CELLS` (placement would starve).
- **Auto-draft** (one button, used once at the start): classifies each cell by its mean art colour against
  reference swatches you click on the art. That gives a rough first coat (sea, forest, desert, ash
  separate cleanly by colour), which you then correct by hand. Threshold biomes the art can't show by colour
  (boneyard, sporewood, snowfield) are always hand-painted.
- **Save** → `POST /api/save-world-biomes` → `src/game/world_biomes.json` (pretty-printed one row per line,
  so a diff shows which rows changed). It has a dev-server-only guard like the other endpoints.

#### Runtime: `src/game/world_regions.js` (pure, testable in node)

Imports the JSON statically, so the itch build bundles it and needs no fetch. The helpers are the same as in
the table below, plus:

| Function | Returns |
|---|---|
| `biomeAt(x, y)` | biome key at a map point (art %), `null` off-map |
| `isPassable(x, y)` | false for sea / lake / peaks |
| `cellsFor(theme)` | passable cells painted as that theme's threshold biome |
| `cellCentre(c, r)` / `cellAt(x, y)` | art % ↔ cell conversion |

`?regions=1` on the game shows the same overlay read-only on the world map, so painted data can be checked in
the real UI.

#### Built 2026-10-27

The painter, the save endpoint, `world_biomes.json`, `world_regions.js` and `test/world_regions.test.js`
all exist. The art is at `public/art/world_map_3072.jpg`. The in-game map still shows the old placeholder,
pending §1. The auto-draft is a script (`scratch/worldmap_campaign/paint_draft.py`), not an editor button:
it painted the first pass once, and Zenu touches it up in the painter.

Zenu's answers:
- Peaks are impassable for now.
- Sporewood is dotted into the forest.
- Snowfield skirts the mountains.
- I painted boneyard as two barrow fields in the moor (south centre and east).
- The guild hub question is still open.

**Later edition:** add real `sea` and `mountain` overland biomes, so coast and high-country travel legs
become possible.

#### Built 2026-10-27 (second pass): hub, distance, routes

This supersedes the straight-line §4 design.
- **Hub:** `world_regions.HUB` is the cell nearest the centroid of the largest painted holdfast patch.
  Repainting moves it. On the map it is a ⌂ "Guildhall" marker; clicking it opens the Guild tab.
- **Distance is travel time, not straight-line art %.** Each cell has a `TRAVEL_COST` by biome:
  holdfast roads 0.7, moor 1, forest 1.4, mire and snow 1.8, and so on. A Dijkstra from the hub gives every
  cell's time. **Days = ceil(time / day length), 1-4**, where the day length is set so the farthest reachable
  doorstep is exactly 4 days (`MAX_TRAVEL_DAYS`). Each day is one overland floor.
- **The route** is A* from the hub to the pin. Cell costs are bent by seeded smooth noise, so every quest
  walks its own road. It is stored on `q.route = { days, legs, path, camps }` and drawn on the map for the
  selected quest: one dashed stretch per day in that day's biome colour, with a camp dot at each day's end.
- **Which overland map each day uses:** the road is cut into `days` equal stretches of travel time, and
  each day is the biome the party spends the most time in. The last day is always the doorstep biome.
- **Floors:** `q.dungeonSize` is the old 3-10 roll, which still drives legendary odds, reward rarity,
  hardness and sequel growth (`questSize`). The dungeon gets `dungeonFloors = size - 2` (or 2 for size 3),
  so `q.floors = days + dungeonFloors` (3-12). Gold and XP still pay per floor, travel days included.
- **Longer, not deadlier:** `depthFloor(q, questFloor)` measures spawn, elite and boss depth as if the
  quest had the old prologue, so a far quest's boss equals a near one's of the same size.
- **Old saves:** in-flight quests without `route` keep the legacy prologue and depth. Old chain pins
  snap onto their theme's doorstep (`snapPin`).
- **Map UI:** §1 is done. Art, route, hub and pins share one 3:2 stage, contained with a blurred backdrop.

#### Decisions this raises (Zenu), original list

1. **Sporewood and snowfield have no visible terrain in this art.** There are no mushrooms (you dropped them)
   and no snow. Options: (a) paint pockets anyway, e.g. sporewood in the deepest forest and snowfield on the
   highest ridges; (b) change the threshold for verdant to `forest` and for frost to `peaks`-adjacent slopes;
   (c) touch up the art so a small snowy range and a pale grove exist. (a) costs nothing and keeps all five
   doorsteps.
2. **Boneyard** (grim's doorstep) is barrow plains, which the art only hints at among the moorland. Paint
   one or two patches there?
3. **Mountains:** impassable `peaks` for the ridge cores, with the slopes painted as whatever surrounds them
   (recommended)? Or are mountains walkable as moor or snowfield?
4. **Guild hub:** the obvious spot is the central settlement at the river crossing (about 47 %, 48 %). It
   should be painted `holdfast`.

---

### Original proposal: a region grid over the art (kept for reference, superseded above)

A new pure-data module, **`src/game/world_regions.js`** (no DOM, so it is testable in node):

```js
export const WORLD_ART = { src: 'world_map.jpg', w: 1024, h: 1024 };
export const GRID = 32;                       // 32×32 cells, one cell = 32 px of art
export const REGIONS = {                      // one char per region
  H: { name: 'Guildvale',     biome: 'holdfast',  dungeons: { ancient: 1, grim: 1 } },
  F: { name: 'Northern Weald',biome: 'forest',    dungeons: { verdant: 2, ancient: 1 } },
  ...
  '~': { name: 'Fog Sea',     impassable: true },
  '^': { name: 'High Peaks',  impassable: true },
};
export const REGION_ROWS = [                  // 32 strings of 32 chars, traced over the art
  '~~^^^^^^^FFFFFF^^^^^^^^^^^^^^^^^',
  ...
];
```

Why a text grid instead of polygons or a painted mask image:
- It can be edited as text, shows up in a git diff, and a node test can read it
  without decoding an image.
- 32 px cells are fine enough for this art, where the regions are large.
- A small script can draft it by sampling the art's colours per cell. Zenu or I
  then fix it by hand while looking at the debug overlay (below).

**Debug overlay (needed to author the grid, dev only):** `?regions=1` on the URL
makes `worldmap.js` draw the grid inside the stage as translucent cells tinted by
each biome's `accent`, with region names. This is how the grid gets checked
against the art.

Helpers in the same module:

| Function | Returns |
|---|---|
| `regionAt(x, y)` | region record for a map point (0–100 art %), `null` off-map |
| `cellsFor(theme)` | passable cells whose region lists that dungeon theme |
| `distanceFromHub(x, y)` | distance in art % (see §3) |
| `planRoute(from, to)` | ordered list of cells crossed (see §4) |

### First-pass region assignment (from the current art)

My reading of `world_map.jpg`. These are guesses, and the grid makes reassigning cheap.

| Region (working name) | Art (approx. art %) | Overland biome | Dungeon themes found here |
|---|---|---|---|
| **Guildvale** (hub) | green river lowland E of the volcano, ~x 52-72, y 52-70 | holdfast | ancient, grim |
| Northern Weald | NW/N woodland & hills, the great west forest, forests by the north lake | forest | verdant, ancient |
| Eastern Steppe | yellow-green grassland with the salt pan, x 55-92, y 33-58 | moor | grim, ancient |
| Southern Fens | swamp delta, x 25-60, y 78-92 | mire | grim, verdant |
| Deep Jungle | dense jungle along the south edge and up the SE river | sporewood | verdant |
| Sand Wastes | SW dunes & cracked earth, x 23-55, y 55-80 | ruinfield | ancient |
| Ember Spine | central volcanic range (lava at ~50, 48) | ashfield | molten |
| Scald Flats | SE badlands with orange pools + the red canyon | ashfield | molten |
| Frost Crown / NW Peaks | rim of both snow ranges | snowfield | frost |
| Grey Isles | western archipelago with the crater isles | boneyard | grim |
| Fog Sea | pale western sea | *impassable* | — |
| High Peaks | interior of the NE snow range | *impassable* | — |

Each dungeon theme has at least one home region: ancient (Guildvale, Weald,
Steppe, Wastes), verdant (Weald, Fens, Jungle), frost (Frost Crown), grim
(Guildvale, Steppe, Fens, Isles), molten (Ember Spine, Scald Flats).

### How quests get placed

The board keeps today's guarantees (variety of themes, level band contract),
but the location now follows the theme:

1. Pick each offer's dungeon theme as today (shuffled pool, [quests.js:322,331](../src/game/quests.js:322)).
2. Pick a cell from `cellsFor(theme)`, weighted by the region's `dungeons` weight,
   with a minimum spacing between pins (replaces `MAP_POSITIONS` + `excludePositions`,
   [quests.js:323-332](../src/game/quests.js:323)), and a jittered point inside the cell.
3. Soft spread rule: try to give the board at least one near, one mid and one far
   offer (distance bands from §3), so every board offers both a short trip and a long one.
4. Store `q.mapLocation` (art %, as today) and `q.region` (region key).

**Consequence to be aware of:** frost only lives in the snow ranges, which are
all far from any central hub, so **frost quests would always be long trips**,
and molten quests (Ember Spine, next to the hub) would often be short. That might be
good for flavour, but it is a balance change. See open questions.

**Files:** new `src/game/world_regions.js`; `src/game/quests.js`
(`generateQuests`, retire `MAP_POSITIONS`); `src/game/worldmap.js` (debug overlay).

**Verify (headless, new `test/world_regions.test.js`):**
- grid is exactly 32×32 and every char is a key of `REGIONS`;
- every non-impassable region's `biome` is a THEMES key with `overland: true`;
- every dungeon theme has ≥ N passable cells (so placement can't starve);
- 1 000 generated boards: every pin is on a passable cell whose region lists `q.theme`;
  pin spacing ≥ minimum; ≥ 4 distinct themes per 6-offer board (today's guarantee).

**Open questions for Zenu**
- Do the region assignments in the table match how you read the art? In particular the desert
  as **ruinfield**, the isles as **boneyard**, and two separate **ashfield** regions.
- Is "frost is always far" OK, or should a small frost pocket sit closer (e.g. the NW peaks rim)?
- Region names are placeholders. Do you want lore names?

---

## 3. Central guild hub (item 1)

### Today
The guild is only a tab ([index.html:279](../index.html:279), `renderGuildPanel` at
[worldmap.js:807](../src/game/worldmap.js:807)) with a 3D compound
([guild_layout.js](../src/game/guild_layout.js)). It has no place on the world map,
and nothing measures distance from it.

### Proposed design
- `GUILD_HUB = { x: 58, y: 58, region: 'H', name: 'The Guildhall' }` in
  `world_regions.js`. Proposed spot: the green river fork just east of the volcanic
  spine. It is close to the art's centre and on land, and Guildvale is settled
  holdfast country, which fits what that biome is for ([dungeon_generator.js:474+](../src/dungeon/dungeon_generator.js:474),
  "settled, worked ground").
- Rendered inside the stage (§1) as a distinct marker (keep or banner icon, bigger
  than quest pins, always labelled, no pulse). Clicking it switches to the Guild tab.
- **Distance** = straight-line distance from the hub in art %, `√(dx² + dy²)`.
  From (58, 58), the farthest playable corners are about 50–65 away.
- The hub never moves at runtime (no save data). If the art changes, only the
  constant changes.

**Art needed:** a pixel-art hub icon (pixel-art-assets-generator skill, grimdark
palette per the art bible). Use a CSS placeholder until it exists.

**Files:** `world_regions.js`, `worldmap.js` (render hub in stage, click → guild tab),
`index.html`/`game.css` (hub marker styles).

**Verify:** headless check that the hub cell is passable and in region `H`; Zenu checks
in game that the hub sits on the art spot they want.

**Open questions for Zenu**
- Where exactly should the guild sit? Is (58, 58) right, or would you rather
  paint a settlement into the art at a spot you pick?
- Should the guild's facility level show on the hub marker (e.g. icon tier from
  `guild_layout.js` `INFRA_TIERS`)? Listed as Suggestion S9.

---

## 4. Distance sets the overland count (item 2)

### Today
- `q.floors` (3–10) **includes** the prologue: `prologueLength` is 2 when
  `floors ≥ 4`, 1 when `floors = 3` ([overland_prologue.js:80-86](../src/game/overland_prologue.js:80)).
  Distance plays no part.
- Rewards scale linearly with `q.floors` ([quests.js:353-354](../src/game/quests.js:353)),
  so the prologue is paid like dungeon floors.
- Two depth formulas use the **absolute** quest floor:
  room count ([game.js:570-576](../src/game/game.js:570)), and
  elite-pack and final-boss target CR ([game.js:937](../src/game/game.js:937),
  [game.js:965](../src/game/game.js:965): `level + (questFloor-1) × 0.5`).
  **Adding overland floors in front of the dungeon would raise the final boss's
  CR** by 0.5 dungeon level per extra leg unless that is changed.

### Proposed shape of a quest

```
[ travel leg ] × 0–3   →   [ threshold ]   →   [ dungeon floor ] × 2–8   (last one = boss)
  biome from the map        doorstep biome      unchanged
```

| Distance from hub (art %) | Travel legs | Overland floors (travel + threshold) |
|---|---|---|
| < 18 | 0 | 1 |
| 18 – 34 | 1 | 2 (= today's usual) |
| 34 – 50 | 2 | 3 |
| ≥ 50 | 3 | 4 |

The thresholds are constants in `world_regions.js`, so they can be tuned later.
The threshold floor stays: it is the doorstep that has to sell the dungeon
below (the rule from the prologue plan), and it stays `THRESHOLD_THEME[q.theme]`.

**Floor count:** roll dungeon depth on its own, `dungeonFloors = 2 + rand(0..6)`
(2–8, the same dungeon depth as today), then `q.floors = overlandFloors + dungeonFloors`,
giving 3–12. Store `q.overlandFloors` and `q.dungeonFloors` alongside it.
The alternative is to keep the 10-floor total and take the overland floors out of it,
but then far quests would get shallower dungeons, which works against "farther = bigger trip".

### Which biome each travel leg uses

`planRoute(hub, pin)`:
1. Walk the straight line from hub to pin across the 32×32 grid (Bresenham),
   collecting cells. Impassable cells are skipped (they don't count toward any leg).
2. Drop the cells of the destination's own region at the end of the line. The
   threshold floor already stands for that region.
3. Split the remaining cells into `travelLegs` equal-length segments. Each leg's
   biome is the **most common biome in its segment**, with ties broken toward
   the segment's midpoint cell.
4. If the line crosses only the hub region (e.g. a near quest just across the
   river), every leg is holdfast. That is honest: you are walking out through home country.

Result, stored on the quest at generation:

```js
q.route = [
  { biome: 'holdfast',  kind: 'travel',    region: 'H' },
  { biome: 'moor',      kind: 'travel',    region: 'S' },
  { biome: 'ruinfield', kind: 'threshold', region: 'W' }
];
```

A **routed path (A\*)** around the Fog Sea and High Peaks would look nicer on the map
line and be more geographically honest. It is Suggestion S5. The straight line is enough for v1
and has no edge cases with unreachable cells.

### How it plugs into the existing flow

| Step | Change |
|---|---|
| `generateQuests` ([quests.js:320](../src/game/quests.js:320)) | after placement (§2): `travelLegs` from distance → `q.route` → `q.overlandFloors`, `q.dungeonFloors`, `q.floors`; then rewards and `decorateQuest` as today |
| `generateSequelQuest` ([quests.js:408](../src/game/quests.js:408)) | same route computation from the pinned `entry.mapLocation`. Old chain entries carry old `MAP_POSITIONS` coordinates, so snap them to the nearest passable cell that allows `entry.theme`. `floors` cap (`:414`) applies to `dungeonFloors` |
| `prologueLength(q)` ([overland_prologue.js:80](../src/game/overland_prologue.js:80)) | `q.route ? q.route.length : <legacy rule>` |
| `autoProloguePlan(q, floor)` ([:99](../src/game/overland_prologue.js:99)) | `q.route ? q.route[floor-1] : <legacy approach/threshold>`. Map size/zones logic (`:117-122`) unchanged; label tables gain entries for every biome used as a travel leg (e.g. "Crossing the Ashfields") |
| `prologueSummary` ([:135](../src/game/overland_prologue.js:135)) | "3 overland floors → 6 below", and the sidebar lists the route: *Guildvale → Eastern Steppe → The Fallen Stones* |
| `_loadFloor` ([game.js:608-629](../src/game/game.js:608)) | **no change**. It already calls `autoProloguePlan` and forges whatever biome comes back |
| Boss / elite depth ([game.js:937](../src/game/game.js:937), [:965](../src/game/game.js:965)), room count ([:574](../src/game/game.js:574)) | use a `depthFloor(q, questFloor)` helper that ignores travel legs beyond today's prologue, so a far quest is **longer, not deadlier** (unless Zenu wants deadlier; see questions) |
| `rollPhases` ([quests.js:156-163](../src/game/quests.js:156)) | unchanged: phases may land on travel legs (an ambush on the road is good, as the prologue plan already decided) |
| Legendary rule ([quests.js:136-141](../src/game/quests.js:136), `floors >= 10`) | must be redefined (see questions). Recommended: `dungeonFloors >= 8`, which is exactly today's "10-floor quest" dungeon depth |
| World map UI | when a quest is selected, draw the route in `#wm-route-layer` (hub → pin polyline, one dot per leg tinted with that biome's `accent`) |

### Save data and old saves
- New fields on the quest object: `region`, `route`, `overlandFloors`, `dungeonFloors`.
  They save with `activeQuest` as they are ([inventory.js:413](../src/game/inventory.js:413)), and
  the route is a few short strings.
- **An in-flight quest from an old save has no `route`** and keeps the legacy
  prologue logic via the fallbacks above. This is why the legacy code paths and
  `test/overland_path.test.js` stay as they are.
- Story missions (own `floorPlan`) and dev test delves (`skipPrologue`,
  [test_dungeon.js:562-563](../src/game/test_dungeon.js:562)) are untouched.
- The offer board is not saved, so no migration is needed there.

### Balance notes (each extra leg)
- +1 floor of `rewardGold`/`rewardXp` (paid at the full per-floor rate, as the prologue is today).
- +1 floor-clear long rest and merchant camp ([game.js:2960-2979](../src/game/game.js:2960)).
  Far quests rest more often. Under "everything has a cost", the cost is time
  plus the risk of a whole extra fight-filled floor, and overland floors drop
  less loot than dungeon floors (noted in OVERLAND_PROLOGUE_PLAN §4).
- Worth one pass through `sim/` / `gold_balancer.html` once built.

**Files:** `world_regions.js`, `quests.js`, `overland_prologue.js`, `game.js`
(depth helper only), `worldmap.js` (route line + sidebar text), `quest_events.js`
(`normalizeQuest` defaults for the new fields).

**Verify (headless):**
- `test/world_regions.test.js`: `planRoute` is deterministic, never yields an
  impassable biome, and leg count matches the distance band for hand-picked points
  (one per band); `regionAt(GUILD_HUB)` is `H`.
- `test/quests.test.js`: for generated quests, `floors === overlandFloors + dungeonFloors`,
  `route.length === overlandFloors`, last route entry is `THRESHOLD_THEME[theme]`,
  `dungeonFloors ≥ 2`, final floor is a dungeon.
- `test/overland_path.test.js`: existing legacy cases unchanged; new case: a quest with
  `route` returns `route[floor-1]` from `autoProloguePlan`.
- A test that the boss target CR for a 4-overland quest equals the 2-overland one
  with the same dungeon depth (if Zenu picks "longer, not deadlier").
- Zenu, in game: accept a near and a far quest and see 1 vs 4 overland floors in
  the biomes the route line promised.

**Open questions for Zenu**
- Distance bands: is **0–3 travel legs** (1–4 overland floors) the right range? Today's
  quests always have 1–2.
- Floors: total grows to 3–12 (recommended), or keep 10 as the cap and shorten the
  dungeon for far quests?
- Should distance make the boss stronger (today's formula would do so), or only make the trip longer
  (recommended)?
- Legendary eligibility: `dungeonFloors >= 8` (recommended) or `floors >= 10` (far
  quests would then qualify more easily)?
- Should overland floors keep paying the full per-floor reward, or a reduced rate?

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Boss CR silently climbs with travel legs (`questFloor` terms at game.js:937/965) | `depthFloor` helper + test (§4) |
| Old in-flight saves | everything keyed on `q.route` presence; legacy paths untouched |
| Chain sequels pinned to old fixed positions | snap-to-valid-cell in `generateSequelQuest` |
| A theme with too few valid cells → pins stack | spacing test over 1 000 boards; fall back to relaxing spacing, never to a wrong region |
| Region grid disagrees with the art | debug overlay + Zenu's visual pass before region logic ships |
| `object-fit` change alters the look (letterbox) | blurred-map fill; Zenu's visual check |
| Longer quests shift the economy | sim pass after §4 lands |
| `floors > 10` assumptions elsewhere (room gradient `floorT` clamps, legendary rule, sequel cap) | grep for `floors` and the literal `10` during §4; covered by the legendary decision |

---

## 6. Order of work

| # | Step | Depends on | Verify |
|---|---|---|---|
| 1 | Map-space stage (§1) | — | electron smoke pin-vs-stage check at 3 sizes; Zenu resizes the window |
| 2 | Biome painter (`world_map_editor.html`, save endpoint) + `world_biomes.json` + `world_regions.js` + `?regions=1` overlay (§2 revised) | 1 | `world_regions.test.js` shape tests; **Zenu paints the map and reviews it in the overlay** |
| 3 | Guild hub marker (§3) | 1, 2 | hub-cell test; Zenu checks the spot |
| 4 | Region-aware quest placement (§2) | 2 | 1 000-board placement test |
| 5 | Route + overland legs (§4), legacy fallbacks, depth helper | 3, 4 + Zenu's answers in §4 | quests / overland_path / route tests; boss-CR test |
| 6 | Route line + sidebar route text | 5 | DOM test that the route layer has `route.length` dots; Zenu checks in game |
| 7 | Balance pass | 5 | `sim/` run, gold balancer |

Each step runs only its own targeted test files, not the full suite.
Step 1 can ship alone and fixes the reported bug even if the rest is postponed.

---

## 7. Suggestions (accept or reject each one separately)

Each one is independent of the others and not needed for items 1–4.

| # | Suggestion | Cost / trade-off (everything has a cost) |
|---|---|---|
| **S1** | **Known roads via the Cartographer's Guild.** The facility ([guild.js:97-101](../src/game/guild.js:97)) already "pre-scouts floors". At higher levels it could chart a region, so routes through charted regions lose one travel leg. | Costs facility upgrades/gold. Shorter trips also mean fewer floor rewards, so it's a time-vs-pay choice, not free power. |
| **S2** | **Waystations.** Pay gold to build a waystation in a region. Routes through it get a guaranteed camp/merchant with better stock, or a safe rest. | Gold sink plus upkeep; one waystation at a time unless the guild grows. |
| **S3** | **Map fog of war.** Unvisited regions are darkened; a region clears once you cross it. Quests in uncharted regions pay a premium. | Pays more but you go in blind (no rumours/route biomes shown until charted). |
| **S4** | **Danger rings.** Offer level drifts upward with distance (far = band +1 more often). | Conflicts slightly with the 1-below/4-at/1-above contract; would need to replace it. |
| **S5** | **Routed path (A\*) instead of a straight line.** The route bends around the Fog Sea and High Peaks, so the line on the map follows real geography and leg biomes are more believable. | More code and a reachability edge case (isles). Distance would become path length. |
| **S6** | **Pan & zoom on the map** (wheel + drag, inside the stage). Lets small windows see detail. Pins stay anchored because they live in the stage. | Small UI effort; must not fight the tab bar's scroll. |
| **S7** | **Persist the offer board in the save.** Today it rerolls on every load and every map visit, which makes rerolling for a near quest or a legendary free. | Removes a free reroll (consistent with "no free benefits"). An explicit "new contracts" button could cost gold. |
| **S8** | **Story missions pinned on the map** at their `place`, using the same region data, shown in the Story tab. | Needs a location per mission; story floorPlans stay hand-authored. |
| **S9** | **Hub reflects guild growth.** The hub marker's icon tier follows `INFRA_TIERS` (huts → palisade → stone keep). | Needs 3–4 icon variants. |
| **S10** | **Guild expeditions on the map.** `EXPEDITION_TEMPLATES` ([guild.js:348](../src/game/guild.js:348)) are already biome-flavoured ("forage_forest"). Show dispatched squads as markers on their region, with duration scaled by distance. | Far expeditions take longer and pay more; ties the guild system to the same geography. |
| **S11** | **Region hover tooltip + legend.** Hovering the map names the region and its biome; a small legend maps biome accents to names. | Pure UI. |
| **S12** | **Lore names for regions** written into the art (labels on the map image or as a text layer in the stage). | Writing time; a text layer scales with the stage, so it stays aligned. |
