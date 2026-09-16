/**
 * asset_pack.js — In-memory virtual asset bundle loader for itch.io and web distribution.
 *
 * `scripts/pack_web.mjs` folds thousands of individual asset files into a few
 * `assets-N.pak` parts described by `assets.manifest.json`, so the upload
 * stays under itch.io's 1,000-file limit and its 200 MB single-file cap. This
 * module loads that manifest and routes asset requests (images, sprites,
 * audio) to in-memory Blob URLs.
 *
 * Parts are either eager (fetched at boot: sprites, icons, SFX — anything an
 * `<img src>` may ask for synchronously) or lazy (fetched on first request:
 * narration, which is only ever reached through `fetch()` and so can be
 * awaited). A lazy part must never hold an image; the packer enforces that.
 *
 * A manifest-less `assets.pak` (single part, self-describing 'PAK1' header)
 * is still understood so an older build keeps working.
 */

// path -> [partIndex, offset, size, mime]
let packIndex = null;
// partIndex -> ArrayBuffer once loaded
const partBuffers = new Map();
// partIndex -> { file, lazy }
let parts = [];
// partIndex -> in-flight load promise
const partLoads = new Map();
const blobUrlCache = new Map();
const blobCache = new Map();

function normalizePath(p) {
  if (!p) return '';
  let clean = p.replace(/^\.\//, '').replace(/^\//, '').replace(/\\/g, '/');
  // Callers reach the pak through two spellings of the same asset: raw paths
  // from `<img src>`, and percent-encoded ones from `fetch(encodeURI(path))`.
  // Index keys are raw, and nearly every sound file has spaces in its name, so
  // an encoded path has to be decoded here or it misses the index and falls
  // through to an individual file the packager already folded into assets.pak.
  if (clean.includes('%')) {
    try { clean = decodeURIComponent(clean); } catch { /* malformed: leave as-is */ }
  }
  return clean;
}

/** True when the pack ships this asset (loaded or not). Lets callers skip a
 *  probe that is guaranteed to 404 on the web, e.g. narration .wav vs .mp3. */
export function hasPackedAsset(pathKey) {
  return !!(packIndex && packIndex[normalizePath(pathKey)]);
}

function sliceEntry(clean, entry) {
  const [part, offset, size, mime] = entry;
  const buf = partBuffers.get(part);
  if (!buf) return null;
  const blob = new Blob([buf.slice(offset, offset + size)], { type: mime || 'image/png' });
  blobCache.set(clean, blob);
  return blob;
}

export function getAssetBlob(pathKey) {
  if (!packIndex) return null;
  const clean = normalizePath(pathKey);
  const entry = packIndex[clean];
  if (!entry) return null;
  if (blobCache.has(clean)) return blobCache.get(clean);
  return sliceEntry(clean, entry);
}

export function getAssetUrl(pathKey) {
  if (!packIndex) return null;
  const clean = normalizePath(pathKey);
  if (blobUrlCache.has(clean)) return blobUrlCache.get(clean);

  const blob = getAssetBlob(clean);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  blobUrlCache.set(clean, url);
  return url;
}

async function fetchBuffer(origFetch, file) {
  const res = await origFetch(file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/* Load one part, once. Concurrent callers share the same promise. */
function ensurePart(origFetch, part) {
  if (partBuffers.has(part)) return Promise.resolve(partBuffers.get(part));
  if (partLoads.has(part)) return partLoads.get(part);
  const p = fetchBuffer(origFetch, './' + parts[part].file)
    .then(buf => { partBuffers.set(part, buf); return buf; })
    .finally(() => partLoads.delete(part));
  partLoads.set(part, p);
  return p;
}

/* Async variant for the fetch hook: pulls in a lazy part on first use. */
async function getAssetBlobAsync(origFetch, clean) {
  const entry = packIndex[clean];
  if (!entry) return null;
  if (blobCache.has(clean)) return blobCache.get(clean);
  await ensurePart(origFetch, entry[0]);
  return sliceEntry(clean, entry);
}

/* Legacy single-file layout: 'PAK1' + uint32 index length + JSON index of
   path -> [offset, size, mime] + raw bytes. Rewritten into the part form. */
function loadLegacyPak(buf) {
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'PAK1') throw new Error('Invalid magic header in assets.pak');
  const indexLen = view.getUint32(4, true);
  const indexJson = new TextDecoder('utf-8').decode(new Uint8Array(buf, 8, indexLen));
  const legacy = JSON.parse(indexJson);
  packIndex = {};
  for (const [k, [offset, size, mime]] of Object.entries(legacy)) packIndex[k] = [0, offset, size, mime];
  parts = [{ file: 'assets.pak', lazy: false }];
  partBuffers.set(0, buf.slice(8 + indexLen));
}

export async function initAssetPack() {
  if (typeof window === 'undefined') return;
  const origFetch = window.fetch;

  try {
    const manifestRes = await origFetch('./assets.manifest.json');
    if (manifestRes.ok) {
      const manifest = await manifestRes.json();
      if (manifest.version !== 2 || !Array.isArray(manifest.parts) || !manifest.index) {
        console.warn('[asset_pack] Unrecognised assets.manifest.json; running in direct-file mode.');
        return;
      }
      parts = manifest.parts;
      packIndex = manifest.index;
      // Eager parts all in flight at once; lazy ones wait for their first hit.
      await Promise.all(parts.map((p, i) => p.lazy ? null : ensurePart(origFetch, i)));
    } else {
      const res = await origFetch('./assets.pak');
      if (!res.ok) {
        // In dev mode or when no pack is present, fall back to individual files
        return;
      }
      loadLegacyPak(await res.arrayBuffer());
    }

    const lazyCount = parts.filter(p => p.lazy).length;
    console.log(`[asset_pack] Indexed ${Object.keys(packIndex).length} virtual assets across ${parts.length} part(s) (${lazyCount} lazy).`);

    // Hook window.fetch so fetch('sounds/...') or fetch('dcss/...') returns the virtual blob
    window.fetch = async function(input, init) {
      const urlStr = typeof input === 'string' ? input : input?.url;
      if (urlStr) {
        const clean = normalizePath(urlStr);
        if (packIndex[clean]) {
          const blob = await getAssetBlobAsync(origFetch, clean);
          if (blob) {
            const mime = packIndex[clean][3] || 'application/octet-stream';
            return new Response(blob, {
              status: 200,
              headers: { 'Content-Type': mime }
            });
          }
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

    /* The setter above never sees markup: `el.innerHTML = '<img src="./dcss/…">'`
       (item icons, shop, codex portraits) has the parser write the content
       attribute directly, so those images went to the network for a folder the
       packager removed from dist. Rewrite them as they are inserted; and since
       the fetch may already be queued by then, also swap the blob in on error. */
    const fixImg = img => {
      const raw = img.getAttribute('src');
      if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return;
      const url = getAssetUrl(raw);
      if (url) img.src = url;
    };
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IMG') fixImg(n);
          else if (n.querySelectorAll) for (const img of n.querySelectorAll('img[src]')) fixImg(img);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('error', e => {
      if (e.target && e.target.tagName === 'IMG') fixImg(e.target);
    }, true);
  } catch (err) {
    console.log('[asset_pack] Running in direct-file mode.', err?.message || '');
  }
}
