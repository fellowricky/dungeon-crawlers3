import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';
import { pathfindingMethods, buildSolidProps, SOLID_PROP_KINDS } from '../src/game/pathfinding.js';
import { FLOOR } from '../src/game/constants.js';

describe('Floor Exit Portal Trigger', () => {
  it('activates portal on exit room cleared and triggers finishDungeon when hero steps on portal', () => {
    let finishCalled = false;
    const game = {
      D: { W: 20, rooms: [{ cx: 10, cy: 10 }] },
      floorExit: { roomId: 0, x: 10, y: 10, active: false, entered: false },
      heroes: [{ x: 10.2, z: 10.2, data: { hp: 100 } }],
      _roomCleared() { return true; },
      wx(x) { return x; },
      wz(z) { return z; },
      finishDungeon() { finishCalled = true; }
    };

    // Import updateFloorExit binding logic
    const updateFloorExit = (dt, elapsed, alive) => {
      const fx = game.floorExit;
      if (!fx || !game.D) return;
      const exitRoomCleared = game._roomCleared(fx.roomId);
      if (!fx.active && exitRoomCleared) {
        fx.active = true;
      }
      if (fx.active) {
        const tx = game.wx(fx.x), tz = game.wz(fx.y);
        const stepped = alive.some(h => Math.hypot(h.x - tx, h.z - tz) < 1.6);
        if (stepped) {
          fx.entered = true;
          game.finishDungeon();
        }
      }
    };

    updateFloorExit(0.1, 0.1, game.heroes);

    expect(game.floorExit.active).toBe(true);
    expect(game.floorExit.entered).toBe(true);
    expect(finishCalled).toBe(true);
  });

  it('routes exploreAI and pickNextRoom to active floor exit even when all rooms are marked done', () => {
    const W = 10, H = 10;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const rooms = [
      { id: 0, cx: 2, cy: 2, w: 4, h: 4 },
      { id: 1, cx: 7, cy: 7, w: 4, h: 4 } // boss room
    ];
    const roomId = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) roomId[(y + 1) * W + (x + 1)] = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) roomId[(y + 5) * W + (x + 5)] = 1;

    const leader = { x: 7.5, z: 5.5, data: { name: 'Leader', speedMult: 1, hp: 100 } };
    const game = Object.assign({}, pathfindingMethods, exploreMethods, {
      D: { W, H, grid, rooms, roomId, boss: 1, entrance: 0, solidProps: new Uint8Array(W * H) },
      cellOf: (x, z) => Math.floor(z) * W + Math.floor(x),
      wx: (x) => x + 0.5,
      wz: (z) => z + 0.5,
      visitedRooms: new Uint8Array(2).fill(1),
      roomDone: () => true,
      roomAnchor: [1 * W + 1, 7 * W + 7],
      floorExit: { roomId: 1, x: 7, y: 7, active: true, entered: false },
      monsters: [],
      chests: [],
      shrines: [],
      targetRoom: -1,
      controlMode: 'auto',
      userGoal: -1,
      setEntityPath: (e, p) => { e.path = p; e.pathI = 0; },
      stepAlong: (e) => true
    });

    // pickNextRoom should pick the exit room (1)
    const nextRoom = game.pickNextRoom(leader);
    expect(nextRoom).toBe(1);

    // roomTargetCell should target the exit portal cell (77)
    const targetCell = game.roomTargetCell(1, leader);
    expect(targetCell).toBe(7 * W + 7);

    // exploreAI should set goalCell to targetCell and compute a path
    game.exploreAI([leader], leader, 0.1);
    expect(game.targetRoom).toBe(1);
    expect(leader.pathGoal).toBe(7 * W + 7);
    expect(leader.path).not.toBeNull();
  });

  it('does not mark bossCrystal as solid so pathfinding to room center succeeds', () => {
    expect(SOLID_PROP_KINDS.has('bossCrystal')).toBe(false);

    const W = 10, H = 10;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const props = [{ kind: 'bossCrystal', x: 5, y: 5, roomId: 0 }];
    const d = { W, H, grid, props, entrance: { x: 0, y: 0 }, rooms: [{ id: 0, cx: 5, cy: 5 }] };
    d.solidProps = buildSolidProps(d);

    expect(d.solidProps[5 * W + 5]).toBe(0);

    const context = { D: d, cellOf: (x, z) => Math.floor(z) * W + Math.floor(x), ...pathfindingMethods };
    const path = context.findPath(0, 5 * W + 5);
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toBe(5 * W + 5);
  });
});
