/**
 * Screen-space pixelfx: an effect played over the whole UI, not in the world
 * (the end-of-fight VICTORY! pop). One fixed canvas laid over the viewport at a
 * chunky art scale, drawn with the vendored pixelfx core, and a
 * requestAnimationFrame loop that runs only while something is playing.
 */

import { createFrame, clearFrame, createFx, composite } from '../vendor/pixelfx/core/index.js';

const live = [];
let cv = null, ctx = null, frame = null, img = null, S = 4, raf = 0, last = 0;

function ensure(scale) {
  if (typeof document === 'undefined') return false;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'screen-fx';
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60;pointer-events:none;image-rendering:pixelated;';
    document.body.appendChild(cv);
    try { ctx = cv.getContext('2d'); } catch { ctx = null; }
  }
  if (!ctx || typeof requestAnimationFrame !== 'function') return false;
  const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
  S = vw < 900 ? Math.max(2, scale - 1) : scale;
  const w = Math.ceil(vw / S), h = Math.ceil(vh / S);
  if (!frame || frame.w !== w || frame.h !== h) {
    cv.width = w; cv.height = h;
    frame = createFrame(w, h);
    img = ctx.createImageData(w, h);
  }
  return true;
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  clearFrame(frame);
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    e.fx.update(dt);
    if (e.fx.done()) { live.splice(i, 1); continue; }
    e.fx.draw(frame);
  }
  composite(frame, img.data, null);
  ctx.putImageData(img, 0, 0);
  raf = live.length ? requestAnimationFrame(tick) : 0;
  if (!raf) ctx.clearRect(0, 0, cv.width, cv.height);
}

/**
 * Play `mod` with its origin at (fx, fy), fractions of the viewport (0.5, 0.5 is
 * the centre). opts: { scale = 4 (CSS px per art px), options (the effect's own) }.
 * Returns false when there is no canvas to draw on (headless), so callers carry on.
 */
export function playScreenFx(mod, fx = 0.5, fy = 0.5, opts = {}) {
  if (!ensure(opts.scale || 4)) return false;
  live.push({ fx: createFx(mod, { ...(opts.options || {}), x: Math.round(frame.w * fx), y: Math.round(frame.h * fy) }) });
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  return true;
}

/** Drop everything now (level change). */
export function clearScreenFx() {
  live.length = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (ctx && cv) ctx.clearRect(0, 0, cv.width, cv.height);
}
