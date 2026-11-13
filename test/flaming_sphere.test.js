import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { burnAtTurnEnd, moveSphere, sphereAiMove } from '../src/game/flaming_sphere.js';
import { reservationMethods } from '../src/game/reservation.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { FLOOR } from '../src/game/constants.js';
import anims from '../src/game/vfx_animations.json';

/* A 20x20 room where one unit is one tile and a cell's world position is its grid position. */
function setup({ grid = false } = {}) {
  let land = null;
  const h = { x: 0, z: 0, data: { name: 'Wizard', hp: 20, maxHp: 20, dmgBonus: 0, _classAtk: 'int', effStats: { int: 16 } } };
  const foe = { x: 5, z: 5, active: true, data: { name: 'Goblin', hp: 30, maxHp: 30 } };
  const ball = { remove: vi.fn(), glideTo: vi.fn() };
  const game = {
    fxNow: 0, heroes: [h], monsters: [foe], activeAoEZones: [],
    markSpellUsed: vi.fn(), fxLog: vi.fn(), spellSave: () => false, spellDamage: vi.fn(),
    isHostileMonster: () => true,
    spawnAoEZone: vi.fn((caster, spellKey, x, z, radius) => {
      const zone = { caster, spellKey, x, z, radius };
      game.activeAoEZones.push(zone);
      return zone;
    }),
    fxFlamingSphere: vi.fn(() => ball),
    moveAoEZone: vi.fn(), fxDelay: (_s, fn) => fn(),
    concentrate: vi.fn((c, key, _a, zone) => { c.conc = { key, zone }; }),
    playAbilityFx: (_h, _k, opts) => { land = opts.onImpact; },
  };
  if (grid) {
    const W = 20;
    Object.assign(game, reservationMethods, {
      D: { W, H: W, grid: new Array(W * W).fill(0) },
      wx: (x) => x, wz: (z) => z,
      cellOf: (x, z) => Math.round(z) * W + Math.round(x),
      _doorFreeCellsNear: (c) => new Set([c - 1, c + 1, c - W, c + W, c - W - 1, c - W + 1, c + W - 1, c + W + 1]),
      isCellOccupiedAny(c, ex) {
        if ([h, foe].some((e) => e !== ex && game.cellOf(e.x, e.z) === c)) return true;
        return game.isCellReserved(c, ex);
      },
      approachCellNear: (c) => c - W,   // the tile "above" the creature
      findPath: vi.fn((from, to) => {
        const path = [from];
        let [x, y] = [from % W, Math.floor(from / W)];
        while (x !== to % W || y !== Math.floor(to / W)) {
          x += Math.sign((to % W) - x);
          y += Math.sign(Math.floor(to / W) - y);
          path.push(y * W + x);
        }
        return path;
      }),
    });
  }
  return { game, h, foe, ball, land: () => land() };
}

function summon(opts) {
  const s = setup({ grid: true, ...opts });
  SPELLS.flamingSphere.cast(s.game, s.h, s.foe, [], 2);
  s.land();
  return { ...s, zone: s.h.conc.zone };
}

