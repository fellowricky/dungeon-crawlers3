import { describe, it, expect, beforeAll } from 'vitest';
import { generateQuests, generateSequelQuest } from '../src/game/quests.js';
import { normalizeQuest, phaseNeedsChoice, onQuestCompleted, getSequelOffers, updateQuestTracker } from '../src/game/quest_events.js';
import { BOSS_IDS, monsterName } from '../src/game/srd.js';

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
        expect(BOSS_IDS.includes(q.finalBossId)).toBe(true);
        expect(q.finalBossName).toBe(monsterName(q.finalBossId));
        
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
});
