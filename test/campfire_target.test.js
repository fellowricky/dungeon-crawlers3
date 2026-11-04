import { describe, it, expect } from 'vitest';
import { exploreMethods } from '../src/game/explore.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { FLOOR } from '../src/game/constants.js';

/* The campfire is a solid prop on a floor cell. Aiming the party AT that cell
   asked for a path into the fire, which never exists, so the campsite was
   written off as unreachable and walked past. */
function room() {
  const W = 9, H = 9;
  const grid = new Uint8Array(W * H).fill(FLOOR);
  const solidProps = new Uint8Array(W * H);
  const fire = 4 * W + 4;
  solidProps[fire] = 1;
  const game = {
    ...pathfindingMethods, ...exploreMethods,
    D: { W, H, grid, solidProps, roomId: new Int16Array(W * H).fill(0) },
    monsters: [], chests: [], floorExit: null, roomAnchor: [0],
    shrines: [{ x: 4, y: 4, roomId: 0, used: false }],
    isCellDoorClosed: () => false
  };
  return { game, fire, W };
}

describe('campfire target', () => {
  it('the party aims beside the fire, never into it', () => {
    const { game, fire, W } = room();
    const c = game.roomTargetCell(0, { x: 0, z: 0 });
    expect(c).not.toBe(fire);
    expect(game.D.solidProps[c]).toBe(0);
    const dx = Math.abs((c % W) - 4), dy = Math.abs(Math.floor(c / W) - 4);
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(2);
  });
});
