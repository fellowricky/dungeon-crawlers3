import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect } from '../src/game/conditions.js';
import anims from '../src/game/vfx_animations.json';

function setup(saved) {
  const foe = { x: 5, z: 5, dead: false, data: { name: 'Orc', hp: 20, maxHp: 20 } };
  const h = { x: 0, z: 0, data: { name: 'Bard', hp: 20, maxHp: 20, level: 3 } };
  const game = { fxNow: 0, markSpellUsed: vi.fn(), fxLog: vi.fn(), fxText: vi.fn(), _v3: (x, y, z) => ({ x, y, z }), playAbilityFx: vi.fn(), spellSave: vi.fn(() => saved) };
  return { game, h, foe };
}

describe('Blindness/Deafness', () => {
  it('flies one dark mote at the target, and saves when it lands', () => {
    const { game, h, foe } = setup(false);
    SPELLS.blindness.cast(game, h, foe);
    expect(game.playAbilityFx).toHaveBeenCalledTimes(1);
    expect(game.playAbilityFx.mock.calls[0][2].at).toBe(foe);
    expect(anims.anims.blindness.travel.front).toMatchObject({ type: 'live', fx: 'softMote', palette: 'shadow' });
    expect(game.spellSave).not.toHaveBeenCalled();
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(hasEffect(foe, 'blinded')).toBe(true);
  });

  it('a passed save blinds nobody', () => {
    const { game, h, foe } = setup(true);
    SPELLS.blindness.cast(game, h, foe);
    game.playAbilityFx.mock.calls[0][2].onImpact();
    expect(hasEffect(foe, 'blinded')).toBe(false);
    expect(game.fxText).toHaveBeenCalled();
  });
});
