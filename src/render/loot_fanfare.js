/**
 * Loot fanfare — pixelfx effects played over the loot cards as they flip,
 * scaled to the rarity. Screen-space (two canvases over the reveal overlay:
 * one behind the cards, one in front), drawn with the vendored pixelfx core
 * at a chunky art scale so it matches the game's pixel art.
 *
 *   common     a small grey sparkle burst
 *   uncommon   the burst in green
 *   rare       the burst in blue, and a short turn of rays behind the card
 *   epic       the burst, rays that linger, and a pillar of light behind the card
 *   legendary  all of that in gold, the rays and pillar for as long as the cards
 *              are up, and confetti over the top
 *
 * Runs its own requestAnimationFrame loop only while something is playing (the
 * game is paused under the reveal).
 */

import { createFrame, clearFrame, createFx, composite } from '../vendor/pixelfx/core/index.js';
import * as burstFx from '../vendor/pixelfx/fx/pickups/collect-burst.js';
import * as beamFx from '../vendor/pixelfx/fx/pickups/loot-beam.js';
import * as raysFx from '../vendor/pixelfx/fx/holy/sunburst.js';
import * as confettiFx from '../vendor/pixelfx/fx/ui/confetti.js';
import { GOLD } from '../vendor/pixelfx/fx/holy/_lib.js';
import { rampFrom } from './pfx/ramps.js';

const BURST_CY = 30;                 // collect-burst's flash sits 30 art px over its origin
const RAYS_LIFE = [0, 0, 1.4, 2.6];  // seconds a tier's rays turn before fading (legendary: until cleared)
const RAYS_REACH = [0, 0, 1.7, 2.0, 2.4]; // how far the rays reach past a card (sunburst `reach`, vendored fork)

/** What a card of tier 0..4 (common..legendary) plays as it turns face up. */
export function fanfareRecipe(tier) {
  return {
    burst: true,
    rays: tier >= 2,
    raysLife: tier >= 4 ? Infinity : RAYS_LIFE[tier] || 0,
    beam: tier >= 3,
    confetti: tier >= 4,
    shake: tier >= 4,
  };
}

function hexNum(c) {
  const n = parseInt(String(c || '#b4b0a4').replace('#', ''), 16);
  return Number.isNaN(n) ? 0xb4b0a4 : n;
}

/**
 * back / front: canvases laid over the viewport. scale: CSS px per art px.
 * Returns { play(tier, color, rect), clear(), resize() }.
 */
export function createFanfare(back, front, { scale = 3 } = {}) {
  const ctxOf = (cv) => { try { return cv && cv.getContext && cv.getContext('2d'); } catch { return null; } };
  /* No 2D canvas (jsdom, a locked-down browser): the cards still flip, just without fanfare. */
  if (!ctxOf(back) || !ctxOf(front) || typeof requestAnimationFrame !== 'function') {
    return { play: (tier) => fanfareRecipe(tier), clear() {}, reset() {}, resize() {} };
  }
  const layers = [back, front].map((cv) => ({ cv, ctx: cv.getContext('2d'), frame: null, img: null, fx: [] }));
  const [B, F] = layers;
  let S = scale, raf = 0, last = 0;

  function resize() {
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 720;
    S = vw < 900 ? Math.max(2, scale - 1) : scale;
    const w = Math.ceil(vw / S), h = Math.ceil(vh / S);
    for (const L of layers) {
      if (L.frame && L.frame.w === w && L.frame.h === h) continue;
      L.cv.width = w; L.cv.height = h;
      L.frame = createFrame(w, h);
      L.img = L.ctx.createImageData(w, h);
    }
  }

  function add(L, mod, opts, life = Infinity) {
    L.fx.push({ fx: createFx(mod, opts), life });
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    let any = false;
    for (const L of layers) {
      clearFrame(L.frame);
      for (let i = L.fx.length - 1; i >= 0; i--) {
        const e = L.fx[i];
        e.fx.update(dt);
        if ((e.life -= dt) <= 0) { e.fx.stop(); e.life = Infinity; }
        if (e.fx.done()) { L.fx.splice(i, 1); continue; }
        e.fx.draw(L.frame);
      }
      composite(L.frame, L.img.data, null);
      L.ctx.putImageData(L.img, 0, 0);
      if (L.fx.length) any = true;
    }
    raf = any ? requestAnimationFrame(tick) : 0;
  }

  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  return {
    /** A card turned face up. rect: its DOMRect (viewport px). */
    play(tier, color, rect) {
      resize();
      const R = fanfareRecipe(tier);
      const palette = rampFrom(hexNum(color));
      const cx = (rect.left + rect.width / 2) / S, cy = (rect.top + rect.height / 2) / S, foot = rect.bottom / S;
      const seed = Math.floor(Math.random() * 1000);
      if (R.beam) add(B, beamFx, { x: cx, y: foot + 6, palette, seed, noItem: true });
      if (R.rays) add(B, raysFx, { x: cx, y: cy, palette: tier >= 4 ? GOLD : palette, rays: tier >= 4 ? 10 : 8, reach: RAYS_REACH[tier], seed }, R.raysLife);
      if (R.burst) add(F, burstFx, { x: cx, y: cy + BURST_CY, palette, seed });
      if (R.confetti) add(F, confettiFx, { x: cx, y: rect.top / S + 20, seed });
      run();
      return R;
    },
    /** Fade everything out (the reveal is closing). */
    clear() {
      for (const L of layers) for (const e of L.fx) e.fx.stop();
    },
    /** Drop everything now. */
    reset() {
      for (const L of layers) L.fx.length = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const L of layers) if (L.frame) { clearFrame(L.frame); L.ctx.clearRect(0, 0, L.cv.width, L.cv.height); }
    },
    resize,
  };
}
