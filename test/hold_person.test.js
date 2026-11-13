import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(saved) {
  let land = null;
  const h = { x: 0, z: 0, data: { name: 'Cleric', hp: 20, maxHp: 20, _classAtk: 'wis', effStats: { wis: 16 } } };
  const foe = { x: 5, z: 5, active: true, data: { name: 'Goblin', hp: 30, maxHp: 30 } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), fxText: vi.fn(), _v3: (x, y, z) => ({ x, y, z }),
    spellSave: vi.fn(() => saved), concentrate: vi.fn(), fxBodyEffect: vi.fn(),
    playAbilityFx: (_h, _k, opts) => { land = opts.onImpact; },
  };
  SPELLS.holdPerson.cast(game, h, foe);
  return { game, h, foe, land: () => land() };
}

describe('Hold Person', () => {
  it('makes no save until the mote lands', () => {
    const { game, foe, land } = setup(false);
    expect(game.spellSave).not.toHaveBeenCalled();
    expect(hasEffect(foe, 'paralyzed')).toBe(false);
    land();
    expect(game.spellSave).toHaveBeenCalledTimes(1);
  });

  it('a failed save clamps shut: paralyzed, held by concentration', () => {
    const { game, h, foe, land } = setup(false);
    land();
    expect(hasEffect(foe, 'paralyzed')).toBe(true);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('holdClamp', foe);
    expect(game.concentrate).toHaveBeenCalledWith(h, 'holdPerson', [{ e: foe, key: 'paralyzed' }]);
  });

  it('a successful save shatters the jaws, and costs no concentration', () => {
    const { game, foe, land } = setup(true);
    land();
    expect(hasEffect(foe, 'paralyzed')).toBe(false);
    expect(game.fxBodyEffect).toHaveBeenCalledWith('holdBreak', foe);
    expect(game.concentrate).not.toHaveBeenCalled();
  });

  it('fizzles if the caster falls while the mote is in the air', () => {
    const { game, h, foe, land } = setup(false);
    h.data.hp = 0;
    land();
    expect(game.spellSave).not.toHaveBeenCalled();
    expect(hasEffect(foe, 'paralyzed')).toBe(false);
  });

  it('flies as a violet mote, with no impact sheet', () => {
    const { travel, impact } = anims.anims.holdPerson;
    expect(travel.front).toMatchObject({ type: 'live', fx: 'softMote', palette: 'arcane' });
    expect(impact.back.type).toBe('none');
  });
});
