/* Headless smoke test for the quest system data layer (vite build --ssr). */
globalThis.document = {
  getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, innerHTML: '', appendChild() {}, children: [], removeChild() {}, firstChild: null, style: {} }),
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {} }, head: { appendChild() {} }
};
import { generateQuests, generateSequelQuest } from './src/game/quests.js';
import { normalizeQuest, phaseNeedsChoice, onQuestCompleted, getSequelOffers, updateQuestTracker } from './src/game/quest_events.js';
import { BOSS_IDS, monsterName } from './src/game/srd.js';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.log('FAIL: ' + msg); }
};

/* ---- generation invariants across many rolls ---- */
for (let trial = 0; trial < 60; trial++) {
  const pl = 1 + (trial % 8);
  const quests = generateQuests(pl, 3);
  ok(quests.length === 3, 'generates 3 quests');
  for (const q of quests) {
    ok(typeof q.embarkText === 'string' && q.embarkText.length > 40, `embarkText present (${q.name})`);
    ok(typeof q.victoryText === 'string' && q.victoryText.length > 40, `victoryText present`);
    ok(q.description === q.embarkText, 'description = embark narration');
    ok(!q.embarkText.includes('{'), 'no unreplaced template slots in embark: ' + q.embarkText);
    ok(!q.victoryText.includes('{'), 'no unreplaced slots in victory');
    ok(q.finalBossId && BOSS_IDS.includes(q.finalBossId), 'finalBossId valid');
    ok(q.finalBossName === monsterName(q.finalBossId), 'finalBossName matches');
    ok(Array.isArray(q.phases), 'phases array');
    ok(Array.isArray(q.sideObjectives), 'sideObjectives array');
    ok(q.chain === null, 'fresh quest has no chain');
    /* phase invariants */
    const expect = q.floors < 3 ? 0 : q.floors <= 5 ? 1 : q.floors <= 8 ? 2 : 3;
    ok(q.phases.length <= expect, `phase count ${q.phases.length} <= ${expect} (floors ${q.floors})`);
    const types = new Set();
    let prev = -99;
    for (const p of q.phases) {
      ok(p.floor >= 2 && p.floor <= q.floors - 1, `phase floor ${p.floor} in [2, ${q.floors - 1}]`);
      ok(p.floor - prev >= 2, 'phases spaced >= 2');
      prev = p.floor;
      ok(!types.has(p.type), 'no duplicate phase types');
      types.add(p.type);
      ok(typeof p.rumor === 'string' && p.rumor.length > 10, 'rumor text');
      ok(p.choice === null && p.resolved === false, 'phase starts unresolved');
      if (p.type === 'ally') {
        ok(p.data.candidates && p.data.candidates.length === 2, 'ally has 2 candidates');
        ok(p.data.candidates[0].kind !== p.data.candidates[1].kind, 'ally candidates differ');
      }
      if (p.type === 'foreshadow') ok(q.floors >= 4, 'foreshadow only on floors>=4');
    }
    /* objective invariants */
    const expObj = q.floors < 2 ? 0 : q.floors >= 5 ? 2 : 1;
    ok(q.sideObjectives.length === expObj, `objective count (floors ${q.floors})`);
    const oKinds = new Set();
    for (const so of q.sideObjectives) {
      ok(!oKinds.has(so.kind), 'distinct objective kinds');
      oKinds.add(so.kind);
      ok(so.need >= 2 && so.have === 0 && so.done === false, 'objective initial state');
      ok(so.rewardGold >= 25 && so.rewardXp >= 15, 'objective rewards');
      ok(so.label.includes(String(so.need)), 'label mentions count');
    }
  }
}

/* ---- excludePositions ---- */
{
  const excl = { x: 22, y: 40 };
  for (let i = 0; i < 20; i++) {
    const qs = generateQuests(3, 3, { excludePositions: [excl] });
    ok(qs.every(q => !(q.mapLocation.x === excl.x && q.mapLocation.y === excl.y)), 'excluded position never used');
  }
}

