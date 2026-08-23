/**
 * Grid pathfinding and local movement helpers.
 *
 * Methods are mixed onto Game — they expect `this.D`, `this.cellOf`,
 * `this.wx` / `this.wz`, and FLOOR/WALL tile constants on the dungeon grid.
 */
import { FLOOR, WALL, CHOKEPOINT_COST, HAZARD_COST, ALLY_PASS_COST, AGENT_R, TIGHT_R } from './constants.js';
import { isPointInAoEZone } from './aoe_system.js';

/** Precompute wall-adjacency for BFS tiebreaking (prefer centre-room paths). */
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
  'pillar', 'pillarA', 'pillarB', 'table', 'altarTable', 'coffin', 'sarco',
  'statue', 'tombstone', 'chest', 'shrineCrystal', 'forge',
  'iceThrone', 'sporePod', 'megalith', 'cauldron', 'wagon', 'bookshelf',
  'weaponRack', 'shieldRack', 'brazier', 'crate', 'barrel', 'urn', 'vase',
  'bench', 'chair', 'globe', 'anvil', 'ossuaryWall', 'runicObelisk',
  'glacialSpire', 'stalagmite', 'hearthPit', 'smeltingCrucible', 'cairn',
  'skulltotem', 'boulderPile', 'tree', 'snowtree', 'tree_winter', 'swamptree', 'deadtree'
]);

