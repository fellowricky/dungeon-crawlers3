// Game fork of pixelfx's arcane/arcane-beam (MIT, https://github.com/patch-gg/pixelfx), the look of every
// beam and ray spell, drawn live by render/pixelfx_live.js (spawnLiveBeam). Upstream is a fixed 168 px beam
// out of a stand-in's hand, its sparks falling to a floor line. Here:
//   - the beam starts at the local origin and runs `o.length` px to the right (the caster->target line, laid
//     along the screen by the renderer), and `o.reach` (0..1) is how far it has shot out so far;
//   - `o.flow` +1 runs its pulses and strands out from the caster, -1 back into it (drains: Vampiric Touch);
//   - nothing knows about a floor: the end's spark fountain sprays back off the tip instead of arcing down,
//     since "down" on a beam laid at any screen angle is just one side of it;
//   - `o.jag` (0..1) kinks the body into a crackling line for lightning.
//
// The beam (banded across, pulses running down it, sine strands that brighten in front, a source flare with
// spinning rays, an end flare spraying rays and sparks) is adapted from Sprite Fusion's open-source energy beam
// (https://www.spritefusion.com/pixel-art-vfx/energy), MIT License, Copyright (c) 2026 Hugo Duprez.
import { PAL, fit, cycle, fly, flyV, loopNoise, fract, ease, sparkle, TAU, WHITE } from "../../vendor/pixelfx/core/index.js";
import { bayer, mote } from "../../vendor/pixelfx/fx/arcane/_lib.js";

const D = 1.2, W = 6;

export const meta = {
  name: "Spell beam",
  desc: "A beam of any length and palette: a white core, strands twisting round it, pulses running down it, a flaring source and an end that sprays sparks.",
  tags: ["beam", "ray", "magic", "loop"],
  /* the canvas is sized per beam by the renderer; this is the authored one */
  size: [264, 100],
  origin: [26, 50],
  duration: 3600,
  loop: true,
  fps: 30,
  options: { palette: PAL.arcane, seed: 10, length: 168, reach: 1, flow: 1, jag: 0 },
};

