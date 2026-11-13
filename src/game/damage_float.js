/**
 * What a floating combat string means. Combat speaks in short strings ("16 ⭕🔥", "4 ❌❄️", "IMMUNE 💀", "+12"), and every
 * one that is a number gets drawn as a pixel number (render/pfx/damage_pop.js, crit_pop.js) instead of as text. Anything
 * that isn't a number, or carries a word ("+4 Ki", "CLEAVE", "miss"), is null here and stays ordinary floating text.
 *
 * No THREE or DOM in here, so it can be tested on its own.
 */
import { DAMAGE_TYPE_ICONS } from './constants.js';

const TYPE_OF_ICON = new Map(Object.entries(DAMAGE_TYPE_ICONS).map(([type, icon]) => [icon, type]));
const NO_TYPE_ICON = '🛡️';   // what combat prints for a share of damage with no type

function graphemes(str) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(str)].map((s) => s.segment);
  }
  return Array.from(str);
}

/** { types: [...], effect } from what follows the number, or null if anything in it isn't a badge. */
function readBadges(rest) {
  const types = [];
  let effect = null;
  for (const ch of graphemes(rest)) {
    if (ch === ' ') continue;
    if (ch === '⭕' || ch === '🟢') effect = effect || 'vuln';
    else if (ch === '❌') effect = effect || 'resist';
    else if (ch === NO_TYPE_ICON) continue;
    else if (TYPE_OF_ICON.has(ch)) types.push(TYPE_OF_ICON.get(ch));
    else return null;
  }
  return { types, effect };
}

/**
 * A float string as a number to draw: { text, amount, heal, types, effect: 'vuln' | 'resist' | 'immune' | null },
 * or null when it's something else.
 */
export function parseDamageFloat(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (/^IMMUNE\b/.test(s)) {
    const b = readBadges(s.slice(6));
    return b ? { text: 'IMMUNE', amount: 0, heal: false, types: b.types, effect: 'immune' } : null;
  }
  const m = /^(\+?)(\d+)(?:\s+(.+))?$/u.exec(s);
  if (!m) return null;
  const b = readBadges(m[3] || '');
  if (!b) return null;
  return { text: m[1] + m[2], amount: Number(m[2]), heal: m[1] === '+', types: b.types, effect: b.effect };
}

/* The colours combat picks for a hit on a monster, which say nothing the type and badge don't say better. Anything else
   is a colour someone chose on purpose (a hero being hurt is red, a heal is green), and it's kept. */
const GENERIC_HIT_COLOURS = new Set(['#ff8a5a', '#ffd34a', '#4ade80', '#ff8a7a']);
export const usesTypeColour = (spec, color) => spec.types.length > 0 && (!color || GENERIC_HIT_COLOURS.has(String(color).toLowerCase()));

/* Where crits on one target go, in the crit effect's own art px from it (+x right, -y up, on screen). A burst is about 100
   wide and 80 tall in those px and its icon and multiplier stick out past it, so these keep each clear of the rest: the
   parts of one multi-type crit can all be read at once. */
export const CRIT_SLOTS = [[0, 0], [150, -34], [-150, -34], [0, -92], [150, -126], [-150, -126]];

/** The first slot no crit still playing near (x, z) holds. `live` is [{ x, z, slot }]. All full: they double up in turn. */
export function pickCritSlot(live, x, z) {
  const near = live.filter((c) => Math.hypot(c.x - x, c.z - z) < 0.6);
  const held = new Set(near.map((c) => c.slot));
  for (let slot = 0; slot < CRIT_SLOTS.length; slot++) if (!held.has(slot)) return slot;
  return near.length % CRIT_SLOTS.length;
}

/** How many coins a gold reward throws: more for more, up to the effect's dozen. */
export function coinsForGold(amount) {
  if (amount <= 5) return 3;
  if (amount <= 10) return 5;
  if (amount <= 25) return 7;
  if (amount <= 60) return 10;
  return 12;
}
