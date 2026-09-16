/**
 * GUILD COMPOUND — scene builder for the between-runs hub.
 *
 * Shares the dungeon renderer wholesale: the same WebGLRenderer, the same
 * THREE.Scene, the same orthographic three-quarter camera, the same lighting
 * rig, the same texture kit, and the same billboarded LPC hero sprites. Art
 * style continuity is therefore structural rather than something we maintain by
 * hand — see GUILD_HALL_PLAN.md §3.
 *
 * What it does NOT share is buildScene(), which wants a fully generated dungeon
 * (grid, bfs, roomId, corridors, lakeMask, fog-of-war reveal, ceiling caps).
 * The compound is authored content, so it composes its own scene graph instead.
 *
 * PHASE 0: every structure is procedural placeholder geometry. Buildings are
 * chamfered boxes with real roofs, doors and silhouette variety — enough to
 * judge scale, framing and click ergonomics, but no GLB art yet. Swapping a
 * placeholder for a modelled building later means registering a prop and
 * pointing the layout's `tiers` array at it; nothing else here changes.
 */
import * as THREE from 'three';
import {
  scene, cam, camTarget, updateCam, renderer, applyThemeEnv, disposeLevel,
  setYawPitch, yaw, pitch, hemi, dirL, registerProp, maxAniso
} from './dungeon_scene.js';
import { THEMES } from '../dungeon/dungeon_generator.js';
import { TEX, matWall, matWallCap, applyTileTheme } from './dungeon_materials.js';
import { chamferBox, boxUV, xg, mergeGeos } from './dungeon_geo.js';
import { HeroSprite } from '../game/sprite_animator.js';
import { STRUCTURES, STRUCTURE_BY_ID, COMPOUND, CAM, OUTSKIRTS, INFRA_TIERS,
         tierOf, infraTierOf, rotationOf, heroSlotWorld } from '../game/guild_layout.js';
import { bakeGroundTexture, preloadGroundTiles } from './guild_ground.js';

/* ---------------- module state ---------------- */

let root = null;                 // THREE.Group holding the whole compound
let structureNodes = {};         // id -> { group, hitbox, mats, glowLights, tier, topY }
let heroes = [];                 // { sprite, slot, structureId }
let torches = [];                // { light, base, phase }
let ownedGeos = [];
let ownedMats = [];
let ownedTextures = [];
let hoverId = null;
let levels = {};                 // id -> facility level, as last built
let buildToken = 0;              // invalidates in-flight async work on rebuild
let spritePending = [];          // sprites still waiting on their image to load

/* ---------------- layout editing ----------------
   Nudges are keyed per BUILDING AND LEVEL (`id@level`), not per building.
   Each level of a hand-authored set is drawn with its own framing and ground
   line, so lvl3 routinely needs a different offset from lvl10 — a single
   per-building transform would drag every level along with it.

   The baseline for a level comes from its manifest tier entry (dx/dz/scale);
   editor nudges layer on top and are saved back into that entry. */
let transforms = {};             // "id@level" -> { dx, dz, scale }
let camLock = null;              // pins camTarget while dragging a building

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v3 = new THREE.Vector3();

/* ---------------- material kit ----------------
   Colours are lifted from the HOLDFAST overland theme (dungeon_generator.js) so
   the compound reads as the same world as the overland prologue: worked ground,
   ochre roads, red-brown cloth. Every material is cloned per structure so hover
   highlighting can touch emissive without bleeding across buildings. */

const RECIPES = {
  plaster:   { map: 'stone', color: 0xd7c2a4, roughness: 0.92, metalness: 0.02 },
  stone:     { map: 'stone', color: 0x9c9384, roughness: 0.94, metalness: 0.02 },
  darkstone: { map: 'stone', color: 0x6b6559, roughness: 0.95, metalness: 0.03 },
  timber:    { map: 'wood',  color: 0x6d4a31, roughness: 0.86, metalness: 0.03 },
  roofTile:  { map: 'stone', color: 0xa8503c, roughness: 0.88, metalness: 0.02 },
  roofSlate: { map: 'stone', color: 0x4e4c58, roughness: 0.90, metalness: 0.05 },
  thatch:    { map: 'wood',  color: 0xb09455, roughness: 0.96, metalness: 0.00 },
  metal:     { map: 'metal', color: 0x8d8d96, roughness: 0.40, metalness: 0.80 },
  gold:      { map: 'metal', color: 0xd9a441, roughness: 0.30, metalness: 0.85 },
  cloth:     { map: null,    color: 0x8e2b24, roughness: 0.92, metalness: 0.00, side: THREE.DoubleSide },
  ground:    { map: 'stone', color: 0x6f7a4e, roughness: 0.96, metalness: 0.00 },
  road:      { map: 'stone', color: 0xa08d63, roughness: 0.95, metalness: 0.00 },
  dirt:      { map: 'stone', color: 0x7d6a4c, roughness: 0.97, metalness: 0.00 }
};

function mat(key, extra = {}) {
  const r = RECIPES[key] || RECIPES.stone;
  const m = new THREE.MeshStandardMaterial({
    map: r.map ? TEX[r.map] : null,
    color: r.color,
    roughness: r.roughness,
    metalness: r.metalness,
    ...(r.side ? { side: r.side } : {}),
    ...extra
  });
  ownedMats.push(m);
  return m;
}

/** Emissive material for lit windows, forge glow, rune light. */
function glowMat(color, intensity = 1.0) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity,
    roughness: 1, metalness: 0
  });
  m.toneMapped = false;
  ownedMats.push(m);
  return m;
}

/** A tiled copy of a base texture — the ground needs far more repeats than the
 *  shared dungeon texture is configured for, and mutating TEX in place would
 *  corrupt the dungeon's own materials. */
function tiled(texKey, repeat) {
  const t = TEX[texKey].clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  ownedTextures.push(t);
  return t;
}

function geo(g) { ownedGeos.push(g); return g; }

/* ---------------- geometry helpers ---------------- */

/** Gable roof: a triangular prism whose ridge runs front-to-back (along z), so
 *  the gable end faces the plaza the way the reference art does. */
function gableGeo(w, d, rise, overhang = 0.4) {
  const W = w + overhang * 2, D = d + overhang * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false });
  g.translate(0, 0, -D / 2);
  /* ExtrudeGeometry emits UVs in raw model units, so a 9-unit-wide roof samples
     the texture across 9 tiles' worth of UV space and smears it into big soft
     blotches. Re-project box-style, the same way every dungeon mesh does. */
  return geo(boxUV(g));
}

function box(w, h, d, chamfer = 0.06) {
  return geo(boxUV(chamferBox(w, h, d, chamfer)));
}

/* ---------------- masonry from unit cubes ----------------
   matWall/matWallCap are atlas materials: atlasPatch rewrites the shader to
   `vMapUv = vMapUv*0.5 + aUvO`, so they expect geometry with 0-1 UVs plus a
   per-cube attribute picking one quadrant of a 2x2 atlas. Dungeon walls satisfy
   that by being instanced 1x1x1 cubes.

   Stretching one 0-1 UV span across a 72-unit wall — which is what a single
   long box does — gives one texture repeat over the whole run, while a 2.6-unit
   tower gets a repeat over 2.6 units. That is the mismatched, smeared masonry:
   texel density varying by more than 20x across the same wall.

   So the compound builds masonry the same way the dungeon does: a grid of unit
   cubes, each with its own atlas quadrant, merged into one geometry for a
   single draw call. */

const ATLAS_QUADS = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];

function atlasCubes(cubes, seed = 1) {
  const base = boxUV(chamferBox(1, 1, 1, 0.06));
  const parts = [];
  const quads = [];
  let h = seed >>> 0;
  for (const c of cubes) {
    const g = xg(base, c.x, c.y, c.z, 0, 0, 0, c.sx ?? 1, c.sy ?? 1, c.sz ?? 1);
    parts.push(g);
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    quads.push(ATLAS_QUADS[h % 4]);
  }
  const merged = mergeGeos(parts);

  /* aUvO must be per-vertex, and mergeGeos concatenates in order, so walk the
     source counts to fill the right span for each cube. */
  const total = merged.attributes.position.count;
  const arr = new Float32Array(total * 2);
  let o = 0;
  parts.forEach((g, i) => {
    const n = g.attributes.position.count;
    const [u, v] = quads[i];
    for (let k = 0; k < n; k++) { arr[(o + k) * 2] = u; arr[(o + k) * 2 + 1] = v; }
    o += n;
  });
  merged.setAttribute('aUvO', new THREE.BufferAttribute(arr, 2));
  return geo(merged);
}

