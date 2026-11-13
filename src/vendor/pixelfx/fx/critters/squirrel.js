/**
 * A snow squirrel, side view, head to the right. It sits with the tail curled
 * up, and stretches out when it dashes. The tail keeps moving either way.
 * The coat follows the seed: frost gray, or a dusk brown.
 */
import { fit, wrap } from "../../core/index.js";
import { Grid } from "./_lib.js";

export const meta = {
  name: "Squirrel",
  desc: "A squirrel sits with its tail curled, then dashes low across the snow. The tail keeps flicking. Each seed wears frost gray or dusk brown.",
  tags: ["critter", "squirrel", "mammal", "ground", "snow", "loop"],
  size: [64, 48],
  origin: [34, 36],
  duration: 1.1,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { seed: 1, run: 0, flick: 0 },
};

const GRID = new Grid(-28, -22, 56, 40);
const COATS = [
  ["#14181c", "#2a323c", "#4a5664", "#7a8896", "#b4c0ca", "#e4eaee", "#1a1e24"],
  ["#161412", "#322820", "#5a4638", "#8a7060", "#c4b0a0", "#e8dcc8", "#1c1612"],
];

function coatOf(seed) {
  const n = Math.abs((seed | 0) - 1);
  return COATS[n % COATS.length];
}

function tailFlick(t) {
  return Math.sin(wrap(t, 1.1) / 1.1 * Math.PI * 2) * 1.4;
}

function squirrel(g, C, o) {
  g.clear();
  const run = o.run >= 0.5;
  const flick = tailFlick(o.flick || 0);
  const bob = run ? Math.sin((o.flick || 0) * 18) * 0.45 : 0;
  const stride = run ? Math.sin((o.flick || 0) * 16) * 2.1 : 0;

  if (run) {
    g.tube(
      [[-2, -0.2 + bob], [-8, -1.2 + flick * 0.35], [-14, -0.2 + flick], [-18, 1.2 + flick * 0.6]],
      (u) => 1.7 * (1 - u * 0.35),
      (u, d) => (d > 0.55 ? C[2] : u > 0.62 ? C[1] : C[4]),
    );
    g.ellipse(2.2, 0.35 + bob, 5.6, 2.05, (nx, ny) => (ny > 0.25 ? C[5] : ny < -0.2 ? C[4] : C[3]));
    g.line(4.2, 1.6 + bob, 6.4 + stride, 4.3, C[1]);
    g.line(0.4, 1.7 + bob, -1.2 - stride, 4.3, C[1]);
    g.line(2.4, 1.7 + bob, 3.2 + stride * 0.6, 4.2, C[2]);
    g.line(-1.2, 1.6 + bob, -2.4 - stride * 0.6, 4.2, C[2]);
    g.ellipse(8.2, -0.55 + bob, 2.15, 1.7, (nx, ny) => (ny > 0.15 ? C[5] : C[4]));
    g.ellipse(7.6, -2.15 + bob, 0.7, 1.15, () => C[3]);
    g.ellipse(8.6, -2.05 + bob, 0.55, 0.95, () => C[4]);
    g.ellipse(9.35, -0.85 + bob, 0.62, 0.5, () => C[6]);
    g.set(10, Math.round(-0.95 + bob), C[5]);
  } else {
    g.tube(
      [[-1.2, 0.2], [-3.2, -3.2 + flick * 0.25], [-2.2, -7.4 + flick], [0.6, -9.2 + flick * 0.8]],
      (u) => 1.85 * (0.7 + u * 0.45),
      (u, d) => (d > 0.5 ? C[2] : u > 0.55 ? C[1] : C[4]),
    );
    g.ellipse(1.4, 0.8, 3.3, 2.7, (nx, ny) => (ny > 0.2 ? C[5] : C[3]));
    g.ellipse(4.6, -0.15, 2.2, 1.75, (nx, ny) => (ny > 0.2 ? C[5] : C[4]));
    g.ellipse(3.7, -1.9, 0.75, 1.2, () => C[3]);
    g.ellipse(5.1, -1.75, 0.6, 1.05, () => C[4]);
    g.line(3.2, 2.6, 2.4, 4.2, C[2]);
    g.line(4.4, 2.5, 5.2, 4.2, C[1]);
    g.ellipse(5.85, -0.45, 0.62, 0.5, () => C[6]);
    g.set(6, -1, C[5]);
  }
  g.outline(() => C[0]);
}

export function draw(p, _time, o) {
  const C = fit(o.palette || coatOf(o.seed), 7);
  squirrel(GRID, C, o || {});
  GRID.draw(p, 1, 0, 0);
}
