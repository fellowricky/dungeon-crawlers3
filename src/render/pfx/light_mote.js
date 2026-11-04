// The Light cantrip's mote, drawn with the pixelfx core: a small steady point of white light with a soft glow, a slow
// bob and a rare twinkle. Deliberately plain beside the Dancing Lights wisps, which are little gold creatures: this
// is a lamp, and it sits at the hero's shoulder for the whole floor, so nothing in it should draw the eye.
import { WHITE, TAU } from "../../vendor/pixelfx/core/index.js";

const C = ["#3a4660", "#7a8aa8", "#b8c8e0", "#e6eeff"];

export const meta = {
  name: "Light mote",
  desc: "A small steady point of white light, bobbing gently.",
  tags: ["light", "mote", "loop"],
  size: [40, 40],
  origin: [20, 20],
  duration: 3600,
  loop: true,
  fps: 20,
  options: { seed: 0 },
};

export function draw(p, t, o) {
  const y = Math.sin(t * 1.6 + o.seed) * 1.5, breathe = 0.5 + 0.5 * Math.sin(t * 2.3 + o.seed);
  p.glow(0, y, 11, C[2], 0.2 + 0.08 * breathe);
  p.glow(0, y, 5, C[3], 0.45);
  p.circle(0, y, 2, C[3]);
  p.circle(0, y, 1.2, WHITE);
  // a rare cross of a twinkle, about a quarter second every three
  const k = ((t + o.seed) % 3) / 0.25;
  if (k < 1) {
    const l = 2 + 3 * Math.sin(k * TAU * 0.5);
    p.line(-l, y, l, y, C[3]);
    p.line(0, y - l, 0, y + l, C[3]);
  }
}
