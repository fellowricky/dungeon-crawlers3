/**
 * Per-monster colour balance (shadows / midtones / highlights).
 *
 * The bestiary editor writes a `colorBalance` block onto each monsters.json
 * record; this module is the single implementation of what that block *means*,
 * shared by the editor preview and by the in-game sprite loader so the two
 * can't drift apart.
 *
 * Deliberately free of any THREE import — it is pure pixel math plus a canvas
 * cache, so it can run in the editor page as well as the game.
 */

export function getDefaultColorBalance() {
  return {
    shadows: { r: 0, g: 0, b: 0 },
    midtones: { r: 0, g: 0, b: 0 },
    highlights: { r: 0, g: 0, b: 0 },
    preserveLuminosity: true
  };
}

const ZONES = ['shadows', 'midtones', 'highlights'];
const CHANNELS = ['r', 'g', 'b'];

/** True when the balance is a no-op, so callers can take the cheap path. */
export function isIdentityColorBalance(cb) {
  if (!cb) return true;
  for (const z of ZONES) {
    const zone = cb[z];
    if (!zone) continue;
    for (const ch of CHANNELS) {
      if (Number(zone[ch]) || 0) return false;
    }
  }
  return true;
}

/** Stable cache key for a balance block (identity collapses to ''). */
export function colorBalanceKey(cb) {
  if (isIdentityColorBalance(cb)) return '';
  const parts = ZONES.map(z => CHANNELS.map(ch => Number(cb?.[z]?.[ch]) || 0).join(','));
  return parts.join('|') + (cb?.preserveLuminosity === false ? '|raw' : '|lum');
}

/**
 * Photoshop-style colour balance on one pixel.
 * Each zone's push is weighted by how much the pixel's luminance belongs to
 * that zone; with preserveLuminosity the result is renormalised back to the
 * original brightness so only hue/tint moves.
 */
export function applyColorBalanceToPixel(r, g, b, cb) {
  let nr = r;
  let ng = g;
  let nb = b;

  const origLuminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const normalizedLum = origLuminance / 255;

  const sWeight = Math.pow(1 - normalizedLum, 2);
  const mWeight = 1 - 4 * Math.pow(normalizedLum - 0.5, 2);
  const hWeight = Math.pow(normalizedLum, 2);

  const maxM = Math.max(0, mWeight);

  const dr = (cb.shadows.r * sWeight) + (cb.midtones.r * maxM) + (cb.highlights.r * hWeight);
  const dg = (cb.shadows.g * sWeight) + (cb.midtones.g * maxM) + (cb.highlights.g * hWeight);
  const db = (cb.shadows.b * sWeight) + (cb.midtones.b * maxM) + (cb.highlights.b * hWeight);

  nr = Math.max(0, Math.min(255, nr + dr));
  ng = Math.max(0, Math.min(255, ng + dg));
  nb = Math.max(0, Math.min(255, nb + db));

  if (cb.preserveLuminosity) {
    const newLuminance = 0.299 * nr + 0.587 * ng + 0.114 * nb;
    if (newLuminance > 0) {
      const scale = origLuminance / newLuminance;
      nr = Math.max(0, Math.min(255, nr * scale));
      ng = Math.max(0, Math.min(255, ng * scale));
      nb = Math.max(0, Math.min(255, nb * scale));
    }
  }

  return [Math.round(nr), Math.round(ng), Math.round(nb)];
}

/** In-place recolour of a full ImageData buffer. Skips near-transparent pixels. */
export function applyColorBalanceToImageData(imgData, cb) {
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    const [nr, ng, nb] = applyColorBalanceToPixel(data[i], data[i + 1], data[i + 2], cb);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  return imgData;
}

/* One balanced canvas per (spritePath, balance) pair. Textures are still made
   per-entity (each mesh mutates tex.repeat to face left/right), but the costly
   decode + per-pixel pass happens once. */
const _canvasCache = new Map();

/**
 * Draw `img` into an offscreen canvas with the balance baked in.
 * Returns the same canvas for repeat calls with the same key.
 */
export function getBalancedCanvas(img, cb, cacheKey) {
  if (cacheKey && _canvasCache.has(cacheKey)) return _canvasCache.get(cacheKey);

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    applyColorBalanceToImageData(imgData, cb);
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    // Tainted canvas (file:// or cross-origin sprite) — fall back to the
    // untinted draw rather than losing the sprite entirely.
    console.warn('[colorBalance] could not read sprite pixels, using raw sprite', e);
  }

  if (cacheKey) _canvasCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Load `path` and hand back a canvas with `cb` applied.
 * `onReady(canvas)` is always called asynchronously; `onError` on load failure.
 */
export function loadBalancedCanvas(path, cb, onReady, onError) {
  const key = path + '#' + colorBalanceKey(cb);
  const cached = _canvasCache.get(key);
  if (cached) {
    queueMicrotask(() => onReady(cached));
    return;
  }
  const img = new Image();
  img.onload = () => {
    const canvas = getBalancedCanvas(img, cb, key);
    if (canvas) onReady(canvas);
    else if (onError) onError();
  };
  img.onerror = () => { if (onError) onError(); };
  img.src = path;
}
