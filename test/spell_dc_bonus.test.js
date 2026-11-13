import { describe, it, expect } from 'vitest';
import { makeHero, recalc, CLASSES } from '../src/game/srd.js';
import { spellDC } from '../src/game/spells.js';

const STATS = { str: 10, dex: 12, con: 12, int: 16, wis: 14, cha: 16 };
const dcOf = (d) => spellDC({ data: d });
const node = (cls, key) => CLASSES[cls].skills.find((s) => s.key === key);

describe('caster accuracy is the spell save DC, not attack rolls', () => {
  it('the Wizard, Sorcerer and Warlock nodes are +1 spell save DC per rank, 3 ranks', () => {
    for (const [cls, key] of [['wizard', 'focused'], ['sorcerer', 'sorcerousAtk'], ['warlock', 'dreadAtk']]) {
      const s = node(cls, key);
      expect(s.max, key).toBe(3);
      expect(s.b, key).toEqual({ spellDC: 1 });
    }
  });

  it('ranks raise the DC and leave attack rolls alone', () => {
    const h = makeHero('W', 'human', 'wizard', STATS);
    recalc(h);
    const dc0 = dcOf(h), atk0 = h.atkProf;
    h.skills = { ...(h.skills || {}), focused: 3 };
    recalc(h);
    expect(dcOf(h)).toBe(dc0 + 3);
    expect(h.atkProf).toBe(atk0);
  });

  it('a save made before the cap came down gets its extra ranks back as points', () => {
    const h = makeHero('S', 'human', 'sorcerer', STATS);
    h.skills = { ...(h.skills || {}), sorcerousAtk: 5 };
    h.pendingSkill = 0;
    recalc(h);
    expect(h.skills.sorcerousAtk).toBe(3);
    expect(h.pendingSkill).toBe(2);
    recalc(h);                                  // only refunds once
    expect(h.pendingSkill).toBe(2);
  });

  it('Land druid and Wild Magic sorcerer passives give +1 spell save DC', () => {
    for (const [cls, sub] of [['druid', 'land'], ['sorcerer', 'wildmagic']]) {
      const h = makeHero('P', 'human', cls, STATS);
      recalc(h);
      const dc0 = dcOf(h);
      h.subclass = sub;
      recalc(h);
      expect(dcOf(h), sub).toBe(dc0 + 1);
    }
  });
});
