import { describe, it, expect } from 'vitest';
import { turnEngineMethods, stepCost } from '../src/game/turn_engine.js';

/* The manual-move arrow and the move itself come from one plan, and the plan
   charges exactly what moveStep charges. */
const W = 20;
const cell = (x, y) => y * W + x;

function makeGame(path, { difficult = new Set() } = {}) {
  return {
    ...turnEngineMethods,
    D: { W, H: 20 },
    cellOf: () => path[0],
    nearFloorCell: c => c,
    findPath: () => path.slice(),
    isDifficultTerrain: c => difficult.has(c)
  };
}

/* moveStep's accounting, restated: a step is taken while budget is left. */
function walk(path, budget, startDiag = 0, difficult = new Set()) {
  let left = budget, diag = startDiag, reached = 0;
  for (let k = 1; k < path.length && left > 0; k++) {
    const a = path[k - 1], b = path[k];
    const s = stepCost(Math.sign((b % W) - (a % W)), Math.sign(Math.floor(b / W) - Math.floor(a / W)), diag, difficult.has(b) ? 2 : 1);
    left -= s.cost; diag = s.diagCount; reached = k;
  }
  return reached;
}

describe('manual move plan', () => {
  it('stops where the walk stops on a diagonal route (alternating 5/10 ft)', () => {
    const path = [cell(0, 0), cell(1, 1), cell(2, 2), cell(3, 3), cell(4, 4), cell(5, 5), cell(6, 6)];
    const g = makeGame(path);
    const hero = { x: 0, z: 0, moveLeft: 6, diagCount: 0, data: {} };
    const plan = g.planManualMove(hero, path[6]);
    /* 5 + 10 + 5 + 10 = 30 ft: four diagonals, not six */
    expect(plan.path.length - 1).toBe(4);
    expect(plan.path.length - 1).toBe(walk(path, 6));
    expect(plan.costFt).toBe(30);
    expect(plan.fullCostFt).toBe(45);
    expect(plan.inBudget).toBe(false);
    expect(plan.goalCell).toBe(path[4]);
    expect(plan.targetCell).toBe(path[6]);
  });

  it('continues the diagonal count the hero has already built up this turn', () => {
    const path = [cell(0, 0), cell(1, 1), cell(2, 2), cell(3, 3)];
    const g = makeGame(path);
    const hero = { x: 0, z: 0, moveLeft: 3, diagCount: 1, data: {} };
    const plan = g.planManualMove(hero, path[3]);
    expect(plan.path.length - 1).toBe(walk(path, 3, 1));
  });

  it('charges difficult terrain double on straight steps', () => {
    const path = [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0), cell(4, 0)];
    const difficult = new Set([cell(1, 0), cell(2, 0)]);
    const g = makeGame(path, { difficult });
    const hero = { x: 0, z: 0, moveLeft: 4, diagCount: 0, data: {} };
    const plan = g.planManualMove(hero, path[4]);
    expect(plan.path.length - 1).toBe(walk(path, 4, 0, difficult));
    expect(plan.path.length - 1).toBe(2);
  });

  it('fits a straight route exactly', () => {
    const path = [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)];
    const plan = makeGame(path).planManualMove({ x: 0, z: 0, moveLeft: 6, diagCount: 0, data: {} }, path[3]);
    expect(plan.path).toEqual(path);
    expect(plan.costFt).toBe(15);
    expect(plan.inBudget).toBe(true);
  });
});
