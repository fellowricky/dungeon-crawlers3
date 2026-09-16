import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { pushLootFeed, clearLootFeed, LOOT_RARITY_COLORS } from '../src/game/ui.js';

/* The loot feed replaced a world-space bubble over the leader's head. Ordering
   is a killfeed: rows are PREPENDED, so the newest is on top and older rows are
   pushed down. The oldest therefore sit at the BOTTOM and expire first, which
   is what makes the column dissolve upward from its bottom edge. */

/* The repo mocks the DOM by hand rather than pulling in jsdom (see
   combat_log.test.js) — this is the same shape, plus the few extras the feed
   needs: prepend, remove, style custom properties and a child query. */
function mockDom() {
  const elements = {};
  const mkClassList = (el) => ({
    add(c) { if (!el.className.split(' ').includes(c)) el.className = (el.className + ' ' + c).trim(); },
    remove(c) { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
    contains(c) { return el.className.split(' ').includes(c); }
  });
  const mkEl = (tag, id) => {
    const el = {
      id, tagName: String(tag).toUpperCase(), className: '', textContent: '',
      children: [], parent: null,
      style: {
        _p: {},
        setProperty(k, v) { this._p[k] = v; },
        getPropertyValue(k) { return this._p[k] || ''; }
      },
      appendChild(c) { c.parent = el; el.children.push(c); return c; },
      prepend(c) { c.parent = el; el.children.unshift(c); return c; },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); },
      querySelector(sel) {
        const want = sel.replace('.', '');
        const walk = (n) => {
          for (const c of n.children) {
            if (c.className.split(' ').includes(want)) return c;
            const deep = walk(c);
            if (deep) return deep;
          }
          return null;
        };
        return walk(el);
      }
    };
    el.classList = mkClassList(el);
    return el;
  };
  global.document = {
    getElementById(id) { return elements[id] || null; },
    createElement(tag) { return mkEl(tag); },
    _add(id) { elements[id] = mkEl('div', id); return elements[id]; },
    _reset() { for (const k of Object.keys(elements)) delete elements[k]; }
  };
  return global.document;
}

const rows = () => [...document.getElementById('lootfeed').children];
const names = () => rows().map(r => r.querySelector('.loot-name').textContent);

beforeEach(() => {
  mockDom()._add('lootfeed');
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('loot feed', () => {
  it('puts the newest pickup at the top', () => {
    pushLootFeed({ name: 'Rusted Sword' });
    pushLootFeed({ name: 'Bone Charm' });
    pushLootFeed({ name: '40 Gold' });

    expect(names()).toEqual(['40 Gold', 'Bone Charm', 'Rusted Sword']);
  });

  it('expires from the bottom up — oldest first', () => {
    pushLootFeed({ name: 'first' });
    vi.advanceTimersByTime(600);
    pushLootFeed({ name: 'second' });

    /* Far enough for the first row's life to end, but not the second's. */
    vi.advanceTimersByTime(3200);
    const leaving = rows().filter(r => r.classList.contains('loot-out'));
    expect(leaving).toHaveLength(1);
    expect(leaving[0].querySelector('.loot-name').textContent).toBe('first');

    /* And it is the bottom row that is going. */
    expect(names()[names().length - 1]).toBe('first');
  });

  it('removes the row from the DOM once the fade finishes', () => {
    pushLootFeed({ name: 'Rusted Sword' });
    expect(rows()).toHaveLength(1);

    vi.advanceTimersByTime(3600 + 450 + 20);
    expect(rows()).toHaveLength(0);
  });

  it('caps a burst of loot, retiring the oldest early', () => {
    /* A big chest should not push the column past the top strip of the screen. */
    for (let i = 0; i < 12; i++) pushLootFeed({ name: `item ${i}` });

    const live = rows().filter(r => !r.classList.contains('loot-out'));
    expect(live.length).toBeLessThanOrEqual(7);
    /* The survivors are the NEWEST ones. */
    expect(live[0].querySelector('.loot-name').textContent).toBe('item 11');
  });

  it('tints the row by rarity', () => {
    pushLootFeed({ name: 'Sunder', rarity: 'legendary' });
    expect(rows()[0].style.getPropertyValue('--loot-tint')).toBe(LOOT_RARITY_COLORS.legendary);

    pushLootFeed({ name: 'Plain Dagger' });
    expect(rows()[0].style.getPropertyValue('--loot-tint')).toBe(LOOT_RARITY_COLORS.common);
  });

  it('shows the quantity only when there is one', () => {
    pushLootFeed({ name: 'Arrows', qty: 'x12' });
    expect(rows()[0].querySelector('.loot-qty').textContent).toBe('x12');

    pushLootFeed({ name: 'Bone Charm' });
    expect(rows()[0].querySelector('.loot-qty')).toBeNull();
  });

  it('ignores a nameless entry rather than adding a blank row', () => {
    pushLootFeed({});
    pushLootFeed(null);
    expect(rows()).toHaveLength(0);
  });

  it('clearLootFeed empties it immediately', () => {
    pushLootFeed({ name: 'a' });
    pushLootFeed({ name: 'b' });
    clearLootFeed();
    expect(rows()).toHaveLength(0);
  });

  it('does nothing when the container is absent', () => {
    document._reset();
    expect(() => { pushLootFeed({ name: 'x' }); clearLootFeed(); }).not.toThrow();
  });
});
