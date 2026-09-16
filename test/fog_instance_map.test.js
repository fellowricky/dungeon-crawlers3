/* ───────────────── Fog ↔ renderer instance mapping ─────────────────
 * The fog dims, sinks and reveals terrain by instance INDEX. Its map from grid
 * cell to index used to be re-derived from the grid — a hand-maintained
 * duplicate of buildScene's emission order, carrying the assumption that each
 * FLOOR cell produces exactly one instance.
 *
 * Staircases broke that: each emits STAIR_N treads. From the first stair
 * onward every index was off by a growing amount, so entering a room dimmed
 * and lit tiles scattered elsewhere on the map. Measured before the fix: 4636
 * of 4726 mapped cells pointed at the wrong instance.
 *
 * The map now comes from the renderer, recorded as the instances are emitted.
 * This test is what keeps the two honest: it builds a real scene and checks
 * every index against where the instance actually stands.
 */
import { describe, it, expect } from 'vitest';
import { generateDungeon, THEME_KEYS, FLOOR, WALL } from '../src/dungeon/dungeon_generator.js';
import { buildFogMaps } from '../src/game/fog.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({
    font: '', measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8Array(4) }),
    createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} })
  }, { get(t, p) { return p in t ? t[p] : () => {}; } });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [],
    body: dummyEl, documentElement: dummyEl
  };
}

const SEEDS = [1000, 8919];

describe('Fog instance maps point at the right instances', () => {
  it('maps every cell onto instances that actually stand over it', async () => {
    const sc = await import('../src/render/dungeon_scene.js');
    const failures = [];

    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        const d = generateDungeon(seed, { seed, roomCount: 20, themeKey });
        sc.buildScene(d);
        sc.settleAll();

        const { floorInst, floorInstN, wallInst } =
          buildFogMaps(d, { start: sc.floorCellStart, count: sc.floorCellCount });
        const { W, H } = d;
        /* Where cell c sits in world space — buildScene's wx/wz. */
        const ex = (c) => (c % W) - W / 2 + 0.5;
        const ez = (c) => ((c / W) | 0) - H / 2 + 0.5;

        const check = (mesh, map, counts, label) => {
          if (!mesh) return;
          const a = mesh.instanceMatrix.array;
          for (let c = 0; c < W * H && failures.length < 8; c++) {
            const i0 = map[c];
            if (i0 < 0) continue;
            const n = counts ? (counts[c] || 1) : 1;
            for (let k = 0; k < n; k++) {
              const i = i0 + k;
              if (i >= mesh.count) {
                failures.push(`${themeKey}/${seed}: ${label} cell ${c % W},${(c / W) | 0} → `
                  + `instance ${i} of only ${mesh.count}`);
                break;
              }
              /* A stair tread is a full-size tile slid along its run, so it
                 straddles the cell edge: the furthest sits 2/3 of a tile out.
                 Allow that and no more — a full tile off is a mismatch, and a
                 misindexed instance lands far further away than this. */
              const dx = a[i * 16 + 12] - ex(c), dz = a[i * 16 + 14] - ez(c);
              if (Math.hypot(dx, dz) > 0.7) {
                failures.push(`${themeKey}/${seed}: ${label} cell ${c % W},${(c / W) | 0} → `
                  + `instance ${i} standing at ${a[i * 16 + 12].toFixed(1)},`
                  + `${a[i * 16 + 14].toFixed(1)} instead of ${ex(c)},${ez(c)}`);
                break;
              }
            }
          }
        };

        check(sc.meshes.floor, floorInst, floorInstN, 'floor');
        check(sc.meshes.wall, wallInst, null, 'wall');
      }
    }

    expect(failures.slice(0, 8), `${failures.length} misdirected cell(s)`).toEqual([]);
  }, 120000);

  it('claims each floor instance for exactly one cell', async () => {
    /* Overlap would mean two cells fight over one tile's brightness; a gap
       means terrain the fog can never touch, which is how a lake bed stayed
       lit inside unexplored dark. */
    const sc = await import('../src/render/dungeon_scene.js');
    for (const themeKey of THEME_KEYS) {
      const d = generateDungeon(1000, { seed: 1000, roomCount: 20, themeKey });
      sc.buildScene(d);
      sc.settleAll();
      const { floorInst, floorInstN } =
        buildFogMaps(d, { start: sc.floorCellStart, count: sc.floorCellCount });

      const owner = new Int32Array(sc.meshes.floor.count).fill(-1);
      for (let c = 0; c < d.W * d.H; c++) {
        const i0 = floorInst[c];
        if (i0 < 0) continue;
        for (let k = 0; k < (floorInstN[c] || 1); k++) {
          expect(owner[i0 + k], `${themeKey}: instance ${i0 + k} claimed twice`).toBe(-1);
          owner[i0 + k] = c;
        }
      }
      const orphans = owner.reduce((n, v) => n + (v < 0 ? 1 : 0), 0);
      expect(orphans, `${themeKey}: ${orphans} floor instances the fog cannot reach`).toBe(0);
    }
  }, 120000);
});
