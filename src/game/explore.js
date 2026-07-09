/**
 * Exploration AI: room goals, party cohesion, chests/shrines, click-to-move.
 * Mixed onto Game — uses pathfinding (findPath, stepAlong, nearFloorCell).
 */
import { subclassOf, roll } from './srd.js';
import { drawBar, spawnSlash } from './entities.js';
import { rollChestLoot } from './items.js';
import { log, updatePartyFrames, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';
import { partyShortRest } from './rest.js';
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
      if (this.targetRoom < 0 || this.roomDone(this.targetRoom)) {
        this.targetRoom = this.pickNextRoom(leader);
      }
      if (this.targetRoom >= 0) goalCell = this.roomTargetCell(this.targetRoom, leader);
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

    /* --- leader stuck recovery (simple timer, original behaviour) --- */
    if (leader.moving || effectiveHold) { this.stuckT = 0; }
    else if (goalCell >= 0) {
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT > 3.0) {
        this.stuckT = 0; this.holdT = 0;
        leader.path = null; leader.pathGoal = -1;
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
      const idx = alive.indexOf(h) - 1; /* 0-based follower index */

      /* compute formation slot position */
      const formation = this.getFormationSlot(leader, idx);
      const formationCell = this.nearFloorCell(this.cellOf(formation.x, formation.z), 2);
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
      if (leaderInChoke || (this.D.chokepoint && myCell >= 0 && this.D.chokepoint[myCell])) {
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

  roomDone(rid) {
    if (!this.visitedRooms[rid]) return false;
    for (const m of this.monsters) if (m.roomId === rid && m.data.hp > 0) return false;
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
      const dd = dist[this.roomAnchor[i]];
      if (dd >= 0 && dd < bd) { bd = dd; best = i; }
    }
    return best;
  },

  checkInteractables(alive) {
    for (const ch of this.chests) {
      if (ch.looted) continue;
      const cx = this.wx(ch.x), cz = this.wz(ch.y);
      if (alive.some(h => Math.hypot(h.x - cx, h.z - cz) < 1.5)) {
        ch.looted = true;
        let g = 25 * this.dungeonLevel + roll(3, 20);
        const thiefBonus = Math.max(0, ...alive.map(h => {
          const sc = subclassOf(h.data);
          return (sc && sc.chestGold) || 0;
        }));
        if (thiefBonus) g = Math.round(g * (1 + thiefBonus));
        this.gold += g;
        log(`🪙 The party loots a chest: ${g} gold${thiefBonus ? ' (Fast Hands)' : ''}.`, 'treasure');
        if (Math.random() < 0.6) {
          if (this.dungeonLevel >= 3 && Math.random() < 0.4) { this.potions.greater++; log('  ↳ a Greater Healing Potion.', 'treasure'); }
          else { this.potions.heal++; log('  ↳ a Healing Potion.', 'treasure'); }
        }
        const loot = rollChestLoot(this.dungeonLevel);
        for (const it of loot) {
          this.inventory.push(it);
          log(`  ↳ ${it.name}!`, 'treasure');
        }
        updateResources(this);
        refreshMenus(this);
      }
    }
    for (const s of this.shrines) {
      if (s.used) continue;
      const sx = this.wx(s.x), sz = this.wz(s.y);
      if (alive.some(h => Math.hypot(h.x - sx, h.z - sz) < 1.6)) {
        s.used = true;
        /* Shrines grant a short rest + full heal (not a long rest) */
        partyShortRest(this, { fullHeal: true, reason: 'shrine' });
      }
    }
  }
};
