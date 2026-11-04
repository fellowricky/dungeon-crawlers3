import { describe, it, expect } from 'vitest';
import { makeHero, spendSkillPoint, normalizeHero, grantXp, XP_TABLE } from '../src/game/srd.js';
import { applyLevelGrants, CLASS_PROGRESSION, levelGrantsTalent } from '../src/game/features.js';

describe('Talent Point Progression', () => {
  it('grants 1 talent point at level 1 upon hero creation', () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});

    expect(hero.level).toBe(1);
    expect(hero.pendingSkill).toBe(1);
  });

  it('grants talent points on odd levels and on even levels with no choice (fighter L2/L6)', () => {
    const hero = makeHero('Valeros', 'human', 'fighter',
      { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, {});

    expect(hero.pendingSkill).toBe(1);

    // Level 2: Action Surge is automatic, no choice — talent point fills the gap
    applyLevelGrants(hero, 2);
    expect(hero.pendingSkill).toBe(2);

    // Level 3 (odd)
    applyLevelGrants(hero, 3);
    expect(hero.pendingSkill).toBe(3);

    // Level 4: ASI/feat choice — no talent point
    applyLevelGrants(hero, 4);
    expect(hero.pendingSkill).toBe(3);

    // Level 5 (odd)
    applyLevelGrants(hero, 5);
    expect(hero.pendingSkill).toBe(4);

    // Level 6: only a silent subclass milestone — talent point
    applyLevelGrants(hero, 6);
    expect(hero.pendingSkill).toBe(5);
  });

  it('does not add an even-level talent point when the class already gets a choice there', () => {
    const wiz = makeHero('Ezren', 'human', 'wizard',
      { str: 8, dex: 12, con: 14, int: 16, wis: 10, cha: 10 }, {});
    expect(wiz.pendingSkill).toBe(1);
    applyLevelGrants(wiz, 2);   // wizard picks a spell at L2
    expect(wiz.pendingSkill).toBe(1);

    const bard = makeHero('Lem', 'human', 'bard',
      { str: 8, dex: 12, con: 14, int: 10, wis: 10, cha: 16 }, {});
    for (let lv = 2; lv <= 6; lv++) applyLevelGrants(bard, lv);
    // Bard: L1, L3, L5 only — L2/L4/L6 all carry spell picks
    expect(bard.pendingSkill).toBe(3);
  });

  it('every class has a choice or a talent point at every level 1-20', () => {
    for (const classKey of Object.keys(CLASS_PROGRESSION)) {
      for (let lv = 1; lv <= 20; lv++) {
        const grants = CLASS_PROGRESSION[classKey][lv] || [];
        const hasChoice = grants.some(g => g.type === 'choice' || g.type === 'subclass');
        expect(hasChoice || levelGrantsTalent(classKey, lv), `${classKey} L${lv}`).toBe(true);
      }
    }
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
    // Rogue L3: Lv 1, Lv 2 (Cunning Action is automatic, no choice), Lv 3
    expect(legacyHero.pendingSkill).toBe(3);
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
    // Fighter Lv 5 earns 4 (L1, L2, L3, L5). 1 is already spent, so 3 pending.
    expect(legacyHero.skills.weaponMaster).toBe(1);
    expect(legacyHero.pendingSkill).toBe(3);
  });
});
