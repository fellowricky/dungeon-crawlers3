import { describe, it, expect } from 'vitest';
import { makeHero, recalc, WILD_SHAPE_FORMS, pickAttackProfile } from '../src/game/srd.js';
import { combatMethods, getAvailableAttackOptions } from '../src/game/combat.js';

describe('Druid Wild Shape Mechanics', () => {
  function druid() {
    const stats = { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 8 };
    return makeHero('TestDruid', 'human', 'druid', stats);
  }

  it('should seed Wild Shape form choice at level 1 for Druid', () => {
    const d = druid();
    expect(d.pendingChoices).toBeDefined();
    const wsChoice = d.pendingChoices.find(c => c.pick === 'wildShapeForm');
    expect(wsChoice).toBeDefined();
    expect(wsChoice.options.length).toBe(3); // Bear, Wolf, Eagle
  });

  it('should apply Bear Form stat bonuses when active in recalc', () => {
    const d = druid();
    const baseCon = d.effStats.con;
    const baseStr = d.effStats.str;
    const baseAc = d.ac;
    d.wildShapeActiveForm = 'bear';
    d.inWildShape = true;
    recalc(d);
    expect(d.effStats.con).toBe(baseCon + 4);
    expect(d.effStats.str).toBe(baseStr + 2);
    expect(d.ac).toBeGreaterThanOrEqual(baseAc + 2);
  });

  it('should apply Wolf Form crit bonus when active in recalc', () => {
    const d = druid();
    const baseCrit = d.critRange;
    d.wildShapeActiveForm = 'wolf';
    d.inWildShape = true;
    recalc(d);
    expect(d.critRange).toBeLessThan(baseCrit);
  });

  it('should apply Eagle Form speed bonus when active in recalc', () => {
    const d = druid();
    const baseSpeed = d.speedMult;
    d.wildShapeActiveForm = 'eagle';
    d.inWildShape = true;
    recalc(d);
    expect(d.speedMult).toBeGreaterThan(baseSpeed);
  });

  it('should not apply Wild Shape bonuses when not in Wild Shape', () => {
    const d = druid();
    const baseAc = d.ac;
    const baseCrit = d.critRange;
    d.wildShapeActiveForm = 'bear';
    d.inWildShape = false;
    recalc(d);
    expect(d.ac).toBe(baseAc);
    expect(d.critRange).toBe(baseCrit);
  });

  it('should export all three forms in WILD_SHAPE_FORMS', () => {
    expect(WILD_SHAPE_FORMS.bear).toBeDefined();
    expect(WILD_SHAPE_FORMS.wolf).toBeDefined();
    expect(WILD_SHAPE_FORMS.eagle).toBeDefined();
    expect(Object.keys(WILD_SHAPE_FORMS).length).toBe(3);
  });

  it('should compute HP pools from form formulas', () => {
    const bear = WILD_SHAPE_FORMS.bear;
    const wolf = WILD_SHAPE_FORMS.wolf;
    const eagle = WILD_SHAPE_FORMS.eagle;
    expect(bear.hpFormula(5, 2)).toBe(25 + 30 + 4);  // 59
    expect(wolf.hpFormula(5, 2)).toBe(18 + 25 + 4);   // 47
    expect(eagle.hpFormula(5, 2)).toBe(14 + 20 + 4);  // 38
  });

  it('should restrict pickAttackProfile to beast melee attacks while in Wild Shape', () => {
    const d = druid();
    d.cantripProfile = { name: 'Thorn Whip', range: 6, cantripScale: true };
    d.weaponProfile = { name: 'Quarterstaff', dmg: [1, 6], melee: true };
    d.inWildShape = true;
    d.wildShapeActiveForm = 'bear';

    const profile = pickAttackProfile(d);
    expect(profile.source).toBe('wildShape');
    expect(profile.melee).toBe(true);
    expect(profile.name).toContain('Bear Form Claws');
    expect(profile.cantripScale).toBe(false);
  });

  it('should block spellcasting while in Wild Shape', () => {
    const d = druid();
    d.inWildShape = true;
    d.knownSpells = ['entangle', 'cureWounds'];
    d.slots = { 1: 3 };

    const heroObj = { data: d };
    const game = Object.assign({}, combatMethods, {
      canUseSpellRecharge: () => true
    });

    expect(game._pickKnownSpell(heroObj, null, [], () => true)).toBeNull();
    expect(game.tryCastKnownSpell(heroObj, null, [])).toBe(false);
    expect(game.tryCastBonusSpell(heroObj, null, [])).toBe(false);
    expect(game.resolveSpell(heroObj, 'entangle', null, [])).toBe(false);
  });

  it('should restrict getAvailableAttackOptions to wildshape attack when transformed', () => {
    const d = druid();
    d.inWildShape = true;
    d.wildShapeActiveForm = 'wolf';
    d.cantripProfile = { name: 'Thorn Whip' };
    d.weaponProfile = { name: 'Dagger', thrown: true };

    const opts = getAvailableAttackOptions({ data: d });
    expect(opts.length).toBe(1);
    expect(opts[0].key).toBe('wildshape_attack');
    expect(opts[0].label).toContain('Wolf Form Bite');
  });
});
