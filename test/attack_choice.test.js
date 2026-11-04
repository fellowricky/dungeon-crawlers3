import { describe, it, expect } from 'vitest';
import { chooseHeroAttackProfile, heroAttackEv } from '../src/game/combat_eval.js';

/* A cleric with a mace and Sacred Flame (DEX save) — the case that started
   this: it should read the foe, not flip a coin. */
function cleric({ rangedPref = 0.5, level = 1 } = {}) {
  return {
    x: 0, z: 0, moveLeft: 6,
    data: {
      name: 'Cleric', classKey: 'cleric', level, atkProf: 2, dmgBonus: 0, _classAtk: 'wis',
      effStats: { str: 14, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
      aiPrefs: { rangedPref },
      weaponProfile: { name: 'Mace', ability: 'str', dmg: [1, 6], range: 1.5, melee: true, dmgType: 'bludgeoning' },
      cantripProfile: { name: 'Sacred Flame', ability: 'wis', dmg: [1, 8], range: 6, melee: false,
        cantripScale: true, isSave: true, saveAbility: 'dex', source: 'cantrip', dmgType: 'radiant' }
    }
  };
}
const foe = (over = {}) => ({ x: 1, z: 0, data: { name: 'Foe', hp: 20, maxHp: 20, ac: 12, effStats: { dex: 10 }, ...over } });

describe('weapon or cantrip', () => {
  it('casts at the armoured, clumsy target and swings at the soft, nimble one', () => {
    const knight = foe({ ac: 20, effStats: { dex: 8 } });
    expect(chooseHeroAttackProfile(cleric(), knight, null).name).toBe('Sacred Flame');
    const skirmisher = foe({ ac: 10, effStats: { dex: 18 } });
    expect(chooseHeroAttackProfile(cleric(), skirmisher, null).name).toBe('Mace');
  });

  it('uses the cantrip when the foe is beyond walking reach this turn', () => {
    const far = { ...foe({ ac: 8, effStats: { dex: 18 } }), x: 7 };   // flame reaches (6 + 2), the mace can't (1.5 + 2)
    const h = cleric(); h.moveLeft = 2;
    expect(chooseHeroAttackProfile(h, far, null).name).toBe('Sacred Flame');
  });

  it('lets the AI Priorities ranged lean tip a close call', () => {
    const even = foe({ ac: 13, effStats: { dex: 12 } });
    const kite = chooseHeroAttackProfile(cleric({ rangedPref: 1 }), even, null).name;
    const hold = chooseHeroAttackProfile(cleric({ rangedPref: 0 }), even, null).name;
    expect(kite).toBe('Sacred Flame');
    expect(hold).toBe('Mace');
  });

  it('leaves no-choice heroes to the old rules', () => {
    const h = cleric(); h.data.cantripProfile = null;
    expect(chooseHeroAttackProfile(h, foe(), null)).toBeNull();
    const s = cleric(); s.data._effects = { silenced: {} };
    expect(chooseHeroAttackProfile(s, foe(), null)).toBeNull();
  });

  it('values a cantrip by its level-scaled dice, with no ability modifier or Extra Attack', () => {
    const f = foe({ effStats: { dex: 10 } });
    const lvl1 = heroAttackEv(cleric({ level: 1 }), cleric().data.cantripProfile, f, null);
    const lvl5 = heroAttackEv(cleric({ level: 5 }), cleric().data.cantripProfile, f, null);
    /* 1d8 → 2d8 doubles the damage; the DC also rises by one at level 5 */
    expect(lvl5 / lvl1).toBeGreaterThan(1.9);
    /* level 1: DC 13 vs +0 → fails 60%; avg 1d8 = 4.5 → 2.7 */
    expect(lvl1).toBeCloseTo(2.7, 1);
  });
});
