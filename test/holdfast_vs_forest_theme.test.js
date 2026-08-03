import { describe, it, expect } from 'vitest';
import { THEMES } from '../src/dungeon/dungeon_generator.js';

describe('Overland Maps: Holdfast and Forest Visual Differentiation', () => {
  it('differentiates holdfast (fortified stockade/masonry) from forest (wild woodland)', () => {
    const forest = THEMES.forest;
    const holdfast = THEMES.holdfast;

    expect(forest).toBeDefined();
    expect(holdfast).toBeDefined();

    // Forest uses tree canopy blockers by default (blockerGeo is not 'block')
    expect(forest.blockerGeo).not.toBe('block');

    // Holdfast uses stockade/masonry block geometry (blockerGeo: 'block')
    expect(holdfast.blockerGeo).toBe('block');
    expect(holdfast.blockerH).toBeDefined();

    // Distinct accents and floor/wall palette colors
    expect(holdfast.accent).not.toBe(forest.accent);
    expect(holdfast.wall).not.toBe(forest.wall);
  });
});
