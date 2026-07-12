/**
 * Exploration AI: room goals, party cohesion, chests/shrines, click-to-move.
 * Mixed onto Game — uses pathfinding (findPath, stepAlong, nearFloorCell).
 */
import { drawBar, spawnSlash } from './entities.js';
import { log } from './ui.js';
import { checkGems } from './quest_events.js';
import { lootChest } from './chest_wheel.js';
import { fireChestChallenge, fireShrineChallenge } from './skills.js';
import { FLOOR, HERO_SPEED, COHESION_MAX,
  FORMATION_SPACING, FORMATION_WIDTH,
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
     Returns true if the entity recovered (moved) this frame. */
  handleStuck(e, leader, dt) {
    e.stuckT = (e.stuckT || 0) + dt;
    e.stuckStage = e.stuckStage || 0;

    /* Stage 1 (~0.6 s): lateral dodge perpendicular to leader */
    if (e.stuckStage === 0 && e.stuckT > STUCK_SIDESTEP_T) {
      e.stuckStage = 1;
      const perpX = -(e.z - leader.z), perpZ = (e.x - leader.x);
      const d = Math.hypot(perpX, perpZ) || 1;
      const sx = e.x + (perpX / d) * STUCK_SIDESTEP_DIST;
      const sz = e.z + (perpZ / d) * STUCK_SIDESTEP_DIST;
      if (!this.blocked(sx, sz, 0.3)) {
        e.x = sx; e.z = sz;
        e.path = null;
        e.stuckT = 0; e.stuckStage = 0;
        return true;
      }
      /* try opposite side */
      const sx2 = e.x - (perpX / d) * STUCK_SIDESTEP_DIST;
      const sz2 = e.z - (perpZ / d) * STUCK_SIDESTEP_DIST;
      if (!this.blocked(sx2, sz2, 0.3)) {
        e.x = sx2; e.z = sz2;
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
      e.x = leader.x + (Math.random() - 0.5) * 0.5;
      e.z = leader.z + (Math.random() - 0.5) * 0.5;
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
        log('The party arrives. Back to exploring.', 'sys');
      } else goalCell = this.userGoal;
    }
    if (goalCell < 0) {
      /* room-search: when the leader stands in a visited room whose
         monsters are dead but which hasn't been searched yet, the
         party fans out and sweeps it before moving on. */
      const lc = this.cellOf(leader.x, leader.z);
      const lRoom = lc >= 0 ? this.D.roomId[lc] : -1;
      if (lRoom >= 0 && this._roomCleared(lRoom) && !this._searchedRooms[lRoom]) {
        if (this._searchRoom !== lRoom) {
          this._searchRoom = lRoom;
          this._searchT = 3.5;
          this._searchGoalT = 0;
          this._searchPhase = 'approach';
          for (const hh of alive) { hh._searchGoal = -1; hh._searchCorner = -1; hh._searchPause = 0; }
        }
        /* phase 1: leader moves to room centre, followers in wedge */
        if (this._searchPhase === 'approach') {
          const anchor = this.roomAnchor[lRoom];
          const ax = this.wx(anchor % W), az = this.wz(Math.floor(anchor / W));
          goalCell = anchor;
          if (Math.hypot(leader.x - ax, leader.z - az) < 0.5) {
            this._searchPhase = 'wander';
            this._searchGoalT = 0;
          }
        }
        /* phase 2: all heroes fan out and search the room */
        if (this._searchPhase === 'wander') {
          this._searchT -= dt;
          if (this._searchT <= 0) {
            this._searchedRooms[this._searchRoom] = 1;
            this._searchRoom = -1;
            this._searchPhase = null;
            for (const hh of alive) { hh._searchGoal = -1; hh._searchCorner = -1; hh._searchPause = 0; }
            for (const ch of this.chests) {
              if (ch.looted || ch.roomId !== lRoom) continue;
              lootChest(ch, false);
            }
            /* auto-use any remaining shrines in the room */
            for (const s of this.shrines) {
              if (s.used || s.roomId !== lRoom) continue;
              s.used = true;
              this.beginCampAnimation(this.wx(s.x), this.wz(s.y), alive);
            }
            checkGems(this, alive);
            log('The party finishes searching the room.', 'sys');
          } else {
            const room = this.D.rooms[lRoom];
            const hw = room.w * 0.5 * 0.75;
            const hh = room.h * 0.5 * 0.75;
            const spots = [
              { x: this.wx(room.cx) - hw, z: this.wz(room.cy) - hh },
              { x: this.wx(room.cx) + hw, z: this.wz(room.cy) - hh },
              { x: this.wx(room.cx) - hw, z: this.wz(room.cy) + hh },
              { x: this.wx(room.cx) + hw, z: this.wz(room.cy) + hh },
            ];
            for (const hh of alive) {
              if (hh._searchPause > 0) {
                hh._searchPause -= dt;
                if (hh._searchPause <= 0) { hh._searchGoal = -1; hh._searchCorner = -1; }
                continue;
              }
              if (!hh._searchGoal || hh._searchGoal < 0) {
                const taken = new Set();
                for (const o of alive) {
                  if (o !== hh && o._searchCorner >= 0) taken.add(o._searchCorner);
                }
                let best = -1, bd = 1e9;
                for (let i = 0; i < spots.length; i++) {
                  if (taken.has(i)) continue;
                  const d = Math.hypot(spots[i].x - hh.x, spots[i].z - hh.z);
                  if (d < bd) { bd = d; best = i; }
                }
                if (best >= 0) {
                  const nc = this.nearFloorCell(this.cellOf(spots[best].x, spots[best].z), 2);
                  if (nc >= 0 && this.D.roomId[nc] === lRoom) {
                    hh._searchGoal = nc;
                    hh._searchCorner = best;
                  }
                }
              }
              if (hh._searchGoal >= 0) {
                const gx = this.wx(hh._searchGoal % W);
                const gz = this.wz(Math.floor(hh._searchGoal / W));
                if (Math.hypot(hh.x - gx, hh.z - gz) < 0.4) {
                  hh._searchGoal = -1;
                  hh._searchPause = 0.5 + Math.random() * 0.5;
                }
              }
            }
            if (leader._searchGoal >= 0) goalCell = leader._searchGoal;
          }
        }
      }
      /* pick next room to explore (only when not searching) */
      if (this._searchPhase !== 'wander' && goalCell < 0) {
        if (this.targetRoom < 0 || this.roomDone(this.targetRoom)) {
          this._searchRoom = -1;
          for (const hh of alive) { hh._searchGoal = -1; hh._searchCorner = -1; hh._searchPause = 0; }
          this.targetRoom = this.pickNextRoom(leader);
        }
        if (goalCell < 0 && this.targetRoom >= 0) goalCell = this.roomTargetCell(this.targetRoom, leader);
      }
    }

    let strayMax = 0;
    for (const h of alive) {
      if (h === leader) continue;
      strayMax = Math.max(strayMax, Math.hypot(h.x - leader.x, h.z - leader.z));
    }
    const hold = strayMax > COHESION_MAX && this.userGoal < 0;

    /* Limit how long the leader waits for stragglers.
       After 4 s the hold releases; the stuck follower will teleport. */
    if (hold) { this.holdT = (this.holdT || 0) + dt; }
    else { this.holdT = 0; }
    const effectiveHold = hold && (this.holdT || 0) < 4.0;

    /* --- leader movement --- */
    if (goalCell >= 0 && !effectiveHold) {
      if (!leader.path || leader.pathI >= leader.path.length || leader.pathGoal !== goalCell) {
        leader.path = this.findPath(this.cellOf(leader.x, leader.z), goalCell);
        leader.pathI = 0; leader.pathGoal = goalCell;
        if (!leader.path && this.userGoal >= 0) {
          this.userGoal = -1;
          log("The party can't find a way there.", 'sys');
        }
      }
      leader.moving = this.stepAlong(leader, HERO_SPEED * leader.data.speedMult, dt);
    } else leader.moving = false;

    /* --- leader stuck recovery ---
       stepAlong returns true whenever a path exists, even when wall-repel /
       corridor-centring / separation forces cancel the step to ZERO net
       movement (narrow-doorway equilibria) — so `leader.moving` can't be
       trusted here.  Measure real displacement over a short window instead. */
    if (effectiveHold || goalCell < 0) {
      this.stuckT = 0; this._ldrProgT = 0;
      this._ldrPX = leader.x; this._ldrPZ = leader.z;
    } else {
      this._ldrProgT = (this._ldrProgT || 0) + dt;
      if (this._ldrProgT >= 0.6) {
        const moved = (this._ldrPX === undefined) ? 1
          : Math.hypot(leader.x - this._ldrPX, leader.z - this._ldrPZ);
        /* < 0.15 tiles in 0.6 s (walk speed is ~2.5) = pinned in place */
        if (moved < 0.15) {
          this.stuckT = (this.stuckT || 0) + this._ldrProgT;
        } else {
          this.stuckT = 0;
          this._ldrStuckHits = 0;
        }
        this._ldrPX = leader.x; this._ldrPZ = leader.z;
        this._ldrProgT = 0;
      }
      if (this.stuckT > 2.4) {
        this.stuckT = 0; this.holdT = 0;
        leader.path = null; leader.pathGoal = -1;
        /* snap to the current cell centre — clears any force equilibrium and
           puts the leader inside the capture radius of a fresh path's start */
        const lc = this.cellOf(leader.x, leader.z);
        if (lc >= 0) {
          const ccx = this.wx(lc % W), ccz = this.wz(Math.floor(lc / W));
          if (!this.blocked(ccx, ccz, 0.2)) { leader.x = ccx; leader.z = ccz; }
        }
        this._ldrStuckHits = (this._ldrStuckHits || 0) + 1;
        if (this.userGoal >= 0 && this._ldrStuckHits >= 2) {
          this.userGoal = -1;
          log("The party can't push through — back to exploring.", 'sys');
        }
        this.targetRoom = this.pickNextRoom(leader);
      }
    }

    /* --- follower movement with formation offsets --- */
    /* If the leader is in a chokepoint (doorway / narrow corridor),
       slow followers down so the leader clears the bottleneck first. */
    const leaderCell = this.cellOf(leader.x, leader.z);
    const leaderInChoke = this.D.chokepoint && leaderCell >= 0 && this.D.chokepoint[leaderCell];

    alive.forEach((h) => {
      if (h === leader) return;
      if (this._searchPhase === 'wander') {
        if (h._searchPause > 0) {
          h.moving = false; h.stuckT = 0; h.stuckStage = 0;
          return;
        }
        if (h._searchGoal >= 0) {
          const goal = h._searchGoal;
          h.repathT -= dt;
          if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
            h.path = this.findPath(this.cellOf(h.x, h.z), goal);
            h.pathI = 0; h.repathT = 0.35; h.pathGoal = goal;
          }
          h.moving = this.stepAlong(h, HERO_SPEED * h.data.speedMult, dt);
          if (h.moving && Math.hypot(h._dx || 0, h._dz || 0) < HERO_SPEED * 0.15 * dt) {
            h.moving = false;
          }
          if (!h.moving) { h.stuckT = 0; h.stuckStage = 0; }
          else { h.stuckT = 0; h.stuckStage = 0; }
          return;
        }
        h.moving = false; h.stuckT = 0; h.stuckStage = 0;
        return;
      }
      const idx = alive.indexOf(h) - 1; /* 0-based follower index */
      const myCell = this.cellOf(h.x, h.z);
      const inChokeSelf = this.D.chokepoint && myCell >= 0 && this.D.chokepoint[myCell];

      /* compute formation slot position */
      const formation = this.getFormationSlot(leader, idx);
      const formationCell = this.nearFloorCell(this.cellOf(formation.x, formation.z), 2);
      const slotInChoke = this.D.chokepoint && formationCell >= 0 && this.D.chokepoint[formationCell];

      /* Near doorways / narrow corridors the wedge falls apart: slots land
         in walls or snap to the wrong side of them.  Switch to single-file —
         each follower targets a breadcrumb on the leader's actual trail,
         which is guaranteed walkable and threads the doorway cleanly. */
      const chokeMode = (leaderInChoke || inChokeSelf || slotInChoke) && this.leaderTrail.length > 0;
      let goal;
      if (chokeMode) {
        goal = this.leaderTrail[Math.min(this.leaderTrail.length - 1, (idx + 1) * 2)];
      } else {
        goal = formationCell >= 0 ? formationCell : this.cellOf(leader.x, leader.z);
      }

      const dFormation = Math.hypot(h.x - formation.x, h.z - formation.z);
      const spacing = 0.9; /* close-enough radius for formation slot */
      if (!chokeMode && dFormation < spacing && !hold) {
        h.moving = false; h.stuckT = 0; h.stuckStage = 0;
        return;
      }
      if (chokeMode) {
        /* arrived at our breadcrumb — stand fast, don't trip the stuck ladder */
        const gx = this.wx(goal % W), gz = this.wz(Math.floor(goal / W));
        if (Math.hypot(h.x - gx, h.z - gz) < 0.55) {
          h.moving = false; h.stuckT = 0; h.stuckStage = 0;
          return;
        }
      }

      h.repathT -= dt;
      if (h.repathT <= 0 || !h.path || h.pathI >= h.path.length || h.pathGoal !== goal) {
        h.path = this.findPath(this.cellOf(h.x, h.z), goal);
        h.pathI = 0; h.repathT = 0.35; h.pathGoal = goal;
      }

      let catchup = 1.1 + Math.min(1.2, Math.max(0, (dFormation - 1.5) * 0.25));
      /* If the leader is in a chokepoint, ease off so they clear it first —
         but a follower already INSIDE the choke keeps full speed: dawdling
         in the doorway is exactly what causes the jam. */
      if (leaderInChoke && !inChokeSelf) catchup *= 0.6;
      h.moving = this.stepAlong(h, HERO_SPEED * catchup * h.data.speedMult, dt);
      /* stepAlong reports "moving" even when forces cancel the step to
         nothing — check net displacement so the stuck ladder can engage */
      if (h.moving && Math.hypot(h._dx || 0, h._dz || 0) < HERO_SPEED * 0.15 * dt) {
        h.moving = false;
      }

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
  roomTargetCell(rid, _leader) {
    return this.roomAnchor[rid];
  },

  commandMove(x, z) {
    if (this.state !== 'crawl' || !this.D || this.paused) return;
    const cell = this.nearFloorCell(this.cellOf(x, z), 3);
    if (cell < 0) return;
    this.userGoal = cell;
    const { W } = this.D;
    const gx = this.wx(cell % W), gz = this.wz(Math.floor(cell / W));
    spawnSlash(this.engine.scene, { x: gx, z: gz }, 0x6ac8ff, 1.3);
    log('📍 You point the way — the party heads there.', 'sys');
  },

  _roomCleared(rid) {
    if (!this.visitedRooms[rid]) return false;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) return false;
    return true;
  },

  roomDone(rid) {
    if (!this._roomCleared(rid)) return false;
    if (!this._searchedRooms[rid]) return false;
    for (const ch of this.chests) if (ch.roomId === rid && !ch.looted) return false;
    for (const s of this.shrines) if (s.roomId === rid && !s.used) return false;
    return true;
  },

  pickNextRoom(leader) {
    const { rooms, W, grid } = this.D;
    const from = this.cellOf(leader.x, leader.z);
    const dist = new Int32Array(this.D.W * this.D.H).fill(-1);
    const q = new Int32Array(this.D.W * this.D.H); let qh = 0, qt = 0;
    if (from >= 0 && grid[from] === FLOOR) { q[qt++] = from; dist[from] = 0; }
    const total = this.D.W * this.D.H;
    while (qh < qt) {
      const c = q[qh++], x = c % W, b = dist[c] + 1;
      let n;
      if (x > 0 && grid[n = c - 1] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (x < W - 1 && grid[n = c + 1] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (c >= W && grid[n = c - W] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
      if (c < total - W && grid[n = c + W] === FLOOR && dist[n] < 0) { dist[n] = b; q[qt++] = n; }
    }
    let best = -1, bd = 1e9, bossOnly = true;
    for (let i = 0; i < rooms.length; i++) {
      if (this.roomDone(i)) continue;
      if (i !== this.D.boss) bossOnly = false;
    }
    for (let i = 0; i < rooms.length; i++) {
      if (this.roomDone(i)) continue;
      if (i === this.D.boss && !bossOnly) continue;
      /* puzzle floors: the boss chamber is sealed until the wards break */
      if (i === this.D.boss && this.puzzleState && !this.puzzleState.solved) continue;
      const dd = dist[this.roomAnchor[i]];
      if (dd >= 0 && dd < bd) { bd = dd; best = i; }
    }
    return best;
  },

  checkInteractables(alive) {
    for (const ch of this.chests) {
      if (ch.looted || ch._challengePending) continue;
      const cx = this.wx(ch.x), cz = this.wz(ch.y);
      if (alive.some(h => Math.hypot(h.x - cx, h.z - cz) < 1.5)) {
        if (!ch._challenged) {
          ch._challenged = true;            // roll once per chest
          if (Math.random() < 0.35) {
            ch._challengePending = true;
            const self = this;
            fireChestChallenge(this, ch, () => {
              ch._challengePending = false;
              lootChest.call(self, ch, true);
            });
            continue;
          }
        }
        if (!ch._challengePending) lootChest(ch, true);
      }
    }
    checkGems(this, alive);
    for (const s of this.shrines) {
      if (s.used || s._challengePending) continue;
      const sx = this.wx(s.x), sz = this.wz(s.y);
      if (alive.every(h => Math.hypot(h.x - sx, h.z - sz) < 1.6)) {
        if (!s._challenged) {
          s._challenged = true;            // roll once per shrine
          if (Math.random() < 0.4) {
            s._challengePending = true;
            const self = this;
            fireShrineChallenge(this, s, () => {
              s._challengePending = false;
              s.used = true;
              self.beginCampAnimation(sx, sz, alive);
            });
            continue;
          }
        }
        s.used = true;
        this.beginCampAnimation(sx, sz, alive);
      }
    }
  }
};
