// The small print on a pixel damage number: what kind of damage it is, and whether it worked. Each damage type has a
// colour ramp and a little hand-drawn icon; effectiveness is told three ways so it reads at a glance and without relying on
// colour: vulnerable is a green ring and "x2", resisted is a greyed icon under a red cross and "1/2", immune is a crossed
// icon and the word IMMUNE. The ring and the cross carry on what the old emoji badges meant.
import { fit, hex, WHITE } from "../../vendor/pixelfx/core/index.js";
import { spell, drawWord } from "../../vendor/pixelfx/fx/ui/_lib.js";

export const TYPE_RAMPS = {
  physical:  ["#1a1410", "#3a2e24", "#6a5a48", "#a08c72", "#d4c2a4", "#efe2c8", "#fffaf0", "#ffffff"],
  fire:      ["#2a0710", "#5e0f16", "#a3191c", "#e0401c", "#ff7b22", "#ffb93b", "#ffe68a", "#ffffff"],
  cold:      ["#0a1a33", "#12335e", "#1e5a94", "#2f8cc9", "#5cc0ea", "#9be4f7", "#d8f7ff", "#ffffff"],
  lightning: ["#241a05", "#4a3a08", "#8a6e0c", "#cfa812", "#f5d820", "#fff060", "#fffcb8", "#ffffff"],
  thunder:   ["#0e1030", "#1e2458", "#34408e", "#4f66c4", "#7b95ea", "#adc4ff", "#dce6ff", "#ffffff"],
  acid:      ["#0c1a08", "#1c3a0c", "#34660f", "#5aa014", "#8ed81f", "#bdf25a", "#e8ffb0", "#ffffff"],
  poison:    ["#06201a", "#0c3f30", "#166b4e", "#22a070", "#3ed096", "#84efc0", "#cffff0", "#ffffff"],
  necrotic:  ["#12061c", "#2a0c3e", "#4d1a6c", "#7a2fa0", "#a55ad0", "#cf9af0", "#efd8ff", "#ffffff"],
  radiant:   ["#2a1e05", "#5c4410", "#a07c18", "#dcb42a", "#ffd84a", "#ffec90", "#fff8d0", "#ffffff"],
  force:     ["#1c0626", "#42105a", "#7a1e9a", "#b03ad0", "#d870f0", "#f0aaff", "#fbe0ff", "#ffffff"],
  psychic:   ["#2a0620", "#5a0e46", "#9a1c78", "#d83aa8", "#f870c8", "#ffaae0", "#ffe0f4", "#ffffff"],
};
const PHYSICAL = new Set(["slashing", "piercing", "bludgeoning"]);

/** The ramp a number of this damage type is drawn in. */
export const rampForType = (type) => (PHYSICAL.has(type) ? TYPE_RAMPS.physical : TYPE_RAMPS[type] || TYPE_RAMPS.physical);

/* a: bright, b: mid, c: deep. Nine pixels square, so they sit beside a number without crowding it. */
const ICONS = {
  slashing: [".......aa", "......aab", ".....aab.", "....aab..", "c..aab...", ".caab....", "..cb.....", ".c.cc....", "c........"],
  piercing: ["....aaaaa", ".......aa", "......aba", ".....ab.a", "....ab...", "...ab....", "c.ab.....", ".cb......", "c.c......"],
  bludgeoning: [".aaaaaaa.", "aabbbbbaa", "aabbbbbbb", ".bbbbbbb.", "....c....", "....c....", "....c....", "....c....", "....c...."],
  fire: ["....a....", "....ab...", "...aab...", "..aabb.a.", ".aabbb.ab", ".abbcbbab", "abbcccbbb", "abbcccbb.", ".bbbbbb.."],
  cold: ["....a....", ".a..a..a.", "..a.a.a..", "...aba...", "aaabcbaaa", "...aba...", "..a.a.a..", ".a..a..a.", "....a...."],
  lightning: [".....aaa.", "....aab..", "...aab...", "..aaaaa..", "....aab..", "...aab...", "..ab.....", ".ab......", ".b......."],
  thunder: ["..b...b..", ".b.....b.", "b..a.a..b", "b.a.a.a.b", "b.a.c.a.b", "b.a.a.a.b", "b..a.a..b", ".b.....b.", "..b...b.."],
  acid: ["....a....", "....a....", "...aab...", "...abb...", "..aabbb..", ".aabbbbb.", ".abbbcbb.", ".bbbccbb.", "..bbbbb.."],
  poison: ["......a..", ".....aba.", "..a...a..", ".aba.....", "..a..aa..", "....abba.", "....abba.", ".a...aa..", "aba......"],
  necrotic: ["..aaaaa..", ".aaaaaaa.", ".accacca.", ".accacca.", ".aaaaaaa.", "..aacaa..", "..aaaaa..", "..a.a.a..", "........."],
  radiant: ["....a....", ".a..a..a.", "..aaaaa..", "..abbba..", "aaabcbaaa", "..abbba..", "..aaaaa..", ".a..a..a.", "....a...."],
  force: ["....a....", "....a....", "...aba...", "...aba...", "aaabcbaaa", "...aba...", "...aba...", "....a....", "....a...."],
  psychic: ["...aaa...", ".aa...aa.", "a..bbb..a", "a.bbcbb.a", "a.bcccb.a", "a.bbcbb.a", "a..bbb..a", ".aa...aa.", "...aaa..."],
};

