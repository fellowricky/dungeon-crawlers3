/* ───────────────────────────── Terrain elevation ──────────────────────────
 * Per-cell terrain height, laid over the flat FLOOR grid after carving.
 *
 * The whole feature rests on one property of this codebase: everything is
 * addressed by (x, z) and `y` is a DERIVED value. Nothing upstream stores a
 * height, so elevation is additive — the ~148 Math.hypot(dx, dz) distance
 * checks in combat/AI keep working unchanged, because a tactics game wants
 * planar distance anyway. What changes is (a) what the renderer draws and
 * (b) which steps pathfinding will take.
 *
 * MODEL
 *   height[c]  signed level, in STEPs, for every FLOOR cell. 0 is the base
 *              plane the dungeon has always been on, so an untouched level is
 *              bit-for-bit the old behaviour.
 *   ramp[c]    marks a cell you may change level on (rendered as a staircase).
 *
 * The traversal rule (canStep) is the smallest one that reads correctly: move
 * freely between cells at the same level, move one level only across a stair,
 * and NEVER move two levels. That last clause is load-bearing rather than a
 * limitation — a 2-level boundary is an impassable cliff, which is how a plan
 * gets real high ground that has to be walked around.
 *
 * ARCHETYPES
 * Rooms are shaped by a named plan (ziggurat, amphitheatre, terraces, …) that
 * assigns a level per cell. Plans are multi-tier: the first version of this
 * emitted a single +1 or -1 platform per room, and no amount of shape variety
 * hid the fact that every room was one step up or one step down.
 *
 * INVARIANT: elevation never disconnects the level. Plans are applied
 * speculatively, stairs are carved until every floor cell is reachable, and
 * the whole plan is rolled back if that proves impossible.
 */

import { FLOOR, POOL } from './dungeon_generator.js';

/* Shared empty result for footprintOf, so the hot path never allocates. */
const EMPTY_CELLS = [];

/* World units per height level. Dungeon walls stand ~2.0, so 0.45 puts one
 * step a touch above waist height on a human sprite: readable as a change of
 * level from the fixed ~37° camera, shallow enough that a tier never hides
 * the party behind it. */
export const STEP = 0.45;

/* A summit three steps up is 1.35 — two thirds of wall height, about as tall
 * as terrain can get before it occludes the room behind it. */
export const MAX_LEVEL = 3;
export const MIN_LEVEL = -2;

/* Rooms below this on their short axis have no room for tiers AND a walkable
 * rim AND stairs, and come out as noise rather than terrain. */
const MIN_ROOM_SPAN = 7;

/** Height of a cell, 0 when the level has no elevation data. */
export function heightOf(d, cell) {
  if (!d || !d.height || cell < 0 || cell >= d.height.length) return 0;
  return d.height[cell];
}

/** World-space Y for a cell. The single conversion from level to Y. */
export function worldYOf(d, cell) {
  return heightOf(d, cell) * STEP;
}

/* How many levels a body may climb or drop UNAIDED when the caller grants a
   free-climb allowance. Exploration passes this; combat does not, because in
   combat the terrain is supposed to cost you something. See canStep. */
export const FREE_CLIMB = 2;

/**
 * May a body move directly from cell `a` to cell `b`?
 *
 * Purely a height question — callers layer this on their own walkability
 * checks (FLOOR, solid props, bodies, doors). Cells are assumed adjacent.
 *
 * `climb` is the number of levels the mover may cross with no stair at all.
 * At the default 0 the strict tactical rule applies: one level, and only over
 * a staircase. Exploration passes FREE_CLIMB so the party can hop a ledge
 * instead of trekking to the nearest steps — safe to relax precisely because
 * the strict rule is what the level is BUILT against (test/pathability), so a
 * body that climbed somewhere always has a stairs-only route back out.
 */
export function canStep(d, a, b, climb = 0) {
  if (!d || !d.height) return true;          // flat level: nothing to say
  const dh = d.height[b] - d.height[a];
  if (dh === 0) return true;
  const rise = dh < 0 ? -dh : dh;
  if (climb > 0) return rise <= climb;       // scramble up, or drop down
  if (rise !== 1) return false;              // two levels is a cliff, not a step
  return !!(d.ramp[a] || d.ramp[b]);
}

/* ─────────────────────────────── archetypes ───────────────────────────────
 * Each returns { name, tiers, levelAt(x, y) } for a room. levelAt works in
 * absolute grid coords and may return any level; the caller clamps.
 *
 * Plans deliberately do NOT worry about stairs or connectivity — carveStairs
 * and the rollback in buildElevation handle that generically, so a plan is
 * free to describe the shape it wants and let the machinery make it legal.
 */

const clampLevel = (v) => Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(v)));

/* Concentric tiers stepping up to a summit. The signature "look at me" room:
   a boss stands on top and the party fights up the terraces. */
function planZiggurat(r, rng) {
  const span = Math.min(r.w, r.h);
  const tiers = span >= 15 ? 3 : span >= 11 ? 2 : 1;
  const band = Math.max(2, Math.floor((span / 2) / (tiers + 1)));
  const cx = Math.round(r.cx), cy = Math.round(r.cy);
  return {
    name: 'ziggurat', tiers,
    levelAt: (x, y) => {
      const cheb = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      return clampLevel(tiers - Math.floor(cheb / band));
    }
  };
}

/* The inverse: tiers descending to a sunken floor. Reads as an arena — the
   fight happens down in the bowl and the rim is the good ground. */
function planAmphitheatre(r, rng) {
  const span = Math.min(r.w, r.h);
  const tiers = span >= 14 ? 2 : 1;
  const band = Math.max(2, Math.floor((span / 2) / (tiers + 1)));
  const cx = Math.round(r.cx), cy = Math.round(r.cy);
  return {
    name: 'amphitheatre', tiers,
    levelAt: (x, y) => {
      const cheb = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      return clampLevel(-(tiers - Math.floor(cheb / band)));
    }
  };
}

