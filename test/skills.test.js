import { describe, it, expect, beforeAll } from 'vitest';
import { checkRoomEntryChallenge, checkForChallenge } from '../src/game/skills.js';

describe('Skill challenges trigger condition', () => {
  beforeAll(() => {
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {
        getElementById: () => null,
        createElement: () => ({ appendChild: () => {}, style: {} }),
        body: { appendChild: () => {} },
      };
    }
  });

  it('does not trigger skill checks when room is visited but unsearched', () => {
    const mockGame = {
      state: 'crawl',
      paused: false,
      _skillsInited: true,
      heroes: [{ data: { hp: 10 } }],
      D: {
        rooms: [{ id: 0, type: 'combat', cx: 10, cy: 10 }],
        boss: 1,
      },
      visitedRooms: new Uint8Array([1, 0]),
      _searchedRooms: new Uint8Array([0, 0]), // Room 0 visited but NOT searched!
      activeQuest: {
        storyChallenges: [
          { zone: 'combat', challenge: { name: 'Test Challenge', approaches: [] } }
        ]
      },
      roomDone: () => false,
      setPaused: () => {},
    };

    checkRoomEntryChallenge(mockGame);
    expect(mockGame._storyChallengesFired?.size || 0).toBe(0);

    checkForChallenge(mockGame);
    expect(mockGame._storyChallengesFired?.size || 0).toBe(0);
  });

  it('triggers skill checks after room is searched', () => {
    const mockGame = {
      state: 'crawl',
      paused: false,
      _skillsInited: true,
      heroes: [{ data: { hp: 10 } }],
      D: {
        rooms: [{ id: 0, type: 'combat', cx: 10, cy: 10 }],
        boss: 1,
      },
      visitedRooms: new Uint8Array([1, 0]),
      _searchedRooms: new Uint8Array([1, 0]), // Room 0 is SEARCHED!
      activeQuest: {
        storyChallenges: [
          { zone: 'combat', challenge: { name: 'Test Challenge', approaches: [] } }
        ]
      },
      roomDone: () => true,
      setPaused: () => {},
    };

    checkRoomEntryChallenge(mockGame);
    expect(mockGame._storyChallengesFired?.has(0)).toBe(true);
  });
});
