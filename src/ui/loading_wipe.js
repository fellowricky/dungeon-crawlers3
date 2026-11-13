/**
 * Wipe out of the loading curtain.
 *
 * Three pixelfx screen transitions, each 320×180: a circle, a fire eating in
 * from the edges, and a blade cut. One is chosen at random. The canvas sits
 * above the curtain. While a wipe is open the curtain shows through.
 * `onCover` runs once the frame is solid, which is when the curtain can
 * disappear. Iris and slash then open onto the floor.
 *
 * Burn away does not open again. Flat black the fire has already eaten is
 * punched out and clipped off the curtain, so the game shows there. The
 * loading art stays in the middle until the fire reaches it. A CSS mask
 * image is not used: an unloaded mask hides the whole curtain, and the
 * game would show through the hole at the first frame.
 *
 * `cover` is the solid frame, from each effect: iris SHUT, burn-away COVER,
 * slash-wipe just after the blade has crossed.
 */

import { createFrame, clearFrame, createFx, composite } from '../vendor/pixelfx/core/index.js';
import * as iris from '../vendor/pixelfx/fx/transitions/iris.js';
import * as burnAway from '../vendor/pixelfx/fx/transitions/burn-away.js';
import * as slashWipe from '../vendor/pixelfx/fx/transitions/slash-wipe.js';

const W = 320;
const H = 180;

export const LOADING_WIPES = [
  { id: 'iris', mod: iris, cover: 0.99 },
  { id: 'burn-away', mod: burnAway, cover: 1.35, reveal: true },
  { id: 'slash-wipe', mod: slashWipe, cover: 0.72 },
];

/* Flat cover painted by the transitions. #0b0a10 from screenMeta. */
const INK = [11, 10, 16];

/**
 * Flat cover is the plate the fire has eaten. Punch it out of the wipe so
 * the game can show through, and mark `keep` 0 there. Everywhere else
 * (the hole, the flames, char, smoke) stays, and `keep` is 1.
 * Returns how many pixels were punched.
 */
export function punchBurnCover(data, keep) {
  let n = 0;
  for (let p = 0, i = 0; p < data.length; p += 4, i++) {
    const cover = data[p + 3] > 240
      && Math.abs(data[p] - INK[0]) <= 6
      && Math.abs(data[p + 1] - INK[1]) <= 6
      && Math.abs(data[p + 2] - INK[2]) <= 8;
    if (cover) {
      data[p + 3] = 0;
      keep[i] = 0;
      n++;
    } else {
      keep[i] = 1;
    }
  }
  return n;
}

/* Boundary of the pixels that still show the curtain. Each loop is a list of
   integer corners, closed (the first point repeated at the end). */
