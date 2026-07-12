/**
 * Fog of war and room reveal.
 * Maps grid cells → InstancedMesh indices, dims/reveals tiles, visits rooms.
 *
 * Visibility tiers (per room, recomputed when rooms are cleared):
 *   Visited   — party entered this room, full brightness
 *   Frontier  — unvisited but adjacent to a cleared room, greyed out
 *   Hidden    — unvisited and not adjacent to cleared, instances sunk below map
 */
import * as THREE from 'three';
import { FLOOR, WALL, POOL } from './constants.js';
import { log } from './ui.js';
import { playSfx } from './audio.js';

const FRONTIER_DIM = 0.35;
const HIDE_Y = -999;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _E = new THREE.Euler();

/** Build floor/wall instance index maps (must match engine buildScene order). */
export function buildFogMaps(d) {
  const { W, H, grid } = d;
  const floorInst = new Int32Array(W * H).fill(-1);
  const wallInst = new Int32Array(W * H).fill(-1);
  let fi = 0, wi = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (grid[c] === FLOOR && !d.lakeMask[c]) floorInst[c] = fi++;
    else if (grid[c] === WALL) wallInst[c] = wi++;
  }
  return { floorInst, wallInst, revealed: new Uint8Array(W * H), visitedRooms: new Uint8Array(d.rooms.length) };
}

