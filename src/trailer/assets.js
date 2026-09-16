/**
 * TRAILER ASSET GATES — everything that must be resident before a frame is
 * allowed to advance.
 *
 * Three independent async sources feed a dungeon frame, and only one of them
 * reports through a single channel:
 *
 *   1. GLB props, tile atlases, monster/VFX sprites — all use loaders built
 *      without an explicit manager, so they report to THREE.DefaultLoadingManager.
 *   2. LPC hero paperdolls — sprite_animator.js composes these from raw
 *      `new Image()` loads, which bypass the manager entirely. They have to be
 *      pre-warmed through HeroSprite.loadState().
 *   3. Shader programs — textures being resident does not mean the material
 *      has compiled. First draw of a new theme hitches without compileAsync().
 *
 * Gate 1 has a wrinkle: registerProp() in dungeon_scene.js calls buildScene(D)
 * when a tree GLB lands, and biome props are kicked off fire-and-forget at
 * module import. A tree resolving mid-shot silently rebuilds the level and
 * restarts the rise animation on camera. So props are gated before frame 0,
 * always.
 */
import * as THREE from 'three';
import { renderer, scene, cam, registeredProps } from '../render/dungeon_scene.js';

/* ---------------- DefaultLoadingManager idle ---------------- */

/* three's LoadingManager keeps itemsLoaded/itemsTotal in closure scope, so the
   only way to know whether anything is in flight is to observe the callbacks.
   These hooks are installed once and chain to whatever was already there. */
let mgrActive = false;
let mgrWaiters = [];

(function installManagerHooks() {
  const mgr = THREE.DefaultLoadingManager;
  const prevStart = mgr.onStart, prevLoad = mgr.onLoad, prevError = mgr.onError;

  mgr.onStart = (...a) => { mgrActive = true; if (prevStart) prevStart(...a); };
  mgr.onLoad = (...a) => {
    mgrActive = false;
    const w = mgrWaiters; mgrWaiters = [];
    for (const r of w) r();
    if (prevLoad) prevLoad(...a);
  };
  mgr.onError = (...a) => { if (prevError) prevError(...a); };
})();

/** Resolve once no manager-tracked load is in flight. */
export function loadersIdle({ timeout = 30000 } = {}) {
  if (!mgrActive) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    mgrWaiters.push(() => finish(true));
    setTimeout(() => {
      if (!done) console.warn('[trailer] loadersIdle timed out — continuing anyway');
      finish(false);
    }, timeout);
  });
}

/* ---------------- prop settle ---------------- */

/**
 * Biome prop GLBs start loading at module import, before this module can hook
 * anything, so the manager may report idle while they are still in flight.
 * Instead watch registeredProps() until the count stops growing — an honest
 * heuristic that also covers props that failed and will never resolve.
 */
export async function propsSettled({ stableMs = 500, timeout = 30000, poll = 60 } = {}) {
  const t0 = Date.now();
  let last = -1, stableSince = 0;
  for (;;) {
    const n = registeredProps().length;
    const now = Date.now();
    if (n !== last) { last = n; stableSince = now; }
    else if (now - stableSince >= stableMs) return n;
    if (now - t0 > timeout) {
      console.warn(`[trailer] propsSettled timed out at ${n} props — continuing anyway`);
      return n;
    }
    await new Promise(r => setTimeout(r, poll));
  }
}

/* ---------------- shader precompile ---------------- */

/** Compile every program the current scene needs, before it is ever drawn. */
export async function compileScene() {
  if (!renderer || !renderer.compileAsync) return false;
  await renderer.compileAsync(scene, cam);
  return true;
}

/* ---------------- combined gate ---------------- */

/**
 * The gate to call before releasing the clock: props resident, textures
 * resident, shaders compiled. Safe to call every beat — it is nearly free once
 * everything is already cached.
 */
export async function gateReady({ props = true, label = '' } = {}) {
  const t0 = performance.now();
  if (props) await propsSettled();
  await loadersIdle();
  await compileScene();
  const ms = performance.now() - t0;
  if (label) console.log(`[trailer] gate "${label}" cleared in ${ms.toFixed(0)}ms`);
  return ms;
}