/** Precompute solidProps map (1 = impassable prop obstacle) for the dungeon grid. */
export function buildSolidProps(d) {
  if (!d) return null;
  const { W, H, grid, props, entrance, rooms } = d;
  if (!W || !H || !grid) return null;
  const total = W * H;
  const solid = new Uint8Array(total);
  if (!props || !Array.isArray(props)) return solid;

  const entCell = (entrance && typeof entrance.x === 'number' && typeof entrance.y === 'number')
    ? entrance.y * W + entrance.x
    : -1;

  for (const p of props) {
    if (!p || !p.kind || !SOLID_PROP_KINDS.has(p.kind)) continue;
    const x = Math.round(p.x), y = Math.round(p.y);
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const c = y * W + x;
    if (grid[c] !== FLOOR) continue;
    if (c === entCell) continue;
    if (d.doorway && d.doorway[c]) continue; // Do not block doorway tiles

    solid[c] = 1;
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
      const flood = () => {
        const reached = new Uint8Array(total);
        const q = [startC];
        reached[startC] = 1;
        let head = 0;
        while (head < q.length) {
          const curr = q[head++];
          const cx = curr % W, cy = Math.floor(curr / W);
          if (cx > 0 && grid[curr - 1] === FLOOR && !solid[curr - 1] && !reached[curr - 1]) { reached[curr - 1] = 1; q.push(curr - 1); }
          if (cx < W - 1 && grid[curr + 1] === FLOOR && !solid[curr + 1] && !reached[curr + 1]) { reached[curr + 1] = 1; q.push(curr + 1); }
          if (cy > 0 && grid[curr - W] === FLOOR && !solid[curr - W] && !reached[curr - W]) { reached[curr - W] = 1; q.push(curr - W); }
          if (cy < H - 1 && grid[curr + W] === FLOOR && !solid[curr + W] && !reached[curr + W]) { reached[curr + W] = 1; q.push(curr + W); }
        }
        return reached;
      };
      let reached = flood();

      const roomSealed = (r) => {
        const rw = r.w || 0, rh = r.h || 0;
        let hasFloor = false;
        for (let oy = -rh; oy <= rh; oy++) {
          for (let ox = -rw; ox <= rw; ox++) {
            const x = r.cx + ox, y = r.cy + oy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const c = y * W + x;
            if (grid[c] !== FLOOR) continue;
            hasFloor = true;
            if (reached[c]) return false; // at least one reachable floor cell
          }
        }
        return hasFloor; // has floor cells but none reachable
      };

      for (let iter = 0; iter <= props.length; iter++) {
        let sealed = -1;
        for (let i = 0; i < rooms.length; i++) {
          if (roomSealed(rooms[i])) { sealed = i; break; }
        }
        if (sealed < 0) break;

        /* Distance (in walkable, non-solid floor steps) from every cell to the
           reachable frontier, so we can pick the solid prop that is actually
           cutting off the room. */
        const dist = new Int32Array(total).fill(-1);
        const fq = [];
        for (let c = 0; c < total; c++) if (reached[c]) { dist[c] = 0; fq.push(c); }
        let fh = 0;
        while (fh < fq.length) {
          const c = fq[fh++];
          const cx = c % W, cy = Math.floor(c / W), nd = dist[c] + 1;
          const tryPush = (n) => {
            if (dist[n] < 0 && grid[n] === FLOOR && !solid[n]) { dist[n] = nd; fq.push(n); }
          };
          if (cx > 0) tryPush(c - 1);
          if (cx < W - 1) tryPush(c + 1);
          if (cy > 0) tryPush(c - W);
          if (cy < H - 1) tryPush(c + W);
        }

        let bestC = -1, bestD = Infinity;
        for (const p of props) {
          if (!p || !p.kind || !SOLID_PROP_KINDS.has(p.kind)) continue;
          const x = Math.round(p.x), y = Math.round(p.y);
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const c = y * W + x;
          if (solid[c] !== 1) continue;
          let d = Infinity;
          if (x > 0 && dist[c - 1] >= 0 && dist[c - 1] < d) d = dist[c - 1];
          if (x < W - 1 && dist[c + 1] >= 0 && dist[c + 1] < d) d = dist[c + 1];
          if (y > 0 && dist[c - W] >= 0 && dist[c - W] < d) d = dist[c - W];
          if (y < H - 1 && dist[c + W] >= 0 && dist[c + W] < d) d = dist[c + W];
          if (d < bestD) { bestD = d; bestC = c; }
        }
        if (bestC < 0) break; // sealed by the grid itself — nothing to clear
        solid[bestC] = 0;
        reached = flood();
      }
    }
  }

  return solid;
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
    if (grid[to] !== FLOOR || (this.D.solidProps && this.D.solidProps[to])) return null;
    const total = W * H;
    const wallAdj = this.D.wallAdj;
    const chokepoint = this.D.chokepoint;
    const inCombat = typeof this.isCombatActive === 'function' ? this.isCombatActive() : !!(this.combat || (this.initiative && this.initiative.active));
    const avoidDoors = (inCombat || !!(opts && opts.avoidClosedDoors)) && (typeof this.isCellDoorClosed === 'function');

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
       separately below, so nobody ends their move inside a teammate. */
    const enemyCells = new Set();
    const allyCells = new Set();
    const sideOf = (b) => (Array.isArray(this.monsters) && this.monsters.includes(b)) ? 'mon' : 'hero';
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
    /* Nobody may FINISH on an occupied tile, ally or enemy. */
    if (allyCells.has(to) || enemyCells.has(to)) return null;

    /* Build set of cells reserved by OTHERS (intent-aware occupancy).
       findPath runs BEFORE setEntityPath commits a new reservation, so the
       mover's own current reservation is excluded — it represents a heading
       the mover is about to abandon. Without this, repathing would be blocked
       by the mover's own stale destination. */
    const reservedCells = new Set();
    if (mover && typeof this.isCellReserved === 'function' && this._reservedCells) {
      for (const [cell, owner] of this._reservedCells) {
        if (owner === mover) continue;
        if (owner && owner.data && owner.data.hp <= 0 && !owner._dying) continue;
        reservedCells.add(cell);
      }
    }

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
        if (grid[n] !== FLOOR || (this.D.solidProps && this.D.solidProps[n])) return false;
        if (avoidDoors && this.isCellDoorClosed(n)) return false;
        /* No destination exemption: a cell with a body on it is not a place to
           stand, goal or not. Callers that want to reach a creature ask
           approachCellNear/getUnoccupiedCellNear for a free neighbouring tile
           instead — the old `n !== to` escape hatch was how two bodies ended up
           finishing their paths on the same square. */
        if (enemyCells.size > 0 && enemyCells.has(n)) return false;
        /* Reserved-by-another cells are blocked. No destination exception —
           a destination reserved by someone else is genuinely taken; callers
           must use approachCellNear/getUnoccupiedCellNear to pick a free one. */
        if (reservedCells.size > 0 && reservedCells.has(n)) return false;
        return true;
      };
      const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
      const relax = (n) => {
        if (!isWalkable(n)) return;
        let step = (chokepoint && chokepoint[n]) ? CHOKEPOINT_COST : 1;
        /* Squeezing past a teammate is allowed but awkward — prefer a clear
           lane when one exists, take the shove when the detour is worse. */
        if (allyCells.size > 0 && allyCells.has(n)) step += ALLY_PASS_COST;
        if (!avoidDoors && hasDoorCheck && this.isCellDoorClosed(n)) step += 5.0;
        if (hasAoE && isHazard(n)) step += HAZARD_COST;
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
      if (x > 0 && c >= W && isWalkable(c - 1) && isWalkable(c - W)) relax(c - W - 1);
      if (x < W - 1 && c >= W && isWalkable(c + 1) && isWalkable(c - W)) relax(c - W + 1);
      if (x > 0 && c < total - W && isWalkable(c - 1) && isWalkable(c + W)) relax(c + W - 1);
      if (x < W - 1 && c < total - W && isWalkable(c + 1) && isWalkable(c + W)) relax(c + W + 1);
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
    for (let r = 1; r <= radius; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const nc = ny * W + nx;
          if (this.D.grid[nc] !== FLOOR) continue;
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
    const isFree = (nc) => {
      if (nc < 0 || this.D.grid[nc] !== FLOOR) return false;
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
      if (c < 0 || this.D.grid[c] !== FLOOR || (this.D.solidProps && this.D.solidProps[c])) return false;
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
    target.x += (dx / len) * cells;
    target.z += (dz / len) * cells;
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

    /* ── Path[0] skip ──────────────────────────────────────────────────
       The #1 cause of exploration jitter was here: every repath produces a
       fresh path whose node 0 is the entity's OWN cell. If the entity has
       already walked past that cell's centre (distance > CAPTURE), it would
       briefly turn BACK toward its own cell centre — a visible 180° flip +
       tiny backstep on every repath (followers repath every 0.35 s).
       Fix: if pathI===0 and the entity is closer to path[1] than to path[0],
       jump straight to path[1]. The entity never targets a node behind it. */
    if (e.pathI === 0 && e.path.length > 1) {
      const c0 = e.path[0], c1 = e.path[1];
      const d0 = Math.hypot(this.wx(c0 % W) - e.x, this.wz(Math.floor(c0 / W)) - e.z);
      const d1 = Math.hypot(this.wx(c1 % W) - e.x, this.wz(Math.floor(c1 / W)) - e.z);
      if (d1 < d0) e.pathI = 1;
    }

    const isFinalNode = (e.pathI >= e.path.length - 1);
    const CAPTURE = isFinalNode ? 0.05 : 0.35;

    /* Advance past any cells we've already reached (within capture range)
       WITHOUT snapping position — just re-target the next cell and fall
       through to the normal movement code.  Eliminates the visual
       "flick to cell centre" that happened on every path-step. */
    let c = e.path[e.pathI];
    let tx = this.wx(c % W), tz = this.wz(Math.floor(c / W));
    let dx = tx - e.x, dz = tz - e.z;
    let dist = Math.hypot(dx, dz);

    e._blockedByDoor = false;

    /* Arriving at the LAST node: land exactly on the tile centre and stop.
       Previously the walk ended anywhere within 0.05 of centre and the residue
       was cleaned up later by snapToTileCenter's lerp — which is the little
       shuffle you see after a creature stops. A tile centre is by definition a
       legal position (the cell is floor and unoccupied, both already checked),
       so there is nothing to slide around: just land on it. */
    if (isFinalNode && dist <= CAPTURE) {
      e.x = tx; e.z = tz;
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = 0; e._dz = 0;
      e.pathI++;
      return false;
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
    /* Bodies block where you come to REST, not where you pass through.
       Two creatures crossing the same tile mid-stride is invisible at this
       speed; two creatures *standing* on it is the artefact worth preventing.
       Blocking every step outright instead gridlocked corridors — everyone
       stalled behind whoever was in front and fights dragged on — so the body
       check is applied only to the final node of the path. Resting overlap is
       then caught for good by snapToTileCenter, which steps aside rather than
       centring two bodies on the same point. */
    const bodyAware = isFinalNode;
    const isBlocked = (x, z) => bodyAware
      ? this.blockedForEntity(x, z, e, TIGHT_R)
      : this.blocked(x, z, TIGHT_R);
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
    this.wallRepel(e);

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
    const cxX = cx % W, cxY = Math.floor(cx / W);
    let pushX = 0, pushZ = 0;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of dirs) {
      const nx = cxX + dx, ny = cxY + dz;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nidx = ny * W + nx;
      if (grid[nidx] === FLOOR && (!this.D.solidProps || !this.D.solidProps[nidx])) continue;
      const isProp = grid[nidx] === FLOOR && this.D.solidProps && this.D.solidProps[nidx];
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
    const xWalled = (cxX > 0 && grid[cx - 1] !== FLOOR) && (cxX < W - 1 && grid[cx + 1] !== FLOOR);
    const zWalled = (cxY > 0 && grid[cx - W] !== FLOOR) && (cxY < H - 1 && grid[cx + W] !== FLOOR);
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
    if (!this.blocked(nx, nz, TIGHT_R)) { e.x = nx; e.z = nz; }
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
    if (this.blocked(nx, nz, r)) return true;
    const target = this.cellOf(nx, nz);
    if (target < 0) return true;
    /* Already standing there (mid-cell drift) — never block our own square. */
    if (target === this.cellOf(e.x, e.z)) return false;
    return this.isCellBodyOccupied(target, e);
  },

  /* 4-point wall probe used by local (non-pathfinding) movement */
  blocked(nx, nz, r = AGENT_R) {
    if (!this.D || !this.D.grid) return true;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    const isB = (cell) => cell < 0 || this.D.grid[cell] !== FLOOR || (this.D.solidProps && this.D.solidProps[cell]) || (hasDoorCheck && this.isCellDoorClosed(cell));
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

    if (!this.blocked(nx, nz, TIGHT_R)) {
      e.x = nx; e.z = nz;
      return step > 0.012;
    }
    if (!this.blocked(nx, e.z, TIGHT_R)) {
      e.x = nx;
      return Math.abs(stepX) > 0.012;
    }
    if (!this.blocked(e.x, nz, TIGHT_R)) {
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
  snapStationaryToTiles(alive, dt) {
    if (!this.initiative || !this.initiative.active) return;
    /* Used to be manual-mode only. The game is grid-based in ALL modes, so a
       body that has stopped belongs on its tile centre either way — leaving
       auto-mode combatants parked wherever their last step ended is what makes
       them look like they are drifting and then twitching into place. */
    if (!this.snapToTileCenter) return;
    for (const h of alive) {
      if (!h.moving) this.snapToTileCenter(h, dt, true);
    }
    for (const m of this.monsters) {
      if (m.active && m.data && m.data.hp > 0 && !m.moving) this.snapToTileCenter(m, dt, true);
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
      if (e.moving || e.walk) return;                 /* in transit — leave it */
      const c = this.cellOf(e.x, e.z);
      if (c < 0) return;
      const other = seen.get(c);
      if (!other) { seen.set(c, e); return; }
      /* Move the one that is NOT the current actor, so we never shove the
         creature whose turn it is out from under its own decision. */
      const mover = (typeof this.isCurrentActor === 'function' && this.isCurrentActor(e)) ? other : e;
      const free = this.getUnoccupiedCellNear(c, mover, 3);
      if (free < 0 || free === c) return;             /* genuinely nowhere to go */
      const W = this.D.W;
      mover.x = this.wx(free % W);
      mover.z = this.wz(Math.floor(free / W));
      if (typeof this.releaseReservation === 'function') this.releaseReservation(mover);
      if (typeof this.reserveCell === 'function') this.reserveCell(mover, free);
      seen.set(free, mover);
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
