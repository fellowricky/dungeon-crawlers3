import { describe, it, expect, vi, afterEach } from 'vitest';
import { heroDamage, roll } from '../src/game/srd.js';

/* A connecting hit deals at least 1. `roll(count, sides, bonus)` is a plain sum
   with no lower bound, so a negative ability modifier on a small die drops to 0
   or under — and BOTH application paths (damageMonster, applyIncomingDamage)
   end in `hp -= d`, which turns a negative into a heal.

   This is not an exotic build: makeHero defaults any unspecified stat to 8
   (mod -1) and abilityForWeapon returns 'str' for every non-finesse melee
   weapon, so a caster with a quarterstaff rolls 1d6-1 as a matter of course. */

afterEach(() => vi.restoreAllMocks());

/** Force every d(n) to its minimum, so the bonus decides the outcome. */
const worstCaseDice = () => vi.spyOn(Math, 'random').mockReturnValue(0);

const hero = (score, weapon) => ({
  level: 1,
  raceKey: 'human',
  effStats: { str: score, dex: score, con: 10, int: 10, wis: 10, cha: 10 },
  dmgBonus: 0,
  elemDamageTotal: 0,
  weaponProfile: weapon,
});

const DAGGER = { melee: true, dmg: [1, 4], ability: 'str', dmgType: 'piercing' };

describe('damage floor', () => {
  it('roll() itself is unbounded — this is the trap being guarded', () => {
    /* Documents WHY the callers clamp. If this ever starts flooring on its own,
       the guards can go, but roll() is also used for HP and healing where a
       floor of 0 would be wrong. */
    worstCaseDice();
    expect(roll(1, 4, -2)).toBeLessThan(0);
  });

  it('still deals 1 for a weak hero with a small weapon', () => {
    worstCaseDice();
    /* STR 6 -> mod -2, 1d4 rolling a 1 => -1 raw. */
    expect(heroDamage(hero(6, DAGGER), false, DAGGER)).toBe(1);
    /* STR 8 -> mod -1, 1d4 rolling a 1 => 0 raw. */
    expect(heroDamage(hero(8, DAGGER), false, DAGGER)).toBe(1);
    /* The realistic case: a caster's quarterstaff, non-finesse so it uses STR. */
    const STAFF = { melee: true, dmg: [1, 6], ability: 'str', dmgType: 'bludgeoning' };
    expect(heroDamage(hero(8, STAFF), false, STAFF)).toBe(1);
  });

  it('still pays out normally when the modifier is not negative', () => {
    worstCaseDice();
    /* STR 14 -> mod +2, 1d4 rolling a 1 => 3. The floor must not flatten this. */
    expect(heroDamage(hero(14, DAGGER), false, DAGGER)).toBe(3);
  });

  it('is never below 1 across the whole low-stat range', () => {
    for (const score of [3, 6, 7, 8, 9, 10]) {
      for (let i = 0; i < 200; i++) {
        expect(heroDamage(hero(score, DAGGER), false, DAGGER)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
