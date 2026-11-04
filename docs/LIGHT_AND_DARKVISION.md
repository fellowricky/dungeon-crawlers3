# Light, Darkness & Darkvision — design

Status: **phases 1–2 built (2026-10-25)**:
- **Phase 1:** light sources, the starting torch, the *Light* cantrip, and darkvision flags.
- **Phase 2:** the hidden bright/dim/dark status on every creature, plus the F4 debug view.

Phases 3–5 not started.

## Why

Sprites are now lit like the floor (`src/render/sprite_lighting.js`). On dark maps,
enemies vanish into the shadows, and Zenu likes that. Light becomes a resource: what you
can see depends on what you carry, which spells you know and what race you are.

## Light levels: a hidden status on every creature

Every hero and monster carries a hidden light state:

- **bright**
- **dim**
- **dark**

It doesn't show in the status tray. It comes from the same per-unit light value that
`sprite_lighting.js` already computes for shading, so the rules and the picture always
agree. A unit that *looks* black is "in darkness".

- **Hysteresis:** small, so torch flicker can't make the state toggle every frame. Read
  the smoothed value, not the instantaneous one.
- **Overland in daytime:** everything is bright, so none of this matters there. It
  matters in dungeons and at night.
- **Combat hook:** the existing `invisible` condition (`src/game/conditions.js`) already
  makes a creature "unseen" in attack logic. Darkness should feed that same path, not
  duplicate it.

Effects the state can drive (pick per phase):

- **Attacking a target in darkness you can't see:** disadvantage.
- **An attacker you can't see:** they get advantage against you.
- **Hide:** rogue Cunning Action and stealth checks are allowed only in dim or dark.
- **Monster traits (later):**
  - sunlight/light sensitivity (kobolds, drow) gives disadvantage in bright light;
  - shadow-type creatures get stronger in the dark;
  - undead weaken in bright light.
- **Spells (later):**
  - Faerie Fire outlines a target and cancels the dark benefits;
  - Darkness / Daylight change the light level of an area.
- **Monster AI (later):**
  - monsters with darkvision prefer to stay in the dark;
  - a lit hero is noticed from further away.

## Light sources

| Source | Bright / dim radius | Look | Notes |
|---|---|---|---|
| Torch | **2 / 4 tiles** (10 ft bright + 10 ft dim) | orange, flickering | every hero starts with one |
| Hooded lantern | **4 / 8 tiles** (twice a torch) | warm yellow, steady | shop upgrade |
| *Light* cantrip | **2 / 4 tiles** (same as a torch) | white, steady, no flicker | Bard, Cleric, Sorcerer, Wizard; no spell slot; lasts the whole floor (auto-cast on entry) |

- **The slot is the trade-off.** A torch or lantern takes the **Trinket** slot, the
  same slot that holds a scroll or potion. Learning *Light* frees it, which is the
  cantrip's real reward.
- **Torches are infinite for now.** *Noted for later:* make them a consumable stack (up
  to 99) that burns down over time while lit.
- **Replaces the leader's lantern.** Today one invisible "lantern" (`heroLight` in
  `dungeon_scene.js`) follows the party leader. It goes away; the heroes' own sources
  replace it.
- **Lights must come from a fixed pool.** Each hero's light is a real PointLight. They
  have to be allocated when a floor is built, never added mid-floor: a changed light
  count recompiles every lit shader and freezes the game for seconds. On Low graphics,
  nearby party lights can merge.

## Darkvision

> **Removed for heroes (2026-10-26).** The greyscale look read badly, so no hero race
> has darkvision any more and the visuals below are gone (the post-pass zone, the
> per-sprite grey uniform, `darkvisionRange()`). Every party now needs a light. Monster
> darkvision is unchanged, and so is the warlock's Devil's Sight (rules only, no
> visual). The notes below are kept as a record of what was built.

- **Rare by design.** 5e hands it to almost everyone; here it's limited to:
  - **Dwarf** (underground)
  - **Tiefling** (infernal)
- **No colour.** Within range (about 6 tiles), darkness counts as dim light, seen in
  greyscale. It emits no light, so a darkvision hero isn't lit up for monsters.
