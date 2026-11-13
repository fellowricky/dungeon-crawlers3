// Hold Person's landing: two jaws of violet crystal slam shut on the creature from either side. Held, its outline blazes
// and the jaws sink into the rime; `broken` (the save), they stop short, strain and shatter. Built on pixelfx's core
// (MIT, https://github.com/patch-gg/pixelfx), on the creature's own outline.
import { PAL, fit, rand, smooth, WHITE } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 0.7, SHUT = 0.14, START = 20, STOP_SHORT = 5, SNAP = 0.24;

export const meta = {
  name: "Hold clamp",
  desc: "Crystal jaws slam shut on the body and sink into it, or stop short and shatter when it resists.",
  tags: ["status", "debuff", "paralyze", "hold", "impact", "one-shot"],
  size: [96, 104],
  origin: [48, 92],
  duration: D,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.arcane, broken: false },
};

/* One jaw as pixels relative to the body's edge, pointing out along +x: a spine two pixels thick with its ends
   hooked in, and shards of crystal biting inward. The second value is its light. */
function jawPixels(top, bottom) {
  const out = [];
  for (let y = top; y <= bottom; y++) {
    const u = (y - top) / Math.max(1, bottom - top);
    const hook = Math.max(0, Math.abs(u - 0.5) * 2 - 0.82) * 22;   // the last few rows curl in
    out.push([0 - hook, y, 2], [1 - hook, y, 1], [2 - hook * 0.5, y, 0]);
    if ((y - top) % 5 === 2) for (let i = 1; i <= 3; i++) out.push([-i, y, i === 3 ? 3 : 2]);
  }
  return out;
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a), broken = o.broken;
  const light = [C[3], C[4], C[6], WHITE];
  const stop = broken ? STOP_SHORT : 0;
  const u = smooth(0, SHUT, t);
  const gap = stop + (START - stop) * (1 - u * u);       // accelerating in: it slams, it doesn't ease to rest
  const strain = broken && t > SHUT && t < SNAP ? (Math.floor(t * 40) % 2 ? 1 : -1) : 0;
  const pixels = jawPixels(Math.round(S.h * 0.08), Math.round(S.h * 0.92));
  const bite = rand(1, 7);

  for (const side of [-1, 1]) {
    const edge = side < 0 ? a.x : a.x + S.w - 1;
    for (const [dx, dy, l] of pixels) {
      const x = edge + side * (gap + dx + strain), y = a.y + dy;
      if (broken && t >= SNAP) {
        /* shattered: every few pixels a shard, thrown outward and falling */
        if (rand(dx * 3 + 11, dy, side + 2) > 0.5) continue;
        const age = t - SNAP, life = 0.2 + 0.26 * rand(dy, dx * 5 + 3, 9);
        if (age > life) continue;
        const vx = side * (26 + 46 * rand(dy, 13)), vy = -28 * rand(dx * 7 + 5, dy, 4) + 14;
        p.px(x + vx * age, y + vy * age + 0.5 * 260 * age * age, age < 0.08 ? WHITE : light[l]);
        continue;
      }
      if (!broken && t > SHUT + 0.1) {
        /* held: it sinks into the rime, pixels dropping out at random */
        const k = (t - SHUT - 0.1) / 0.28;
        if (k > 1 || rand(dx * 3 + 11, dy, side + bite) < k) continue;
      }
      p.px(x, y, t > SHUT - 0.03 && t < SHUT + 0.05 ? WHITE : light[l]);
    }
    /* the rush of air behind a closing jaw */
    if (t < SHUT) for (let i = 0; i < 7; i++) {
      const y = a.y + S.h * (0.14 + 0.1 * i);
      p.dot(edge + side * (gap + 4 + 3 * rand(i, 3)), y, C[4]);
      p.dot(edge + side * (gap + 8 + 3 * rand(i, 5)), y, C[3]);
    }
  }

  /* contact: held, the outline blazes round the sprite (nothing is drawn over the body); resisted, a glow where the jaws grind */
  const since = t - SHUT;
  if (!broken && since >= 0) {
    const k = 1 - smooth(0, 0.3, since);
    if (k > 0) {
      for (const [x, y] of S.outline) p.px(a.x + x, a.y + y, since < 0.08 ? WHITE : C[6]);
      p.glow(a.x + S.w / 2, a.y + S.h / 2, S.h * 0.7, C[5], 0.4 * k);
    }
  } else if (broken && t >= SHUT && t < SNAP + 0.1) {
    p.glow(a.x + S.w / 2, a.y + S.h / 2, S.h * 0.6, C[5], 0.25);
  }
}
