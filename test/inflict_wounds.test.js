import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Cleric', hp: 20, maxHp: 20, level: 1, dmgBonus: 0 } };
  const game = {
    markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), spellDamage: vi.fn(),
    fxScytheReap: vi.fn(), fxManaBurst: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, pending };
}

describe('Inflict Wounds', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.inflictWounds;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('reaps, then bursts in blood, then hurts on the burst flash', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.inflictWounds.cast(game, h, foe);
    expect(pending.map(p => +p.sec.toFixed(2))).toEqual([0, 0.56, 0.78]);
    pending[0].cb();
    expect(game.fxScytheReap).toHaveBeenCalledWith(foe, h, 0.7);
    pending[1].cb();
    expect(game.fxManaBurst).toHaveBeenCalledWith(foe, 'blood', 0.7);
    expect(game.spellDamage).not.toHaveBeenCalled();
    pending[2].cb();
    expect(game.spellDamage).toHaveBeenCalled();
  });

  it('does not hurt a corpse', () => {
    const { game, h, foe, pending } = setup();
    SPELLS.inflictWounds.cast(game, h, foe);
    foe.dead = true;
    pending[2].cb();
    expect(game.spellDamage).not.toHaveBeenCalled();
  });
});
