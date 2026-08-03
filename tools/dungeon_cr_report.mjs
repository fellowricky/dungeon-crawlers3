/* Dungeon × CR coverage auditor — read-only analysis report generator.
   Thematic fit is now judged PER-MONSTER by tools/dungeon_habitat.mjs (elemental
   immunities, breath/attack damage types, traits, creature type, name keywords),
   NOT by creature-type family groups. Family groups misassign e.g. all dragons
   to the same dungeon, so a green dragon (forest) or white dragon (frost) ends
   up in lava. The habitat scorer fixes that.

   It compares each monster's current `dungeons` whitelist against its proposed
   habitat and the even-CR-spread target.
   Outputs dungeon_cr_report.md (analysis only — never writes monsters.json).
   Run:  node tools/dungeon_cr_report.mjs [--json out.json]
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MONSTERS_ALL } from '../src/game/srd.js';
import {
  DUNGEONS, DUNGEON_LABEL, LABEL, proposeDungeons, PROPOSE_TOP,
} from './dungeon_habitat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MD = path.join(ROOT, 'dungeon_cr_report.md');

const BANDS = [
  { key: 'cr0', label: 'CR 0 – ½',  test: c => c <= 0.5 },
  { key: 'cr05', label: 'CR ½ – 2',  test: c => c > 0.5 && c <= 2 },
  { key: 'cr2', label: 'CR 2 – 4½',  test: c => c > 2 && c <= 4.5 },
  { key: 'cr45', label: 'CR 4½ – 8',  test: c => c > 4.5 && c <= 8 },
  { key: 'cr8', label: 'CR 8+',       test: c => c > 8 },
];
const crStr = c => c === 0.125 ? '1/8' : c === 0.25 ? '1/4' : c === 0.5 ? '1/2' : String(c);
const inBand = m => BANDS.findIndex(b => b.test(m.cr));

/* Pre-score every monster once. proposal.proposed = top-N habitat dungeons. */
const scored = MONSTERS_ALL.map(m => ({ m, prop: proposeDungeons(m) }));
const propTop = ({ prop }) => new Set(prop.top);
const proposedIn = (entry, k) => entry.prop.scores[k] > 0; // any positive score = habitat fit
const proposedStrong = (entry, k) => {
  /* Strong = dungeon is in the monster's top-N, i.e. one of its clear homes. */
  return entry.prop.top.includes(k);
};

/* Current assignment + proposed-pool per dungeon. */
const byDungeon = {};
for (const k of DUNGEONS) byDungeon[k] = { assigned: [], pool: [], strong: [], misplaced: [] };

for (const e of scored) {
  const { m } = e;
  for (const k of DUNGEONS) {
    const isAssigned = Array.isArray(m.dungeons) && m.dungeons.includes(k);
    if (isAssigned) byDungeon[k].assigned.push(e);
    if (proposedIn(e, k)) byDungeon[k].pool.push(e);
    if (proposedStrong(e, k)) byDungeon[k].strong.push(e);
    /* assigned, but habitat scorer gives this dungeon no positive score —
       i.e. the monster thematically does not belong here. */
    if (isAssigned && !proposedIn(e, k)) byDungeon[k].misplaced.push(e);
  }
}

const bandCount = list => BANDS.map(b => list.filter(e => b.test(e.m.cr)).length);

/* ---------- target model ---------- */
const TARGET_PER_DUNGEON = MONSTERS_ALL.length / DUNGEONS.length; // ~82
const TARGET_PER_BAND = TARGET_PER_DUNGEON / BANDS.length;        // ~16.4

/* ---------- assemble report ---------- */
const L = [];
const h = s => L.push(`# ${s}`);
const h2 = s => L.push(`\n## ${s}`);
const h3 = s => L.push(`\n### ${s}`);
const p = s => L.push(s);
const table = (header, rows) => {
  L.push(`\n${header}`);
  L.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
  L.push(`| ${rows[0].join(' | ')} |`);
  for (const r of rows.slice(1)) L.push(`| ${r.join(' | ')} |`);
};

h(`Dungeon Monster Coverage & CR Balance Report`);
p(`\nGenerated from the live roster (**${MONSTERS_ALL.length} monsters**) in ` +
  `\`src/game/monsters.json\`. This is an analysis report only — it does not ` +
  `modify any game data.`);
p(`\n**Thematic fit is judged per monster**, not per creature-type family. ` +
  `\`tools/dungeon_habitat.mjs\` scores each creature against all 5 dungeon ` +
  `types from its own data — elemental immunities, breath/attack damage types, ` +
  `traits (Amphibious, Ice Walk, Spider Climb…), creature type, and name ` +
  `keywords. The top **${PROPOSE_TOP}** scoring dungeons are its proposed ` +
  `habitat. This is why a red dragon → **Molten** (fire-immune) but a green ` +
  `dragon → **Verdant** (poison-immune, Amphibious) and a white dragon → ` +
  `**Frostfell** (cold-immune, Ice Walk).`);
