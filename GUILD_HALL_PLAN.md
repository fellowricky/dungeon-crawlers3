# Guild Compound Plan

**Status:** PHASE 0 IMPLEMENTED (2026-08-21) — standalone preview only, not
wired into the game. See §11 for what landed.
**Scope:** replaces the guild subtab UI (`src/game/worldmap.js`) with a rendered
3D compound in the shipping dungeon renderer (`src/render/dungeon_scene.js`),
and promotes it to the between-runs hub. Guild *logic* (`src/game/guild.js`) is
untouched.

---

## 1. What we are replacing

The guild is currently a bar of 11 buttons (`index.html:339`) driving
`renderFacilityView(facilityId)` (`worldmap.js:757`), which emits a
full-panel HTML blob per facility. It is functional and complete — every
facility, upgrade path, hero assignment, and resource economy already works.
The problem is purely presentational: eleven tabs of dense forms with no sense
of place.

The target: a **guild compound** seen in the game's existing three-quarter
camera. Each facility is a building. Empty lots become buildings when built.
Buildings visibly grow as they upgrade. Heroes stand around in it. Clicking a
building offers **Upgrade** or **Enter**; the functionality lives inside.

---

## 2. What the renderer already gives us for free

This is the reason to build on the dungeon renderer rather than in DOM.

### 2.1 The camera: right projection, wrong yaw

```js
// dungeon_scene.js:230-233
export const cam = new THREE.OrthographicCamera(-BASE_HALF*aspect, BASE_HALF*aspect, BASE_HALF, -BASE_HALF, -400, 800);
export let yaw = Math.PI/4, pitch = 0.64;
```

The **orthographic projection** is exactly right and is reused unchanged. The
**yaw is not**. A 45° yaw is precisely what makes a scene read as isometric:
the ground grid becomes a diamond and every building is seen on its corner.

The compound uses `yaw = 0` — looking straight down the world's north axis, so
buildings present their front face square to the screen and the yard reads
north-south. That is the SNES-JRPG town camera, and it is also a hard
requirement of paper-doll art: a sprite is drawn from one angle, and at 45° it
would be showing a view it does not have.

The pose lives in `CAM` (`guild_layout.js`) rather than being borrowed from the
dungeon, since the two scenes genuinely want different angles.

### 2.1b Camera controls come free, minus orbit

`dungeon_scene.js:492-530` already implements drag-pan and wheel-zoom written
generically against `yaw`, so both behave correctly at yaw 0 and are reused as-is.
Only two things need constraining, which `constrainCamera()` does after the fact
rather than by intercepting events — keeping one set of camera controls in the
codebase instead of two competing ones:

- **Orbit is suppressed.** Right-drag and shift-drag change yaw/pitch, which
  would show sprites off-angle.
- **Pan and zoom are bounded** to the compound, so the player cannot drag the
  yard off-screen or pull out into void. The pan margin is derived from how much
  of the compound is actually off-screen at the current zoom, so when everything
  fits the view simply stays centred.

### 2.2 Arbitrary GLBs already load as props

```js
// dungeon_scene.js:84
export function registerProp(key, url, scaleMult, retries = 2)
```

Any GLB, any URL, registered under a key and instanced into the scene.
`custom_props.json` and the dungeon editor already import models live at
runtime. **Each guild building is just a prop.** An upgrade tier is a different
prop key at the same anchor.

### 2.3 Pixel-art-over-3D is already the house style

`HeroSprite` (`sprite_animator.js:112`) is a billboarded LPC paperdoll living in
the 3D scene, composed through `buildLayerPaths` from the same appearance data
the roster uses. Heroes standing in the compound is **the existing rendering
path**, not new work. This is also why the three-quarter camera matters: LPC art
was drawn for exactly this projection.

### 2.4 Click-to-world raycasting already exists

`dungeon_scene.js:305-308` already maintains a `Raycaster`, an NDC vector, a
ground `Plane`, and drag-vs-click discrimination via `downX/downY`, plus hover
marker meshes. Building selection reuses this wholesale.

---

## 3. The one build decision: new scene module, not `buildScene`

