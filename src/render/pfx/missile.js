// Game fork of pixelfx's arcane/arcane-missiles (MIT, https://github.com/patch-gg/pixelfx), one missile of its
// volley. Upstream flies five bolts across a fixed stage at a stand-in target. Here the game owns the flight (the
// composite travel tween, each bolt on its own bend to its own target), so this draws only what it looks like: a
// layered head with spinning rays at the local origin, and the tapering ribbon with its twisting strands along
// `o.trail`, the points the missile has actually been, in art px from the head (render/pixelfx_live.js).
//
// The bolt (a layered head with spinning rays) is adapted from Sprite Fusion's open-source energy bolt
// (https://www.spritefusion.com/pixel-art-vfx/energy), MIT License, Copyright (c) 2026 Hugo Duprez.
import { PAL, fit, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";

export const meta = {
  name: "Missile",
  desc: "A single arcane missile: a bright spinning head on a tapering, twisting ribbon.",
  tags: ["arcane", "missile", "projectile", "loop"],
  size: [144, 144],
  origin: [72, 72],
  duration: 3600,
  loop: true,
  fps: 30,
  options: { palette: PAL.arcane, seed: 3, trail: [] },
};

function ribbon(p, t, o, C) {
  const pts = o.trail, n = pts.length, tw = o.seed * 1.7;
  if (n < 2) return;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    for (let d = 0; d < L; d += 0.5) {
      const u = (i + d / L) / (n - 1), x = x0 + ((x1 - x0) * d) / L, y = y0 + ((y1 - y0) * d) / L, a = (1 - u) * 1.7;
      // the body: a capsule that tapers down the tail, white along its middle near the head, cooling outward
      const w = 2.6 * Math.pow(1 - u, 0.8) + 0.3;
      for (let q = -w; q <= w; q += 0.5) {
        const v = Math.abs(q) / w;
        p.dot(x + nx * q, y + ny * q, v < 0.35 ? (u < 0.25 ? WHITE : C[6]) : v < 0.7 ? (u < 0.4 ? C[6] : C[5]) : u < 0.5 ? C[5] : C[4], a * (v < 0.7 ? 1 : 0.75));
      }
      // two strands twisting round it: bright where they come round the front, dim behind
      for (const s of [0, Math.PI]) {
        const ph = u * 10 - t * 26 + tw + s, off = Math.sin(ph) * (w + 1.4);
        if (Math.cos(ph) > -0.2) p.dot(x + nx * off, y + ny * off, Math.cos(ph) > 0.4 ? (u < 0.35 ? WHITE : C[6]) : C[4], a);
      }
    }
    if (i % 3 === 0) p.glow(x0, y0, 9 * (1 - i / n) + 3, C[5], 0.3 * (1 - i / n));
  }
}

function head(p, t, o, C) {
  const tw = o.seed * 1.7;
  for (let i = 0; i < 4; i++) {
    const a = t * 24 + (i * TAU) / 4 + tw, l = 5.5 + 1.5 * Math.sin(t * 50 + i);
    p.line(Math.cos(a) * 3.2, Math.sin(a) * 3.2, Math.cos(a) * l, Math.sin(a) * l, C[6]);
  }
  p.circle(0, 0, 3.8, C[4]);
  p.circle(0, 0, 3, C[5]);
  p.circle(0, 0, 2.1, C[6]);
  p.circle(0, 0, 1.2, WHITE);
  p.glow(0, 0, 24, C[5], 0.6);
  p.glow(0, 0, 7, WHITE, 0.4);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8);
  ribbon(p, t, o, C);
  head(p, t, o, C);
}