p(`\n**Balance target:** each of the 5 dungeon types should host a similar number ` +
  `of monsters (~**${TARGET_PER_DUNGEON.toFixed(0)}** each), with an even mix across ` +
  `the 5 CR bands (~**${TARGET_PER_BAND.toFixed(1)}** per band).`);

/* ---------- summary ---------- */
h2('Summary: current vs proposed');
table('| Dungeon | Assigned now | Proposed habitat pool | Strong (top-3) | Target | Misplaced (assigned but no habitat score) |',
  DUNGEONS.map(k => {
    const d = byDungeon[k];
    return [
      DUNGEON_LABEL[k], String(d.assigned.length), String(d.pool.length),
      String(d.strong.length), TARGET_PER_DUNGEON.toFixed(0), String(d.misplaced.length),
    ];
  }));

h2('CR band distribution — currently assigned vs proposed habitat');
{
  const header = ['Dungeon'].concat(BANDS.map(b => b.label),
    ['Total', 'Even target']);
  const rows = [header].concat(DUNGEONS.map(k => {
    const d = byDungeon[k];
    return [DUNGEON_LABEL[k] + ' (assigned)']
      .concat(bandCount(d.assigned))
      .concat([String(d.assigned.length), TARGET_PER_DUNGEON.toFixed(0)]);
  })).concat(DUNGEONS.map(k => {
    const d = byDungeon[k];
    return [DUNGEON_LABEL[k] + ' (proposed pool)']
      .concat(bandCount(d.pool))
      .concat([String(d.pool.length), TARGET_PER_DUNGEON.toFixed(0)]);
  }));
  table('| CR band spread (count per band) |', rows);
}

h2('Per-dungeon analysis');
for (const k of DUNGEONS) {
  const d = byDungeon[k];
  h3(`${DUNGEON_LABEL[k]} (\`${k}\`)`);
  p(`- Assigned now: **${d.assigned.length}** · proposed habitat pool: **${d.pool.length}** · ` +
    `strong homes (top-3): **${d.strong.length}** · target: **${TARGET_PER_DUNGEON.toFixed(0)}**`);
  p(`- Assigned CR mix: **${bandCount(d.assigned).join(' / ')}**`);
  p(`- Proposed-pool CR mix: **${bandCount(d.pool).join(' / ')}**`);

  /* 1. band gaps */
  h3(`${DUNGEON_LABEL[k]} — CR band gaps (proposed pool vs target)`);
  {
    const rows = [[`Band`, 'Assigned', 'Proposed pool', 'Target', 'Δ (proposed−target)', 'Unassigned thematic fills']];
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      const assigned = d.assigned.filter(e => b.test(e.m.cr)).length;
      const pool = d.pool.filter(e => b.test(e.m.cr)).length;
      const target = TARGET_PER_BAND;
      const delta = (pool - target).toFixed(1);
      const unassignedFill = pool - assigned; // habitat-fit monsters not whitelisted in this band
      rows.push([b.label, String(assigned), String(pool), target.toFixed(1),
        delta, unassignedFill > 0 ? `+${unassignedFill}` : '0']);
    }
    table(`| ${k} band comparison |`, rows);
  }

  /* 2. misplaced */
  if (d.misplaced.length) {
    h3(`${DUNGEON_LABEL[k]} — thematically misplaced (assigned here, habitat says no)`);
    p(`These are whitelisted for \`${k}\` even though the habitat scorer gives ` +
      `\`${k}\` **zero** points from their data — e.g. a fire creature in a frost ` +
      `cave. Review whether they should be removed (the scorer's reasons below ` +
      `show what they actually fit).`);
    d.misplaced.sort((a, b) => a.m.cr - b.m.cr);
    table('| Monster | CR | Type | Habitat score for ' + DUNGEON_LABEL[k] + ' | Best-fit dungeon (score) |',
      d.misplaced.map(e => {
        const { scores } = e.prop;
        const best = DUNGEONS.slice().sort((a, b) => scores[b] - scores[a])[0];
        return [e.m.name, crStr(e.m.cr), e.m.type, String(scores[k] || 0),
          `${DUNGEON_LABEL[best]} (${scores[best]})`];
      }));
  } else {
    p(`\nNo misplaced monsters — every creature whitelisted for ${k} has a positive habitat score there.`);
  }

  /* 3. unassigned thematic fills */
  const fills = d.pool.filter(e => !(Array.isArray(e.m.dungeons) && e.m.dungeons.includes(k)));
  if (fills.length) {
    h3(`${DUNGEON_LABEL[k]} — thematic candidates not yet whitelisted (easy fills)`);
    const byBand = BANDS.map((b, i) => ({
      band: b.label,
      list: fills.filter(e => inBand(e.m) === i).sort((a, b) => a.m.cr - b.m.cr),
    }));
    for (const g of byBand) {
      if (!g.list.length) continue;
      p(`\n**${g.band}** (${g.list.length}): ` +
        g.list.map(e => `${e.m.name} (${crStr(e.m.cr)})`).join(', '));
    }
  }
}

