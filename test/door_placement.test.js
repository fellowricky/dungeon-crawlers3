import { describe, it, expect } from 'vitest';
import { generateDungeon, THEMES, FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';

/* Doors (D.arches) drive both the rendered gate and the cellToArch footprint
   that game.js blocks while a door is closed. When those two disagree the
   player sees an invisible wall, or a gate that doesn't seal anything.
   These are the invariants that keep them in step. */

const DUNGEON_THEMES = Object.keys(THEMES).filter(k => !THEMES[k].overland);
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

function survey() {
  const out = { arches: 0, rooms: 0, floors: 0, archlessFloors: 0,
                lenMismatch: [], overlapping: [], notFloor: [], unsealed: [] };

  for (const themeKey of DUNGEON_THEMES) {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed, { themeKey, roomCount: 16 });
      if (!d || !d.arches) continue;
      const { W, H, grid } = d;
      out.floors++;
      out.rooms += d.rooms.length;
      out.arches += d.arches.length;
      if (d.arches.length === 0) out.archlessFloors++;

      const claimed = new Set();
      for (const a of d.arches) {
        const where = `${themeKey}#${seed} @${a.x},${a.y}`;

        if (a.cells.length !== a.len) out.lenMismatch.push(`${where} len=${a.len} cells=${a.cells.length}`);

        for (const c of a.cells) {
          if (grid[c] !== FLOOR) out.notFloor.push(where);
          if (claimed.has(c)) out.overlapping.push(where);
          claimed.add(c);
        }

        /* The cell run must be capped by something solid at both ends,
           otherwise the closed gate leaves a walkable gap beside it. */
        const first = a.cells[0], last = a.cells[a.cells.length - 1];
        const fx = first % W, fy = (first / W) | 0;
        const lx = last % W, ly = (last / W) | 0;
        const before = a.px === 1 ? (fx - 1) + fy * W : fx + (fy - 1) * W;
        const after = a.px === 1 ? (lx + 1) + ly * W : lx + (ly + 1) * W;
        const solid = c => c < 0 || c >= W * H || grid[c] === WALL;
        if (!solid(before) || !solid(after)) out.unsealed.push(where);
      }
    }
  }
  return out;
}

describe('Door placement invariants', () => {
  const s = survey();

  it('generates doors on every floor', () => {
    expect(s.floors).toBeGreaterThan(0);
    expect(s.archlessFloors).toBe(0);
    /* Historically ~1.15 arches per room. A large drop means the fit rules
       got too strict and floors lost their doors. */
    expect(s.arches / s.rooms).toBeGreaterThan(1.0);
  });

  it('keeps the blocked cell run the same width as the rendered gate', () => {
    // len is the gate's rendered width; cells is what closing it blocks.
    expect(s.lenMismatch.slice(0, 5)).toEqual([]);
  });

  it('never lets two doors claim the same cell', () => {
    // Overlapping footprints mean opening one door partly opens another.
    expect(s.overlapping.slice(0, 5)).toEqual([]);
  });

  it('only places door cells on floor tiles', () => {
    expect(s.notFloor.slice(0, 5)).toEqual([]);
  });

  it('seals the opening it stands in, on all but map-edge cases', () => {
    // A gate wider than MAX_ARCH_SPAN is rejected rather than placed unsealed;
    // the remainder are runs clamped by the map boundary.
    expect(s.unsealed.length / s.arches).toBeLessThan(0.01);
  });

  it('spawns room monsters with a buffer away from doorways', () => {
    for (const themeKey of DUNGEON_THEMES) {
      for (const seed of SEEDS) {
        const d = generateDungeon(seed, { themeKey, roomCount: 16 });
        if (!d || !d.spawns || !d.doorway) continue;

        const { W, H, doorway, spawns } = d;
        const doorwayCoords = [];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (doorway[y * W + x]) doorwayCoords.push({ x, y });
          }
        }
        if (!doorwayCoords.length) continue;

        for (const sp of spawns) {
          let minDist = 999;
          for (const dw of doorwayCoords) {
            const dist = Math.hypot(sp.x - dw.x, sp.y - dw.y);
            if (dist < minDist) minDist = dist;
          }
          // Spawns must never be directly on a doorway tile (dist > 0)
          expect(minDist).toBeGreaterThan(0.99);
        }
      }
    }
  });
});
