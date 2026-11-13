/**
 * Boneyard bat, from the pixelfx bat. The glowing eyes, the glint, and the
 * red trail they left are left out. In the air it flaps in place. Roosting,
 * it hangs from the branch with the wings folded.
 */
import { fit, mix, wrap, lerp } from "../../core/index.js";
import { Grid, shift } from "./_lib.js";

export const meta = {
  name: "Bat",
  desc: "A bat flaps in place. Roosting, it hangs upside down with the wings folded. The eyes are dark: no glow, no glint.",
  tags: ["critter", "bat", "night", "flying", "loop"],
  size: [112, 80],
  origin: [56, 40],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "sky",
  options: {
    palette: ["#0c0912", "#1f1629", "#382645", "#5b3f66", "#866089", "#b88fb0", "#e8cfe0"],
    seed: 1,
    /* 1 hangs folded. 0 flies. Absent means flying, so a raw preview still flaps. */
    roost: 0,
  },
};

const D = meta.duration, FLAPS = 6, GRID = new Grid(-24, -22, 48, 44);
const FRAMES = [
  { arm: -58, al: 8, f: [-112, -76, -38], fl: [9, 11, 9], lift: 1 },
  { arm: -18, al: 9, f: [-40, -12, 16], fl: [10, 11, 9], lift: 0 },
  { arm: 28, al: 8, f: [50, 72, 94], fl: [9, 10, 8], lift: -2 },
  { arm: -42, al: 6, f: [-66, -38, -10], fl: [7, 8, 6], lift: -1 },
];
const rad = (d) => (d * Math.PI) / 180;
const frameAt = (t) => Math.floor(wrap((t / D) * FLAPS, 1) * 4) % 4;

function wingPts(F, s) {
  const sh = [s * 2.5, -2], ar = rad(F.arm), wr = [sh[0] + s * Math.cos(ar) * F.al, sh[1] + Math.sin(ar) * F.al];
  const tips = F.f.map((d, i) => [wr[0] + s * Math.cos(rad(d)) * F.fl[i], wr[1] + Math.sin(rad(d)) * F.fl[i]]);
  const pull = (a, b, k) => [lerp((a[0] + b[0]) / 2, wr[0], k), lerp((a[1] + b[1]) / 2, wr[1], k)];
  const hip = [s * 2, 3.5];
  return { sh, wr, tips, hip, poly: [sh, wr, tips[0], pull(tips[0], tips[1], 0.22), tips[1], pull(tips[1], tips[2], 0.22), tips[2], pull(tips[2], hip, 0.38), hip] };
}

function bat(g, C, F) {
  g.clear();
  for (const s of [-1, 1]) {
    const w = wingPts(F, s);
    const lead = (x, y) => {
      const [ax, ay] = w.wr, [bx, by] = w.tips[0], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      return Math.abs(((x - ax) * dy - (y - ay) * dx) / L);
    };
    g.poly(w.poly, (x, y) => {
      const near = Math.hypot(x - w.sh[0], y - w.sh[1]);
      if (lead(x, y) < 1.2 && F.arm < 20) return C[3];
      return near < 4.5 ? C[1] : C[2];
    });
    g.line(w.sh[0], w.sh[1], w.wr[0], w.wr[1], C[4]);
    for (const tip of w.tips) g.line(w.wr[0], w.wr[1], tip[0], tip[1], (u) => (u < 0.6 ? C[4] : C[3]));
    g.set(w.wr[0], w.wr[1] - 1, C[5]);
  }
  g.ellipse(0, 0.5, 3.8, 4.8, (nx, ny) => {
    return nx * -0.6 + ny * -0.8 > 0.45 ? C[4] : nx * 0.6 + ny * 0.8 > 0.55 ? C[2] : ny > 0.1 && Math.abs(nx) < 0.5 ? C[4] : C[3];
  });
  for (const s of [-1, 1]) {
    g.poly([[s * 0.6, -3.5], [s * 3.6, -9.5], [s * 3.8, -3]], s < 0 ? C[4] : C[3]);
    g.line(s * 2.6, -4, s * 3.2, -7.5, C[5]);
  }
  /* Dark eyes. The bright ramp and the glint stay out. */
  g.set(-2, -1, C[1]); g.set(1, -1, C[1]);
  g.set(-1, 0, C[1]); g.set(0, 0, C[1]);
  g.set(-1, 1, C[5]); g.set(0, 1, C[5]);
  g.set(-2, 5, C[3]); g.set(1, 5, C[3]);
  g.outline(C[0]);
}

/* Wide toes on the branch, a short folded cloak, then the face, then the ears. */
function hang(g, C) {
  g.clear();
  g.set(-2, 1, C[2]); g.set(-1, 1, C[1]); g.set(0, 1, C[3]); g.set(1, 1, C[1]); g.set(2, 1, C[2]);
  g.set(-3, 2, C[2]); g.set(-2, 2, C[1]); g.set(-1, 2, C[3]); g.set(0, 2, C[4]); g.set(1, 2, C[3]); g.set(2, 2, C[1]); g.set(3, 2, C[2]);
  for (let y = 3; y <= 7; y++) for (let x = -2; x <= 2; x++) g.set(x, y, C[4]);
  g.set(-3, 4, C[3]); g.set(3, 4, C[3]);
  g.set(-3, 5, C[3]); g.set(3, 5, C[3]);
  g.set(-2, 8, C[3]); g.set(2, 8, C[3]);
  g.set(-3, 9, C[3]); g.set(3, 9, C[3]);
  g.set(-3, 10, C[4]); g.set(3, 10, C[4]);
  g.set(-4, 11, C[4]); g.set(4, 11, C[4]);
  g.outline(C[0]);
  for (const x of [-4, -3, -2, 2, 3, 4]) g.set(x, -2, C[6]);
  g.set(-3, -1, C[5]); g.set(3, -1, C[5]);
  g.set(-2, 0, C[4]); g.set(2, 0, C[4]);
  g.set(-1, 4, C[0]); g.set(-1, 5, C[0]);
  g.set(1, 4, C[0]); g.set(1, 5, C[0]);
  g.set(0, 6, C[6]);
}

export function draw(p, time, o) {
  const roost = !!o.roost;
  const t = shift(time, D, o.seed), C = fit(o.palette, 7);
  const g = GRID;
  if (roost) {
    hang(g, C);
    g.draw(p, 1, Math.sin(t * 1.3) * 0.7, 0);
    return;
  }
  const fi = frameAt(t), F = FRAMES[fi];
  if (fi === 2) {
    bat(g, C, FRAMES[1]);
    g.recolor((x, y, c) => mix(c, C[4], 0.35));
    g.a.fill(0.35);
    g.draw(p, 1, 0, F.lift - FRAMES[1].lift);
  }
  bat(g, C, F);
  g.draw(p, 1, 0, F.lift);
}
