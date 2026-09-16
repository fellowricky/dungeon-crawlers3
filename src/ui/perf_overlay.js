/**
 * Performance readout — the numbers to look at when "it hitches".
 *
 * Three lock-up hunts in one day (a shader recompile from a stray light, a
 * force-ended turn, a 5 MB autosave) each started from nothing but a feeling.
 * This puts the frame on screen: ms/frame with the recent worst, draw calls,
 * triangles, live textures and shader programs (a jump there IS a recompile),
 * the point-light count (which must not change mid-floor), and the engine's
 * own queues. Toggle with F3 or the Options switch; costs nothing when off.
 *
 * Reads `renderer.info` the way three.js exposes it; nothing here touches the
 * scene. Sampled four times a second so the text is readable.
 */

let host = null;
let on = false;
let frames = 0, accum = 0, worst = 0, lastSample = 0;
let lastFrameT = 0;

function el() {
  if (host || typeof document === 'undefined') return host;
  host = document.createElement('pre');
  host.id = 'dc-perf-overlay';
  host.hidden = true;
  document.body.appendChild(host);
  return host;
}

export function setPerfOverlay(enabled) {
  on = !!enabled;
  const h = el();
  if (h) h.hidden = !on;
  frames = 0; accum = 0; worst = 0; lastSample = 0;
}
export function perfOverlayOn() { return on; }

function countLights(scene) {
  let point = 0, other = 0;
  scene.traverse(o => { if (o.isPointLight) point++; else if (o.isLight) other++; });
  return { point, other };
}

/**
 * Call once per rendered frame with the real (unscaled) frame time in
 * seconds. `ctx` supplies the renderer, scene and game for the counters.
 */
export function tickPerfOverlay(rawDt, ctx) {
  if (!on) return;
  const h = el();
  if (!h) return;
  const ms = rawDt * 1000;
  frames++; accum += ms; if (ms > worst) worst = ms;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - lastSample < 250) return;
  lastSample = now;

  const avg = frames ? accum / frames : 0;
  frames = 0; accum = 0;
  const r = ctx.renderer;
  const info = r && r.info;
  const lights = ctx.scene ? countLights(ctx.scene) : { point: 0, other: 0 };
  const g = ctx.game || {};
  const pending = (g._pendingImpacts && g._pendingImpacts.length) || 0;
  const init = g.initiative && g.initiative.active
    ? `turn ${g.initiative.idx != null ? g.initiative.idx : '?'} age ${(g.initiative._turnAge || 0).toFixed(1)}s`
    : 'no combat';
  const lines = [
    `${avg.toFixed(1)} ms/frame  (${(1000 / Math.max(avg, 0.01)).toFixed(0)} fps)  worst ${worst.toFixed(0)} ms`,
    info ? `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  tex ${info.memory.textures}  geo ${info.memory.geometries}  programs ${info.programs ? info.programs.length : '?'}` : 'renderer: none',
    `lights ${lights.point} point + ${lights.other}  pixelRatio ${r ? r.getPixelRatio().toFixed(2) : '?'}`,
    `monsters ${g.monsters ? g.monsters.filter(m => m.active).length : 0}  impacts queued ${pending}  ${init}`
  ];
  h.textContent = lines.join('\n');
  worst = Math.max(0, worst * 0.5);   // the worst frame fades so a new spike shows
}

/**
 * HUD scale. `zoom` scales layout as well as paint, so the HUD's own
 * measurement-based layout (layoutHud) sees the scaled sizes and still fits
 * the panels together; a `transform` would not.
 */
export function applyUiScale(v) {
  if (typeof document === 'undefined') return;
  const s = Math.max(0.5, Math.min(2, Number(v) || 1));
  document.documentElement.style.setProperty('--dc-ui-scale', String(s));
}
