import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';

function setup() {
  const unit = (name) => ({ x: 0, z: 0, data: { name, hp: 20, maxHp: 20 } });
  const h = unit('Cleric'), a = unit('Rogue');
  const pending = [];
  const game = {
    fxNow: 0, heroes: [h, a],
    fxLog: vi.fn(), markSpellUsed: vi.fn(), concentrate: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, a, pending };
}

describe('Bless: a blessing, then a halo', () => {
  it('plays the cone on every ally, with no status yet', () => {
    const { game, h, a } = setup();
    expect(SPELLS.bless.cast(game, h, null, [h, a])).toBe(true);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('blessing', h);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('blessing', a);
    expect(hasEffect(a, 'blessed')).toBe(false);
  });

  it('blesses them as the cone fades, and concentrates on it', () => {
    const { game, h, a, pending } = setup();
    SPELLS.bless.cast(game, h, null, [h, a]);
    expect(pending[0].sec).toBeCloseTo(2.5);
    pending[0].cb();
    expect(hasEffect(h, 'blessed')).toBe(true);
    expect(hasEffect(a, 'blessed')).toBe(true);
    expect(game.concentrate.mock.calls[0][2]).toHaveLength(2);
  });

  it('passes over an ally who fell in the meantime', () => {
    const { game, h, a, pending } = setup();
    SPELLS.bless.cast(game, h, null, [h, a]);
    a.data.hp = 0;
    pending[0].cb();
    expect(hasEffect(a, 'blessed')).toBe(false);
    expect(hasEffect(h, 'blessed')).toBe(true);
  });

  it('fizzles if the caster falls first', () => {
    const { game, h, a, pending } = setup();
    SPELLS.bless.cast(game, h, null, [h, a]);
    h.data.hp = 0;
    pending[0].cb();
    expect(hasEffect(a, 'blessed')).toBe(false);
    expect(game.concentrate).not.toHaveBeenCalled();
  });
});
