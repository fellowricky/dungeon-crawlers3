/* Walls the party has been next to must never wink out again.
 *
 * The flicker: revealAround (a plain radius, every frame) marks a wall
 * `revealed` and paints it 1.0. The next fog rebuild computes that wall's
 * brightness from its FLOOR neighbours — and a wall two or three cells thick
 * whose only floor neighbours are on the far side, in an unvisited room or an
 * unreached corridor, gets 0 and is sunk. `_losTier` returns 0 for revealed
 * cells ("it has a brighter rule of its own"), so nothing rescues it, and the
 * write clears `revealed`. Next frame proximity reveals it again. Repeat on
 * every step: a wall blinking in and out just beyond line of sight. */
import { describe, it, expect } from 'vitest';
import { fogMethods } from '../src/game/fog.js';
import { FLOOR, WALL } from '../src/game/constants.js';

function makeFog(W, H, grid, roomId, rooms) {
  const painted = new Float64Array(W * H).fill(-1);
  const g = Object.assign({}, fogMethods, {
    D: { W, H, grid, roomId, rooms, edges: [], sightBlockers: null, overland: false },
    engine: { getMeshes: () => ({}), getLights: () => null, getParticles: () => null, getStandalone: () => null },
    monsters: [],
    revealed: new Uint8Array(W * H),
    losSeen: new Uint8Array(W * H),
    losVisible: new Uint8Array(W * H),
    visitedRooms: new Uint8Array(rooms.length),
    floorInst: new Int32Array(W * H).fill(-1),
    floorInstN: new Uint8Array(W * H),
    wallInst: new Int32Array(W * H).fill(-1),
    _roomCleared: () => false,
    isCellDoorClosed: () => false,
    _applyPropFog() {}, _applyMonsterFog() {},
  });
  g._paintCell = (c, m) => { painted[c] = m; };
  /* revealCell raises the instance and writes full colour without going
     through _paintCell — record that as 1.0 too. */
  g.showCell = (c) => { painted[c] = 1.0; };
  g.painted = painted;
  return g;
}
const at = (W, x, y) => y * W + x;

describe('a wall once revealed stays rendered', () => {
  /* Layout (W=7, H=5): a visited corridor on row 1, a two-thick wall on rows
     2-3, an unvisited room's floor on row 4. The party stands at (3,1). */
  function build() {
    const W = 7, H = 5;
    const grid = new Uint8Array(W * H).fill(WALL);
    const roomId = new Int32Array(W * H).fill(-1);
    for (let x = 0; x < W; x++) grid[at(W, x, 1)] = FLOOR;                    // corridor
    for (let x = 1; x < W - 1; x++) { grid[at(W, x, 4)] = FLOOR; roomId[at(W, x, 4)] = 0; }   // room 0
    const rooms = [{ id: 0, cx: 3, cy: 4, w: 5, h: 1, type: 'combat' }];
    const g = makeFog(W, H, grid, roomId, rooms);
    for (let c = 0; c < W * H; c++) if (grid[c] === WALL) g.wallInst[c] = c;    // every wall has an instance
    return { g, W, H };
  }

  it('the inner wall of a thick wall does not flip between shown and sunk across fog rebuilds', () => {
    const { g, W } = build();
    const inner = at(W, 3, 3);   // only floor neighbour is room 0's floor below — unvisited
    const outer = at(W, 3, 2);   // touches the revealed corridor above

    /* frame: the party at (3,1) reveals a radius-2 disc — both wall rows */
    g.revealAround(at(W, 3, 1), 2);
    expect(g.revealed[inner]).toBe(1);
    expect(g.painted[inner]).toBe(1.0);

    /* the vision field moved → fog rebuild */
    g.recalculateFog(g);
    expect(g.painted[outer]).toBe(1.0);
    expect(g.painted[inner], 'inner wall sunk by the rebuild').toBeGreaterThan(0);
    expect(g.revealed[inner], 'and its reveal was erased').toBe(1);

    /* next frame: proximity again, then another rebuild — must be steady */
    g.revealAround(at(W, 3, 1), 2);
    g.recalculateFog(g);
    expect(g.painted[inner]).toBe(1.0);
    expect(g.revealed[inner]).toBe(1);
  });

  it('a hidden room dimming its bounding ring cannot sink a wall the party has stood beside', () => {
    const { g, W } = build();
    const shared = at(W, 3, 3);
    g.revealAround(at(W, 3, 1), 2);
    g.setRoomDimLevel(0, 0);          // room 0 is hidden; its ring includes row 3
    expect(g.painted[shared]).toBe(1.0);
    expect(g.revealed[shared]).toBe(1);
  });
});
