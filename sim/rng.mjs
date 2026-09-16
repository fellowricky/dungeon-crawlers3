/**
 * Deterministic RNG for the balance simulator.
 *
 * The game's rules code (srd.js, items.js, features.js) calls the global
 * `Math.random()` everywhere — dice, stat rolls, loot rolls, monster picks.
 * To make a whole simulation run reproducible from a single seed we install a
 * seeded generator over `Math.random`. Call `installSeededRandom(seed)` once
 * before generating anything; call `restoreRandom()` when done (optional).
 */

/** mulberry32 — tiny, fast, decent-quality seeded PRNG in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _originalRandom = null;

/** Replace Math.random with a seeded stream. Returns the raw rng function. */
export function installSeededRandom(seed) {
  const rng = mulberry32(seed);
  if (_originalRandom === null) _originalRandom = Math.random;
  Math.random = rng;
  return rng;
}

/** Restore the platform Math.random (if it was replaced). */
export function restoreRandom() {
  if (_originalRandom) { Math.random = _originalRandom; _originalRandom = null; }
}

/**
 * Run `fn` with Math.random swapped to an independent stream, then restore.
 *
 * Content generation (parties, levelling, gear, monster picks) MUST NOT share
 * a stream with combat. Combat consumes a variable number of random draws, so
 * any change to the AI shifts the stream and every subsequent party and
 * encounter comes out different — which makes two runs at "the same seed"
 * incomparable, and silently turns A/B measurements into noise.
 *
 * Isolating generation means the same seed always produces the same parties
 * fighting the same monsters, whatever the AI does in between.
 */
export function withStream(rng, fn) {
  const saved = Math.random;
  Math.random = rng;
  try { return fn(); } finally { Math.random = saved; }
}
