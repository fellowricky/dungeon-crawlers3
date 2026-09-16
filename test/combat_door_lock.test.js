/* ──────────────── Fighting across a shut gate ────────────────
 * A fight started with a monster on the far side of a closed door and the
 * party had no legal move: heroes could not path through the door because
 * combat banned it, and the door could not open because door-opening was
 * suspended for the duration of combat — which could not end, because nobody
 * could reach anybody. Three separate safety nets existed and every one of
 * them began with "return if in combat".
 *
 * The rule that survives: a closed door blocks whoever cannot OPEN one. That
 * is monsters, and they say so by passing avoidClosedDoors. For heroes it is a
 * cost, in a fight exactly as much as out of one.
 */
import { describe, it, expect } from 'vitest';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { generateDungeon, THEME_KEYS, FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';

describe('Closed doors during combat', () => {
  /* A wall across the middle with one gap, and that gap is a shut door. */
  const W = 11, H = 7;
  const DOOR = 3 * W + 5;
  const make = () => {
    const grid = new Uint8Array(W * H).fill(FLOOR);
    for (let x = 0; x < W; x++) if (x !== 5) grid[3 * W + x] = WALL;
    const cellToArch = new Int32Array(W * H).fill(-1);
    cellToArch[DOOR] = 0;
    return Object.assign({}, pathfindingMethods, {
      D: { W, H, grid, cellToArch, wallAdj: null, chokepoint: null, solidProps: null },
      heroes: [], monsters: [], _reservedCells: null, activeAoEZones: [],
      isCombatActive: () => true,                 // mid-fight, which was the trap
      isCellDoorClosed: (c) => c === DOOR,
      isCellReserved: () => false
    });
  };
  const from = 1 * W + 5, to = 5 * W + 5;

  it('lets a hero route through one mid-fight', () => {
    const path = make().findPath(from, to);
    expect(path, 'no route to the far side of a shut door').toBeTruthy();
    expect(path).toContain(DOOR);
  });

  it('still stops a monster, which cannot open it', () => {
    expect(make().findPath(from, to, { avoidClosedDoors: true })).toBeNull();
  });

  it('prefers a way round when one exists, rather than barging the door', () => {
    /* The door stays a real cost — this is not "doors are free now". */
    const g = make();
    g.D.grid[3 * W + 3] = FLOOR;                 // a second, undoored gap
    const path = g.findPath(from, to);
    expect(path).toBeTruthy();
    expect(path, 'walked through the gate with a clear lane available').not.toContain(DOOR);
  });
});

describe('Monster spawn placement keeps clear of doorways', () => {
  it('never seeds a monster on a threshold', () => {
    /* The buffer used to be purely relative to the room's own size, so a
       cramped room placed monsters as close as 1.0 cells to its doorway —
       close enough to open a fight through the arch with the party still on
       the far side. 22.6% of all spawns sat within 3 cells of a door. */
    let total = 0, within3 = 0, closest = Infinity;
    for (const themeKey of THEME_KEYS) {
      for (const seed of [1000, 8919, 24757, 40595, 64352]) {
        const d = generateDungeon(seed, { seed, roomCount: 40, themeKey });
        const doors = [];
        for (let c = 0; c < d.doorway.length; c++) {
          if (d.doorway[c]) doors.push([c % d.W, (c / d.W) | 0]);
        }
        for (const sp of d.spawns) {
          let m = Infinity;
          for (const [dx, dy] of doors) {
            const q = Math.hypot(sp.x - dx, sp.y - dy);
            if (q < m) m = q;
          }
          total++;
          if (m < 3) within3++;
          if (m < closest) closest = m;
        }
      }
    }
    expect(total, 'no spawns generated at all').toBeGreaterThan(500);
    /* Hard floor. A room too cramped to hold the full buffer falls back to its
       deepest cell, so this asks for the guarantee that fallback still keeps:
       never adjacent to the threshold itself. */
    expect(closest, `closest spawn sits ${closest.toFixed(2)} from a doorway`)
      .toBeGreaterThanOrEqual(2);
    /* And the buffer proper, which every sampled room can currently afford. */
    expect(within3 / total, `${within3}/${total} spawns are within 3 cells of a door`)
      .toBeLessThan(0.01);
  }, 120000);
});
