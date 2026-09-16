import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { reservationMethods } from '../src/game/reservation.js';
import { FLOOR, WALL } from '../src/game/constants.js';

/* Reservation system: the structural fix for "two sprites on one square".
   These cover the lifecycle (reserve → release → reap), the pathfinding
   integration (findPath / approachCellNear honor reservations), and the
   spawn helper (placeAtFreeCell picks a free cell). */
function makeGame(W = 7, H = 7) {
  const grid = new Uint8Array(W * H).fill(FLOOR);
  // wall border so all interior cells are reachable floor
  for (let x = 0; x < W; x++) { grid[x] = WALL; grid[(H - 1) * W + x] = WALL; }
  for (let y = 0; y < H; y++) { grid[y * W] = WALL; grid[y * W + (W - 1)] = WALL; }
  const game = Object.assign({}, pathfindingMethods, reservationMethods, {
    D: { W, H, grid },
    cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
    wx: (x) => x + 0.5,
    wz: (z) => z + 0.5,
    heroes: [],
    monsters: []
  });
  return game;
}

describe('Cell Reservation System', () => {
  it('reserveCell / releaseReservation maintain the map and the entity field', () => {
    const game = makeGame();
    const e = { data: { hp: 1 } };
    game.reserveCell(e, 12);
    expect(e.reservedCell).toBe(12);
    expect(game.isCellReserved(12)).toBe(true);
    expect(game.isCellReserved(12, e)).toBe(false); // owner excluded

    game.releaseReservation(e);
    expect(e.reservedCell).toBe(-1);
    expect(game.isCellReserved(12)).toBe(false);
  });

  it('reserveCell re-assigning moves the reservation and frees the old cell', () => {
    const game = makeGame();
    const e = { data: { hp: 1 } };
    game.reserveCell(e, 10);
    game.reserveCell(e, 20);
    expect(e.reservedCell).toBe(20);
    expect(game.isCellReserved(10)).toBe(false); // old cell freed
    expect(game.isCellReserved(20)).toBe(true);
  });

  it('setEntityPath reserves the destination cell and clears release the reservation', () => {
    const game = makeGame();
    const e = { data: { hp: 1 } };
    game.setEntityPath(e, [5, 6, 7]);   // path: start 5, end 7
    expect(e.path).toEqual([5, 6, 7]);
    expect(e.pathI).toBe(0);
    expect(e.reservedCell).toBe(7);     // destination reserved
    expect(game.isCellReserved(7)).toBe(true);

    game.clearEntityPath(e);
    expect(e.path).toBeNull();
    expect(e.reservedCell).toBe(-1);
    expect(game.isCellReserved(7)).toBe(false);
  });

  it('isCellOccupiedAny reports reserved cells as occupied', () => {
    const game = makeGame();
    const mover = { data: { hp: 1 } };
    game.reserveCell(mover, 12);
    // No body stands on cell 12, but a reservation counts as occupancy.
    expect(game.isCellOccupiedAny(12)).toBe(true);
    expect(game.isCellOccupiedAny(12, mover)).toBe(false);
    expect(game.isCellOccupiedAny(99)).toBe(false);
  });

  it('findPath refuses to route onto a cell reserved by another entity', () => {
    const game = makeGame(7, 7);
    // place a hero so findPath builds the mover context
    const hero = { x: 1.5, z: 1.5, data: { hp: 10, name: 'H' } };
    game.heroes = [hero];
    // Reserve cell 14 (directly between hero at cell 8 and the goal at cell 20)
    // Grid interior cells: cell = y*7 + x. (1,1)=8, (1,2)=9, (1,3)=10 ... (2,1)=15...
    // Hero at (1,1)=8. Goal at (5,1)=12. Straight path 8->9->10->11->12 along row 1.
    const blocker = { data: { hp: 10, name: 'Other' } };
    game.reserveCell(blocker, 10); // reserve cell (3,1)
    const path = game.findPath(8, 12, { mover: hero });
    expect(path).toBeDefined();
    expect(path).not.toContain(10); // must detour around the reserved cell
  });

  it('approachCellNear skips reserved cells when ring-1 is packed', () => {
    const game = makeGame(7, 7);
    const center = 24; // (3,3)
    // occupy all 8 ring-1 neighbours with live bodies
    const ring1 = [
      [2, 2], [3, 2], [4, 2],
      [2, 3],        [4, 3],
      [2, 4], [3, 4], [4, 4]
    ];
    game.heroes = ring1.map(([x, y], i) => ({ x: x + 0.5, z: y + 0.5, data: { hp: 1, name: 'h' + i } }));
    const goal = game.approachCellNear(center, { data: { hp: 1 } });
    expect(goal).not.toBe(center);
    // must be a ring-2 cell (not occupied)
    expect(game.isCellOccupiedAny(goal, { data: {} })).toBe(false);
  });

  it('placeAtFreeCell avoids an occupied cell and reserves the landing cell', () => {
    const game = makeGame(7, 7);
    const occupant = { x: 2.5, z: 2.5, data: { hp: 10, name: 'Occ' } };
    game.heroes = [occupant];
    game.reserveCell(occupant, game.cellOf(2.5, 2.5));

    const newcomer = { x: 2.5, z: 2.5, data: { hp: 10, name: 'New' } };
    game.placeAtFreeCell(newcomer, 2.5, 2.5, { radius: 2 });

    // newcomer must NOT be on the occupant's cell
    expect(game.cellOf(newcomer.x, newcomer.z)).not.toBe(game.cellOf(occupant.x, occupant.z));
    expect(newcomer.reservedCell).toBe(game.cellOf(newcomer.x, newcomer.z));
  });

  it('pushEntity walks cell-by-cell and stops at walls / occupancy', () => {
    const game = makeGame(7, 7);
    const target = { x: 3.5, z: 3.5, data: { hp: 10 }, reservedCell: -1 };
    // push east (away from x=1.5) up to 5 cells — but the wall at x=6 stops it at x=5
    const moved = game.pushEntity(target, 1.5, 3.5, 5, 1);
    expect(moved).toBeLessThanOrEqual(5);
    expect(target.x).toBeGreaterThan(3.5); // moved east
    expect(target.reservedCell).toBe(game.cellOf(target.x, target.z));
  });

  it('reapReservations voids stale entries (owner no longer intends the cell)', () => {
    const game = makeGame();
    const e = { data: { hp: 1 }, x: 2.5, z: 2.5 };
    game.reserveCell(e, 99); // reserved a cell the entity isn't on and isn't pathing to
    expect(game.isCellReserved(99)).toBe(true);
    game.reapReservations();
    expect(game.isCellReserved(99)).toBe(false); // reaped
    expect(e.reservedCell).toBe(-1);
  });

  it('reapReservations keeps a reservation when the owner is standing on the cell', () => {
    const game = makeGame();
    const e = { data: { hp: 1 }, x: 2.5, z: 2.5, path: null };
    const cell = game.cellOf(2.5, 2.5);
    game.reserveCell(e, cell);
    game.reapReservations();
    expect(game.isCellReserved(cell)).toBe(true); // standing on it — kept
  });

  it('reapReservations releases dead holders', () => {
    const game = makeGame();
    const e = { data: { hp: 0 }, x: 2.5, z: 2.5 };
    game.reserveCell(e, game.cellOf(2.5, 2.5));
    game.reapReservations();
    expect(game.isCellReserved(game.cellOf(2.5, 2.5))).toBe(false);
  });

  it('two actors requesting the same destination: second findPath must detour', () => {
    const game = makeGame(7, 7);
    const heroA = { x: 1.5, z: 1.5, data: { hp: 10, name: 'A' } };
    const heroB = { x: 1.5, z: 5.5, data: { hp: 10, name: 'B' } };
    game.heroes = [heroA, heroB];
    const goal = 24; // (3,3)
    // A commits first — reserves the goal
    const pathA = game.findPath(game.cellOf(heroA.x, heroA.z), goal, { mover: heroA });
    game.setEntityPath(heroA, pathA);
    // B pathfinds to the same goal — must NOT land on A's reserved cell
    const pathB = game.findPath(game.cellOf(heroB.x, heroB.z), goal, { mover: heroB });
    if (pathB) {
      const bDest = pathB[pathB.length - 1];
      expect(bDest).not.toBe(goal); // rerouted away from A's reservation
    }
  });
});
