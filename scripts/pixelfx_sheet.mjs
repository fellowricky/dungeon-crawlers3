#!/usr/bin/env node
/**
 * Export a pixelfx effect as a sprite sheet with options its CLI does not
 * expose: a canvas margin (for effects pushed past their authored size, e.g.
 * frost-breath widened to a spell's cone angle), no stand-in actor, a named
 * palette, and several seeded copies layered into one sheet.
 *
 *   node scripts/pixelfx_sheet.mjs <id> <outDir> [--margin N] [--opts JSON] [--no-actor]
 *        [--seed N] [--palette ice] [--layers "seed:dx:dy:delay,..."] [--blank-actor]
 *
 * --blank-actor  an invisible stand-in, for effects that trace the character they
 *            are drawn around (Blessing's lit outline) but still need one to run
 * --palette  a PAL ramp from the pixelfx core (ice, fire, poison, holy, ...)
 * --layers   one copy of the effect per entry, each with its own seed, offset
 *            in art px and start delay in seconds, alpha-composited in order
 *            (Ice Storm: three Starfalls landing over each other)
 *
 * Writes <outDir>/<name>.png + .json in render.mjs's format (pivot corrected
 * for the margin) for scripts/pixelfx_import.py. Needs the pixelfx checkout
 * beside this repo (G:\ClaudesFolder\pixelfx).
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PFX = resolve(import.meta.dirname, '..', '..', 'pixelfx');
const { loadEffect, renderFrames, spriteSheet, save } = await import(pathToFileURL(join(PFX, 'tools', 'lib', 'fxlib.mjs')).href);
const { PAL } = await import(pathToFileURL(join(PFX, 'src', 'core', 'index.js')).href);

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const [id, outDir] = args;
if (!id || !outDir) { console.error('usage: node scripts/pixelfx_sheet.mjs <id> <outDir> [--margin N] [--opts JSON] [--no-actor] [--seed N] [--palette ice] [--layers "seed:dx:dy:delay,..."]'); process.exit(1); }
const margin = +(flag('--margin') ?? 0);
const options = flag('--opts') ? JSON.parse(flag('--opts')) : {};
if (flag('--palette')) {
  if (!PAL[flag('--palette')]) { console.error(`no PAL.${flag('--palette')}; have: ${Object.keys(PAL).join(' ')}`); process.exit(1); }
  options.palette = PAL[flag('--palette')];
}

let renderOptions = options;
if (args.includes('--blank-actor')) {
  const { stockActor } = await import(pathToFileURL(join(PFX, 'src', 'core', 'actor.js')).href);
  const s = stockActor(2), empty = (a) => new a.constructor(a.length);
  renderOptions = { ...options, actor: { ...s, mask: { ...s.mask, data: empty(s.mask.data) }, pixels: empty(s.pixels) } };
}

const fx = await loadEffect(id);
const render = (seed) => renderFrames(fx, {
  margin, seed, bg: 'none',
  actor: args.includes('--no-actor') ? false : undefined,
  options: renderOptions,
});

let r;
if (flag('--layers')) {
  /* Each copy rendered on its own clock, then laid over the others shifted
     by (dx, dy) and started `delay` seconds in; "clear" frames are straight
     RGBA, so this is a plain alpha-over. */
  const layers = flag('--layers').split(',').map(s => { const [seed, dx, dy, delay] = s.split(':').map(Number); return { seed, dx: dx || 0, dy: dy || 0, delay: delay || 0 }; });
  const runs = layers.map(L => ({ ...L, r: render(L.seed) }));
  const { w, h, fps } = runs[0].r;
  const n = Math.max(...runs.map(L => L.r.frames.length + Math.round(L.delay * fps)));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (const L of runs) {
      const j = i - Math.round(L.delay * fps);
      if (j < 0 || j >= L.r.frames.length) continue;
      const src = L.r.frames[j].clear;
      for (let y = 0; y < h; y++) {
        const ty = y + L.dy;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < w; x++) {
          const tx = x + L.dx;
          if (tx < 0 || tx >= w) continue;
          const s = (y * w + x) * 4, a = src[s + 3] / 255;
          if (!a) continue;
          const d = (ty * w + tx) * 4, da = out[d + 3] / 255, oa = a + da * (1 - a);
          for (let c = 0; c < 3; c++) out[d + c] = (src[s + c] * a + out[d + c] * da * (1 - a)) / oa;
          out[d + 3] = oa * 255;
        }
      }
    }
    frames.push({ t: i / fps, clear: out, color: out });
  }
  r = { ...runs[0].r, n, frames };
} else {
  r = render(flag('--seed') != null ? +flag('--seed') : undefined);
}

const name = id.split('/')[1];
const s = spriteSheet(fx, r, name);
s.json.meta.pixelfx.pivot = fx.meta.origin.map(v => v + margin);
save(join(outDir, `${name}.png`), s.png);
save(join(outDir, `${name}.json`), JSON.stringify(s.json, null, 1));
console.log(`${id}  ${r.n} frames ${r.w}x${r.h}  ->  ${join(outDir, name + '.json')}`);
