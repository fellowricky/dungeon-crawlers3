/**
 * Turn-based combat rules engine — movement budgets, the D&D 5e action
 * economy (Move / Action / Bonus Action / Free Action / Reaction), grid
 * movement costs (PHB alternating diagonals), reachable-cell computation,
 * threatened squares, and the command schema that both the AI controller
 * and the human (manual) controller feed into shared validators.
 *
 * PHASING
 *   Phase 0: pure rules math + per-turn budget reset + command validators
 *     (additive — no behaviour change).
 *   Phase 1 (DONE): movement is locked to the current initiative actor and
 *     budgeted by moveLeft. moveStep() / spendMove() gate + spend the budget;
 *     off-turn actors are frozen (also in applySeparation). Applies to auto
 *     mode now and manual mode later — one shared ruleset.
 *   Phase 2: wire opportunity attacks (provokesOA) into movement.
 *   Phase 3+: route every action through validateCommand / applyCommand.
 *
 * Pure helpers are exported separately so they can be unit-tested without a
 * Game instance. The mixin (turnEngineMethods) is mixed onto Game.prototype
 * alongside the other domain mixins and uses pathfinding (cellOf/wx/wz),
 * initiative (isCurrentActor), and conditions (getEffectMods).
 */
import { FLOOR, CHOKEPOINT_COST, COMBAT_MOVE_BOOST, HERO_ATTACK_CD, MONSTER_ATTACK_CD } from './constants.js';
import { RACES } from './srd.js';
import { getEffectMods, applyEffect, hasEffect, ROUND_SECONDS } from './conditions.js';

/* ── Tunables ──────────────────────────────────────────────────────── */
export const FT_PER_CELL = 5;             // 1 grid cell = 5 ft (D&D 5e)
export const DEFAULT_SPEED_FT = 30;       // base speed for Medium races (30 ft → 6 cells)
export const DEFAULT_MONSTER_CELLS = 6;   // 30 ft; per-monster override via data.speedCells

/* ── Command schema ────────────────────────────────────────────────── */
/* Both controllers (AI + human) emit these. validateCommand checks them
 * against the acting entity's per-turn budgets; applyCommand books the
 * budget. Actual execution (moving the sprite, rolling the attack…) is
 * added in later phases — Phase 0 only validates + accounts. */
export const COMMAND = Object.freeze({
  MOVE: 'move',        // { type, path }   — traverse a cell path, spending moveLeft
  ATTACK: 'attack',    // { type, target } — one Attack action (Extra Attack resolved inside)
  CAST: 'cast',        // { type, spell, target } — cast a leveled spell as the Action
  BONUS: 'bonus',      // { type, key, ...} — a bonus-action ability/spell
  DASH: 'dash',        // Disengage/Dash/Dodge take the whole Action:
  DODGE: 'dodge',      //   DASH  → grant another moveLeft this turn
  DISENGAGE: 'disengage',// DODGE → attackers have disadvantage until next turn
  FREE: 'free',        // { type, ... }    — free/object/interact (no budget)
  END: 'end'           // end the turn
});

/* ── Pure helpers (unit-tested; no `this`, no Game) ────────────────── */

/** Convert a speed in feet to grid cells (floored). 30 ft → 6 cells. */
export function ftToCells(ft) {
  return Math.floor((ft || 0) / FT_PER_CELL);
}

/** Apply a speed multiplier to a cell budget, floored, minimum 1. */
export function applySpeedMult(cells, mult) {
  return Math.max(1, Math.floor(cells * (mult || 1)));
}

/** Default monster movement in cells. `data.speedCells` overrides; else derived from `speedFt`/`speed` or default 6. */
export function monsterCells(data) {
  if (!data) return DEFAULT_MONSTER_CELLS;
  if (data.speedCells != null) return data.speedCells;
  if (data.speedFt != null) return ftToCells(data.speedFt);
  if (data.speed != null) return ftToCells(Math.round((data.speed * 10) / 5) * 5);
  return DEFAULT_MONSTER_CELLS;
}

/**
 * PHB alternating diagonal cost. `diagCount` is how many diagonal steps the
 * entity has already taken THIS TURN. The NEXT diagonal costs 1 when that
 * count is even, 2 when odd — so diagonals go 1, 2, 1, 2, …  (PHB p.192).
 * Cardinal steps ignore this counter (they always cost 1).
 */
