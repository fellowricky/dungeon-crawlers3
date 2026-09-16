import { describe, it, expect } from 'vitest';
import { initiativeMethods } from '../src/game/initiative.js';

/* Minimal stand-in for the Game object: isCurrentActor only touches
   `this.initiative` and `this._currentActor()`, both provided here. */
function fakeGame(order, { active = true, idx = 0, awaitingReveal = false } = {}) {
  return Object.assign(Object.create(initiativeMethods), {
    initiative: { active, order, idx, _awaitingReveal: awaitingReveal },
  });
}

const combatant = name => ({ name, data: { hp: 10 }, active: true });

describe('isCurrentActor — the gate every action path consults', () => {
  it('lets the top of the order act once the reveal is done', () => {
    const [a, b] = [combatant('a'), combatant('b')];
    const g = fakeGame([a, b]);
    expect(g.isCurrentActor(a)).toBe(true);
    expect(g.isCurrentActor(b)).toBe(false);
  });

  /* The bug this exists for: _rollInitiative sets active=true and idx=0 before
     the roll-off starts, so without the _awaitingReveal check the first
     combatant was already "current" and opened with a spell mid-animation. */
  it('freezes EVERYONE while the initiative roll-off is playing', () => {
    const [a, b] = [combatant('a'), combatant('b')];
    const g = fakeGame([a, b], { awaitingReveal: true });
    expect(g.isCurrentActor(a)).toBe(false);
    expect(g.isCurrentActor(b)).toBe(false);
  });

  it('unfreezes as soon as the reveal flag clears', () => {
    const [a, b] = [combatant('a'), combatant('b')];
    const g = fakeGame([a, b], { awaitingReveal: true });
    expect(g.isCurrentActor(a)).toBe(false);
    g.initiative._awaitingReveal = false;
    expect(g.isCurrentActor(a)).toBe(true);
  });

  it('stays false when initiative is not active at all', () => {
    const a = combatant('a');
    expect(fakeGame([a], { active: false }).isCurrentActor(a)).toBe(false);
  });

  it('returns a real boolean, never a truthy object', () => {
    const a = combatant('a');
    const g = fakeGame([a]);
    expect(g.isCurrentActor(a)).toBe(true);
    expect(typeof fakeGame([a], { active: false }).isCurrentActor(a)).toBe('boolean');
  });

  it('does not throw when initiative has not been built yet', () => {
    const g = Object.assign(Object.create(initiativeMethods), { initiative: null });
    expect(() => g.isCurrentActor(combatant('a'))).not.toThrow();
    expect(g.isCurrentActor(combatant('a'))).toBe(false);
  });
});