/** A straight run of masonry: unit cubes, stacked to the requested height. */
function wallRunCubes(cx, cz, len, along, h) {
  const cubes = [];
  const n = Math.max(1, Math.round(len));
  const layers = Math.max(1, Math.round(h));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const x = along === 'x' ? cx + t * len : cx;
    const z = along === 'x' ? cz : cz + t * len;
    for (let l = 0; l < layers; l++) cubes.push({ x, y: l + 0.5, z });
  }
  return cubes;
}

function addMesh(parent, geometry, material, x, y, z, rot = null) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Door recess on the front (+z) face. */
function addDoor(g, w, d, h, doorMat) {
  const dw = Math.min(1.6, w * 0.28), dh = Math.min(2.2, h * 0.72);
  addMesh(g, box(dw, dh, 0.22, 0.03), doorMat, 0, dh / 2, d / 2 + 0.02);
}

/** Row of windows along the front face, lit at higher tiers. */
function addWindows(g, w, d, y, count, lit) {
  const m = lit ? glowMat(0xffc46a, 1.5) : mat('darkstone');
  const span = w * 0.62, step = count > 1 ? span / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    const x = count > 1 ? -span / 2 + i * step : 0;
    addMesh(g, box(0.62, 0.82, 0.16, 0.02), m, x, y, d / 2 + 0.03);
  }
}

/** Hanging banners — the cheapest, loudest "this got upgraded" tell. */
function addBanners(g, w, d, h) {
  const cm = mat('cloth');
  for (const sx of [-1, 1]) {
    addMesh(g, geo(new THREE.PlaneGeometry(0.85, 2.1)), cm,
      sx * w * 0.34, h - 1.35, d / 2 + 0.09);
  }
}

/** Point light registered for flicker in updateGuildScene. */
function addTorchLight(parent, x, y, z, color, intensity, range) {
  const l = new THREE.PointLight(color, intensity, range, 2);
  l.position.set(x, y, z);
  parent.add(l);
  torches.push({ light: l, base: intensity, phase: Math.random() * Math.PI * 2 });
  return l;
}

/* ---------------- structure builders ----------------
   Each returns { group, topY }. `topY` is where a floating label or popup
   anchor should sit. All build facing +z; the caller rotates. */

/** Tier 0 — the lot before anything is built: plinth, survey stakes, rope. */
function buildEmptyLot(s) {
  const g = new THREE.Group();
  const plinth = mat('dirt');
  addMesh(g, box(s.w, 0.24, s.d, 0.05), plinth, 0, 0.12, 0);

  const stakeM = mat('timber');
  const hw = s.w / 2 - 0.3, hd = s.d / 2 - 0.3;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    addMesh(g, box(0.16, 1.5, 0.16, 0.02), stakeM, sx * hw, 0.75, sz * hd);
  }
  /* A surveyor's plan board so an empty lot still reads as "buildable here"
     rather than "broken". */
  addMesh(g, box(0.12, 1.1, 0.12, 0.02), stakeM, 0, 0.55, s.d / 2 + 0.6);
  addMesh(g, box(1.1, 0.7, 0.08, 0.02), mat('plaster'), 0, 1.15, s.d / 2 + 0.6);
  return { group: g, topY: 1.8 };
}

/** The workhorse: a plastered hall with a tiled gable roof. */
function buildHall(s, tier, opts = {}) {
  const g = new THREE.Group();
  const wallM = mat(opts.wall || 'plaster');
  const roofM = mat(opts.roof || 'roofTile');
  const trimM = mat('timber');

  const storeys = tier >= 3 ? 2 : 1;
  const storeyH = opts.storeyH || 3.2;
  const bodyH = storeyH * storeys;

  addMesh(g, box(s.w, bodyH, s.d), wallM, 0, bodyH / 2, 0);

  /* Timber corner posts — cheap, but they do most of the work making a plain
     box read as a building at this camera angle. */
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    addMesh(g, box(0.28, bodyH, 0.28, 0.02), trimM,
      sx * (s.w / 2 - 0.14), bodyH / 2, sz * (s.d / 2 - 0.14));
  }

  const rise = opts.roofRise || Math.max(1.8, s.w * 0.34);
  addMesh(g, gableGeo(s.w, s.d, rise), roofM, 0, bodyH, 0);

  addDoor(g, s.w, s.d, storeyH, mat('timber'));
  addWindows(g, s.w, s.d, storeyH * 0.62, tier >= 2 ? 3 : 2, tier >= 2);
  if (storeys > 1) addWindows(g, s.w, s.d, storeyH + storeyH * 0.55, 3, true);

  /* Tier 2: a lean-to extension on the left flank. */
  if (tier >= 2) {
    const ew = s.w * 0.42, eh = storeyH * 0.72, ed = s.d * 0.72;
    addMesh(g, box(ew, eh, ed), wallM, -(s.w / 2 + ew / 2 - 0.1), eh / 2, 0);
    addMesh(g, gableGeo(ew, ed, 0.9, 0.25), roofM, -(s.w / 2 + ew / 2 - 0.1), eh, 0);
  }

  /* Tier 3: banners and a lantern by the door. */
  if (tier >= 3) {
    addBanners(g, s.w, s.d, bodyH);
    addMesh(g, box(0.3, 0.3, 0.3, 0.04), glowMat(0xffb04a, 2.0), s.w * 0.3, 2.5, s.d / 2 + 0.25);
    addTorchLight(g, s.w * 0.3, 2.5, s.d / 2 + 0.8, 0xffa04a, 6, 9);
  }

  return { group: g, topY: bodyH + rise + 0.4 };
}

/** Blacksmith — the loudest silhouette in the compound: chimney and forge glow. */
function buildForge(s, tier) {
  const { group: g, topY } = buildHall(s, tier, { wall: 'stone', roof: 'roofSlate' });

  const chH = 3.0 + tier * 1.4;
  const chW = 1.1 + tier * 0.12;
  addMesh(g, box(chW, chH, chW, 0.05), mat('darkstone'),
    s.w * 0.32, (3.2 * (tier >= 3 ? 2 : 1)) + chH / 2 - 0.4, -s.d * 0.18);

  /* Open forge mouth on the front face — an emissive slab plus a real point
     light, so the building throws colour onto the ground around it. */
  const glowH = 0.9 + tier * 0.14;
  addMesh(g, box(1.5, glowH, 0.2, 0.03), glowMat(0xff6a1e, 1.6 + tier * 0.5),
    -s.w * 0.26, glowH / 2 + 0.35, s.d / 2 + 0.06);
  addTorchLight(g, -s.w * 0.26, 1.1, s.d / 2 + 1.1, 0xff7a28, 5 + tier * 3.5, 8 + tier * 2.5);

  /* Anvil out front, growing into a full work yard at higher tiers. */
  addMesh(g, box(0.9, 0.34, 0.5, 0.05), mat('metal'), 1.8, 0.62, s.d / 2 + 2.0);
  addMesh(g, box(0.5, 0.6, 0.5, 0.05), mat('timber'), 1.8, 0.3, s.d / 2 + 2.0);
  if (tier >= 2) {
    addMesh(g, box(2.2, 0.24, 1.0, 0.04), mat('timber'), -2.2, 0.9, s.d / 2 + 2.1);
    for (const dx of [-3.1, -1.3]) addMesh(g, box(0.2, 0.9, 0.2, 0.02), mat('timber'), dx, 0.45, s.d / 2 + 2.1);
  }

  return { group: g, topY: Math.max(topY, chH + 3.4) };
}

