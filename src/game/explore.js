/**
 * Exploration AI: room goals, party cohesion, chests/shrines, click-to-move.
 * Mixed onto Game — uses pathfinding (findPath, stepAlong, nearFloorCell).
 */
import * as THREE from 'three';
import { lightStateOf } from './light_sources.js';
import { perceptionAdv } from './light_rules.js';
import { rollItem, addToInventory } from './items.js';
import { subclassOf, CLASSES, roll } from './srd.js';
import { drawBar, createSearchIndicator, updateSearchIndicator, disposeSearchIndicator } from './entities.js';
import { rollChestLoot } from './items.js';
import { lootChest } from './chest_loot.js';
import { recoverSlots, totalSlots } from './features.js';
import { partyShortRest } from './rest.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';
import { FLOOR, HERO_SPEED,
  COHESION_HOLD_DIST, COHESION_RESUME_DIST, COHESION_SLOW_DIST, ROOM_TARGET_SWITCH_MARGIN,
  FORMATION_SPACING, FORMATION_WIDTH, TIGHT_R,
  STUCK_SIDESTEP_T, STUCK_REPATH_T, STUCK_TELEPORT_T, STUCK_SIDESTEP_DIST
} from './constants.js';
import { firstRunTip } from './help_ui.js';
import { pinUnitCard, unpinUnitCard } from './unit_card.js';

/** The room the leader is standing in, or -1 (corridor, doorway, off-grid). */
function _leaderRoom(game, leader) {
  const c = game.cellOf(leader.x, leader.z);
  return (c >= 0 && game.D.roomId) ? game.D.roomId[c] : -1;
}

/** A standable square beside an unused campfire in the leader's room, or -1
 *  when there is no fire to go to (none here, used, or the room still holds
 *  living monsters — fights come first). */
