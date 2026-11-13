// A fight won. The lettering is ui/level-up's (the drop, squash, flash, shine sweep and pop-away), standing on
// its own in the middle of the screen: a flash and a ring burst first, the rays come out when the last letter lands.
import { Particles, Lights, P, Rng, fit, band, flare, sparkle, clamp, seg, smooth, ease, rand, scale, TAU, WHITE } from "../../core/index.js";
import { spell, drawWord } from "./_lib.js";

export const meta = {
  name: "Victory",
  desc: "A gold flash bursts in a ring, VICTORY! drops in letter by letter and bounces, rays shoot out round it, a shine sweeps it and sparkles twinkle; then the letters pop away.",
  tags: ["ui", "victory", "win", "reward", "text", "one-shot"],
  size: [232, 120],
  origin: [116, 60],
  duration: 2.6,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: ["#2a1405", "#5c3008", "#9a5a0e", "#d48e18", "#f5b92c", "#ffde5e", "#fff4bc", "#ffffff"], text: "VICTORY!", seed: 7 },
};

// the opening flash, first letter, stagger, all landed, shine, letters pop away
const FLASH = 0.16, DROP = 0.14, STAG = 0.055, SHINE_AFTER = 0.18, EXIT = 1.95;
export const REPORT_AT = 1.85;   // a host can bring its next screen in here, as the letters start to go

