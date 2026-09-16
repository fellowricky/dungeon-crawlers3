import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import MONSTERS from '../src/game/monsters.json' with { type: 'json' };

/* Animation blocks describe a sheet they do not own: `cols`, `rows` and the
   frame size all have to agree with the actual PNG on disk. Nothing at runtime
   checks this, and the failure is quiet — a too-low `cols` silently truncates
   the loop, a too-high one reads past the end and shows blank frames, and a
   wrong path just fails to load. All three shipped at once before the codex
   portrait started showing idle and attack, which is what surfaced them. */

const PUBLIC = path.resolve(__dirname, '..', 'public');

/** Width/height straight from the PNG header — no image library needed. */
function pngSize(file) {
  const head = Buffer.alloc(26);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 26, 0); } finally { fs.closeSync(fd); }
  if (head.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') return null;
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

const clips = [];
for (const m of MONSTERS) {
  for (const [kind, a] of Object.entries(m.animations || {})) {
    clips.push({ id: m.id, kind, a });
  }
}

describe('monster animation sheets', () => {
  it('has clips to check', () => {
    expect(clips.length).toBeGreaterThan(200);
  });

  it('every clip names its own sheet', () => {
    /* An omitted path silently falls back to the monster's base sprite, which
       happens to work for some and shows the wrong pose for others. */
    const nameless = clips.filter(c => !c.a.sprite).map(c => `${c.id}/${c.kind}`);
    expect(nameless).toEqual([]);
  });

  it('every sheet exists on disk', () => {
    const missing = clips
      .filter(c => c.a.sprite && !fs.existsSync(path.join(PUBLIC, c.a.sprite)))
      .map(c => `${c.id}/${c.kind} -> ${c.a.sprite}`);
    expect(missing).toEqual([]);
  });

  it('cols and rows match the real frame count in each sheet', () => {
    const wrong = [];
    for (const { id, kind, a } of clips) {
      const file = path.join(PUBLIC, a.sprite || '');
      if (!a.sprite || !fs.existsSync(file)) continue;      // covered above
      const size = pngSize(file);
      if (!size) continue;
      const cols = size.w / a.frameWidth;
      const rows = size.h / a.frameHeight;
      if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
        wrong.push(`${id}/${kind}: ${size.w}x${size.h} is not a whole number of ${a.frameWidth}x${a.frameHeight} cells`);
      } else if (cols !== a.cols || rows !== (a.rows ?? 1)) {
        wrong.push(`${id}/${kind}: declares ${a.cols}x${a.rows ?? 1}, sheet holds ${cols}x${rows}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
