// Arms of Hadar's portal, drawn straight down so it lies flat on the floor and holds true as the camera
// turns, under the upright tentacles (pfx_arms_of_hadar, pixelfx shadow/shadow-tendrils). Authored in the
// pixelfx checkout as shadow/hadar-portal and timed to the tendrils: it tears open over OPEN, shuts from SHUT.
import { Rng, fit, clamp, smooth, ease, noise, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { VOID, ringFast, unlight } from "../../vendor/pixelfx/fx/shadow/_lib.js";

export const meta = {
  name: "Hadar portal",
  desc: "Seen from above: the floor tears open on a starry void, arms turning down into black, a torn lit lip, cracks round it; ripples where things break through, then it pinches shut.",
  tags: ["shadow", "portal", "void", "rift", "ground", "top-down", "dark", "one-shot"],
  size: [212, 212],
  origin: [106, 106],
  duration: 3.2,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: VOID, seed: 5, radius: 76 },
};

const OPEN = 0.34, SHUT = 2.5, GONE = 2.95;

export function create(o) {
  const C = fit(o.palette, 8), R0 = o.radius, rng = new Rng(o.seed);
  const ph = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
  // cold stars far down in the dark, turning with the arms
  const stars = Array.from({ length: 34 }, () => ({
    u: Math.sqrt(rng.range(0.02, 0.7)), a: rng.range(0, TAU), tw: rng.range(2, 5), ph: rng.range(0, TAU), big: rng.chance(0.18),
  }));
  // cracks the tearing throws out across the floor
  const cracks = Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * TAU + rng.range(-0.2, 0.2), pts = [];
    let r = 0.96, ang = a;
    const len = rng.range(0.18, 0.38);
    while (r < 0.96 + len) { pts.push([r, ang]); r += 0.03; ang += rng.range(-0.06, 0.06); }
    return { pts, t0: rng.range(0.12, 0.3), w: rng.chance(0.4) };
  });
  // where the tentacles break the surface (shadow-tendrils lashes them up from 0.3 s), then where they sink
  const ripples = [];
  for (let i = 0; i < 7; i++) ripples.push({ u: rng.range(0.15, 0.6), a: rng.range(0, TAU), t0: 0.3 + i * 0.045 + rng.range(0, 0.03), life: 0.7, w: 1 });
  for (let i = 0; i < 7; i++) ripples.push({ u: rng.range(0.15, 0.6), a: rng.range(0, TAU), t0: 1.9 + i * 0.1, life: 0.6, w: 0.7 });
  for (let i = 0; i < 3; i++) ripples.push({ u: rng.range(0.1, 0.6), a: rng.range(0, TAU), t0: rng.range(0.8, 1.8), life: 0.5, w: 0.6 });

  let t = 0;
  // the open radius: tears out fast, holds with a slow breath, pinches shut
  const size = (tt) => ease.outCubic(clamp(tt / OPEN)) * (1 - ease.inCubic(clamp((tt - SHUT) / (GONE - SHUT)))) * (1 + 0.015 * Math.sin(tt * 4));
  // a ragged edge: integer harmonics so it closes on itself, crawling slowly
  const edge = (a, tt) => 1 + 0.035 * Math.sin(3 * a + ph[0] + tt * 0.6) + 0.025 * Math.sin(7 * a + ph[1] - tt * 1.4)
    + 0.018 * Math.abs(Math.sin(11 * a + ph[2] + tt * 0.8)) + 0.012 * Math.sin(23 * a - ph[0]) + 0.08 * Math.max(0, Math.sin(5 * a + ph[1])) ** 10;
  // speed: every cell's distance and angle worked out once, and the edge tabulated once a frame
  const EN = 512, E = new Float32Array(EN);
  const PD = new Float32Array(256 * 256), PA = new Float32Array(256 * 256), PK = new Uint8Array(256 * 256);
  let cd = 0, ca = 0;
  const polar = (x, y) => {
    const i = ((Math.floor(y) + 128) << 8) | (Math.floor(x) + 128);
    if (!PK[i]) { PK[i] = 1; PD[i] = Math.hypot(x, y); PA[i] = Math.atan2(y, x); }
    cd = PD[i]; ca = PA[i];
  };
  const edgeAt = (a) => E[Math.floor(((a + Math.PI) / TAU) * EN) & (EN - 1)];

  return {
    update(dt) { t += dt; },
    draw(p) {
      const k = size(t), R = R0 * k;
      const spin = t * 0.9 + 2.2 * ease.inCubic(clamp((t - SHUT) / (GONE - SHUT)));   // it winds faster as it shuts
      const scar = clamp((t - 0.12) / 0.2) * (1 - smooth(SHUT, 3.15, t));              // the floor marks: in with the tear, out after it shuts
      for (let i = 0; i < EN; i++) E[i] = edge(((i + 0.5) / EN) * TAU - Math.PI, t);

      // the stain and the cracks on the floor round it
      if (scar > 0) {
        const RS = R0 * Math.max(k, 0.55);
        p.shade(-RS * 1.2, -RS * 1.2, RS * 1.2, RS * 1.2, (x, y) => {
          polar(x, y);
          const a = ca, u = cd / (RS * edgeAt(a));
          if (u < 1 || u > 1.2) return;
          const n = noise(a * 9 + 3, 7) * 0.5 + 0.5;
          if (u < 1 + 0.2 * n * scar) return u < 1.04 ? C[1] : noise(a * 23 + 1, 11) + noise(u * 40, 12) * 0.5 > -0.3 ? C[0] : undefined;
        });
        for (const c of cracks) {
          const g = clamp((t - c.t0) / 0.18) * scar;
          const n = Math.floor(c.pts.length * g);
          for (let i = 1; i < n; i++) {
            const [r0, a0] = c.pts[i - 1], [r, a] = c.pts[i];
            const x0 = Math.cos(a0) * r0 * RS, y0 = Math.sin(a0) * r0 * RS, x = Math.cos(a) * r * RS, y = Math.sin(a) * r * RS;
            // a dark seam with light leaking up out of it; brighter near the rim, a hot tip while it runs
            if (c.w) p.line(x0 + Math.sin(a), y0 - Math.cos(a), x + Math.sin(a), y - Math.cos(a), C[1]);
            p.line(x0, y0, x, y, i > n - 2 && g < 1 ? C[7] : i < n * 0.4 ? C[5] : C[3]);
          }
        }
      }
      if (k <= 0.01) {
        // the pinch: a last spark where it closed
        const f = clamp(1 - (t - GONE) / 0.18);
        if (t > GONE && f > 0) { p.px(0, 0, WHITE); p.glow(0, 0, 10 * f + 4, C[6], 0.6 * f); }
        return;
      }

      // the void: spiral arms turning down into black, stars far below
      const live = [];
      for (const r of ripples) {
        const age = t - r.t0;
        if (age >= 0 && age <= r.life) live.push({ x: Math.cos(r.a) * r.u * R, y: Math.sin(r.a) * r.u * R, rr: age * 13 * r.w + 1, c: age < r.life * 0.35 ? C[3] : C[2] });
      }
      p.shade(-R * 1.12, -R * 1.12, R * 1.12, R * 1.12, (x, y) => {
        polar(x, y);
        const a = ca, u = cd / (R * edgeAt(a));
        if (u >= 1) return;
        // the lip: lit where it folds over, a chasing shimmer round it
        const lip = 1 - 3.2 / R;
        if (u > lip) {
          const sh = Math.sin(a * 2 - t * 3.2) > 0.86 || Math.sin(a * 3 + t * 2.1 + 1) > 0.93;
          return u > 1 - 1.6 / R ? (sh ? C[7] : C[5]) : sh ? C[6] : C[4];
        }
        if (u > lip - 0.07) return C[2];
        // ripples running out over the surface
        for (const r of live) if (Math.abs(Math.hypot(x - r.x, y - r.y) - r.rr) < 0.6) return r.c;
        const arm = Math.sin(a * 3 + Math.log(u + 0.04) * 3.2 + spin * 1.0);
        const fade = smooth(0.12, 0.8, u);           // the arms sink out of sight into the middle
        const v = arm * fade + noise(a * 5 + u * 9 - t, 3) * 0.14;
        // a thin lit crest on each arm, its body dark violet, black between
        return v > 0.93 ? (u > 0.5 ? C[4] : C[3]) : v > 0.6 ? C[2] : v > 0.3 ? C[1] : C[0];
      });
      for (const s of stars) {
        const a = s.a + spin * 0.35, r = s.u * R * 0.8, b = Math.sin(t * s.tw + s.ph);
        if (b < -0.3) continue;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        p.px(x, y, b > 0.75 ? (s.big ? WHITE : C[7]) : b > 0.2 ? C[6] : C[4]);
        if (s.big && b > 0.6) { p.px(x + 1, y, C[5]); p.px(x - 1, y, C[5]); p.px(x, y + 1, C[5]); p.px(x, y - 1, C[5]); }
      }

      // the tear lands with a flash ring as the tentacles break through
      const fa = t - (OPEN - 0.04);
      if (fa > 0 && fa < 0.3) ringFast(p, 0, 0, R0 * (1.02 + fa * 0.9), 2, fa < 0.08 ? WHITE : C[6], 1 - fa / 0.3);

      // light: a violet halo on the floor, the rim glowing; the middle stays truly dark
      p.glow(0, 0, R * 1.5, C[4], 0.2 * k);
      p.glowRing(0, 0, R * 0.99, 6, C[5], 0.22 * k);
      if (fa > 0 && fa < 0.25) p.glow(0, 0, R * 1.3, C[6], 0.5 * (1 - fa / 0.25));
      unlight(p, -R, -R, R, R, (x, y) => Math.hypot(x, y) < R * 0.55, 0.15);
    },
  };
}
