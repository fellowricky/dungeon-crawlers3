/**
 * Shared frame-sliced sprite-atlas playback.
 *
 * Three sprite paths need identical maths:
 *   - monsters              (buildMonsterAnimator, entities.js)
 *   - druid wild-shape forms (BeastSprite, sprite_animator.js)
 *   - familiars/companions   (WolfSprite,  sprite_animator.js)
 *
 * They used to be independent, and the monster path was the only one that could
 * animate at all. Keeping the frame selection, UV mapping, idle phase and impact
 * timing here means a fix lands once for all three rather than drifting apart —
 * the cols/UV-window bug that shipped on the goblin was exactly this class of
 * problem, and it would have been easy to reintroduce in a second copy.
 *
 * An `animations` config entry is the same shape everywhere:
 *   { sprite, frameWidth, frameHeight, cols, rows, fps, loop, frames? }
 * `frames` is an optional explicit index sequence (row-major) — e.g. [0,1,2,1]
 * ping-pongs a 3-frame wing-beat — and when omitted the whole sheet plays in
 * order.
 */

import * as THREE from 'three';

/* How far into a one-shot attack the blow lands. Sheets are authored as
   windup -> strike -> recover, so the contact pose sits about two thirds in;
   firing damage on frame 0 shows the number before the creature has moved. */
export const ATTACK_IMPACT_FRAC = 2 / 3;

/** Number of playback steps in one cycle (sequence length, or the whole sheet). */
export function atlasCount(cfg) {
  if (!cfg) return 0;
  const seq = cfg.frames && cfg.frames.length ? cfg.frames : null;
  return seq ? seq.length : (cfg.cols || 1) * (cfg.rows || 1);
}

/** Sheet cell to display for playback step `step` (handles `frames` sequences). */
export function atlasSheetIndex(cfg, step) {
  const count = atlasCount(cfg);
  if (count <= 0) return 0;
  const seq = cfg.frames && cfg.frames.length ? cfg.frames : null;
  const i = ((step % count) + count) % count;
  const raw = seq ? seq[i] : i;
  const last = (cfg.cols || 1) * (cfg.rows || 1) - 1;
  return Math.max(0, Math.min(raw, last));
}

/** One full cycle in seconds, or 0 when the config can't play. */
export function atlasDuration(cfg) {
  const count = atlasCount(cfg);
  if (!(count > 0) || !(cfg && cfg.fps > 0)) return 0;
  return count / cfg.fps;
}

/** Seconds from play('attack') to the contact pose. 0 when there is no sheet. */
export function attackImpactDelay(cfg) {
  return atlasDuration(cfg) * ATTACK_IMPACT_FRAC;
}

/** Point a THREE texture at one cell. `flipX` mirrors horizontally in place. */
export function applyAtlasUV(tex, cfg, sheetIndex, flipX = false) {
  if (!tex) return;
  const cols = cfg.cols || 1;
  const rows = cfg.rows || 1;
  const col = sheetIndex % cols;
  const row = Math.floor(sheetIndex / cols);
  const iw = 1 / cols;
  const ih = 1 / rows;
  if (flipX) {
    tex.repeat.set(-iw, ih);
    tex.offset.set((col + 1) * iw, (rows - 1 - row) * ih);
  } else {
    tex.repeat.set(iw, ih);
    tex.offset.set(col * iw, (rows - 1 - row) * ih);
  }
}

/* ---------------- per-instance idle phase ----------------
   Successive phases spread by the golden-ratio conjugate. Plain Math.random()
   clumps: a room's creatures spawn back-to-back, so two of five drawing 0.06
   and 0.09 land on the same frame and still look synchronised. This is a
   low-discrepancy sequence, so any run of consecutive spawns is spread about as
   evenly as it can be while never repeating a pattern.

   Seeded with a constant, not Math.random(): drawing at import time would
   consume a value from the global RNG and shift every unseeded consumer
   downstream (the spawn picker among them). */
const PHI_CONJUGATE = 0.618033988749895;
let animPhaseSeq = 0;

