// Lesser Restoration's landing, in three beats. A band of light climbs the creature's outline, tearing dark flecks of the
// affliction off it as it passes. They stream up into a knot over the head. The knot bursts: a ring, sparks, the whole
// outline blazing clean, and motes of light settling back down. Built on pixelfx's core (MIT,
// https://github.com/patch-gg/pixelfx). It draws only round the body: the sprite itself is left alone.
import { PAL, fit, rand, smooth, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { shape } from "../../vendor/pixelfx/fx/status/_lib.js";

const D = 1.4, CLIMB = 0.42, BURST = 0.72, FLECKS = 34, SPARKS = 22, RAYS = 10, MOTES = 16;
/* 0xAABBGGRR: the affliction's bruise-dark, and the sick violet that lets it show on a dark floor */
const SICK = [0xff1c0c20, 0xff3a2042, 0xff7a3f86];

export const meta = {
  name: "Affliction lift",
  desc: "Light climbs the outline and tears dark flecks off it; they knot over the head and burst into a ring and sparks, and motes settle back down.",
  tags: ["status", "cure", "cleanse", "buff", "outline", "burst", "one-shot"],
  size: [112, 136],
  origin: [56, 104],
  duration: D,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.heal },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, S = shape(a), N = S.outline.length;
  const hx = a.x + S.w / 2, hy = a.y - 11;

  /* the climbing band: the outline lights at its front and stays lit, dimmer, behind it */
  if (t < BURST) {
    const front = S.h * (1 - smooth(0, CLIMB, t));
    for (const [x, y] of S.outline) {
      const d = y - front;
      if (d < -1) continue;
      if (d < 3) p.px(a.x + x, a.y + y, WHITE);
      else if (d < 7) p.px(a.x + x, a.y + y, C[6]);
      else if (t < CLIMB + 0.12 && rand(x, y, 3) > (t - CLIMB) / 0.12) p.px(a.x + x, a.y + y, C[4]);
    }
    if (front > 0) p.glow(hx, a.y + front, 12, C[5], 0.4);
  }

  /* the flecks: each leaves as the band reaches its height, then streams up and in to the knot */
  for (let i = 0; i < FLECKS && N; i++) {
    const [ex, ey] = S.outline[Math.floor(rand(i, 9) * N)];
    const leave = CLIMB * (1 - ey / S.h) + 0.03 * rand(i, 4);
    const u = (t - leave) / (BURST - leave);
    if (u < 0 || u >= 1) continue;
    const pull = u * u * (3 - 2 * u), swirl = Math.sin(u * Math.PI) * (5 + 5 * rand(i, 6)) * (i % 2 ? 1 : -1);
    const x = a.x + ex + (hx - a.x - ex) * pull + swirl, y = a.y + ey + (hy - a.y - ey) * pull;
    const c = i % 3 === 0 ? SICK[2] : SICK[i % 3];
    p.px(x, y, c);
    if (i % 2 === 0) { p.px(x + 1, y, SICK[1]); p.px(x, y + 1, SICK[0]); }   // the heavier clots
  }

  /* the knot: swelling and shuddering over the head, its rim catching the light */
  if (t > CLIMB * 0.6 && t < BURST) {
    const k = smooth(CLIMB * 0.6, BURST, t), r = 1.5 + 4.5 * k;
    const jx = hx + Math.sin(t * 71) * 0.7 * k, jy = hy + Math.cos(t * 83) * 0.7 * k;
    p.circle(jx, jy, r + 1, SICK[2]);
    p.circle(jx, jy, r, SICK[1]);
    p.circle(jx, jy, r * 0.6, SICK[0]);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU + t * 9;
      p.px(jx + Math.cos(ang) * (r + 2), jy + Math.sin(ang) * (r + 2), i % 2 ? C[5] : SICK[2]);
    }
  }

  const since = t - BURST;
  if (since < 0) return;

  /* the burst: a white core, an opening ring, rays and thrown sparks */
  if (since < 0.1) {
    p.circle(hx, hy, 6 - 30 * since, WHITE);
    p.glow(hx, hy, 26, C[6], 0.7 * (1 - since / 0.1));
  }
  if (since < 0.28) {
    const r = 3 + 19 * smooth(0, 0.28, since) ** 0.6;
    p.ring(hx, hy, r, since < 0.12 ? 2 : 1, since < 0.08 ? WHITE : since < 0.18 ? C[6] : C[5]);
  }
  for (let i = 0; i < RAYS && since < 0.18; i++) {
    const ang = ((i + rand(i, 3) * 0.4) / RAYS) * TAU, inner = 5 + 70 * since, len = 7 * (1 - since / 0.18);
    for (let j = 0; j < len; j++) p.px(hx + Math.cos(ang) * (inner + j), hy + Math.sin(ang) * (inner + j), j < 2 ? WHITE : C[6]);
  }
  for (let i = 0; i < SPARKS; i++) {
    const life = 0.3 + 0.3 * rand(i, 8);
    if (since >= life) continue;
    const ang = rand(i, 2) * TAU, v = 40 + 55 * rand(i, 5), drag = 1 - 0.5 * since / life;
    const u = since / life;
    p.px(hx + Math.cos(ang) * v * since * drag, hy + Math.sin(ang) * v * since * drag + 60 * since * since, u < 0.35 ? WHITE : u < 0.7 ? C[6] : C[5]);
  }

  /* clean: the whole outline blazes, then drops out pixel by pixel */
  if (since < 0.5) {
    const gone = smooth(0.18, 0.5, since);
    for (const [x, y] of S.outline) {
      if (rand(x, y, 3) < gone) continue;
      p.px(a.x + x, a.y + y, since < 0.08 ? WHITE : y < S.h * 0.5 ? C[6] : C[5]);
    }
    p.glow(hx, a.y + S.h / 2, S.h * 0.7, C[5], 0.32 * (1 - since / 0.5));
  }

  /* motes settling back down over the body, twinkling out */
  for (let i = 0; i < MOTES; i++) {
    const u = (since - 0.06 - rand(i, 11) * 0.2) / (0.38 + 0.08 * rand(i, 12));
    if (u < 0 || u >= 1) continue;
    const x = a.x + S.w * (rand(i, 13) * 1.3 - 0.15) + Math.sin(u * 6 + i) * 1.5;
    const y = hy + (S.h + 6) * rand(i, 14) * 0.35 + (S.h * 0.65) * u;
    if (u > 0.7 && Math.floor(u * 40 + i) % 2) continue;
    p.px(x, y, i % 4 === 0 ? WHITE : C[6]);
  }
}
