import { describe, it, expect } from 'vitest';
import { applyEffect, clearEffect, hasEffect, getEffectMods, EFFECTS } from '../src/game/conditions.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';

describe('Enlarged Status Effect & Sprite Scaling', () => {
  it('enlarged condition is registered with correct stats (+25% dmg, +2 dmg)', () => {
    expect(EFFECTS.enlarged).toBeDefined();
    expect(EFFECTS.enlarged.dmgMul).toBe(1.25);
    expect(EFFECTS.enlarged.dmgBonus).toBe(2);

    const dummy = { data: { type: 'humanoid' } };
    applyEffect(dummy, 'enlarged', { duration: 60, elapsed: 0 });
    expect(hasEffect(dummy, 'enlarged')).toBe(true);

    const mods = getEffectMods(dummy);
    expect(mods.dmgDealtMul).toBe(1.25);
    expect(mods.dmgBonus).toBe(2);
  });

  it('monster visuals scale sprite by 50% (1.5x) when enlarged, and restore to 1.0x when effect clears', () => {
    const scaleObj = {
      x: 1.0, y: 1.0, z: 1.0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    };
    const monster = {
      x: 10,
      z: 10,
      data: { hp: 50, name: 'Duergar' },
      ent: {
        grp: {
          position: { set: () => {} },
          rotation: { y: 0 },
          scale: scaleObj
        },
        anim: {
          setDirection: () => {},
          update: () => {},
          mesh: { position: { y: 0 } }
        }
      }
    };

    const game = Object.assign({}, monsterAiMethods, {
      monsters: [monster],
      lungeOffset: () => [0, 0]
    });

    // Initial tick: no enlarged effect -> scale remains 1.0
    game.updateMonsterVisuals(0.016, 0, 1, 0);
    expect(monster.ent.grp.scale.x).toBe(1.0);

    // Apply enlarged
    applyEffect(monster, 'enlarged', { duration: 60, elapsed: 0 });

    // After updating over 1 second, scale should reach 1.5 (+50%)
    for (let i = 0; i < 60; i++) {
      game.updateMonsterVisuals(0.016, i * 0.016, 1, 0);
    }
    expect(monster.ent.grp.scale.x).toBeCloseTo(1.5, 2);
    expect(monster.ent.grp.scale.y).toBeCloseTo(1.5, 2);
    expect(monster.ent.grp.scale.z).toBeCloseTo(1.5, 2);

    // Remove enlarged
    clearEffect(monster, 'enlarged');

    // After updating over 1 second, scale should smoothly return to 1.0
    for (let i = 0; i < 60; i++) {
      game.updateMonsterVisuals(0.016, (60 + i) * 0.016, 1, 0);
    }
    expect(monster.ent.grp.scale.x).toBeCloseTo(1.0, 2);
    expect(monster.ent.grp.scale.y).toBeCloseTo(1.0, 2);
    expect(monster.ent.grp.scale.z).toBeCloseTo(1.0, 2);
  });

  it('enlargeReduce spell exists, concentrates, and applies enlarged condition to an ally', () => {
    expect(SPELLS.enlargeReduce).toBeDefined();
    expect(SPELLS.enlargeReduce.level).toBe(2);
    expect(SPELLS.enlargeReduce.concentration).toBe(true);
    expect(SPELL_POOLS.wizard[2]).toContain('enlargeReduce');
    expect(SPELL_POOLS.sorcerer[2]).toContain('enlargeReduce');

    const heroCaster = {
      data: { name: 'Mage', classKey: 'wizard', hp: 30, maxHp: 30 },
      x: 0, z: 0
    };
    const heroTarget = {
      data: { name: 'Fighter', classKey: 'fighter', hp: 50, maxHp: 50 },
      x: 1, z: 1
    };

    let concentratedSpell = null;
    const mockGame = {
      fxNow: 12,
      markSpellUsed: () => {},
      concentrate: (caster, spellKey) => { concentratedSpell = spellKey; },
      playAbilityFx: () => {},
      fxLog: () => {}
    };

    const castSuccess = SPELLS.enlargeReduce.cast(mockGame, heroCaster, null, [heroCaster, heroTarget]);
    expect(castSuccess).toBe(true);
    expect(hasEffect(heroTarget, 'enlarged')).toBe(true);
    expect(concentratedSpell).toBe('enlargeReduce');
  });
});