export function diagCost(diagCount) {
  return (diagCount % 2 === 0) ? 1 : 2;
}

/**
 * Cost of a single grid step and the resulting diagonal count.
 *   dx, dy ∈ {-1, 0, 1}  (dy = row delta, dx = column delta)
 *   baseCost: cost to enter the destination (1 by default; path/cell-level
 *             helpers add chokepoint/hazard weight).
 *   Returns { cost, diagCount }.
 */
export function stepCost(dx, dy, diagCount, baseCost = 1) {
  if (dx === 0 && dy === 0) return { cost: 0, diagCount };
  const diagonal = (dx !== 0 && dy !== 0);
  const cost = diagonal ? diagCost(diagCount) : baseCost;
  return { cost, diagCount: diagonal ? diagCount + 1 : diagCount };
}

/**
 * Total movement cost to walk a cell-index `path` (as produced by findPath),
 * using PHB alternating diagonals. `startDiag` is the entity's diagonal
 * count at the start of the walk. Returns { cost, diagCount }.
 */
export function pathMoveCost(path, W, startDiag = 0) {
  if (!path || path.length < 2) return { cost: 0, diagCount: startDiag };
  let cost = 0, diag = startDiag;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = Math.sign((b % W) - (a % W));
    const dy = Math.sign(Math.floor(b / W) - Math.floor(a / W));
    const s = stepCost(dx, dy, diag);
    cost += s.cost;
    diag = s.diagCount;
  }
  return { cost, diagCount: diag };
}

/**
 * Cells threatened by an entity of the given `reach` centred on `center`.
 * Threatened squares are every FLOOR cell within Chebyshev distance `reach`
 * (reach 1 = the 8 neighbours). 5e does not require line-of-sight to
 * threaten. Returns a Set<cellIndex>.
 */
export function threatenedCellsGrid(grid, W, H, center, reach) {
  const out = new Set();
  if (center < 0) return out;
  const cx = center % W, cy = Math.floor(center / W);
  const r = reach || 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (grid[n] === FLOOR) out.add(n);
    }
  }
  return out;
}

/**
 * Which hostiles provoke an opportunity attack from a mover leaving
 * `fromCell` for `toCell`. A hostile threatens the move if its threatened
 * set contains `fromCell` but NOT `toCell` (the mover is genuinely leaving
 * its reach). Disengage / teleportation callers skip this check.
 *   hostiles: [{ entity, threatened: Set<cellIndex> }, ...]
 *   Returns the list of hostile entities whose reach is being exited.
 *
 * (Wired into movement resolution in Phase 2; pure + tested now.)
 */
export function provokesOA(hostiles, fromCell, toCell) {
  const out = [];
  if (!hostiles) return out;
  for (const h of hostiles) {
    const t = h && h.threatened;
    if (!t) continue;
    if (t.has(fromCell) && !t.has(toCell)) out.push(h.entity);
  }
  return out;
}

/**
 * Bounded Dijkstra: every cell reachable from `start` within a movement
 * `budget`, using PHB alternating diagonals handled EXACTLY by tracking
 * diagonal-parity in the search state (a cell reached on an even vs odd
 * diagonal count is a distinct state with a distinct best cost — this is
 * why naive Dijkstra gets diagonal reachability wrong).
 *
 *   grid:       typed array of cell types (FLOOR/WALL/…)
 *   W, H:       grid dimensions
 *   start:      starting cell index
 *   budget:     max total cost (inclusive)
 *   opts.chokepoint: Uint8Array marking tight cells (adds CHOKEPOINT_COST),
 *                    mirroring the weighting in pathfinding.findPath
 *
 * Diagonals cannot corner-cut: both orthogonal neighbours must be FLOOR
 * (same rule as findPath). Returns Map<cellIndex, bestCost>.
 */