const INK = hex("#0d0a14"), GREEN = hex("#4ade80"), GREEN_LIT = hex("#c4ffd8"), RED = hex("#ef4444"), RED_DEEP = hex("#7a1414");
const GREY = [hex("#3a3a44"), hex("#6a6a78"), hex("#a0a0ae")];

/* One of the badge's pixels, k art pixels square: a crit is drawn at half size, so its badge is drawn at k = 2 to match. */
function block(p, x, y, k, col) {
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) p.px(x + i, y + j, col);
}

/** A damage type's icon, centred on (x, y). `dim` greys it. */
function drawIcon(p, type, x, y, C, dim, k) {
  const rows = ICONS[type];
  if (!rows) return;
  const X = Math.round(x) - 4 * k, Y = Math.round(y) - 4 * k;
  const on = (cx, cy) => cy >= 0 && cy < 9 && cx >= 0 && cx < 9 && rows[cy][cx] !== ".";
  for (let cy = -1; cy <= 9; cy++) for (let cx = -1; cx <= 9; cx++) {
    if (on(cx, cy)) {
      const ch = rows[cy][cx];
      const col = dim ? (ch === "a" ? GREY[2] : ch === "b" ? GREY[1] : GREY[0]) : ch === "a" ? C[6] : ch === "b" ? C[5] : C[3];
      block(p, X + cx * k, Y + cy * k, k, col);
    } else if (on(cx - 1, cy) || on(cx + 1, cy) || on(cx, cy - 1) || on(cx, cy + 1)) block(p, X + cx * k, Y + cy * k, k, INK);
  }
}

/** A ring of whole pixels round (x, y), with a dark line outside it so it holds on any floor. */
function ring(p, x, y, r, col, k) {
  const X = Math.round(x), Y = Math.round(y);
  for (let dy = -r - 2; dy <= r + 2; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) {
    const d = Math.hypot(dx, dy);
    if (d >= r - 0.5 && d < r + 0.5) block(p, X + dx * k, Y + dy * k, k, col);
    else if (d >= r + 0.5 && d < r + 1.5) block(p, X + dx * k, Y + dy * k, k, INK);
  }
}

/** A cross over an icon: red with a dark edge. */
function cross(p, x, y, r, k) {
  const X = Math.round(x), Y = Math.round(y);
  for (let i = -r; i <= r; i++) for (const s of [1, -1]) {
    block(p, X + (i + 1) * k, Y + s * i * k, k, RED_DEEP);
    block(p, X + (i - 1) * k, Y + s * i * k, k, RED_DEEP);
  }
  for (let i = -r; i <= r; i++) for (const s of [1, -1]) block(p, X + i * k, Y + s * i * k, k, RED);
}

/** How much room an icon takes beside a number. */
export const BADGE_W = 16;

/** The damage type's icon with its effectiveness on it, centred on (x, y): nothing but the icon when it's an ordinary hit. */
export function drawBadge(p, x, y, types, effect, palette, k = 1) {
  const type = types && types[0];
  const C = fit(palette || rampForType(type), 8);
  if (type) drawIcon(p, type, x, y, C, effect === "resist" || effect === "immune", k);
  if (effect === "vuln") ring(p, x, y, 7, GREEN, k);
  else if (effect === "resist" || effect === "immune") cross(p, x, y, 4, k);
}

/** The multiplier, left-aligned at (x, y) (its vertical middle): green x2, or red 1/2. */
export function drawMultiplier(p, x, y, effect, a = 1, k = 1) {
  if (effect !== "vuln" && effect !== "resist") return;
  const word = spell(effect === "vuln" ? "x2" : "1/2", "mini"), s = 2 * k;
  const items = word.letters.filter((L) => L.g).map((L) => ({ g: L.g, x: Math.round(x) + L.x * s, y: Math.round(y) - 5 * k, sx: s, sy: s, a }));
  const st = effect === "vuln"
    ? { fill: [GREEN, GREEN, GREEN_LIT], edge: WHITE, under: GREEN, outline: INK, shadow: 0 }
    : { fill: [RED, RED, hex("#ff9a8a")], edge: hex("#ffc4bc"), under: RED, outline: INK, shadow: 0 };
  drawWord(p, items, st);
}
