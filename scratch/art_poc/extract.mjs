import fs from 'fs';
const s = fs.readFileSync('G:/ClaudesFolder/dungeon-crawlers/src/game/story.js', 'utf8').replace(/\r/g, '');
const ids = [...s.matchAll(/id: 'story_ch(\d+)'/g)].map(m => ({ n: +m[1], i: m.index }));
ids.push({ n: 99, i: s.length });

const want = {
  2: ['Drag Marks', 'What the Cattle Saw', 'Down the Throat'],
  3: ['Garrison Shrine, Still Lit', 'The Unbarred Door', 'The Roll of Sixteen'],
  4: ['The Signing', 'The Proving-Bout', 'The Long Roll'],
  5: ['The Sealed Case', 'The Vault Warden', 'The Drowned Causeway'],
};
const clean = t => t.replace(/'\s*\+\s*\n\s*'/g, '').replace(/\s+/g, ' ').trim();

for (let k = 0; k < ids.length - 1; k++) {
  const n = ids[k].n;
  if (n < 2 || n > 5) continue;
  const blk = s.slice(ids[k].i, ids[k + 1].i);
  const g = re => { const m = blk.match(re); return m ? clean(m[1]) : null; };
  console.log('\n########## CH' + n);
  console.log('DESC: ' + g(/description:\s*\n?\s*'([\s\S]*?)',\n/));
  console.log('EMBARK: ' + g(/embarkText:\s*\n?\s*'([\s\S]*?)',\n/));
  console.log('VICTORY: ' + g(/victoryText:\s*\n?\s*'([\s\S]*?)',\n/));
  for (const w of (want[n] || [])) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = blk.match(new RegExp("name: '" + esc + "'[\\s\\S]{0,400}?desc:\\s*\\n?\\s*'([\\s\\S]*?)',\\n"));
    console.log('  --[' + w + ']: ' + (m ? clean(m[1]) : 'NOT FOUND'));
  }
}
