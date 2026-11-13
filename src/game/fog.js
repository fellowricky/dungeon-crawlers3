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
import { firstRunTip } from './help_ui.js';
import { stopNixieEffect } from '../render/nixie_vfx.js';

const FRONTIER_DIM = 0.35;
const HIDE_Y = -999;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _E = new THREE.Euler();
const _c = new THREE.Color();

/**
 * Build the cell → instance index maps the fog dims and hides through.
 *
 * The FLOOR map comes from the scene, which records it as it emits the
 * instances (dungeon_scene's floorCellStart/floorCellCount). It used to be
 * re-derived right here by walking the grid and assuming one instance per
 * FLOOR cell — a duplicate of buildScene's ordering that had to be kept in
 * step by hand, and wasn't: staircases emit three treads each, so from the
 * first stair onward every index was off by a growing amount and the fog dimmed
 * unrelated tiles. Ask the thing that built them instead of guessing.
 *
 * A cell can own several instances (a staircase's treads), so the map is a
 * start index plus a count; callers walk the run.
 *
 * Walls are still derived, and correctly — one instance per WALL cell, in grid
 * order, which is exactly what buildScene emits. test/fog_instance_map.test.js
 * checks both against a real scene.
 *
 * @param d      dungeon
 * @param floors { start, count } from the renderer; omit for a headless
 *               harness with no scene, which then gets the naive 1:1 map.
 */
export function buildFogMaps(d, floors) {
  const { W, H, grid } = d;
  const wallInst = new Int32Array(W * H).fill(-1);
  let wi = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (grid[c] === WALL) wallInst[c] = wi++;
  }

  let floorInst, floorInstN;
  if (floors && floors.start && floors.count) {
    floorInst = floors.start;
    floorInstN = floors.count;
  } else {
    floorInst = new Int32Array(W * H).fill(-1);
    floorInstN = new Uint8Array(W * H);
    let fi = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x;
      if (grid[c] === FLOOR && !d.lakeMask[c]) { floorInst[c] = fi++; floorInstN[c] = 1; }
    }
  }

  return { floorInst, floorInstN, wallInst,
           revealed: new Uint8Array(W * H),
           /* Line-of-sight layers, kept SEPARATE from `revealed` on purpose.
              `revealed` means "the party has been here" and is read by
              monster_ai.tryActivateMonster to decide whether a monster may
              wake; writing a sighting into it would make every monster you can
              see through an open doorway activation-eligible, and
              activateRoomMonsters would then wake its whole room.
              `losSeen`   — has ever been in a hero's line of sight (remembered)
              `losVisible`— is in a hero's line of sight right now (lit) */
           losSeen: new Uint8Array(W * H), losVisible: new Uint8Array(W * H),
           visitedRooms: new Uint8Array(d.rooms.length) };
}

/** Y a door instance rests at once it has finished opening — far enough under
 *  the floor to be out of sight, and well above HIDE_Y so it never reads as
 *  fog-hidden. */
export const DOOR_OPEN_Y = -10.0;

/** Is this instance currently parked by the fog rather than by its owner? */
export function isFogHidden(mesh, i) {
  const s = mesh && mesh.userData && mesh.userData.set;
  return !!s && s.py[i] <= -500;
}

/**
 * Write one gate instance to match its open/closed state.
 *
 * Lives here, next to _sinkInstance/_raiseInstance, because it has to respect
 * their convention: while the fog has a gate hidden it OWNS that instance's py,
 * and restores it from _origPy when the cell is revealed. An owner that writes
 * py directly resurrects fogged gates — which is how closed doors ended up
 * floating in the dark over corridors the party had never seen. Any door
 * opening anywhere triggers a full re-sync, so one careless write lifted every
 * hidden gate on the floor at once.
 *
 * Returns true if live state was written, false if the fog holds the instance.
 */
