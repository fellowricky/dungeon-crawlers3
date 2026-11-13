import { describe, it, expect } from 'vitest';
import { partyCompareHTML, consumableCardHTML } from '../src/game/menus.js';
import { makeHero, recalc, canEquip } from '../src/game/srd.js';
import { rollItem, itemPoints } from '../src/game/items.js';

const STATS = { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 12 };

describe('shop: compare an item with any party member', () => {
  const party = () => ['fighter', 'wizard', 'cleric'].map((c, i) => {
    const h = makeHero(`H${i}`, 'human', c, STATS);
    recalc(h);
    return { data: h };
  });

  it('shows a chip per hero, picks whoever gains most, and the side-by-side comparison', () => {
    const heroes = party();
    const armor = rollItem(5, () => 0.4, 'armor', { source: 'boss', forceRarity: 'rare' });
    const { html, pick } = partyCompareHTML(armor, heroes, null);
    expect((html.match(/data-cmp-hero=/g) || []).length).toBe(3);
    expect(html).toContain('tt-compare');            // the inventory's own comparison card
    expect(pick).not.toBeNull();
    /* the auto pick is a hero who can use it with the biggest Power Score gain */
    const usable = heroes.map((h, i) => ({ i, ok: canEquip(h.data, armor),
      gain: itemPoints(armor) - (h.data.equipment.armor ? itemPoints(h.data.equipment.armor) : 0) })).filter((r) => r.ok);
    expect(usable.map((r) => r.i)).toContain(pick);
    expect(usable.find((r) => r.i === pick).gain).toBe(Math.max(...usable.map((r) => r.gain)));
  });

  it('honours an explicit pick and marks heroes who can\'t use the item', () => {
    const heroes = party();
    const heavy = rollItem(5, () => 0.4, 'armor', { source: 'boss', forceRarity: 'rare' });
    heavy.prof = 'heavy';
    const { html, pick } = partyCompareHTML(heavy, heroes, 1);
    expect(pick).toBe(1);
    expect(html).toMatch(/pc-chip on[^"]*" data-cmp-hero="1"/);
  });

  it('dyes and runes get a plain card, potions a consumable card', () => {
    const dye = { slot: 'dye', name: 'Crimson Dye', rarity: 'common', color: '#b4b0a4', dyeColor: '#a02020' };
    const r = partyCompareHTML(dye, party(), null);
    expect(r.html).not.toContain('data-cmp-hero');
    expect(r.html).toContain('Drag onto equipped gear');
    expect(consumableCardHTML('🧪', 'Healing Potion', 'Heals 2d4+2')).toContain('Healing Potion');
  });
});
