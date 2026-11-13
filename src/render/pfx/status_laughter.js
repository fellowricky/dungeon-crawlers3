// Tasha's Hideous Laughter: jittery "HA!"s break out round the victim's head one after another,
// rise and fade. Lettered like pixelfx's ui/level-up, with its word drawing (ui/_lib.js).
import { PAL, fit, clamp, rand, WHITE } from "../../vendor/pixelfx/core/index.js";
import { spell, drawWord } from "../../vendor/pixelfx/fx/ui/_lib.js";

const D = 2.4, WORDS = 4, LIFE = 1.1, POP = 0.1, RISE = 16;
const WORD = spell("HA!").letters.filter((l) => l.g);
const WIDTH = spell("HA!").w;

export const meta = {
  name: "Laughter",
  desc: "Jittery HA!s break out round the head one after another, rise and fade.",
  tags: ["status", "laughter", "text", "debuff", "loop"],
  size: [104, 96],
  origin: [52, 80],
  duration: D,
  loop: true,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { palette: PAL.arcane },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), a = o.actor, cx = a.x + a.w / 2, frame = Math.floor(t * 15);
  for (let i = 0; i < WORDS; i++) {
    const age = (t - (i * D) / WORDS + D) % D;
    if (age >= LIFE) continue;
    const q = age / LIFE, fade = 1 - clamp((q - 0.6) / 0.4);
    /* the words alternate sides of the head, each at its own height, shaking as they go */
    const side = i % 2 ? 1 : -1, shakeX = Math.round((rand(frame, i, 3) - 0.5) * 2.5), shakeY = Math.round((rand(frame, i, 5) - 0.5) * 2);
    const x = Math.round(cx + side * (9 + 4 * rand(i, 7)) - WIDTH / 2) + shakeX;
    const y = Math.round(a.y + 2 - 6 * rand(i, 9) - q * RISE) + shakeY;
    const flash = clamp(1 - age / POP);
    drawWord(p, WORD.map((l) => ({ g: l.g, x: x + l.x, y, sx: 1, sy: 1, a: fade, flash })),
      { fill: [C[4], C[5], C[6], C[6]], edge: WHITE, under: C[3], outline: C[1], shadow: C[0] });
  }
}
