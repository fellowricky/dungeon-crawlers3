// A damage number: adapted from pixelfx's ui/damage-number (MIT, https://github.com/patch-gg/pixelfx). It punches out of a
// hit spark, white for a frame, arcs up, lands with a squash and a hop, and fades as it lifts. Added for the game: the damage
// type's icon beside it, the multiplier on the other side, and effectiveness in how it moves. A vulnerable hit is a size
// larger with more sparks and a green glow; a resisted one is dull, throws few sparks and barely hops.
import { Particles, Lights, P, Rng, fit, sparkle, seg, ease, TAU, WHITE, scale, hex } from "../../vendor/pixelfx/core/index.js";
import { spell, drawWord } from "../../vendor/pixelfx/fx/ui/_lib.js";
import { drawBadge, drawMultiplier, BADGE_W } from "./damage_badge.js";

const LAND = -8, FADE = 0.84, GREEN = hex("#4ade80");

export const meta = {
  name: "Damage pop",
  desc: "A number punches out of a hit spark with its damage type's icon, arcs up, lands with a squash and a hop, and lifts away.",
  tags: ["ui", "damage", "number", "combat", "text", "hit", "one-shot"],
  size: [168, 88],
  origin: [84, 70],
  duration: 1.05,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: ["#1a0508", "#4a0b12", "#8c1420", "#d42a2e", "#ff5a4a", "#ff9a86", "#ffd8cc", "#ffffff"], text: "27", types: [], effect: null, dir: 1, seed: 2 },
};

export function create(o) {
  const C = fit(o.palette, 8), R = new Rng(o.seed), word = spell(o.text), effect = o.effect;
  const weak = effect === "resist" || effect === "immune", strong = effect === "vuln";
  const size = strong ? 3 : 2;
  /* a resisted number is dull; IMMUNE is grey already and has to stay legible, being the whole message */
  const fill = effect === "immune" ? [C[4], C[5], C[5], C[6]] : weak ? [C[2], C[3], C[3], C[4]] : [C[3], C[3], C[4], C[5]];
  const ps = new Particles({ rng: R, sparks: [C[7], C[6], C[4], C[2]] }), lights = new Lights();
  /* the number is a little body: thrown up and out, it lands, hops once and settles. A resisted one is thrown short. */
  const n = { x: 0, y: LAND, vx: (weak ? 14 : 34) * o.dir, vy: weak ? -110 : strong ? -200 : -175, sq: 0, hops: 0 };
  const SPIKES = strong ? 13 : 9;
  const spikes = Array.from({ length: SPIKES }, (_, i) => [(i / SPIKES) * TAU + R.range(-0.2, 0.2), R.range(8, 14) * (strong ? 1.3 : 1)]);
  let t = 0, hit = false;
  return {
    update(dt) {
      t += dt;
      if (!hit) {
        hit = true;
        lights.add(0, -4, 30, strong ? GREEN : C[5], weak ? 0.3 : 0.7, 0.25);
        lights.add(0, -4, 14, WHITE, weak ? 0.25 : 0.6, 0.08);
        const sparks = weak ? 3 : strong ? 16 : 9;
        for (let i = 0; i < sparks; i++) {
          const an = R.range(-Math.PI * 0.95, -0.05) + (i % 2 ? Math.PI * 0.08 : 0), sp = R.range(90, 200);
          ps.spawn(P.SPARK, 0, -4, Math.cos(an) * sp, Math.sin(an) * sp, R.range(0.1, 0.25));
        }
      }
      if (n.hops < 2) {
        n.vy += 900 * dt;
        n.vx -= n.vx * 2 * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.y >= LAND && n.vy > 0) {
          n.y = LAND;
          n.sq = 1;
          n.hops++;
          n.vy = n.hops < 2 && !weak ? -n.vy * 0.36 : 0;
          if (weak) n.hops = 2;
          if (n.hops === 1) for (const s of [-1, 1]) ps.spawn(P.STAR, n.x + s * 14, LAND + R.range(-2, 1), s * R.range(15, 35), -R.range(5, 20), R.range(0.2, 0.35), C[6], R.range(0.5, 1.2));
        }
      }
      n.sq = Math.max(0, n.sq - dt / 0.09);
      ps.update(dt);
      lights.update(dt);
    },

    draw(p) {
      /* the hit: two frames of a spiky white-hot star, then a glint and a ring where the blow landed. A resisted blow gets only the ring. */
      if (!weak) {
        if (t < 0.07) {
          const big = t < 0.035;
          spikes.forEach(([an, L], i) => {
            const l = L * (big ? 1 : 1.3), ca = Math.cos(an), sa = Math.sin(an);
            if (big) {
              p.line(-sa, -4 + ca, ca * l * 0.7 - sa, -4 + sa * l * 0.7 + ca, C[4]);
              p.line(sa, -4 - ca, ca * l * 0.7 + sa, -4 + sa * l * 0.7 - ca, C[4]);
            }
            p.line(ca * (big ? 0 : l * 0.45), -4 + sa * (big ? 0 : l * 0.45), ca * l, -4 + sa * l, big ? WHITE : i % 2 ? C[6] : C[5]);
          });
          if (big) p.circle(0, -4, 3.2, WHITE);
        } else if (t < 0.16) sparkle(p, 0, -4, 5 * (1 - (t - 0.07) / 0.09), WHITE, C[5], 0.6);
      }
      const rk = t / 0.22;
      if (rk < 1) p.ring(0, -4, 3 + 10 * ease.outCubic(rk), Math.max(1, 2 * (1 - rk)), rk < 0.4 ? WHITE : C[5], 1.2 - rk);
      ps.draw(p);
      /* the number: punches out big and white, springs to size, squashes as it lands, then lifts and fades */
      const out = seg(t, FADE, meta.duration - 0.04);
      if (out < 1) {
        let s = size + (weak ? 0.5 : 1.4) * Math.exp(-t * 22) * Math.cos(t * 30), sx = s, sy = s;
        if (n.sq > 0) (sx = s * (1 + 0.18 * n.sq)), (sy = s * (1 - 0.2 * n.sq));
        else if (n.hops < 2 && Math.abs(n.vy) > 120) (sx = s * 0.92), (sy = s * 1.1);
        const W = word.w * sx, H = 7 * sy, x0 = n.x - W / 2, y0 = n.y - H - 6 * ease.inQuad(out), midY = y0 + H / 2;
        const flash = t < 0.035 ? 1 : t < 0.07 ? 0.4 : 0;
        const items = word.letters.filter((L) => L.g).map((L) => ({ g: L.g, x: x0 + L.x * sx, y: y0, sx, sy, flash, a: 1 - out }));
        drawWord(p, items, { fill, edge: weak ? C[5] : C[6], under: C[2], outline: C[0], shadow: scale(C[0], 0.5) });
        p.glow(n.x, midY, 18, strong ? GREEN : C[4], (weak ? 0.1 : 0.3) * (1 - out) + (t < 0.1 ? (weak ? 0.1 : 0.4) * (1 - t / 0.1) : 0));
        /* the small print rides with it, and goes with its last frames: a dither fade would muddy anything this small */
        if (out < 0.6 && t > 0.04) {
          drawBadge(p, x0 - BADGE_W / 2 - 1, midY, o.types, effect, o.typePalette);
          if (o.types && o.types[1]) drawBadge(p, x0 - BADGE_W * 1.5 - 1, midY, [o.types[1]], effect, null);
          drawMultiplier(p, x0 + W + 4, midY, effect);
        }
      }
      lights.draw(p);
    },
  };
}