`buildScene(d)` (`dungeon_scene.js:665`) consumes a fully generated dungeon:
`grid`, `roomId`, `corridor`, `doorway`, `bfs`, `maxBfs`, `rooms`, `lakeMask`,
`palisadeMask`, `props`, `torches`, `arches`, `entrance`, `seed`,
`params.themeKey`. It also brings fog-of-war reveal, ceiling caps, torch light
pools, and room logic shaped around monster encounters.

Hand-authoring a courtyard through that structure means fighting it at every
step, and the compound is authored content — not a generated grid.

**Decision: `src/render/guild_scene.js`.** It imports the *same* `renderer`,
`scene`, `cam`, `updateCam`, `registerProp`, `disposeLevel`, and the same
materials and tile atlases, but composes its own ground plane and building
props. Estimated 300–400 lines against `dungeon_scene.js`'s 2013.

Art-style continuity is not merely preserved, it is **structural** — it is
literally the same renderer, lighting rig, material set, and sprite system.

### 3.1 Lifecycle constraint

`renderer`, `scene`, and `cam` are module-level singletons with one `group` live
at a time. Compound to dungeon and back is `disposeLevel()` then build the
other. `guild_scene.js` must obey that contract and register its own geometry
for disposal.

---

## 4. The real architectural change: hub as a state, not an overlay

Today the hub is a **DOM overlay over a paused scene**: `G.state = 'worldmap'`
adds `.show` to `#worldmapscreen` and calls `G.setPaused(true)`
(`worldmap.js:154`). Everything is HTML.

The compound inverts this. `G.state = 'compound'` renders an actual live scene,
and the DOM becomes popups floating over it.

**This is the genuine work item of the project.** Everything else is additive.

Mitigating factor: `showWorldMap()` is the single entry point — `game.js` calls
it from exactly five sites (`game.js:415`, `419`, `2126`, `2335`, plus init at
`396`), always as `showWorldMap({ refresh: true })`. Its quest generation, shop
restock, and hire-pool rolls stay exactly as they are. Only the tail of the
function changes: instead of forcing the map tab, it enters the compound scene.
**`game.js` itself needs no changes.**

### 4.1 Existing panels become destinations

The Quests, Story, and Shop panels are kept verbatim and re-reached from inside
the world:

| Structure in compound | Opens |
|---|---|
| Tavern | existing Quests panel (`#wm-panel-map`) |
| Chronicle / notice board | existing Story panel |
| Merchant | existing Shop panel |
| Living Quarters | existing roster + hire lists |
| 10 other facilities | `renderFacilityView()` in an interior view |

The subtab bar (`index.html:339`) retires.

---

## 5. Level 0 as an empty lot

The insight that a building *is* the level-1 upgrade maps onto the existing data
model with **zero changes**:

```js
// guild.js:337-339
for (const key of Object.keys(FACILITY_DEFINITIONS)) {
  this.facilityLevels[key] = key === 'living_quarters' ? 1 : 0;
}
```

Everything except Living Quarters already starts at 0, and `isUnlocked()` plus
the "Build / Unlock Facility" path already exist (`worldmap.js:775`). So:

- **Level 0** — empty lot: foundation stakes, a survey post, cleared ground
- **Level 1** — the building exists
- **Levels 2–10** — the building grows

Visual tier is a pure function of level. No save-format change, no migration.

### 5.1 Tavern and merchant

Neither is in `FACILITY_DEFINITIONS` — they are town features
(`G.townShopInventory`, `G.townTavernHirePool`). They enter the compound as
**non-upgradable structures** that always exist and route to their panels. If
they should become upgradable later, they get added to `FACILITY_DEFINITIONS`
like anything else.

---

## 6. Interiors: the scope trap

"Click Enter, go inside" implies **thirteen interior scenes**. Built as real 3D
rooms that is a very large art commitment, and it is the thing most likely to
stall this project short of shipping.

**Staged recommendation:**

- **Stage A** — Enter opens the existing `renderFacilityView()` content as a
  full-screen interior view, framed and styled as a room, over a blurred or
  darkened compound. Costs nothing; the functionality is already written.
- **Stage B** — the two or three highest-traffic buildings (Living Quarters,
  Blacksmith, Tavern) graduate to real 3D interiors with heroes standing in
  them.
- **Stage C** — the rest, only if B proves worth the cost.

The compound is where the sense of place is won. Interiors are where the work
gets done, and a well-framed panel is not a failure there.

---

## 7. Art: a paper-doll / GLB blend

