// Faerie Fire's standing area: a sparse, quiet glitter hanging in the air over the
// ground. Each mote fades up, drifts a little and fades away on its own clock, and
// only the brightest moment of each opens into a tiny four-point star.
import { Rng, fit, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";

const RX = 84, RY = 42, TOP = 58;   // art px: the area's half-width and half-depth, and how high the motes hang

export const meta = {
  name: "Faerie sparkle",
  desc: "Sparse motes of violet light twinkle on and off in the air over an area, each drifting slowly upward and briefly opening into a tiny star.",
  tags: ["arcane", "sparkle", "glitter", "faerie", "area", "ambient", "loop"],
  size: [188, 124],
  origin: [94, 66],
  duration: 4,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: ["#1a0a24", "#3c1450", "#6a2a8c", "#a24cc8", "#d488f0", "#f6c8ff", "#ffffff"], count: 34, seed: 3 },
};

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed);
  const motes = Array.from({ length: o.count }, () => {
    const a = R.range(0, TAU), r = Math.sqrt(R.next());
    return {
      x: Math.cos(a) * r * RX, y: Math.sin(a) * r * RY, h: R.range(0, TOP),
      life: R.range(1.4, 3), rest: R.range(0.3, 1.8), ph: R.next(), rise: R.range(2, 7),
      c: R.pick([C[4], C[5], C[5], C[6]]),
    };
  });
  let t = 0;
  return {
    update(dt) { t += dt; },
    draw(p) {
      for (const m of motes) {
        const span = m.life + m.rest, u = (t / span + m.ph) % 1, q = (u * span) / m.life;
        if (q >= 1) continue;
        const k = Math.sin(Math.PI * q);
        const x = m.x, y = m.y - m.h - m.rise * q;
        p.dot(x, y, m.c, k);
        if (k > 0.7) {
          const a = (k - 0.7) / 0.3;
          p.dot(x, y, WHITE, a);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.dot(x + dx, y + dy, m.c, a * 0.75);
        }
        p.glow(x, y, 4, m.c, 0.12 * k);
      }
    },
  };
}
