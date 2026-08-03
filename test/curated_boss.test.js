import { describe, it, expect } from 'vitest';
import { makeStoryQuest } from '../src/game/story.js';
import { spawnMonster, MONSTERS_BY_ID } from '../src/game/srd.js';

describe('Curated Final Boss Spawning', () => {
  it('preserves finalBossId and finalBossName for story missions', () => {
    const mission = {
      id: 'story_ch1',
      chapter: 1,
      name: 'Embers over Greenrise',
      theme: 'forest',
      level: 1,
      floors: 5,
      finalBossId: 'goblin-king',
      finalBossName: 'the Goblin King'
    };

    const q = makeStoryQuest(mission);
    expect(q.finalBossId).toBe('goblin-king');
    expect(q.finalBossName).toBe('the Goblin King');

    // Spawn boss monster with finalBossId
    const bossSpec = spawnMonster(3.0, 1, Math.random, [q.finalBossId], { dungeonLevel: 1, questFloor: 5, floors: 5 }, 'boss', true, true);
    expect(bossSpec.id).toBe('goblin-king');

    // Apply story boss name
    if (q.finalBossName) bossSpec.name = q.finalBossName;
    expect(bossSpec.name).toBe('the Goblin King');
  });

  it('correctly resolves monster spec for all story final boss IDs', () => {
    const storyBosses = ['goblin-king', 'grick', 'wight', 'owlbear', 'death-knight'];
    for (const bossId of storyBosses) {
      expect(MONSTERS_BY_ID[bossId]).toBeDefined();
      const spec = spawnMonster(3.0, 1, Math.random, [bossId], null, 'boss', true, true);
      expect(spec.id).toBe(bossId);
    }
  });
});
