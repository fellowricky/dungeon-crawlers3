/**
 * GUILD COMPOUND LAYOUT — pure data describing where every structure stands.
 *
 * Deliberately data-only: repositioning a building is editing numbers here, not
 * touching scene code. See GUILD_HALL_PLAN.md §8.
 *
 * Coordinate space matches the dungeon renderer: 1 unit = 1 dungeon tile = 5ft,
 * +x right, +z toward the camera (south). The plaza sits at the origin and the
 * gate is at south. `rot` is optional — structures face the plaza automatically.
 *
 * Hero slots are in LOCAL space relative to the structure anchor, BEFORE
 * rotation, where +dz is "in front of the door". guild_scene.js rotates them
 * into world space, so a building can be moved or re-faced without touching its
 * slots.
 */

/** Facility level (0-10) → visual tier (0-3). Tier 0 is an empty lot. */
export function tierOf(level) {
  const lvl = Math.max(0, Math.min(10, level | 0));
  if (lvl <= 0) return 0;
  if (lvl <= 3) return 1;
  if (lvl <= 7) return 2;
  return 3;
}

export const MAX_TIER = 3;

/* ---------------- infrastructure ----------------
   The compound's own fabric — wall, gate, towers — is not a facility you buy.
   It reflects how developed the guild is overall, so it is driven by the MEAN
   facility level: invest broadly and the whole place visibly hardens from a
   staked timber palisade into a fortified stone curtain wall. */

/* A brand-new guild is a few huts in a field — it has not earned a wall, and
   even a palisade reads as too much fortification for level 1. Nothing encloses
   the compound until it is genuinely established; the early tiers just mark
   where the land ends. */
export const INFRA_TIERS = [
  { name: 'Open Ground',     minAvg: 0,   wall: 'none' },
  { name: 'Marked Bounds',   minAvg: 2,   wall: 'markers' },
  { name: 'Timber Palisade', minAvg: 4,   wall: 'timber' },
  { name: 'Stone Curtain',   minAvg: 6.5, wall: 'stone' },
  { name: 'Bastion',         minAvg: 8.5, wall: 'bastion' }
];

/** Mean level across the upgradable facilities (town structures excluded —
 *  they never level, so counting them would permanently drag the average). */
export function averageFacilityLevel(levels = {}) {
  const ids = STRUCTURES.filter(s => s.facility).map(s => s.id);
  if (!ids.length) return 0;
  return ids.reduce((n, id) => n + (levels[id] ?? 0), 0) / ids.length;
}

/** Infrastructure tier index (0-4) for a set of facility levels. */
export function infraTierOf(levels = {}) {
  const avg = averageFacilityLevel(levels);
  let t = 0;
  for (let i = 0; i < INFRA_TIERS.length; i++) if (avg >= INFRA_TIERS[i].minAvg) t = i;
  return t;
}

/** How far the grass and scatter extend beyond the wall. */
export const OUTSKIRTS = { margin: 46, propCount: 190 };

/** Ground extent of the walled compound, and where the gate breaks the wall.
 *
 *  Wide and shallow on purpose. The camera looks straight down -z (see CAM
 *  below), so depth is foreshortened by the pitch while width is not — a square
 *  compound would read as a letterbox. */
export const COMPOUND = {
  halfW: 40,
  halfD: 30,
  wallH: 2.6,
  gate: { x: 0, z: 30, width: 8 },
  plaza: { x: 0, z: 6, radius: 9 },
  /** Orthographic zoom that frames the whole compound. The dungeon's default
   *  (9.67) shows ~11 tiles of height — far too tight for a 70-unit yard. */
  camZoom: 1.32,
  themeKey: 'holdfast'
};

/** The compound's fixed camera pose.
 *
 *  yaw 0 — NOT the dungeon's 45°. A 45° yaw is what makes a scene read as
 *  isometric: the ground grid turns into a diamond and every building is seen
 *  on its corner. The SNES-JRPG interior camera this is aiming for looks
 *  straight down the world's north axis, so buildings present their front
 *  face square to the screen and the compound reads north-south.
 *
 *  This is also what paper-doll art requires: a billboard sprite only looks
 *  correct from the angle it was drawn for, and it is drawn face-on. */
export const CAM = {
  yaw: 0,
  pitch: 0.62
};

/**
 * Every structure in the compound.
 *
 * - `facility`  key into FACILITY_DEFINITIONS (guild.js), or null for the
 *               town structures that have no upgrade track.
 * - `kind`      silhouette family the scene builder draws.
 * - `opens`     which panel/flow a click ultimately leads to.
 */
