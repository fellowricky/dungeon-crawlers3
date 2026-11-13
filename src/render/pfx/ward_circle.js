// Protection from Evil's circle, redrawn straight down so it can lie flat on the floor and hold
// true as the camera turns. Game fork of pixelfx's arcane/rune-circle (MIT,
// https://github.com/patch-gg/pixelfx): the same rings, studs, turning square, runes and chasing
// light, seen from above and opening out from the middle; its rising motes and column of light,
// which stand up off the floor, are gone.
import { PAL, fit, ease, clamp, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { floorRing, glyph } from "../../vendor/pixelfx/fx/arcane/_lib.js";

const SIZE = 120, R = 46, RR = 37, RI = 23, RC = 7, NR = 12, D = 4, OPEN = 0.35;

export const meta = {
  name: "Ward circle",
  desc: "A top-down rune circle opens out on the floor and turns: runes lit by chasing light, a turning square, ticks.",
  tags: ["arcane", "holy", "rune", "circle", "ward", "ground", "top-down", "loop"],
  size: [SIZE, SIZE],
  origin: [SIZE / 2, SIZE / 2],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: PAL.holy },
};

const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const all = () => true;

export function create(o) {
  const C = fit(o.palette, 8);
  let t = 0;
  return {
    update(dt) { t += dt; },
    draw(p) {
      const k = ease.outCubic(clamp(t / OPEN));
      if (k < 0.02) return;
      const spin = (t / D) * (TAU / 2), chase = (t / D) * TAU * 2;
      const lit = (g, w) => gap(g, chase) < w || gap(g, chase + Math.PI) < w;
      p.glow(0, 0, R * 1.3 * k, C[4], 0.22);
      floorRing(p, 0, 0, R * k, 1, (g) => (lit(g, 0.22) ? WHITE : lit(g, 0.5) ? C[6] : C[5]), 1, all);
      floorRing(p, 0, 0, RI * k, 1, () => C[5], 1, all);
      floorRing(p, 0, 0, RC * k, 1, () => C[6], 1, all);
      /* studs round the outside */
      for (let j = 0; j < 16; j++) {
        const g = spin + ((j + 0.5) * TAU) / 16, x = Math.cos(g) * (R + 3.5) * k, y = Math.sin(g) * (R + 3.5) * k;
        p.px(x, y, lit(g, 0.3) ? WHITE : j % 2 ? C[5] : C[6]);
      }
      /* the square, turning the other way with its corners on the inner ring */
      const pts = [0, 1, 2, 3].map((n) => { const g = -spin + (n * TAU) / 4 + Math.PI / 4; return [Math.cos(g) * RI * k, Math.sin(g) * RI * k]; });
      for (let n = 0; n < 4; n++) p.line(pts[n][0], pts[n][1], pts[(n + 1) % 4][0], pts[(n + 1) % 4][1], C[5]);
      /* the runes, riding round the band once it has opened */
      if (k > 0.6) {
        for (let n = 0; n < NR; n++) {
          const g = spin + ((n + 0.5) * TAU) / NR, hot = lit(g, 0.2), x = Math.cos(g) * RR, y = Math.sin(g) * RR;
          glyph(p, [0, 3, 5][n % 3], x, y, hot ? WHITE : C[6], 1, hot ? C[5] : C[3]);
        }
      }
      for (const g of [chase, chase + Math.PI]) p.glow(Math.cos(g) * R * k, Math.sin(g) * R * k, 10, C[5], 0.4);
    },
  };
}
