import { describe, it, expect } from 'vitest';
import { unitCardData, unitCardHTML } from '../src/game/unit_card.js';
import { applyEffect } from '../src/game/conditions.js';
import { BESTIARY_UNLOCK } from '../src/game/constants.js';
import { exploreMethods } from '../src/game/explore.js';

const rat = () => ({
  x: 1, z: 1, active: true, _effects: {},
  data: { id: 'giant-rat', name: 'Giant <Rat>', hp: 3, maxHp: 7, ac: 12, size: 'small', type: 'beast', cr: 0.125,
    effStats: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 }, saves: { dex: 4 },
    statblock: { resist: ['poison'], immune: [], vulnerable: ['fire'], condImmune: ['charmed'] } },
});
const game = (kills = 0) => ({ fxNow: 0, bestiary: { 'giant-rat': kills }, cellsForSpeed: () => 6 });

describe('unit card: a monster before its Bestiary entry unlocks', () => {
  it('shows a health bar with no numbers, Bloodied under half, effects, and kills to go', () => {
    const m = rat(), g = game(3);
    applyEffect(m, 'poisoned', { duration: 12, elapsed: 0 });
    const c = unitCardData(g, m);
    expect(c.unlocked).toBe(false);
    expect(c.bloodied).toBe(true);
    expect(c.effects.map((f) => f.key)).toEqual(['poisoned']);
    expect(c.effects[0].rounds).toBe(2);
    const html = unitCardHTML(c);
    expect(html).toContain('Bloodied');
    expect(html).toContain(`3/${BESTIARY_UNLOCK}`);
    expect(html).not.toContain('3</b> / 7');         // no exact HP
    expect(html).not.toContain('uc-abil');            // no stat block
    expect(html).toContain('Giant &lt;Rat&gt;');
  });
});

describe('unit card: an unlocked monster', () => {
  it('reveals exact HP, AC, speed, ability mods, saves and resistances', () => {
    const c = unitCardData(game(BESTIARY_UNLOCK), rat());
    expect(c.unlocked).toBe(true);
    expect(c.ac).toBe(12);
    expect(c.speedFt).toBe(30);
    const dex = c.abilities.find((a) => a.ab === 'dex');
    expect(dex).toMatchObject({ mod: 2, save: 4, prof: true });
    expect(c.abilities.find((a) => a.ab === 'str')).toMatchObject({ mod: -2, save: -2, prof: false });
    const html = unitCardHTML(c);
    expect(html).toContain('3</b> / 7');
    expect(html).toContain('uc-abil');
    expect(html).toContain('Resists');
    expect(html).toContain('Vulnerable');
    expect(html).toContain('charmed');
    expect(html).toContain('No active effects');
  });
});

describe('unit card: heroes', () => {
  it('always show their full card, with temp HP and live AC', () => {
    const h = { _side: 'hero', x: 0, z: 0, _effects: {}, data: { name: 'Aldric', classKey: 'fighter', raceKey: 'human', level: 3, hp: 20, maxHp: 28, tempHp: 5, ac: 16, effStats: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, saves: { str: 5, con: 4 } } };
    applyEffect(h, 'hasted', { duration: 60, elapsed: 0 });
    const g = { fxNow: 0, heroAC: () => 18, cellsForSpeed: () => 6, bestiary: {} };
    const c = unitCardData(g, h);
    expect(c.hero).toBe(true);
    expect(c.unlocked).toBe(true);
    expect(c.ac).toBe(18);
    expect(c.sub).toContain('Fighter');
    expect(c.effects[0]).toMatchObject({ key: 'hasted', category: 'buff', rounds: 10 });
    expect(unitCardHTML(c, { pinned: true })).toContain('uc-close');
    expect(unitCardHTML(c)).toContain('+5');
  });
});

describe('clicking a creature', () => {
  it('finds the monster on the tile, else a hero, else nothing', () => {
    const m = rat(), h = { x: 3, z: 3, data: { name: 'H', hp: 10 } };
    const g = { ...exploreMethods, D: {}, monsters: [m], heroes: [h], cellOf: (x, z) => Math.floor(x) * 100 + Math.floor(z) };
    expect(g.unitAtPoint(1.2, 1.4)).toBe(m);
    expect(g.unitAtPoint(3.3, 3.6)).toBe(h);
    expect(g.unitAtPoint(7, 7)).toBe(null);
  });
});

describe('the selection outline', () => {
  const vec = () => ({ x: 0, y: 0, z: 0, w: 0, set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } });
  const creature = () => {
    const outline = { value: vec() };
    return { x: 0, z: 0, active: true, data: { name: 'G', hp: 5, maxHp: 5 }, ent: { anim: { mesh: { material: { userData: { sprOutline: outline } } } } }, outline };
  };

  it('the creature under the cursor gets a white outline, which goes when the cursor leaves', async () => {
    const { setCursorUnit } = await import('../src/game/unit_card.js');
    const a = creature(), b = creature();
    setCursorUnit(a);
    expect(a.outline.value).toMatchObject({ x: 1, y: 1, z: 1, w: 1 });
    setCursorUnit(b);
    expect(a.outline.value.w).toBe(0);
    expect(b.outline.value.w).toBe(1);
    setCursorUnit(null);
    expect(b.outline.value.w).toBe(0);
  });

  it('a dead monster under the cursor is not outlined', async () => {
    const { setCursorUnit } = await import('../src/game/unit_card.js');
    const a = creature();
    a.data.hp = 0; a.dead = true;
    setCursorUnit(a);
    expect(a.outline.value.w).toBe(0);
    setCursorUnit(null);
  });
});

describe("whose turn it is", () => {
  const vec = () => ({ x: 0, y: 0, z: 0, w: 0, set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } });
  const creature = () => {
    const outline = { value: vec() };
    return { x: 0, z: 0, active: true, data: { name: 'G', hp: 5, maxHp: 5 }, ent: { anim: { mesh: { material: { userData: { sprOutline: outline } } } } }, outline };
  };

  it('gets a green outline that moves on with the turn; hovering it shows white over the green', async () => {
    const { setTurnUnit, setCursorUnit } = await import('../src/game/unit_card.js');
    const a = creature(), b = creature();
    setTurnUnit(a);
    expect(a.outline.value.y).toBe(1);
    expect(a.outline.value.x).toBeLessThan(0.1);          // green
    setCursorUnit(a);
    expect(a.outline.value).toMatchObject({ x: 1, y: 1, z: 1 });   // white wins while pointed at
    setCursorUnit(null);
    expect(a.outline.value.x).toBeLessThan(0.1);          // back to green
    setTurnUnit(b);
    expect(a.outline.value.w).toBe(0);
    expect(b.outline.value.w).toBe(1);
    setTurnUnit(null);
    expect(b.outline.value.w).toBe(0);
  });
});