/** Enchanter's Spire — grows visibly taller with every tier. */
function buildSpire(s, tier) {
  const g = new THREE.Group();
  const stoneM = mat('stone');
  const roofM = mat('roofSlate');

  const r = Math.min(s.w, s.d) * 0.42;
  const h = 4.5 + tier * 3.2;
  addMesh(g, geo(new THREE.CylinderGeometry(r, r * 1.1, h, 12)), stoneM, 0, h / 2, 0);

  /* Corbelled top ring, then a conical cap. */
  addMesh(g, geo(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.4, 12)), stoneM, 0, h + 0.2, 0);
  addMesh(g, geo(new THREE.ConeGeometry(r * 1.25, 2.4 + tier * 0.4, 12)), roofM, 0, h + 1.6 + tier * 0.2, 0);

  addDoor(g, s.w, r * 2, 3.0, mat('timber'));

  /* Arcane windows spiral up the shaft — the tier tell is how far up they go. */
  const winM = glowMat(0x8fb8ff, 1.4 + tier * 0.35);
  const rings = 1 + tier;
  for (let i = 0; i < rings; i++) {
    const y = 2.2 + i * (h - 3.0) / Math.max(1, rings);
    const a = i * 1.1;
    addMesh(g, box(0.5, 0.7, 0.16, 0.02), winM,
      Math.sin(a) * r, y, Math.cos(a) * r, [0, a, 0]);
  }
  if (tier >= 2) addTorchLight(g, 0, h + 1.0, 0, 0x7aa8ff, 6 + tier * 3, 12 + tier * 3);

  return { group: g, topY: h + 4.2 };
}

/** The Crypt — low, heavy, walled. Sinks rather than rises as it upgrades. */
function buildCrypt(s, tier) {
  const g = new THREE.Group();
  const stoneM = mat('darkstone');
  const h = 2.4;

  addMesh(g, box(s.w, h, s.d), stoneM, 0, h / 2, 0);
  addMesh(g, box(s.w + 0.8, 0.35, s.d + 0.8, 0.06), mat('stone'), 0, h + 0.17, 0);
  addDoor(g, s.w, s.d, h, mat('metal'));

  /* Pillars flanking the door, and headstones appearing along the flanks. */
  for (const sx of [-1, 1]) {
    addMesh(g, geo(new THREE.CylinderGeometry(0.28, 0.34, h + 1.2, 8)), mat('stone'),
      sx * s.w * 0.34, (h + 1.2) / 2, s.d / 2 + 0.4);
  }
  const stones = tier * 3;
  for (let i = 0; i < stones; i++) {
    const sx = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    addMesh(g, box(0.45, 0.8, 0.18, 0.04), mat('stone'),
      sx * (s.w / 2 + 1.3), 0.4, -s.d / 2 + 0.9 + row * 1.5);
  }
  if (tier >= 2) {
    addMesh(g, box(0.34, 0.34, 0.34, 0.05), glowMat(0x6fe0b0, 1.6), 0, h + 0.9, 0);
    addTorchLight(g, 0, h + 1.2, 0, 0x5ad0a0, 5, 10);
  }
  return { group: g, topY: h + 2.4 };
}

/** Living Quarters — wide, domestic, the most windows. */
function buildQuarters(s, tier) {
  const r = buildHall(s, tier, { wall: 'plaster', roof: 'roofTile', storeyH: 3.0 });
  /* A chimney and a washing line: the room where the roster actually lives. */
  addMesh(r.group, box(0.9, 2.4 + tier * 0.5, 0.9, 0.05), mat('darkstone'),
    -s.w * 0.3, (3.0 * (tier >= 3 ? 2 : 1)) + 1.0, -s.d * 0.2);
  return r;
}

/** The Tavern — always built, signposted, warm. */
function buildTavern(s) {
  const r = buildHall(s, 2, { wall: 'plaster', roof: 'thatch', roofRise: 3.0 });
  const g = r.group;

  /* Hanging sign on a bracket — the landmark that says "quests are here". */
  const postM = mat('timber');
  addMesh(g, box(0.24, 4.2, 0.24, 0.03), postM, s.w * 0.5 + 1.2, 2.1, s.d / 2 + 0.6);
  addMesh(g, box(1.5, 0.16, 0.16, 0.02), postM, s.w * 0.5 + 0.55, 4.0, s.d / 2 + 0.6);
  addMesh(g, geo(new THREE.PlaneGeometry(1.3, 0.9)), mat('cloth'),
    s.w * 0.5 + 0.35, 3.4, s.d / 2 + 0.6);

  addTorchLight(g, 0, 2.4, s.d / 2 + 1.4, 0xffab55, 9, 12);

  /* Benches and a table outside the door. */
  for (const dx of [-2.4, 2.4]) {
    addMesh(g, box(2.0, 0.18, 0.5, 0.03), postM, dx, 0.5, s.d / 2 + 2.4);
    addMesh(g, box(0.2, 0.5, 0.4, 0.02), postM, dx, 0.25, s.d / 2 + 2.4);
  }
  addMesh(g, box(1.6, 0.16, 1.0, 0.03), postM, 0, 0.85, s.d / 2 + 2.4);
  return r;
}

/** The Merchant — an open awning stall rather than a closed building. */
function buildStall(s) {
  const g = new THREE.Group();
  const postM = mat('timber');
  const h = 3.0;

  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    addMesh(g, box(0.22, h, 0.22, 0.02), postM,
      sx * (s.w / 2 - 0.3), h / 2, sz * (s.d / 2 - 0.3));
  }
  /* Striped awning, pitched toward the plaza. */
  addMesh(g, gableGeo(s.w, s.d, 1.1, 0.6), mat('cloth'), 0, h, 0);
  /* Counter and crates. */
  addMesh(g, box(s.w * 0.9, 1.0, 0.7, 0.04), mat('timber'), 0, 0.5, s.d / 2 - 0.5);
  for (const dx of [-1.6, 0.2, 1.8]) {
    addMesh(g, box(0.7, 0.7, 0.7, 0.04), postM, dx, 0.35, -s.d / 2 + 1.0);
  }
  addTorchLight(g, 0, 2.6, s.d / 2 - 0.2, 0xffc070, 6, 9);
  return { group: g, topY: h + 1.6 };
}

/** Training Grounds — a fenced yard, not a building. */
function buildYard(s, tier) {
  const g = new THREE.Group();
  const postM = mat('timber');

  /* Sand floor. */
  addMesh(g, geo(new THREE.PlaneGeometry(s.w, s.d)), mat('dirt'), 0, 0.03, 0, [-Math.PI / 2, 0, 0]);

  /* Rail fence around three sides, open toward the plaza. */
  const hw = s.w / 2, hd = s.d / 2;
  const railM = postM;
  const postEvery = 2.2;
  const line = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / postEvery));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      addMesh(g, box(0.16, 1.15, 0.16, 0.02), postM, x0 + (x1 - x0) * t, 0.57, z0 + (z1 - z0) * t);
    }
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const ang = Math.atan2(x1 - x0, z1 - z0);
    addMesh(g, box(0.1, 0.12, len, 0.02), railM, mx, 0.92, mz, [0, ang, 0]);
  };
  line(-hw, -hd, hw, -hd);
  line(-hw, -hd, -hw, hd);
  line(hw, -hd, hw, hd);

  /* Pell dummies — one more per tier, so the yard visibly gets busier. */
  const dummies = 1 + tier;
  for (let i = 0; i < dummies; i++) {
    const x = -hw + 1.8 + i * (s.w - 3.6) / Math.max(1, dummies - 1 || 1);
    addMesh(g, box(0.26, 2.0, 0.26, 0.03), postM, x, 1.0, -hd + 2.2);
    addMesh(g, box(1.5, 0.2, 0.2, 0.03), postM, x, 1.7, -hd + 2.2);
    addMesh(g, box(0.55, 0.7, 0.4, 0.06), mat('cloth'), x, 1.35, -hd + 2.2);
  }
  /* Weapon rack at tier 2+, archery butts at tier 3. */
  if (tier >= 2) {
    addMesh(g, box(2.4, 0.18, 0.5, 0.03), postM, hw - 2.0, 1.2, hd - 1.6);
    for (const dx of [-1.1, 1.1]) addMesh(g, box(0.18, 1.2, 0.18, 0.02), postM, hw - 2.0 + dx, 0.6, hd - 1.6);
    for (let i = 0; i < 4; i++) addMesh(g, box(0.09, 1.5, 0.09, 0.01), mat('metal'), hw - 2.9 + i * 0.55, 1.1, hd - 1.55);
  }
  if (tier >= 3) {
    for (const dx of [-2.2, 0.6]) {
      addMesh(g, geo(new THREE.CylinderGeometry(0.85, 0.85, 0.25, 14)), mat('thatch'),
        dx, 1.4, -hd + 0.5, [Math.PI / 2, 0, 0]);
      addMesh(g, box(0.16, 1.4, 0.16, 0.02), postM, dx, 0.7, -hd + 0.5);
    }
  }
  return { group: g, topY: 2.8 };
}

