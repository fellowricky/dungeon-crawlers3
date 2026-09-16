import { describe, it, expect, vi, afterEach } from 'vitest';
import Game from '../src/game/combat.js';
import { SPELLS, throwRoll, throwDC } from '../src/game/spells.js';
import { rollItem, addToInventory, BASES, trinketFamily } from '../src/game/items.js';
import { makeHero } from '../src/game/srd.js';
import { applyEffect, hasEffect } from '../src/game/conditions.js';

/* Thrown gear and the potion roster: anybody can throw a flask, the drop
   table gates by depth and deals from three families, healing potions feed
   the shared pool, and a spent trinket reloads from the bag. */

const fighter = () => ({ x: 0, z: 0, data: makeHero('Bram', 'human', 'fighter', { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }) });
const foe = (over = {}) => ({ x: 1, z: 0, active: true, data: { name: 'Ghoul', hp: 30, maxHp: 30, ac: 12, type: 'undead', ...over } });

function mockGame(over = {}) {
  const g = {
    fxNow: 0, heroes: [], monsters: [], inventory: [], potions: { heal: 0, greater: 0, superior: 0 },
    fxLog: vi.fn(), fxText: vi.fn(), fxSprite: vi.fn(), playAbilityFx: vi.fn(),
    refreshHud: vi.fn(), refreshAbilityHud: vi.fn(),
    _v3: (x, y, z) => ({ x, y, z }),
    fxProjectile: (from, to, kind, color, onHit) => onHit(),
    spellDamage: vi.fn((m, dmg) => { m.data.hp -= dmg; return dmg; }),
    spellSave: vi.fn(() => false),
    monsterEliteRoom: () => false,
    ...over
  };
  for (const k of ['markSpellUsed', '_consumeScrollFor', '_equippedScroll', '_equippedPotion', '_usePotion', '_scorePotion',
    '_reloadTrinketFromBag', '_combatStable', 'canUseSpellRecharge', 'getAbilityUseWeight'])
    if (Game[k]) g[k] = Game[k].bind(g);
  g._combatSec = () => 999;
  return g;
}

afterEach(() => vi.restoreAllMocks());

describe('throw roll', () => {
  it('uses the better of STR and DEX plus proficiency against AC', () => {
    const h = fighter();                                  // STR 16 → +3, prof 2
    vi.spyOn(Math, 'random').mockReturnValue(0.5);        // d20 = 11
    const r = throwRoll(h, foe({ ac: 16 }));
    expect(r.hit).toBe(true);                             // 11 + 5 = 16
    expect(throwRoll(h, foe({ ac: 17 })).hit).toBe(false);
    expect(throwDC(h)).toBe(13);
  });
  it('a natural 1 misses and a natural 20 crits', () => {
    const h = fighter();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(throwRoll(h, foe({ ac: 1 })).hit).toBe(false);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(throwRoll(h, foe({ ac: 40 }))).toMatchObject({ hit: true, crit: true });
  });
});

describe('thrown items resolve through the trinket slot', () => {
  it('a fighter throws acid from an equipped vial and spends a charge', () => {
    const h = fighter();
    h.data.equipment.trinket = { name: 'Vial of Acid', slot: 'trinket', scroll: true, thrown: true, spellKey: 'acidVial', charges: 2, baseKey: 'Vial of Acid' };
    const m = foe();
    const g = mockGame({ monsters: [m] });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);        // hits, no crit
    h._scrollCastKey = 'acidVial';
    expect(SPELLS.acidVial.cast(g, h, m)).toBe(true);
    expect(g.spellDamage).toHaveBeenCalledTimes(1);
    expect(m.data.hp).toBeLessThan(30);
    expect(h.data.equipment.trinket.charges).toBe(1);
  });
  it('bolas restrain on a hit', () => {
    const h = fighter();
    h.data.equipment.trinket = { name: 'Bolas', slot: 'trinket', scroll: true, thrown: true, spellKey: 'bolas', charges: 1, baseKey: 'Bolas' };
    const m = foe();
    const g = mockGame({ monsters: [m] });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    h._scrollCastKey = 'bolas';
    SPELLS.bolas.cast(g, h, m);
    expect(hasEffect(m, 'restrained')).toBe(true);
  });
  it('holy water only bites undead and fiends', () => {
    const h = fighter();
    h.data.equipment.trinket = { name: 'Flask of Holy Water', slot: 'trinket', scroll: true, thrown: true, spellKey: 'holyWater', charges: 2, baseKey: 'Flask of Holy Water' };
    const beast = foe({ type: 'beast' });
    const g = mockGame({ monsters: [beast] });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    h._scrollCastKey = 'holyWater';
    SPELLS.holyWater.cast(g, h, beast);
    expect(g.spellDamage).not.toHaveBeenCalled();
    expect(beast.data.hp).toBe(30);
  });
});

