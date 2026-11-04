/**
 * Holdfast river: one river right across the map, bridged where the road
 * meets it (oc.river in dungeon_generator.js). The bridge is the only way
 * over, so the properties that matter are that the river really is a barrier,
 * that the bridge really does carry the party across, and that the deck is a
 * flat rectangle the rest of the generator leaves alone.
 */
import { describe, it, expect } from 'vitest';
import { generateOverland, FLOOR, POOL } from '../src/dungeon/dungeon_generator.js';

const RIBBON = { themeKey: 'holdfast', level: 5, mapW: 50, mapH: 300, zones: 9, layout: 'ribbon' };
const SQUARE = { themeKey: 'holdfast', level: 5, mapW: 84, mapH: 84 };

function flood(grid, W, start) {
  const seen = new Uint8Array(grid.length);
  if (grid[start] !== FLOOR) return seen;
  const st = [start]; seen[start] = 1;
  while (st.length) {
    const c = st.pop(), x = c % W;
    for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (n < 0 || n >= grid.length || seen[n] || grid[n] !== FLOOR) continue;
      seen[n] = 1; st.push(n);
    }
  }
  return seen;
}
const centre = (d, i) => d.rooms[i].cy * d.W + d.rooms[i].cx;
const deckCells = d => d.props.filter(p => p.kind === 'woodBridge').map(p => p.y * d.W + p.x);

describe('Holdfast river', () => {
  it('places on every ribbon travel day when forced', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const d = generateOverland({ ...RIBBON, seed, river: true });
      expect(d.stats.river, `seed ${seed}`).toBe(1);
    }
  });

  it('is a barrier the bridge alone gets you across', () => {
    for (const [base, seeds] of [[RIBBON, [1, 7, 13]], [SQUARE, [3, 7, 11]]]) {
      for (const seed of seeds) {
        const d = generateOverland({ ...base, seed, river: true });
        if (!d.stats.river) continue;
        const from = centre(d, d.entrance), to = centre(d, d.boss);
        expect(flood(d.grid, d.W, from)[to], `seed ${seed}: camp reachable`).toBe(1);
        const cut = d.grid.slice();
        for (const c of deckCells(d)) cut[c] = POOL;
        expect(flood(cut, d.W, from)[to], `seed ${seed}: camp reachable without the bridge`).toBe(0);
      }
    }
  });

  it('lays a flat rectangular deck of road, railed only against the water', () => {
    for (const seed of [2, 5, 9, 21]) {
      const d = generateOverland({ ...RIBBON, seed, river: true });
      const deck = deckCells(d);
      expect(deck.length).toBeGreaterThanOrEqual(6);
      const xs = deck.map(c => c % d.W), ys = deck.map(c => (c / d.W) | 0);
      const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
      expect(deck.length, `seed ${seed}: deck is a full rectangle`).toBe(w * h);
      expect(new Set(d.props.filter(p => p.kind === 'woodBridge').map(p => p.rot)).size).toBe(1);
      const on = new Set(deck);
      for (const c of deck) {
        expect(d.grid[c]).toBe(FLOOR);
        expect(d.corridor[c]).toBeTruthy();
      }
      expect(new Set(deck.map(c => d.height[c])).size, `seed ${seed}: deck on one level`).toBe(1);
      for (const r of d.props.filter(p => p.kind === 'woodRailing')) {
        const c = r.y * d.W + r.x;
        expect(on.has(c)).toBe(true);
        const n = c + Math.round(r.ox / 0.46) + Math.round(r.oz / 0.46) * d.W;
        expect(d.grid[n], `seed ${seed}: rail faces water`).not.toBe(FLOOR);
      }
    }
  });

  it('keeps out of the inner part of every clearing', () => {
    let checked = 0;
    for (const seed of [4, 8, 15, 16, 23, 42]) {
      const d = generateOverland({ ...SQUARE, seed, river: true });
      if (!d.stats.river) continue;
      checked++;
      /* the river is the water touching the bridge; ordinary ponds may sit
         anywhere they like */
      const river = new Set(), st = [];
      for (const c of deckCells(d))
        for (const n of [c - 1, c + 1, c - d.W, c + d.W])
          if (d.grid[n] === POOL && !river.has(n)) { river.add(n); st.push(n); }
      while (st.length) {
        const c = st.pop();
        for (const n of [c - 1, c + 1, c - d.W, c + d.W])
          if (d.grid[n] === POOL && !river.has(n)) { river.add(n); st.push(n); }
      }
      expect(river.size, `seed ${seed}`).toBeGreaterThan(d.W);
      for (const c of river) {
        const x = c % d.W, y = (c / d.W) | 0;
        for (const r of d.rooms)
          expect((x - r.cx) ** 2 + (y - r.cy) ** 2, `seed ${seed} room ${r.id}`).toBeGreaterThanOrEqual((r.rad * 0.6) ** 2);
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('runs four to five tiles wide (Zenu asked for wider than 2-3)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const d = generateOverland({ ...RIBBON, seed, river: true });
      /* the ribbon river runs across the map, so its width is the run of
         water down each column; take the typical one */
      const deck = new Set(deckCells(d));
      const widths = [];
      for (let x = 2; x < d.W - 2; x++) {
        let best = 0, run = 0;
        for (let y = 0; y < d.H; y++) {
          const c = y * d.W + x;
          run = (d.grid[c] === POOL || deck.has(c)) ? run + 1 : 0;
          best = Math.max(best, run);
        }
        widths.push(best);
      }
      widths.sort((a, b) => a - b);
      const median = widths[widths.length >> 1];
      expect(median, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(median, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it('can be switched off, and only holdfast has one', () => {
    for (const seed of [1, 2, 3]) {
      const off = generateOverland({ ...RIBBON, seed, river: false });
      expect(off.stats.river).toBe(0);
      expect(off.props.some(p => p.kind === 'woodBridge')).toBe(false);
      const forest = generateOverland({ ...RIBBON, themeKey: 'forest', seed, river: true });
      expect(forest.stats.river).toBe(0);
    }
  });
});
