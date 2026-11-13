/**
 * Moor dragonfly, side view, head to the right. Four narrow wings flap through
 * a wide stroke, then a glide holds them open. The coat follows
 * the seed. No dust and no glow. The eye is a dark bead.
 */
import { fit, wrap } from "../../core/index.js";
import { Grid, shift } from "./_lib.js";
import { paintInsect } from "./insect.js";

const COATS = [
  {
    name: "olive",
    palette: ["#12160e", "#2a3820", "#445632", "#627848", "#a3b484", "#d7e2bc", "#1a160e"],
  },
  {
    name: "steel",
    palette: ["#101418", "#243038", "#3a4c58", "#5a7280", "#a8bcc2", "#dce8ea", "#14181c"],
  },
  {
    name: "russet",
    palette: ["#160e0c", "#3a2418", "#5c3c28", "#7c5840", "#b8a078", "#e4d4b0", "#1c1410"],
  },
];

export const meta = {
  name: "Dragonfly",
  desc: "A dragonfly flaps its four wings through a wide stroke, then holds them open to glide. Each seed wears olive, steel, or russet. The eye stays dark.",
  tags: ["critter", "dragonfly", "insect", "flying", "animal", "loop"],
  size: [64, 56],
  origin: [34, 28],
  duration: 0.72,
  loop: true,
  fps: 30,
  bg: "sky",
  options: { seed: 1, beat: 1 },
};

const D = meta.duration;
/** One flap, open to clapped and back. It divides the loop, so the seam meets. */
export const BEAT = 0.36;
/** How far the wings swing, in radians. Upper and lower pairs sweep opposite ways. */
const FLAP = 1.35;
const GRID = new Grid(-30, -26, 60, 52);

/* Hinge first. The wings stand up and down off the thorax. The abdomen
   reaches past them, so the tail is not buried in the hindwing. */
const FORE_UP = [[2.2, -1.2], [4, -5], [5, -11], [4.2, -16], [2.4, -16.2], [2.6, -10], [2.2, -4]];
const HIND_UP = [[0.2, -1.2], [-1.2, -6], [-2.4, -12], [-4.2, -15], [-5.6, -13.5], [-3.2, -8], [-1, -3]];
const FORE_DOWN = [[2.2, 1.2], [3.6, 6], [4.4, 12], [3.2, 16], [1.6, 15.4], [2.2, 9], [2, 4]];
const HIND_DOWN = [[0.2, 1.2], [-1.4, 6], [-3, 12], [-5.2, 15], [-6.4, 13], [-3.4, 8], [-1, 3]];

function body(g, C) {
  g.tube(
    [[1.2, 0.1], [-4, 0.35], [-10, 0.45], [-16, 0.2], [-23, -0.1]],
    (u) => 1.55 * (1 - u * 0.78),
    (u, d) => {
      if (d > 0.62) return C[1];
      return Math.floor(u * 9) % 2 ? C[2] : C[3];
    },
  );
  g.ellipse(3.5, -0.1, 2.5, 1.8, (nx, ny) => (ny < 0 ? C[3] : C[2]));
  g.ellipse(6.6, -0.35, 2.05, 1.75, (nx, ny) => (nx > 0.15 ? C[2] : C[1]));
  g.ellipse(7.7, -1.05, 1.15, 1.05, (nx, ny) => (nx > 0.2 && ny < -0.15 ? C[3] : C[0]));
  g.line(8.5, -1.2, 11.2, -2.4, C[1]);
  g.line(2.4, 1.3, 1.2, 3.4, C[1]);
  g.line(3.6, 1.4, 3.8, 3.5, C[1]);
  g.line(1.2, 1.3, 0.2, 3.2, C[1]);
}

const PROFILE = {
  wings: [
    { pts: HIND_DOWN, alpha: 0.66, sweep: -0.92, lag: 0.06 },
    { pts: FORE_DOWN, alpha: 0.74, sweep: -1 },
    { pts: HIND_UP, alpha: 0.78, sweep: 0.92, lag: 0.06 },
    { pts: FORE_UP, alpha: 0.86, sweep: 1 },
  ],
  body,
};

function coatOf(seed) {
  const n = Math.abs((seed | 0) - 1);
  return COATS[n % COATS.length];
}

function buzz(t) {
  const ph = wrap(t, BEAT) / BEAT;
  return {
    ghost: { phase: ph - 0.05, amp: FLAP, alpha: 0.35 },
    crisp: { phase: ph, amp: FLAP, alpha: 1 },
  };
}

export function draw(p, time, o) {
  const t = shift(time, D, o.seed);
  const C = fit(o.palette || coatOf(o.seed).palette, 7);
  const resting = o.rest >= 0.5;
  const beating = !resting && (o.beat == null || o.beat >= 0.5);
  for (const wing of PROFILE.wings) wing.membrane = () => C[4];
  const pose = resting
    ? { crisp: { phase: 0.75, amp: FLAP, alpha: 1 } }
    : (beating ? buzz(t) : { crisp: { span: 1, alpha: 1 } });
  paintInsect(p, GRID, PROFILE, C, pose);
}
