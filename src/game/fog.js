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
import { log, showBanner } from './ui.js';
import { playSfx } from './audio.js';

const FRONTIER_DIM = 0.35;
const HIDE_Y = -999;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _E = new THREE.Euler();
const _c = new THREE.Color();

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
    for (let i = 0; i < set.n; i++) {
      if (only && !only.has(i)) continue;
      mesh.setColorAt(i, _c.set(set.col[i]).multiplyScalar(FRONTIER_DIM));
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
    const hidden = s.py[i] <= -500;
    _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
    _p.set(s.px[i], s.py[i], s.pz[i]);
    _s.set(hidden ? 0 : s.sx[i], hidden ? 0 : s.sy[i], hidden ? 0 : s.sz[i]);
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
      const fi = this.floorInst[c];
      if (fi >= 0 && floor) {
        floor.setColorAt(fi, _c.set(floor.userData.set.col[fi]).multiplyScalar(multiplier));
        floor.instanceColor.needsUpdate = true;
      }
      const wi = this.wallInst[c];
      if (wi >= 0) {
        if (wall) { wall.setColorAt(wi, _c.set(wall.userData.set.col[wi]).multiplyScalar(multiplier)); wall.instanceColor.needsUpdate = true; }
        if (wallCap) { wallCap.setColorAt(wi, _c.set(wallCap.userData.set.col[wi]).multiplyScalar(multiplier)); wallCap.instanceColor.needsUpdate = true; }
      }
    }
    this.revealed[c] = multiplier >= 1.0 ? 1 : 0;
  },

  revealCell(c) {
    if (this.revealed[c]) return;
    // Never auto-reveal cells in unvisited rooms — recalculateFog owns their dim
    // level. Overland maps are the exception: every cell brightens by proximity,
    // so a clearing lights up as the party approaches, before it's "visited".
    if (!(this.D && this.D.overland)) {
      const rid = this.D && this.D.roomId ? this.D.roomId[c] : -1;
      if (rid >= 0 && !this.visitedRooms[rid]) return;
    }
    this.showCell(c);
    this.revealed[c] = 1;
    const { floor, wall, wallCap } = this.engine.getMeshes();
    const fi = this.floorInst[c];
    if (fi >= 0 && floor) {
      floor.setColorAt(fi, _c.set(floor.userData.set.col[fi]));
      floor.instanceColor.needsUpdate = true;
    }
    const wiN = this.wallInst[c];
    if (wiN >= 0) {
      if (wall) { wall.setColorAt(wiN, _c.set(wall.userData.set.col[wiN])); wall.instanceColor.needsUpdate = true; }
      if (wallCap) { wallCap.setColorAt(wiN, _c.set(wallCap.userData.set.col[wiN])); wallCap.instanceColor.needsUpdate = true; }
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
    if (r.banner) {
      showBanner(r.banner.title, r.banner.subtitle, 'banner-' + (r.banner.style || 'special'));
      log(`⚔️ Special Room: ${r.banner.title} — ${r.banner.subtitle}`, r.type);
    } else if (r.type === 'treasure') {
      showBanner('SECRET VAULT', 'Ancient treasures and forgotten loot lie within.', 'banner-treasure');
      log('✨ A treasure vault glitters ahead!', r.type);
    } else if (r.type === 'shrine') {
      showBanner('COZY CAMPSITE', 'A warm campfire flickers, offering safety and restorative rest.', 'banner-shrine');
      log('🔥 A warm campfire crackles, offering restorative rest.', r.type);
    } else if (r.type === 'elite') {
      showBanner('ELITE CONFRONTATION', 'A deadly encounter tests your party\'s strength.', 'banner-elite');
      log('⚠ An elite guard room! Steel yourselves.', r.type);
    } else if (r.type === 'boss') {
      showBanner('BOSS LAIR', 'The ruler of these depths awaits!', 'banner-boss');
      log('💀 The boss lair. This is it.', r.type);
    } else {
      const flavor = {
        combat: 'The party presses on.',
        entrance: ''
      }[r.type];
      if (flavor) log(flavor, r.type);
    }
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
    // Overland maps: shrouded-map fog. Nothing is ever sunk to black; the whole
    // map sits at dim-grey and cells brighten permanently once the party has
    // been near them (this.revealed[c], set by revealAround / visitRoom).
    if (this.D.overland) { this._recalcOverlandFog(); return; }
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
      } else if (adj[rid].some(nb => cleared[nb]) || (this._scoutedRooms && this._scoutedRooms[rid])) {
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
   * Overland fog: grey the whole map, never sink. Terrain the party hasn't been
   * near (revealed[c] === 0) is held at FRONTIER_DIM; revealed cells keep the
   * full brightness revealCell gave them. Props/particles/lights/standalone are
   * all shown so the landscape reads through the shroud.
   */
  _recalcOverlandFog() {
    const { W, H, grid, lakeMask } = this.D;
    const n = W * H;
    for (let c = 0; c < n; c++) {
      if (this.revealed[c]) continue;                    // near party — stays lit
      const isFloor = grid[c] === FLOOR && !lakeMask[c];
      if (isFloor || this.wallInst[c] >= 0) this.setCellBrightness(c, FRONTIER_DIM);
    }
    this._showAllObjects();
  },

  /** Raise/show every fog-managed object (overland has no per-room hiding). */
  _showAllObjects() {
    const meshes = this.engine.getMeshes();
    for (const key in meshes) {
      const mesh = meshes[key];
      const roomIds = mesh.userData && mesh.userData.roomIds;
      if (!roomIds || !roomIds.length) continue;
      for (let i = 0; i < roomIds.length; i++) this._raiseInstance(mesh, i);
    }
    const lights = this.engine.getLights && this.engine.getLights();
    if (lights) for (const L of lights) { if (L.userData.roomId !== undefined) L.userData.fogMult = 1; }
    const parts = this.engine.getParticles && this.engine.getParticles();
    if (parts && parts.userData.fogCells) {
      const oy = parts.userData.origY, pos = parts.geometry.getAttribute('position');
      for (let i = 0; i < parts.userData.fogCells.length; i++) pos.array[i * 3 + 1] = oy[i];
      pos.needsUpdate = true;
    }
    const standalone = this.engine.getStandalone && this.engine.getStandalone();
    if (standalone) for (const s of standalone) {
      s.mesh.userData.fogVisible = true;
      s.mesh.visible = s.mesh.userData.layerVisible !== false;
    }
  },

  /**
   * A wall is visible iff something visible stands next to it: brightness =
   * max over its 8 neighbours (visited room floor 1.0, frontier room /
   * reachable corridor 0.35, else 0). POOL neighbours count via the pool's
   * own floor neighbours so walls framing visible lava stay lit.
   */
  _applyWallFog(visState, seen) {
    const { W, H, grid, roomId } = this.D;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (this.wallInst[c] < 0) continue;

      const rid = roomId[c];
      if (rid >= 0) {
        const st = visState[rid];
        const b = st === 2 ? 1.0 : (st === 1 ? FRONTIER_DIM : 0);
        this.setCellBrightness(c, b);
        continue;
      }

      let b = 0;
      for (let oy = -1; oy <= 1 && b < 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (grid[nc] === FLOOR) {
          const nrid = roomId[nc];
          const isRev = !!(this.revealed && this.revealed[nc]);
          const t = isRev ? 1.0 : (nrid >= 0 ? (visState[nrid] === 2 ? 1.0 : (visState[nrid] === 1 ? FRONTIER_DIM : 0)) : (seen && seen[nc] ? FRONTIER_DIM : 0));
          if (t > b) b = t;
        } else if (grid[nc] === POOL) {
          for (const d4 of [1, -1, W, -W]) {
            const pc = nc + d4;
            if (pc >= 0 && pc < W * H && grid[pc] === FLOOR) {
              const prid = roomId[pc];
              const isRev = !!(this.revealed && this.revealed[pc]);
              const t = isRev ? 1.0 : (prid >= 0 ? (visState[prid] === 2 ? 1.0 : (visState[prid] === 1 ? FRONTIER_DIM : 0)) : (seen && seen[pc] ? FRONTIER_DIM : 0));
              if (t > b) b = t;
            }
          }
        }
      }
      this.setCellBrightness(c, b);
    }
  },

  _sinkCorridors(visState) {
    const { W, H, grid, roomId } = this.D;
    const seen = new Uint8Array(W * H);
    const q = new Int32Array(W * H); let qh = 0, qt = 0;

    // Seed BFS from cells in VISITED rooms ONLY
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        const rid = roomId[c];
        if (rid >= 0 && visState[rid] === 2 && grid[c] === FLOOR) { seen[c] = 1; q[qt++] = c; }
      }
    }

    // BFS through floor cells; stop at unvisited rooms
    while (qh < qt) {
      const c = q[qh++], cx = c % W, cy = (c / W) | 0;
      for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (seen[nc] || grid[nc] !== FLOOR) continue;
        const nrid = roomId[nc];
        if (nrid >= 0 && visState[nrid] < 2) continue; // don't enter unvisited rooms
        seen[nc] = 1; q[qt++] = nc;
      }
    }

    // Sink unreachable floor cells, show reachable corridor cells at frontier dim, keep revealed cells at 1.0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (grid[c] !== FLOOR || roomId[c] >= 0) continue; // only corridor cells
        if (this.revealed && this.revealed[c]) {
          this.setCellBrightness(c, 1.0);
        } else if (seen[c]) {
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
      const set = mesh.userData.set;
      for (let i = 0; i < roomIds.length; i++) {
        // roomIds encoding: >=0 room id · -1 unfogged/wall-anchored · <=-2 cell-anchored
        // (arches, pool rims): grid cell (-2 - rid) follows corridor BFS
        const rid = roomIds[i];
        let visible = false;
        if (rid >= 0) {
          visible = visState[rid] === 2;
        } else if (rid <= -2) {
          const cell = -2 - rid;
          const { W, H, roomId } = this.D || {};
          let isAdjacentRoomRevealed = false;
          if (roomId && W && H && cell >= 0 && cell < W * H) {
            const x = cell % W, y = (cell / W) | 0;
            for (let oy = -1; oy <= 1 && !isAdjacentRoomRevealed; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const nx = x + ox, ny = y + oy;
                if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
                  const nc = ny * W + nx;
                  const r = roomId[nc];
                  if (r >= 0 && visState[r] === 2) {
                    isAdjacentRoomRevealed = true;
                    break;
                  }
                }
              }
            }
          }
          visible = isAdjacentRoomRevealed || !!(this.revealed && this.revealed[cell]) || !!(seen && seen[cell]);
        } else if (rid === -1 && set && set.px && set.pz) {
          const c = typeof this.cellOf === 'function' ? this.cellOf(set.px[i], set.pz[i]) : -1;
          if (c >= 0) {
            const { W, H, roomId } = this.D || {};
            let isAdjVis = false;
            if (roomId && W && H) {
              const x = c % W, y = (c / W) | 0;
              for (let oy = -1; oy <= 1 && !isAdjVis; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                  const nx = x + ox, ny = y + oy;
                  if (nx >= 0 && ny >= 0 && nx < W && ny < H) {
                    const r = roomId[ny * W + nx];
                    if (r >= 0 && visState[r] === 2) { isAdjVis = true; break; }
                  }
                }
              }
            }
            visible = isAdjVis || !!(this.revealed && this.revealed[c]) || !!(seen && seen[c]);
          } else {
            visible = false;
          }
        }

        if (visible) this._raiseInstance(mesh, i);
        else this._sinkInstance(mesh, i);
      }
    }
    // Point lights (roomId uses the same >=0 / -2-cell encoding as props)
    const lights = this.engine.getLights && this.engine.getLights();
    if (lights) {
      for (const L of lights) {
        const rid = L.userData.roomId;
        let vis = false;
        if (rid === undefined) continue;
        if (rid >= 0) vis = visState[rid] === 2;
        else if (rid <= -2) {
          const cell = -2 - rid;
          const cellRid = this.D && this.D.roomId ? this.D.roomId[cell] : -1;
          if (cellRid >= 0) vis = visState[cellRid] === 2;
          else vis = !!(this.revealed && this.revealed[cell]);
        }
        L.userData.fogMult = vis ? 1 : 0;
      }
    }
    // Ambient particles: sink emitters whose anchor floor/pool cell isn't visible
    const parts = this.engine.getParticles && this.engine.getParticles();
    if (parts && parts.userData.fogCells) {
      const cells = parts.userData.fogCells, oy = parts.userData.origY;
      const pos = parts.geometry.getAttribute('position');
      const { roomId } = this.D || {};
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        let isVis = false;
        if (c >= 0) {
          const rid = roomId && roomId[c];
          if (rid >= 0 && visState && visState[rid] === 2) isVis = true;
          else if (this.revealed && this.revealed[c]) isVis = true;
          else if (seen && seen[c]) isVis = true;
        }
        pos.array[i * 3 + 1] = isVis ? oy[i] : HIDE_Y;
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
          vis = visState[s.rid] === 2;
        } else continue;
        s.mesh.userData.fogVisible = vis;
        s.mesh.visible = vis && s.mesh.userData.layerVisible !== false;
      }
    }
  }
};
