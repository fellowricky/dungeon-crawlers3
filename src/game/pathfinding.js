/**
 * Grid pathfinding and local movement helpers.
 *
 * Methods are mixed onto Game — they expect `this.D`, `this.cellOf`,
 * `this.wx` / `this.wz`, and FLOOR/WALL tile constants on the dungeon grid.
 */
import { FLOOR, WALL, CHOKEPOINT_COST, HAZARD_COST, AGENT_R, TIGHT_R } from './constants.js';

/** Precompute wall-adjacency for BFS tiebreaking (prefer centre-room paths). */
export function buildWallAdj(grid, W, H) {
  const total = W * H;
  const wallAdj = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (grid[i] !== FLOOR) continue;
    const x = i % W;
    if ((x > 0 && grid[i - 1] === WALL) ||
        (x < W - 1 && grid[i + 1] === WALL) ||
        (i >= W && grid[i - W] === WALL) ||
        (i < total - W && grid[i + W] === WALL)) {
      wallAdj[i] = 1;
    }
  }
  return wallAdj;
}

/** Precompute chokepoint cells: 1-wide corridors and doorways where
 *  entities are likely to jam.  A cell is a chokepoint if it is a
 *  floor cell with neighbours that are walls on two opposite sides,
 *  i.e. it sits in a 1-tile-wide passage. */
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
    if (x === 0 || grid[i - 1] === WALL) walls++;
    if (x === W - 1 || grid[i + 1] === WALL) walls++;
    if (i < W || grid[i - W] === WALL) walls++;
    if (i >= total - W || grid[i + W] === WALL) walls++;
    if (walls >= 2) ch[i] = 1;
  }
  return ch;
}

/** Prop kinds that act as impassable solid obstacles (pillars, tables, coffins, etc.).
 *  Small scatter (skeletons, bones, debris, rocks, moss, plant scatter) remain walkable. */
