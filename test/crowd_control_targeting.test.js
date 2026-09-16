/* ───────── Crowd control the party does not instantly shatter ─────────
 *
 * Reported: Hypnotic Pattern "is meant to incapacitate monsters while
 * hypnotized, but it doesn't seem to be doing that — they gain a status
 * effect, but that status effect doesn't do anything."
 *
 * The condition itself was fine. Traced in the headless engine, a monster
 * holding `unconscious` genuinely cannot act for the full duration. What
 * failed was everything around it:
 *
 *   1. pickHeroTarget was blind to the condition, so heroes picked a
 *      hypnotised foe like any other, and
 *   2. damageMonster clears `unconscious` on any damage (5e: the effect ends
 *      if the creature takes damage), so the first hit ended it, and
 *   3. a melee hit on an unconscious target is an auto-crit, so the scorer
 *      actively PREFERRED the one enemy it should have left alone.
 *
 * Net effect: a 3rd-level slot bought a status icon that vanished within a
 * fraction of a second. Sleep rides the same key and had the same problem.
 *
 * (2) and (3) are correct 5e and stay. (1) is the fix.
 */
import { describe, it, expect } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { applyEffect, hasEffect, getEffectMods } from '../src/game/conditions.js';

const mob = (name, x, hp = 40) => ({
  x, z: 0, active: true, dead: false,
  data: { name, hp, maxHp: 40, scale: 1, level: 3, ac: 12 }
});

function game(monsters) {
  return Object.assign({}, combatMethods, {
    monsters,
    heroes: [],
    initiative: { active: false },
    fxNow: 0,
  });
}

const hero = () => ({
  x: 0, z: 0,
  data: {
    name: 'Hero', classKey: 'fighter', level: 5, hp: 40, maxHp: 40,
    aiPrefs: { targeting: 'nearest' },
    weaponProfile: { name: 'Longsword', dmg: [1, 8], ability: 'str', melee: true },
    effStats: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    dmgBonus: 0, atkBonus: 3
  }
});

describe('hypnotised and sleeping foes', () => {
  it('are passed over while anything else is still standing', () => {
    const hypnotised = mob('Hypnotised', 1.2);
    const awake = mob('Awake', 2.0);
    const g = game([hypnotised, awake]);
    applyEffect(hypnotised, 'unconscious', { duration: 60, elapsed: 0 });

    /* nearest-first would grab the hypnotised one; auto-crit scoring would
       positively want it */
    const pick = g.pickHeroTarget(hero(), []);
    expect(pick).toBe(awake);
  });

  it('are still attacked when they are all that is left', () => {
    /* Never return null here — that would drop the party out of combat and
       leave the fight hanging. */
    const a = mob('SleeperA', 1.2);
    const b = mob('SleeperB', 2.0);
    const g = game([a, b]);
    applyEffect(a, 'unconscious', { duration: 60, elapsed: 0 });
    applyEffect(b, 'unconscious', { duration: 60, elapsed: 0 });

    const pick = g.pickHeroTarget(hero(), []);
    expect(pick === a || pick === b).toBe(true);
  });

  it('are picked normally again once the effect lapses', () => {
    const near = mob('Near', 1.2);
    const far = mob('Far', 6.0);
    const g = game([near, far]);
    applyEffect(near, 'unconscious', { duration: 60, elapsed: 0 });
    expect(g.pickHeroTarget(hero(), [])).toBe(far);

    near._effects = null;
    near._effectCache = null;
    expect(hasEffect(near, 'unconscious')).toBe(false);
    expect(g.pickHeroTarget(hero(), [])).toBe(near);
  });

  it('does not change targeting for conditions that survive damage', () => {
    /* Only the break-on-damage condition is special. A slowed or frightened
       foe is still a perfectly good thing to hit. */
    const slowed = mob('Slowed', 1.2);
    const other = mob('Other', 2.0);
    const g = game([slowed, other]);
    applyEffect(slowed, 'slowed', { duration: 60, elapsed: 0 });
    expect(g.pickHeroTarget(hero(), [])).toBe(slowed);
  });
});

describe('the condition itself', () => {
  it('really does incapacitate — that half was never broken', () => {
    const m = mob('Hypnotised', 1.2);
    applyEffect(m, 'unconscious', { duration: 60, elapsed: 0 });
    expect(hasEffect(m, 'unconscious')).toBe(true);
    expect(getEffectMods(m).incapacitated).toBe(true);
    /* and it is why melee against it auto-crits */
    expect(getEffectMods(m).autoCritMelee).toBe(true);
  });
});
