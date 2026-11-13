import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const ally = { x: 3, z: 0, _side: 'hero', data: { name: 'Ally', hp: 2, maxHp: 20 } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Cleric', hp: 20, maxHp: 20, level: 1 } };
  const game = {
    heroes: [h, ally],
    markSpellUsed: vi.fn(), fxLog: vi.fn(), healHero: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, ally, pending };
}

describe('Cure Wounds', () => {
  it('plays Heal on the ally, and aims the cast at them so the caster turns', () => {
    const { game, h, ally } = setup();
    SPELLS.cureWounds.cast(game, h, ally, [h, ally], 1);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('cureWounds', ally);
    expect(game.playAbilityFx.mock.calls[0][2]).toMatchObject({ at: ally, spell: true });
  });

  it('heals when the hoop reaches the top, not on the cast', () => {
    const { game, h, ally, pending } = setup();
    SPELLS.cureWounds.cast(game, h, ally, [h, ally], 1);
    expect(game.healHero).not.toHaveBeenCalled();
    expect(pending[0].sec).toBeCloseTo(0.74);
    pending[0].cb();
    expect(game.healHero).toHaveBeenCalledWith(ally, expect.any(Number), expect.anything());   // the caster, credited with the healing (healDone)
  });

  it('has no flight, and holds the turn for the whole effect', () => {
    const { travel, impact } = anims.anims.cureWounds;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
    expect(travel.duration + impact.back.dur).toBeCloseTo(1.9);
  });
});
