import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';

function setup(hp) {
  const pending = [];
  const foe = { x: 1, z: 1, dead: false, active: true, data: { name: 'Rat', hp, maxHp: hp } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Wizard', hp: 20, maxHp: 20 } };
  const game = {
    fxNow: 0, heroes: [h], monsters: [foe], markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxWardCircle: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Sleep', () => {
  it('opens a night circle, and they drop as it turns', () => {
    const { game, h, foe, pending } = setup(1);
    SPELLS.sleep.cast(game, h, foe);
    expect(hasEffect(foe, 'unconscious')).toBe(false);
    pending[0].cb();
    expect(game.fxWardCircle).toHaveBeenCalledWith(foe, 'hush');
    expect(pending[1].sec).toBeCloseTo(0.6);
    pending[1].cb();
    expect(hasEffect(foe, 'unconscious')).toBe(true);
  });

  it('shows the circle on the target even when the pool covers nobody', () => {
    const { game, h, foe, pending } = setup(9999);
    SPELLS.sleep.cast(game, h, foe);
    pending[0].cb();
    pending[1].cb();
    expect(game.fxWardCircle).toHaveBeenCalledWith(foe, 'hush');
    expect(hasEffect(foe, 'unconscious')).toBe(false);
  });

  it('does not put a corpse to sleep', () => {
    const { game, h, foe, pending } = setup(1);
    SPELLS.sleep.cast(game, h, foe);
    foe.dead = true;
    pending[1].cb();
    expect(hasEffect(foe, 'unconscious')).toBe(false);
  });
});