export function burnKeepLoops(keep, w, h) {
  const next = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = x0 + ',' + y0;
    let list = next.get(k);
    if (!list) next.set(k, list = []);
    list.push([x1, y1]);
  };
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (keep[row + x] !== 1) continue;
      if (!solid(x, y - 1)) add(x, y, x + 1, y);
      if (!solid(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!solid(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!solid(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const takeNext = (outs, px, py, x, y) => {
    if (outs.length === 1) return outs.pop();
    const rvx = px - x;
    const rvy = py - y;
    let best = 0;
    let bestAng = Infinity;
    for (let i = 0; i < outs.length; i++) {
      const ox = outs[i][0] - x;
      const oy = outs[i][1] - y;
      let ang = Math.atan2(rvx * oy - rvy * ox, rvx * ox + rvy * oy);
      if (ang < 0) ang += Math.PI * 2;
      if (ang < bestAng) {
        bestAng = ang;
        best = i;
      }
    }
    return outs.splice(best, 1)[0];
  };

  const loops = [];
  const limit = w * h * 4;
  for (const [k, outs] of next) {
    const comma = k.indexOf(',');
    const sx = +k.slice(0, comma);
    const sy = +k.slice(comma + 1);
    while (outs.length) {
      let prev = [sx, sy];
      let cur = outs.pop();
      const loop = [prev, cur];
      let guard = 0;
      while ((cur[0] !== sx || cur[1] !== sy) && guard++ < limit) {
        const nouts = next.get(cur[0] + ',' + cur[1]);
        if (!nouts || !nouts.length) break;
        const nxt = takeNext(nouts, prev[0], prev[1], cur[0], cur[1]);
        prev = cur;
        cur = nxt;
        loop.push(cur);
      }
      if (cur[0] === sx && cur[1] === sy && loop.length > 3) loops.push(loop);
    }
  }
  return loops;
}

export function loopsContain(loops, x, y) {
  let inside = false;
  for (let n = 0; n < loops.length; n++) {
    const loop = loops[n];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const xi = loop[i][0];
      const yi = loop[i][1];
      const xj = loop[j][0];
      const yj = loop[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}

function simplifyLoop(loop) {
  const n = loop.length;
  if (n < 4) return loop;
  const closed = loop[0][0] === loop[n - 1][0] && loop[0][1] === loop[n - 1][1];
  const m = closed ? n - 1 : n;
  const out = [];
  for (let i = 0; i < m; i++) {
    const a = loop[(i + m - 1) % m];
    const b = loop[i];
    const c = loop[(i + 1) % m];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcy = c[1] - b[1];
    if (abx * bcy !== aby * bcx || abx * bcx + aby * bcy < 0) out.push(b);
  }
  if (out.length && closed) out.push(out[0]);
  return out;
}

/* CSS path() in the overlay's border box. `mapX`/`mapY` take bitmap edge
   coordinates and return CSS pixels. */
export function burnClipPath(loops, mapX, mapY) {
  let d = '';
  for (let n = 0; n < loops.length; n++) {
    const pts = simplifyLoop(loops[n]);
    if (pts.length < 3) continue;
    d += 'M' + mapX(pts[0][0]).toFixed(1) + ' ' + mapY(pts[0][1]).toFixed(1);
    for (let i = 1; i < pts.length; i++) {
      d += 'L' + mapX(pts[i][0]).toFixed(1) + ' ' + mapY(pts[i][1]).toFixed(1);
    }
    d += 'Z';
  }
  return d;
}

let playing = null;

export function loadingWipePlaying() {
  return !!playing;
}

export function pickLoadingWipe(rng = Math.random) {
  const n = LOADING_WIPES.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(rng() * n)));
  return LOADING_WIPES[i];
}

function curtainEl() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return null;
  return document.getElementById('dungeon-loading-overlay');
}

export function clearCurtainMask() {
  const el = curtainEl();
  if (!el || !el.style) return;
  el.style.clipPath = '';
  el.style.webkitClipPath = '';
  el.style.maskImage = '';
  el.style.webkitMaskImage = '';
  el.style.maskSize = '';
  el.style.webkitMaskSize = '';
  el.style.maskPosition = '';
  el.style.webkitMaskPosition = '';
  el.style.maskRepeat = '';
  el.style.webkitMaskRepeat = '';
}

function applyCurtainClip(d) {
  const el = curtainEl();
  if (!el || !el.style) return;
  const value = d ? `path(evenodd, '${d}')` : '';
  el.style.clipPath = value;
  el.style.webkitClipPath = value;
}

export function cancelLoadingWipe() {
  const run = playing;
  playing = null;
  if (!run) return;
  run.stop = true;
  if (run.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(run.raf);
  clearCurtainMask();
  const canvas = run.canvas;
  if (canvas && canvas.parentNode && typeof canvas.parentNode.removeChild === 'function') {
    canvas.parentNode.removeChild(canvas);
  }
}

function prefersStill() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

function fitCanvas(canvas) {
  const vw = window.innerWidth || W;
  const vh = window.innerHeight || H;
  const scale = Math.max(vw / W, vh / H);
  const dw = Math.ceil(W * scale);
  const dh = Math.ceil(H * scale);
  const left = Math.round((vw - dw) / 2);
  const top = Math.round((vh - dh) / 2);
  canvas.style.width = dw + 'px';
  canvas.style.height = dh + 'px';
  canvas.style.left = left + 'px';
  canvas.style.top = top + 'px';
  const sx = dw / W;
  const sy = dh / H;
  return {
    mapX: (px) => left + px * sx,
    mapY: (py) => top + py * sy,
  };
}

/**
 * Start a wipe. Pass an id (`iris`, `burn-away`, `slash-wipe`) to force one;
 * otherwise one is chosen at random. Returns false when it cannot draw, so
 * the caller can fade instead. `onCover` runs once, at the solid frame.
 */
export function playLoadingWipe(onCover, id) {
  if (prefersStill()) return false;
  if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') return false;
  if (typeof requestAnimationFrame !== 'function') return false;
  if (typeof ImageData !== 'function') return false;

  const canvas = document.createElement('canvas');
  if (typeof canvas.getContext !== 'function') return false;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx || typeof ctx.putImageData !== 'function') return false;

  const wipe = (id && LOADING_WIPES.find((w) => w.id === id)) || pickLoadingWipe();
  const keep = wipe.reveal ? new Uint8Array(W * H) : null;
  cancelLoadingWipe();

  canvas.width = W;
  canvas.height = H;
  canvas.className = 'dungeon-loading-wipe';
  if (typeof canvas.setAttribute === 'function') {
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-wipe', wipe.id);
  }
  if (canvas.style) canvas.style.imageRendering = 'pixelated';
  document.body.appendChild(canvas);
  fitCanvas(canvas);

  const frame = createFrame(W, H);
  const fx = createFx(wipe.mod, {});
  const img = new ImageData(W, H);
  const run = { canvas, stop: false, raf: 0, covered: false };
  playing = run;
  let last = 0;

  const finish = () => {
    clearCurtainMask();
    try { if (onCover) onCover(); } catch (e) { /* the curtain still has to finish */ }
    cancelLoadingWipe();
  };

  const step = (now) => {
    if (run.stop || playing !== run) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    fx.update(dt);
    clearFrame(frame);
    fx.draw(frame);
    composite(frame, img.data);
    const fit = fitCanvas(canvas);
    if (wipe.reveal) {
      const punched = punchBurnCover(img.data, keep);
      if (!punched) {
        clearCurtainMask();
      } else {
        const loops = burnKeepLoops(keep, W, H);
        const cx = (W / 2) + 0.5;
        const cy = (H / 2) + 0.5;
        const centerKept = keep[(H >> 1) * W + (W >> 1)] === 1;
        if (centerKept && !loopsContain(loops, cx, cy)) clearCurtainMask();
        else applyCurtainClip(burnClipPath(loops, fit.mapX, fit.mapY));
      }
      if (fx.t >= wipe.cover) {
        finish();
        return;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (!wipe.reveal && !run.covered && fx.t >= wipe.cover) {
      run.covered = true;
      try { if (onCover) onCover(); } catch (e) { /* the curtain still has to finish */ }
    }
    if (fx.done()) {
      cancelLoadingWipe();
      return;
    }
    run.raf = requestAnimationFrame(step);
  };
  run.raf = requestAnimationFrame(step);
  return true;
}
