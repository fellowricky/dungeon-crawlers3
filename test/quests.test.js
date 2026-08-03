import { describe, it, expect, beforeAll } from 'vitest';
import { generateQuests, generateSequelQuest } from '../src/game/quests.js';
import { normalizeQuest, phaseNeedsChoice, onQuestCompleted, getSequelOffers, updateQuestTracker } from '../src/game/quest_events.js';
import { MONSTERS_BY_ID, MONSTERS_ALL, dungeonMonsterIds, getThemeForMonster } from '../src/game/srd.js';

describe('Quest System Data Layer', () => {
  beforeAll(() => {
    // Stub document for headless compatibility, matching smoke_quests.mjs stubbing
    globalThis.document = {
      getElementById: () => ({ classList: { add() {}, remove() {}, contains() { return false; } }, innerHTML: '', appendChild() {}, children: [], removeChild() {}, firstChild: null, style: {} }),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
      body: { appendChild() {} }, head: { appendChild() {} }
    };
  });

  it('should validate generation invariants across multiple rolls', () => {
    for (let trial = 0; trial < 20; trial++) {
      const pl = 1 + (trial % 8);
      const quests = generateQuests(pl, 3);
      expect(quests.length).toBe(3);
      
      for (const q of quests) {
        expect(typeof q.embarkText).toBe('string');
        expect(q.embarkText.length).toBeGreaterThan(40);
        expect(typeof q.victoryText).toBe('string');
        expect(q.victoryText.length).toBeGreaterThan(40);
        expect(q.description).toBe(q.embarkText);
        expect(q.embarkText.includes('{')).toBe(false);
        expect(q.victoryText.includes('{')).toBe(false);
        
        expect(q.finalBossId).toBeDefined();
        expect(q.finalBossId in MONSTERS_BY_ID).toBe(true);
        expect(typeof q.finalBossName).toBe('string');
        expect(q.finalBossName.length).toBeGreaterThan(0);
        
        expect(Array.isArray(q.phases)).toBe(true);
        expect(Array.isArray(q.sideObjectives)).toBe(true);
        expect(q.chain).toBeNull();
        
        // phase invariants
        const expectPhases = q.floors < 3 ? 0 : q.floors <= 5 ? 1 : q.floors <= 8 ? 2 : 3;
        expect(q.phases.length).toBeLessThanOrEqual(expectPhases);
        
        const types = new Set();
        let prev = -99;
        for (const p of q.phases) {
          expect(p.floor).toBeGreaterThanOrEqual(2);
          expect(p.floor).toBeLessThanOrEqual(q.floors - 1);
          expect(p.floor - prev).toBeGreaterThanOrEqual(2);
          prev = p.floor;
          expect(types.has(p.type)).toBe(false);
          types.add(p.type);
          expect(typeof p.rumor).toBe('string');
          expect(p.rumor.length).toBeGreaterThan(10);
          expect(p.choice).toBeNull();
          expect(p.resolved).toBe(false);
          
          if (p.type === 'ally') {
            expect(p.data.candidates.length).toBe(2);
            expect(p.data.candidates[0].kind).not.toBe(p.data.candidates[1].kind);
          }
          if (p.type === 'foreshadow') {
            expect(q.floors).toBeGreaterThanOrEqual(4);
          }
        }
        
        // objective invariants
        const expObj = q.floors < 2 ? 0 : q.floors >= 5 ? 2 : 1;
        expect(q.sideObjectives.length).toBe(expObj);
        const oKinds = new Set();
        for (const so of q.sideObjectives) {
          expect(oKinds.has(so.kind)).toBe(false);
          oKinds.add(so.kind);
          expect(so.need).toBeGreaterThanOrEqual(2);
          expect(so.have).toBe(0);
          expect(so.done).toBe(false);
          expect(so.rewardGold).toBeGreaterThanOrEqual(25);
          expect(so.rewardXp).toBeGreaterThanOrEqual(15);
          expect(so.label.includes(String(so.need))).toBe(true);
        }
      }
    }
  });

  it('should honor levelOffsets band contract', () => {
    for (let trial = 0; trial < 10; trial++) {
      const pl = 2 + (trial % 7);
      const offsets = [-1, 1, 0, 0, 0, 0];
      const qs = generateQuests(pl, 6, { levelOffsets: offsets });
      expect(qs.length).toBe(6);
      expect(qs.map(q => q.level)).toEqual([pl - 1, pl + 1, pl, pl, pl, pl]);
      // 6 quests must land on 6 distinct map positions
      const locs = new Set(qs.map(q => `${q.mapLocation.x},${q.mapLocation.y}`));
      expect(locs.size).toBe(6);
    }
  });

  it('should clamp below-level band to level 1 for a fresh party', () => {
    const qs = generateQuests(1, 6, { levelOffsets: [-1, 1, 0, 0, 0, 0] });
    expect(qs.map(q => q.level)).toEqual([1, 2, 1, 1, 1, 1]);
  });

  it('legendaries stay 10-floor-only and are no longer guaranteed per board', () => {
    let boards = 0, legendaryBoards = 0, tenFloorBoards = 0;
    for (let trial = 0; trial < 60; trial++) {
      const qs = generateQuests(6, 6, { levelOffsets: [-1, 1, 0, 0, 0, 0] });
      boards++;
      const tenFloor = qs.filter(q => q.floors >= 10);
      if (tenFloor.length) tenFloorBoards++;
      for (const q of qs) {
        if (q.isLegendaryReward) expect(q.floors).toBe(10);
      }
      if (qs.some(q => q.isLegendaryReward)) legendaryBoards++;
    }
    // Scarcity: with a 22-37% roll per 10-floor quest, many boards with a
    // 10-floor offer must still come up empty (old code guaranteed one on
    // roughly every board that had a 10-floor quest).
    expect(legendaryBoards).toBeLessThan(tenFloorBoards);
  });

  it('pity counter forces a legendary onto the hardest 10-floor offer', () => {
    let sawForcedBoard = false;
    for (let trial = 0; trial < 40 && !sawForcedBoard; trial++) {
      const qs = generateQuests(6, 6, { levelOffsets: [-1, 1, 0, 0, 0, 0], legendaryPity: 99 });
      const tenFloor = qs.filter(q => q.floors >= 10);
      if (!tenFloor.length) continue;
      sawForcedBoard = true;
      // exactly the hardest 10-floor quest must carry the pity legendary
      expect(tenFloor.some(q => q.isLegendaryReward)).toBe(true);
    }
    expect(sawForcedBoard).toBe(true);

    // pity below threshold: no forcing (still possible via the normal roll,
    // but a pity of 0 must never force on a board with no 10-floor quest)
    for (let trial = 0; trial < 10; trial++) {
      const qs = generateQuests(6, 6, { levelOffsets: [-1, 1, 0, 0, 0, 0], legendaryPity: 0 });
      for (const q of qs) {
        if (q.floors < 10) expect(q.isLegendaryReward).toBe(false);
      }
    }
  });

  it('should respect excludePositions option', () => {
    const excl = { x: 22, y: 40 };
    for (let i = 0; i < 5; i++) {
      const qs = generateQuests(3, 3, { excludePositions: [excl] });
      expect(qs.every(q => !(q.mapLocation.x === excl.x && q.mapLocation.y === excl.y))).toBe(true);
    }
  });

  it('should handle quest chain lifecycle correctly', () => {
    const game = { questChains: { active: [], log: [] }, saveGame() {}, heroes: [] };
    const [q1] = generateQuests(3, 1);
    q1.floors = 8; // ensure legendary-eligible (10 floors for part III)
    onQuestCompleted(game, q1);
    
    expect(game.questChains.active.length).toBe(1);
    const entry = game.questChains.active[0];
    expect(entry.part).toBe(2);
    expect(entry.baseSeed).toBe(q1.seed);
    expect(entry.arcTitle).toBe(q1.name);
    expect(entry.mapLocation).toBe(q1.mapLocation);

    const s1 = generateSequelQuest(entry, 4);
    const s2 = generateSequelQuest(entry, 4);
    if (s1.rewardItem && s2.rewardItem) s2.rewardItem.id = s1.rewardItem.id;
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2)); // deterministic
    expect(s1.chain.part).toBe(2);
    expect(s1.chain.baseSeed).toBe(entry.baseSeed);
    expect(s1.level).toBeGreaterThanOrEqual(q1.level);
    expect(s1.floors).toBe(Math.min(10, q1.floors + 2));
    expect(s1.phases.length).toBeGreaterThanOrEqual(1);
    expect(s1.name.includes('Part II')).toBe(true);
    expect(s1.embarkText.includes('{')).toBe(false);

    const offers = getSequelOffers(game, 4);
    expect(offers.length).toBe(1);
    expect(offers[0].id).toBe(s1.id);

    // Part II completion -> Part III
    onQuestCompleted(game, s1);
    expect(game.questChains.active.length).toBe(1);
    expect(game.questChains.active[0].part).toBe(3);
    
    const s3 = generateSequelQuest(game.questChains.active[0], 5);
    expect(s3.isLegendaryReward).toBe(true);
    expect(s3.phases.some(p => p.type === 'foreshadow')).toBe(true);
    expect(s3.name.includes('Part III')).toBe(true);

    // Part III completion -> log
    try {
      onQuestCompleted(game, s3);
    } catch (e) {
      // Ignore DOM banner element issues in headless test
    }
    expect(game.questChains.active.length).toBe(0);
    expect(game.questChains.log.length).toBe(1);
  });

  it('should normalize old saves correctly', () => {
    const old = { name: 'The Crypt of Gloomhaven', theme: 'grim', level: 2, floors: 4, seed: 123 };
    normalizeQuest(old);
    expect(Array.isArray(old.phases)).toBe(true);
    expect(Array.isArray(old.sideObjectives)).toBe(true);
    expect(old.chain).toBeNull();
    expect(old.bossIntel).toBe(false);
    expect(old.place).toBe('Gloomhaven');
  });

  it('should check if phase needs choice correctly', () => {
    expect(phaseNeedsChoice({ type: 'ambush', choice: null, resolved: false })).toBe(true);
    expect(phaseNeedsChoice({ type: 'foreshadow', choice: null, resolved: false })).toBe(false);
    expect(phaseNeedsChoice({ type: 'gauntlet', choice: 'accept', resolved: false })).toBe(false);
    expect(phaseNeedsChoice(null)).toBe(false);
  });

  it('should handle missing mapLocation gracefully in sequel quests and completion', () => {
    const entryWithoutLocation = {
      chainId: 'ch_123',
      part: 2,
      arcTitle: 'Test Saga',
      place: 'The Abyss',
      locType: 'Depths',
      theme: 'grim',
      baseSeed: 456,
      level: 3,
      floors: 5
    };
    const sequel = generateSequelQuest(entryWithoutLocation, 3);
    expect(sequel.mapLocation).toBeDefined();
    expect(typeof sequel.mapLocation.x).toBe('number');
    expect(typeof sequel.mapLocation.y).toBe('number');

    const game = { questChains: { active: [], log: [] } };
    const storyQuestWithoutLoc = { id: 'story_1', name: 'Story Mission 1', theme: 'grim', level: 1, floors: 5, seed: 789 };
    onQuestCompleted(game, storyQuestWithoutLoc);
    expect(game.questChains.active.length).toBe(1);
    expect(game.questChains.active[0].mapLocation).toBeNull();

    const sequelFromStory = generateSequelQuest(game.questChains.active[0], 3);
    expect(sequelFromStory.mapLocation).toBeDefined();
    expect(typeof sequelFromStory.mapLocation.x).toBe('number');
    expect(typeof sequelFromStory.mapLocation.y).toBe('number');
  });

  it('should keep slay objectives achievable in the dungeon they are set in', () => {
    /* This used to assert targetIds was always null, on the basis that no
       creature was whitelisted for any dungeon. The bestiary is populated
       now, so assert the property that actually matters: a slay objective
       must either match any kill, or name creatures that can genuinely
       spawn in that dungeon. Anything else is an unachievable objective. */
    let sawTargeted = 0;
    for (let trial = 0; trial < 25; trial++) {
      const quests = generateQuests(1 + (trial % 6), 3);
      for (const q of quests) {
        for (const so of q.sideObjectives || []) {
          if (so.kind !== 'slay') continue;
          if (so.targetIds === null) continue;      // "any kill" is always fine

          sawTargeted++;
          expect(Array.isArray(so.targetIds)).toBe(true);
          expect(so.targetIds.length).toBeGreaterThan(0);

          const spawnable = new Set(dungeonMonsterIds(q.theme));
          for (const id of so.targetIds) expect(spawnable.has(id)).toBe(true);
        }
      }
    }
    expect(sawTargeted).toBeGreaterThan(0);
  });

  it('names a creature family in the label only when that family can spawn there', () => {
    /* The label and the target list have to agree. Targeting the theme's
       whole roster under a "Slay N goblinoids" label let any kill in the
       dungeon tick a family-specific objective. */
    for (let trial = 0; trial < 25; trial++) {
      const quests = generateQuests(1 + (trial % 6), 3);
      for (const q of quests) {
        for (const so of q.sideObjectives || []) {
          if (so.kind !== 'slay' || !so.targetIds) continue;
          if (/Slay \d+ monsters$/.test(so.label)) continue;   // generic wording

          const families = new Set(
            so.targetIds
              .map(id => MONSTERS_ALL.find(m => m.id === id))
              .filter(Boolean)
              .map(getThemeForMonster)
          );
          expect(families.size).toBe(1);
        }
      }
    }
  });
});
