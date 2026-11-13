// Grease's slick, drawn straight down so it can lie flat on the floor and hold true as
// the camera turns: an uneven pool of dark oil that spreads out from its middle, a sheen
// sliding slowly across it, a wet rim, and now and then a fat bubble that swells and pops.
import { Rng, fit, clamp, ease, noise, noise2, TAU } from "../../vendor/pixelfx/core/index.js";

const SIZE = 184, R = 86, SPREAD = 0.6, BUBBLES = 9;

export const meta = {
  name: "Grease slick",
  desc: "A top-down pool of dark oil spreads out from its middle; a sheen slides across it, its rim glistens, and fat bubbles swell and pop.",
  tags: ["oil", "grease", "puddle", "slick", "ground", "top-down", "loop"],
  size: [SIZE, SIZE],
  origin: [SIZE / 2, SIZE / 2],
  duration: 4,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: ["#0e0a06", "#1c140b", "#2e2212", "#463419", "#6a4f24", "#94743a", "#c8a860", "#f0e0a8"], seed: 5 },
};

export function create(o) {
  const C = fit(o.palette, 8), R0 = new Rng(o.seed), S = o.seed;
  /* What never changes is worked out once: each pixel's place in the pool (0 middle, 1 rim) and its shade of oil. */
  const px = [];
  for (let y = -R - 2; y <= R + 2; y++)
    for (let x = -R - 2; x <= R + 2; x++) {
      const d = Math.hypot(x, y), th = Math.atan2(y, x);
      const edge = R * (0.86 + 0.08 * noise(Math.cos(th) * 2 + 3, S) + 0.06 * noise(Math.sin(th) * 5 + 9, S + 1));
      const q = d / edge;
      if (q <= 1) px.push({ x, y, q, th, base: noise2(x * 0.04, y * 0.04, S + 2) });
    }
  const bubbles = Array.from({ length: BUBBLES }, () => {
    const a = R0.range(0, TAU), r = Math.sqrt(R0.next()) * R * 0.75;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, size: R0.range(2, 4.5), life: R0.range(1.2, 2), rest: R0.range(1.5, 5), ph: R0.next() };
  });
  let t = 0;

  return {
    update(dt) { t += dt; },
    draw(p) {
      const G = ease.outCubic(clamp(t / SPREAD));
      for (const a of px) {
        if (a.q > G) continue;
        /* the sheen: chunky so it stays pixel art, drifting at its own pace */
        const X = Math.floor(a.x / 2), Y = Math.floor(a.y / 2);
        const sheen = Math.abs(noise2(X * 0.07 + t * 0.1, Y * 0.1 - t * 0.07, S + 3) - 0.15);
        let c = a.base > 0.1 ? C[1] : C[0];
        if (sheen < 0.012) c = C[4];                                         // thin ribbons of light on the oil
        else if (sheen < 0.04) c = C[3];
        else if (sheen < 0.07) c = C[2];
        const rim = a.q / G;
        if (rim > 0.96) c = Math.cos(a.th + 2.2) > 0.2 ? C[5] : C[3];       // the wet lip, lit from the upper left
        else if (rim > 0.91) c = C[0];                                       // and the dark just inside it
        p.px(a.x, a.y, c);
      }
      for (const b of bubbles) {
        const span = b.life + b.rest, u = ((t / span + b.ph) % 1) * span;
        if (u > b.life + 0.14 || G < 0.9) continue;
        if (u > b.life) {
          /* the pop: a broken ring */
          const r = b.size + 3 * ((u - b.life) / 0.14);
          for (let i = 0; i < 8; i += 2) p.dot(b.x + Math.cos((i / 8) * TAU) * r, b.y + Math.sin((i / 8) * TAU) * r, C[5], 0.8);
          continue;
        }
        const r = b.size * ease.outCubic(u / b.life);
        p.circle(b.x, b.y, r, C[3]);
        p.circle(b.x, b.y, Math.max(0.5, r - 1), C[1]);
        p.dot(b.x - r * 0.4, b.y - r * 0.4, C[6]);
      }
    },
  };
}
