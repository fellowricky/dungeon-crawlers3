import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSlotKey, getActiveSlot, setActiveSlot, loadSlotRaw, saveSlotRaw,
  deleteSaveSlot, getSaveSlotInfo, listSaveSlots, hasAnySave, getMostRecentSaveSlot
} from '../src/game/save_slots.js';
import { SAVE_KEY, SAVE_SLOT_PREFIX, ACTIVE_SLOT_KEY } from '../src/game/constants.js';
import { inventoryMethods } from '../src/game/inventory.js';

function createLocalStorageMock() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
}

describe('Multi-Slot Save Game Engine', () => {
  beforeEach(() => {
    globalThis.localStorage = createLocalStorageMock();
  });

  it('should generate correct slot keys and manage active slot', () => {
    expect(getSlotKey(1)).toBe(`${SAVE_SLOT_PREFIX}1`);
    expect(getSlotKey(3)).toBe(`${SAVE_SLOT_PREFIX}3`);
    expect(getSlotKey(5)).toBe(`${SAVE_SLOT_PREFIX}5`);

    // Clamping checks
    expect(getSlotKey(0)).toBe(`${SAVE_SLOT_PREFIX}1`);
    expect(getSlotKey(99)).toBe(`${SAVE_SLOT_PREFIX}5`);

    // Default active slot is 1
    expect(getActiveSlot()).toBe(1);

    setActiveSlot(3);
    expect(getActiveSlot()).toBe(3);
    expect(globalThis.localStorage.getItem(ACTIVE_SLOT_KEY)).toBe('3');
  });

  it('should isolate saves across different slots without cross-contamination', () => {
    const party1 = {
      heroes: [{ name: 'Aldric', classKey: 'fighter', level: 3, hp: 30, maxHp: 30 }],
      gold: 150,
      dungeonLevel: 2
    };

    const party2 = {
      heroes: [{ name: 'Wren', classKey: 'wizard', level: 5, hp: 20, maxHp: 20 }],
      gold: 500,
      dungeonLevel: 4
    };

    saveSlotRaw(1, party1);
    saveSlotRaw(2, party2);

    const loaded1 = loadSlotRaw(1);
    const loaded2 = loadSlotRaw(2);
    const loaded3 = loadSlotRaw(3);

    expect(loaded1).toBeDefined();
    expect(loaded1.heroes[0].name).toBe('Aldric');
    expect(loaded1.gold).toBe(150);

    expect(loaded2).toBeDefined();
    expect(loaded2.heroes[0].name).toBe('Wren');
    expect(loaded2.gold).toBe(500);

    expect(loaded3).toBeNull();
  });

  it('should automatically migrate legacy unslotted saves into Slot 1', () => {
    const legacySave = {
      heroes: [{ name: 'ClassicHero', classKey: 'cleric', level: 2 }],
      gold: 75,
      dungeonLevel: 1
    };

    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(legacySave));

    // Slot 1 is initially empty in slot storage
    expect(globalThis.localStorage.getItem(`${SAVE_SLOT_PREFIX}1`)).toBeNull();

    // Loading slot 1 should migrate and return the legacy save
    const loaded = loadSlotRaw(1);
    expect(loaded).toBeDefined();
    expect(loaded.heroes[0].name).toBe('ClassicHero');
    expect(loaded.slotId).toBe(1);

    // Verify it was persisted to slot 1 key
    expect(globalThis.localStorage.getItem(`${SAVE_SLOT_PREFIX}1`)).not.toBeNull();
  });

  it('should correctly format slot metadata via listSaveSlots and getSaveSlotInfo', () => {
    const partyData = {
      heroes: [
        { name: 'Thoradin', raceKey: 'dwarf', classKey: 'cleric', level: 4, hp: 35, maxHp: 35 },
        { name: 'Sariel', raceKey: 'elf', classKey: 'wizard', level: 4, hp: 22, maxHp: 22 }
      ],
      leaderIdx: 0,
      gold: 320,
      activeQuest: { name: 'Crypt of Sorrows', floors: 3 },
      questFloor: 2
    };

    saveSlotRaw(2, partyData);

    const slotList = listSaveSlots();
    expect(slotList.length).toBe(5);

    // Slot 1 is empty
    expect(slotList[0].slotId).toBe(1);
    expect(slotList[0].empty).toBe(true);

    // Slot 2 is occupied
    expect(slotList[1].slotId).toBe(2);
    expect(slotList[1].empty).toBe(false);
    expect(slotList[1].leader.name).toBe('Thoradin');
    expect(slotList[1].heroes.length).toBe(2);
    expect(slotList[1].gold).toBe(320);
    expect(slotList[1].locationText).toContain('Crypt of Sorrows');
    expect(slotList[1].locationText).toContain('Floor 2/3');

    // Slot 3, 4, 5 are empty
    expect(slotList[2].empty).toBe(true);
    expect(slotList[3].empty).toBe(true);
    expect(slotList[4].empty).toBe(true);
  });

  it('should find the most recent save slot by timestamp', () => {
    expect(hasAnySave()).toBe(false);
    expect(getMostRecentSaveSlot()).toBeNull();

    saveSlotRaw(1, { heroes: [{ name: 'A' }] });
    // Simulate older save
    const slot1Data = loadSlotRaw(1);
    slot1Data.updatedAt = 1000;
    globalThis.localStorage.setItem(getSlotKey(1), JSON.stringify(slot1Data));

    saveSlotRaw(3, { heroes: [{ name: 'C' }] });
    const slot3Data = loadSlotRaw(3);
    slot3Data.updatedAt = 2000;
    globalThis.localStorage.setItem(getSlotKey(3), JSON.stringify(slot3Data));

    expect(hasAnySave()).toBe(true);
    expect(getMostRecentSaveSlot()).toBe(3);
  });

  it('should delete save slots cleanly', () => {
    saveSlotRaw(1, { heroes: [{ name: 'Hero1' }] });
    saveSlotRaw(2, { heroes: [{ name: 'Hero2' }] });

    expect(loadSlotRaw(1)).not.toBeNull();
    expect(loadSlotRaw(2)).not.toBeNull();

    deleteSaveSlot(1);
    expect(loadSlotRaw(1)).toBeNull();
    expect(loadSlotRaw(2)).not.toBeNull();
  });

  it('should integrate saveGame and loadSave on inventory methods with slotId parameter', () => {
    const fakeGame = {
      ...inventoryMethods,
      activeSaveSlot: 2,
      heroes: [{ temp: false, companion: false, data: { name: 'Garrick', classKey: 'rogue', level: 1 } }],
      inventory: [],
      gold: 50,
      potions: { heal: 1, greater: 0, superior: 0 },
      dungeonLevel: 1,
      afterGearChange: () => {},
      announceLevelUp: () => {}
    };

    // Save to active slot (2)
    fakeGame.saveGame();
    expect(loadSlotRaw(2)).toBeDefined();
    expect(loadSlotRaw(2).heroes[0].name).toBe('Garrick');

    // Save explicitly to slot 4
    fakeGame.heroes[0].data.name = 'Piotr';
    fakeGame.saveGame(4);
    expect(fakeGame.activeSaveSlot).toBe(4);
    expect(loadSlotRaw(4).heroes[0].name).toBe('Piotr');
    expect(loadSlotRaw(2).heroes[0].name).toBe('Garrick');

    // Load from slot 2
    const loadedFrom2 = fakeGame.loadSave(2);
    expect(loadedFrom2.heroes[0].name).toBe('Garrick');
    expect(fakeGame.activeSaveSlot).toBe(2);
  });
});

