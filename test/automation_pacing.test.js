/* The two Automation options changed shape: neither one skips its presentation
 * any more, they only shorten (or lengthen) the wait. These lock the pacing
 * numbers down, since the behaviour is otherwise only visible by playing. */
import { describe, it, expect, beforeEach } from 'vitest';
import { setSetting, resetSettings, getSetting } from '../src/game/settings.js';
import { autoTakeSeconds } from '../src/game/chest_wheel.js';
import { readFileSync } from 'fs';

beforeEach(() => resetSettings());

describe('auto-loot chests', () => {
  it('defaults to the hands-off 30s idle countdown', () => {
    expect(getSetting('autoLootChests')).toBe(false);
    expect(autoTakeSeconds()).toBe(30);
  });

  it('takes the loot 3s after the wheel stops when enabled', () => {
    setSetting('autoLootChests', true);
    expect(autoTakeSeconds()).toBe(3);
  });

  /* The wheel must keep spinning either way — the setting is no longer allowed
     to reach lootChest's showWheel argument. */
  it('still shows the spin wheel when enabled', () => {
    const src = readFileSync('src/game/explore.js', 'utf8');
    expect(src).toMatch(/lootChest\(ch,\s*true\)/);
    expect(src).not.toMatch(/autoLootChests/);
  });
});

describe('auto-complete skill challenges', () => {
  const src = readFileSync('src/game/skills.js', 'utf8');

  it('holds the choose phase open while narration is still speaking', () => {
    expect(src).toMatch(/isNarrationActive\(\)\s*&&\s*waited\s*<\s*AUTO_CHOOSE_IDLE_MS/);
  });

  it('keeps a floor so an unrecorded or muted line still leaves a reading beat', () => {
    expect(src).toMatch(/waited\s*<\s*AUTO_CHOOSE_MIN_MS/);
    expect(src).toMatch(/const AUTO_CHOOSE_MIN_MS = 900;/);
  });

  it('caps the narration wait so a stuck line cannot stall the run', () => {
    expect(src).toMatch(/const AUTO_CHOOSE_IDLE_MS = 30000;/);
    expect(src).toMatch(/const AUTO_CONTINUE_MAX_MS = 45000;/);
  });

  it('applies the same rule to the result-phase auto-continue', () => {
    expect(src).toMatch(/isNarrationActive\(\)\s*&&\s*waited\s*<\s*AUTO_CONTINUE_MAX_MS/);
    expect(src).toMatch(/const AUTO_CONTINUE_MIN_MS = 15000;/);
  });
});
