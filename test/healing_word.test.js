import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import anims from '../src/game/vfx_animations.json';

function setup() {
  const pending = [];
  const ally = { x: 3, z: 0, _side: 'hero', data: { name: 'Ally', hp: 2, maxHp: 20 } };
  const h = { x: 0, z: 0, _side: 'hero', data: { name: 'Bard', hp: 20, maxHp: 20, level: 1 } };
  const game = {
    heroes: [h, ally], markSpellUsed: vi.fn(), fxLog: vi.fn(), healHero: vi.fn(), playAbilityFx: vi.fn(), fxBodyEffect: vi.fn(),
    fxDelay: (sec, cb) => pending.push({ sec, cb }),
  };
  return { game, h, ally, pending };
}

describe('Healing Word', () => {
  it('flies a soft green mote to the ally', () => {
    const { travel } = anims.anims.healingWord;
    expect(travel.front).toMatchObject({ type: 'live', fx: 'softMote', palette: 'leaf' });
  });

  it('plays its light heal on landing, and heals as the hoop reaches the top', () => {
    const { game, h, ally, pending } = setup();
    SPELLS.healingWord.cast(game, h, ally, [h, ally], 1);
    const opts = game.playAbilityFx.mock.calls[0][2];
    expect(opts.at).toBe(ally);
    expect(game.fxBodyEffect).not.toHaveBeenCalled();
    opts.onImpact();
    expect(game.fxBodyEffect).toHaveBeenCalledWith('healingWord', ally);
    expect(game.healHero).not.toHaveBeenCalled();
    expect(pending[0].sec).toBeCloseTo(0.74);
    pending[0].cb();
    expect(game.healHero).toHaveBeenCalledWith(ally, expect.any(Number), expect.anything());   // the caster, credited with the healing (healDone)
  });
});
