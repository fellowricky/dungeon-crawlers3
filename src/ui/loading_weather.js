/**
 * Weather over a loading plate. Rain, fog, snow, and blizzard are the Pixel
 * Effects loops (painted by loading_weather_paint.js), drawn on their own
 * clock so a looping plate does not restart them. Clear, overcast, ash, and
 * spores leave the plate bare.
 */
import { BIOME_WEATHER_TABLES } from '../dungeon/overland_weather.js';
import {
  WEATHER_FX as FX, PLATE_WEATHER_W, PLATE_WEATHER_H, createWeatherPainter,
} from './loading_weather_paint.js';
import { startOffthreadWeather, stopOffthreadWeather, isOffthreadCanvas } from './loading_offthread.js';

export { PLATE_WEATHER_W, PLATE_WEATHER_H };

const DUNGEON_PLATES = ['ancient', 'verdant', 'frost', 'grim', 'molten'];
const OVERLAND_PLATES = ['forest', 'moor', 'mire', 'holdfast', 'boneyard', 'ruinfield', 'ashfield', 'snowfield', 'sporewood'];
const TIMES = ['day', 'dusk', 'night'];

let painter = null;
let loop = 0;
let token = 0;
let offthread = false;

export function plateWeatherKind(weather) {
  return FX[weather] ? weather : '';
}

/**
 * Every plate the curtain can show. Dungeons have one still. Overland floors
 * have day, dusk, and night, and only the weathers that biome rolls.
 */
export function loadingRecipes() {
  const out = [];
  for (const theme of DUNGEON_PLATES) {
    out.push({ theme, timeOfDay: '', weather: '', kind: '', label: theme });
  }
  for (const theme of OVERLAND_PLATES) {
    const table = BIOME_WEATHER_TABLES[theme];
    const weathers = table ? table.weathers.map((w) => w.value) : [];
    for (const timeOfDay of TIMES) {
      for (const weather of weathers) {
        out.push({
          theme,
          timeOfDay,
          weather,
          kind: plateWeatherKind(weather),
          label: `${theme} · ${timeOfDay} · ${weather}`,
        });
      }
    }
  }
  return out;
}

/** One transparent frame of a plate weather, for tests and the curtain. */
export function renderPlateWeather(kind, t = 0.4, seed = 1) {
  if (!painter) painter = createWeatherPainter();
  const out = new Uint8ClampedArray(painter.rgba(kind, t, seed));
  return { w: PLATE_WEATHER_W, h: PLATE_WEATHER_H, out };
}

export function stopPlateWeather() {
  token += 1;
  if (loop && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loop);
  loop = 0;
  if (offthread) stopOffthreadWeather();
  offthread = false;
}

/**
 * Draw `kind` into `canvas` until stopPlateWeather. The curtain worker draws
 * it when it can, so the weather keeps falling while the main thread is
 * blocked. Otherwise it runs here on requestAnimationFrame. A canvas without
 * getContext (the loading-screen test double) is left alone.
 */
export function mountPlateWeather(canvas, kind, seed = 1) {
  stopPlateWeather();
  const mine = token;
  if (!canvas || !FX[kind]) return false;
  if (startOffthreadWeather(canvas, kind, seed)) {
    offthread = true;
    return true;
  }
  /* A canvas the worker owned (it died since) has no context left here. */
  if (isOffthreadCanvas(canvas) || typeof canvas.getContext !== 'function') return false;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.createImageData !== 'function') return false;
  canvas.width = PLATE_WEATHER_W;
  canvas.height = PLATE_WEATHER_H;
  const img = ctx.createImageData(PLATE_WEATHER_W, PLATE_WEATHER_H);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!painter) painter = createWeatherPainter();
  const step = (now) => {
    if (mine !== token) return;
    img.data.set(painter.rgba(kind, (now - t0) / 1000, seed));
    ctx.putImageData(img, 0, 0);
    if (typeof requestAnimationFrame === 'function') loop = requestAnimationFrame(step);
  };
  if (typeof requestAnimationFrame !== 'function') {
    step(t0);
    return true;
  }
  loop = requestAnimationFrame(step);
  return true;
}
