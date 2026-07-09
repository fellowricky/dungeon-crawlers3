/**
 * Fog of war and room reveal.
 * Maps grid cells → InstancedMesh indices, dims/reveals tiles, visits rooms.
 */
import * as THREE from 'three';
import { FLOOR, WALL } from './constants.js';
import { log } from './ui.js';

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
      mesh.setColorAt(i, c.set(set.col[i]).multiplyScalar(0.055));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  },

  revealCell(c) {
    if (this.revealed[c]) return;
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
  }
};
