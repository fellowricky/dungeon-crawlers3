import { describe, it, expect, beforeEach, vi } from 'vitest';

/* The help panel's claims must match the code, and the first-run tips must
   fire exactly once each across sessions (they persist in settings). */
describe('how to play', () => {
  beforeEach(() => {
    let store = {};
    globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  });

  it('documents every hotkey the game binds', async () => {
    const { HELP_TABS } = await import('../src/game/help_ui.js');
    const keys = HELP_TABS.find(t => t.key === 'keys').html;
    for (const k of ['M', 'E', 'Esc', 'Space', 'L', '1', '2', '3', 'I', 'K', 'F3']) {
      expect(keys).toContain(`<kbd>${k}</kbd>`);
    }
    const game = (await import('fs')).readFileSync(new URL('../src/game/game.js', import.meta.url), 'utf8');
    for (const k of ['F3', "'1'", "'2'", "'3'", "'l'", "'m'", "'e'", 'Escape', "'Space'"]) expect(game).toContain(k);
  });

  it('states the rules the engine uses: 30% recovery, CON save on damage, 0.7× default speed', async () => {
    const { HELP_TABS } = await import('../src/game/help_ui.js');
    const { SETTING_DEFAULTS } = await import('../src/game/settings.js');
    const loop = HELP_TABS.find(t => t.key === 'loop').html;
    const combat = HELP_TABS.find(t => t.key === 'combat').html;
    expect(loop).toContain('30% HP');
    expect(combat).toContain('CON save');
    expect(combat).toContain(`${SETTING_DEFAULTS.combatSpeed}×`);
  });

  it('shows each first-run tip once, and remembers across reloads', async () => {
    const { firstRunTip, onTip, TIPS } = await import('../src/game/help_ui.js');
    const { getSetting } = await import('../src/game/settings.js');
    const shown = [];
    onTip((key, text) => shown.push([key, text]));
    expect(firstRunTip('initiative')).toBe(true);
    expect(firstRunTip('initiative')).toBe(false);
    expect(firstRunTip('chest')).toBe(true);
    expect(firstRunTip('nonsense')).toBe(false);
    expect(shown.map(s => s[0])).toEqual(['initiative', 'chest']);
    expect(shown[0][1]).toBe(TIPS.initiative);
    expect(getSetting('seenTips')).toEqual({ initiative: true, chest: true });
    const persisted = JSON.parse(globalThis.localStorage.getItem('dc_settings_v1'));
    expect(persisted.seenTips.initiative).toBe(true);
  });
});
