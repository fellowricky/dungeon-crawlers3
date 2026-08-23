/**
 * asset_pack.js — In-memory virtual asset bundle loader for itch.io and web distribution.
 *
 * When `assets.pak` is present (created by `scripts/pack_web.mjs`), this module
 * loads the entire virtual file archive and routes all asset requests (images,
 * sprites, audio) into in-memory Blob URLs, reducing thousands of individual
 * files into a single bundle to satisfy itch.io's 1,000-file limit.
 */

let packIndex = null;
let packBuffer = null;
const blobUrlCache = new Map();
const blobCache = new Map();

function normalizePath(p) {
  if (!p) return '';
  return p.replace(/^\.\//, '').replace(/^\//, '').replace(/\\/g, '/');
}

export function getAssetBlob(pathKey) {
  if (!packIndex || !packBuffer) return null;
  const clean = normalizePath(pathKey);
  const entry = packIndex[clean];
  if (!entry) return null;
  if (blobCache.has(clean)) return blobCache.get(clean);

  const [offset, size, mime] = entry;
  const slice = packBuffer.slice(offset, offset + size);
  const blob = new Blob([slice], { type: mime || 'image/png' });
  blobCache.set(clean, blob);
  return blob;
}

export function getAssetUrl(pathKey) {
  if (!packIndex || !packBuffer) return null;
  const clean = normalizePath(pathKey);
  if (blobUrlCache.has(clean)) return blobUrlCache.get(clean);

  const blob = getAssetBlob(clean);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  blobUrlCache.set(clean, url);
  return url;
}

export async function initAssetPack() {
  if (typeof window === 'undefined') return;

  try {
    const res = await fetch('./assets.pak');
    if (!res.ok) {
      // In dev mode or when assets.pak is absent, fallback to regular individual files
      return;
    }
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'PAK1') {
      console.warn('[asset_pack] Invalid magic header in assets.pak');
      return;
    }
    const indexLen = view.getUint32(4, true);
    const indexBytes = new Uint8Array(buf, 8, indexLen);
    const indexJson = new TextDecoder('utf-8').decode(indexBytes);
    packIndex = JSON.parse(indexJson);
    packBuffer = buf.slice(8 + indexLen);

    console.log(`[asset_pack] Loaded ${Object.keys(packIndex).length} virtual assets from assets.pak!`);

    // Hook window.fetch so fetch('sounds/...') or fetch('dcss/...') returns the virtual blob
    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const urlStr = typeof input === 'string' ? input : input?.url;
      if (urlStr) {
        const clean = normalizePath(urlStr);
        const blob = getAssetBlob(clean);
        if (blob) {
          const mime = packIndex[clean]?.[2] || 'application/octet-stream';
          return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': mime }
          });
        }
      }
      return origFetch.apply(this, arguments);
    };

    // Hook HTMLImageElement.prototype.src so <img src="./dcss/..."> and new Image().src resolve to Blob URLs
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (srcDesc && srcDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set(val) {
          if (typeof val === 'string') {
            const blobUrl = getAssetUrl(val);
            srcDesc.set.call(this, blobUrl || val);
          } else {
            srcDesc.set.call(this, val);
          }
        },
        get() {
          return srcDesc.get.call(this);
        },
        configurable: true
      });
    }
  } catch (err) {
    console.log('[asset_pack] Running in direct-file mode.');
  }
}
