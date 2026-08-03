/*
 * Story-mode narration extractor
 * ------------------------------
 * Companion to extract.mjs (which handles the skills.js challenge pools).
 * This one reads src/game/story.js — pure data, imported directly — and
 * emits scripts/narration/out/story-manifest.json for narrate_batch.py.
 *
 * Ids MUST match what the runtime requests verbatim (no slugging of the
 * composed ids — only challenge names are slugged, mirroring narrBase()):
 *
 *   intro_crawl_p{i}              — opening-crawl paragraph i (intro_crawl.js)
 *   {mission.id}_desc             — story-tab mission description (worldmap.js)
 *   {mission.id}_embark           — embark line (worldmap.js launchStoryQuest)
 *   {mission.id}_victory          — victory line (quest_events.js onQuestCompleted)
 *   {mission.id}_brief_{nodeId}   — briefing dialogue node (story_dialog.js)
 *   {slug(ch.nid||ch.name)}[..]   — story challenges, same scheme as extract.mjs
 *                                   (desc + _a{i}_act/_win/_lose; skills.js narrBase)
 *
 * Run:  node scripts/narration/extract_story.mjs
 * Then: localvoice venv python whisper-stt/narrate_batch.py \
 *         --manifest scripts/narration/out/story-manifest.json --voice Merlin
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const OUT = join(here, 'out');
const NARR_DIR = join(repoRoot, 'public', 'sounds', 'Narration');

const { STORY_MISSIONS, INTRO_CRAWL } =
  await import(pathToFileURL(join(repoRoot, 'src', 'game', 'story.js')).href);

/* identical to extract.mjs / audio.js narrationId */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const rows = [];
const push = (id, name, text) => {
  if (typeof text === 'string' && text.trim()) rows.push({ id, name, text: text.trim() });
};

/* -- opening crawl -- */
(INTRO_CRAWL?.paragraphs || []).forEach((p, i) =>
  push(`intro_crawl_p${i}`, `Opening crawl ¶${i + 1}`, p));

/* -- story missions -- */
for (const m of STORY_MISSIONS) {
  push(`${m.id}_desc`, `${m.name} — description`, m.description);
  push(`${m.id}_embark`, `${m.name} — embark`, m.embarkText);
  push(`${m.id}_victory`, `${m.name} — victory`, m.victoryText);
  for (const [nodeId, node] of Object.entries(m.briefing?.nodes || {}))
    push(`${m.id}_brief_${nodeId}`, `${m.name} — briefing:${nodeId}`, node.text);

  for (const sc of m.storyChallenges || []) {
    const ch = sc.challenge;
    if (!ch || !ch.name) continue;
    const base = slug(ch.nid || ch.name);
    push(base, ch.name, ch.desc);
    (ch.approaches || []).forEach((a, i) => {
      push(`${base}_a${i}_act`, `${ch.name} — ${a.label}`, a.label);
      push(`${base}_a${i}_win`, `${ch.name} — ${a.label} (success)`, a.win);
      push(`${base}_a${i}_lose`, `${ch.name} — ${a.label} (failure)`, a.lose);
    });
  }

  /* End-of-floor story beats: voiced branching dialogue nodes, then the beat's
     skill challenge. Node ids MUST mirror floor_beat.js: `${m.id}_fb${floor}_${nodeId}`. */
  for (const [floor, beat] of Object.entries(m.floorBeats || {})) {
    for (const [nodeId, node] of Object.entries(beat.nodes || {}))
      push(`${m.id}_fb${floor}_${nodeId}`, `${m.name} — floor ${floor}:${nodeId}`, node.text);

    const ch = beat.challenge;
    if (ch && ch.name) {
      const base = slug(ch.nid || ch.name);
      push(base, ch.name, ch.desc);
      (ch.approaches || []).forEach((a, i) => {
        push(`${base}_a${i}_act`, `${ch.name} — ${a.label}`, a.label);
        push(`${base}_a${i}_win`, `${ch.name} — ${a.label} (success)`, a.win);
        push(`${base}_a${i}_lose`, `${ch.name} — ${a.label} (failure)`, a.lose);
      });
    }
  }
}

/* -- collision guard: never silently claim an id another manifest owns -- */
const mainManifestPath = join(OUT, 'narration-manifest.json');
if (existsSync(mainManifestPath)) {
  const mainIds = new Set(JSON.parse(readFileSync(mainManifestPath, 'utf8')).map(r => r.id));
  const clashes = rows.filter(r => mainIds.has(r.id));
  if (clashes.length) {
    console.error('ID COLLISION with skill-challenge manifest — add a nid to these story challenges:');
    for (const c of clashes) console.error(`  ${c.id}  (${c.name})`);
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'story-manifest.json'),
  JSON.stringify(rows.map(({ id, text }) => ({ id, text })), null, 2) + '\n');

const sheet = rows.map((r, i) =>
  `${String(i + 1).padStart(3, ' ')}. [${r.name}]\n` +
  `     save as:  public/sounds/Narration/${r.id}.wav\n` +
  `     narrate:  ${r.text}\n`).join('\n');
writeFileSync(join(OUT, 'story-script.txt'),
  `Dungeon Crawlers — story-mode narration script (crawl + missions + briefings + story challenges)\n` +
  `${rows.length} lines.\n${'='.repeat(72)}\n\n${sheet}`);

const recorded = existsSync(NARR_DIR)
  ? new Set(readdirSync(NARR_DIR).map(f => f.replace(/\.(wav|mp3)$/i, ''))) : new Set();
const missing = rows.filter(r => !recorded.has(r.id));
console.log(`Extracted ${rows.length} story lines -> scripts/narration/out/story-manifest.json`);
console.log(`  already recorded: ${rows.length - missing.length} · still missing: ${missing.length}`);
