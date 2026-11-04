import { describe, it, expect, vi } from 'vitest';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';

function setup(saved, level = 1) {
  const foe = { x: 4, z: 0, dead: false, data: { name: 'Goblin', hp: 30, maxHp: 30, scale: 1 } };
  const h = { x: 0, z: 0, data: { name: 'Lyra', level, effStats: { cha: 16 }, cls: 'bard', class: 'bard' } };
  const game = {
    fxNow: 0, monsters: [foe], heroes: [h],
    fxLog: vi.fn(), fxText: vi.fn(),
    _v3: (x, y, z) => ({ x, y, z }),
    fxChestPos: (e) => ({ x: e.x, y: 0.5, z: e.z }),
    fxGroundY: () => 0,
    playAbilityFx: vi.fn((_c, _k, o) => o.onImpact()),
    spellSave: vi.fn(() => saved),
    spellDamage: vi.fn(),
    fxBodyEffect: vi.fn(),
  };
  return { game, h, foe };
}

describe('Vicious Mockery', () => {
  it('on a failed save, deals psychic damage and rattles the target', () => {
    const { game, h, foe } = setup(false);
    expect(SPELLS.viciousMockery.cast(game, h, foe)).toBe(true);
    expect(game.spellSave).toHaveBeenCalledWith(foe, 'wis', expect.any(Number), { magic: true });
    const [, amt, , , opts] = game.spellDamage.mock.calls[0];
    expect(amt).toBeGreaterThanOrEqual(1);
    expect(amt).toBeLessThanOrEqual(4);
    expect(opts.dmgType).toBe('psychic');
    expect(hasEffect(foe, 'mocked')).toBe(true);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('mockeryConfused', foe);
  });

  it('on a successful save, does nothing to the target', () => {
    const { game, h, foe } = setup(true);
    SPELLS.viciousMockery.cast(game, h, foe);
    expect(game.spellDamage).not.toHaveBeenCalled();
    expect(hasEffect(foe, 'mocked')).toBe(false);
    expect(game.fxBodyEffect).not.toHaveBeenCalled();
  });

  it('rolls another die at levels 5, 11 and 17', () => {
    const { game, h, foe } = setup(false, 17);
    let top = 0;
    for (let i = 0; i < 200; i++) {
      game.spellDamage.mockClear();
      SPELLS.viciousMockery.cast(game, h, foe);
      top = Math.max(top, game.spellDamage.mock.calls[0][1]);
    }
    expect(top).toBeGreaterThan(4);
    expect(top).toBeLessThanOrEqual(16);
  });

  it('is on no class list yet, so nothing can learn it', () => {
    expect(JSON.stringify(SPELL_POOLS)).not.toContain('viciousMockery');
  });
});
