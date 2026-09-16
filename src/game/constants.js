/**
 * Shared gameplay constants.
 * Tune combat pacing, pathfinding feel, and save version here.
 */

export const FLOOR = 1;
export const WALL = 2;
export const POOL = 3;

export const THEME_ORDER = ['ancient', 'verdant', 'frost', 'grim', 'molten'];
export const SAVE_KEY = 'dungeon-crawlers-save-v1';
export const SAVE_SLOT_PREFIX = 'dungeon-crawlers-save-slot-';
export const ACTIVE_SLOT_KEY = 'dc_active_save_slot';
export const MAX_SAVE_SLOTS = 5;

export const HERO_SPEED = 1.5;         // ~30% slower than the previous 2.15
export const MONSTER_SPEED_MULT = 0.5; // global monster speed scale (matches hero slowdown)
export const AGGRO_RANGE = 12;         // was 8.5 — LOS gate (walls/closed doors) now bounds aggro, so range can be generous
/* The leash for a monster JOINING a fight that is already under way. AGGRO_RANGE
   can be generous because a closed door blocks line of sight — but doors open
   during combat now (the cure for the fight-across-a-shut-gate soft-lock), and
   the instant one does, 12 units of aggro reach through the empty doorway into
   the next room. This is the range that applies once the swords are already
   out; see tryActivateMonster. */
export const COMBAT_JOIN_RANGE = 5;
/* Tactical combat (Phase 1): movement is locked to the current initiative
   actor and budgeted by moveLeft (cells). COMBAT_MOVE_BOOST multiplies the
   continuous walk speed ONLY during a tactical spotlight so a 6-cell move
   resolves in ~1.5s instead of ~4s — keeps turn pace responsive. Tunable:
   raise for snappier movement, lower for a more deliberate feel. */
export const COMBAT_MOVE_BOOST = 3.5;
/* Action-cadence slowdown: >1 makes entities take actions (attack/spell/ability)
   less often. Affects ONLY the attack cooldowns below — movement speed is
   governed separately by HERO_SPEED / MONSTER_SPEED_MULT / COMBAT_SPEED. */
export const COMBAT_ACTION_SLOWDOWN = 1.5;
export const HERO_ATTACK_CD = 2.2 * COMBAT_ACTION_SLOWDOWN;    // slower, more deliberate exchanges
/* How often a hero re-decides its combat target. pickHeroTarget re-rolls a
   random tiebreaker each call, so running it every frame made heroes twitch
   between foes. Decisions now refresh on this interval (staggered per hero);
   facing/movement/animation still run every frame off the cached choice. */
export const HERO_THINK_INTERVAL = 0.3;
export const MONSTER_ATTACK_CD = 2.6 * COMBAT_ACTION_SLOWDOWN;
export const XP_SHARE = parseFloat(globalThis.localStorage?.getItem('dc_xp_share') || '0.15');         // each living hero gets xp * this
export const REVEAL_RADIUS = 6.5;
/* How far the party can SEE, as opposed to how far it counts as having been.
   Deliberately longer than REVEAL_RADIUS — you can see across a room you have
   not walked; at 6.5 the field of view barely cleared a doorway and the reveal
   past an opened door read as nothing happening. Matched to AGGRO_RANGE so
   sight is symmetric: the range at which a monster can spot the party is the
   range at which the party can spot it. */
export const SIGHT_RADIUS = 12;
/* Superseded by COHESION_HOLD_DIST below, which is what the leader actually
   waits on. Kept only so an old saved tuning file does not fail to import. */
export const COHESION_MAX = 4.6;
/* Party cohesion band. The leader hard-stops once someone strays past HOLD,
   and resumes once the party is back inside RESUME; between the two it keeps
   whatever it was doing (hysteresis, so it cannot flap frame to frame).
   RESUME sits just under HOLD rather than far below it: formation depth is
   only ~2.5 tiles (FORMATION_SPACING/WIDTH), so requiring a much tighter
   regroup made the leader sit still long after the party had closed up —
   measured over 20 dungeon runs, 54 of 95 leader freezes were still holding
   at a stray distance already back inside HOLD. */
