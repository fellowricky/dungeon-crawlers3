/**
 * Spell lights: real light on the room and the sprites from an animation's optional `light` block. It follows the
 * projectile through its flight, then flares on landing and fades.
 *
 * Purely visual. The rules' light map reads steady sources and lights tagged `steady` or `radii` (see
 * sprite_lighting.js), and these carry neither, so a spell never changes a tile's bright/dim/dark.
 *
 * Every light is borrowed from the fixed pool in entities.js, because a change in the scene's light count recompiles
 * every lit shader. When the pool is dry the spell plays unlit.
 */
import { acquirePooledLight, releasePooledLight } from './entities.js';

/** What a newly lit animation starts from. Intensities are three.js point-light units, ranges are tiles. */
export const LIGHT_DEFAULTS = {
  enabled: true, color: '#ffffff', travel: 2, travelRange: 5, impact: 4, impactRange: 7, fade: 0.35, flicker: 0.15, delay: 0,
};
const LIFT = 0.3;          // above the effect's centre, so the floor gets a pool of light and not a hot spot
const RISE = 0.08;         // seconds to come up, so a light doesn't pop on

const active = [];

/** The animation's light settings, or null if it has none or they're switched off. */
export function lightDefOf(anim) {
  const def = anim && anim.light;
  return def && def.enabled !== false ? { ...LIGHT_DEFAULTS, ...def } : null;
}

function borrow(scene, def, pos) {
  const light = acquirePooledLight(scene);
  if (!light) return null;
  const h = { light, scene, def, mode: 'travel', t: 0, phase: Math.random() * 6.28 };
  light._owner = h;
  light.color.set(def.color);
  light.decay = 2;
  light.position.set(pos.x, pos.y + LIFT, pos.z);
  active.push(h);
  return h;
}

function setup(h, peak, range) {
  h.peak = peak;
  h.light.distance = range;
}

/** Start the light that travels with a projectile. Returns its handle, or null if it plays unlit. */
export function startTravelLight(scene, def, pos) {
  if (!(def.travel > 0)) return null;
  const h = borrow(scene, def, pos);
  if (h) setup(h, def.travel, def.travelRange);
  return h;
}

/** Move a travelling light with its projectile. */
export function moveSpellLight(h, pos) {
  if (h) h.light.position.set(pos.x, pos.y + LIFT, pos.z);
}

function retire(h) {
  const i = active.indexOf(h);
  if (i >= 0) active.splice(i, 1);
  if (h.light._owner === h) releasePooledLight(h.scene, h.light);
}

/** Flare at the landing, reusing the travelling light if there was one. `delay` holds the flare back to the effect's
 *  bright moment (Cure Wounds' heal lands 0.74s in), keeping the light dark and its pool slot held until then. */
export function flareSpellLight(scene, def, pos, h = null) {
  if (!(def.impact > 0)) { if (h) retire(h); return; }
  if (!h) h = borrow(scene, def, pos);
  if (!h) return;
  h.mode = def.delay > 0 ? 'wait' : 'flare';
  h.t = 0;
  h.light.position.set(pos.x, pos.y + LIFT, pos.z);
  setup(h, def.impact, def.impactRange);
  if (h.mode === 'wait') h.light.intensity = 0;
}

/** Advance every spell light. Called from updateCompositeFX. */
export function updateSpellLights(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const h = active[i];
    if (h.light._owner !== h) { active.splice(i, 1); continue; }   // the pool took it back (a new scene)
    h.t += dt;
    if (h.mode === 'wait') {
      if (h.t < h.def.delay) continue;
      h.mode = 'flare';
      h.t = 0;
    }
    let k = Math.min(1, h.t / RISE);
    if (h.mode === 'flare') {
      const u = h.t / Math.max(0.01, h.def.fade);
      if (u >= 1) { retire(h); continue; }
      k = (1 - u) * (1 - u);
    }
    const f = h.def.flicker * (Math.sin(h.t * 31 + h.phase) * 0.6 + Math.sin(h.t * 67 + h.phase * 2) * 0.4);
    h.light.intensity = Math.max(0, h.peak * k * (1 + f));
  }
}

/** How many spell lights are live, for tests and the performance overlay. */
export const activeSpellLights = () => active.length;
