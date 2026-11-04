import { describe, it, expect } from 'vitest';
import { FLOOR, WALL, CHOKEPOINT_COST } from '../src/game/constants.js';
import { RACES } from '../src/game/srd.js';
import {
  FT_PER_CELL, DEFAULT_MONSTER_CELLS,
  ftToCells, applySpeedMult, monsterCells,
  diagCost, stepCost, pathMoveCost,
  threatenedCellsGrid, provokesOA, reachableCellsGrid,
  validateCommand, COMMAND, turnEngineMethods
} from '../src/game/turn_engine.js';
import { COMBAT_MOVE_BOOST } from '../src/game/constants.js';
import { getEffectMods, applyEffect } from '../src/game/conditions.js';

/* Helpers: build a flat typed grid from a 2D row array of chars.
 *   '.' = FLOOR, '#' = WALL. Rows are top-to-bottom, columns left-to-right.
 *   Returns { grid, W, H, cell } where cell(x,y) = y*W + x. */
function gridFrom(rows) {
  const H = rows.length, W = rows[0].length;
  const grid = new Int32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      grid[y * W + x] = rows[y][x] === '#' ? WALL : FLOOR;
  return { grid, W, H };
}

describe('turn_engine — speed → cells', () => {
  it('ftToCells floors feet/5 (30 ft → 6, 25 ft → 5)', () => {
    expect(ftToCells(30)).toBe(6);
    expect(ftToCells(25)).toBe(5);
    expect(ftToCells(7)).toBe(1);
    expect(ftToCells(0)).toBe(0);
  });

  it('applySpeedMult floors and clamps to minimum 1', () => {
    expect(applySpeedMult(6, 1.0)).toBe(6);
    expect(applySpeedMult(6, 1.5)).toBe(9);
    expect(applySpeedMult(6, 0.5)).toBe(3);
    expect(applySpeedMult(6, 0.01)).toBe(1);   // never below 1
    expect(applySpeedMult(5, undefined)).toBe(5);
  });

  it('monsterCells defaults to 6, honours data.speedCells', () => {
    expect(monsterCells({})).toBe(DEFAULT_MONSTER_CELLS);
    expect(monsterCells(null)).toBe(DEFAULT_MONSTER_CELLS);
    expect(monsterCells({ speedCells: 8 })).toBe(8);
    expect(monsterCells({ speedCells: 4 })).toBe(4);
    expect(monsterCells({ speedCells: 0 })).toBe(0);   // explicit 0 respected
  });

  it('RACES carry D&D-accurate speedFt (small races = 25, others = 30)', () => {
    for (const key of Object.keys(RACES)) {
      expect(RACES[key].speedFt, `${key} missing speedFt`).toBeDefined();
    }
    expect(RACES.dwarf.speedFt).toBe(25);
    expect(RACES.gnome.speedFt).toBe(25);
    expect(RACES.halfling.speedFt).toBe(25);
    expect(RACES.human.speedFt).toBe(30);
    expect(RACES.elf.speedFt).toBe(30);
    expect(RACES.dragonborn.speedFt).toBe(30);
  });

  it('cellsForSpeed derives hero budget directly from speedFt (30 ft -> 6 cells, 25 ft -> 5 cells)', () => {
    const heroHuman = { data: { raceKey: 'human', speedFt: 30 } };
    const heroDwarf = { data: { raceKey: 'dwarf', speedFt: 25 } };
    expect(turnEngineMethods.cellsForSpeed(heroHuman)).toBe(6);
    expect(turnEngineMethods.cellsForSpeed(heroDwarf)).toBe(5);
  });

  it('cellsForSpeed respects discrete 5ft (+1 tile) combat movement bonuses', () => {
    // Human with +5 ft Move (e.g. Fleet-Foot rank 1 or Athlete feat) -> 35 ft -> 7 cells
    const hero35 = { data: { raceKey: 'human', speedFt: 35 } };
    expect(turnEngineMethods.cellsForSpeed(hero35)).toBe(7);

    // Human with +10 ft Move (e.g. Mobile feat) -> 40 ft -> 8 cells
    const hero40 = { data: { raceKey: 'human', speedFt: 40 } };
    expect(turnEngineMethods.cellsForSpeed(hero40)).toBe(8);
  });

  it('cellsForSpeed does not mix continuous exploration speedMult into combat movement', () => {
    // Exploration speedMult might be 1.5 (+50% explore speed), but combat cell budget stays 6 cells (30 ft)
    const heroExploreFast = { data: { raceKey: 'human', speedFt: 30, speedMult: 1.5 } };
    expect(turnEngineMethods.cellsForSpeed(heroExploreFast)).toBe(6);
  });

  it('cellsForSpeed applies tactical combat effect multipliers (Haste / Slow)', () => {
    const hero = { data: { raceKey: 'human', speedFt: 30 }, effects: {} };
    // Normal: 6 cells
    expect(turnEngineMethods.cellsForSpeed(hero)).toBe(6);

    // Hasted: speedMul 2 (5e doubles speed) -> 12 cells
    applyEffect(hero, 'hasted', { duration: 10 });
    expect(turnEngineMethods.cellsForSpeed(hero)).toBe(12);

    // Entangled / slowed: speedMul 0.5 -> floor(6 * 0.5) = 3 cells
    const slowedHero = { data: { raceKey: 'human', speedFt: 30 }, effects: {} };
    applyEffect(slowedHero, 'slowed', { duration: 10 });
    expect(turnEngineMethods.cellsForSpeed(slowedHero)).toBe(3);
  });
});

