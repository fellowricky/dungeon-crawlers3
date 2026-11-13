// Blinded: a semi-transparent dark cloud over the top third of the creature, its edge slowly rolling. Sized from the
// creature's own figure (o.actor), so it works on any sprite without having to find a head or eyes. Blended rather
// than stacked, so the cloud stays one even veil the sprite shows through. Everything turns on whole laps of the loop,
// so it stays seamless.
import { PAL, fit, TAU } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 3, OPACITY = 0.8, OVERHANG = 3, RISE = 2;

export const meta = {
  name: "Blinded",
  desc: "A semi-transparent dark cloud rolls over the top third of the creature.",
  tags: ["status", "blind", "smoke", "shadow", "debuff", "loop"],
  size: [84, 88],
  origin: [42, 76],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.shadow, opacity: OPACITY },
};

/** The top third of the figure, in mask space: its first row, its height, and its left and right edges. */
function topThird(S) {
  let first = S.rows.findIndex(([l]) => l >= 0), last = S.rows.length - 1;
  if (first < 0) return { first: 0, tall: S.h / 3, l: 0, r: S.w - 1 };
  while (last > first && S.rows[last][0] < 0) last--;
  const tall = (last - first + 1) / 3;
  let l = S.w, r = 0;
  for (let y = first; y < first + tall; y++) {
    const [a, b] = S.rows[y];
    if (a < 0) continue;
    l = Math.min(l, a);
    r = Math.max(r, b);
  }
  return { first, tall, l, r };
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, ph = (t / D) * TAU, op = o.opacity ?? OPACITY;
  const { first, tall, l, r } = topThird(shape(a));
  const rx = (r - l + 1) / 2 + OVERHANG, ry = (tall + RISE) / 2 + 1.5;
  const cx = a.x + (l + r + 1) / 2, cy = a.y + first + (tall - RISE) / 2;

  for (let y = Math.floor(cy - ry * 1.3); y <= Math.ceil(cy + ry * 1.3); y++)
    for (let x = Math.floor(cx - rx * 1.3); x <= Math.ceil(cx + rx * 1.3); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, d = Math.hypot(u, v), th = Math.atan2(v, u);
      /* a lumpy edge rolling round the cloud */
      const edge = 1 + 0.13 * Math.sin(3 * th + ph) + 0.08 * Math.sin(5 * th - 2 * ph) + 0.05 * Math.sin(8 * th + 3 * ph);
      const depth = edge - d;
      if (depth <= 0) continue;
      /* drifting patches of darker and lighter smoke inside it */
      const swirl = Math.sin(x * 0.42 + ph) + Math.sin(y * 0.65 - ph + x * 0.18);
      const col = depth < 0.14 ? C[3] : swirl > 0.9 ? C[2] : swirl < -0.6 ? C[0] : C[1];
      p.blend(x, y, col, op * (depth < 0.14 ? 0.55 : 1));
    }
}
