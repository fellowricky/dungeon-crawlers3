/**
 * Error surfacing — the game must say when it breaks.
 *
 * Nearly every defect found in the September 2026 sweep had been failing
 * quietly for weeks: the autosave threw into an empty catch, the aiming ring
 * threw after it had already added itself to the scene, a monster's attack
 * called an import by the wrong name. None crashed; all degraded. A game that
 * swallows its errors turns every bug into a session-long hunt.
 *
 * This is a leaf module (no imports) so anything can report through it:
 *   reportError(where, err)          console.error + notify listeners
 *   reportError(where, err, 'warn')  console.warn only — a degraded optional
 *                                    (a warmup, a decoration) nobody needs told
 * The UI subscribes with onError() and shows a toast plus a combat-log line;
 * installGlobalErrorHandlers() catches everything nobody wrapped.
 *
 * Repeats are folded: a bug inside the frame loop fires 60 times a second, and
 * the first report is the one that matters. Listeners hear the first
 * occurrence of a message and then every REPEAT_EVERY-th.
 */

const listeners = new Set();
const counts = new Map();
const REPEAT_EVERY = 50;

/** Subscribe to reports. Returns an unsubscribe function. */
export function onError(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function describe(err) {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

/**
 * @param {string} where  what was being done — "projectile impact", "autosave"
 * @param {*} err         the thrown value
 * @param {'error'|'warn'} level
 */
export function reportError(where, err, level = 'error') {
  const msg = `${where}: ${describe(err)}`;
  const n = (counts.get(msg) || 0) + 1;
  counts.set(msg, n);
  const first = n === 1;
  if (level === 'warn') {
    if (first) console.warn(`[dc] ${msg}`, err);
    return;
  }
  if (first || n % REPEAT_EVERY === 0) {
    console.error(`[dc] ${msg}${n > 1 ? ` (×${n})` : ''}`, err);
    for (const fn of listeners) {
      try { fn(where, err, n); } catch (e) { console.error('[dc] error listener failed', e); }
    }
  }
}

/** Counts so far, for tests and the debug overlay. */
export function errorCounts() { return new Map(counts); }
export function resetErrorCounts() { counts.clear(); }

let installed = false;
/** Catch what nobody wrapped: thrown in a frame, a timer, or a promise. */
export function installGlobalErrorHandlers(target = typeof window !== 'undefined' ? window : null) {
  if (!target || installed || typeof target.addEventListener !== 'function') return;
  installed = true;
  target.addEventListener('error', (ev) => {
    const err = ev.error || ev.message;
    const at = ev.filename ? ` (${String(ev.filename).split('/').pop()}:${ev.lineno})` : '';
    reportError(`uncaught${at}`, err);
  });
  target.addEventListener('unhandledrejection', (ev) => {
    reportError('unhandled promise', ev.reason);
  });
}
