import { describe, it, expect } from 'vitest';
import { chargeDef, chargesLeft, spendCharge, restoreCharges } from '../src/game/features.js';
import { combatMethods } from '../src/game/combat.js';

describe('Fiendish Blessing Feature & Charge Tracking', () => {
  it('defines fiendishBlessing as exactly 1 use per short rest', () => {
    const def = chargeDef('fiendishBlessing', { level: 5 });
    expect(def.max).toBe(1);
    expect(def.recharge).toBe('short');
  });

  it('tracks charges properly across uses and short rests', () => {
    const hero = {
      data: {
        level: 3,
        classKey: 'warlock',
        subclass: 'fiend',
        hp: 24,
        maxHp: 24,
        charges: {}
      }
    };

    expect(chargesLeft(hero, 'fiendishBlessing')).toBe(1);
    expect(spendCharge(hero, 'fiendishBlessing')).toBe(true);
    expect(chargesLeft(hero, 'fiendishBlessing')).toBe(0);
    expect(spendCharge(hero, 'fiendishBlessing')).toBe(false);

    restoreCharges(hero, 'short');
    expect(chargesLeft(hero, 'fiendishBlessing')).toBe(1);
  });

  it('triggers once at start of combat and not repeatedly during battle', () => {
    const hero = {
      x: 10, z: 10,
      data: {
        name: 'Warlock',
        level: 3,
        classKey: 'warlock',
        subclass: 'fiend',
        hp: 20,
        maxHp: 24,
        tempHp: 0,
        charges: {},
        effStats: { cha: 16 }
      }
    };

    const mockGame = {
      ...combatMethods,
      playAbilityFx: () => {},
      fxLog: () => {},
      fxText: () => {},
      _v3: (x, y, z) => ({ x, y, z })
    };

    // First fight: triggers at combat start
    mockGame.subclassCombatStart(hero, [hero]);
    expect(hero.data.tempHp).toBe(10);
    expect(chargesLeft(hero, 'fiendishBlessing')).toBe(0);

    // Second fight before short rest: should not trigger again
    mockGame.subclassCombatStart(hero, [hero]);
    expect(hero.data.tempHp).toBe(10); // Unchanged from second fight
    expect(chargesLeft(hero, 'fiendishBlessing')).toBe(0);
  });
});
