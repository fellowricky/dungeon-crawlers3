import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { turnEngineMethods } from '../src/game/turn_engine.js';
import { FLOOR, WALL } from '../src/game/constants.js';

describe('Smooth Movement & Tile Center Interpolation', () => {
  function setupGame() {
    const W = 5, H = 5;
    const grid = new Uint8Array([
      WALL, WALL, WALL, WALL, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, FLOOR, FLOOR, FLOOR, WALL,
      WALL, WALL, WALL, WALL, WALL
    ]);
    return Object.assign({}, pathfindingMethods, turnEngineMethods, {
      D: { W, H, grid },
      cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5
    });
  }

  it('snapToTileCenter smoothly interpolates position when smooth=true', () => {
    const game = setupGame();
    // Entity placed slightly offset from cell (1, 1) center (1.5, 1.5)
    const entity = { x: 1.2, z: 1.2 };

    // Smooth snap with dt = 0.016
    game.snapToTileCenter(entity, 0.016, true);
    // Should move closer to 1.5, 1.5 but NOT teleport instantly to 1.5
    expect(entity.x).toBeGreaterThan(1.2);
    expect(entity.x).toBeLessThan(1.5);
    expect(entity.z).toBeGreaterThan(1.2);
    expect(entity.z).toBeLessThan(1.5);

    // Hard snap with smooth=false
    game.snapToTileCenter(entity, 0.016, false);
    expect(entity.x).toBe(1.5);
    expect(entity.z).toBe(1.5);
  });

  it('stepAlong continues walking towards final destination node instead of stopping at 0.35 distance', () => {
    const game = setupGame();
    const startCell = game.cellOf(1.5, 1.5); // cell 6
    const endCell = game.cellOf(2.5, 1.5);   // cell 7

    const entity = {
      x: 2.3, // 0.2 units away from cell 7 center (2.5, 1.5)
      z: 1.5,
      path: [startCell, endCell],
      pathI: 1,
      ent: { grp: { rotation: { y: 0 } } }
    };

    // Before our fix, dist <= 0.35 would cause stepAlong to return false immediately (stopping 0.2 units away).
    // Now with CAPTURE = 0.05 for final node, stepAlong continues stepping toward 2.5!
    const moved = game.stepAlong(entity, 2.0, 0.016);
    expect(moved).toBe(true);
    expect(entity.x).toBeGreaterThan(2.3);
  });
});
