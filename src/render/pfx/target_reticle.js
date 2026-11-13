// Hunter's Mark: four corner brackets snap in round the creature's own outline, lock with
// a small flash, and fade as the mark's comet takes over. Sized from `o.actor`, the
// creature's figure, once when it starts, so it doesn't shiver with the sprite's frames.
import { PAL, fit, clamp, ease, WHITE } from "../../vendor/pixelfx/core/index.js";

const SNAP = 0.26, LOCK = 0.35, FADE_FROM = 0.5, DONE = 0.72;
const GAP = 3, START_OUT = 16, ARM = 6;   // art px: clearance round the body, how far out they start, bracket length

export const meta = {
  name: "Target reticle",
  desc: "Four corner brackets snap inward round a creature, lock with a small flash, and fade.",
  tags: ["mark", "target", "reticle", "hunter", "actor", "one-shot"],
  size: [120, 100],
  origin: [60, 84],
  duration: DONE,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.heal },
};

export function create(o) {
  const C = fit(o.palette, 8), A = o.actor;
  const L = A.x - GAP, R = A.x + A.w + GAP - 1, T = A.y - GAP, B = A.y + A.h + GAP - 1;
  const bar = (p, x0, y0, x1, y1, c, a) => p.line(x0, y0, x1, y1, c, a);
  let t = 0;

  function bracket(p, x, y, dx, dy, c, a) {
    // two px thick, the corner on the outside: (dx, dy) points back along the arms
    bar(p, x, y, x + dx * ARM, y, c, a);
    bar(p, x, y + dy, x + dx * ARM, y + dy, c, a);
    bar(p, x, y, x, y + dy * ARM, c, a);
    bar(p, x + dx, y, x + dx, y + dy * ARM, c, a);
  }

  return {
    update(dt) { t += dt; },
    draw(p) {
      const out = START_OUT * (1 - ease.outCubic(clamp(t / SNAP)));
      const a = clamp(t / 0.06) * (1 - clamp((t - FADE_FROM) / (DONE - FADE_FROM)));
      const flash = 1 - clamp(Math.abs(t - LOCK) / 0.07);
      const c = flash > 0 ? WHITE : t > LOCK ? C[5] : C[6];
      for (const [x, y, dx, dy] of [[L - out, T - out, 1, 1], [R + out, T - out, -1, 1], [L - out, B + out, 1, -1], [R + out, B + out, -1, -1]]) {
        bracket(p, x + dx * -1, y + dy * -1, dx, dy, C[1], a * 0.8);   // a dark edge so it reads on any floor
        bracket(p, x, y, dx, dy, c, a);
        p.glow(x, y, 6 + 6 * flash, C[5], (0.2 + 0.5 * flash) * a);
      }
    },
  };
}