describe('the AI and holy water', () => {
  const setup = () => {
    const h = fighter();
    h.data.knownSpells = [];
    h.data.aiPrefs.abilityUsage = 'unleash';
    h.data.equipment.trinket = { name: 'Flask of Holy Water', slot: 'trinket', scroll: true, thrown: true, spellKey: 'holyWater', charges: 2, baseKey: 'Flask of Holy Water' };
    const g = mockGame({ getAbilityUseWeight: () => 1, _worthSpending: () => true });
    for (const k of ['_pickKnownSpell', '_scoreSpellForTarget', 'aoeRadiusOf']) g[k] = Game[k].bind(g);
    return { h, g };
  };
  it('throws at an undead target', () => {
    const { h, g } = setup();
    const ghoul = foe();
    g.monsters = [ghoul];
    expect(g._pickKnownSpell(h, ghoul, [h], sp => sp.bonusAction !== true)).toMatchObject({ key: 'holyWater' });
  });
  it('never wastes it on a wolf', () => {
    const { h, g } = setup();
    const wolf = foe({ name: 'Wolf', type: 'beast' });
    g.monsters = [wolf];
    expect(g._pickKnownSpell(h, wolf, [h], sp => sp.bonusAction !== true)).toBeNull();
  });
  it('looks past a wolf to the skeleton behind it', () => {
    const { h, g } = setup();
    const wolf = foe({ name: 'Wolf', type: 'beast' });
    const skel = foe({ name: 'Skeleton', type: 'undead' }); skel.x = 3;
    g.monsters = [wolf, skel];
    const pick = g._pickKnownSpell(h, wolf, [h], sp => sp.bonusAction !== true);
    expect(pick).toMatchObject({ key: 'holyWater' });
    expect(pick.foe).toBe(skel);
  });
});

describe('reloading from the bag', () => {
  it('the last charge readies the next scroll of the same kind from the bag stack', () => {
    const h = fighter();
    const g = mockGame();
    const fresh = rollItem(3, () => 0.99, 'trinket');
    fresh.charges = 2;
    addToInventory(g.inventory, fresh); addToInventory(g.inventory, { ...fresh, id: 'x' });
    const equipped = { ...fresh, id: 'e', charges: 1, qty: 1 };
    h.data.equipment.trinket = equipped;
    h.data.knownSpells = [];
    g._consumeScrollFor(h, fresh.spellKey);
    expect(h.data.equipment.trinket).toBeTruthy();
    expect(h.data.equipment.trinket).not.toBe(equipped);
    expect(h.data.equipment.trinket.charges).toBe(2);
    expect(g.inventory[0].qty).toBe(1);
  });
  it('a different scroll in the bag is left alone', () => {
    const h = fighter();
    const g = mockGame();
    const other = rollItem(3, () => 0.01, 'trinket');
    addToInventory(g.inventory, other);
    h.data.equipment.trinket = { name: 'Scroll of Nothing', slot: 'trinket', scroll: true, spellKey: 'acidVial', charges: 1, baseKey: 'Nothing' };
    h.data.knownSpells = [];
    g._consumeScrollFor(h, 'acidVial');
    expect(h.data.equipment.trinket).toBeUndefined();
    expect(g.inventory).toHaveLength(1);
  });
});

describe('potion roster', () => {
  it('a dropped healing potion tops up the shared pool instead of the bag', () => {
    const g = mockGame();
    const base = BASES.trinket.find(b => b.potionPool === 'greater');
    const item = { ...base, slot: 'trinket', potion: true, qty: 1 };
    addToInventory(g.inventory, item, g);
    expect(g.potions.greater).toBe(1);
    expect(g.inventory).toHaveLength(0);
  });
  it('an elixir cures what ails you and the AI only drinks it when something does', () => {
    const h = fighter();
    const g = mockGame();
    const elixir = { name: 'Elixir of Health', slot: 'trinket', potion: true, charges: 1, cures: ['poisoned', 'blinded'] };
    expect(g._scorePotion(h, elixir, [h])).toBe(-1);
    applyEffect(h, 'poisoned', { duration: 60, elapsed: 0 });
    expect(g._scorePotion(h, elixir, [h])).toBeGreaterThan(0);
    h.data.equipment.trinket = elixir;
    g._usePotion(h, elixir);
    expect(hasEffect(h, 'poisoned')).toBe(false);
    expect(h.data.equipment.trinket).toBeUndefined();
  });
  it('heroism grants temp HP with its buff', () => {
    const h = fighter();
    const g = mockGame();
    const p = { name: 'Potion of Heroism', slot: 'trinket', potion: true, charges: 1, buffKey: 'heroism', buffDuration: 60, tempHp: 10 };
    g._usePotion(h, p);
    expect(hasEffect(h, 'heroism')).toBe(true);
    expect(h.data.tempHp).toBe(10);
  });
  it('the drop table respects depth and deals every family', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const it = rollItem(0, Math.random, 'trinket', { ilvl: 0 });
      const base = BASES.trinket.find(b => b.name === it.baseKey);
      expect(base.minIlvl | 0).toBe(0);
      seen.add(trinketFamily(base));
    }
    expect([...seen].sort()).toEqual(['potion', 'scroll', 'thrown']);
    const deep = new Set();
    for (let i = 0; i < 400; i++) deep.add(rollItem(14, Math.random, 'trinket', { ilvl: 14 }).baseKey);
    expect(deep.has('Potion of Foresight') || deep.has('Bead of Force') || deep.has('Potion of Fury')).toBe(true);
  });
});
