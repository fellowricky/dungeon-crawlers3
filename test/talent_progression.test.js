import { describe, it, expect } from 'vitest';
import { makeHero, spendSkillPoint, normalizeHero, grantXp, XP_TABLE } from '../src/game/srd.js';
import { applyLevelGrants } from '../src/game/features.js';

describe('Talent Point Progression', () => {
  it('grants 1 talent point at level 1 upon hero creation', () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});

    expect(hero.level).toBe(1);
    expect(hero.pendingSkill).toBe(1);
  });

  it('grants talent points on odd levels (Lv 3, Lv 5) but not on even levels (Lv 2, Lv 4)', () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});

    expect(hero.pendingSkill).toBe(1);

    // Level 2 (even)
    applyLevelGrants(hero, 2);
    expect(hero.pendingSkill).toBe(1);

    // Level 3 (odd)
    applyLevelGrants(hero, 3);
    expect(hero.pendingSkill).toBe(2);

    // Level 4 (even)
    applyLevelGrants(hero, 4);
    expect(hero.pendingSkill).toBe(2);

    // Level 5 (odd)
    applyLevelGrants(hero, 5);
    expect(hero.pendingSkill).toBe(3);
  });

  it('allows spending talent points and recalculates combat bonuses', () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});

    expect(hero.pendingSkill).toBe(1);
    const initialAtk = hero.atkBonus;

    // Fighter talent 'weaponMaster' grants +1 atk
    const success = spendSkillPoint(hero, 'weaponMaster');
    expect(success).toBe(true);
    expect(hero.pendingSkill).toBe(0);
    expect(hero.skills.weaponMaster).toBe(1);
    expect(hero.atkBonus).toBe(initialAtk + 1);

    // Cannot spend without points
    expect(spendSkillPoint(hero, 'weaponMaster')).toBe(false);
  });

  it('backfills talent points in normalizeHero for older saves', () => {
    // Simulate an old save of a level 3 hero with 0 talent points and 0 spent
    const legacyHero = {
      name: 'OldHero',
      raceKey: 'human',
      classKey: 'rogue',
      level: 3,
      stats: { str: 10, dex: 16, con: 12, int: 14, wis: 10, cha: 10 },
      equipment: {},
      skills: {},
      pendingSkill: 0
    };

    normalizeHero(legacyHero);
    // Level 3 should have 2 talent points (1 from Lv 1, 1 from Lv 3)
    expect(legacyHero.pendingSkill).toBe(2);
  });

  it('respects already-spent talent points during backfill in normalizeHero', () => {
    // Level 5 hero who had spent 1 talent and had 0 pending
    const legacyHero = {
      name: 'OldHero5',
      raceKey: 'human',
      classKey: 'fighter',
      level: 5,
      stats: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      equipment: {},
      skills: { weaponMaster: 1 },
      pendingSkill: 0
    };

    normalizeHero(legacyHero);
    // Total expected for Lv 5 is 3. 1 is already spent, so 2 pending.
    expect(legacyHero.skills.weaponMaster).toBe(1);
    expect(legacyHero.pendingSkill).toBe(2);
  });
});
