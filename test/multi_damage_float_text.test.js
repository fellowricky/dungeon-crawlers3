import { describe, it, expect, vi } from 'vitest';
import { combatMethods } from '../src/game/combat.js';

describe('Multi-Damage Type Floating Text Breakdown', () => {
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

  const createMonster = (statblock = {}) => ({
    x: 2,
    z: 3,
    roomId: 0,
    dead: false,
    active: true,
    data: {
      name: 'Training Dummy',
      hp: 100,
      maxHp: 100,
      scale: 1,
      statblock: {
        immune: statblock.immune || [],
        resist: statblock.resist || [],
        vulnerable: statblock.vulnerable || []
      }
    },
    ent: { bar: {}, grp: { visible: true } }
  });

  const hero = {
    data: {
      name: 'Hero',
      dmgDealt: 0
    }
  };

  it('shows the number and its type for single-type neutral damage with no modifiers', () => {
    const game = createMockGame();
    const mon = createMonster();

    // 8 slashing damage against neutral target
    const res = game.damageMonster(mon, 8, hero, false, {
      dmgType: 'slashing'
    });

    expect(res.dmg).toBe(8);
    expect(res.modLabel).toBeNull();
    expect(game.fxText).toHaveBeenCalledTimes(1);
    expect(game.fxText).toHaveBeenCalledWith('8 🗡️', expect.anything(), '#ff8a5a', false);
  });

  it('displays single-type vulnerable damage with green badge icon', () => {
    const game = createMockGame();
    const mon = createMonster({ vulnerable: ['fire'] });

    const res = game.damageMonster(mon, 8, hero, false, {
      dmgType: 'fire'
    });

    expect(res.dmg).toBe(16);
    expect(res.modLabel).toBe('⭕🔥');
    expect(game.fxText).toHaveBeenCalledTimes(1);
    expect(game.fxText).toHaveBeenCalledWith('16 ⭕🔥', expect.anything(), '#4ade80', false);
  });

  it('displays single-type resistant damage with red badge icon', () => {
    const game = createMockGame();
    const mon = createMonster({ resist: ['cold'] });

    const res = game.damageMonster(mon, 8, hero, false, {
      dmgType: 'cold'
    });

    expect(res.dmg).toBe(4);
    expect(res.modLabel).toBe('❌❄️');
    expect(game.fxText).toHaveBeenCalledTimes(1);
    expect(game.fxText).toHaveBeenCalledWith('4 ❌❄️', expect.anything(), '#ff8a7a', false);
  });

  it('separates multi-damage attack into distinct numbers with neutral icons (5 slashing + 2 fire)', () => {
    const game = createMockGame();
    const mon = createMonster();

    // 7 total damage: 5 slashing + 2 fire
    const res = game.damageMonster(mon, 7, hero, false, {
      dmgType: 'slashing',
      elemDamage: { fire: 2 }
    });

    expect(res.dmg).toBe(7);
    expect(game.fxText).toHaveBeenCalledTimes(2);
    expect(game.fxText).toHaveBeenNthCalledWith(1, '5 🗡️', expect.anything(), '#ff8a5a', false);
    expect(game.fxText).toHaveBeenNthCalledWith(2, '2 🔥', expect.anything(), '#ff8a5a', false);
  });

  it('applies crit styling across multiple damage numbers when attack is a critical hit', () => {
    const game = createMockGame();
    const mon = createMonster();

    // Crit strike with 10 slashing + 4 fire
    const res = game.damageMonster(mon, 14, hero, true, {
      dmgType: 'slashing',
      elemDamage: { fire: 4 }
    });

    expect(res.dmg).toBe(14);
    expect(game.fxText).toHaveBeenCalledTimes(2);
    expect(game.fxText).toHaveBeenNthCalledWith(1, '10 🗡️', expect.anything(), '#ffd34a', true);
    expect(game.fxText).toHaveBeenNthCalledWith(2, '4 🔥', expect.anything(), '#ffd34a', true);
  });

  it('handles multi-damage attack with mixed neutral and vulnerable components', () => {
    const game = createMockGame();
    const mon = createMonster({ vulnerable: ['fire'] });

    // 5 piercing + 3 fire (fire vulnerable -> 6) => total 11 damage
    const res = game.damageMonster(mon, 8, hero, false, {
      dmgType: 'piercing',
      elemDamage: { fire: 3 }
    });

    expect(res.dmg).toBe(11);
    expect(game.fxText).toHaveBeenCalledTimes(2);
    // Piercing is neutral
    expect(game.fxText).toHaveBeenNthCalledWith(1, '5 🏹', expect.anything(), '#ff8a5a', false);
    // Fire is vulnerable
    expect(game.fxText).toHaveBeenNthCalledWith(2, '6 ⭕🔥', expect.anything(), '#4ade80', false);
  });

  it('handles multi-damage attack with immunity on one component', () => {
    const game = createMockGame();
    const mon = createMonster({
      immune: ['bludgeoning, piercing, and slashing from nonmagical weapons']
    });

    // 8 total damage: 5 slashing (nonmagical -> immune) + 3 fire (neutral)
    const res = game.damageMonster(mon, 8, hero, false, {
      dmgType: 'slashing',
      magical: false,
      elemDamage: { fire: 3 }
    });

    expect(res.dmg).toBe(3);
    expect(game.fxText).toHaveBeenCalledTimes(2);
    // Physical is immune
    expect(game.fxText).toHaveBeenNthCalledWith(1, 'IMMUNE 🗡️', expect.anything(), '#9aa');
    // Fire goes through
    expect(game.fxText).toHaveBeenNthCalledWith(2, '3 🔥', expect.anything(), '#ff8a5a', false);
  });

  it('handles multi-damage attack with three components (slashing, fire, and radiant)', () => {
    const game = createMockGame();
    const mon = createMonster({ resist: ['fire'] });

    // 15 total: 8 bludgeoning + 4 fire (resisted to 2) + 3 radiant
    const res = game.damageMonster(mon, 15, hero, false, {
      dmgType: 'bludgeoning',
      elemDamage: { fire: 4, radiant: 3 }
    });

    expect(res.dmg).toBe(13); // 8 + 2 + 3
    expect(game.fxText).toHaveBeenCalledTimes(3);
    expect(game.fxText).toHaveBeenNthCalledWith(1, '8 🔨', expect.anything(), '#ff8a5a', false);
    expect(game.fxText).toHaveBeenNthCalledWith(2, '2 ❌🔥', expect.anything(), '#ff8a7a', false);
    expect(game.fxText).toHaveBeenNthCalledWith(3, '3 ✨', expect.anything(), '#ff8a5a', false);
  });
});
