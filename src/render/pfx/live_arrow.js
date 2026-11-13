// An arrow for spells: pixelfx's projectiles/arrow (MIT, https://github.com/patch-gg/pixelfx) with everything taken from one
// palette. Upstream's palette only reaches its fletching, leaving a steel head, a wooden shaft and pale wind. Drawn nose
// right with the tip at its origin, for a composite's `orient` layer; the game owns the flight.
import { PAL, fit, rand, sparkle, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { beat } from "../../vendor/pixelfx/fx/projectiles/_lib.js";

export const meta = {
  name: "Arrow",
  desc: "An arrow in flight in one palette: a bright head, a dark shaft, fletching fluttering, streaks peeling off it.",
  tags: ["projectile", "arrow", "spell", "directional", "loop"],
  size: [112, 32],
  origin: [92, 16],
  duration: 0.6,
  loop: true,
  fps: 30,
  options: { palette: PAL.leaf, seed: 3 },
};

const HEAD = ["..LL....", "..sLLL..", "bbsSSSSW", "..dDDD..", "..DD...."];
const FLETCH = [
  ["AAa.........", ".aAAa.......", "..aaAAa.....", "nkkkkkkkkkkk", "..cCCc......", ".cCCc.......", "CCc........."],
  [".AAa........", "..aAAa......", "..aaAAAa....", "nkkkkkkkkkkk", "..cCCCc.....", "..cCCc......", ".CCc........"],
  ["AAAa........", "aAAa........", ".aaAAa......", "nkkkkkkkkkkk", "..ccCc......", "cCCc........", "CCc........."],
];

export function draw(p, t, o) {
  const C = fit(o.palette, 8), S = o.seed, D = meta.duration;
  const fr = Math.floor(t * 30 + 1e-6), ph = t / D, left = -meta.origin[0] + 2, LEN = 36;

  // streaks peeling off the head and the fletching, stretching back and thinning
  beat(t, D, 9, S, (r) => r.range(0.14, 0.26), (age, life, r) => {
    const k = age / life, top = r.chance(0.5) ? -1 : 1, from = r.chance(0.6) ? -3 : -LEN + 6;
    const x0 = from - age * r.range(160, 240), len = r.range(8, 16) * (0.5 + k), y = 0.5 + top * (r.range(3, 5) + k * r.range(1, 2.5));
    if (x0 - len < left) return;
    p.line(x0, y, x0 - len, y, (u) => (u < 0.25 && k < 0.4 ? C[6] : k < 0.4 ? C[5] : C[3]), (u) => (u < 0.65 ? 1 : (1 - u) / 0.35));
  });
  // little eddies spinning off the feathers
  beat(t, D, 6, S + 3, (r) => r.range(0.15, 0.25), (age, life, r) => {
    const k = age / life, cx = -LEN - 2 - age * r.range(100, 150), cy = 0.5 + r.sign() * r.range(2, 4), a = age * 30 + r.range(0, TAU), rr = 1.2 + k * 1.5;
    if (cx < left + 4) return;
    for (let i = 0; i < 4; i++) p.dot(cx + Math.cos(a + i * 0.5) * rr, cy + Math.sin(a + i * 0.5) * rr, C[5], (1 - k) * (1 - i * 0.2));
  });

  // the shaft with a lit top line
  p.line(-LEN + 11, 0, -7, 0, C[2]);
  for (let x = -LEN + 14; x < -8; x += 6) p.px(x, 0, C[4]);
  // the fletching flutters through its poses
  const pose = FLETCH[Math.floor(rand(fr, S) * 3)];
  p.sprite(pose, { a: C[5], A: C[6], c: C[3], C: C[4], k: C[1], n: C[0] }, -LEN, -3);
  // the binding and the head: a lit upper bevel, a shaded lower one, a white point
  p.sprite(HEAD, { L: C[7], s: C[6], S: C[6], d: C[3], D: C[4], b: C[0], W: WHITE }, -7, -2);
  // a glint runs down the blade now and then
  const g = (ph * 2) % 1;
  if (g < 0.25) sparkle(p, -5 + g * 16, -1, 1 + Math.round(2 * Math.sin((g / 0.25) * Math.PI)), WHITE, C[6], 0.25);
}
