// Acid Arrow landing: the arrow was never solid. It bursts as liquid where it strikes, carrying on the way it was
// going: a sloppy pop, a ring, and gobs thrown mostly forward (art right) that arc, fall and splat on the floor.
// options.floor is how far below the strike the floor is, in art px.
import { PAL, Rng, fit, clamp, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";

const G = 420, POP = 0.14, GOBS = 34;

export const meta = {
  name: "Acid splat",
  desc: "A projectile bursts as liquid: a sloppy pop and gobs thrown forward that arc, fall and splat on the floor.",
  tags: ["acid", "liquid", "splash", "impact", "directional", "one-shot"],
  size: [176, 120],
  origin: [64, 70],
  duration: 1.15,
  loop: false,
  fps: 30,
  options: { palette: PAL.leaf, floor: 31, seed: 4 },
};

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), floor = o.floor;
  const gobs = Array.from({ length: GOBS }, (_, i) => {
    /* three in four carry on forward; the rest slop back off the target */
    const a = (i % 4 ? R.range(-0.95, 0.6) : Math.PI + R.range(-0.7, 0.7)), v = R.range(50, i % 4 ? 190 : 90);
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v - R.range(10, 60), r: R.next() < 0.25 ? R.range(1.4, 2.2) : R.range(0.6, 1.1), t0: R.range(0, 0.05), c: R.pick([C[4], C[5], C[5], C[6]]) };
  });
  /* when a gob reaches the floor: solving y = vy t + G t^2 / 2 */
  for (const g of gobs) { g.land = (-g.vy + Math.sqrt(g.vy * g.vy + 2 * G * floor)) / G; g.lx = g.vx * g.land; }
  let t = 0;
  return {
    update(dt) { t += dt; },
    draw(p) {
      /* the pop: a squashed blob spreading forward and a thin ring, gone quickly */
      if (t < POP) {
        const k = t / POP;
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU, r = (3 + 7 * k) * (0.7 + 0.3 * Math.sin(i * 2.3));
          p.circle(Math.cos(a) * r + 3 * k, Math.sin(a) * r * 0.75, 3.2 * (1 - k) + 0.6, k < 0.35 ? C[6] : C[5]);
        }
        if (k < 0.35) p.circle(0, 0, 4, WHITE);
        p.glow(0, 0, 18, C[5], 0.45 * (1 - k));
      }
      if (t < POP * 2.2) p.ring(0, 0, 4 + 80 * t, 1, C[5], clamp(1 - t / (POP * 2.2)) * 0.8);
      for (const g of gobs) {
        const a = t - g.t0;
        if (a < 0) continue;
        if (a < g.land) {
          const x = g.vx * a, y = g.vy * a + 0.5 * G * a * a;
          /* stretched along its flight: a head and a short tail */
          p.circle(x, y, g.r, g.c);
          p.dot(x - g.vx * 0.012, y - (g.vy + G * a) * 0.012, C[4], 0.8);
          if (g.r > 1.3) p.dot(x - g.r * 0.4, y - g.r * 0.4, C[7]);
        } else {
          /* where it lands: a splat flattening out, then fading */
          const k = (a - g.land) / 0.5;
          if (k >= 1) continue;
          const w = g.r + 2.5 * Math.min(1, k * 3);
          p.line(g.lx - w, floor, g.lx + w, floor, k < 0.25 ? C[6] : C[3], 1 - k);
          if (k < 0.3) for (const s of [-1, 1]) p.dot(g.lx + s * (w + 1), floor - 1 - 2 * k, C[5], 1 - k * 3);
        }
      }
    },
  };
}
