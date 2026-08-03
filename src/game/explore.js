/**
 * Exploration AI: room goals, party cohesion, chests/shrines, click-to-move.
 * Mixed onto Game — uses pathfinding (findPath, stepAlong, nearFloorCell).
 */
import { subclassOf, CLASSES, roll } from './srd.js';
import { drawBar, spawnSlash, createSearchIndicator, updateSearchIndicator, disposeSearchIndicator } from './entities.js';
import { rollChestLoot } from './items.js';
import { lootChest } from './chest_wheel.js';
import { recoverSlots, totalSlots } from './features.js';
import { partyShortRest } from './rest.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';
import { FLOOR, HERO_SPEED, COHESION_MAX,
  FORMATION_SPACING, FORMATION_WIDTH, TIGHT_R,
  STUCK_SIDESTEP_T, STUCK_REPATH_T, STUCK_TELEPORT_T, STUCK_SIDESTEP_DIST
} from './constants.js';

export const exploreMethods = {

  /* Compute a wedge-formation offset behind the leader based on the
     leader's facing direction.  Slots spread left/right behind the
     leader so followers don't all converge on one cell. */
  getFormationSlot(leader, index) {
    const facingAngle = leader.ent.grp.rotation.y;
    const forward = { x: Math.sin(facingAngle), z: Math.cos(facingAngle) };
    const right = { x: Math.cos(facingAngle), z: -Math.sin(facingAngle) };

    /* wedge slots: ranks of 2, spaced behind the leader */
    const rank = Math.floor(index / 2);
    const side = (index % 2 === 0) ? -1 : 1;
    const behind = FORMATION_SPACING * (rank + 1);
    const lateral = FORMATION_WIDTH * (rank * 0.5 + 1) * side;

    return {
      x: leader.x - forward.x * behind + right.x * lateral,
      z: leader.z - forward.z * behind + right.z * lateral
    };
  },

  /* Multi-stage stuck recovery: lateral dodge → repath → yield → teleport.
      Returns true if the entity recovered (moved) this frame.

      Cause-aware: classifyStuck() is consulted at Stage 1 to pick a dodge
      direction that fits the situation. A *wall* jam in open ground is
      broken with a perpendicular sidestep (the original behaviour). But an
      *entity* jam or *oscillation* inside a doorway can't be sidestepped —
      both cardinal neighbours are walls — so the entity backs out along the
      leader's incoming path instead of flailing sideways against the frame.
      Without this distinction every doorway jam burned the full 2.5 s to
      teleport. */
  handleStuck(e, leader, dt) {
    /* Standing still in front of a closed gate is not being stuck — the door
       has its own 0.6 s unlock timer (updateDoors) and opens on its own. The
       sidestep/repath/teleport ladder would only shove the entity back out of
       unlock range and restart the wait, so hold position and let it open.
       Failsafe: if waiting for > 1.0 s, force open doors along the path so
       the entity never stays permanently stuck. */
    if (e._blockedByDoor) {
      e._doorWaitT = (e._doorWaitT || 0) + dt;
      if (e._doorWaitT > 1.0) {
        if (typeof this.forceDoorsAlongPath === 'function' && e.path) {
          this.forceDoorsAlongPath(e.path);
        } else if (typeof this.forceOpenAllDoors === 'function') {
          this.forceOpenAllDoors();
        }
        e._blockedByDoor = false;
        e._doorWaitT = 0;
      }
      e.stuckT = 0; e.stuckStage = 0;
      return false;
    } else {
      e._doorWaitT = 0;
    }

    e.stuckT = (e.stuckT || 0) + dt;
    e.stuckStage = e.stuckStage || 0;

    /* Stage 1 (~0.6 s): directional dodge. Pick the dodge based on cause. */
    if (e.stuckStage === 0 && e.stuckT > STUCK_SIDESTEP_T) {
      e.stuckStage = 1;
      const cause = (typeof this.classifyStuck === 'function') ? this.classifyStuck(e) : 'unknown';

      let recoverable = false;
      if (cause === 'entity' || cause === 'oscillation') {
        /* Back out toward the cell the leader came from — by definition a
           recently-cleared floor cell behind the entity, so the move is
           both useful (frees the doorway) and unobstructed. */
        const back = (leader && leader.path && leader.pathI > 0)
          ? leader.path[leader.pathI - 1] : -1;
        if (back >= 0) {
          const tx = this.wx(back % this.D.W), tz = this.wz(Math.floor(back / this.D.W));
          const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
          const bx = e.x + (dx / d) * STUCK_SIDESTEP_DIST;
          const bz = e.z + (dz / d) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(bx, bz, TIGHT_R)) {
            e.x = bx; e.z = bz;
            recoverable = true;
          }
        }
      }

      if (!recoverable) {
        /* Default perpendicular sidestep (handles 'wall' and 'unknown'). */
        const perpX = -(e.z - leader.z), perpZ = (e.x - leader.x);
        const d = Math.hypot(perpX, perpZ) || 1;
        const sx = e.x + (perpX / d) * STUCK_SIDESTEP_DIST;
        const sz = e.z + (perpZ / d) * STUCK_SIDESTEP_DIST;
        if (!this.blocked(sx, sz, TIGHT_R)) {
          e.x = sx; e.z = sz; recoverable = true;
        } else {
          /* try opposite side */
          const sx2 = e.x - (perpX / d) * STUCK_SIDESTEP_DIST;
          const sz2 = e.z - (perpZ / d) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(sx2, sz2, TIGHT_R)) {
            e.x = sx2; e.z = sz2; recoverable = true;
          }
        }
      }

      if (!recoverable) {
        /* Longitudinal fallback for narrow 1-wide passages where perpendicular sides are walls */
        const parX = (leader.x - e.x), parZ = (leader.z - e.z);
        const pd = Math.hypot(parX, parZ) || 1;
        const lx = e.x + (parX / pd) * STUCK_SIDESTEP_DIST;
        const lz = e.z + (parZ / pd) * STUCK_SIDESTEP_DIST;
        if (!this.blocked(lx, lz, TIGHT_R)) {
          e.x = lx; e.z = lz; recoverable = true;
        } else {
          const lx2 = e.x - (parX / pd) * STUCK_SIDESTEP_DIST;
          const lz2 = e.z - (parZ / pd) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(lx2, lz2, TIGHT_R)) {
            e.x = lx2; e.z = lz2; recoverable = true;
          }
        }
      }

      if (recoverable) {
        e.path = null;
        e.stuckT = 0; e.stuckStage = 0;
        return true;
      }
    }

    /* Stage 2 (~1.5 s): force full repath */
    if (e.stuckStage === 1 && e.stuckT > STUCK_REPATH_T) {
      e.stuckStage = 2;
      e.path = null; /* will repath next frame */
      return false;
    }

    /* Stage 3 (~2.5 s): last resort teleport */
    if (e.stuckStage >= 2 && e.stuckT > STUCK_TELEPORT_T) {
      e.stuckT = 0; e.stuckStage = 0;
      if (e === leader && e.pathGoal >= 0 && this.D) {
        const targetCell = this.nearFloorCell(e.pathGoal, 3);
        if (targetCell >= 0) {
          e.x = this.wx(targetCell % this.D.W);
          e.z = this.wz(Math.floor(targetCell / this.D.W));
        } else {
          e.x = leader.x + (Math.random() - 0.5) * 0.5;
          e.z = leader.z + (Math.random() - 0.5) * 0.5;
        }
      } else {
        e.x = leader.x + (Math.random() - 0.5) * 0.5;
        e.z = leader.z + (Math.random() - 0.5) * 0.5;
      }
      e.path = null;
      log(`✨ Teleported ${e.data.name} to catch up.`, 'sys');
      return true;
    }

    return false;
  },

  exploreAI(alive, leader, dt) {
    const { W } = this.D;
    let goalCell = -1;

    if (this.userGoal >= 0) {
      const gx = this.wx(this.userGoal % W), gz = this.wz(Math.floor(this.userGoal / W));
      if (Math.hypot(leader.x - gx, leader.z - gz) < 1.1) {
        this.userGoal = -1;
        log(this.controlMode === 'manual' ? '📍 The party arrives and awaits your command.' : 'The party arrives. Back to exploring.', 'sys');
      } else goalCell = this.userGoal;
    }
    if (goalCell < 0) {
      if (this.controlMode !== 'manual') {
        if (this.targetRoom < 0 || this.roomDone(this.targetRoom)) {
          this.targetRoom = this.pickNextRoom(leader);
        }
        if (this.targetRoom >= 0) goalCell = this.roomTargetCell(this.targetRoom, leader);
      }
    }

    let strayMax = 0;
    for (const h of alive) {
      if (h === leader) continue;
      strayMax = Math.max(strayMax, Math.hypot(h.x - leader.x, h.z - leader.z));
    }
    const hold = strayMax > COHESION_MAX && this.userGoal < 0;

    /* Never hold for cohesion while the leader is standing IN a doorway /
       chokepoint. Parking in the gap blocks the 1-wide passage, so the
       followers can't close up, so they stay "strayed", so the hold never
       releases — a deadlock that reads as "the leader sits in the door and the
       party paces back and forth". Force the leader to clear the gap first;
       it can hold for cohesion in the open on the far side. */
    const _leaderCell = this.cellOf(leader.x, leader.z);
    const leaderInChokeNow = this.D.chokepoint && _leaderCell >= 0 && this.D.chokepoint[_leaderCell] > 0;

    /* Limit how long the leader waits for stragglers.
       After 4 s the hold releases; the stuck follower will teleport. */
    if (hold) { this.holdT = (this.holdT || 0) + dt; }
    else { this.holdT = 0; }
    const effectiveHold = hold && (this.holdT || 0) < 4.0 && !leaderInChokeNow;

    /* --- leader movement --- */
    if (goalCell >= 0 && !effectiveHold) {
      if (!leader.path || leader.pathI >= leader.path.length || leader.pathGoal !== goalCell) {
        leader.path = this.findPath(this.cellOf(leader.x, leader.z), goalCell);
        leader.pathI = 0; leader.pathGoal = goalCell;
        if (!leader.path && this.userGoal >= 0) {
          this.userGoal = -1;
          log("The party can't find a way there.", 'sys');
        }
        if (!leader.path && goalCell === this.roomTargetCell(this.targetRoom, leader)) {
          if (this.targetRoom >= 0) {
            (this._unreachableRooms = this._unreachableRooms || {})[this.targetRoom] = true;
            this.targetRoom = -1;
          }
        }
      }
      leader.moving = this.stepAlong(leader, HERO_SPEED * leader.data.speedMult, dt);
    } else leader.moving = false;

    /* Stagnant displacement check: detect micro-oscillations against walls or props */
    if (!leader._posHistory) leader._posHistory = [];
    leader._posHistoryTimer = (leader._posHistoryTimer || 0) + dt;
    if (leader._posHistoryTimer > 0.2) {
      leader._posHistoryTimer = 0;
      leader._posHistory.push({ x: leader.x, z: leader.z });
      if (leader._posHistory.length > 8) leader._posHistory.shift(); // ~1.6s rolling window
    }

    let isOscillating = false;
    if (leader.moving && leader._posHistory.length >= 5) {
      let maxDistFromStart = 0;
      const startP = leader._posHistory[0];
      for (const p of leader._posHistory) {
        maxDistFromStart = Math.max(maxDistFromStart, Math.hypot(p.x - startP.x, p.z - startP.z));
      }
      if (maxDistFromStart < 0.40) {
        isOscillating = true;
        leader.moving = false;
      }
    }

    /* --- leader stuck recovery --- */
    if ((leader.moving && !isOscillating) || effectiveHold || leader._blockedByDoor) {
      /* _blockedByDoor: waiting on the gate to swing, not stuck — without this
         the 2.5 s escalation below flags the room beyond the door
         "unreachable" and the party turns around a beat before it opens. */
      leader.stuckT = 0; leader.stuckStage = 0;
      this.stuckT = 0;
    } else if (goalCell >= 0) {
      this.handleStuck(leader, leader, dt);
      if ((leader.stuckT || 0) > 2.5 || (this.stuckT = (this.stuckT || 0) + dt) > 2.5) {
        leader.stuckT = 0; leader.stuckStage = 0;
        this.stuckT = 0; this.holdT = 0;
        leader.path = null; leader.pathGoal = -1;
        leader._posHistory = [];
        if (this.targetRoom >= 0) {
          (this._unreachableRooms = this._unreachableRooms || {})[this.targetRoom] = true;
        }
        this.targetRoom = this.pickNextRoom(leader);
      }
    }

    /* --- follower movement with formation offsets --- */
    /* If the leader is in a chokepoint (doorway / narrow corridor),
       slow followers down so the leader clears the bottleneck first. */
    const leaderCell = this.cellOf(leader.x, leader.z);
    const leaderInChoke = this.D.chokepoint && leaderCell >= 0 && this.D.chokepoint[leaderCell];
    /* The cell the leader just left (behind it on its current path). By
       construction this is a recently-walked floor cell, so it is a safe
       "fall back and wait" target for followers caught behind a doorway. */
    const leaderBackCell = (leader.path && leader.pathI > 0)
      ? leader.path[leader.pathI - 1] : -1;
    const isChoke = (c) => c >= 0 && this.D.chokepoint && this.D.chokepoint[c] > 0;

    alive.forEach((h) => {
      if (h === leader) return;
      const idx = alive.indexOf(h) - 1; /* 0-based follower index */

      /* compute formation slot position */
      const formation = this.getFormationSlot(leader, idx);
      let formationCell = this.nearFloorCell(this.cellOf(formation.x, formation.z), 2);

      /* Doorway queueing: when the leader is in a chokepoint (a doorway /
         1-wide corridor), the wedge slot often lands inside a wall and
         nearFloorCell() relocates it onto the nearest floor — which used to
         be the doorway cell the leader currently occupies. Two followers
         then pathed onto the same tile and jammed. Instead, if the slot
         resolves to a chokepoint or to the leader's own cell, drop the
         follower back to the cell behind the leader so the party queues
         through the bottleneck single-file. */
      if (formationCell < 0 || formationCell === leaderCell || isChoke(formationCell)) {
        const backStep = (leader.path && leader.pathI > idx) ? leader.path[leader.pathI - (idx + 1)] : -1;
        if (backStep >= 0 && this.D.grid[backStep] === FLOOR) {
          formationCell = backStep;
        } else if (leaderBackCell >= 0 && this.D.grid[leaderBackCell] === FLOOR) {
          formationCell = leaderBackCell;
        } else if (formationCell < 0) {
          formationCell = leaderCell; /* last-resort fallback */
        }
      }
      const goal = formationCell >= 0 ? formationCell : this.cellOf(leader.x, leader.z);

      const dFormation = Math.hypot(h.x - formation.x, h.z - formation.z);
      const spacing = 0.9; /* close-enough radius for formation slot */
      if (dFormation < spacing && !hold) {
        h.moving = false; h.stuckT = 0; h.stuckStage = 0;
        return;
      }

      h.repathT -= dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
        h.path = this.findPath(this.cellOf(h.x, h.z), goal);
        h.pathI = 0; h.repathT = 0.35; h.pathGoal = goal;
      }

      let catchup = 1.1 + Math.min(1.2, Math.max(0, (dFormation - 1.5) * 0.25));
      /* If the leader is in a chokepoint, slow followers so the leader
         clears the bottleneck first.  Also slow if THIS follower is in
         a chokepoint — let the entity ahead of you clear it. */
      const myCell = this.cellOf(h.x, h.z);
      if (leaderInChoke || isChoke(myCell)) {
        catchup *= 0.35;
      }
      h.moving = this.stepAlong(h, HERO_SPEED * catchup * h.data.speedMult, dt);

      if (!h.moving) {
        this.handleStuck(h, leader, dt);
      } else {
        h.stuckT = 0; h.stuckStage = 0;
      }
    });
  },

  /* the cell the leader should actually walk to in a room: nearest living
     monster first (so fights start), then unlooted chest, unused shrine,
     falling back to the room anchor */
  roomTargetCell(rid, leader) {
    const { W } = this.D;
    let best = -1, bd = 1e9;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) {
      const dd = Math.hypot(m.x - leader.x, m.z - leader.z);
      if (dd < bd) { bd = dd; best = this.nearFloorCell(this.cellOf(m.x, m.z), 2); }
    }
    if (best >= 0) return best;
    for (const ch of this.chests) if (ch.roomId === rid && !ch.looted)
      return this.nearFloorCell(ch.y * W + ch.x, 2);
    for (const s of this.shrines) if (s.roomId === rid && !s.used)
      return this.nearFloorCell(s.y * W + s.x, 2);
    return this.roomAnchor[rid];
  },

  setPendingMove(hero, goalCell, path, costFt) {
    this.clearPendingMove();
    this.pendingMoveState = { active: true, hero, goalCell, path, costFt };
    this.updatePathVisual(path, costFt);
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
  },

  clearPathVisual() {
    if (this._pathVisualGroup) {
      if (this._pathVisualGroup.parent) this._pathVisualGroup.parent.remove(this._pathVisualGroup);
      else if (this.gameGroup) this.gameGroup.remove(this._pathVisualGroup);
      else if (this.engine && this.engine.scene) this.engine.scene.remove(this._pathVisualGroup);
      this._pathVisualGroup = null;
    }
  },

  clearPendingMove() {
    this.clearPathVisual();
    this.pendingMoveState = null;
    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();
  },

  updatePathVisual(path, costFt) {
    if (!path || path.length < 2) {
      this.clearPathVisual();
      return;
    }
    const parentGroup = this.gameGroup || (this.engine ? this.engine.scene : null);
    if (!parentGroup) return;

    this.clearPathVisual();

    const group = new THREE.Group();
    group.renderOrder = 999;
    const W = this.D ? this.D.W : 20;

    const wx = c => (typeof this.wx === 'function' ? this.wx(c % W) : (c % W) + 0.5);
    const wz = c => (typeof this.wz === 'function' ? this.wz(Math.floor(c / W)) : Math.floor(c / W) + 0.5);

    // Color theme matching tactical movement preview (vibrant green as requested in Image 2)
    const greenCol = 0x22c55e;

    // 1. Thick path line ribbon connecting each tile center along the path
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: greenCol,
      transparent: true,
      opacity: 0.90,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    ribbonMat.toneMapped = false;

    for (let i = 0; i < path.length - 1; i++) {
      const c1 = path[i], c2 = path[i + 1];
      const x1 = wx(c1), z1 = wz(c1);
      const x2 = wx(c2), z2 = wz(c2);

      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);

      const ribbonGeom = new THREE.PlaneGeometry(0.24, len).rotateX(-Math.PI / 2);
      const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
      ribbonMesh.renderOrder = 999;
      ribbonMesh.position.set((x1 + x2) / 2, 0.12, (z1 + z2) / 2);
      ribbonMesh.rotation.y = angle;
      group.add(ribbonMesh);
    }

    // 2. Start cell ring marker (matching Image 2)
    const ringMat = new THREE.MeshBasicMaterial({
      color: greenCol,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    ringMat.toneMapped = false;
    const ringGeom = new THREE.RingGeometry(0.20, 0.28, 32).rotateX(-Math.PI / 2);

    const startCell = path[0];
    const sx = wx(startCell), sz = wz(startCell);
    const startRing = new THREE.Mesh(ringGeom, ringMat);
    startRing.renderOrder = 1000;
    startRing.position.set(sx, 0.13, sz);
    group.add(startRing);

    // 3. Destination cell ring marker (matching Image 2)
    const destCell = path[path.length - 1];
    const lx = wx(destCell), lz = wz(destCell);
    const destRing = new THREE.Mesh(ringGeom, ringMat);
    destRing.renderOrder = 1000;
    destRing.position.set(lx, 0.13, lz);
    group.add(destRing);

    // Waypoint dots for intermediate tile centers
    const dotMat = new THREE.MeshBasicMaterial({
      color: greenCol,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    dotMat.toneMapped = false;
    const dotGeom = new THREE.CircleGeometry(0.12, 16).rotateX(-Math.PI / 2);
    for (let i = 1; i < path.length - 1; i++) {
      const c = path[i];
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.renderOrder = 1000;
      dot.position.set(wx(c), 0.13, wz(c));
      group.add(dot);
    }

    // 4. Directional Arrow Head pointing into destination circle
    const prevCell = path[path.length - 2] || path[0];
    const px = wx(prevCell), pz = wz(prevCell);
    const arrowAngle = Math.atan2(lx - px, lz - pz);

    const arrowMat = new THREE.MeshBasicMaterial({
      color: greenCol,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    arrowMat.toneMapped = false;

    const arrowGeom = new THREE.ConeGeometry(0.35, 0.65, 3).rotateX(Math.PI / 2).rotateY(arrowAngle);
    const arrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
    arrowMesh.renderOrder = 1000;
    arrowMesh.position.set(lx, 0.14, lz);
    group.add(arrowMesh);

    // 5. Target Cell Tile Highlight Plane
    const tileHighlightMat = new THREE.MeshBasicMaterial({
      color: greenCol,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    tileHighlightMat.toneMapped = false;
    const tileMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), tileHighlightMat);
    tileMesh.renderOrder = 998;
    tileMesh.position.set(lx, 0.11, lz);
    group.add(tileMesh);

    parentGroup.add(group);
    this._pathVisualGroup = group;
  },

  commandMove(x, z) {
    if (this.state !== 'crawl' || !this.D || this.paused) return;

    /* Manual spell targeting confirmation */
    if (this.targetingState && this.targetingState.active) {
      const clickedMonster = this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - x, m.z - z) < 1.4);
      this.confirmSpellTargeting(x, z, clickedMonster);
      return;
    }

    const cell = this.nearFloorCell(this.cellOf(x, z), 3);
    if (cell < 0) return;

    /* Manual combat targeting & movement */
    if (this.initiative && this.initiative.active && this.controlMode === 'manual') {
      const cur = this._currentActor();
      if (cur && cur._side === 'hero') {
        /* Check if click was on or near a live monster */
        const clickedMonster = this.monsters.find(m => m.active && m.data.hp > 0 && Math.hypot(m.x - x, m.z - z) < 1.4);
        if (clickedMonster) {
          this.clearPendingMove();
          if (!cur.actUsed) {
            this.manualPerformAttack(cur, clickedMonster);
            return;
          }
        }

        /* 2-Click Movement Confirmation System */
        if ((cur.moveLeft || 0) <= 0) {
          log(`${cur.data.name} has no movement budget remaining this turn.`, 'sys');
          return;
        }

        /* 2nd click on the pending target cell: CONFIRM MOVE */
        if (this.pendingMoveState && this.pendingMoveState.active && this.pendingMoveState.hero === cur && this.pendingMoveState.goalCell === cell) {
          const { path, costFt } = this.pendingMoveState;
          cur.path = path;
          cur.pathI = 0;
          cur.moving = true;
          log(`🏃 ${cur.data.name} moves ${costFt} ft!`, 'sys');
          this.clearPendingMove();
          const { W } = this.D;
          const gx = this.wx(cell % W), gz = this.wz(Math.floor(cell / W));
          spawnSlash(this.engine.scene, { x: gx, z: gz }, 0x36b0ff, 1.0);
          return;
        }

        /* 1st click (or clicking a new cell): preview path and distance cost */
        const rawPath = this.findPath(this.cellOf(cur.x, cur.z), cell);
        if (!rawPath || rawPath.length < 2) return;

        const maxSteps = Math.min(cur.moveLeft || this.cellsForSpeed(cur), rawPath.length - 1);
        const actualPath = rawPath.slice(0, maxSteps + 1);
        const costFt = maxSteps * 5;
        const actualGoalCell = actualPath[actualPath.length - 1];

        this.setPendingMove(cur, actualGoalCell, actualPath, costFt);
        const { W } = this.D;
        const gx = this.wx(actualGoalCell % W), gz = this.wz(Math.floor(actualGoalCell / W));
        spawnSlash(this.engine.scene, { x: gx, z: gz }, 0x4ade4a, 1.0);
        log(`🦶 Target ${costFt} ft move. Click target square again to confirm movement (Esc to cancel).`, 'sys');
        return;
      }
    }

    this.userGoal = cell;
    const { W } = this.D;
    const gx = this.wx(cell % W), gz = this.wz(Math.floor(cell / W));
    spawnSlash(this.engine.scene, { x: gx, z: gz }, 0x6ac8ff, 1.3);
    log('📍 You point the way — the party heads there.', 'sys');
  },

  roomDone(rid) {
    if (!this.visitedRooms[rid]) return false;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) return false;
    for (const ch of this.chests) if (ch.roomId === rid && !ch.looted) return false;
    for (const s of this.shrines) if (s.roomId === rid && !s.used) return false;
    if (this._searchedRooms && !this._searchedRooms[rid]) return false;
    return true;
  },

  /** Lighter check than roomDone: visited AND no living monsters, but
   *  ignores chests/shrines.  Used by fog recalculation to decide which
   *  rooms reveal their neighbours (monsters dead is enough). */
  _roomCleared(rid) {
    if (!this.visitedRooms[rid]) return false;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) return false;
    return true;
  },

  pickNextRoom(leader) {
    const { rooms, W, H, grid, roomId } = this.D;
    const from = this.nearFloorCell(this.cellOf(leader.x, leader.z), 3);
    const dist = new Int32Array(W * H).fill(-1);
    const q = new Int32Array(W * H); let qh = 0, qt = 0;
    if (from >= 0 && grid[from] === FLOOR) { q[qt++] = from; dist[from] = 0; }
    const total = W * H;
    while (qh < qt) {
      const c = q[qh++], x = c % W, b = dist[c] + 1;
      let n;
      if (x > 0 && grid[n = c - 1] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (x < W - 1 && grid[n = c + 1] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (c >= W && grid[n = c - W] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (c < total - W && grid[n = c + W] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
    }

    /* Minimum distance from leader to any cell belonging to room i */
    const roomMinDist = new Int32Array(rooms.length).fill(1e9);
    for (let c = 0; c < total; c++) {
      const r = roomId[c];
      if (r >= 0 && dist[c] >= 0) {
        if (dist[c] < roomMinDist[r]) roomMinDist[r] = dist[c];
      }
    }

    /* 1. Prioritize unvisited non-boss rooms nearest to the leader */
    let best = -1, bd = 1e9;
    for (let i = 0; i < rooms.length; i++) {
      if (i === this.D.boss) continue;
      if (this.visitedRooms && this.visitedRooms[i]) continue;
      if (this.roomDone(i)) continue;
      if (this._unreachableRooms && this._unreachableRooms[i]) continue;
      const d = roomMinDist[i];
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) return best;

    /* 2. If all reachable non-boss rooms have been visited, target visited but incomplete non-boss rooms */
    bd = 1e9;
    for (let i = 0; i < rooms.length; i++) {
      if (i === this.D.boss) continue;
      if (this.roomDone(i)) continue;
      if (this._unreachableRooms && this._unreachableRooms[i]) continue;
      const d = roomMinDist[i];
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) return best;

    /* 3. Fall back to boss room if it's the only one left incomplete */
    if (this.D.boss >= 0 && !this.roomDone(this.D.boss) && (!this._unreachableRooms || !this._unreachableRooms[this.D.boss])) {
      return this.D.boss;
    }

    /* 4. If all rooms were filtered out as unreachable, clear the unreachable map and retry */
    if (this._unreachableRooms && Object.keys(this._unreachableRooms).length > 0) {
      this._unreachableRooms = null;
      return this.pickNextRoom(leader);
    }

    return -1;
  },

  checkInteractables(alive) {
    for (const ch of this.chests) {
      if (ch.looted) continue;
      const cx = this.wx(ch.x), cz = this.wz(ch.y);
      if (alive.some(h => Math.hypot(h.x - cx, h.z - cz) < 1.6)) {
        /* The wheel always spins — "Auto-loot chests" (Options menu) only
           shortens the wait on the loot panel afterwards, which chest_wheel.js
           reads for itself. */
        lootChest(ch, true);
      }
    }
    for (const s of this.shrines) {
      if (s.used) continue;
      const sx = this.wx(s.x), sz = this.wz(s.y);
      if (alive.some(h => Math.hypot(h.x - sx, h.z - sz) < 1.6)) {
        s.used = true;
        log('🔮 The shrine restores the party to full strength!', 'heal');
        if (typeof this.beginCampAnimation === 'function') {
          this.beginCampAnimation(sx, sz, alive);
        } else {
          partyShortRest(this, { fullHeal: true, reason: 'shrine' });
        }
      }
    }
  },

  updateSearch(dt, alive, leader) {
    if (this.state !== 'crawl' || this.combat || !this.D || this.paused) {
      if (this._searchIndicator) {
        disposeSearchIndicator(this._searchIndicator);
        this._searchIndicator = null;
      }
      this._searchRoom = -1;
      return;
    }

    if (!alive) alive = this.heroes.filter(h => h.data.hp > 0);
    if (!leader) leader = this.partyLeader(alive);
    if (!leader) return;
    const leaderCell = this.cellOf(leader.x, leader.z);
    if (leaderCell < 0) return;
    const rid = this.D.roomId[leaderCell];

    const monstersDead = !this.monsters.some(m => m.roomId === rid && m.data.hp > 0);

    if (rid >= 0 && monstersDead && this._searchedRooms && !this._searchedRooms[rid]) {
      const rx = this.wx(this.D.rooms[rid].cx), rz = this.wz(this.D.rooms[rid].cy);
      const dLeader = Math.hypot(leader.x - rx, leader.z - rz);
      const rm = this.D.rooms[rid];
      const inRoom = rm && leader.x >= this.wx(rm.x) - 0.5 && leader.x <= this.wx(rm.x + rm.w) + 0.5 && leader.z >= this.wz(rm.y) - 0.5 && leader.z <= this.wz(rm.y + rm.h) + 0.5;

      if (dLeader < 3.2 || inRoom) {
        if (this._searchRoom !== rid) {
          this._searchRoom = rid;
          this._searchT = 0;
          if (this._searchIndicator) disposeSearchIndicator(this._searchIndicator);
          this._searchIndicator = createSearchIndicator(this.gameGroup, rx, rz);
        }

        /* Prevent handleStuck from accumulating fake stuck time while room searching */
        this.stuckT = 0;
        this.holdT = 0;
        leader.stuckT = 0;
        leader.stuckStage = 0;

        const SEARCH_DURATION = 2.0;
        this._searchT += dt;
        const frac = Math.min(1.0, this._searchT / SEARCH_DURATION);
        if (this._searchIndicator) {
          updateSearchIndicator(this._searchIndicator, frac);
        }

        if (this._searchT >= SEARCH_DURATION) {
          this._searchedRooms[rid] = 1;
          this._searchRoom = -1;
          this._searchT = 0;
          if (this._searchIndicator) {
            disposeSearchIndicator(this._searchIndicator);
            this._searchIndicator = null;
          }

          /* Force immediate pathing to the next room upon search completion */
          this.stuckT = 0;
          this.holdT = 0;
          leader.stuckT = 0;
          leader.stuckStage = 0;
          leader.path = null;
          leader.pathGoal = -1;
          this.targetRoom = -1;
          this._unreachableRooms = null;

          let foundGold = roll(2, 10) + 5 * this.dungeonLevel;
          this.gold += foundGold;
          log(`🔍 Room searched! Found ${foundGold} hidden gold.`, 'treasure');
          let hasPotion = false;
          if (Math.random() < 0.25) {
            hasPotion = true;
            this.potions.heal++;
            log('  ↳ Discovered a hidden Healing Potion!', 'treasure');
          }
          if (typeof this.notifyLootFeedback === 'function') {
            this.notifyLootFeedback({ gold: foundGold, potion: hasPotion ? 'heal' : null });
          }
          updateResources(this);
          refreshMenus(this);
        }
      }
    } else {
      if (this._searchIndicator) {
        disposeSearchIndicator(this._searchIndicator);
        this._searchIndicator = null;
      }
      this._searchRoom = -1;
      this._searchT = 0;
    }
  },

  /** Room-clear spell-slot refresh: the first time a room becomes fully
   *  cleared (monsters dead, chests looted, shrines used), each living
   *  caster in the party recovers one spell slot. Runs every frame while
   *  not in combat but only acts on newly-cleared rooms via the
   *  _slotRefreshedRooms set (re-initialized per floor in onDungeon). */
  refreshSlotsOnRoomClear() {
    /* Room-clear spell slot regeneration has been removed. */
  }
};
