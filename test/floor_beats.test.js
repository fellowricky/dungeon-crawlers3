import { describe, it, expect } from 'vitest';
import { STORY_MISSIONS } from '../src/game/story.js';

/* Slug identical to audio.js / extract_story.mjs, used to derive voice ids. */
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const beats = [];   // { mission, floor, beat }
for (const m of STORY_MISSIONS) {
  for (const [floor, beat] of Object.entries(m.floorBeats || {})) {
    beats.push({ mission: m, floor: Number(floor), beat });
  }
}

describe('end-of-floor story beats', () => {
  it('only bind to non-boss floors', () => {
    for (const { mission, floor } of beats) {
      expect(floor, `${mission.id} floor ${floor}`).toBeGreaterThanOrEqual(1);
      expect(floor, `${mission.id} floor ${floor} must be a non-boss floor`).toBeLessThan(mission.floors);
    }
  });

  it('have a start node that exists', () => {
    for (const { mission, floor, beat } of beats) {
      const start = beat.start || 'root';
      expect(beat.nodes, `${mission.id} fb${floor}`).toBeTruthy();
      expect(beat.nodes[start], `${mission.id} fb${floor} start '${start}'`).toBeTruthy();
    }
  });

  it('have no dangling choice targets, and a reachable terminal node', () => {
    for (const { mission, floor, beat } of beats) {
      const ids = new Set(Object.keys(beat.nodes));
      let terminals = 0;
      for (const [nid, node] of Object.entries(beat.nodes)) {
        const choices = node.choices || [];
        if (!choices.length) { terminals++; continue; }
        for (const c of choices) {
          expect(ids.has(c.next), `${mission.id} fb${floor} node '${nid}' -> '${c.next}'`).toBe(true);
        }
      }
      expect(terminals, `${mission.id} fb${floor} needs a terminal node`).toBeGreaterThan(0);
    }
  });

  it('carry a well-formed skill challenge (nid + 3 approaches + reward)', () => {
    for (const { mission, floor, beat } of beats) {
      const ch = beat.challenge;
      expect(ch, `${mission.id} fb${floor} challenge`).toBeTruthy();
      expect(typeof ch.nid, `${mission.id} fb${floor} needs an explicit nid`).toBe('string');
      expect(ch.reward, `${mission.id} fb${floor} reward`).toBeTruthy();
      expect(Array.isArray(ch.approaches) && ch.approaches.length === 3,
        `${mission.id} fb${floor} needs exactly 3 approaches`).toBe(true);
      for (const a of ch.approaches) {
        expect(a.skill, `${mission.id} fb${floor} approach skill`).toBeTruthy();
        expect(a.win && a.lose, `${mission.id} fb${floor} approach win/lose`).toBeTruthy();
      }
      expect(ch.visuals && ch.visuals.backdrop, `${mission.id} fb${floor} backdrop`).toBeTruthy();
    }
  });

  it('use globally-unique challenge nids', () => {
    const nids = beats.map(b => b.beat.challenge?.nid).filter(Boolean);
    expect(new Set(nids).size, 'duplicate floor-beat nid').toBe(nids.length);
  });

  it('do not collide with any storyChallenge voice base', () => {
    const storyBases = new Set();
    for (const m of STORY_MISSIONS)
      for (const sc of m.storyChallenges || [])
        if (sc.challenge?.name) storyBases.add(slug(sc.challenge.nid || sc.challenge.name));
    for (const { mission, floor, beat } of beats) {
      const base = slug(beat.challenge.nid);
      expect(storyBases.has(base), `${mission.id} fb${floor} nid '${base}' collides with a storyChallenge`).toBe(false);
    }
  });
});
