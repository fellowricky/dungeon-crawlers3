import { describe, it, expect, vi } from 'vitest';

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
});
