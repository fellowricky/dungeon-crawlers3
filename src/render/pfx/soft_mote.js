// Healing Word's projectile: a small soft point of light that breathes and sways a little
// as it goes, shedding a few twinkles that hang where it has been and fade. The quiet
// counterpart to the magic missile's ribbon. The game owns the flight (the composite
// travel tween); `o.trail` is where it has been, in art px from the mote
// (render/pixelfx_live.js spawnLiveMissile).
import { PAL, fit } from "../../vendor/pixelfx/core/index.js";

export const meta = {
  name: "Soft mote",
  desc: "A small soft point of light breathing as it drifts, leaving a few fading twinkles behind it.",
  tags: ["light", "mote", "projectile", "gentle", "loop"],
  size: [144, 144],
  origin: [72, 72],
  duration: 3600,
  loop: true,
  fps: 30,
  options: { palette: PAL.heal, seed: 6, trail: [] },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8);
  /* the twinkles: every other point of its path, dimming with age and winking on their own beat */
  const pts = o.trail;
  for (let i = 2; i < pts.length; i += 2) {
    const [x, y] = pts[i], k = 1 - i / pts.length;
    const wink = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7 + o.seed);
    const sx = Math.sin(i * 12.9 + o.seed) * 2.5, sy = Math.cos(i * 7.3 + o.seed) * 2.5;
    p.dot(x + sx, y + sy, k > 0.5 ? C[6] : C[5], k * (0.4 + 0.6 * wink));
    if (i % 4 === 0) p.glow(x + sx, y + sy, 4, C[5], 0.12 * k);
  }
  const breathe = 0.5 + 0.5 * Math.sin(t * 5 + o.seed), sway = Math.sin(t * 3.1 + o.seed) * 1.2;
  p.glow(sway, 0, 13 + 3 * breathe, C[4], 0.3);
  p.glow(sway, 0, 6, C[6], 0.5);
  p.circle(sway, 0, 2.2, C[5]);
  p.circle(sway, 0, 1.2, C[6]);
}