describe('turn_engine — PHB alternating diagonals', () => {
  it('diagCost alternates 1,2,1,2…', () => {
    expect(diagCost(0)).toBe(1);
    expect(diagCost(1)).toBe(2);
    expect(diagCost(2)).toBe(1);
    expect(diagCost(3)).toBe(2);
    expect(diagCost(4)).toBe(1);
  });

  it('stepCost: cardinal is 1 and leaves diagCount alone; diagonal uses alternating', () => {
    expect(stepCost(1, 0, 0)).toEqual({ cost: 1, diagCount: 0 });
    expect(stepCost(0, 1, 2)).toEqual({ cost: 1, diagCount: 2 });
    expect(stepCost(1, 1, 0)).toEqual({ cost: 1, diagCount: 1 });  // 1st diag
    expect(stepCost(1, 1, 1)).toEqual({ cost: 2, diagCount: 2 });  // 2nd diag
    expect(stepCost(-1, 1, 2)).toEqual({ cost: 1, diagCount: 3 });
    expect(stepCost(0, 0, 3)).toEqual({ cost: 0, diagCount: 3 });  // no-op
  });

  it('pathMoveCost sums a mixed cardinal/diagonal path', () => {
    // 5-wide grid. Path cells (x,y): (0,0)->(1,1)->(2,1)->(3,2)->(4,2)
    //   diagonal(1, 1st) + cardinal(1) + diagonal(2, 2nd) + cardinal(1) = 5, diagCount ends 2
    const W = 5;
    const path = [0, 6, 7, 13, 14];   // (0,0),(1,1),(2,1),(3,2),(4,2)
    const r = pathMoveCost(path, W);
    expect(r.cost).toBe(5);
    expect(r.diagCount).toBe(2);
  });

  it('pathMoveCost: two consecutive diagonals cost 1 + 2 = 3', () => {
    // (0,0)->(1,1)->(2,2): 1st diag (1) + 2nd diag (2) = 3
    expect(pathMoveCost([0, 6, 12], 5)).toEqual({ cost: 3, diagCount: 2 });
  });

  it('pathMoveCost handles empty / single-cell paths', () => {
    expect(pathMoveCost([], 5)).toEqual({ cost: 0, diagCount: 0 });
    expect(pathMoveCost([3], 5)).toEqual({ cost: 0, diagCount: 0 });
    expect(pathMoveCost(null, 5)).toEqual({ cost: 0, diagCount: 0 });
  });
});

