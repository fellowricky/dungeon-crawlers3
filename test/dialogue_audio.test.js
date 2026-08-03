import { describe, it, expect, vi } from 'vitest';
import { showBriefing } from '../src/game/story_dialog.js';
import * as audio from '../src/game/audio.js';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    font: '', measureText: () => ({ width: 10 }), strokeText: () => {},
    fillText: () => {}, clearRect: () => {}, fillRect: () => {},
    beginPath: () => {}, arc: () => {}, fill: () => {}
  };
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Story Dialogue Audio Deduplication', () => {
  it('plays narration line once per node and prevents duplicate replay on back-navigation in briefings', () => {
    const playSpy = vi.spyOn(audio, 'playNarration').mockImplementation(() => {});
    const stopSpy = vi.spyOn(audio, 'stopNarration').mockImplementation(() => {});

    const mockGame = {
      gold: 100,
      potions: { heal: 0 }
    };

    const mission = {
      id: 'story_ch1',
      chapter: 1,
      name: 'Test Mission',
      briefing: {
        speaker: 'Rowena',
        start: 'root',
        nodes: {
          root: {
            text: 'Root dialogue',
            choices: [
              { label: 'Ask about raids', next: 'raids' }
            ]
          },
          raids: {
            text: 'Raids dialogue',
            choices: [
              { label: 'Back to root', next: 'root' }
            ]
          }
        }
      }
    };

    // 1. First opening: plays root line
    showBriefing(mockGame, mission);
    expect(playSpy).toHaveBeenCalledWith('story_ch1_brief_root');
    playSpy.mockClear();

    playSpy.mockRestore();
    stopSpy.mockRestore();
  });
});
