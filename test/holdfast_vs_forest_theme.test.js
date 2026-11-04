import { describe, it, expect } from 'vitest';
import { THEMES, generateOverland } from '../src/dungeon/dungeon_generator.js';

describe('Ribbon overland layout', () => {
  it('is long and narrow, with every clearing further up the map than the last', () => {
    for (const seed of [3, 44, 555]) {
      const d = generateOverland({ seed, themeKey: 'holdfast', level: 5, mapW: 50, mapH: 300, zones: 9, layout: 'ribbon' });
      expect(d.W).toBe(50);
      expect(d.H).toBe(300);
      expect(d.rooms).toHaveLength(9);
      /* the road never doubles back: each clearing sits higher (smaller y) than the one before */
      for (let i = 1; i < d.rooms.length; i++) expect(d.rooms[i].cy).toBeLessThan(d.rooms[i - 1].cy);
      expect(d.rooms[d.entrance].cy).toBeGreaterThan(250);
      expect(d.rooms[d.boss].cy).toBeLessThan(40);
      /* Y branch: the road carries on past the camp to the top edge of the map,
         and the camp hangs off it on a spur rather than sitting on it */
      let topX = -1;
      for (let x = 0; x < d.W; x++) if (d.corridor[x]) topX = x;
      expect(topX, 'road reaches the top edge').toBeGreaterThanOrEqual(0);
      /* (the spur runs into the camp's centre, so measure against the through road) */
      const camp = d.rooms[d.boss];
      expect(Math.abs(topX - camp.cx), 'through road clears the camp').toBeGreaterThan(camp.rad);
      /* the fight arenas bulge off to the side: the road skirts them rather
         than running through their middle, and still passes inside them */
      for (const r of d.rooms) {
        if (r.id === d.entrance || r.id === d.boss) continue;
        const rd = d.roadDist[r.cy * d.W + r.cx];
        expect(rd, `arena ${r.id}`).toBeGreaterThanOrEqual(4);
        expect(rd, `arena ${r.id}`).toBeLessThan(r.rad);
      }
    }
  });
});

