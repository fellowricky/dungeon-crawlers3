/* Report the mean HSL lightness of the opaque pixels in an LPC sheet.
   Used to calibrate the character recolour palettes in src/game/appearance.js:
   the recolour shifts a sheet's shading so its mean lands on the swatch's own
   lightness, so the swatches have to be authored around these numbers.

   Usage: node scripts/sheet_lightness.mjs <png> [...]
   Minimal PNG reader — handles the 8-bit truecolour+alpha and palette files
   the LPC sheets ship as; no image dependency in this repo.  */
import fs from 'fs';
import zlib from 'zlib';

function decodePng(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, pal = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tag = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9];
    } else if (tag === 'PLTE') pal = data;
    else if (tag === 'tRNS') trns = data;
    else if (tag === 'IDAT') idat.push(data);
    else if (tag === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 && !(depth === 4 && type === 3)) throw new Error('unsupported bit depth ' + depth);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error('unsupported colour type ' + type);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = depth === 4 ? 1 : channels;          // filtering works on whole bytes
  const stride = depth === 4 ? Math.ceil(w / 2) : w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  // normalise to RGBA
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b, a = 255;
    if (type === 6) { r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; }
    else if (type === 2) { r = out[i*3]; g = out[i*3+1]; b = out[i*3+2]; }
    else if (type === 3) {
      const x = i % w, y = (i / w) | 0;
      const p = depth === 4
        ? (out[y * stride + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0x0f
        : out[i];
      r = pal[p*3]; g = pal[p*3+1]; b = pal[p*3+2]; if (trns && p < trns.length) a = trns[p];
    }
    else if (type === 4) { r = g = b = out[i*2]; a = out[i*2+1]; }
    else { r = g = b = out[i]; }
    rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b; rgba[i*4+3] = a;
  }
  return { w, h, rgba };
}

for (const file of process.argv.slice(2)) {
  const { w, h, rgba } = decodePng(fs.readFileSync(file));
  let sum = 0, n = 0, min = 1, max = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i+3] < 128) continue;
    const l = (Math.max(rgba[i], rgba[i+1], rgba[i+2]) + Math.min(rgba[i], rgba[i+1], rgba[i+2])) / 510;
    sum += l; n++; if (l < min) min = l; if (l > max) max = l;
  }
  console.log(`${file}  ${w}x${h}  opaque=${n}  meanL=${(sum/n).toFixed(3)}  range=${min.toFixed(3)}..${max.toFixed(3)}`);
}
