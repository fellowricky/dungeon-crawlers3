import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { demuxMp4 } from '../src/ui/mp4_demux.js';

function load(name) {
  const b = fs.readFileSync(`public/art/loading/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('loading plate mp4 demuxer', () => {
  it('reads the H.264 track the curtain worker decodes', () => {
    const info = demuxMp4(load('moor_day.mp4'));
    expect(info.codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(736);
    expect(info.samples).toHaveLength(140);
    expect(info.samples[0].key).toBe(true);
    expect(info.durationUs).toBe(5833333);
    /* B-frames: decode order is not presentation order, but every 24 fps
       slot is presented exactly once, starting at 0. */
    const pts = info.samples.map(s => s.ptsUs).sort((a, b) => a - b);
    expect(pts[0]).toBe(0);
    pts.forEach((p, i) => expect(Math.abs(p - i * 41666.67)).toBeLessThan(2));
  });

  it('demuxes every shipped plate loop', () => {
    for (const f of fs.readdirSync('public/art/loading').filter(n => n.endsWith('.mp4'))) {
      const info = demuxMp4(load(f));
      expect(info, f).not.toBeNull();
      expect(info.samples[0].key, f).toBe(true);
    }
  });

  it('returns null for a file it cannot read', () => {
    expect(demuxMp4(new ArrayBuffer(8))).toBeNull();
    expect(demuxMp4(new Uint8Array(64).buffer)).toBeNull();
  });
});
