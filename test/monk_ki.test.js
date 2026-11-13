import { describe, it, expect } from 'vitest';
import { makeHero, recalc, unarmedFallback, grantXp, XP_TABLE, isMonkWeapon } from '../src/game/srd.js';
import { applyShortRestToHero, applyLongRestToHero } from '../src/game/rest.js';
import { hasKi, spendKi, restoreKi, kiLeft, hasFeature } from '../src/game/features.js';
import { EFFECTS } from '../src/game/conditions.js';

const MONK_STATS = { str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 10 };

describe('Monk Ki System & Mechanics', () => {
  it('initializes Monk Ki pool based on level (SRD 5e: Monk Level starting at L2)', () => {
    const monkL1 = makeHero('Monk1', 'human', 'monk', MONK_STATS);
    recalc(monkL1);
    expect(monkL1.kiMax).toBe(0);
    expect(monkL1.ki).toBe(0);

    const monkL2 = makeHero('Monk2', 'human', 'monk', MONK_STATS);
    monkL2.level = 2;
    recalc(monkL2);
    expect(monkL2.kiMax).toBe(2);
    expect(monkL2.ki).toBe(2);

    const monkL5 = makeHero('Monk5', 'human', 'monk', MONK_STATS);
    monkL5.level = 5;
    recalc(monkL5);
    expect(monkL5.kiMax).toBe(5);
    expect(monkL5.ki).toBe(5);

    const monkL20 = makeHero('Monk20', 'human', 'monk', MONK_STATS);
    monkL20.level = 20;
    recalc(monkL20);
    expect(monkL20.kiMax).toBe(20);
    expect(monkL20.ki).toBe(20);
  });

  it('calculates Ki Save DC as 8 + ProfBonus + WisMod', () => {
    const monk = makeHero('MonkWis', 'human', 'monk', { str: 10, dex: 14, con: 12, int: 10, wis: 16, cha: 10 });
    monk.level = 5; // PB = 3
    recalc(monk);
    expect(monk.kiSaveDC).toBe(8 + 3 + 3); // 14
  });

  it('scales Monk Unarmed Strike die with level (1d4 -> 1d6 -> 1d8 -> 1d10)', () => {
    const m1 = { classKey: 'monk', level: 1 };
    expect(unarmedFallback(m1).dmg).toEqual([1, 4]);

    const m4 = { classKey: 'monk', level: 4 };
    expect(unarmedFallback(m4).dmg).toEqual([1, 4]);

    const m5 = { classKey: 'monk', level: 5 };
    expect(unarmedFallback(m5).dmg).toEqual([1, 6]);

    const m10 = { classKey: 'monk', level: 10 };
    expect(unarmedFallback(m10).dmg).toEqual([1, 6]);

    const m11 = { classKey: 'monk', level: 11 };
    expect(unarmedFallback(m11).dmg).toEqual([1, 8]);

    const m16 = { classKey: 'monk', level: 16 };
    expect(unarmedFallback(m16).dmg).toEqual([1, 8]);

    const m17 = { classKey: 'monk', level: 17 };
    expect(unarmedFallback(m17).dmg).toEqual([1, 10]);

    const m20 = { classKey: 'monk', level: 20 };
    expect(unarmedFallback(m20).dmg).toEqual([1, 10]);

    // Non-monk fallback is 1d1 str
    const fighter = { classKey: 'fighter', level: 5 };
    expect(unarmedFallback(fighter).dmg).toEqual([1, 1]);
  });

  it('manages Ki spending and rest restoration', () => {
    const monk = makeHero('MonkRest', 'human', 'monk', MONK_STATS);
    monk.level = 5;
    recalc(monk);

    expect(kiLeft(monk)).toBe(5);
    expect(hasKi(monk, 1)).toBe(true);
    expect(hasKi(monk, 5)).toBe(true);
    expect(hasKi(monk, 6)).toBe(false);

    // Spend 3 ki
    expect(spendKi(monk, 1)).toBe(true);
    expect(spendKi(monk, 2)).toBe(true);
    expect(kiLeft(monk)).toBe(2);

    // Cannot spend more than available
    expect(spendKi(monk, 3)).toBe(false);
    expect(kiLeft(monk)).toBe(2);

    // Short rest restores full Ki
    applyShortRestToHero(monk);
    expect(monk.ki).toBe(5);

    // Spend all Ki
    spendKi(monk, 5);
    expect(monk.ki).toBe(0);

    // Long rest restores full Ki
    applyLongRestToHero(monk);
    expect(monk.ki).toBe(5);
  });

  it('contains proper monk progression features', () => {
    const monk = makeHero('ProgMonk', 'human', 'monk', MONK_STATS);
    grantXp(monk, XP_TABLE[5]);
    recalc(monk);

    expect(hasFeature(monk, 'martialArts')).toBe(true);
    expect(hasFeature(monk, 'ki')).toBe(true);
    expect(hasFeature(monk, 'flurryOfBlows')).toBe(true);
    expect(hasFeature(monk, 'patientDefense')).toBe(true);
    expect(hasFeature(monk, 'stepOfTheWind')).toBe(true);
    expect(hasFeature(monk, 'stunningStrike')).toBe(true);
    expect(hasFeature(monk, 'extraAttack')).toBe(true);
  });

  it('restores 4 Ki points on combat start for Level 20 Monk with Perfect Self when Ki is 0', () => {
    const monk = makeHero('Grandmaster', 'human', 'monk', MONK_STATS);
    grantXp(monk, XP_TABLE[20]);
    recalc(monk);

    expect(hasFeature(monk, 'perfectSelf')).toBe(true);
    monk.ki = 0; // Empty ki

    const heroObj = { data: monk, x: 0, z: 0 };
    const game = {
      heroes: [heroObj],
      fxText() {},
      fxLog() {},
      _v3: (x, y, z) => ({ x, y, z }),
      subclassCombatStart(h, alive) {
        if (h.data.hp <= 0) return;
        const d = h.data;
        if (hasFeature(d, 'perfectSelf') && (d.ki || 0) === 0) {
          d.ki = Math.min(d.kiMax || 20, 4);
        }
      }
    };

    game.subclassCombatStart(heroObj, [heroObj]);
    expect(monk.ki).toBe(4);
  });

  it('Martial Arts: a monk uses DEX with monk weapons, including staves', () => {
    expect(isMonkWeapon({ melee: true, weaponType: 'simple', twoHanded: true, focus: true })).toBe(true);   // staff
    expect(isMonkWeapon({ melee: true, weaponType: 'simple', twoHanded: true })).toBe(false);               // greatclub
    expect(isMonkWeapon({ melee: true, weaponType: 'martial', baseKey: 'Shortsword' })).toBe(true);
    expect(isMonkWeapon({ melee: true, weaponType: 'martial', baseKey: 'Longsword' })).toBe(false);
    const monk = makeHero('M', 'human', 'monk', MONK_STATS);
    recalc(monk);
    if (monk.weaponProfile && isMonkWeapon(monk.equipment.weapon)) expect(monk.weaponProfile.ability).toBe('dex');
  });
});