export function reachableCellsGrid(grid, W, H, start, budget, opts = {}) {
  const out = new Map();
  if (start < 0 || grid[start] !== FLOOR || budget <= 0) return out;
  const choke = opts.chokepoint || null;
  const solid = opts.solidProps || null;

  /* State = cell*2 + parity(=diagCount mod 2). dist over states. */
  const N = W * H;
  const dist = new Float64Array(N * 2).fill(Infinity);
  const hC = new Int32Array(N * 2);
  const hP = new Float64Array(N * 2);
  let hN = 0;
  const push = (state, prio) => {
    let i = hN++; hC[i] = state; hP[i] = prio;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hP[p] <= hP[i]) break;
      const tc = hC[p], tp = hP[p]; hC[p] = hC[i]; hP[p] = hP[i]; hC[i] = tc; hP[i] = tp;
      i = p;
    }
  };
  const pop = () => {
    const s = hC[0]; hN--;
    if (hN > 0) {
      hC[0] = hC[hN]; hP[0] = hP[hN];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let b = i;
        if (l < hN && hP[l] < hP[b]) b = l;
        if (r < hN && hP[r] < hP[b]) b = r;
        if (b === i) break;
        const tc = hC[b], tp = hP[b]; hC[b] = hC[i]; hP[b] = hP[i]; hC[i] = tc; hP[i] = tp;
        i = b;
      }
    }
    return s;
  };

  dist[start * 2] = 0;
  push(start * 2, 0);

  const isWalkable = (n) => grid[n] === FLOOR && (!solid || !solid[n]);

  while (hN > 0) {
    const s = pop();
    const cell = s >> 1, parity = s & 1;
    const dc = dist[s];
    if (dc > budget) continue;
    if (!out.has(cell) || out.get(cell) > dc) out.set(cell, dc);

    const x = cell % W;
    const diagCount = parity;
    const tryRelax = (nx, ny, dx, dy) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
      const n = ny * W + nx;
      if (!isWalkable(n)) return;
      const diagonal = (dx !== 0 && dy !== 0);
      /* no corner-cutting on diagonals */
      if (diagonal) {
        if (!isWalkable(cell + dx)) return;       /* (cx+dx, cy) */
        if (!isWalkable(cell + dy * W)) return;   /* (cx, cy+dy) */
      }
      let base = choke && choke[n] ? CHOKEPOINT_COST : 1;
      const step = stepCost(dx, dy, diagCount, base);
      const nd = dc + step.cost;
      if (nd > budget) return;
      const ns = n * 2 + (step.diagCount & 1);
      if (nd < dist[ns]) { dist[ns] = nd; push(ns, nd); }
    };

    /* 8-neighbour relaxation */
    if (x > 0) tryRelax(x - 1, Math.floor(cell / W), -1, 0);
    if (x < W - 1) tryRelax(x + 1, Math.floor(cell / W), 1, 0);
    if (cell >= W) tryRelax(x, Math.floor(cell / W) - 1, 0, -1);
    if (cell < N - W) tryRelax(x, Math.floor(cell / W) + 1, 0, 1);
    const cy = Math.floor(cell / W);
    if (x > 0 && cell >= W) tryRelax(x - 1, cy - 1, -1, -1);
    if (x < W - 1 && cell >= W) tryRelax(x + 1, cy - 1, 1, -1);
    if (x > 0 && cell < N - W) tryRelax(x - 1, cy + 1, -1, 1);
    if (x < W - 1 && cell < N - W) tryRelax(x + 1, cy + 1, 1, 1);
  }
  return out;
}

/**
 * Validate a command against an entity's per-turn budgets WITHOUT mutating.
 *   budgets: { moveLeft, actUsed, bonusUsed, reactionUsed }
 *   Returns { ok:true } or { ok:false, reason }.
 */
export function validateCommand(cmd, budgets) {
  if (!cmd || !cmd.type) return { ok: false, reason: 'command has no type' };
  const b = budgets || {};
  switch (cmd.type) {
    case COMMAND.MOVE:
      if ((b.moveLeft || 0) <= 0) return { ok: false, reason: 'no movement left' };
      return { ok: true };
    case COMMAND.ATTACK:
    case COMMAND.CAST:
    case COMMAND.DASH:
    case COMMAND.DODGE:
    case COMMAND.DISENGAGE:
      if (b.actUsed) return { ok: false, reason: 'action already used this turn' };
      return { ok: true };
    case COMMAND.BONUS:
      if (b.bonusUsed) return { ok: false, reason: 'bonus action already used this turn' };
      return { ok: true };
    case COMMAND.FREE:
    case COMMAND.END:
      return { ok: true };
    default:
      return { ok: false, reason: 'unknown command type' };
  }
}

