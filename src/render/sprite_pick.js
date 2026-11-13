/**
 * Pixel-accurate creature picking: what is actually drawn under the cursor.
 *
 * The cursor ray is cast against each creature's body sprite (three.js raycasts
 * sprites as their camera-facing quad, honouring `center` and scale, and gives
 * back the hit's texture coordinate). That coordinate goes through the frame's
 * offset/repeat into the sheet, and only an opaque pixel there counts, so the
 * clear margin round a body, and the floor tile under it, don't. The nearest hit
 * to the camera wins. Alpha masks are read once per texture and cached.
 */

import * as THREE from 'three';
import { visualOf } from '../game/entities.js';

const ALPHA_MIN = 40;    // a pixel this opaque is the body
const SLOP = 1;          // also accept a hit this many sheet pixels off the body edge, so thin limbs aren't fiddly

const _masks = new WeakMap();   // texture -> { version, mask: { w, h, data } | null (unreadable) }
const _uv = new THREE.Vector2();
const _hits = [];

function maskOf(tex) {
  const img = tex && tex.image;
  if (!img) return null;
  /* keyed on the texture's version, which three bumps on every needsUpdate: a composed
     hero sheet is a canvas redrawn after load and on gear changes, so it is re-read then */
  const hit = _masks.get(tex);
  if (hit && hit.version === tex.version) return hit.mask;
  let mask = null;
  try {
    const w = img.width || img.videoWidth, h = img.height || img.videoHeight;
    if (w && h && typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      mask = { w, h, data: ctx.getImageData(0, 0, w, h).data };
    }
  } catch { mask = null; }      // a tainted or not-yet-loaded image: fall back to the quad
  if (img.complete !== false) _masks.set(tex, { version: tex.version, mask });
  return mask;
}

/** Is the sprite's sheet opaque at the quad coordinate `uv` (0..1 across the quad)? */
export function opaqueAt(tex, uv) {
  const mask = maskOf(tex);
  if (!mask) return true;                  // can't read it: the quad hit stands
  _uv.copy(uv);
  if (tex.matrixAutoUpdate) tex.updateMatrix();
  /* transformUv applies the frame's offset/repeat AND the flipY flip, so its result
     is already top-down in image rows; flipping again mirrored every body top to
     bottom (unnoticed on a rat drawn mid-frame, a hawk's pick floated above it). */
  tex.transformUv(_uv);
  const px = Math.floor(_uv.x * mask.w);
  const py = Math.floor(_uv.y * mask.h);
  for (let dy = -SLOP; dy <= SLOP; dy++) {
    for (let dx = -SLOP; dx <= SLOP; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) continue;
      if (mask.data[(y * mask.w + x) * 4 + 3] > ALPHA_MIN) return true;
    }
  }
  return false;
}

function bodyOf(e) {
  const v = visualOf(e);
  const mesh = v && v.anim && v.anim.mesh;
  return mesh && mesh.isSprite ? mesh : null;
}

/* drawn at all: the sprite and every parent visible (fogged monsters aren't) */
function shown(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * The creature whose drawn pixels are under the ray, or null. `raycaster` must
 * already be set from the camera (setFromCamera), since sprites need it.
 */
export function pickUnit(game, raycaster) {
  if (!game) return null;
  const units = [];
  for (const m of game.monsters || []) if (m && m.active && m.data && m.data.hp > 0 && !m.dead) units.push(m);
  for (const h of game.heroes || []) if (h && h.data) units.push(h);
  let best = null, bestD = Infinity;
  for (const u of units) {
    const mesh = bodyOf(u);
    if (!mesh || !shown(mesh) || !mesh.material || !mesh.material.map) continue;
    _hits.length = 0;
    mesh.raycast(raycaster, _hits);
    for (const hit of _hits) {
      if (hit.distance >= bestD || !hit.uv) continue;
      if (!opaqueAt(mesh.material.map, hit.uv)) continue;
      best = u; bestD = hit.distance;
    }
  }
  return best;
}