describe('turn_engine — threatened squares', () => {
  it('reach 1 threatens the 8 adjacent floor cells, not the center, not walls', () => {
    const { grid, W, H } = gridFrom([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....'
    ]);
    // center cell (2,2) = 12
    const t = threatenedCellsGrid(grid, W, H, 12, 1);
    expect(t.size).toBe(8);
    expect(t.has(12)).toBe(false);
    expect([...t].sort((a, b) => a - b)).toEqual([6, 7, 8, 11, 13, 16, 17, 18]);
  });

  it('walls are not threatened; out-of-bounds ignored', () => {
    const { grid, W, H } = gridFrom([
      '.#',
      '..'
    ]);
    // center (0,0)=0, reach 1. Neighbours: (1,0)=1 is WALL, (0,1)=2 floor, (1,1)=3 floor.
    const t = threatenedCellsGrid(grid, W, H, 0, 1);
    expect([...t].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('reach 2 covers the full 5x5 minus the center (24 cells)', () => {
    const { grid, W, H } = gridFrom([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....'
    ]);
    const t = threatenedCellsGrid(grid, W, H, 12, 2);
    expect(t.size).toBe(24);
    expect(t.has(12)).toBe(false);
  });
});

describe('turn_engine — opportunity attacks', () => {
  const hostiles = [
    { entity: 'wolf', threatened: new Set([0, 1, 2]) },
    { entity: 'goblin', threatened: new Set([5, 6]) }
  ];

  it('provokes when leaving a threatened cell for a non-threatened one', () => {
    expect(provokesOA(hostiles, 1, 9)).toEqual(['wolf']);      // wolf threatens 1, not 9
    expect(provokesOA(hostiles, 6, 1)).toEqual(['goblin']);    // goblin threatens 6, not 1
  });

  it('does NOT provoke when staying within the same threat set', () => {
    expect(provokesOA(hostiles, 0, 2)).toEqual([]);            // both 0 and 2 threatened by wolf
  });

  it('does NOT provoke when the origin was not threatened', () => {
    expect(provokesOA(hostiles, 99, 1)).toEqual([]);           // origin unthreatened
  });

  it('multiple hostiles can provoke at once', () => {
    const both = [
      { entity: 'a', threatened: new Set([1]) },
      { entity: 'b', threatened: new Set([1]) }
    ];
    expect(provokesOA(both, 1, 2)).toEqual(['a', 'b']);
  });

  it('handles degenerate input', () => {
    expect(provokesOA(null, 1, 2)).toEqual([]);
    expect(provokesOA([], 1, 2)).toEqual([]);
    expect(provokesOA([{ entity: 'x' }], 1, 2)).toEqual([]);   // no threatened set
  });
});

describe('turn_engine — reachableCellsGrid', () => {
  it('3x3 from center, budget 1 reaches all 9 cells (first diagonal = 1)', () => {
    const { grid, W, H } = gridFrom(['...', '...', '...']);
    const r = reachableCellsGrid(grid, W, H, 4, 1);   // center cell
    expect(r.size).toBe(9);
    expect(r.get(4)).toBe(0);
    for (const n of [1, 3, 5, 7, 0, 2, 6, 8]) expect(r.has(n)).toBe(true);
  });

  it('PHB parity: 3x3 from CORNER, budget 2 reaches 8 cells (far diagonal corner needs 3)', () => {
    const { grid, W, H } = gridFrom(['...', '...', '...']);
    const r = reachableCellsGrid(grid, W, H, 0, 2);
    // cell0=0, cell1 & cell3 =1, cell4(diag)=1, cell2 & cell6=2, cell5 & cell7=2,
    // cell8 (two diagonals away) = 1+2 = 3 → NOT reachable at budget 2.
    expect(r.size).toBe(8);
    expect(r.has(8)).toBe(false);
    expect(r.get(4)).toBe(1);   // single diagonal from corner = cost 1
  });

  it('budget 3 from the corner reaches the far diagonal corner (cost 3)', () => {
    const { grid, W, H } = gridFrom(['...', '...', '...']);
    const r = reachableCellsGrid(grid, W, H, 0, 3);
    expect(r.has(8)).toBe(true);
    expect(r.size).toBe(9);
  });

  it('does not corner-cut through walls on a diagonal', () => {
    // (1,0) and (0,1) are walls, so the diagonal (0,0)->(1,1) is blocked.
    const { grid, W, H } = gridFrom([
      '.#.',
      '...',
      '...'
    ]);
    // Replace (0,1) too: build manually for precision.
    const W2 = 3, H2 = 3;
    const g2 = new Int32Array(9);
    g2[0] = FLOOR;                   // (0,0)
    g2[1] = WALL;                    // (1,0)
    g2[2] = FLOOR;                   // (2,0)
    g2[3] = WALL;                    // (0,1)
    g2[4] = FLOOR;                   // (1,1)
    g2[5] = FLOOR;
    g2[6] = FLOOR; g2[7] = FLOOR; g2[8] = FLOOR;
    const r = reachableCellsGrid(g2, W2, H2, 0, 5);
    expect(r.has(4)).toBe(false);    // diagonal corner-cut blocked
  });

  it('walls are never reachable', () => {
    const { grid, W, H } = gridFrom([
      '..#',
      '..#',
      '..#'
    ]);
    const r = reachableCellsGrid(grid, W, H, 0, 10);
    for (const wallCell of [2, 5, 8]) expect(r.has(wallCell)).toBe(false);
    expect(r.has(0)).toBe(true);
  });

  it('respects the budget cap (linear corridor)', () => {
    // 1x6 corridor along the top row, but make other rows walls so movement
    // is forced along x. start at (0,0), budget 3 → reaches (0..3,0).
    const W = 6, H = 1;
    const g = new Int32Array(W * H).fill(FLOOR);
    const r = reachableCellsGrid(g, W, H, 0, 3);
    expect(r.get(0)).toBe(0);
    expect(r.get(1)).toBe(1);
    expect(r.get(2)).toBe(2);
    expect(r.get(3)).toBe(3);
    expect(r.has(4)).toBe(false);
    expect(r.size).toBe(4);
  });

  it('chokepoint cells cost CHOKEPOINT_COST to enter', () => {
    // 1x4 corridor, cell 1 is a chokepoint (cost 3 to enter). budget 2 from
    // cell 0 cannot pass it; budget 4 can reach cell 2.
    const W = 4, H = 1;
    const g = new Int32Array(W).fill(FLOOR);
    const choke = new Uint8Array(W); choke[1] = 1;
    const blocked = reachableCellsGrid(g, W, H, 0, 2, { chokepoint: choke });
    expect(blocked.has(2)).toBe(false);             // can't afford through choke
    const through = reachableCellsGrid(g, W, H, 0, 4, { chokepoint: choke });
    expect(through.has(2)).toBe(true);
    expect(through.get(2)).toBeGreaterThanOrEqual(1 + CHOKEPOINT_COST); // 1(enter choke) + ... 
  });

  it('returns empty for invalid start / non-positive budget', () => {
    const { grid, W, H } = gridFrom(['...', '...', '...']);
    expect(reachableCellsGrid(grid, W, H, -1, 5).size).toBe(0);
    expect(reachableCellsGrid(grid, W, H, 4, 0).size).toBe(0);
    // start on a wall
    const g = new Int32Array([WALL, FLOOR, FLOOR]);
    expect(reachableCellsGrid(g, 3, 1, 0, 5).size).toBe(0);
  });
});

describe('turn_engine — command validation', () => {
  const full = () => ({ moveLeft: 6, actUsed: false, bonusUsed: false, reactionUsed: false });

  it('MOVE allowed while moveLeft > 0, blocked at 0', () => {
    expect(validateCommand({ type: COMMAND.MOVE }, full()).ok).toBe(true);
    const b = full(); b.moveLeft = 0;
    expect(validateCommand({ type: COMMAND.MOVE }, b).ok).toBe(false);
  });

  it('ATTACK / CAST / DASH / DODGE / DISENGAGE all consume the single Action', () => {
    for (const t of [COMMAND.ATTACK, COMMAND.CAST, COMMAND.DASH, COMMAND.DODGE, COMMAND.DISENGAGE]) {
      expect(validateCommand({ type: t }, full()).ok).toBe(true);
      const b = full(); b.actUsed = true;
      const r = validateCommand({ type: t }, b);
      expect(r.ok).toBe(false);
    }
  });

  it('BONUS consumes the single Bonus Action', () => {
    expect(validateCommand({ type: COMMAND.BONUS }, full()).ok).toBe(true);
    const b = full(); b.bonusUsed = true;
    expect(validateCommand({ type: COMMAND.BONUS }, b).ok).toBe(false);
  });

  it('FREE and END are always allowed (no budget)', () => {
    const exhausted = { moveLeft: 0, actUsed: true, bonusUsed: true, reactionUsed: true };
    expect(validateCommand({ type: COMMAND.FREE }, exhausted).ok).toBe(true);
    expect(validateCommand({ type: COMMAND.END }, exhausted).ok).toBe(true);
  });

  it('rejects unknown / missing command types', () => {
    expect(validateCommand({ type: 'fly' }, full()).ok).toBe(false);
    expect(validateCommand({}, full()).ok).toBe(false);
    expect(validateCommand(null, full()).ok).toBe(false);
  });

  it('COMMAND is frozen and stable', () => {
    expect(COMMAND.MOVE).toBe('move');
    expect(COMMAND.DASH).toBe('dash');
    expect(Object.isFrozen(COMMAND)).toBe(true);
  });
});

/* ── moveStep / spendMove: budgeted movement (Phase 1) ──────────────────
 * These are Game-mixin methods, so we invoke them against a minimal fake
 * `this` that supplies just the surface they touch: initiative state,
 * isCurrentActor, canMove, D.W, and a stub stepAlong that advances pathI by
 * a controllable number of waypoints per call (simulating cell captures).
 * The real resolveOpportunityAttacks is mixed in too — with empty hero/monster
 * rosters it is a no-op, so the budget math below is measured through the same
 * code path the game runs.  */
function makeCtx({ active = true, current = null, stepAdvance = 1 } = {}) {
  const ctx = {
    initiative: { active },
    isCurrentActor(e) { return e === current; },
    canMove: turnEngineMethods.canMove,
    moveStep: turnEngineMethods.moveStep,
    spendMove: turnEngineMethods.spendMove,
    resolveOpportunityAttacks: turnEngineMethods.resolveOpportunityAttacks,
    oaHostiles: turnEngineMethods.oaHostiles,
    heroes: [],
    monsters: [],
    D: { W: 5 },
    /* Stub: advance pathI by stepAdvance (capped at path length) and report
       "moved". Position is irrelevant to the budget math being tested. */
    stepAlong(e /*, speed, dt */) {
      if (!e.path) return false;
      e.pathI = Math.min(e.path.length, (e.pathI | 0) + stepAdvance);
      return true;
    }
  };
  return ctx;
}

describe('turn_engine — moveStep budget consumption', () => {
  it('off-turn actors are frozen (no move, no budget change)', () => {
    const hero = { moveLeft: 6, path: [0, 1, 2], pathI: 0, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: { other: true } });   // hero is NOT current
    const moved = ctx.moveStep(hero, 1, 0.016);
    expect(moved).toBe(false);
    expect(hero.moving).toBe(false);
    expect(hero.moveLeft).toBe(6);      // untouched
    expect(hero.pathI).toBe(0);         // stepAlong never called
  });

  it('current actor with no budget is frozen (turn not ended — budget stays 0)', () => {
    const hero = { moveLeft: 0, path: [0, 1, 2], pathI: 0, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: hero });
    expect(ctx.moveStep(hero, 1, 0.016)).toBe(false);
    expect(hero.pathI).toBe(0);
  });

  // NOTE: path[0] is the actor's current cell (findPath returns [from,…,to]),
  // captured for free on the first frame. These tests start at pathI:1 to model
  // the steady mid-move state where every capture is a real step into a new cell.
  it('deducts one cardinal step (cost 1) when a waypoint is captured', () => {
    // path (x,y): (0,0)->(1,0)->(2,0) — all cardinal; start consumed (pathI:1)
    const hero = { moveLeft: 6, path: [0, 1, 2], pathI: 1, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: hero, stepAdvance: 1 });
    ctx.moveStep(hero, 1, 0.016);   // captures path[1]: (0,0)->(1,0)
    expect(hero.moveLeft).toBe(5);
    expect(hero.diagCount).toBe(0);
  });

  it('honours PHB alternating diagonals across successive captures', () => {
    // path (x,y): (0,0)->(1,1)->(2,2)->(3,3): three diagonals costing 1,2,1
    const hero = { moveLeft: 6, path: [0, 6, 12, 18], pathI: 1, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: hero, stepAdvance: 1 });
    ctx.moveStep(hero, 1, 0.016);   // (0,0)->(1,1): 1st diagonal, cost 1
    expect(hero.moveLeft).toBe(5);
    expect(hero.diagCount).toBe(1);
    ctx.moveStep(hero, 1, 0.016);   // (1,1)->(2,2): 2nd diagonal, cost 2
    expect(hero.moveLeft).toBe(3);
    expect(hero.diagCount).toBe(2);
    ctx.moveStep(hero, 1, 0.016);   // (2,2)->(3,3): 3rd diagonal, cost 1
    expect(hero.moveLeft).toBe(2);
    expect(hero.diagCount).toBe(3);
  });

  it('deducts multiple captures in one frame (fast step) with correct diagonal parity', () => {
    // stepAdvance 2: captures path[1] and path[2] in a single call.
    // path (x,y): (0,0)->(1,1)->(2,1): diagonal(1) + cardinal(1) = 2 spent.
    const hero = { moveLeft: 6, path: [0, 6, 7], pathI: 1, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: hero, stepAdvance: 2 });
    ctx.moveStep(hero, 1, 0.016);
    expect(hero.moveLeft).toBe(4);
    expect(hero.diagCount).toBe(1);
  });

  it('truncates the path and pins the actor when the budget is exhausted', () => {
    // Only 1 cell of budget; path is 3 cardinal steps (start consumed).
    const hero = { moveLeft: 1, path: [0, 1, 2, 3], pathI: 1, diagCount: 0 };
    const ctx = makeCtx({ active: true, current: hero, stepAdvance: 1 });
    ctx.moveStep(hero, 1, 0.016);   // captures path[1]: spends the last cell
    expect(hero.moveLeft).toBe(0);
    expect(hero.path).toBe(null);   // remainder dropped so it stops
    expect(hero.pathI).toBe(0);
    // next call: pinned (no budget), path already cleared
    expect(ctx.moveStep(hero, 1, 0.016)).toBe(false);
  });

  it('outside initiative, movement is free and unbudgeted', () => {
    const hero = { moveLeft: 0, path: [0, 1, 2], pathI: 0, diagCount: 0 };
    const ctx = makeCtx({ active: false });   // no active initiative
    const moved = ctx.moveStep(hero, 1, 0.016);
    expect(moved).toBe(true);        // moved despite moveLeft 0
    expect(hero.pathI).toBe(1);      // stepAlong ran
    expect(hero.moveLeft).toBe(0);   // budget not touched off-combat
  });
});