export const STRUCTURES = [
  /* Plots are spaced for the ENDGAME, not for opening day.
     A level-1 facility is a four-metre hut and a level-10 one is a
     seventeen-metre hall — the art grows by two and a half times linearly — so
     a layout that looks cosy at level 1 has buildings clipping through each
     other by level 8. Fixed plots on generous centres is how a real town works:
     the gaps early on read as room to grow, and the compound fills in as the
     guild does. Columns sit on x = +/-14 and +/-30, rows on z = -24, -6, 16. */

  /* ── back row (far from camera) ─────────────────────────────────────────
     Tall, ceremonial buildings go here: they read against the sky and they
     are the least often clicked, so losing their lower half behind the middle
     row costs nothing. */
  {
    id: 'academy', facility: 'academy', kind: 'hall', opens: 'facility',
    name: 'The Academy', x: -30, z: -24, w: 12, d: 7,
    heroSlots: [{ dx: -2.0, dz: 4.4 }, { dx: 2.0, dz: 4.4 }]
  },
  {
    id: 'enchanter', facility: 'enchanter', kind: 'spire', opens: 'facility',
    name: "Enchanter's Spire", x: -14, z: -24, w: 11, d: 7,
    heroSlots: [{ dx: -2.2, dz: 4.6 }]
  },
  {
    id: 'crypt', facility: 'crypt', kind: 'crypt', opens: 'facility',
    name: 'The Crypt', x: 14, z: -24, w: 12, d: 7,
    heroSlots: [{ dx: 0, dz: 4.4 }]
  },
  {
    id: 'war_room', facility: 'war_room', kind: 'hall', opens: 'facility',
    name: 'The War Room', x: 30, z: -24, w: 13, d: 7,
    heroSlots: [{ dx: -1.8, dz: 4.4 }, { dx: 1.8, dz: 4.4 }]
  },

  /* ── middle row ─────────────────────────────────────────────────────── */
  {
    id: 'living_quarters', facility: 'living_quarters', kind: 'quarters', opens: 'roster',
    name: 'Living Quarters', x: -30, z: -6, w: 13, d: 8,
    heroSlots: [{ dx: -2.8, dz: 4.8 }, { dx: 0, dz: 5.2 }, { dx: 2.8, dz: 4.8 }]
  },
  {
    id: 'infirmary', facility: 'infirmary', kind: 'hall', opens: 'facility',
    name: 'The Infirmary', x: -14, z: -6, w: 13, d: 7,
    heroSlots: [{ dx: 0, dz: 4.4 }]
  },
  {
    id: 'armory', facility: 'armory', kind: 'hall', opens: 'facility',
    name: 'The Armory', x: 14, z: -6, w: 12, d: 7,
    heroSlots: [{ dx: 0, dz: 4.4 }]
  },
  {
    id: 'blacksmith', facility: 'blacksmith', kind: 'forge', opens: 'facility',
    name: 'The Blacksmith', x: 30, z: -6, w: 11, d: 7,
    heroSlots: [{ dx: -2.2, dz: 4.8 }, { dx: 2.2, dz: 4.8 }]
  },

  /* ── front row (nearest camera) ─────────────────────────────────────────
     Highest-traffic destinations sit closest to the gate and the player, and
     the two inner plots flank the gate road. */
  {
    id: 'cartographer', facility: 'cartographer', kind: 'hall', opens: 'facility',
    name: "Cartographer's Guild", x: -30, z: 16, w: 12, d: 7,
    heroSlots: [{ dx: -1.8, dz: 4.4 }, { dx: 1.8, dz: 4.4 }]
  },
  {
    id: 'merchant', facility: null, kind: 'stall', opens: 'shop',
    name: 'The Merchant', x: -14, z: 16, w: 9, d: 6, alwaysBuilt: true,
    heroSlots: [{ dx: 0, dz: 4.2 }]
  },
  {
    id: 'training_grounds', facility: 'training_grounds', kind: 'yard', opens: 'facility',
    name: 'Training Grounds', x: 14, z: 16, w: 14, d: 9,
    heroSlots: [{ dx: -3.4, dz: 3.2 }, { dx: 0, dz: 3.6 }, { dx: 3.4, dz: 3.2 }]
  },
  {
    id: 'apothecary', facility: 'apothecary', kind: 'hall', opens: 'facility',
    name: 'The Apothecary', x: 30, z: 16, w: 12, d: 7,
    heroSlots: [{ dx: 0, dz: 4.4 }]
  },

  /* ── the plaza ──────────────────────────────────────────────────────────
     The tavern stands alone in the middle, in the gap between the columns and
     between the rows, at the head of the gate road. It is the hub of the
     game's mechanics, so nothing is allowed to stand in front of it. */
  {
    id: 'tavern', facility: null, kind: 'tavern', opens: 'quests',
    name: 'The Tavern', x: 0, z: 4, w: 11, d: 7, alwaysBuilt: true,
    heroSlots: [{ dx: -2.8, dz: 5.0 }, { dx: 0, dz: 5.4 }, { dx: 2.8, dz: 5.0 }]
  },
  {
    id: 'chronicle', facility: null, kind: 'board', opens: 'story',
    name: 'The Chronicle', x: -7, z: 15, w: 2.8, d: 1, alwaysBuilt: true,
    heroSlots: []
  }
];


/** Lookup by id. */
export const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURES.map(s => [s.id, s]));

/** Facing angle for a structure.
 *
 *  Zero by default: every building faces the camera square-on. That is not a
 *  simplification, it is the requirement — paper-doll pixel art is drawn from
 *  one angle, so a building rotated to "face the plaza" would be presenting a
 *  view its sprite does not have. Classic JRPG towns do exactly this: every
 *  structure faces the viewer regardless of where it stands. */
export function rotationOf(s) {
  return typeof s.rot === 'number' ? s.rot : 0;
}

/** Hero slot local offset → world position, applying the structure's rotation. */
export function heroSlotWorld(s, slot) {
  const r = rotationOf(s);
  const c = Math.cos(r), sn = Math.sin(r);
  return {
    x: s.x + slot.dx * c + slot.dz * sn,
    z: s.z - slot.dx * sn + slot.dz * c
  };
}
