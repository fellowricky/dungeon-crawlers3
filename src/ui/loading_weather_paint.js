/**
 * The plate-weather painter, with no DOM and no game imports, so the curtain
 * worker can run it as well as the main thread. Rain, fog, snow, and blizzard
 * are the Pixel Effects loops. The floor each effect paints for its gallery
 * frame (wet stone, a snow drift, whiteout haze) stays out, so the landscape
 * remains the picture.
 */
import { createFrame, clearFrame, painterFor, composite } from '../vendor/pixelfx/core/index.js';
import * as rainFx from '../vendor/pixelfx/fx/weather/rain.js';
import * as snowFx from '../vendor/pixelfx/fx/weather/snow.js';
import * as fogFx from '../vendor/pixelfx/fx/weather/fog.js';
import * as blizzardFx from '../vendor/pixelfx/fx/weather/blizzard.js';

export const WEATHER_FX = { rain: rainFx, snow: snowFx, fog: fogFx, blizzard: blizzardFx };

/** Effect buffer. Two effect pixels per buffer pixel, so a 1280-wide curtain is about two screen pixels. */
export const WEATHER_SCALE = 2;
export const PLATE_WEATHER_W = 320 * WEATHER_SCALE;
export const PLATE_WEATHER_H = 180 * WEATHER_SCALE;
export const WEATHER_ALPHA = 0.55;

function installScale(p, s) {
  p.wx = s;
  const toX = p.toX.bind(p);
  const toY = p.toY.bind(p);
  const fromX = p.fromX.bind(p);
  const fromY = p.fromY.bind(p);
  p.toX = (x, y) => toX(x * s, y * s);
  p.toY = (x, y) => toY(x * s, y * s);
  p.fromX = (sx, sy) => fromX(sx, sy) / s;
  p.fromY = (sx, sy) => fromY(sx, sy) / s;
  const stamp = (sx, sy, fn) => {
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) fn(sx + dx, sy + dy);
    }
  };
  p.px = (x, y, c) => stamp(p.cellX(x, y), p.cellY(x, y), (sx, sy) => p.put(sx, sy, c, 1));
  p.dot = (x, y, c, a = 1) => {
    if (a > 0) stamp(p.cellX(x, y), p.cellY(x, y), (sx, sy) => p.put(sx, sy, c, a));
  };
  p.light = (x, y, c, k = 1) => stamp(p.cellX(x, y), p.cellY(x, y), (sx, sy) => p.add(sx, sy, c, k));
  p.blend = (x, y, c, a) => stamp(p.cellX(x, y), p.cellY(x, y), (sx, sy) => p.blendPx(sx, sy, c, a));
}

/**
 * One reusable effect buffer. `paint(kind, t, seed)` draws a frame and
 * returns it; `rgba(kind, t, seed)` also composites it into a shared RGBA
 * array the size of the canvas.
 */
export function createWeatherPainter() {
  const frame = createFrame(PLATE_WEATHER_W, PLATE_WEATHER_H);
  const painter = painterFor(frame);
  installScale(painter, WEATHER_SCALE);
  const out = new Uint8ClampedArray(PLATE_WEATHER_W * PLATE_WEATHER_H * 4);

  function paint(kind, t, seed) {
    clearFrame(frame);
    const mod = WEATHER_FX[kind];
    if (!mod) return frame;
    const p = painter;
    p.place(PLATE_WEATHER_W / 2, PLATE_WEATHER_H - 20, false, 0);
    p.fade = 1;
    p.lightK = 0.45;
    p.wx = WEATHER_SCALE;
    const opts = {
      ...(mod.meta.options || {}),
      seed: (Number(seed) >>> 0) || 1,
      plate: 1,
      density: kind === 'rain' ? 1.15 : 1,
    };
    const dur = mod.meta.duration || 1;
    const tt = ((t % dur) + dur) % dur;
    if (mod.drawBack) mod.drawBack(p, tt, opts);
    if (mod.draw) mod.draw(p, tt, opts);
    return frame;
  }

  function rgba(kind, t, seed) {
    paint(kind, t, seed);
    composite(frame, out, null, WEATHER_ALPHA);
    return out;
  }

  return { frame, paint, rgba };
}
