import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { getEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(saved = false) {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, active: true, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Druid', hp: 20, maxHp: 20, level: 3 } };
  const weeds = { remove: vi.fn() };
  const game = {
    heroes: [h], monsters: [foe], fxNow: 0,
    markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(), concentrate: vi.fn(),
    spawnAoEZone: vi.fn(() => ({})), spellSave: vi.fn(() => saved), fxEntangleWeeds: vi.fn(() => weeds),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, weeds, pending };
}

describe('Entangle', () => {
  it('has no flight and no impact sheet', () => {
    const { travel, impact } = anims.anims.entangle;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
    expect(impact.front.enabled).toBe(false);
  });

  it('marks the circle without the old vines, and grows weeds tied to the zone', () => {
    const { game, h, foe, weeds, pending } = setup();
    SPELLS.entangle.cast(game, h, foe);
    expect(game.spawnAoEZone).not.toHaveBeenCalled();
    pending[0].cb();
    const opts = game.spawnAoEZone.mock.calls[0][5];
    expect(opts.procedural).toBeUndefined();
    expect(opts.loopSheet).toBeUndefined();
    expect(opts.borderOpacity).toBeGreaterThan(0);
    expect(game.spawnAoEZone.mock.results[0].value.liveFx).toBe(weeds);
  });

  it('seizes a failed save in green roots, and concentrates on them', () => {
    const { game, h, foe, pending } = setup(false);
    SPELLS.entangle.cast(game, h, foe);
    pending[0].cb();
    expect(getEffect(foe, 'restrained').aura).toBe('entangled');
    expect(game.concentrate.mock.calls[0][2]).toEqual([{ e: foe, key: 'restrained' }]);
  });

  it('leaves a passed save alone', () => {
    const { game, h, foe, pending } = setup(true);
    SPELLS.entangle.cast(game, h, foe);
    pending[0].cb();
    expect(getEffect(foe, 'restrained')).toBeNull();
  });
});
