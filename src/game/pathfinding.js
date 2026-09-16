/**
 * Grid pathfinding and local movement helpers.
 *
 * Methods are mixed onto Game — they expect `this.D`, `this.cellOf`,
 * `this.wx` / `this.wz`, and FLOOR/WALL tile constants on the dungeon grid.
 */
import { FLOOR, WALL, POOL, CHOKEPOINT_COST, HAZARD_COST, ALLY_PASS_COST, CLIMB_COST, AGENT_R, TIGHT_R } from './constants.js';
import { isPointInAoEZone } from './aoe_system.js';
import { canStep, groundY, FREE_CLIMB } from '../dungeon/elevation.js';
import { WILD_SHAPE_FORMS } from './srd.js';
import { Motion } from './motion_debug.js';

/** Precompute wall-adjacency for BFS tiebreaking (prefer centre-room paths). */
/* ── Flight ───────────────────────────────────────────────────────────────
 * POOL is a hole in the walkable set: water, bog and lava are all "not FLOOR",
 * which is why every ground check in here reads `grid[c] === FLOOR`. A creature
 * with the `flying` tag is the one thing that hole does not stop — a stirge or
 * an imp crosses the mere instead of trudging round it.
 *
 * Three kinds of body can have it, and each keeps it in its own place:
 *   - monsters carry the tag in their stat block (monsters.json
 *     `tags: ["flying"]`), which is what the bestiary edits;
 *   - familiars and other summons get a plain `flying: true` on the hero-shaped
 *     record their factory builds (an owl and an imp fly, a viper does not);
 *   - a druid borrows it from the shape they are wearing, so it is DERIVED from
 *     the active form rather than copied onto the hero — the form is already
 *     the source of truth for AC, HP and attacks everywhere else, and a copied
 *     flag would be one more thing to remember to clear on revert.
 * A mover with no data — or none passed at all — is grounded, which is what
 * keeps ordinary heroes on the old rules. */
export function canFly(mover) {
  const d = mover && mover.data;
  if (!d) return false;
  if (d.flying === true) return true;
  if (d.inWildShape && d.wildShapeActiveForm) {
    const form = WILD_SHAPE_FORMS[d.wildShapeActiveForm];
    if (form && form.flying) return true;
  }
  return Array.isArray(d.tags) && d.tags.indexOf('flying') !== -1;
}

/* Ground a body of this kind may occupy: FLOOR for everyone, POOL as well for
   a flyer. `flies` is resolved once by the caller and passed in — this runs per
   neighbour inside Dijkstra's inner loop, so the tag lookup must not happen
   per cell. */
export function isGroundFor(grid, cell, flies) {
  const t = grid[cell];
  return t === FLOOR || (flies && t === POOL);
}

export function buildWallAdj(grid, W, H) {
  const total = W * H;
  const wallAdj = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (grid[i] !== FLOOR) continue;
    const x = i % W;
    if ((x > 0 && grid[i - 1] !== FLOOR) ||
        (x < W - 1 && grid[i + 1] !== FLOOR) ||
        (i >= W && grid[i - W] !== FLOOR) ||
        (i < total - W && grid[i + W] !== FLOOR)) {
      wallAdj[i] = 1;
    }
  }
  return wallAdj;
}

/** Precompute chokepoint cells: any floor cell with ≥ 2 adjacent walls
 *  is considered "tight" — this catches doorways, 1-wide corridors,
 *  corridor turns, and cells pinched between pillars.  The BFS uses
 *  this to prefer wider paths, and followers slow down when the leader
 *  is in one of these cells to avoid doorway jams. */
export function buildChokepoints(grid, W, H) {
  const total = W * H;
  const ch = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (grid[i] !== FLOOR) continue;
    const x = i % W;
    let walls = 0;
    if (x === 0 || grid[i - 1] !== FLOOR) walls++;
    if (x === W - 1 || grid[i + 1] !== FLOOR) walls++;
    if (i < W || grid[i - W] !== FLOOR) walls++;
    if (i >= total - W || grid[i + W] !== FLOOR) walls++;
    if (walls >= 2) ch[i] = 1;
  }
  return ch;
}

/** Prop kinds that act as impassable solid obstacles (pillars, tables, coffins, etc.).
 *  Small scatter (skeletons, bones, debris, rocks, moss, plant scatter) remain walkable. */
export const SOLID_PROP_KINDS = new Set([
  /* altarTable is solid only as a FALLBACK — see PODIUM_PROP_KINDS below. */
  'pillar', 'pillarA', 'pillarB', 'table', 'altarTable', 'coffin', 'sarco',
  'statue', 'tombstone', 'chest', 'shrineCrystal', 'forge',
  'iceThrone', 'sporePod', 'megalith', 'cauldron', 'wagon', 'bookshelf',
  'weaponRack', 'shieldRack', 'brazier', 'crate', 'barrel', 'urn', 'vase',
  'bench', 'chair', 'globe', 'anvil', 'ossuaryWall', 'runicObelisk',
  'glacialSpire', 'stalagmite', 'hearthPit', 'smeltingCrucible', 'cairn',
  'skulltotem', 'boulderPile', 'tree', 'snowtree', 'tree_winter', 'swamptree', 'deadtree',
  'alchemyBench', 'mammothTusks', 'lectern', 'grainjars', 'scrollshelf',
  /* Waist-or-taller obstacles that render as real blockers but were never
     listed here, so they stayed walk-through: a fallen log, a tree stump, a
     large bone, stake/rack/campfire clutter, and the grim bone totem and
     headstone. Deliberately NOT solid: sepulcherDais (a raised platform the
     boss sarco stands ON — sealing it walls off the arena centre), bossCrystal
     (the floor exit, which has to be walked up to), bridgeRailing/woodRailing
     (placed on the bridge DECK cell with a visual offset, so marking them would
     sever the bridge), fren1-4 (ferns — they scatter through the same
     propScatter channel as moss, mushroom caps and roots, all ground cover),
     and the rest of the soft/flat scatter (bush, vinemound, ingotStack,
     signposts, wheel). */
  'boneTotem', 'grave', 'mushroomLog',
  'stump', 'rack', 'goblinfire', 'icebone', 'stakes',
  'cage', 'cage2', 'throne'
]);

/** Props that are meant to be climbed rather than walked around. buildElevation
 *  raises the cells one of these covers by a level and stamps `podium` on it;
 *  from then on the prop IS the tier's top surface, so it must stop being an
 *  obstacle or nothing could ever stand on it. An altar the terrain pass could
 *  not raise (too near a doorway, straddling a level change, or on a level with
 *  elevation switched off) keeps no `podium` flag and stays solid exactly as
 *  before — the fallback is the old behaviour, never a walk-through. */
export const PODIUM_PROP_KINDS = new Set(['altarTable']);

/** The subset of SOLID_PROP_KINDS tall and opaque enough to stop SIGHT, not
 *  merely feet. Collision and vision are separate questions: you cannot walk
 *  through a coffin, a table or a barrel, but you can see over all three, and
 *  a creature standing behind one is not hidden by it.
 *
 *  Keeping the two on one set was invisible while the connectivity guard was
 *  clearing ~85% of solid props — with almost nothing marked, almost nothing
 *  blocked sight. Once props actually stayed solid, 35.6% of same-room sight
 *  lines (2-12 units, sampled over 12 dungeons) were blocked, about half of
 *  them by waist-high furniture: monsters stopped seeing heroes across a room
 *  with a table in it, and any field-of-view built on hasLOS would punch holes
 *  in a room's reveal behind every chair. Restricted to this list it is 17.7%,
 *  which is the pillars and statues genuinely standing in the way. */
export const SIGHT_BLOCKING_KINDS = new Set([
  'pillar', 'pillarA', 'pillarB', 'statue', 'bookshelf', 'scrollshelf', 'megalith',
  'runicObelisk', 'glacialSpire', 'stalagmite', 'ossuaryWall',
  'tree', 'snowtree', 'tree_winter', 'swamptree', 'deadtree',
  'boneTotem', 'skulltotem', 'iceThrone', 'throne', 'forge', 'boulderPile',
  'sporePod', 'wagon'
]);

