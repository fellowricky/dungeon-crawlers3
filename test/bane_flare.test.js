import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';

function setup(saved = false) {
  const foe = { x: 2, z: 0, dead: false, active: true, data: { name: 'Goblin', hp: 10, maxHp: 10, scale: 1 } };
  const h = { x: 0, z: 0, data: { name: 'Lyra', level: 3, hp: 20, effStats: { cha: 16 } } };
  const pending = [];
  const game = {
    fxNow: 0, monsters: [foe], heroes: [h],
    fxLog: vi.fn(), fxText: vi.fn(), markSpellUsed: vi.fn(), concentrate: vi.fn(),
    playAbilityFx: vi.fn(), spellSave: vi.fn(() => saved), hasLOS: () => true,
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Bane lands on the sigil\'s flare', () => {
  it('plays over the target, with no save or curse until the flare', () => {
    const { game, h, foe, pending } = setup();
    expect(SPELLS.bane.cast(game, h, foe)).toBe(true);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(foe);
    expect(game.spellSave).not.toHaveBeenCalled();
    expect(hasEffect(foe, 'baned')).toBe(false);
    expect(pending[0].sec).toBeCloseTo(2.6);
  });

  it('curses a foe that fails its save, and concentrates on it', () => {
    const { game, h, foe, pending } = setup(false);
    SPELLS.bane.cast(game, h, foe);
    pending[0].cb();
    expect(hasEffect(foe, 'baned')).toBe(true);
    expect(game.concentrate).toHaveBeenCalledWith(h, 'bane', [{ e: foe, key: 'baned' }]);
  });

  it('spares a foe that saves', () => {
    const { game, h, foe, pending } = setup(true);
    SPELLS.bane.cast(game, h, foe);
    pending[0].cb();
    expect(hasEffect(foe, 'baned')).toBe(false);
  });

  it('fizzles if the caster falls before the flare', () => {
    const { game, h, foe, pending } = setup(false);
    SPELLS.bane.cast(game, h, foe);
    h.data.hp = 0;
    pending[0].cb();
    expect(hasEffect(foe, 'baned')).toBe(false);
    expect(game.concentrate).not.toHaveBeenCalled();
  });
});
