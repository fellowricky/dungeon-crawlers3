import { describe, it, expect, vi } from 'vitest';
import { strikeInterval, scheduleFollowUpStrike, attackAnimDelay, MIN_STRIKE_INTERVAL } from '../src/game/turn_engine.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { initiativeMethods } from '../src/game/initiative.js';

/* Extra Attack / Multiattack follow-ups must run on the COMBAT clock — the one
   the attack animation and its deferred impact use (fxImpactDelay) — not on
   real time (fxSchedule). At the default 0.7 combat speed a real-time gap let
   the archer re-draw before the first arrow had left. These pin the clock and
   the spacing; the animation itself is covered by hero_attack_animation_timing. */

const heroWithAnim = (delay) => ({
  x: 0, z: 0, data: { name: 'Vale', hp: 20, maxHp: 20, classKey: 'ranger' },
  ent: { anim: { attackImpactDelay: () => delay } }
});

describe('follow-up strike timing', () => {
  it('spaces strikes by the first animation plus a beat, never tighter than the floor', () => {
    expect(strikeInterval(1.0)).toBeCloseTo(1.25);      // LPC shoot: 13 frames @ 13 fps
    expect(strikeInterval(0.6)).toBeCloseTo(0.85);      // LPC slash
    expect(strikeInterval(0)).toBe(MIN_STRIKE_INTERVAL); // un-animated
    expect(strikeInterval(undefined)).toBe(MIN_STRIKE_INTERVAL);
  });

  it('reads the animation delay off the actor and tolerates actors without one', () => {
    expect(attackAnimDelay(heroWithAnim(1.0))).toBe(1.0);
    expect(attackAnimDelay({ ent: {} })).toBe(0);
    expect(attackAnimDelay(null)).toBe(0);
  });

  it('prefers the combat clock over real time, and tracks the pending count', () => {
    const impact = vi.fn();
    const real = vi.fn();
    const game = { fxImpactDelay: impact, fxSchedule: real };
    const h = heroWithAnim(1.0);
    const fn = vi.fn();
    scheduleFollowUpStrike(game, h, 1.25, fn);
    expect(h._pendingAttacks).toBe(1);
    expect(real).not.toHaveBeenCalled();
    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact.mock.calls[0][0]).toBeCloseTo(1.25);
    impact.mock.calls[0][1]();                      // the clock reaches the strike
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h._pendingAttacks).toBe(0);
  });

  it('each strike that fires restarts the initiative deadlock breaker', () => {
    /* A three-shot volley is longer than the breaker's 4 s ceiling; measured
       from the turn's start it force-ended every volley, wiping the arrows. */
    const game = {
      ...initiativeMethods,
      initiative: { active: true, _turnAge: 3.9 },
      fxImpactDelay: (sec, cb) => cb()
    };
    scheduleFollowUpStrike(game, heroWithAnim(1.0), 1.25, () => {});
    expect(game.initiative._turnAge).toBe(0);
    /* Outside combat there is nothing to reset. */
    const idle = { ...initiativeMethods, initiative: { active: false, _turnAge: 3.9 } };
    idle.markTurnProgress();
    expect(idle.initiative._turnAge).toBe(3.9);
  });

  it('falls back to real-time scheduling, then to firing inline', () => {
    const real = vi.fn();
    const h = heroWithAnim(0.6);
    scheduleFollowUpStrike({ fxSchedule: real }, h, 0.85, () => {});
    expect(real).toHaveBeenCalledWith(850, expect.any(Function));
    const fn = vi.fn();
    scheduleFollowUpStrike({}, h, 0.85, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a hero with Extra Attack shoots on the combat clock, one animation apart', () => {
    const h = heroWithAnim(1.0);
    h.data.features = { extraAttack: true };
    const scheduled = [];
    const game = {
      ...combatMethods,
      fxImpactDelay: (sec, cb) => scheduled.push({ sec, cb }),
      fxSchedule: vi.fn(),
      heroPerformAttack: vi.fn(() => 1.0),
      fireExtraBeams: vi.fn(), beginBlastAction: vi.fn(),
      buildAttackOpts: () => ({}), refreshAbilityHud: vi.fn(), fxLog: vi.fn(),
      playAbilityFx: vi.fn(), monsterEliteRoom: () => false
    };
    const foe = { x: 4, z: 0, data: { name: 'Archer', hp: 30, maxHp: 30 } };
    /* Drive just the Extra Attack block the way heroCombat does. */
    const alive = [h];
    const atk = { source: 'weapon', melee: false, range: 16 };
    const delaySec = game.heroPerformAttack(h, foe, alive, { profile: atk });
    const interval = strikeInterval(delaySec);
    scheduleFollowUpStrike(game, h, interval, () => game.heroPerformAttack(h, foe, alive, { profile: atk }));

    expect(game.fxSchedule).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].sec).toBeCloseTo(1.25);
    scheduled[0].cb();
    expect(game.heroPerformAttack).toHaveBeenCalledTimes(2);
  });

  it('a ranged Multiattack monster staggers its extra shots instead of firing them in one tick', () => {
    const scheduled = [];
    const shots = [];
    const game = {
      ...monsterAiMethods,
      fxImpactDelay: (sec, cb) => scheduled.push({ sec, cb }),
      fxSchedule: vi.fn(),
      faceTowards: vi.fn(),
      _countSwing: vi.fn(),
      monsterRangedAttack: (m, t) => shots.push([m, t])
    };
    const m = {
      x: 0, z: 0, active: true, actUsed: false,
      data: { name: 'Master Archer', hp: 40, attacksPerTurn: 3, ranged: true },
      ent: { anim: { attackImpactDelay: () => 1.0 } }
    };
    const tgt = { x: 5, z: 0, data: { name: 'Vale', hp: 20 } };

    game.monsterRanged(m, tgt, 0.016);

    expect(shots).toHaveLength(1);                     // only the first shot is immediate
    expect(game.fxSchedule).not.toHaveBeenCalled();
    expect(scheduled.map(s => s.sec)).toEqual([1.25, 2.5]);
    expect(m._pendingAttacks).toBe(2);
    scheduled.forEach(s => s.cb());
    expect(shots).toHaveLength(3);
    expect(m._pendingAttacks).toBe(0);
  });

  it('extra shots stop once the target is down', () => {
    const scheduled = [];
    const shots = [];
    const game = {
      ...monsterAiMethods,
      fxImpactDelay: (sec, cb) => scheduled.push({ sec, cb }),
      faceTowards: vi.fn(), _countSwing: vi.fn(),
      monsterRangedAttack: (m, t) => shots.push(t)
    };
    const m = { x: 0, z: 0, active: true, actUsed: false, data: { name: 'Archer', hp: 40, attacksPerTurn: 2 }, ent: {} };
    const tgt = { x: 5, z: 0, data: { name: 'Vale', hp: 20 } };
    game.monsterRanged(m, tgt, 0.016);
    tgt.data.hp = 0;
    scheduled.forEach(s => s.cb());
    expect(shots).toHaveLength(1);
    expect(m._pendingAttacks).toBe(0);
  });
});
