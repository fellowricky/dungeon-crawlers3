/* Chests open in the world (the lid on the model swings back) and pay out on
 * a timer against that animation; there is no modal and nothing to click, so
 * the old "Auto-loot chests" option has no job left. Skill challenges keep
 * their presentation and only shorten the wait. These lock the pacing numbers
 * down, since the behaviour is otherwise only visible by playing. */
import { describe, it, expect, beforeEach } from 'vitest';
import { setSetting, resetSettings, getSetting, SETTING_DEFAULTS } from '../src/game/settings.js';
import { readFileSync } from 'fs';

beforeEach(() => resetSettings());

describe('chest loot', () => {
  const src = readFileSync('src/game/chest_loot.js', 'utf8');

  it('retired the auto-loot option along with the wheel', () => {
    expect(SETTING_DEFAULTS).not.toHaveProperty('autoLootChests');
    expect(getSetting('autoLootChests')).toBeUndefined();
    expect(readFileSync('src/game/options_ui.js', 'utf8')).not.toMatch(/autoLootChests/);
  });

  it("is addressed by the chest's world position so the lid can animate", () => {
    expect(readFileSync('src/game/explore.js', 'utf8')).toMatch(/lootChest\(ch,\s*\{\s*x:\s*cx,\s*z:\s*cz\s*\}\)/);
    expect(src).toMatch(/_g\.openChest\(at\.x,\s*at\.z\)/);
  });

  it('never pauses the run and reveals the haul while the lid is still moving', () => {
    expect(src).not.toMatch(/setPaused/);
    expect(src).toMatch(/const REVEAL_AT = 1\.5;/);
    expect(src).toMatch(/chest\.looted = true;/);   // claimed before the timer, the proximity check runs every frame
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