/* ── Mixin: instance methods on Game.prototype ────────────────────── */
export const turnEngineMethods = {
  /**
   * Movement budget in cells for one entity this turn.
   *   Heroes: floor(race.speedFt / 5) × speedMult × effect-speedMul
   *   Monsters: data.speedCells (default 6) × effect-speedMul
   * `speedMult` (gear/skills) and the effect multiplier (haste/slow) both
   * extend or shrink the allowance, matching the live continuous-speed
   * model so movement feels consistent before/after Phase 1.
   */
  cellsForSpeed(e) {
    if (!e || !e.data) return DEFAULT_MONSTER_CELLS;
    const d = e.data;
    const effMul = (getEffectMods(e).speedMul != null) ? getEffectMods(e).speedMul : 1;
    if (d.raceKey != null) {
      const race = RACES[d.raceKey];
      const ft = (race && race.speedFt) || DEFAULT_SPEED_FT;
      return applySpeedMult(ftToCells(ft), (d.speedMult != null ? d.speedMult : 1) * effMul);
    }
    return applySpeedMult(monsterCells(d), effMul);
  },

  /**
   * Reach in cells (threatened-square radius). Defaults to 1; weapons with
   * the `reach` property or melee range ≥ 2.2 get 2. Ranged attackers still
   * threaten adjacent squares (a bowman threatens the 8 neighbours in 5e).
   */
  entityReach(e) {
    const p = e && e.data && (e.data.weaponProfile || e.data.lastProfile);
    if (p && (p.reach || (p.range && p.range >= 2.2))) return 2;
    return 1;
  },

  /** Threatened cells for `e` (Set<cellIndex>) based on its current cell + reach. */
  threatenedCells(e) {
    if (!e || !this.D) return new Set();
    const { W, H, grid } = this.D;
    return threatenedCellsGrid(grid, W, H, this.cellOf(e.x, e.z), this.entityReach(e));
  },

  /**
   * Movement gate for the upcoming turn-locked combat (Phase 1). While
   * initiative is active, only the current actor may move; off-turn
   * entities hold position. Outside initiative (exploration) everyone moves
   * freely — the existing real-time loop is untouched there.
   */
  canMove(e) {
    if (!this.initiative || !this.initiative.active) return true;
    return this.isCurrentActor(e);
  },

  /**
   * Cells reachable by `e` this turn (Map<cell, cost>), bounded by its
   * remaining moveLeft. Used by the Phase 4 highlight overlay and by the AI
   * to pick tactical destinations.
   */
  reachableCells(e) {
    if (!e || !this.D) return new Map();
    const { W, H, grid, chokepoint } = this.D;
    const start = this.cellOf(e.x, e.z);
    const budget = e.moveLeft != null ? e.moveLeft : this.cellsForSpeed(e);
    return reachableCellsGrid(grid, W, H, start, budget, { chokepoint });
  },

  /**
   * Reset an entity's per-turn budgets. Called from initiative._beginTurn
   * at the start of each actor's spotlight. Additive only — existing
   * _bonusActed / _bonusLeveled flags are still reset by _beginTurn itself.
   *
   *   moveLeft:        cells remaining this turn (Dash adds to this)
   *   actUsed:         the Action is spent (Attack/Cast/Dash/Dodge/Disengage)
   *   bonusUsed:       the Bonus Action is spent
   *   reactionUsed:    the Reaction is spent (opportunity attacks, etc.)
   *   diagCount:       PHB alternating-diagonal counter, per turn
   *   disengageActive: suppress opportunity attacks until end of turn
   */
  resetTurnBudgets(e) {
    if (!e) return;
    e.moveLeft = this.cellsForSpeed(e);
    e.actUsed = false;
    e.bonusUsed = false;
    e.reactionUsed = false;
    e.diagCount = 0;
    e.disengageActive = false;
  },

  /**
   * Budgeted wrapper around pathfinding.stepAlong — the single movement
   * primitive for every in-combat path-follower (heroCombat chase,
   * combatCatchup, monsterChase, monsterKite, charmed-hero stalk).
   *
   *   • While a tactical spotlight is active, only the CURRENT actor moves;
   *     off-turn entities hold position (returns false, moving=false).
   *   • The current actor spends moveLeft per grid cell it enters, using PHB
   *     alternating diagonal costs (cardinal 1; diagonals 1,2,1,2…). When the
   *     budget hits 0 the remaining path is dropped so the sprite stops —
   *     the actor may STILL act (independent budgets), the turn is not ended.
   *   • Outside initiative (exploration / between-fight transition) movement
   *     is free and unbudgeted, exactly as before.
   *   • During a spotlight the walk speed is scaled by COMBAT_MOVE_BOOST so a
   *     full move resolves quickly enough to keep turn pace snappy.
   *
   * Returns stepAlong's `moved` flag so callers keep driving walk anims /
   * stuck-recovery unchanged (callers guard stuck-recovery with canMove()).
   */
  snapToTileCenter(e, dt = 0.016, smooth = true) {
    if (!e || !this.D) return;
    let c = this.cellOf ? this.cellOf(e.x, e.z) : -1;
    if (c < 0) return;
    /* If somebody else is already on this square, snapping both to its centre
       makes the overlap pixel-perfect. Step aside to a free neighbour instead —
       this is the last line of defence, and it is the one that visibly
       un-stacks two sprites that have drifted onto one tile. */
    if (typeof this.isCellBodyOccupied === 'function' && this.isCellBodyOccupied(c, e)
        && typeof this.getUnoccupiedCellNear === 'function') {
      const free = this.getUnoccupiedCellNear(c, e, 2);
      if (free >= 0 && free !== c) c = free;
    }
    const W = this.D.W;
    const cx = c % W, cz = Math.floor(c / W);
    const targetX = (typeof this.wx === 'function') ? this.wx(cx) : (cx + 0.5);
    const targetZ = (typeof this.wz === 'function') ? this.wz(cz) : (cz + 0.5);

    if (smooth && dt > 0) {
      const d = Math.hypot(targetX - e.x, targetZ - e.z);
      if (d < 0.005) {
        e.x = targetX; e.z = targetZ;
      } else {
        const factor = Math.min(1.0, dt * 16.0);
        e.x += (targetX - e.x) * factor;
        e.z += (targetZ - e.z) * factor;
      }
    } else {
      e.x = targetX;
      e.z = targetZ;
    }
  },

  moveStep(e, speed, dt) {
    if (!e) return false;
    const tactical = !!(this.initiative && this.initiative.active);
    if (tactical) {
      if (!this.isCurrentActor(e)) {
        e.moving = false;
        if (this.controlMode === 'manual') this.snapToTileCenter(e, dt, true);
        return false;
      }
      if ((e.moveLeft || 0) <= 0) {
        e.moving = false;
        if (this.controlMode === 'manual') this.snapToTileCenter(e, dt, true);
        return false;
      }
    }

    const W = this.D.W;
    const i0 = e.pathI | 0;
    const isDash = !!(e.actUsed && (e.moveLeft || 0) > 0);
    const effSpeed = tactical ? speed * COMBAT_MOVE_BOOST * (isDash ? 1.4 : 1.0) : speed;
    const moved = this.stepAlong(e, effSpeed, dt);

    if (moved && tactical && e._side === 'hero' && this.processTurnAuras) {
      this.processTurnAuras(e);
    }

    /* Deduct budget for each path waypoint captured this frame. Capturing
       path[k] completes the step path[k-1] → path[k]. path[0] is the start
       cell (no cost), so the loop begins at max(i0, 1). At real frame rates
       an entity crosses at most one cell per frame, so overshoot is nil. */
    if (tactical && e.path) {
      const ip = e.pathI | 0;
      for (let k = Math.max(i0, 1); k < ip; k++) {
        const from = e.path[k - 1], to = e.path[k];
        const dx = Math.sign((to % W) - (from % W));
        const dy = Math.sign(Math.floor(to / W) - Math.floor(from / W));
        /* Leaving a hostile's reach draws an opportunity attack (5e) unless
           this actor took the Disengage action. Resolved per cell crossed. */
        this.resolveOpportunityAttacks(e, from, to);
        if (e.data && e.data.hp <= 0) {
          if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
          else { e.path = null; e.pathI = 0; }
          e.moving = false; return false;
        }
        const s = stepCost(dx, dy, e.diagCount | 0);
        e.moveLeft -= s.cost;
        e.diagCount = s.diagCount;
        if (e.moveLeft <= 0) {
          e.moveLeft = 0;
          if (typeof this.clearEntityPath === 'function') this.clearEntityPath(e);
          else { e.path = null; e.pathI = 0; }
          if (this.snapToTileCenter) this.snapToTileCenter(e, dt, true);
          break;
        }
      }
    }

    if (!moved || (tactical && (e.moveLeft || 0) <= 0) || (e.path && e.pathI >= e.path.length)) {
      if (tactical || this.controlMode === 'manual') {
        if (this.snapToTileCenter) this.snapToTileCenter(e, dt, true);
      }
      /* Reservation now makes a same-cell landing structurally impossible.
         If we ever get here with a genuine overlap it's a reservation leak —
         log it once per entity so it surfaces during testing instead of
         silently teleporting bodies around. */
      if (this._reservedCells && e.data && e.data.hp > 0 && typeof this.cellOf === 'function' && typeof this.isCellOccupiedAny === 'function') {
        const c = this.cellOf(e.x, e.z);
        if (c >= 0 && this.isCellOccupiedAny(c, e) && !e._overlapLogged) {
          e._overlapLogged = true;
          console.warn('[reservation] overlap detected on move completion — possible reservation leak', e.data && e.data.name, c);
        }
      }
      if (e._pendingAttackTarget) {
        const foe = e._pendingAttackTarget;
        e._pendingAttackTarget = null;
        if (foe && foe.data && foe.data.hp > 0 && Math.hypot(foe.x - e.x, foe.z - e.z) <= 2.2 && !e.actUsed) {
          this.manualPerformAttack(e, foe);
        }
      }
    }

    e.moving = moved;
    return moved;
  },

  /**
   * Deduct a world-distance of movement from e.moveLeft (1 world unit ≈ 1
   * cell). Used by combatMove's continuous orbit so in-range repositioning
   * draws from the SAME per-turn budget as pathed movement — tactical
   * orbiting is not free. No-op outside a tactical spotlight. Returns the
   * remaining budget.
   */
  spendMove(e, worldDist) {
    if (!e || !(worldDist > 0)) return e ? (e.moveLeft || 0) : 0;
    if (e.moveLeft != null) e.moveLeft = Math.max(0, e.moveLeft - worldDist);
    return e.moveLeft || 0;
  },

  /**
   * Validate a command for `e`, then book its budget cost. Does NOT execute
   * the move/attack itself — that is layered on in Phase 1 (movement) and
   * Phase 3 (actions). Returns the validateCommand result. Phase 0 callers:
   * none yet (dormant); the AI and human controllers feed commands here from
   * Phase 3 / Phase 4 onward.
   */
  applyCommand(e, cmd) {
    const result = validateCommand(cmd, e);
    if (!result.ok) return result;
    switch (cmd.type) {
      case COMMAND.MOVE:
        /* actual moveLeft decrement happens in Phase 1's moveStep as the
           entity crosses cells, so a single command may partially resolve. */
        break;
      case COMMAND.ATTACK:
      case COMMAND.CAST:
      case COMMAND.DODGE:
      case COMMAND.DISENGAGE:
        e.actUsed = true;
        if (cmd.type === COMMAND.DODGE) e.dodgeActive = true;
        if (cmd.type === COMMAND.DISENGAGE) e.disengageActive = true;
        break;
      case COMMAND.DASH:
        e.actUsed = true;
        e.moveLeft += this.cellsForSpeed(e);   /* 5e Dash: grant another move's worth */
        break;
      case COMMAND.BONUS:
        e.bonusUsed = true;
        break;
      case COMMAND.FREE:
      case COMMAND.END:
        break;
    }
    return result;
  },

  /**
   * Take one of the three universal Action-economy options as `e`. This is the
   * single entry point shared by the monster AI (monster_ai.js), the hero auto
   * AI (combat.js heroCombat) and the manual action bar, so all three book the
   * same budgets and produce the same log line.
   *
   *   dash      → spend the Action, gain another full move budget
   *   dodge     → spend the Action, +5 AC until the start of the next turn
   *                (the `patientDefense` effect — see conditions.js)
   *   disengage → spend the Action, movement provokes no opportunity attacks
   *                for the rest of this turn
   *
   * Returns true if the action was taken (false when the Action is already
   * spent, or the creature is incapacitated and cannot act).
   */
  takeCommonAction(e, kind) {
    if (!e || !e.data || e.actUsed) return false;
    if (getEffectMods(e).incapacitated) return false;
    const type = kind === 'dash' ? COMMAND.DASH
      : kind === 'dodge' ? COMMAND.DODGE
      : kind === 'disengage' ? COMMAND.DISENGAGE : null;
    if (!type) return false;
    const res = this.applyCommand(e, { type });
    if (!res.ok) return false;

    const name = (e.data && e.data.name) || 'The creature';
    if (kind === 'dodge') {
      applyEffect(e, 'patientDefense', { duration: ROUND_SECONDS, elapsed: this.fxNow });
      this.fxStatusTray(e);
      if (this.playAbilityFx) this.playAbilityFx(e, 'dodge', { at: e });
      this.fxLog(`🛡️ ${name} takes the Dodge action.`, 'sys');
    } else if (kind === 'dash') {
      if (this.playAbilityFx) this.playAbilityFx(e, 'dash', { at: e });
      this.fxLog(`🏃 ${name} Dashes to close the distance.`, 'sys');
    } else {
      if (this.playAbilityFx) this.playAbilityFx(e, 'disengage', { at: e });
      this.fxLog(`💨 ${name} Disengages.`, 'sys');
    }
    return true;
  },

  /**
   * Creatures on the opposite side of `e` that could take an opportunity
   * attack right now: alive, not incapacitated or charmed, reaction still
   * available, and armed with something that actually threatens adjacent
   * squares. Ranged-only attackers are excluded — an OA is a melee attack.
   */
  oaHostiles(e) {
    const isHero = (e._side === 'hero') || (this.heroes && this.heroes.includes(e));
    const pool = isHero
      ? (this.monsters || []).filter(m => m.active && m.data && m.data.hp > 0 && !m.data.ranged)
      : (this.heroes || []).filter(h => h.data && h.data.hp > 0 && this._hasMeleeProfile(h));
    const out = [];
    for (const o of pool) {
      if (o === e || o.reactionUsed) continue;
      if (getEffectMods(o).incapacitated) continue;
      if (hasEffect(o, 'charmed') || hasEffect(o, 'frightened')) continue;
      out.push({ entity: o, threatened: this.threatenedCells(o) });
    }
    return out;
  },

  /** A hero can only make an opportunity attack with a melee weapon (or fists). */
  _hasMeleeProfile(h) {
    const p = h.data && (h.data.weaponProfile || h.data.lastProfile);
    return !p || !!p.melee;
  },

  /**
   * Resolve opportunity attacks provoked by `mover` stepping fromCell→toCell.
   * Each hostile whose reach the mover is genuinely leaving spends its
   * reaction for one attack. Suppressed entirely by the Disengage action, and
   * only ever fires inside a tactical spotlight.
   */
  resolveOpportunityAttacks(mover, fromCell, toCell) {
    if (!mover || fromCell === toCell) return;
    if (!this.initiative || !this.initiative.active) return;
    if (mover.disengageActive) return;
    if (!mover.data || mover.data.hp <= 0) return;

    const provoked = provokesOA(this.oaHostiles(mover), fromCell, toCell);
    for (const o of provoked) {
      if (mover.data.hp <= 0) break;
      o.reactionUsed = true;
      this.fxLog(`⚔️ ${o.data.name} takes an opportunity attack at ${mover.data.name}!`, 'sys');
      if (o._side === 'hero' || (this.heroes && this.heroes.includes(o))) {
        this.heroAttackRoll(o, mover, this.heroes.filter(x => x.data.hp > 0),
          { profile: o.data.weaponProfile || o.data.lastProfile });
      } else {
        this.monsterAttack(o, mover);
      }
    }
  }
};
