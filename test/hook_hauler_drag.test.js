import { describe, it, expect, vi, afterEach } from 'vitest';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import MONSTERS from '../src/game/monsters.json' with { type: 'json' };

/* The Hook-Hauler's "Drag Them Back": a 30 ft chain that reels a hero in.
   Forced movement is data-driven (`pull` on the ability) and rides the shared
   pushEntity primitive, so these cover the wiring rather than the walk itself —
   pushEntity's wall/occupancy behaviour is already pinned by reservation.test.js
   and knockback_glide.test.js. */

const HAULER = MONSTERS.find(m => m.id === 'hook-hauler');
const DRAG = HAULER.abilities.find(a => a.key === 'drag-them-back');

const mkHauler = (over = {}) => ({
  x: 0, z: 0, active: true, isBoss: false,
  data: HAULER,
  actUsed: false, walk: false, moving: false, _spellCycle: 99,
  ent: { grp: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } } },
  ...over
});

const mkHero = (x = 4) => ({
  x, z: 0,
  data: { name: 'Hero', hp: 30, maxHp: 30, str: 10 },
  ent: { grp: { position: { x, y: 0, z: 0 } }, bar: {} },
});

/* The save is rolled through conditions.js's own module-scope rollSaveDetail,
   not through anything the host can stub — so pin the d20 at the source.
   Without this the DC-13 Strength save lands either way and the pull tests are
   coin flips. */
const forceD20 = (v) => vi.spyOn(Math, 'random').mockReturnValue((v - 1) / 20 + 0.001);
afterEach(() => vi.restoreAllMocks());

function mkGame(over = {}) {
  const g = {
    heroes: [], monsters: [], fxNow: 0,
    _v3: (x, y, z) => ({ x, y, z }),
    hasLOS: () => true,
    faceTowards() {}, triggerLunge() {}, triggerShake() {},
    fxPlaySfx() {}, fxAbilitySfx: () => 'x', fxLog() {}, fxText() {},
    fxSprite() {}, fxTelegraph() {}, fxRichAbilityVFX() {}, fxDrawBar() {},
    fxHitFlash() {}, refreshHud() {}, hurtHero() {},
    fxImpactDelay: (_d, cb) => cb(),
    fxBeam: vi.fn(),
    pushEntity: vi.fn(() => 3),
    ...over
  };
  Object.assign(g, monsterAiMethods);
  Object.assign(g, over);
  return g;
}

describe('Hook-Hauler — Drag Them Back', () => {
  it('is authored as a 30 ft cycle ability that pulls', () => {
    /* 1 cell = 5 ft, so range 6 is the 30 ft the statblock prose promises. */
    expect(DRAG.trigger).toBe('cycle');
    expect(DRAG.range).toBe(6);
    expect(DRAG.pull).toBe(4);
    expect(DRAG.save).toEqual({ ab: 'str', dc: 13 });
    expect(DRAG.beam).toBe('chain');
    const prose = HAULER.statblock.actions.find(a => a.name.startsWith('Drag Them Back'));
    expect(prose.desc).toContain('30 ft');
    expect(prose.desc).toContain('20 ft');
  });

  it('reels the hero toward the hauler when the save fails', () => {
    forceD20(1);
    const g = mkGame();
    const m = mkHauler();
    const h = mkHero(4);
    g.monsters = [m]; g.heroes = [h];

    g._resolveAbilityOnHero(m, h, DRAG, 'Drag Them Back');

    expect(g.pushEntity).toHaveBeenCalledTimes(1);
    const [target, fromX, fromZ, cells, dir] = g.pushEntity.mock.calls[0];
    expect(target).toBe(h);
    expect(fromX).toBe(m.x);
    expect(fromZ).toBe(m.z);
    expect(cells).toBe(4);
    /* -1 is pull TOWARD the source; +1 would shove them away. */
    expect(dir).toBe(-1);
  });

  it('does not move a hero who makes the Strength save', () => {
    forceD20(20);
    const g = mkGame();
    const m = mkHauler();
    const h = mkHero(4);
    g.monsters = [m]; g.heroes = [h];

    g._resolveAbilityOnHero(m, h, DRAG, 'Drag Them Back');

    expect(g.pushEntity).not.toHaveBeenCalled();
  });

  it('draws a chain beam that tracks the victim sprite', () => {
    forceD20(1);
    const g = mkGame();
    const m = mkHauler();
    const h = mkHero(4);
    g.monsters = [m]; g.heroes = [h];

    g._resolveAbilityOnHero(m, h, DRAG, 'Drag Them Back');

    expect(g.fxBeam).toHaveBeenCalledTimes(1);
    const opts = g.fxBeam.mock.calls[0][2];
    expect(opts.type).toBe('chain');
    /* followTo is what lets the chain shorten as the hero glides inward. */
    expect(opts.followTo).toBe(h.ent.grp);
  });

  it('holds the hook for range, and does not waste it on an adjacent hero', () => {
    const near = mkGame();
    const far = mkGame();
    const adjacent = mkGame();

    /* In band (20 ft): fires. */
    const m1 = mkHauler(); const h1 = mkHero(4);
    near.monsters = [m1]; near.heroes = [h1];
    near.monsterUseAbility = vi.fn();
    expect(near.tryMonsterCycleAbility(m1, h1)).toBe(true);
    expect(near.monsterUseAbility).toHaveBeenCalled();

    /* Beyond 30 ft: held. */
    const m2 = mkHauler(); const h2 = mkHero(7);
    far.monsters = [m2]; far.heroes = [h2];
    far.monsterUseAbility = vi.fn();
    expect(far.tryMonsterCycleAbility(m2, h2)).toBe(false);
    expect(far.monsterUseAbility).not.toHaveBeenCalled();

    /* Already in its face: pulling them is pointless, so it swings instead. */
    const m3 = mkHauler(); const h3 = mkHero(1);
    adjacent.monsters = [m3]; adjacent.heroes = [h3];
    adjacent.monsterUseAbility = vi.fn();
    expect(adjacent.tryMonsterCycleAbility(m3, h3)).toBe(false);
    expect(adjacent.monsterUseAbility).not.toHaveBeenCalled();
  });
});