The compound is **not** 39 GLBs. Art is chosen per structure between two paths,
both supported by `guild_scene.js` via a structure's `art` field:

```js
art: { type: 'sprite', tiers: ['/art/guild/forge_t1.png', ...], height: 9 }
art: { type: 'glb',    tiers: ['forge_t1', 'forge_t2', 'forge_t3'] }
```

With no `art` declared, a structure falls back to the procedural placeholder
geometry Phase 0 ships.

**Paper-doll pixel art is the primary path.** An upright quad with a nearest-
filtered pixel-art texture, leaned back to meet the camera pitch. This is the
same technique the heroes already use (`HeroSprite` is a billboarded LPC
paperdoll), which is exactly why the two read as one world. It is also far
cheaper than modelling: a 2D building sprite is one image from the
`pixel-art-assets-generator` pipeline, not a mesh, UVs, and materials.

**GLB is the path where 3D genuinely earns it** — structures that benefit from
real silhouette against the ground plane, catch shadows convincingly, or need to
be seen while the camera pans across them. `registerGuildModel()` wraps the
dungeon's own DRACO-configured prop loader, so a compound model loads through the
same path as every dungeon prop.

Because the two mix freely, the art budget is a decision per building rather than
one global commitment, and a structure can start as a sprite and be promoted to a
model later without touching anything but its `art` field.

**Tiering stays additive.** Three visual tiers per structure (see `tierOf`), and
higher tiers should add to the silhouette — a taller chimney, a second storey, a
lean-to, banners — rather than replacing it. "Growing" reads better than
"swapped", and it is far less art either way.

**Style lock:** produce every structure's tier-1 art as one batch against a
single locked prompt stem and palette, review them together, and only then do
tiers 2-3. Consistency across a set is much harder to recover than to establish.

### 7.1 The chosen sprite recipe (benched 2026-08-22)

```
model    Z-Image Turbo (DC_GuildBuilding_Z.json): z_image_turbo_bf16 +
         PixelArt_Perfect LoRA @1.0 + Desimulate @0.5, 768x768, 10 steps,
         cfg 1, euler_ancestral / beta, ModelSamplingAuraFlow shift 7
prompt   variant `zdark` = weighted front-on lock + weighted background
         isolation + steep-overhead composition + dark fantasy palette
fix      pre-crop raw to subject -> pixel fixer at (world width x 32) px with
         --no-bg-remove -> border-connected keyout -> despeckle -> alpha crop
run      python tools/gen_guild_building.py --subject <id> --seeds 6
         python tools/gen_guild_building.py --subject <id> --pick <seed>
```

Benched against `pixelArtDiffusionXL_spriteShaper`, `hyperpixel_v10`, and two
Illustrious + pixel-LoRA stacks. spriteshaper made the chunkiest pixels but
defaults hard to isometric; hyperpixel drew isometric wall fragments; both
Illustrious stacks drew eye-level buildings inside full scenes. Z-Image holds
front-on framing and isolation naturally, and its speckle — the one thing it was
losing on — is fixed in the pipeline rather than by changing model.

**Three things had to be discovered by testing, not reasoning:**

1. **Stating the camera angle in degrees does not work.** "Roughly 35 degrees
   above the horizon" produced ~15-20 degree eye-level buildings from every
   model. Describing the *composition* the angle implies — "the roof seen from
   above filling the upper two thirds, only a strip of front wall beneath the
   eaves" — is what lands.
2. **SDXL ignores a mid-prompt isolation clause.** Every SDXL recipe drew sky,
   trees and ground despite matching negatives. Front-loading *and* weighting it
   (`(plain solid pure white background:1.6)`) fixed it.
3. **spriteshaper defaults to isometric** and a plain `isometric diamond`
   negative did not shift it — it needed front-on weighted up and every synonym
   for corner-on weighted down.

**Pixel density is the real style lock.** Sprites generate at exactly 32 px per
world unit — the density of the DCSS ground tiles — so ground pixels and building
pixels stay the same size at every zoom. The LPC heroes are denser (~57 px/unit);
that is a pre-existing LPC quirk, deliberately not propagated.

### 7.2 The hole bug, and why review sheets are magenta

The first promoted tavern had **26% of its interior fully transparent**. The
fixer's `remove_background` deletes every pixel within a colour distance of the
median corner colour *anywhere in the image*, so the building's pale plaster
walls were keyed out wherever they appeared, leaving timber and roof floating
over holes.