export const PROP_FOOTPRINTS = {
  // Multi-tile elongated rectangular props: { length: majorAxisLength, width: minorAxisLength }
  sarco:           { length: 1.8, width: 0.95 },
  coffin:          { length: 1.6, width: 0.90 },
  altarTable:      { length: 1.6, width: 0.90 },
  alchemyBench:    { length: 1.4, width: 0.85 },
  wagon:           { length: 2.2, width: 1.30 },
  forge:           { length: 1.8, width: 1.20 },
  smeltingCrucible:{ length: 1.4, width: 1.10 },
  iceThrone:       { length: 1.6, width: 1.20 },
  mammothTusks:    { length: 1.6, width: 0.80 },
  ossuaryWall:     { length: 1.4, width: 0.50 },
  
  // Multi-tile radial props: { radius: R }
  megalith:        { radius: 1.1 },
  boulderPile:     { radius: 1.1 },
  sporePod:        { radius: 0.9 },
  cairn:           { radius: 0.8 },
  tree:            { radius: 0.8 },
  snowtree:        { radius: 0.8 },
  tree_winter:     { radius: 0.8 },
  swamptree:       { radius: 0.8 },
  deadtree:        { radius: 0.8 },

  // Single-tile props:
  table:           { radius: 0.5 },
  bench:           { radius: 0.5 },
  chair:           { radius: 0.4 },
  shieldRack:      { radius: 0.5 },
  weaponRack:      { radius: 0.5 },
  bookshelf:       { radius: 0.5 },
  scrollshelf:     { radius: 0.5 },
  lectern:         { radius: 0.45 },
  grainjars:       { radius: 0.45 },
  statue:          { radius: 0.5 },
  goldBullion:     { radius: 0.35 },
  pillar:          { radius: 0.5 },
  pillarA:         { radius: 0.5 },
  pillarB:         { radius: 0.5 },
  tombstone:       { radius: 0.5 },
  chest:           { radius: 0.5 },
  shrineCrystal:   { radius: 0.5 },
  brazier:         { radius: 0.5 },
  crate:           { radius: 0.5 },
  barrel:          { radius: 0.5 },
  urn:             { radius: 0.4 },
  vase:            { radius: 0.4 },
  globe:           { radius: 0.4 },
  anvil:           { radius: 0.5 },
  runicObelisk:    { radius: 0.5 },
  glacialSpire:    { radius: 0.5 },
  stalagmite:      { radius: 0.5 },
  hearthPit:       { radius: 0.5 },
  skulltotem:      { radius: 0.5 },
  boneTotem:       { radius: 0.45 },
  grave:           { radius: 0.5 },
  mushroomLog:     { radius: 0.5 },
  stump:           { radius: 0.45 },
  rack:            { radius: 0.5 },
  goblinfire:      { radius: 0.5 },
  icebone:         { radius: 0.5 },
  stakes:          { radius: 0.45 }
};

/**
 * Returns an array of grid cell indices occupied by a prop based on its position, rotation, and footprint geometry.
 */
export function getPropFootprintCells(p, W, H) {
  if (!p || !W || !H) return [];
  const cx = Math.round(p.x), cy = Math.round(p.y);
  if (cx < 0 || cx >= W || cy < 0 || cy >= H) return [];
  const centerCell = cy * W + cx;
  
  const fp = PROP_FOOTPRINTS[p.kind];
  if (!fp) return [centerCell];

  const scale = p.scale || 1.0;
  const rot = p.rot || 0;
  const cells = new Set([centerCell]);

  if (fp.length && fp.width) {
    const halfLen = (fp.length * scale) * 0.5;
    const halfWid = (fp.width * scale) * 0.5;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const maxR = Math.ceil(Math.max(halfLen, halfWid));

    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        
        const ox = nx - p.x, oy = ny - p.y;
        const u = Math.abs(ox * cos + oy * sin);
        const v = Math.abs(-ox * sin + oy * cos);
        
        if (u <= halfLen + 0.35 && v <= halfWid + 0.35 && (u <= halfLen || v <= halfWid)) {
          cells.add(ny * W + nx);
        }
      }
    }
  } else if (fp.radius) {
    const rad = fp.radius * scale;
    const maxR = Math.ceil(rad);
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const dist = Math.hypot(nx - p.x, ny - p.y);
        if (dist <= rad + 0.25) {
          cells.add(ny * W + nx);
        }
      }
    }
  }

  return Array.from(cells);
}

/** Precompute solidProps map (1 = impassable prop obstacle) for the dungeon grid. */
export function buildSolidProps(d) {
  if (!d) return null;
  const { W, H, grid, props, entrance, rooms } = d;
  if (!W || !H || !grid) return null;
  const total = W * H;
  const solid = new Uint8Array(total);
  if (!props || !Array.isArray(props)) return solid;

  /* `entrance` is a ROOM INDEX on generated dungeons, and an {x,y} only on
     hand-authored ones. Reading just the object form left entCell at -1 for
     every real level, so the guard below started its flood from rooms[0] —
     which is not necessarily the entrance, and on a level where it sat in a
     different region meant connectivity was repaired relative to the wrong
     place entirely. */
  const entCell = (typeof entrance === 'number' && rooms && rooms[entrance])
    ? rooms[entrance].cy * W + rooms[entrance].cx
    : (entrance && typeof entrance.x === 'number' && typeof entrance.y === 'number')
      ? entrance.y * W + entrance.x
      : -1;

  for (const p of props) {
    if (!p || !p.kind || !SOLID_PROP_KINDS.has(p.kind)) continue;
    if (p.podium && PODIUM_PROP_KINDS.has(p.kind)) continue;   // a step, not a wall
    const cells = getPropFootprintCells(p, W, H);
    for (const c of cells) {
      if (grid[c] !== FLOOR) continue;
      if (c === entCell) continue;
      if (d.doorway && d.doorway[c]) continue; // Do not block doorway tiles
      /* A staircase is the elevation-era equivalent of a doorway: the ONLY way
         between two tiers. A prop standing on one seals everything above it, and
         neither guard caught it — this function floods flat 4-way with no notion
         of height, and the elevation pass carves stairs without knowing props
         exist. Treat them like doorways and never mark them solid. */
      if (d.ramp && d.ramp[c]) continue;

      solid[c] = 1;
    }
  }

  /* Connectivity guard: ensure every room stays reachable from the entrance.
     A room is only "sealed" when NONE of its floor cells can be reached — a
     solid prop sitting on a room's centre (chest, shrine crystal, boss
     sarcophagus…) must NOT unmark the whole room. When a room is genuinely
     sealed we clear the solid prop nearest the reachable frontier (multi-source
     BFS), re-flood, and repeat, so only the actual blocker is removed — even
     when the blocker is a prop in the corridor outside the room. */
  if (rooms && rooms.length > 0) {
    const startC = (entCell >= 0 && grid[entCell] === FLOOR && !solid[entCell])
      ? entCell
      : (rooms[0].cy * W + rooms[0].cx);
    if (startC >= 0 && startC < total && grid[startC] === FLOOR) {
      /* Height matters. This flood used to run flat, which meant a prop that
         sealed the only staircase off a tier was invisible here: the room it
         belonged to still had reachable floor at the bottom, so nothing looked
         wrong, and a unit that walked up ended up stranded. Steps obey the same
         rule as findPath — same level freely, one level only across a stair. */
      const stepOK = (a, b) => {
        if (!d.height) return true;
        const dh = d.height[b] - d.height[a];
        if (dh === 0) return true;
        if (dh !== 1 && dh !== -1) return false;
        return !!(d.ramp && (d.ramp[a] || d.ramp[b]));
      };
      const passable = (c) => grid[c] === FLOOR && !solid[c];
      const flood = () => {
        const reached = new Uint8Array(total);
        const q = [startC];
        reached[startC] = 1;
        let head = 0;
        while (head < q.length) {
          const curr = q[head++];
          const cx = curr % W, cy = Math.floor(curr / W);
          /* EIGHT-way, with findPath's corner-cut guard. Flooding 4-way here
             was the second half of the stuck-unit bug: a tier whose stair is
             only reachable diagonally reads as orphaned, so the repair loop
             below chewed through 471 innocent props on one level looking for a
             blocker that did not exist, then gave up with the real orphan
             still cut off. The guard has to model the same movement the game
             actually performs. */
          const tryGo = (n) => {
            if (reached[n] || !passable(n) || !stepOK(curr, n)) return;
            reached[n] = 1; q.push(n);
          };
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const nx = cx + ox, ny = cy + oy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              if (ox && oy && (!passable(cy * W + nx) || !passable(ny * W + cx))) continue;
              tryGo(ny * W + nx);
            }
          }
        }
        return reached;
      };
      let reached = flood();

      /* Repair until NOTHING walkable is orphaned, not merely until every room
         has one reachable tile. The room-level test passed a room whose upper
         tier was sealed off, because its ground floor was still reachable —
         which is exactly how a unit ended up stuck on a terrace.

         The blocker is found by flooding the ORPHANED region and looking at the
         solid cells that wall it in. Ranking every prop on the map by its
         distance to the reachable frontier instead — which is what this used to
         do — is not a blocker test at all: a prop standing in the middle of an
         already-reachable room touches the frontier too, so it scores 0 just
         like the real blocker, and the loop cleared whichever such prop came
         first in `props`. A handful of orphaned cells routinely deleted 80-100
         props a level that way, which is why coffins, pillars and sarcophagi
         were still walk-through in play despite being marked solid here. */
      const hopeless = new Uint8Array(total);
      for (let iter = 0; iter <= props.length + total; iter++) {
        let orphan = -1;
        for (let c = 0; c < total; c++) {
          if (passable(c) && !reached[c] && !hopeless[c]) { orphan = c; break; }
        }
        if (orphan < 0) break;

        /* Flood the orphaned region, collecting the solid cells on its rim. */
        const region = [orphan];
        const inRegion = new Uint8Array(total);
        inRegion[orphan] = 1;
        const border = new Set();
        let rh = 0;
        while (rh < region.length) {
          const c = region[rh++];
          const cx = c % W, cy = Math.floor(c / W);
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const nx = cx + ox, ny = cy + oy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const nc = ny * W + nx;
              if (grid[nc] !== FLOOR) continue;
              if (solid[nc]) { border.add(nc); continue; }
              if (ox && oy && (!passable(cy * W + nx) || !passable(ny * W + cx))) continue;
              if (inRegion[nc] || !stepOK(c, nc)) continue;
              inRegion[nc] = 1; region.push(nc);
            }
          }
        }

        if (!border.size) {
          /* Walled by the grid or by a level change, not by a prop — clearing
             props cannot help. Leave it and stop re-picking it as the orphan,
             otherwise the scan above returns the same cell forever. */
          for (const c of region) hopeless[c] = 1;
          continue;
        }

        /* Clear a prop sitting on that rim, preferring one that also touches
           the reachable side: that single prop IS the wall between the two
           regions, so removing it reconnects them in one step. Otherwise any
           rim prop will do — the region grows and the next pass carries on. */
        let bestP = null, bestScore = -1;
        for (const p of props) {
          if (!p || !p.kind || !SOLID_PROP_KINDS.has(p.kind)) continue;
          if (p.podium && PODIUM_PROP_KINDS.has(p.kind)) continue;
          const cells = getPropFootprintCells(p, W, H);
          let onBorder = false, touchesReached = false;
          for (const c of cells) {
            if (!solid[c]) continue;
            if (border.has(c)) onBorder = true;
            const x = c % W, y = Math.floor(c / W);
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                if (!ox && !oy) continue;
                const nx = x + ox, ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const nc = ny * W + nx;
                if (reached[nc] && stepOK(nc, c)) touchesReached = true;
              }
            }
          }
          if (!onBorder) continue;
          const score = touchesReached ? 2 : 1;
          if (score > bestScore) { bestScore = score; bestP = p; if (score === 2) break; }
        }

        if (bestP) {
          for (const c of getPropFootprintCells(bestP, W, H)) solid[c] = 0;
        } else {
          /* Rim cells that no surviving prop claims (overlapping footprints
             already cleared elsewhere) — peel them directly so the solid set
             still shrinks and the loop cannot spin. */
          for (const bc of border) solid[bc] = 0;
        }
        reached = flood();
      }
    }
  }

  return solid;
}

