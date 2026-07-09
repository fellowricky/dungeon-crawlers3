/**
 * Grid pathfinding and local movement helpers.
 *
 * Methods are mixed onto Game — they expect `this.D`, `this.cellOf`,
 * `this.wx` / `this.wz`, and FLOOR/WALL tile constants on the dungeon grid.
 */
import { FLOOR, WALL, STEER_ENTITY_RADIUS, CHOKEPOINT_COST } from './constants.js';

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
export function buildChokepoints(grid, W, H) {
  const total = W * H;
  const ch = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (grid[i] !== FLOOR) continue;
    const x = i % W;
    const n = (i >= W) ? grid[i - W] : WALL;
    const s = (i < total - W) ? grid[i + W] : WALL;
    const e = (x < W - 1) ? grid[i + 1] : WALL;
    const w = (x > 0) ? grid[i - 1] : WALL;
    /* 1-wide N-S corridor (walls E+W, floor N+S) */
    if (e === WALL && w === WALL && n === FLOOR && s === FLOOR) { ch[i] = 1; }
    /* 1-wide E-W corridor (walls N+S, floor E+W) */
    else if (n === WALL && s === WALL && e === FLOOR && w === FLOOR) { ch[i] = 1; }
    /* doorway cell: a floor cell adjacent to at least one wall that
       connects a room to a corridor — i.e. two opposite floor neighbours
       and the other two are walls */
    else if ((n === FLOOR && s === FLOOR && e === WALL && w === WALL) ||
             (e === FLOOR && w === FLOOR && n === WALL && s === WALL)) { ch[i] = 1; }
  }
  return ch;
}

