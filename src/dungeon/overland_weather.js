/**
 * OVERLAND WEATHER & DAY/NIGHT SYSTEM
 *
 * Provides dynamic temporal (Day, Dusk, Night) and atmospheric (Clear, Overcast,
 * Rain, Fog, Snow, Ashfall, Spore Drift) simulation for all overland biomes.
 *
 * Environments are derived deterministically from the level seed (or explicit
 * story/editor overrides) without mutating base theme definition literals.
 */

/* ---------------- Deterministic PRNG Helper ---------------- */
function makeWeatherRng(seed) {
  let s = (seed ^ 0xa341316c) >>> 0;
  return {
    raw: () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    pickWeighted: (entries) => {
      let total = 0;
      for (const e of entries) total += e.weight;
      let roll = makeWeatherRng(seed).raw() * total;
      // Use internal state progression
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      roll = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * total;
      for (const e of entries) {
        if (roll < e.weight) return e.value;
        roll -= e.weight;
      }
      return entries[0].value;
    }
  };
}

/* ---------------- Biome Weather & Temporal Matrices ---------------- */
export const BIOME_WEATHER_TABLES = {
  forest: {
    times: [
      { value: 'day', weight: 65 },
      { value: 'dusk', weight: 20 },
      { value: 'night', weight: 15 }
    ],
    weathers: [
      { value: 'clear', weight: 60 },
      { value: 'overcast', weight: 20 },
      { value: 'rain', weight: 15 },
      { value: 'fog', weight: 5 }
    ]
  },
  moor: {
    times: [
      { value: 'day', weight: 45 },
      { value: 'dusk', weight: 30 },
      { value: 'night', weight: 25 }
    ],
    weathers: [
      { value: 'overcast', weight: 40 },
      { value: 'rain', weight: 30 },
      { value: 'fog', weight: 15 },
      { value: 'clear', weight: 15 }
    ]
  },
  mire: {
    times: [
      { value: 'day', weight: 35 },
      { value: 'dusk', weight: 35 },
      { value: 'night', weight: 30 }
    ],
    weathers: [
      { value: 'fog', weight: 45 },
      { value: 'rain', weight: 35 },
      { value: 'overcast', weight: 15 },
      { value: 'clear', weight: 5 }
    ]
  },
  holdfast: {
    times: [
      { value: 'day', weight: 65 },
      { value: 'dusk', weight: 20 },
      { value: 'night', weight: 15 }
    ],
    weathers: [
      { value: 'clear', weight: 60 },
      { value: 'overcast', weight: 25 },
      { value: 'rain', weight: 15 }
    ]
  },
  boneyard: {
    times: [
      { value: 'night', weight: 50 },
      { value: 'dusk', weight: 35 },
      { value: 'day', weight: 15 }
    ],
    weathers: [
      { value: 'fog', weight: 55 },
      { value: 'rain', weight: 25 },
      { value: 'overcast', weight: 20 }
    ]
  },
  snowfield: {
    times: [
      { value: 'day', weight: 50 },
      { value: 'night', weight: 30 },
      { value: 'dusk', weight: 20 }
    ],
    weathers: [
      { value: 'snow', weight: 55 },
      { value: 'blizzard', weight: 25 },
      { value: 'clear', weight: 20 }
    ]
  },
  ashfield: {
    times: [
      { value: 'dusk', weight: 45 },
      { value: 'night', weight: 40 },
      { value: 'day', weight: 15 }
    ],
    weathers: [
      { value: 'ash', weight: 65 },
      { value: 'clear', weight: 25 },
      { value: 'overcast', weight: 10 }
    ]
  },
  ruinfield: {
    times: [
      { value: 'day', weight: 60 },
      { value: 'dusk', weight: 25 },
      { value: 'night', weight: 15 }
    ],
    weathers: [
      { value: 'clear', weight: 65 },
      { value: 'overcast', weight: 25 },
      { value: 'rain', weight: 10 }
    ]
  },
  sporewood: {
    times: [
      { value: 'day', weight: 45 },
      { value: 'night', weight: 35 },
      { value: 'dusk', weight: 20 }
    ],
    weathers: [
      { value: 'spores', weight: 60 },
      { value: 'rain', weight: 25 },
      { value: 'fog', weight: 15 }
    ]
  }
};

/* ---------------- Weather Ground Fog Specs ---------------- */
const FOG_SPECS = {
  mire:     { density: 0.26, speed: 0.025, color: 0x809c84, scale: 0.12, height: 0.18 },
  boneyard: { density: 0.24, speed: 0.020, color: 0xa8bca4, scale: 0.11, height: 0.20 },
  moor:     { density: 0.22, speed: 0.035, color: 0xd6ded2, scale: 0.10, height: 0.22 },
  forest:   { density: 0.16, speed: 0.018, color: 0xdde6d8, scale: 0.09, height: 0.16 },
  sporewood:{ density: 0.18, speed: 0.020, color: 0x58b07a, scale: 0.10, height: 0.16 },
  default:  { density: 0.20, speed: 0.025, color: 0xd4dad0, scale: 0.10, height: 0.20 }
};