export function nextAnimPhase() {
  animPhaseSeq = (animPhaseSeq + PHI_CONJUGATE) % 1;
  return animPhaseSeq;
}

/**
 * Playback step for a looping/one-shot animation.
 * `phase` (0..1) offsets looping states only — a one-shot attack must start on
 * frame 0 every time it is played, and callers rely on `step >= count` to know
 * the one-shot has finished.
 */
export function atlasStep(cfg, time, phase = 0) {
  const count = atlasCount(cfg);
  if (count <= 0 || !(cfg.fps > 0)) return 0;
  const off = cfg.loop ? phase * count : 0;
  return Math.floor(time * cfg.fps + off);
}

/* ---------------- body anchor ----------------
   Where the creature actually sits inside its frame. Sheets are padded to give
   an attack swing room — the H3 pipeline's 192px frames park the body ~24px
   left of centre — so anchoring the quad at (0.5, 0) plants the padding on the
   tile, not the creature. Worse, the UV flip mirrors the frame about its own
   centre, so a body d off-centre lurches 2d sideways every time it turns.

   The anchor is measured from the FIRST playback frame of a sheet: x is the
   alpha-weighted centroid (a bounding box would let a lone spear tip drag the
   body off the tile), y is the lowest opaque row, i.e. the feet. Both are
   fractions of the frame, which is the space THREE.Sprite.center works in. */

const ALPHA_INK = 15;          // alpha above this counts as art, matching the despeckle floor
const DEFAULT_ANCHOR = Object.freeze({ x: 0.5, y: 0 });
const _anchorCache = new WeakMap();   // image -> Map(cacheKey -> anchor)

/**
 * Measure the body anchor of one frame. Returns `{ x, y }` in frame fractions,
 * or null when it cannot be measured (headless, or an empty frame) so the
 * caller can fall back rather than anchor on garbage.
 */
export function measureFrameAnchor(image, cfg, step = 0) {
  if (!image || !cfg || typeof document === 'undefined') return null;
  const totalW = image.naturalWidth || image.width;
  const totalH = image.naturalHeight || image.height;
  if (!totalW || !totalH) return null;
  const fw = Math.min(totalW, cfg.frameWidth || totalW);
  const fh = Math.min(totalH, cfg.frameHeight || totalH);
  const cols = cfg.cols || 1;
  const rows = cfg.rows || 1;
  const sheetIndex = atlasSheetIndex(cfg, step);
  const key = `${fw}x${fh}/${cols}x${rows}#${sheetIndex}`;
  let perImage = _anchorCache.get(image);
  if (perImage && perImage.has(key)) return perImage.get(key);

  let anchor = null;
  try {
    const sx = (sheetIndex % cols) * fw;
    const sy = Math.floor(sheetIndex / cols) * fh;
    const cv = document.createElement('canvas');
    cv.width = fw; cv.height = fh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    ctx.drawImage(image, sx, sy, fw, fh, 0, 0, fw, fh);
    const d = ctx.getImageData(0, 0, fw, fh).data;
    let mass = 0, mx = 0, bottom = -1;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const a = d[(y * fw + x) * 4 + 3];
        if (a <= ALPHA_INK) continue;
        mass += a; mx += a * (x + 0.5);
        bottom = y;
      }
    }
    if (mass > 0) anchor = { x: mx / mass / fw, y: (fh - 1 - bottom) / fh };
  } catch (e) {
    anchor = null;
  }
  if (!perImage) { perImage = new Map(); _anchorCache.set(image, perImage); }
  perImage.set(key, anchor);
  return anchor;
}

/**
 * The anchor to use while `state` is showing. `textures` is the loaded map
 * `{ state: { tex, cfg } }` where each cfg may carry a measured `anchor` and
 * optional authored `anchorX` / `anchorY` overrides.
 *
 * Every state anchors on the IDLE sheet's measurement when the two sheets
 * share a frame size: they come from the same base art, and a lunge that
 * carries the body forward in the attack frames should read as a lunge, not
 * be re-centred away. A sheet with its own frame size is measured on its own.
 */
