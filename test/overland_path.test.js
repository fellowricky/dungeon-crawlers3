import { describe, it, expect } from 'vitest';
import { generateDungeon, THEMES, FLOOR, TYPE } from '../src/dungeon/dungeon_generator.js';
import {
  autoProloguePlan, prologueLength, approachTheme, THRESHOLD_THEME, APPROACH_POOLS
} from '../src/game/overland_prologue.js';

const OVERLAND = Object.keys(THEMES).filter(k => THEMES[k].overland);
/* the portrait sizes are what the prologue actually asks for; the square ones
   are the legacy story-mission shapes, which still have to generate */
const SIZES = [
  [61, 92, 5], [65, 100, 6], [71, 113, 8], [78, 120, 9],
  [58, 58, 5], [84, 84, 12], [48, 48, 4]
];
/* what the prologue actually asks for at low / mid / high quest level */
const PROLOGUE_SIZES = [[61, 92, 5], [71, 113, 7], [78, 120, 9]];

/** Every overland map is a journey: one zone after another, entrance to camp. */
describe('overland zone chain', () => {
  it('lays every biome out as a single unbranching path', () => {
    for (const theme of OVERLAND) {
      for (const [mapW, mapH, zones] of SIZES) {
        const d = generateDungeon({ seed: 4242, themeKey: theme, mapW, mapH, zones });
        const N = d.rooms.length;
        const deg = new Array(N).fill(0);
        for (const e of d.edges) { deg[e.a]++; deg[e.b]++; }

        const label = `${theme} ${mapW}x${mapH}/z${zones}`;
        expect(d.edges.length, `${label}: edge count`).toBe(N - 1);
        expect(d.edges.filter(e => e.isLoop).length, `${label}: loops`).toBe(0);
        // exactly two endpoints (trailhead + camp), everything else is a through-zone
        expect(deg.filter(x => x === 1).length, `${label}: endpoints`).toBe(2);
        expect(deg.filter(x => x === 2).length, `${label}: through-zones`).toBe(N - 2);
        // the journey runs entrance -> ... -> camp in index order
        expect(d.entrance, `${label}: entrance`).toBe(0);
        expect(d.boss, `${label}: camp`).toBe(N - 1);
        expect(d.rooms[0].type).toBe(TYPE.ENTRANCE);
        expect(d.rooms[N - 1].type).toBe(TYPE.BOSS);
      }
    }
  });

  /* Regression: stampTrail's bounds test read `py+py`, so no trail cell in the
     bottom half of a map was protected from the blocker pass. The old loop-rich
     zone graph routed around the damage; a linear path cannot. */
  it('keeps every zone on the chain walkable from the trailhead', () => {
    for (const theme of OVERLAND) {
      for (const [mapW, mapH, zones] of SIZES) {
        for (const seed of [1, 7919, 385140]) {
          const d = generateDungeon({ seed, themeKey: theme, mapW, mapH, zones });
          const cut = d.rooms.filter(r => d.bfs[r.cy * d.W + r.cx] < 0).map(r => r.id);
          expect(cut, `${theme} ${mapW}x${mapH}/z${zones} seed ${seed}: cut-off zones`).toEqual([]);
        }
      }
    }
  });

  it('reaches nearly all floor tiles, not just the road', () => {
    for (const theme of OVERLAND) {
      const d = generateDungeon({ seed: 7919, themeKey: theme, mapW: 84, mapH: 84, zones: 20 });
      let floorTiles = 0;
      for (let i = 0; i < d.grid.length; i++) if (d.grid[i] === FLOOR) floorTiles++;
      // small pockets behind blockers are expected and long-standing; a severed
      // road shows up as a collapse to a few percent
      expect(d.stats.reach / floorTiles, `${theme}: reachable fraction`).toBeGreaterThan(0.85);
    }
  });

  /* The corridor mask is what makes the map a road through wilderness rather
     than an open field with a trail drawn on it. If it regresses, the open
     fraction climbs back toward the ~100% the generator used to produce. */
  it('walls off the country either side of the road', () => {
    for (const theme of OVERLAND) {
      for (const [mapW, mapH, zones] of PROLOGUE_SIZES) {
        const d = generateDungeon({ seed: 4242, themeKey: theme, mapW, mapH, zones });
        let floorTiles = 0;
        for (let i = 0; i < d.grid.length; i++) if (d.grid[i] === FLOOR) floorTiles++;
        const open = floorTiles / (mapW * mapH);
        const label = `${theme} ${mapW}x${mapH}: open fraction`;
        expect(open, label).toBeLessThan(0.55);   // a ribbon, not a field
        expect(open, label).toBeGreaterThan(0.12); // but still a walkable road
      }
    }
  });

  /* Long hauls are the point — the journey should cover real ground. */
  /* Clearings are battlefields, not wide spots in the road: big enough to fight
     across, spaced so there is open country between them, and scattered enough
     to break up sightlines. */
  it('gives every clearing room, spacing and cover', () => {
    for (const theme of OVERLAND) {
      for (const [mapW, mapH, zones] of PROLOGUE_SIZES) {
        /* level 14: past the spawn-budget curve's early-level spawn caps, so
           this exercises clearing size rather than the level clamp. */
        const d = generateDungeon({ seed: 4242, themeKey: theme, mapW, mapH, zones, level: 14 });
        const label = `${theme} ${mapW}x${mapH}`;

        for (const r of d.rooms) expect(r.rad, `${label}: clearing radius`).toBeGreaterThanOrEqual(8);

        // neighbours should mostly stand apart, not fuse into one long meadow
        let merged = 0;
        for (let i = 0; i < d.rooms.length - 1; i++) {
          const gap = Math.hypot(d.rooms[i].cx - d.rooms[i+1].cx, d.rooms[i].cy - d.rooms[i+1].cy);
          if (gap < d.rooms[i].rad + d.rooms[i+1].rad) merged++;
        }
        expect(merged / (d.rooms.length - 1), `${label}: merged neighbours`).toBeLessThan(0.4);

        // combat zones need a real fight in them, not two stragglers
        const perZone = {};
        for (const s of d.spawns) perZone[s.roomId] = (perZone[s.roomId] || 0) + 1;
        const combat = d.rooms.filter(r => r.type === TYPE.COMBAT);
        let maxCombat = 0;
        for (const r of combat) {
          const n = perZone[r.id] || 0;
          if (n > maxCombat) maxCombat = n;
          expect(n, `${label}: spawns in zone ${r.id} (r=${r.rad})`).toBeGreaterThanOrEqual(3);
        }
        // Overland clearings now use the spawn-budget loop (× typeMult), so the
        // camp (boss, ×1.25, max difficulty) is always the floor's densest fight —
        // at least as populated as the biggest combat zone. The absolute count
        // tracks the live spawn_budget tuning, so the invariant is relative.
        expect(perZone[d.boss] || 0, `${label}: camp spawns`).toBeGreaterThanOrEqual(maxCombat);
        // and no two monsters stacked on one tile
        const cells = d.spawns.map(s => s.y * d.W + s.x);
        expect(new Set(cells).size, `${label}: distinct spawn tiles`).toBe(cells.length);

        expect(d.props.length, `${label}: scattered props`).toBeGreaterThan(d.rooms.length * 6);
      }
    }
  });

  it('lays a road long enough to feel like a journey', () => {
    for (const theme of OVERLAND) {
      const d = generateDungeon({ seed: 4242, themeKey: theme, mapW: 71, mapH: 113, zones: 8 });
      let len = 0;
      for (let i = 0; i < d.rooms.length - 1; i++)
        len += Math.hypot(d.rooms[i].cx - d.rooms[i+1].cx, d.rooms[i].cy - d.rooms[i+1].cy);
      // the straight-line distance trailhead -> camp is the floor to beat; a
      // wandering road should be well longer than simply walking up the map
      const asCrow = Math.hypot(
        d.rooms[0].cx - d.rooms[d.rooms.length-1].cx,
        d.rooms[0].cy - d.rooms[d.rooms.length-1].cy);
      expect(len, `${theme}: road length vs straight line`).toBeGreaterThan(asCrow * 1.5);
    }
  });

  it('spaces the treasure and shrine along the journey, not beside the camp', () => {
    for (const theme of OVERLAND) {
      const d = generateDungeon({ seed: 4242, themeKey: theme, mapW: 72, mapH: 72, zones: 12 });
      const N = d.rooms.length;
      const t = d.rooms.findIndex(r => r.type === TYPE.TREASURE);
      const s = d.rooms.findIndex(r => r.type === TYPE.SHRINE);
      expect(t, `${theme}: has treasure`).toBeGreaterThan(0);
      expect(s, `${theme}: has shrine`).toBeGreaterThan(0);
      expect(t).not.toBe(N - 2);          // not always the zone before the camp
      expect(s).toBeLessThan(t);          // shrine comes first on the road
      expect(d.rooms[N - 1].difficulty).toBe(1);
      expect(d.rooms[0].difficulty).toBe(0);
    }
  });
});

