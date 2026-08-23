/**
 * GUILD COMPOUND GROUND — autotiled grass/dirt terrain baked to one texture.
 *
 * Source tiles are the DCSS `dirt_*` floor set (see CREDITS.md). Measured, the
 * set works like this:
 *
 *   dirt_full          solid GRASS
 *   dirt_0 / _1 / _2   solid DIRT, three variants
 *   dirt_<dir>         a GRASS tile with dirt bleeding in from <dir>
 *   dirt_<dir><dir>    a GRASS tile with dirt on TWO ADJACENT edges
 *
 * So the name says where the dirt is, and the tile itself is the grass side of
 * the seam. That makes it a standard 8-way fringe set: every dirt cell draws a
 * dirt variant, and every grass cell picks its tile from which of its four
 * orthogonal neighbours are dirt.
 *
 * The whole terrain bakes into ONE canvas texture rather than thousands of
 * quads: one draw call, and at the compound's default zoom a 32px tile lands
 * almost exactly on 32 screen pixels, so the pixel art reads at native scale.
 */
import * as THREE from 'three';
import { COMPOUND, STRUCTURES } from '../game/guild_layout.js';

export const TILE_PX = 32;
const TILE_ROOT = './art/ground/';

const GRASS = 0, DIRT = 1;

/* Every tile ships a `_old` twin: same palette, different noise. They are free
   extra variants and the single biggest weapon against visible tiling. */
const BASE_NAMES = [
  'dirt_full', 'dirt_0', 'dirt_1', 'dirt_2',
  'dirt_north', 'dirt_south', 'dirt_east', 'dirt_west',
  'dirt_northeast', 'dirt_northwest', 'dirt_southeast', 'dirt_southwest'
];
const TILE_NAMES = BASE_NAMES.flatMap(n => [n, `${n}_old`]);

/** Solid-grass pool. */
const GRASS_POOL = ['dirt_full', 'dirt_full_old'];
/** Solid-dirt pool. */
const DIRT_POOL = ['dirt_0', 'dirt_1', 'dirt_2', 'dirt_0_old', 'dirt_1_old', 'dirt_2_old'];

let images = null;
let loadPromise = null;

/** Load the tile set once. Safe to call repeatedly. */
export function preloadGroundTiles() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all(TILE_NAMES.map(name => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve([name, img]);
    img.onerror = () => { console.warn(`guild ground: missing tile ${name}`); resolve([name, null]); };
    img.src = `${TILE_ROOT}${name}.png`;
  }))).then(pairs => {
    images = Object.fromEntries(pairs);
    return images;
  });
  return loadPromise;
}

/* ---------------- terrain mask ----------------
   The road network is DERIVED from the layout rather than hand-painted, so
   moving a building in guild_layout.js re-routes its path automatically. */

/* Road widths are the single knob controlling how green the compound reads.
   They look narrower on paper than they play: the camera pitch foreshortens
   depth by sin(0.62) ~= 0.58, and the buildings stand ON the grass bands, so
   the ground actually visible between them is disproportionately street. */

/** East-west streets, sitting in the gaps between the three building rows. */
/* One cross street just south of each row of doors, so every building's spur
   is short and the streets read as serving the row rather than cutting
   through it. Rows sit at z = -24, -6 and 16 (guild_layout.js). */
const STREETS_Z = [-16, 2, 24];
const MAIN_ROAD_W = 5.0;
const STREET_W = 3.0;
const SPUR_W = 2.2;

class Mask {
  constructor(W, D) {
    this.W = W; this.D = D;
    this.cols = Math.round(W);
    this.rows = Math.round(D);
    this.cells = new Uint8Array(this.cols * this.rows);   // GRASS by default
  }
  /** World (x,z) → tile indices. Column 0 is the west edge, row 0 the north. */
  col(x) { return Math.floor(x + this.W / 2); }
  row(z) { return Math.floor(z + this.D / 2); }
  at(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return GRASS;
    return this.cells[r * this.cols + c];
  }
  set(c, r, v) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    this.cells[r * this.cols + c] = v;
  }

  /** Filled circle in world units. */
  disc(cx, cz, radius) {
    const r2 = radius * radius;
    for (let z = cz - radius; z <= cz + radius; z += 0.5) {
      for (let x = cx - radius; x <= cx + radius; x += 0.5) {
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz <= r2) this.set(this.col(x), this.row(z), DIRT);
      }
    }
  }

  /** Axis-aligned rectangle in world units, centred on (cx,cz). */
  rect(cx, cz, w, d) {
    for (let z = cz - d / 2; z <= cz + d / 2; z += 0.5) {
      for (let x = cx - w / 2; x <= cx + w / 2; x += 0.5) {
        this.set(this.col(x), this.row(z), DIRT);
      }
    }
  }

  /** Thick straight run between two world points (axis-aligned or diagonal). */
  road(x0, z0, x1, z1, width) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.rect(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, width, width);
    }
  }
}

