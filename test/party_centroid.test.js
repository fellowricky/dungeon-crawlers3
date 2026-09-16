import { describe, it, expect } from 'vitest';
import { partyCentroid } from '../src/game/combat_eval.js';

const hero = (x, z, extra = {}) => ({ x, z, data: { hp: 10 }, ...extra });

describe('partyCentroid — the combat camera anchor', () => {
  it('averages the living party', () => {
    const c = partyCentroid([hero(0, 0), hero(4, 8)]);
    expect(c).toEqual({ x: 2, z: 4 });
  });

  it('ignores downed heroes', () => {
    const c = partyCentroid([hero(0, 0), hero(100, 100, { data: { hp: 0 } })]);
    expect(c).toEqual({ x: 0, z: 0 });
  });

  /* The reason this is a function rather than three inline lines: a summon that
     charges the far wall must not drag the camera off the player's own party. */
  it('ignores companions and temp allies', () => {
    const c = partyCentroid([
      hero(0, 0),
      hero(2, 2),
      hero(50, 50, { companion: true }),
      hero(-50, -50, { temp: true }),
    ]);
    expect(c).toEqual({ x: 1, z: 1 });
  });

  it('returns null when nobody qualifies, so the caller can fall back', () => {
    expect(partyCentroid([])).toBeNull();
    expect(partyCentroid(null)).toBeNull();
    expect(partyCentroid([hero(1, 1, { data: { hp: 0 } })])).toBeNull();
    expect(partyCentroid([hero(1, 1, { companion: true })])).toBeNull();
  });

  it('survives malformed entries rather than returning NaN', () => {
    const c = partyCentroid([null, undefined, {}, hero(6, 6)]);
    expect(c).toEqual({ x: 6, z: 6 });
  });

  /* The regression this change exists for: monsters must not move the anchor. */
  it('is unaffected by how many enemies are on the field', () => {
    const party = [hero(10, 10), hero(12, 10)];
    expect(partyCentroid(party)).toEqual({ x: 11, z: 10 });
  });
});
