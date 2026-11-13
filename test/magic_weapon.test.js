import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';

function setup() {
  const pending = [];
  const h = { x: 0, z: 0, data: { name: 'Paladin', hp: 20, maxHp: 20 } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), concentrate: vi.fn(), playAbilityFx: vi.fn(),
    fxDelay: (_s, fn) => pending.push(fn),
  };
  return { game, h, flush: () => pending.splice(0).forEach((fn) => fn()) };
}

describe('Magic Weapon', () => {
  it('takes hold when the charge ends, with concentration', () => {
    const { game, h, flush } = setup();
    expect(SPELLS.magicWeapon.cast(game, h)).toBe(true);
    expect(hasEffect(h, 'magicWeapon')).toBe(false);
    expect(game.playAbilityFx).toHaveBeenCalledWith(h, 'magicWeapon', expect.objectContaining({ at: h, spell: true }));
    flush();
    expect(hasEffect(h, 'magicWeapon')).toBe(true);
    expect(game.concentrate).toHaveBeenCalledWith(h, 'magicWeapon', [{ e: h, key: 'magicWeapon' }]);
  });

  it('fizzles if the caster falls during the charge', () => {
    const { game, h, flush } = setup();
    SPELLS.magicWeapon.cast(game, h);
    h.data.hp = 0;
    flush();
    expect(hasEffect(h, 'magicWeapon')).toBe(false);
    expect(game.concentrate).not.toHaveBeenCalled();
  });
});