describe('Overland zone furniture and holdfast ruins', () => {
  it('chests and campfires stand beside the road, never on it', () => {
    for (const themeKey of ['holdfast', 'forest', 'moor', 'boneyard']) {
      for (const seed of [11, 222, 3333]) {
        const d = generateOverland({ seed, themeKey, level: 5, mapW: 66, mapH: 100, zones: 6 });
        for (const p of d.props) {
          if (p.kind !== 'chest' && p.kind !== 'shrineCrystal') continue;
          const c = Math.round(p.y) * d.W + Math.round(p.x);
          expect(d.corridor[c], `${themeKey}/${seed} ${p.kind}`).toBeFalsy();
          expect(d.roadDist[c], `${themeKey}/${seed} ${p.kind}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('holdfast ruins sit on one level, off the road, and holdfast has no snow cairns', () => {
    let ruins = 0;
    for (const seed of [5, 66, 777, 8888, 9999]) {
      const d = generateOverland({ seed, themeKey: 'holdfast', level: 5, mapW: 66, mapH: 100, zones: 6 });
      ruins += d.stats.ruins;
      expect(d.stats.ruinsTilted).toBe(0);
      for (const p of d.props) {
        expect(p.kind).not.toBe('cairn');
        if (p.ruin === undefined) continue;
        const c = Math.round(p.y) * d.W + Math.round(p.x);
        expect(d.roadDist[c]).toBeGreaterThanOrEqual(3);
      }
    }
    expect(ruins).toBeGreaterThan(0);
  });

  it('holdfast stakes only come as ruin yard fences and the camp ring', () => {
    let ring = 0;
    for (const seed of [5, 66, 777, 8888]) {
      const d = generateOverland({ seed, themeKey: 'holdfast', level: 5, mapW: 66, mapH: 100, zones: 6 });
      for (const p of d.props) {
        if (p.kind !== 'stakes') continue;
        expect(p.fence, 'free-standing fence run').toBeUndefined();
        expect(p.ruin !== undefined || p.palisade, 'loose stake').toBeTruthy();
        if (p.palisade) ring++;
      }
    }
    expect(ring).toBeGreaterThan(0);
  });
});

describe('Overland Maps: Holdfast and Forest Visual Differentiation', () => {
  it('differentiates holdfast (settled country, dirt road) from forest (wild woodland)', () => {
    const forest = THEMES.forest;
    const holdfast = THEMES.holdfast;

    expect(forest).toBeDefined();
    expect(holdfast).toBeDefined();

    // Both are walled in by trees now (holdfast's stone blocks read as pillars, 2026-10-27)…
    expect(forest.blockerGeo).not.toBe('block');
    expect(holdfast.blockerGeo).toBe('tree');

    // …so holdfast is told apart by its tiled ground: a dirt road down the trail.
    expect(holdfast.groundTiles).toBeDefined();
    expect(holdfast.groundTiles.road).toBeGreaterThanOrEqual(0);
    expect(forest.groundTiles).toBeUndefined();

    // Distinct accents and floor/wall palette colors
    expect(holdfast.accent).not.toBe(forest.accent);
    expect(holdfast.wall).not.toBe(forest.wall);
  });
});

describe('Ribbon arena terrain', () => {
  const ribbon = { level: 5, mapW: 60, mapH: 300, zones: 9, layout: 'ribbon' };
  /* 8-way, no corner cutting, level changes only by one across a stair —
     the same rule as findPath */
  const reachable = d => {
    const { W, H, grid, height, ramp } = d;
    const pass = c => grid[c] === 1 || grid[c] === 3;
    const seen = new Uint8Array(W * H);
    const e = d.rooms[d.entrance], s0 = e.cy * W + e.cx;
    const q = [s0]; seen[s0] = 1;
    while (q.length) {
      const c = q.pop(), x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (seen[n] || !pass(n)) continue;
        if (ox && oy && (!pass(ny * W + x) || !pass(y * W + nx))) continue;
        const dh = height[n] - height[c];
        if (dh && (Math.abs(dh) !== 1 || !(ramp[c] || ramp[n]))) continue;
        seen[n] = 1; q.push(n);
      }
    }
    return seen;
  };

  it('bluffs and hollows are sheer two-level cliffs except at one shoulder, and can be climbed by it', () => {
    let count = 0;
    for (const themeKey of ['holdfast', 'forest', 'snowfield', 'mire']) {
      for (const seed of [3, 44, 555]) {
        const d = generateOverland({ seed, themeKey, ...ribbon });
        const seen = reachable(d);
        for (const f of d.elevationFeatures) {
          if (f.kind !== 'bluff' && f.kind !== 'hollow') continue;
          count++;
          const m = d.mesas.find(x => x.roomId === f.roomId);
          const inside = new Set(m.cells), shoulder = new Set(f.shoulder);
          const top = d.height[m.cells[0]];
          for (const c of m.cells) {
            expect(d.height[c], `${themeKey}/${seed} flat top`).toBe(top);
            for (const n of [c - 1, c + 1, c - d.W, c + d.W]) {
              if (inside.has(n) || shoulder.has(n) || d.grid[n] !== 1) continue;
              expect(Math.abs(d.height[n] - top), `${themeKey}/${seed} cliff`).toBeGreaterThanOrEqual(2);
            }
          }
          expect(m.cells.some(c => seen[c]), `${themeKey}/${seed} bluff ${f.roomId} reachable`).toBe(true);
          expect(d.rooms[f.roomId].arena).toBeTruthy();
        }
      }
    }
    expect(count).toBeGreaterThan(12);
  });

  it('thickets are solid knots inside arenas, off the road, and cut nothing off', () => {
    let knots = 0;
    for (const themeKey of ['holdfast', 'forest', 'boneyard']) {
      for (const seed of [3, 44, 555]) {
        const d = generateOverland({ seed, themeKey, ...ribbon });
        knots += d.stats.thickets;
        const seen = reachable(d);
        for (let c = 0; c < d.W * d.H; c++) {
          if (!d.thicketMask[c]) continue;
          expect(d.grid[c]).toBe(2);
          expect(d.roadDist[c]).toBeGreaterThanOrEqual(4);
          expect(d.rooms[d.roomId[c]]?.arena, `${themeKey}/${seed} thicket outside an arena`).toBeTruthy();
        }
        /* every spawn still reachable */
        for (const s of d.spawns || []) expect(seen[Math.round(s.y) * d.W + Math.round(s.x)], `${themeKey}/${seed} spawn`).toBeTruthy();
      }
    }
    expect(knots).toBeGreaterThan(20);
  });

  it('holdfast ribbon ruins stand in the arenas', () => {
    for (const seed of [3, 44, 555]) {
      const d = generateOverland({ seed, themeKey: 'holdfast', ...ribbon });
      expect(d.stats.ruins).toBeGreaterThanOrEqual(2);
      for (const p of d.props) {
        if (p.ruin === undefined || p.kind === 'stakes') continue;
        const r = d.rooms[d.roomId[Math.round(p.y) * d.W + Math.round(p.x)]];
        expect(r?.arena, `ruin in ${r?.id}`).toBeTruthy();
      }
    }
  });
});
