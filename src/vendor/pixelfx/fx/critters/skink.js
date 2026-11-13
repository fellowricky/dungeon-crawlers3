/**
 * A small side-view skink, head to the right. Ash wears a dull rust stripe.
 * Ruin wears sandstone with a pale mark on the shoulder. It basks flat, blinks,
 * and turns its head. The legs only scuttle while it is crossing.
 */
import { fit, wrap } from "../../core/index.js";
import { Grid } from "./_lib.js";

export const meta = {
  name: "Skink",
  desc: "A skink basks on the stone, blinks, and turns its head. The legs scuttle only while it crosses to a new patch. Ash wears a rust stripe. Ruin wears a pale shoulder mark.",
  tags: ["critter", "skink", "lizard", "reptile", "ground", "loop"],
  size: [64, 40],
  origin: [30, 30],
  duration: 1.2,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { seed: 1, coat: "ash", blink: 0, scuttle: 0, step: 0 },
};

const GRID = new Grid(-26, -14, 52, 28);
const COATS = {
  ash: ["#120e0c", "#241c18", "#3a2e28", "#4e3c32", "#6a5040", "#8a5a38", "#1a1410"],
  ruin: ["#161410", "#2c2822", "#4a4338", "#6a5e50", "#8a7c68", "#c4b498", "#1c1814"],
};

function coatOf(name) {
  return COATS[name] || COATS.ash;
}

function skink(g, C, o) {
  g.clear();
  const run = o.scuttle >= 0.5;
  const step = o.step || 0;
  const bob = run ? Math.sin(step * 16) * 0.55 : 0;
  const look = run ? 0 : Math.sin((o.blink || 0) * 0.85) * 1.1;
  const stride = run ? Math.sin(step * 14) * 1.6 : 0;
  const hy = -2.4 + bob * 0.4 + look * 0.15;

  g.tube(
    [[-1.5, 0.6 + bob], [-7, 1.1 + bob], [-13, 1.8 + bob * 0.4], [-19, 2.6]],
    (u) => 1.15 * (1 - u * 0.72),
    (u) => (u > 0.72 ? C[1] : C[2]),
  );
  g.ellipse(1.2, 0.55 + bob, 5.4, 2.15, (nx, ny) => {
    if (ny > 0.35) return C[2];
    if (ny < -0.25) return C[4];
    return C[3];
  });
  if ((o.coat || "ash") === "ruin") {
    g.ellipse(3.4, -0.7 + bob, 1.15, 0.7, () => C[5]);
  } else {
    g.line(-3.5, -1.15 + bob, 5.2, -1.55 + bob, C[5]);
    g.line(-2.2, -0.7 + bob, 4.2, -1.05 + bob, C[4]);
  }

  const legs = [
    [3.1, 1.7, 1, 1],
    [-0.6, 1.8, -1, 1],
    [1.4, 1.8, 1, -1],
    [-2.4, 1.7, -1, -1],
  ];
  for (const [x, y, side, phase] of legs) {
    const foot = x + stride * side * phase;
    g.line(x, y + bob, foot, 4.15, C[1]);
    g.set(Math.round(foot), 4, C[0]);
  }

  g.ellipse(7.4, hy, 2.35, 1.65, (nx, ny) => (ny > 0.2 ? C[2] : C[3]));
  g.line(9.2, hy + 0.35, 10.4, hy + 0.15, C[1]);
  const shut = wrap(o.blink || 0, 4.4) > 4.05;
  if (shut) g.line(8.3, hy - 0.35, 9.15, hy - 0.2, C[0]);
  else {
    g.ellipse(8.55, hy - 0.45, 0.72, 0.58, () => C[6]);
    g.set(9, Math.round(hy - 0.7), C[3]);
  }
  g.outline(() => C[0]);
}

export function draw(p, _time, o) {
  const C = fit(coatOf(o.coat), 7);
  skink(GRID, C, o || {});
  GRID.draw(p, 1, 0, 0);
}
