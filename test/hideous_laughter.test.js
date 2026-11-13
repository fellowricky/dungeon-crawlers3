import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { getEffect, hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(saved) {
  const foe = { x: 5, z: 5, dead: false, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Bard', hp: 20, maxHp: 20, level: 1 } };
  const game = {
    fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), fxText: vi.fn(), _v3: (x, y, z) => ({ x, y, z }),
    playAbilityFx: vi.fn(), concentrate: vi.fn(), spellSave: vi.fn(() => saved),
  };
  return { game, h, foe };
}

describe("Tasha's Hideous Laughter", () => {
  it('flies one soft mote at the target', () => {
    const { game, h, foe } = setup(false);
    SPELLS.hideousLaughter.cast(game, h, foe);
    expect(game.playAbilityFx).toHaveBeenCalledTimes(1);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(foe);
    expect(anims.anims.hideousLaughter.travel.front).toMatchObject({ type: 'live', fx: 'softMote' });
  });

  it('makes the save on landing; a failure lays it out laughing', () => {
    const { game, h, foe } = setup(false);
    SPELLS.hideousLaughter.cast(game, h, foe);
    expect(game.spellSave).not.toHaveBeenCalled();
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(getEffect(foe, 'incapacitated').aura).toBe('laughing');
    expect(hasEffect(foe, 'prone')).toBe(true);
    expect(game.concentrate).toHaveBeenCalled();
  });

  it('a passed save leaves it standing', () => {
    const { game, h, foe } = setup(true);
    SPELLS.hideousLaughter.cast(game, h, foe);
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(hasEffect(foe, 'incapacitated')).toBe(false);
    expect(game.fxText).toHaveBeenCalled();
  });
});
