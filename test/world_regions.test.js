import { describe, it, expect } from 'vitest';
import {
  WORLD, IMPASSABLE, MIN_DOORSTEP_CELLS, THEMES_ON_GROUND, DUNGEON_SITES, MAX_TRAVEL_DAYS, HUB,
  biomeAt, biomeOfCell, cellAt, cellCentre, cellsFor, biomeCounts, isPassable,
  reachableCellsFor, travelDays, planRoute, pickPin
} from '../src/game/world_regions.js';
import { THRESHOLD_THEME, autoProloguePlan, prologueLength, depthFloor } from '../src/game/overland_prologue.js';
import { THEMES } from '../src/dungeon/dungeon_generator.js';
import { generateQuests, mulberry32, DUNGEON_THEMES } from '../src/game/quests.js';

describe('world_biomes.json shape', () => {
  it('is a full cols x rows grid of legend letters', () => {
    expect(WORLD.cells).toHaveLength(WORLD.rows);
    for (const row of WORLD.cells) {
      expect(row).toHaveLength(WORLD.cols);
      for (const ch of row) expect(WORLD.legend).toHaveProperty(ch);
    }
  });

  it('cells are square on the art', () => {
    expect(WORLD.art.w / WORLD.cols).toBe(WORLD.art.h / WORLD.rows);
  });

  it('every passable legend biome is a real overland theme', () => {
    for (const b of Object.values(WORLD.legend)) {
      if (IMPASSABLE.has(b)) continue;
      expect(THEMES[b]?.overland, b).toBe(true);
    }
  });

  it('every dungeon theme has enough painted doorstep to place pins', () => {
    for (const theme of Object.keys(THRESHOLD_THEME)) {
      expect(cellsFor(theme).length, theme).toBeGreaterThanOrEqual(MIN_DOORSTEP_CELLS);
    }
  });
});

describe('lookups', () => {
  it("every theme's own doorstep is one of its sites, and ground maps back to themes", () => {
    for (const [theme, biome] of Object.entries(THRESHOLD_THEME)) expect(DUNGEON_SITES[theme][0]).toBe(biome);
    expect(THEMES_ON_GROUND.ashfield).toEqual(['molten']);
    expect(THEMES_ON_GROUND.sporewood).toEqual(expect.arrayContaining(['verdant', 'ancient']));
    expect(THEMES_ON_GROUND.forest).toEqual(['ancient']);
    expect(THEMES_ON_GROUND.mire).toEqual(expect.arrayContaining(['grim', 'verdant']));
    expect(THEMES_ON_GROUND.moor).toBeUndefined();
  });

  it('cell centre maps back to the same cell and biome', () => {
    for (const [c, r] of [[0, 0], [WORLD.cols - 1, WORLD.rows - 1], [40, 30]]) {
      const p = cellCentre(c, r);
      expect(cellAt(p.x, p.y)).toEqual({ c, r });
      expect(biomeAt(p.x, p.y)).toBe(WORLD.legend[WORLD.cells[r][c]]);
    }
  });

  it('100% sits on the last cell and off-map is null', () => {
    expect(cellAt(100, 100)).toEqual({ c: WORLD.cols - 1, r: WORLD.rows - 1 });
    expect(biomeAt(-1, 50)).toBeNull();
    expect(biomeAt(50, 101)).toBeNull();
    expect(isPassable(-1, 50)).toBe(false);
  });

  it("cellsFor returns only that theme's site ground", () => {
    for (const theme of DUNGEON_THEMES) {
      for (const { c, r, b } of cellsFor(theme)) {
        expect(b).toBe(WORLD.legend[WORLD.cells[r][c]]);
        expect(DUNGEON_SITES[theme]).toContain(b);
      }
    }
  });

  it('counts cover every cell', () => {
    const total = Object.values(biomeCounts()).reduce((a, b) => a + b, 0);
    expect(total).toBe(WORLD.cols * WORLD.rows);
  });
});

