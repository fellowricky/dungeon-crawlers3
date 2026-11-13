import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { combatMethods } from '../src/game/combat.js';
import anims from '../src/game/vfx_animations.json';

describe('Thunderous Smite', () => {
  it('readies the next swing, with no flight of its own', () => {
    const h = { data: { name: 'Paladin' } };
    SPELLS.thunderousSmite.cast({ markSpellUsed: vi.fn(), playAbilityFx: vi.fn(), fxLog: vi.fn() }, h);
    expect(h.smiteNext).toBe(true);
    const { travel, impact } = anims.anims.thunderousSmite;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('shows an outline while readied, once the charge ends', () => {
    const pending = [], outline = { remove: vi.fn() };
    const h = { data: { name: 'Paladin' } };
    const game = {
      markSpellUsed: vi.fn(), playAbilityFx: vi.fn(), fxLog: vi.fn(),
      fxBodyEffect: vi.fn(() => outline), fxDelay: (sec, cb) => pending.push({ sec, cb }),
    };
    SPELLS.thunderousSmite.cast(game, h);
    expect(game.fxBodyEffect).not.toHaveBeenCalled();
    pending[0].cb();
    expect(game.fxBodyEffect).toHaveBeenCalledWith('smiteReady', h);
    expect(h._smiteFx).toBe(outline);
  });

  it('plays its swing on the attack that spends it, timed to the blow', () => {
    const roll = vi.fn();
    const game = {
      ...combatMethods,
      heroStartAttackAnim: () => 0.5, fxHold: vi.fn(), fxImpactDelay: vi.fn(), heroAttackRoll: roll, fxSmiteSwing: vi.fn(),
    };
    const h = { data: {} }, foe = { data: { hp: 10 } };
    game.heroPerformAttack(h, foe, [], { smited: true, profile: {} });
    expect(game.fxSmiteSwing).toHaveBeenCalledWith(h, foe, 0.5);
    game.fxSmiteSwing.mockClear();
    game.heroPerformAttack(h, foe, [], { profile: {} });
    expect(game.fxSmiteSwing).not.toHaveBeenCalled();
  });
});
