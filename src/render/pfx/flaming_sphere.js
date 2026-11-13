// Flaming Sphere: a hovering ball of fire nearly a hero's height, drawn at the game's own pixel scale rather than scaled
// up. The ball itself is shaded as a true sphere, under the crown of tongues, licks and embers from pixelfx's
// critters/flying-skull (MIT, https://github.com/patch-gg/pixelfx).
// The fire recipes are adapted from Sprite Fusion's open-source fire (https://www.spritefusion.com/pixel-art-vfx/fire),
// MIT License, Copyright (c) 2026 Hugo Duprez.
import { fit, rand, wrap, cycle, fly, clamp, P, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { Swarm, lnoise, tongue, firePuff } from "../../vendor/pixelfx/fx/critters/_lib.js";

const D = 2.4, RAD = 14, Y0 = -20;

export const meta = {
  name: "Flaming sphere",
  desc: "A hovering ball of fire: a molten swirl round a white-hot heart, tongues of flame licking off its crown, embers rising, the floor lit beneath it.",
  tags: ["fire", "orb", "sphere", "floating", "loop"],
  size: [112, 120],
  origin: [56, 88],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  options: {
    palette: ["#4a1712", "#8a1f17", "#c9281f", "#f2561d", "#ff8a2a", "#ffc23d", "#ffe26b", "#fff3a6", "#ffffff"],
    seed: 1,
  },
};

const SWARM = new Swarm();
const centre = (t) => ({ ph: t / D, cx: 0, cy: Y0 + Math.sin((t / D) * TAU) * 1.5 });
const topY = (x) => -Math.sqrt(Math.max(0, RAD * RAD - x * x));
const flick = (t) => 0.74 + 0.16 * lnoise(t, D, 18, 0, 1) + 0.1 * lnoise(t, D, 46, 0, 2);

/* the tongues on the crown: tallest in the middle, outermost drawn first */
function crown(seed) {
  const out = [];
  for (let x = -12; x <= 12; x += 2) out.push({ x, h: 7 + 12 * (1 - (x / 13) ** 2), w: 2.2 + rand(x + 20, seed, 3) * 0.8, n: 37 + x * 3 + seed * 11, front: false });
  for (let x = -7; x <= 7; x += 3.5) out.push({ x, h: 4 + 3 * rand(x * 4 + 20, seed, 5), w: 1.6, n: 91 + x * 5 + seed * 7, front: true });
  return out.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
}
function height(f, t, k) {
  const leap = Math.max(0, lnoise(t, D, 6, f.n * 3.1, 70) - 0.55) * 1.6;
  return (f.h + 0.25 * f.h * lnoise(t, D, 8, f.n * 1.7, 5) + f.h * leap) * (0.9 + 0.1 * k);
}
function tongues(p, t, k, s, list, heat, sunk) {
  const lick = (f) => lnoise(t, D, 5, f.n, 40) * 2 - clamp(f.x * 0.2, -2, 2);
  for (let li = 0; li < 4; li++)
    for (const f of list) tongue(p, s.cx + f.x, s.cy + topY(f.x) + sunk, height(f, t, k), f.w, lick(f), t, D, f.n, heat, li);
}

/* Swirling fire fixed to the ball's surface: smooth, warped sines over a point on the unit sphere. */
function plasma(x, y, z) {
  const n = (Math.sin(5.1 * x + 1.7 + 2.4 * Math.sin(3.7 * y + 0.4))
    + Math.sin(5.9 * y + 0.6 + 2.2 * Math.sin(4.6 * z + 1))
    + Math.sin(5.3 * z + 2.4 + 2 * Math.sin(4.9 * x + 2.2))) / 3;
  return 1 - 2.6 * Math.abs(n);   // ridged: thin bright veins where the sines cross, dark crust between
}

/* A real ball, drawn pixel by pixel: each pixel finds its point on the sphere, turns that point back
   through the tilt and the spin to read the fire there (one whole turn a loop, so the loop is seamless),
   and is shaded by how it faces the light. Hot up on the lit side, sinking to crust round the far limb. */
const TILT = 0.5, LIGHT = [-0.36, -0.52, 0.77];
function orb(p, F, s, k) {
  const cx = Math.round(s.cx), cy = Math.round(s.cy);
  const ramp = [F[0], F[1], F[2], F[3], F[4], F[5], F[6], F[7], WHITE];
  const ct = Math.cos(TILT), st = Math.sin(TILT), ca = Math.cos(s.ph * TAU), sa = Math.sin(s.ph * TAU);
  for (let dy = -RAD; dy <= RAD; dy++)
    for (let dx = -RAD; dx <= RAD; dx++) {
      const u = dx / (RAD + 0.5), v = dy / (RAD + 0.5), r2 = u * u + v * v;
      if (r2 > 1) continue;
      const w = Math.sqrt(1 - r2);
      const y1 = v * ct - w * st, z1 = v * st + w * ct;
      const n = plasma(u * ca + z1 * sa, y1, z1 * ca - u * sa);
      const facing = u * LIGHT[0] + v * LIGHT[1] + w * LIGHT[2];
      const heat = 0.27 + 0.4 * facing + 0.3 * Math.max(-0.6, n) * (0.4 + 0.6 * w) + (k - 0.82) * 0.25;
      p.dot(cx + dx, cy + dy, ramp[Math.round(clamp(heat, 0, 1) * 8)]);
    }
}

/* flame puffs and licks breaking off the crown, embers wandering up */
function particles(p, t, o, s, heat, F) {
  const sw = SWARM.begin(t), S = o.seed * 7;
  sw.ps.sparks = [F[7], F[6], F[4], F[2]];
  cycle(t, D, 24, S + 2, (r) => r.range(0.18, 0.36), (age, L, r) => {
    const a = r.range(-1.2, 1.2);
    const [x, y] = fly(s.cx + Math.sin(a) * RAD, s.cy - Math.cos(a) * RAD - r.range(0, 6), r.range(-6, 6) + Math.sin(a) * 6, -r.range(18, 32), age, -95, 3.2);
    firePuff(p, x, y, 1 - age / L, r.range(1, 2), r.next() * 100, heat);
  });
  cycle(t, D, 14, S + 3, 0.26, (age, L, r) => {
    const fx = r.range(-10, 10), k = 1 - age / L, rr = r.range(0.9, 1.6) * (0.4 + 0.6 * k);
    const x = s.cx + fx + r.range(-3, 3) * age, y = s.cy + topY(fx) - r.range(5, 16) * (1 - Math.abs(fx) / 14) - r.range(12, 20) * age;
    p.circle(x, y, rr + 0.6, k > 0.5 ? heat[5] : heat[6]);
    if (k > 0.35) p.circle(x, y - 0.3, rr * 0.6, k > 0.7 ? heat[2] : heat[4]);
  });
  cycle(t, D, 16, S + 4, (r) => r.range(1, 2.2), (age, L, r) => {
    const q = r.next() * 100, [x, y] = fly(s.cx + r.range(-11, 11), s.cy - r.range(4, 16), r.range(-18, 18), -r.range(20, 50), age, -20, 1.6);
    sw.add(P.EMBER, x + Math.sin(age * 2.3 + q) * 3 * Math.min(1, age), y, 0, 0, age, L, F[4], r.chance(0.3) ? 2 : 1, 0, q);
  });
  sw.draw(p);
}

export function drawBack(p, time, o) {
  const t = wrap(time, D), F = fit(o.palette, 9), k = flick(t), s = centre(t);
  for (let x = -24; x <= 24; x += 6) p.glow(x, -1, 16, F[4], 0.16 * k * (1 - Math.abs(x) / 32));
  p.glow(s.cx, s.cy, 30, F[4], 0.3 * k);
}

export function draw(p, time, o) {
  const t = wrap(time, D), F = fit(o.palette, 9), heat = [...F].reverse(), k = flick(t), s = centre(t);
  const all = crown(o.seed);
  tongues(p, t, k, s, all.filter((f) => !f.front), heat, 3);
  orb(p, F, s, k);
  tongues(p, t, k, s, all.filter((f) => f.front), heat, 2);
  particles(p, t, o, s, heat, F);
}