/** The Chronicle — a notice board. Small on purpose. */
function buildBoard(s) {
  const g = new THREE.Group();
  const postM = mat('timber');
  for (const sx of [-1, 1]) addMesh(g, box(0.16, 2.4, 0.16, 0.02), postM, sx * s.w * 0.42, 1.2, 0);
  addMesh(g, box(s.w, 1.5, 0.14, 0.03), mat('plaster'), 0, 1.75, 0);
  addMesh(g, box(s.w + 0.25, 0.18, 0.3, 0.03), postM, 0, 2.6, 0);
  /* Pinned notices. */
  for (const [dx, dy] of [[-0.7, 1.9], [0.1, 1.6], [0.75, 2.0]]) {
    addMesh(g, geo(new THREE.PlaneGeometry(0.45, 0.55)), mat('plaster'), dx, dy, 0.09);
  }
  return { group: g, topY: 3.2 };
}

const BUILDERS = {
  hall: buildHall, forge: buildForge, spire: buildSpire, crypt: buildCrypt,
  quarters: buildQuarters, yard: buildYard,
  tavern: (s) => buildTavern(s), stall: (s) => buildStall(s), board: (s) => buildBoard(s)
};

/* ---------------- real art paths ----------------
   The compound is a blend: some structures will be paper-doll pixel art on an
   upright quad, others will be GLB models, chosen per structure. Both paths
   live here so the layout can opt a single building in without the rest of the
   scene caring which it is.

   A structure declares its art per tier:
     art: { type: 'sprite', tiers: ['./art/guild/forge_t1.png', ...], height: 9 }
     art: { type: 'glb',    tiers: ['forge_t1', 'forge_t2', 'forge_t3'] }
   With no `art`, it falls through to the procedural placeholder above. */

const spriteTexCache = {};

/** Paper-doll building: one upright quad, pixel-art texture, no billboarding.
 *  The camera is fixed (CAM.yaw = 0), so the quad is simply axis-aligned — a
 *  real billboard would swim if the camera is ever unlocked for inspection. */
function buildSpriteArt(s, art, tier, level) {
  const g = new THREE.Group();

  /* A hand-authored set ships one sprite per facility LEVEL (10 of them), so it
     indexes by level directly. Generated sets have one sprite per visual TIER
     (1-3), so those still index by tier. `perLevel` on the manifest entry says
     which, rather than guessing from array length. */
  const idx = art.perLevel
    ? Math.min(Math.max(1, level | 0), art.tiers.length) - 1
    : Math.min(tier - 1, art.tiers.length - 1);
  const entry = art.tiers[idx];

  /* Tier entries are either a bare URL string (generated sets) or an object
     carrying its own world size (imported sets, where every level is drawn at a
     different size and normalising them is the whole point). */
  const url = typeof entry === 'string' ? entry : entry.file;
  const perTierW = (entry && entry.worldW) || null;
  const perTierAspect = (entry && entry.aspect) || null;

  /* World size comes from the LAYOUT, never from the sprite's pixel count.
     Art resolution and physical footprint are deliberately decoupled — a
     placeholder may be 2048px wide and a finished asset 600px, and both must
     occupy the same number of world units. */
  /* Divide by bodyFrac so the BUILDING matches the layout footprint rather than
     the sprite's full alpha box. Generated sprites often carry a strip of ground
     wider than the building itself; without this the building renders visibly
     smaller than its neighbours and the turf takes up its budget. */
  const w = perTierW || ((art.width || s.w) / (art.bodyFrac || 1));

  let tex = spriteTexCache[url];
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    /* Pixel art must never be filtered — bilinear turns crisp pixels to mush.
       Matches configureSpriteMaterial in sprite_animator.js. */
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = maxAniso;
    tex.colorSpace = THREE.SRGBColorSpace;
    spriteTexCache[url] = tex;
  }

  const m = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
    depthWrite: true
  });
  ownedMats.push(m);

  /* Unit plane scaled to size, rather than a sized PlaneGeometry: the sprite's
     true aspect is only known once the image has loaded, and rescaling a unit
     quad is a one-line fix-up where rebuilding geometry would not be. */
  const quad = new THREE.Mesh(unitQuad(), m);

  /* Lean the quad back to face the camera squarely.
   *
   * The camera sits along f = (0, sin(pitch), cos(pitch)) looking back at the
   * origin, so the quad's normal must point along +f. A plane's default normal
   * is +Z, and rotating about X by t sends it to (0, -sin t, cos t) — so the
   * rotation needed is -pitch, not +pitch. (Wrong sign tilts the sprite away
   * from the camera and it renders edge-on to invisible.) */
  quad.rotation.x = -CAM.pitch;

  const node = { quad, w, h: w * (perTierAspect || art.aspect || 0.9) };
  applySpriteSize(node);
  g.add(quad);

  /* Correct the height from the image's real aspect as soon as it is known.
     Without this every sprite would render at the layout's guessed aspect and
     squash or stretch. */
  const fixAspect = () => {
    const img = tex.image;
    if (!img || !img.width) return;
    node.h = node.w * (img.height / img.width);
    applySpriteSize(node);
  };
  /* Resolved on a later frame by updateGuildScene. Texture loading has no
     reliable event once the texture is served from cache, so poll instead —
     it is a handful of checks for one or two frames. */
  if (tex.image && tex.image.width) fixAspect();
  else spritePending.push({ tex, fix: fixAspect });

  return { group: g, topY: Math.cos(CAM.pitch) * node.h + 0.6, sprite: node };
}

/** Shared 1x1 plane; every sprite scales its own copy of the transform. */
let _unitQuadGeo = null;
function unitQuad() {
  if (!_unitQuadGeo) _unitQuadGeo = new THREE.PlaneGeometry(1, 1);
  return _unitQuadGeo;
}

/** Size the quad and stand it on the ground.
 *
 *  After the -pitch rotation the quad's local +Y maps to
 *  (0, cos(pitch), -sin(pitch)), so its bottom edge sits at
 *  (0, -cos(pitch)*h/2, +sin(pitch)*h/2) from the centre. Undo that offset so
 *  the base lands on y = 0 at the structure's own anchor. */
function applySpriteSize(node) {
  const c = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  node.quad.scale.set(node.w, node.h, 1);
  node.quad.position.set(0, c * node.h / 2, -sp * node.h / 2);
}

/** GLB building: a prop registered through the dungeon's own loader. */
function buildGlbArt(s, art, tier, node) {
  const g = new THREE.Group();
  const key = art.tiers[Math.min(tier - 1, art.tiers.length - 1)];
  const asset = glbAssets[key];
  if (asset) {
    const inst = asset.clone(true);
    inst.scale.setScalar(art.scale || 1);
    inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(inst);
  }
  return { group: g, topY: art.height || Math.max(5, s.w * 0.9) };
}

const glbAssets = {};

/* ---------------- art manifest ----------------
   public/art/guild/manifest.json is written by tools/gen_all_placeholders.py and
   lists whatever building sprites currently exist. Reading it means a newly
   generated building appears in the compound with no edit to guild_layout.js —
   the alternative was hand-maintaining an `art:` block per structure, which
   would drift out of sync with the files on disk immediately. */

let artManifest = {};

export async function loadGuildArt(url = './art/guild/manifest.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) { artManifest = {}; return artManifest; }
    const raw = await res.json();
    artManifest = {};
    for (const [id, e] of Object.entries(raw)) {
      artManifest[id] = {
        type: 'sprite',
        tiers: e.tiers || [`./art/guild/${id}_t1.png`],
        aspect: e.aspect,
        bodyFrac: e.bodyFrac,
        perLevel: !!e.perLevel,
        id
      };
    }
  } catch {
    artManifest = {};      // no manifest yet — placeholders stay procedural
  }
  return artManifest;
}

export function guildArtCount() { return Object.keys(artManifest).length; }

/** Load a GLB and make it available to structures that reference `key`.
 *  Thin wrapper over the dungeon's prop loader so the compound shares its
 *  DRACO setup and caching. Call before buildGuildScene, or call again and
 *  rebuild. */
export async function registerGuildModel(key, url, scale) {
  await registerProp(`guild_${key}`, url, scale);
  /* registerProp keeps its own registry private, so mirror the loaded scene
     here via a second lightweight load from the browser cache. */
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  glbAssets[key] = gltf.scene;
  return key;
}

/* ---------------- compound shell ---------------- */

