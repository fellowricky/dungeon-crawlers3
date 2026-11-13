import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showLoadingScreen, hideLoadingScreen, updateLoadingProgress, advanceLoadingMarch, loadingMarch, loadingPlateUrl, marcherLayout, revealLoadingMap, scheduleAfterPaint, MIN_LOADING_TIME_MS, MARCH_FULL_MS } from '../src/ui/loading_screen.js';

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
      },
      addEventListener(type, fn) {
        (this._listeners || (this._listeners = {}))[type] = fn;
      },
      dispatchEvent(type) {
        const fn = this._listeners && this._listeners[type];
        if (fn) fn();
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
    expect(overlay.attributes['data-theme']).toBe('');
    expect(overlay.style.backgroundImage).toBe('');
  });

  it('Default MIN_LOADING_TIME_MS is 1400ms', () => {
    expect(MIN_LOADING_TIME_MS).toBe(1400);
  });

  it('Reports progress without snapping the party across the screen', () => {
    showLoadingScreen({ title: 'DEPTH 4' });
    const subtitle = global.document.getElementById('dungeon-loading-subtitle');
    const party = global.document.getElementById('dungeon-loading-party');

    expect(party).not.toBeNull();
    expect(loadingMarch()).toEqual({ shown: 0, target: 0 });

    updateLoadingProgress(70, 'Composing party hero sprites...');
    expect(subtitle.textContent).toBe('Composing party hero sprites...');
    expect(loadingMarch().target).toBe(70);
    expect(loadingMarch().shown).toBe(0);

    /* A stalled frame must not spend the whole stall walking. dt is capped,
       so a jump to 70% is crossed over many steps, not one. */
    const step = advanceLoadingMarch(2);
    const capped = 100 / (MARCH_FULL_MS / 1000) * 0.05;
    expect(step).toBeCloseTo(capped, 5);
    expect(step).toBeLessThan(70);

    for (let i = 0; i < 80; i++) advanceLoadingMarch(0.05);
    expect(loadingMarch().shown).toBe(70);
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

  it('Maps each playable floor to a still plate', () => {
    expect(loadingPlateUrl('ancient')).toBe('./art/loading/ancient.webp');
    expect(loadingPlateUrl('verdant')).toBe('./art/loading/verdant.webp');
    expect(loadingPlateUrl('frost')).toBe('./art/loading/frost.webp');
    expect(loadingPlateUrl('grim')).toBe('./art/loading/grim.webp');
    expect(loadingPlateUrl('molten')).toBe('./art/loading/molten.webp');
    expect(loadingPlateUrl('forest', 'night')).toBe('./art/loading/forest_night.webp');
    expect(loadingPlateUrl('holdfast', 'dusk')).toBe('./art/loading/holdfast_dusk.webp');
    expect(loadingPlateUrl('ashfield')).toBe('./art/loading/ashfield_day.webp');
    expect(loadingPlateUrl('sporewood', 'day')).toBe('./art/loading/sporewood_day.webp');
    expect(loadingPlateUrl('sea')).toBe('');
    expect(loadingPlateUrl('')).toBe('');
  });

  it('Keeps oversize weapon sheets at the same body size', () => {
    expect(marcherLayout(64)).toEqual({ width: 112, height: 112, drop: 0 });
    expect(marcherLayout(128)).toEqual({ width: 224, height: 224, drop: 56 });
    expect(marcherLayout(192, 1, 1)).toEqual({ width: 336, height: 336, drop: 112 });
    /* A shorter race still stands on the line; only the body shrinks. */
    expect(marcherLayout(64, 1.15, 0.85)).toEqual({ width: 129, height: 95, drop: 0 });
  });

  it('Paints the plate for the floor theme', () => {
    showLoadingScreen({ title: 'ASH WASTE', theme: 'ashfield', timeOfDay: 'dusk' });
    const overlay = global.document.getElementById('dungeon-loading-overlay');
    expect(overlay.attributes['data-theme']).toBe('ashfield');
    expect(overlay.attributes['data-time']).toBe('dusk');
    expect(overlay.style.backgroundImage).toBe('url("./art/loading/ashfield_dusk.webp")');
  });

  it('Plays a loop over the still and drops it when the file fails', async () => {
    showLoadingScreen({ title: 'WOODS', theme: 'forest', timeOfDay: 'night' });
    const overlay = global.document.getElementById('dungeon-loading-overlay');
    const video = global.document.getElementById('dungeon-loading-plate');
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    /* The still is requested first. The loop waits a turn so it cannot
       cut in front of the picture. */
    expect(video.attributes.src || '').toBe('');
    expect(overlay.style.backgroundImage).toBe('url("./art/loading/forest_night.webp")');
    await Promise.resolve();
    expect(video.attributes.src).toBe('./art/loading/forest_night.mp4');
    expect(video.style.display).toBe('none');
    video.dispatchEvent('loadeddata');
    expect(video.style.display).not.toBe('none');

    let plays = 0;
    video.play = () => {
      plays += 1;
      return { catch() {} };
    };
    showLoadingScreen({ title: 'WOODS', theme: 'forest', timeOfDay: 'night' });
    await Promise.resolve();
    expect(video.attributes.src).toBe('./art/loading/forest_night.mp4');
    expect(plays).toBe(1);

    showLoadingScreen({ title: 'HEATH', theme: 'moor', timeOfDay: 'dusk' });
    await Promise.resolve();
    expect(video.attributes.src).toBe('./art/loading/moor_dusk.mp4');
    expect(plays).toBe(2);

    video.dispatchEvent('error');
    expect(video.attributes.src).toBe('');
    expect(video.style.display).toBe('none');
    expect(overlay.style.backgroundImage).toBe('url("./art/loading/moor_dusk.webp")');

    showLoadingScreen({ title: 'OPEN SEA', theme: 'sea' });
    expect(overlay.style.backgroundImage).toBe('');
    expect(video.style.display).toBe('none');
    expect(video.attributes.src).toBe('');
  });

  it('Holds the rest of the load until the still has decoded', async () => {
    const imgs = [];
    function FakeImage() { imgs.push(this); }
    FakeImage.prototype.setAttribute = function () {};
    Object.defineProperty(FakeImage.prototype, 'src', { set() {} });
    global.Image = FakeImage;
    const prevRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = undefined;
    try {
      let ran = false;
      showLoadingScreen({ title: 'HEATH', theme: 'moor', timeOfDay: 'day' });
      scheduleAfterPaint(() => { ran = true; });
      await Promise.resolve();
      await Promise.resolve();
      expect(ran).toBe(false);
      expect(imgs).toHaveLength(1);
      imgs[0].onload();
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(ran).toBe(true);
    } finally {
      delete global.Image;
      global.requestAnimationFrame = prevRaf;
    }
  });

  it('Puts the next map and the floor progress on the title card', () => {
    showLoadingScreen({
      title: 'THE MISSING HERD',
      subtitle: 'Preparing encounters...',
      map: 'Longbarrow Moor — The Drove-road',
      mapLock: true,
      floor: 2,
      floors: 5
    });

    const map = global.document.getElementById('dungeon-loading-map');
    const floor = global.document.getElementById('dungeon-loading-floor');
    const pips = global.document.getElementById('dungeon-loading-pips');
    const title = global.document.getElementById('dungeon-loading-title');
    expect(map.textContent).toBe('Longbarrow Moor — The Drove-road');
    expect(floor.textContent).toBe('Floor 2 of 5');
    expect(pips.children.map(p => p.className)).toEqual([
      'dungeon-loading-pip is-done',
      'dungeon-loading-pip is-now',
      'dungeon-loading-pip',
      'dungeon-loading-pip',
      'dungeon-loading-pip'
    ]);
    expect(title.classList.contains('is-echo')).toBe(false);

    revealLoadingMap('The Silent Halls of Mal’goth');
    expect(map.textContent).toBe('Longbarrow Moor — The Drove-road');

    showLoadingScreen({
      title: 'A RANDOM DELVE',
      map: 'Greyfell',
      floor: 3,
      floors: 4
    });
    expect(map.textContent).toBe('Greyfell');
    expect(floor.textContent).toBe('Floor 3 of 4');
    revealLoadingMap('The Silent Halls of Mal’goth');
    expect(map.textContent).toBe('The Silent Halls of Mal’goth');
    expect(floor.textContent).toBe('Floor 3 of 4');
  });

  it('Keeps the walk cycle on a CSS clock, apart from the slide', async () => {
    const orig = global.document.createElement;
    global.document.createElement = (tag) => {
      const el = orig(tag);
      el.getContext = () => {
        if (!el._ctx) {
          el._ctx = {
            imageSmoothingEnabled: true,
            drawImage(...args) { (el._draws || (el._draws = [])).push(args); }
          };
        }
        return el._ctx;
      };
      return el;
    };

    const hero = {
      data: { hp: 12 },
      ent: { anim: { textures: { walk: { image: { width: 576, height: 256 }, _cell: 64 } } } }
    };
    const second = {
      data: { hp: 12 },
      ent: { anim: { textures: { walk: { image: { width: 576, height: 256 }, _cell: 64 } } } }
    };
    showLoadingScreen({ title: 'WOODS', party: [hero, second] });

    const party = global.document.getElementById('dungeon-loading-party');
    const frames = party.children;
    expect(frames).toHaveLength(2);
    const strip = frames[0].children[0];
    const other = frames[1].children[0];
    expect(strip.className).toBe('dungeon-loading-strip');
    expect(strip.style.animationName).toBe('dungeon-loading-walk');
    expect(strip.style.animationDuration).toBe('1s');
    expect(strip.style.animationTimingFunction).toBe('steps(8, end)');
    expect(strip.style.animationIterationCount).toBe('infinite');
    expect(strip.style.animationDelay).toBe('0s');
    expect(other.style.animationDelay).toBe('-0.13s');

    await Promise.resolve();

    const canvas = strip.children[0];
    expect(canvas._draws).toHaveLength(8);
    expect(canvas._draws[0].slice(1, 5)).toEqual([64, 192, 64, 64]);
    expect(canvas._draws[7].slice(1, 5)).toEqual([512, 192, 64, 64]);
    expect(canvas._draws[0].slice(5)).toEqual([0, 0, 64, 64]);
    expect(canvas._draws[7].slice(5)).toEqual([448, 0, 64, 64]);
    expect(frames[0].style.width).toBe('112px');
    expect(strip.style.width).toBe('896px');

    advanceLoadingMarch(0.05);
    expect(canvas._draws).toHaveLength(8);
  });
});