/* ---------- content gaps ---------- */
h2('Content gaps — bands where even the full proposed habitat pool falls short');
{
  p('A band is a content gap when the **entire** proposed habitat pool (assigned + ' +
    'easy fills) in that band is smaller than the even-spread target — i.e. even ' +
    `whitelisting every habitat-fit monster, that band cannot reach ~16 creatures, ` +
    `so reaching an even spread there requires adding new monsters. Bands where ` +
    `the pool exceeds the target need no new content, just assignment.`);
  for (const k of DUNGEONS) {
    const d = byDungeon[k];
    const gaps = [];
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      const assigned = d.assigned.filter(e => b.test(e.m.cr)).length;
      const pool = d.pool.filter(e => b.test(e.m.cr)).length;
      if (pool < TARGET_PER_BAND) {
        gaps.push(`${b.label}: pool ${pool}/${TARGET_PER_BAND.toFixed(1)} ` +
          `(assigned ${assigned}, fillable ${pool - assigned})`);
      }
    }
    p(`- **${DUNGEON_LABEL[k]}**: ${gaps.length ? gaps.join('; ') : 'none — every band has enough thematic candidates to reach target'}`);
  }
}

/* ---------- recommended actions ---------- */
h2('Recommended actions');
{
  const weakest = DUNGEONS.slice().sort(
    (a, b) => byDungeon[a].assigned.length - byDungeon[b].assigned.length);
  p('1. **Assign habitat-fit monsters first.** The "easy fills" lists add creatures ' +
    `to a dungeon at no cost — they are already thematically correct per the ` +
    `habitat scorer but not whitelisted. Prioritize ${weakest.slice(0, 3).map(k => DUNGEON_LABEL[k]).join(', ')}.`);
  p(`2. **Remove or rehome misplaced monsters** (listed per dungeon above) so a frost ` +
    `cave doesn't spawn fire creatures and a lava forge doesn't spawn ice ones. ` +
    `The report shows each misplaced creature's best-fit dungeon for rehoming.`);
  p(`3. **Add new monsters only for genuine content gaps** (the "Content gaps" ` +
    `section): bands where even the full habitat pool can't reach the even target. ` +
    `Prefer importing SRD/DCSS monsters whose own data fits the dungeon's climate.`);
  p(`4. **Per-monster overrides are the long-term answer.** A monster with an explicit ` + '`dungeons` array already overrides everything, so the game never needs family-based defaults. Once the report\u2019s proposals are applied, ' + '`DUNGEON_MONSTER_MAP` becomes only a seed hint, not a rule.');
}

/* ---------- appendix: unassigned + low confidence ---------- */
h2('Appendix');
{
  const none = MONSTERS_ALL.filter(m => !(Array.isArray(m.dungeons) && m.dungeons.some(x => DUNGEONS.includes(x))));
  p(`**${none.length}** of **${MONSTERS_ALL.length}** monsters are whitelisted for none ` +
    `of the 5 dungeon types. These never appear in themed dungeon rooms.`);
  const byBand = BANDS.map((b, i) => `${b.label}: ${none.filter(m => inBand(m) === i).length}`);
  p(`CR spread of the unassigned: ${byBand.join(' · ')}`);

  const weak = scored.filter(e => Math.max(...Object.values(e.prop.scores)) < 15);
  p(`\n**${weak.length}** monsters have a weak habitat signal (best score < 15) — ` +
    `generic creatures with no strong climate/terrain data. Their proposed home is ` +
    `a soft default; decide these by hand.`);
  p(weak.map(e => e.m.name).join(', '));
}

fs.writeFileSync(OUT_MD, L.join('\n') + '\n');
console.log(`Wrote ${OUT_MD} (${(fs.statSync(OUT_MD).size / 1024).toFixed(1)} KB)`);

if (process.argv.includes('--json')) {
  const i = process.argv.indexOf('--json');
  const out = process.argv[i + 1];
  const data = {};
  for (const k of DUNGEONS) {
    const d = byDungeon[k];
    data[k] = {
      assigned: d.assigned.map(e => e.m.id),
      pool: d.pool.map(e => e.m.id),
      strong: d.strong.map(e => e.m.id),
      misplaced: d.misplaced.map(e => ({ id: e.m.id, best: DUNGEONS.slice().sort((a, b) => e.prop.scores[b] - e.prop.scores[a])[0] })),
      bandCounts: bandCount(d.pool),
    };
  }
  fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(data, null, 2));
  console.log(`Wrote ${out}`);
}