function buildGround() {
  const g = new THREE.Group();
  const W = Math.round(COMPOUND.halfW * 2 + 16), D = Math.round(COMPOUND.halfD * 2 + 16);

  /* One plane, one baked texture. The terrain is autotiled from the DCSS dirt
     set in guild_ground.js — grass, packed-earth roads, and the fringe tiles
     that blend between them — so there are no separate plaza/road quads to
     z-fight with the ground. Sized 1 world unit per 32px tile, which lands
     almost exactly 1:1 on screen at the compound's default zoom. */
  const groundM = mat('ground', { map: null, color: 0x6f7a4e });
  addMesh(g, geo(new THREE.PlaneGeometry(W, D)), groundM, 0, 0, 0, [-Math.PI / 2, 0, 0]);

  /* Baking waits on the tile images, so the plane starts as flat grass colour
     and the texture drops in when ready. Guarded by the build token: a rebuild
     triggered while this is in flight must not stamp a stale terrain over the
     new one. */
  const token = buildToken;
  bakeGroundTexture(W, D, levels, maxAniso)
    .then(tex => {
      if (token !== buildToken) { tex.dispose(); return; }
      groundM.map = tex;
      groundM.color.set(0xffffff);   // let the texture supply the colour
      groundM.needsUpdate = true;
      ownedTextures.push(tex);
    })
    .catch(err => console.warn('guild ground bake failed', err));

  /* The well at the centre of the plaza. */
  const stoneM = mat('stone');
  addMesh(g, geo(new THREE.CylinderGeometry(1.15, 1.25, 1.0, 14)), stoneM, 0, 0.5, 0);
  addMesh(g, geo(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 14)), mat('darkstone'), 0, 1.0, 0);
  for (const sx of [-1, 1]) addMesh(g, box(0.18, 2.2, 0.18, 0.02), mat('timber'), sx * 1.0, 2.1, 0);
  addMesh(g, box(2.6, 0.7, 0.9, 0.06), mat('roofTile'), 0, 3.4, 0);

  return g;
}

function buildWall(infra) {
  const g = new THREE.Group();
  const style = (INFRA_TIERS[infra] || INFRA_TIERS[0]).wall;
  if (style === 'none') return g;         // a new guild has not earned a wall

  const hw = COMPOUND.halfW, hd = COMPOUND.halfD;
  const gapHalf = COMPOUND.gate.width / 2;
  const timberM = mat('timber');

  /* Cloned, never the shared singletons — matWall/matWallCap are used by every
     dungeon level and tinting them in place would change the whole game. The
     clones keep the same DCSS atlas but can be brought down for daylight, where
     the dungeon's own calibration clips masonry to flat white. */
  const stoneM = matWall.clone();  stoneM.color.setHex(0x8f9298);
  const capM   = matWallCap.clone(); capM.color.setHex(0x7d8087);
  ownedMats.push(stoneM, capM);

  const runs = [
    { x: 0, z: -hd, len: hw * 2, along: 'x' },
    { x: -hw, z: 0, len: hd * 2, along: 'z' },
    { x: hw, z: 0, len: hd * 2, along: 'z' },
    { x: -(gapHalf + (hw - gapHalf) / 2), z: hd, len: hw - gapHalf, along: 'x' },
    { x: gapHalf + (hw - gapHalf) / 2, z: hd, len: hw - gapHalf, along: 'x' }
  ];

  /* ── markers: just boundary stones, no enclosure ── */
  if (style === 'markers') {
    const cubes = [];
    for (const r of runs) {
      const n = Math.max(2, Math.round(r.len / 7));
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        cubes.push({
          x: r.along === 'x' ? r.x + t * r.len : r.x,
          y: 0.4, sy: 0.8,
          z: r.along === 'x' ? r.z : r.z + t * r.len
        });
      }
    }
    addMesh(g, atlasCubes(cubes, 11), stoneM, 0, 0, 0);
    return g;
  }

  /* ── timber palisade ── */
  if (style === 'timber') {
    for (const r of runs) {
      const n = Math.max(2, Math.round(r.len / 0.85));
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        const px = r.along === 'x' ? r.x + t * r.len : r.x;
        const pz = r.along === 'x' ? r.z : r.z + t * r.len;
        const jit = ((i * 37) % 7) * 0.04;
        addMesh(g, box(0.32, 2.2 + jit, 0.32, 0.03), timberM, px, (2.2 + jit) / 2, pz);
      }
    }
    for (const sx of [-1, 1]) {
      addMesh(g, box(0.7, 3.4, 0.7, 0.05), timberM, sx * (gapHalf + 1.0), 1.7, hd);
    }
    return g;
  }

  /* ── stone curtain, and bastion ── */
  const h = style === 'bastion' ? 4 : 3;
  const cubes = [];
  for (const r of runs) cubes.push(...wallRunCubes(r.x, r.z, r.len, r.along, h));

  /* Gatehouse towers. */
  const towerH = h + (style === 'bastion' ? 3 : 2);
  for (const sx of [-1, 1]) {
    const px = sx * (gapHalf + 1.5);
    for (let l = 0; l < towerH; l++)
      for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
        cubes.push({ x: px + ox, y: l + 0.5, z: hd + oz });
  }

  /* Corner towers only at bastion. */
  if (style === 'bastion') {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = sx * hw, cz = sz * hd;
      if (sz > 0 && Math.abs(cx) < gapHalf + 5) continue;
      for (let l = 0; l < h + 3; l++)
        for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
          cubes.push({ x: cx + ox, y: l + 0.5, z: cz + oz });
    }
  }
  addMesh(g, atlasCubes(cubes, 7), stoneM, 0, 0, 0);

  /* Capping course, also unit cubes so its texels match the wall below. */
  const caps = [];
  for (const r of runs) {
    const n = Math.max(1, Math.round(r.len));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      caps.push({
        x: r.along === 'x' ? r.x + t * r.len : r.x,
        y: h + 0.15, sy: 0.3, sx: 1.2, sz: 1.2,
        z: r.along === 'x' ? r.z : r.z + t * r.len
      });
      /* Crenellations at bastion: merlons every few units. */
      if (style === 'bastion' && i % 3 === 0) {
        caps.push({
          x: r.along === 'x' ? r.x + t * r.len : r.x,
          y: h + 0.8, sy: 0.9, sx: 0.9, sz: 0.9,
          z: r.along === 'x' ? r.z : r.z + t * r.len
        });
      }
    }
  }
  addMesh(g, atlasCubes(caps, 23), capM, 0, 0, 0);

  /* Braziers flanking the gate. */
  for (const sx of [-1, 1]) {
    const px = sx * (gapHalf + 1.5);
    addMesh(g, box(0.34, 0.34, 0.34, 0.04), glowMat(0xffb04a, 2.0), px, towerH - 0.6, hd - 1.4);
    addTorchLight(g, px, towerH - 0.6, hd - 1.8, 0xffa04a, 7, 12);
    if (style === 'bastion') {
      addMesh(g, geo(new THREE.PlaneGeometry(1.0, 2.6)), mat('cloth'),
        px - sx * 1.5, towerH * 0.55, hd - 1.45);
    }
  }
  return g;
}

/* ---------------- outskirts ----------------
   Land beyond the wall, so the compound sits in a place rather than floating on
   a slab. Uses the overland biome models the dungeon already ships in /3d, for
   the same reason the wall uses the dungeon's tile atlases: one asset library,
   one look. */

const OUTSKIRT_PROPS = [
  /* The .opt.glb variants (same mesh, up-axis baked in, ~3 MB instead of
     ~25 MB each) — the raw masters must not ship in the web build. */
  { url: './3d/Forest/tree.opt.glb',       scale: 2.6, weight: 26 },
  { url: './3d/Moor/swamptree.opt.glb',    scale: 2.4, weight: 10 },
  { url: './3d/Moor/bush.opt.glb',         scale: 1.3, weight: 20 },
  { url: './3d/Forest/rocks.opt.glb',      scale: 1.2, weight: 14 },
  { url: './3d/Forest/stump.opt.glb',      scale: 1.2, weight: 8 },
  { url: './3d/Forest/Cairn.opt.glb',      scale: 1.1, weight: 5 },
  { url: './3d/Forest/MushroomLog.opt.glb', scale: 1.2, weight: 6 },
  { url: './3d/Forest/vinemound.opt.glb',  scale: 1.2, weight: 6 },
  { url: './3d/Moor/signpost.opt.glb',     scale: 1.1, weight: 3 }
];

const outskirtCache = {};

