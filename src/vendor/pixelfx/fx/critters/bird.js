/**
 * Forest songbird, from the pixelfx bird. In the air it keeps that wing
 * cycle. Perched, the wings stay folded and the body only breathes. On the
 * ground the wings stay folded and the beak dips. The coat follows the seed,
 * so the flock is not one bird copied.
 */
import { fit, hex, clamp, wrap, lerp, smooth, ease, TAU } from "../../core/index.js";
import { Grid, shift } from "./_lib.js";

const COATS = [
  {
    name: "robin",
    palette: ["#1c120c", "#3a2414", "#5c3a20", "#7c5430", "#a07848", "#c8a478", "#ead4b0"],
    breast: ["#4a160e", "#8a3014", "#c45020", "#e88848"],
  },
  {
    name: "sparrow",
    palette: ["#16140e", "#2c2820", "#484238", "#6a6456", "#8e8878", "#b4ae9c", "#ddd6c4"],
    breast: ["#3a3424", "#6a5c40", "#a09068", "#d4c49c"],
  },
  {
    name: "finch",
    palette: ["#10160c", "#243018", "#3c4c28", "#567038", "#789450", "#a4bc78", "#d4e4b0"],
    breast: ["#3a3010", "#6a5418", "#a88830", "#e0c868"],
  },
  {
    name: "blackbird",
    palette: ["#0c0c0e", "#1a1a1e", "#2a2a30", "#424248", "#64646c", "#909098", "#c8c8cc"],
    breast: ["#121214", "#26262c", "#3a3a42", "#5c5c64"],
  },
  {
    name: "jay",
    palette: ["#0e1420", "#1a2848", "#284878", "#3868a4", "#5a90cc", "#98c0e8", "#e4f2ff"],
    breast: ["#4a2430", "#8a4860", "#c07890", "#f0b0b8"],
  },
];

export const meta = {
  name: "Bird",
  desc: "A songbird. In the air, bursts of wingbeats and a glide. Perched, the wings stay folded and it breathes. On the ground it pecks. Each seed wears a different coat.",
  tags: ["critter", "bird", "flying", "animal", "loop"],
  size: [112, 80],
  origin: [56, 40],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "sky",
  options: {
    palette: COATS[0].palette,
    breast: COATS[0].breast,
    seed: 1,
    /* 1 sits with the wings folded. 0 flies. Absent means flying, so a raw preview still flaps. */
    perch: 0,
    /* 1 stands with the wings folded and dips the beak. Wins over perch. */
    peck: 0,
  },
};

/** Peck loop, seconds. Two dips, then a short pause. */
export const PECK_LOOP = 0.84;
/** Time in that loop when the beak is lowest. */
export const PECK_NOD_AT = 0.18;

function peckDip(t) {
  const u = wrap(t, PECK_LOOP);
  const pulse = (a, b) => {
    if (u < a || u > b) return 0;
    return Math.sin(((u - a) / (b - a)) * Math.PI);
  };
  return Math.max(pulse(0.08, 0.28), pulse(0.36, 0.56));
}

const D = meta.duration, GRID = new Grid(-26, -26, 52, 46), BEAK = hex("#f0b030"), BEAKD = hex("#a86a18");
const POSE = {
  up: [[0, 0], [-1, -8], [-5, -15], [-8, -13.5], [-10.5, -10.5], [-11, -7], [-9, -3], [-6, 1]],
  mid: [[0, 0], [-3, -2.5], [-9, -2.5], [-10.5, -0.5], [-10, 1.2], [-8.5, 2], [-7, 2.2], [-5, 2]],
  down: [[0, 0], [-1, 6], [-3.5, 12], [-6, 11], [-7.5, 8.5], [-8, 6], [-7, 3], [-5, 2]],
  /* folded back along the body, the perch */
  fold: [[0, 0], [-2, -1], [-6, -1.5], [-8, -0.5], [-8, 1], [-7, 2], [-5.5, 2.4], [-4, 2.2]],
  glide: [[0, 0], [-2, -5], [-7, -10], [-10, -9], [-12, -6.5], [-11.5, -3.5], [-9, -1], [-6, 1]],
};
const mixPose = (a, b, u) => a.map(([x, y], i) => [lerp(x, b[i][0], u), lerp(y, b[i][1], u)]);
const FLAPS = 4, GLIDE = 1.5;
function wing(t) {
  t = wrap(t, D);
  if (t < GLIDE) {
    const u = ((t / GLIDE) * FLAPS) % 1;
    if (u < 0.4) {
      const k = ease.inOutSine(u / 0.4);
      return { pts: k < 0.5 ? mixPose(POSE.up, POSE.mid, k * 2) : mixPose(POSE.mid, POSE.down, k * 2 - 1), down: true, u };
    }
    const k = ease.inOutSine((u - 0.4) / 0.6);
    return { pts: k < 0.5 ? mixPose(POSE.down, POSE.fold, k * 2) : mixPose(POSE.fold, POSE.up, k * 2 - 1), down: false, u };
  }
  const g = (t - GLIDE) / (D - GLIDE), into = smooth(0, 0.15, g), out = smooth(0.85, 1, g);
  return { pts: mixPose(mixPose(POSE.up, POSE.glide, into), POSE.up, out), down: false, u: 0 };
}
function lift(t) {
  t = wrap(t, D);
  let y = 0;
  for (let k = 0; k < 6; k++) if (wing(t - k * 0.02).down) y -= 0.45;
  if (t >= GLIDE) y += 2.2 * Math.sin(Math.PI * ((t - GLIDE) / (D - GLIDE)));
  return y + 1.2;
}

