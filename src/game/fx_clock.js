/**
 * Presentation clock — "is the screen quiet enough to read yet?"
 *
 * THE PROBLEM
 * The turn engine asked `entities.hasActiveFX()`, which only ever looked at the
 * projectile pool. A spell fired through `spawnCompositeAnimation` lives in
 * vfx_animations.js's own `travelPool`, so it was invisible to that check: the
 * caster's bolt was still in flight while three melee turns resolved, logged and
 * animated on top of it. Bursts of actions landed faster than anyone could read.
 *
 * WHY NOT JUST CHECK EVERY POOL
 * There are ~13 FX registries across entities.js, vfx_animations.js, nixie_vfx.js
 * and pixel_vfx.js, and several are *persistent by design* — an AoE aura lasts a
 * minute, torch embers last forever. Gate a turn on those and combat deadlocks.
 * Enumerating "the blocking ones" also means every effect added later is opted in
 * by default, i.e. one forgotten classification away from a hung fight.
 *
 * So it is inverted: effects that carry INFORMATION register a deadline here when
 * they spawn. Decoration simply never calls `hold()`. The default is "does not
 * block", which is the safe direction to be wrong in.
 *
 * TWO THINGS COMPOSE
 *   hold(d)      a visual carrying information is playing for `d` seconds
 *   noteBeat(k)  what just happened was routine / notable / major — how long to
 *                dwell AFTER the visuals stop so the result can be read
 *
 * `readyAt = fxUntil + BEAT_BUFFER[beat]`, so the dwell begins when the last
 * visual ends rather than overlapping it. The beat is the *high-water mark* for
 * the turn: a turn that crits and then kills dwells as a kill.
 *
 * WHY WEIGHTED RATHER THAN A FLAT BUFFER
 * This is an idle game watched unattended. A flat half-second after every actor
 * turns a 9-combatant round into ten seconds of waiting, which reads as sluggish
 * rather than legible. Most turns are a routine hit or miss and need almost no
 * dwell; the half-second belongs on the beats that actually carry information.
 *
 * TIME BASE
 * `now` is accumulated from the game loop's combat `dt`, which game.js has already
 * scaled by the Options combat-speed slider — so the slider scales pacing exactly
 * the way it scales everything else, and this stays independent of frame rate.
 * It is deliberately NOT `game.fxNow`: that clock jumps a fixed ROUND_SECONDS per
 * pass of the initiative order and says nothing about real elapsed time.
 *
 * HEADLESS
 * Every `hold()` site sits behind a `game_hooks.js` `fx*` call that HeadlessGame
 * stubs out, and `noteBeat()` is called from those same hooks. So the balance sim
 * and the unit suite never touch this module, advance turns with zero delay, and
 * produce unchanged outcomes. Nothing here imports THREE or touches the DOM.
 */

/** Significance of what happened on a turn, lowest to highest. */
export const BEAT = Object.freeze({
  ROUTINE: 'routine',   // a plain hit, a miss, a step
  NOTABLE: 'notable',   // a spell landing, a crit, a save
  MAJOR:   'major',     // something died
});

/** Seconds to dwell after the visuals stop, per beat. The tuning knob. */
export const BEAT_BUFFER = Object.freeze({
  routine: 0.15,
  notable: 0.50,
  major:   0.75,
});

const BEAT_RANK = Object.freeze({ routine: 0, notable: 1, major: 2 });

/* No single effect may push the quiet time more than this far out. A hung or
   absurdly long animation therefore cannot hang the fight — it bounds the worst
   case at MAX_HOLD + the largest beat buffer. */
export const MAX_HOLD = 2.0;

let now = 0;
let fxUntil = 0;
let beat = null;

/** Advance the presentation clock. `dt` is the combat-speed-scaled frame delta. */
export function tickFxClock(dt) {
  if (typeof dt === 'number' && dt > 0) now += dt;
}

/**
 * Register that an information-carrying visual is playing for `duration` seconds.
 * Extends the quiet time; never shortens it (two overlapping effects resolve to
 * whichever finishes last).
 */
export function hold(duration) {
  if (typeof duration !== 'number' || !(duration > 0)) return;
  const until = now + Math.min(duration, MAX_HOLD);
  if (until > fxUntil) fxUntil = until;
}

/**
 * Record how significant this turn's action was. Keeps the highest beat seen, so
 * ordering of calls within a turn does not matter.
 */
export function noteBeat(kind) {
  if (!kind || BEAT_BUFFER[kind] == null) return;
  if (beat == null || BEAT_RANK[kind] > BEAT_RANK[beat]) beat = kind;
  /* The dwell is measured from the action, not from a stale deadline in the
     past — otherwise an action with no visuals at all would read as already
     finished dwelling. */
  if (fxUntil < now) fxUntil = now;
}

/**
 * Called at the top of each turn. Every turn carries at least a ROUTINE beat, so
 * even a silent turn (a pure reposition) gets a brief settle rather than snapping
 * instantly to the next actor.
 */
export function beginTurnFx() {
  beat = BEAT.ROUTINE;
  if (fxUntil < now) fxUntil = now;
}

/** True once the visuals have stopped and the read buffer has elapsed. */
export function readyToAdvance() {
  return now >= fxUntil + (beat != null ? BEAT_BUFFER[beat] : 0);
}

/** True while an information-carrying visual (cast, charge, projectile, impact) is still playing (excluding post-visual read dwell). */
export function fxVisualBusy() {
  return now < fxUntil;
}

/** Seconds still to wait. 0 when ready. Used by the deadlock breaker and tests. */
export function fxWaitRemaining() {
  return Math.max(0, (fxUntil + (beat != null ? BEAT_BUFFER[beat] : 0)) - now);
}

/** Drop all pending holds — combat ended, floor changed, effects wiped. */
export function resetFxClock() {
  fxUntil = now;
  beat = null;
}

/** Inspection hook for tests. Not used by the game. */
export function fxClockState() {
  return { now, fxUntil, beat, waiting: fxWaitRemaining() };
}
