import { fit, hex, mix, clamp, wrap, lerp, seg, ease } from "../../core/index.js";
import { Grid, shift, shadow, spring } from "./_lib.js";

export const meta = {
  name: "Frog",
  desc: "A frog puffs its throat, blinks, crouches and leaps, then lands with a squash, gulps and settles.",
  tags: ["critter", "frog", "animal", "hop", "ground", "loop"],
  size: [112, 88],
  origin: [56, 80],
  duration: 2.6,
  loop: true,
  fps: 30,
  bg: "ground",
  options: {
    palette: ["#0a140c", "#163616", "#265722", "#38762a", "#5a9639", "#87ad58", "#a8b982"],
    belly: ["#575422", "#a1984c", "#bab37b"],
    seed: 1,
  },
};

const D = meta.duration, GRID = new Grid(-22, -40, 44, 44);
const T_CROUCH = 0.95, T_UP = 1.2, T_LAND = 1.62, G = 1000, HOP = (G * (T_LAND - T_UP) ** 2) / 8;
const EYE = ["#342608", "#aa7e1d", "#d6b24f"].map(hex);

// the pose at loop time t: lift off the floor, nose tilt, squash, hind legs out, throat puffed, eye shut
function pose(t) {
  let by = 0, rot = 0, sq = 0, leg = 0, throat = 0, shut = 0;
  const age = wrap(t - T_LAND, D);
  for (const [a, b] of [[0.05, 0.45], [0.5, 0.85], [1.75, 1.95]]) if (t > a && t < b) throat = Math.sin(Math.PI * ((t - a) / (b - a))) ** 0.7 * (a > 1 ? 0.6 : 1);
  if (t > 0.88 && t < 0.95) shut = 1;
  if (t >= T_CROUCH && t < T_UP) {
    const u = ease.inOutSine(seg(t, T_CROUCH, T_UP));
    sq = -0.18 * u;
    rot = -0.12 * u;
  } else if (t >= T_UP && t < T_LAND) {
    const q = (t - T_UP) / (T_LAND - T_UP);
    by = -HOP * 4 * q * (1 - q);
    rot = lerp(0.42, -0.25, q);
    sq = lerp(0.18, 0.02, Math.min(1, q * 2));
    leg = q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25;
  } else {
    sq = -0.24 * spring(age, 2.4, 6.5);
    rot = -0.08 * Math.exp(-age * 6);
  }
  return { by, rot, sq, leg, throat, shut, air: t >= T_UP && t < T_LAND };
}