/* localStorage's per-origin quota is ~5 MB and the editors share it with the
   game. A save that no longer fits used to fail silently on every 5 s
   autosave — serialising the whole state each time (the hitch) and saving
   nothing. The failure must say what is big, and the autosave must back off. */
function createFullStorageMock(existing = {}) {
  const store = { ...existing };
  const quota = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; e.code = 22; return e; };
  return {
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i],
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { if (key.startsWith(SAVE_SLOT_PREFIX)) throw quota(); store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => {}
  };
}

describe('save quota failures', () => {
  let warnings;
  beforeEach(() => {
    warnings = [];
    globalThis.localStorage = createFullStorageMock({ dc_bestiary_monster_edits: 'x'.repeat(4096) });
    globalThis.console.warn = (...a) => warnings.push(a.map(String).join(' '));
  });

  it('throws a quota-flagged error and reports the largest fields and keys', () => {
    let err = null;
    try { saveSlotRaw(2, { heroes: [{ name: 'Vale', bag: 'y'.repeat(2048) }], gold: 5 }); }
    catch (e) { err = e; }
    expect(err).toBeTruthy();
    expect(err.quota).toBe(true);
    const report = warnings.find(w => w.includes('Largest fields'));
    expect(report).toBeTruthy();
    expect(report).toMatch(/heroes: 2\.\d KB/);
    expect(report).toMatch(/dc_bestiary_monster_edits: 4\.0 KB/);
  });

  it('the autosave stands down after a quota failure, explicit saves still try, and the player is told once', () => {
    const logs = [];
    const game = {
      ...inventoryMethods,
      elapsed: 100, heroes: [], inventory: [], gold: 0, potions: 0, dungeonLevel: 1,
      activeSaveSlot: 2
    };
    let attempts = 0;
    const ls = globalThis.localStorage;
    const origSet = ls.setItem;
    ls.setItem = (k, v) => { if (k.startsWith(SAVE_SLOT_PREFIX)) attempts++; return origSet(k, v); };
    game.saveGame();                       // periodic: fails, backs off
    expect(attempts).toBe(1);
    expect(game._saveQuotaFailedAt).toBe(100);
    game.elapsed = 130;
    game.saveGame();                       // periodic, inside the back-off: skipped
    expect(attempts).toBe(1);
    game.saveGame(2);                      // explicit: still tries (and re-arms the back-off)
    expect(attempts).toBe(2);
    expect(game._saveQuotaFailedAt).toBe(130);
    game.elapsed = 170;
    game.saveGame();                       // still inside the re-armed back-off
    expect(attempts).toBe(2);
    game.elapsed = 200;
    game.saveGame();                       // back-off elapsed: tries again
    expect(attempts).toBe(3);
  });
});