/**
 * Paint the compound's terrain: plaza, gate road, cross streets, and a spur
 * from every built structure's door to the nearest street.
 */
function paintTerrain(mask, levels) {
  const hd = COMPOUND.halfD, hw = COMPOUND.halfW;

  /* Gate road: in through the south wall, north across the plaza, ending at
     the tavern door. The tavern now sits dead centre at the head of the road —
     it is the hub of the game's mechanics, so it gets the focal position and
     the vista from the gate. */
  mask.road(0, hd + 6, 0, 6, MAIN_ROAD_W);

  /* Cross streets. Stop short of the wall so the verge stays green. */
  for (const z of STREETS_Z) mask.road(-hw + 3, z, hw - 3, z, STREET_W);

  /* Plaza. Painted after the roads so it reads as the widening they open into. */
  mask.disc(COMPOUND.plaza.x, COMPOUND.plaza.z, COMPOUND.plaza.radius - 1.5);

  for (const s of STRUCTURES) {
    const built = s.alwaysBuilt || (levels[s.id] ?? 0) > 0;
    if (!built) continue;

    /* A stoop of worn earth at the door only.
       An apron around the whole footprint was the first attempt and it was
       badly wrong: at 8-11 units wide per building, fourteen aprons merged with
       the streets into one continuous dirt field with almost no grass left. The
       grass has to stay dominant for the road network to read as roads. */
    const doorZ = s.z + s.d / 2;
    mask.rect(s.x, doorZ + 0.8, Math.min(5, s.w * 0.5), 2.2);

    /* Spur from the door to whichever street is nearest. */
    let best = STREETS_Z[0];
    for (const z of STREETS_Z) if (Math.abs(z - doorZ) < Math.abs(best - doorZ)) best = z;
    mask.road(s.x, doorZ, s.x, best, SPUR_W);
  }

  /* The training yard is bare earth end to end, not grass with a path. */
  const yard = STRUCTURES.find(s => s.id === 'training_grounds');
  if (yard && ((levels[yard.id] ?? 0) > 0)) mask.rect(yard.x, yard.z, yard.w, yard.d);
}

/* ---------------- autotiling ---------------- */

/** Stable spatial hash — a rebuild must not reshuffle the yard. */
function hash(c, r, salt = 0) {
  return Math.abs((c * 73856093) ^ (r * 19349663) ^ (salt * 83492791));
}

/**
 * Draw one tile, optionally reoriented.
 *
 * `orient` bit 0 mirrors horizontally; bits 1-2 are quarter turns.
 *
 * Reorienting is what kills the tile grid, but it can only be applied to
 * textures with no inherent direction:
 *
 *  - DIRT is isotropic noise, so all 8 orientations are safe.
 *  - GRASS is NOT. Its blades run vertically, and rotating them 90° produces a
 *    very obvious pinwheel quilt (tested — it looked far worse than plain
 *    repetition). Grass gets the horizontal mirror only. A vertical flip was
 *    also tried and introduced a diamond lattice, so it is deliberately unused.
 *  - FRINGE tiles encode which edge the dirt is on, so they are never touched.
 */
function drawTile(ctx, img, x, y, orient) {
  if (!orient) { ctx.drawImage(img, x, y, TILE_PX, TILE_PX); return; }
  const h = TILE_PX / 2;
  ctx.save();
  ctx.translate(x + h, y + h);
  const quarters = (orient >> 1) & 3;
  if (quarters) ctx.rotate(quarters * Math.PI / 2);
  if (orient & 1) ctx.scale(-1, 1);
  ctx.drawImage(img, -h, -h, TILE_PX, TILE_PX);
  ctx.restore();
}