- **Visuals:**
  - **Units** seen only through darkvision are drawn in greyscale at readable brightness
    (per-unit sprite uniform, next to the existing light and fog values).
  - **Environment:** a screen-space post effect around each darkvision hero lifts and
    desaturates dark pixels, fading at the edge of range. The result is a grey zone in
    the black, with colour wherever a real light shines. The final pass already tracks
    screen points (combat focus), so the effect fits there.
- **Monsters** already carry darkvision ranges in `monsters.json`, so the dark is
  asymmetric: many of them see you whether or not you see them.

## What phase 1 built

- **Data:** `src/game/light_sources.js` holds the source table (radius, colour, strength,
  flicker), plus `heroLightSource()` (lantern > Light > torch) and `darkvisionRange()`.
- **Items:** Torch and Hooded Lantern are trinket bases in `items.json`:
  - marked `lightSource` and `noDrop`;
  - `isLightSource()` identifies them, and `makeLightSourceItem()` builds them;
  - they are kept out of loot rolls and out of the consumable paths;
  - item text reads "Light: bright to N tiles, dim to M".
- **Torch for everyone:** `makeHero` equips a torch. Older saves get one through
  `normalizeHero`:
  - equipped if the trinket slot is free;
  - otherwise owed to the bag, which `game.js` pays out on load.
- **Lantern:** always stocked by the between-floor merchant.
- ***Light* cantrip:** `SPELLS.light`, `passive` (never cast). It is in the tier-1 pools
  of bard, cleric, sorcerer and wizard, so learning it costs a level-1 spell pick. AI
  scoring and the manual action menus skip passive spells.
- **Party lights:** 4 fixed PointLights in `dungeon_scene.js` (`partyLights`,
  `updatePartyLights`) replace the leader's lantern.
  - Each is assigned to a hero who carries a light, leader first.
  - They're on in dungeons; on an overland, only when `heroLightNeeded`.
  - Heroes within 3 tiles of each other share brightness (1/sqrt of the crowd), so a
    bunched party doesn't bleach the floor.
- **Darkvision:** `RACES.dwarf.darkvision` and `RACES.tiefling.darkvision` were both 6
  (since removed — see *Darkvision* above).

## What phase 2 built

- **Status:** `lightLevelAt(x, y, z)` in `src/render/sprite_lighting.js` measures the
  light on the ground at a spot exactly as the floor is lit: normal up, plain
  Lambert, sun through the wall-shadow march, every point light. Each frame, every
  hero and monster gets:
  - `u.lightLevel`, the smoothed value (≈ 0.25 s);
  - `u.lightState`, one of `'bright'`, `'dim'` or `'dark'`.

  This runs whether or not the creature is visible. Rules read the state through
  `lightStateOf(u)` in `src/game/light_sources.js`; an unknown creature counts as
  bright.
- **Thresholds:** `LIGHT_LEVELS` in `light_sources.js`.
  - Bright at **≥ 0.35**; dim at **≥ 0.05**; dark below that.
  - A creature must fall to **80%** of a line before it drops a level (`hyst`), so
    torch flicker can't make the state chatter.
  - Reference values: sunny overland ≈ 2.4; dungeon open floor ≈ 0.5–0.7; dungeon
    wall shadow ≈ 0.2; moonlight ≈ 0.3; night shadow ≈ 0.02; a torch is bright
    within about 4 tiles and dim out to about 7.
- **Debug view (F4):**
  - Every floor tile is tinted by its state: yellow = bright, blue = dim,
    red = dark. Tiles are re-sampled 4× a second.
  - Each creature's contact shadow becomes a ring in its own state's colour.
  - A legend shows bottom-left.
  - Console helpers:
    - `__lightDebug(true|false)` switches the view on or off;
    - `__lightAt(x, z)` returns `{ level, state }` for any spot;
    - `__partyLights()` reports the party lights;
    - `__lightSources` is the live source table, editable while playing.

## Steady light map (2026-10-25)

- **What the rules read:** steady light, not what the GPU draws this frame.
  - The visuals use a small pool of real lights (6/10/16 by graphics quality), handed
    each frame to the wall torches nearest the camera, with flicker.
  - The rules (`lightLevelAt`) read every wall torch, candle and brazier on the level
    (`steadyLightSources()` in `dungeon_scene.js`, cached per level) at its
    flicker-averaged strength (torch/brazier ×0.78, candle ×0.82).
  - They also read any light publishing `userData.steady`: key lights, campfires and
    party lights. Pooled torch lights and spell flashes are skipped.
  - So a tile's state never changes with flicker, camera position or graphics
    quality. There's no easing; a carried torch updates its status the same frame.
