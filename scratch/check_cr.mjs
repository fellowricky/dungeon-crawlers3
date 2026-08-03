const { getCuratedBossEncounters, MONSTERS_BY_ID } = await import('../src/game/srd.js');
const encs = getCuratedBossEncounters();
let weird = 0;
for (const e of encs) {
  const m = MONSTERS_BY_ID[e.bossId];
  if (!m) { console.log('MISSING monster:', e.id, e.bossId); weird++; continue; }
  const diff = Math.abs(m.cr - e.targetCR);
  if (diff > 1.5 || e.targetCR === 0) {
    weird++;
    if (weird <= 30) console.log(`${e.id}: targetCR=${e.targetCR} monster=${e.bossId} actualCR=${m.cr} diff=${diff.toFixed(1)}`);
  }
}
console.log('Total encounters:', encs.length, '| mismatched (diff>1.5):', weird);
