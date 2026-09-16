import { describe, it, expect, vi } from 'vitest';
import { SPELLS } from '../src/game/spells.js';
import { hasEffect, EFFECTS } from '../src/game/conditions.js';

const NEW = ['dominatePerson', 'forcecage', 'foresight', 'powerWordHeal',
             'stormOfVengeance', 'trueResurrection'];

function stub({ saveSucceeds = false } = {}) {
  const mob = (name, hp = 60) => ({
    x: 4, z: 0, dead: false, active: true,
    data: { name, hp, maxHp: 60, scale: 1, level: 10, effStats: { wis: 10 } }
  });
  const ally = (name, hp) => ({
    x: 0, z: 0, dead: hp <= 0,
    data: { name, hp, maxHp: 50, level: 10, dmgBonus: 0, weaponProfile: {} }
  });
  const caster = { x: 0, z: 0, data: { name: 'Caster', level: 17, hp: 40, maxHp: 40,
    dmgBonus: 0, effStats: { cha: 18, int: 18, wis: 18 }, atkProf: 6 } };

  const game = {
    fxNow: 0,
    monsters: [mob('Goblin'), mob('Ogre')],
    heroes: [caster, ally('Fighter', 5), ally('Rogue', 0)],
    markSpellUsed: vi.fn(),
    playAbilityFx: vi.fn(),
    fxLog: vi.fn(),
    fxText: vi.fn(),
    fxSlash: vi.fn(),
    spellDamage: vi.fn((t, amt) => { t.data.hp = Math.max(0, t.data.hp - amt); }),
    spellSave: vi.fn(() => saveSucceeds),
    concentrate: vi.fn(),
    _reviveHeroPose: vi.fn(),
    _v3: (x, y, z) => ({ x, y, z }),
  };
  return { game, caster };
}

describe('the new high-tier spells', () => {
  it('are all registered with a level, a description and a cast body', () => {
    for (const k of NEW) {
      const sp = SPELLS[k];
      expect(sp, k).toBeDefined();
      expect(sp.level).toBeGreaterThanOrEqual(5);
      expect(typeof sp.cast).toBe('function');
      expect(sp.desc.length).toBeGreaterThan(10);
      expect(sp.key).toBe(k);
    }
  });

  it('all run to completion and spend their slot', () => {
    for (const k of NEW) {
      const { game, caster } = stub();
      const foe = game.monsters[0];
      expect(() => SPELLS[k].cast(game, caster, foe), k).not.toThrow();
      expect(game.markSpellUsed, k).toHaveBeenCalled();
    }
  });

  it('Dominate Person charms a foe that fails its save, and nothing on a save', () => {
    const { game, caster } = stub({ saveSucceeds: false });
    SPELLS.dominatePerson.cast(game, caster, game.monsters[0]);
    expect(hasEffect(game.monsters[0], 'charmed')).toBe(true);
    expect(game.concentrate).toHaveBeenCalled();

    const saved = stub({ saveSucceeds: true });
    SPELLS.dominatePerson.cast(saved.game, saved.caster, saved.game.monsters[0]);
    expect(hasEffect(saved.game.monsters[0], 'charmed')).toBe(false);
  });

  it('Forcecage restrains with no saving throw at all', () => {
    const { game, caster } = stub({ saveSucceeds: true });
    SPELLS.forcecage.cast(game, caster, game.monsters[0]);
    expect(game.spellSave).not.toHaveBeenCalled();
    expect(hasEffect(game.monsters[0], 'restrained')).toBe(true);
  });

  it('Foresight buffs an ally with a real, registered condition', () => {
    expect(EFFECTS.foresight).toBeDefined();
    expect(EFFECTS.foresight.atkAdvantage).toBe(1);
    /* must persist — not be eaten by the first swing like Bardic Inspiration */
    expect(EFFECTS.foresight.consumeOnAttack).toBeFalsy();

    const { game, caster } = stub();
    SPELLS.foresight.cast(game, caster);
    expect(game.heroes.some(a => hasEffect(a, 'foresight'))).toBe(true);
  });

  it('Power Word Heal fully restores the worst-off ally, downed included', () => {
    const { game, caster } = stub();
    const downed = game.heroes[2];
    SPELLS.powerWordHeal.cast(game, caster);
    expect(downed.data.hp).toBe(downed.data.maxHp);
    expect(game._reviveHeroPose).toHaveBeenCalled();
  });

  it('Storm of Vengeance hits every enemy on the field', () => {
    const { game, caster } = stub();
    SPELLS.stormOfVengeance.cast(game, caster);
    const hit = new Set(game.spellDamage.mock.calls.map(c => c[0]));
    expect(hit.size).toBe(game.monsters.length);
  });

  it('True Resurrection prefers the dead over the merely wounded', () => {
    const { game, caster } = stub();
    const downed = game.heroes[2];
    const wounded = game.heroes[1];
    SPELLS.trueResurrection.cast(game, caster);
    expect(downed.data.hp).toBe(downed.data.maxHp);
    expect(wounded.data.hp).toBe(5);            /* untouched */
    expect(game._reviveHeroPose).toHaveBeenCalled();
  });
});