/* How much closer a different monster must be before the exploring party
   switches which one it is walking toward. Without a margin, two roughly
   equidistant monsters trade places as "nearest" every frame and the party
   oscillates between them instead of reaching either. */
export const ROOM_TARGET_SWITCH_MARGIN = 1.5;
export const COHESION_HOLD_DIST = 6.0;
export const COHESION_RESUME_DIST = 5.0;
export const COHESION_SLOW_DIST = 4.2;
export const COMBAT_SPEED = 0.72;     // fraction of move speed used for combat repositioning
export const BESTIARY_UNLOCK = 10;    // kills of a monster before its compendium entry unlocks

// --- Formation / cohesion ---
export const FORMATION_SPACING = 1.0;  // tiles behind leader for follower slots
export const FORMATION_WIDTH = 1.0;    // tiles to side for follower wedge spread

// --- Chokepoint ---
export const CHOKEPOINT_COST = 3;        // Dijkstra penalty weight for chokepoint cells
export const HAZARD_COST = 6;            // Dijkstra penalty weight for AoE-covered cells
// Squeezing through a teammate's square: legal in 5e (you just can't stop
// there), but preferably avoided. Hard-blocking allies instead sent heroes on
// long detours around their own party rather than queueing behind them.
export const ALLY_PASS_COST = 2;
/* Dijkstra penalty per LEVEL scrambled without a staircase, in combat. Not a
   prohibition: refusing the climb outright is what let a party get walled in
   behind a two-level face with a monster parked on the only steps. Priced at
   four so a stair within a few tiles always wins and a long detour does not. */
export const CLIMB_COST = 4;

// --- Collision radii (world tiles; cell centres are 1.0 apart) ---
// A floor cell spans +/-0.5 around its centre, so any radius < 0.5 keeps the
// 4-point probe in-cell. AGENT_R is the nominal body radius used for open-area
// queries (combat ring positioning). TIGHT_R is the doorway-safe radius: small
// enough that an entity jostled up to ~0.28 off-centre still probes clear in a
// 1-wide passage. Local movement physics (stepAlong/wallRepel/nudgeToward) and
// separation push-validation all use TIGHT_R so a "passable" decision is
// consistent across systems inside doorways.
export const AGENT_R = 0.3;
export const TIGHT_R = 0.22;

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

// --- Tactical-action gating (Dash / Dodge / Disengage) ---
// These "fallback" actions spend the whole Action, so the AIs only take them
// when they actually pay off. A creature below TACTICAL_BLOODIED_FRAC HP is
// considered bloodied (retreats / breaks contact); a creature is "under
// pressure" (Dodge-worthy) when bloodied below TACTICAL_DODGE_BLOODIED_FRAC
// or pinned by TACTICAL_DODGE_PIN_THREATS adjacent hostiles.
export const TACTICAL_BLOODIED_FRAC = 0.35;      // retreat / break-contact threshold
export const TACTICAL_DODGE_BLOODIED_FRAC = 0.4; // pressure threshold for Dodge
export const TACTICAL_DODGE_PIN_THREATS = 2;     // adjacent hostiles that count as pressure

// --- Monster AI: flanking ---
export const FLANK_OFFSET = 1.5;         // tiles past the target a flanker aims for

// --- Monster AI: pack focus fire ---
// Monsters whose tags/id match these sets coordinate on a shared target.
export const PACK_TAGS = ['pack', 'swarm'];
export const PACK_IDS = ['giant-rat','grey-rat','dire-wolf','wolf','winter-wolf',
  'kobold','kobold-slinger','goblin','goblin-scout','hobgoblin',
  'gnoll','ghoul','hyena','bloodhound','war-dog'];
export const PACK_FOCUS_BONUS = 8.0;     // score bonus for matching a pack-mate's target