/* ---------------- Color Manipulation Utilities ---------------- */
function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
function rgbToHex(r, g, b) {
  return ((Math.max(0, Math.min(255, Math.round(r))) << 16) |
          (Math.max(0, Math.min(255, Math.round(g))) << 8) |
          Math.max(0, Math.min(255, Math.round(b)))) >>> 0;
}
function lerpColor(c1, c2, t) {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function scaleColor(c, s) {
  const [r, g, b] = hexToRgb(c);
  return rgbToHex(r * s, g * s, b * s);
}

/**
 * Resolve the dynamic weather and time of day for an overland map.
 * Returns an environment profile that can be cleanly applied to the scene.
 */
export function resolveOverlandEnvironment(themeKey, seed, options = {}) {
  const tKey = (themeKey || 'forest').toLowerCase();
  const table = BIOME_WEATHER_TABLES[tKey] || BIOME_WEATHER_TABLES.forest;
  const rng = makeWeatherRng(seed);

  // 1. Time of Day
  let timeOfDay = options.timeOfDay;
  if (!timeOfDay || timeOfDay === 'auto') {
    timeOfDay = rng.pickWeighted(table.times);
  }

  // 2. Weather Condition
  let weather = options.weather;
  if (!weather || weather === 'auto') {
    weather = rng.pickWeighted(table.weathers);
  }

  return {
    themeKey: tKey,
    timeOfDay,
    weather,
    seed
  };
}

/* Lighting keys that can be hand-tuned per time of day. A theme's
   `tod: { day: {...}, dusk: {...}, night: {...} }` (written by the dungeon
   editor into theme_overrides.json) replaces what that time would otherwise
   derive from the base theme. Weather still layers on top, so one tuned night
   serves clear, rainy and foggy nights alike. Overland only: dungeons have a
   single time of day and keep using the base theme. */
export const TOD_LIGHT_KEYS = ['bg', 'fog', 'fogD', 'hemi', 'dir', 'sunAngle', 'torchLight', 'lightLevels'];

/**
 * The base theme as it looks at one time of day, before weather: the derived
 * day/dusk/night modulation, then that time's hand-tuned `tod` values.
 * Returns a clone; the base theme is never mutated.
 */
export function timeOfDayTheme(baseTheme, timeOfDay) {
  if (!baseTheme || !baseTheme.overland) return baseTheme;

  const res = Object.assign({}, baseTheme);
  res.hemi = [...(baseTheme.hemi || [0x82b4dc, 0x4e6638, 0.45])];
  res.dir = [...(baseTheme.dir || [0xfff4db, 0.78])];
  res.sunAngle = [...(baseTheme.sunAngle || [54, 46.5])];
  res.bg = baseTheme.bg;
  res.fog = baseTheme.fog;
  res.fogD = baseTheme.fogD || 0.0006;
  res.groundFog = null; // Ground fog is null by default; enabled strictly by weather

  // ── 1. Temporal Lighting & Palette Modulations ───────────────────────
  if (timeOfDay === 'dusk') {
    // Low, raking golden/amber sun casting long dramatic shadows
    res.sunAngle = [245, 16];
    res.dir[0] = lerpColor(res.dir[0], 0xff9c4a, 0.65); // rich golden-orange
    res.dir[1] = Math.max(0.40, res.dir[1] * 0.85);

    res.hemi[0] = lerpColor(res.hemi[0], 0xcc7755, 0.60); // amber-rose sky
    res.hemi[1] = lerpColor(res.hemi[1], 0x332218, 0.55); // warm twilight earth
    res.hemi[2] = Math.max(0.35, res.hemi[2] * 0.90);

    res.bg = lerpColor(res.bg, 0x3c2420, 0.60);
    res.fog = lerpColor(res.fog, 0x4a2c26, 0.60);
    res.fogD = (res.fogD || 0.0006) * 1.15;
    res.heroLightNeeded = true;
    res.heroLightIntensity = 1.3;
  } else if (timeOfDay === 'night') {
    // Cool, silvery directional moonlight with deep shadows
    res.sunAngle = [120, 32];
    res.dir[0] = 0x88aacc; // silvery blue moonlight
    res.dir[1] = 0.28;

    res.hemi[0] = 0x182436; // midnight sky
    res.hemi[1] = 0x080c14; // dark ground
    res.hemi[2] = 0.38;

    res.bg = 0x0a1018;
    res.fog = 0x0d1420;
    res.fogD = (res.fogD || 0.0006) * 1.45;
    res.heroLightNeeded = true;
    res.heroLightIntensity = 2.4; // party lantern is vital at night
  } else {
    // Daytime
    res.heroLightNeeded = false;
    res.heroLightIntensity = 0.0;
  }

  // ── 1b. Hand-tuned lighting for this time of day ─────────────────────
  const tuned = baseTheme.tod && baseTheme.tod[timeOfDay];
  if (tuned) {
    for (const k of TOD_LIGHT_KEYS) {
      if (tuned[k] == null) continue;
      const v = tuned[k];
      res[k] = Array.isArray(v) ? [...v] : (v && typeof v === 'object') ? { ...v } : v;
    }
  }
  return res;
}

/**
 * Creates an effective theme definition combining the base theme with
 * the resolved dynamic time of day and weather.
 * Returns a cloned/merged theme object without mutating the base theme.
 */
export function buildEffectiveOverlandTheme(baseTheme, env) {
  if (!baseTheme || !baseTheme.overland) return baseTheme;
  const { timeOfDay, weather } = env;
  const res = timeOfDayTheme(baseTheme, timeOfDay);
  res.weatherDirScale = 1;
  res.weatherHemiScale = 1;

  // ── 2. Weather Condition Modulations ─────────────────────────────────
  if (weather === 'rain') {
    // Rain streaks particle system (kind 5)
    res.particles = {
      kind: 5,
      color: timeOfDay === 'night' ? 0x88a8c0 : 0xa4c6db,
      n: 420
    };
    // Overcast diffuse lighting
    res.weatherDirScale = 0.65;
    res.weatherHemiScale = 0.88;
    res.dir[1] *= res.weatherDirScale;
    res.hemi[2] *= res.weatherHemiScale;
    res.fogD = Math.max(res.fogD, 0.0024);
    res.bg = lerpColor(res.bg, 0x182028, 0.40);
    res.fog = lerpColor(res.fog, 0x222c36, 0.40);
    // In rain, heroes light their lantern for visibility
    res.heroLightNeeded = true;
    res.heroLightIntensity = Math.max(res.heroLightIntensity || 0, 1.4);
  } else if (weather === 'fog') {
    // Rolling ground fog plane enabled
    const baseSpec = FOG_SPECS[env.themeKey] || FOG_SPECS.default;
    res.groundFog = {
      density: baseSpec.density,
      speed: baseSpec.speed,
      color: timeOfDay === 'night' ? scaleColor(baseSpec.color, 0.4) : (timeOfDay === 'dusk' ? lerpColor(baseSpec.color, 0xcca888, 0.5) : baseSpec.color),
      scale: baseSpec.scale,
      height: baseSpec.height
    };
    // Higher scene fog density
    res.fogD = Math.max(res.fogD, 0.0028);
    res.weatherDirScale = 0.70;
    res.dir[1] *= res.weatherDirScale;
    // Boneyard gets glowing soul wisps (kind 3) in fog
    if (env.themeKey === 'boneyard') {
      res.particles = { kind: 3, color: 0x98d498, n: 220 };
    } else {
      res.particles = { kind: 0, color: 0xd4e2d0, n: 80 };
    }
    if (timeOfDay === 'night' || timeOfDay === 'dusk') {
      res.heroLightNeeded = true;
    }
  } else if (weather === 'overcast') {
    res.weatherDirScale = 0.72;
    res.weatherHemiScale = 0.92;
    res.dir[1] *= res.weatherDirScale;
    res.hemi[2] *= res.weatherHemiScale;
    res.fogD = Math.max(res.fogD, 0.0016);
    res.bg = lerpColor(res.bg, 0x30363a, 0.35);
    res.fog = lerpColor(res.fog, 0x3c4448, 0.35);
    res.particles = { kind: 0, color: 0xd0d4cc, n: 60 };
  } else if (weather === 'snow' || weather === 'blizzard') {
    const isBlizzard = weather === 'blizzard';
    /* Blizzard has its own flake kind (7: fast sideways streaming, normal
       blend) and scales with the map: ~6 flakes per walkable cell. */
    res.particles = isBlizzard
      ? { kind: 7, color: 0xffffff, perCell: 6, cap: 24000 }
      : { kind: 2, color: 0xffffff, n: 320 };
    if (isBlizzard) {
      /* A whiteout, not a colour wash. The camera sits ~220 units out, so
         FogExp2 at 0.0035 buried the party under ~45% of the theme's fog
         colour, and snowfield's tuned fog is a cyan (#9ffffb) that is only
         invisible at its tuned 0.0001 density. 0.0021 is ~20% at the party,
         and the colour is pulled to a neutral snow-grey for the time of day. */
      res.fogD = Math.max(res.fogD, 0.0021);
      const whiteout = timeOfDay === 'night' ? 0x1c222a : timeOfDay === 'dusk' ? 0x6a5c5a : 0xc4ccd4;
      res.fog = lerpColor(res.fog, whiteout, 0.8);
      res.weatherDirScale = 0.60;
      res.dir[1] *= res.weatherDirScale;
    }
  } else if (weather === 'ash') {
    res.particles = {
      kind: 6,
      color: timeOfDay === 'night' ? 0xff7030 : 0xff9450,
      n: 420
    };
  } else if (weather === 'spores') {
    res.particles = {
      kind: 4,
      color: timeOfDay === 'night' ? 0x62e0a8 : 0x8fd0a0,
      n: 300
    };
  } else if (weather === 'clear') {
    // Clear weather: clean air with subtle ambient dust/sun motes
    res.particles = {
      kind: 0,
      color: timeOfDay === 'dusk' ? 0xffc870 : 0xffe8aa,
      n: 100
    };
    res.groundFog = null;
  }

  return res;
}
