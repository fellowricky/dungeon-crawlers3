/**
 * Main-thread side of the loading-curtain worker.
 *
 * The curtain's plate loop and weather are drawn by a worker on canvases
 * handed over with transferControlToOffscreen, so they keep moving while the
 * main thread is blocked (the floor forge alone can hold it for many
 * seconds). Everything here degrades: no Worker, no OffscreenCanvas, a worker
 * that fails to load, or a plate the worker cannot decode all report "not
 * handled", and the caller uses its main-thread path instead.
 */

let worker = null;
let broken = false;
const plateListeners = new Map(); // serial -> { shown, failed }
const brokenListeners = new Set();
let probeWaiters = [];

function supported() {
  if (typeof Worker !== 'function') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

function onMessage(ev) {
  const m = ev.data || {};
  if (m.op === 'plate-shown' || m.op === 'plate-failed') {
    const l = plateListeners.get(m.serial);
    if (!l) return;
    if (m.op === 'plate-shown') l.shown();
    else { plateListeners.delete(m.serial); l.failed(m.reason); }
  } else if (m.op === 'probe') {
    const waiters = probeWaiters;
    probeWaiters = [];
    const shift = m.origin - performance.timeOrigin;
    const out = { weather: m.weather.map(t => t + shift), plate: m.plate.map(t => t + shift) };
    for (const w of waiters) w(out);
  }
}

function markBroken() {
  if (broken) return;
  broken = true;
  try { if (worker) worker.terminate(); } catch (e) { /* gone */ }
  worker = null;
  for (const l of plateListeners.values()) l.failed('worker error');
  plateListeners.clear();
  for (const fn of brokenListeners) fn();
}

function getWorker() {
  if (broken) return null;
  if (worker) return worker;
  if (!supported()) { broken = true; return null; }
  try {
    worker = new Worker(new URL('./loading_curtain.worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    broken = true;
    return null;
  }
  worker.onmessage = onMessage;
  worker.onerror = () => markBroken();
  if (typeof window !== 'undefined' && window.__plateWeatherProbe) {
    worker.postMessage({ op: 'probe', on: true });
    window.__dumpCurtainProbe = () => new Promise((resolve) => {
      if (!worker) { resolve(null); return; }
      probeWaiters.push(resolve);
      worker.postMessage({ op: 'probe-dump' });
    });
  }
  return worker;
}

/** Start the worker ahead of the first curtain, so its module is loaded by then. */
export function warmOffthread() {
  getWorker();
}

/** True once a canvas has been handed to the worker (it can no longer draw here). */
export function isOffthreadCanvas(canvas) {
  return !!(canvas && canvas.__dcOffthread);
}

/** True when the worker died. Canvases it owned must be replaced. */
export function offthreadBroken() {
  return broken;
}

/** Call `fn` if the worker dies after it started drawing. */
export function onOffthreadBroken(fn) {
  brokenListeners.add(fn);
  return () => brokenListeners.delete(fn);
}

/* Hand `canvas` to the worker once. A canvas that already has a main-thread
   context cannot be transferred, and stays on the main-thread path. */
function adopt(canvas, op) {
  if (!canvas) return null;
  const w = getWorker();
  if (!w) return null;
  if (canvas.__dcOffthread) return w;
  if (typeof canvas.transferControlToOffscreen !== 'function') return null;
  let off;
  try { off = canvas.transferControlToOffscreen(); } catch (e) { return null; }
  canvas.__dcOffthread = true;
  w.postMessage({ op, canvas: off }, [off]);
  return w;
}

/** Draw weather `kind` on `canvas` from the worker. False: use the main thread. */
export function startOffthreadWeather(canvas, kind, seed) {
  const w = adopt(canvas, 'weather-canvas');
  if (!w) return false;
  w.postMessage({ op: 'weather', kind, seed });
  return true;
}

export function stopOffthreadWeather() {
  if (worker) worker.postMessage({ op: 'weather-stop' });
}

/**
 * Play the plate loop at `url` on `canvas` from the worker. `shown` fires on
 * the first drawn frame, `failed(reason)` when the worker cannot play it.
 * False: the worker is not available, use the <video> element.
 */
export function startOffthreadPlate(canvas, url, serial, { shown, failed }) {
  const w = adopt(canvas, 'plate-canvas');
  if (!w) return false;
  let abs = url;
  try { abs = new URL(url, document.baseURI).href; } catch (e) { /* keep as given */ }
  for (const key of plateListeners.keys()) if (key !== serial) plateListeners.delete(key);
  plateListeners.set(serial, { shown: shown || (() => {}), failed: failed || (() => {}) });
  w.postMessage({ op: 'plate', url: abs, serial });
  return true;
}

export function stopOffthreadPlate() {
  plateListeners.clear();
  if (worker) worker.postMessage({ op: 'plate-stop' });
}
