import { describe, it, expect, beforeEach } from 'vitest';
import { formatLogMessage, log, updateLogPauseBtn } from '../src/game/ui.js';

describe('Combat Log Improvements', () => {
  const mockGame = {
    heroes: [{ data: { name: 'Valeros' } }, { data: { name: 'Kyra' } }],
    monsters: [{ data: { name: 'Goblin Boss' } }, { data: { name: 'Skeleton Archer' } }],
    paused: false,
    setPaused(p) {
      this.paused = p;
      updateLogPauseBtn(p);
    }
  };

  beforeEach(() => {
    // Setup lightweight DOM mock
    const elements = {};
    global.document = {
      getElementById(id) {
        if (!elements[id]) {
          const el = {
            id,
            className: '',
            classList: {
              add(c) { el.className = (el.className + ' ' + c).trim(); },
              remove(c) { el.className = el.className.replace(c, '').trim(); },
              contains(c) { return el.className.includes(c); }
            },
            children: [],
            appendChild(child) { el.children.push(child); },
            removeChild(child) { el.children = el.children.filter(c => c !== child); },
            scrollTop: 0,
            scrollHeight: 500,
            clientHeight: 100,
            textContent: '',
            innerHTML: '',
            title: ''
          };
          elements[id] = el;
        }
        return elements[id];
      },
      createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          children: [],
          textContent: '',
          innerHTML: '',
          appendChild(child) { el.children.push(child); },
          classList: {
            add(c) { el.className = (el.className + ' ' + c).trim(); },
            remove(c) { el.className = el.className.replace(c, '').trim(); },
            contains(c) { return el.className.includes(c); }
          }
        };
        return el;
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    };
  });

  it('highlights friendly names in light green (.log-friendly)', () => {
    const formatted = formatLogMessage('Valeros attacks and heals Kyra', mockGame);
    expect(formatted).toContain('<span class="log-friendly">Valeros</span>');
    expect(formatted).toContain('<span class="log-friendly">Kyra</span>');
  });

  it('highlights enemy names in dark red (.log-enemy)', () => {
    const formatted = formatLogMessage('Goblin Boss strikes at Valeros', mockGame);
    expect(formatted).toContain('<span class="log-enemy">Goblin Boss</span>');
    expect(formatted).toContain('<span class="log-friendly">Valeros</span>');
  });

  it('highlights damage numbers, abilities, rolls, and healing values', () => {
    const text = 'Kyra casts Cure Wounds on Valeros (+14 HP). Goblin Boss hits for 8 slashing damage (d20+4 = 17 vs AC 15) (crit!)';
    const formatted = formatLogMessage(text, mockGame);

    expect(formatted).toContain('<span class="log-ability">Cure Wounds</span>');
    expect(formatted).toContain('<span class="log-heal-val">+14 HP</span>');
    expect(formatted).toContain('<span class="log-enemy">Goblin Boss</span>');
    expect(formatted).toContain('<span class="log-dmg">8 slashing damage</span>');
    expect(formatted).toContain('<span class="log-roll-detail">d20+4 = 17 vs AC 15</span>');
    expect(formatted).toContain('<span class="log-crit-tag">crit!</span>');
  });

  it('highlights status conditions', () => {
    const text = 'Skeleton Archer makes Kyra rattled';
    const formatted = formatLogMessage(text, mockGame);
    expect(formatted).toContain('<span class="log-enemy">Skeleton Archer</span>');
    expect(formatted).toContain('<span class="log-status">rattled</span>');
  });

  it('updates pause button text and state when paused', () => {
    const btn = document.getElementById('log-pause-btn');

    mockGame.setPaused(true);
    expect(btn.classList.contains('paused')).toBe(true);
    expect(btn.innerHTML).toContain('Resume');

    mockGame.setPaused(false);
    expect(btn.classList.contains('paused')).toBe(false);
    expect(btn.innerHTML).toContain('Pause');
  });

  /* ── verbosity categories (Options menu → Combat Log) ──────────────────
   * Suppression itself is CSS (see game.css / settings.applyLogClasses); what
   * log() must guarantee is that every line carries the right category class
   * and that roll math lands in its own .lg-detail span so it can be hidden
   * without losing the readable summary. */
  describe('verbosity classes', () => {
    const lastLine = () => {
      const box = document.getElementById('gamelog');
      return box.children[box.children.length - 1];
    };

    it('tags attack results as the hit/miss category', () => {
      log('Valeros hits', 'roll');
      expect(lastLine().className).toContain('lg-hitmiss');
      log('Valeros misses', 'miss');
      expect(lastLine().className).toContain('lg-hitmiss');
      log('Valeros crits', 'crit');
      expect(lastLine().className).toContain('lg-hitmiss');
    });

    it('tags healing, buffs and enemy deaths as their own categories', () => {
      log('healed up', 'heal');
      expect(lastLine().className).toContain('lg-heal');
      log('shield up', 'buff');
      expect(lastLine().className).toContain('lg-effect');
      log('slain', 'kill');
      expect(lastLine().className).toContain('lg-death');
      log('boss slain', 'boss');
      expect(lastLine().className).toContain('lg-death');
    });

    it('never categorises system, story or hero-down lines (always visible)', () => {
      for (const kind of ['sys', 'story', 'down']) {
        log('important', kind);
        expect(lastLine().className).not.toContain('lg-');
      }
    });

    it('an explicit cat overrides the kind', () => {
      /* a monster crit uses the "down" style but is still a hit/miss line */
      log('Goblin Boss hits hard', 'down', { cat: 'hitmiss' });
      expect(lastLine().className).toContain('lg-hitmiss');
    });

    it('puts roll math in a separate .lg-detail span, not the summary', () => {
      log('Valeros -> Goblin Boss: hit, 8 dmg', 'roll', { detail: '(14+7 vs AC 15)' });
      const line = lastLine();
      /* the summary text is the line's own innerHTML; the detail is a child */
      expect(line.innerHTML).not.toContain('vs AC 15');
      expect(line.children).toHaveLength(1);
      expect(line.children[0].className).toBe('lg-detail');
      expect(line.children[0].innerHTML).toContain('vs AC 15');
    });

    it('adds no detail span when no detail is supplied', () => {
      log('plain line', 'roll');
      expect(lastLine().children).toHaveLength(0);
    });
  });

  it('pins scroll position when user is scrolled up in combat log', () => {
    const box = document.getElementById('gamelog');

    // Scrolled up: scrollHeight = 500, clientHeight = 100, scrollTop = 100
    // distance from bottom = 500 - 100 - 100 = 300 (> 35)
    box.scrollHeight = 500;
    box.clientHeight = 100;
    box.scrollTop = 100;

    log('Testing scrolled up message', 'roll');

    // Should NOT jump scrollTop to 500 (scrollHeight)
    expect(box.scrollTop).toBe(100);

    // User scrolls near bottom: distance from bottom = 500 - 380 - 100 = 20 (< 35)
    box.scrollTop = 380;
    log('Testing scrolled to bottom message', 'roll');

    // Should auto-scroll to bottom
    expect(box.scrollTop).toBe(500);
  });
});
