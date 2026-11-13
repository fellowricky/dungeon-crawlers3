import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const h = { x: 0, z: 0, data: { name: 'Wizard', hp: 20, maxHp: 20, classKey: 'wizard' } };
  const ally = { x: 1, z: 0, data: { name: 'Fighter', hp: 20, maxHp: 20, classKey: 'fighter' } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(), concentrate: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, ally, pending };
}

describe('Enlarge', () => {
  it('grows the ally only when the charge ends, in one aura', () => {
    const { game, h, ally, pending } = setup();
    SPELLS.enlargeReduce.cast(game, h, null, [h, ally]);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(ally);
    expect(hasEffect(ally, 'enlarged')).toBe(false);
    expect(game.concentrate).not.toHaveBeenCalled();
    pending[0].cb();
    expect(hasEffect(ally, 'enlarged')).toBe(true);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('growthAura', ally);
    expect(game.fxBodyEffect).toHaveBeenCalledTimes(1);
    expect(game.concentrate.mock.calls[0][2]).toEqual([{ e: ally, key: 'enlarged' }]);
  });

  it('fizzles if the ally falls during the charge', () => {
    const { game, h, ally, pending } = setup();
    SPELLS.enlargeReduce.cast(game, h, null, [h, ally]);
    ally.data.hp = 0;
    pending[0].cb();
    expect(hasEffect(ally, 'enlarged')).toBe(false);
    expect(game.fxBodyEffect).not.toHaveBeenCalled();
  });

  it('has no flight and no impact sheet, only its light', () => {
    const { travel, impact, light } = anims.anims.enlargeReduce;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
    expect(light.enabled).toBe(true);
  });
});
