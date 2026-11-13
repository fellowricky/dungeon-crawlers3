// Thunderwave's shock ring, drawn straight down so it can lie flat on the floor and run over steps as
// it goes: the floor ring of pixelfx's lightning/thunderclap (MIT, https://github.com/patch-gg/pixelfx),
// seen from above and at the same pace. Starts at the clap, so its own clock runs from there.
// The band follows Sprite Fusion's open-source explosion (https://www.spritefusion.com/pixel-art-vfx/lightning),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { PAL, fit, band, clamp, ease } from "../../vendor/pixelfx/core/index.js";

export const SHOCK_REACH = 104, SHOCK_SECONDS = 0.5;
const START = 8, SIZE = 2 * (SHOCK_REACH + 12);

/** How far out the ring is, in art px, `t` seconds after the clap. */
export const shockFront = (t) => START + (SHOCK_REACH - START) * ease.outCubic(clamp(t / SHOCK_SECONDS));
/* spells.js shockArrives inverts shockFront, to land Thunderwave's blows as the ring reaches each foe. */

export const meta = {
  name: "Shock ring",
  desc: "A heavy top-down ring of force tears outward from the centre and fades.",
  tags: ["lightning", "thunder", "shockwave", "ground", "top-down", "one-shot"],
  size: [SIZE, SIZE],
  origin: [SIZE / 2, SIZE / 2],
  duration: SHOCK_SECONDS,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { palette: PAL.electric },
};

const all = () => true;

export function create(o) {
  const C = fit(o.palette, 8);
  let t = 0;
  return {
    update(dt) { t += dt; },
    draw(p) {
      const u = t / SHOCK_SECONDS;
      if (u >= 1) return;
      band(p, 0, 0, shockFront(t), 1, Math.max(2, 16 * (1 - u)), 1.25 - u, [C[1], C[2], C[4], C[6]], all, u < 0.15);
    },
  };
}
