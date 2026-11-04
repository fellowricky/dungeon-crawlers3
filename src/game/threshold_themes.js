/**
 * Dungeon theme -> its threshold overland biome: the dungeon's own doorstep,
 * above ground (the last overland floor before the dungeon proper).
 *
 * A leaf module with no imports. overland_prologue.js re-exports it, and
 * world_regions.js reads it to know where each dungeon can sit on the painted
 * world map. Keeping it here breaks the quests -> world_regions ->
 * overland_prologue -> quests import cycle.
 */
export const THRESHOLD_THEME = {
  ancient: 'ruinfield',
  verdant: 'sporewood',
  frost:   'snowfield',
  grim:    'boneyard',
  molten:  'ashfield'
};

/**
 * Dungeon theme -> every painted world-map biome a dungeon of that theme may
 * sit on. The first entry is its own doorstep (THRESHOLD_THEME). Ancient ruins
 * also lie overgrown in forest and sporewood, and grim and verdant dungeons
 * can both sink into a mire (Zenu, 2026-10-27). On the painted map, the ground
 * under the pin becomes the quest's last overland day.
 */
export const DUNGEON_SITES = {
  ancient: ['ruinfield', 'forest', 'sporewood'],
  verdant: ['sporewood', 'mire'],
  frost:   ['snowfield'],
  grim:    ['boneyard', 'mire'],
  molten:  ['ashfield']
};