export const fogMethods = {
  fogAll() {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    this.dimInstances(floor, null);
    this.dimInstances(wall, null);
    this.dimInstances(wallCap, null);
  },

  dimInstances(mesh, only) {
    if (!mesh) return;
    const set = mesh.userData.set;
    const c = new THREE.Color();
    for (let i = 0; i < set.n; i++) {
      if (only && !only.has(i)) continue;
      mesh.setColorAt(i, c.set(set.col[i]).multiplyScalar(FRONTIER_DIM));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  },

  hideCell(c) {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    const fi = this.floorInst[c];
    if (fi >= 0 && floor) this._sinkInstance(floor, fi);
    const wi = this.wallInst[c];
    if (wi >= 0) {
      if (wall) this._sinkInstance(wall, wi);
      if (wallCap) this._sinkInstance(wallCap, wi);
    }
  },

  showCell(c) {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    const fi = this.floorInst[c];
    if (fi >= 0 && floor) this._raiseInstance(floor, fi);
    const wi = this.wallInst[c];
    if (wi >= 0) {
      if (wall) this._raiseInstance(wall, wi);
      if (wallCap) this._raiseInstance(wallCap, wi);
    }
  },

  _sinkInstance(mesh, i) {
    const s = mesh.userData.set;
    if (!mesh.userData._origPy) mesh.userData._origPy = s.py.slice();
    s.py[i] = HIDE_Y;
    this._writeInstanceMatrix(mesh, i);
  },

  _raiseInstance(mesh, i) {
    const s = mesh.userData.set;
    if (mesh.userData._origPy) s.py[i] = mesh.userData._origPy[i];
    this._writeInstanceMatrix(mesh, i);
  },

  _writeInstanceMatrix(mesh, i) {
    const s = mesh.userData.set;
    _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
    _p.set(s.px[i], s.py[i], s.pz[i]);
    _s.set(s.sx[i], s.sy[i], s.sz[i]);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
  },

  setCellBrightness(c, multiplier) {
    if (multiplier <= 0) {
      this.hideCell(c);
    } else {
      this.showCell(c);
      const { floor, wall, wallCap } = this.engine.getMeshes();
      const col = new THREE.Color();
      const fi = this.floorInst[c];
      if (fi >= 0 && floor) {
        floor.setColorAt(fi, col.set(floor.userData.set.col[fi]).multiplyScalar(multiplier));
        floor.instanceColor.needsUpdate = true;
      }
      const wi = this.wallInst[c];
      if (wi >= 0) {
        if (wall) { wall.setColorAt(wi, col.set(wall.userData.set.col[wi]).multiplyScalar(multiplier)); wall.instanceColor.needsUpdate = true; }
        if (wallCap) { wallCap.setColorAt(wi, col.set(wallCap.userData.set.col[wi]).multiplyScalar(multiplier)); wallCap.instanceColor.needsUpdate = true; }
      }
    }
    this.revealed[c] = multiplier >= 1.0 ? 1 : 0;
  },

  revealCell(c) {
    if (this.revealed[c]) return;
    // Never auto-reveal cells in unvisited rooms — recalculateFog owns their dim level
    const rid = this.D && this.D.roomId ? this.D.roomId[c] : -1;
    if (rid >= 0 && !this.visitedRooms[rid]) return;
    this.showCell(c);
    this.revealed[c] = 1;
    const { floor, wall, wallCap } = this.engine.getMeshes();
    const col = new THREE.Color();
    const fi = this.floorInst[c];
    if (fi >= 0 && floor) {
      floor.setColorAt(fi, col.set(floor.userData.set.col[fi]));
      floor.instanceColor.needsUpdate = true;
    }
    const wiN = this.wallInst[c];
    if (wiN >= 0) {
      if (wall) { wall.setColorAt(wiN, col.set(wall.userData.set.col[wiN])); wall.instanceColor.needsUpdate = true; }
      if (wallCap) { wallCap.setColorAt(wiN, col.set(wallCap.userData.set.col[wiN])); wallCap.instanceColor.needsUpdate = true; }
    }
  },

  revealAround(cell, radius) {
    const { W, H } = this.D;
    const cx = cell % W, cy = Math.floor(cell / W);
    const r = Math.ceil(radius);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (ox * ox + oy * oy > radius * radius) continue;
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      this.revealCell(ny * W + nx);
    }
  },

  visitRoom(rid, silent = false) {
    if (rid < 0 || this.visitedRooms[rid]) return;
    this.visitedRooms[rid] = 1;
    const { W, H, roomId, rooms } = this.D;
    const r = rooms[rid];
    const x0 = Math.max(0, Math.floor(r.cx - r.w / 2) - 1), x1 = Math.min(W - 1, Math.ceil(r.cx + r.w / 2) + 1);
    const y0 = Math.max(0, Math.floor(r.cy - r.h / 2) - 1), y1 = Math.min(H - 1, Math.ceil(r.cy + r.h / 2) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = y * W + x;
      if (roomId[c] === rid || this.D.grid[c] === WALL) this.revealCell(c);
    }
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) m.ent.grp.visible = true;
    // Raise props, arches, and standalones for this room immediately
    this.recalculateFog(this);
    if (silent) return;
    const flavor = {
      combat: 'The party presses on.',
      elite: '⚠ An elite guard room! Steel yourselves.',
      treasure: '✨ A treasure vault glitters ahead!',
      shrine: '🔮 A shrine hums with restorative magic.',
      boss: '💀 The boss lair. This is it.',
      entrance: ''
    }[r.type];
    if (flavor) log(flavor, r.type);
    if (r.type === 'boss') playSfx('portcullis', { volume: 0.8 });
    else if (r.type === 'treasure') playSfx('lockUnlock', { volume: 0.6 });
  },

  setRoomDimLevel(rid, multiplier) {
    const { W, H, roomId, rooms } = this.D;
    const r = rooms[rid];
    const x0 = Math.max(0, Math.floor(r.cx - r.w / 2) - 1), x1 = Math.min(W - 1, Math.ceil(r.cx + r.w / 2) + 1);
    const y0 = Math.max(0, Math.floor(r.cy - r.h / 2) - 1), y1 = Math.min(H - 1, Math.ceil(r.cy + r.h / 2) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = y * W + x;
      if (roomId[c] === rid || this.D.grid[c] === WALL) this.setCellBrightness(c, multiplier);
    }
  },

  recalculateFog(game) {
    if (!this.D) return;
    const { rooms, edges } = this.D;
    const N = rooms.length;

    // Build adjacency list from graph edges
    const adj = Array.from({ length: N }, () => []);
    for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }

    // A room is "cleared" if visited AND no living monster inside it.
    const cleared = new Uint8Array(N);
    for (let rid = 0; rid < N; rid++) {
      if (game._roomCleared(rid)) cleared[rid] = 1;
    }

    // visState: 0 = hidden, 1 = frontier, 2 = visited
    const visState = new Uint8Array(N);

    for (let rid = 0; rid < N; rid++) {
      if (this.visitedRooms[rid]) {
        this.setRoomDimLevel(rid, 1.0);
        visState[rid] = 2;
      } else if (adj[rid].some(nb => cleared[nb])) {
        this.setRoomDimLevel(rid, FRONTIER_DIM);
        visState[rid] = 1;
      } else {
        this.setRoomDimLevel(rid, 0);
      }
    }

    // Sink corridor tiles not reachable from visible rooms. Runs first because
    // its reachability map also drives walls and cell-anchored props
    // (arches, torches, pool rims, corridor liquid, particles).
    const seen = this._sinkCorridors(visState);

    // Wall visibility from adjacency, not room bboxes — corridor-flanking
    // walls belong to no room and were never fogged by setRoomDimLevel
    this._applyWallFog(visState, seen);

    // Apply same visibility to prop instances
    this._applyPropFog(visState, seen);
  },

  /**
   * A wall is visible iff something visible stands next to it: brightness =
   * max over its 8 neighbours (visited room floor 1.0, frontier room /
   * reachable corridor 0.35, else 0). POOL neighbours count via the pool's
   * own floor neighbours so walls framing visible lava stay lit.
   */
  _applyWallFog(visState, seen) {
    const { W, H, grid, roomId } = this.D;
    const tierOf = c => {
      const rid = roomId[c];
      if (rid >= 0) return visState[rid] === 2 ? 1.0 : (visState[rid] === 1 ? FRONTIER_DIM : 0);
      return seen[c] ? FRONTIER_DIM : 0;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (this.wallInst[c] < 0) continue;
      let b = 0;
      for (let oy = -1; oy <= 1 && b < 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (grid[nc] === FLOOR) { const t = tierOf(nc); if (t > b) b = t; }
        else if (grid[nc] === POOL) {
          for (const d4 of [1, -1, W, -W]) {
            const pc = nc + d4;
            if (pc >= 0 && pc < W * H && grid[pc] === FLOOR) { const t = tierOf(pc); if (t > b) b = t; }
          }
        }
        if (b >= 1) break;
      }
      this.setCellBrightness(c, b);
    }
  },

  _sinkCorridors(visState) {
    const { W, H, grid, roomId } = this.D;
    const seen = new Uint8Array(W * H);
    const q = new Int32Array(W * H); let qh = 0, qt = 0;

    // Seed BFS from cells in visited / frontier rooms
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        const rid = roomId[c];
        if (rid >= 0 && visState[rid] > 0 && grid[c] === FLOOR) { seen[c] = 1; q[qt++] = c; }
      }
    }

    // BFS through floor cells; stop at hidden rooms
    while (qh < qt) {
      const c = q[qh++], cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (seen[nc] || grid[nc] !== FLOOR) continue;
        const nrid = roomId[nc];
        if (nrid >= 0 && visState[nrid] <= 0) continue; // don't enter hidden rooms
        seen[nc] = 1; q[qt++] = nc;
      }
    }

    // Sink unreachable floor cells, show reachable corridor cells at frontier dim
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (grid[c] !== FLOOR || roomId[c] >= 0) continue; // only corridor cells
        if (seen[c]) {
          this.setCellBrightness(c, FRONTIER_DIM);
        } else {
          this.setCellBrightness(c, 0); // Sink
        }
      }
    }
    return seen;
  },

  _applyPropFog(visState, seen) {
    const meshes = this.engine.getMeshes();
    for (const key in meshes) {
      const mesh = meshes[key];
      const roomIds = mesh.userData && mesh.userData.roomIds;
      if (!roomIds || !roomIds.length) continue;
      for (let i = 0; i < roomIds.length; i++) {
        // roomIds encoding: >=0 room id · -1 unfogged · <=-2 cell-anchored
        // (arches, pool rims): grid cell (-2 - rid) follows corridor BFS
        const rid = roomIds[i];
        let visible;
        if (rid >= 0) visible = visState[rid] > 0;
        else if (rid <= -2 && seen) visible = !!seen[-2 - rid];
        else continue;
        if (visible) this._raiseInstance(mesh, i);
        else this._sinkInstance(mesh, i);
      }
    }
    // Point lights (roomId uses the same >=0 / -2-cell encoding as props)
    const lights = this.engine.getLights && this.engine.getLights();
    if (lights) {
      for (const L of lights) {
        const rid = L.userData.roomId;
        let vis;
        if (rid === undefined) continue;
        if (rid >= 0) vis = visState[rid] > 0;
        else if (rid <= -2 && seen) vis = !!seen[-2 - rid];
        else continue;
        L.userData.fogMult = vis ? 1 : 0;
      }
    }
    // Ambient particles: sink emitters whose anchor floor cell isn't visible
    const parts = this.engine.getParticles && this.engine.getParticles();
    if (parts && parts.userData.fogCells && seen) {
      const cells = parts.userData.fogCells, oy = parts.userData.origY;
      const pos = parts.geometry.getAttribute('position');
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        pos.array[i * 3 + 1] = (c >= 0 && seen[c]) ? oy[i] : HIDE_Y;
      }
      pos.needsUpdate = true;
    }
    // Standalone meshes (portal, rune ring, shafts, per-room liquid).
    // {rid} follows the room tier; {cells} (corridor-anchored liquid) is
    // visible if any anchor cell is BFS-reachable. Visibility combines with
    // the UI layer toggle via userData.layerVisible (see applyObjectVis).
    const standalone = this.engine.getStandalone && this.engine.getStandalone();
    if (standalone) {
      for (const s of standalone) {
        let vis;
        if (s.cells) {
          vis = false;
          if (seen) for (const c of s.cells) { if (seen[c]) { vis = true; break; } }
        } else if (s.rid >= 0) {
          vis = visState[s.rid] > 0;
        } else continue;
        s.mesh.userData.fogVisible = vis;
        s.mesh.visible = vis && s.mesh.userData.layerVisible !== false;
      }
    }
  }
};
