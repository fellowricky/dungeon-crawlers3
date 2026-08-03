import { describe, it, expect } from 'vitest';
import { FLOOR, WALL } from '../src/game/constants.js';
import { buildSolidProps, SOLID_PROP_KINDS, pathfindingMethods } from '../src/game/pathfinding.js';

describe('Solid Props & Impassable Terrain', () => {
  it('correctly classifies solid objects vs walkable scatter props', () => {
    expect(SOLID_PROP_KINDS.has('pillar')).toBe(true);
    expect(SOLID_PROP_KINDS.has('table')).toBe(true);
    expect(SOLID_PROP_KINDS.has('coffin')).toBe(true);
    expect(SOLID_PROP_KINDS.has('sarco')).toBe(true);
    expect(SOLID_PROP_KINDS.has('statue')).toBe(true);
    expect(SOLID_PROP_KINDS.has('chest')).toBe(true);
    expect(SOLID_PROP_KINDS.has('barrel')).toBe(true);
    expect(SOLID_PROP_KINDS.has('crate')).toBe(true);

    // Scatter exceptions
    expect(SOLID_PROP_KINDS.has('skeleton')).toBe(false);
    expect(SOLID_PROP_KINDS.has('rocks')).toBe(false);
    expect(SOLID_PROP_KINDS.has('bonePile')).toBe(false);
    expect(SOLID_PROP_KINDS.has('debris')).toBe(false);
    expect(SOLID_PROP_KINDS.has('moss')).toBe(false);
    expect(SOLID_PROP_KINDS.has('candle')).toBe(false);
  });

  it('marks solid props as impassable in d.solidProps while keeping scatter walkable', () => {
    const W = 10, H = 10;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const props = [
      { kind: 'pillar', x: 2, y: 2, roomId: 0 },
      { kind: 'coffin', x: 4, y: 4, roomId: 0 },
      { kind: 'table', x: 6, y: 6, roomId: 0 },
      { kind: 'skeleton', x: 3, y: 3, roomId: 0 },
      { kind: 'rocks', x: 5, y: 5, roomId: 0 }
    ];
    const rooms = [{ id: 0, cx: 5, cy: 5, w: 8, h: 8, type: 0 }];
    const d = { W, H, grid, props, entrance: { x: 1, y: 1 }, rooms };

    const solid = buildSolidProps(d);

    // Solid objects should be impassable (1)
    expect(solid[2 * W + 2]).toBe(1); // pillar
    expect(solid[4 * W + 4]).toBe(1); // coffin
    expect(solid[6 * W + 6]).toBe(1); // table

    // Exceptions / scatter objects should remain walkable (0)
    expect(solid[3 * W + 3]).toBe(0); // skeleton
    expect(solid[5 * W + 5]).toBe(0); // rocks
  });

  it('pathfinding routes around solid prop obstacles and through scatter', () => {
    const W = 5, H = 5;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const props = [
      { kind: 'pillar', x: 2, y: 2 },   // solid pillar right in the center (2,2)
      { kind: 'skeleton', x: 1, y: 2 }  // scatter skeleton at (1,2)
    ];
    const d = { W, H, grid, props, entrance: { x: 0, y: 2 }, rooms: [{ id: 0, cx: 2, cy: 2, w: 4, h: 4 }] };
    d.solidProps = buildSolidProps(d);

    const context = { D: d, ...pathfindingMethods };

    // Path from (0,2) to (4,2)
    const fromCell = 2 * W + 0;
    const toCell = 2 * W + 4;

    const path = context.findPath(fromCell, toCell);

    expect(path).not.toBeNull();
    // Path must not enter cell (2,2) where pillar is located
    const pillarCell = 2 * W + 2;
    expect(path).not.toContain(pillarCell);
  });

  it('prevents diagonal corner-cutting past solid prop corners (e.g. chairs/tables)', () => {
    // 3x3 grid:
    // (0,0) [Start]  (1,0) [Floor]  (2,0) [Floor]
    // (0,1) [Floor]  (1,1) [Chair]  (2,1) [Floor]
    // (0,2) [Floor]  (1,2) [Floor]  (2,2) [Goal]
    const W = 3, H = 3;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const props = [{ kind: 'table', x: 1, y: 1 }]; // solid prop in center (1,1)
    const d = { W, H, grid, props, entrance: { x: 0, y: 0 } };
    d.solidProps = buildSolidProps(d);

    const context = { D: d, ...pathfindingMethods };

    const fromCell = 0 * W + 0; // (0,0)
    const toCell = 2 * W + 2;   // (2,2)

    const path = context.findPath(fromCell, toCell);

    expect(path).not.toBeNull();
    // Path must not cut diagonally from (0,0) to (2,2) or (0,2) to (2,0) across (1,1) corner
    const chairCell = 1 * W + 1;
    expect(path).not.toContain(chairCell);

    // Verify path steps go around (1,1)
    for (let i = 0; i < path.length - 1; i++) {
      const c1 = path[i], c2 = path[i + 1];
      const x1 = c1 % W, y1 = Math.floor(c1 / W);
      const x2 = c2 % W, y2 = Math.floor(c2 / W);
      const dx = x2 - x1, dy = y2 - y1;
      if (dx !== 0 && dy !== 0) {
        // If stepping diagonally (dx, dy), both adjacent cardinal cells (x1+dx, y1) and (x1, y1+dy) must be walkable
        const card1 = y1 * W + (x1 + dx);
        const card2 = (y1 + dy) * W + x1;
        expect(d.solidProps[card1]).toBe(0);
        expect(d.solidProps[card2]).toBe(0);
      }
    }
  });
});