export function coatOf(seed) {
  const i = Math.abs(((seed ?? 1) | 0) - 1) % COATS.length;
  return COATS[i];
}

const SH = [1, -2];
const wingPts = (w, far) => w.pts.map(([x, y]) => [SH[0] + x - (far ? 1 : 0), SH[1] + y * (far ? 0.85 : 1) - (far ? 1 : 0)]);

function bird(g, C, Br, t, w, idle, nod) {
  g.clear();
  g.poly(wingPts(w, true), C[1]);
  const tf = idle ? 0.1 + 0.06 * Math.sin(t * 2.4) : 0.25 + 0.35 * Math.sin((t / D) * TAU * 2);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i - 1) * tf * 0.5 + 0.1, L = (idle ? 7 : 9) - Math.abs(i - 1);
    g.poly([[-7, -2.4], [-7 + Math.cos(a) * L, -1 + Math.sin(a) * L - 1.2], [-7 + Math.cos(a) * L, -1 + Math.sin(a) * L + 1.2], [-7, 0.6]], i === 0 ? C[3] : C[2]);
  }
  const inBody = (x, y) => ((x + 1) / 8.5) ** 2 + (y / 5.2) ** 2 <= 1 || (x - 6.5) ** 2 + (y + 3) ** 2 <= 4.6 ** 2;
  g.shade(-10, -9, 12, 6, (x, y) => {
    if (!inBody(x, y)) return 0;
    const top = !inBody(x, y - 2.2), under = !inBody(x + 0.5, y + 1.6);
    if (y > -0.5 && x > -2.5) return under ? Br[1] : x > 3 && y < 2 ? Br[3] : Br[2];
    if (y > 1.5) return under ? C[4] : C[5];
    return top ? (x > 2 ? C[5] : C[4]) : y < -3.5 && x > 3 ? C[4] : C[3];
  });
  /* nod 0 is the level beak. nod 2 points it at the ground in front of the toes. */
  const k = nod > 0 ? nod / 2 : 0;
  const tipX = 14.5 + (13 - 14.5) * k;
  const tipY = -3 + (3 - (-3)) * k;
  g.poly(
    [[10.5, -4.5 + k], [tipX, tipY], [10.5, -2 + k * 2]],
    (x, y) => (y < (k > 0 ? tipY + 1 : -3) ? BEAK : BEAKD),
  );
  const eyeY = -4 + (nod || 0);
  g.set(8, eyeY, C[0]); g.set(9, eyeY, C[0]);
  g.line(5, -7, 9, -6.5, C[2]);
  const wp = wingPts(w, false);
  const edge = (x, y) => {
    let m = Infinity;
    for (let i = 1; i < 3; i++) {
      const [ax, ay] = wp[i - 1], [bx, by] = wp[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, u = clamp(((x - ax) * dx + (y - ay) * dy) / L2);
      m = Math.min(m, Math.hypot(ax + dx * u - x, ay + dy * u - y));
    }
    return m;
  };
  g.poly(wp, (x, y) => {
    const d = edge(x, y);
    return d < 1.2 ? C[5] : d < 3 ? C[4] : C[3];
  });
  for (let i = 3; i < 7; i++) g.line(wp[1][0], wp[1][1], lerp(wp[1][0], wp[i][0], 0.92), lerp(wp[1][1], wp[i][1], 0.92), C[2]);
  /* toes on the branch. The pivot is the body, so these sit a few pixels below it. */
  if (idle) {
    g.set(1, 5, C[2], 1, 1); g.set(2, 6, C[1], 1, 1);
    g.set(4, 5, C[2], 1, 1); g.set(5, 6, C[1], 1, 1);
  }
  g.outline(C[0]);
}

export function draw(p, time, o) {
  const pecking = !!o.peck;
  const idle = !!o.perch || pecking;
  const t = shift(time, D, o.seed);
  const coat = coatOf(o.seed);
  const C = fit(o.vary === false ? o.palette : coat.palette, 7);
  const Br = fit(o.vary === false ? o.breast : coat.breast, 4);
  const w = idle ? { pts: POSE.fold, down: false, u: 0 } : wing(t);
  const y = pecking ? 0 : idle ? Math.sin(t * 2.1) * 0.45 : lift(t);
  const g = GRID;
  if (!idle && w.down && w.u > 0.1) {
    const s = t - 0.05, ws = wing(s);
    g.clear();
    g.poly(wingPts(ws, false), C[6]);
    g.a.fill(0.42);
    g.draw(p, 1, 0, Math.round(lift(s)));
  }
  bird(g, C, Br, t, w, idle, pecking ? Math.round(peckDip(t) * 2) : 0);
  g.draw(p, 1, 0, Math.round(y));
  if (!idle) {
    const fa = wrap(t - 0.45, D);
    if (fa < 1.8) {
      const fx = -6 - 14 * fa - 3 * Math.sin(fa * 5), fy = 4 + 9 * fa + 1.5 * Math.cos(fa * 5) * fa, rock = Math.sin(fa * 5) * 0.8;
      const a = Math.min(1, (1.8 - fa) * 2);
      for (let i = -2; i <= 2; i++) p.dot(fx + i * Math.cos(rock), fy + i * Math.sin(rock) * 0.8, i < 0 ? C[5] : C[4], a);
      p.dot(fx + 2.6 * Math.cos(rock), fy + 2.6 * Math.sin(rock) * 0.8, C[3], a);
    }
  }
}