/* combat.js writes data.conc (targets are ENTITIES, zone holds THREE groups)
   and conditions.js mirrors data._effects (source/dotSrc are entities). An
   entity's .ent reaches the renderer, and JSON.stringify -> Object3D.toJSON
   turns every sprite sheet into a data URL: a 150 KB save became megabytes
   whenever a caster held Moonbeam. The save must carry names, never objects. */
describe('hero save records carry no runtime references', () => {
  const heavyEntity = (name) => ({
    data: { name },
    ent: { grp: { isObject3D: true, children: [{ isObject3D: true, material: { isMaterial: true, map: { isTexture: true, image: 'x'.repeat(100000) } } }] } }
  });

  it('heroSaveRecord keeps conc.key and effect sources by name only', async () => {
    const { heroSaveRecord } = await import('../src/game/inventory.js');
    const foe = heavyEntity('Ghoul');
    const d = {
      name: 'Vale', hp: 12,
      conc: { key: 'moonbeam', targets: [{ e: foe, key: 'moonbeam' }], zone: { visual: heavyEntity('zone').ent } },
      _effects: { drained: { applied: 3, tag: 'rest', source: foe, dotSrc: null }, burning: { applied: 4, source: foe, dotSrc: foe } },
      _queuedAction: 'attack'
    };
    const out = heroSaveRecord(d);
    expect(out.conc).toEqual({ key: 'moonbeam' });
    expect(out._effects.drained.source).toBe('Ghoul');
    expect(out._effects.burning.dotSrc).toBe('Ghoul');
    expect(out._queuedAction).toBeUndefined();
    expect(JSON.stringify(out).length).toBeLessThan(600);
    /* The live record is untouched — combat still needs its entities. */
    expect(d.conc.targets[0].e).toBe(foe);
    expect(d._effects.burning.source).toBe(foe);
  });

  it('saveSlotRaw drops any renderer object that still slips through', () => {
    globalThis.localStorage = createLocalStorageMock();
    const leaked = heavyEntity('Leak');
    saveSlotRaw(1, { heroes: [{ name: 'Vale', oops: leaked }] });
    const stored = globalThis.localStorage.getItem(getSlotKey(1));
    expect(stored.length).toBeLessThan(400);
    expect(JSON.parse(stored).heroes[0].oops.ent.grp).toBeUndefined();
  });
});

/* Export/import: a save leaves as a self-describing JSON file and comes back
   through the same slot write as any other save, so load-time migration
   applies. The parser refuses anything that is not a save with a party. */
describe('save export and import', () => {
  beforeEach(() => { globalThis.localStorage = createLocalStorageMock(); });

  it('exports an occupied slot as a named file and nothing for an empty one', async () => {
    const { exportSlotFile } = await import('../src/game/save_slots.js');
    expect(exportSlotFile(3)).toBeNull();
    saveSlotRaw(3, { heroes: [{ name: "Vale O'Brien", level: 4, classKey: 'ranger' }], gold: 12 });
    const out = exportSlotFile(3);
    expect(out.filename).toMatch(/^dungeon-crawlers-vale-o-brien-slot3-\d{4}-\d{2}-\d{2}\.json$/);
    const env = JSON.parse(out.text);
    expect(env.format).toBe('dungeon-crawlers-save');
    expect(env.data.heroes[0].name).toBe("Vale O'Brien");
    expect(env.data.gold).toBe(12);
  });

  it('round-trips into another slot, and reads a bare save object too', async () => {
    const { exportSlotFile, parseSaveFile, importSaveInto } = await import('../src/game/save_slots.js');
    saveSlotRaw(1, { heroes: [{ name: 'Vale', level: 4, classKey: 'ranger' }], gold: 12 });
    const file = parseSaveFile(exportSlotFile(1).text);
    expect(file.heroes).toEqual([{ name: 'Vale', level: 4, classKey: 'ranger' }]);
    expect(file.sourceSlot).toBe(1);
    importSaveInto(2, file);
    const back = loadSlotRaw(2);
    expect(back.slotId).toBe(2);
    expect(back.gold).toBe(12);
    /* The source slot is untouched. */
    expect(loadSlotRaw(1).slotId).toBe(1);

    const bare = parseSaveFile(JSON.stringify({ heroes: [{ name: 'Ash', level: 2 }], gold: 3 }));
    expect(bare.heroes[0]).toEqual({ name: 'Ash', level: 2, classKey: '' });
  });

  it('refuses files that are not saves, with a reason the player can read', async () => {
    const { parseSaveFile } = await import('../src/game/save_slots.js');
    expect(() => parseSaveFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseSaveFile('{"gold": 5}')).toThrow(/no party/);
    expect(() => parseSaveFile(JSON.stringify({ format: 'dungeon-crawlers-save', version: 99, data: { heroes: [{}] } }))).toThrow(/newer version/);
  });
});