/* A hillside: parallel steps marching across the room's long axis. The most
   tactical shape — a clean firing line at every level. */
function planTerraces(r, rng) {
  const horiz = r.w >= r.h;
  const span = horiz ? r.w : r.h;
  const tiers = span >= 16 ? 3 : 2;
  const band = Math.max(2, Math.floor(span / (tiers + 1)));
  const lo = Math.round(horiz ? r.cx - r.w / 2 : r.cy - r.h / 2);
  const flip = rng.chance(0.5);
  return {
    name: 'terraces', tiers,
    levelAt: (x, y) => {
      const v = (horiz ? x : y) - lo;
      const t = Math.min(tiers, Math.max(0, Math.floor(v / band)));
      return clampLevel(flip ? tiers - t : t);
    }
  };
}

/* A raised walkway crossing a sunken floor. Creates high ground that splits
   the room — the causeway is a chokepoint you can be shot from. */
function planCauseway(r, rng) {
  const horiz = r.w >= r.h;
  const half = Math.max(1, Math.floor(rng.f(1, 2.4)));
  const mid = Math.round(horiz ? r.cy : r.cx);
  return {
    name: 'causeway', tiers: 2,
    levelAt: (x, y) => {
      /* Graded shoulder between walkway and floor. Without it the +1 deck sits
         Δ2 above the -1 floor along its whole length, no Δ1 frontier exists
         anywhere, and carveStairs correctly refuses the plan — this archetype
         never once fired before the shoulder was added. */
      const v = Math.abs((horiz ? y : x) - mid);
      if (v <= half) return 1;
      if (v <= half + 1) return 0;
      return -1;
    }
  };
}

/* A central island ringed by a moat, rim back at base level. Four bands and
   three distinct levels in a small footprint — the keep reads as defended
   without ever being sealed off. */
function planMoat(r, rng) {
  const span = Math.min(r.w, r.h);
  const cx = Math.round(r.cx), cy = Math.round(r.cy);
  const island = Math.max(1, Math.floor(span * 0.18));
  const moat = island + Math.max(1, Math.floor(span * 0.12));
  return {
    name: 'moat', tiers: 2,
    levelAt: (x, y) => {
      /* island → bank → moat → rim, each one level apart, so the keep is
         reachable the long way round instead of being sealed by a Δ2 ring. */
      const cheb = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (cheb <= island) return 1;
      if (cheb <= island + 1) return 0;
      if (cheb <= moat) return -1;
      return 0;
    }
  };
}

/* Raised perimeter walkway around a sunken centre — a pillared gallery. Pairs
   with the pillars the generator already rings large rooms with. */
function planGallery(r, rng) {
  const span = Math.min(r.w, r.h);
  const cx = Math.round(r.cx), cy = Math.round(r.cy);
  const inner = Math.max(2, Math.floor(span * 0.30));
  return {
    name: 'gallery', tiers: 2,
    levelAt: (x, y) => {
      /* sunken centre → floor-level walk → raised gallery, one level apiece */
      const cheb = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (cheb <= inner) return -1;
      if (cheb <= inner + 1) return 0;
      return 1;
    }
  };
}

/* Room split along a diagonal — an upthrust slab. Cheap, but it breaks the
   symmetry every concentric plan shares. */
function planSplit(r, rng) {
  const cx = Math.round(r.cx), cy = Math.round(r.cy);
  const sx = rng.chance(0.5) ? 1 : -1, sy = rng.chance(0.5) ? 1 : -1;
  const lift = rng.chance(0.35) ? 2 : 1;
  return {
    name: 'split', tiers: lift,
    levelAt: (x, y) => (sx * (x - cx) + sy * (y - cy) >= 2 ? lift : 0)
  };
}

/* Which plans suit which rooms. Ceremonial rooms get the showpieces; ordinary
   combat rooms get the shapes that make a fight interesting. */
/* Ziggurat is the showpiece and stays ceremonial-only: with it in both pools
   it took 78% of every room on the level, because it succeeds almost always
   and inherited every room whose first pick failed to carve. */
const CEREMONIAL = ['ziggurat', 'moat', 'gallery'];
const COMBAT = ['terraces', 'amphitheatre', 'causeway', 'split', 'gallery'];
const PLANS = {
  ziggurat: planZiggurat, amphitheatre: planAmphitheatre, terraces: planTerraces,
  causeway: planCauseway, moat: planMoat, gallery: planGallery, split: planSplit
};

/**
 * Assign per-cell heights for a generated level.
 *
 * Runs AFTER all carving (rooms, corridors, pools, pits, doorway widening) so
 * it sees the final walkable set, and after prop placement — props take their
 * Y from the cell they stand on at render time, so anything on a tier rides
 * up with it for free.
 *
 * @returns {{height: Int8Array, ramp: Uint8Array, features: Array}}
 */
