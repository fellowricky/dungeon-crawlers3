/**
 * TREE FOLIAGE — leaf cards for bare tree models.
 *
 * Image-to-3D generators can't make leaves: a canopy comes out as smooth solid
 * blobs. So trees are generated BARE (trunk and branches, which they do well)
 * and the foliage is added here: clusters of crossed, alpha-cut leaf cards
 * around the branch ends, one merged geometry per tree model, drawn instanced
 * with the same transforms as the trunks.
 *
 *  - Cluster centres come from the trunk mesh itself (canopyPoints): voxelise
 *    the vertices, favour branch ends (voxels with few occupied neighbours) and
 *    the outer, upper crown, then spread them with farthest-point sampling.
 *  - Card normals point out from the crown centre instead of along each card,
 *    and the shader never flips them for back faces, so the crown shades like
 *    one rounded volume rather than a heap of paper.
 *  - The leaf texture is grey-scale and tinted by FOLIAGE[key].tint, so one
 *    texture serves several species. It is drawn procedurally for now; a
 *    generated leaf-cluster image could replace it (not wired up yet).
 *  - style 'conifer' (spruce, fir, pine) swaps in needle sprays that lie flat
 *    along the branches, taper up the cone, and shade with cone normals.
 *  - style 'willow' replaces cards with curved ribbons: each leaves a branch,
 *    arcs out and over, then falls in a long curtain, carrying a hanging-withy
 *    texture of its own, shaded by vertex colour and swaying from the root down.
 *
 * Which models get foliage, and how, is FOLIAGE below (keyed by prop key).
 */
import * as THREE from 'three';
import { cutawayPatch } from './wall_cutaway.js';
import { propBlendPatch } from './dungeon_materials.js';

/* Per tree model. size = card edge as a fraction of tree height; minH = lowest
   foliage as a fraction of height; clusters = how many (0 = from crown size). */
export const FOLIAGE = {
  elm: { tint: 0x5c723e, size: 0.15, minH: 0.30, clusters: 0, cards: 3, push: 0.35 },
  /* birch: slender, fine twigs from low down; small, light, yellow-green */
  birch: { tint: 0x768548, size: 0.11, minH: 0.42, clusters: 0, cards: 3, push: 0.30 },
  /* hawthorn: low wide gnarled crown; dense small dark clusters */
  hawthorn: { tint: 0x56693a, size: 0.13, minH: 0.36, clusters: 0, cards: 4, push: 0.30 },
  /* oak: massive trunk, broad crown; the biggest, darkest clusters */
  oak: { tint: 0x5c7140, size: 0.19, minH: 0.38, clusters: 0, cards: 3, push: 0.40 },
  /* pollarded: a ball of shoots on a short trunk; leaves only up top */
  pollarded: { tint: 0x66793f, size: 0.14, minH: 0.44, clusters: 0, cards: 3, push: 0.30 },
  /* conifers (3d/Forest): needle sprays laid flat along the branches, tapering
     up the cone (style 'conifer' in foliageGeometry), dark blue-green */
  spruce: { style: 'conifer', tint: 0x40573f, size: 0.16, minH: 0.12, clusters: 160, cards: 4, push: 0.25 },
  fir: { style: 'conifer', tint: 0x44603f, size: 0.15, minH: 0.14, clusters: 160, cards: 4, push: 0.25 },
  /* scots pine: crown in the top half only; bare dead limbs below are right for the species */
  pine: { style: 'conifer', tint: 0x4f6440, size: 0.17, minH: 0.45, clusters: 110, cards: 4, push: 0.25 },
  /* snowfield (3d/frost borrows the Forest models): the same conifers, colder
     and darker underneath, with `snow` laid on the upward faces of the sprays */
  snowspruce: { style: 'conifer', tint: 0x34483f, size: 0.16, minH: 0.12, clusters: 160, cards: 4, push: 0.25, snow: 0.85 },
  snowfir: { style: 'conifer', tint: 0x374c3f, size: 0.15, minH: 0.14, clusters: 160, cards: 4, push: 0.25, snow: 0.85 },
  snowpine: { style: 'conifer', tint: 0x404f3c, size: 0.17, minH: 0.45, clusters: 110, cards: 4, push: 0.25, snow: 0.7 },
  /* weeping willow (3d/Moor), for the moor, mire and sporewood. size = ribbon
     width; clusters = ribbons; segs = bends per ribbon; reach = how far past
     its branch a ribbon can carry; radius = the widest the curtain gets;
     bark = tint on the model's own material, so the limbs sit back in the crown.
     At the elm's tint it renders about 1.2x the elm, so a brighter tint soon looks
     pale in game (0x98a84e measured 2.3x the moor's other trees). Match new tints
     by measuring beside the neighbours in theme light, not from a lone preview. */
  swamptree: { style: 'willow', tint: 0x61723c, size: 0.2, minH: 0.5, clusters: 130, cards: 1, push: 0, segs: 6, reach: 0.22, radius: 0.56, bark: 0x8c8378 },
  /* the same tree in the sporewood, picking up its emerald glow */
  sporewillow: { style: 'willow', tint: 0x3e8363, size: 0.2, minH: 0.5, clusters: 130, cards: 1, push: 0, segs: 6, reach: 0.22, radius: 0.56, bark: 0x7a7a80 }
};

