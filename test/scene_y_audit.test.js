/* ─────────────────────── Scene-wide Y audit ───────────────────────────────
 * Terrain elevation broke the same assumption in five separate places before
 * this test existed: props, walls, pools, lakes and boss rocks were each
 * positioned at a hardcoded y = 0, which is correct only while the floor is
 * flat. Every one was found the same way — Zenu spotted it in a screenshot,
 * one geometry type at a time.
 *
 * So rather than assert about any particular mesh, this walks the ENTIRE built
 * scene: every object and every instance of every InstancedMesh. It maps each
 * one back to the grid cell it stands over and checks it is not buried below
 * that cell's surface. Anything anchored to y = 0 over a raised tier fails by
 * construction, including geometry nobody has thought of yet.
 *
 * It runs in vitest (not the Electron smoke test) because buildScene only
 * needs THREE's CPU-side scene graph — no GL context — as camera_spawn_snap
 * already demonstrates.
 */
import { describe, it, expect } from 'vitest';
import { generateDungeon, THEME_KEYS, FLOOR, POOL } from '../src/dungeon/dungeon_generator.js';
import { STEP } from '../src/dungeon/elevation.js';

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

/* How far below its cell's surface an object may sit before it counts as
   buried. Generous enough for deliberate sub-surface art (liquid surfaces sit
   0.08-0.12 down, floor slabs chamfer) and far tighter than one STEP (0.45),
   which is the smallest error the bug class can produce. */
const BURY_TOL = 0.25;

const SEEDS = [8919, 1000, 42, 771204];