export function syncDoorInstance(gateMesh, i, isOpen) {
  const s = gateMesh && gateMesh.userData && gateMesh.userData.set;
  if (!s) return false;
  const targetY = isOpen ? DOOR_OPEN_Y : 0;

  /* An open door is scaled to NOTHING, in the set arrays themselves — not just
     in the matrix we happen to write here.
     Sinking it out of sight is not enough on its own: several other passes
     rebuild a gate's matrix straight from these arrays (the fog raising a
     revealed cell, settleAll after the intro animation), and every one of them
     took the full scale and put the slab back — hanging in the void under the
     map, which is exactly where it was visible from a high camera. Zero here
     and there is nothing left for any of them to draw. */
  if (!gateMesh.userData._doorScale) {
    gateMesh.userData._doorScale = { sx: s.sx.slice(), sy: s.sy.slice(), sz: s.sz.slice() };
  }
  const base = gateMesh.userData._doorScale;
  s.sx[i] = isOpen ? 0 : base.sx[i];
  s.sy[i] = isOpen ? 0 : base.sy[i];
  s.sz[i] = isOpen ? 0 : base.sz[i];

  /* Always record where the gate BELONGS, so the fog raises it correctly
     later even though we may not touch it now. */
  if (gateMesh.userData._origPy) gateMesh.userData._origPy[i] = targetY;
  if (isFogHidden(gateMesh, i)) return false;

  s.py[i] = targetY;
  _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
  _p.set(s.px[i], targetY, s.pz[i]);
  _s.set(s.sx[i], s.sy[i], s.sz[i]);
  _m.compose(_p, _q, _s);
  gateMesh.setMatrixAt(i, _m);
  return true;
}

/* Octant transforms for recursive shadowcasting: [xx, xy, yx, yy]. */
const FOV_OCTANTS = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]
];

/**
 * Recursive shadowcasting over one octant (Björn Bergström's formulation).
 *
 * Chosen over casting a ray to each perimeter cell — the obvious approach —
 * because perimeter rays leave unlit holes inside open rooms (no ray happens to
 * land on a cell), give asymmetric results (A sees B but B does not see A), and
 * cost O(cells x ray length) instead of O(cells).
 *
 * Blocking cells are themselves marked visible, so you see the wall you are
 * looking at rather than a room with no edges.
 */
