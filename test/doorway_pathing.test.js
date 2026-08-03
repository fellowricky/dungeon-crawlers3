import { describe, it, expect } from 'vitest';
import { generateDungeon, generateOverland, FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';
import { pathfindingMethods, buildWallAdj, buildChokepoints } from '../src/game/pathfinding.js';
import { exploreMethods } from '../src/game/explore.js';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    font: '', measureText: () => ({ width: 10 }), strokeText: () => {},
    fillText: () => {}, clearRect: () => {}, fillRect: () => {},
    beginPath: () => {}, arc: () => {}, fill: () => {}
  };
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelectorAll: () => []
  };
}

describe('Doorway Pathing & Map Widening', () => {
  it('widens 1-tile wide doorways to 2-tile wide openings in dungeon generation', () => {
    const seed = 771204; // Story chapter 1 seed
    const d = generateDungeon(seed, { seed, roomCount: 16, themeKey: 'forest' });
    const { grid, W, H } = d;
    const idx = (x, y) => y * W + x;

    let singleTileDoorCount = 0;
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const c = idx(x, y);
        if (grid[c] !== FLOOR) continue;
        const vChoke = grid[idx(x - 1, y)] === WALL && grid[idx(x + 1, y)] === WALL &&
                       grid[idx(x, y - 1)] === FLOOR && grid[idx(x, y + 1)] === FLOOR;
        const hChoke = grid[idx(x, y - 1)] === WALL && grid[idx(x, y + 1)] === WALL &&
                       grid[idx(x - 1, y)] === FLOOR && grid[idx(x + 1, y)] === FLOOR;
        if (vChoke || hChoke) {
          singleTileDoorCount++;
        }
      }
    }
    // Widen pass eliminates strict 1-tile pinch points
    expect(singleTileDoorCount).toBe(0);
  });

  it('correctly centers entities in 1-wide corridors in wallRepel', () => {
    const game = Object.assign({}, pathfindingMethods, {
      D: {
        W: 5, H: 5,
        grid: new Uint8Array([
          WALL, WALL, WALL, WALL, WALL,
          WALL, FLOOR, FLOOR, FLOOR, WALL,
          WALL, WALL, FLOOR, WALL, WALL, // cell 12 (x=2, y=2) has WALL left and right
          WALL, FLOOR, FLOOR, FLOOR, WALL,
          WALL, WALL, WALL, WALL, WALL
        ]),
        wallAdj: new Uint8Array(25),
        chokepoint: new Uint8Array(25)
      },
      cellOf: (x, z) => Math.floor(z) * 5 + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      blocked: () => false
    });

    const ent = { x: 2.2, z: 2.5 }; // slightly offset to the left in cell 12
    game.wallRepel(ent);

    // Should pull entity toward x=2.5 (center of cell 12), not 3.0
    expect(ent.x).toBeGreaterThan(2.2);
    expect(ent.x).toBeLessThanOrEqual(2.5);
  });

  it('staggers follower doorway queueing targets single-file', () => {
    const leader = { x: 10.5, z: 10.5, path: [100, 99, 98, 97], pathI: 3, data: { speedMult: 1 } };
    const alive = [leader, { x: 8.5, z: 8.5, data: { speedMult: 1 } }, { x: 8.0, z: 8.0, data: { speedMult: 1 } }];
    const game = Object.assign({}, exploreMethods, {
      D: { W: 20, H: 20, grid: new Uint8Array(400).fill(FLOOR), chokepoint: new Uint8Array(400), rooms: [], roomId: new Int16Array(400).fill(-1) },
      cellOf: (x, z) => Math.floor(z) * 20 + Math.floor(x),
      nearFloorCell: (c) => c,
      getFormationSlot: () => ({ x: 5, z: 5 }),
      findPath: () => null,
      stepAlong: () => false,
      handleStuck: () => {},
      userGoal: -1,
      roomAnchor: [50],
      roomDone: () => false,
      controlMode: 'auto',
      visitedRooms: [],
      monsters: [],
      chests: [],
      shrines: []
    });

    game.D.chokepoint[97] = 1; // leader is in chokepoint cell 97
    game.D.chokepoint[105] = 1; // formation slot is inside chokepoint
    game.exploreAI(alive, leader, 0.016);

    // Follower 0 targets path step pathI-1 (index 2) = 98
    // Follower 1 targets path step pathI-2 (index 1) = 99
    expect(alive[1].pathGoal).toBe(98);
    expect(alive[2].pathGoal).toBe(99);
  });
});