/** Deterministic RNG — the scatter must not reshuffle on every rebuild. */
function scatterRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOutskirts() {
  const g = new THREE.Group();
  const hw = COMPOUND.halfW, hd = COMPOUND.halfD, m = OUTSKIRTS.margin;

  /* Outer ground is a plain repeating grass plane, NOT part of the baked
     tilemap. Extending the bake this far would push the canvas past 4700px
     wide for terrain that is only ever grass — a repeat-wrapped tile is a
     fraction of the memory and looks identical out here. */
  const grass = new THREE.TextureLoader().load('./art/ground/dirt_full.png');
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.magFilter = THREE.NearestFilter;
  grass.minFilter = THREE.LinearMipmapLinearFilter;
  grass.anisotropy = maxAniso;
  grass.colorSpace = THREE.SRGBColorSpace;
  const OW = (hw + m) * 2, OD = (hd + m) * 2;
  grass.repeat.set(OW, OD);
  ownedTextures.push(grass);

  const gm = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.96, metalness: 0 });
  ownedMats.push(gm);
  /* Sits just below the baked tilemap so the detailed inner ground wins where
     they overlap, instead of z-fighting with it. */
  addMesh(g, geo(new THREE.PlaneGeometry(OW, OD)), gm, 0, -0.05, 0, [-Math.PI / 2, 0, 0]);

  scatterOutskirtProps(g);
  return g;
}

/** Load the models once, then place them. Async: the scatter appears a moment
 *  after the compound, which is fine — it is background dressing. */
async function scatterOutskirtProps(parent) {
  const token = buildToken;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();

  await Promise.all(OUTSKIRT_PROPS.map(async p => {
    if (outskirtCache[p.url]) return;
    try {
      const gltf = await loader.loadAsync(p.url);
      outskirtCache[p.url] = gltf.scene;
    } catch {
      outskirtCache[p.url] = null;      // missing model: just skip it
    }
  }));
  if (token !== buildToken) return;      // a rebuild overtook us

  const pool = OUTSKIRT_PROPS.filter(p => outskirtCache[p.url]);
  if (!pool.length) return;
  const totalWeight = pool.reduce((n, p) => n + p.weight, 0);

  const rnd = scatterRng(0xC0FFEE);
  const hw = COMPOUND.halfW, hd = COMPOUND.halfD, m = OUTSKIRTS.margin;
  let placed = 0, guard = 0;

  while (placed < OUTSKIRTS.propCount && guard++ < OUTSKIRTS.propCount * 12) {
    const x = (rnd() * 2 - 1) * (hw + m);
    const z = (rnd() * 2 - 1) * (hd + m);

    /* Keep the walls clear, and keep the gate approach open so the road out of
       the compound still reads as a road rather than a gap in a thicket. */
    if (Math.abs(x) < hw + 3 && Math.abs(z) < hd + 3) continue;
    if (Math.abs(x) < COMPOUND.gate.width * 1.6 && z > hd) continue;

    let r = rnd() * totalWeight, pick = pool[0];
    for (const p of pool) { r -= p.weight; if (r <= 0) { pick = p; break; } }

    const inst = outskirtCache[pick.url].clone(true);
    const s = pick.scale * (0.75 + rnd() * 0.55);
    inst.scale.setScalar(s);
    inst.position.set(x, 0, z);
    inst.rotation.y = rnd() * Math.PI * 2;
    inst.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    parent.add(inst);
    placed++;
  }
}

/* ---------------- structure assembly ---------------- */

function buildStructure(s, level) {
  const tier = s.alwaysBuilt ? Math.max(1, tierOf(level)) : tierOf(level);
  const matsBefore = ownedMats.length;

  /* Art selection: real art if the structure declares any and it has loaded,
     procedural placeholder otherwise. Phase 0 is all placeholder. */
  /* An explicit layout `art` entry wins; otherwise fall back to whatever the
     generated-art manifest offers for this structure. */
  const art = s.art || artManifest[s.id];

  let built;
  if (tier === 0) {
    built = buildEmptyLot(s);
  } else if (art?.type === 'sprite') {
    built = buildSpriteArt(s, art, tier, level);
  } else if (art?.type === 'glb' && glbAssets[art.tiers[Math.min(tier - 1, art.tiers.length - 1)]]) {
    built = buildGlbArt(s, art, tier);
  } else {
    built = (BUILDERS[s.kind] || buildHall)(s, tier);
  }

  const g = built.group;
  g.position.set(s.x, 0, s.z);
  g.rotation.y = rotationOf(s);
  g.userData.structureId = s.id;

  /* Generous invisible click volume. Raycasting the real meshes alone would
     make an empty lot nearly unclickable and the yard fiddly, so every
     structure gets one box that covers its whole footprint and height.
     opacity 0 rather than visible:false — an invisible Object3D is skipped by
     some three.js raycast paths, an invisible *material* never is. */
  /* The click volume belongs to the PLOT, not to the artwork.
   *
   * It used to be a child of the structure group, so every per-level position
   * and scale nudge dragged the clickable area around with it — tune lvl4's
   * placement and the target you have to click moves too. It is now a sibling
   * added straight to `root` at the structure's own anchor, with its own
   * explicitly editable size and offset, so it stays put across all ten levels. */
  const hb = getStructureHitbox(s.id, built.topY);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  ownedMats.push(hitMat);
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hitMat);
  hitbox.userData.structureId = s.id;
  hitbox.userData.isHitbox = true;
  root.add(hitbox);

  /* Wireframe so the volume can actually be seen while it is being edited. */
  const hbWire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9 }));
  hbWire.visible = hitboxDebug;
  root.add(hbWire);

  /* Hover ring on the ground, hidden until the cursor is over the structure. */
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd68a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide
  });
  ringMat.toneMapped = false;
  ownedMats.push(ringMat);
  const rOuter = Math.max(s.w, s.d) * 0.62 + 1.0;
  const ring = new THREE.Mesh(geo(new THREE.RingGeometry(rOuter - 0.35, rOuter, 44)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.visible = false;
  g.add(ring);

  root.add(g);

  structureNodes[s.id] = {
    s, group: g, hitbox, hbWire, ring, tier, topY: built.topY,
    /* Materials this structure owns, for hover emissive. Skips the hit/ring
       materials appended after the build. */
    level,
    mats: ownedMats.slice(matsBefore).filter(m => m.isMeshStandardMaterial)
  };
  applyTransform(structureNodes[s.id]);
  applyHitbox(structureNodes[s.id]);
  return structureNodes[s.id];
}

/* ---------------- public API ---------------- */

/**
 * Build (or rebuild) the whole compound.
 * @param {object} opts
 * @param {object} opts.levels  { facilityId: 0..10 } — drives visual tier.
 * @param {string} opts.themeKey  THEMES key for fog/light mood.
 */
export function buildGuildScene(opts = {}) {
  disposeGuildScene();
  disposeLevel();          // clear any dungeon geometry sharing this scene

  buildToken++;
  spritePending = [];
  hitboxes = {};                 // re-read from the manifest on every build
  levels = { ...(opts.levels || {}) };
  root = new THREE.Group();
  scene.add(root);

  const TH = THEMES[opts.themeKey || COMPOUND.themeKey] || THEMES.ancient;
  applyThemeEnv(TH);

  /* ── daylight override ──────────────────────────────────────────────────
     Every THEMES entry describes an underground or dusk mood: near-black
     background, dense fog, a warm torch-coloured key light. Applied unchanged
     the compound looks like a town at midnight. The guild is the safe place
     you come back to between runs, so it gets its own daylight rig.

     applyThemeEnv still runs first — it sets the accent colour the UI reads —
     and then everything atmospheric is replaced. */
  const sky = new THREE.Color(0x9fb4c4);
  scene.background = sky;              // overrides the renderer's dark clear
  scene.fog.color.copy(sky);
  scene.fog.density = 0.0009;

  /* Balanced against pale plaster and painted roofs rather than wet stone: the
     dungeon's own intensities clip these materials to flat white. */
  dirL.intensity = 4.4;
  dirL.color.set(0xfff2d8);
  hemi.color.set(0xbcd2e8);
  hemi.groundColor.set(0x4a4a32);
  hemi.intensity = 6.0;

  /* Wall and cap use the dungeon's DCSS tile atlases. Selecting a stone theme
     here means the compound's masonry is the same bake as an ancient dungeon's
     walls, rather than this module's own procedural noise. */
  applyTileTheme('ancient');

  infraTier = infraTierOf(levels);
  root.add(buildGround());
  root.add(buildWall(infraTier));
  root.add(buildOutskirts());

  for (const s of STRUCTURES) buildStructure(s, levels[s.id] ?? 0);

  resizeGuildCamera();               // frustum from the live viewport, not load time
  cam.zoom = Math.max(COMPOUND.camZoom, minCompoundZoom());
  cam.updateProjectionMatrix();
  camTarget.set(0, 0, 0);
  setYawPitch(CAM.yaw, CAM.pitch);   // straight down the north axis, not 45°
  updateCam();

  return root;
}

/** Rebuild one structure in place — used by the level sliders in the preview. */
export function setStructureLevel(id, level) {
  const s = STRUCTURE_BY_ID[id];
  if (!s || !root) return;
  levels[id] = level;

  const old = structureNodes[id];
  if (old) {
    root.remove(old.group);
    old.group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    /* The click volume and its wireframe are siblings of the group now, not
       children, so removing the group alone would leak them — and worse, leave
       a stale invisible box still answering raycasts. */
    for (const extra of [old.hitbox, old.hbWire]) {
      if (!extra) continue;
      root.remove(extra);
      extra.geometry?.dispose();
    }
    delete structureNodes[id];
  }
  /* Torch lights belonging to the old build are inside the removed group. */
  torches = torches.filter(t => {
    let p = t.light.parent;
    while (p) { if (p === old?.group) return false; p = p.parent; }
    return true;
  });

  const node = buildStructure(s, level);
  if (hoverId === id) applyHover(node, true);
  return node;
}

export function getStructureLevel(id) { return levels[id] ?? 0; }

/** Raycast the compound. Returns a structure id or null. */
export function pickStructure(clientX, clientY) {
  if (!root || !renderer) return null;
  const r = renderer.domElement.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, cam);
  const hits = _ray.intersectObjects(root.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o) {
      if (o.userData && o.userData.structureId) return o.userData.structureId;
      o = o.parent;
    }
  }
  return null;
}

