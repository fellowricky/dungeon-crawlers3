import { describe, it, expect } from 'vitest';
import { getPropFootprintCells, buildSolidProps, SOLID_PROP_KINDS, PROP_FOOTPRINTS } from '../src/game/pathfinding.js';
import { FLOOR, WALL } from '../src/game/constants.js';

describe('Multi-Tile Prop Collision & Footprints', () => {
  const W = 20, H = 20;

  it('marks both center and adjacent tiles for horizontal sarcophagus', () => {
    // Sarcophagus at (10, 10) unrotated (major axis horizontal along X)
    const sarco = { kind: 'sarco', x: 10, y: 10, rot: 0, scale: 1.0 };
    const cells = getPropFootprintCells(sarco, W, H);
    
    // Should include (10, 10), (9, 10), (11, 10)
    expect(cells).toContain(10 * W + 10);
    expect(cells).toContain(10 * W + 9);
    expect(cells).toContain(10 * W + 11);
    // Should NOT include (10, 9) or (10, 11) since width is narrow
    expect(cells).not.toContain(9 * W + 10);
    expect(cells).not.toContain(11 * W + 10);
  });

  it('marks both center and adjacent tiles for vertical sarcophagus', () => {
    // Sarcophagus at (10, 10) rotated 90 deg (major axis vertical along Y)
    const sarco = { kind: 'sarco', x: 10, y: 10, rot: Math.PI / 2, scale: 1.0 };
    const cells = getPropFootprintCells(sarco, W, H);
    
    // Should include (10, 10), (10, 9), (10, 11)
    expect(cells).toContain(10 * W + 10);
    expect(cells).toContain(9 * W + 10);
    expect(cells).toContain(11 * W + 10);
    // Should NOT include (9, 10) or (11, 10)
    expect(cells).not.toContain(10 * W + 9);
    expect(cells).not.toContain(10 * W + 11);
  });

  it('buildSolidProps marks all footprint cells of solid multi-tile props as impassable', () => {
    const grid = new Uint8Array(W * H).fill(1); // 1 = FLOOR
    const dungeon = {
      W,
      H,
      grid,
      props: [
        { kind: 'sarco', x: 5, y: 5, rot: 0, scale: 1.0 },
        { kind: 'pillar', x: 15, y: 15, rot: 0, scale: 1.0 }
      ],
      entrance: { x: 0, y: 0 },
      rooms: [
        { cx: 5, cy: 5, w: 8, h: 8, id: 1 }
      ]
    };

    const solid = buildSolidProps(dungeon);
    expect(solid).not.toBeNull();
    // Sarco footprint cells must all be solid
    expect(solid[5 * W + 5]).toBe(1);
    expect(solid[5 * W + 4]).toBe(1);
    expect(solid[5 * W + 6]).toBe(1);
    // Pillar cell must be solid
    expect(solid[15 * W + 15]).toBe(1);
    // Free floor cell remains walkable
    expect(solid[5 * W + 7]).toBe(0);
  });
});

describe('Connectivity repair targets the actual blocker', () => {
  /* Regression: the repair loop used to rank every solid prop on the map by its
     distance to the REACHABLE frontier and clear the closest. A prop standing
     in an already-reachable room touches the frontier too, so it scored 0 just
     like the real blocker — the loop cleared unrelated furniture, level after
     level, and coffins/pillars/sarcophagi ended up walk-through in play. */
  it('does not clear props far from the orphaned pocket', () => {
    // One wide open room. A pillar at (3,3) seals a 1-cell nook at (2,3)
    // against the left wall; unrelated furniture sits far away on the right.
    const W = 16, H = 8;
    const grid = new Uint8Array(W * H).fill(WALL);
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 14; x++) grid[y * W + x] = FLOOR;
    // Wall off (2,3)'s neighbours except through the pillar cell.
    grid[2 * W + 2] = WALL;
    grid[4 * W + 2] = WALL;
    grid[2 * W + 3] = WALL;
    grid[4 * W + 3] = WALL;

    const props = [
      { kind: 'pillar', x: 3, y: 3, rot: 0, scale: 1 },   // the actual blocker
      { kind: 'coffin', x: 11, y: 4, rot: 0, scale: 1 },  // innocent, far away
      { kind: 'table',  x: 13, y: 3, rot: 0, scale: 1 },  // innocent, far away
      { kind: 'chest',  x: 8,  y: 5, rot: 0, scale: 1 }   // innocent, far away
    ];
    const rooms = [{ id: 0, cx: 8, cy: 3, w: 7, h: 2 }];
    const d = { W, H, grid, props, entrance: { x: 14, y: 3 }, rooms };

    const solid = buildSolidProps(d);

    // The blocker is cleared so the nook stays reachable...
    expect(solid[3 * W + 3]).toBe(0);
    // ...and every unrelated prop keeps its collision.
    expect(solid[4 * W + 11]).toBe(1); // coffin
    expect(solid[3 * W + 13]).toBe(1); // table
    expect(solid[5 * W + 8]).toBe(1);  // chest
  });

  it('leaves props alone when terrain, not a prop, orphans a region', () => {
    // Two rooms with no connection at all, plus furniture in the reachable one.
    // No prop can reconnect them, so none may be sacrificed trying.
    const W = 12, H = 6;
    const grid = new Uint8Array(W * H).fill(WALL);
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) grid[y * W + x] = FLOOR;
    for (let y = 1; y <= 4; y++) for (let x = 8; x <= 10; x++) grid[y * W + x] = FLOOR;

    const props = [
      { kind: 'coffin', x: 2, y: 2, rot: 0, scale: 1 },
      { kind: 'pillar', x: 4, y: 4, rot: 0, scale: 1 }
    ];
    const rooms = [{ id: 0, cx: 2, cy: 2, w: 2, h: 2 }, { id: 1, cx: 9, cy: 2, w: 1, h: 2 }];
    const d = { W, H, grid, props, entrance: { x: 1, y: 1 }, rooms };

    const solid = buildSolidProps(d);

    expect(solid[2 * W + 2]).toBe(1); // coffin keeps its collision
    expect(solid[4 * W + 4]).toBe(1); // pillar keeps its collision
  });
});