function frog(g, C, Bl, Pz, t) {
  g.clear();
  const cs = Math.cos(Pz.rot), sn = Math.sin(Pz.rot), sx = 1 + Pz.sq * -0.6, sy = 1 + Pz.sq;
  // into the frog's own frame: centred on its body, turned with it, squashed with it
  const local = (x, y) => {
    const dx = x, dy = y + 7;
    return [(dx * cs + dy * sn) / sx, (-dx * sn + dy * cs) / sy - 7];
  };
  const inBody = (x, y) => ((x + 1) / 10.5) ** 2 + ((y + 7) / 6) ** 2 <= 1 || ((x - 6) / 6.2) ** 2 + ((y + 8.6) / 4.8) ** 2 <= 1;
  const inEye = (x, y) => (x - 5.5) ** 2 + (y + 13.2) ** 2 <= 3.2 ** 2;
  // the body and head: lit on top, a pale belly, dark spots on the back
  const lit = (x, y, k) => inBody(-4 + (x + 4) / k, -13 + (y + 13) / k);
  g.shade(-15, -22, 15, 1, (x, y) => {
    const [u, v] = local(x, y);
    if (!inBody(u, v) && !inEye(u, v)) return 0;
    if (inEye(u, v)) {
      const d = Math.hypot(u - 5.5, v - 13.2 * -1);
      if (Pz.shut) return v < -13.2 ? C[4] : C[3];
      if (Math.abs(v + 13) < 0.7 && Math.abs(u - 6) < 1.8) return C[0];
      if (u < 4.7 && v < -14) return EYE[2];
      return d < 2.4 ? EYE[1] : EYE[0];
    }
    if (v > -5 && u > -6) return v > -3 ? Bl[1] : Bl[2];
    for (const [px, py, r] of [[-5, -10, 1.6], [0, -11.5, 1.3], [-8, -7, 1.2], [3, -12.5, 0.9]]) if (Math.hypot(u - px, v - py) < r) return C[2];
    if (!inBody(u + 2, v + 2.4)) return C[2];
    return lit(u, v, 0.5) ? C[5] : lit(u, v, 0.8) ? C[4] : C[3];
  });
  // hind leg: a thigh folded at the rump, or kicked out straight when it leaps
  const legs = [];
  if (Pz.leg < 0.5) {
    g.ellipse(-7.5, -4.5 + (1 - sy) * 3, 5, 3.6, (nx, ny) => (nx * -0.6 + ny * -0.8 > 0.35 ? C[4] : ny > 0.4 ? C[2] : C[3]));
    legs.push([[-4, -1.5], [-9, -1], [-3, -0.5], [4, -0.5]]);
  } else {
    const ex = -8 - 10 * Pz.leg, ey = 4 + 6 * Pz.leg;
    legs.push([[-6, -5], [-10, 0], [ex, ey], [ex - 5, ey + 2]]);
  }
  for (const L of legs) {
    // a tapering tube: a thick thigh, a thinner shin, a long foot; lit along its top
    g.tube(L, (u) => lerp(2, 0.7, u), (u, v) => (v > 0.55 ? C[2] : u > 0.66 ? C[3] : C[4]));
    // webbed toes spread at the end of the foot
    const [fx, fy] = L[L.length - 1], [px, py] = L[L.length - 2], dx = fx - px, dy = fy - py, l = Math.hypot(dx, dy) || 1;
    for (const k of [-1, 0, 1]) g.line(fx, fy, fx + (dx / l) * 2 - (dy / l) * k * 1.6, fy + (dy / l) * 2 + (dx / l) * k * 1.6, C[3]);
  }
  // glint in the eye, the mouth line
  if (!Pz.shut) {
    const [gx, gy] = [4.6, -14.4], X = gx * cs - (gy + 7) * sn * 1, Y = gx * sn + (gy + 7) * cs - 7;
    g.set(X, Y, C[6]);
  }
  for (let u = 3; u <= 11; u++) {
    const v = -7.8 + (u - 3) * 0.05, X = (u * sx) * cs - ((v + 7) * sy) * sn, Y = (u * sx) * sn + ((v + 7) * sy) * cs - 7;
    g.set(X, Y, C[1]);
  }
  // the front leg props it up, or tucks in when it leaps
  const fl = Pz.air ? [[7, -4], [9, -1]] : [[7, -4], [8, -0.5]];
  g.line(fl[0][0], fl[0][1], fl[1][0], fl[1][1], C[3]);
  g.set(fl[1][0] + 1, fl[1][1], C[3]); g.set(fl[1][0] - 1, fl[1][1], C[3]);
  // the throat sac swells into a glossy bubble under the chin
  if (Pz.throat > 0.05) {
    const r = 0.8 + 2.8 * Pz.throat, cx = 7, cy = -5.2 + r * 0.25;
    g.ellipse(cx, cy, r * 1.1, r, (nx, ny) => (nx * -0.6 + ny * -0.8 > 0.55 ? Bl[2] : ny > 0.5 ? Bl[1] : mix(Bl[2], C[5], 0.4)), 0.9);
    g.set(cx - r * 0.4, cy - r * 0.45, C[6]);
  }
  g.outline(C[0]);
}

export function draw(p, time, o) {
  const t = shift(time, D, o.seed), C = fit(o.palette, 7), Bl = fit(o.belly, 3), Pz = pose(t);
  const g = GRID;
  frog(g, C, Bl, Pz, t);
  g.draw(p, 1, 0, Math.round(Pz.by));
}

export function drawBack(p, time, o) {
  const t = shift(time, D, o.seed), C = fit(o.palette, 7), Pz = pose(t), hgt = clamp(-Pz.by / HOP);
  shadow(p, 0, -0.2, 13 * (1 - 0.35 * hgt), 1.6, C[0], 0.6 - 0.3 * hgt);
}
