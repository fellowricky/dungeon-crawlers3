import { describe, it, expect } from 'vitest';
import SB from '../src/game/spawn_budget.json' with { type: 'json' };
import {
  buyRoomSpawns, roomSpawnBudget, roomSpawnCap, generateDungeon
} from '../src/dungeon/dungeon_generator.js';
import { crToCost, maxCrForDungeonLevel } from '../src/game/constants.js';
import { spawnMonster, dungeonMonsterIds, dungeonMonsterCRs } from '../src/game/srd.js';
import { shouldUseStoryCast } from '../src/game/quest_events.js';

const LEVELS = [1, 2, 4, 8, 12, 16, 20];

/* The CR a spawn point is priced at, mirroring game.js's crOffset handling —
   including its clamp to the level ceiling (a step-up past the ceiling is priced
   at the ceiling, exactly what spawnMonster fields). */
function slotCR(sp, level) {
  let tcr = sp.targetCR ?? 1;
  if (sp.crOffset !== undefined && !sp.fixedCR) {
    tcr = Math.max(0.125, sp.crOffset >= 0
      ? tcr * Math.pow(1.5, sp.crOffset)
      : tcr * Math.pow(0.6, -sp.crOffset));
    tcr = Math.min(tcr, maxCrForDungeonLevel(level));
  }
  return tcr;
}

/* Statistical spawn simulations over many seeds: 5–25 s each in isolation,
   longer under the full suite's worker contention. Not a hang. */
