# Overland Prologue Floors — Implementation Plan

> **Status 2026-07-26: steps 1–4 are built and merged.** All 166 vitest tests,
> `smoke_quests.mjs` and `vite build` pass; the five new biomes generate headlessly
> with props placing correctly. Step 5 (bespoke 3D props) is the only open item.
> Sections below are kept as the design record — the "decisions that need a call"
> in §4 have all been made and are noted inline.

**Goal:** every dungeon run opens with two overland floors before going underground.
Floor 1 = a generic *approach* (existing overland type). Floor 2 = a *threshold*
overland type that is thematically the dungeon's doorstep. Floors 3+ = the dungeon
itself, unchanged.

> Worked example (Zenu's): crypt run → F1 moor → F2 graveyard → F3-N crypt.

---

## 1. What already exists

| Piece | Where | State |
|---|---|---|
| 5 dungeon themes | `THEMES` in [dungeon_generator.js:101](src/dungeon/dungeon_generator.js:101) | `ancient, verdant, frost, grim, molten` (`THEME_KEYS` = non-overland) |
| 4 overland themes | same table, flagged `overland:true` | `forest, moor, mire, holdfast` |
| Overland generator | `generateOverland()` [dungeon_generator.js:1281](src/dungeon/dungeon_generator.js:1281) | open field + zones + trails + enemy camp as "boss" |
| Per-floor surface switching | `q.floorPlan[]` consumed in `_loadFloor` [game.js:446](src/game/game.js:446) | **already works** — Ch5 does overland×2 → dungeon×3 |
| Overland fog | [fog.js:217](src/game/fog.js:217) | shrouded-map mode, keyed off `d.overland` |
| Overland monster pools | `DUNGEON_MONSTER_MAP` [srd.js:611](src/game/srd.js:611) | has entries for all 4 overland keys |

**The routing machinery is done.** The work is (a) five new overland *themes*, (b) a
derived floor plan for randomly-generated quests, (c) a few renderer branches that
currently hardcode "overland = trees on grass".

---

## 2. New overland map types (5)

One threshold type per dungeon theme. Each is a new entry in `THEMES` with
`overland:true`.

| Key | Label | For dungeon theme | Fiction | Blockers | Ground | Signature props |
|---|---|---|---|---|---|---|
| `boneyard` | BONEYARD | `grim` | Walled graveyard sprawling outside the crypt gate; grave rows, leaning mausoleums, gravedigger's yard | low **stone** walls + mausoleum blocks | dead turf | `tombstone`, `cairn`, `bush`, `stakes` |
| `ruinfield` | RUINFIELD | `ancient` | Toppled colonnade and sunken plaza above the vault; foundations drifted over | **stone** rubble + pillar stumps | dry dust | `pillarA/B`, `vase`, `rocks`, `cairn` |
| `ashfield` | ASHFIELD | `molten` | Cooling flows and cinder cones on the caldera's flank; smoke, vents | **stone** obsidian spires | ash/scoria | `rocks`, `anvil`, `stakes`, `skulltotem` |
| `snowfield` | SNOWFIELD | `frost` | Wind-scoured white pass leading to the ice caverns; crevasses, dead pines | mixed **tree** (dead pine) | snow | `icebone`, `cairn`, `rocks`, `signpost` |
| `sporewood` | SPOREWOOD | `verdant` | Fungal grove choking the warren mouth; giant caps, thorn walls | **tree** (fat cap) | moss | `mushroomA/B`, `rootsA/B`, `fren1-4`, `vinemound` |

**Zero new 3D art required for v1.** Prop GLBs are registered in one flat
`propAssets` map ([dungeon_scene.js:62](src/render/dungeon_scene.js:62)), so any
theme's `oc.ground` table can reference any existing key. `tombstone`, `icebone`,
`anvil`, `pillarA/B`, `vase` already exist and are exactly right for four of the
five. Bespoke assets (mausoleum, obelisk, lava vent, dead pine, giant cap) are a
follow-up via the `dnd-3d-asset` / Tripo pipeline.

### Floor-1 approach pools (existing types only)

Weighted per destination theme so the walk in reads as the right country:

```
ancient  → moor, forest, holdfast
verdant  → forest, mire
frost    → forest, moor
grim     → mire, moor, holdfast
molten   → moor, forest
```

---

## 3. Code changes

### 3.1 `src/dungeon/dungeon_generator.js` — theme data

For each of the 5 new keys add to `THEMES`:

- `overland:true`, `label`, `accent`
- lighting block: `bg, fog, fogD, hemi, dir` (daylight-ish for boneyard/ruinfield/
  snowfield; low + red for ashfield; dim green for sporewood)
- surface colors: `floor, corridor, wall, cap, pillar, debris`
- `flame/flameCore/torchLight/cloth`
- **`blockerGeo`** *(new field)*: `'tree'` (default, current behaviour) or `'block'`
- **`groundMat`** *(new field)*: `'grass' | 'floor' | 'ice'`
- `blocker:{trunkH,trunkR,canopyS,canopyY}` for the tree ones
- `oc:{ edgeMin, edgeRand, belt, beltLinked, lone, copseDiv, copseChance,
  camp:{palisade,tents,bones}, ground:{...prop densities} }`
- `particles:{kind,color,n}` — reuse kinds 0 dust / 1 embers / 2 snow / 4 spores
- `nameA[] / nameB[]` for `dungeonName()`

Also add matching entries to **`SPAWN_THEMES`** ([dungeon_generator.js:247](src/dungeon/dungeon_generator.js:247))
— spawn-marker geo/colors, else they fall back to `ancient` stone rings.

`THEME_KEYS` filters on `overland`, so the new keys stay out of dungeon rotation
automatically. `generateOverland()` itself needs **no changes**.

### 3.2 `src/render/dungeon_scene.js` — two hardcodes to break

1. **Blocker geometry** ([:588-615](src/render/dungeon_scene.js:588)) — the overland
   branch always builds `GEO.treeTrunk` + `GEO.treeCanopy` with bark/leaf materials.
   Split on `TH.blockerGeo`:
   - `'tree'` → current path (unchanged)
   - `'block'` → jittered `GEO.wall` + `GEO.wallCap` with `matWall`/`matFloor`,
     per-cell height 1.2–2.4 and a random Y-rotation, colored from `TH.wall`/`TH.cap`
   The palisade branch (`d.palisadeMask`) is orthogonal and stays as-is.
2. **Ground material** ([:576](src/render/dungeon_scene.js:576)) — currently
   `TH.overland ? matGrass : matFloor`. Change to select via `TH.groundMat`
   (verify `matIce` exists in [dungeon_materials.js](src/render/dungeon_materials.js);
   if not, `matFloor` tinted by `TH.floor` is sufficient for v1).

Everything else in the render path already reads `TH.*` and needs no change.

### 3.3 `src/game/srd.js` — monster pools

Add `DUNGEON_MONSTER_MAP` entries. Threshold floors should already lean toward the
dungeon's cast so the difficulty and fiction ramp:

```
boneyard  → Undead + Beasts + Vermin
ruinfield → Goblinoid + Vermin + Undead
ashfield  → Elemental + Beasts + Giantkind
snowfield → Beasts + Vermin + Giantkind
sporewood → Fey + Vermin + Beasts
```

### 3.4 `src/game/overland_prologue.js` — **new module**

Exports the mapping tables plus:

```js
prologueLength(q)        // 2 | 1 | 0  (see §4)
autoProloguePlan(q, floor) // -> {mapKind,theme,name,mapW,mapH,zones} | null
```

`autoProloguePlan` returns `null` for any floor past the prologue and for any quest
that already declares `floorPlan` (story missions win). Names come from
`` `${q.place} — The Approach` `` / `` `${q.place} — The ${thresholdLabel}` ``.

Map size gradient (overland uses `mapW/mapH/zones`, not `roomCount`):
`W=H = clamp(56 + level*1.4, 56, 84)`, `zones = 6 + floor(level/3)`, floor 2 one
step larger than floor 1.

### 3.5 `src/game/game.js` — one line

[game.js:446](src/game/game.js:446):

```js
const plan = (q && Array.isArray(q.floorPlan))
  ? q.floorPlan[this.questFloor - 1]
  : (q ? autoProloguePlan(q, this.questFloor) : null);
```

**Derive, don't bake.** Computing the plan at load time instead of stamping
`floorPlan` onto the quest at generation keeps saved in-flight quests working —
they pick up the prologue on their next floor load with no migration.

### 3.6 `src/game/menus.js` — quest card

Show the shape of the run next to the floor count, e.g.
`10 floors · 2 overland approach → 8 below`. Card markup is around
[menus.js:1146](src/game/menus.js:1146).

---

## 4. Design decisions — resolved

**Minimum floors raised to 3.** Random quests now roll `3 + rand*8`
([quests.js:358](src/game/quests.js:358)) so every quest has room for a prologue
*and* a dungeon boss floor. Prologue length:

| `q.floors` | Prologue |
|---|---|
| ≥ 4 | 2 overland (approach + threshold) |
| 3 | 1 overland (threshold only — the doorstep is the floor that has to sell the dungeon) |

Note this raises low-end rewards: `rewardGold`/`rewardXp` scale linearly with
`floors`, so the old 1- and 2-floor quests are gone and the cheapest offer is now
3 floors' worth of pay.

**Final floor stays a dungeon.** Guaranteed — the prologue never reaches
`q.floors`, so `finalBossId` / boss-card / reward-grant paths are untouched.

**Loot & XP dip on floors 1–2.** Overland floors have 6–20 zones vs. 12–70 dungeon
rooms, so the opening floors drop meaningfully less than they used to. Reads as a
gentler ramp, but it is a real economy change — worth a pass through `sim/` and
`gold_balancer.html`.

**Narrative phases are left unconstrained.** `rollPhases` picks floors in
`[2, floors-1]` ([quests.js:143](src/game/quests.js:143)), so an ambush or gauntlet
can land on the overland threshold — which is desirable (an ambush on the moor is
good). `placeGems` anchors to `d.rooms`/`roomAnchor`, which overland zones provide,
so the puzzle phase works unchanged.

**Pre-existing:** overland maps always report `valid:false` — the copse/belt pass
strands a few small pockets of floor tiles behind blockers on *every* overland
biome including the shipped `forest`/`moor`/`mire`/`holdfast`. `generateOverland`
returns without the retry loop and nothing consults `d.valid` for overland, so it
is inert. Worst case across a 540-map sweep is 7% stray tiles. Not addressed here.

---

## 4b. The road (2026-07-27)

Overland zones were scattered at random and wired up with Delaunay → MST → loops,
which read as a *region* to wander rather than a road to walk. Now
`generateOverland` builds a journey:

**Meandering polyline.** The road is a sequence of legs — a short climb, then a
long haul left or right across most of the map's width, repeat — from the
trailhead at the bottom edge to the camp at the top. It starts hard against one
side so the first haul crosses the country, and turns back early when a side runs
out of map. Leg lengths are randomised, so it wanders rather than switchbacking.

**Zones dropped by arc length.** Zones are placed at even intervals *along* the
polyline, so they come one after another down the road however much it winds.

**Edges are consecutive only** (`i → i+1`). No Delaunay, no MST, no loops. The
graph is a simple path: entrance is always zone `0`, the camp always zone `N-1`,
depth is just the index, and difficulty ramps evenly along the journey.

**Corridor mask.** A multi-source BFS out of the trail centreline gives every
cell its distance from the road; anything past `roadBand` (per-theme
`[minimum verge, ragged extra]`) that is not inside a zone clearing becomes solid
wilderness. This is what makes the map a ribbon you travel rather than a field
you cross — open fraction drops from ~100% to 30–39%.

Two constants matter and are easy to get wrong:

- **`LEG_PITCH` (17 tiles).** Two stacked hauls have to clear each other or their
  corridors fuse into horizontal stripes and the map goes blobby again. The leg
  count is capped by `vspan / LEG_PITCH`, so *map height is what buys legs*.
- **Portrait maps.** Because of the above, the prologue asks for tall maps
  (~61×92 at level 1 up to ~78×120 at level 20) rather than squares. A square map
  at this leg count fuses. Legacy square story-mission sizes still generate fine,
  they just get fewer legs.

Treasure/shrine are placed at ~70% / ~40% **along the path**. The old
sort-by-depth pick would now always land the treasure immediately before the
camp, since depth is the index.

### Clearings are battlefields

The clearings strung along the road were widened from radius 6–8 to **8–12**
(camp 12–15) so each one is ground you fight *across*. Four things had to move
together — changing only the radius makes zones merge and feel empty:

| | before | after |
|---|---|---|
| zone radius | 6–8 | 8–12 (camp 12–15) |
| `minD` centre spacing | ≥13 | ≥30 |
| zones per prologue map | 6–13 | 5–9 |
| default zone density (no `zones` passed) | `total/420` | `total/900` |
| spawns per combat zone | flat 2 | 3–6, scaled by clearing **area** |
| spawns in the camp | flat 8 | up to 12 |
| props per clearing | ~7–16 | ~13–25 (`scatterGain`, default 2.0) |

- **Spawn count follows area** (referenced to the old radius-7 zone, capped at
  6 / 12) so a battlefield twice the size holds a proportionate fight rather
  than two monsters rattling around it. Placement is area-uniform (`sqrt` on the
  radius draw) so they fill the clearing instead of bunching at the centre, and
  occupancy is tracked **map-wide** — neighbouring clearings may overlap, and a
  per-zone set let two zones stack monsters on one tile.
- **`scatterGain`** lifts every theme's ground densities together while keeping
  each theme's own prop *mix*. Tune that one number, not nine density tables.
  `holdfast` also got a real ground table (it only ever had debris + moss, which
  read as bare once clearings got big).
- **The default zone density matters more than it looks.** Every hand-authored
  story mission omits `zones` and lands on it; at the old `total/420` Ch5's
  88×84 causeway would have asked for 18 battlefield-sized clearings.

Measured across 1080 maps (9 biomes × 10 shapes incl. the legacy square
story-mission sizes × 12 seeds): every map a simple path, zero cut-off zones,
zero stacked spawns, ≥91% reachable, 38–47% open at prologue sizes (64% worst
case on a legacy square shape), ≥3 monsters in every combat clearing.

**Cost to watch:** ground props are individual GLB clones, i.e. one draw call
each. The biggest map now emits ~230 where it used to emit ~110. `scatterGain`
is the dial if that shows up on lower-end hardware.

### Bug this surfaced

`stampTrail`'s bounds test read `if(!inB(px+ox, py+py))` — `py+py`, not `py+oy`.
For any trail cell with `py >= H/2` the test failed and the whole 3×3 stamp was
skipped, so **no trail cell in the bottom half of any overland map ever got
`protect` or `corridor` set** and the blocker pass could wall the road over. The
old loop-rich zone graph routed around the damage; a single linear path cannot —
`mire` at 20 zones collapsed to 549 of 4716 reachable tiles. Fixed; `mire` now
reaches 4659/4812.

`test/overland_path.test.js` covers the path shape, per-zone reachability across
9 biomes × 5 sizes × 3 seeds, and the prologue routing. The reachability case was
confirmed to fail with the old `py+py` restored.

---

## 5. Build order — status

1. ~~**Five biome themes**~~ — `THEMES` + `SPAWN_THEMES` entries. **Done.**
2. ~~**Renderer**~~ — `blockerGeo`, `groundMat`, `canopyTint`, `blockerH`; plus
   `scatterKinds` in `generateOverland` extended from a 13-kind whitelist to the
   full prop set (it silently dropped any kind not on the list, which would have
   made every threshold biome's signature props invisible). **Done.**
3. ~~**`overland_prologue.js` + the `game.js` line + `srd.js` pools**~~ **Done.**
4. ~~**World-map card**~~ — floor count now reads `10 · 2 overland floors → 8 below`.
   **Done.**
5. **Bespoke props** — open. Needs ComfyUI running (not up as of writing). Wishlist
   below; everything currently renders using existing GLBs.

### Open: bespoke prop wishlist

| Biome | Wanted | Standing in for now |
|---|---|---|
| `boneyard` | mausoleum, lychgate, grave-mound, iron fence | `tombstone`, `cairn`, `bush` |
| `ruinfield` | fallen obelisk, cracked plinth, arch fragment | `pillarA/B`, `vase`, `rocks` |
| `ashfield` | lava vent, obsidian shard, cinder cone, charred stump | `rocks`, `anvil`, `stakes` |
| `snowfield` | dead pine, snow drift, ice crevasse, frozen marker | `icebone`, `cairn`, `rocks` |
| `sporewood` | giant cap cluster, shelf fungus, spore vent | `mushroomA/B`, `rootsA/B`, `fren1-4` |

Pipeline: `dnd-3d-asset` skill (Z-Image → Hunyuan3D → Blender review) → drop the
`.opt.glb` in `public/3d/<Biome>/` → add to `BIOME_PROP_FILES` +
`PROP_SCALE_MULTIPLIER` ([dungeon_scene.js:28](src/render/dungeon_scene.js:28)) →
add the key to `scatterKinds` and to the theme's `oc.ground` density table.