// --- Damage types (D&D 5e). Used by the damage-type modifier system. ---
// Physical (subject to nonmagical-weapon resistance on some monsters):
export const DMG_PHYSICAL = ['bludgeoning', 'piercing', 'slashing'];
// Energy / typed damage (always considered magical when from a spell):
export const DMG_TYPES = [
  'bludgeoning', 'piercing', 'slashing',     // physical
  'acid', 'cold', 'fire', 'lightning', 'thunder',
  'force', 'necrotic', 'poison', 'psychic', 'radiant',
];

export const DAMAGE_TYPE_ICONS = {
  fire: '🔥',
  cold: '❄️',
  lightning: '⚡',
  thunder: '🌩️',
  acid: '🧪',
  poison: '☠️',
  necrotic: '💀',
  radiant: '✨',
  force: '💫',
  psychic: '👁️',
  slashing: '🗡️',
  piercing: '🏹',
  bludgeoning: '🔨'
};

// --- CR-based Monster Stat Scaling Table ---
// Percentage levers per CR rating for AC, HP, to-hit (atk), and ability stats.
// Calculated values are rounded down via Math.floor().
// The values live in cr_scaling.json so the bestiary's "CR Scaling" tab can edit
// and save them without touching source. Keys are CR strings ("0.125" = CR 1/8),
// which index fine with numeric lookups since JS coerces the key to a string.
import CR_SCALING_DATA from './cr_scaling.json' with { type: 'json' };

/* --- Monster CR by dungeon level ---
   Flat Challenge-Rating progression replaces the old 5 discrete tiers. Each
   dungeon level maps to a target CR via a piecewise-linear anchor curve:

     level 1 -> CR 0.25,  level 4 -> CR 1,  level 8 -> CR 3,
     level 12 -> CR 6,    level 16 -> CR 10

   These CRs are the medians of the former tiers 1-5, so the new curve lands in
   the same place the tier anchors did. Between anchors each spawn rolls the two
   adjacent CRs with linear weights — a level-3 dungeon averages ~CR 0.75 but
   sometimes rolls up to CR 1.

   This lives here, not in srd.js, because THREE places need it and they used to
   disagree: srd.js picks the CR that actually spawns, the dungeon generator
   prices its spawn budget against it, and the bestiary previews it. The anchors
   themselves live in spawn_budget.json so tuning the curve is a data edit. */
import SPAWN_BUDGET_DATA from './spawn_budget.json' with { type: 'json' };

/** Dungeon levels at which the CR curve has an anchor.
 *  Pass an optional data object (e.g. the bestiary's live SPAWN_BUDGET) to see
 *  edits before they are saved to disk. */
export function crAnchorLevels(data) {
  const d = data || SPAWN_BUDGET_DATA;
  const a = d.crAnchorLevels;
  return (Array.isArray(a) && a.length >= 2) ? a : [1, 4, 8, 12, 16];
}

/** Target CR at each anchor level (parallel to crAnchorLevels). */
export function crAnchorCRs(data) {
  const d = data || SPAWN_BUDGET_DATA;
  const c = d.crAnchorCRs;
  return (Array.isArray(c) && c.length === crAnchorLevels(d).length) ? c : [0.25, 1, 3, 6, 10];
}

/** The CR a dungeon of this level is guaranteed to field at minimum — the
 *  lower of the two anchors it sits between. Deterministic; use for pricing and
 *  for display where a dice roll would be noise. */
export function baseCrForDungeonLevel(level, data) {
  const A = crAnchorLevels(data);
  const V = crAnchorCRs(data);
  if (level <= A[0]) return V[0];
  if (level >= A[A.length - 1]) return V[V.length - 1];
  let i = 0;
  while (level > A[i + 1]) i++;
  return V[i];
}

/** The maximum CR possible at this dungeon level — the upper of the two
 *  anchors it sits between (i.e. the CR the roll-up can reach). */
export function maxCrForDungeonLevel(level, data) {
  const A = crAnchorLevels(data);
  const V = crAnchorCRs(data);
  if (level <= A[0]) return V[0];
  if (level >= A[A.length - 1]) return V[V.length - 1];
  let i = 0;
  while (level > A[i + 1]) i++;
  return V[i + 1];
}