describe('turn_engine — spendMove', () => {
  const ctx = { spendMove: turnEngineMethods.spendMove };

  it('deducts world-distance from moveLeft and clamps at 0', () => {
    const e = { moveLeft: 5 };
    expect(ctx.spendMove(e, 2)).toBe(3);
    expect(e.moveLeft).toBe(3);
    expect(ctx.spendMove(e, 10)).toBe(0);   // clamped
    expect(e.moveLeft).toBe(0);
  });

  it('is a no-op for non-positive distance', () => {
    const e = { moveLeft: 4 };
    expect(ctx.spendMove(e, 0)).toBe(4);
    expect(ctx.spendMove(e, -3)).toBe(4);
    expect(e.moveLeft).toBe(4);
  });
});

describe('turn_engine — canMove gate', () => {
  const canMove = turnEngineMethods.canMove;
  it('allows everyone outside initiative', () => {
    const ctx = { initiative: { active: false }, isCurrentActor: () => false };
    expect(canMove.call(ctx, { x: 1 })).toBe(true);
    const ctx2 = { initiative: null, isCurrentActor: () => false };
    expect(canMove.call(ctx2, { x: 1 })).toBe(true);
  });
  it('allows only the current actor during a spotlight', () => {
    const hero = { x: 1 };
    const ctx = { initiative: { active: true }, isCurrentActor: e => e === hero };
    expect(canMove.call(ctx, hero)).toBe(true);
    expect(canMove.call(ctx, { x: 2 })).toBe(false);
  });
});

