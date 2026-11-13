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
 *
 * Quests placed on the painted world map carry `q.route` instead
 * (world_regions.planRoute): one overland floor per day of travel from the
 * guild hub (1-4), each in the biome the road crosses most that day, the last
 * one always the doorstep. Quests without a route keep the shape above.
 */

import { mulberry32 } from './quests.js';
import { maxCrForDungeonLevel } from './constants.js';
import { THRESHOLD_THEME } from './threshold_themes.js';
import { QUEST_OVERLAND_MAP } from '../dungeon/dungeon_generator.js';
import { resolveOverlandEnvironment } from '../dungeon/overland_weather.js';

/* Overland floors fight at half the dungeon's strength: the approach is the
   gentle ramp into a run, and natural wildlife runs out of believable CRs
   long before the dungeon curve does. */
export const OVERLAND_STRENGTH = 0.5;

/**
 * The dungeon level an overland floor spawns as for a quest of `level` — the
 * highest level whose CR is at most OVERLAND_STRENGTH × the quest level's CR.
 * The whole floor (purse, CR ladder, ceiling) runs at that level, so it is a
 * real level-N floor rather than a level-20 purse spent on CR-8 bodies.
 * Reads the live CR curve, so retuning spawn_budget.json carries through.
 */
export function overlandSpawnLevel(level, data) {
  const lvl = Math.max(1, level | 0);
  const target = maxCrForDungeonLevel(lvl, data) * OVERLAND_STRENGTH;
  let best = 1;
  for (let l = 1; l <= lvl; l++) {
    if (maxCrForDungeonLevel(l, data) <= target) best = l;
  }
  return best;
}

/** Dungeon theme -> the overland biomes you might cross to reach it. */
export const APPROACH_POOLS = {
  ancient: ['moor', 'forest', 'holdfast'],
  verdant: ['forest', 'mire'],
  frost:   ['forest', 'moor'],
  grim:    ['moor', 'mire', 'holdfast'],
  molten:  ['moor', 'forest']
};

/** Dungeon theme -> its threshold overland biome (the last overland floor). */
export { THRESHOLD_THEME };

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
  /* Quests placed on the painted world map carry their road: one overland
     floor per day of travel (world_regions.planRoute). */
  if (q.route && Array.isArray(q.route.legs)) return q.route.legs.length;
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
  const legs = q.route && Array.isArray(q.route.legs) ? q.route.legs : null;
  /* A routed quest's days are whatever country the road crosses that day, so a
     travel leg can be any overland biome, threshold ones included. */
  const theme = legs
    ? legs[floor - 1]
    : (isThreshold ? (THRESHOLD_THEME[q.theme] || 'moor') : approachTheme(q));
  /* An ancient dungeon can sit in a forest, so the last day may be an approach biome too. */
  const label = isThreshold
    ? (THRESHOLD_LABEL[theme] || APPROACH_LABEL[theme] || 'The Threshold')
    : (APPROACH_LABEL[theme] || THRESHOLD_LABEL[theme] || 'The Approach');

  return {
    mapKind: 'overland',
    theme,
    name: legs && len > 1
      ? `${q.place || q.name} — Day ${floor}: ${label}`
      : `${q.place || q.name} — ${label}`,
    /* Every quest overland floor is a RIBBON map (50 x 300, nine clearings),
       so a day on the road reads as a journey. Story missions keep the sizes
       in their own floorPlans. */
    ...QUEST_OVERLAND_MAP
  };
}

/**
 * Theme, time of day, and weather for the loading plate of this floor.
 * Time and weather use the same seed the overland generator does, so the
 * still and the weather layer match the map.
 */
export function loadingSurface(q, floor, seed, fallbackTheme = '') {
  const plan = (q && Array.isArray(q.floorPlan))
    ? q.floorPlan[(floor | 0) - 1]
    : ((q && !q.skipPrologue) ? autoProloguePlan(q, floor) : null);
  const mapKind = (plan && plan.mapKind) || (q && q.mapKind) || '';
  const theme = (plan && plan.theme) || (q && q.theme) || fallbackTheme || '';
  let timeOfDay = '';
  let weather = '';
  if (mapKind === 'overland' && theme) {
    const env = resolveOverlandEnvironment(theme, seed >>> 0, {
      ...(plan && plan.timeOfDay ? { timeOfDay: plan.timeOfDay } : {}),
      ...(plan && plan.weather ? { weather: plan.weather } : {}),
    });
    timeOfDay = env.timeOfDay || '';
    weather = env.weather || '';
  }
  return { plan, mapKind, theme, timeOfDay, weather };
}

/**
 * The floor depth the spawn and boss scaling should read for `questFloor`.
 * Monster CR, the elite pack and the final boss all climb half a level per
 * quest floor. A routed quest puts up to four travel days in front of its
 * dungeon, and those must make the trip longer, not the boss deadlier, so the
 * depth is measured as if the quest had the old fixed prologue (2 floors, or 1
 * on a size-3 quest). Legacy quests use questFloor unchanged.
 */
export function depthFloor(q, questFloor) {
  const f = questFloor | 0;
  if (!q || !q.route || !Array.isArray(q.route.legs)) return f;
  const legacyPrologue = (q.dungeonSize || 0) >= 4 ? 2 : 1;
  return Math.max(1, f - q.route.legs.length + legacyPrologue);
}

/** One-line summary of a quest's shape for the world-map card. */
export function prologueSummary(q) {
  const len = prologueLength(q);
  if (!len) return null;
  const below = (q.floors | 0) - len;
  if (q.route) return `${len} ${len === 1 ? 'day' : 'days'} overland → ${below} below`;
  return `${len} overland ${len === 1 ? 'floor' : 'floors'} → ${below} below`;
}