export const SOLID_PROP_KINDS = new Set([
  'pillar', 'pillarA', 'pillarB', 'table', 'altarTable', 'coffin', 'sarco',
  'statue', 'tombstone', 'chest', 'shrineCrystal', 'bossCrystal', 'forge',
  'iceThrone', 'sporePod', 'megalith', 'cauldron', 'wagon', 'bookshelf',
  'weaponRack', 'brazier', 'crate', 'barrel', 'urn', 'bench', 'chair',
  'globe', 'anvil', 'ossuaryWall'
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

  // Connectivity guard: ensure all rooms remain reachable from the entrance.
  if (rooms && rooms.length > 0) {
    const startC = (entCell >= 0 && grid[entCell] === FLOOR && !solid[entCell])
      ? entCell
      : (rooms[0].cy * W + rooms[0].cx);
    if (startC >= 0 && startC < total && grid[startC] === FLOOR) {
      const reached = new Uint8Array(total);
      const q = [startC];
      reached[startC] = 1;
      let head = 0;
      while (head < q.length) {
        const curr = q[head++];
        const cx = curr % W, cy = Math.floor(curr / W);
        const neighbors = [];
        if (cx > 0) neighbors.push(curr - 1);
        if (cx < W - 1) neighbors.push(curr + 1);
        if (cy > 0) neighbors.push(curr - W);
        if (cy < H - 1) neighbors.push(curr + W);
        for (const n of neighbors) {
          if (grid[n] === FLOOR && !solid[n] && !reached[n]) {
            reached[n] = 1;
            q.push(n);
          }
        }
      }

      for (const r of rooms) {
        const rc = r.cy * W + r.cx;
        if (grid[rc] === FLOOR && !reached[rc]) {
          // Unmark solid props in isolated room area to restore reachability
          for (const p of props) {
            if (p.roomId === r.id || (Math.abs(p.x - r.cx) <= r.w && Math.abs(p.y - r.cy) <= r.h)) {
              const pc = Math.round(p.y) * W + Math.round(p.x);
              if (pc >= 0 && pc < total) solid[pc] = 0;
            }
          }
        }
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
    const avoidDoors = !!(opts && opts.avoidClosedDoors) && (typeof this.isCellDoorClosed === 'function');

    const mover = opts && opts.mover;
    const isHeroMover = mover && (Array.isArray(this.heroes) && this.heroes.includes(mover));
    const isMonsterMover = mover && (Array.isArray(this.monsters) && this.monsters.includes(mover));

    // Build set of enemy-occupied cells to route around
    const enemyCells = new Set();
    if (isHeroMover || (opts && opts.avoidOpponents === 'hero')) {
      if (Array.isArray(this.monsters)) {
        for (const m of this.monsters) {
          if (m.active && m.data && m.data.hp > 0) {
            const mc = this.cellOf(m.x, m.z);
            if (mc >= 0) enemyCells.add(mc);
          }
        }
      }
    } else if (isMonsterMover || (opts && opts.avoidOpponents === 'monster')) {
      if (Array.isArray(this.heroes)) {
        for (const h of this.heroes) {
          if (h.data && h.data.hp > 0) {
            const hc = this.cellOf(h.x, h.z);
            if (hc >= 0) enemyCells.add(hc);
          }
        }
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
        const cx = z.spellKey === 'spiritGuardians' ? z.caster?.x ?? z.x : z.x;
        const cz = z.spellKey === 'spiritGuardians' ? z.caster?.z ?? z.z : z.z;
        if (Math.hypot(wx - cx, wz - cz) <= (z.radius || 2.0)) return true;
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
        if (enemyCells.size > 0 && enemyCells.has(n) && n !== to) return false;
        return true;
      };
      const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
      const relax = (n) => {
        if (!isWalkable(n)) return;
        let step = (chokepoint && chokepoint[n]) ? CHOKEPOINT_COST : 1;
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
    if (dist[to] === Infinity) return null;
    const path = [];
    for (let c = to; c !== -1; c = par[c]) path.push(c);
    path.reverse();
    return path;
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
      if (c < 0 || this.D.grid[c] === WALL || (this.D.solidProps && this.D.solidProps[c])) return false;
      if (hasDoorCheck && this.isCellDoorClosed(c)) return false;
    }
    return true;
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
    if (!e.path || e.pathI >= e.path.length) return false;

    const prevX = e.x, prevZ = e.z;
    const { W } = this.D;
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
    if (this.blocked(bestX, bestZ, TIGHT_R)) {
      let found = false;
      const angles = [0.26, -0.26, 0.52, -0.52, 0.79, -0.79];
      for (const angle of angles) {
        const ax = e.x + Math.sin(baseAngle + angle) * step;
        const az = e.z + Math.cos(baseAngle + angle) * step;
        if (!this.blocked(ax, az, TIGHT_R)) {
          bestX = ax; bestZ = az; found = true;
          break;
        }
      }
      if (!found) {
        /* axis-slide: keep whichever single-axis component is unobstructed */
        if (!this.blocked(e.x + dirX, e.z, TIGHT_R)) { bestX = e.x + dirX; bestZ = e.z; found = true; }
        else if (!this.blocked(e.x, e.z + dirZ, TIGHT_R)) { bestX = e.x; bestZ = e.z + dirZ; found = true; }
      }
      if (!found) { bestX = e.x; bestZ = e.z; moved = false; }
    }
    e.x = bestX; e.z = bestZ;
    this.wallRepel(e);

    const targetAngle = Math.atan2(dx, dz);
    let delta = targetAngle - e.ent.grp.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
    e._lastDx = e._dx; e._lastDz = e._dz;
    e._dx = e.x - prevX; e._dz = e.z - prevZ;
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
      if (grid[nidx] !== WALL && (!this.D.solidProps || !this.D.solidProps[nidx])) continue;
      const isProp = grid[nidx] !== WALL && this.D.solidProps && this.D.solidProps[nidx];
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
       (1-wide corridor), add a gentle pull toward the cell centreline. */
    const xWalled = (cxX > 0 && grid[cx - 1] === WALL) && (cxX < W - 1 && grid[cx + 1] === WALL);
    const zWalled = (cxY > 0 && grid[cx - W] === WALL) && (cxY < H - 1 && grid[cx + W] === WALL);
    if (xWalled || zWalled) {
      const midX = this.wx(cxX), midZ = this.wz(cxY);
      const toMidX = midX - e.x, toMidZ = midZ - e.z;
      const midDist = Math.hypot(toMidX, toMidZ);
      if (midDist > 0.01) {
        const midForce = Math.min(midDist * 0.25, 0.025);
        pushX += (toMidX / midDist) * midForce;
        pushZ += (toMidZ / midDist) * midForce;
      }
    }

    const mag = Math.hypot(pushX, pushZ);
    if (mag < 0.0005) return;
    const maxPush = 0.05;
    const s = Math.min(mag, maxPush) / mag;
    const nx = e.x + pushX * s;
    const nz = e.z + pushZ * s;
    if (!this.blocked(nx, nz, TIGHT_R)) { e.x = nx; e.z = nz; }
  },

  /* 4-point wall probe used by local (non-pathfinding) movement */
  blocked(nx, nz, r = AGENT_R) {
    let c;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    const isB = (cell) => cell < 0 || this.D.grid[cell] === WALL || (this.D.solidProps && this.D.solidProps[cell]) || (hasDoorCheck && this.isCellDoorClosed(cell));
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

  /* soft pairwise separation so heroes and monsters never stand on the same
     spot — overlapping bodies push each other apart a little each frame,
     which spreads melee scrums into a readable ring. Wall-aware.
     Includes predictive separation: if two entities are moving toward each
     other, separation triggers at 1.25× the overlap radius to gently avoid
     collision before it happens.  Push force is clamped low per-frame so
     entities slide apart smoothly rather than jittering.

     Push-destination validation uses the tight doorway radius (TIGHT_R) so a
     push can complete inside a 1-wide passage — the old 0.3 probe rejected
     every push position in a doorway, so head-on hero/monster pairs jammed.

     Hero right-of-way: during exploration (this.state === 'crawl'), when a
     hero and a monster are separating and one of them is in a chokepoint,
     the monster yields — it takes the full push while the hero keeps its
     ground. This stops the deadlock where both slow to a crawl in the same
     doorway cell. In combat the push stays symmetric so melee rings form. */
  applySeparation(alive, dt) {
    /* In manual mode during initiative combat, combatants strictly adhere to tile centers */
    if (this.controlMode === 'manual' && this.initiative && this.initiative.active) {
      for (const h of alive) {
        if (!h.moving && this.snapToTileCenter) this.snapToTileCenter(h, dt, true);
      }
      for (const m of this.monsters) {
        if (m.active && m.data && m.data.hp > 0 && !m.moving && this.snapToTileCenter) this.snapToTileCenter(m, dt, true);
      }
      return;
    }
    const ents = [];
    for (const h of alive) ents.push({ e: h, r: 0.36, hero: true });
    for (const m of this.monsters)
      if (m.data.hp > 0 && m.active) ents.push({ e: m, r: 0.34 * (m.data.scale || 1), hero: false });
    const maxPush = 2.8 * dt; /* gentler than 4.5 — less jitter */
    const choke = this.D && this.D.chokepoint;
    const cellOf = (x, z) => this.cellOf(x, z);
    const explore = this.state === 'crawl';
    for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
      const A = ents[i], B = ents[j];
      if (A.hero && B.hero) {
        /* Heroes pass through each other while moving.
           When stationary, apply separation so they don't stack on the exact same spot. */
        if (A.e.moving || B.e.moving) continue;
      }
      let dx = B.e.x - A.e.x, dz = B.e.z - A.e.z;
      let dd = Math.hypot(dx, dz);
      let min = A.r + B.r;

      /* Predictive expansion: if entities are moving toward each
         other, gently expand the separation radius. */
      if (A.e.moving || B.e.moving) {
        const vAx = A.e.x - ((A.e._prevX !== undefined) ? A.e._prevX : A.e.x);
        const vAz = A.e.z - ((A.e._prevZ !== undefined) ? A.e._prevZ : A.e.z);
        const vBx = B.e.x - ((B.e._prevX !== undefined) ? B.e._prevX : B.e.x);
        const vBz = B.e.z - ((B.e._prevZ !== undefined) ? B.e._prevZ : B.e.z);
        const relVx = vAx - vBx, relVz = vAz - vBz;
        if (dx * relVx + dz * relVz < 0) {
          min *= 1.25;
        }
      }

      if (dd >= min) continue;
      if (dd < 1e-4) {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a); dz = Math.sin(a); dd = 1;
      }
      let push = Math.min((min - dd) * 0.5, maxPush);

      /* Hero right-of-way through chokepoints during exploration: the
         monster takes the full push, the hero a quarter — so the hero
         advances through the doorway while the monster backs out. */
      let pushA = push, pushB = push;
      if (explore && choke && (A.hero !== B.hero)) {
        const aChoke = A.e.x !== undefined && choke[cellOf(A.e.x, A.e.z)] > 0;
        const bChoke = B.e.x !== undefined && choke[cellOf(B.e.x, B.e.z)] > 0;
        if (aChoke || bChoke) {
          if (A.hero) { pushA = push * 0.25; pushB = push; }
          else        { pushA = push;        pushB = push * 0.25; }
        }
      }

      /* Tactical freeze (Phase 1): during a turn-locked spotlight, off-turn
         actors hold their ground — separation must not drift them off their
         square. Only the current actor yields; if both are off-turn neither
         moves. Outside initiative canMove() is always true, so exploration
         separation is unchanged. */
      if (this.initiative && this.initiative.active) {
        if (!this.canMove(A.e)) pushA = 0;
        if (!this.canMove(B.e)) pushB = 0;
      }

      const px = dx / dd, pz = dz / dd;
      if (!this.blocked(A.e.x - px * pushA, A.e.z - pz * pushA, TIGHT_R)) { A.e.x -= px * pushA; A.e.z -= pz * pushA; }
      if (!this.blocked(B.e.x + px * pushB, B.e.z + pz * pushB, TIGHT_R)) { B.e.x += px * pushB; B.e.z += pz * pushB; }
    }

    /* Wall Repulsion: push entities gently away from nearby WALL cells into open space */
    if (this.D && this.D.grid) {
      const W = this.D.W, H = this.D.H, grid = this.D.grid;
      const tacticalFreeze = !!(this.initiative && this.initiative.active);
      for (const ent of ents) {
        /* Off-turn actors are pinned during a tactical spotlight (Phase 1). */
        if (tacticalFreeze && !this.canMove(ent.e)) continue;
        const ex = ent.e.x, ez = ent.e.z;
        const gx = Math.floor(ex), gy = Math.floor(ez);
        let repX = 0, repZ = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
              const nidx = ny * W + nx;
              if (grid[nidx] === WALL || (this.D.solidProps && this.D.solidProps[nidx])) {
                const wallWx = this.wx(nx), wallWz = this.wz(ny);
                const dX = ex - wallWx, dZ = ez - wallWz;
                const d = Math.hypot(dX, dZ);
                if (d < 1.15 && d > 0.01) {
                  const force = (1.15 - d) * 2.2 * dt;
                  repX += (dX / d) * force;
                  repZ += (dZ / d) * force;
                }
              }
            }
          }
        }
        if (repX !== 0 || repZ !== 0) {
          const nx = ent.e.x + repX, nz = ent.e.z + repZ;
          if (!this.blocked(nx, nz, TIGHT_R)) {
            ent.e.x = nx; ent.e.z = nz;
          }
        }
      }
    }

    /* Store previous positions for next frame's velocity estimate */
    for (const ent of ents) {
      ent.e._prevX = ent.e.x;
      ent.e._prevZ = ent.e.z;
    }
  },

  /** Whether a world position is beyond the combat-room leash radius.
   *  Uses the room's diagonal/2 + a 2-tile buffer so the leash area is
   *  a circle that fully encompasses the room with a small doorway
   *  margin.  Returns false (no leash) when no combat room is tracked
   *  or the position is inside the radius — callers use this to decide
   *  whether to give up a chase, not to apply physics forces. */
  beyondCombatLeash(x, z) {
    return false;
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
    let wallCount = 0;
    if (cxX > 0 && grid[cx - 1] === WALL) wallCount++;
    if (cxX < W - 1 && grid[cx + 1] === WALL) wallCount++;
    if (cxY > 0 && grid[cx - W] === WALL) wallCount++;
    if (cxY < this.D.H - 1 && grid[cx + W] === WALL) wallCount++;
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
    if (cell < 0) return -1;
    const { W, H, grid } = this.D;
    const solid = this.D.solidProps;
    if (grid[cell] === FLOOR && (!solid || !solid[cell])) return cell;
    const cx = cell % W, cy = Math.floor(cell / W);
    for (let r = 1; r <= rad; r++)
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (grid[nc] === FLOOR && (!solid || !solid[nc])) return nc;
      }
    return -1;
  }
};
