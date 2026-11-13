// Enlarge's landing: a warm aura round the creature's own outline that glows while it grows, then fades. Built on
// pixelfx's core (MIT, https://github.com/patch-gg/pixelfx). Parented to the creature, so it swells with the body.
import { PAL, fit, mix, rand, smooth, WHITE } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";
import { recolor } from "../../vendor/pixelfx/fx/holy/_lib.js";

const D = 0.9, MOTES = 10;

export const meta = {
  name: "Growth aura",
  desc: "A warm glow floods the body and hugs its outline, a few motes rise off it, and it all fades.",
  tags: ["status", "buff", "aura", "outline", "motes", "one-shot"],
  size: [88, 104],
  origin: [44, 92],
  duration: D,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.gold },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a);
  const k = smooth(0, 0.12, t) * (1 - smooth(0.4, D, t));
  if (k <= 0) return;
  p.glow(a.x + S.w / 2, a.y + S.h / 2, S.h * 0.75, C[5], 0.45 * k);
  recolor(p, a, (c) => mix(c, C[5], 0.4 * k));   // a solid tint: a translucent dot would dither into a checkerboard
  for (const [x, y] of S.outline) p.dot(a.x + x, a.y + y, k > 0.6 ? C[6] : C[5], k > 0.25 ? 1 : 0);
  for (let i = 0; i < MOTES; i++) {
    const u = (t - rand(i, 3) * 0.35) / 0.5;
    if (u < 0 || u > 1) continue;
    const x = a.x + rand(i, 5) * S.w, y = a.y + S.h * (0.2 + 0.8 * rand(i, 7)) - u * 20;
    p.dot(x, y, u < 0.3 ? WHITE : C[6], Math.sin(Math.PI * u));
  }
}
