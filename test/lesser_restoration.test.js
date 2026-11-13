import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { applyEffect, hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(condition = 'poisoned') {
  let land = null;
  const h = { x: 0, z: 0, data: { name: 'Cleric', hp: 20, maxHp: 20 } };
  const ally = { x: 3, z: 0, data: { name: 'Fighter', hp: 20, maxHp: 20 } };
  if (condition) applyEffect(ally, condition, { duration: 60, elapsed: 0 });
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), fxBodyEffect: vi.fn(),
    playAbilityFx: vi.fn((_h, _k, opts) => { land = opts.onImpact; }),
  };
  return { game, h, ally, land: () => land(), cast: () => SPELLS.lesserRestoration.cast(game, h, null, [h, ally]) };
}

describe('Lesser Restoration', () => {
  it('cures nothing until the mote lands, then lifts the affliction off', () => {
    const { game, ally, land, cast } = setup();
    expect(cast()).toBe(true);
    expect(hasEffect(ally, 'poisoned')).toBe(true);
    expect(game.fxBodyEffect).not.toHaveBeenCalled();
    land();
    expect(hasEffect(ally, 'poisoned')).toBe(false);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('afflictionLift', ally);
  });

  it('is not spent when nobody needs it', () => {
    const { game, cast } = setup(null);
    expect(cast()).toBe(false);
    expect(game.markSpellUsed).not.toHaveBeenCalled();
  });

  it('does nothing if the caster falls while the mote is in the air', () => {
    const { h, ally, land, cast } = setup();
    cast();
    h.data.hp = 0;
    land();
    expect(hasEffect(ally, 'poisoned')).toBe(true);
  });

  it('flies as a pale mote, with no heal sheet', () => {
    const { travel, impact } = anims.anims.lesserRestoration;
    expect(travel.front).toMatchObject({ type: 'live', fx: 'softMote' });
    expect(impact.back.type).toBe('none');
  });
});
