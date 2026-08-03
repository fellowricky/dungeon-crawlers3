/**
 * OVERLAND PROLOGUE — the two surface floors that open every dungeon run.
 *
 *   floor 1  approach   an existing overland biome, the country you cross to
 *                       get there (moor, forest, mire, holdfast)
 *   floor 2  threshold  the dungeon's own doorstep, above ground — a boneyard
 *                       outside the crypt, a ruinfield over the vault, and so on
 *   floor 3+ the dungeon itself, unchanged
 *
 * Nothing is written onto the quest object: `autoProloguePlan` derives the same
 * floorPlan entry the hand-authored story missions declare, so quests already
 * in flight in an old save pick the prologue up on their next floor load with
 * no migration. Story missions ship their own `floorPlan` and are never touched.
 */

import { mulberry32 } from './quests.js';

/** Dungeon theme -> the overland biomes you might cross to reach it. */
export const APPROACH_POOLS = {
  ancient: ['moor', 'forest', 'holdfast'],
  verdant: ['forest', 'mire'],
  frost:   ['forest', 'moor'],
  grim:    ['moor', 'mire', 'holdfast'],
  molten:  ['moor', 'forest']
};

/** Dungeon theme -> its threshold overland biome (prologue floor 2). */
export const THRESHOLD_THEME = {
  ancient: 'ruinfield',
  verdant: 'sporewood',
  frost:   'snowfield',
  grim:    'boneyard',
  molten:  'ashfield'
};

/** Floor-name fragments, keyed by the biome actually being generated. */
const APPROACH_LABEL = {
  moor:     'The Open Moor',
  forest:   'The Forest Trail',
  mire:     'The Sunken Causeway',
  holdfast: 'The Waystation'
};
const THRESHOLD_LABEL = {
  boneyard:  'The Boneyard',
  ruinfield: 'The Fallen Stones',
  ashfield:  'The Ashfields',
  snowfield: 'The White Pass',
  sporewood: 'The Sporewood'
};

/**
 * How many surface floors this quest opens with.
 * The prologue must never reach the last floor — that one carries the final
 * boss and has to be a dungeon — so a 3-floor quest gets the threshold only.
 * Story missions (own floorPlan) and any quest shorter than 3 get none.
 */
export function prologueLength(q) {
  if (!q || q.story || Array.isArray(q.floorPlan)) return 0;
  const floors = q.floors | 0;
  if (floors >= 4) return 2;
  if (floors === 3) return 1;
  return 0;
}

/** Deterministic approach biome for a quest (stable across reloads). */
export function approachTheme(q) {
  const pool = APPROACH_POOLS[q.theme] || ['moor', 'forest'];
  const rng = mulberry32(((q.seed | 0) ^ 0x9e3779b9) >>> 0);
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * The derived floorPlan entry for `floor` (1-based), or null when that floor is
 * a normal dungeon floor. Shape matches the hand-authored entries in story.js.
 */
export function autoProloguePlan(q, floor) {
  const len = prologueLength(q);
  if (floor > len) return null;

  /* A 1-floor prologue is the threshold — the approach is what gets dropped,
     since the doorstep is the floor that has to sell the dungeon below it. */
  const isThreshold = (floor === len);
  const theme = isThreshold ? (THRESHOLD_THEME[q.theme] || 'moor') : approachTheme(q);
  const label = isThreshold
    ? (THRESHOLD_LABEL[theme] || 'The Threshold')
    : (APPROACH_LABEL[theme] || 'The Approach');

  /* Overland maps are sized in tiles + zone count, not room count. They are
     generated PORTRAIT: the road climbs from the bottom edge to the camp at the
     top in a series of long side-to-side hauls, and it is map height that buys
     those hauls room to clear each other (see LEG_PITCH in generateOverland).
     A square map fuses them into stripes. Both axes grow with quest level, and
     the threshold runs a step longer than the approach so the walk escalates. */
  const lvl = Math.max(1, q.level | 0);
  const mapW = Math.round(Math.min(74, 60 + lvl * 0.7)) + (isThreshold ? 4 : 0);
  const mapH = Math.round(Math.min(112, 90 + lvl * 1.5)) + (isThreshold ? 8 : 0);
  /* Fewer, bigger clearings: each one is a battlefield, and the road has to
     find room for open ground between them. */
  const zones = Math.min(12, 5 + Math.floor(lvl / 6) + (isThreshold ? 1 : 0));

  return {
    mapKind: 'overland',
    theme,
    name: `${q.place || q.name} — ${label}`,
    mapW,
    mapH,
    zones
  };
}

/** One-line summary of a quest's shape for the world-map card. */
export function prologueSummary(q) {
  const len = prologueLength(q);
  if (!len) return null;
  const below = (q.floors | 0) - len;
  return `${len} overland ${len === 1 ? 'floor' : 'floors'} → ${below} below`;
}
