import { describe, it, expect } from 'vitest';
import { THEMES, generateOverland } from '../src/dungeon/dungeon_generator.js';
import {
  BIOME_WEATHER_TABLES,
  resolveOverlandEnvironment,
  buildEffectiveOverlandTheme
} from '../src/dungeon/overland_weather.js';

const OVERLAND_BIOMES = ['forest', 'moor', 'mire', 'holdfast', 'boneyard', 'ruinfield', 'ashfield', 'snowfield', 'sporewood'];

describe('Overland Weather & Day/Night System', () => {
  it('defines weather and temporal matrices for all 9 overland biomes', () => {
    for (const biome of OVERLAND_BIOMES) {
      const table = BIOME_WEATHER_TABLES[biome];
      expect(table, `Missing table for ${biome}`).toBeDefined();
      expect(table.times.length).toBeGreaterThanOrEqual(2);
      expect(table.weathers.length).toBeGreaterThanOrEqual(2);

      // Verify weights sum to 100
      const timeSum = table.times.reduce((acc, t) => acc + t.weight, 0);
      const weatherSum = table.weathers.reduce((acc, w) => acc + w.weight, 0);
      expect(timeSum).toBe(100);
      expect(weatherSum).toBe(100);
    }
  });

  it('resolves environment deterministically given the same seed', () => {
    const seed = 1234567;
    for (const biome of OVERLAND_BIOMES) {
      const env1 = resolveOverlandEnvironment(biome, seed);
      const env2 = resolveOverlandEnvironment(biome, seed);
      expect(env1.timeOfDay).toBe(env2.timeOfDay);
      expect(env1.weather).toBe(env2.weather);
    }
  });

  it('respects explicit timeOfDay and weather overrides', () => {
    const env = resolveOverlandEnvironment('forest', 42, {
      timeOfDay: 'night',
      weather: 'rain'
    });
    expect(env.timeOfDay).toBe('night');
    expect(env.weather).toBe('rain');

    const theme = buildEffectiveOverlandTheme(THEMES.forest, env);
    expect(theme.particles.kind).toBe(5); // rain streaks
    expect(theme.heroLightNeeded).toBe(true);
    expect(theme.groundFog).toBeNull(); // rain does not create ground fog plane
  });

  it('does not have ground fog in clear weather for dry/woodland biomes', () => {
    const dryBiomes = ['forest', 'holdfast', 'ruinfield', 'snowfield', 'ashfield'];
    for (const biome of dryBiomes) {
      const env = { themeKey: biome, timeOfDay: 'day', weather: 'clear' };
      const theme = buildEffectiveOverlandTheme(THEMES[biome], env);
      expect(theme.groundFog, `${biome} should not have ground fog in clear weather`).toBeNull();
    }
  });

  it('enables ground fog when weather rolls fog', () => {
    const env = { themeKey: 'mire', timeOfDay: 'day', weather: 'fog' };
    const theme = buildEffectiveOverlandTheme(THEMES.mire, env);
    expect(theme.groundFog).not.toBeNull();
    expect(theme.groundFog.density).toBeGreaterThan(0.15);
    expect(theme.groundFog.height).toBeGreaterThan(0.10);
  });

  it('enables party lantern (heroLightNeeded) at night and dusk, disables on clear days', () => {
    const dayTheme = buildEffectiveOverlandTheme(THEMES.forest, {
      themeKey: 'forest', timeOfDay: 'day', weather: 'clear'
    });
    expect(dayTheme.heroLightNeeded).toBe(false);

    const nightTheme = buildEffectiveOverlandTheme(THEMES.forest, {
      themeKey: 'forest', timeOfDay: 'night', weather: 'clear'
    });
    expect(nightTheme.heroLightNeeded).toBe(true);
    expect(nightTheme.heroLightIntensity).toBeGreaterThanOrEqual(2.0);

    const duskTheme = buildEffectiveOverlandTheme(THEMES.forest, {
      themeKey: 'forest', timeOfDay: 'dusk', weather: 'clear'
    });
    expect(duskTheme.heroLightNeeded).toBe(true);
  });

  it('attaches weather and timeOfDay to generated overland maps', () => {
    const d = generateOverland({
      seed: 8888,
      themeKey: 'forest',
      mapW: 48,
      mapH: 48,
      zones: 4
    });

    expect(d.overland).toBe(true);
    expect(d.weather).toBeDefined();
    expect(d.timeOfDay).toBeDefined();
    expect(d.weatherEnv).toBeDefined();
    expect(d.effectiveTheme).toBeDefined();
    expect(['day', 'dusk', 'night']).toContain(d.timeOfDay);
    expect(['clear', 'overcast', 'rain', 'fog']).toContain(d.weather);
  });
});
