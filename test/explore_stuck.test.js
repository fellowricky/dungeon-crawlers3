import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { STUCK_SIDESTEP_T, STUCK_REPATH_T, STUCK_TELEPORT_T, FLOOR, WALL } from '../src/game/constants.js';

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

describe('Hero Exploration AI Stuck Recovery', () => {
  it('has correct timing ordering (SIDESTEP < REPATH < TELEPORT)', () => {
    expect(STUCK_SIDESTEP_T).toBeLessThan(STUCK_REPATH_T);
    expect(STUCK_REPATH_T).toBeLessThan(STUCK_TELEPORT_T);
    expect(STUCK_SIDESTEP_T).toBe(0.6);
  });

  it('resets stuckStage on successful sidestep recovery', () => {
    const leader = { x: 5.5, z: 5.5, data: { name: 'Leader', speedMult: 1 } };
    const stuckHero = { x: 5.5, z: 5.5, data: { name: 'Fighter', speedMult: 1 } };

    const game = Object.assign({}, pathfindingMethods, exploreMethods, {
      D: { W: 10, H: 10, grid: new Uint8Array(100).fill(FLOOR) },
      cellOf: (x, z) => Math.floor(z) * 10 + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      blocked: () => false, // sidestep succeeds
      classifyStuck: () => 'wall'
    });

    const recovered = game.handleStuck(stuckHero, leader, 0.7);
    expect(recovered).toBe(true);
    expect(stuckHero.stuckStage).toBe(0);
    expect(stuckHero.stuckT).toBe(0);
  });

  it('progresses through Stage 1, Stage 2, Stage 3 when sidestep is blocked', () => {
    const leader = { x: 5.5, z: 5.5, data: { name: 'Leader', speedMult: 1 } };
    const stuckHero = { x: 5.5, z: 5.5, data: { name: 'Fighter', speedMult: 1 } };

    const game = Object.assign({}, pathfindingMethods, exploreMethods, {
      D: { W: 10, H: 10, grid: new Uint8Array(100).fill(FLOOR) },
      cellOf: (x, z) => Math.floor(z) * 10 + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      blocked: () => true, // sidestep blocked
      classifyStuck: () => 'wall'
    });

    // Advance 0.7s -> Stage 1 sidestep fails, stuckStage becomes 1
    game.handleStuck(stuckHero, leader, 0.7);
    expect(stuckHero.stuckStage).toBe(1);

    // Advance to 1.6s -> triggers Stage 2 (repath)
    game.handleStuck(stuckHero, leader, 0.9);
    expect(stuckHero.stuckStage).toBe(2);

    // Advance to 2.6s -> triggers Stage 3 (teleport / recovery)
    game.handleStuck(stuckHero, leader, 1.0);
    expect(stuckHero.stuckStage).toBe(0); // resets back to 0 on completion
  });

  it('blacklists unreachable rooms when findPath returns null', () => {
    const leader = { x: 2.5, z: 2.5, data: { speedMult: 1 } };
    const game = Object.assign({}, pathfindingMethods, exploreMethods, {
      D: {
        W: 10, H: 10,
        grid: new Uint8Array(100).fill(FLOOR),
        rooms: [{ id: 0, cx: 2, cy: 2 }, { id: 1, cx: 8, cy: 8 }],
        roomId: new Int16Array(100).fill(0),
        boss: -1
      },
      cellOf: (x, z) => Math.floor(z) * 10 + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      visitedRooms: new Uint8Array(2),
      roomDone: () => false,
      roomTargetCell: (rid) => rid === 1 ? 88 : 22,
      findPath: () => null, // pathfinding fails for room 1
      stepAlong: () => false,
      handleStuck: () => {},
      controlMode: 'auto',
      targetRoom: 1,
      monsters: [],
      chests: [],
      shrines: []
    });

    // Set roomId for room 1 cells
    for (let c = 80; c < 100; c++) game.D.roomId[c] = 1;

    game.exploreAI([leader], leader, 0.016);

    // Target room 1 path failed, so it should be marked in _unreachableRooms
    expect(game._unreachableRooms[1]).toBe(true);
  });

  it('detects stagnant displacement micro-oscillations and marks leader stuck', () => {
    const leader = { x: 5.5, z: 5.5, data: { speedMult: 1 }, _lastPosX: 5.5, _lastPosZ: 5.5 };
    const game = Object.assign({}, pathfindingMethods, exploreMethods, {
      D: { W: 10, H: 10, grid: new Uint8Array(100).fill(FLOOR), chokepoint: new Uint8Array(100) },
      cellOf: (x, z) => Math.floor(z) * 10 + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      findPath: () => [55, 56],
      stepAlong: () => true, // stepAlong falsely claims movement
      handleStuck: () => { leader.stuckHandled = true; },
      controlMode: 'auto',
      roomDone: () => false,
      targetRoom: 0,
      roomTargetCell: () => 56,
      monsters: [],
      chests: [],
      shrines: []
    });

    /* The position sampler records at most ONE sample per call (it resets its
       0.2s timer each time it fires), so two 0.6s ticks only ever build a
       2-entry history — never the 5 the oscillation check needs. Drive it with
       realistic frames instead: at 60fps, 0.2s spacing fills the window in
       about a second. */
    for (let i = 0; i < 90; i++) game.exploreAI([leader], leader, 1 / 60);

    // Stagnant check sets leader.moving = false, which invokes handleStuck
    expect(leader.moving).toBe(false);
    expect(leader.stuckHandled).toBe(true);
  });

  it('treats void tiles (0) and negative cells as blocked in blocked()', () => {
    const grid = new Uint8Array(100).fill(0); // All void
    grid[55] = FLOOR; // Only cell 55 is floor
    const game = Object.assign({}, pathfindingMethods, {
      D: { W: 10, H: 10, grid },
      cellOf: (x, z) => (x < 0 || z < 0 || x >= 10 || z >= 10) ? -1 : Math.floor(z) * 10 + Math.floor(x)
    });

    // Probing in void tile (e.g. cell 11 at x=1.5, z=1.5) must be blocked
    expect(game.blocked(1.5, 1.5, 0.22)).toBe(true);

    // Probing completely outside map boundaries (negative coords) must be blocked
    expect(game.blocked(-2, -2, 0.22)).toBe(true);

    // Probing on floor cell 55 (at x=5.5, z=5.5) with small radius should be clear
    expect(game.blocked(5.5, 5.5, 0.22)).toBe(false);
  });

  it('nearFloorCell recovers valid floor even from out of bounds / void start', () => {
    const grid = new Uint8Array(100).fill(0);
    grid[44] = FLOOR;
    grid[45] = FLOOR;
    const game = Object.assign({}, pathfindingMethods, {
      D: { W: 10, H: 10, grid, solidProps: null },
      roomAnchor: [44]
    });

    // Given negative cell -1, nearFloorCell finds nearest floor
    const recovered = game.nearFloorCell(-1, 50);
    expect(recovered).toBeGreaterThanOrEqual(0);
    expect(grid[recovered]).toBe(FLOOR);
  });
});
