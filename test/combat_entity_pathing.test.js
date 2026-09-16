import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { FLOOR, WALL } from '../src/game/constants.js';

describe('Combat Entity-Aware Pathfinding & Occupancy', () => {
  function setupGame() {
    // 5x5 grid:
    // W W W W W
    // W . . . W
    // W . . . W
    // W . . . W
    // W W W W W
    const W = 5, H = 5;
    const grid = new Uint8Array([
      WALL, WALL, WALL, WALL, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, WALL, WALL, WALL, WALL
    ]);
    const heroes = [{ x: 1.5, z: 1.5, data: { name: 'Hero1', hp: 10 } }];
    const monsters = [{ active: true, x: 2.5, z: 2.5, data: { name: 'Goblin1', hp: 10 } }];

    return Object.assign({}, pathfindingMethods, {
      D: { W, H, grid },
      cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      heroes,
      monsters
    });
  }

  it('detects entity cell occupancy via isCellOccupiedAny', () => {
    const game = setupGame();
    const heroCell = game.cellOf(1.5, 1.5);
    const monsterCell = game.cellOf(2.5, 2.5);
    const emptyCell = game.cellOf(3.5, 3.5);

    expect(game.isCellOccupiedAny(heroCell)).toBe(true);
    expect(game.isCellOccupiedAny(monsterCell)).toBe(true);
    expect(game.isCellOccupiedAny(emptyCell)).toBe(false);

    // Excluded entity check
    expect(game.isCellOccupiedAny(heroCell, game.heroes[0])).toBe(false);
    expect(game.isCellOccupiedAny(monsterCell, game.monsters[0])).toBe(false);
  });

  it('finds unoccupied neighbor cell via getUnoccupiedCellNear', () => {
    const game = setupGame();
    const monsterCell = game.cellOf(2.5, 2.5); // occupied by Goblin1

    const freeCell = game.getUnoccupiedCellNear(monsterCell, game.heroes[0]);
    expect(freeCell).not.toBe(monsterCell);
    expect(game.isCellOccupiedAny(freeCell, game.heroes[0])).toBe(false);
  });

  it('routes around opposing team entities blocking a passage in findPath', () => {
    // 5x5 grid with a line of 2 monsters blocking middle column (x=2, y=1 and y=2)
    // Hero at (1.5, 1.5) trying to reach (3.5, 1.5)
    const W = 5, H = 5;
    const grid = new Uint8Array([
      WALL, WALL, WALL, WALL, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL, // row 1: x=1, x=2(enemy), x=3
      WALL, FLOOR, FLOOR, FLOOR, WALL, // row 2: x=1, x=2(enemy), x=3
      WALL, FLOOR, FLOOR, FLOOR, WALL, // row 3: x=1, x=2(open),  x=3
      WALL, WALL, WALL, WALL, WALL
    ]);
    const hero = { x: 1.5, z: 1.5, data: { hp: 10 } };
    const monsters = [
      { active: true, x: 2.5, z: 1.5, data: { hp: 10 } }, // cell 7 (x=2, y=1)
      { active: true, x: 2.5, z: 2.5, data: { hp: 10 } }  // cell 12 (x=2, y=2)
    ];

    const game = Object.assign({}, pathfindingMethods, {
      D: { W, H, grid },
      cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      heroes: [hero],
      monsters
    });

    const start = game.cellOf(1.5, 1.5); // cell 6
    const dest = game.cellOf(3.5, 1.5);  // cell 8

    // Pathfinding without mover passes through cell 7
    const straightPath = game.findPath(start, dest);
    expect(straightPath).toBeDefined();

    // Pathfinding with mover (hero) MUST detour around enemy cells (cell 7 and 12) down to row 3 (cell 17)
    const detourPath = game.findPath(start, dest, { mover: hero });
    expect(detourPath).toBeDefined();
    expect(detourPath.includes(7)).toBe(false);
    expect(detourPath.includes(12)).toBe(false);
    expect(detourPath.includes(17)).toBe(true); // routed via open cell 17 at (x=2, y=3)
  });

  it('approachCellNear never returns the target cell and stays in ring-1', () => {
    const game = setupGame();
    const foeCell = game.cellOf(2.5, 2.5); // occupied by Goblin1

    const goal = game.approachCellNear(foeCell, game.heroes[0]);
    expect(goal).not.toBe(foeCell);
    const W = 5;
    const gx = foeCell % W, gz = Math.floor(foeCell / W);
    const nx = goal % W, nz = Math.floor(goal / W);
    // Chebyshev distance must be exactly 1 (adjacent ring), never 2+.
    expect(Math.max(Math.abs(nx - gx), Math.abs(nz - gz))).toBe(1);
  });

  it('approachCellNear prefers an unoccupied adjacent floor cell', () => {
    const game = setupGame();
    const freeCell = game.cellOf(1.5, 1.5); // empty floor
    // Only the hero occupies (1,1); pass the hero as mover so its own cell is excluded.
    const goal = game.approachCellNear(freeCell, game.heroes[0]);
    expect(goal).not.toBe(freeCell);
    expect(game.isCellOccupiedAny(goal, game.heroes[0])).toBe(false);
  });

  it('approachCellNear returns a floor neighbour even when ring-1 is fully packed', () => {
    /* New behaviour: when ring-1 is fully packed, approachCellNear expands
       outward to ring-2/ring-3 before giving up. The old code returned an
       OCCUPIED ring-1 cell as a "fallback", which was the structural cause
       of two sprites stacking on one square. The grid is fully open floor so
       a ring-2 cell is actually reachable once ring-1 is packed. */
    const W = 5, H = 5;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const center = 12; // (2,2) in a 5x5
    const blockers = [
      // 8 ring-1 neighbours of (2,2), all occupied
      { active: true, x: 1.5, z: 1.5, data: { hp: 1 } },
      { active: true, x: 2.5, z: 1.5, data: { hp: 1 } },
      { active: true, x: 3.5, z: 1.5, data: { hp: 1 } },
      { active: true, x: 1.5, z: 2.5, data: { hp: 1 } },
      { active: true, x: 3.5, z: 2.5, data: { hp: 1 } },
      { active: true, x: 1.5, z: 3.5, data: { hp: 1 } },
      { active: true, x: 2.5, z: 3.5, data: { hp: 1 } },
      { active: true, x: 3.5, z: 3.5, data: { hp: 1 } }
    ];
    const game = Object.assign({}, pathfindingMethods, {
      D: { W, H, grid },
      cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      heroes: [],
      monsters: blockers
    });

    /* With ring-1 fully packed, the goal must come from ring-2 (Chebyshev
       distance 2), never the target cell and never an occupied tile. */
    const goal = game.approachCellNear(center, { data: {} });
    expect(goal).not.toBe(center);
    expect(game.isCellOccupiedAny(goal, { data: {} })).toBe(false);
    const cx = center % W, cz = Math.floor(center / W);
    const gx = goal % W, gz = Math.floor(goal / W);
    const cheb = Math.max(Math.abs(gx - cx), Math.abs(gz - cz));
    expect(cheb).toBeGreaterThanOrEqual(1);
    expect(cheb).toBeLessThanOrEqual(3);
  });
});
