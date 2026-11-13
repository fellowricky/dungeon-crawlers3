// Moonbeam's circle on the floor, drawn straight down so it lies flat: where the shaft lands, hard-edged like a spotlight's
// pool, a flat disc of light with a brighter core and a crisp bright rim. It snaps out from the middle as the beam strikes.
// `flash` brightens it when it burns someone. Built on pixelfx's core (MIT, https://github.com/patch-gg/pixelfx).
import { fit, clamp, ease, WHITE } from "../../vendor/pixelfx/core/index.js";

const R = 62, SIZE = R * 2 + 8, D = 2, SPREAD = 0.14, DELAY = 0.18;

export const meta = {
  name: "Moonbeam pool",
  desc: "A hard-edged top-down circle of light, with a brighter core and a crisp rim, snapping out from its middle.",
  tags: ["holy", "moon", "light", "ground", "top-down", "spotlight", "loop"],
  size: [SIZE, SIZE],
  origin: [SIZE / 2, SIZE / 2],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  options: { palette: ["#141c30", "#26365a", "#3e5a88", "#6288b4", "#8cb4d4", "#c0e8ff", "#e0f4ff", "#ffffff"], flash: 0 },
};

export function create(o) {
  const C = fit(o.palette, 8), px = [];
  for (let y = -R - 1; y <= R + 1; y++) for (let x = -R - 1; x <= R + 1; x++) {
    const d = Math.hypot(x, y);
    if (d <= R + 1) px.push({ x, y, q: d / R });
  }
  let age = 0;
  return {
    update(dt) { age += dt; },
    draw(p, t, opt) {
      const flash = opt.flash || 0;
      const reach = ease.outCubic(clamp((age - DELAY) / SPREAD));
      if (reach <= 0) return;
      const lift = 0.3 * (1 - clamp((age - DELAY - SPREAD) / 0.35)) + 0.3 * flash;
      for (const { x, y, q } of px) {
        if (q > reach * 1.02) continue;
        const u = q / reach;
        if (u > 0.965) p.px(x, y, lift > 0.05 ? WHITE : C[6]);
        else p.blend(x, y, u < 0.42 ? C[5] : C[4], (u < 0.42 ? 0.34 : 0.22) + lift);
      }
    },
  };
}