export function buildElevation(d, rng) {
  const { W, H, grid, roomId, corridor, doorway, rooms, lakeMask, props } = d;
  const total = W * H;
  const height = new Int8Array(total);
  const ramp = new Uint8Array(total);
  const features = [];

  if (!rooms || !rooms.length) return { height, ramp, features };

  const idx = (x, y) => y * W + x;
  const isFloor = (c) => c >= 0 && c < total && grid[c] === FLOOR;
  /* Lake cells are FLOOR carrying a lakeMask flag, NOT the POOL tile — so
     unlike pools they landed inside roomCells() and archetype plans happily
     assigned them tier heights. That gave 12 of 20 lake bodies a STEPPED
     surface and floated some of them two levels above the floor beside them.
     Water is not terrain: plans must not shape it, and it is levelled with the
     pools below. */
  const isLake = (c) => !!(lakeMask && lakeMask[c]);
  const isLiquid = (c) => (c >= 0 && c < total) && (grid[c] === POOL || (grid[c] === FLOOR && isLake(c)));

  const chance = d.params && typeof d.params.elevationChance === 'number'
    ? d.params.elevationChance : 0.62;
  /* An explicit 0 means "flat level", including the ceremonial rooms that
     otherwise skip the roll — otherwise there is no way to turn the feature
     off, which the flat-render regression check (and anyone debugging a
     terrain bug) needs. */
  if (chance <= 0) return { height, ramp, features };

  /* Cells pinned to level 0: corridors, doorways, anything outside a room, and
     the floor around a doorway. Chokepoints must stay flat — a staircase in a
     2-wide corridor is how a party gets wedged — and a plan that runs a tier
     into a door makes the room read as sealed. */
  const pinned = new Uint8Array(total);
  for (let c = 0; c < total; c++) {
    if (!isFloor(c)) continue;
    if (corridor[c] || doorway[c] || roomId[c] < 0) pinned[c] = 1;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = idx(x, y);
      if (!isFloor(c) || !doorway[c]) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = idx(nx, ny);
          if (isFloor(n)) pinned[n] = 1;
        }
      }
    }
  }

  /* ── approach grading ──────────────────────────────────────────────────
     Distance (in steps) from the pinned corridor/doorway network, over walkable
     floor. A plan may then only rise one level per cell of distance from that
     network, which guarantees a Δ1 staircase chain from every doorway into the
     room behind it.
     Without this, connectivity alone was not enough: the whole-map flood only
     asks whether a cell is reachable SOMEHOW, and a door reached via its own
     corridor passes that test even when the room beside it is fenced off by an
     unclimbable face. Measured across 50 levels, that left 421 Δ2+ cliff edges
     sitting directly on door aprons — doors opening onto a 3-high wall, with
     the way in a long walk around. */
  const distPinned = new Int16Array(total).fill(-1);
  {
    const q = new Int32Array(total);
    let qh = 0, qt = 0;
    for (let c = 0; c < total; c++) {
      if (isFloor(c) && pinned[c]) { distPinned[c] = 0; q[qt++] = c; }
    }
    while (qh < qt) {
      const c = q[qh++];
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = idx(nx, ny);
          if (!isFloor(nc) || distPinned[nc] >= 0) continue;
          distPinned[nc] = distPinned[c] + 1;
          q[qt++] = nc;
        }
      }
    }
  }
  /* How far from level 0 a cell is allowed to sit. A cell touching the network
     must stay flat, one further may go a single level, and so on. Cells the
     BFS never reached (walled-off pockets) get the full range. */
  const levelCap = (c) => {
    const dp = distPinned[c];
    if (dp < 0) return MAX_LEVEL;
    return Math.max(0, dp - 1);
  };

  /* Cells with something standing on them. Elevation runs AFTER prop
     placement, so a staircase can be carved right under a pillar. Pathfinding
     now refuses to seal a stair, so this is no longer a stuck-unit bug, but a
     pillar planted in the middle of a staircase still looks wrong. Prefer
     clean ground, and only accept an occupied cell when a tier has no other
     way off it. */
  /* FOOTPRINTS, not anchor cells. A sarcophagus, an altar slab or a wagon
     covers two or three tiles; marking only the tile it is centred on left
     every other tile of it looking like clean ground, so carveStairs cheerfully
     ran a staircase through the far half of the boss coffin. That is how the
     centrepiece of a Grim boss arena ended up walk-through: buildSolidProps
     refuses to mark a stair cell solid (a sealed stair strands a tier), so the
     ramp punched a hole straight through the prop, and whatever cells survived
     were then cleared by its connectivity guard. Measured over 120 grim levels,
     10.7% of all solid props came out non-solid with elevation on against 1.9%
     with it off — the whole gap was this. */
  /* Memoised: a prop's footprint is a pure function of its position, and this
     is asked for it thousands of times a level (every rebuild, every deletion
     scan). Recomputing it each time — a fresh Set and Array per call — was the
     single largest cost this pass added to generation. */
  const fpCache = new Map();
  const footprintOf = (pr) => {
    if (!pr) return EMPTY_CELLS;
    let cells = fpCache.get(pr);
    if (cells) return cells;
    if (typeof d.footprintCells === 'function') {
      cells = d.footprintCells(pr, W, H);
    } else {
      const px = Math.round(pr.x), py = Math.round(pr.y);
      cells = (px < 0 || py < 0 || px >= W || py >= H) ? [] : [py * W + px];
    }
    fpCache.set(pr, cells);
    return cells;
  };
  /* `blocked` is the subset of propAt that pathfinding will treat as
     IMPASSABLE. Terrain has to be planned against it: reachability here was
     computed over bare floor, so a plan could strand a tier behind a pillar
     and still be accepted, leaving buildSolidProps to restore the level the
     only way it can — by deleting the pillar. Flooding through the same
     obstacles the game does means the plan is either carved around them or
     rejected, and the props stay. Doorway cells are excluded to match
     buildSolidProps, which never seals a door. */
  /* The floods below ask "may I stand here?" eight times per cell visited, and
     there are dozens of floods per level. As predicate CALLS that dominated
     generation time; as two byte arrays it is an indexed read. passFree is the
     bare floor and never changes; passOpen tracks `blocked` and is refreshed
     wherever that is written. */
  const passFree = new Uint8Array(total);
  const passOpen = new Uint8Array(total);
  for (let c = 0; c < total; c++) passFree[c] = grid[c] === FLOOR ? 1 : 0;

  const propAt = new Uint8Array(total);
  const blocked = new Uint8Array(total);
  const syncOpen = (c) => { passOpen[c] = passFree[c] && !blocked[c] ? 1 : 0; };
  const isSolidProp = typeof d.isSolidProp === 'function' ? d.isSolidProp : null;
  const rebuildProps = () => {
    propAt.fill(0); blocked.fill(0);
    if (!Array.isArray(props)) { passOpen.set(passFree); return; }
    for (const pr of props) {
      const solidKind = isSolidProp ? !!isSolidProp(pr) : false;
      for (const c of footprintOf(pr)) {
        if (c < 0 || c >= total) continue;
        propAt[c] = 1;
        if (solidKind && !(doorway && doorway[c])) blocked[c] = 1;
      }
    }
    for (let c = 0; c < total; c++) syncOpen(c);
  };
  rebuildProps();
  /* Only one prop's solidity changed, so re-mark just its cells instead of
     sweeping every prop on the level. A cell may be covered by more than one
     prop, so clearing is a re-derive over the overlapping props only. */
  const remarkProp = (pr) => {
    const solidKind = isSolidProp ? !!isSolidProp(pr) : false;
    for (const c of footprintOf(pr)) {
      if (c < 0 || c >= total) continue;
      if (solidKind && !(doorway && doorway[c])) { blocked[c] = 1; continue; }
      let other = false;
      for (const q of props) {
        if (q === pr || !isSolidProp || !isSolidProp(q)) continue;
        if (footprintOf(q).includes(c)) { other = true; break; }
      }
      blocked[c] = (other && !(doorway && doorway[c])) ? 1 : 0;
      syncOpen(c);
    }
  };

  /* When a tier genuinely has no clean way off and a stair must go on an
     occupied cell, clear what is standing there. A pillar in the middle of a
     staircase is wrong however passable it is. Removing a prop frees every
     cell it covered, so the maps are rebuilt from what is left rather than
     having the one cell cleared — otherwise the other half of a two-tile prop
     stayed marked and permanently fenced off a stair site that is now empty. */
  const clearPropsAt = (cell) => {
    if (!Array.isArray(props) || !propAt[cell]) return;
    let removed = false;
    for (let i = props.length - 1; i >= 0; i--) {
      const pr = props[i];
      if (!pr) continue;
      if (footprintOf(pr).includes(cell)) { fpCache.delete(pr); props.splice(i, 1); removed = true; }
    }
    if (!removed) { propAt[cell] = 0; return; }
    rebuildProps();
    propsDirty = true;
  };
  /* Set whenever a prop is deleted: that OPENS cells, so the reachability
     target below has to be re-measured rather than compared against a stale
     smaller number. */
  let propsDirty = false;

  /* Walkable AND not behind a solid prop — the set every flood below works
     over. */
  const open = (c) => isFloor(c) && !blocked[c];


  let floorTotal = 0, seedCell = -1, anyFloorCell = -1;
  for (let c = 0; c < total; c++) {
    if (!isFloor(c)) continue;
    floorTotal++;
    if (anyFloorCell < 0) anyFloorCell = c;
    if (seedCell < 0 && open(c)) seedCell = c;
  }
  if (seedCell < 0 || anyFloorCell < 0) return { height, ramp, features };

  /* ── reachability under the current height/ramp state ──────────────────
     Mirrors findPath exactly: 8-way, no corner cutting, level changes only
     across a stair. Leaves `seen` populated so callers can walk the frontier. */
  const queue = new Int32Array(floorTotal);
  const seen = new Uint8Array(total);
  /* Two views of the same level, and terrain has to survive BOTH.
       avoidProps=false — bare floor, ignoring props. This is the module's
         original contract: every floor cell height-reachable, so a prop is
         only ever an optional obstacle standing on ground you could walk.
       avoidProps=true  — floor minus what pathfinding calls solid. Terrain
         that satisfies only the first can still strand a tier behind a
         pillar, which buildSolidProps then "repairs" by deleting the pillar.
     Leaves `seen` populated so callers can walk the frontier. */
  const flood = (avoidProps = false) => {
    const pass = avoidProps ? passOpen : passFree;
    const start = avoidProps ? seedCell : anyFloorCell;
    seen.fill(0);
    let qh = 0, qt = 0, n = 0;
    queue[qt++] = start; seen[start] = 1;
    while (qh < qt) {
      const c = queue[qh++]; n++;
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = idx(nx, ny);
          if (seen[nc] || !pass[nc]) continue;
          if (ox && oy && (!pass[idx(nx, y)] || !pass[idx(x, ny)])) continue;
          const dh = height[nc] - height[c];
          if (dh !== 0 && (Math.abs(dh) !== 1 || !(ramp[c] || ramp[nc]))) continue;
          seen[nc] = 1; queue[qt++] = nc;
        }
      }
    }
    return n;
  };

  /* How much of the level a body can reach with props in the way. This is the
     bar every plan has to clear, and it is MEASURED rather than assumed to be
     the whole floor: a level may already have pockets sealed by props before
     any terrain exists, and demanding total reachability would reject every
     plan on such a level. Terrain's contract against props is only that it
     must never make reachability WORSE; against bare floor it stays absolute. */
  let reachTarget = flood(true);

  /* ── generic stair carving ─────────────────────────────────────────────
     Flood, then look along the frontier for any cardinal pair one level apart
     with exactly one side reached; put a stair on the LOWER cell and flood
     again. Repeat until everything is reachable, or no frontier remains.
     This replaces the original "pick 1-2 ramps for the one platform", which
     could not describe a multi-tier room at all: a ziggurat needs a stair
     between every pair of adjacent tiers and where those land depends on the
     shape. Letting reachability drive it means any plan, however irregular,
     gets exactly the stairs it needs and no more. */
  /* Box-limited flood, used while carving. Carving originally re-flooded the
     WHOLE map after every single stair — up to 64 full-map floods per plan
     attempt per room, which on a roomCount-50 level meant thousands of them
     and quadrupled dungeon generation time (217ms/level, enough to time out
     the spawn tests). Only this room's cells changed height, so the search
     only ever needs to look at its bounding box; the authoritative global
     check runs once per accepted plan instead of once per stair. */
  const floodBox = (bx0, by0, bx1, by1, rid, avoidProps) => {
    const pass = avoidProps ? passOpen : passFree;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) seen[idx(x, y)] = 0;
    }
    let qh = 0, qt = 0, roomFloor = 0;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const c = idx(x, y);
        if (!pass[c]) continue;
        /* Only THIS room's cells have to come out reachable. A neighbouring
           room's cells, or a corridor clipping the corner of the box, may
           legitimately route around outside it — counting those as failures
           rejected two thirds of all otherwise-valid plans. */
        if (roomId[c] === rid) roomFloor++;
        /* Pinned cells are level 0 and wired to the corridor network, so they
           are the room's anchors to the rest of the map. */
        if (pinned[c] && !seen[c]) { seen[c] = 1; queue[qt++] = c; }
      }
    }
    if (qt === 0) {
      outer: for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const c = idx(x, y);
          if (pass[c]) { seen[c] = 1; queue[qt++] = c; break outer; }
        }
      }
    }
    let n = 0;
    for (let i = 0; i < qt; i++) if (roomId[queue[i]] === rid) n++;
    while (qh < qt) {
      const c = queue[qh++];
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
          const nc = idx(nx, ny);
          if (seen[nc] || !pass[nc]) continue;
          if (ox && oy && (!pass[idx(nx, y)] || !pass[idx(x, ny)])) continue;
          const dh = height[nc] - height[c];
          if (dh !== 0 && (Math.abs(dh) !== 1 || !(ramp[c] || ramp[nc]))) continue;
          seen[nc] = 1; queue[qt++] = nc;
          if (roomId[nc] === rid) n++;
        }
      }
    }
    return { reached: n, roomFloor };
  };

  /* ── generic stair carving ─────────────────────────────────────────────
     Flood the room's box, then look along the frontier for any cardinal pair
     one level apart with exactly one side reached; put a stair on the LOWER
     cell and flood again. Repeat until the box is whole, or no frontier
     remains.
     This replaces the original "pick 1-2 ramps for the one platform", which
     could not describe a multi-tier room at all: a ziggurat needs a stair
     between every pair of adjacent tiers and where those land depends on the
     shape. Letting reachability drive it means any plan, however irregular,
     gets exactly the stairs it needs and no more. */
  const carveStairs = (bx0, by0, bx1, by1, rid, avoidProps) => {
    for (let guard = 0; guard < 32; guard++) {
      const { reached, roomFloor } = floodBox(bx0, by0, bx1, by1, rid, avoidProps);
      if (reached >= roomFloor) return true;
      const cands = [];
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const c = idx(x, y);
          if (!isFloor(c) || !seen[c]) continue;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + ox, ny = y + oy;
            if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
            const n = idx(nx, ny);
            if (!isFloor(n) || seen[n]) continue;
            if (Math.abs(height[n] - height[c]) !== 1) continue;
            /* Stair goes on the lower side; pinned cells may not become one. */
            const low = height[c] < height[n] ? c : n;
            if (pinned[low]) continue;
            cands.push(low);
          }
        }
      }
      if (!cands.length) return false;
      /* Clean ground first; an occupied cell is a last resort. */
      const clear = cands.filter(c => !propAt[c]);
      const pick = clear.length ? clear : cands;
      const chosen = pick[rng.i(0, pick.length - 1)];
      clearPropsAt(chosen);
      ramp[chosen] = 1;
    }
    return false;
  };

  /* Room floor cells, excluding pinned ones. */
  const roomCells = (r) => {
    const out = [];
    const x0 = Math.max(0, Math.floor(r.cx - r.w / 2));
    const x1 = Math.min(W - 1, Math.ceil(r.cx + r.w / 2));
    const y0 = Math.max(0, Math.floor(r.cy - r.h / 2));
    const y1 = Math.min(H - 1, Math.ceil(r.cy + r.h / 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = idx(x, y);
        if (isFloor(c) && !isLake(c) && roomId[c] === r.id && !pinned[c]) out.push(c);
      }
    }
    return out;
  };

  /* ── apply one plan to one room ────────────────────────────────────────
     Speculative: heights and stairs are written, and if the level cannot be
     made whole again the entire room reverts. Stairs are global state, so the
     whole ramp array is snapshotted rather than just this room's cells. */
  const applyPlan = (r, plan, cells) => {
    const prevH = cells.map(c => height[c]);
    const prevR = new Uint8Array(ramp);
    for (const c of cells) {
      const cap = levelCap(c);
      const want = clampLevel(plan.levelAt(c % W, (c / W) | 0));
      height[c] = Math.max(-cap, Math.min(cap, want));
    }
    let changed = false;
    for (let i = 0; i < cells.length; i++) {
      if (height[cells[i]] !== prevH[i]) { changed = true; break; }
    }
    const bx0 = Math.max(0, Math.floor(r.cx - r.w / 2) - 2);
    const bx1 = Math.min(W - 1, Math.ceil(r.cx + r.w / 2) + 2);
    const by0 = Math.max(0, Math.floor(r.cy - r.h / 2) - 2);
    const by1 = Math.min(H - 1, Math.ceil(r.cy + r.h / 2) + 2);
    /* Local carve, then ONE authoritative whole-map check — of BOTH views.
       The prop-respecting carve adds the stairs needed to route AROUND a
       pillar; the prop-free carve adds any still needed to reach the cell the
       pillar stands on. Extra stairs only ever make more moves legal, so
       running the two in sequence is safe. */
    let reachedNow = 0;
    if (!changed
        || !carveStairs(bx0, by0, bx1, by1, r.id, true)
        || !carveStairs(bx0, by0, bx1, by1, r.id, false)
        || flood(false) !== floorTotal
        || (reachedNow = flood(true)) < reachTarget) {
      cells.forEach((c, i) => { height[c] = prevH[i]; });
      ramp.set(prevR);
      /* Props cleared while carving are NOT rolled back with the heights, so a
         rejected attempt can still have opened the level up. */
      if (propsDirty) { reachTarget = flood(true); propsDirty = false; }
      return false;
    }
    reachTarget = reachedNow;
    propsDirty = false;
    let lo = 0, hi = 0, stairs = 0;
    for (const c of cells) {
      if (height[c] < lo) lo = height[c];
      if (height[c] > hi) hi = height[c];
    }
    for (let c = 0; c < total; c++) if (ramp[c] && !prevR[c]) stairs++;
    features.push({ roomId: r.id, kind: plan.name, tiers: plan.tiers,
                    low: lo, high: hi, cells: cells.length, stairs });
    return true;
  };

  for (const r of rooms) {
    /* The entrance stays flat: it is the first thing a player sees and where
       the camera snaps on spawn. */
    if (r.type === 'entrance') continue;
    if (Math.min(r.w, r.h) < MIN_ROOM_SPAN) continue;

    const cells = roomCells(r);
    if (cells.length < 12) continue;

    const ceremonial = r.type === 'shrine' || r.type === 'boss' || r.type === 'treasure';
    if (!ceremonial && !rng.chance(chance)) continue;

    /* Concentric plans need room for three distinct rings; below that their
       tiers just clamp into each other. */
    const span = Math.min(r.w, r.h);
    const pool = (ceremonial ? CEREMONIAL : COMBAT)
      .filter(n => (n !== 'moat' && n !== 'gallery') || span >= 11);
    if (!pool.length) continue;

    /* Try plans in shuffled order so a room that cannot host its first pick
       (usually because the stairs cannot be carved) still gets terrain. */
    const order = pool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.i(0, i);
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (const name of order) {
      const plan = PLANS[name](r, rng);
      if (plan && applyPlan(r, plan, cells)) break;
    }
  }

  /* ── liquids follow the terrain ────────────────────────────────────────
     POOL cells are not FLOOR, so no plan ever touches them and they stayed at
     level 0 while the floor around them moved: in molten/frost/grim/verdant a
     third of all pool cells ended up beside elevated ground, deviating by as
     much as three levels — lava slabs hanging in mid-air, or buried.
     Each liquid BODY — pools and lakes alike, and a pool touching a lake counts
     as one body — is levelled as a unit (flood 8-way, take the lowest adjacent
     floor level) so its surface stays flat, which is the one thing a liquid
     must be. Lowest rather than average because water pools at the
     bottom of a depression, and a body that straddles tiers should read as
     filling the deeper one. */
  const poolSeen = new Uint8Array(total);
  const body = [];
  for (let start = 0; start < total; start++) {
    if (!isLiquid(start) || poolSeen[start]) continue;
    body.length = 0;
    let qh = 0;
    body.push(start); poolSeen[start] = 1;
    let lowest = null;
    /* The body is bound by the SAME approach grading as terrain. Without this
       a lake overlapping a doorway apron was levelled to its lowest neighbour
       and dragged the apron off level 0 with it, re-opening the unclimbable-
       face-beside-a-door bug from the other direction. */
    let cap = MAX_LEVEL;
    while (qh < body.length) {
      const c = body[qh++];
      const cc = levelCap(c);
      if (cc < cap) cap = cc;
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = idx(nx, ny);
          if (isLiquid(nc)) {
            if (!poolSeen[nc]) { poolSeen[nc] = 1; body.push(nc); }
          } else if (grid[nc] === FLOOR) {
            if (lowest === null || height[nc] < lowest) lowest = height[nc];
          }
        }
      }
    }
    if (lowest !== null) {
      const lv = Math.max(-cap, Math.min(cap, lowest));
      for (const c of body) height[c] = lv;
    }
  }

  /* ── containment: raised water needs banks to hold it ──────────────────
     A liquid may legitimately sit above the floor beside it — a body pinned to
     the doorway network cannot always drop to its lowest neighbour — but then
     it has to be HELD there. Water whose surface is higher than the ground at
     its edge reads as spilling over a lip into thin air.
     So wherever a body sits above an adjacent floor cell, raise that cell to
     the waterline and it becomes the bank. Where the approach grading forbids
     that (too near a doorway to be lifted), the water gives way instead and
     drops to meet the ground. Grading is what keeps this from re-breaking the
     door rule: an apron cell has a cap of 0, so it can never be raised into a
     bank. */
  const preH = new Int8Array(height), preR = new Uint8Array(ramp);
  const contSeen = new Uint8Array(total);
  for (let start = 0; start < total; start++) {
    if (!isLiquid(start) || contSeen[start]) continue;
    const cells = [];
    let qh = 0;
    cells.push(start); contSeen[start] = 1;
    while (qh < cells.length) {
      const c = cells[qh++];
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = idx(nx, ny);
          if (isLiquid(nc) && !contSeen[nc]) { contSeen[nc] = 1; cells.push(nc); }
        }
      }
    }
    let L = height[cells[0]];
    /* Two passes: the first may lower the waterline, so banks are only
       committed once L has settled. */
    for (let pass = 0; pass < 2; pass++) {
      const banks = [];
      let forcedDown = null;
      for (const c of cells) {
        const x = c % W, y = (c / W) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nc = idx(nx, ny);
            if (!isFloor(nc) || isLiquid(nc) || height[nc] >= L) continue;
            if (L <= levelCap(nc)) banks.push(nc);
            else if (forcedDown === null || height[nc] > forcedDown) forcedDown = height[nc];
          }
        }
      }
      if (forcedDown !== null && forcedDown < L) { L = forcedDown; continue; }
      for (const c of cells) height[c] = L;
      for (const b of banks) height[b] = L;
      break;
    }
  }

  /* Raising banks can wall off a tier, so re-open the level and roll the whole
     containment pass back if it cannot be made whole again. */
  /* Ordered so the FAILING check is the one that leaves `seen` populated —
     the repair loop below walks that frontier to find where to cut a stair. */
  const contained = () => flood(true) >= reachTarget && flood(false) === floorTotal;
  let ok = contained();
  for (let guard = 0; guard < 48 && !ok; guard++) {
    const cands = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = idx(x, y);
        if (!isFloor(c) || !seen[c]) continue;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = idx(nx, ny);
          if (!isFloor(n) || seen[n]) continue;
          if (Math.abs(height[n] - height[c]) !== 1) continue;
          const low = height[c] < height[n] ? c : n;
          if (pinned[low]) continue;
          cands.push(low);
        }
      }
    }
    if (!cands.length) break;
    const clearC = cands.filter(c => !propAt[c]);
    const pickC = clearC.length ? clearC : cands;
    const chosenC = pickC[rng.i(0, pickC.length - 1)];
    clearPropsAt(chosenC);
    ramp[chosenC] = 1;
    ok = contained();
  }
  if (!ok) { height.set(preH); ramp.set(preR); } else { reachTarget = flood(true); }

  /* ── podiums ───────────────────────────────────────────────────────────
     An altar slab is not a wall to walk around, it is a step to walk ONTO.
     Expressing that as TERRAIN rather than as a prop flag is what makes it
     mean anything: the cells it covers go up a level, so standing on the altar
     is real high ground and every rule already written against elevation —
     canStep, the AI's tactics, line of sight — applies to it unchanged, with
     no new special case.

     Runs LAST, after the room plans and after the liquid levelling and its
     rollback, so nothing downstream can reshape a podium back out of one
     plane — the containment pass raising a bank cell to a waterline was doing
     exactly that.

     Speculative like a plan: an altar that cannot be raised without stranding
     something stays flat, keeps no `podium` flag, and so goes on being a solid
     obstacle (see PODIUM_PROP_KINDS) — the fallback is the old behaviour, never
     a walk-through. The prop is marked walkable BEFORE the floods, because from
     the moment it is a podium it is floor as far as pathfinding is concerned. */
  const PODIUM_KINDS = new Set(['altarTable']);
  if (Array.isArray(props)) {
    for (const pr of props) {
      if (!pr || !PODIUM_KINDS.has(pr.kind)) continue;
      const cells = footprintOf(pr).filter(c => isFloor(c) && !isLiquid(c));
      if (!cells.length) continue;
      /* A podium needs ONE surface to stand on, so it may not straddle a level
         change, sit on a staircase, or lift a cell the doorway grading pins. */
      if (cells.some(c => pinned[c] || ramp[c])) continue;
      const base = height[cells[0]];
      if (cells.some(c => height[c] !== base)) continue;
      const want = base + 1;
      if (want > MAX_LEVEL || cells.some(c => want > levelCap(c))) continue;

      /* Turning the altar from wall into floor OPENS the cells it covers, so
         the bar rises by exactly that many — no re-flood needed to find the
         new target. Cells another solid prop also covers stay blocked and do
         not count. An altar whose opened cells cannot then be reached falls
         short of the bar and is correctly refused: an unreachable podium is
         not a podium. */
      const wasBlocked = cells.map(c => blocked[c]);
      pr.podium = 1;
      remarkProp(pr);
      let opened = 0;
      for (let i = 0; i < cells.length; i++) {
        if (wasBlocked[i] && !blocked[cells[i]]) opened++;
      }
      const target = reachTarget + opened;
      const prevH = cells.map(c => height[c]);
      const prevR = new Uint8Array(ramp);
      for (const c of cells) height[c] = want;

      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (const c of cells) {
        const x = c % W, y = (c / W) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      bx0 = Math.max(0, bx0 - 2); by0 = Math.max(0, by0 - 2);
      bx1 = Math.min(W - 1, bx1 + 2); by1 = Math.min(H - 1, by1 + 2);
      const rid = roomId[cells[0]];

      if (!carveStairs(bx0, by0, bx1, by1, rid, true)
          || !carveStairs(bx0, by0, bx1, by1, rid, false)
          || flood(false) !== floorTotal
          || flood(true) < target) {
        cells.forEach((c, i) => { height[c] = prevH[i]; });
        ramp.set(prevR);
        delete pr.podium;
        remarkProp(pr);
        reachTarget = flood(true);
        propsDirty = false;
        continue;
      }
      reachTarget = target;
      propsDirty = false;
      /* Whatever was standing ON the altar was offset by the slab's own height.
         A podium's top face is flush with the tier instead, so that offset now
         hangs it in the air — drop it onto the new surface. */
      const ax = Math.round(pr.x), ay = Math.round(pr.y);
      for (const q of props) {
        if (!q || q === pr || !q.oy) continue;
        if (Math.round(q.x) === ax && Math.round(q.y) === ay) q.oy = 0;
      }
      features.push({ roomId: rid, kind: 'podium', tiers: 1,
                      low: base, high: want, cells: cells.length, stairs: 0 });
    }
  }

  /* ── redundancy: a second way up ───────────────────────────────────────
     carveStairs is minimal by construction — it stops the moment the room is
     whole, so a three-tier room routinely ends up with ONE staircase per tier
     boundary. That is connected but miserable to walk: every route across the
     room funnels through the same square, and a body coming the other way, or
     a prop beside the steps, turns a short walk into a lap of the room.
     So once the level is settled we go back and roughly DOUBLE the count,
     adding optional stairs at Δ1 boundaries that already exist. This can only
     ever make more moves legal, never fewer, which is why it is safe to run
     after the connectivity guarantee rather than inside it. */
  if (ok) {
    let base = 0;
    for (let c = 0; c < total; c++) if (ramp[c]) base++;
    if (base) {
      /* Chebyshev distance to the nearest existing staircase, so we can place
         the spares where the walk is currently worst rather than beside the
         steps that are already there. */
      const dist = new Int32Array(total).fill(-1);
      const q = new Int32Array(total);
      let qh = 0, qt = 0;
      for (let c = 0; c < total; c++) if (ramp[c]) { dist[c] = 0; q[qt++] = c; }
      while (qh < qt) {
        const c = q[qh++];
        const x = c % W, y = (c / W) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nc = idx(nx, ny);
            if (dist[nc] >= 0) continue;
            dist[nc] = dist[c] + 1; q[qt++] = nc;
          }
        }
      }

      /* A cell qualifies if it is the LOW side of a one-level cardinal step —
         the same shape carveStairs looks for. Props are skipped outright: an
         optional staircase is never worth deleting scenery for. */
      const spares = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = idx(x, y);
          if (!isFloor(c) || ramp[c] || pinned[c] || propAt[c]) continue;
          if (dist[c] < 2) continue;               // too close to a stair we have
          let boundary = false;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const n = idx(nx, ny);
            if (isFloor(n) && height[n] - height[c] === 1) { boundary = true; break; }
          }
          if (boundary) spares.push(c);
        }
      }
      /* Furthest-first, cell index breaking ties so the level stays a pure
         function of its seed. */
      spares.sort((a, b) => (dist[b] - dist[a]) || (a - b));
      let added = 0;
      for (const c of spares) {
        if (added >= base) break;
        /* Keep the spares apart from each other too, or the sort hands us a
           cluster of adjacent treads reading as one very wide staircase. */
        let near = false;
        const x = c % W, y = (c / W) | 0;
        for (let oy = -1; oy <= 1 && !near; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (ramp[idx(nx, ny)]) { near = true; break; }
          }
        }
        if (near) continue;
        ramp[c] = 1; added++;
      }
      /* Deliberately NOT pushed into `features`: that list describes room
         archetypes (kind/tiers/low/high) and every consumer reads those
         fields. Spares are level-wide, not a room's shape. */
    }
  }

  return { height, ramp, features };
}

