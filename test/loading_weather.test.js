import { describe, it, expect } from 'vitest';
import {
  plateWeatherKind,
  loadingRecipes,
  renderPlateWeather,
  PLATE_WEATHER_W,
  PLATE_WEATHER_H,
} from '../src/ui/loading_weather.js';
import { loadingSurface } from '../src/game/overland_prologue.js';
import { showLoadingScreen } from '../src/ui/loading_screen.js';

function cover(shot) {
  let n = 0, minX = shot.w, maxX = 0, minY = shot.h, maxY = 0, bottom = 0, solid = 0;
  const band = 12;
  for (let y = 0; y < shot.h; y++) {
    for (let x = 0; x < shot.w; x++) {
      const a = shot.out[(y * shot.w + x) * 4 + 3];
      if (a < 20) continue;
      n += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y >= shot.h - band) {
        bottom += 1;
        if (a > 200) solid += 1;
      }
    }
  }
  const span = band * shot.w;
  return { n, minX, maxX, minY, maxY, bottomFrac: bottom / span, solidBottom: solid / span };
}

describe('loading plate weather', () => {
  it('lists every dungeon still and every overland weather the biome rolls', () => {
    const recipes = loadingRecipes();
    const ancient = recipes.filter((r) => r.theme === 'ancient');
    expect(ancient).toEqual([{ theme: 'ancient', timeOfDay: '', weather: '', kind: '', label: 'ancient' }]);
    const snow = recipes.filter((r) => r.theme === 'snowfield' && r.timeOfDay === 'day');
    expect(snow.map((r) => r.weather)).toEqual(['snow', 'blizzard', 'clear']);
    expect(snow.map((r) => r.kind)).toEqual(['snow', 'blizzard', '']);
    const ash = recipes.find((r) => r.theme === 'ashfield' && r.weather === 'ash');
    expect(ash.kind).toBe('');
    const rain = recipes.find((r) => r.theme === 'forest' && r.timeOfDay === 'night' && r.weather === 'rain');
    expect(rain.kind).toBe('rain');
    expect(plateWeatherKind('fog')).toBe('fog');
    expect(plateWeatherKind('overcast')).toBe('');
    expect(plateWeatherKind('spores')).toBe('');
    expect(recipes.length).toBeGreaterThan(90);
  });

  it('resolves the same weather the overland map will roll', () => {
    const surface = loadingSurface(
      { mapKind: 'overland', theme: 'snowfield', skipPrologue: true },
      1,
      11,
      'snowfield',
    );
    expect(surface.theme).toBe('snowfield');
    expect(['snow', 'blizzard', 'clear']).toContain(surface.weather);
    expect(['day', 'dusk', 'night']).toContain(surface.timeOfDay);
    const again = loadingSurface(
      { mapKind: 'overland', theme: 'snowfield', skipPrologue: true },
      1,
      11,
      'snowfield',
    );
    expect(again.weather).toBe(surface.weather);
    expect(again.timeOfDay).toBe(surface.timeOfDay);
    const pinned = loadingSurface(
      {
        mapKind: 'overland',
        theme: 'holdfast',
        skipPrologue: true,
        floorPlan: [{ mapKind: 'overland', theme: 'holdfast', timeOfDay: 'night', weather: 'rain' }],
      },
      1,
      3,
      'holdfast',
    );
    expect(pinned.weather).toBe('rain');
    expect(pinned.timeOfDay).toBe('night');
  });

  it('draws rain, fog, snow, and blizzard across the plate without a solid floor', () => {
    for (const kind of ['rain', 'fog', 'snow', 'blizzard']) {
      const shot = renderPlateWeather(kind, 1.2, 4);
      expect(shot.w).toBe(PLATE_WEATHER_W);
      expect(shot.h).toBe(PLATE_WEATHER_H);
      const box = cover(shot);
      expect(box.n, kind).toBeGreaterThan(80);
      expect(box.minX, kind).toBeLessThan(80);
      expect(box.maxX, kind).toBeGreaterThan(shot.w - 80);
      /* Fog banks sit in the lower landscape and stay see-through. The other
         three fall off the bottom, so a painted floor would fill that band. */
      if (kind === 'fog') {
        expect(box.minY, kind).toBeGreaterThan(shot.h * 0.3);
        expect(box.solidBottom, kind).toBeLessThan(0.05);
      } else {
        expect(box.bottomFrac, kind).toBeLessThan(0.45);
      }
    }
  });

  it('draws plate rain as short thin streaks', () => {
    const shot = renderPlateWeather('rain', 1.2, 4);
    const { w, h, out } = shot;
    const lit = (x, y) => out[(y * w + x) * 4 + 3] > 20;
    let n = 0, longestH = 0, longestV = 0;
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        if (!lit(x, y)) { run = 0; continue; }
        n += 1;
        run += 1;
        if (run > longestH) longestH = run;
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y < h; y++) {
        if (!lit(x, y)) { run = 0; continue; }
        run += 1;
        if (run > longestV) longestV = run;
      }
    }
    expect(n).toBeGreaterThan(700);
    expect(n).toBeLessThan(2200);
    expect(longestV).toBeLessThan(14);
    expect(longestH).toBeLessThan(6);
  });

  it('puts a weather canvas on the curtain only for a drawn kind', () => {
    const registry = new Map();
    function el(id = '') {
      const node = {
        id,
        className: '',
        textContent: '',
        style: {},
        attributes: {},
        children: [],
        classList: {
          _classes: new Set(),
          add(...c) { c.forEach((x) => this._classes.add(x)); },
          remove(...c) { c.forEach((x) => this._classes.delete(x)); },
          contains(c) { return this._classes.has(c); },
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        appendChild(child) {
          this.children.push(child);
          if (child.id) registry.set(child.id, child);
        },
        addEventListener() {},
      };
      if (id) registry.set(id, node);
      return node;
    }
    global.document = {
      body: el('body'),
      getElementById: (id) => registry.get(id) || null,
      createElement: () => el(''),
    };
    showLoadingScreen({ title: 'SNOW', theme: 'snowfield', timeOfDay: 'day', weather: 'blizzard', seed: 4 });
    const overlay = document.getElementById('dungeon-loading-overlay');
    expect(overlay.attributes['data-weather']).toBe('blizzard');
    expect(document.getElementById('dungeon-loading-weather')).not.toBeNull();

    showLoadingScreen({ title: 'ASH', theme: 'ashfield', timeOfDay: 'dusk', weather: 'ash', seed: 4 });
    expect(document.getElementById('dungeon-loading-overlay').attributes['data-weather']).toBe('');
    delete global.document;
  });
});
