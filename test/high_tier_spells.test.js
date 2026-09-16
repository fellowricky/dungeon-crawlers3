import { describe, it, expect } from 'vitest';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';
import { CLASS_PROGRESSION, applyLevelGrants, resolveChoice } from '../src/game/features.js';
import { makeHero } from '../src/game/srd.js';

describe('High-Tier Spells (6th-9th) & Expanded Spell Catalog', () => {
  it('registers all 6th-9th level spells with valid metadata', () => {
    const tier6 = ['disintegrate', 'chainLightning', 'heal', 'sunbeam', 'harm'];
    const tier7 = ['fingerOfDeath', 'fireStorm', 'regenerate', 'prismaticSpray'];
    const tier8 = ['sunburst', 'earthquake', 'mindBlank', 'dominateMonster'];
    const tier9 = ['meteorSwarm', 'timeStop', 'powerWordKill', 'massHeal', 'wish'];

    for (const key of tier6) {
      expect(SPELLS[key]).toBeDefined();
      expect(SPELLS[key].level).toBe(6);
      expect(typeof SPELLS[key].cast).toBe('function');
    }
    for (const key of tier7) {
      expect(SPELLS[key]).toBeDefined();
      expect(SPELLS[key].level).toBe(7);
      expect(typeof SPELLS[key].cast).toBe('function');
    }
    for (const key of tier8) {
      expect(SPELLS[key]).toBeDefined();
      expect(SPELLS[key].level).toBe(8);
      expect(typeof SPELLS[key].cast).toBe('function');
    }
    for (const key of tier9) {
      expect(SPELLS[key]).toBeDefined();
      expect(SPELLS[key].level).toBe(9);
      expect(typeof SPELLS[key].cast).toBe('function');
    }
  });

  it('registers lower-tier iconic specials', () => {
    const specials = ['spikeGrowth', 'passWithoutTrace', 'crusadersMantle', 'banishment', 'steelWindStrike'];
    for (const k of specials) {
      expect(SPELLS[k]).toBeDefined();
      expect(typeof SPELLS[k].cast).toBe('function');
    }
    expect(SPELLS.spikeGrowth.level).toBe(2);
    expect(SPELLS.passWithoutTrace.level).toBe(2);
    expect(SPELLS.crusadersMantle.level).toBe(3);
    expect(SPELLS.banishment.level).toBe(4);
    expect(SPELLS.steelWindStrike.level).toBe(5);
  });

  it('supports Wizard learning 6th through 9th level spells at high levels', () => {
    const wiz = makeHero('Mordenkainen', 'human', 'wizard', { str: 10, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }, {});
    
    // Level 11 -> 6th-level spell
    applyLevelGrants(wiz, 11, null, { autosOnly: false });
    const l11Choice = wiz.pendingChoices.find(c => c.pick === 'spell' && c.tier === 6);
    expect(l11Choice).toBeDefined();
    expect(l11Choice.options.some(o => o.key === 'disintegrate')).toBe(true);
    expect(l11Choice.options.some(o => o.key === 'chainLightning')).toBe(true);
    resolveChoice(wiz, l11Choice.id, 'disintegrate');
    expect(wiz.knownSpells).toContain('disintegrate');

    // Level 13 -> 7th-level spell
    applyLevelGrants(wiz, 13, null, { autosOnly: false });
    const l13Choice = wiz.pendingChoices.find(c => c.pick === 'spell' && c.tier === 7);
    expect(l13Choice).toBeDefined();
    expect(l13Choice.options.some(o => o.key === 'prismaticSpray')).toBe(true);
    resolveChoice(wiz, l13Choice.id, 'prismaticSpray');
    expect(wiz.knownSpells).toContain('prismaticSpray');

    // Level 15 -> 8th-level spell
    applyLevelGrants(wiz, 15, null, { autosOnly: false });
    const l15Choice = wiz.pendingChoices.find(c => c.pick === 'spell' && c.tier === 8);
    expect(l15Choice).toBeDefined();
    expect(l15Choice.options.some(o => o.key === 'sunburst')).toBe(true);
    resolveChoice(wiz, l15Choice.id, 'sunburst');
    expect(wiz.knownSpells).toContain('sunburst');

    // Level 17 -> 9th-level spell
    applyLevelGrants(wiz, 17, null, { autosOnly: false });
    const l17Choice = wiz.pendingChoices.find(c => c.pick === 'spell' && c.tier === 9);
    expect(l17Choice).toBeDefined();
    expect(l17Choice.options.some(o => o.key === 'meteorSwarm')).toBe(true);
    expect(l17Choice.options.some(o => o.key === 'wish')).toBe(true);
    resolveChoice(wiz, l17Choice.id, 'meteorSwarm');
    expect(wiz.knownSpells).toContain('meteorSwarm');
  });

  it('supports Cleric learning 6th through 9th level prayers', () => {
    const cleric = makeHero('Kyra', 'human', 'cleric', { str: 14, dex: 10, con: 14, int: 10, wis: 18, cha: 12 }, {});
    
    // Level 11 -> 6th-level prayer (Heal/Harm/Sunbeam)
    applyLevelGrants(cleric, 11, null, { autosOnly: false });
    const l11Choice = cleric.pendingChoices.find(c => c.pick === 'spell' && c.tier === 6);
    expect(l11Choice).toBeDefined();
    expect(l11Choice.options.some(o => o.key === 'heal')).toBe(true);
    resolveChoice(cleric, l11Choice.id, 'heal');
    expect(cleric.knownSpells).toContain('heal');

    // Level 17 -> 9th-level prayer (Mass Heal)
    applyLevelGrants(cleric, 17, null, { autosOnly: false });
    const l17Choice = cleric.pendingChoices.find(c => c.pick === 'spell' && c.tier === 9);
    expect(l17Choice).toBeDefined();
    expect(l17Choice.options.some(o => o.key === 'massHeal')).toBe(true);
    resolveChoice(cleric, l17Choice.id, 'massHeal');
    expect(cleric.knownSpells).toContain('massHeal');
  });

  it('populates valid spell pools across tiers 6-9 for all full casters', () => {
    const fullCasters = ['wizard', 'sorcerer', 'cleric', 'druid', 'bard', 'warlock'];
    for (const cls of fullCasters) {
      expect(SPELL_POOLS[cls][6].length).toBeGreaterThanOrEqual(1);
      expect(SPELL_POOLS[cls][7].length).toBeGreaterThanOrEqual(1);
      expect(SPELL_POOLS[cls][8].length).toBeGreaterThanOrEqual(1);
      expect(SPELL_POOLS[cls][9].length).toBeGreaterThanOrEqual(1);
    }
  });

  it('provides a dedicated, non-default icon in ABILITY_ICON for every spell in SPELLS', async () => {
    const { ABILITY_ICON } = await import('../src/game/ui.js');
    for (const spellKey of Object.keys(SPELLS)) {
      const icon = ABILITY_ICON[spellKey];
      expect(icon, `Spell ${spellKey} should have a dedicated icon in ABILITY_ICON`).toBeDefined();
      expect(icon).not.toBe('★');
    }
  });
});
