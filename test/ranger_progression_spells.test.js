import { describe, it, expect } from 'vitest';
import { makeHero } from '../src/game/srd.js';
import { applyLevelGrants, resolveChoice, syncMissingSpellChoices } from '../src/game/features.js';
import { SPELL_POOLS } from '../src/game/spells.js';

describe('Ranger Spell Progression', () => {
  it('grants spells at levels 2, 3, 5, 7, 9 reaching 6 spells known at level 10', () => {
    const ranger = makeHero('Alleria', 'elf', 'ranger', { str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 10 }, {});
    expect(ranger.knownSpells.length).toBe(0);

    // Level 2 grants 2 1st-level spells
    applyLevelGrants(ranger, 2, null, { autosOnly: false });
    const l2Choices = ranger.pendingChoices.filter(c => c.pick === 'spell');
    expect(l2Choices.length).toBe(2);
    resolveChoice(ranger, l2Choices[0].id, 'huntersMark');
    resolveChoice(ranger, l2Choices[1].id, 'entangle');
    expect(ranger.knownSpells).toContain('huntersMark');
    expect(ranger.knownSpells).toContain('entangle');

    // Level 3 grants 1 1st-level spell
    applyLevelGrants(ranger, 3, null, { autosOnly: false });
    const l3Choices = ranger.pendingChoices.filter(c => c.pick === 'spell');
    expect(l3Choices.length).toBe(1);
    resolveChoice(ranger, l3Choices[0].id, 'cureWounds');
    expect(ranger.knownSpells.length).toBe(3);

    // Level 4 is ASI
    applyLevelGrants(ranger, 4, null, { autosOnly: false });
    expect(ranger.pendingChoices.filter(c => c.pick === 'spell').length).toBe(0);

    // Level 5 grants 1 2nd-level spell
    applyLevelGrants(ranger, 5, null, { autosOnly: false });
    const l5Choices = ranger.pendingChoices.filter(c => c.pick === 'spell');
    expect(l5Choices.length).toBe(1);
    expect(l5Choices[0].tier).toBe(2);
    resolveChoice(ranger, l5Choices[0].id, 'barkskin');
    expect(ranger.knownSpells.length).toBe(4);

    // Level 7 grants 1 2nd-level spell
    applyLevelGrants(ranger, 7, null, { autosOnly: false });
    const l7Choices = ranger.pendingChoices.filter(c => c.pick === 'spell');
    expect(l7Choices.length).toBe(1);
    resolveChoice(ranger, l7Choices[0].id, 'silence');
    expect(ranger.knownSpells.length).toBe(5);

    // Level 9 grants 1 3rd-level spell
    applyLevelGrants(ranger, 9, null, { autosOnly: false });
    const l9Choices = ranger.pendingChoices.filter(c => c.pick === 'spell');
    expect(l9Choices.length).toBe(1);
    expect(l9Choices[0].tier).toBe(3);
    resolveChoice(ranger, l9Choices[0].id, 'callLightning');
    expect(ranger.knownSpells.length).toBe(6);
  });

  it('retroactively queues missing spell choices for an existing level 10 hero who only has 2 spells', () => {
    const ranger = makeHero('Strider', 'human', 'ranger', { str: 12, dex: 16, con: 14, int: 10, wis: 14, cha: 10 }, {});
    ranger.level = 10;
    ranger.knownSpells = ['huntersMark', 'cureWounds']; // only 2 spells from old table
    ranger.pendingChoices = [];

    syncMissingSpellChoices(ranger);

    const pendingSpells = ranger.pendingChoices.filter(c => c.pick === 'spell');
    // At level 10, total spell grants = 6, hero has 2, so 4 missing spell choices should be queued!
    expect(pendingSpells.length).toBe(4);

    // Resolving one adds it to knownSpells
    const choice1 = pendingSpells[0];
    const option = choice1.options[0];
    resolveChoice(ranger, choice1.id, option.key);
    expect(ranger.knownSpells.includes(option.key)).toBe(true);
    expect(ranger.knownSpells.length).toBe(3);
  });

  it('has valid spell pools for Ranger across tiers 1-5', () => {
    expect(SPELL_POOLS.ranger[1].length).toBeGreaterThanOrEqual(4);
    expect(SPELL_POOLS.ranger[2].length).toBeGreaterThanOrEqual(4);
    expect(SPELL_POOLS.ranger[3].length).toBeGreaterThanOrEqual(4);
    expect(SPELL_POOLS.ranger[4].length).toBeGreaterThanOrEqual(2);
    expect(SPELL_POOLS.ranger[5].length).toBeGreaterThanOrEqual(2);
  });
});