/* ── takeCommonAction: Dash / Dodge / Disengage (shared by both AIs) ──── */
describe('turn_engine — takeCommonAction', () => {
  /* Minimal `this`: the real applyCommand + takeCommonAction, plus the
     cellsForSpeed Dash needs. No FX/log surface — log() is a no-op import and
     playAbilityFx is optional. */
  function actorCtx() {
    return {
      fxNow: 0,
      applyCommand: turnEngineMethods.applyCommand,
      takeCommonAction: turnEngineMethods.takeCommonAction,
      cellsForSpeed: () => 6,
      fxLog: () => {},
      fxStatusTray: () => {},
    };
  }
  const mob = (over = {}) => ({
    data: { name: 'Gnoll', hp: 10, maxHp: 10 }, _side: 'mon',
    moveLeft: 0, actUsed: false, bonusUsed: false, reactionUsed: false,
    diagCount: 0, disengageActive: false, ...over
  });

  it('Dash spends the Action and grants another full move budget', () => {
    const ctx = actorCtx(), m = mob({ moveLeft: 0 });
    expect(ctx.takeCommonAction(m, 'dash')).toBe(true);
    expect(m.actUsed).toBe(true);
    expect(m.moveLeft).toBe(6);
  });

  it('Dodge spends the Action and applies the +5 AC patientDefense effect', () => {
    const ctx = actorCtx(), m = mob();
    expect(ctx.takeCommonAction(m, 'dodge')).toBe(true);
    expect(m.actUsed).toBe(true);
    expect(getEffectMods(m).acBonus).toBe(5);
  });

  it('Disengage spends the Action and arms the OA suppression flag', () => {
    const ctx = actorCtx(), m = mob();
    expect(ctx.takeCommonAction(m, 'disengage')).toBe(true);
    expect(m.actUsed).toBe(true);
    expect(m.disengageActive).toBe(true);
  });

  it('refuses when the Action is already spent, and on an unknown kind', () => {
    const ctx = actorCtx(), m = mob({ actUsed: true });
    expect(ctx.takeCommonAction(m, 'dodge')).toBe(false);
    expect(ctx.takeCommonAction(mob(), 'pirouette')).toBe(false);
  });

  it('refuses for an incapacitated creature', () => {
    const ctx = actorCtx(), m = mob();
    applyEffect(m, 'stunned', { duration: 10, elapsed: 0 });
    expect(getEffectMods(m).incapacitated).toBe(true);
    expect(ctx.takeCommonAction(m, 'dodge')).toBe(false);
    expect(m.actUsed).toBe(false);
  });
});

