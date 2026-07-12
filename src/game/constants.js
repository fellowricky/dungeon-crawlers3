/**
 * Shared gameplay constants.
 * Tune combat pacing, pathfinding feel, and save version here.
 */

export const FLOOR = 1;
export const WALL = 2;
export const POOL = 3;

export const THEME_ORDER = ['ancient', 'verdant', 'frost', 'grim', 'molten'];
export const SAVE_KEY = 'dungeon-crawlers-save-v1';

export const HERO_SPEED = 1.5;         // ~30% slower than the previous 2.15
export const MONSTER_SPEED_MULT = 0.5; // global monster speed scale (matches hero slowdown)
export const AGGRO_RANGE = 8.5;
/* Action-cadence slowdown: >1 makes entities take actions (attack/spell/ability)
   less often. Affects ONLY the attack cooldowns below — movement speed is
   governed separately by HERO_SPEED / MONSTER_SPEED_MULT / COMBAT_SPEED. */
export const COMBAT_ACTION_SLOWDOWN = 1.5;
export const HERO_ATTACK_CD = 2.2 * COMBAT_ACTION_SLOWDOWN;    // slower, more deliberate exchanges
export const MONSTER_ATTACK_CD = 2.6 * COMBAT_ACTION_SLOWDOWN;
export const XP_SHARE = 0.15;         // each living hero gets xp * this
export const REVEAL_RADIUS = 4.5;
export const COHESION_MAX = 4.6;      // leader waits if any ally is farther than this
export const COMBAT_SPEED = 0.72;     // fraction of move speed used for combat repositioning
export const BESTIARY_UNLOCK = 10;    // kills of a monster before its compendium entry unlocks

// --- Formation / cohesion ---
export const FORMATION_SPACING = 1.0;  // tiles behind leader for follower slots
export const FORMATION_WIDTH = 0.5;    // tiles to side for follower wedge spread

// --- Chokepoint ---
export const CHOKEPOINT_COST = 3;        // BFS penalty weight for chokepoint cells

// --- Stuck recovery ---
export const STUCK_SIDESTEP_T = 0.6;     // seconds before sidestep attempt
export const STUCK_REPATH_T = 1.5;       // seconds before forced repath
export const STUCK_TELEPORT_T = 2.5;     // seconds before last-resort teleport
export const STUCK_SIDESTEP_DIST = 0.45; // sidestep lateral distance

// --- Monster AI: threat-based targeting ---
// Monsters score each hero: score = threat*THREAT_WEIGHT
//   + (AGGRO_RANGE - dist)*THREAT_DIST_WEIGHT + rand()*THREAT_JITTER.
// Damage dealt to a monster accrues as threat; it decays exponentially with
// a half-life of THREAT_HALFLIFE_SEC so stale aggro fades. A monster keeps
// its current target unless another hero beats it by TARGET_SWITCH_MARGIN.
export const THREAT_WEIGHT = 1.0;        // per point of damage dealt
export const THREAT_DIST_WEIGHT = 1.0;   // proximity pull (per tile)
export const THREAT_JITTER = 1.5;        // random spread so monsters diverge
export const THREAT_HALFLIFE_SEC = 6.0;  // threat halves every N seconds
export const TARGET_SWITCH_MARGIN = 1.3; // must beat current target by 30%

// --- Monster AI: ranged kiting ---
export const KITE_THREAT_RANGE = 2.2;    // a melee hero within this spooks the shooter
export const KITE_RETREAT_DIST = 2.5;    // world tiles to back away toward
export const KITE_COMMIT_SEC = 0.6;      // min time committed to a kite before reconsidering

// --- Monster AI: flanking ---
export const FLANK_OFFSET = 1.5;         // tiles past the target a flanker aims for

// --- Monster AI: pack focus fire ---
// Monsters whose tags/id match these sets coordinate on a shared target.
export const PACK_TAGS = ['pack', 'swarm'];
export const PACK_IDS = ['giant-rat','grey-rat','dire-wolf','wolf','winter-wolf',
  'kobold','kobold-slinger','goblin','goblin-scout','hobgoblin',
  'gnoll','ghoul','hyena','bloodhound','war-dog'];
export const PACK_FOCUS_BONUS = 8.0;     // score bonus for matching a pack-mate's target
