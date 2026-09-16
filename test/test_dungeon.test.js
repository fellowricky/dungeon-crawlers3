import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Dungeon Theme & Level Test Launcher', () => {
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
        return child;
      },
      insertBefore(child, ref) {
        this.children.push(child);
        if (child.id) elementRegistry.set(child.id, child);
        return child;
      },
      addEventListener: vi.fn(),
      querySelector: (sel) => {
        const m = createMockElement();
        if (sel === '#dev-floors-select') m.value = '3';
        else if (sel === '#dev-seed-input') m.value = '4242';
        else if (sel === 'input[name="dev-party-choice"]:checked') m.value = 'scale';
        else if (sel === '#dev-reveal-map') m.checked = false;
        else if (sel === '#dev-god-mode') m.checked = false;
        else if (sel === '#dev-full-potions') m.checked = true;
        else if (sel === '#dev-level-input') m.value = '7';
        else if (sel === '#dev-level-slider') m.value = '7';
        return m;
      },
      querySelectorAll: () => []
    };
    if (id) elementRegistry.set(id, el);
    return el;
  }

  let testDungeonModule;

  beforeEach(async () => {
    elementRegistry = new Map();
    const body = createMockElement('body');
    const titlescreen = createMockElement('titlescreen');
    const tsMenu = createMockElement('', 'ts-menu');
    const tsNew = createMockElement('ts-new');
    titlescreen.appendChild(tsMenu);
    tsMenu.appendChild(tsNew);

    const hudRight = createMockElement('hud-top-right');
    const floorbadge = createMockElement('floorbadge');
    hudRight.appendChild(floorbadge);

    body.appendChild(titlescreen);
    body.appendChild(hudRight);

    global.document = {
      body,
      getElementById: (id) => elementRegistry.get(id) || null,
      querySelector: (sel) => {
        if (sel === '#titlescreen .ts-menu') return tsMenu;
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag) => createMockElement('', ''),
      addEventListener: vi.fn(),
      contains: (el) => true
    };
    global.window = {
      location: { search: '' }
    };

    testDungeonModule = await import('../src/game/test_dungeon.js');
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  it('exports ENABLE_DEV_TEST_DELVE as a master boolean flag', () => {
    expect(typeof testDungeonModule.ENABLE_DEV_TEST_DELVE).toBe('boolean');
    expect(testDungeonModule.ENABLE_DEV_TEST_DELVE).toBe(true);
  });

  it('injects the test delve button into the title screen menu', () => {
    const mockGame = {
      heroes: [],
      startQuest: vi.fn(),
      guild: null
    };

    testDungeonModule.initTestDungeon(mockGame);

    const tsBtn = global.document.getElementById('ts-test-delve');
    expect(tsBtn).not.toBeNull();
    expect(tsBtn.innerHTML).toContain('TEST DELVE');
  });

  it('injects the test delve HUD button', () => {
    const mockGame = {
      heroes: [],
      startQuest: vi.fn(),
      guild: null
    };

    testDungeonModule.initTestDungeon(mockGame);

    const hudBtn = global.document.getElementById('btn-dev-test-hud');
    expect(hudBtn).not.toBeNull();
    expect(hudBtn.innerHTML).toContain('Test');
  });

  it('opens and closes the modal correctly', () => {
    testDungeonModule.openTestDelveModal();
    const modal = global.document.getElementById('dev-test-delve-modal');
    expect(modal).not.toBeNull();
    expect(modal.style.display).toBe('flex');

    testDungeonModule.closeTestDelveModal();
    expect(modal.style.display).toBe('none');
  });

  it('launches a test delve quest with specified theme and level', () => {
    const startQuestMock = vi.fn();
    const mockGame = {
      heroes: [],
      startQuest: startQuestMock,
      guild: null,
      potions: {}
    };

    testDungeonModule.initTestDungeon(mockGame);

    testDungeonModule.launchTestDelve({
      theme: 'molten',
      level: 7,
      floors: 3,
      seed: 4242,
      partyChoice: 'scale',
      revealMap: false,
      godMode: false,
      fullPotions: true
    });

    expect(startQuestMock).toHaveBeenCalled();
    const passedQuest = startQuestMock.mock.calls[0][0];
    expect(passedQuest.theme).toBe('molten');
    expect(passedQuest.level).toBe(7);
    expect(passedQuest.floors).toBe(3);
    expect(passedQuest.seed).toBe(4242);
    expect(passedQuest.testDelve).toBe(true);
    expect(mockGame.potions.heal).toBe(99);
    expect(mockGame.heroes.length).toBe(4);
    expect(mockGame.heroes[0].data.level).toBe(7);
  });

  it('supports starting on specific floor and skipping overland maps', () => {
    const startQuestMock = vi.fn();
    const mockGame = {
      heroes: [],
      startQuest: startQuestMock,
      guild: null,
      potions: {}
    };

    testDungeonModule.initTestDungeon(mockGame);

    testDungeonModule.launchTestDelve({
      theme: 'frost',
      level: 10,
      startFloor: 3,
      floors: 5,
      skipPrologue: true,
      partyChoice: 'scale'
    });

    expect(startQuestMock).toHaveBeenCalled();
    const q = startQuestMock.mock.calls[0][0];
    expect(q.startFloor).toBe(3);
    expect(q.skipPrologue).toBe(true);
    expect(Array.isArray(q.floorPlan)).toBe(true);
    expect(q.floorPlan.length).toBe(5);
    expect(q.floorPlan[0].theme).toBe('frost');
    expect(q.floorPlan[0].mapKind).toBe('dungeon');
    // Verify hero visuals are populated
    expect(mockGame.heroes[0].data.visual).toBeDefined();
    expect(mockGame.heroes[0].data.visual.gender).toBe('male');
    expect(mockGame.heroes[0].data.visual.skinColor).toBeDefined();
  });
});