- **Thresholds** raised 10%: bright **≥ 0.385**, dim **≥ 0.055**.
- **Finding:** each dungeon level has about 100 wall torches reaching 13–25 tiles
  (`torchPoolRange`). Counting them all, wall light alone puts a typical tile at about
  0.3, and with the sky/sun fill Ancient's darkest tile is 0.46. So dungeons are
  bright everywhere by these rules. The levers for pockets of dark:
  - shorter wall-torch reach (about 6–8 tiles, like a carried torch);
  - walls blocking the sky fill;
  - a lower dungeon sky/sun baseline.

  Shorter reach also lets the visual pool cover every torch that matters, so the
  picture and the rules agree.

## Tuning pass on Ancient (2026-10-25)

- **The rules ignore the sky fill** (`LIGHT_LEVELS.skyWeight = 0`). The Hemi sliders are
  now the scene's visual-brightness knob: they brighten the picture without lighting
  anything for the mechanics. The sun and every fire still count.
- **Thresholds:** bright **≥ 0.5**, dim **≥ 0.3**. On Ancient (Zenu's tuning) this
  splits about 28% bright / 34% dim / 38% dark, with about 75% of room centres dark.
  - A lone hero torch reads bright to about 3.3 tiles and dim to about 4.3, narrower
    than the design's 4/8.
  - Grim, Molten, Frost and Verdant still read 80–95% bright. They haven't been
    retuned like Ancient yet, and their sun is 4–9× stronger.
- **Editor:** the Light debug section has **Bright at ≥ / Dim at ≥ / Sky fill counts /
  Darkness shading** sliders. Since 2026-10-26 they are saved per theme as
  `lightLevels: { bright, dim, skyWeight, darkCue }` in `theme_overrides.json`, and on
  overland themes per time of day (`tod.day|dusk|night.lightLevels`). `buildScene` loads
  them for each level (`applyThemeLightLevels`); anything unset falls back to
  `LIGHT_LEVEL_DEFAULTS` (0.5 / 0.3 / 0) and a darkness shading of 0.8.
- **Torch intensity slider fixed.** Wall torches used a fixed `max(1.8, …)` and ignored
  `torchLight[1]`. They now use it.
  - Every theme's stored value (14 defaults + 4 overrides) was set to the 1.8 actually
    drawn, so nothing changed on screen.
  - Torch range was already live. It is scaled by about 1.68 internally (`TORCH_R_K`),
    so a slider value of 12 reaches about 20 tiles.

## Carried lights by radius + hero card badge (2026-10-25)

- **Radii are the rule for carried lights** (torch, lantern, *Light*). As in 5e,
  within `bright` tiles a spot is at least bright, and within `dim` tiles at least
  dim: torch/Light 4/8, lantern 6/12. The fires on the level still count by their
  steady light; the carried light takes the higher of the two.
  - A physical falloff can't stay "dim" out to 8 tiles without flattening the pool
    into a disc, so the radii carry the rule.
  - The visible pool is strengthened so the floor reads exactly the bright threshold
    (0.5) at the bright radius:
    - torch/Light: base 1.30, reach 12;
    - lantern: base 2.19, height 2.5, reach 18.

    Past the bright radius it fades: about 0.22 at 6 tiles, 0.09 at 8.
- **Hero cards** show the light each hero stands in, next to the level:
  ☀️ bright, ⛅ dim, 🌙 dark, with a tooltip.
  - It's refreshed every frame by `updatePartyLightBadges`, touching the page only
    on change.
  - It's read from `h.data._lightState`, which `heroSaveRecord` keeps out of saves.

## Making dim vs dark readable (2026-10-25)

The rules ignore the sky fill, but the picture keeps it, so dim and dark looked alike
with F4 off. There are two cues, both driven by the shared level light map
(`sprite_lighting.js`).

The **light map** is `lightLevelAt` at every walkable tile.
- The static part (sun, sky at `skyWeight`, the level's fires) is cached until the
  level or the lighting settings change.
- Key lights, campfires and carried lights are layered on top 5× a second.
- F4 paints from the same map.

**Darkness shading** (`DARK_CUE`, `window.__darkCue`) is a multiply tint on the floor,
blended across tiles.

| State | Shading (linear, at strength 1) |
|---|---|
| Bright | none |
| Dim | slightly cooler (×0.86/0.88/0.94) |
| Dark | darker cool blue-grey (×0.52/0.58/0.80) |

- Default strength is 0.8. It's tunable in the editor (**Darkness shading**); global,
  not saved.
- Amount steps up a little at each threshold, so the boundary reads.
- Floor only; walls and props keep their look. Hidden outside a crawl.

**Hover hint:** in manual mode the move and attack tooltips add a small ⛅ or 🌙 after
the text. Nothing appears in bright light.
- For the move tooltip, it's the destination tile.
- For targets and attacks, it's the creature's own state.

## Torch reduced (2026-10-25)

The held torch is now **10 ft bright + 10 ft dim**: bright to 2 tiles, dim to 4.
- Visible pool re-solved: base 0.553, reach 6. The floor reads 0.5 at 2 tiles and
  about 0.11 at 4; under the hero it's about 1.1, down from 2.6.
- The *Light* cantrip (4/8) and the lantern (6/12) are unchanged, so both are now
  real upgrades over a torch.

## Light sources rebalanced (2026-10-25)

- **Torch:** 2/4.
- ***Light*:** 2/4. Same reach as a torch; its reward is the free trinket slot.
- **Lantern:** 4/8 (base 1.30, reach 12), twice a torch.

## Backlog: light from spells and monsters (not built)

Emitters should be rules-first: radii, as carried lights already work. Visuals come from
pooled lights or an additive glow sprite, never a new PointLight (see
[[pointlight-count-shader-recompile]]). Instant flashes (Fireball, Sunburst, Call
Lightning, Fire Storm, Prismatic Spray) shed no lasting light; the rules already ignore
spell flashes.

**Spells already in the game:**

| Spell | Light | Notes |
|---|---|---|
| Moonbeam | dim in its beam | |
| Flaming Sphere | bright 2 / dim 4 around the sphere | moves with it |
| Faerie Fire | targets shed dim light (1–2 tiles) | Should also cancel darkness benefits: an outlined target can't hide in the dark. Strong phase-4 synergy. |
| Sunbeam | bright light around the caster for the duration | |
| Wall of Fire | bright 1 / dim 2 along the wall | design call; 5e is silent |
| Guiding Bolt | target glimmers with dim light until it's hit | |

**5e light spells worth adding:**
- Dancing Lights (cantrip): movable dim lights.
- Continual Flame: a permanent torch-like light.
- Daylight: a big bright area that dispels magical darkness.
- Darkness: the inverse, a zone that forces dark.

**Rejected:** druids shedding light from Produce Flame for free. Every light source must
have a cost.

**Monsters (ids in `monsters.json`).** Glow is rare on purpose: a glowing monster gives
itself away in the dark.

| Group | Monsters | Light |
|---|---|---|
| 5e illumination | will-o-wisp | bright/dim, 1–4 tiles |
| | fire-elemental | 6/12 |
| | magmin, ember-magmin | 2/4 |
| | azer | 2/4 |
| | giant-fire-beetle | 2/4 |
| | phoenix | large |
| | salamander, ember-swarm-chief | fire-themed, small |
| Ghostly dim (Zenu's call) | ghost, specter, banshee | dim 1–2 tiles, cold pale colour |
| | wraith, freezing-wraith | optional |
| Shadow creatures: no glow | shadow, shadow-wraith, shadow-fiend, shadow-dragon | Should profit from darkness instead (hide in dim/dark, weakened in bright light) |

## Build order

1. Light sources:
   - torch, lantern and *Light* as pooled per-hero lights, replacing the leader lantern;
   - starting torch for every hero;
   - darkvision on dwarf and tiefling.
2. Hidden light status (bright / dim / dark) on all creatures, read from the sprite
   light sampler.
3. Darkvision visuals (greyscale units + the environment zone).
4. Combat effects through the `invisible` path (disadvantage/advantage), then Hide.
5. Later: monster light traits, light-related spells, AI preferences, consumable torches.

## Open questions

- Exact radii in tiles. The ones above are 5e's numbers at 5 ft per tile; tune in play.
- Should darkness affect combat from phase 1, or only after the visuals are in?
