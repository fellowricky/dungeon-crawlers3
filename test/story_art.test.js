import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/* Chapter art is referenced by string path from story.js and loaded at runtime
   by the briefing overlay, the challenge vignette and the boss card. A typo in
   one of those strings fails silently in-game (a blank banner, a backdrop that
   never paints), so pin them to real files here instead. */
const storySrc = fs.readFileSync(path.join(ROOT, 'src/game/story.js'), 'utf8');

function refs(re) {
  return [...storySrc.matchAll(re)].map(m => m[1]);
}

describe('story chapter art references', () => {
  const all = [
    ...refs(/\bart:\s*'([^']+)'/g),
    ...refs(/\bbossArt:\s*'([^']+)'/g),
    ...refs(/\bbackdrop:\s*'([^']+)'/g),
  ];

  it('finds art references to check', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('every referenced art file exists in public/', () => {
    const missing = all.filter(p => !fs.existsSync(path.join(PUBLIC, p.replace(/^\.\//, ''))));
    expect(missing).toEqual([]);
  });

  it('every referenced art path is web-relative and a webp', () => {
    const bad = all.filter(p => !p.startsWith('./art/') || !p.endsWith('.webp'));
    expect(bad).toEqual([]);
  });

  it('every mission with bossArt also supplies a caption label', () => {
    const missions = storySrc.split(/id: 'story_ch/).slice(1);
    const bad = missions
      .filter(m => /\bbossArt:/.test(m) && !/\bbossArtLabel:/.test(m))
      .map(m => m.slice(0, m.indexOf("'")));
    expect(bad).toEqual([]);
  });
});