function applyHover(node, on) {
  if (!node) return;
  node.ring.visible = on;
  for (const m of node.mats) {
    if (on) {
      m.userData._emiBase = m.userData._emiBase ?? m.emissiveIntensity;
      m.userData._emiColor = m.userData._emiColor ?? m.emissive.getHex();
      /* Lift only unlit materials — boosting an already-emissive forge glow
         just blows it out. */
      if (m.userData._emiColor === 0x000000) {
        m.emissive.setHex(0x3a2a12);
        m.emissiveIntensity = 1;
      }
    } else if (m.userData._emiColor !== undefined) {
      m.emissive.setHex(m.userData._emiColor);
      m.emissiveIntensity = m.userData._emiBase ?? 1;
    }
  }
}

/* ---------------- click volumes ----------------
   One per structure, independent of level and of the art transform. */
let hitboxes = {};               // id -> { dx, dz, w, h, d }
let hitboxDebug = false;
let infraTier = 0;

/** Current infrastructure tier (0-4), derived from the mean facility level. */
export function getInfraTier() { return infraTier; }

/** Config for a structure's click volume, defaulting to its plot footprint. */
export function getStructureHitbox(id, fallbackTopY) {
  if (hitboxes[id]) return hitboxes[id];
  const fromManifest = artManifest[id] && artManifest[id].hitbox;
  const s = STRUCTURE_BY_ID[id];
  const def = {
    dx: 0, dz: 0,
    w: (s ? s.w : 6) + 1.6,
    h: Math.max(3.0, fallbackTopY || 6),
    d: (s ? s.d : 6) + 1.6
  };
  hitboxes[id] = fromManifest ? { ...def, ...fromManifest } : def;
  return hitboxes[id];
}

export function setStructureHitbox(id, patch) {
  const cur = getStructureHitbox(id);
  hitboxes[id] = {
    ...cur, ...patch,
    w: Math.max(0.5, patch.w ?? cur.w),
    h: Math.max(0.5, patch.h ?? cur.h),
    d: Math.max(0.5, patch.d ?? cur.d)
  };
  const node = structureNodes[id];
  if (node) applyHitbox(node);
  return hitboxes[id];
}

export function getHitboxOverrides() {
  const out = {};
  for (const [id, hb] of Object.entries(hitboxes)) {
    const s = STRUCTURE_BY_ID[id];
    const isDefault = s && Math.abs(hb.dx) < 0.001 && Math.abs(hb.dz) < 0.001
      && Math.abs(hb.w - (s.w + 1.6)) < 0.001 && Math.abs(hb.d - (s.d + 1.6)) < 0.001;
    if (!isDefault) {
      out[id] = { dx: +hb.dx.toFixed(2), dz: +hb.dz.toFixed(2),
                  w: +hb.w.toFixed(2), h: +hb.h.toFixed(2), d: +hb.d.toFixed(2) };
    }
  }
  return out;
}

export function setHitboxDebug(on) {
  hitboxDebug = !!on;
  for (const node of Object.values(structureNodes)) {
    if (node.hbWire) node.hbWire.visible = hitboxDebug;
  }
}

export function isHitboxDebug() { return hitboxDebug; }

function applyHitbox(node) {
  const hb = getStructureHitbox(node.s.id, node.topY);
  const x = node.s.x + hb.dx, z = node.s.z + hb.dz;
  node.hitbox.scale.set(hb.w, hb.h, hb.d);
  node.hitbox.position.set(x, hb.h / 2, z);
  if (node.hbWire) {
    node.hbWire.scale.copy(node.hitbox.scale);
    node.hbWire.position.copy(node.hitbox.position);
    node.hbWire.visible = hitboxDebug;
  }
}

const tkey = (id, level) => `${id}@${level | 0}`;

/** Baseline offset stored with the level's art in the manifest. */
function baseTransform(id, level) {
  const art = artManifest[id];
  if (!art || !art.perLevel) return { dx: 0, dz: 0, scale: 1 };
  const e = art.tiers[Math.min(Math.max(1, level | 0), art.tiers.length) - 1];
  return { dx: e?.dx || 0, dz: e?.dz || 0, scale: e?.scale || 1 };
}

/** Nudge one LEVEL of a structure. Deltas are world units from the anchor. */
export function setStructureTransform(id, level, t) {
  const k = tkey(id, level);
  const cur = transforms[k] || baseTransform(id, level);
  transforms[k] = { ...cur, ...t };
  const node = structureNodes[id];
  if (node && (node.level | 0) === (level | 0)) applyTransform(node);
  return transforms[k];
}

export function getStructureTransform(id, level) {
  return transforms[tkey(id, level)] || baseTransform(id, level);
}

/** Everything actually moved, grouped by building then level. */
export function getTransformOverrides() {
  const out = {};
  for (const [k, t] of Object.entries(transforms)) {
    const [id, lvl] = k.split('@');
    if (Math.abs(t.dx) > 0.001 || Math.abs(t.dz) > 0.001 || Math.abs(t.scale - 1) > 0.001) {
      (out[id] ||= {})[lvl] = {
        dx: +t.dx.toFixed(2), dz: +t.dz.toFixed(2), scale: +t.scale.toFixed(3)
      };
    }
  }
  return out;
}

export function clearTransforms() {
  transforms = {};
  for (const id of Object.keys(structureNodes)) applyTransform(structureNodes[id]);
}

function applyTransform(node) {
  const t = getStructureTransform(node.s.id, node.level);
  node.group.position.set(node.s.x + t.dx, 0, node.s.z + t.dz);
  node.group.scale.setScalar(t.scale);
}

/** World point on the ground plane under the cursor — used to drag buildings. */
export function groundPointAt(clientX, clientY) {
  if (!renderer) return null;
  const r = renderer.domElement.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, cam);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  return _ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
}

/** Freeze the camera while dragging, so the shared pan handler cannot fight it. */
export function lockCamera(on) {
  camLock = on ? { x: camTarget.x, z: camTarget.z, zoom: cam.zoom } : null;
}

export function setHoverStructure(id) {
  if (id === hoverId) return hoverId;
  if (hoverId) applyHover(structureNodes[hoverId], false);
  hoverId = id;
  if (hoverId) applyHover(structureNodes[hoverId], true);
  if (renderer) renderer.domElement.style.cursor = hoverId ? 'var(--cur-hand, pointer)' : '';
  return hoverId;
}

export function getHoverStructure() { return hoverId; }

