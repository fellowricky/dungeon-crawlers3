/* ── light sources ────────────────────────────────────────────────────────
   What each hero carries to see by (docs/LIGHT_AND_DARKVISION.md). One table
   for the renderer (render/dungeon_scene.js turns the active source into a
   pooled PointLight above the hero) and, later, for the bright/dim/dark
   rules, so a radius here is a radius everywhere.

   Radii are in tiles (5 ft each; the torch is 10 ft bright + 10 ft more dim)
   and they ARE the rules: like a 5e torch, a carried light makes its
   bright radius bright and its dim radius at least dim, whatever the falloff
   (render/sprite_lighting.js lightLevelAt). The PointLight only has to look
   the part: `base`/`decay`/`reach` are solved so the floor reads exactly the
   bright threshold (0.5) at the bright radius, then fades out toward the dim
   radius. A physical falloff cannot hold "dim" all the way to 8 tiles without
   flattening the pool into a disc, which is why the radii carry the rule.
   `base` is PERCEIVED brightness: the renderer divides out the colour's
   luminance, so an orange torch and a white Light with the same base light the
   floor equally. `flicker` picks the intensity wobble. */
export const LIGHT_SOURCES = {
  /* 10 ft bright, 20 ft dim (2026-10-25: was 4/8 — too strong a pool) */
  torch: {
    label: 'Torch', color: 0xff9a4a, bright: 2, dim: 4,
    base: 0.553, decay: 1, height: 2.0, reach: 6, flicker: 'torch'
  },
  /* twice a torch: 20 ft bright, 40 ft dim */
  lantern: {
    label: 'Hooded Lantern', color: 0xffc870, bright: 4, dim: 8,
    base: 1.30, decay: 1, height: 2.0, reach: 12, flicker: 'lantern'
  },
  /* A hooded lantern: a 1-tile dim glow to sneak by (bonus action toggle). */
  lanternHooded: {
    label: 'Hooded Lantern (hooded)', color: 0xffc870, bright: 0, dim: 1,
    base: 0.12, decay: 1, height: 2.0, reach: 2.5, flicker: 'lantern'
  },
  /* Driftglobe: a rare floating orb in a Kit slot — a lantern's light with
     the trinket slot left free. */
  driftglobe: {
    label: 'Driftglobe', color: 0xdff4ff, bright: 4, dim: 8,
    base: 1.30, decay: 1, height: 2.6, reach: 12, flicker: 'none'
  },
  /* One Dancing Lights wisp: the same light as a torch at half the brightness.
     Its rule radii stay the spell's 2 tiles of dim light. */
  dancingLight: {
    label: 'Dancing Light', color: 0xff9a4a, bright: 0, dim: 2,
    base: 0.2765, decay: 1, height: 2.0, reach: 6, flicker: 'torch'
  },
  /* The Light cantrip: a torch's reach, white and perfectly steady. Its real
     reward is the trinket slot it frees. */
  light: {
    label: 'Light', color: 0xe6eeff, bright: 2, dim: 4,
    base: 0.553, decay: 1, height: 2.0, reach: 6, flicker: 'none'
  }
};

/* Best first, when a hero has more than one. Light beats a torch (same reach,
   steadier white light); a lantern (twice the reach) beats both. */
const RANK = { driftglobe: 3, lantern: 3, light: 2, torch: 1, lanternHooded: 0.5 };

/* Consumable torches (docs/LIGHT_IDEAS.md 19): a torch item is a stack
   (`charges`) and each one burns this many seconds of lit time. */
export const TORCH_BURN_SEC = 300;
export const TORCH_STACK_START = 10;

/* ── virtual lights & darkness zones ──
   Lights that are rules first: bright/dim radii, drawn as a soft glow on the
   floor, never a scene PointLight (a changed light count recompiles every lit
   shader). Spells, thrown torches, burning oil register here; glowing monsters
   are read from monster_light.js each frame instead. Darkness zones are
   magical Darkness: nothing inside is lit, only Devil's Sight and blindsight
   see in or out. The renderer reads both (render/sprite_lighting.js).
   Spec: { x, z, follow?: unit, bright, dim, color?, ttl? (seconds) }. */
