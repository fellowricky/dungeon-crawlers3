/**
 * Minimal MP4 demuxer for the loading-plate loops.
 *
 * The curtain worker decodes the plate loop itself with WebCodecs, because a
 * <video> element needs the main thread to load data and to loop, and a floor
 * forge blocks that thread for seconds. The plates are all one shape (a single
 * H.264 track, moov before mdat, 24 fps, B-frames), so this reads only what
 * that needs: the avcC record and the sample table. Anything else returns null
 * and the curtain falls back to the <video> element.
 */

function u32(v, o) { return v.getUint32(o); }
function type(v, o) {
  return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

/* Child boxes of [start, end). Returns { type, start (payload), end }. */
function boxes(v, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32(v, o);
    const t = type(v, o + 4);
    let head = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(o + 8));
      head = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < head || o + size > end) break;
    out.push({ type: t, start: o + head, end: o + size });
    o += size;
  }
  return out;
}

function child(v, box, t) {
  return box ? boxes(v, box.start, box.end).find(b => b.type === t) || null : null;
}

function path(v, box, ...types) {
  let cur = box;
  for (const t of types) cur = child(v, cur, t);
  return cur;
}

function hex2(n) { return n.toString(16).padStart(2, '0'); }

/**
 * Parse `buf` (ArrayBuffer of a whole .mp4). Returns
 *   { codec, description, width, height, timescale, durationUs, samples }
 * where samples are in decode order: { offset, size, key, ptsUs, durUs }.
 * ptsUs starts at 0 for the first presented frame.
 */
export function demuxMp4(buf) {
  if (!buf || !(buf.byteLength > 16)) return null;
  const v = new DataView(buf);
  const top = boxes(v, 0, buf.byteLength);
  const moov = top.find(b => b.type === 'moov');
  if (!moov) return null;
  for (const trak of boxes(v, moov.start, moov.end).filter(b => b.type === 'trak')) {
    const mdia = child(v, trak, 'mdia');
    const hdlr = child(v, mdia, 'hdlr');
    if (!hdlr || type(v, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(v, mdia, 'mdhd');
    if (!mdhd) return null;
    const ver = v.getUint8(mdhd.start);
    const timescale = ver === 1 ? u32(v, mdhd.start + 20) : u32(v, mdhd.start + 12);
    const stbl = path(v, mdia, 'minf', 'stbl');
    const stsd = child(v, stbl, 'stsd');
    if (!stsd) return null;
    /* stsd: version/flags(4) + count(4), then the first sample entry. */
    const entry = boxes(v, stsd.start + 8, stsd.end)[0];
    if (!entry || (entry.type !== 'avc1' && entry.type !== 'avc3')) return null;
    const width = v.getUint16(entry.start + 24);
    const height = v.getUint16(entry.start + 26);
    /* VisualSampleEntry is 78 bytes before its child boxes. */
    const avcC = boxes(v, entry.start + 78, entry.end).find(b => b.type === 'avcC');
    if (!avcC) return null;
    const description = new Uint8Array(buf.slice(avcC.start, avcC.end));
    const codec = 'avc1.' + hex2(description[1]) + hex2(description[2]) + hex2(description[3]);

    const stsz = child(v, stbl, 'stsz');
    const stsc = child(v, stbl, 'stsc');
    const stco = child(v, stbl, 'stco');
    const co64 = child(v, stbl, 'co64');
    const stts = child(v, stbl, 'stts');
    if (!stsz || !stsc || !(stco || co64) || !stts) return null;
    const ctts = child(v, stbl, 'ctts');
    const stss = child(v, stbl, 'stss');

    const fixed = u32(v, stsz.start + 4);
    const count = u32(v, stsz.start + 8);
    const sizes = new Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(v, stsz.start + 12 + i * 4);

    const chunkN = u32(v, (stco || co64).start + 4);
    const chunkOff = new Array(chunkN);
    for (let i = 0; i < chunkN; i++) {
      chunkOff[i] = stco ? u32(v, stco.start + 8 + i * 4) : Number(v.getBigUint64(co64.start + 8 + i * 8));
    }

    /* stsc: runs of (firstChunk, samplesPerChunk). */
    const runs = [];
    const scN = u32(v, stsc.start + 4);
    for (let i = 0; i < scN; i++) {
      const o = stsc.start + 8 + i * 12;
      runs.push([u32(v, o) - 1, u32(v, o + 4)]);
    }
    const offsets = new Array(count);
    let s = 0;
    for (let r = 0; r < runs.length && s < count; r++) {
      const last = r + 1 < runs.length ? runs[r + 1][0] : chunkN;
      for (let c = runs[r][0]; c < last && s < count; c++) {
        let o = chunkOff[c];
        for (let k = 0; k < runs[r][1] && s < count; k++) {
          offsets[s] = o;
          o += sizes[s];
          s++;
        }
      }
    }

    const dts = new Array(count);
    const durs = new Array(count);
    let t = 0;
    s = 0;
    const ttsN = u32(v, stts.start + 4);
    for (let i = 0; i < ttsN && s < count; i++) {
      const n = u32(v, stts.start + 8 + i * 8);
      const d = u32(v, stts.start + 12 + i * 8);
      for (let k = 0; k < n && s < count; k++) { dts[s] = t; durs[s] = d; t += d; s++; }
    }
    const total = t;

    const cto = new Array(count).fill(0);
    if (ctts) {
      const cver = v.getUint8(ctts.start);
      const cN = u32(v, ctts.start + 4);
      s = 0;
      for (let i = 0; i < cN && s < count; i++) {
        const n = u32(v, ctts.start + 8 + i * 8);
        const off = cver === 1 ? v.getInt32(ctts.start + 12 + i * 8) : u32(v, ctts.start + 12 + i * 8);
        for (let k = 0; k < n && s < count; k++) cto[s++] = off;
      }
    }

    const keys = new Set();
    if (stss) {
      const kN = u32(v, stss.start + 4);
      for (let i = 0; i < kN; i++) keys.add(u32(v, stss.start + 8 + i * 4) - 1);
    }

    let minPts = Infinity;
    for (let i = 0; i < count; i++) minPts = Math.min(minPts, dts[i] + cto[i]);
    const toUs = x => Math.round((x * 1e6) / timescale);
    const samples = [];
    for (let i = 0; i < count; i++) {
      if (!(offsets[i] >= 0) || offsets[i] + sizes[i] > buf.byteLength) return null;
      samples.push({
        offset: offsets[i],
        size: sizes[i],
        key: stss ? keys.has(i) : true,
        ptsUs: toUs(dts[i] + cto[i] - minPts),
        durUs: toUs(durs[i])
      });
    }
    if (!samples.length || !samples[0].key) return null;
    return { codec, description, width, height, timescale, durationUs: toUs(total), samples };
  }
  return null;
}
