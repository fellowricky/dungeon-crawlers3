/**
 * Side-view insect. The head points at +x, which is screen-right before a
 * billboard flip. A wing is a polygon in that plane. Its first point is the
 * hinge on the thorax. span 1 draws the wing as authored. A smaller span
 * pulls the rest of the wing toward the hinge. sweptWing rotates that
 * wing around the hinge, so a beat can clap it through a wide stroke.
 *
 * profile.wings: { pts, alpha, sweep, lag, membrane(C, x, y) }.
 * profile.body(g, C) paints the opaque head, thorax, and abdomen after the
 * wings. The outline is the darkest ramp step.
 */
import { clamp } from "../../core/index.js";

/** The wing point farthest from the hinge. */
export function wingTip(pts) {
  const [hx, hy] = pts[0];
  let best = pts[0];
  let bestD = -1;
  for (const p of pts) {
    const d = (p[0] - hx) * (p[0] - hx) + (p[1] - hy) * (p[1] - hy);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Authored wing at `span` (1 open, smaller tilted toward the body). */
export function posedWing(pts, span) {
  const s = clamp(span, 0.08, 1.25);
  const [hx, hy] = pts[0];
  const along = 0.84 + 0.16 * s;
  return pts.map(([x, y], i) => (
    i === 0 ? [x, y] : [hx + (x - hx) * along, hy + (y - hy) * s]
  ));
}

/**
 * Rotate a wing around its hinge. Positive `turn` swings a point that sits
 * above the hinge toward +x (screen-right). Painter y grows downward.
 */
export function sweptWing(pts, turn) {
  if (!turn) return pts;
  const [hx, hy] = pts[0];
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return pts.map(([x, y], i) => {
    if (i === 0) return [x, y];
    const dx = x - hx;
    const dy = y - hy;
    return [hx + dx * c - dy * s, hy + dx * s + dy * c];
  });
}

function stampWings(g, profile, C, pose) {
  const span = pose.span == null ? 1 : pose.span;
  const alphaScale = pose.alpha == null ? 1 : pose.alpha;
  const amp = pose.amp || 0;
  const phase = pose.phase || 0;
  for (const wing of profile.wings) {
    let pts = posedWing(wing.pts, span);
    if (amp && wing.sweep) {
      const turn = Math.sin((phase + (wing.lag || 0)) * Math.PI * 2) * amp * wing.sweep;
      pts = sweptWing(pts, turn);
    }
    const alpha = (wing.alpha == null ? 0.8 : wing.alpha) * alphaScale;
    g.poly(pts, (x, y) => {
      g.o.a = alpha;
      return wing.membrane ? wing.membrane(C, x, y) : C[4];
    });
    if (alphaScale > 0.7) {
      const tip = wingTip(pts);
      g.line(pts[0][0], pts[0][1], tip[0], tip[1], C[1], 1);
      g.set(Math.round(tip[0]), Math.round(tip[1]), C[6]);
    }
  }
}

/**
 * Paint one insect. `pose.crisp` is `{ span, alpha, phase, amp }`. `amp`
 * swings each wing by `wing.sweep`. `pose.ghost` is drawn first, without an
 * outline, so the stroke leaves a trail.
 */
export function paintInsect(p, g, profile, C, pose) {
  const dy = pose.dy || 0;
  if (pose.ghost) {
    g.clear();
    const ghost = pose.ghost;
    if (ghost.alpha == null) ghost.alpha = 0.4;
    stampWings(g, profile, C, ghost);
    g.draw(p, 1, 0, dy);
  }
  g.clear();
  const crisp = pose.crisp || { span: 1, alpha: 1 };
  stampWings(g, profile, C, crisp);
  profile.body(g, C);
  g.outline(() => C[0]);
  g.draw(p, 1, 0, dy);
}