It shipped because the review sheet rendered candidates over a dark band and a
light band. **A hole shows whatever is behind it** — so the missing walls read as
timber shadow on dark and as plaster on light. The two backgrounds that were
supposed to catch defects were the two that disguised this one.

Both halves are now fixed and neither should be undone:

- The fixer runs `--no-bg-remove`; keying is a **border-connected flood fill**,
  so an enclosed wall panel can never be deleted regardless of its colour.
  A `despeckle` pass then drops opaque islands not connected to the body
  (Z-Image leaves ~40-100 stray pixels per sprite).
- Review sheets render over **magenta** and mid grey. A colour that cannot occur
  in the art makes missing pixels unmissable.
- `alpha_report()` prints interior transparency; it should read 0.0%.

## 8. Layout as data

```js
// guild_hall_layout.js
GUILD_COMPOUND = {
  blacksmith: {
    anchor: { x, z },                                // ground-plane position
    rotation,
    tiers: ['forge_t1', 'forge_t2', 'forge_t3'],     // prop keys
    heroSlots: [{ x, z, facing }],                   // assigned-hero standing spots
    label: 'The Blacksmith'
  },
  ...
}
```

Repositioning a building is editing numbers. Given `dungeon_editor.html` already
places props against the live renderer, extending it with a compound mode is
preferable to building a separate tool.

---

## 9. Known risks

**9.1 `renderFacilityView` emits full-panel-width HTML with heavy inline
styles.** Reframed as an interior view most will be fine, but the Armory storage
grid and the Academy tech tree are laid out for a wide panel and will need real
CSS work. Budget for it rather than discovering it.

**9.2 Scene singleton contention.** Compound and dungeon share one `scene` and
one `group`. Transitions must dispose cleanly or geometry leaks across states.

**9.3 The hub-as-state conversion touches the screen lifecycle.** Pause
handling, the system menu overlay, and the party/gear menus all currently assume
a DOM overlay above a frozen scene. Each needs checking against a live one.

**9.4 Art consistency across the full structure set** — see §7.

---

## 10. Phases

- **Phase 0 — Blockout.** `guild_scene.js` renders a ground plane with 13
  primitive-box placeholder buildings at authored anchors. Raycast selection,
  the Upgrade/Enter popup, and Stage-A interiors wired to the existing
  `renderFacilityView`. **Fully playable with zero new art.** Pins down scale,
  camera framing, and click ergonomics before a single asset is made.
- **Phase 1 — Hub conversion.** Compound becomes the landing state from
  `showWorldMap()`. Tavern, merchant, and chronicle route to the existing
  panels. Subtab bar retires.
- **Phase 2 — Buildings.** Tier-1 GLBs for all 13 as a style-lock batch, then
  tiers 2–3 as kit pieces.
- **Phase 3 — Life.** Assigned heroes billboarded at their `heroSlots`, idle
  animation off the existing walk sheets, forge glow and chimney smoke via the
  existing ambient FX, "ready" markers on buildings with something waiting
  (expedition returned, injury healed, research complete).

Phase 0 is the one that de-risks everything else, and it needs no artwork at
all.

---

## 11. What Phase 0 landed (2026-08-21)

Standalone preview only. **Nothing in `src/game/` imports any of it**, and
`showWorldMap()` is untouched — the current guild UI still ships as-is.

| File | Role |
|---|---|
| `src/game/guild_layout.js` | Pure data: compound bounds, camera pose, 14 structures with footprints and hero slots, `tierOf()` |
| `src/render/guild_scene.js` | Scene builder on the shared renderer: ground, wall, gatehouse, procedural buildings, raycast picking, hover, hero placement, camera constraint |
| `src/render/guild_ground.js` | Autotiled grass/dirt terrain baked to one texture from the DCSS `dirt_*` set |
| `src/guild_preview.js` + `guild_preview.html` | Standalone harness — level sliders, hero count, theme, zoom, structure popup |

Run it with the dev server at **`/guild_preview.html`**.

### Verified working

- North-south three-quarter camera at `yaw 0`; orbit blocked, pan and wheel-zoom
  bounded to the compound
- Click a building → popup pinned over it, reading real `FACILITY_DEFINITIONS`
  data (description, effect text at current level, next upgrade cost)
