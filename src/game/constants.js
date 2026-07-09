/**
 * Shared gameplay constants.
 * Tune combat pacing, pathfinding feel, and save version here.
 */

export const FLOOR = 1;
export const WALL = 2;

export const THEME_ORDER = ['ancient', 'verdant', 'frost', 'grim', 'molten'];
export const SAVE_KEY = 'dungeon-crawlers-save-v1';

export const HERO_SPEED = 3.1;
export const AGGRO_RANGE = 8.5;
export const HERO_ATTACK_CD = 2.2;    // slower, more deliberate exchanges
export const MONSTER_ATTACK_CD = 2.6;
export const XP_SHARE = 0.15;         // each living hero gets xp * this
export const REVEAL_RADIUS = 4.5;
export const COHESION_MAX = 4.6;      // leader waits if any ally is farther than this
export const COMBAT_SPEED = 0.72;     // fraction of move speed used for combat repositioning

// --- Formation / cohesion ---
export const FORMATION_SPACING = 1.8;  // tiles behind leader for follower slots
export const FORMATION_WIDTH = 1.2;    // tiles to side for follower wedge spread

// --- Local steering ---
export const STEER_ENTITY_RADIUS = 0.45; // entity body radius for clearance checks

// --- Chokepoint ---
export const CHOKEPOINT_COST = 3;        // BFS penalty weight for chokepoint cells

// --- Stuck recovery ---
export const STUCK_SIDESTEP_T = 0.6;     // seconds before sidestep attempt
export const STUCK_REPATH_T = 1.5;       // seconds before forced repath
export const STUCK_TELEPORT_T = 2.5;     // seconds before last-resort teleport
export const STUCK_SIDESTEP_DIST = 0.45; // sidestep lateral distance
