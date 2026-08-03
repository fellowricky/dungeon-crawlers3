import { describe, it, expect } from 'vitest';
import { generateQuests } from '../src/game/quests.js';
import { getCuratedMonsterRoster } from '../src/game/srd.js';

if (typeof globalThis.document === 'undefined') {
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;
  const dummyCtx = new Proxy({}, { get: () => () => {} });
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Curated Mob Lists for Quest Missions', () => {
  it('attaches a curated monsterRoster to generated quests', () => {
    const quests = generateQuests(1, 3);
    expect(quests.length).toBe(3);
    for (const q of quests) {
      expect(Array.isArray(q.monsterRoster)).toBe(true);
      expect(q.monsterRoster.length).toBeGreaterThan(0);
      if (q.finalBossId) {
        expect(q.monsterRoster.includes(q.finalBossId)).toBe(true);
      }
    }
  });

  it('guarantees goblinoid staples for Level 1 ancient/forest quests', () => {
    const roster = getCuratedMonsterRoster('forest', 1, 'goblin-king');
    expect(roster).toBeDefined();
    expect(roster.includes('goblin')).toBe(true);
    expect(roster.includes('goblin-king')).toBe(true);
  });
});
