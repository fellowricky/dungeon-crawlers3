/**
 * The Moor thins its tree belt to copses, which left the blocked ground round
 * the map looking bare and unfinished (Zenu, 2026-11-07). oc.edgeScatter dresses
 * it with the map's own grass and scrub. Those cells are never walkable, so the
 * things that matter are that it stays on them, covers them, and leaves the
 * playable map exactly as it generated before.
 */
import { describe, it, expect } from 'vitest';
import { generateOverland, THEMES, FLOOR, POOL } from '../src/dungeon/dungeon_generator.js';

const RIBBON = { themeKey: 'moor', level: 5, mapW: 50, mapH: 300, zones: 9, layout: 'ribbon' };
const WALL_KINDS = new Set(['swampgrass', 'swampgrass2', 'swampgrass3', 'bush', 'debris']);
const cell = (d, p) => Math.round(p.y) * d.W + Math.round(p.x);
const isEdgeProp = (d, p) => p.roomId === undefined && WALL_KINDS.has(p.kind) && d.grid[cell(d, p)] !== FLOOR && d.grid[cell(d, p)] !== POOL;

describe('Moor edge scatter', () => {
  it('covers most of the blocked ground near the playable map', () => {
    for (const seed of [3, 11, 29]) {
      const d = generateOverland({ ...RIBBON, seed });
      const dressed = new Set(d.props.filter(p => isEdgeProp(d, p)).map(p => cell(d, p)));
      let front = 0, covered = 0;
      for (let y = 1; y < d.H - 1; y++) for (let x = 1; x < d.W - 1; x++) {
        const c = y * d.W + x;
        if (d.grid[c] === FLOOR || d.grid[c] === POOL || (d.thicketMask && d.thicketMask[c])) continue;
        if (d.grid[c - 1] !== FLOOR && d.grid[c + 1] !== FLOOR && d.grid[c - d.W] !== FLOOR && d.grid[c + d.W] !== FLOOR) continue;
        front++;
        if (dressed.has(c)) covered++;
      }
      expect(front, `seed ${seed}`).toBeGreaterThan(200);
      expect(covered / front, `seed ${seed} front row cover`).toBeGreaterThan(0.6);
    }
  });

  it('puts only the scatter it should on blocked cells, and few bushes', () => {
    const d = generateOverland({ ...RIBBON, seed: 7 });
    const edge = d.props.filter(p => isEdgeProp(d, p));
    expect(edge.length).toBeGreaterThan(500);
    const bushes = edge.filter(p => p.kind === 'bush').length;
    /* a bush is a 9k-triangle model; the grass does the covering */
    expect(bushes).toBeLessThan(220);
    expect(edge.filter(p => p.kind.startsWith('swampgrass')).length).toBeGreaterThan(bushes * 5);
  });

  it('leaves the playable map exactly as it generates without it', () => {
    const oc = THEMES.moor.oc, saved = oc.edgeScatter;
    for (const seed of [3, 42]) {
      const withIt = generateOverland({ ...RIBBON, seed });
      oc.edgeScatter = undefined;
      const without = generateOverland({ ...RIBBON, seed });
      oc.edgeScatter = saved;
      expect(Array.from(withIt.grid)).toEqual(Array.from(without.grid));
      expect(Array.from(withIt.height)).toEqual(Array.from(without.height));
      /* every prop from before is still there, in order, untouched */
      const kept = withIt.props.slice(0, without.props.length);
      expect(kept).toEqual(without.props);
      expect(withIt.props.length).toBeGreaterThan(without.props.length);
      for (const p of withIt.props.slice(without.props.length)) {
        const g = withIt.grid[cell(withIt, p)];
        expect(g === FLOOR || g === POOL, `${p.kind} at ${p.x},${p.y}`).toBe(false);
      }
    }
  });

  it('is deterministic, and stays out of themes that did not ask for it', () => {
    const a = generateOverland({ ...RIBBON, seed: 5 }), b = generateOverland({ ...RIBBON, seed: 5 });
    expect(a.props).toEqual(b.props);
    expect(THEMES.forest.oc.edgeScatter).toBeUndefined();
    expect(THEMES.mire.oc.edgeScatter).toBeUndefined();
  });
});
