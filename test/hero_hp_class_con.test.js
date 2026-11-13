import { describe, it, expect } from 'vitest';
import { makeHero, recalc, CLASSES, RACES, LEVEL1_GRIT_HP } from '../src/game/srd.js';
import { combatMethods } from '../src/game/combat.js';

const PLAYABLE = Object.keys(CLASSES).filter((k) => !['beast', 'familiar'].includes(k));
const STATS = { str: 12, dex: 12, con: 14, int: 12, wis: 12, cha: 12 };
const conMod = (h) => Math.floor((h.effStats.con - 10) / 2);
/* Full die + the flat level-1 grit at 1st level, the die's average after, CON every level. */
const expected = (cls, level, con) => {
  const hd = CLASSES[cls].hitDie;
  return hd + LEVEL1_GRIT_HP + (level - 1) * Math.ceil((hd + 1) / 2) + level * con;
};

describe('hero max HP is class + CON only (plus the level-1 grit)', () => {
  it('matches the formula for every class from level 1 to 20', () => {
    expect(LEVEL1_GRIT_HP).toBe(8);
    for (const cls of PLAYABLE) {
      const h = makeHero('T', 'human', cls, STATS);
      for (let lvl = 1; lvl <= 20; lvl++) {
        h.level = lvl;
        recalc(h);
        expect(h.maxHp, `${cls} L${lvl}`).toBe(expected(cls, lvl, conMod(h)));
      }
    }
  });

  it('race only matters through its CON: a Hill Dwarf gets no extra HP per level', () => {
    const dwarf = makeHero('D', 'dwarf', 'fighter', STATS);
    dwarf.level = 10;
    recalc(dwarf);
    expect(RACES.dwarf.hpPerLevel).toBeUndefined();
    expect(dwarf.maxHp).toBe(expected('fighter', 10, conMod(dwarf)));
  });

  it('feats, skill-tree toughness and feature bumps give start-of-fight temp HP, not max HP', () => {
    const h = makeHero('F', 'human', 'fighter', STATS);
    h.level = 5;
    recalc(h);
    const base = h.maxHp;
    h.feats = [...(h.feats || []), 'tough'];
    h.skills = { ...(h.skills || {}), toughness: 3 };
    recalc(h);
    expect(h.maxHp).toBe(base);
    expect(h.fightTempHp).toBe(2 * 5 + 5 * 3);   // Tough 2/level + Toughness 5/rank (half the d10)
  });

  it('gear HP still adds to max HP', () => {
    const h = makeHero('G', 'human', 'wizard', STATS);
    recalc(h);
    const base = h.maxHp;
    h.equipment = { ...h.equipment, ring1: { id: 'test_ring', slot: 'ring1', name: 'Ring of the Bear', bonuses: { hp: 5 } } };
    recalc(h);
    expect(h.maxHp).toBe(base + 5);
  });
});

describe('the start-of-fight ward', () => {
  const game = { ...combatMethods, fxText() {}, _v3: (x, y, z) => ({ x, y, z }) };
  const hero = (tempHp, pool) => ({ x: 0, z: 0, data: { hp: 10, tempHp, fightTempHp: pool } });

  it('grants the pool on a fresh fight', () => {
    const h = hero(0, 12);
    game.applyFightWard(h, 0);
    expect(h.data.tempHp).toBe(12);
  });

  it('stacks on top of what a subclass shield just gave this fight', () => {
    const h = hero(0, 12);
    h.data.tempHp = 7;                  // Arcane Ward / Thick Hide fired in subclassCombatStart
    game.applyFightWard(h, 0);
    expect(h.data.tempHp).toBe(19);
  });

  it('never stacks on temp HP left over from an earlier fight', () => {
    const h = hero(20, 12);
    game.applyFightWard(h, 20);
    expect(h.data.tempHp).toBe(20);
    const h2 = hero(5, 12);
    game.applyFightWard(h2, 5);
    expect(h2.data.tempHp).toBe(12);
  });
});