function castLight(cx, cy, row, startSlope, endSlope, radius, xx, xy, yx, yy, W, H, blocks, mark) {
  if (startSlope < endSlope) return;
  let start = startSlope;
  let newStart = 0;
  let blocked = false;
  const r2 = radius * radius;

  for (let distance = row; distance <= radius && !blocked; distance++) {
    const dy = -distance;
    for (let dx = -distance; dx <= 0; dx++) {
      const curX = cx + dx * xx + dy * xy;
      const curY = cy + dx * yx + dy * yy;
      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);

      if (start < rightSlope) continue;
      if (endSlope > leftSlope) break;
      if (curX < 0 || curY < 0 || curX >= W || curY >= H) continue;

      const c = curY * W + curX;
      if (dx * dx + dy * dy <= r2) mark(c);

      if (blocked) {
        if (blocks(c)) { newStart = rightSlope; continue; }
        blocked = false;
        start = newStart;
      } else if (blocks(c) && distance < radius) {
        blocked = true;
        castLight(cx, cy, distance + 1, start, leftSlope, radius, xx, xy, yx, yy, W, H, blocks, mark);
        newStart = rightSlope;
      }
    }
  }
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
    mesh.userData._cellBright = null;
    const set = mesh.userData.set;
    for (let i = 0; i < set.n; i++) {
      if (only && !only.has(i)) continue;
      mesh.setColorAt(i, _c.set(set.col[i]).multiplyScalar(FRONTIER_DIM));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  },

  /** Every floor instance belonging to cell `c` — a staircase owns several. */
  _eachFloorInstance(c, fn) {
    const fi = this.floorInst[c];
    if (fi < 0) return;
    const n = this.floorInstN ? (this.floorInstN[c] || 1) : 1;
    for (let k = 0; k < n; k++) fn(fi + k);
  },

  hideCell(c) {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    if (floor) this._eachFloorInstance(c, (i) => this._sinkInstance(floor, i));
    const wi = this.wallInst[c];
    if (wi >= 0) {
      if (wall && wi < wall.userData.set.n) this._sinkInstance(wall, wi);
      if (wallCap && wi < wallCap.userData.set.n) this._sinkInstance(wallCap, wi);
    }
  },

  showCell(c) {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    if (floor) this._eachFloorInstance(c, (i) => this._raiseInstance(floor, i));
    const wi = this.wallInst[c];
    if (wi >= 0) {
      if (wall && wi < wall.userData.set.n) this._raiseInstance(wall, wi);
      if (wallCap && wi < wallCap.userData.set.n) this._raiseInstance(wallCap, wi);
    }
  },

  _sinkInstance(mesh, i) {
    const u = mesh.userData, s = u.set;
    if (!u._origPy) u._origPy = s.py.slice();
    if (u._visState && u._visState[i] === 1 && s.py[i] === HIDE_Y) return;
    if (!u._visState) u._visState = new Uint8Array(s.n);
    u._visState[i] = 1;
    s.py[i] = HIDE_Y;
    this._writeInstanceMatrix(mesh, i);
  },

  _raiseInstance(mesh, i) {
    const u = mesh.userData, s = u.set;
    const origY = u._origPy ? u._origPy[i] : s.py[i];
    if (u._visState && u._visState[i] === 2 && s.py[i] === origY) return;
    if (!u._visState) u._visState = new Uint8Array(s.n);
    u._visState[i] = 2;
    s.py[i] = origY;
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

  /** Write a cell's brightness. No bookkeeping — callers own `revealed`. */
  _paintCell(c, multiplier) {
    const { floor, wall, wallCap } = this.engine.getMeshes();
    if (multiplier <= 0) {
      if (floor && floor.userData._cellBright) floor.userData._cellBright[c] = 0;
      if (wall && wall.userData._cellBright) wall.userData._cellBright[c] = 0;
      if (wallCap && wallCap.userData._cellBright) wallCap.userData._cellBright[c] = 0;
      this.hideCell(c);
      return;
    }
    this.showCell(c);
    const N = this.D ? this.D.W * this.D.H : 0;
    if (floor) {
      if (!floor.userData._cellBright || floor.userData._cellBright.length !== N) floor.userData._cellBright = new Float32Array(N).fill(-1);
      if (floor.userData._cellBright[c] !== multiplier) {
        floor.userData._cellBright[c] = multiplier;
        this._eachFloorInstance(c, (i) => {
          floor.setColorAt(i, _c.set(floor.userData.set.col[i]).multiplyScalar(multiplier));
        });
        floor.instanceColor.needsUpdate = true;
      }
    }
    const wi = this.wallInst[c];
    if (wi >= 0) {
      if (wall && wi < wall.userData.set.n) {
        if (!wall.userData._cellBright || wall.userData._cellBright.length !== N) wall.userData._cellBright = new Float32Array(N).fill(-1);
        if (wall.userData._cellBright[c] !== multiplier) {
          wall.userData._cellBright[c] = multiplier;
          wall.setColorAt(wi, _c.set(wall.userData.set.col[wi]).multiplyScalar(multiplier));
          wall.instanceColor.needsUpdate = true;
        }
      }
      if (wallCap && wi < wallCap.userData.set.n) {
        if (!wallCap.userData._cellBright || wallCap.userData._cellBright.length !== N) wallCap.userData._cellBright = new Float32Array(N).fill(-1);
        if (wallCap.userData._cellBright[c] !== multiplier) {
          wallCap.userData._cellBright[c] = multiplier;
          wallCap.setColorAt(wi, _c.set(wallCap.userData.set.col[wi]).multiplyScalar(multiplier));
          wallCap.instanceColor.needsUpdate = true;
        }
      }
    }
  },

  setCellBrightness(c, multiplier) {
    this._paintCell(c, multiplier);
    this.revealed[c] = multiplier >= 1.0 ? 1 : 0;
  },

  /**
   * Brightness this cell is entitled to from line of sight alone: full while a
   * hero can see it, FRONTIER_DIM once seen and remembered, 0 if never seen.
   *
   * Only cells in rooms the party has NOT entered can earn a tier here.
   * Corridors and visited rooms already have their own rules (revealAround,
   * _sinkCorridors, visitRoom) and masking them out keeps the field quiet as
   * the party walks through territory it already knows — the vision pass then
   * reports "nothing changed" and skips the repaint.
   */
  _losTier(c) {
    if (!this.losSeen || !this.D || !this.D.roomId) return 0;
    const rid = this.D.roomId[c];
    /* Skip only what already has a BRIGHTER rule of its own: a room the party
       has entered (all 1.0) and any cell proximity has revealed. Corridors are
       emphatically not skipped — restricting this to unvisited rooms was why
       the reveal did nothing in play. Sampled at the party's position on a real
       crypt floor, the sight radius held 7 corridor cells and 0 unvisited-room
       cells, so the rule excluded literally everything that was visible, and
       the only things that appeared past a door were props (which follow
       losSeen directly). What is past a door is usually corridor first. */
    if (rid >= 0 && this.visitedRooms[rid]) return 0;
    if (this.revealed[c]) return 0;
    if (this.losVisible[c]) return 1.0;
    if (this.losSeen[c]) return FRONTIER_DIM;
    return 0;
  },

  /**
   * setCellBrightness for the passes that dim UNVISITED rooms. Never paints a
   * cell darker than line of sight entitles it to, so an LOS reveal survives
   * recalculateFog — which otherwise repaints every hidden room from scratch
   * (setRoomDimLevel(rid, 0)) and erased the reveal moments after it happened.
   *
   * `revealed` is still written from `multiplier` alone, i.e. exactly what it
   * would have been without any of this: it gates monster activation, and a
   * sighting must not count as having been there.
   */
  setCellBrightnessLOS(c, multiplier) {
    /* A WALL the party has been beside (revealAround) stays lit for good.
       Without this, a wall two or three cells thick whose only floor
       neighbours lie in an unvisited room or an unreached corridor is sunk by
       every fog rebuild (its neighbour rule says 0, and _losTier says 0 for a
       revealed cell), then re-revealed by proximity on the next frame — a wall
       blinking in and out just past line of sight. Floors are untouched: a
       revealed floor already has its own permanent rule in _sinkCorridors and
       revealCell, and `revealed` on floors is what gates monster activation. */
    if (multiplier < 1.0 && this.revealed[c] && this.wallInst && this.wallInst[c] >= 0) multiplier = 1.0;
    const tier = this._losTier(c);
    this._paintCell(c, tier > multiplier ? tier : multiplier);
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
    if (floor) {
      if (floor.userData._cellBright) floor.userData._cellBright[c] = 1.0;
      this._eachFloorInstance(c, (i) => {
        floor.setColorAt(i, _c.set(floor.userData.set.col[i]));
      });
      floor.instanceColor.needsUpdate = true;
    }
    const wiN = this.wallInst[c];
    if (wiN >= 0) {
      if (wall && wiN < wall.userData.set.n) { if (wall.userData._cellBright) wall.userData._cellBright[c] = 1.0; wall.setColorAt(wiN, _c.set(wall.userData.set.col[wiN])); wall.instanceColor.needsUpdate = true; }
      if (wallCap && wiN < wallCap.userData.set.n) { if (wallCap.userData._cellBright) wallCap.userData._cellBright[c] = 1.0; wallCap.setColorAt(wiN, _c.set(wallCap.userData.set.col[wiN])); wallCap.instanceColor.needsUpdate = true; }
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

  /**
   * Recompute the party's field of view and repaint if it changed.
   *
   * Answers the "rooms past an opened door stay dark until someone steps in
   * them" complaint: the per-frame reveal driver (game.js) is a plain radius
   * with no sight test at all, and revealCell refuses cells in unvisited rooms
   * outright, so the only thing that ever lit a new room was walking into it.
   *
   * Marking is deliberately restricted to unvisited rooms — see _losTier. Sight
   * still travels through everything; it is only the bookkeeping that is
   * skipped, so walking around known territory reports no change and costs one
   * shadowcast rather than a full fog repaint.
   *
   * Returns true if the visible/remembered set moved.
   */
  updateVisionField(heroes, radius) {
    if (!this.D || this.D.overland || !this.losSeen) return false;
    const { W, H, grid, roomId, sightBlockers } = this.D;
    const prev = this.losVisible;
    const next = new Uint8Array(W * H);
    const r = Math.max(1, Math.floor(radius));

    const blocks = (c) => {
      const t = grid[c];
      if (t !== FLOOR && t !== POOL) return true;
      if (sightBlockers && sightBlockers[c]) return true;
      return typeof this.isCellDoorClosed === 'function' && this.isCellDoorClosed(c);
    };
    /* Mirror _losTier: remember anything that does not already have a brighter
       rule. Skipping cells the party has already walked past keeps the field
       stable while it moves through known ground, so `changed` stays false and
       the caller skips the fog rebuild. */
    const mark = (c) => {
      const rid = roomId[c];
      if (rid >= 0 && this.visitedRooms[rid]) return;
      if (this.revealed[c]) return;
      next[c] = 1;
    };

    for (const h of heroes) {
      if (!h || (h.data && h.data.hp <= 0)) continue;
      const cell = this.cellOf(h.x, h.z);
      if (cell < 0) continue;
      const cx = cell % W, cy = (cell / W) | 0;
      mark(cell);
      for (const [xx, xy, yx, yy] of FOV_OCTANTS) {
        castLight(cx, cy, 1, 1.0, 0.0, r, xx, xy, yx, yy, W, H, blocks, mark);
      }
    }

    let changed = false;
    for (let c = 0; c < next.length; c++) {
      if (next[c] !== prev[c]) changed = true;
      if (next[c]) this.losSeen[c] = 1;
    }
    this.losVisible = next;
    return changed;
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
      firstRunTip('treasureRoom');
    } else if (r.type === 'shrine') {
      showBanner('COZY CAMPSITE', 'A warm campfire flickers, offering safety and restorative rest.', 'banner-shrine');
      log('🔥 A warm campfire crackles, offering restorative rest.', r.type);
    } else if (r.type === 'elite') {
      showBanner('ELITE CONFRONTATION', 'A deadly encounter tests your party\'s strength.', 'banner-elite');
      log('⚠ An elite guard room! Steel yourselves.', r.type);
    } else if (r.type === 'boss') {
      showBanner('BOSS LAIR', 'The ruler of these depths awaits!', 'banner-boss');
      log('💀 The boss lair. This is it.', r.type);
      /* only where a boss actually waits: the quest's last floor */
      const q = this.activeQuest;
      if (!q || (this.questFloor | 0) >= (q.floors | 0)) firstRunTip('bossRoom');
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
      if (roomId[c] === rid || this.D.grid[c] === WALL) this.setCellBrightnessLOS(c, multiplier);
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

    // Monsters standing where the party can actually see them
    this._applyMonsterFog();
  },

  /**
   * Render living monsters the party can currently see, even in a room nobody
   * has entered — a lit room with invisible occupants reads as a bug.
   *
   * Presentation ONLY. Activation still runs through
   * monster_ai.tryActivateMonster, which gates on `revealed`; LOS never writes
   * that, so sighting a room through a doorway cannot wake it (and cannot make
   * activateRoomMonsters recruit everything in it).
   *
   * Keyed on losVisible rather than losSeen because monsters move: "remembered"
   * is a sensible tier for terrain, not for a creature that may have walked
   * off. Visibility is only ever turned ON here, matching visitRoom.
   */
  _applyMonsterFog() {
    if (!this.losVisible || !this.monsters) return;
    for (const m of this.monsters) {
      if (!m || !m.ent || !m.ent.grp || !m.data || m.data.hp <= 0) continue;
      if (m.ent.grp.visible) continue;
      const c = this.cellOf(m.x, m.z);
      if (c >= 0 && this.losVisible[c]) m.ent.grp.visible = true;
    }
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
        this.setCellBrightnessLOS(c, b);
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
          let t = isRev ? 1.0 : (nrid >= 0 ? (visState[nrid] === 2 ? 1.0 : (visState[nrid] === 1 ? FRONTIER_DIM : 0)) : (seen && seen[nc] ? FRONTIER_DIM : 0));
          const lt = this._losTier(nc);
          if (lt > t) t = lt;
          if (t > b) b = t;
        } else if (grid[nc] === POOL) {
          for (const d4 of [1, -1, W, -W]) {
            const pc = nc + d4;
            if (pc >= 0 && pc < W * H && grid[pc] === FLOOR) {
              const prid = roomId[pc];
              const isRev = !!(this.revealed && this.revealed[pc]);
              let t = isRev ? 1.0 : (prid >= 0 ? (visState[prid] === 2 ? 1.0 : (visState[prid] === 1 ? FRONTIER_DIM : 0)) : (seen && seen[pc] ? FRONTIER_DIM : 0));
              const lt = this._losTier(pc);
              if (lt > t) t = lt;
              if (t > b) b = t;
            }
          }
        }
      }
      this.setCellBrightnessLOS(c, b);
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
          this.setCellBrightnessLOS(c, FRONTIER_DIM);
        } else {
          this.setCellBrightnessLOS(c, 0); // Sink unless line of sight holds it
        }
      }
    }
    return seen;
  },

  /** Has the cell this instance stands on been seen by line of sight? */
  _propCellSeen(set, i) {
    if (!this.losSeen || !set || !set.px || !set.pz) return false;
    if (typeof this.cellOf !== 'function') return false;
    const c = this.cellOf(set.px[i], set.pz[i]);
    return this._losSeenAt(c);
  },

  /** Has this cell been seen by line of sight? */
  _losSeenAt(c) {
    return !!(this.losSeen && c >= 0 && this.losSeen[c]);
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
          /* A room-anchored prop is tied to its room's tier, which is the only
             prop branch that never consulted the per-cell reveal — so a room
             sighted through a doorway showed its floor and walls but none of
             its furniture. Fall back to where the prop actually stands. */
          visible = visState[rid] === 2 || this._propCellSeen(set, i);
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
          visible = isAdjacentRoomRevealed || !!(this.revealed && this.revealed[cell])
                    || !!(seen && seen[cell]) || this._losSeenAt(cell);
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
            /* The FLOOR and WALL meshes carry roomIds too, and their entries are
               -1, so this branch decides whether the ground itself is raised —
               not just scenery. Without the line-of-sight term here the reveal
               looked broken in exactly one specific way: room-anchored props
               (rid >= 0, above) popped into view through an opened door while
               the floor and walls under them stayed sunk, so a sighted room
               read as scatter floating in blackness. */
            visible = isAdjVis || !!(this.revealed && this.revealed[c])
                      || !!(seen && seen[c]) || this._losSeenAt(c);
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
    if (this._exitIndicator && this._exitIndicator.mesh && this.floorExit) {
      const fx = this.floorExit;
      const exitCell = fx.y * (this.D ? this.D.W : 0) + fx.x;
      const isExitVis = !!(
        (visState && visState[fx.roomId] === 2) ||
        (this.visitedRooms && this.visitedRooms[fx.roomId]) ||
        (this.revealed && this.revealed[exitCell]) ||
        (this.losSeen && this.losSeen[exitCell])
      );
      this._exitIndicator.mesh.visible = isExitVis;
      if (!isExitVis && this._exitIndicator._nixieInst) {
        stopNixieEffect(this._exitIndicator._nixieInst);
        this._exitIndicator._nixieInst = null;
      }
    }
  }
};