/* Size of each species relative to the others when it stands in a tree wall.
   The generated models are all normalised to ~1 unit tall, so without this a
   hawthorn stands as tall as an oak. */
export const TREE_SCALE = {
  oak: 1.25, hawthorn: 0.85, pollarded: 0.95, birch: 1.05,
  swamptree: 1.15, sporewillow: 1.15,
  /* boneyard's dead trees (3d/Grim); no FOLIAGE entry, they stay bare */
  deadOak: 1.25, deadHawthorn: 0.85, deadSnag: 0.7, gallowsTree: 1.15
};

/**
 * Smooth 0..1 noise over map cells, for gathering a tree belt into copses (open
 * country: bare ground between stands, not an evenly thinned forest). `size` is
 * the noise's cell size in tiles. It takes nothing from the level's random
 * stream, so turning copses on leaves the rest of the level as it was.
 */
export function copseNoise(x, y, seed = 0, size = 9) {
  const lattice = (ix, iy) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x / size, fy = y / size, ix = Math.floor(fx), iy = Math.floor(fy);
  const sm = t => t * t * (3 - 2 * t);
  const u = sm(fx - ix), v = sm(fy - iy);
  const top = lattice(ix, iy) * (1 - u) + lattice(ix + 1, iy) * u;
  const bot = lattice(ix, iy + 1) * (1 - u) + lattice(ix + 1, iy + 1) * u;
  return top * (1 - v) + bot * v;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Leaf-cluster centres for a bare tree. `pos` is a flat xyz array in the
 * tree's upright local space (y up, base at the bottom).
 * Returns { points: [[x,y,z]…], ax, az, y0, H } (ax/az = trunk axis).
 */
export function canopyPoints(pos, { cells = 48, minH = 0.30, clusters = 0 } = {}) {
  const n = pos.length / 3;
  let y0 = Infinity, y1 = -Infinity, mnx = Infinity, mnz = Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos[3 * i + 1];
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (pos[3 * i] < mnx) mnx = pos[3 * i];
    if (pos[3 * i + 2] < mnz) mnz = pos[3 * i + 2];
  }
  const H = (y1 - y0) || 1;
  // Trunk axis: the mean of the base ring.
  let ax = 0, az = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    if (pos[3 * i + 1] < y0 + 0.08 * H) { ax += pos[3 * i]; az += pos[3 * i + 2]; nb++; }
  }
  ax /= nb || 1; az /= nb || 1;

  // Voxelise: each occupied voxel keeps the mean of its vertices.
  const v = H / cells;
  const vox = new Map();
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const k = `${Math.floor((x - mnx) / v)},${Math.floor((y - y0) / v)},${Math.floor((z - mnz) / v)}`;
    const e = vox.get(k);
    if (e) { e[0] += x; e[1] += y; e[2] += z; e[3]++; } else vox.set(k, [x, y, z, 1]);
  }

  const cand = [];
  for (const [k, e] of vox) {
    const c = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
    const h = (c[1] - y0) / H;
    if (h < minH) continue;
    const [i, j, l] = k.split(',').map(Number);
    let nbrs = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if ((dx || dy || dz) && vox.has(`${i + dx},${j + dy},${l + dz}`)) nbrs++;
    }
    const r = Math.hypot(c[0] - ax, c[2] - az) / H;
    // Branch ends have few occupied neighbours; favour them and the outer, upper crown.
    cand.push({ c, score: (nbrs <= 3 ? 1.5 : 0) + 2 * r + h });
  }
  if (!cand.length) return { points: [], ax, az, y0, H };
  cand.sort((a, b) => b.score - a.score);

  // Farthest-point sampling from the best voxel; better-ranked voxels win ties.
  const want = Math.min(cand.length, clusters || Math.max(24, Math.min(90, Math.floor(cand.length / 6))));
  const d = new Float64Array(cand.length).fill(Infinity);
  const points = [];
  let pick = 0;
  for (let s = 0; s < want; s++) {
    const p = cand[pick].c;
    points.push(p);
    let best = -1, bi = 0;
    for (let i = 0; i < cand.length; i++) {
      const q = cand[i].c;
      const dd = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (dd < d[i]) d[i] = dd;
      const w = d[i] * (1 - 0.4 * i / cand.length);
      if (w > best) { best = w; bi = i; }
    }
    pick = bi;
  }
  return { points, ax, az, y0, H };
}

