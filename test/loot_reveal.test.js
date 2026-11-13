import { describe, it, expect, vi } from 'vitest';
import { fanfareRecipe } from '../src/render/loot_fanfare.js';
import { _internal, revealItems } from '../src/game/item_reveal.js';
import { combatMethods } from '../src/game/combat.js';
import { beginFightSpoils, finishFightSpoils } from '../src/game/spoils.js';

describe('loot fanfare scales with rarity', () => {
  it('adds a layer per tier: burst, rays, pillar, then confetti and shake for legendary', () => {
    const r = [0, 1, 2, 3, 4].map(fanfareRecipe);
    expect(r.map((x) => x.burst)).toEqual([true, true, true, true, true]);
    expect(r.map((x) => x.rays)).toEqual([false, false, true, true, true]);
    expect(r.map((x) => x.beam)).toEqual([false, false, false, true, true]);
    expect(r.map((x) => x.confetti)).toEqual([false, false, false, false, true]);
    expect(r[4].raysLife).toBe(Infinity);
    expect(r[2].raysLife).toBeLessThan(r[3].raysLife);
  });
});

describe('the fight report', () => {
  const report = {
    heroes: [
      { name: 'Aldric', classKey: 'fighter', dmgDealt: 30, dmgTaken: 12, kills: 2, downs: 0, levelUp: false },
      { name: 'Mira <x>', classKey: 'wizard', dmgDealt: 45, dmgTaken: 0, healDone: 14, kills: 1, downs: 1, levelUp: true },
    ],
    totals: { kills: 3, dmgDealt: 75, dmgTaken: 12, healDone: 14, downs: 1 }, mvp: 'Mira <x>', xpEach: 6, gold: 37, items: [], notes: ['2 Knowledge Tomes'], rounds: 3,
  };

  it('sums the fight in one line and names the rounds and kills', () => {
    expect(_internal.fightSub(report)).toBe('3 rounds · 3 slain');
    const line = _internal.totalsLine(report);
    expect(line).toContain('+37</b> gold');
    expect(line).toContain('+6</b> XP each');
    expect(line).toContain('75 dealt');
    expect(line).toContain('12 taken');
    expect(line).toContain('sp-ico');            // icon chips (or their text fallback)
  });

  it('lists every hero with badges, and escapes names', () => {
    const html = _internal.reportHTML(report);
    expect(html).toContain('Mira &lt;x&gt;');
    expect(html).not.toContain('Mira <x>');
    expect(html).toContain('MVP');
    expect(html).toContain('LEVEL UP');
    expect(html).toContain('DOWNED');
    expect(html).toContain('Also recovered: 2 Knowledge Tomes');
    expect(html).toContain('Healed');
    expect(html).toContain('sp-mvp-row');        // the MVP's row is highlighted
    expect(html).toMatch(/sp-healed sp-top">14</);
    /* each column's leader stands out: Mira dealt the most, Aldric took and killed the most */
    expect(html).toMatch(/sp-dealt sp-top">45</);
    expect(html).toMatch(/sp-dealt">30</);
    expect(html).toMatch(/sp-taken sp-top">12</);
    expect(html).toMatch(/sp-kills sp-top">2</);
    expect(html).not.toMatch(/sp-zero sp-top/);
  });

  it('flips on its own after 10 s idle', () => {
    expect(_internal.AUTO_FLIP_MS).toBe(10000);
  });

  it("a chest with nothing to show still runs its follow-up (the tutorial's equip card)", () => {
    const onDone = vi.fn();
    revealItems([], { onDone });
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe('kill drops during a fight are held for the reveal', () => {
  const game = () => ({ ...combatMethods, gold: 0, heroes: [], initiative: { round: 2 }, notifyLootFeedback: vi.fn(), fxLog: vi.fn() });

  it('a drop mid-fight is held quietly: no feed line, no log line', () => {
    const g = game();
    beginFightSpoils(g);
    g.announceDrop({ name: 'Sword', rarity: 'rare' }, 'dropped Sword');
    expect(g.notifyLootFeedback).not.toHaveBeenCalled();
    expect(g.fxLog).not.toHaveBeenCalled();
    expect(finishFightSpoils(g).items).toEqual([{ name: 'Sword', rarity: 'rare' }]);
  });

  it('a drop outside a fight is announced as before', () => {
    const g = game();
    g.announceDrop({ name: 'Ring' }, 'dropped Ring');
    expect(g.notifyLootFeedback).toHaveBeenCalledWith({ item: { name: 'Ring' } });
    expect(g.fxLog).toHaveBeenCalledWith('dropped Ring', 'treasure');
  });
});

describe('screens after a fight wait their turn', () => {
  it('nothing is holding the screen when no reveal is pending or open', async () => {
    const { isRevealBusy } = await import('../src/game/item_reveal.js');
    expect(isRevealBusy()).toBe(false);
  });

  it('the report waits for the whole VICTORY! pop, then a beat', async () => {
    const victory = await import('../src/vendor/pixelfx/fx/ui/victory.js');
    const src = (await import('node:fs')).readFileSync(new URL('../src/game/item_reveal.js', import.meta.url), 'utf8');
    expect(src).toMatch(/REPORT_AFTER_POP_MS = Math\.round\(\(victoryFx\.meta\.duration \+ 0\.25\) \* 1000\)/);
    expect(victory.meta.duration).toBeGreaterThan(2);
  });
});

describe("a turned card is the inventory's own item card", () => {
  it('shows the same name, headline stat, rows and Power Score as the bag tooltip', async () => {
    const { itemCardHTML, itemTipBlock } = await import('../src/game/menus.js');
    const { rollItem } = await import('../src/game/items.js');
    const it = rollItem(5, () => 0.42, 'armor', { source: 'boss', forceRarity: 'rare' });
    const card = itemCardHTML(it, 'A rare find', '#5aa0f0');
    expect(card).toBe(itemTipBlock(it, 'A rare find', '#5aa0f0'));
    expect(card).toContain('tt-primary');
    expect(card).toContain('Power Score');
    expect(card).toContain(it.name);
  });

  it('dyes and runes get their own cards, not empty stat blocks', async () => {
    const { itemCardHTML } = await import('../src/game/menus.js');
    const dye = { slot: 'dye', name: 'Crimson Dye', rarity: 'common', color: '#b4b0a4', dyeColor: '#a02020' };
    expect(itemCardHTML(dye, 'Found', '#fff')).toContain('Drag onto equipped gear');
  });
});
