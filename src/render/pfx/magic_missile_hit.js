// The hit of pixelfx's projectiles/magic-missile (MIT, https://github.com/patch-gg/pixelfx) on its own: the burst it
// ends in, a star flare and a ring that open out and fade, with sprays of motes, sparks and hanging stars. Upstream
// plays it at the end of its own flight; the game owns the flight, so this starts at the moment of arrival.
// The star particles and burst flare follow Sprite Fusion's open-source energy bolt
// (https://www.spritefusion.com/pixel-art-vfx/energy), MIT License, Copyright (c) 2026 Hugo Duprez.
import { Particles, Lights, P, Rng, fit, flare, sparkle, ease, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";

const FLOOR = 40;   // art px below the hit: where falling sparks come to rest

export const meta = {
  name: "Magic missile hit",
  desc: "A star flare and a ring open out and fade, throwing motes, sparks and hanging stars.",
  tags: ["impact", "magic", "arcane", "missile", "spell", "one-shot"],
  size: [176, 150],
  origin: [88, 90],
  duration: 1.4,
  loop: false,
  fps: 30,
  options: { palette: ["#140a26", "#2b1252", "#481c88", "#6b2cc0", "#9a48ec", "#c684ff", "#ecc8ff", "#ffffff"], seed: 6 },
};

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => FLOOR, sparks: [WHITE, C[6], C[5], C[4]] }), lights = new Lights();
  let t = 0, burst = false;
  return {
    update(dt) {
      t += dt;
      if (!burst) {
        burst = true;
        lights.add(0, 0, 52, C[4], 0.95, 0.55);
        lights.add(0, 0, 22, WHITE, 0.8, 0.12);
        for (let i = 0; i < 26; i++) {
          const a = R.range(0, TAU), sp = R.range(60, 150) * (1 - 0.65 * Math.max(0, Math.sin(a)));
          ps.spawn(i % 3 ? P.MOTE : P.STAR, 0, 0, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.25, 0.45), R.pick([C[5], C[6], WHITE]), R.range(0.8, 1.8));
        }
        for (let i = 0; i < 18; i++) {
          const a = R.range(0, TAU), sp = R.range(110, 240) * (1 - 0.5 * Math.max(0, Math.sin(a)));
          ps.spawn(P.SPARK, 0, 0, Math.cos(a) * sp, Math.sin(a) * sp - 30, R.range(0.12, 0.3));
        }
        for (let i = 0; i < 14; i++) {
          const a = R.range(0, TAU), d = R.range(4, 22);
          ps.spawn(P.STAR, Math.cos(a) * d, Math.sin(a) * d * 0.8, 0, -R.range(2, 8), R.range(0.5, 1.1), R.pick([C[6], WHITE, C[5]]), R.range(0.8, 2.6), R.range(0.05, 0.45));
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    draw(p) {
      ps.draw(p);
      if (t < 0.5) {
        const e = t / 0.5;
        if (e < 0.5) flare(p, 0, 0, 26 * Math.pow(1 - e * 2, 1.2) + 2, 1 - e * 2, C);
        if (e < 0.12) p.circle(0, 0, 6 * (1 - e / 0.12) + 1, WHITE);
        p.ring(0, 0, 4 + 20 * ease.outCubic(e), Math.max(1, 2.5 * (1 - e)), e < 0.3 ? C[6] : C[5], Math.min(1, (1 - e) * 1.5));
        if (e < 0.4) sparkle(p, 0, 0, 7 * (1 - e / 0.4), C[6], C[4], 0.6 * (1 - e / 0.4));
      }
      lights.draw(p);
    },
  };
}