/**
 * Merged leaf-card geometry for one tree, in the same local space as `trunkGeo`.
 * Deterministic: seeded from the vertex count, so every build looks the same.
 */
export function foliageGeometry(trunkGeo, cfg) {
  const attr = trunkGeo.getAttribute('position');
  const pos = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    pos[3 * i] = attr.getX(i); pos[3 * i + 1] = attr.getY(i); pos[3 * i + 2] = attr.getZ(i);
  }
  const { points, ax, az, y0, H } = canopyPoints(pos, cfg);
  const rng = mulberry32(attr.count * 2654435761);
  if (cfg.style === 'willow') return willowGeometry({ points, ax, az, y0, H }, cfg, rng);

  // Crown centre, for the volume normals.
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= points.length || 1; cy /= points.length || 1; cz /= points.length || 1;

  const P = [], N = [], UV = [], I = [];
  const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const corner = new THREE.Vector3(), out = new THREE.Vector3();
  for (const p of points) {
    // Push the cluster a little out from the trunk so leaves hang off the branch, not inside it.
    out.set(p[0] - ax, 0.25 * (p[1] - cy), p[2] - az);
    if (out.lengthSq() < 1e-8) out.set(rng() - 0.5, 0.3, rng() - 0.5);
    out.normalize();
    const conifer = cfg.style === 'conifer';
    /* Conifers taper: sprays near the base are the biggest, the tip's the smallest. */
    const hFrac = (p[1] - y0) / H;
    const taper = conifer ? 1.3 - 0.8 * hFrac : 1;
    const s = cfg.size * H * (0.8 + 0.45 * rng()) * taper;
    const c = [p[0] + out.x * s * cfg.push, p[1] + out.y * s * cfg.push, p[2] + out.z * s * cfg.push];
    const quad = Math.floor(rng() * 4);                   // one of the 2x2 texture variants
    const u0 = (quad & 1) * 0.5, v0 = (quad >> 1) * 0.5;
    /* direction out from the trunk, flat: a conifer spray runs along it */
    const radial = new THREE.Vector3(p[0] - ax, 0, p[2] - az);
    if (radial.lengthSq() < 1e-8) radial.set(rng() - 0.5, 0, rng() - 0.5);
    radial.normalize();
    for (let k = 0; k < cfg.cards; k++) {
      let tx, bx, sx = 1, sy = 1;
      if (conifer) {
        /* Needle sprays lie nearly flat and droop outward along the branch:
           card normal mostly up, tipped out; the spray (texture u) runs along
           the branch direction, a little fanned. */
        n.set(radial.x * 0.45, 1, radial.z * 0.45);
        n.x += (rng() - 0.5) * 0.35; n.z += (rng() - 0.5) * 0.35; n.normalize();
        const fan = (rng() - 0.5) * 0.9;
        t.copy(radial).applyAxisAngle(up, fan);
        t.addScaledVector(n, -t.dot(n)).normalize();
        b.crossVectors(n, t);
        tx = t.clone(); bx = b.clone();
        sx = 1.35; sy = 0.75;                                // sprays are long and narrow
      } else {
        // Random card orientation, leaning toward horizontal-ish and outward.
        n.set(rng() - 0.5, rng() * 0.9 + 0.1, rng() - 0.5).addScaledVector(out, 0.6).normalize();
        t.crossVectors(Math.abs(n.y) < 0.95 ? up : out, n).normalize();
        b.crossVectors(n, t);
        const ang = rng() * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        tx = t.clone().multiplyScalar(ca).addScaledVector(b, sa); bx = t.clone().multiplyScalar(-sa).addScaledVector(b, ca);
      }
      const base = P.length / 3, hs = s / 2;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        corner.set(c[0], c[1], c[2]).addScaledVector(tx, du * hs * sx).addScaledVector(bx, dv * hs * sy);
        P.push(corner.x, corner.y, corner.z);
        if (conifer) {
          /* Cone normals: out from the trunk axis, tipped up, so the crown
             shades like a cone that catches the light on its upper flanks. */
          out.set(corner.x - ax, 0, corner.z - az);
          if (out.lengthSq() < 1e-8) out.set(0, 1, 0); else out.normalize();
          out.y = 0.8; out.normalize();
        } else {
          // Volume normal: away from the crown centre, lifted a little so the top catches the sun.
          out.set(corner.x - cx, (corner.y - cy) + 0.35 * H * 0.3, corner.z - cz).normalize();
        }
        N.push(out.x, out.y, out.z);
        UV.push(u0 + (du + 1) * 0.25, v0 + (dv + 1) * 0.25);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/**
 * Willow curtains: one curved ribbon per canopy point. A ribbon leaves its
 * branch outward and slightly up, arcs over, then falls most of the way to the
 * ground, so the upward-reaching limbs of the model carry a drooping dome.
 * uv.y runs 0 at the branch to 1 at the tip: the texture and the sway both use it.
 */
function willowGeometry({ points, ax, az, y0, H }, cfg, rng) {
  const segs = cfg.segs || 5;
  const P = [], N = [], C = [], UV = [], I = [];
  const up = new THREE.Vector3(0, 1, 0);
  const radial = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3();
  const spine = new THREE.Vector3(), corner = new THREE.Vector3(), nrm = new THREE.Vector3();
  const crownY = y0 + 0.6 * H, maxR = cfg.radius * H;
  for (const p of points) {
    radial.set(p[0] - ax, 0, p[2] - az);
    const r0 = radial.length();
    if (r0 < 1e-6) radial.set(rng() - 0.5, 0, rng() - 0.5);
    radial.normalize();
    tangent.crossVectors(up, radial);

    /* A drape is short and hangs straight off its branch: the model's limbs
       reach upward, and without these they stick out of the dome like antlers. */
    const hFrac = (p[1] - y0) / H;
    const drape = rng() < (hFrac > 0.68 ? 0.55 : 0.2);
    /* Where it ends up: outer ribbons form the curtain, inner ones fill it. */
    const rEnd = Math.min(maxR, r0 + H * (drape ? 0.02 + 0.07 * rng() : 0.08 + cfg.reach * rng()));
    const reach = Math.max(0, rEnd - r0);
    const rise = H * (drape ? 0.02 : 0.015 + 0.05 * rng());
    /* Most fall almost to the ground, unevenly; some stop short, for layers. */
    const tipH = rng() < 0.72 ? 0.10 + 0.22 * rng() : 0.36 + 0.22 * rng();
    const fall = drape ? H * (0.2 + 0.22 * rng()) : Math.max(0.12 * H, p[1] - (y0 + tipH * H));
    /* A drape roots a little above its limb, so the leaves spill over it. */
    const lift = drape ? H * (0.04 + 0.07 * rng()) : 0;

    /* Turned off the tangent so no angle sees every ribbon edge-on. */
    across.copy(tangent).applyAxisAngle(up, (rng() - 0.5) * 1.7);
    const width = cfg.size * H * (0.8 + 0.4 * rng());
    const col = Math.floor(rng() * 4);                     // one of the four texture columns
    const flip = rng() < 0.5;                              // mirrored, for more variety from them
    const lean = H * 0.012 * (rng() < 0.5 ? -1 : 1), phase = rng() * 6.28;
    /* Some strands run yellower, some deeper: willows are never one green. */
    const warm = rng();
    const cr = 0.86 + 0.28 * warm, cg = 0.95 + 0.1 * warm, cb = 0.86 - 0.14 * warm;

    const base = P.length / 3;
    for (let i = 0; i <= segs; i++) {
      const s = Math.pow(i / segs, 1.35);                  // rows bunch up around the bend
      const a = Math.min(1, s / 0.38);                     // the arc is over by s = 0.38
      const out = reach * (1 - (1 - a) * (1 - a));
      const y = p[1] + lift + rise * Math.sin(Math.PI * a) - fall * Math.pow(s, 1.55);
      const side = lean * Math.sin(phase + s * 5) * s;
      spine.set(p[0], y, p[2]).addScaledVector(radial, out).addScaledVector(tangent, side);
      /* narrow at the root, so no ribbon shows a flat top edge; a drape widens fast */
      const hw = width * 0.5 * (0.45 + 0.55 * Math.min(1, s / (drape ? 0.16 : 0.3)));
      for (const e of [-1, 1]) {
        corner.copy(spine).addScaledVector(across, e * hw);
        P.push(corner.x, corner.y, corner.z);
        /* Dome normals: out from the crown and lifted, so the top catches the sun. */
        nrm.set(corner.x - ax, (corner.y - crownY) * 0.55 + 0.3 * H, corner.z - az).normalize();
        N.push(nrm.x, nrm.y, nrm.z);
        /* Baked shade: dark inside the curtain and low down, lighter at the tips. */
        const outer = Math.min(1, Math.hypot(corner.x - ax, corner.z - az) / (0.5 * H));
        const high = Math.min(1, Math.max(0, (corner.y - y0) / H));
        const shade = (0.52 + 0.4 * outer + 0.2 * high) * (1 + 0.14 * s);
        C.push(cr * shade, cg * shade, cb * shade);
        const left = (e < 0) !== flip;
        UV.push((col + (left ? 0.012 : 0.988)) / 4, s);
      }
      if (i < segs) {
        const q = base + i * 2;
        I.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/* ---------------- leaf texture ---------------- */

/** Four columns of hanging withies, top = the branch end, grey-scale for tinting.
 *  Strands are drawn bold on purpose: a ribbon is only ~30 px wide at game
 *  distance, so fine ones would average away. Returned as raw pixels with the
 *  colour of the empty texels set to the leaves' own grey, otherwise the
 *  mipmaps fade to black and every strand grows a dark outline. */
function makeWillowTexture() {
  const S = 1024, Q = S / 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rng = mulberry32(51423);
  g.lineCap = 'round';
  for (let q = 0; q < 4; q++) {
    const ox = q * Q;
    g.save();
    g.beginPath(); g.rect(ox, 0, Q, S); g.clip();
    const strands = 5 + (q & 1);
    for (let k = 0; k < strands; k++) {
      /* evenly spread with some wander; uneven lengths fringe the bottom edge
         and uneven starts break up the top one */
      const x0 = ox + Q * ((k + 0.5) / strands + (rng() - 0.5) * 0.09);
      const len = S * (0.62 + 0.36 * rng());
      const top = S * 0.09 * rng();
      const amp = Q * (0.018 + 0.03 * rng()), ph = rng() * 6.28, fq = 1.5 + rng() * 1.5;
      const at = y => x0 + amp * Math.sin(ph + (y / S) * fq * 6.28);
      /* The stem is thick and leaf-coloured, tapering to the tip: it is what
         survives minification, so a strand stays one line, not a row of dashes. */
      for (let y = top; y < len; y += 16) {
        const f = y / len, shade = (126 + 50 * f) | 0;
        g.strokeStyle = `rgb(${shade},${shade},${(shade * 0.92) | 0})`;
        g.lineWidth = 10 - 6 * f;
        g.beginPath(); g.moveTo(at(y), y); g.lineTo(at(y + 16), y + 16); g.stroke();
      }
      /* narrow leaves in pairs down the strand, hanging close to it */
      for (let y = top + 8 + rng() * 10; y < len; y += 12 + rng() * 6) {
        const f = y / len;
        for (const sgn of [-1, 1]) {
          if (rng() < 0.08) continue;                      // the odd gap keeps it from looking like rope
          const ll = Q * (0.135 + 0.05 * rng()) * (1 - 0.35 * f);
          const lw = Q * (0.026 + 0.008 * rng()) * (1 - 0.25 * f);
          const ang = sgn * (0.26 + 0.24 * rng());         // radians off straight down
          const x = at(y), shade = Math.min(255, (148 + 66 * f + rng() * 44) | 0);
          g.save();
          g.translate(x, y);
          g.rotate(-ang);
          g.fillStyle = `rgb(${shade},${shade},${(shade * 0.96) | 0})`;
          g.beginPath();
          g.moveTo(0, 0);
          g.quadraticCurveTo(lw, ll * 0.45, 0, ll);        // a lance, pointed at both ends
          g.quadraticCurveTo(-lw, ll * 0.45, 0, 0);
          g.fill();
          g.restore();
        }
      }
    }
    g.restore();
  }
  const px = g.getImageData(0, 0, S, S).data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) { px[i] = 176; px[i + 1] = 176; px[i + 2] = 168; }
  }
  const tex = new THREE.DataTexture(new Uint8Array(px.buffer), S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** 2x2 atlas of grey-scale leaf sprays on transparent ground (tinted by the material). */
function makeLeafTexture() {
  const S = 512, Q = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rng = mulberry32(90210);
  for (let q = 0; q < 4; q++) {
    const ox = (q & 1) * Q, oy = (q >> 1) * Q;
    g.save();
    g.beginPath(); g.rect(ox, oy, Q, Q); g.clip();
    // A few twigs fanning from the middle, leaves along them.
    const twigs = 5 + Math.floor(rng() * 3);
    for (let tw = 0; tw < twigs; tw++) {
      const a = rng() * Math.PI * 2, len = Q * (0.28 + rng() * 0.18);
      const sx = ox + Q / 2, sy = oy + Q / 2;
      g.strokeStyle = 'rgba(70,62,52,0.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len); g.stroke();
      const leaves = 6 + Math.floor(rng() * 4);
      for (let lf = 0; lf < leaves; lf++) {
        const f = 0.25 + 0.75 * lf / leaves;
        const px = sx + Math.cos(a) * len * f, py = sy + Math.sin(a) * len * f;
        const side = lf & 1 ? 1 : -1;
        const la = a + side * (0.6 + rng() * 0.5);
        const rx = Q * (0.045 + rng() * 0.025), ry = rx * (0.5 + rng() * 0.12);
        const lx = px + Math.cos(la) * rx * 0.9, ly = py + Math.sin(la) * rx * 0.9;
        const shade = 150 + Math.floor(rng() * 105);
        g.save();
        g.translate(lx, ly); g.rotate(la);
        g.fillStyle = `rgb(${shade},${shade},${shade})`;
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `rgba(${shade * 0.55 | 0},${shade * 0.55 | 0},${shade * 0.55 | 0},0.9)`;
        g.lineWidth = 1;
        g.stroke();
        g.beginPath(); g.moveTo(-rx * 0.9, 0); g.lineTo(rx * 0.9, 0); g.stroke();   // midrib
        g.restore();
      }
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 2x2 atlas of grey-scale conifer sprays: a twig along u (left to right,
 *  drooping a little) with short dense needles angled forward, side shoots. */
function makeNeedleTexture() {
  const S = 512, Q = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rng = mulberry32(31337);
  g.lineCap = 'round';
  for (let q = 0; q < 4; q++) {
    const ox = (q & 1) * Q, oy = (q >> 1) * Q;
    g.save();
    g.beginPath(); g.rect(ox, oy, Q, Q); g.clip();
    /* main twig plus 3-4 side shoots, each needled */
    const shoots = [[ox + Q * 0.06, oy + Q * 0.5, 0, Q * 0.88]];
    const nSide = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < nSide; i++) {
      const f = 0.2 + 0.6 * (i / nSide) + rng() * 0.08;
      const side = i & 1 ? 1 : -1;
      shoots.push([ox + Q * (0.06 + 0.88 * f), oy + Q * 0.5 + f * Q * 0.04, side * (0.55 + rng() * 0.3), Q * (0.28 - 0.12 * f)]);
    }
    for (const [sx, sy, ang, len] of shoots) {
      const steps = Math.max(6, Math.round(len / 3));
      let px = sx, py = sy;
      for (let k = 0; k < steps; k++) {
        const f = k / steps;
        const a = ang + f * 0.18;                       // a slight droop toward the tip
        const nx = px + Math.cos(a) * len / steps, ny = py + Math.sin(a) * len / steps;
        g.strokeStyle = 'rgba(60,52,44,0.95)'; g.lineWidth = 2 - f;
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
        /* needles both sides, angled forward, shortening toward the tip */
        for (const sgn of [-1, 1]) {
          const nl = Q * (0.07 - 0.03 * f) * (0.8 + rng() * 0.4);
          const na = a + sgn * (0.75 + rng() * 0.35);
          const shade = 140 + Math.floor(rng() * 110);
          g.strokeStyle = `rgb(${shade},${shade},${shade})`;
          g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); g.stroke();
        }
        px = nx; py = ny;
      }
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------- material ---------------- */

let _leafTex = null, _needleTex = null, _willowTex = null;
const _mats = new Map();
/* Seconds, for the willow's sway. The scene's per-frame tick writes this. */
export const foliageWind = { value: 0 };

/** Foliage material for a FOLIAGE entry (cached per style and tint). */
export function foliageMaterial(cfg) {
  const conifer = cfg.style === 'conifer';
  const willow = cfg.style === 'willow';
  const snow = cfg.snow || 0;
  const key = `${willow ? 'w' : conifer ? 'n' : 'l'}:${cfg.tint}:${snow}`;
  if (_mats.has(key)) return _mats.get(key);
  if (conifer && !_needleTex) _needleTex = makeNeedleTexture();
  if (willow && !_willowTex) _willowTex = makeWillowTexture();
  if (!conifer && !willow && !_leafTex) _leafTex = makeLeafTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: willow ? _willowTex : conifer ? _needleTex : _leafTex, color: cfg.tint, alphaTest: 0.5, side: THREE.DoubleSide,
    roughness: 0.82, metalness: 0, vertexColors: willow
  });
  /* Keep the crown-volume normals on BOTH faces: three flips them on back
     faces of double-sided materials, which would light the far side of every
     card from inside the tree. */
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')
    );
    if (willow) {
      /* Sway grows from nothing at the branch to full at the tip, each tree on
         its own phase. The offset is in the model's own units (about 1 tall). */
      sh.uniforms.uFoliageWind = foliageWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFoliageWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float swayW = uv.y * uv.y;
          #ifdef USE_INSTANCING
            float swayP = instanceMatrix[3].x * 1.3 + instanceMatrix[3].z * 0.9;
          #else
            float swayP = 0.0;
          #endif
          float swayY = position.y * 6.0;
          transformed.x += swayW * 0.014 * sin(uFoliageWind * 0.9 + swayP + swayY);
          transformed.z += swayW * 0.010 * sin(uFoliageWind * 0.7 + swayP * 1.4 + swayY * 1.2);
        }`);
      /* Mipmapping averages a thin strand's alpha below any fixed cut-off, so
         at game distance the curtain would dissolve. Relax the cut-off as the
         texture minifies: near, crisp leaves; far, solid strands. */
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
        float willowTexels = max(length(dFdx(vMapUv)), length(dFdy(vMapUv))) * 1024.0;
        if (diffuseColor.a < mix(0.5, 0.3, smoothstep(1.0, 10.0, willowTexels))) discard;`);
      /* Cutting a coarse mip at a hard threshold shows its texels as blocks, so
         read one level sharper than the hardware would pick. */
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, -1.2 )'));
    }
    /* Snow lies on whatever faces the sky. The volume normals point out of
       the crown, so use the card's own flat face instead (screen-space
       derivatives, which always face the camera, so a positive dot means the
       spray's top side is the one in view): flat sprays seen from above catch
       it, undersides and steep sprays stay green. A world-space value noise
       (about a tile across) gathers it into clumps with dark green between;
       the needle texture's own grain can't do that at game distance, where
       its mipmaps are mostly dark transparent texels. */
    if (snow > 0) {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 faceN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float lie = smoothstep(0.35, 0.85, dot(faceN, upV));
          vec3 wp = transpose(mat3(viewMatrix)) * (-vViewPosition) + cameraPosition;
          vec3 ip = floor(wp * 1.6), fp = fract(wp * 1.6);
          fp = fp * fp * (3.0 - 2.0 * fp);
          #define SNOWH(o) fract(sin(dot(ip + o, vec3(127.1, 311.7, 74.7))) * 43758.5453)
          float vn = mix(mix(mix(SNOWH(vec3(0,0,0)), SNOWH(vec3(1,0,0)), fp.x), mix(SNOWH(vec3(0,1,0)), SNOWH(vec3(1,1,0)), fp.x), fp.y),
                         mix(mix(SNOWH(vec3(0,0,1)), SNOWH(vec3(1,0,1)), fp.x), mix(SNOWH(vec3(0,1,1)), SNOWH(vec3(1,1,1)), fp.x), fp.y), fp.z);
          float clump = smoothstep(0.3, 0.6, vn);
          float grain = dot(diffuseColor.rgb, vec3(0.333)) / max(0.05, dot(diffuse, vec3(0.333)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.88, 0.93) * clamp(grain, 0.6, 1.1), lie * clump * ${snow.toFixed(2)});
        }`
      );
    }
  };
  mat.customProgramCacheKey = () => `foliage_card_volume_normals_${snow}${willow ? '_willow' : ''}`;
  propBlendPatch(mat);
  cutawayPatch(mat);   // leaves are part of the wall: the camera cutaway must fade them too
  _mats.set(key, mat);
  return mat;
}
