// Held in rime: a complete border of frost round the body, thin ferns creeping in from it, an icicle or two. Adapted from
// pixelfx's status/frozen (MIT, https://github.com/patch-gg/pixelfx), which redraws the whole body. This draws no body:
// the creature's own sprite shows through, tinted and held still by status_auras.js.
import { cycle, fit, rand, Rng, smooth, sparkle, TAU, PAL } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

export const meta = {
  name: "Rime",
  desc: "A complete border of frost round a still body, thin ferns creeping in from it, an icicle or two.",
  tags: ["status", "ice", "hold", "paralyzed", "debuff", "loop"],
  size: [72, 64],
  origin: [36, 54],
  duration: 3,
  loop: true,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.arcane, seed: 4 },
};

const D = meta.duration;

/* Worked out from the figure: fern paths walking in from the sides, icicle roots, ledges of ice. */
function plan(a, seed) {
  const S = shape(a), H = S.h, R = new Rng(seed * 11 + 1), ferns = [];
  const roots = S.side.filter(([, y]) => y > H * 0.15 && y < H * 0.9).sort(() => R.next() - 0.5).slice(0, 5);
  roots.forEach(([x0, y0, dir]) => {
    let x = x0, y = y0, ang = (dir < 0 ? -0.5 : Math.PI + 0.5) + R.range(-0.4, 0.4);
    for (let s = 0; s < 6; s++) {
      x += Math.cos(ang) * 1.1;
      y += Math.sin(ang) * 1.1;
      const px = Math.round(x), py = Math.round(y);
      if (!S.on(px, py)) break;
      ferns.push([px, py, s / 6]);
      if (s % 2 === 1) for (const side of [-1, 1]) {
        const ba = ang + side * 1.05, L = 1 + Math.round(R.range(0, 1) * (1 - s / 6));
        for (let k = 1; k <= L; k++) {
          const bx = Math.round(x + Math.cos(ba) * k), by = Math.round(y + Math.sin(ba) * k);
          if (S.on(bx, by)) ferns.push([bx, by, (s + k * 0.6) / 6]);
        }
      }
      ang += R.range(-0.25, 0.25);
    }
  });
  const hangs = S.body.filter(([x, y]) => !S.on(x, y + 1) && S.on(x, y - 1) && y < H * 0.72 && y > 4 && !S.on(x, y + 2) && !S.on(x, y + 3) && !S.on(x, y + 4));
  const icicles = hangs.sort(() => R.next() - 0.5).slice(0, 2).map(([x, y], i) => ({ x, y: y + 1, len: R.range(3, 5.5), phase: R.next(), period: i % 2 ? 1.5 : 3 }));
  return { ferns, icicles };
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a), P = plan(a, o.seed);
  const X = (mx) => a.x + mx, Y = (my) => a.y + my;
  /* ferns: grown in over the first second, then a slow creep back and forth across the tips */
  const grow = smooth(0, 1, t) * (0.75 + 0.25 * Math.sin((t / D) * TAU + 1));
  for (const [x, y, u] of P.ferns) if (u < grow) p.px(X(x), Y(y), u > grow - 0.1 ? C[6] : rand(x, y, 5) < 0.5 ? C[5] : C[4]);
  /* a complete border of rime, every empty pixel touching the body, frosted paler where it faces up */
  for (const [x, y, , ny] of S.outline) p.px(X(x), Y(y), ny < -0.3 || rand(x, y, 7) < 0.15 ? C[6] : C[5]);
  for (const ic of P.icicles) {
    const u = ((t / ic.period + ic.phase) % 1 + 1) % 1, L = ic.len * (0.6 + 0.4 * smooth(0, 0.7, u)), x = X(ic.x), y0 = Y(ic.y);
    for (let j = 0; j < L; j++) {
      const v = j / L;
      p.px(x, y0 + j, v > 0.75 ? C[6] : C[5]);
    }
    if (u >= 0.86) {
      const f = (u - 0.86) * ic.period, y = y0 + L + 0.5 * 760 * f * f;
      if (y < -1) p.px(x, y, C[5]);
    }
  }
  /* now and then a glint off the crust */
  cycle(t, D, 5, o.seed + 2, 0.4, (age, life, r) => {
    const e = S.outline[Math.floor(r.next() * S.outline.length)];
    if (e) sparkle(p, X(e[0]), Y(e[1]), Math.round(2 * (1 - age / life)), C[6], C[5], 0.4);
  });
  p.glow(a.x + S.w / 2, a.y + S.h * 0.5, 26, C[4], 0.16);
}
