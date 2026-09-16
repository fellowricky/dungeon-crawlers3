import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showLoadingScreen, hideLoadingScreen, updateLoadingProgress, MIN_LOADING_TIME_MS } from '../src/ui/loading_screen.js';

describe('Dungeon Loading Screen Overlay', () => {
  let elementRegistry = new Map();

  function createMockElement(id = '', className = '') {
    const el = {
      id,
      className,
      textContent: '',
      innerHTML: '',
      style: {},
      attributes: {},
      children: [],
      classList: {
        _classes: new Set(className.split(' ').filter(Boolean)),
        add(...cls) { cls.forEach(c => this._classes.add(c)); },
        remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); }
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      appendChild(child) {
        this.children.push(child);
        if (child.id) elementRegistry.set(child.id, child);
      }
    };
    if (id) elementRegistry.set(id, el);
    return el;
  }

  beforeEach(() => {
    elementRegistry = new Map();
    global.document = {
      body: createMockElement('body'),
      getElementById: (id) => elementRegistry.get(id) || null,
      createElement: (tag) => createMockElement('', '')
    };
  });

  afterEach(() => {
    delete global.document;
  });

  it('Creates and displays loading screen on showLoadingScreen()', () => {
    showLoadingScreen({ title: 'THE SHATTERED KEEP', subtitle: 'Floor 1 of 3', floor: 1 });

    const overlay = global.document.getElementById('dungeon-loading-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('active')).toBe(true);
    expect(overlay.classList.contains('hidden')).toBe(false);

    const title = global.document.getElementById('dungeon-loading-title');
    const subtitle = global.document.getElementById('dungeon-loading-subtitle');
    expect(title.textContent).toBe('THE SHATTERED KEEP');
    expect(subtitle.textContent).toBe('Floor 1 of 3');
  });

  it('Default MIN_LOADING_TIME_MS is 1400ms', () => {
    expect(MIN_LOADING_TIME_MS).toBe(1400);
  });

  it('Updates loading progress percentage and status label', () => {
    showLoadingScreen({ title: 'DEPTH 4' });
    const percent = global.document.getElementById('dungeon-loading-percent');
    const subtitle = global.document.getElementById('dungeon-loading-subtitle');
    const fill = global.document.getElementById('dungeon-loading-bar-fill');

    expect(percent.textContent).toBe('0%');

    updateLoadingProgress(65, 'Loading spell VFX & cantrips...');
    expect(percent.textContent).toBe('65%');
    expect(subtitle.textContent).toBe('Loading spell VFX & cantrips...');
    expect(fill.style.width).toBe('65%');
  });

  it('Enforces minimum duration before hiding', () => {
    vi.useFakeTimers();
    showLoadingScreen({ title: 'DEPTH 4' });

    const overlay = global.document.getElementById('dungeon-loading-overlay');
    expect(overlay.classList.contains('active')).toBe(true);

    // Call hide immediately
    hideLoadingScreen();

    // At 500ms, it should still be active
    vi.advanceTimersByTime(500);
    expect(overlay.classList.contains('active')).toBe(true);

    // After 1900ms (1400ms min + 500ms fade), it should be hidden
    vi.advanceTimersByTime(1400);
    expect(overlay.classList.contains('hidden')).toBe(true);

    vi.useRealTimers();
  });

  it('Waits for readyPromise before hiding even after min duration elapses', async () => {
    showLoadingScreen({ title: 'DEPTH 5' });
    const overlay = global.document.getElementById('dungeon-loading-overlay');
    expect(overlay.classList.contains('active')).toBe(true);

    let resolveWarmup;
    const warmupPromise = new Promise(r => { resolveWarmup = r; });

    hideLoadingScreen(warmupPromise, 50);

    // Give microtasks time to execute without resolving warmupPromise
    await new Promise(r => setTimeout(r, 100));
    expect(overlay.classList.contains('active')).toBe(true);

    // Resolve warmupPromise
    resolveWarmup();
    await new Promise(r => setTimeout(r, 100));

    // Screen begins fade / hides
    expect(overlay.classList.contains('fade-out') || overlay.classList.contains('hidden')).toBe(true);
  });
});