/**
 * Precompute sightBlockers (1 = this cell stops line of sight).
 *
 * Derived from the finished `solid` map rather than from the props directly, so
 * it inherits every exemption that map already earned: doorway and staircase
 * cells are never marked, and a prop the connectivity guard had to clear stops
 * blocking sight too — having removed its collision so the party can walk
 * through it, leaving it opaque would be indefensible.
 */
export function buildSightBlockers(d, solid) {
  if (!d) return null;
  const { W, H, props } = d;
  if (!W || !H) return null;
  const sight = new Uint8Array(W * H);
  const solidMap = solid || d.solidProps;
  if (!props || !Array.isArray(props) || !solidMap) return sight;

  for (const p of props) {
    if (!p || !p.kind || !SIGHT_BLOCKING_KINDS.has(p.kind)) continue;
    for (const c of getPropFootprintCells(p, W, H)) {
      if (solidMap[c]) sight[c] = 1;
    }
  }
  return sight;
}

export const pathfindingMethods = {
  /* ============ pathfinding (Dijkstra, weighted cost) ============
   * Cost of entering a cell:
   *   - chokepoint cell (doorway / 1-wide corridor)  -> CHOKEPOINT_COST
   *   - cell covered by an active AoE hazard zone     -> + HAZARD_COST
   *   - otherwise                                     -> 1
   * A tiny fractional tiebreak (0.001) is added for wall-adjacent cells so
   * that among equal-cost paths the route biased toward room centres wins,
   * preserving the original centre-room feel.  Doorways are no longer free:
   * a route will detour around them when the detour is cheaper than going
   * through, which is what stops the party from funnelling every walk into a
   * single 1-tile jam.
   *
   * opts.avoidClosedDoors: when true, closed doorway-arch cells are treated
   * as impassable for this search (monsters pathing through still-locked
   * gates). Heroes do not pass this flag — they unlock gates as they
   * approach (updateDoors), so doors remain open floor for them. */
  findPath(from, to, opts) {
    const { W, H, grid } = this.D;
    if (from === to || from < 0 || to < 0) return null;
    /* Flight is decided once, up front: `flies` then stands in for "POOL counts
       as floor" everywhere below without re-reading the tag per cell. */
    const flies = canFly(opts && opts.mover);
    const isGround = (n) => isGroundFor(grid, n, flies);
    if (!isGround(to) || (this.D.solidProps && this.D.solidProps[to])) return null;
    const total = W * H;
    const wallAdj = this.D.wallAdj;
    const chokepoint = this.D.chokepoint;
    const inCombat = typeof this.isCombatActive === 'function' ? this.isCombatActive() : !!(this.combat || (this.initiative && this.initiative.active));
    /* Closed doors block whoever cannot open one — which is monsters, and only
       monsters. They say so themselves by passing avoidClosedDoors.
       `inCombat ||` used to be in this condition, which quietly extended the
       ban to heroes for the length of every fight. That is the soft-lock: a
       fight that starts across a shut gate leaves the party with no legal route
       to the enemy, and since door-opening was ALSO suspended during combat,
       nothing could ever clear it. Heroes unlock gates by walking up to them
       (updateDoors), so for them a closed door is a COST, not a wall — see the
       +5 below. */
    const avoidDoors = !!(opts && opts.avoidClosedDoors) && (typeof this.isCellDoorClosed === 'function');

    /* Climbing. A body scrambles up or drops down as much as FREE_CLIMB levels
       with no staircase at all — always LEGAL, but not always free.
       The first cut of this allowed it out of combat only, on the reasoning
       that height should cost something in a fight. What it actually cost was
       the fight: the level being connected under the stairs-only rule is a
       statement about EMPTY terrain, and combat is exactly when the terrain is
       not empty. One monster standing on the only steps off a tier, or a
       closed gate on the far side of the detour, and the party is walled in
       with nowhere legal to move. So in combat the climb is priced instead of
       banned — CLIMB_COST per level, which keeps stairs the obvious choice
       whenever they are anywhere near and leaves scrambling as the way out
       when they are not. */
    const climb = (opts && typeof opts.climb === 'number') ? opts.climb : FREE_CLIMB;
    const climbCost = inCombat ? CLIMB_COST : 0;
    const eH = this.D.height, eR = this.D.ramp;

    const mover = opts && opts.mover;
    const isHeroMover = mover && (Array.isArray(this.heroes) && this.heroes.includes(mover));
    const isMonsterMover = mover && (Array.isArray(this.monsters) && this.monsters.includes(mover));

    /* Bodies, split the way 5e splits them: you may move THROUGH an ally's
       square but not stop there, and you may not pass through an enemy at all.
       Hard-blocking allies too (the first cut of this) sent heroes on long
       detours around their own party — a target 4 tiles away would route 9
       tiles the wrong way round, which is most of what "the paladin runs
       around instead of attacking" looked like.
       Allies are therefore a COST, not a wall; the destination is validated
       separately below, so nobody ends their move inside a teammate.
       Reservations used to hard-block EVERY booked cell, including an ally
       standing on their own square — that quietly undid pass-through. */
    const enemyCells = new Set();
    const allyCells = new Set();
    const reservedByEnemy = new Set();
    const reservedByAlly = new Set();
    const sideOf = (b) => this._entitySide(b);
    const moverSide = mover ? sideOf(mover) : null;
    const addBody = (b) => {
      if (b === mover) return;
      if (!b || !b.data || b.data.hp <= 0) return;
      if (b.active === false) return;
      const c = this.cellOf(b.x, b.z);
      if (c < 0) return;
      if (moverSide && sideOf(b) === moverSide) allyCells.add(c);
      else enemyCells.add(c);
    };
    if (Array.isArray(this.monsters)) for (const m of this.monsters) addBody(m);
    if (Array.isArray(this.heroes)) for (const h of this.heroes) addBody(h);
    void isHeroMover; void isMonsterMover;
    if (mover && this._reservedCells) {
      for (const [cell, owner] of this._reservedCells) {
        if (!owner || owner === mover) continue;
        if (owner.data && owner.data.hp <= 0 && !owner._dying) continue;
        if (moverSide && sideOf(owner) === moverSide) reservedByAlly.add(cell);
        else reservedByEnemy.add(cell);
      }
    }
    /* Nobody may FINISH on an occupied or reserved tile, ally or enemy. */
    if (allyCells.has(to) || enemyCells.has(to) || reservedByAlly.has(to) || reservedByEnemy.has(to)) return null;

    const dist = new Float64Array(total).fill(Infinity);
    const par = new Int32Array(total).fill(-1);
    dist[from] = 0;

    /* binary min-heap keyed by dist[] (cells may be pushed more than once;
       stale entries are skipped on pop by comparing their stored priority
       against the current best-known dist). */
    const hC = new Int32Array(total);
    const hP = new Float64Array(total);
    let hN = 0;
    const push = (cell, prio) => {
      let i = hN++;
      hC[i] = cell; hP[i] = prio;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hP[p] <= hP[i]) break;
        const tc = hC[p], tp = hP[p];
        hC[p] = hC[i]; hP[p] = hP[i];
        hC[i] = tc; hP[i] = tp;
        i = p;
      }
    };
    const popMin = () => {
      const cell = hC[0];
      hN--;
      if (hN > 0) {
        hC[0] = hC[hN]; hP[0] = hP[hN];
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let best = i;
          if (l < hN && hP[l] < hP[best]) best = l;
          if (r < hN && hP[r] < hP[best]) best = r;
          if (best === i) break;
          const tc = hC[best], tp = hP[best];
          hC[best] = hC[i]; hP[best] = hP[i];
          hC[i] = tc; hP[i] = tp;
          i = best;
        }
      }
      return cell;
    };

    push(from, 0);
    const hasAoE = !!(this.activeAoEZones && this.activeAoEZones.length);
    const isHazard = (cell) => {
      if (!hasAoE) return false;
      const wx = this.wx(cell % W), wz = this.wz(Math.floor(cell / W));
      for (const z of this.activeAoEZones) {
        if (isPointInAoEZone(wx, wz, z)) return true;
      }
      return false;
    };

    while (hN > 0) {
      const c = popMin();
      const dc = dist[c];
      /* stale heap entry (a shorter distance was already finalised) */
      if (c === to) break;
      const x = c % W;
      const isWalkable = (n) => {
        if (!isGround(n) || (this.D.solidProps && this.D.solidProps[n])) return false;
        if (avoidDoors && this.isCellDoorClosed(n)) return false;
        /* No destination exemption: a cell with a body on it is not a place to
           stand, goal or not. Callers that want to reach a creature ask
           approachCellNear/getUnoccupiedCellNear for a free neighbouring tile
           instead — the old `n !== to` escape hatch was how two bodies ended up
           finishing their paths on the same square. */
        if (enemyCells.size > 0 && enemyCells.has(n)) return false;
        if (reservedByEnemy.size > 0 && reservedByEnemy.has(n)) return false;
        return true;
      };
      const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
      /* Height is an EDGE property, not a cell one: whether you may enter `n`
         depends on where you are standing. isWalkable answers "is this a place
         to be", canStep answers "can I get there from here" — a ledge is
         walkable on both sides, it is the transition that is illegal. */
      const stepOK = (a, b) => isWalkable(b) && canStep(this.D, a, b, climb);
      const relax = (n) => {
        if (!stepOK(c, n)) return;
        let step = (chokepoint && chokepoint[n]) ? CHOKEPOINT_COST : 1;
        /* Scrambling a face is legal but slow; taking the steps is not. */
        if (climbCost && eH && eH[n] !== eH[c] && !(eR && (eR[c] || eR[n]))) {
          step += climbCost * Math.abs(eH[n] - eH[c]);
        }
        /* Squeezing past a teammate is allowed but awkward — prefer a clear
           lane when one exists, take the shove when the detour is worse. */
        if ((allyCells.size > 0 && allyCells.has(n)) || (reservedByAlly.size > 0 && reservedByAlly.has(n))) {
          step += ALLY_PASS_COST;
        }
        if (!avoidDoors && hasDoorCheck && this.isCellDoorClosed(n)) step += 5.0;
        if (hasAoE && isHazard(n)) step += HAZARD_COST;
        if (typeof this.isDifficultTerrain === 'function' && this.isDifficultTerrain(n, mover)) step += 1.0;
        if (wallAdj && wallAdj[n]) step += 0.001; /* centre-room tiebreak */
        const nd = dc + step;
        if (nd < dist[n]) { dist[n] = nd; par[n] = c; push(n, nd); }
      };
      /* cardinals */
      if (x > 0) relax(c - 1);
      if (x < W - 1) relax(c + 1);
      if (c >= W) relax(c - W);
      if (c < total - W) relax(c + W);
      /* diagonals — both adjacent cardinals must be walkable floor to prevent
         corner-cutting through walls or solid props */
      if (x > 0 && c >= W && stepOK(c, c - 1) && stepOK(c, c - W)) relax(c - W - 1);
      if (x < W - 1 && c >= W && stepOK(c, c + 1) && stepOK(c, c - W)) relax(c - W + 1);
      if (x > 0 && c < total - W && stepOK(c, c - 1) && stepOK(c, c + W)) relax(c + W - 1);
      if (x < W - 1 && c < total - W && stepOK(c, c + 1) && stepOK(c, c + W)) relax(c + W + 1);
    }
    let goal = to;
    if (dist[to] === Infinity) {
      /* The exact goal is unreachable — usually because somebody is standing on
         it or on the only way in. Giving up here made heroes freeze mid-fight
         once bodies started blocking properly, so with opts.nearest we fall
         back to the reachable cell closest to the goal and at least keep
         closing the distance. */
      if (!opts || !opts.nearest) return null;
      const gx = to % W, gy = Math.floor(to / W);
      let bestCell = -1, bestScore = Infinity;
      for (let c = 0; c < total; c++) {
        if (dist[c] === Infinity || c === from) continue;
        const dx = (c % W) - gx, dy = Math.floor(c / W) - gy;
        /* Closeness to the goal dominates; travel cost breaks ties so we don't
           take a scenic route to an equally-near tile. */
        const score = Math.hypot(dx, dy) * 4 + dist[c] * 0.1;
        if (score < bestScore) { bestScore = score; bestCell = c; }
      }
      if (bestCell < 0) return null;
      goal = bestCell;
    }
    const path = [];
    for (let c = goal; c !== -1; c = par[c]) path.push(c);
    path.reverse();
    return path.length > 1 ? path : null;
  },

  isCellOccupiedAny(cell, excludeEntity) {
    if (cell < 0 || !this.D) return false;
    if (Array.isArray(this.heroes)) {
      for (const h of this.heroes) {
        if (h === excludeEntity || (h.data && h.data.hp <= 0)) continue;
        if (this.cellOf(h.x, h.z) === cell) return true;
      }
    }
    if (Array.isArray(this.monsters)) {
      for (const m of this.monsters) {
        if (m === excludeEntity || !m.active || (m.data && m.data.hp <= 0)) continue;
        if (this.cellOf(m.x, m.z) === cell) return true;
      }
    }
    /* Reservations count as occupancy: a cell someone is animating ONTO is
       not free even though no body has float-landed on it yet. */
    if (typeof this.isCellReserved === 'function' && this.isCellReserved(cell, excludeEntity)) return true;
    return false;
  },

  getUnoccupiedCellNear(cell, mover, radius = 3) {
    if (cell < 0 || !this.D) return cell;
    if (!this.isCellOccupiedAny(cell, mover)) return cell;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const cx = cell % W, cy = Math.floor(cell / W);
    const solid = this.D.solidProps;
    const flies = canFly(mover);
    for (let r = 1; r <= radius; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nc = ny * W + nx;
          if (!isGroundFor(this.D.grid, nc, flies)) continue;
          if (solid && solid[nc]) continue;
          if (this.isCellOccupiedAny(nc, mover)) continue;
          return nc;
        }
      }
    }
    return cell;
  },

  /* Pick a floor cell near `cell` for `mover` to path to.
     Prefers an unoccupied ring-1 (adjacent) cell. If every ring-1 cell is
     taken (a common situation when 8 melee already surround a target), the
     search expands to ring-2 and ring-3 before giving up. NEVER returns a
     cell that is occupied or reserved by another body — the old fallback that
     returned an occupied neighbour was the structural cause of two sprites
     stacking on one square. Only returns `cell` itself as an absolute last
     resort (callers treat goal===targetCell as "abort approach"). */
  approachCellNear(cell, mover, opts = {}) {
    if (cell < 0 || !this.D) return cell;
    /* Ring 4 matters now that a body genuinely blocks its tile: with 3 rings a
       well-surrounded target left approachers with no legal stance at all, and
       they simply stopped. */
    const maxRing = opts.maxRing || 4;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const cx = cell % W, cy = Math.floor(cell / W);
    const solid = this.D.solidProps;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    const flies = canFly(mover);
    const isFree = (nc) => {
      if (nc < 0 || !isGroundFor(this.D.grid, nc, flies)) return false;
      if (solid && solid[nc]) return false;
      if (hasDoorCheck && this.isCellDoorClosed(nc)) return false;
      if (typeof this.isCellOccupiedAny === 'function' && this.isCellOccupiedAny(nc, mover)) return false;
      return true;
    };

    /* Ring-1 pass first (preserve original nearest-neighbour preference). */
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;                 /* never the target cell */
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (isFree(ny * W + nx)) return ny * W + nx;
      }
    }
    /* Rings 2..maxRing — expanding search so a packed ring-1 doesn't force a
       collision. Spiral outward; nearest wins. */
    for (let r = 2; r <= maxRing; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue; /* ring perimeter */
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (isFree(ny * W + nx)) return ny * W + nx;
        }
      }
    }
    /* Absolute last resort. Callers should treat this as "no free cell found"
       and hold position rather than path onto an occupied tile. */
    return cell;
  },

  /* Ground height under a world position — the Y an entity standing here
     should be drawn at. Flat levels return 0, so this is safe to call
     unconditionally from every placement site. */
  groundY(x, z) {
    return groundY(this.D, x, z);
  },

  /* Line of sight. A still-closed doorway gate is as opaque as a wall — this
     is what tryActivateMonster relies on to avoid waking a room through a
     locked door (and, with it, latching this.combat on while the party is
     still on the wrong side of the gate). */
  hasLOS(x0, z0, x1, z1) {
    const { W } = this.D;
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist * 3);
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const c = this.cellOf(x0 + dx * t, z0 + dz * t);
      if (c < 0) return false;
      /* A pool is not a wall. Sight used to break on any non-FLOOR tile, so
         nothing could see — or shoot — across a mere; with flyers now hovering
         over one, an unseeable target would be an unkillable one. Liquid stops
         feet, not eyes. */
      const tile = this.D.grid[c];
      if (tile !== FLOOR && tile !== POOL) return false;
      /* sightBlockers, NOT solidProps — see SIGHT_BLOCKING_KINDS. Falls back to
         solidProps only for a harness that never built the sight map, which
         keeps such a caller at the old (over-blocking) behaviour rather than
         handing it no occlusion at all. */
      const sight = this.D.sightBlockers || this.D.solidProps;
      if (sight && sight[c]) return false;
      if (hasDoorCheck && this.isCellDoorClosed(c)) return false;
    }
    return true;
  },

  /* Smoothly rotate `e` toward the direction of (tx,tz). Replaces the hard
     `rotation.y = atan2(...)` snaps that made monsters/heroes flick their
     facing 180° when toggling between chase/melee/kite at range boundaries.
     Uses the same hysteresis + eased lerp as stepAlong's facing code, so a
     target-side change eases in over a few frames instead of cutting. */
  faceTowards(e, tx, tz, dt = 0.016) {
    if (!e || !e.ent || !e.ent.grp) return;
    const targetAngle = Math.atan2(tx - e.x, tz - e.z);
    let delta = targetAngle - e.ent.grp.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) > 0.12) {
      e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
    }
  },

  /* ── Reservation shims (overridden by reservationMethods in production).
     These let pathfindingMethods stand alone in unit tests — without them,
     every test fixture that exercises explore/combat code would need the
     reservation mixin too. In production, reservationMethods is mixed onto
     Game.prototype AFTER pathfindingMethods, so these are shadowed. */
  setEntityPath(e, path) {
    if (!e) return;
    e.path = path || null;
    e.pathI = 0;
  },
  clearEntityPath(e) {
    if (!e) return;
    e.path = null;
    e.pathI = 0;
  },
  releaseReservation(e) { /* no-op without the reservation map */ },
  reserveCell(e, cell) { /* no-op without the reservation map */ },
  isCellReserved(cell, excludeEntity) { return false; },
  reapReservations() { /* no-op without the reservation map */ },
  placeAtFreeCell(e, x, z, opts) {
    if (!e) return e;
    e.x = x; e.z = z;
    return e;
  },
  pushEntity(target, fromX, fromZ, cells, dir = 1) {
    if (!target) return 0;
    let dx = (target.x - fromX), dz = (target.z - fromZ);
    if (dir < 0) { dx = -dx; dz = -dz; }
    const len = Math.hypot(dx, dz) || 1;
    const ox = (dx / len) * cells, oz = (dz / len) * cells;
    target.x += ox;
    target.z += oz;
    /* Visual only — see reservation.js pushEntity: the position moves at once,
       the sprite catches up via lungeOffset() so the shove reads as a slide. */
    const dur = Math.min(0.34, 0.11 * cells);
    target.knockOX = -ox;
    target.knockOZ = -oz;
    target.knockT = dur;
    target.knockDur = dur;
    return cells;
  },

  /* move entity along its path; returns true if moving.
     Wall repulsion is applied after each position update to keep
     sprites from clipping into wall geometry.  Uses a generous
     capture radius (0.35 tiles) so entities flow through cells
     without needing exact center occupancy.
     If the direct step hits a wall, probes angled deviations before
     giving up — this helps entities slide past corners and through
     tight doorways without a full repath. */
  stepAlong(e, speed, dt) {
    try {
    /* ── Position tween integration ───────────────────────────────────
       A short smooth glide used by stuck-recovery (handleStuck) and spell
       knockback fall-backs, replacing the old instant ±0.45 sidestep that
       read as a "teleport to another square". While a tween is active the
       entity glides toward the target over `dur` seconds and then clears it. */
    if (e._posTween && e._posTween.dur > 0) {
      const tw = e._posTween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const nx = tw.fromX + (tw.toX - tw.fromX) * k;
      const nz = tw.fromZ + (tw.toZ - tw.fromZ) * k;
      if (!this.blockedForEntity(nx, nz, e, TIGHT_R)) { e.x = nx; e.z = nz; }
      if (k >= 1) e._posTween = null;
      /* Reflect tween velocity so facing follows the glide. */
      const velX = (tw.toX - tw.fromX), velZ = (tw.toZ - tw.fromZ);
      if (e.ent && e.ent.grp && (velX || velZ)) {
        const targetAngle = Math.atan2(velX, velZ);
        let delta = targetAngle - e.ent.grp.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) > 0.12) e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
      }
      return true; /* still moving */
    }

    if (!e.path || e.pathI >= e.path.length) return false;

    const prevX = e.x, prevZ = e.z;
    const { W } = this.D;

    /* ── Leading-node skip ─────────────────────────────────────────────
       A fresh path's node 0 is the entity's OWN cell. Targeting that centre
       after the body has already stepped toward node 1 pulls it BACK onto
       the tile centre — the Giant Rat log (`stepAlong → stepAlong` reversal
       with pathLeft flipping 2 ↔ 1). Skip every leading node we are already
       standing on, or that we have walked past (closer to the next node). */
    while (e.pathI < e.path.length - 1) {
      const cHere = e.path[e.pathI], cNext = e.path[e.pathI + 1];
      const dHere = Math.hypot(this.wx(cHere % W) - e.x, this.wz(Math.floor(cHere / W)) - e.z);
      const dNext = Math.hypot(this.wx(cNext % W) - e.x, this.wz(Math.floor(cNext / W)) - e.z);
      if (this.cellOf(e.x, e.z) === cHere || dNext <= dHere) e.pathI++;
      else break;
    }

    const tactical = !!(this.initiative && this.initiative.active);
    let isFinalNode = (e.pathI >= e.path.length - 1);
    /* Combat is a grid: visit every waypoint centre (0.05) instead of cutting
       the corner at 0.35, which is how a unit in an empty room ended a step
       parked on the Voronoi edge between two tiles. */
    const tightCapture = tactical || isFinalNode;
    const CAPTURE = tightCapture ? 0.05 : 0.35;

    /* Advance past any cells we've already reached (within capture range)
       WITHOUT snapping position — just re-target the next cell and fall
       through to the normal movement code.  Eliminates the visual
       "flick to cell centre" that happened on every path-step. */
    let c = e.path[e.pathI];
    let tx = this.wx(c % W), tz = this.wz(Math.floor(c / W));
    let dx = tx - e.x, dz = tz - e.z;
    let dist = Math.hypot(dx, dz);

    e._blockedByDoor = false;

    const abortPath = () => {
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
      else { e.path = null; e.pathI = 0; }
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = 0; e._dz = 0;
    };

    /* Hostiles block the square entirely — do not creep up to the tile edge
       and grind. Allies may be walked THROUGH (handled below) but never
       stopped on. Hold the path for a beat so a body that steps onto the
       next tile does not wipe a 10-square walk the same frame (that abort
       plus snapToTileCenter was the shaman reversal). Then drop it so the
       next think can pick a new square. */
    const blockedWaypoint = (this.cellOf(e.x, e.z) !== c) && (
      (typeof this.cellHasHostile === 'function' && this.cellHasHostile(c, e))
      || (isFinalNode && typeof this.isCellBodyOccupied === 'function' && this.isCellBodyOccupied(c, e))
    );
    if (blockedWaypoint) {
      e._bodyBlockT = (e._bodyBlockT || 0) + dt;
      if (e._bodyBlockT > 0.35) { e._bodyBlockT = 0; abortPath(); }
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = 0; e._dz = 0;
      return false;
    }

    /* Arriving at a combat waypoint or the LAST node: land exactly on the
       tile centre. Leaving a 0.05 residue for snapToTileCenter to lerp was
       the shuffle after a creature stopped in an empty room. */
    if (tightCapture && dist <= CAPTURE) {
      e.x = tx; e.z = tz;
      e._settledCell = c;
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = 0; e._dz = 0;
      e.pathI++;
      if (isFinalNode || !e.path || e.pathI >= e.path.length) return false;
      c = e.path[e.pathI];
      tx = this.wx(c % W); tz = this.wz(Math.floor(c / W));
      dx = tx - e.x; dz = tz - e.z; dist = Math.hypot(dx, dz);
      isFinalNode = (e.pathI >= e.path.length - 1);
    }

    if (dist <= CAPTURE) {
      const nextNode = e.path[e.pathI + 1];
      if (nextNode !== undefined && typeof this.isCellDoorClosed === 'function' && this.isCellDoorClosed(nextNode)) {
        this.wallRepel(e);
        e._lastDx = e._dx; e._lastDz = e._dz;
        e._dx = 0; e._dz = 0;
        e._blockedByDoor = true;
        return false;
      }
      e.pathI++;
      if (e.pathI >= e.path.length) return false;
      c = e.path[e.pathI];
      tx = this.wx(c % W); tz = this.wz(Math.floor(c / W));
      dx = tx - e.x; dz = tz - e.z; dist = Math.hypot(dx, dz);
    }

    if (typeof this.isCellDoorClosed === 'function' && this.isCellDoorClosed(c)) {
      this.wallRepel(e);
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = 0; e._dz = 0;
      e._blockedByDoor = true;
      return false;
    }

    /* Single-file doorways: if the next cell is a tight chokepoint already
       occupied by another body that is ahead of us (inside it, or closer to
       its centre), wait briefly so we pass one at a time instead of both
       wedging in the frame. A 0.7 s cap guarantees we never wait forever —
       if the occupant is itself stuck we force through and let the usual
       recovery sort it out. */
    const choke = this.D.chokepoint;
    if (choke && choke[c] && this.cellOf(e.x, e.z) !== c && this._chokeOccupant(c, e)) {
      e._doorWaitT = (e._doorWaitT || 0) + dt;
      if (e._doorWaitT < 0.35) {
        this.wallRepel(e);
        e._lastDx = e._dx; e._lastDz = e._dz;
        e._dx = 0; e._dz = 0;
        return false;
      }
    } else {
      e._doorWaitT = 0;
    }

    /* Clamp step to remaining distance so the entity never overshoots
       past the target cell (which would cause jitter without the old
       snap-to-centre correction). */
    const step = Math.min(speed * dt, dist);
    const baseAngle = Math.atan2(dx, dz);

    /* Try the direct step.  If the direct position clips a wall, probe
       angled deviations, then fall back to an axis-slide (move along X only,
       then Z only) — the same wall-sliding nudgeToward uses, which is what
       actually threads a body through a 1-wide doorframe when the straight
       line clips the jamb.  Only if EVERY option is blocked do we hold, rather
       than committing a blocked spot (shoving into the wall + wallRepel bounce
       was the old doorway jitter/jam). */
    const dirX = Math.sin(baseAngle) * step;
    const dirZ = Math.cos(baseAngle) * step;
    let bestX = e.x + dirX;
    let bestZ = e.z + dirZ;
    let moved = true;
    /* 5e occupancy: hostiles block the square entirely (cannot pass through);
       allies may be walked through but you cannot STOP on them. Snap-to-centre
       used to "solve" a landing overlap by shoving the occupant — that is the
       visible push. We refuse the illegal step instead. */
    const isBlocked = (x, z) => {
      if (this.blocked(x, z, TIGHT_R, e)) return true;
      const target = this.cellOf(x, z);
      if (target < 0) return true;
      if (target === this.cellOf(e.x, e.z)) return false;
      if (typeof this.cellHasHostile === 'function' && this.cellHasHostile(target, e)) return true;
      if (isFinalNode && this.isCellBodyOccupied(target, e)) return true;
      return false;
    };
    if (isBlocked(bestX, bestZ)) {
      let found = false;
      const angles = [0.26, -0.26, 0.52, -0.52, 0.79, -0.79];
      for (const angle of angles) {
        const ax = e.x + Math.sin(baseAngle + angle) * step;
        const az = e.z + Math.cos(baseAngle + angle) * step;
        if (!isBlocked(ax, az)) {
          bestX = ax; bestZ = az; found = true;
          break;
        }
      }
      if (!found) {
        /* axis-slide: keep whichever single-axis component is unobstructed */
        if (!isBlocked(e.x + dirX, e.z)) { bestX = e.x + dirX; bestZ = e.z; found = true; }
        else if (!isBlocked(e.x, e.z + dirZ)) { bestX = e.x; bestZ = e.z + dirZ; found = true; }
      }
      if (!found) {
        /* Genuinely wedged. Drop the path so the next tick replans around
           whoever is in the way instead of grinding against them. */
        bestX = e.x; bestZ = e.z; moved = false;
        if (this.isCellBodyOccupied(this.cellOf(e.x + dirX, e.z + dirZ), e)) {
          e._bodyBlockT = (e._bodyBlockT || 0) + dt;
          if (e._bodyBlockT > 0.4) { e._bodyBlockT = 0; this.clearEntityPath(e); }
        }
      }
    } else {
      e._bodyBlockT = 0;
    }
    e.x = bestX; e.z = bestZ;
    /* Soft wall-repel in combat fights the grid: it nudges a finished step
       off-centre, snap pulls back, and that is the empty-room edge jitter.
       Exploration still uses it to keep sprites out of wall geometry. */
    if (!tactical) this.wallRepel(e);

    /* ── Facing: velocity-gated with hysteresis ────────────────────────
       Old code derived facing from the PATH-TARGET direction (dx,dz toward
       the next cell centre). Any frame where that target flipped (e.g. the
       path[0] skip above, or a repath) instantly started rotating the sprite
       — a visible 180° flick. Now we derive facing from ACTUAL velocity this
       frame, and only update rotation when the entity genuinely moved. A
       small deadzone + hysteresis latch suppresses sub-pixel noise. */
    const velX = e.x - prevX, velZ = e.z - prevZ;
    const speed2 = Math.hypot(velX, velZ);
    e._lastDx = e._dx; e._lastDz = e._dz;
    e._dx = velX; e._dz = velZ;
    if (e.ent && e.ent.grp && speed2 > 0.004) {
      /* Use actual velocity direction — robust against path-target flips. */
      const targetAngle = Math.atan2(velX, velZ);
      let delta = targetAngle - e.ent.grp.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      /* Hysteresis: ignore tiny angular changes (< 0.12 rad ≈ 7°) so the
         sprite doesn't quiver near axis boundaries. Large turns ease in
         over a few frames via the dt*8 lerp. */
      if (Math.abs(delta) > 0.12) {
        e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
      }
    }
    return moved;
    } finally {
      Motion.after(this, e, (e._posTween && e._posTween.dur > 0) ? 'posTween' : 'stepAlong');
    }
  },

  /* Push entity away from nearby walls — prevents sprite clipping
     and keeps heroes centred in corridors instead of hugging walls.
     Uses a soft falloff so repulsion is gentle at normal distances
     and ramps up only when the entity drifts too close.
     In 1-wide corridors adds a gentle centring force so entities
     don't oscillate between the two walls. */
  wallRepel(e) {
    const { W, H, grid } = this.D;
    const cx = this.cellOf(e.x, e.z);
    if (cx < 0) return;
    /* To a flyer the water's edge is not a wall, so it must not push back —
       otherwise a hovering body is shoved off the pool it just crossed. */
    const flies = canFly(e);
    const cxX = cx % W, cxY = Math.floor(cx / W);
    let pushX = 0, pushZ = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of dirs) {
      const nx = cxX + dx, ny = cxY + dz;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nidx = ny * W + nx;
      if (isGroundFor(grid, nidx, flies) && (!this.D.solidProps || !this.D.solidProps[nidx])) continue;
      const isProp = isGroundFor(grid, nidx, flies) && this.D.solidProps && this.D.solidProps[nidx];
      const maxDist = isProp ? 0.38 : 0.48;
      const wx = this.wx(nx), wz = this.wz(ny);
      const tox = e.x - wx, toz = e.z - wz;
      const d = Math.hypot(tox, toz);
      if (d < maxDist && d > 0.001) {
        const force = (maxDist - d) / maxDist * (isProp ? 1.4 : 2.2);
        pushX += (tox / d) * force;
        pushZ += (toz / d) * force;
      }
    }

    /* Corridor centring: if both cardinal neighbours in an axis are walls
       (1-wide corridor), pull toward that axis's centreline. This must be
       axis-specific — centring BOTH axes toward the cell centre fights
       straight-line travel: in a 1-wide corridor the confined axis is walled,
       so the old code also applied a cross-axis pull toward the current cell's
       centre, which opposed forward motion and stalled the entity mid-cell
       (e.g. a single walkable tile between a doorway and a liquid pit). */
    const xWalled = (cxX > 0 && !isGroundFor(grid, cx - 1, flies)) && (cxX < W - 1 && !isGroundFor(grid, cx + 1, flies));
    const zWalled = (cxY > 0 && !isGroundFor(grid, cx - W, flies)) && (cxY < H - 1 && !isGroundFor(grid, cx + W, flies));
    if (xWalled) {
      const toMidX = this.wx(cxX) - e.x;
      const d = Math.abs(toMidX);
      if (d > 0.01) pushX += (toMidX / d) * Math.min(d * 0.25, 0.025);
    }
    if (zWalled) {
      const toMidZ = this.wz(cxY) - e.z;
      const d = Math.abs(toMidZ);
      if (d > 0.01) pushZ += (toMidZ / d) * Math.min(d * 0.25, 0.025);
    }

    const mag = Math.hypot(pushX, pushZ);
    if (mag < 0.0005) return;
    const maxPush = 0.05;
    const s = Math.min(mag, maxPush) / mag;
    const nx = e.x + pushX * s;
    const nz = e.z + pushZ * s;
    if (!this.blocked(nx, nz, TIGHT_R, e)) { e.x = nx; e.z = nz; }
    Motion.after(this, e, 'wallRepel');
  },

  /** 'hero' | 'mon' | null — used to split ally pass-through from enemy block. */
  _entitySide(e) {
    if (!e) return null;
    if (Array.isArray(this.monsters) && this.monsters.includes(e)) return 'mon';
    if (Array.isArray(this.heroes) && this.heroes.includes(e)) return 'hero';
    return e._side || null;
  },

  /** True if a live hostile body occupies `cell`. Allies do not count. */
  cellHasHostile(cell, mover) {
    if (cell < 0 || !mover) return false;
    const side = this._entitySide(mover);
    const hits = (b) => {
      if (!b || b === mover || !b.data || b.data.hp <= 0) return false;
      if (b.active === false) return false;
      if (this.cellOf(b.x, b.z) !== cell) return false;
      const bs = this._entitySide(b);
      if (!side || !bs) return true;
      return bs !== side;
    };
    if (Array.isArray(this.heroes)) for (const h of this.heroes) if (hits(h)) return true;
    if (Array.isArray(this.monsters)) for (const m of this.monsters) if (hits(m)) return true;
    return false;
  },

  /** True if a live body OTHER than `excludeEntity` is standing on `cell`.
   *  Position-only — deliberately ignores reservations, so an entity is never
   *  blocked by its own booked destination. */
  isCellBodyOccupied(cell, excludeEntity) {
    if (cell < 0 || !this.D) return false;
    if (Array.isArray(this.heroes)) {
      for (const h of this.heroes) {
        if (h === excludeEntity || !h.data || h.data.hp <= 0) continue;
        if (this.cellOf(h.x, h.z) === cell) return true;
      }
    }
    if (Array.isArray(this.monsters)) {
      for (const m of this.monsters) {
        if (m === excludeEntity || !m.active || !m.data || m.data.hp <= 0) continue;
        if (this.cellOf(m.x, m.z) === cell) return true;
      }
    }
    return false;
  },

  /** A body at rest on `cell` other than `exclude`. Passers (live path / tween)
   *  do not count — they are walking through, and treating them as occupants
   *  is what shoved the standing unit off its square. */
  cellHasSettledBody(cell, exclude) {
    if (cell < 0) return false;
    const hits = (b) => {
      if (!b || b === exclude || !b.data || b.data.hp <= 0) return false;
      if (b.active === false) return false;
      if (typeof this._entityInTransit === 'function' && this._entityInTransit(b)) return false;
      return this.cellOf(b.x, b.z) === cell;
    };
    if (Array.isArray(this.heroes)) for (const h of this.heroes) if (hits(h)) return true;
    if (Array.isArray(this.monsters)) for (const m of this.monsters) if (hits(m)) return true;
    return false;
  },

  /** Wall probe PLUS bodies. Walls are probed at radius `r` (a body has width);
   *  occupancy is judged on the destination cell alone, because a neighbouring
   *  creature's cell overlaps our probe radius constantly and would wedge
   *  everyone in place.
   *
   *  This is the check that actually stops two sprites standing on one square.
   *  `blocked()` only ever knew about walls, props and doors, so stepAlong /
   *  nudgeToward / the tween glide would happily walk one body straight through
   *  another; reservations covered the *destination* of a path but nothing in
   *  between. */
  blockedForEntity(nx, nz, e, r = AGENT_R) {
    if (this.blocked(nx, nz, r, e)) return true;
    const target = this.cellOf(nx, nz);
    if (target < 0) return true;
    /* Already standing there (mid-cell drift) — never block our own square. */
    if (target === this.cellOf(e.x, e.z)) return false;
    return this.isCellBodyOccupied(target, e);
  },

  /* 4-point wall probe used by local (non-pathfinding) movement */
  blocked(nx, nz, r = AGENT_R, mover) {
    if (!this.D || !this.D.grid) return true;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    /* `mover` is optional: omit it and this is the old ground-only probe, which
       is what every hero-side caller wants. Pass the entity and liquid stops
       counting as a wall for a flyer — without it findPath would hand back a
       route over the water that the local physics then refuses to walk. */
    const flies = canFly(mover);
    const isB = (cell) => cell < 0 || !isGroundFor(this.D.grid, cell, flies) || (this.D.solidProps && this.D.solidProps[cell]) || (hasDoorCheck && this.isCellDoorClosed(cell));
    if (isB(this.cellOf(nx - r, nz))) return true;
    if (isB(this.cellOf(nx + r, nz))) return true;
    if (isB(this.cellOf(nx, nz - r))) return true;
    if (isB(this.cellOf(nx, nz + r))) return true;
    return false;
  },

  /* direct local move that refuses to step into a wall.
     Uses the tight doorway radius so local repositioning can still thread a
     1-wide passage — a wider probe here would declare a doorway "blocked"
     while stepAlong (which uses the same tight radius) happily walks through
     it, producing the flip-flop that jammed followers in doorways. */
  nudgeToward(e, tx, tz, speed, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return false;
    const step = Math.min(d, speed * dt);

    const stepX = dx / d * step;
    const stepZ = dz / d * step;
    const nx = e.x + stepX;
    const nz = e.z + stepZ;

    if (!this.blocked(nx, nz, TIGHT_R, e)) {
      e.x = nx; e.z = nz;
      return step > 0.012;
    }
    if (!this.blocked(nx, e.z, TIGHT_R, e)) {
      e.x = nx;
      return Math.abs(stepX) > 0.012;
    }
    if (!this.blocked(e.x, nz, TIGHT_R, e)) {
      e.z = nz;
      return Math.abs(stepZ) > 0.012;
    }
    return false;
  },

  /* Strict tile-lock replacement for the old soft-body applySeparation.
     Called every frame (game.js) but only acts in manual tactical mode: it
     lerps each STATIONARY combatant toward its own tile centre so manual-mode
     tactical combat still feels "snapped" without the old pairwise shove.
     Never mutates a moving entity (stepAlong owns those), and never shoves a
     body off its square onto a neighbour — it only recentres within the cell
     the entity already occupies. */
  /* True while this body is still owned by the movement system: a live path
     or a recovery tween. `e.moving` is a poor proxy — a single blocked frame
     (occupied next tile, doorway yield) sets moving=false even though the
     path is still live, and snapping then fights the next frame's step. */
  _entityInTransit(e) {
    if (!e) return false;
    if (e._posTween && e._posTween.dur > 0) return true;
    if (e.path && e.pathI < e.path.length) return true;
    return false;
  },

  snapStationaryToTiles(alive, dt) {
    if (!this.initiative || !this.initiative.active) return;
    /* Used to be manual-mode only. The game is grid-based in ALL modes, so a
       body that has stopped belongs on its tile centre either way — leaving
       auto-mode combatants parked wherever their last step ended is what makes
       them look like they are drifting and then twitching into place. */
    if (!this.snapToTileCenter) return;
    /* The current actor with movement left is still in its move — even if
       this frame's path was aborted and a new square has not been picked
       yet. Snapping in that gap fights the next stepAlong. */
    const midMove = (e) => this.isCurrentActor && this.isCurrentActor(e) && (e.moveLeft || 0) > 0;
    for (const h of alive) {
      if (!h.moving && !this._entityInTransit(h) && !midMove(h)) this.snapToTileCenter(h, dt, true);
    }
    for (const m of this.monsters) {
      if (m.active && m.data && m.data.hp > 0 && !m.moving && !this._entityInTransit(m) && !midMove(m)) {
        this.snapToTileCenter(m, dt, true);
      }
    }
  },

  /**
   * Un-stack any two STOPPED bodies sharing a tile.
   *
   * Everything else in the occupancy layer is preventative — pathing avoids
   * bodies, paths may not end on one, movement refuses the final step onto one.
   * This is the cleanup for stacks that appear anyway: an actor whose movement
   * budget expires mid-stride and stops wherever it happens to be, a knockback,
   * a summon, a monster waking up under someone. Those never move again on
   * their own, so nothing was ever going to separate them.
   *
   * Only stationary bodies are touched — a pair crossing the same square is
   * legal and resolves itself. Cheap: one pass over the entity list, and it
   * only does work when a collision actually exists.
   */
  resolveRestingOverlaps() {
    if (!this.D) return;
    const seen = new Map();
    const consider = (e) => {
      if (!e || !e.data || e.data.hp <= 0 || e.active === false) return;
      if (e.moving || e.walk || this._entityInTransit(e)) return; /* passer — leave them */
      const c = this.cellOf(e.x, e.z);
      if (c < 0) return;
      const other = seen.get(c);
      if (!other) { seen.set(c, e); return; }
      /* Move the interloper, not the body that already owns the square.
         Walking onto someone and then shoving THEM was the "pushing units
         out of the way by walking on their tile" bug. */
      const otherOwns = other.reservedCell === c || other._settledCell === c;
      const eOwns = e.reservedCell === c || e._settledCell === c;
      let mover;
      if (otherOwns && !eOwns) mover = e;
      else if (eOwns && !otherOwns) mover = other;
      else mover = (typeof this.isCurrentActor === 'function' && this.isCurrentActor(e)) ? other : e;
      const free = this.getUnoccupiedCellNear(c, mover, 3);
      if (free < 0 || free === c) return;             /* genuinely nowhere to go */
      const W = this.D.W;
      mover.x = this.wx(free % W);
      mover.z = this.wz(Math.floor(free / W));
      if (typeof this.releaseReservation === 'function') this.releaseReservation(mover);
      if (typeof this.reserveCell === 'function') this.reserveCell(mover, free);
      seen.set(free, mover);
      Motion.after(this, mover, 'resolveRestingOverlaps');
    };
    if (Array.isArray(this.heroes)) for (const h of this.heroes) consider(h);
    if (Array.isArray(this.monsters)) for (const m of this.monsters) consider(m);
  },


  /**
   * Compute a flee/retreat path away from hostile threats.
   * `threats`: array of living hostile entities near `entity`.
   * `fleeDist`: target world distance to retreat (e.g. entity's moveLeft).
   * `opts`: pathfinding options (e.g. { avoidClosedDoors: true } for monsters).
   */
  findFleePath(entity, threats, fleeDist = 5.0, opts = {}) {
    if (!entity || !threats || !threats.length) return null;
    let dx = 0, dz = 0;
    for (const t of threats) {
      if (!t || (t.data && t.data.hp <= 0)) continue;
      const ex = entity.x - t.x, ez = entity.z - t.z;
      const d = Math.hypot(ex, ez) || 1;
      dx += ex / d;
      dz += ez / d;
    }
    const len = Math.hypot(dx, dz);
    if (len < 0.001) { dx = (Math.random() - 0.5); dz = (Math.random() - 0.5); }
    else { dx /= len; dz /= len; }

    const fromCell = this.cellOf(entity.x, entity.z);
    if (fromCell < 0) return null;

    const angles = [0, 0.785, -0.785, 1.57, -1.57, 2.35, -2.35];
    let bestPath = null;
    let maxDist = -1;

    for (const distMult of [1.0, 0.75, 0.5]) {
      const dist = fleeDist * distMult;
      if (dist < 1.0) break;
      for (const ang of angles) {
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        const rx = dx * cosA - dz * sinA;
        const rz = dx * sinA + dz * cosA;
        const goalCell = this.nearFloorCell(this.cellOf(entity.x + rx * dist, entity.z + rz * dist), 2);
        if (goalCell < 0 || goalCell === fromCell) continue;

        const path = this.findPath(fromCell, goalCell, opts);
        if (path && path.length > 1) {
          const endCell = path[path.length - 1];
          const W = this.D ? this.D.W : 20;
          const endX = this.wx(endCell % W), endZ = this.wz(Math.floor(endCell / W));
          let minThreatDist = 1e9;
          for (const t of threats) {
            if (!t || (t.data && t.data.hp <= 0)) continue;
            const d = Math.hypot(endX - t.x, endZ - t.z);
            if (d < minThreatDist) minThreatDist = d;
          }
          if (minThreatDist > maxDist) {
            maxDist = minThreatDist;
            bestPath = path;
          }
        }
      }
      if (bestPath && maxDist >= 2.0) break;
    }
    return bestPath;
  },

  /* Is a tight chokepoint cell already claimed by another live body that is
     "ahead" of `self` — either standing inside the cell, or closer to its
     centre than self is? Used by stepAlong to enforce single-file passage
     through 1-wide doorways. Returns that entity, or null. The ahead-only
     test means the body nearer the doorway keeps moving while the one behind
     yields, so two entities approaching from opposite sides never mutually
     block (whoever is closer wins; a rare exact tie just lets both proceed). */
  _chokeOccupant(cell, self) {
    const { W } = this.D;
    const cxw = this.wx(cell % W), czw = this.wz(Math.floor(cell / W));
    const myD = Math.hypot(self.x - cxw, self.z - czw);
    const selfIsHero = Array.isArray(this.heroes) && this.heroes.includes(self);
    const claims = (e) => {
      if (!e || e === self) return false;
      if (e.data && e.data.hp <= 0) return false;
      const d = Math.hypot(e.x - cxw, e.z - czw);
      if (d > 0.5) return false;
      return this.cellOf(e.x, e.z) === cell || d < myD - 0.02;
    };
    for (const h of this.heroes) if (claims(h)) return h;
    /* Only ACTIVE monsters block a doorway — a dormant monster (active falsy)
       isn't part of separation and shouldn't make heroes yield to it.
       During exploration, heroes have right-of-way over monsters in chokepoints. */
    if (!selfIsHero || this.state !== 'crawl') {
      for (const m of this.monsters) if (m.active && claims(m)) return m;
    }
    return null;
  },

  /* Classify why an entity is stuck: wall-blocked, entity-blocked,
     oscillating (direction reversal), or unknown.  Used by multi-stage
     stuck recovery to pick the right recovery strategy. */
  classifyStuck(e) {
    const { W, grid } = this.D;
    const cx = this.cellOf(e.x, e.z);
    if (cx < 0) return 'unknown';
    const cxX = cx % W, cxY = Math.floor(cx / W);

    /* wall-blocked: ≥3 of 4 cardinal neighbours are walls */
    /* wall-blocked: ≥3 of 4 cardinal neighbours are walls / boundaries */
    let wallCount = 0;
    if (cxX > 0 && grid[cx - 1] !== FLOOR) wallCount++;
    if (cxX < W - 1 && grid[cx + 1] !== FLOOR) wallCount++;
    if (cxY > 0 && grid[cx - W] !== FLOOR) wallCount++;
    if (cxY < this.D.H - 1 && grid[cx + W] !== FLOOR) wallCount++;
    if (wallCount >= 3) return 'wall';

    /* entity-blocked: another living entity within 0.55 tiles */
    for (const h of this.heroes) {
      if (h === e || h.data.hp <= 0) continue;
      if (Math.hypot(h.x - e.x, h.z - e.z) < 0.55) return 'entity';
    }
    for (const m of this.monsters) {
      if (m === e || m.data.hp <= 0 || !m.active) continue;
      if (Math.hypot(m.x - e.x, m.z - e.z) < 0.55) return 'entity';
    }

    /* oscillation: recent movement reversed direction */
    if (e._lastDx !== undefined && e._lastDz !== undefined &&
        e._dx !== undefined && e._dz !== undefined) {
      const dot = e._lastDx * e._dx + e._lastDz * e._dz;
      if (dot < -0.3) return 'oscillation';
    }
    return 'unknown';
  },

  /* snap a cell to the nearest walkable floor cell within `rad` (props like
     chests can sit on non-floor tiles that BFS refuses as a destination) */
  nearFloorCell(cell, rad = 3) {
    if (!this.D || !this.D.grid) return -1;
    const { W, H, grid } = this.D;
    const solid = this.D.solidProps;
    if (cell >= 0 && cell < grid.length && grid[cell] === FLOOR && (!solid || !solid[cell])) return cell;
    const cx = (cell >= 0 && cell < grid.length) ? (cell % W) : Math.floor(W / 2);
    const cy = (cell >= 0 && cell < grid.length) ? Math.floor(cell / W) : Math.floor(H / 2);
    const maxR = (cell >= 0 && cell < grid.length) ? rad : Math.max(rad, Math.max(W, H));
    for (let r = 1; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nc = ny * W + nx;
          if (grid[nc] === FLOOR && (!solid || !solid[nc])) return nc;
        }
      }
    }
    if (this.roomAnchor && this.roomAnchor.length > 0 && this.roomAnchor[0] >= 0) {
      return this.roomAnchor[0];
    }
    return -1;
  }
};
