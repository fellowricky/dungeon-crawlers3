// Warded (Protection from Evil), and bright without its motes Thunderous Smite held ready: a faint line of light hugging the creature's own outline with a
// glint running round it, and a few motes drifting up off the body and twinkling out. Quiet on
// purpose: it lasts ten rounds, and the sprite should stay fully visible under it.
import { PAL, fit, rand, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 6, GLINTS_PER_LOOP = 2;

export const meta = {
  name: "Warded",
  desc: "A faint line of light hugs the outline, a glint running round it, and a few motes drift up and twinkle out.",
  tags: ["status", "holy", "ward", "buff", "outline", "motes", "loop"],
  size: [72, 88],
  origin: [36, 76],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.holy, motes: 9, line: 0.32 },
};

const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a);
  const cx = S.w / 2, cy = S.h / 2, glint = (t / D) * TAU * GLINTS_PER_LOOP;
  /* the outline: the empty pixels touching the body, lit by how near the glint is */
  for (const [mx, my] of S.body) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ex = mx + dx, ey = my + dy;
      if (S.on(ex, ey)) continue;
      const g = gap(Math.atan2(ey - cy, ex - cx), glint), near = g < 0.25 ? 1 : g < 0.7 ? 0.5 : 0;
      p.dot(a.x + ex, a.y + ey, near === 1 ? WHITE : near ? C[6] : C[5], near === 1 ? 0.95 : near ? Math.max(0.7, o.line) : o.line);
    }
  }
  /* the motes: each on a whole number of laps of the loop, so it stays seamless */
  for (let i = 0; i < o.motes; i++) {
    const laps = 2 + (i % 3), u = ((t / D) * laps + rand(i, 3)) % 1;
    if (u > 0.55) continue;      // resting between rises
    const q = u / 0.55, k = Math.sin(Math.PI * q);
    const x = a.x + rand(i, 5) * S.w + Math.sin(q * 5 + i) * 1.5, y = a.y + S.h * (0.25 + 0.75 * rand(i, 7)) - q * 18;
    p.dot(x, y, q > 0.45 && q < 0.6 ? WHITE : C[6], k);
    p.glow(x, y, 4, C[5], 0.22 * k);
  }
}