export const VIRTUAL_LIGHTS = new Set();
export const DARK_ZONES = new Set();
export function addVirtualLight(spec) { const L = { ...spec }; VIRTUAL_LIGHTS.add(L); return L; }
export function removeVirtualLight(L) { VIRTUAL_LIGHTS.delete(L); }
export function hasVirtualLight(L) { return VIRTUAL_LIGHTS.has(L); }
export function addDarkZone(spec) { const Z = { ...spec }; DARK_ZONES.add(Z); return Z; }
export function removeDarkZone(Z) { DARK_ZONES.delete(Z); }
export const zonePos = z => (z.follow ? { x: z.follow.x, z: z.follow.z } : { x: z.x, z: z.z });
export function inDarkZone(x, z) {
  for (const Z of DARK_ZONES) { const p = zonePos(Z); if (Math.hypot(p.x - x, p.z - z) <= Z.r) return true; }
  return false;
}
/** Age timed lights and zones; drop the expired and those whose unit died. */
export function tickLightRegistry(dt) {
  for (const S of [VIRTUAL_LIGHTS, DARK_ZONES]) for (const e of [...S]) {
    if (e.follow && e.follow.data && e.follow.data.hp <= 0) { S.delete(e); continue; }
    if (e.ttl !== undefined) { e.ttl -= dt; if (e.ttl <= 0) { S.delete(e); if (e.onExpire) e.onExpire(e); } }
  }
}
export function clearLightRegistry() { VIRTUAL_LIGHTS.clear(); DARK_ZONES.clear(); }

/** The wisps lighting the level, as carried lights for the renderer. */
export function dancingLightCarriers(heroes) {
  const out = [];
  for (const h of heroes || []) {
    if (!h.data || h.data.hp <= 0) continue;
    for (const m of h._dancingLights || []) out.push({ h: m, src: LIGHT_SOURCES.dancingLight });
  }
  return out;
}

/** The light source a hero record (h.data) sees by, or null. */
export function heroLightSource(d) {
  if (!d) return null;
  if (d._dousedT > 0) return null;          // a goblin's bucket — out until relit
  const opts = [];
  const eq = d.equipment || {};
  for (const slot of ['trinket', 'kit1', 'kit2', 'offhand', 'mainhand']) {
    const it = eq[slot];
    if (!it || !it.lightSource || !LIGHT_SOURCES[it.lightSource]) continue;
    if (it.lightSource === 'torch' && it.charges !== undefined && it.charges <= 0) continue;
    opts.push(it.lightSource === 'lantern' && d._lanternHooded ? 'lanternHooded' : it.lightSource);
  }
  if (Array.isArray(d.knownSpells) && d.knownSpells.includes('light')) opts.push('light');
  if (!opts.length) return null;
  opts.sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0));
  return opts[0];
}

/* ── light status: bright / dim / dark ──
   A hidden state on every creature (and the F4 debug overlay paints the same
   thing per floor tile). It is read from the light falling on the GROUND
   where the creature stands, the same value the floor shows, relative to the
   sprite reference (1.0 = full daylight on the PNG). The light is STEADY:
   flicker-averaged, from every source on the level, not just the pooled
   lights the camera is near (render/sprite_lighting.js lightLevelAt). It
   counts the sun and every fire, but the hemisphere sky fill only at
   `skyWeight` — 0 by default, which leaves the Hemi sliders as the scene's
   visual-brightness knob: lift a dungeon for the eye without lighting it for
   the rules. `hyst` is how far below a threshold a creature must fall to
   drop a level, so a carried torch can't make the state chatter.
   Tuned on Ancient (2026-10-25): 0.5 / 0.3 splits it about 28% bright / 34%
   dim / 38% dark, with three room centres in four dark; a lone hero torch
   reads bright to ~3.3 tiles and dim to ~4.3. Live-tunable in the dungeon
   editor's Light debug section (not saved from there — copy numbers here). */
export const LIGHT_LEVELS = { bright: 0.5, dim: 0.3, hyst: 0.8, skyWeight: 0 };
/* What a theme without its own `lightLevels` block gets. A theme (and, on an
   overland map, each time of day of it — see overland_weather.js tod) may set
   its own cut-offs; render/sprite_lighting.js applyThemeLightLevels loads them
   when a level is built. */
export const LIGHT_LEVEL_DEFAULTS = { bright: 0.5, dim: 0.3, skyWeight: 0 };

export function classifyLight(v, prev = null) {
  const { bright: B, dim: Dm, hyst: h } = LIGHT_LEVELS;
  const EPS = 1e-4;
  if (prev === 'bright' && v >= (B * (h ?? 1)) - EPS) return 'bright';
  if (v >= B - EPS) return 'bright';
  if (prev === 'dim' && v >= (Dm * (h ?? 1)) - EPS) return 'dim';
  if (v >= Dm - EPS) return 'dim';
  return 'dark';
}

/* Tile light for game rules (Shadow Step, Hide, Kindle…). The renderer owns
   the light map, so it registers a probe (render/sprite_lighting.js); with no
   scene (headless tests) every tile counts as bright. */
let _lightProbe = null;
export function setLightProbe(fn) { _lightProbe = typeof fn === 'function' ? fn : null; }
export function lightStateAt(x, z) { return _lightProbe ? _lightProbe(x, z) : 'bright'; }

/** A creature's light state, for rules. Unknown (headless sims, a unit not
 *  yet sampled) counts as bright, so nothing gets a darkness modifier it
 *  never saw coming. */
export function lightStateOf(u) {
  return (u && (u.lightState || (u.ent && u.ent.lightState))) || 'bright';
}
