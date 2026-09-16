import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import MONSTERS from '../src/game/monsters.json' with { type: 'json' };

describe('Elemental Weapon Damage vs Nonmagical Weapon Immunity', () => {
  const createMockGame = () => {
    const game = {
      monsters: [],
      heroes: [],
      fxNow: 0,
      _v3: (x, y, z) => ({ x, y, z }),
      fxHitFlash: vi.fn(),
      fxText: vi.fn(),
      fxDrawBar: vi.fn(),
      fxLog: vi.fn(),
      activateRoomMonsters: vi.fn(),
      creditThreat: vi.fn()
    };
    Object.assign(game, combatMethods);
    return game;
  };

  it('applies elemental damage from weapon affixes even when monster is immune to nonmagical physical damage', () => {
    const game = createMockGame();
    const wereratDef = MONSTERS.find(m => m.id === 'wererat-hybrid');
    expect(wereratDef).toBeDefined();

    const monster = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        id: 'wererat-hybrid',
        name: 'Wererat, Hybrid Form',
        hp: 30,
        maxHp: 30,
        scale: 1,
        statblock: JSON.parse(JSON.stringify(wereratDef.statblock))
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    // 1. Plain nonmagical physical weapon attack: 10 piercing damage
    const heroNoElem = {
      data: {
        name: 'Fighter',
        elemDamage: {},
        elemDamageTotal: 0,
        dmgDealt: 0
      }
    };

    const res1 = game.damageMonster(monster, 10, heroNoElem, false, {
      dmgType: 'piercing',
      magical: false,
      elemDamage: null
    });

    expect(res1.modLabel).toBe('IMMUNE');
    expect(res1.dmg).toBe(0);
    expect(monster.data.hp).toBe(30);

    // 2. Spear with +3 fire damage: total 10 damage (7 piercing + 3 fire)
    const heroWithFire = {
      data: {
        name: 'Fighter',
        elemDamage: { fire: 3 },
        elemDamageTotal: 3,
        dmgDealt: 0
      }
    };

    const res2 = game.damageMonster(monster, 10, heroWithFire, false, {
      dmgType: 'piercing',
      magical: false,
      elemDamage: { fire: 3 }
    });

    // Piercing is 0 (immune), Fire is 3 -> Total 3 damage dealt
    expect(res2.dmg).toBe(3);
    expect(monster.data.hp).toBe(27);
  });

  it('correctly modifies elemental damage against monsters with elemental resistances or vulnerabilities', () => {
    const game = createMockGame();

    // Monster immune to nonmagical piercing, vulnerable to fire
    const mummyLike = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        name: 'Mummy',
        hp: 50,
        maxHp: 50,
        scale: 1,
        statblock: {
          immune: ['bludgeoning, piercing, and slashing from nonmagical weapons'],
          resist: [],
          vulnerable: ['fire']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Paladin',
        elemDamage: { fire: 4 },
        elemDamageTotal: 4,
        dmgDealt: 0
      }
    };

    // 12 total damage (8 piercing + 4 fire)
    const res = game.damageMonster(mummyLike, 12, hero, false, {
      dmgType: 'piercing',
      magical: false,
      elemDamage: { fire: 4 }
    });

    // Piercing 8 -> 0 (immune). Fire 4 -> 8 (vulnerable). Total = 8 damage dealt.
    expect(res.dmg).toBe(8);
    expect(mummyLike.data.hp).toBe(42);
  });

  it('allows full physical damage through when attack is magical (e.g. Magic Weapon spell)', () => {
    const game = createMockGame();
    const wereratDef = MONSTERS.find(m => m.id === 'wererat-hybrid');
    const monster = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        id: 'wererat-hybrid',
        name: 'Wererat',
        hp: 30,
        maxHp: 30,
        scale: 1,
        statblock: JSON.parse(JSON.stringify(wereratDef.statblock))
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Wizard',
        elemDamage: { fire: 3 },
        elemDamageTotal: 3,
        dmgDealt: 0
      }
    };

    // 10 total damage with magical: true (Magic Weapon active)
    const res = game.damageMonster(monster, 10, hero, false, {
      dmgType: 'piercing',
      magical: true,
      elemDamage: { fire: 3 }
    });

    // Piercing 7 (magical -> not immune) + Fire 3 -> Total 10 damage dealt
    expect(res.dmg).toBe(10);
    expect(monster.data.hp).toBe(20);
  });
});
