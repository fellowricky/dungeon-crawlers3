import { describe, it, expect } from 'vitest';
import {
  initRunStats, trackGold, trackLoot, trackFloor,
  finalizeRunStats, serializeRunStats, restoreRunStats
} from '../src/game/run_stats.js';

function makeGame() {
  return {
    elapsed: 0,
    heroes: [
      { data: { name: 'Aria', kills: 10, dmgDealt: 500, dmgTaken: 200, downs: 1, xp: 900 } },
      { data: { name: 'Bram', kills: 4, dmgDealt: 300, dmgTaken: 350, downs: 3, xp: 900 } },
      { temp: true, data: { name: 'Guest', kills: 99, dmgDealt: 9999, dmgTaken: 0, downs: 0, xp: 0 } }
    ]
  };
}

const quest = { id: 'q_test', name: 'The Crypt of Testing', floors: 3 };

describe('Run stats', () => {
  it('tracks a full run and diffs against the embark baseline', () => {
    const g = makeGame();
    initRunStats(g, quest);

    /* the run happens */
    g.heroes[0].data.kills += 7;
    g.heroes[0].data.dmgDealt += 250;
    g.heroes[0].data.dmgTaken += 80;
    g.heroes[0].data.xp += 400;
    g.heroes[1].data.downs += 1;
    g.heroes[1].data.xp += 400;
    trackGold(g, 120);
    trackGold(g, 30);
    trackLoot(g, { name: 'Rusty Dagger', rarity: 'common' });
    trackLoot(g, { name: 'Doombringer', rarity: 'legendary' });
    trackFloor(g); trackFloor(g); trackFloor(g);
    g.elapsed = 95;

    const s = finalizeRunStats(g);
    expect(s.questName).toBe(quest.name);
    expect(s.heroes.length).toBe(2); // temp ally excluded
    const aria = s.heroes.find(h => h.name === 'Aria');
    expect(aria).toMatchObject({ kills: 7, dmgDealt: 250, dmgTaken: 80, downs: 0, xp: 400 });
    const bram = s.heroes.find(h => h.name === 'Bram');
    expect(bram).toMatchObject({ kills: 0, dmgDealt: 0, dmgTaken: 0, downs: 1, xp: 400 });
    expect(s.totals).toMatchObject({ kills: 7, dmgDealt: 250, dmgTaken: 80, downs: 1, xp: 800 });
    expect(s.goldEarned).toBe(150);
    expect(s.itemsLooted).toBe(2);
    expect(s.lootByRarity).toEqual({ common: 1, legendary: 1 });
    expect(s.notableLoot).toEqual([{ name: 'Doombringer', rarity: 'legendary' }]);
    expect(s.floorsCleared).toBe(3);
    expect(s.elapsedSec).toBe(95);
  });

  it('is a safe no-op outside a quest run', () => {
    const g = makeGame();
    g.runStats = null;
    expect(() => { trackGold(g, 50); trackLoot(g, { rarity: 'rare' }); trackFloor(g); }).not.toThrow();
    expect(finalizeRunStats(g)).toBeNull();
    expect(serializeRunStats(g)).toBeNull();
  });

  it('survives save/load round-trip with the clock folded in', () => {
    const g = makeGame();
    initRunStats(g, quest);
    trackGold(g, 100);
    g.elapsed = 60;

    const saved = JSON.parse(JSON.stringify(serializeRunStats(g)));
    expect(saved.playedSec).toBe(60);

    const g2 = makeGame(); // fresh session, elapsed restarts
    restoreRunStats(g2, saved);
    expect(g2.runStats.goldEarned).toBe(100);
    g2.elapsed = 35;
    const s = finalizeRunStats(g2);
    expect(s.elapsedSec).toBe(95);
  });

  it('credits nothing (not lifetime totals) for a hero missing a baseline', () => {
    const g = makeGame();
    initRunStats(g, quest);
    g.heroes.push({ data: { name: 'Newcomer', kills: 500, dmgDealt: 1, dmgTaken: 1, downs: 1, xp: 1 } });
    const s = finalizeRunStats(g);
    const n = s.heroes.find(h => h.name === 'Newcomer');
    expect(n).toMatchObject({ kills: 0, dmgDealt: 0, dmgTaken: 0, downs: 0, xp: 0 });
  });

  it('never reports negative deltas', () => {
    const g = makeGame();
    initRunStats(g, quest);
    g.heroes[0].data.kills -= 5; // pathological / corrupted counter
    const s = finalizeRunStats(g);
    expect(s.heroes.find(h => h.name === 'Aria').kills).toBe(0);
  });
});
