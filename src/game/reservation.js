/**
 * Cell reservation system — the single source of truth for "who owns a tile".
 *
 * Mixed onto Game.prototype alongside pathfindingMethods. The occupancy model
 * used to be purely *derived* from each entity's float x/z (via cellOf), which
 * meant two combatants animating onto the same cell wouldn't be detected until
 * both had arrived, and the cleanup (`enforceUnoccupiedCell`) had to teleport
 * one of them aside — producing the visible "shove out of the square" jitter.
 *
 * Reservation adds *intent*. When a path is committed via `setEntityPath`, its
 * destination cell is reserved for that entity; pathfinding (`findPath`,
 * `approachCellNear`) and spawn placement (`placeAtFreeCell`) all treat cells
 * reserved by OTHERS as blocked. This makes two combatants landing on the same
 * cell structurally impossible, so `enforceUnoccupiedCell` becomes unreachable
 * and the per-frame soft-body `applySeparation` can be removed entirely.
 *
 * Lifecycle:
 *   setEntityPath(e, path)   — release old reservation, assign path, reserve endpoint
 *   clearEntityPath(e)       — release reservation, null out path
 *   releaseReservation(e)    — release only (leaves path alone, used on death)
 *   placeAtFreeCell(e, x, z) — pick a free cell near (x,z), set e.x/z, reserve
 *   pushEntity(t, fromX, fromZ, cells) — cell-by-cell knockback honoring walls/occupancy
 *
 * State is lazy-initialized: `this._reservedCells` is a Map<cellIndex, entity>.
 * Each entity also carries `e.reservedCell` (its currently-held reservation, or -1).
 */
import { FLOOR } from './constants.js';

