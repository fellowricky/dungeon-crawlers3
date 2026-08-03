globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }
};
globalThis.document = {
  getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, innerHTML: '', appendChild() {}, children: [], removeChild() {}, firstChild: null, style: {} }),
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {} }, head: { appendChild() {} }
};

const { getCuratedBossEncounter, getCuratedBossEncounters, spawnMonster, MONSTERS_BY_ID } = await import('../src/game/srd.js');
const { generateQuests } = await import('../src/game/quests.js');

// Check escort spawning with strictIds
let escortOk = 0, escortFail = 0;
for (const enc of getCuratedBossEncounters()) {
  if (!enc.escorts || !enc.escorts.length) continue;
  const qi = { dungeonLevel: enc.level, questFloor: enc.level, floors: enc.level };
  const D = enc.level + (enc.level - 1) * 0.5;
  const btCR = Math.max(1, D);
  for (const esc of enc.escorts) {
    const spec = spawnMonster(Math.max(0.5, btCR * 0.6), Math.max(1, enc.level), Math.random, [esc.id], qi, 'minion', true, true);
    if (spec && spec.id === esc.id) {
      escortOk++;
    } else {
      escortFail++;
      if (escortFail <= 5) {
        const wanted = esc.id;
        const actual = spec ? spec.id : 'null';
        const escCR = MONSTERS_BY_ID[esc.id]?.cr;
        console.log(`ESCORT FAIL: ${enc.id} wanted=${wanted} (CR ${escCR}) got=${actual} target=${(btCR * 0.6).toFixed(1)}`);
      }
    }
  }
}
console.log(`\nEscort spawns: ok=${escortOk} fail=${escortFail}`);