/** Deterministic RNG so the mottle pattern is stable across rebuilds. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Large-scale brightness variation laid over the finished terrain.
 *
 * Per-tile variants and mirroring break up detail at tile frequency, but a big
 * field of grass still reads as flat and uniform. This adds variation at ~6
 * tiles per cycle — far coarser than the tile grid, so the eye reads it as
 * ground unevenness rather than as texture, and stops locking onto the repeat.
 */
function applyMottle(ctx, w, h, seed = 1337) {
  const CELL = 6 * TILE_PX;
  const nw = Math.ceil(w / CELL) + 1, nh = Math.ceil(h / CELL) + 1;
  const noise = document.createElement('canvas');
  noise.width = nw; noise.height = nh;
  const nctx = noise.getContext('2d');
  const img = nctx.createImageData(nw, nh);
  const rnd = mulberry32(seed);
  for (let i = 0; i < nw * nh; i++) {
    /* Centred on mid-grey: 'overlay' leaves 128 untouched, so the mottle
       brightens and darkens without shifting overall exposure. */
    const v = 128 + Math.round((rnd() - 0.5) * 96);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;      // upscale the noise smoothly
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.5;
  ctx.drawImage(noise, 0, 0, w, h);
  ctx.restore();
}

/**
 * Pick the tile for one cell.
 *
 * Dirt cells are solid. Grass cells look at their four orthogonal neighbours:
 * two adjacent dirt edges select a corner tile, one selects an edge tile, none
 * leaves plain grass. Three-or-more-sided cases fall through to a corner, which
 * is close enough — a road drawn this way never produces them.
 */
function tileFor(mask, c, r) {
  if (mask.at(c, r) === DIRT) {
    return { name: DIRT_POOL[hash(c, r, 1) % DIRT_POOL.length], orient: hash(c, r, 3) % 8 };
  }

  const n = mask.at(c, r - 1) === DIRT;   // row 0 is north
  const s = mask.at(c, r + 1) === DIRT;
  const w = mask.at(c - 1, r) === DIRT;
  const e = mask.at(c + 1, r) === DIRT;

  let fringe = null;
  if (n && e) fringe = 'dirt_northeast';
  else if (n && w) fringe = 'dirt_northwest';
  else if (s && e) fringe = 'dirt_southeast';
  else if (s && w) fringe = 'dirt_southwest';
  else if (n) fringe = 'dirt_north';
  else if (s) fringe = 'dirt_south';
  else if (e) fringe = 'dirt_east';
  else if (w) fringe = 'dirt_west';

  if (fringe) {
    /* Fringe tiles must keep their orientation, but the `_old` twin is the same
       seam with different noise, so alternating between them is free variety. */
    const alt = hash(c, r, 5) & 1;
    return { name: alt ? `${fringe}_old` : fringe, orient: 0 };
  }

  return {
    name: GRASS_POOL[hash(c, r, 2) % GRASS_POOL.length],
    orient: hash(c, r, 4) & 1            // horizontal mirror only — see drawTile
  };
}

/* ---------------- bake ---------------- */

/**
 * Bake the compound terrain into a THREE.CanvasTexture.
 * Resolves only once the tile images are in — callers should assign the result
 * to an existing material and flag it for update.
 *
 * @param {number} W  ground plane width in world units (= tiles)
 * @param {number} D  ground plane depth in world units (= tiles)
 * @param {object} levels  facility levels, so unbuilt lots get no yard
 * @param {number} anisotropy
 */
export async function bakeGroundTexture(W, D, levels, anisotropy = 1) {
  await preloadGroundTiles();

  const mask = new Mask(W, D);
  paintTerrain(mask, levels || {});

  const canvas = document.createElement('canvas');
  canvas.width = mask.cols * TILE_PX;
  canvas.height = mask.rows * TILE_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < mask.rows; r++) {
    for (let c = 0; c < mask.cols; c++) {
      const pick = tileFor(mask, c, r);
      const img = images[pick.name] || images[pick.name.replace('_old', '')];
      if (img) drawTile(ctx, img, c * TILE_PX, r * TILE_PX, pick.orient);
    }
  }

  applyMottle(ctx, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  /* Crisp when magnified (that is the whole point of pixel art), but mipmapped
     when minified — the ground recedes to the horizon and unfiltered minification
     would crawl and shimmer as the camera pans. */
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