// rays above and below the word, starting on an ellipse just outside it so none crosses it
function rays(p, C, t, k, hw) {
  if (k <= 0.02) return;
  for (let i = 0; i < 26; i++) {
    const an = (i / 26) * TAU + 0.06, ca = Math.cos(an), sa = Math.sin(an), long = i % 2 === 0;
    if (Math.abs(sa) < 0.32) continue;
    const r0 = 1 / Math.sqrt((ca / (hw + 6)) ** 2 + (sa / 15) ** 2) + 2 * k, len = (long ? 20 + 9 * rand(i, 9) : 9 + 5 * rand(i, 8)) * k;
    if (len < 1) continue;
    const sh = 0.75 + 0.25 * Math.sin(t * 7 + i * 2.1), x0 = ca * r0, y0 = sa * r0;
    p.line(x0, y0, x0 + ca * len, y0 + sa * len, (u) => (u < 0.3 ? C[7] : u < 0.6 ? C[6] : C[5]), (u) => sh * (u < 0.55 ? 1.3 : (1.3 * (1 - u)) / 0.45));
  }
}

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), SHADOW = scale(C[0], 0.5);
  const ps = new Particles({ rng: R, ground: () => 999, sparks: [C[7], C[6], C[5], C[3]] }), lights = new Lights();
  const spawn = (k, x, y, vx, vy, life, ...rest) => ps.spawn(k, x, y, vx, vy, Math.min(life, meta.duration - 0.05 - t), ...rest);
  const word = spell(o.text), X0 = -word.w, BASE = 7;
  const lets = word.letters.filter((L) => L.g).map((L, i) => ({ g: L.g, w: L.w, cx: X0 + (L.x + L.w / 2) * 2, born: DROP + i * STAG, pop: EXIT + i * 0.04, off: -22, v: 70, sq: 0, flash: 0, on: false, landed: false, rest: false, burst: false }));
  const right = X0 + word.w * 2, hw = word.w;
  const LANDED = DROP + (lets.length - 1) * STAG + 0.2, SHINE = LANDED + SHINE_AFTER;
  const sats = Array.from({ length: 10 }, (_, i) => {
    const s = i % 2 ? 1 : -1, x = s * R.range(18, hw + 14), y = Math.abs(x) < hw ? R.sign() * R.range(12, 20) : R.range(-14, 14);
    return { x, y, t0: SHINE - 0.1 + i * 0.11 + R.range(0, 0.05), dur: R.range(0.32, 0.5), L: R.range(3, 6) };
  });
  let t = 0;
  return {
    update(dt) {
      t += dt;
      // twinkles round the title while it holds
      if (t > LANDED && t < EXIT + 0.2 && R.chance(0.16)) {
        spawn(P.STAR, R.range(-hw - 16, hw + 16), R.range(-22, 22), R.range(-6, 6), -R.range(4, 14), R.range(0.4, 0.8), R.pick([C[7], C[6], C[6], C[5]]), R.chance(0.3) ? R.range(1.5, 2.4) : 0.6);
      }
      for (const L of lets) {
        if (t < L.born) continue;
        L.on = true;
        if (!L.rest) {
          L.v += 1700 * dt;
          L.off += L.v * dt;
          if (L.off >= 0 && L.v > 0) {
            L.off = 0;
            if (L.v > 110) {
              L.sq = 1;
              if (!L.landed) {
                L.landed = true;
                L.flash = 1;
                lights.add(L.cx, BASE - 7, 18, C[5], 0.55, 0.25);
                for (const s of [-1, 1]) spawn(P.STAR, L.cx + s * L.w, BASE - R.range(0, 3), s * R.range(15, 40), -R.range(5, 25), R.range(0.25, 0.45), C[6], R.range(0.5, 1.2));
              }
              L.v = -L.v * 0.3;
            } else (L.v = 0), (L.rest = true);
          }
        }
        L.sq = Math.max(0, L.sq - dt / 0.1);
        L.flash = Math.max(0, L.flash - dt / 0.12);
        if (!L.burst && t >= L.pop + 0.06) {
          L.burst = true;
          for (let i = 0; i < 4; i++) {
            const an = R.range(0, TAU), sp = R.range(25, 65);
            spawn(P.STAR, L.cx + R.range(-3, 3), BASE - 7 + R.range(-4, 4), Math.cos(an) * sp, Math.sin(an) * sp - 15, R.range(0.3, 0.6), R.pick([C[7], C[6]]), i ? 0.6 : R.range(1.2, 2));
          }
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      rays(p, C, t, ease.outExpo(seg(t, LANDED, LANDED + 0.2)) * (1 - ease.inQuad(seg(t, EXIT - 0.15, EXIT + 0.1))), hw);
      // the opening ring bursts outward
      for (const [d, r1, th] of [[0, hw + 30, 4], [0.07, hw, 2.5]]) {
        const k = (t - d) / 0.5;
        if (k > 0 && k < 1) band(p, 0, 0, 6 + r1 * ease.outCubic(k), 0.42, Math.max(1, th * (1 - k)), 1.15 - k, C, () => true, k < 0.12);
      }
      ps.draw(p, "back");
    },
    draw(p) {
      if (t < FLASH + 0.2) {
        const a = clamp(t / FLASH), b = (t - FLASH) / 0.2;
        if (t < FLASH) sparkle(p, 0, 0, 2 + 10 * a * a, C[6], C[5], 0.4 + 0.5 * a);
        else flare(p, 0, 0, 36 * Math.pow(1 - b, 1.5), 1 - b, C);
        p.glow(0, 0, 60, WHITE, 0.25 * (t < FLASH ? a : 1 - b));
      }
      ps.draw(p, "front");
      const items = [], done = (t - LANDED) / 0.12;
      for (const L of lets) {
        if (!L.on) continue;
        let sx = 2, sy = 2, flash = L.flash;
        if (!L.landed && L.v > 150) (sx = 1.8), (sy = 2.3);
        if (L.sq > 0) (sx = 2 * (1 + 0.22 * L.sq)), (sy = 2 * (1 - 0.22 * L.sq));
        const pu = (t - L.pop) / 0.07, hop = seg(t, L.pop - 0.1, L.pop);
        if (pu >= 1) continue;
        if (hop > 0 && pu <= 0) (sx = 2 * (1 - 0.1 * hop)), (sy = 2 * (1 + 0.15 * hop));
        if (pu > 0) (sx = sy = 2 * (1 + 0.3 * pu)), (flash = 1);
        flash = Math.max(flash, done > 0 && done < 1 ? 1 - done : 0);
        const h = 7 * sy, w = L.w * sx;
        items.push({ g: L.g, x: L.cx - w / 2, y: BASE + L.off - h - 3 * ease.outQuad(hop), sx, sy, a: clamp((t - L.born) / 0.05), flash });
      }
      const sh = seg(t, SHINE, SHINE + 0.34), shine = sh > 0 && sh < 1 ? X0 - 14 + (right - X0 + 30) * ease.inOutSine(sh) : null;
      drawWord(p, items, { fill: [C[3], C[4], C[5], C[6]], edge: WHITE, under: C[2], outline: C[0], shadow: SHADOW, shine, shineY: BASE - 14, glint: C[6] });
      if (shine !== null && shine > X0 && shine < right) p.glowLine(shine, BASE - 14, shine + 8.4, BASE, 9, C[6], 0.3);
      const hold = smooth(LANDED - 0.2, LANDED + 0.1, t) * (1 - smooth(EXIT, EXIT + 0.4, t));
      if (hold > 0) p.glow(0, 0, hw + 20, C[5], 0.22 * hold + (done > 0 && done < 1 ? 0.3 * (1 - done) : 0));
      for (const L of lets) {
        const u = (t - L.pop - 0.07) / 0.16;
        if (u > 0 && u < 1) sparkle(p, L.cx, BASE - 7, 6 * (1 - u) * (1 - u), C[6], C[5], 0.5);
      }
      const g = (t - SHINE - 0.3) / 0.26;
      if (g > 0 && g < 1) sparkle(p, right - 2, BASE - 13, 7 * Math.sin(g * Math.PI), C[6], C[5], 0.6);
      for (const s of sats) {
        const u = (t - s.t0) / s.dur;
        if (u > 0 && u < 1) sparkle(p, s.x, s.y, s.L * Math.sin(u * Math.PI), C[7], C[5], 0.5);
      }
      lights.draw(p);
    },
  };
}