describe('overland prologue', () => {
  const quest = (over = {}) => ({
    theme: 'grim', floors: 6, level: 5, seed: 12345, place: 'Gloomhaven', name: 'q', ...over
  });

  it('opens a run with an approach then the dungeon threshold', () => {
    for (const theme of Object.keys(THRESHOLD_THEME)) {
      const q = quest({ theme });
      expect(prologueLength(q)).toBe(2);
      const f1 = autoProloguePlan(q, 1), f2 = autoProloguePlan(q, 2);
      expect(f1.mapKind).toBe('overland');
      expect(APPROACH_POOLS[theme]).toContain(f1.theme);
      expect(f2.theme).toBe(THRESHOLD_THEME[theme]);
      expect(THEMES[f2.theme].threshold).toBe(theme);
      // floors past the prologue fall through to the dungeon generator
      expect(autoProloguePlan(q, 3)).toBeNull();
      expect(autoProloguePlan(q, q.floors)).toBeNull();
    }
  });

  it('drops the approach on a 3-floor quest so the boss floor stays a dungeon', () => {
    const q = quest({ floors: 3 });
    expect(prologueLength(q)).toBe(1);
    expect(autoProloguePlan(q, 1).theme).toBe(THRESHOLD_THEME.grim);
    expect(autoProloguePlan(q, 2)).toBeNull();
    expect(autoProloguePlan(q, 3)).toBeNull();
  });

  it('never covers the final floor', () => {
    for (let floors = 3; floors <= 10; floors++) {
      const q = quest({ floors });
      expect(prologueLength(q)).toBeLessThan(floors);
      expect(autoProloguePlan(q, floors)).toBeNull();
    }
  });

  it('leaves hand-authored story missions alone', () => {
    expect(prologueLength(quest({ story: true }))).toBe(0);
    expect(prologueLength(quest({ floorPlan: [{ mapKind: 'overland' }] }))).toBe(0);
    expect(autoProloguePlan(quest({ story: true }), 1)).toBeNull();
  });

  it('picks a stable approach for a given quest seed', () => {
    const q = quest();
    expect(approachTheme(q)).toBe(approachTheme({ ...q }));
    expect(autoProloguePlan(q, 1).theme).toBe(autoProloguePlan({ ...q }, 1).theme);
  });

  it('generates a real map from every derived plan', () => {
    for (const theme of Object.keys(THRESHOLD_THEME)) {
      for (const floors of [3, 7]) {
        const q = quest({ theme, floors });
        for (let f = 1; f <= prologueLength(q); f++) {
          const p = autoProloguePlan(q, f);
          const d = generateDungeon({ seed: q.seed + f * 9973, themeKey: p.theme, mapW: p.mapW, mapH: p.mapH, zones: p.zones });
          expect(d.overland, `${theme} f${f}`).toBe(true);
          expect(d.rooms.length).toBeGreaterThanOrEqual(2);
          expect(d.spawns.length).toBeGreaterThan(0);
          expect(p.name).toContain(q.place);
        }
      }
    }
  });
});
