// Entangle's standing growth: one low tuft of hooked weeds, swaying. Kept dark and
// below a creature's waist so a field of them marks the ground without hiding who
// stands in it. They push up when spawned; set options.wither and they shrink back.
import { Rng, PAL, fit, clamp, ease, TAU } from "../../vendor/pixelfx/core/index.js";

export const meta = {
  name: "Weed tuft",
  desc: "A low tuft of hooked, leafy weeds pushes up from a dark patch of churned earth and sways on its own slow rhythm.",
  tags: ["nature", "weeds", "plant", "ground", "loop"],
  size: [48, 34],
  origin: [24, 30],
  duration: 4,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: PAL.leaf, seed: 1 },
};

const GROW = 0.45, WITHER = 0.45;

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed);
  const stalks = Array.from({ length: R.int(5, 8) }, () => {
    const x0 = R.range(-9, 9), side = x0 === 0 ? R.sign() : Math.sign(x0);
    return {
      x0, y0: R.range(-1, 1),
      h: R.range(7, 17) * (1 - Math.abs(x0) / 26),     // tallest in the middle of the tuft
      curl: side * R.range(0.25, 0.7),                 // leans outward, hooking at the tip
      amp: R.range(0.8, 1.8), w: R.range(1.1, 1.9), ph: R.range(0, TAU),
      at: R.range(0, 0.2),
      leaves: Array.from({ length: R.int(1, 3) }, () => ({ s: R.range(0.35, 0.85), d: R.sign(), len: R.range(2, 4) })),
    };
  });
  const earth = Array.from({ length: 22 }, () => [R.range(-11, 11), R.range(-2, 2), R.chance(0.5) ? 0 : 1]);
  let t = 0, gone = 0;

  return {
    update(dt) {
      t += dt;
      if (o.wither) gone = Math.min(WITHER, gone + dt);
    },
    draw(p) {
      const shrink = 1 - gone / WITHER;
      for (const [x, y, c] of earth) p.dot(x, y, C[c], 0.55 * clamp(t / GROW) * shrink);
      for (const k of stalks) {
        const g = ease.outCubic(clamp((t - k.at) / GROW)) * shrink;
        if (g <= 0.02) continue;
        const H = k.h * g, sway = Math.sin(t * k.w + k.ph);
        const at = (s) => [k.x0 + k.curl * s * s * s * k.h + sway * k.amp * s * s, k.y0 - H * s];
        const steps = Math.max(2, Math.ceil(H * 1.3));
        for (let i = 0; i <= steps; i++) {
          const s = i / steps, [x, y] = at(s);
          p.dot(x + 1, y, C[0], 0.9);                  // the shadowed side
          p.dot(x, y, s < 0.3 ? C[1] : s < 0.7 ? C[2] : C[3]);
          if (s < 0.4) p.dot(x - 1, y, C[2]);          // thicker low down, lit on the left
        }
        const [tx, ty] = at(1);
        p.dot(tx, ty - 1, C[4]);
        for (const l of k.leaves) {
          const [lx, ly] = at(l.s);
          for (let j = 1; j <= l.len * g; j++) p.dot(lx + l.d * j, ly - j * 0.5, j === 1 ? C[3] : C[4]);
        }
      }
    },
  };
}
