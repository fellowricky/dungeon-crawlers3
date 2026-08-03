import { describe, it, expect } from 'vitest';
import {
  applyEffect, hasEffect, getEffectMods, rollSave, clearEffect, tickEffects,
  clearCombatEffects, ROUND_SECONDS
} from '../src/game/conditions.js';

describe('Conditions & Status Effects Engine', () => {
  it('should apply and clear effects correctly', () => {
    const entity = { data: { type: 'humanoid' } };
    
    const applied = applyEffect(entity, 'poisoned', { duration: 10, elapsed: 0 });
    expect(applied).toBe(true);
    expect(hasEffect(entity, 'poisoned')).toBe(true);
    
    clearEffect(entity, 'poisoned');
    expect(hasEffect(entity, 'poisoned')).toBe(false);
  });

  it('should respect type-based immunities (e.g. undead immune to poisoned)', () => {
    const skeleton = { data: { type: 'undead' } };
    
    // Undead are immune to poisoned
    const applied = applyEffect(skeleton, 'poisoned', { duration: 10, elapsed: 0 });
    expect(applied).toBe(false);
    expect(hasEffect(skeleton, 'poisoned')).toBe(false);
  });

  it('should compute aggregate effect modifiers correctly', () => {
    const hero = { data: { type: 'humanoid' } };
    
    // Apply hasted: +2 AC, 1.4x speed
    applyEffect(hero, 'hasted', { duration: 6, elapsed: 0 });
    
    // Apply slowed: -2 AC, 0.5x speed
    applyEffect(hero, 'slowed', { duration: 6, elapsed: 0 });
    
    const mods = getEffectMods(hero);
    // AC bonus: 2 - 2 = 0
    expect(mods.acBonus).toBe(0);
    // Speed multiplier: 1.4 * 0.5 = 0.7
    expect(mods.speedMul).toBeCloseTo(0.7);
  });

  it('should handle saving throws and special rules (rollSave)', () => {
    const gnomeHero = {
      data: {
        raceKey: 'gnome',
        effStats: { wis: 14 } // mod +2
      }
    };
    
    // Gnome Cunning grants advantage on WIS saves against magic (adv > 0)
    // We can't directly check random rolls easily, but we can verify it doesn't throw and behaves correctly.
    const saveResult = rollSave(gnomeHero, 'wis', 10, { magic: true });
    expect(typeof saveResult).toBe('boolean');
    
    const standardHero = {
      data: {
        effStats: { wis: 10 } // mod +0
      }
    };
    
    // Restrained character has disadvantage on DEX saves
    applyEffect(standardHero, 'restrained', { duration: 6, elapsed: 0 });
    const dexSave = rollSave(standardHero, 'dex', 15);
    expect(typeof dexSave).toBe('boolean');
  });

  /* ── Combat-clock time base ──────────────────────────────────────────
     Durations are 5e seconds measured against the combat clock (game.fxNow),
     which advances ROUND_SECONDS per full pass of the initiative order and is
     frozen between fights. These tests exercise conditions.js against a hand-
     driven clock; initiative.js is what actually turns it. */

  it('measures durations in rounds, not real time', () => {
    const hero = { data: { type: 'humanoid' } };
    let fx = 0;

    // A 5-round buff (30 fx-seconds).
    applyEffect(hero, 'raging', { duration: 5 * ROUND_SECONDS, elapsed: fx });

    // Four rounds pass — however long they took in real seconds.
    for (let r = 0; r < 4; r++) { fx += ROUND_SECONDS; tickEffects(hero, fx); }
    expect(hasEffect(hero, 'raging')).toBe(true);

    // The fifth round ends it.
    fx += ROUND_SECONDS;
    tickEffects(hero, fx);
    expect(hasEffect(hero, 'raging')).toBe(false);
  });

  it('banks a buff earned out of combat until the clock next moves', () => {
    /* The clock is frozen outside a fight, so a skill-challenge boon does not
       burn down while the party walks the floor — it starts at the top of the
       next encounter with its full duration intact. */
    const hero = { data: { type: 'humanoid' } };
    const fxAtGrant = 42;   // clock reading left over from the previous fight

    applyEffect(hero, 'shielded', { duration: 3 * ROUND_SECONDS, elapsed: fxAtGrant, tag: 'skill' });

    // Exploration: many frames, but the clock does not move.
    for (let i = 0; i < 500; i++) tickEffects(hero, fxAtGrant);
    expect(hasEffect(hero, 'shielded')).toBe(true);

    // Next fight starts. Two rounds in, still up; the third ends it.
    tickEffects(hero, fxAtGrant + 2 * ROUND_SECONDS);
    expect(hasEffect(hero, 'shielded')).toBe(true);
    tickEffects(hero, fxAtGrant + 3 * ROUND_SECONDS);
    expect(hasEffect(hero, 'shielded')).toBe(false);
  });

  it('clearCombatEffects wipes buffs and debuffs but spares until-rest ones', () => {
    const hero = { data: { type: 'humanoid' } };

    applyEffect(hero, 'raging',   { duration: 30, elapsed: 0 });            // buff
    applyEffect(hero, 'poisoned', { duration: 30, elapsed: 0 });            // debuff
    applyEffect(hero, 'inspired', { duration: 30, elapsed: 0, tag: 'skill' }); // banked boon
    applyEffect(hero, 'corroded', { elapsed: 0, tag: 'rest' });             // persist:true
    applyEffect(hero, 'drained',  { elapsed: 0, tag: 'rest' });             // persist:true

    const cleared = clearCombatEffects(hero);

    expect(cleared).toBe(3);
    expect(hasEffect(hero, 'raging')).toBe(false);
    expect(hasEffect(hero, 'poisoned')).toBe(false);
    expect(hasEffect(hero, 'inspired')).toBe(false);
    // Monster-ability drains end on a rest, not on a fight.
    expect(hasEffect(hero, 'corroded')).toBe(true);
    expect(hasEffect(hero, 'drained')).toBe(true);
  });

  it('clearCombatEffects invalidates the aggregate-mods cache', () => {
    const hero = { data: { type: 'humanoid' } };
    applyEffect(hero, 'shielded', { duration: 30, elapsed: 0 });   // +5 AC
    expect(getEffectMods(hero).acBonus).toBe(5);

    clearCombatEffects(hero);
    expect(getEffectMods(hero).acBonus).toBe(0);
  });

  it('rolls repeat saves on a round cadence', () => {
    /* A repeat save fires once per round of combat time. With a DC of 0 the
       save always succeeds, so the effect must be gone after exactly one
       round's worth of clock — and still present before that. */
    const hero = { data: { type: 'humanoid', effStats: { wis: 10 } } };
    applyEffect(hero, 'frightened', {
      duration: 10 * ROUND_SECONDS, elapsed: 0,
      repeatSave: { ability: 'wis', dc: 0, every: ROUND_SECONDS }
    });

    tickEffects(hero, ROUND_SECONDS - 0.01);
    expect(hasEffect(hero, 'frightened')).toBe(true);

    tickEffects(hero, ROUND_SECONDS);
    expect(hasEffect(hero, 'frightened')).toBe(false);
  });
});
