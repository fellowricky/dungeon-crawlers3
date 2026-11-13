import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect, getEffectMods } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(wis) {
  const pending = [];
  const h = { x: 0, z: 0, data: { name: 'Druid', hp: 20, maxHp: 20, _classAtk: 'wis', effStats: { wis } } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(), concentrate: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, pending };
}

describe('Barkskin', () => {
  it('is on the caster alone, with no flight', () => {
    const { game, h, pending } = setup(10);
    SPELLS.barkskin.cast(game, h);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(h);
    pending[0].cb();
    expect(game.fxBodyEffect).toHaveBeenCalledWith('barkCreep', h);
    expect(game.concentrate.mock.calls[0][2]).toEqual([{ e: h, key: 'barkskin' }]);
    const { travel, impact } = anims.anims.barkskin;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('sets the AC floor to 14 + spellcasting modifier', () => {
    const { game, h, pending } = setup(18);
    SPELLS.barkskin.cast(game, h);
    expect(hasEffect(h, 'barkskin')).toBe(false);
    pending[0].cb();
    expect(getEffectMods(h).acFloor).toBe(18);
  });

  it('a low modifier lowers it', () => {
    const { game, h, pending } = setup(8);
    SPELLS.barkskin.cast(game, h);
    pending[0].cb();
    expect(getEffectMods(h).acFloor).toBe(13);
  });
});