/* ── resolveOpportunityAttacks: leaving reach draws a free swing ──────── */
describe('turn_engine — opportunity attack resolution', () => {
  /* 5x5 open floor. The hero moves; one melee monster stands adjacent. */
  function oaCtx(over = {}) {
    const { grid, W, H } = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    const swings = [];
    const ctx = {
      initiative: { active: true },
      D: { W, H, grid },
      heroes: [], monsters: [],
      cellOf: (x, z) => z * W + x,
      entityReach: turnEngineMethods.entityReach,
      threatenedCells: turnEngineMethods.threatenedCells,
      oaHostiles: turnEngineMethods.oaHostiles,
      _hasMeleeProfile: turnEngineMethods._hasMeleeProfile,
      resolveOpportunityAttacks: turnEngineMethods.resolveOpportunityAttacks,
      monsterAttack: (m, h) => swings.push([m.data.name, h.data.name]),
      heroAttackRoll: (h, m) => swings.push([h.data.name, m.data.name]),
      fxLog: () => {},
      ...over
    };
    return { ctx, swings, W };
  }
  /* hero at cell (1,1); monster at (2,1) threatens the 8 cells around it. */
  const hero = () => ({ data: { name: 'Bran', hp: 20, maxHp: 20 }, _side: 'hero', x: 1, z: 1 });
  const gnoll = () => ({ data: { name: 'Gnoll', hp: 9, maxHp: 9 }, _side: 'mon',
                         active: true, x: 2, z: 1, reactionUsed: false });

  it('fires when the mover genuinely leaves the threatened square', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(), m = gnoll();
    ctx.heroes = [h]; ctx.monsters = [m];
    /* (1,1) is adjacent to the gnoll; (0,3) is not — reach is left behind. */
    ctx.resolveOpportunityAttacks(h, 1 * W + 1, 3 * W + 0);
    expect(swings).toEqual([['Gnoll', 'Bran']]);
    expect(m.reactionUsed).toBe(true);
  });

  it('does not fire when the mover stays inside the same reach', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(), m = gnoll();
    ctx.heroes = [h]; ctx.monsters = [m];
    /* (1,1) -> (1,2): both are still adjacent to the gnoll at (2,1). */
    ctx.resolveOpportunityAttacks(h, 1 * W + 1, 2 * W + 1);
    expect(swings).toEqual([]);
    expect(m.reactionUsed).toBe(false);
  });

  it('is suppressed by the Disengage action', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(); h.disengageActive = true;
    const m = gnoll();
    ctx.heroes = [h]; ctx.monsters = [m];
    ctx.resolveOpportunityAttacks(h, 1 * W + 1, 3 * W + 0);
    expect(swings).toEqual([]);
    expect(m.reactionUsed).toBe(false);
  });

  it('costs a reaction — one opportunity attack per hostile per round', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(), m = gnoll();
    ctx.heroes = [h]; ctx.monsters = [m];
    ctx.resolveOpportunityAttacks(h, 1 * W + 1, 3 * W + 0);
    h.x = 1; h.z = 1;                                   // step back into reach
    ctx.resolveOpportunityAttacks(h, 1 * W + 1, 3 * W + 0);
    expect(swings).toHaveLength(1);
  });

  it('never fires outside a tactical spotlight', () => {
    const { ctx, swings, W } = oaCtx({ initiative: { active: false } });
    ctx.heroes = [hero()]; ctx.monsters = [gnoll()];
    ctx.resolveOpportunityAttacks(ctx.heroes[0], 1 * W + 1, 3 * W + 0);
    expect(swings).toEqual([]);
  });

  it('ranged-only monsters do not take opportunity attacks', () => {
    const { ctx, swings, W } = oaCtx();
    const m = gnoll(); m.data.ranged = true;
    ctx.heroes = [hero()]; ctx.monsters = [m];
    ctx.resolveOpportunityAttacks(ctx.heroes[0], 1 * W + 1, 3 * W + 0);
    expect(swings).toEqual([]);
  });

  it('a charmed or incapacitated hostile cannot react', () => {
    const { ctx, swings, W } = oaCtx();
    const m = gnoll();
    applyEffect(m, 'charmed', { duration: 10, elapsed: 0 });
    ctx.heroes = [hero()]; ctx.monsters = [m];
    ctx.resolveOpportunityAttacks(ctx.heroes[0], 1 * W + 1, 3 * W + 0);
    expect(swings).toEqual([]);
  });

  it('heroes take opportunity attacks at monsters leaving their reach', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(), m = gnoll();
    h.data.weaponProfile = { melee: true };
    ctx.heroes = [h]; ctx.monsters = [m];
    /* the gnoll at (2,1) flees out of Bran's reach */
    ctx.resolveOpportunityAttacks(m, 1 * W + 2, 3 * W + 4);
    expect(swings).toEqual([['Bran', 'Gnoll']]);
    expect(h.reactionUsed).toBe(true);
  });

  it('a hero holding a bow gets no opportunity attack', () => {
    const { ctx, swings, W } = oaCtx();
    const h = hero(), m = gnoll();
    h.data.weaponProfile = { melee: false, range: 8 };
    ctx.heroes = [h]; ctx.monsters = [m];
    ctx.resolveOpportunityAttacks(m, 1 * W + 2, 3 * W + 4);
    expect(swings).toEqual([]);
  });
});
