import { describe, it, expect } from 'vitest';
import { gearProficiencies, canEquip } from '../src/game/srd.js';

describe('gear proficiencies shown on the skills tab', () => {
  it('follows the class baseline', () => {
    const fighter = gearProficiencies({ classKey: 'fighter', feats: [] });
    expect(fighter.armor).toEqual({ light: true, medium: true, heavy: true });
    expect(fighter.shields).toBe(true);
    expect(fighter.weapons.martial).toBe(true);
    const wizard = gearProficiencies({ classKey: 'wizard', feats: [] });
    expect(wizard.armor).toEqual({ light: false, medium: false, heavy: false });
    expect(wizard.shields).toBe(false);
    expect(wizard.weapons.martial).toBe(false);
  });

  it('lists the named weapons a non-martial class may use anyway', () => {
    expect(gearProficiencies({ classKey: 'rogue', feats: [] }).specific).toEqual(expect.arrayContaining(['Rapier']));
  });

  it('feats raise it, and are marked as the source', () => {
    const w = gearProficiencies({ classKey: 'wizard', feats: ['moderatelyArmored', 'martialTraining'] });
    expect(w.armor).toEqual({ light: true, medium: true, heavy: false });
    expect(w.shields).toBe(true);
    expect(w.weapons.martial).toBe(true);
    expect(w.fromFeat).toMatchObject({ light: true, medium: true, heavy: false, shields: true, martial: true });
  });

  it('agrees with what canEquip actually allows', () => {
    for (const cls of ['fighter', 'wizard', 'cleric', 'rogue', 'ranger', 'druid']) {
      const h = { classKey: cls, feats: [] };
      const gp = gearProficiencies(h);
      for (const [prof, ok] of [['light', gp.armor.light], ['medium', gp.armor.medium], ['heavy', gp.armor.heavy]]) {
        expect(canEquip(h, { slot: 'armor', prof }), `${cls} ${prof}`).toBe(ok);
      }
      expect(canEquip(h, { slot: 'shield' }), `${cls} shield`).toBe(gp.shields);
      expect(canEquip(h, { slot: 'weapon', weaponType: 'martial', baseKey: 'Greataxe' }), `${cls} martial`).toBe(gp.weapons.martial);
    }
  });
});
