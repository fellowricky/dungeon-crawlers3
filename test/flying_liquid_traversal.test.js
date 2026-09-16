import { describe, it, expect } from 'vitest';
import { FLOOR, WALL, POOL } from '../src/dungeon/dungeon_generator.js';
import { pathfindingMethods, canFly, isGroundFor } from '../src/game/pathfinding.js';
import { reachableCellsGrid } from '../src/game/turn_engine.js';
import { WILD_SHAPE_FORMS, createFamiliarCompanion, createWolfCompanion } from '../src/game/srd.js';

/* A 10x10 arena split down the middle by a liquid channel: two dry banks with
   four columns of POOL between them and no way round (the channel runs wall to
   wall). A walker must find no route; a flyer must cross. */
function makeArena() {
  const W = 10, H = 10;
  const grid = new Uint8Array(W * H).fill(WALL);
  for (let y = 1; y <= 8; y++) {
    for (let x = 1; x <= 8; x++) grid[y * W + x] = FLOOR;
  }
  for (let y = 1; y <= 8; y++) {
    for (let x = 4; x <= 5; x++) grid[y * W + x] = POOL;
  }

  return Object.assign({}, pathfindingMethods, {
    D: { W, H, grid, wallAdj: null, chokepoint: null, solidProps: null },
    heroes: [], monsters: [], _reservedCells: null, activeAoEZones: [],
    isCombatActive: () => false, isCellDoorClosed: () => false, isCellReserved: () => false,
    cellOf(x, z) {
      const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
      return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
    },
    wx: (x) => x - W / 2 + 0.5,
    wz: (z) => z - H / 2 + 0.5
  });
}

const flyer = (game, gx, gy) => ({
  x: game.wx(gx), z: game.wz(gy),
  data: { hp: 10, tags: ['beast', 'flying'] }
});
const walker = (game, gx, gy) => ({
  x: game.wx(gx), z: game.wz(gy),
  data: { hp: 10, tags: ['beast'] }
});

