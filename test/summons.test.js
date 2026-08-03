import { describe, it, expect, vi } from 'vitest';

/* summons.js imports DOM/THREE-bound helpers at module top, so stub them out
   and exercise the manager's pure lifecycle logic against a fake game. */
vi.mock('../src/game/entities.js', () => ({
  makeHeroMesh: () => ({
    grp: { position: { set() {} }, parent: null, rotation: {} },
    bar: {},
    anim: { mesh: { position: {} }, play() {}, _dying: false, _deathDone: false }
  }),
  drawBar: () => {}
}));
vi.mock('../src/game/ui.js', () => ({ buildPartyFrames: () => {} }));

import { createSummonManager, COMPANIONS } from '../src/game/summons.js';
import { makeHero } from '../src/game/srd.js';

function makeGame() {
  const ranger = {
    data: makeHero('Rin', 'human', 'ranger',
      { str: 12, dex: 16, con: 14, int: 10, wis: 13, cha: 10 }, {}),
    x: 5, z: 5
  };
  const game = {
    heroes: [ranger],
    gameGroup: { add() {} },
    initiative: { active: false },
    effectiveLevel: 1,
    wx: () => 0, wz: () => 0
  };
  game.summons = createSummonManager(game);
  return game;
}

describe('Summon manager', () => {
  it('registers the wolf companion', () => {
    expect(COMPANIONS.wolf).toBeDefined();
    expect(COMPANIONS.wolf.lifetime).toBe('run');
    expect(COMPANIONS.wolf.slot).toBe('dedicated');
  });

  it('spawns a flagged companion into game.heroes', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    const wolf = game.summons.spawn(ranger, 'wolf');
    expect(wolf).not.toBeNull();
    expect(wolf.companion).toBe(true);
    expect(wolf._side).toBe('hero');
    expect(wolf.kind).toBe('wolf');
    expect(wolf.summonerName).toBe('Rin');
    expect(wolf.summonerClassKey).toBe('ranger');
    expect(wolf.data.hp).toBe(wolf.data.maxHp);
    expect(wolf.data.companion).toBe(true);   // flagged for party-frame filtering
    expect(game.heroes).toContain(wolf);
  });

  it('enforces the dedicated slot (one wolf per summoner)', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    expect(game.summons.spawn(ranger, 'wolf')).not.toBeNull();
    expect(game.summons.spawn(ranger, 'wolf')).toBeNull();   // already active
    expect(game.summons.getActive('wolf', ranger)).not.toBeNull();
  });

  it('revives a downed companion but no-ops when alive', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    const wolf = game.summons.spawn(ranger, 'wolf');
    wolf.data.hp = 0;                                          // downed
    expect(game.summons.revive('wolf', ranger, 1)).toBe(wolf);
    expect(wolf.data.hp).toBeGreaterThan(0);
    expect(game.summons.revive('wolf', ranger, 1)).toBeNull(); // alive -> no-op
  });

  it('revives a downed wolf to ~50% on a short rest', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    const wolf = game.summons.spawn(ranger, 'wolf');
    wolf.data.hp = 0;
    game.summons.onShortRest();
    expect(wolf.data.hp).toBeGreaterThan(0);
    expect(wolf.data.hp).toBeLessThanOrEqual(Math.round(wolf.data.maxHp * 0.5) + 1);
  });

  it('rescales a companion when its summoner levels up', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    const wolf = game.summons.spawn(ranger, 'wolf');
    const hpLvl1 = wolf.data.maxHp;
    expect(wolf.summonerLevel).toBe(1);
    ranger.data.level = 6;
    game.summons.syncScales();
    expect(wolf.summonerLevel).toBe(6);
    expect(wolf.data.maxHp).toBeGreaterThan(hpLvl1);
  });

  it('keeps a downed companion downed through a rescale', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    const wolf = game.summons.spawn(ranger, 'wolf');
    wolf.data.hp = 0;                                          // downed
    ranger.data.level = 5;
    game.summons.syncScales();
    expect(wolf.data.hp).toBeLessThanOrEqual(0);              // still downed
  });

  it('serializes and restores across a save/load', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    game.summons.spawn(ranger, 'wolf');
    const saved = game.summons.serialize();
    expect(saved).toHaveLength(1);
    expect(saved[0].kind).toBe('wolf');
    expect(saved[0].summonerName).toBe('Rin');

    const game2 = makeGame();                                 // fresh load
    expect(game2.heroes).toHaveLength(1);
    game2.summons.restore(saved);
    expect(game2.heroes).toHaveLength(2);
    expect(game2.heroes[1].companion).toBe(true);
    expect(game2.heroes[1].summonerName).toBe('Rin');
    expect(game2.summons.getActive('wolf', game2.heroes[0])).not.toBeNull();
  });

  it('does not restore a companion whose summoner is gone', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    game.summons.spawn(ranger, 'wolf');
    const saved = game.summons.serialize();
    const game2 = makeGame();
    game2.heroes = [];                                        // summoner stored/removed
    game2.summons.restore(saved);
    expect(game2.heroes).toHaveLength(0);
  });

  it('produces a UI badge summary for the owner only', () => {
    const game = makeGame();
    const ranger = game.heroes[0];
    expect(game.summons.summaryFor(ranger.data)).toBeNull(); // none yet
    const wolf = game.summons.spawn(ranger, 'wolf');
    const s = game.summons.summaryFor(ranger.data);
    expect(s).not.toBeNull();
    expect(s.icon).toBe('🐺');
    expect(s.label).toBe('Wolf Companion');
    expect(s.down).toBe(false);
    expect(s.hp).toBe(s.maxHp);

    wolf.data.hp = 0;                                         // downed
    const s2 = game.summons.summaryFor(ranger.data);
    expect(s2.down).toBe(true);
  });
});
