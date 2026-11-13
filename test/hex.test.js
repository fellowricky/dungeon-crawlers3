import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Warlock', hp: 20, maxHp: 20, level: 3 } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(), concentrate: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Hex', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.hex;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('plays the curse now, and takes hold when the skull stamps', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.hex.cast(game, h, foe);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('hexCurse', foe);
    expect(hasEffect(foe, 'hexMarked')).toBe(false);
    expect(pending[0].sec).toBeCloseTo(0.55);
    pending[0].cb();
    expect(hasEffect(foe, 'hexMarked')).toBe(true);
    expect(game.concentrate.mock.calls[0][1]).toBe('hex');
  });

  it('does not curse a foe that dies before the stamp', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.hex.cast(game, h, foe);
    foe.dead = true;
    pending[0].cb();
    expect(hasEffect(foe, 'hexMarked')).toBe(false);
    expect(game.concentrate).not.toHaveBeenCalled();
  });
});
