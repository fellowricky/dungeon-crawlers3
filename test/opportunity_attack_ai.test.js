import { describe, it, expect } from 'vitest';
import { provokesOA } from '../src/game/turn_engine.js';

describe('AI Opportunity-Attack Risk Avoidance', () => {
  it('detects when stepping from cell A to cell B provokes an opportunity attack', () => {
    // Hostile threatens cell 10, but NOT cell 11
    const hostileThreats = new Set([10]);
    const hostiles = [{ entity: { name: 'Goblin' }, threatened: hostileThreats }];

    const provoked = provokesOA(hostiles, 10, 11);
    expect(provoked.length).toBe(1);
    expect(provoked[0].name).toBe('Goblin');

    // Stepping between cells within reach (cell 10 to cell 10) does NOT provoke OA
    const internalMove = provokesOA(hostiles, 10, 10);
    expect(internalMove.length).toBe(0);
  });
});
