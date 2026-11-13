// Hunter's Mark's lasting sign: a small mote of light tracing a tight figure-eight over the
// prey's head with a short tail. Game fork of pixelfx's pickups/xp-orb (MIT,
// https://github.com/patch-gg/pixelfx), much smaller, and without upstream's shadow and light
// on the floor beneath it: over a creature's head those lay across its body and looked wrong.
// The orb's shading follows Sprite Fusion's open-source pickup orb
// (https://www.spritefusion.com/pixel-art-vfx/pickup), MIT License, Copyright (c) 2026 Hugo Duprez.
import { fit, TAU } from "../../vendor/pixelfx/core/index.js";

export const meta = {
  name: "Marked mote",
  desc: "A small mote of light traces a tight figure-eight with a short tail.",
  tags: ["mark", "mote", "hunter", "status", "loop"],
  size: [48, 40],
  origin: [24, 34],
  duration: 1.8,
  loop: true,
  fps: 30,
  options: { palette: ["#140606", "#2e0b0b", "#561212", "#8c1a1a", "#c02424", "#e85040", "#ff9a80", "#ffe0d0"] },
};

const A = 7, B = 3.5, HOVER = 9, TAIL = 0.3;

const at = (t) => {
  const a = (t / meta.duration) * TAU;
  return [A * Math.sin(a), -HOVER + B * Math.sin(a) * Math.cos(a)];
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), [x, y] = at(t);
  /* the tail: its own path just behind it, thinning and cooling */
  const n = 24;
  for (let i = n; i >= 1; i--) {
    const u = i / n, [tx, ty] = at(t - u * TAIL);
    p.dot(tx, ty, u < 0.4 ? C[5] : C[4], (1 - u) * 1.4);
  }
  const X = Math.round(x), Y = Math.round(y);
  p.circle(X, Y, 1.9, C[1]);
  p.circle(X, Y, 1.2, C[5]);
  p.px(X, Y, C[7]);
  p.glow(x, y, 6, C[5], 0.3);
}
