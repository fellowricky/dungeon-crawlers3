import { describe, it, expect, beforeEach } from 'vitest';
import {
  BEAT, BEAT_BUFFER, MAX_HOLD,
  tickFxClock, hold, noteBeat, beginTurnFx,
  readyToAdvance, fxWaitRemaining, resetFxClock, fxClockState,
} from '../src/game/fx_clock.js';

/** Advance the presentation clock in small frames, like the game loop does. */
function advance(seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) tickFxClock(step);
}

describe('fx_clock — presentation deadline', () => {
  beforeEach(() => {
    resetFxClock();
    beginTurnFx();
  });

  it('every turn carries at least a routine dwell', () => {
    expect(readyToAdvance()).toBe(false);
    advance(BEAT_BUFFER.routine + 0.02);
    expect(readyToAdvance()).toBe(true);
  });

  it('holds the turn for the whole length of a visual, then dwells on top', () => {
    hold(0.8);
    noteBeat(BEAT.NOTABLE);

    /* Mid-flight: the spell is still travelling. This is the regression that
       matters — previously composite animations were invisible to the gate and
       the next combatant acted straight over them. */
    advance(0.5);
    expect(readyToAdvance()).toBe(false);

    /* Visual finished, but the read buffer has not elapsed. */
    advance(0.35);
    expect(readyToAdvance()).toBe(false);

    advance(BEAT_BUFFER.notable + 0.02);
    expect(readyToAdvance()).toBe(true);
  });

  it('keeps the longest of overlapping holds', () => {
    hold(0.3);
    hold(1.0);
    hold(0.2);
    advance(0.6);
    expect(readyToAdvance()).toBe(false);
    advance(0.45 + BEAT_BUFFER.routine);
    expect(readyToAdvance()).toBe(true);
  });

  it('dwells longer on bigger beats', () => {
    noteBeat(BEAT.ROUTINE);
    const routine = fxWaitRemaining();

    resetFxClock(); beginTurnFx();
    noteBeat(BEAT.NOTABLE);
    const notable = fxWaitRemaining();

    resetFxClock(); beginTurnFx();
    noteBeat(BEAT.MAJOR);
    const major = fxWaitRemaining();

    expect(notable).toBeGreaterThan(routine);
    expect(major).toBeGreaterThan(notable);
  });

  it('keeps the highest beat regardless of call order', () => {
    noteBeat(BEAT.MAJOR);
    noteBeat(BEAT.ROUTINE);
    noteBeat(BEAT.NOTABLE);
    expect(fxClockState().beat).toBe(BEAT.MAJOR);
  });

  it('ignores malformed durations and unknown beats', () => {
    const before = fxWaitRemaining();
    hold(0); hold(-5); hold(NaN); hold(undefined);
    noteBeat('catastrophic'); noteBeat(null);
    expect(fxWaitRemaining()).toBeCloseTo(before, 5);
  });

  /* The failure mode of getting any of this wrong is a fight that never ends,
     so these two are the important ones. */
  it('clamps a single hold so no effect can hang the fight', () => {
    hold(999);
    expect(fxWaitRemaining()).toBeLessThanOrEqual(MAX_HOLD + BEAT_BUFFER.major + 0.001);
  });

  it('always becomes ready in bounded time, even under constant abuse', () => {
    hold(MAX_HOLD);
    noteBeat(BEAT.MAJOR);
    advance(MAX_HOLD + BEAT_BUFFER.major + 0.05);
    expect(readyToAdvance()).toBe(true);
  });

  it('resetFxClock drops pending holds so combat end is never blocked', () => {
    hold(MAX_HOLD);
    noteBeat(BEAT.MAJOR);
    expect(readyToAdvance()).toBe(false);
    resetFxClock();
    expect(readyToAdvance()).toBe(true);
  });

  it('a turn with no beat at all does not wait', () => {
    resetFxClock();               // no beginTurnFx — beat stays null
    expect(readyToAdvance()).toBe(true);
  });
});

describe('fx_clock — headless contract', () => {
  it('is inert without spawn sites: no holds means no waiting', () => {
    resetFxClock();
    /* HeadlessGame stubs every fx* hook, so neither hold() nor noteBeat() is
       ever reached and the sim advances turns with zero delay. */
    expect(readyToAdvance()).toBe(true);
    expect(fxWaitRemaining()).toBe(0);
  });
});