/** How far (0..1) the level sits between its two surrounding anchors. */
export function crUpChanceForDungeonLevel(level, data) {
  const A = crAnchorLevels(data);
  if (level <= A[0] || level >= A[A.length - 1]) return 0;
  let i = 0;
  while (level > A[i + 1]) i++;
  return (level - A[i]) / (A[i + 1] - A[i]);
}

/** The CR a single spawn actually gets at this dungeon level — interpolates
 *  between anchors and, between anchors, sometimes rolls up to the next CR. */
export function crForDungeonLevel(level, rng = Math.random, data) {
  const A = crAnchorLevels(data);
  const V = crAnchorCRs(data);
  if (level <= A[0]) return V[0];
  if (level >= A[A.length - 1]) return V[V.length - 1];
  let i = 0;
  while (level > A[i + 1]) i++;
  const frac = (level - A[i]) / (A[i + 1] - A[i]);
  const base = V[i] + frac * (V[i + 1] - V[i]);
  /* roll-up mirrors the old tierUpChance: between anchors, each spawn has a
     frac chance to jump to the next anchor's CR instead of the blend. */
  return (frac > 0 && rng() < frac) ? V[i + 1] : base;
}

/** Spawn-budget cost for a monster of the given CR. Replaces the old per-tier
 *  `tierCost` table with a continuous curve tuned to reproduce the former tier
 *  medians at the anchor CRs: CR 0.25 -> 12, CR 1 -> 21, CR 3 -> 38, CR 6 -> 62,
 *  CR 10 -> 90 (the high end runs a touch richer, which the overspend slack
 *  absorbs). `crCostScale` in spawn_budget.json scales the whole curve. */
export function crToCost(cr, data) {
  const d = data || SPAWN_BUDGET_DATA;
  const c = Math.max(0, cr || 0);
  const scale = d.crCostScale ?? 1;
  const overrides = d.crCostOverrides;
  if (overrides && typeof overrides === 'object') {
    // Exact match: use the override directly
    const key = String(c);
    if (overrides[key] != null) {
      return Math.max(1, Math.round(overrides[key] * scale));
    }
    // Interpolate between surrounding overrides when possible
    const keys = Object.keys(overrides).map(Number).filter(k => isFinite(k)).sort((a, b) => a - b);
    if (keys.length >= 2) {
      if (c <= keys[0]) return Math.max(1, Math.round(overrides[String(keys[0])] * scale));
      if (c >= keys[keys.length - 1]) return Math.max(1, Math.round(overrides[String(keys[keys.length - 1])] * scale));
      let lo = 0;
      while (keys[lo + 1] < c) lo++;
      const crLo = keys[lo], crHi = keys[lo + 1];
      const t = (c - crLo) / (crHi - crLo);
      const cost = overrides[String(crLo)] + t * (overrides[String(crHi)] - overrides[String(crLo)]);
      return Math.max(1, Math.round(cost * scale));
    }
  }
  return Math.max(1, Math.round((8 + 13 * Math.pow(c, 0.8)) * scale));
}

/** Discrete band index (0-4) for a CR — an internal bucketing aid used by the
 *  spawn "lock" (same-band spawns in a room share a species) and any place that
 *  needs a coarse CR group. Bands track the former tier medians. */
export function crBandIndex(cr) {
  const c = Math.max(0, cr || 0);
  if (c < 0.6) return 0;
  if (c < 2) return 1;
  if (c < 4.5) return 2;
  if (c < 8) return 3;
  return 4;
}

export const CR_SCALING_TABLE = CR_SCALING_DATA;

export function getCRScale(cr = 0) {
  if (CR_SCALING_TABLE[cr]) return CR_SCALING_TABLE[cr];
  const keys = Object.keys(CR_SCALING_TABLE).map(Number).sort((a, b) => a - b);
  if (cr > keys[keys.length - 1]) return CR_SCALING_TABLE[keys[keys.length - 1]];
  if (cr < keys[0]) return CR_SCALING_TABLE[keys[0]];
  let best = keys[0];
  for (const k of keys) {
    if (k <= cr) best = k;
  }
  return CR_SCALING_TABLE[best];
}

