import { describe, it, expect, vi } from 'vitest';
import { tickLightMotes } from '../src/game/spells.js';

function setup(equipment = {}) {
  const mote = { place: vi.fn(), remove: vi.fn() };
  const hero = { x: 3, z: 4, data: { hp: 10, knownSpells: ['light'], equipment } };
  const game = {
    state: 'crawl', heroes: [hero],
    fxChestPos: e => ({ x: e.x, y: 0.5, z: e.z }),
    fxLightMote: vi.fn(() => mote),
  };
  return { game, hero, mote };
}

describe('the Light cantrip mote', () => {
  it('appears for a hero seeing by the spell, and goes with them', () => {
    const { game, hero, mote } = setup();
    tickLightMotes(game, 0.05);
    expect(game.fxLightMote).toHaveBeenCalledTimes(1);
    tickLightMotes(game, 0.05);
    hero.x = 8;
    const before = mote.place.mock.calls.at(-1)[0];
    tickLightMotes(game, 0.05);
    expect(mote.place.mock.calls.at(-1)[0]).toBeGreaterThan(before);
    expect(game.fxLightMote).toHaveBeenCalledTimes(1);
  });

  it('never appears for a hero without the spell', () => {
    const { game, hero } = setup();
    hero.data.knownSpells = [];
    tickLightMotes(game, 0.05);
    expect(game.fxLightMote).not.toHaveBeenCalled();
  });

  it('goes out when the hero falls, is doused, leaves the floor or leaves the party', () => {
    for (const end of [
      ({ hero }) => { hero.data.hp = 0; },
      ({ hero }) => { hero.data._dousedT = 5; },
      ({ game }) => { game.state = 'guild'; },
      ({ game }) => { game.heroes = []; },
    ]) {
      const s = setup();
      tickLightMotes(s.game, 0.05);
      end(s);
      tickLightMotes(s.game, 0.05);
      expect(s.mote.remove).toHaveBeenCalledTimes(1);
    }
  });
});
