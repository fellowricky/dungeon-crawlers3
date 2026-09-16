# Trailer rig

A filming harness for the game's own renderer. Open `/trailer.html` on the dev
server. It never calls `game.init()` — it forges real dungeons with the shipping
scene code and drives the visual half of the frame itself, the same way
`src/dungeon_editor.js` does.

## Why it looks the way it does

Three properties of the existing code make the "party stands still while the
world changes" shot nearly free:

- `disposeLevel()` only tears down the level `group`. A party parented to
  `scene` survives a rebuild untouched.
- `buildScene()` already plays a staggered per-instance rise. So the transition
  between environments is not a cut — the new world grows up around the party.
- `HeroSprite` composes gear from `hero.equipment` and caches by a full visual
  signature, so gear changes are a texture-cache hit once pre-warmed.

## Modules

| File | Owns |
|---|---|
| `clock.js` | Fixed-timestep clock. Nothing reads wall time. |
| `assets.js` | Load gates: prop GLBs, `DefaultLoadingManager`, shader precompile. |
| `party.js` | Hero creation, formation, marching, screen-space facing, gear. |
| `stage.js` | Level forge/swap, walk path, camera orbit + leader lock. |
| `capture.js` | `gl.readPixels` → numbered PNGs. |
| `director.js` | Preflight, then the frame loop. |
| `shots.js` | **Data only.** New shots go here and nowhere else. |

## The one idea

`clock.t` is never derived from `performance.now()`. Frame *n* is always at
`n/fps` seconds no matter how long the machine took. That makes an asset stall
free: the director simply `await`s the gate mid-loop, and because the scene
update and the frame write both happen inside one `step()`, they cannot drift
apart. There is no pause/unpause to coordinate.

Preview mode adds `pace: true`, which only ever *delays* — a paced preview and
an unpaced render emit the identical frame sequence.

## Shots

| Shot | What it is |
|---|---|
| `biome_tour` | 9 biomes, 3s each, 27s at 30fps. One continuous orbit. |
| `swap_test` | Two biomes, 4s each, 8s at 60fps. The proving shot. |
| `swap_quick` | Same at 720p/30fps — for eyeballing a change fast. |

3s is about the floor for a beat: the rise animation runs ~2.15s (`animEnd`
plus the tail), so a shorter beat cuts to the next biome before this one has
finished building itself.

## Rendering out

Hit **Render to PNG**. Frames land in `trailer_out/<shot>/` via the
`/api/trailer-frame` dev middleware (dev server only; `trailer_out/` is
gitignored). The page prints the `ffmpeg` line to reassemble them.

**Render MP4** is the normal path: frames are piped straight into a server-side
ffmpeg and never touch disk as images, so a 27s tour costs tens of MB instead of
the ~3.6 GB the equivalent PNG sequence would. It also removes the manual ffmpeg
step — the file lands at `trailer_out/<shot>.mp4`.

**PNG frames** still dumps a numbered sequence, for when the individual stills
are the point (capsule art, thumbnails). Budget disk first: a 1080p PNG frame is
~4.6 MB, so `biome_tour` at 810 frames is ~3.6 GB.

Throughput notes, measured rather than assumed:
- JPEG intermediates instead of PNG were the single biggest win (112ms -> 28ms
  per frame to encode, and ~7x less to push over the wire). The frames are
  re-encoded to H.264 anyway, so a lossless intermediate bought nothing.
- The vertical flip is done by ffmpeg (`-vf vflip`), not by a JS pass over two
  million pixels.
- NVENC is the default and measured faster AND smaller than libx264 here.

## Themes

Only five are real dungeons: `ancient molten frost grim verdant` (that is
`THEME_KEYS`), and `biome_tour` films all five. The other nine are **overland**
surfaces, and the tour films only the four that are finished art — `forest`,
`snowfield`, `mire`, `sporewood`. `moor`, `holdfast`, `boneyard`, `ruinfield`
and `ashfield` are cut on polish grounds; the rig films them fine, so putting
one back is one line in `BIOME_TOUR`.

Overland surfaces generate differently — `forest`, for instance, always emits
exactly four zones, ignores `roomCount`, renders its walls as trees, and makes
every zone a centrepiece type (entrance / shrine / treasure / boss). There is no plain room to film in.
Five of the overland themes name a `threshold` dungeon they are the doorstep of
(boneyard→grim, ruinfield→ancient, ashfield→molten, snowfield→frost,
sporewood→verdant), which is a ready-made structure for a progression montage.
Two of those pairs survive the cut (snowfield→frost, sporewood→verdant); the
tour reaches `ancient`, `molten` and `grim` straight from the beat before.

## Picking where to film

`Stage.pickRoom` scores every room x every lane through it, and takes the best.
It is scored, not filtered — an earlier tiered version took the first tier that
produced a clean lane and reliably chose a cramped 9x10 chamber over a good
room. Weights are in one object at the top of the function; the terms are
clipping, centrepiece rooms, rooms too small for the crossing, floor area,
and distance from the room's centre line.

The lane offset is what makes a centrepiece room survivable: walking the centre
line of an entrance zone goes straight through the platform ring, walking a lane
beside it puts the ring in frame as scenery. On the overland themes there is no
other option.

Walk speed is fitted to the room that got picked, so the party arrives at the
far side as the beat ends rather than marching into a wall. If a beat reports a
speed well under its requested one, the shot is asking for a longer crossing
than the level can offer — shorten the beat rather than fighting it.

## Gotchas already handled

- The canvas carries gameplay pointer handlers — wheel rewrites `cam.zoom`
  (clamped 0.36–7.8). `lockInput()` makes it inert; without it a stray scroll
  silently ruins a take.
- `makeHeroMesh` attaches an HP ring, status tray and turn highlight. Hidden by
  default via `party.showHud(false)`.
- Sprites anchor at the feet, so the camera aims at `focusHeight`, not the floor.
- `reloadAll()` fires its promises and discards them — always `await
  loadState()` directly when pre-warming.
- LPC rows are picked by projecting travel through the camera, so facing stays
  correct as the orbit swings past the diagonals.
- The heading is locked for the whole shot. Re-deriving it per room snaps the
  camera-to-party angle at a beat boundary and reads as a cut even though the
  yaw never skipped a radian. See `resolveHeading`.
- `scene` outlives a run, so `runShot` sweeps orphaned parties (`clearParties`)
  before adding one. Without it a second Preview leaves the first party standing
  frozen while the new one walks off.
- `NON_BLOCKING` is an allowlist of flat props. Anything unknown counts as solid
  — a wrong guess there puts a hero waist-deep in a coffin on camera.
- `pathCost` tests only the formation slots the live party occupies. Testing the
  whole `FORMATION` table demands a lane wide enough for six to film four, which
  rejects every plain room in a pillared dungeon.
