import { describe, it, expect } from 'vitest';
import { hitProbability, attackPreview, attackPreviewText, movePreview, threatZone } from '../src/game/tactical_preview.js';
import { applyEffect } from '../src/game/conditions.js';

/* The preview must be a projection of the rules heroAttackRoll applies —
   same to-hit composition (atkProf + ability mod + effect bonus), same
   effective AC (foe ac + acBonus), same advantage sources — and never a
   roll. */

const hero = (over = {}) => ({
  x: 0, z: 0, _side: 'hero',
  data: { name: 'Vale', hp: 20, maxHp: 20, level: 5, classKey: 'fighter', atkProf: 3, critRange: 20, dmgBonus: 1,
          effStats: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, ...over }
});
const foe = (over = {}) => ({ x: 1, z: 0, active: true, _side: 'mon', data: { name: 'Ghoul', hp: 20, maxHp: 20, ac: 14, ...over } });
const sword = { name: 'Longsword', melee: true, ability: 'str', dmg: [1, 8], source: 'weapon' };

describe('hit probability', () => {
  it('follows the d20: need 11 is 50%, nat 1 always misses, nat 20 always hits', () => {
    expect(hitProbability(11)).toBeCloseTo(0.5);
    expect(hitProbability(-5)).toBeCloseTo(0.95);
    expect(hitProbability(30)).toBeCloseTo(0.05);
  });
  it('advantage and disadvantage bend it the right way', () => {
    expect(hitProbability(11, 1)).toBeCloseTo(0.75);
    expect(hitProbability(11, -1)).toBeCloseTo(0.25);
  });
});

describe('attack preview', () => {
  it('composes to-hit and damage exactly as the roll does', () => {
    const p = attackPreview({ heroes: [] }, hero(), foe(), sword);
    expect(p.toHit).toBe(6);                       // prof 3 + STR mod 3
    expect(p.foeAc).toBe(14);
    expect(p.hitPct).toBe(65);                     // need 8 → 13/20
    expect(p.critPct).toBe(5);
    expect(p.minDmg).toBe(5);                      // 1 + 3 + 1
    expect(p.maxDmg).toBe(12);                     // 8 + 3 + 1
    expect(p.avgDmg).toBe(9);                      // 4.5 + 4 → 8.5 rounds to 9
    expect(attackPreviewText(p)).toBe('65% to hit vs AC 14 · 5% crit · 5–12 dmg (avg 9)');
  });

  it('shows advantage sources by name and lifts the odds', () => {
    const h = hero();
    const f = foe();
    applyEffect(f, 'blinded', { elapsed: 0 });      // a blinded target grants advantage
    const p = attackPreview({ heroes: [] }, h, f, sword);
    expect(p.adv).toBe(1);
    expect(p.hitPct).toBe(88);                     // 1 - 0.35²
    expect(attackPreviewText(p)).toContain('advantage: target impaired');
  });

  it('counts a flanking ally as sneak attack for a rogue', () => {
    const rogue = hero({ classKey: 'rogue', level: 5 });
    const ally = hero({ name: 'Ash' }); ally.x = 2; ally.z = 0;
    const p = attackPreview({ heroes: [rogue, ally] }, rogue, foe(), { ...sword, ability: 'dex' });
    expect(p.notes).toContain('sneak attack');
    expect(p.maxDmg).toBe(8 + 1 + 1 + 18);         // + 3d6
  });

  it('says nothing for a dead target or no profile', () => {
    expect(attackPreview({ heroes: [] }, hero(), foe({ hp: 0 }), sword)).toBeNull();
    expect(attackPreview({ heroes: [] }, hero(), foe(), null)).toBeNull();
  });
});

describe('move preview', () => {
  const game = {
    oaHostiles: () => [{ entity: foe({ name: 'Ghoul' }), threatened: new Set([5, 6, 7]) }]
  };
  it('names the hostile whose reach the path leaves', () => {
    expect(movePreview(game, hero(), [5, 6, 9]).provokers.map(e => e.data.name)).toEqual(['Ghoul']);
    expect(movePreview(game, hero(), [5, 6, 7]).provokers).toEqual([]);    // never leaves reach
    expect(movePreview(game, hero(), [1, 2]).provokers).toEqual([]);       // never inside it
  });
  it('paints the union of every hostile threat as the danger zone', () => {
    expect([...threatZone(game, hero())].sort()).toEqual([5, 6, 7]);
  });
});