/* half beam width (px) along it: the authored wobble, and for lightning a crackling kink */
function centreAt(d, ph, o) {
  if (!o.jag) return 0;
  const k = Math.floor(ph * 18);   // re-kinks ~18 times a loop: a crackle, not a slither
  return o.jag * 7 * loopNoise(fract(d * 0.011 + k * 0.137), 2.4, o.seed + k);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), ph = (t % D) / D, S = o.seed, F = o.flow < 0 ? -1 : 1;
  const L = Math.max(4, o.length * Math.max(0, Math.min(1, o.reach))), HX = 0, HY = 0, EX = HX + L;
  const LV = [WHITE, C[6], C[5], C[4], C[3], C[2]];
  // the body, built across from a white core out to a dithered edge, wobbling and pulsing as it goes
  for (let d = 0; d <= L; d += 0.5) {
    const x = HX + d, cy = HY + centreAt(d, ph, o);
    const w = W * (1 + 0.12 * Math.sin(d * 0.35 - F * ph * TAU * 8)) * Math.min(1, (d + 3) / 7) * (o.jag ? 0.7 : 1);
    const pulse = fract(d * 0.025 - F * ph * 4) < 0.07 ? 1 : 0;
    for (let q0 = -w * 1.3; q0 <= w * 1.3; q0 += 0.5) {
      const q = Math.abs(q0) / w, y = cy + q0;
      let lv = q < 0.2 ? 0 : q < 0.4 ? 1 : q < 0.62 ? 2 : q < 0.85 ? 3 : q < 1 ? 4 : 5;
      lv = Math.max(0, lv - pulse);
      if (lv === 5 && bayer(x, y) > (1.3 - q) / 0.3) continue;
      p.px(x, y, LV[lv]);
    }
    // three strands twisting round it: bright on the near side, gone behind
    for (let s = 0; s < 3; s++) {
      const a = d * 0.17 - F * ph * TAU * 6 + (s * TAU) / 3, off = Math.sin(a) * w * 1.05;
      if (Math.cos(a) > -0.15) p.dot(x, cy + off, Math.cos(a) > 0.55 ? WHITE : C[6]);
    }
    if ((Math.round(d * 2) & 11) === 0) p.glow(x, cy, w * 2.2 + 4, C[5], 0.2);
  }

  // the source: a flickering flare with spinning rays at the hand
  const fr = 4.2 + Math.sin(ph * TAU * 10) * 0.6;
  for (let i = 0; i < 4; i++) {
    const a = ph * TAU * 2.5 + (i * TAU) / 4, l = 7 + 3 * Math.sin(ph * TAU * 6 + i);
    p.line(HX, HY, HX + Math.cos(a) * l, HY + Math.sin(a) * l, (u) => (u < 0.5 ? WHITE : C[6]), (u) => (u < 0.6 ? 1 : 1.6 - u));
  }
  p.circle(HX, HY, fr + 1.5, C[4]);
  p.circle(HX, HY, fr, C[6]);
  p.circle(HX, HY, fr * 0.6, WHITE);
  p.glow(HX, HY, 32, C[5], 0.8);
  // energy drawn into the hand (or, for a drain, the stolen light arriving)
  cycle(t, D, 10, S * 3 + 1, 0.18, (age, life, r) => {
    const a = r.range(0, TAU), dd = 16 * (1 - age / life) + 3, x = HX + Math.cos(a) * dd, y = HY + Math.sin(a) * dd;
    p.dot(x, y, age / life > 0.6 ? WHITE : C[6]);
  });

  // the end: a hot flare spraying rays, rings shocking out, sparks thrown back off the tip
  const ey = HY + centreAt(L, ph, o), ir = 5 + Math.sin(ph * TAU * 12) * 0.8;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i - 3) * 0.36, l = 8 + 8 * Math.abs(loopNoise(ph, 4, S * 7 + i));
    p.line(EX, ey, EX + Math.cos(a) * l, ey + Math.sin(a) * l, (u) => (u < 0.4 ? WHITE : i % 2 ? C[5] : C[6]), (u) => (u < 0.6 ? 1 : 1.6 - u));
  }
  for (let k = 0; k < 3; k++) {
    const q = fract(ph * 3 + k / 3);
    p.ring(EX, ey, 3 + 15 * ease.outCubic(q), Math.max(1, 2 * (1 - q)), q < 0.25 ? WHITE : C[5], 1.1 - q);
  }
  p.circle(EX, ey, ir + 1.5, C[4]);
  p.circle(EX, ey, ir, C[6]);
  p.circle(EX, ey, ir * 0.55, WHITE);
  p.glow(EX, ey, 40, C[5], 0.9);
  p.glow(EX, ey, 12, WHITE, 0.6);
  // a fan of sparks thrown back off the tip, both sides, slowing (no floor: a beam lies at any angle)
  cycle(t, D, 160, S * 3 + 2, (g) => g.range(0.18, 0.45), (age, life, r) => {
    const a = Math.PI + r.range(-1.5, 1.5), sp = r.range(70, 240), vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
    const [x, y] = fly(EX, ey, vx, vy, age, 0, 3.2), [ux, uy] = flyV(vx, vy, age, 0, 3.2), k = 1 - age / life;
    const head = k > 0.6 ? WHITE : k > 0.3 ? C[6] : C[5], sp2 = Math.hypot(ux, uy) || 1, len = Math.min(8, 1 + sp2 * 0.022);
    p.line(x - (ux / sp2) * len, y - (uy / sp2) * len, x, y, (u) => (u > 0.5 ? head : C[4]));
    p.glow(x, y, 3, head, 0.45 * k);
  });
  cycle(t, D, 6, S * 3 + 3, 0.3, (age, life, r) => {
    const k = Math.sin((age / life) * Math.PI);
    sparkle(p, EX + r.range(-12, 4), ey + r.range(-12, 12), 1 + 2.5 * k, C[6], C[5], 0.4 * k);
  });
  // vapour lifting off the end
  cycle(t, D, 7, S * 3 + 5, (g) => g.range(0.8, 1.2), (age, life, r) => {
    const q = age / life, x = EX + r.range(-8, 4) - q * 6, y = ey + r.sign() * (4 + q * r.range(10, 18)), rad = r.range(3, 5) * (0.7 + 0.8 * q);
    p.disc(x, y, rad, C[4], (dd) => 0.28 * Math.sin(q * Math.PI) * (1 - dd * dd));
  });
  // motes shed along the beam, drifting with its flow
  const motes = Math.max(4, Math.round(L / 10));
  cycle(t, D, motes, S * 3 + 4, (g) => g.range(0.3, 0.6), (age, life, r) => {
    const q = age / life, d0 = r.range(10, Math.max(12, L - 10)), x = HX + d0 + F * q * 20, y = HY + centreAt(d0, ph, o) + r.sign() * (W + 1 + q * r.range(4, 10));
    mote(p, x, y, F * 40, (y - HY) * 1.5, r.chance(0.5) ? C[6] : C[5], 0.6, 1 - q, 0.3);
  });
}
