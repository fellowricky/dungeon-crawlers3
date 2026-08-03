import { describe, it, expect } from 'vitest';
import { PERKS, perkDescFor } from '../src/game/items.js';

describe('Legendary Affixes: Spell Effects On Hit', () => {
  it('registers arcaneBurst, frostBite, and holySmite legendary perks', () => {
    expect(PERKS.arcaneBurst).toBeDefined();
    expect(PERKS.frostBite).toBeDefined();
    expect(PERKS.holySmite).toBeDefined();

    expect(perkDescFor('arcaneBurst', 10)).toContain('force damage');
    expect(perkDescFor('frostBite', 10)).toContain('chill');
    expect(perkDescFor('holySmite', 10)).toContain('radiant damage');
  });
});
