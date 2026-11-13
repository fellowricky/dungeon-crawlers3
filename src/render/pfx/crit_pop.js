// A critical hit's number: pixelfx's ui/crit-number (MIT, https://github.com/patch-gg/pixelfx) as authored, whole, with the
// damage type's icon and the multiplier added over it. It holds still while it plays, so they can sit beside the number.
// It's played at half size (CRIT_SCALE in pixelfx_live.js), making its digits the size of an ordinary number's, so the icon and
// multiplier are drawn double here to come out the same size as theirs too.
import * as critNumber from "../../vendor/pixelfx/fx/ui/crit-number.js";
import { spell } from "../../vendor/pixelfx/fx/ui/_lib.js";
import { drawBadge, drawMultiplier } from "./damage_badge.js";

export const meta = {
  ...critNumber.meta,
  name: "Crit pop",
  size: [248, 120],    // wider than authored: a three-digit crit's icon and multiplier stick out past the burst
  origin: [124, 60],
  options: { ...critNumber.meta.options, types: [], effect: null },
};

const NUMBER_SCALE = 4, NUMBER_MID_Y = 5, GONE = 1.06, AFTER_SLAM = 0.08, BADGE_SCALE = 2;

export function create(o) {
  const base = critNumber.create(o), width = spell(o.text).w * NUMBER_SCALE;
  let t = 0;
  return {
    update(dt, opts) { t += dt; base.update(dt, opts); },
    drawBack: base.drawBack ? (p, tt, opts) => base.drawBack(p, tt, opts) : undefined,
    draw(p, tt, opts) {
      base.draw(p, tt, opts);
      if (t < AFTER_SLAM || t >= GONE) return;
      drawBadge(p, width / 2 + 20, NUMBER_MID_Y, o.types, o.effect, o.typePalette, BADGE_SCALE);
      drawMultiplier(p, -width / 2 - (o.effect === "resist" ? 52 : 36), NUMBER_MID_Y, o.effect, 1, BADGE_SCALE);
    },
  };
}
