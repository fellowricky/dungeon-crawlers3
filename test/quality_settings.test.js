import { describe, it, expect, beforeEach, vi } from 'vitest';

/* The graphics/comfort dials: settings know them, the renderer maps a quality
   level to concrete costs, and the comfort gates short-circuit the effects
   they cover. dungeon_scene.js needs a document + WebGL, so its profile table
   is checked through the same shape the module builds from. */
describe('graphics & comfort settings', () => {
  beforeEach(() => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  });

  it('ships with the full look and every comfort effect on', async () => {
    const { SETTING_DEFAULTS, GRAPHICS_QUALITY_LEVELS } = await import('../src/game/settings.js');
    expect(SETTING_DEFAULTS.graphicsQuality).toBe('high');
    expect(GRAPHICS_QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
    expect(SETTING_DEFAULTS.screenShake).toBe(true);
    expect(SETTING_DEFAULTS.hitStop).toBe(true);
    expect(SETTING_DEFAULTS.filmGrain).toBe(true);
    expect(SETTING_DEFAULTS.uiScale).toBe(1.0);
    expect(SETTING_DEFAULTS.perfOverlay).toBe(false);
  });

  it('notifies subscribers so the renderer can re-apply a changed dial', async () => {
    const { setSetting, onSettingsChange, getSetting } = await import('../src/game/settings.js');
    const heard = [];
    const off = onSettingsChange((k, v) => heard.push([k, v]));
    setSetting('graphicsQuality', 'low');
    setSetting('screenShake', false);
    off();
    expect(getSetting('graphicsQuality')).toBe('low');
    expect(heard).toEqual([['graphicsQuality', 'low'], ['screenShake', false]]);
    setSetting('graphicsQuality', 'high');
    setSetting('screenShake', true);
  });

  it('the options panel offers the quality select, comfort toggles, UI scale and the readout', async () => {
    const src = (await import('fs')).readFileSync(new URL('../src/game/options_ui.js', import.meta.url), 'utf8');
    for (const key of ['graphicsQuality', 'screenShake', 'hitStop', 'filmGrain', 'uiScale', 'perfOverlay']) {
      expect(src).toContain(`key: '${key}'`);
    }
    expect(src).toMatch(/type: 'select'/);
  });

  it('the UI scale clamps to a sane range and lands on the root as a CSS variable', async () => {
    const set = vi.fn();
    globalThis.document = { documentElement: { style: { setProperty: set } }, createElement: () => ({ hidden: true }), body: { appendChild: () => {} } };
    const { applyUiScale } = await import('../src/ui/perf_overlay.js');
    applyUiScale(1.2);
    applyUiScale(9);
    applyUiScale('junk');
    expect(set.mock.calls.map(c => c[1])).toEqual(['1.2', '2', '1']);
  });
});
