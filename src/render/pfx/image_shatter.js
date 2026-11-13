// A Mirror Image duplicate breaking: its own outline flashes white, then its shape falls apart into glass shards thrown
// outward from the middle, falling and glinting out. Built on pixelfx's core (MIT, https://github.com/patch-gg/pixelfx).
import { PAL, fit, rand, smooth, WHITE } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 0.65, FLASH = 0.07;

export const meta = {
  name: "Image shatter",
  desc: "A duplicate's outline flashes and its shape breaks into glass shards thrown outward, falling and glinting out.",
  tags: ["illusion", "glass", "shatter", "impact", "one-shot"],
  size: [112, 112],
  origin: [56, 88],
  duration: D,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.ice },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a), cx = S.w / 2, cy = S.h * 0.45;
  if (t < FLASH) {
    for (const [x, y] of S.outline) p.px(a.x + x, a.y + y, WHITE);
    p.glow(a.x + cx, a.y + cy, S.h * 0.6, C[6], 0.5);
    return;
  }
  const age = t - FLASH;
  for (const [x, y] of S.body) {
    if (rand(x, y, 3) > 0.34) continue;
    const life = 0.28 + 0.3 * rand(x, y, 5);
    if (age >= life) continue;
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1, v = 26 + 44 * rand(x, y, 7);
    const px = a.x + x + (dx / l) * v * age, py = a.y + y + (dy / l) * v * age * 0.7 + 150 * age * age;
    const u = age / life;
    /* a shard catches the light as it tumbles */
    const c = Math.floor(age * 30 + x * 3 + y) % 5 === 0 ? WHITE : u < 0.5 ? C[6] : C[5];
    p.px(px, py, c);
    if (rand(x, y, 9) < 0.3 && u < 0.6) p.px(px + 1, py, C[5]);
  }
  p.glow(a.x + cx, a.y + cy, S.h * 0.5, C[5], 0.3 * (1 - smooth(0, 0.25, age)));
}
