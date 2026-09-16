import { describe, it, expect, beforeEach } from 'vitest';
import { gameHookMethods } from '../src/game/game_hooks.js';
import { resetFxClock, tickFxClock, fxWaitRemaining, beginTurnFx } from '../src/game/fx_clock.js';

/* fxDelay is the combat-clock timer every sequenced visual must use instead
   of setTimeout (Magic Missile darts, Ice Storm hail, Chain Lightning arcs).
   It advances only when the game ticks it, so the speed slider and hit-stop
   stretch it exactly as they stretch the animation it is paired with. */
function host() {
  return { fxDelay: gameHookMethods.fxDelay, fxImpactDelay: gameHookMethods.fxImpactDelay, tickPendingImpacts: gameHookMethods.tickPendingImpacts };
}

describe('fxDelay — the combat-clock timer', () => {
  beforeEach(() => { resetFxClock(); beginTurnFx(); });

  it('fires in combat time, not on the wall clock', () => {
    const g = host();
    const fired = [];
    g.fxDelay(0.30, () => fired.push('a'));
    g.fxDelay(0.10, () => fired.push('b'));
    g.tickPendingImpacts(0.05);
    expect(fired).toEqual([]);
    g.tickPendingImpacts(0.06);                // 0.11 elapsed
    expect(fired).toEqual(['b']);
    g.tickPendingImpacts(0.20);                // 0.31 elapsed
    expect(fired).toEqual(['b', 'a']);
  });

  it('a zero or missing delay fires inline', () => {
    const g = host();
    let n = 0;
    g.fxDelay(0, () => n++);
    g.fxDelay(undefined, () => n++);
    expect(n).toBe(2);
  });

  it('holds the turn engine for a visual, and not for a rule (hold: false)', () => {
    const g = host();
    g.fxDelay(1.0, () => {});
    const withHold = fxWaitRemaining();
    expect(withHold).toBeGreaterThanOrEqual(1.0);

    resetFxClock(); beginTurnFx();
    g.fxDelay(5.0, () => {}, { hold: false });
    expect(fxWaitRemaining()).toBeLessThan(1.0);   // only the routine beat buffer
  });

  it('a callback that throws does not stop the others', () => {
    const g = host();
    let ok = false;
    g.fxDelay(0.1, () => { throw new Error('bad dart'); });
    g.fxDelay(0.1, () => { ok = true; });
    expect(() => g.tickPendingImpacts(0.2)).not.toThrow();
    expect(ok).toBe(true);
  });

  it('fxImpactDelay is the same timer', () => {
    const g = host();
    let hit = false;
    g.fxImpactDelay(0.2, () => { hit = true; });
    g.tickPendingImpacts(0.25);
    expect(hit).toBe(true);
  });
});