export const pathfindingMethods = {
  /* ============ pathfinding (BFS, uniform cost) ============ */
  findPath(from, to) {
    const { W, H, grid } = this.D;
    if (from === to || from < 0 || to < 0) return null;
    if (grid[to] !== FLOOR) return null;
    const par = new Int32Array(W * H).fill(-2);
    par[from] = -1;
    const q = new Int32Array(W * H); let qh = 0, qt = 0;
    q[qt++] = from;
    const total = W * H;
    const wallAdj = this.D.wallAdj;
    const chokepoint = this.D.chokepoint;
    while (qh < qt) {
      const c = q[qh++];
      if (c === to) break;
      const x = c % W;
      /* Collect unvisited neighbours, then sort so non-wall-adjacent,
         non-chokepoint cells are explored first — this biases BFS toward
         centre-room, wide-corridor paths without changing hop-count. */
      const nb = [];
      let n;
      if (x > 0 && grid[n = c - 1] === FLOOR && par[n] === -2) { nb.push(n); }
      if (x < W - 1 && grid[n = c + 1] === FLOOR && par[n] === -2) { nb.push(n); }
      if (c >= W && grid[n = c - W] === FLOOR && par[n] === -2) { nb.push(n); }
      if (c < total - W && grid[n = c + W] === FLOOR && par[n] === -2) { nb.push(n); }
      if (nb.length > 1) {
        nb.sort((a, b) => {
          /* primary: prefer non-chokepoint cells */
          const ca = chokepoint ? (chokepoint[a] || 0) : 0;
          const cb = chokepoint ? (chokepoint[b] || 0) : 0;
          if (ca !== cb) return ca - cb;
          /* secondary: prefer non-wall-adjacent cells */
          return wallAdj[a] - wallAdj[b];
        });
      }
      for (const nn of nb) { par[nn] = c; q[qt++] = nn; }
    }
    if (par[to] === -2) return null;
    const path = [];
    for (let c = to; c !== -1; c = par[c]) path.push(c);
    path.reverse();
    return path;
  },

  hasLOS(x0, z0, x1, z1) {
    const { W } = this.D;
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist * 3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const c = this.cellOf(x0 + dx * t, z0 + dz * t);
      if (c < 0 || this.D.grid[c] === WALL) return false;
    }
    return true;
  },

  /* move entity along its path; returns true if moving.
     Wall repulsion is applied after each position update to keep
     sprites from clipping into wall geometry.  Uses a generous
     capture radius (0.35 tiles) so entities flow through cells
     without needing exact center occupancy.
     When otherEntities is provided, uses local steering to avoid
     entity-entity collisions without a full repath. */
  stepAlong(e, speed, dt, otherEntities = null) {
    if (!e.path || e.pathI >= e.path.length) return false;

    /* track movement delta for classifyStuck */
    const prevX = e.x, prevZ = e.z;

    const { W } = this.D;
    const c = e.path[e.pathI];
    const tx = this.wx(c % W), tz = this.wz(Math.floor(c / W));
    const dx = tx - e.x, dz = tz - e.z;
    const dist = Math.hypot(dx, dz);

    const CAPTURE = 0.35;
    if (dist <= CAPTURE) {
      e.x = tx; e.z = tz; e.pathI++;
      this.wallRepel(e);
      if (e.pathI < e.path.length) {
        const nx = this.wx(e.path[e.pathI] % W);
        const nz = this.wz(Math.floor(e.path[e.pathI] / W));
        const targetAngle = Math.atan2(nx - e.x, nz - e.z);
        let delta = targetAngle - e.ent.grp.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
      }
      /* store movement delta */
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = e.x - prevX; e._dz = e.z - prevZ;
      return e.pathI < e.path.length;
    }

    /* use entity-aware steering when we have other entities to avoid */
    if (otherEntities && otherEntities.length > 0) {
      const moved = this.steerStep(e, tx, tz, speed, dt, otherEntities);
      if (moved) {
        const targetAngle = Math.atan2(dx, dz);
        let delta = targetAngle - e.ent.grp.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
      }
      e._lastDx = e._dx; e._lastDz = e._dz;
      e._dx = e.x - prevX; e._dz = e.z - prevZ;
      return moved;
    }

    const step = speed * dt;
    e.x += dx / dist * step;
    e.z += dz / dist * step;
    this.wallRepel(e);
    const targetAngle = Math.atan2(dx, dz);
    let delta = targetAngle - e.ent.grp.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    e.ent.grp.rotation.y += delta * Math.min(1, dt * 8);
    e._lastDx = e._dx; e._lastDz = e._dz;
    e._dx = e.x - prevX; e._dz = e.z - prevZ;
    return true;
  },

  /* Local obstacle-aware steering: tries the direct step toward (tx,tz)
     first; if blocked by another entity (not a wall), probes ±15°/±30°/±45°
     deviations and picks the first clear one.  Falls back to axis decomposition
     (X-only, Z-only) before giving up. */
  steerStep(e, tx, tz, speed, dt, otherEntities) {
    const dx = tx - e.x, dz = tz - e.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.005) return false;
    const step = Math.min(dist, speed * dt);
    if (step < 0.005) return false;
    const baseAngle = Math.atan2(dx, dz);

    /* try direct step first */
    const nx = e.x + Math.sin(baseAngle) * step;
    const nz = e.z + Math.cos(baseAngle) * step;
    if (!this.blocked(nx, nz, 0.3) && !this.entityBlocked(nx, nz, e, otherEntities)) {
      e.x = nx; e.z = nz;
      this.wallRepel(e);
      return true;
    }

    /* try angled deviations (±15°, ±30°, ±45°) */
    const angles = [0.26, -0.26, 0.52, -0.52, 0.79, -0.79];
    for (const angle of angles) {
      const ax = e.x + Math.sin(baseAngle + angle) * step;
      const az = e.z + Math.cos(baseAngle + angle) * step;
      if (!this.blocked(ax, az, 0.3) && !this.entityBlocked(ax, az, e, otherEntities)) {
        e.x = ax; e.z = az;
        this.wallRepel(e);
        return true;
      }
    }

    /* last resort: axis-aligned slides */
    const nxOnly = e.x + Math.sin(baseAngle) * step;
    if (!this.blocked(nxOnly, e.z, 0.3) && !this.entityBlocked(nxOnly, e.z, e, otherEntities)) {
      e.x = nxOnly;
      this.wallRepel(e);
      return true;
    }
    const nzOnly = e.z + Math.cos(baseAngle) * step;
    if (!this.blocked(e.x, nzOnly, 0.3) && !this.entityBlocked(e.x, nzOnly, e, otherEntities)) {
      e.z = nzOnly;
      this.wallRepel(e);
      return true;
    }
    return false;
  },

  /* Check whether a world position overlaps with any entity in the given set
     (excluding self).  Uses a generous body radius. */
  entityBlocked(x, z, self, others) {
    const r2 = STEER_ENTITY_RADIUS * STEER_ENTITY_RADIUS;
    for (const o of others) {
      if (o === self) continue;
      if (o.data && o.data.hp <= 0) continue;
      const dx = o.x - x, dz = o.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
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
      if (grid[ny * W + nx] !== WALL) continue;
      const wx = this.wx(nx), wz = this.wz(ny);
      const tox = e.x - wx, toz = e.z - wz;
      const d = Math.hypot(tox, toz);
      if (d < 0.48 && d > 0.001) {
        const force = (0.48 - d) / 0.48 * 2.2;
        pushX += (tox / d) * force;
        pushZ += (toz / d) * force;
      }
    }

    /* Corridor centring: if both cardinal neighbours in an axis are walls
       (1-wide corridor), add a gentle pull toward the cell centreline. */
    const xWalled = (cxX > 0 && grid[cx - 1] === WALL) && (cxX < W - 1 && grid[cx + 1] === WALL);
    const zWalled = (cxY > 0 && grid[cx - W] === WALL) && (cxY < H - 1 && grid[cx + W] === WALL);
    if (xWalled || zWalled) {
      const midX = this.wx(cxX + 0.5), midZ = this.wz(cxY + 0.5);
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
    if (!this.blocked(nx, nz, 0.22)) { e.x = nx; e.z = nz; }
  },

  /* 4-point wall probe used by local (non-pathfinding) movement */
  blocked(nx, nz, r = 0.35) {
    let c;
    if ((c = this.cellOf(nx - r, nz)) < 0 || this.D.grid[c] === WALL) return true;
    if ((c = this.cellOf(nx + r, nz)) < 0 || this.D.grid[c] === WALL) return true;
    if ((c = this.cellOf(nx, nz - r)) < 0 || this.D.grid[c] === WALL) return true;
    if ((c = this.cellOf(nx, nz + r)) < 0 || this.D.grid[c] === WALL) return true;
    return false;
  },

  /* direct local move that refuses to step into a wall */
  nudgeToward(e, tx, tz, speed, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return false;
    const step = Math.min(d, speed * dt);

    const stepX = dx / d * step;
    const stepZ = dz / d * step;
    const nx = e.x + stepX;
    const nz = e.z + stepZ;

    if (!this.blocked(nx, nz, 0.35)) {
      e.x = nx; e.z = nz;
      return step > 0.012;
    }
    if (!this.blocked(nx, e.z, 0.35)) {
      e.x = nx;
      return Math.abs(stepX) > 0.012;
    }
    if (!this.blocked(e.x, nz, 0.35)) {
      e.z = nz;
      return Math.abs(stepZ) > 0.012;
    }
    return false;
  },

  /* soft pairwise separation so heroes and monsters never stand on the same
     spot — overlapping bodies push each other apart a little each frame,
     which spreads melee scrums into a readable ring. Wall-aware.
     Includes predictive separation: if two entities are moving toward each
     other, separation triggers at 1.6× the overlap radius to avoid collision
     before it happens. */
  applySeparation(alive, dt) {
    const ents = [];
    for (const h of alive) ents.push({ e: h, r: 0.36 });
    for (const m of this.monsters)
      if (m.data.hp > 0 && m.active) ents.push({ e: m, r: 0.34 * (m.data.scale || 1) });
    const maxPush = 4.5 * dt;
    for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
      const A = ents[i], B = ents[j];
      let dx = B.e.x - A.e.x, dz = B.e.z - A.e.z;
      let dd = Math.hypot(dx, dz);
      let min = A.r + B.r;

      /* Predictive expansion: if both entities are moving toward each
         other, increase the separation radius so they start yielding
         before they actually overlap. */
      if (A.e.moving || B.e.moving) {
        const vAx = A.e.x - ((A.e._prevX !== undefined) ? A.e._prevX : A.e.x);
        const vAz = A.e.z - ((A.e._prevZ !== undefined) ? A.e._prevZ : A.e.z);
        const vBx = B.e.x - ((B.e._prevX !== undefined) ? B.e._prevX : B.e.x);
        const vBz = B.e.z - ((B.e._prevZ !== undefined) ? B.e._prevZ : B.e.z);
        const relVx = vAx - vBx, relVz = vAz - vBz;
        /* dot product negative = relative velocity points toward each other */
        if (dx * relVx + dz * relVz < 0) {
          min *= 1.6;
        }
      }

      if (dd >= min) continue;
      if (dd < 1e-4) {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a); dz = Math.sin(a); dd = 1;
      }
      const push = Math.min((min - dd) * 0.5, maxPush);
      const px = dx / dd * push, pz = dz / dd * push;
      if (!this.blocked(A.e.x - px, A.e.z - pz, 0.3)) { A.e.x -= px; A.e.z -= pz; }
      if (!this.blocked(B.e.x + px, B.e.z + pz, 0.3)) { B.e.x += px; B.e.z += pz; }
    }

    /* Store previous positions for next frame's velocity estimate */
    for (const ent of ents) {
      ent.e._prevX = ent.e.x;
      ent.e._prevZ = ent.e.z;
    }
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
    if (grid[cell] === FLOOR) return cell;
    const cx = cell % W, cy = Math.floor(cell / W);
    for (let r = 1; r <= rad; r++)
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (grid[ny * W + nx] === FLOOR) return ny * W + nx;
      }
    return -1;
  }
};
