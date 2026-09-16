import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';
import { DAMAGE_TYPE_ICONS } from '../src/game/constants.js';
import { parseFloatTextTokens } from '../src/game/entities.js';

describe('Combat Resistance Floating Text Indicators', () => {
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

  it('defines damage type icons for all 5e damage types', () => {
    expect(DAMAGE_TYPE_ICONS.fire).toBe('🔥');
    expect(DAMAGE_TYPE_ICONS.cold).toBe('❄️');
    expect(DAMAGE_TYPE_ICONS.lightning).toBe('⚡');
    expect(DAMAGE_TYPE_ICONS.acid).toBe('🧪');
    expect(DAMAGE_TYPE_ICONS.poison).toBe('☠️');
    expect(DAMAGE_TYPE_ICONS.necrotic).toBe('💀');
    expect(DAMAGE_TYPE_ICONS.radiant).toBe('✨');
    expect(DAMAGE_TYPE_ICONS.force).toBe('💫');
    expect(DAMAGE_TYPE_ICONS.psychic).toBe('👁️');
    expect(DAMAGE_TYPE_ICONS.slashing).toBe('🗡️');
    expect(DAMAGE_TYPE_ICONS.piercing).toBe('🏹');
    expect(DAMAGE_TYPE_ICONS.bludgeoning).toBe('🔨');
  });

  it('displays ❌[icon] instead of text word RESIST when dealing resisted elemental damage', () => {
    const mockGame = createMockGame();

    // Monster resistant to fire
    const fireResistantMon = {
      x: 10, z: 10, roomId: 0, dead: false, active: true,
      data: {
        name: 'Fire Imp',
        hp: 40,
        maxHp: 40,
        scale: 1,
        statblock: {
          resist: ['fire']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Wizard',
        dmgDealt: 0
      }
    };

    const res = mockGame.damageMonster(fireResistantMon, 20, hero, false, {
      dmgType: 'fire',
      magical: true
    });

    expect(res.dmg).toBe(10);
    expect(res.modLabel).toBe('❌🔥');
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '10 ❌🔥',
      expect.anything(),
      '#ff8a7a',
      false
    );
  });

  it('displays physical resistance icon ❌🗡️ for slashing resistance', () => {
    const mockGame = createMockGame();

    const gargoyle = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        name: 'Gargoyle',
        hp: 50,
        maxHp: 50,
        scale: 1,
        statblock: {
          resist: ['bludgeoning, piercing, and slashing from nonmagical attacks']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Fighter',
        dmgDealt: 0
      }
    };

    const res = mockGame.damageMonster(gargoyle, 16, hero, false, {
      dmgType: 'slashing',
      magical: false
    });

    expect(res.dmg).toBe(8);
    expect(res.modLabel).toBe('❌🗡️');
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '8 ❌🗡️',
      expect.anything(),
      '#ff8a7a',
      false
    );
  });

  it('displays multi-elemental resistance icons for hybrid attacks', () => {
    const mockGame = createMockGame();

    const monster = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        name: 'Iron Golem',
        hp: 100,
        maxHp: 100,
        scale: 1,
        statblock: {
          resist: ['fire', 'cold']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Mage Knight',
        dmgDealt: 0
      }
    };

    // 10 fire + 10 cold
    const res = mockGame.damageMonster(monster, 20, hero, false, {
      elemDamage: { fire: 10, cold: 10 }
    });

    // 5 + 5 = 10
    expect(res.dmg).toBe(10);
    expect(res.modLabel).toBe('❌🔥❄️');
  });

  it('displays ⭕[icon] instead of text word VULNERABLE with green text when dealing vulnerable damage', () => {
    const mockGame = createMockGame();

    // Monster vulnerable to fire (e.g. Mummy / Plant)
    const vulnerableMon = {
      x: 10, z: 10, roomId: 0, dead: false, active: true,
      data: {
        name: 'Mummy',
        hp: 60,
        maxHp: 60,
        scale: 1,
        statblock: {
          vulnerable: ['fire']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Wizard',
        dmgDealt: 0
      }
    };

    const res = mockGame.damageMonster(vulnerableMon, 15, hero, false, {
      dmgType: 'fire',
      magical: true
    });

    // 15 * 2 = 30
    expect(res.dmg).toBe(30);
    expect(res.modLabel).toBe('⭕🔥');
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '30 ⭕🔥',
      expect.anything(),
      '#4ade80',
      false
    );
  });

  it('displays physical vulnerability icon ⭕🔨 for bludgeoning vulnerability (e.g. Skeletons)', () => {
    const mockGame = createMockGame();

    const skeleton = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        name: 'Skeleton',
        hp: 30,
        maxHp: 30,
        scale: 1,
        statblock: {
          vulnerable: ['bludgeoning']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Cleric',
        dmgDealt: 0
      }
    };

    const res = mockGame.damageMonster(skeleton, 12, hero, false, {
      dmgType: 'bludgeoning',
      magical: false
    });

    // 12 * 2 = 24
    expect(res.dmg).toBe(24);
    expect(res.modLabel).toBe('⭕🔨');
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '24 ⭕🔨',
      expect.anything(),
      '#4ade80',
      false
    );
  });

  it('displays hybrid vulnerability and resistance in multi-element attacks', () => {
    const mockGame = createMockGame();

    const hybridMon = {
      x: 5, z: 5, roomId: 0, dead: false, active: true,
      data: {
        name: 'Frost Drake',
        hp: 80,
        maxHp: 80,
        scale: 1,
        statblock: {
          vulnerable: ['fire'],
          resist: ['cold']
        }
      },
      ent: { bar: {}, grp: { visible: true } }
    };

    const hero = {
      data: {
        name: 'Sorcerer',
        dmgDealt: 0
      }
    };

    // 10 fire (vuln -> 20) + 10 cold (resist -> 5) = 25
    const res = mockGame.damageMonster(hybridMon, 20, hero, false, {
      elemDamage: { fire: 10, cold: 10 }
    });

    expect(res.dmg).toBe(25);
    expect(res.modLabel).toBe('⭕🔥 ❌❄️');
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '20 ⭕🔥',
      expect.anything(),
      '#4ade80',
      false
    );
    expect(mockGame.fxText).toHaveBeenCalledWith(
      '5 ❌❄️',
      expect.anything(),
      '#ff8a7a',
      false
    );
  });

  it('correctly tokenizes floating text into plain text and icon badge layers', () => {
    // Plain text has no badges
    expect(parseFloatTextTokens('15')).toEqual([{ type: 'text', text: '15' }]);
    expect(parseFloatTextTokens('miss')).toEqual([{ type: 'text', text: 'miss' }]);

    // Resistance with Red X layer behind icon
    const resistTokens = parseFloatTextTokens('10 ❌🔥');
    expect(resistTokens).toEqual([
      { type: 'text', text: '10 ' },
      { type: 'badge', kind: 'resist', icon: '🔥' }
    ]);

    // Multiple resistance icons
    const multiResist = parseFloatTextTokens('8 ❌🗡️🏹');
    expect(multiResist).toEqual([
      { type: 'text', text: '8 ' },
      { type: 'badge', kind: 'resist', icon: '🗡️' },
      { type: 'badge', kind: 'resist', icon: '🏹' }
    ]);

    // Vulnerability with Green Circle layer behind icon
    const vulnTokens = parseFloatTextTokens('30 ⭕⚡');
    expect(vulnTokens).toEqual([
      { type: 'text', text: '30 ' },
      { type: 'badge', kind: 'vuln', icon: '⚡' }
    ]);

    // Mixed vulnerability and resistance
    const mixedTokens = parseFloatTextTokens('25 ⭕🔥 ❌❄️');
    expect(mixedTokens).toEqual([
      { type: 'text', text: '25 ' },
      { type: 'badge', kind: 'vuln', icon: '🔥' },
      { type: 'text', text: ' ' },
      { type: 'badge', kind: 'resist', icon: '❄️' }
    ]);

    // Neutral damage type icons without vuln/resist prefixes
    const neutralTokens = parseFloatTextTokens('5 🗡️');
    expect(neutralTokens).toEqual([
      { type: 'text', text: '5 ' },
      { type: 'badge', kind: 'neutral', icon: '🗡️' }
    ]);
  });
});