export function resolveAtlasAnchor(textures, state) {
  const own = textures && textures[state];
  if (!own || !own.cfg) return DEFAULT_ANCHOR;
  const idle = textures.idle;
  const sameFrame = idle && idle.cfg
    && idle.cfg.frameWidth === own.cfg.frameWidth
    && idle.cfg.frameHeight === own.cfg.frameHeight;
  const src = (sameFrame ? idle : own).cfg;
  const measured = src.anchor || own.cfg.anchor || DEFAULT_ANCHOR;
  const x = src.anchorX != null ? src.anchorX : measured.x;
  const y = src.anchorY != null ? src.anchorY : measured.y;
  return { x, y };
}

/**
 * Plant the quad on its anchor. The UV flip mirrors the frame about its
 * centre, so the anchor mirrors with it — that is what stops the turn lurch.
 */
export function applyAtlasAnchor(mesh, anchor, flipX = false) {
  if (!mesh || !mesh.center) return;
  const a = anchor || DEFAULT_ANCHOR;
  mesh.center.set(flipX ? 1 - a.x : a.x, a.y);
}

/* ---------------- shared sheet textures ----------------
   Every animated creature used to load its own copy of its sheet: six kobolds
   in a room were six image decodes and six GPU uploads of the same 3648×192
   PNG (~2.8 MB of texture memory each), and a load hitch on every spawn. The
   sheet is now fetched and decoded ONCE per URL and each instance receives a
   clone(): clones share the image and the THREE `source`, so the renderer
   uploads the pixels a single time and every instance still gets its own
   repeat/offset for the frame it is showing. Filters and colour space are set
   on the base BEFORE cloning so all clones share one GL cache key. */

const _sharedSheets = new Map();   // key -> { base, ready, failed, waiters }
let _sharedLoader = null;

function _sheetEntry(key) {
  let e = _sharedSheets.get(key);
  if (!e) { e = { base: null, ready: false, failed: false, waiters: [] }; _sharedSheets.set(key, e); }
  return e;
}
function _prepBase(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
function _settle(e, ok) {
  e.ready = ok; e.failed = !ok;
  const w = e.waiters; e.waiters = [];
  for (const { onReady, onError } of w) {
    if (ok) onReady(e.base.clone());
    else if (onError) onError();
  }
}
function _subscribe(e, onReady, onError) {
  if (e.ready) { onReady(e.base.clone()); return; }
  if (e.failed) { if (onError) onError(); return; }
  e.waiters.push({ onReady, onError });
}

/** Load `url` once; `onReady` receives a clone of the shared texture. */
export function sharedSheetTexture(url, onReady, onError) {
  if (!url) { if (onError) onError(); return; }
  const e = _sheetEntry(url);
  if (!e.base) {
    if (!_sharedLoader) _sharedLoader = new THREE.TextureLoader();
    e.base = _prepBase(_sharedLoader.load(url, () => _settle(e, true), undefined, () => _settle(e, false)));
  }
  _subscribe(e, onReady, onError);
}

/** Same sharing for a sheet produced by a custom loader (the colour-balanced
    canvas path): `produce(onTexture, onFail)` is called once per `key`. */
export function sharedSheetFromLoader(key, produce, onReady, onError) {
  const e = _sheetEntry(key);
  if (!e.base && !e.failed && !e.loading) {
    e.loading = true;
    produce((tex) => { e.base = _prepBase(tex); _settle(e, true); }, () => _settle(e, false));
  }
  _subscribe(e, onReady, onError);
}

/** Warm the cache without needing a texture back. */
export function warmSharedSheet(url) {
  sharedSheetTexture(url, () => {}, () => {});
}

/** Drop every shared sheet whose key `keep(key)` rejects, freeing its GPU
    memory. Called on level load with the floor's roster plus the party's own
    companions, so a long session does not accumulate every biome it visited. */
export function evictSharedSheets(keep) {
  let n = 0;
  for (const [key, e] of _sharedSheets) {
    if (keep(key)) continue;
    if (e.base) e.base.dispose();
    _sharedSheets.delete(key);
    n++;
  }
  return n;
}

export function sharedSheetKeys() { return Array.from(_sharedSheets.keys()); }