- **Upgrade → visible growth**: Living Quarters at level 8 gains a second storey
  and a new window row; the forge chimney and the spire grow with tier; level 0
  is an empty lot with survey stakes
- LPC paper-doll heroes standing at hero slots, at correct scale against the
  architecture

### Terrain

The ground is real tile art, not flat colour: the DCSS `dirt_*` set
(`public/art/ground/`, credited in CREDITS.md), autotiled and baked into a single
canvas texture. Measured, the set is an 8-way fringe: `dirt_full` is solid grass,
`dirt_0..2` are solid dirt variants, and each `dirt_<dir>` / `dirt_<dir><dir>` is
a *grass* tile with dirt bleeding in from the named edge(s). So every dirt cell
draws a variant and every grass cell picks its tile from which orthogonal
neighbours are dirt.

The road network is **derived from the layout**, not hand-painted — a gate road,
three cross streets in the gaps between building rows, the plaza, and a spur from
every built structure's door to its nearest street. Move a building in
`guild_layout.js` and its path re-routes on the next bake. One plane, one draw
call, and at the default zoom a 32px tile lands almost exactly on 32 screen
pixels.

Road widths (`MAIN_ROAD_W`, `STREET_W`, `SPUR_W`) are the single knob for how
green the compound reads.

#### Breaking up the tile grid

A first pass drew one grass tile and three dirt tiles unrotated, and the 32px
repeat was glaring. Three things fixed it, and the order of what did and did not
work is worth keeping:

1. **`_old` twins.** Every tile ships one: same palette, different noise. Free
   variants — 2 grass, 6 dirt, and an alternate for each fringe tile.
2. **Per-tile reorientation, but only where the texture allows it.** Dirt is
   isotropic noise, so all 8 orientations are safe and it is the single biggest
   win. **Grass is not isotropic** — its blades run vertically, and rotating them
   90° produced an obvious pinwheel quilt that looked considerably worse than
   plain repetition. Grass gets the horizontal mirror only; a vertical flip was
   also tried and introduced a diamond lattice. Fringe tiles are never
   reoriented, since their whole meaning is which edge the dirt is on.
3. **A low-frequency mottle** overlaid at ~6 tiles per cycle. Variants and
   mirroring break up detail at *tile* frequency, but a big field still reads as
   flat; varying brightness at a much coarser scale reads as ground unevenness
   and stops the eye locking onto the repeat.

Also tested and rejected: mixing in the separate `grass_*` tile family for more
grass variants. It has six, but its green is brighter than the `dirt_*` family's,
so the field turned into a light/dark checkerboard — worse than the problem.
Grass and fringe must come from the same family.

### Findings that changed the design

- **`idle.png` is not safe for paperdolls.** Body ships one, but most
  torso/legs/cape/weapon layers do not, so composing `idle` silently drops half a
  hero's gear. Phase 0 holds frame 0 of the `walk` sheet, which every layer has.
  Real idle motion needs either generated idle sheets or a procedural bob.
- **The dungeon's light rig cannot be reused outdoors.** Every THEMES entry
  describes an underground or dusk mood; applied unchanged the compound looked
  like a town at midnight, and its intensities clip pale plaster to flat white.
  The compound sets its own daylight rig and sky.
- **`ExtrudeGeometry` UVs are in raw model units**, so roof textures smeared
  into soft blotches until re-projected through `boxUV`.
- **The orthographic frustum is never initialised to the live viewport.**
  `dungeon_scene.js` computes its aspect once at module evaluation and only
  corrects it on a resize event, so a pane that was a different shape at load
  leaves the frustum wrong — which pinned the compound's zoom to maximum via
  `minCompoundZoom`. `resizeGuildCamera()` now sets it from the real canvas
  before framing. **This would have hit the shipping hub too**, not just the
  preview.
- **Dirt coverage is dominated by perception, not area.** A first pass with a
  packed-earth apron around every building measured a reasonable 50% dirt inside
  the walls but *looked* like a mud pit: the camera pitch foreshortens depth by
  ~0.58, and the buildings stand on the grass bands, so the ground actually
  visible between them is disproportionately road.

### Not done

- No real art — every structure is procedural placeholder geometry
- Interiors: "Enter" is a stub that reports where it would go
- No integration with `showWorldMap()`, `G.state`, or save data