describe('flying tag — traversal over liquid', () => {
  it('reads the tag off monster data, and treats everything else as grounded', () => {
    expect(canFly({ data: { tags: ['beast', 'flying'] } })).toBe(true);
    expect(canFly({ data: { flying: true } })).toBe(true);
    expect(canFly({ data: { tags: ['beast'] } })).toBe(false);
    expect(canFly({ data: {} })).toBe(false);
    expect(canFly({})).toBe(false);
    expect(canFly(undefined)).toBe(false);
  });

  it('gives the owl and imp familiars flight, but not the viper or the wolf', () => {
    expect(canFly({ data: createFamiliarCompanion('owl', 3) })).toBe(true);
    expect(canFly({ data: createFamiliarCompanion('imp', 3) })).toBe(true);
    expect(canFly({ data: createFamiliarCompanion('viper', 3) })).toBe(false);
    expect(canFly({ data: createWolfCompanion(3) })).toBe(false);
  });

  it('re-stamps flight onto a companion restored from a save that predates it', async () => {
    /* A saved companion keeps its saved `data` wholesale, so a trait added to a
       factory later never reaches it — an imp summoned before flight existed
       stayed grounded for the rest of that run, reload after reload. */
    if (typeof globalThis.document === 'undefined') {
      const el = {
        setAttribute: () => {}, addEventListener: () => {}, style: {},
        getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
        querySelector: () => el, querySelectorAll: () => [], appendChild: () => {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        getContext: () => new Proxy({}, { get: () => () => {} })
      };
      globalThis.document = {
        createElement: () => el, createElementNS: () => el,
        getElementById: () => null, querySelector: () => el, querySelectorAll: () => [], body: el
      };
    }
    const { createSummonManager } = await import('../src/game/summons.js');

    const summoner = { data: { name: 'Aelindra', classKey: 'wizard', level: 3 }, x: 0, z: 0 };
    const game = { heroes: [summoner], gameGroup: null, D: null };
    const summons = createSummonManager(game);

    /* an old save: imp familiar data with no `flying` anywhere on it */
    const stale = createFamiliarCompanion('imp', 3);
    delete stale.flying;
    expect(canFly({ data: stale })).toBe(false);

    summons.restore([{
      kind: 'impFamiliar', summonerName: 'Aelindra', summonerClassKey: 'wizard',
      summonerLevel: 3, data: stale
    }]);

    const imp = game.heroes.find(h => h.companion);
    expect(imp).toBeTruthy();
    expect(canFly(imp)).toBe(true);
  });

  it('derives flight from the wild-shape form the druid is currently wearing', () => {
    expect(WILD_SHAPE_FORMS.eagle.flying).toBe(true);
    expect(canFly({ data: { inWildShape: true, wildShapeActiveForm: 'eagle' } })).toBe(true);
    expect(canFly({ data: { inWildShape: true, wildShapeActiveForm: 'bear' } })).toBe(false);
    expect(canFly({ data: { inWildShape: true, wildShapeActiveForm: 'wolf' } })).toBe(false);
    /* reverting must take the flight with it — nothing is copied onto the hero,
       so a stale form key on a reverted druid stays grounded */
    expect(canFly({ data: { inWildShape: false, wildShapeActiveForm: 'eagle' } })).toBe(false);
  });

  it('carries an eagle-form druid over the channel a bear-form one has to walk round', () => {
    const game = makeArena();
    const from = game.cellOf(game.wx(2), game.wz(4));
    const to = game.cellOf(game.wx(7), game.wz(4));
    const eagle = { data: { hp: 10, inWildShape: true, wildShapeActiveForm: 'eagle' } };
    const bear = { data: { hp: 10, inWildShape: true, wildShapeActiveForm: 'bear' } };
    expect(game.findPath(from, to, { mover: eagle })).not.toBeNull();
    expect(game.findPath(from, to, { mover: bear })).toBeNull();
  });

  it('flies an owl familiar across, and keeps the viper on the bank', () => {
    const game = makeArena();
    const from = game.cellOf(game.wx(2), game.wz(4));
    const to = game.cellOf(game.wx(7), game.wz(4));
    const owl = { data: createFamiliarCompanion('owl', 3) };
    const viper = { data: createFamiliarCompanion('viper', 3) };
    expect(game.findPath(from, to, { mover: owl })).not.toBeNull();
    expect(game.findPath(from, to, { mover: viper })).toBeNull();
  });

  it('does not judge a hovering flyer out of bounds', () => {
    /* game.js runs an out-of-bounds watchdog over every alive hero each frame:
       a body whose cell is not somewhere it could legally be gets teleported to
       the nearest floor and has its path cleared. Testing FLOOR alone fired it
       on every flyer the instant it crossed the water's edge — it was yanked
       back, re-planned the same crossing, and bounced. This is the predicate
       the watchdog now uses. */
    const game = makeArena();
    const wet = game.cellOf(game.wx(4), game.wz(4));
    const dry = game.cellOf(game.wx(2), game.wz(4));
    const wall = game.cellOf(game.wx(0), game.wz(0));

    expect(isGroundFor(game.D.grid, wet, canFly(flyer(game, 4, 4)))).toBe(true);
    expect(isGroundFor(game.D.grid, wet, canFly(walker(game, 2, 4)))).toBe(false);
    expect(isGroundFor(game.D.grid, dry, canFly(flyer(game, 2, 4)))).toBe(true);
    /* a flyer that really has left the map is still rescued */
    expect(isGroundFor(game.D.grid, wall, canFly(flyer(game, 4, 4)))).toBe(false);
  });

  it('counts liquid inside a flyer\'s movement range, and not a walker\'s', () => {
    const game = makeArena();
    const { W, H, grid } = game.D;
    const start = game.cellOf(game.wx(2), game.wz(4));
    const wet = game.cellOf(game.wx(4), game.wz(4));

    const flyRange = reachableCellsGrid(grid, W, H, start, 6, { flies: true });
    const walkRange = reachableCellsGrid(grid, W, H, start, 6, {});
    expect(flyRange.has(wet)).toBe(true);
    expect(walkRange.has(wet)).toBe(false);
    /* and the far bank is only reachable on the wing */
    const farBank = game.cellOf(game.wx(7), game.wz(4));
    expect(flyRange.has(farBank)).toBe(true);
    expect(walkRange.has(farBank)).toBe(false);
  });

  it('leaves a walker stopped at the water: no route across the channel', () => {
    const game = makeArena();
    const m = walker(game, 2, 4);
    const path = game.findPath(game.cellOf(m.x, m.z), game.cellOf(game.wx(7), game.wz(4)), { mover: m });
    expect(path).toBeNull();
  });

  it('routes a flyer straight over the channel', () => {
    const game = makeArena();
    const m = flyer(game, 2, 4);
    const from = game.cellOf(m.x, m.z);
    const to = game.cellOf(game.wx(7), game.wz(4));
    const path = game.findPath(from, to, { mover: m });
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toBe(to);
    /* the route genuinely goes over the water rather than round it */
    expect(path.some(c => game.D.grid[c] === POOL)).toBe(true);
  });

  it('lets the flyer actually walk that route — the local physics agree with the plan', () => {
    const game = makeArena();
    const m = flyer(game, 2, 4);
    const to = game.cellOf(game.wx(7), game.wz(4));
    const path = game.findPath(game.cellOf(m.x, m.z), to, { mover: m });
    game.setEntityPath(m, path);

    let t = 0;
    while (t < 20 && m.pathI < path.length) {
      m.moving = game.stepAlong(m, 1.5, 0.016);
      t += 0.016;
    }
    expect(m.pathI).toBe(path.length);
    expect(game.cellOf(m.x, m.z)).toBe(to);
  });

  it('blocks a walker but not a flyer at the local probe, and never on walls', () => {
    const game = makeArena();
    const wetX = game.wx(4), wetZ = game.wz(4);
    expect(game.blocked(wetX, wetZ, 0.2, walker(game, 2, 4))).toBe(true);
    expect(game.blocked(wetX, wetZ, 0.2, flyer(game, 2, 4))).toBe(false);
    /* omitting the mover keeps the old ground-only probe, which is what every
       hero-side caller relies on */
    expect(game.blocked(wetX, wetZ, 0.2)).toBe(true);
    /* flight is not phasing: a wall is still a wall */
    expect(game.blocked(game.wx(0), game.wz(0), 0.2, flyer(game, 2, 4))).toBe(true);
  });

  it('does not shove a hovering flyer off the water', () => {
    const game = makeArena();
    const m = flyer(game, 4, 4);
    const x0 = m.x, z0 = m.z;
    game.wallRepel(m);
    expect(m.x).toBeCloseTo(x0, 6);
    expect(m.z).toBeCloseTo(z0, 6);
  });

  it('keeps a hovering flyer visible: liquid does not block line of sight', () => {
    const game = makeArena();
    /* bank to hovering flyer, straight across two columns of water */
    expect(game.hasLOS(game.wx(2), game.wz(4), game.wx(5), game.wz(4))).toBe(true);
    /* a wall still does */
    expect(game.hasLOS(game.wx(2), game.wz(4), game.wx(2), game.wz(0))).toBe(false);
  });

  it('offers a flyer a stance over the water when the dry approaches are taken', () => {
    const game = makeArena();
    /* target on the east bank at the water's edge; every dry neighbour occupied */
    const tgt = { x: game.wx(6), z: game.wz(4), data: { hp: 10 }, active: true };
    const blockers = [[6, 3], [6, 5], [7, 3], [7, 4], [7, 5]]
      .map(([gx, gy]) => ({ x: game.wx(gx), z: game.wz(gy), data: { hp: 10 }, active: true }));
    game.monsters = [tgt, ...blockers];

    const m = flyer(game, 2, 4);
    const goal = game.approachCellNear(game.cellOf(tgt.x, tgt.z), m);
    expect(goal).not.toBe(game.cellOf(tgt.x, tgt.z));
    expect(game.D.grid[goal]).toBe(POOL);
  });
});