describe('Scene Y audit — nothing is buried by the terrain', () => {
  it('places every scene object at or above the surface of the cell it stands on', async () => {
    const sc = await import('../src/render/dungeon_scene.js');
    const failures = [];

    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        let d;
        try { d = generateDungeon(seed, { seed, roomCount: 16, themeKey }); }
        catch { continue; }
        sc.buildScene(d);
        sc.settleAll();

        const { W, H, grid, height, ramp, lakeMask } = d;
        const cellOf = (x, z) => {
          const cx = Math.round(x + W / 2 - 0.5), cz = Math.round(z + H / 2 - 0.5);
          return (cx < 0 || cz < 0 || cx >= W || cz >= H) ? -1 : cz * W + cx;
        };

        /* Exemptions, each for a stated structural reason — NOT because the
           object happened to fail. */
        const exempt = new Set([
          /* Walls and their caps are the one thing that legitimately spans
             from below the lowest floor up past every tier. */
          sc.meshes.wall, sc.meshes.wallCap
        ].filter(Boolean));
        /* Liquid meshes bake world coordinates into their vertices and sit at
           the origin, so object-position mapping is meaningless for them. They
           get a dedicated vertex-level check below, plus the containment test
           in elevation.test.js. */
        const liquids = new Set(sc.fx.liquids);

        const label = new Map();
        for (const [k, mesh] of Object.entries(sc.meshes)) if (mesh) label.set(mesh, k);

        /* A podium altar is drawn a full STEP under its cell ON PURPOSE: the
           elevation pass raised the tile so the party can climb onto the altar,
           and the slab is squashed and sunk so its TOP face is the tier
           surface. Buried by this audit's measure, correct on screen. */
        const podiumCells = new Set();
        for (const pr of (d.props || [])) {
          if (!pr || !pr.podium) continue;
          const px = Math.round(pr.x), py = Math.round(pr.y);
          if (px >= 0 && py >= 0 && px < W && py < H) podiumCells.add(py * W + px);
        }

        const flag = (what, dy, cellH) => {
          failures.push(`${themeKey}/${seed}: ${what} sits ${(-dy).toFixed(2)} below `
            + `its cell surface (cell level ${cellH})`);
        };

        sc.group.traverse((o) => {
          if (exempt.has(o) || liquids.has(o)) return;
          const name = label.get(o) || o.type;
          if (o.isInstancedMesh) {
            const a = o.instanceMatrix.array;
            for (let i = 0; i < o.count; i++) {
              const off = i * 16;
              const c = cellOf(a[off + 12], a[off + 14]);
              /* POOL counts. Restricting this to FLOOR is what let the pool
                 basin and rim skirt keep their hardcoded y=0 through an
                 earlier pass of this very audit — pool cells are not FLOOR, so
                 every instance standing on one was skipped silently. */
              if (c < 0 || !(grid[c] === FLOOR || grid[c] === POOL)) continue;
              if (o === sc.meshes.floor) {
                /* Two floor instances legitimately sit below their own cell:
                   a descending staircase's treads (that is what a stair is),
                   and a lake bed (drawn one step under the waterline). */
                if (ramp[c]) continue;
                if (lakeMask && lakeMask[c]) continue;
              }
              if (o === sc.meshes.altarTable && podiumCells.has(c)) continue;
              const dy = a[off + 13] - height[c] * STEP;
              if (dy < -BURY_TOL) { flag(`${name}[${i}]`, dy, height[c]); return; }
            }
          } else if ((o.isMesh || o.isGroup) && o.parent === sc.group) {
            const c = cellOf(o.position.x, o.position.z);
            if (c < 0 || !(grid[c] === FLOOR || grid[c] === POOL)) return;
            const dy = o.position.y - height[c] * STEP;
            if (dy < -BURY_TOL) flag(name, dy, height[c]);
          }
        });

        /* Liquids, at vertex level: sample each quad's centre rather than a
           corner, since corners land in the neighbouring cell. */
        for (const mesh of sc.fx.liquids) {
          const pos = mesh.geometry.getAttribute('position');
          for (let v = 0; v + 5 < pos.count; v += 6) {
            let sx = 0, sz = 0;
            for (let k = 0; k < 6; k++) { sx += pos.getX(v + k); sz += pos.getZ(v + k); }
            const c = cellOf(sx / 6, sz / 6);
            if (c < 0) continue;
            const dy = pos.getY(v) - height[c] * STEP;
            if (dy < -BURY_TOL) { flag('liquid surface', dy, height[c]); break; }
          }
        }
      }
    }

    expect(failures.slice(0, 12), `${failures.length} buried object(s)`).toEqual([]);
  }, 120000);

  it('leaves no daylight under a ledge — every block reaches its lower neighbour', async () => {
    /* The counterpart to the burial check, and the one that has cycled twice.
       A raised tile has to extend far enough DOWN that its side face meets the
       block beside it, or you see through the terrain at the ledge.
       First attempt consulted only the four CARDINAL neighbours, so convex
       corners and platform interiors had nothing lower to react to and floated.
       The fix — sink every block to the level's global floor — closed the gaps
       but stretched the side textures up to 11x, because side UVs are
       normalised over the geometry's own 0.22 height. This is the third
       position: reach the lowest of the EIGHT neighbours plus a slab of
       overlap, which closes the gaps with the shallowest possible column. */
    const sc = await import('../src/render/dungeon_scene.js');
    const geo = await import('../src/render/dungeon_geo.js');
    const g = geo.GEO.floor;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const failures = [];

    for (const themeKey of THEME_KEYS) {
      for (const seed of SEEDS) {
        let d;
        try { d = generateDungeon(seed, { seed, roomCount: 16, themeKey }); }
        catch { continue; }
        sc.buildScene(d);
        sc.settleAll();

        const { W, H, grid, ramp } = d;
        const wx = (x) => x - W / 2 + 0.5, wz = (y) => y - H / 2 + 0.5;
        const mesh = sc.meshes.floor, a = mesh.instanceMatrix.array;
        /* A cell may emit several instances (stair treads); take the whole
           vertical extent it occupies. */
        const top = new Map(), bot = new Map();
        for (let i = 0; i < mesh.count; i++) {
          const o = i * 16;
          const k = Math.hypot(a[o + 4], a[o + 5], a[o + 6]);
          const key = Math.round(a[o + 12]) + ',' + Math.round(a[o + 14]);
          const t = a[o + 13] + bb.max.y * k, b = a[o + 13] + bb.min.y * k;
          if (!top.has(key) || t > top.get(key)) top.set(key, t);
          if (!bot.has(key) || b < bot.get(key)) bot.set(key, b);
        }

        for (let y = 0; y < H && failures.length < 12; y++) {
          for (let x = 0; x < W && failures.length < 12; x++) {
            const c = y * W + x;
            if (grid[c] !== FLOOR || ramp[c]) continue;
            const k1 = Math.round(wx(x)) + ',' + Math.round(wz(y));
            if (!bot.has(k1)) continue;
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (grid[ny * W + nx] !== FLOOR) continue;
              const k2 = Math.round(wx(nx)) + ',' + Math.round(wz(ny));
              if (!top.has(k2)) continue;
              if (top.get(k2) >= top.get(k1)) continue;   // neighbour is not lower
              const shortfall = bot.get(k1) - top.get(k2);
              if (shortfall > 0.001) {
                failures.push(`${themeKey}/${seed}: tile ${x},${y} stops `
                  + `${shortfall.toFixed(3)} above its lower neighbour ${nx},${ny}`);
              }
            }
          }
        }
      }
    }

    expect(failures.slice(0, 12), `${failures.length} ledge gap(s)`).toEqual([]);
  }, 120000);
});
