import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';
import { reservationMethods } from '../src/game/reservation.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: (w, h) => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    }
  });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Exploration AI Room Search & Pathing Fix', () => {
  it('resets stuck timers during room search and invalidates pathing upon search completion', () => {
    const game = {
      state: 'crawl',
      combat: false,
      paused: false,
      dungeonLevel: 1,
      gold: 0,
      potions: { heal: 0 },
      visitedRooms: { 0: 1 },
      _searchedRooms: {},
      _searchRoom: -1,
      _searchT: 0,
      stuckT: 2.4, // Pre-existing high stuck timer
      targetRoom: 0,
      monsters: [],
      chests: [],
      shrines: [],
      gameGroup: { add: () => {}, remove: () => {} },
      heroes: [
        {
          x: 10, z: 10,
          data: { hp: 100, speedMult: 1 },
          stuckT: 2.4, stuckStage: 1,
          path: [1, 2, 3], pathGoal: 100
        }
      ],
      partyLeader(alive) { return alive[0]; },
      cellOf(x, z) { return 100; },
      wx(x) { return x; },
      wz(z) { return z; },
      nearFloorCell(c) { return c; },
      D: {
        W: 20, H: 20,
        roomId: new Int32Array(400).fill(0),
        rooms: [{ cx: 10, cy: 10, x: 5, y: 5, w: 10, h: 10 }]
      }
    };

    Object.assign(game, exploreMethods);

    // Frame 1: Search starts
    game.updateSearch(0.5, game.heroes, game.heroes[0]);
    expect(game._searchRoom).toBe(0);
    expect(game.stuckT).toBe(0); // Stuck timer reset!
    expect(game.heroes[0].stuckT).toBe(0);

    // Frame 2: Search in progress (accumulates 1.6s total time = 2.1s >= 2.0s duration)
    game.updateSearch(1.6, game.heroes, game.heroes[0]);

    // Search should be complete now
    expect(game._searchedRooms[0]).toBe(1);
    expect(game._searchRoom).toBe(-1);
    expect(game.targetRoom).toBe(-1); // Target room reset for fresh selection
    expect(game.heroes[0].path).toBeNull(); // Path invalidated
    expect(game.heroes[0].pathGoal).toBe(-1);
    expect(game.stuckT).toBe(0); // Stuck timer clean
  });

  it('detects micro-oscillations and allows stuck recovery to accumulate stuckT', () => {
    const leader = {
      x: 10.0, z: 10.0,
      moving: true,
      data: { speedMult: 1 },
      path: [10, 50],
      pathGoal: 50,
      pathI: 0,
      _posHistory: [
        { x: 10.00, z: 10.00 },
        { x: 10.05, z: 10.02 },
        { x: 10.01, z: 10.04 },
        { x: 10.04, z: 10.01 },
        { x: 10.02, z: 10.03 }
      ]
    };

    const game = {
      userGoal: -1,
      controlMode: 'auto',
      targetRoom: 1,
      visitedRooms: {},
      _searchedRooms: {},
      monsters: [],
      chests: [],
      shrines: [],
      roomAnchor: { 1: 50 },
      roomDone() { return false; },
      pickNextRoom() { return 2; },
      roomTargetCell() { return 50; },
      cellOf() { return 10; },
      findPath() { return [10, 50]; },
      stepAlong() { return true; }, // Returns moving = true
      handleStuck(e, l, dt) { e.stuckT = (e.stuckT || 0) + dt; },
      D: { W: 20, grid: new Int32Array(400).fill(1) }
    };

    Object.assign(game, exploreMethods, reservationMethods);

    // Run exploreAI step when leader is oscillating in place
    game.exploreAI([leader], leader, 0.5);

    // Because movement is oscillating in a tiny radius (<0.40m), stuckT should accumulate instead of resetting to 0!
    expect(game.stuckT).toBe(0.5);
  });
});
