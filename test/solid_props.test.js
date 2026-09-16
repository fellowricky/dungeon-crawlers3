import { describe, it, expect } from 'vitest';
import { FLOOR, WALL } from '../src/game/constants.js';
import { buildSolidProps, SOLID_PROP_KINDS, PODIUM_PROP_KINDS,
         getPropFootprintCells, pathfindingMethods } from '../src/game/pathfinding.js';
import { generateDungeon } from '../src/dungeon/dungeon_generator.js';

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

  it('keeps a whole room solid when a solid prop sits on the room centre (chest/shrine)', () => {
    // Regression: the old connectivity guard unmarked EVERY prop in a room
    // whose centre cell was unreachable — which is exactly what happens when a
    // chest/shrine/sarco sits on the centre tile.
    const W = 12, H = 12;
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const props = [
      { kind: 'chest', x: 5, y: 5, roomId: 0 },   // solid prop at room centre
      { kind: 'table', x: 2, y: 2, roomId: 0 },
      { kind: 'coffin', x: 8, y: 8, roomId: 0 }
    ];
    const rooms = [{ id: 0, cx: 5, cy: 5, w: 9, h: 9 }];
    const d = { W, H, grid, props, entrance: { x: 0, y: 0 }, rooms };

    const solid = buildSolidProps(d);

    expect(solid[5 * W + 5]).toBe(1); // chest (room centre)
    expect(solid[2 * W + 2]).toBe(1); // table
    expect(solid[8 * W + 8]).toBe(1); // coffin
  });

  it('clears only the blocking prop when a solid prop seals off a room', () => {
    // 1-wide corridor (row y=1) leads to a 2-cell room at the right end. A
    // table placed in the corridor is the only thing cutting the room off.
    // The guard must clear just that table, leaving the room's own coffin solid.
    const W = 7, H = 4;
    const grid = new Uint8Array(W * H).fill(WALL);
    const floorCells = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 2]];
    for (const [x, y] of floorCells) grid[y * W + x] = FLOOR;
    const props = [
      { kind: 'table', x: 4, y: 1, roomId: 0 },  // corridor blocker
      { kind: 'coffin', x: 5, y: 2, roomId: 0 }  // inside the room
    ];
    const rooms = [{ id: 0, cx: 5, cy: 1, w: 1, h: 1 }];
    const d = { W, H, grid, props, entrance: { x: 1, y: 1 }, rooms };

    const solid = buildSolidProps(d);

    expect(solid[1 * W + 4]).toBe(0); // blocker cleared to reconnect the room
    expect(solid[2 * W + 5]).toBe(1); // room's own coffin stays solid

    const context = { D: { ...d, solidProps: solid }, ...pathfindingMethods };
    const path = context.findPath(1 * W + 1, 1 * W + 5);
    expect(path).not.toBeNull(); // the room is reachable again
  });

  /* Elevation used to plan terrain over bare floor, blind to props. Stairs were
     cut through them and the connectivity guard then deleted whatever still
     blocked a tier, so a tenth of every level's solid props were silently
     walk-through — most visibly the sarcophagus at the centre of a Grim boss
     arena, which came out passable about half the time. */
  it('keeps solid props solid on elevated levels — the Grim boss sarcophagus especially', () => {
    let checkedBoss = 0, passableBoss = 0, placed = 0, lost = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const d = generateDungeon(seed, { seed, roomCount: 16, themeKey: 'grim' });
      const solid = buildSolidProps(d);
      const anySolid = p => getPropFootprintCells(p, d.W, d.H).some(c => solid[c]);
      const boss = d.rooms.find(r => r.type === 'boss');
      for (const p of d.props) {
        if (!SOLID_PROP_KINDS.has(p.kind)) continue;
        if (p.podium && PODIUM_PROP_KINDS.has(p.kind)) continue;
        placed++;
        if (!anySolid(p)) lost++;
        if (boss && p.kind === 'sarco' && p.roomId === boss.id) {
          checkedBoss++;
          if (!anySolid(p)) passableBoss++;
        }
      }
    }
    expect(checkedBoss).toBeGreaterThan(0);
    expect(passableBoss, `${passableBoss}/${checkedBoss} boss sarcophagi walk-through`).toBe(0);
    // Terrain must not cost props their collision: the flat-level baseline is ~2%.
    expect(lost / placed).toBeLessThan(0.05);
  });

  /* An altar is meant to be climbed, not walked around. buildElevation raises
     the tile it covers and stamps `podium`; from then on it must NOT be solid,
     or nothing could stand on it. One it could not raise keeps the old
     behaviour and stays an obstacle. */
  it('makes a raised altar walkable terrain and leaves an unraised one solid', () => {
    let podiums = 0, plainAltars = 0, plainSolid = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const d = generateDungeon(seed, { seed, roomCount: 16, themeKey: 'grim' });
      const solid = buildSolidProps(d);
      for (const p of d.props) {
        if (p.kind !== 'altarTable') continue;
        const cells = getPropFootprintCells(p, d.W, d.H).filter(c => d.grid[c] === FLOOR);
        if (!cells.length) continue;
        if (p.podium) {
          podiums++;
          // one plane, one level above what it was cut from, and steppable
          expect(new Set(cells.map(c => d.height[c])).size).toBe(1);
          const blockedBySelf = cells.every(c => solid[c]);
          expect(blockedBySelf).toBe(false);
        } else {
          plainAltars++;
          if (cells.some(c => solid[c])) plainSolid++;
        }
      }
    }
    expect(podiums).toBeGreaterThan(0);
    expect(plainAltars).toBeGreaterThan(0);
    /* Not every one: the connectivity guard may still clear an altar that is
       genuinely the only thing sealing a region. The point is that failing to
       become a podium leaves an obstacle, not a hole. Twelve seeds give ~50
       plain altars, so one more cleared altar moves this by 2% — 0.85 keeps
       the guard's occasional clearance from failing the invariant. */
    expect(plainSolid / plainAltars).toBeGreaterThan(0.85);
  });
});
