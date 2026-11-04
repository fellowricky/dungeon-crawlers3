// Game fork of pixelfx's projectiles/magic-missile (MIT, https://github.com/patch-gg/pixelfx). Upstream gathers an orb
// at a hand, weaves it along a fixed path and bursts it. Here the game owns the flight (the composite travel tween) and
// the landing, so this keeps what it looks like in the air: the orb with its turning ring of light, and the ribbon
// that twists behind it along `o.trail`, the points it has actually been, in art px from the orb
// (render/pixelfx_live.js spawnLiveMissile).
import { PAL, fit, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";

export const meta = {
  name: "Magic missile",
  desc: "An orb with a turning ring of light, trailing a ribbon that twists, its bright face and dark back taking turns.",
  tags: ["arcane", "missile", "projectile", "loop"],
  size: [144, 144],
  origin: [72, 72],
  duration: 3600,
  loop: true,
  fps: 30,
  options: { palette: PAL.arcane, seed: 6, trail: [] },
};

const RIBBON_POINTS = 11;   // about the third of a second upstream keeps

function ribbon(p, t, o, C) {
  const pts = o.trail.slice(0, RIBBON_POINTS), n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let d = 0; d < L; d += 0.5) {
      const u = (i + d / L) / (n - 1), k = 1 - u, tw = Math.sin(u * 8 - t * 26 + o.seed), w = 3.2 * k * Math.abs(tw) + 0.4, face = tw > 0;
      const x = x0 + (dx * d) / L, y = y0 + (dy * d) / L;
      for (let s = -w; s <= w; s += 0.5) {
        const edge = Math.abs(s) > w - 0.8, c = face ? (edge ? C[6] : k > 0.6 ? C[5] : C[4]) : edge ? C[4] : C[2];
        p.dot(x + nx * s, y + ny * s, c, k > 0.35 ? 1 : k / 0.35);
      }
    }
    if (i % 3 === 0) p.glow(x1, y1, 6, C[4], 0.25 * (1 - i / n));
  }
}

function orb(p, t, C) {
  const r = 4;
  p.circle(0, 0, r + 1.4, C[3]);
  p.circle(0, 0, r + 0.4, C[5]);
  p.circle(-0.4, -0.4, r * 0.55, WHITE);
  for (let i = 0; i < 3; i++) {
    const a = t * 14 + (i * TAU) / 3;
    p.px(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3) * 0.6, i ? C[6] : WHITE);
  }
  p.glow(0, 0, 20, C[4], 0.65);
  p.glow(0, 0, 7, C[6], 0.5);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8);
  ribbon(p, t, o, C);
  orb(p, t, C);
}