describe('a room spends its threat purse', { timeout: 90000 }, () => {
  it('gets close to budget instead of stopping at the first unaffordable roll', () => {
    /* The old loop broke on the first CR it could not afford, leaving 13-23%
       of every room unspent. It must now step down the CR ladder instead. */
    for (const level of LEVELS) {
      let budget = 0, spent = 0;
      for (let i = 0; i < 400; i++) {
        const r = buyRoomSpawns({ level, roomType: 'combat', difficulty: Math.random() });
        budget += r.budget;
        spent += r.spent;
      }
      const used = spent / budget;
      expect(used, `level ${level} only spends ${(used * 100).toFixed(0)}% of its budget`)
        .toBeGreaterThan(0.85);
    }
  });

  it('stops only at the slot cap or when it cannot afford the cheapest creature', () => {
    for (const level of LEVELS) {
      const cheapest = crToCost(Math.min(...[0.125, 0.25, 0.5, 1].filter(
        c => c <= maxCrForDungeonLevel(level))));
      for (let i = 0; i < 200; i++) {
        const r = buyRoomSpawns({ level, roomType: 'combat', difficulty: Math.random() });
        const atCap = r.crs.length >= r.cap;
        const brokeByPurse = r.remaining < cheapest;
        expect(atCap || brokeByPurse,
          `level ${level}: stopped at ${r.crs.length}/${r.cap} slots with ${r.remaining} left`
        ).toBe(true);
      }
    }
  });

  it('never exceeds the cap that spawn_budget.json declares', () => {
    for (const level of LEVELS) {
      const cap = roomSpawnCap(level);
      for (const roomType of ['combat', 'elite', 'boss']) {
        for (let i = 0; i < 200; i++) {
          const r = buyRoomSpawns({ level, roomType, difficulty: Math.random() });
          expect(r.crs.length).toBeLessThanOrEqual(cap);
          expect(r.crs.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('honours the cap when spawn_budget.json is retuned', () => {
    /* Both knobs bind: the global maxSpawns AND the per-level spawnCap. */
    const origMax = SB.maxSpawns;
    const origCap = SB.levelCurve['8'].spawnCap;
    try {
      SB.maxSpawns = 3;
      expect(roomSpawnCap(8)).toBe(3);
      for (let i = 0; i < 200; i++) {
        expect(buyRoomSpawns({ level: 8, roomType: 'boss', difficulty: 1 }).crs.length)
          .toBeLessThanOrEqual(3);
      }
      SB.maxSpawns = 99;
      SB.levelCurve['8'].spawnCap = 2;
      expect(roomSpawnCap(8)).toBe(2);
      for (let i = 0; i < 200; i++) {
        expect(buyRoomSpawns({ level: 8, roomType: 'boss', difficulty: 1 }).crs.length)
          .toBeLessThanOrEqual(2);
      }
    } finally {
      SB.maxSpawns = origMax;
      SB.levelCurve['8'].spawnCap = origCap;
    }
  });

  it('a bigger budget buys more threat, up to the cap', () => {
    /* The room draws a single target CR, so a bigger purse does not always mean
       more BODIES — it can buy the same count at a higher CR. The invariant is
       threat value: both calls spend their purse to within the cheapest rung, so
       the bigger purse must field strictly more CR-cost. */
    const small = buyRoomSpawns({ level: 8, budget: 40, cap: 20 });
    const big = buyRoomSpawns({ level: 8, budget: 400, cap: 20 });
    const worth = (r) => r.crs.reduce((a, c) => a + crToCost(c), 0);
    expect(worth(big)).toBeGreaterThan(worth(small));
    expect(big.crs.length).toBeLessThanOrEqual(20);
    /* A purse big enough to fill the whole room does fill it. */
    expect(buyRoomSpawns({ level: 8, budget: 4000, cap: 6 }).crs.length).toBe(6);
  });

  it('snaps to the CRs actually available when a roster is supplied', () => {
    /* With roster CRs passed in, the purse is charged for what the room can
       really field — no downshift surprise later in game.js. */
    const available = [0.25, 1];
    for (let i = 0; i < 300; i++) {
      const r = buyRoomSpawns({ level: 12, roomType: 'combat', difficulty: 0.8, availableCRs: available });
      for (const c of r.crs) expect(available).toContain(c);
    }
  });

  it('never fields a creature stronger than the slot was priced for', () => {
    /* Hard ceiling: the party must not meet anything above the level's
       controlled strength. The old +/-50% CR window let the top half of the
       band field a creature dearer than the slot it filled. Erring cheap is
       fine and intended; erring strong is not. */
    for (const theme of ['grim', 'verdant', 'molten', 'frost', 'ancient']) {
      const roster = dungeonMonsterIds(theme);
      for (const level of [1, 2, 4, 8, 12, 16, 20]) {
        for (let s = 0; s < 4; s++) {
          const d = generateDungeon(900 + s, { seed: 900 + s, level, roomCount: 14, themeKey: theme });
          for (const sp of d.spawns) {
            const tcr = slotCR(sp, level);
            const spec = spawnMonster(tcr, level, Math.random, roster,
              { dungeonLevel: level, questFloor: 1, floors: 1 }, sp.role || null);
            expect(spec.cr,
              `${theme} lvl ${level}: slot priced CR ${tcr} fielded ${spec.id} at CR ${spec.cr}`
            ).toBeLessThanOrEqual(tcr);
          }
        }
      }
    }
  });

  it('delivers the threat value it charged the purse for', () => {
    /* A slot priced at CR 3 (28 pts) must not quietly resolve to a CR-1 worth
       16. Two things used to break this: the generator buying CRs absent from
       the theme roster, and spawnMonster drawing uniformly across the CR window
       over a bottom-heavy bestiary. Delivery measured 84-92% before the fix. */
    for (const theme of ['grim', 'verdant', 'molten']) {
      const roster = dungeonMonsterIds(theme);
      for (const level of [1, 4, 8, 12, 20]) {
        let paid = 0, fielded = 0;
        for (let s = 0; s < 6; s++) {
          const d = generateDungeon(900 + s, { seed: 900 + s, level, roomCount: 14, themeKey: theme });
          for (const sp of d.spawns) {
            const tcr = slotCR(sp, level);
            const spec = spawnMonster(tcr, level, Math.random, roster,
              { dungeonLevel: level, questFloor: 1, floors: 1 }, sp.role || null);
            paid += crToCost(tcr);
            fielded += crToCost(spec.cr);
          }
        }
        const ratio = fielded / paid;
        expect(ratio, `${theme} lvl ${level} delivers only ${(ratio * 100).toFixed(1)}% of what it paid`)
          .toBeGreaterThan(0.97);
        /* Skewing cheap is intended; overshooting the budget is not. */
        expect(ratio, `${theme} lvl ${level} over-delivers at ${(ratio * 100).toFixed(1)}%`)
          .toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('only buys CRs the theme roster can actually field', () => {
    for (const theme of ['grim', 'verdant', 'molten']) {
      const rosterCRs = new Set(dungeonMonsterCRs(theme));
      for (const level of [4, 12, 20]) {
        const r = buyRoomSpawns({ level, themeKey: theme, roomType: 'combat', difficulty: 0.6 });
        for (const c of r.crs) {
          expect(rosterCRs.has(c), `${theme} lvl ${level} bought CR ${c}, absent from its roster`).toBe(true);
        }
      }
    }
  });

  it('keeps species variety despite pinning CR', () => {
    /* Matching CR must not collapse a floor onto one creature — variety now
       comes from the several species each roster carries at a given rung. */
    const roster = dungeonMonsterIds('grim');
    const seen = new Set();
    for (let s = 0; s < 10; s++) {
      const d = generateDungeon(300 + s, { seed: 300 + s, level: 8, roomCount: 14, themeKey: 'grim' });
      for (const sp of d.spawns) {
        seen.add(spawnMonster(sp.targetCR ?? 1, 8, Math.random, roster,
          { dungeonLevel: 8, questFloor: 1, floors: 1 }, sp.role || null).id);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it('holds end-to-end through generateDungeon', () => {
    for (const level of [1, 8, 20]) {
      let budget = 0, spent = 0, rooms = 0;
      const cap = roomSpawnCap(level);
      for (let s = 0; s < 8; s++) {
        const d = generateDungeon(700 + s, { seed: 700 + s, level, roomCount: 14, themeKey: 'grim' });
        const byRoom = {};
        for (const sp of d.spawns) (byRoom[sp.roomId] = byRoom[sp.roomId] || []).push(sp);
        for (const r of d.rooms) {
          const list = byRoom[r.id];
          if (!list || (r.roomStyle && r.roomStyle !== 'generic')) continue;
          expect(list.length).toBeLessThanOrEqual(cap);
          budget += roomSpawnBudget(r.type, r.difficulty, 1, level);
          spent += list.reduce((a, sp) => a + crToCost(sp.targetCR ?? 0), 0);
          rooms++;
        }
      }
      expect(rooms).toBeGreaterThan(0);
      expect(spent / budget, `level ${level} rooms under-spend`).toBeGreaterThan(0.85);
    }
  });

  it('generic quests do NOT take the story-cast path, even with a monsterRoster', () => {
    /* decorateQuest sets q.monsterRoster on EVERY quest. If game.js routes on
       monsterRoster alone, generic rooms are spawned by planStoryFloorCast —
       a lane-locked curated cast that ignores the room budget and the level's
       CR ceiling (this was the bug: level-4 rooms fielding 4 identical CR-2
       creatures regardless of the 56-point budget). */
    const generic = { level: 4, theme: 'grim', monsterRoster: { 1: ['giant-rat'], 2: ['ghoul'] } };
    expect(shouldUseStoryCast(generic, null)).toBe(false);

    const withFloorCast = { level: 4, theme: 'grim' };
    expect(shouldUseStoryCast(withFloorCast, { monsters: { 1: ['giant-rat'] } })).toBe(true);

    const story = { level: 4, theme: 'grim', story: true, monsterRoster: { 1: ['giant-rat'] } };
    expect(shouldUseStoryCast(story, null)).toBe(true);
  });

  it('spawnMonster never exceeds the level ceiling for non-boss spawns', () => {
    /* A caller asking for a CR above the level (the floor-scaling elite pack)
       must still field the dearest creature the level actually allows. */
    for (const level of [4, 8, 12]) {
      const cap = maxCrForDungeonLevel(level);
      for (const asked of [cap, cap + 1, cap + 3, 20]) {
        for (let i = 0; i < 200; i++) {
          const spec = spawnMonster(asked, level, Math.random, null,
            { dungeonLevel: level, questFloor: 1, floors: 1 });
          expect(spec.cr, `lvl ${level} asked ${asked} fielded ${spec.id}@${spec.cr}`)
            .toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('a bypass (boss) spawn may exceed the level ceiling', () => {
    const spec = spawnMonster(20, 4, Math.random, null,
      { dungeonLevel: 4, questFloor: 1, floors: 1 }, 'boss', true, true);
    expect(spec.cr).toBeGreaterThan(maxCrForDungeonLevel(4));
  });
});