function _campDetourCell(game, leader) {
  const rid = _leaderRoom(game, leader);
  if (rid < 0) return -1;
  const s = game.shrines.find(sh => sh.roomId === rid && !sh.used);
  if (!s) return -1;
  if (game.monsters.some(m => m.roomId === rid && m.data.hp > 0)) return -1;
  return game.nearFloorCell(s.y * game.D.W + s.x, 2);
}

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

      Stage 1 now GLIDES instead of teleporting: the old instant ±0.45
      sidestep read as "teleport to another square". A 0.15 s tween makes the
      recovery visible-but-smooth. With the stepAlong path[0]-skip fix, false
      stuck classifications are rarer, so this fires mostly for genuine jams. */
  handleStuck(e, leader, dt) {
    /* Standing still in front of a closed gate is not being stuck — the door
       has its own 0.6 s unlock timer (updateDoors) and opens on its own. The
       sidestep/repath/teleport ladder would only shove the entity back out of
       unlock range and restart the wait, so hold position and let it open.
       Failsafe: if waiting for > 1.0 s, force open doors along the path so
       the entity never stays permanently stuck. */
    if (e._blockedByDoor) {
      const inCombat = typeof this.isCombatActive === 'function' ? this.isCombatActive() : !!(this.combat || (this.initiative && this.initiative.active));
      if (inCombat) {
        e._blockedByDoor = false;
        e._doorWaitT = 0;
      } else {
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
      }
    } else {
      e._doorWaitT = 0;
    }

    e.stuckT = (e.stuckT || 0) + dt;
    e.stuckStage = e.stuckStage || 0;

    /* Helper: kick off a smooth glide toward (tx,tz) over 0.15 s. */
    const glideTo = (tx, tz) => {
      e._posTween = { fromX: e.x, fromZ: e.z, toX: tx, toZ: tz, t: 0, dur: 0.15 };
    };

    /* Stage 1 (~0.6 s): directional dodge. Pick the dodge based on cause. */
    if (e.stuckStage === 0 && e.stuckT > STUCK_SIDESTEP_T) {
      e.stuckStage = 1;
      /* Combat is a grid. The 0.45-tile sidestep lands a unit on the Voronoi
         edge of its own empty square; snapToTileCenter then pulls it back —
         that is the "jitter on the tile edge with nobody around" bug. Skip
         the nudge and just drop the path so the next think repaths. */
      const inCombat = typeof this.isCombatActive === 'function'
        ? this.isCombatActive()
        : !!(this.combat || (this.initiative && this.initiative.active));
      if (inCombat) {
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
        else e.path = null;
        e.stuckT = 0; e.stuckStage = 0;
        return false;
      }
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
          if (!this.blocked(bx, bz, TIGHT_R, e)) {
            glideTo(bx, bz);
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
        if (!this.blocked(sx, sz, TIGHT_R, e)) {
          glideTo(sx, sz); recoverable = true;
        } else {
          /* try opposite side */
          const sx2 = e.x - (perpX / d) * STUCK_SIDESTEP_DIST;
          const sz2 = e.z - (perpZ / d) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(sx2, sz2, TIGHT_R, e)) {
            glideTo(sx2, sz2); recoverable = true;
          }
        }
      }

      if (!recoverable) {
        /* Longitudinal fallback for narrow 1-wide passages where perpendicular sides are walls */
        const parX = (leader.x - e.x), parZ = (leader.z - e.z);
        const pd = Math.hypot(parX, parZ) || 1;
        const lx = e.x + (parX / pd) * STUCK_SIDESTEP_DIST;
        const lz = e.z + (parZ / pd) * STUCK_SIDESTEP_DIST;
        if (!this.blocked(lx, lz, TIGHT_R, e)) {
          glideTo(lx, lz); recoverable = true;
        } else {
          const lx2 = e.x - (parX / pd) * STUCK_SIDESTEP_DIST;
          const lz2 = e.z - (parZ / pd) * STUCK_SIDESTEP_DIST;
          if (!this.blocked(lx2, lz2, TIGHT_R, e)) {
            glideTo(lx2, lz2); recoverable = true;
          }
        }
      }

      if (recoverable) {
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
        else { e.path = null; }
        e.stuckT = 0; e.stuckStage = 0;
        return true;
      }
    }

    /* Stage 2 (~1.5 s): force full repath */
    if (e.stuckStage === 1 && e.stuckT > STUCK_REPATH_T) {
      e.stuckStage = 2;
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
      else e.path = null;
      return false;
    }

    /* Stage 3 (~2.5 s): last resort teleport. */
    if (e.stuckStage >= 2 && e.stuckT > STUCK_TELEPORT_T) {
      const isLeader = (e === leader);
      const distFromLeader = leader ? Math.hypot(e.x - leader.x, e.z - leader.z) : 0;
      const farEnough = isLeader ? true : (distFromLeader > 4.0);
      if (!farEnough) {
        /* Close to leader — just clear stuck state and keep trying; no teleport. */
        e.stuckT = 0; e.stuckStage = 0;
        return false;
      }
      e.stuckT = 0; e.stuckStage = 0;
      let targetCell = -1;
      if (isLeader) {
        if (e.pathGoal >= 0) {
          targetCell = this.nearFloorCell(e.pathGoal, 3);
        }
        if (targetCell < 0) {
          const roomTarget = (this.targetRoom != null && this.targetRoom >= 0 && typeof this.roomTargetCell === 'function')
            ? this.roomTargetCell(this.targetRoom, leader)
            : -1;
          targetCell = roomTarget >= 0 ? roomTarget : (this.roomAnchor ? this.roomAnchor[this.D.entrance] : -1);
        }
      } else {
        const leaderCell = (typeof this.cellOf === 'function' && leader) ? this.cellOf(leader.x, leader.z) : -1;
        targetCell = this.nearFloorCell(leaderCell >= 0 ? leaderCell : 0, 3);
      }
      if (targetCell < 0) targetCell = this.nearFloorCell(0, 50);
      if (targetCell < 0) return false;

      const tx = this.wx(targetCell % this.D.W);
      const tz = this.wz(Math.floor(targetCell / this.D.W));

      /* Glide over 0.25 s instead of a hard cut — still a fast catch-up but
         no longer an instant pop. */
      e._posTween = { fromX: e.x, fromZ: e.z, toX: tx, toZ: tz, t: 0, dur: 0.25 };
      if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
      else e.path = null;
      log(`✨ Relocated ${e.data.name} to path destination.`, 'sys');
      return true;
    }

    return false;
  },

  exploreAI(alive, leader, dt) {
    if (this.campAnim) return;
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
        const exitActive = this.floorExit && this.floorExit.active && !this.floorExit.entered;
        if (this.targetRoom < 0 || (this.roomDone(this.targetRoom) && !(exitActive && this.targetRoom === this.floorExit.roomId))) {
          this.targetRoom = this.pickNextRoom(leader);
        }
        if (this.targetRoom >= 0) goalCell = this.roomTargetCell(this.targetRoom, leader);
      }
    }
    /* Stepping into a campsite room detours to the fire, in either control
       mode and even on the way to a clicked destination (which resumes once
       camp is struck). The room picker only chose rooms as destinations, so a
       campsite the route merely passed through was walked straight past. */
    const campCell = _campDetourCell(this, leader);
    if (campCell >= 0) goalCell = campCell;

    let strayMax = 0;
    for (const h of alive) {
      if (h === leader) continue;
      strayMax = Math.max(strayMax, Math.hypot(h.x - leader.x, h.z - leader.z));
    }

    /* Cohesion management with hysteresis:
       - If strayMax exceeds 6.0 tiles, leader holds to let stragglers catch up.
       - Once holding, leader waits until strayMax drops below 3.5 tiles before resuming.
       - While walking, if party is slightly stretched (4.2 - 6.0 tiles), leader gently
         paces down (0.65x speed) instead of halting, preventing start-stop stutter. */
    if (strayMax > COHESION_HOLD_DIST && this.userGoal < 0) {
      this._cohesionHolding = true;
    } else if (strayMax < COHESION_RESUME_DIST || this.userGoal >= 0) {
      this._cohesionHolding = false;
    }

    const _leaderCell = this.cellOf(leader.x, leader.z);
    const leaderInChokeNow = this.D.chokepoint && _leaderCell >= 0 && this.D.chokepoint[_leaderCell] > 0;

    if (this._cohesionHolding) { this.holdT = (this.holdT || 0) + dt; }
    else { this.holdT = 0; }
    const effectiveHold = this._cohesionHolding && (this.holdT || 0) < 4.0 && !leaderInChokeNow;

    /* Dynamic leader speed: slow down gently when party is stretching instead of hard stop/start */
    let leaderSpeedScale = 1.0;
    if (!effectiveHold && strayMax > COHESION_SLOW_DIST && !leaderInChokeNow) {
      leaderSpeedScale = 0.65;
    }
    if (typeof this.isDifficultTerrain === 'function' && this.isDifficultTerrain(_leaderCell, leader)) {
      leaderSpeedScale *= 0.5;
    }

    /* --- leader movement --- */
    if (goalCell >= 0 && !effectiveHold) {
      if (!leader.path || leader.pathI >= leader.path.length || leader.pathGoal !== goalCell) {
        /* Wipe the stall detector only when the DESTINATION actually changed.
           Clearing it on every repath meant that re-deriving a route to the
           same place — which happens constantly — reset the evidence that the
           party was getting nowhere, so a leader lurching on the spot never
           accumulated the samples needed to notice. */
        const goalChanged = leader.pathGoal !== goalCell;
        this.setEntityPath(leader, this.findPath(this.cellOf(leader.x, leader.z), goalCell));
        leader.pathGoal = goalCell;
        if (goalChanged) {
          leader._posHistory = [];
          leader._posHistoryTimer = 0;
        }
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
      leader.moving = this.stepAlong(leader, HERO_SPEED * leaderSpeedScale * leader.data.speedMult, dt);
    } else {
      leader.moving = false;
    }

    /* Stagnant displacement check: detect true micro-oscillations against walls,
       props, or the party's own bodies.

       This used to sample ONLY while `leader.moving` was true, and wipe the
       whole buffer the instant it went false. Jitter is precisely an
       alternation between "moved a hair" and "wedged", so the buffer was
       cleared long before it could reach the 5 samples (1 s) the test needs —
       and because `leader.moving` was true on most of those frames, the branch
       below reset stuckT every frame as well. A jittering leader was therefore
       invisible to stuck recovery and could stand in one spot indefinitely,
       which is what an idle party is doing when you come back to find it
       shuffling on the spot in a cleared room.

       Sample on the clock instead and judge by displacement. The legitimate
       reasons to stand still — nothing to walk to, regrouping, waiting on a
       gate, searching a room — are excluded explicitly rather than inferred
       from a single frame's movement flag. */
    let isOscillating = false;
    if (goalCell < 0 || effectiveHold || leader._blockedByDoor || (this._searchRoom >= 0)) {
      leader._posHistory = [];
      leader._posHistoryTimer = 0;
    } else {
      if (!leader._posHistory) leader._posHistory = [];
      leader._posHistoryTimer = (leader._posHistoryTimer || 0) + dt;
      if (leader._posHistoryTimer > 0.2) {
        leader._posHistoryTimer = 0;
        leader._posHistory.push({ x: leader.x, z: leader.z });
        if (leader._posHistory.length > 8) leader._posHistory.shift(); // ~1.6s rolling window
      }

      if (leader._posHistory.length >= 5) {
        let maxDistFromStart = 0;
        const startP = leader._posHistory[0];
        for (const p of leader._posHistory) {
          maxDistFromStart = Math.max(maxDistFromStart, Math.hypot(p.x - startP.x, p.z - startP.z));
        }
        if (maxDistFromStart < 0.35) {
          isOscillating = true;
          leader.moving = false;
        }
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
    const leaderCell = this.cellOf(leader.x, leader.z);
    const leaderInDoor = this.D.doorway && leaderCell >= 0 && this.D.doorway[leaderCell];
    const leaderBackCell = (leader.path && leader.pathI > 0)
      ? leader.path[leader.pathI - 1] : -1;
    const isChoke = (c) => c >= 0 && this.D.chokepoint && this.D.chokepoint[c] > 0;

    alive.forEach((h) => {
      if (h === leader) return;
      const idx = alive.indexOf(h) - 1; /* 0-based follower index */

      /* compute formation slot position */
      const formation = this.getFormationSlot(leader, idx);
      let formationCell = this.nearFloorCell(this.cellOf(formation.x, formation.z), 2);

      /* Corridor / Doorway single-file queueing */
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

      const targetX = (formationCell >= 0 && isChoke(formationCell)) ? this.wx(formationCell % W) : formation.x;
      const targetZ = (formationCell >= 0 && isChoke(formationCell)) ? this.wz(Math.floor(formationCell / W)) : formation.z;
      const dGoal = Math.hypot(h.x - targetX, h.z - targetZ);

      /* Settle when leader is stationary and follower is close to target */
      if (!leader.moving && dGoal < 0.65 && !this._cohesionHolding) {
        h.moving = false; h.stuckT = 0; h.stuckStage = 0;
        return;
      }

      h.repathT -= dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
        /* Followers path as themselves, so a flying familiar or a druid in
           eagle form takes the short way over a pool instead of trailing the
           party round it. Deliberately NOT done for the leader below: the
           leader's route is the route everyone else has to be able to walk,
           and a leader that flew across a lake would strand the party on the
           bank with no legal way to follow. */
        this.setEntityPath(h, this.findPath(this.cellOf(h.x, h.z), goal, { mover: h }));
        h.repathT = 0.35; h.pathGoal = goal;
      }

      let catchup = 1.1 + Math.min(1.2, Math.max(0, (dGoal - 1.5) * 0.25));
      const myCell = this.cellOf(h.x, h.z);
      const isDoor = (c) => c >= 0 && this.D.doorway && this.D.doorway[c];
      if (isDoor(myCell) || (leaderInDoor && isChoke(myCell))) {
        catchup *= 0.75;
      }
      const diffScale = (typeof this.isDifficultTerrain === 'function' && this.isDifficultTerrain(myCell, h)) ? 0.5 : 1.0;
      h.moving = this.stepAlong(h, HERO_SPEED * catchup * h.data.speedMult * diffScale, dt);

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
    let best = -1, bd = 1e9, bestMon = null;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) {
      const dd = Math.hypot(m.x - leader.x, m.z - leader.z);
      if (dd < bd) { bd = dd; bestMon = m; best = this.nearFloorCell(this.cellOf(m.x, m.z), 2); }
    }
    if (best >= 0) {
      /* Stick with the creature we are already walking toward unless another is
         clearly closer.

         This is recomputed every frame from the leader's own position, and the
         caller repaths whenever the answer differs. With a bare `<` tiebreak,
         two roughly equidistant monsters swap places as "nearest" on alternate
         frames — each step the leader takes toward one makes the other nearer —
         so the party repaths every frame and lurches on the spot between two
         targets, forever, without ever reaching either. Dormant monsters make
         it worse: they never activate, so no fight ever resolves the tie.
         Same reasoning as TARGET_SWITCH_MARGIN in the monster AI. */
      const prev = this._roomTargetMon;
      if (prev && prev.rid === rid && prev.mon && prev.mon.data.hp > 0 && prev.mon.roomId === rid) {
        const pd = Math.hypot(prev.mon.x - leader.x, prev.mon.z - leader.z);
        if (pd <= bd + ROOM_TARGET_SWITCH_MARGIN) {
          /* Re-derive the cell so a monster that moves is still followed. */
          return this.nearFloorCell(this.cellOf(prev.mon.x, prev.mon.z), 2);
        }
      }
      this._roomTargetMon = { rid, mon: bestMon };
      return best;
    }
    this._roomTargetMon = null;
    for (const ch of this.chests) if (ch.roomId === rid && !ch.looted)
      return this.nearFloorCell(ch.y * W + ch.x, 2);
    for (const s of this.shrines) if (s.roomId === rid && !s.used) {
      /* The campfire is a SOLID prop standing on a floor cell. Aiming at that
         cell (as this used to whenever the grid said FLOOR) asked for a path
         into the fire: none exists, so the room was written off as
         unreachable and the party walked on past it. Stand beside it —
         checkInteractables lights the camp from 2.5 away. */
      const sCell = s.y * W + s.x;
      const beside = typeof this.nearFloorCell === 'function' ? this.nearFloorCell(sCell, 2) : sCell;
      return beside >= 0 ? beside : sCell;
    }
    if (this.floorExit && this.floorExit.active && !this.floorExit.entered && this.floorExit.roomId === rid) {
      const exitCell = this.floorExit.y * W + this.floorExit.x;
      const target = typeof this.nearFloorCell === 'function' ? this.nearFloorCell(exitCell, 2) : exitCell;
      return target >= 0 ? target : exitCell;
    }
    const anchor = this.roomAnchor ? this.roomAnchor[rid] : -1;
    if (anchor >= 0) {
      const target = typeof this.nearFloorCell === 'function' ? this.nearFloorCell(anchor, 2) : anchor;
      return target >= 0 ? target : anchor;
    }
    return -1;
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

    // Color theme: route in vibrant green, destination in cyan so the goal
    // tile stands out from the intermediate steps.
    const routeCol = 0x22c55e;
    const destCol = 0x36b0ff;

    // 0. Per-tile footprint on EVERY cell of the path (except the hero's own
    //    tile) so the whole route lights up — you can see exactly which squares
    //    the hero walks through, including detours around walls / past foes.
    const tileBaseMat = new THREE.MeshBasicMaterial({
      color: routeCol,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    tileBaseMat.toneMapped = false;
    const tileQuad = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    for (let i = 1; i < path.length; i++) {
      const c = path[i];
      const isDest = (i === path.length - 1);
      const mat = isDest
        ? new THREE.MeshBasicMaterial({ color: destCol, transparent: true, opacity: 0.40, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
        : tileBaseMat;
      if (isDest) mat.toneMapped = false;
      const m = new THREE.Mesh(tileQuad, mat);
      m.renderOrder = 998;
      m.position.set(wx(c), 0.10, wz(c));
      group.add(m);
    }

    // 1. Thick path line ribbon connecting each tile center along the path
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: routeCol,
      transparent: true,
      opacity: 0.95,
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

      const ribbonGeom = new THREE.PlaneGeometry(0.30, len).rotateX(-Math.PI / 2);
      const ribbonMesh = new THREE.Mesh(ribbonGeom, ribbonMat);
      ribbonMesh.renderOrder = 999;
      ribbonMesh.position.set((x1 + x2) / 2, 0.12, (z1 + z2) / 2);
      ribbonMesh.rotation.y = angle;
      group.add(ribbonMesh);
    }

    // 2. Start cell ring marker
    const ringMat = new THREE.MeshBasicMaterial({
      color: routeCol,
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

    // 3. Destination cell ring marker (cyan)
    const destCell = path[path.length - 1];
    const lx = wx(destCell), lz = wz(destCell);
    const destRingMat = new THREE.MeshBasicMaterial({
      color: destCol,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    destRingMat.toneMapped = false;
    const destRing = new THREE.Mesh(ringGeom, destRingMat);
    destRing.renderOrder = 1000;
    destRing.position.set(lx, 0.13, lz);
    group.add(destRing);

    // Waypoint dots for intermediate tile centers
    const dotMat = new THREE.MeshBasicMaterial({
      color: routeCol,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    dotMat.toneMapped = false;
    const dotGeom = new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2);
    for (let i = 1; i < path.length - 1; i++) {
      const c = path[i];
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.renderOrder = 1000;
      dot.position.set(wx(c), 0.13, wz(c));
      group.add(dot);
    }

    // 4. Directional Arrow Head pointing into destination circle (cyan)
    const prevCell = path[path.length - 2] || path[0];
    const px = wx(prevCell), pz = wz(prevCell);
    const arrowAngle = Math.atan2(lx - px, lz - pz);

    const arrowMat = new THREE.MeshBasicMaterial({
      color: destCol,
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

    parentGroup.add(group);
    this._pathVisualGroup = group;
  },

  /** `picked`: the creature drawn under the click, to the pixel (render/sprite_pick.js);
   *  null when the click hit no creature. Left undefined by callers without a
   *  renderer, which fall back to the creature on the clicked tile. */
  commandMove(x, z, picked = undefined) {
    if (this.state !== 'crawl' || !this.D) return;

    /* Inspect (unit_card.js): outside manual combat and targeting, a click on a
       creature pins its card above the combat log instead of pointing the way.
       It works while paused, so a frozen fight can be read. Clicking empty
       ground puts the card away and moves as before. */
    const manualFight = this.controlMode === 'manual' && this.initiative && this.initiative.active;
    const targeting = (this.targetingState && this.targetingState.active) || (this.attackTargetingState && this.attackTargetingState.active);
    if (!manualFight && !targeting) {
      const unit = picked !== undefined ? picked : this.unitAtPoint(x, z);
      if (unit) { pinUnitCard(unit); return; }
      unpinUnitCard();
    }
    if (this.paused) return;

    /* Manual spell targeting confirmation */
    if (this.targetingState && this.targetingState.active) {
      const ts = this.targetingState;
      /* the creature drawn under the click when the renderer picked one (render/sprite_pick.js) */
      const clickedHero = picked !== undefined
        ? (picked && !this.monsters.includes(picked) && picked.data.hp > 0 ? picked : null)
        : (this.heroes || []).find(h => h.data && h.data.hp > 0 && Math.hypot(h.x - x, h.z - z) < 1.4);
      const clickedMonster = picked !== undefined
        ? (picked && this.monsters.includes(picked) ? picked : null)
        : (this.monsters || []).find(m => m.active && m.data && m.data.hp > 0 && Math.hypot(m.x - x, m.z - z) < 1.4);
      const target = (ts.isAlly && clickedHero) ? clickedHero : (clickedMonster || (ts.isAlly ? clickedHero : null));
      this.confirmSpellTargeting(x, z, target);
      return;
    }

    /* Manual attack targeting resolution (melee/thrown option selected). A
       click on a monster resolves the attack with the armed profile; a click
       on empty ground cancels the aim. Mirrors the spell-targeting flow. */
    if (this.attackTargetingState && this.attackTargetingState.active) {
      const at = this.attackTargetingState;
      const rawCell = this.cellOf(x, z);
      const clickedMonster = picked !== undefined
        ? (picked && this.monsters.includes(picked) ? picked : null)
        : this.monsters.find(m => m.active && m.data.hp > 0
          && (this.cellOf(m.x, m.z) === rawCell || Math.hypot(m.x - x, m.z - z) < 0.6));
      if (clickedMonster) {
        const hero = at.hero;
        const profile = at.profile;
        const profileOverride = at.profileOverride;
        this.cancelAttackTargeting();
        this.manualPerformAttack(hero, clickedMonster, profile);
        if (hero && hero.attacksLeft > 0 && !hero.actUsed) {
          this.startAttackTargeting(hero, profileOverride);
        }
      } else {
        this.cancelAttackTargeting();
        this.fxLog('🎯 Attack targeting cancelled.', 'sys');
      }
      return;
    }

    const cell = this.nearFloorCell(this.cellOf(x, z), 3);
    if (cell < 0) return;

    /* Manual combat targeting & movement */
    if (this.initiative && this.initiative.active && this.controlMode === 'manual') {
      const cur = this._currentActor();
      if (cur && cur._side === 'hero') {
        const { W } = this.D;
        const rawCell = this.cellOf(x, z);

        /* Highest priority: confirming a pending move. This MUST come before
           the monster-attack check, otherwise a monster standing near the
           pending destination intercepts the confirm click and you attack
           instead of moving. Same-cell re-click = commit to the move. */
        /* The re-click may land on the square the budget stops at OR on the
           square originally aimed at (beyond reach) — both mean "go". */
        const pms = this.pendingMoveState;
        if (pms && pms.active && pms.hero === cur && (pms.goalCell === cell || pms.targetCell === cell)) {
          const { path, costFt } = this.pendingMoveState;
          this.setEntityPath(cur, path);
          cur.moving = true;
          log(`🏃 ${cur.data.name} moves ${costFt} ft!`, 'sys');
          this.clearPendingMove();
          return;
        }

        /* Attack only when the click lands on a monster's own tile (grid-based,
           not a fat float radius) so adjacent floor tiles stay selectable for
           movement. A tight 0.6 fallback covers monsters drifting between
           cells. Heroes who have already acted can't attack, so their click
           always falls through to movement. */
        if (!cur.actUsed) {
          /* the monster drawn under the click (render/sprite_pick.js); its tile when no renderer picked */
          const clickedMonster = picked !== undefined
            ? (picked && this.monsters.includes(picked) ? picked : null)
            : ((typeof this.monsters.find === 'function') ? this.monsters.find(m => m.active && m.data.hp > 0 && (this.cellOf(m.x, m.z) === rawCell || Math.hypot(m.x - x, m.z - z) < 0.6)) : null);
          if (clickedMonster) {
            this.clearPendingMove();
            this.manualPerformAttack(cur, clickedMonster);
            return;
          }
        }

        /* 2-Click Movement Confirmation System */
        if ((cur.moveLeft || 0) <= 0) {
          log(`${cur.data.name} has no movement budget remaining this turn.`, 'sys');
          return;
        }

        /* 1st click (or clicking a new cell): preview path and distance cost.
           Same planner as the hover preview (planManualMove), so what is
           armed here is exactly the arrow the player was looking at. */
        const plan = this.planManualMove(cur, rawCell);
        if (!plan) return;
        const costFt = plan.costFt;

        this.setPendingMove(cur, plan.goalCell, plan.path, costFt);
        this.pendingMoveState.targetCell = plan.targetCell;
        log(`🦶 Target ${costFt} ft move. Click target square again to confirm movement (Esc to cancel).`, 'sys');
        return;
      }
    }

    this.userGoal = cell;
    log('📍 You point the way — the party heads there.', 'sys');
  },

  /** The creature standing on the tile at (x, z), or right at the point:
   *  a living monster first, then a hero. Same test as the click-to-attack one. */
  unitAtPoint(x, z) {
    if (!this.D) return null;
    const cell = this.cellOf(x, z);
    const on = (e) => (cell >= 0 && this.cellOf(e.x, e.z) === cell) || Math.hypot(e.x - x, e.z - z) < 0.6;
    return (this.monsters || []).find(m => m.active && m.data && m.data.hp > 0 && on(m))
      || (this.heroes || []).find(h => h.data && on(h))
      || null;
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

    /* 4. If an active floor exit exists, head to the exit room */
    if (this.floorExit && this.floorExit.active && !this.floorExit.entered && this.floorExit.roomId >= 0) {
      if (!this._unreachableRooms || !this._unreachableRooms[this.floorExit.roomId]) {
        return this.floorExit.roomId;
      }
    }

    /* 5. If all rooms were filtered out as unreachable, clear the unreachable map and retry */
    if (this._unreachableRooms && Object.keys(this._unreachableRooms).length > 0) {
      this._unreachableRooms = null;
      return this.pickNextRoom(leader);
    }

    return -1;
  },

  checkInteractables(alive) {
    if (this.campAnim) return;
    for (const ch of this.chests) {
      if (ch.looted) continue;
      const cx = this.wx(ch.x), cz = this.wz(ch.y);
      if (alive.some(h => Math.hypot(h.x - cx, h.z - cz) < 1.6)) {
        lootChest(ch, { x: cx, z: cz });   // lid swings open in-world, haul follows
      }
    }
    for (const s of this.shrines) {
      if (s.used) continue;
      const sx = this.wx(s.x), sz = this.wz(s.y);
      const near = alive.some(h => {
        const d = Math.hypot(h.x - sx, h.z - sz);
        if (d < 2.5) return true;
        const c = typeof this.cellOf === 'function' ? this.cellOf(h.x, h.z) : -1;
        return c >= 0 && this.D && this.D.roomId && this.D.roomId[c] === s.roomId && d < 3.2;
      });
      if (near) {
        s.used = true;
        firstRunTip('shrine');
        /* the Shrine of Light (docs/LIGHT_IDEAS.md 47): at most one per
           floor, flagged by the generator (chooseLightShrine) */
        if (s.lightShrine) {
          this._lightBlessedD = this.D;
          log('☀️ The shrine blazes — its light settles on the party. Your lights burn twice as far on this floor.', 'treasure');
        }
        if (typeof this.beginCampAnimation === 'function') {
          this.beginCampAnimation(sx, sz, alive);
        } else {
          partyShortRest(this, { fullHeal: true, reason: 'shrine' });
        }
      }
    }
  },

  /* Light-only secrets (docs/LIGHT_IDEAS.md 45): about a third of rooms hide
     a cache. In bright light the search finds it; in dim light it takes a
     Perception check (DC 13, rolled at disadvantage there); in the dark the
     party only senses something is there — bring a light and search again. */
  searchSecretCache(rid, leader, alive) {
    const D = this.D;
    if (!D) return;
    const has = ((((D.seed || 0) ^ (rid * 2654435761)) >>> 0) % 3) === 0;
    if (!has) return;
    this._secretCacheFound = this._secretCacheFound || {};
    if (this._secretCacheFound[rid]) return;
    const st = lightStateOf(leader);
    let found = st === 'bright';
    if (st === 'dim') {
      const best = Math.max(...alive.map(h => {
        const a = 1 + Math.floor(Math.random() * 20), b = 1 + Math.floor(Math.random() * 20);
        const d20 = perceptionAdv(h) < 0 ? Math.min(a, b) : a;
        return d20 + Math.floor(((h.data.effStats?.wis ?? h.data.stats?.wis ?? 10) - 10) / 2) + (h.data.skillRanks?.perception || 0);
      }));
      found = best >= 13;
      if (!found) log('⛅ Something seems hidden here, but the light is too poor to find it.', 'sys');
    } else if (st === 'dark') {
      log('🌙 You sense a hidden cache in the dark — come back with a light to search properly.', 'sys');
      this._cachePending = this._cachePending || {};
      this._cachePending[rid] = true;      // checked again when someone brings light (updateSearch)
      return;
    }
    if (!found) return;
    this._secretCacheFound[rid] = true;
    const item = rollItem(this.dungeonLevel || 1, Math.random, null, { source: 'chest' });
    if (item) { addToInventory(this.inventory, item, this); log(`🗝 A hidden cache! ${item.name}.`, 'treasure'); }
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
    /* a cache sensed in the dark: look again once the leader stands in light */
    if (this._cachePending && this._cachePending[rid] && lightStateOf(leader) !== 'dark') {
      delete this._cachePending[rid];
      this.searchSecretCache(rid, leader, alive);
    }

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
          leader._posHistory = [];
          leader._posHistoryTimer = 0;
          this.targetRoom = -1;
          this._unreachableRooms = null;

          let foundGold = roll(2, 10) + 5 * this.dungeonLevel;
          this.gold += foundGold;
          log(`🔍 Room searched! Found ${foundGold} hidden gold.`, 'treasure');
          this.searchSecretCache(rid, leader, alive);
          firstRunTip('roomSearched');
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

  /** Room-clear Warlock boon: the first time a room is emptied of monsters
   *  (its last monster dies), every living Warlock in the party recovers one
   *  spell slot. Fires once per room via the _slotRefreshedRooms set
   *  (re-initialized per floor in onDungeon). Rooms that never spawned a fight
   *  (no monsters) don't count — strolling through an empty room isn't clearing. */
  refreshSlotsOnRoomClear() {
    if (!this._slotRefreshedRooms) this._slotRefreshedRooms = new Set();
    if (!this.D || !this.D.rooms || typeof this._roomCleared !== 'function') return;
    let changed = false;
    for (let rid = 0; rid < this.D.rooms.length; rid++) {
      if (this._slotRefreshedRooms.has(rid)) continue;
      if (!this._roomCleared(rid)) continue;
      /* Only rooms that actually spawned monsters count. */
      if (!(this.monsters || []).some(m => m.roomId === rid)) continue;
      this._slotRefreshedRooms.add(rid);
      for (const h of this.heroes) {
        if (!h || !h.data || h.data.hp <= 0) continue;
        if (h.data.classKey !== 'warlock') continue;
        if (recoverSlots(h.data, 1) > 0) {
          changed = true;
          log(`🔮 ${h.data.name} recovers a spell slot from the cleared room.`, 'heal');
        }
      }
    }
    if (changed) {
      updatePartyFrames(this.heroes.map(x => x.data));
      refreshMenus(this);
    }
  }
};
