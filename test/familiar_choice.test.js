import { describe, it, expect } from 'vitest';
import { makeHero } from '../src/game/srd.js';
import { seedNewHeroProgression, resolveChoice, migrateProgression, FAMILIAR_FORMS } from '../src/game/features.js';

const wiz = () => {
  const h = makeHero('W', 'human', 'wizard', { str: 8, dex: 14, con: 14, int: 16, wis: 10, cha: 10 }, {});
  seedNewHeroProgression(h);
  return h;
};
const famChoice = h => h.pendingChoices.find(c => c.pick === 'familiar');

describe('choosing a familiar', () => {
  it('is not offered to a wizard who has not learned Find Familiar', () => {
    const h = wiz();
    h.knownSpells = h.knownSpells.filter(k => k !== 'findFamiliar');
    migrateProgression(h);
    expect(famChoice(h)).toBeUndefined();
  });

  it('is queued the moment Find Familiar is learned, and fixed once picked', () => {
    const h = wiz();
    h.knownSpells = h.knownSpells.filter(k => k !== 'findFamiliar');
    h.pendingChoices.push({ type: 'choice', pick: 'spell', id: 't_spell', options: [{ key: 'findFamiliar', label: 'Find Familiar' }] });
    resolveChoice(h, 't_spell', 'findFamiliar');
    const c = famChoice(h);
    expect(c.options.map(o => o.key)).toEqual(Object.keys(FAMILIAR_FORMS));
    resolveChoice(h, c.id, 'impFamiliar');
    expect(h.familiarChoice).toBe('impFamiliar');
    migrateProgression(h);
    expect(famChoice(h)).toBeUndefined();
  });

  it('an old save that knows the spell but never chose is asked once', () => {
    const h = wiz();
    if (!h.knownSpells.includes('findFamiliar')) h.knownSpells.push('findFamiliar');
    delete h.familiarChoice;
    migrateProgression(h);
    migrateProgression(h);
    expect(h.pendingChoices.filter(c => c.pick === 'familiar').length).toBe(1);
  });
});
