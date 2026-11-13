// Moonbeam burning someone: a silver line round the creature's own outline, and pale light rising off it. Built on pixelfx's
// core (MIT, https://github.com/patch-gg/pixelfx). It draws only round the body: the sprite itself is left alone.
import { fit, rand, smooth, WHITE, PAL } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 0.7, MOTES = 18;

export const meta = {
  name: "Moon scorch",
  desc: "A silver line blazes round the outline, drops out pixel by pixel, and pale motes rise off the body.",
  tags: ["holy", "moon", "burn", "outline", "motes", "one-shot"],
  size: [88, 112],
  origin: [44, 92],
  duration: D,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.ice },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a), N = S.outline.length;
  const gone = smooth(0.1, 0.45, t);
  for (const [x, y] of S.outline) {
    if (rand(x, y, 3) < gone) continue;
    p.px(a.x + x, a.y + y, t < 0.07 ? WHITE : C[6]);
  }
  for (let i = 0; i < MOTES && N; i++) {
    const u = (t - rand(i, 3) * 0.25) / (0.3 + 0.15 * rand(i, 5));
    if (u < 0 || u >= 1) continue;
    const [ex, ey] = S.outline[Math.floor(rand(i, 9) * N)];
    p.px(a.x + ex + Math.sin(u * 6 + i), a.y + ey - (8 + 18 * rand(i, 7)) * u, u < 0.4 ? WHITE : C[6]);
  }
}