describe('Flaming Sphere', () => {
  it('nothing lands until the mote does, and it does no damage on arrival', () => {
    const { game, h, foe, ball, land } = setup();
    SPELLS.flamingSphere.cast(game, h, foe, [], 2);
    expect(game.spawnAoEZone).not.toHaveBeenCalled();
    land();
    const zone = h.conc.zone;
    expect(zone.liveFx).toBe(ball);          // the ball fades with the zone
    expect(game.spellDamage).not.toHaveBeenCalled();
    expect(game.concentrate).toHaveBeenCalledWith(h, 'flamingSphere', [], zone);
  });

  it('fizzles if the caster falls while the mote is in the air', () => {
    const { game, h, foe, land } = setup();
    SPELLS.flamingSphere.cast(game, h, foe, [], 2);
    h.data.hp = 0;
    land();
    expect(game.spawnAoEZone).not.toHaveBeenCalled();
  });

  it('takes up a tile of its own beside the target, which nobody else can use', () => {
    const { game, foe, zone } = summon();
    const cell = game.cellOf(zone.body.x, zone.body.z);
    expect(cell).not.toBe(game.cellOf(foe.x, foe.z));
    expect(Math.hypot(zone.body.x - foe.x, zone.body.z - foe.z)).toBeLessThanOrEqual(1.5);
    expect(game.isCellReserved(cell, foe)).toBe(true);
    game.reapReservations();                 // still held: it is standing there
    expect(game.isCellReserved(cell, foe)).toBe(true);
  });

  it('the real pathfinder walks heroes and monsters round its tile, and will not stop on it', () => {
    const W = 9;
    const hero = { x: 0, z: 4, data: { hp: 10 } }, mon = { x: 8, z: 4, active: true, data: { hp: 10 } };
    const game = Object.assign({ D: { W, H: W, grid: new Array(W * W).fill(FLOOR) }, heroes: [hero], monsters: [mon], wx: (x) => x, wz: (z) => z, cellOf: (x, z) => Math.round(z) * W + Math.round(x) }, pathfindingMethods, reservationMethods);
    const sphereCell = 4 * W + 4;
    const body = { x: 4, z: 4, active: true, _side: 'sphere', reservedCell: -1, data: { hp: 1 } };
    game.reserveCell(body, sphereCell);
    for (const mover of [hero, mon]) {
      const from = game.cellOf(mover.x, mover.z), to = 4 * W + (mover === hero ? 7 : 1);
      const path = game.findPath(from, to, { mover });
      expect(path).toBeTruthy();
      expect(path).not.toContain(sphereCell);
      expect(game.findPath(from, sphereCell, { mover })).toBeNull();
    }
  });

  it('burns anyone who ends a turn beside it, friend or foe, and nobody further off', () => {
    const { game, h, foe, zone } = summon();
    burnAtTurnEnd(game, foe);
    expect(game.spellDamage).toHaveBeenCalledTimes(1);
    expect(game.spellDamage.mock.calls[0][0]).toBe(foe);

    game.spellDamage.mockClear();
    h.x = zone.body.x + 1; h.z = zone.body.z + 1;   // the caster strays next to it
    burnAtTurnEnd(game, h);
    expect(game.spellDamage.mock.calls[0][0]).toBe(h);

    game.spellDamage.mockClear();
    h.x = zone.body.x + 2;
    burnAtTurnEnd(game, h);
    expect(game.spellDamage).not.toHaveBeenCalled();
  });

  it('rolls with the bonus action, moving its tile, up to 30 ft', () => {
    const { game, h, ball, zone } = summon();
    const start = { x: zone.body.x, z: zone.body.z };
    const oldCell = game.cellOf(start.x, start.z);
    expect(moveSphere(game, h, { x: start.x + 10, z: start.z })).toBe(true);
    expect(zone.body.x).toBe(start.x + 6);   // stopped at 6 tiles of the 10 asked for
    expect(h._bonusActed).toBe(true);
    expect(game.isCellReserved(oldCell, null)).toBe(false);
    expect(game.isCellReserved(game.cellOf(zone.body.x, zone.body.z), null)).toBe(true);
    expect(game.moveAoEZone).toHaveBeenCalledTimes(6);
    expect(ball.glideTo).toHaveBeenCalledTimes(6);

    expect(moveSphere(game, h, { x: start.x, z: start.z })).toBe(false);   // the bonus action is spent
  });

  it('ramming burns the creature, unless the sphere cannot reach them', () => {
    const { game, h, foe, zone } = summon();
    zone.body.x = 5; zone.body.z = 10;
    game.reserveCell(zone.body, game.cellOf(5, 10));
    expect(moveSphere(game, h, null, foe)).toBe(true);
    expect(game.spellDamage).toHaveBeenCalledTimes(1);
    expect(game.spellDamage.mock.calls[0][0]).toBe(foe);

    game.spellDamage.mockClear();
    h._bonusActed = false; h.bonusUsed = false;
    zone.body.x = 19; zone.body.z = 19;
    game.reserveCell(zone.body, game.cellOf(19, 19));
    moveSphere(game, h, null, foe);
    expect(game.spellDamage).not.toHaveBeenCalled();
  });

  it('gives its tile back when concentration ends', async () => {
    const { aoeZoneManager } = await import('../src/game/aoe_system.js');
    const { game, zone } = summon();
    const cell = game.cellOf(zone.body.x, zone.body.z);
    aoeZoneManager.removeZone(game, zone);
    expect(game.isCellReserved(cell, null)).toBe(false);
  });

  it('the AI rams a foe in reach, but not when that scorches a friend', () => {
    const a = summon();
    a.zone.body.x = 5; a.zone.body.z = 8;
    expect(sphereAiMove(a.game, a.h)).toBe(true);
    expect(a.game.spellDamage.mock.calls[0][0]).toBe(a.foe);

    const b = summon();
    b.zone.body.x = 5; b.zone.body.z = 8;
    b.h.x = 5; b.h.z = 3;                    // stands beside the tile it would ram from
    expect(sphereAiMove(b.game, b.h)).toBe(false);
  });

  it('flies as a mote of fire, with no impact sheet', () => {
    const { travel, impact, light } = anims.anims.flamingSphere;
    expect(travel.front).toMatchObject({ type: 'live', fx: 'softMote', palette: 'fire' });
    expect(impact.back.type).toBe('none');
    expect(light.enabled).toBe(true);
  });
});