describe('travel', () => {
  it('the hub sits on painted holdfast', () => {
    expect(biomeOfCell(HUB.c, HUB.r)).toBe('holdfast');
  });

  it('days run 1..MAX_TRAVEL_DAYS and the farthest doorstep is exactly the max', () => {
    let far = 0;
    for (const theme of DUNGEON_THEMES) {
      for (const { c, r } of reachableCellsFor(theme)) {
        const d = travelDays(c, r);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(MAX_TRAVEL_DAYS);
        far = Math.max(far, d);
      }
    }
    expect(far).toBe(MAX_TRAVEL_DAYS);
  });

  it('routes walk passable neighbouring cells from the hub to the pin', () => {
    for (const theme of DUNGEON_THEMES) {
      for (let s = 0; s < 8; s++) {
        const pin = pickPin(theme, mulberry32(100 + s));
        const route = planRoute(pin.x, pin.y, theme, mulberry32(7 + s));
        const cells = [];
        for (let i = 0; i < route.path.length; i += 2) cells.push([route.path[i], route.path[i + 1]]);
        expect(cells[0]).toEqual([HUB.c, HUB.r]);
        const end = cellAt(pin.x, pin.y);
        expect(cells[cells.length - 1]).toEqual([end.c, end.r]);
        for (let i = 0; i < cells.length; i++) {
          expect(IMPASSABLE.has(biomeOfCell(...cells[i]))).toBe(false);
          if (i) {
            expect(Math.abs(cells[i][0] - cells[i - 1][0])).toBeLessThanOrEqual(1);
            expect(Math.abs(cells[i][1] - cells[i - 1][1])).toBeLessThanOrEqual(1);
          }
        }
        expect(route.days).toBe(travelDays(end.c, end.r));
        expect(route.legs).toHaveLength(route.days);
        expect(route.legs[route.days - 1]).toBe(biomeOfCell(end.c, end.r));   // the ground under the pin
        expect(DUNGEON_SITES[theme]).toContain(route.legs[route.days - 1]);
        for (const b of route.legs) expect(THEMES[b]?.overland, b).toBe(true);
        expect(route.camps).toHaveLength(route.days - 1);
        for (let i = 1; i < route.camps.length; i++) expect(route.camps[i]).toBeGreaterThan(route.camps[i - 1]);
      }
    }
  });

  it('a day is holdfast only when it never leaves holdfast', () => {
    for (const theme of DUNGEON_THEMES) {
      for (let s = 0; s < 12; s++) {
        const pin = pickPin(theme, mulberry32(500 + s));
        const route = planRoute(pin.x, pin.y, theme, mulberry32(60 + s));
        const ends = [...route.camps, route.path.length / 2 - 1];
        let start = 0;
        ends.forEach((end, d) => {
          // Cells strictly inside the day; the boundary steps are shared with the neighbouring days.
          if (route.legs[d] === 'holdfast') {
            for (let k = start + 1; k < end; k++) {
              expect(biomeOfCell(route.path[2 * k], route.path[2 * k + 1])).toBe('holdfast');
            }
          }
          start = end;
        });
      }
    }
  });

  it('ancient pins spread over ruins, forest and sporewood instead of following area', () => {
    const seen = {};
    for (let s = 0; s < 300; s++) {
      const p = pickPin('ancient', mulberry32(9000 + s));
      const b = biomeAt(p.x, p.y);
      seen[b] = (seen[b] || 0) + 1;
    }
    for (const b of DUNGEON_SITES.ancient) expect(seen[b] || 0, b).toBeGreaterThan(60);
  });

  it('the same seed walks the same road', () => {
    const pin = pickPin('molten', mulberry32(3));
    expect(planRoute(pin.x, pin.y, 'molten', mulberry32(9))).toEqual(planRoute(pin.x, pin.y, 'molten', mulberry32(9)));
  });

  it('pins land on reachable doorstep ground, spaced apart', () => {
    for (const theme of DUNGEON_THEMES) {
      const taken = [];
      for (let i = 0; i < 4; i++) {
        const p = pickPin(theme, mulberry32(i * 31 + 5), taken);
        expect(DUNGEON_SITES[theme]).toContain(biomeAt(p.x, p.y));
        taken.push(p);
      }
    }
  });
});

describe('routed quests', () => {
  it('floors = travel days + dungeon, overland floors follow the road, boss depth unchanged', () => {
    for (let trial = 0; trial < 15; trial++) {
      for (const q of generateQuests(5, 6)) {
        expect(q.route).toBeTruthy();
        expect(q.floors).toBe(q.route.legs.length + q.dungeonFloors);
        expect(q.dungeonFloors).toBeGreaterThanOrEqual(2);
        expect(q.dungeonFloors).toBeLessThanOrEqual(8);
        expect(prologueLength(q)).toBe(q.route.legs.length);
        q.route.legs.forEach((biome, i) => {
          const plan = autoProloguePlan(q, i + 1);
          expect(plan.mapKind).toBe('overland');
          expect(plan.theme).toBe(biome);
          /* every quest overland floor is a long narrow ribbon map */
          expect(plan).toMatchObject({ mapW: 60, mapH: 300, zones: 9, layout: 'ribbon' });
        });
        expect(autoProloguePlan(q, q.floors)).toBeNull();          // the boss floor is a dungeon
        expect(DUNGEON_SITES[q.theme]).toContain(biomeAt(q.mapLocation.x, q.mapLocation.y));
        /* The boss reads the depth the same-size quest had with the old
           prologue: its final floor was floor `size`. */
        expect(depthFloor(q, q.floors)).toBe(q.dungeonSize);
      }
    }
  });

  it('quests saved before routes keep the legacy prologue and depth', () => {
    const legacy = { theme: 'grim', floors: 6, seed: 42, level: 3, place: 'X' };
    expect(prologueLength(legacy)).toBe(2);
    expect(depthFloor(legacy, 6)).toBe(6);
    expect(autoProloguePlan(legacy, 2).theme).toBe('boneyard');
  });
});