/* ---- chain lifecycle ---- */
{
  const game = { questChains: { active: [], log: [] }, saveGame() {}, heroes: [] };
  const [q1] = generateQuests(3, 1);
  q1.floors = 8; /* ensure legendary-eligible (10 floors for part III) */
  onQuestCompleted(game, q1);
  ok(game.questChains.active.length === 1, 'part I completion unlocks a chain');
  const entry = game.questChains.active[0];
  ok(entry.part === 2 && entry.baseSeed === q1.seed && entry.arcTitle === q1.name, 'chain entry shape');
  ok(entry.mapLocation === q1.mapLocation, 'location pinned');

  const s1 = generateSequelQuest(entry, 4);
  const s2 = generateSequelQuest(entry, 4);
  if (s1.rewardItem && s2.rewardItem) s2.rewardItem.id = s1.rewardItem.id;
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'sequel generation deterministic');
  ok(s1.chain && s1.chain.part === 2 && s1.chain.baseSeed === entry.baseSeed, 'sequel chain metadata');
  ok(s1.level >= q1.level + 1 || s1.level >= 4, 'sequel harder');
  ok(s1.floors === Math.min(10, q1.floors + 2), 'sequel longer');
  ok(s1.phases.length >= 1, 'sequel has >= 1 phase');
  ok(s1.name.includes('Part II'), 'sequel named Part II: ' + s1.name);
  ok(!s1.embarkText.includes('{'), 'sequel embark clean');

  const offers = getSequelOffers(game, 4);
  ok(offers.length === 1 && offers[0].id === s1.id, 'getSequelOffers materializes the entry');

  /* part 2 -> part 3 */
  onQuestCompleted(game, s1);
  ok(game.questChains.active.length === 1 && game.questChains.active[0].part === 3, 'part II advances chain to III');
  const s3 = generateSequelQuest(game.questChains.active[0], 5);
  ok(s3.isLegendaryReward === true, 'part III guarantees legendary');
  ok(s3.phases.some(p => p.type === 'foreshadow'), 'part III always foreshadows');
  ok(s3.name.includes('Part III'), 'part III name');

  /* part 3 completion -> epilogue + log (showBanner needs DOM; stub minimal) */
  globalThis.document = {
    getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, innerHTML: '', appendChild() {}, children: [], removeChild() {}, firstChild: null, style: {} }),
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
    body: { appendChild() {} }, head: { appendChild() {} }
  };
  try { onQuestCompleted(game, s3); } catch (e) { fails++; console.log('FAIL: part III completion threw: ' + e.message); }
  ok(game.questChains.active.length === 0, 'saga removed from active');
  ok(game.questChains.log.length === 1, 'saga logged');
}

/* ---- old-save normalization ---- */
{
  const old = { name: 'The Crypt of Gloomhaven', theme: 'grim', level: 2, floors: 4, seed: 123 };
  normalizeQuest(old);
  ok(Array.isArray(old.phases) && Array.isArray(old.sideObjectives) && old.chain === null
    && old.bossIntel === false && old.place === 'Gloomhaven', 'old save normalized');
}

/* ---- phaseNeedsChoice ---- */
{
  ok(phaseNeedsChoice({ type: 'ambush', choice: null, resolved: false }) === true, 'ambush needs choice');
  ok(phaseNeedsChoice({ type: 'foreshadow', choice: null, resolved: false }) === false, 'foreshadow needs no choice');
  ok(phaseNeedsChoice({ type: 'gauntlet', choice: 'accept', resolved: false }) === false, 'decided phase asks nothing');
  ok(phaseNeedsChoice(null) === false, 'null phase safe');
}

/* ---- tracker with no DOM is a no-op ---- */
try { updateQuestTracker({ activeQuest: null }); } catch (e) { fails++; console.log('FAIL: tracker threw headless'); }

console.log(fails === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
