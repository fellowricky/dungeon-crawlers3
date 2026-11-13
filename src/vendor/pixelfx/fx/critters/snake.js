import { fit, hex, clamp, wrap, lerp, smooth, TAU } from "../../core/index.js";
import { Grid, shift, shadow } from "./_lib.js";

export const meta = {
  name: "Snake",
  desc: "A snake lies flat until it slithers, humps rolling back along its body only while it crawls. Its forked tongue keeps flicking either way.",
  tags: ["critter", "snake", "reptile", "ground", "loop"],
  size: [136, 56],
  origin: [68, 48],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "ground",
  options: {
    palette: ["#08120e", "#14361c", "#1f5527", "#307630", "#55993e", "#87ad58", "#a8b982"],
    belly: ["#453613", "#98772e", "#bfa85a"],
    seed: 1,
    // Body clock. Advances only while the snake is crossing to a new patch.
    slither: 0,
    // 0 lies flat. 1 is a full slither. The game eases this at the start and end of a crawl.
    wave: 0,
    // Tongue clock. The game advances this even when the body is still.
    flick: 0,
  },
};

const D = meta.duration, HEAD = 30, LEN = 70, GRID = new Grid(-44, -24, 88, 26);
const TONGUE = hex("#e8304a");
const K = TAU / 30, W = (TAU * 2) / D;
// Three quick darts, a short rest, then again. Short enough that a resting snake still reads as alive.
const FLICK = 0.64, FLICK_ON = 0.5;

function waveOf(o) {
  const k = o.wave;
  if (k == null) return 1;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

// the body's centre height u px behind the head. Humps roll only while `k` is up; at rest the body is flat and the neck still lifts into the head.
function lift(u, t, k) {
  const wave = Math.max(0, Math.sin(K * u - W * t)) ** 0.85, env = smooth(8, 18, u) * (1 - smooth(LEN - 14, LEN - 2, u));
  const neck = u < 12 ? 6 * (1 - u / 12) ** 2 : 0;
  return 7 * wave * env * k + neck;
}
const radius = (u) => (u < 6 ? 3.3 : lerp(3.4, 0.6, ((u - 6) / (LEN - 6)) ** 1.3));
// the head's bob with the rhythm, and the tongue's flicks
const bob = (t, k) => 0.8 * Math.sin(W * t) * k;
function tongue(t) {
  const k = wrap(t, FLICK) / FLICK_ON;
  if (k >= 1) return 0;
  return Math.max(0, Math.sin(k * Math.PI * 3)) ** 0.6;
}

function snake(g, C, B, t, k) {
  g.clear();
  const hb = bob(t, k);
  // the body, column by column from the tail to the neck: lit along its back, a gold belly, dark diamonds, glints on the humps
  for (let u = LEN; u >= 2; u -= 0.5) {
    const x = HEAD - u, r0 = radius(u), cy = -r0 - lift(u, t, k) + (u < 12 ? hb * (1 - u / 12) : 0), hump = lift(u, t, k);
    // keep the body as thick across its slope as along the floor
    const slope = (lift(u + 0.5, t, k) - lift(u - 0.5, t, k)), r = r0 * Math.sqrt(1 + slope * slope);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      const v = (y + 0.5 - cy) / r;
      if (Math.abs(v) > 1) continue;
      let c = v < -0.5 ? C[4] : v < 0.1 ? C[3] : v < 0.45 ? C[2] : v < 0.8 ? B[1] : B[0];
      const dm = Math.abs(((u + 2) % 7) - 3.5) / 3.5 + Math.abs(v + 0.25) / 0.55;
      if (dm < 0.85 && v < 0.35 && u > 4) c = dm < 0.5 ? C[1] : C[2];
      if (v < -0.62 && hump > 4.5 && dm >= 0.85) c = hump > 6 ? C[6] : C[5];
      if (v > 0.45 && v < 0.8 && Math.floor(u) % 3 === 0) c = B[2];
      g.set(x, y, c);
    }
  }
  // the head: a blunt wedge raised off the floor, lit on top, an eye with a slit pupil, a nostril, a mouth line
  const hx = HEAD + 2, hy = -9.5 + hb;
  g.shade(hx - 5, hy - 4, hx + 6, hy + 4, (x, y) => {
    const dx = (x - hx) / (x > hx ? 5.6 : 4.6), dy = (y - hy) / (3.6 - Math.max(0, x - hx) * 0.18);
    if (dx * dx + dy * dy > 1) return 0;
    if (dy > 0.55) return B[1];
    return dy < -0.3 ? (dx < 0.3 ? C[5] : C[4]) : C[3];
  });
  g.line(hx - 1, hy + 1.5, hx + 5, hy + 1.2, C[1]);
  g.set(hx + 1, hy - 2, C[0]); g.set(hx + 2, hy - 2, B[2]); g.set(hx + 1, hy - 1, B[2]); g.set(hx + 2, hy - 1, C[0]);
  g.set(hx + 1, hy - 3, C[6]);
  g.set(hx + 5, hy - 1, C[1]);
  g.outline(C[0]);
}

function bodyTime(time, o) {
  return shift(o.slither != null ? o.slither : time, D, o.seed);
}

function flickTime(time, o) {
  return shift(o.flick != null ? o.flick : time, FLICK, o.seed);
}

export function draw(p, time, o) {
  const body = bodyTime(time, o), live = flickTime(time, o), k = waveOf(o), C = fit(o.palette, 7), B = fit(o.belly, 3), hb = bob(body, k);
  // the tongue darts out of the still mouth, forked, and flicks back
  const e = tongue(live), tx = HEAD + 7.5, ty = -8.2 + hb;
  if (e > 0.05) {
    const L = 7 * e, wig = Math.sin(live * 60) * 0.6 * e;
    p.line(tx, ty, tx + L, ty + wig, TONGUE);
    if (L > 3) p.px(tx + L + 1, ty + wig - 1, TONGUE), p.px(tx + L + 1, ty + wig + 1, TONGUE);
  }
  const g = GRID;
  snake(g, C, B, body, k);
  g.draw(p);
  // a glint in its eye
  p.glow(HEAD + 3.5, -11 + hb, 4, B[2], 0.35);
}

export function drawBack(p, time, o) {
  const t = bodyTime(time, o), k = waveOf(o), C = fit(o.palette, 7);

  // a shadow along its length, softer under the humps
  for (let u = 2; u <= LEN; u += 2) {
    const h = lift(u, t, k), r = radius(u);
    shadow(p, HEAD - u, -0.2, 2.2 + r * 0.4, 1.2, C[0], 0.5 * (1 - clamp(h / 10)) + 0.1);
  }
  shadow(p, HEAD + 2, -0.2, 5, 1.2, C[0], 0.35);
}