/* How fast a body's rendered Y catches up with the ground under it, per
   second of exponential approach. See easeBodyY. */
const BODY_Y_RATE = 16;

/**
 * Ease a body's rendered Y toward the ground height beneath it.
 *
 * groundY interpolates only in the neighbourhood of a staircase, which was
 * correct while a stair was the ONLY way to change level. Free climbing broke
 * that assumption: a body crossing an unstaired ledge would jump a whole STEP
 * between one frame and the next. Easing the Y (and only the Y — X and Z stay
 * exact, so a body never lags its own logical position) turns that back into a
 * hop. Large deltas pass straight through, so a teleport or a respawn still
 * places instantly instead of gliding across the room.
 */
export function easeBodyY(cur, want, dt) {
  const d = want - cur;
  if (d < 0.002 && d > -0.002) return want;
  if (d > 2 || d < -2) return want;              // placement, not locomotion
  return cur + d * Math.min(1, (dt || 0) * BODY_Y_RATE);
}

/**
 * World-space ground Y at a continuous world position.
 *
 * Ledges must read as crisp steps and stairs as smooth climbs, which pull in
 * opposite directions: interpolating everywhere turns every ledge into a
 * gentle hill, interpolating nowhere makes a body pop up a whole STEP as it
 * walks onto a stair. So we interpolate ONLY in the neighbourhood of a stair —
 * the one place a gradual change is what the geometry actually shows.
 *
 * @param d dungeon (needs W,H,height,ramp,grid); flat/absent data returns 0
 * @param x,z world coordinates (as stored on every entity)
 */
export function groundY(d, x, z) {
  if (!d || !d.height) return 0;
  const { W, H, height, ramp } = d;
  const gx = x + W / 2 - 0.5, gz = z + H / 2 - 0.5;
  const cx = Math.round(gx), cz = Math.round(gz);
  if (cx < 0 || cz < 0 || cx >= W || cz >= H) return 0;
  const at = (ax, az) => {
    if (ax < 0 || az < 0 || ax >= W || az >= H) return null;
    return az * W + ax;
  };
  const c = cz * W + cx;

  let nearRamp = !!ramp[c];
  if (!nearRamp) {
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = at(cx + ox, cz + oz);
      if (n !== null && ramp[n]) { nearRamp = true; break; }
    }
  }
  if (!nearRamp) return height[c] * STEP;

  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const tx = gx - x0, tz = gz - z0;
  const hAt = (ax, az) => {
    const n = at(ax, az);
    return n === null ? height[c] : height[n];
  };
  const h00 = hAt(x0, z0), h10 = hAt(x0 + 1, z0);
  const h01 = hAt(x0, z0 + 1), h11 = hAt(x0 + 1, z0 + 1);
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return (a + (b - a) * tz) * STEP;
}