export const reservationMethods = {
  /* Lazy-init the reservation map. Safe to call repeatedly. */
  _ensureReservation() {
    if (!this._reservedCells) this._reservedCells = new Map();
  },

  /** Reserve `cell` for `e`. Releases any prior reservation held by `e` first,
   *  so an entity ever holds at most one cell. No-op if `cell < 0`. */
  reserveCell(e, cell) {
    if (!e || cell < 0) return;
    this._ensureReservation();
    const prev = e.reservedCell;
    if (prev === cell) return;            /* already holds it */
    if (prev >= 0) this._reservedCells.delete(prev);
    /* If the cell is somehow already reserved by someone else (shouldn't happen
       through the normal API, but defensive), the new owner wins and the old
       owner's field is invalidated. */
    const priorOwner = this._reservedCells.get(cell);
    if (priorOwner && priorOwner !== e) priorOwner.reservedCell = -1;
    this._reservedCells.set(cell, e);
    e.reservedCell = cell;
  },

  /** Release whatever cell `e` has reserved. No-op if it holds none. */
  releaseReservation(e) {
    if (!e) return;
    const prev = e.reservedCell;
    if (prev == null || prev < 0) return;
    this._ensureReservation();
    /* Only delete the map entry if e still owns it (avoids wiping a new owner
       if e's field is stale). */
    if (this._reservedCells.get(prev) === e) this._reservedCells.delete(prev);
    e.reservedCell = -1;
  },

  /** True if `cell` is reserved by anyone other than `excludeEntity`.
   *  Dead/dying holders are ignored (their reservations are considered void). */
  isCellReserved(cell, excludeEntity) {
    if (cell < 0 || !this._reservedCells) return false;
    const owner = this._reservedCells.get(cell);
    if (!owner || owner === excludeEntity) return false;
    /* A dead holder's reservation is stale — treat as free so pathing doesn't
       permanently block on a corpse. Its release should have been called on
       death, but this is a belt-and-braces guard. */
    if (owner.data && owner.data.hp <= 0 && !owner._dying) return false;
    return true;
  },

  /** Sweep the reservation map and void any entry whose owner no longer
   *  intends the cell. Called once per frame from game.js — cheap (the map is
   *  bounded by the entity count). This is the safety net that makes bare
   *  `e.path = null` assignments safe: even if a site forgets to call
   *  clearEntityPath, the stale reservation is dropped within a frame.
   *
   *  An owner "intends" its reserved cell if EITHER:
   *    - it has a live path whose final node is that cell, OR
   *    - it's standing on that cell (cellOf(x,z) === cell). */
  reapReservations() {
    if (!this._reservedCells || this._reservedCells.size === 0) return;
    const cellOf = this.cellOf;
    const hasCellOf = typeof cellOf === 'function';
    for (const [cell, owner] of this._reservedCells) {
      if (!owner) { this._reservedCells.delete(cell); continue; }
      if (owner.data && owner.data.hp <= 0 && !owner._dying) {
        /* dead holder — release */
        this._reservedCells.delete(cell);
        if (owner.reservedCell === cell) owner.reservedCell = -1;
        continue;
      }
      const path = owner.path;
      const intendsViaPath = Array.isArray(path) && path.length > 0 && path[path.length - 1] === cell;
      const intendsViaPosition = hasCellOf && cellOf(owner.x, owner.z) === cell;
      if (!intendsViaPath && !intendsViaPosition) {
        this._reservedCells.delete(cell);
        if (owner.reservedCell === cell) owner.reservedCell = -1;
      }
    }
  },

  /** Set an entity's path and atomically reserve its destination cell.
   *  - Releases any prior reservation held by `e`.
   *  - Assigns `e.path = path; e.pathI = 0`.
   *  - Reserves the LAST cell of `path` (the destination). path[0] is the
   *    start cell and is never reserved by this call.
   *  Pass `path = null` (or omit) to act as `clearEntityPath`. */
  setEntityPath(e, path) {
    if (!e) return;
    this._ensureReservation();
    this.releaseReservation(e);
    e.path = path || null;
    e.pathI = 0;
    if (path && path.length > 0) {
      this.reserveCell(e, path[path.length - 1]);
    }
  },

  /** Clear an entity's path and release its reservation. */
  clearEntityPath(e) {
    if (!e) return;
    this.releaseReservation(e);
    e.path = null;
    e.pathI = 0;
  },

  /** Place `e` at a free cell near world `(x, z)` and reserve it.
   *  Searches outward in rings up to `radius` (default 3) for an unoccupied,
   *  unreserved, walkable floor cell; falls back to the raw cell if none found.
   *  Calls `onPlace(entity, cell)` if supplied (e.g. to sync a mesh). */
  placeAtFreeCell(e, x, z, opts = {}) {
    if (!e || !this.D) return e;
    const radius = opts.radius != null ? opts.radius : 3;
    const W = this.D.W;
    const rawCell = (typeof this.cellOf === 'function') ? this.cellOf(x, z) : -1;
    const solid = this.D.solidProps;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    const isFree = (c) => {
      if (c < 0 || this.D.grid[c] !== FLOOR) return false;
      if (solid && solid[c]) return false;
      if (hasDoorCheck && this.isCellDoorClosed(c)) return false;
      if (typeof this.isCellOccupiedAny === 'function' && this.isCellOccupiedAny(c, e)) return false;
      if (typeof this.isCellReserved === 'function' && this.isCellReserved(c, e)) return false;
      return true;
    };

    let target = rawCell;
    if (rawCell < 0 || !isFree(rawCell)) {
      target = -1;
      const H = this.D.H || Math.floor(this.D.grid.length / W);
      const cx = (rawCell >= 0 && rawCell < this.D.grid.length) ? (rawCell % W) : Math.floor(W / 2);
      const cy = (rawCell >= 0 && rawCell < this.D.grid.length) ? Math.floor(rawCell / W) : Math.floor(H / 2);
      outer: for (let r = 1; r <= radius; r++) {
        for (let oy = -r; oy <= r; oy++) {
          for (let ox = -r; ox <= r; ox++) {
            if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue; /* ring only */
            const nx = cx + ox, ny = cy + oy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nc = ny * W + nx;
            if (isFree(nc)) { target = nc; break outer; }
          }
        }
      }
      if (target < 0 && typeof this.nearFloorCell === 'function') {
        target = this.nearFloorCell(rawCell >= 0 ? rawCell : 0, 50);
      }
      if (target < 0 && this.roomAnchor && this.roomAnchor[0] >= 0) {
        target = this.roomAnchor[0];
      }
    }

    if (target < 0) return e;

    /* Assign position at the chosen cell's center. */
    const tx = (typeof this.wx === 'function') ? this.wx(target % W) : (target % W) + 0.5;
    const tz = (typeof this.wz === 'function') ? this.wz(Math.floor(target / W)) : Math.floor(target / W) + 0.5;
    e.x = tx; e.z = tz;
    this.releaseReservation(e);
    this.reserveCell(e, target);
    if (typeof opts.onPlace === 'function') opts.onPlace(e, target);
    return e;
  },

  /** Cell-by-cell knockback / pull for spell effects. Walks `target` one whole
   *  cell at a time away from (push) or toward (pull) `(fromX, fromZ)`,
   *  stopping at the first wall / solid prop / closed door / occupied or
   *  reserved cell. `dir` = +1 to push away, -1 to pull toward. `cells` = max
   *  whole tiles to move. Releases and re-reserves the target's cell as it
   *  lands. Returns the number of cells actually moved. */
  pushEntity(target, fromX, fromZ, cells, dir = 1) {
    if (!target || !this.D || !(cells > 0)) return 0;
    const W = this.D.W, H = this.D.H || Math.floor(this.D.grid.length / W);
    const solid = this.D.solidProps;
    const hasDoorCheck = typeof this.isCellDoorClosed === 'function';
    let curCell = (typeof this.cellOf === 'function') ? this.cellOf(target.x, target.z) : -1;
    if (curCell < 0) return 0;
    const cx0 = curCell % W, cy0 = Math.floor(curCell / W);
    /* Unit step direction (whole-tile) away from / toward the source. */
    let dx = (target.x - fromX), dz = (target.z - fromZ);
    if (dir < 0) { dx = -dx; dz = -dz; }
    const len = Math.hypot(dx, dz) || 1;
    const sx = Math.sign(dx / len), sz = Math.sign(dz / len);
    /* Clamp to cardinal/diagonal step in {-1,0,1}. */
    const stepX = (dx === 0) ? 0 : (dx > 0 ? 1 : -1);
    const stepZ = (dz === 0) ? 0 : (dz > 0 ? 1 : -1);
    void sx; void sz;

    const blocked = (c) => {
      if (c < 0) return true;
      if (this.D.grid[c] !== FLOOR) return true;
      if (solid && solid[c]) return true;
      if (hasDoorCheck && this.isCellDoorClosed(c)) return true;
      if (typeof this.isCellOccupiedAny === 'function' && this.isCellOccupiedAny(c, target)) return true;
      if (typeof this.isCellReserved === 'function' && this.isCellReserved(c, target)) return true;
      return false;
    };

    let moved = 0;
    for (let i = 0; i < cells; i++) {
      const nx = cx0 + stepX * (i + 1);
      const ny = cy0 + stepZ * (i + 1);
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
      const nxCell = ny * W + nx;
      if (blocked(nxCell)) break;
      /* corner-cut guard on diagonals */
      if (stepX !== 0 && stepZ !== 0) {
        const c1 = ny * W + cx0;
        const c2 = cy0 * W + nx;
        if (this.D.grid[c1] !== FLOOR || this.D.grid[c2] !== FLOOR) break;
      }
      curCell = nxCell;
      moved++;
    }

    if (moved > 0) {
      this.releaseReservation(target);
      const tx = (typeof this.wx === 'function') ? this.wx(curCell % W) : (curCell % W) + 0.5;
      const tz = (typeof this.wz === 'function') ? this.wz(Math.floor(curCell / W)) : Math.floor(curCell / W) + 0.5;
      target.x = tx; target.z = tz;
      target.path = null; target.pathI = 0;
      this.reserveCell(target, curCell);
    }
    return moved;
  }
};