/** Screen-space anchor for a DOM popup over a structure. */
export function screenPosOf(id) {
  const node = structureNodes[id];
  if (!node || !renderer) return null;
  const t = getStructureTransform(id, node.level);
  _v3.set(node.s.x + t.dx, node.topY * t.scale, node.s.z + t.dz).project(cam);
  const r = renderer.domElement.getBoundingClientRect();
  return {
    x: r.left + (_v3.x * 0.5 + 0.5) * r.width,
    y: r.top + (-_v3.y * 0.5 + 0.5) * r.height,
    behind: _v3.z > 1
  };
}

export function structureIds() { return STRUCTURES.map(s => s.id); }

/* ---------------- heroes ---------------- */

/**
 * Place heroes at the hero slots of the structures they are assigned to.
 * @param {Array} list  [{ hero, structureId }] — hero needs .visual/.equipment.
 */
export function setHeroes(list = []) {
  clearHeroes();
  const used = {};
  for (const { hero, structureId } of list) {
    const s = STRUCTURE_BY_ID[structureId];
    if (!s || !s.heroSlots || !s.heroSlots.length) continue;
    const i = (used[structureId] = (used[structureId] ?? -1) + 1);
    if (i >= s.heroSlots.length) continue;      // slots full

    const sprite = new HeroSprite(hero, 0xffffff);
    const p = heroSlotWorld(s, s.heroSlots[i]);
    sprite.mesh.position.set(p.x, 0.02, p.z);
    /* Held frame 0 of the WALK sheet, not the idle sheet. Only some LPC layers
       ship an idle.png (body and a few others) — most torso/legs/cape/weapon
       layers do not, so composing 'idle' silently drops half a hero's gear.
       walk frame 0 is the standing pose and every layer has it.
       HeroSprite.update() holds frame 0 while `time` stays near zero, so
       clearing `animating` freezes them standing. */
    sprite.play('walk', true);
    sprite.dir = 'down';               // face the camera
    sprite.time = 0;
    sprite.animating = false;
    root.add(sprite.mesh);
    heroes.push({ sprite, structureId });
  }
  return heroes.length;
}

export function clearHeroes() {
  for (const h of heroes) {
    if (root) root.remove(h.sprite.mesh);
    if (h.sprite.material) h.sprite.material.dispose();
  }
  heroes = [];
}

/* ---------------- camera ----------------
   The compound reuses the dungeon's own drag-pan and wheel-zoom (they are
   written generically against `yaw`, so they behave correctly at yaw 0). Two
   things do need constraining:

   - ORBIT must not happen. Right-drag and shift-drag change yaw/pitch, which
     would show paper-doll sprites from an angle they were never drawn for.
   - PAN and ZOOM must stay inside the walls, or the player can drag the
     compound off screen into empty void.

   Constraining after the fact rather than intercepting the events keeps one
   set of camera controls in the codebase instead of two competing ones. */

let cameraConstrained = true;

/** Mirrors BASE_HALF in dungeon_scene.js, which does not export it. */
const BASE_HALF = 55;

/**
 * Point the orthographic frustum at the CURRENT viewport.
 *
 * `dungeon_scene.js` computes its aspect once at module evaluation and only
 * corrects it on a resize event. If the viewport was a different shape when the
 * module happened to load — which is normal for an embedded or freshly-opened
 * pane — the frustum stays wrong until the window is resized, and everything
 * derived from it (notably minCompoundZoom) is wrong with it. Call this before
 * framing the compound rather than trusting the load-time value.
 */
export function resizeGuildCamera() {
  const canvas = renderer?.domElement;
  const w = canvas?.clientWidth || window.innerWidth;
  const h = canvas?.clientHeight || window.innerHeight;
  const aspect = (w && h) ? w / h : 1;
  cam.left = -BASE_HALF * aspect;
  cam.right = BASE_HALF * aspect;
  cam.top = BASE_HALF;
  cam.bottom = -BASE_HALF;
  cam.updateProjectionMatrix();
}

/** Turn the constraint off to free-look while designing. Not for shipping. */
export function setCameraConstrained(on) { cameraConstrained = on; }
export function isCameraConstrained() { return cameraConstrained; }

/** Smallest zoom that still frames the compound — prevents pulling out into
 *  void. Derived from the live frustum so it survives window resizes. */
/** How far the view may range: the compound plus part of its surroundings.
 *  Derived from OUTSKIRTS so widening the land automatically lets the camera
 *  pull back far enough to see it, instead of the two drifting apart. */
function viewBounds() {
  return {
    x: COMPOUND.halfW + OUTSKIRTS.margin * 0.55,
    z: COMPOUND.halfD + OUTSKIRTS.margin * 0.85
  };
}

export function minCompoundZoom() {
  const frustumHalfW = (cam.right - cam.left) / 2;
  const frustumHalfH = (cam.top - cam.bottom) / 2;
  const b = viewBounds();
  return Math.max(
    frustumHalfW / b.x,
    (frustumHalfH / Math.sin(CAM.pitch)) / b.z
  );
}

function constrainCamera() {
  if (camLock) {
    /* Dragging a building: hold the view still. The pan handler lives in
       dungeon_scene and cannot be selectively disabled, so its effect is
       undone each frame rather than prevented. */
    camTarget.set(camLock.x, 0, camLock.z);
    if (cam.zoom !== camLock.zoom) { cam.zoom = camLock.zoom; cam.updateProjectionMatrix(); }
    updateCam();
    return;
  }
  if (!cameraConstrained) return;

  /* Undo any orbit the shared handler applied this frame. */
  if (yaw !== CAM.yaw || pitch !== CAM.pitch) setYawPitch(CAM.yaw, CAM.pitch);

  const zMin = minCompoundZoom();
  if (cam.zoom < zMin) { cam.zoom = zMin; cam.updateProjectionMatrix(); }
  if (cam.zoom > 9) { cam.zoom = 9; cam.updateProjectionMatrix(); }

  /* How much of the compound is off-screen at this zoom — that, and only that,
     is how far panning is allowed to travel. When everything already fits, the
     margin is zero and the view stays centred. */
  const viewHalfW = (cam.right - cam.left) / 2 / cam.zoom;
  const viewHalfD = ((cam.top - cam.bottom) / 2 / cam.zoom) / Math.sin(CAM.pitch);
  const b = viewBounds();
  const marginX = Math.max(0, b.x - viewHalfW);
  const marginZ = Math.max(0, b.z - viewHalfD);

  camTarget.x = Math.max(-marginX, Math.min(marginX, camTarget.x));
  camTarget.z = Math.max(-marginZ, Math.min(marginZ, camTarget.z));
  camTarget.y = 0;
  updateCam();
}

/* ---------------- frame update ---------------- */

let _t = 0;

/** Advance hero animation and torch flicker. Call once per rendered frame. */
export function updateGuildScene(dt) {
  _t += dt;
  constrainCamera();

  /* Sprites whose image has now arrived get their true aspect applied. */
  if (spritePending.length) {
    spritePending = spritePending.filter(p => {
      if (p.tex.image && p.tex.image.width) { p.fix(); return false; }
      return true;
    });
  }
  /* Heroes stand still in Phase 0 (see setHeroes), but update() still has to
     run — it is what swaps the composed texture in once it finishes loading
     and unhides the sprite. */
  for (const h of heroes) h.sprite.update(dt);
  for (const t of torches) {
    /* Same character as the dungeon's torch flicker: two detuned sines so the
       period never reads as a loop. */
    const f = 0.86 + 0.14 * Math.sin(_t * 7.3 + t.phase) + 0.06 * Math.sin(_t * 17.1 + t.phase * 2);
    t.light.intensity = t.base * f;
  }
}

/* ---------------- teardown ---------------- */

export function disposeGuildScene() {
  clearHeroes();
  /* Hand the shared scene back the way the dungeon expects it: a null
     background lets renderFrame's clear colour show through again. The next
     buildScene() call re-applies its own theme lighting and fog. */
  scene.background = null;
  if (root) {
    scene.remove(root);
    root.traverse(o => {
      if (o.geometry && (o.isMesh || o.isLine || o.isLineSegments)) o.geometry.dispose();
      if (o.isLineSegments && o.material) o.material.dispose();
    });
  }
  for (const g of ownedGeos) g.dispose();
  for (const m of ownedMats) m.dispose();
  for (const t of ownedTextures) t.dispose();
  ownedGeos = []; ownedMats = []; ownedTextures = [];
  structureNodes = {}; torches = []; root = null; hoverId = null;
}
