import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { getEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(saved = false) {
  const pending = [];
  const foe = { x: 5, z: 5, dead: false, active: true, _side: 'monster', data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Wizard', hp: 20, maxHp: 20, level: 3 } };
  const slick = { remove: vi.fn() };
  const game = {
    heroes: [h], monsters: [foe], fxNow: 0,
    markSpellUsed: vi.fn(), fxLog: vi.fn(), playAbilityFx: vi.fn(),
    spawnAoEZone: vi.fn(() => ({})), spellSave: vi.fn(() => saved), fxGreaseSlick: vi.fn(() => slick),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, foe, slick, pending };
}

describe('Grease', () => {
  it('has no flight', () => {
    const { travel, impact } = anims.anims.grease;
    expect(travel.back.enabled || travel.front.enabled).toBe(false);
    expect(impact.back.type).toBe('none');
  });

  it('spreads its slick as a zone, without the old smoke or a light', () => {
    const { game, h, foe, slick, pending } = setup();
    SPELLS.grease.cast(game, h, foe);
    expect(game.spawnAoEZone).not.toHaveBeenCalled();
    pending[0].cb();
    const opts = game.spawnAoEZone.mock.calls[0][5];
    expect(opts.loopSheet).toBeUndefined();
    expect(opts.pointLight).toBe(false);
    expect(game.spawnAoEZone.mock.results[0].value.liveFx).toBe(slick);
  });

  it('drops a failed save only once the slick has reached it', () => {
    const { game, h, foe, pending } = setup(false);
    SPELLS.grease.cast(game, h, foe);
    pending[0].cb();
    expect(getEffect(foe, 'prone')).toBeNull();
    pending[1].cb();
    expect(getEffect(foe, 'prone')).toBeTruthy();
  });

  it('leaves a passed save standing', () => {
    const { game, h, foe, pending } = setup(true);
    SPELLS.grease.cast(game, h, foe);
    pending[0].cb();
    pending[1].cb();
    expect(getEffect(foe, 'prone')).toBeNull();
  });
});
