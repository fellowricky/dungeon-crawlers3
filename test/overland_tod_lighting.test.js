import { describe, it, expect } from 'vitest';
import { timeOfDayTheme, buildEffectiveOverlandTheme, TOD_LIGHT_KEYS } from '../src/dungeon/overland_weather.js';

const base = () => ({
  overland: true, accent: '#fff',
  bg: 0x101010, fog: 0x202020, fogD: 0.001,
  hemi: [0x3c4c42, 0x121614, 0.46], dir: [0xadbcad, 0.5], sunAngle: [54, 46.5],
  torchLight: [0xff8800, 1.8, 8]
});

describe('per-time-of-day overland lighting (theme.tod)', () => {
  it('a tuned night replaces the derived night and leaves day and dusk alone', () => {
    const th = base();
    const dayBefore = timeOfDayTheme(th, 'day'), duskBefore = timeOfDayTheme(th, 'dusk');
    th.tod = { night: { hemi: [0x223344, 0x050505, 0.3], dir: [0x8899aa, 0.2], torchLight: [0xff8800, 2.6, 10] } };
    const night = timeOfDayTheme(th, 'night');
    expect(night.hemi).toEqual([0x223344, 0x050505, 0.3]);
    expect(night.dir).toEqual([0x8899aa, 0.2]);
    expect(night.torchLight).toEqual([0xff8800, 2.6, 10]);
    expect(night.sunAngle).toEqual([120, 32]);                 // untuned keys still derive
    for (const k of TOD_LIGHT_KEYS) {
      expect(timeOfDayTheme(th, 'day')[k]).toEqual(dayBefore[k]);
      expect(timeOfDayTheme(th, 'dusk')[k]).toEqual(duskBefore[k]);
    }
  });

  it('returns copies: editing the result never touches the theme or its tod block', () => {
    const th = base();
    th.tod = { day: { hemi: [1, 2, 0.5] } };
    const day = timeOfDayTheme(th, 'day');
    day.hemi[2] = 9; day.torchLight[1] = 9;
    expect(th.tod.day.hemi[2]).toBe(0.5);
    expect(th.hemi[2]).toBe(0.46);
  });

  it('weather still layers on top of the tuned time', () => {
    const th = base();
    th.tod = { dusk: { dir: [0xffaa66, 1.0], fogD: 0.0005 } };
    const rainy = buildEffectiveOverlandTheme(th, { themeKey: 'mire', timeOfDay: 'dusk', weather: 'rain' });
    expect(rainy.dir[1]).toBeCloseTo(0.65);                    // rain dims the tuned sun
    expect(rainy.fogD).toBeGreaterThanOrEqual(0.0024);         // and thickens the fog
    const clear = buildEffectiveOverlandTheme(th, { themeKey: 'mire', timeOfDay: 'dusk', weather: 'clear' });
    expect(clear.dir).toEqual([0xffaa66, 1.0]);
  });

  it('light cut-offs are per time too: day and night keep their own, as copies', () => {
    const th = base();
    th.tod = { day: { lightLevels: { bright: 1, dim: 0.4 } }, night: { lightLevels: { bright: 0.75, dim: 0.2 } } };
    expect(timeOfDayTheme(th, 'day').lightLevels).toEqual({ bright: 1, dim: 0.4 });
    expect(timeOfDayTheme(th, 'night').lightLevels).toEqual({ bright: 0.75, dim: 0.2 });
    expect(timeOfDayTheme(th, 'dusk').lightLevels).toBeUndefined();
    timeOfDayTheme(th, 'day').lightLevels.bright = 9;
    expect(th.tod.day.lightLevels.bright).toBe(1);
  });

  it('dungeon themes ignore it: one time of day, the base theme as is', () => {
    const th = { ...base(), overland: false, tod: { night: { hemi: [0, 0, 0] } } };
    expect(buildEffectiveOverlandTheme(th, { timeOfDay: 'night', weather: 'clear' })).toBe(th);
  });

  it('keeps the F4 rules light map invariant across weather conditions on tuned overland nights', async () => {
    if (typeof globalThis.document === 'undefined') {
      globalThis.innerWidth = 1920;
      globalThis.innerHeight = 1080;
      const dummyCtx = new Proxy({
        font: '', measureText: () => ({ width: 10 }),
        getImageData: () => ({ data: new Uint8Array(4) }),
        createImageData: (w = 100, h = 100) => ({ data: new Uint8Array(w * h * 4) }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} })
      }, { get(t, p) { return p in t ? t[p] : () => {}; } });
      const dummyEl = {
        setAttribute: () => {}, addEventListener: () => {}, style: { setProperty: () => {} },
        getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
        getContext: () => dummyCtx, querySelector: () => dummyEl, querySelectorAll: () => [],
        classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {}
      };
      globalThis.document = {
        createElement: () => dummyEl, createElementNS: () => dummyEl,
        getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [],
        body: dummyEl, documentElement: dummyEl
      };
    }
    if (typeof globalThis.Image === 'undefined') {
      globalThis.Image = class { set src(_v) {} };
    }
    const S = await import('../src/render/dungeon_scene.js');
    const L = await import('../src/render/sprite_lighting.js');
    const { generateDungeon } = await import('../src/dungeon/dungeon_generator.js');
    L.setLightDebug(true);
    try {
      const dClear = generateDungeon(4242, { themeKey: 'holdfast', timeOfDay: 'night', weather: 'clear' });
      S.buildScene(dClear);
      L.updateSpriteLighting([], 0.6);
      const sumClear = L.lightDebugSummary();

      const dOvercast = generateDungeon(4242, { themeKey: 'holdfast', timeOfDay: 'night', weather: 'overcast' });
      S.buildScene(dOvercast);
      L.updateSpriteLighting([], 0.6);
      const sumOvercast = L.lightDebugSummary();

      const dRain = generateDungeon(4242, { themeKey: 'holdfast', timeOfDay: 'night', weather: 'rain' });
      S.buildScene(dRain);
      L.updateSpriteLighting([], 0.6);
      const sumRain = L.lightDebugSummary();

      expect(sumClear.dark).toBeGreaterThan(0.9);
      expect(sumClear.bright).toBeLessThan(0.05);
      expect(sumClear).toEqual(sumOvercast);
      expect(sumClear).toEqual(sumRain);
    } finally {
      L.setLightDebug(false);
    }
  });
});
