import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { generateDungeon, TYPE } from '../src/dungeon/dungeon_generator.js';
import { MONSTERS_BY_ID } from '../src/game/srd.js';

/* The tutorial: a 3-floor guided quest offered to every new party. */
describe('tutorial', () => {
  beforeEach(() => {
    let store = {};
    globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  });

  it('is one overland floor then two ancient floors, at level 1, with no quest reward', async () => {
    const { makeTutorialQuest } = await import('../src/game/tutorial.js');
    const q = makeTutorialQuest();
    expect(q.tutorial).toBe(true);
    expect(q.level).toBe(1);
    expect(q.floors).toBe(3);
    expect(q.floorPlan.map(f => [f.mapKind, f.theme])).toEqual([
      ['overland', 'forest'], ['dungeon', 'ancient'], ['dungeon', 'ancient']
    ]);
    expect(q.rewardGold).toBe(0);
    expect(q.rewardXp).toBe(0);
    expect(q.rewardItem).toBeNull();
    /* a fresh object each time: running quests are mutated */
    expect(makeTutorialQuest()).not.toBe(q);
  });

  it('fields only real, animated creatures, and Grik is the boss', async () => {
    const { makeTutorialQuest } = await import('../src/game/tutorial.js');
    const q = makeTutorialQuest();
    const ids = new Set([q.finalBossId]);
    for (const f of q.floorPlan) for (const lane of Object.values(f.monsters)) lane.forEach(id => ids.add(id));
    for (const id of ids) {
      const m = MONSTERS_BY_ID[id];
      expect(m, id).toBeTruthy();
      expect(!!(m.animations && (m.animations.idle || m.animations.attack)), `${id} animated`).toBe(true);
    }
    expect(q.floorPlan[2].monsters.boss).toEqual([q.finalBossId]);
  });

  it('floor 2 forges a treasure room from the quest seed', async () => {
    const { makeTutorialQuest } = await import('../src/game/tutorial.js');
    const q = makeTutorialQuest();
    /* same seed and room count _loadFloor asks the engine for on floor 2 */
    const seed = (q.seed + 1 * 9973) >>> 0;
    const d = generateDungeon(seed, {
      seed, roomCount: 14, loopChance: 0.18, decorDensity: 1,
      themeKey: 'ancient', threatMult: q.threatMult, level: 1
    });
    expect(d.rooms.some(r => r.type === TYPE.TREASURE)).toBe(true);
  });

  it('has text for every tip the game fires', async () => {
    const { TIPS } = await import('../src/game/help_ui.js');
    const { TUTORIAL_CARDS } = await import('../src/game/tutorial.js');
    const dir = new URL('../src/game/', import.meta.url);
    const fired = new Set();
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/firstRunTip\('(\w+)'\)/g)) fired.add(m[1]);
    }
    expect(fired.size).toBeGreaterThan(10);
    for (const key of fired) {
      expect(!!(TIPS[key] || TUTORIAL_CARDS[key]), key).toBe(true);
    }
    for (const card of Object.values(TUTORIAL_CARDS)) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.body.length).toBeGreaterThan(20);
    }
  });

  it('claims tips as cards while running, and leaves them as toasts otherwise', async () => {
    const { initTutorial } = await import('../src/game/tutorial.js');
    const { firstRunTip, onTip } = await import('../src/game/help_ui.js');
    const game = { activeQuest: null, paused: false, setPaused(p) { this.paused = p; } };
    initTutorial(game);
    const toasts = [];
    onTip(key => toasts.push(key));

    /* no tutorial: the ordinary one-shot toast */
    expect(firstRunTip('chest')).toBe(true);
    expect(toasts).toEqual(['chest']);

    /* in the tutorial: a card instead, even for a tip already seen */
    game.activeQuest = { tutorial: true };
    expect(firstRunTip('chest')).toBe(true);
    expect(firstRunTip('crawl')).toBe(true);        // tutorial-only card
    expect(toasts).toEqual(['chest']);

    /* tutorial-only cards never toast outside it */
    game.activeQuest = null;
    expect(firstRunTip('crawl')).toBe(false);
  });

  it('has a proficient, real upgrade for every class', async () => {
    const { TUTORIAL_UPGRADES } = await import('../src/game/tutorial.js');
    const { STARTER_GEAR, canEquip } = await import('../src/game/srd.js');
    const { rollItem } = await import('../src/game/items.js');
    /* every class a player can create — STARTER_GEAR has exactly those */
    for (const classKey of Object.keys(STARTER_GEAR)) {
      const pick = TUTORIAL_UPGRADES[classKey];
      expect(pick, classKey).toBeTruthy();
      const it = rollItem(1, Math.random, pick.slot, { baseKey: pick.baseKey, forceRarity: 'uncommon', ilvl: 1 });
      expect(it && it.baseKey, classKey).toBe(pick.baseKey);
      expect(canEquip({ classKey, feats: [], level: 1 }, it), `${classKey} can use ${pick.baseKey}`).toBe(true);
    }
  });

  it('the first chest holds one upgrade per hero, once', async () => {
    const { tutorialGearChest, isTutorialGearChest, makeTutorialQuest } = await import('../src/game/tutorial.js');
    const { rollItem } = await import('../src/game/items.js');
    const game = {
      activeQuest: makeTutorialQuest(), questFloor: 1,
      heroes: [
        { data: { classKey: 'fighter' } }, { data: { classKey: 'wizard' } },
        { data: { classKey: 'rogue' } }, { companion: true, data: { classKey: 'fighter' } }
      ]
    };
    expect(isTutorialGearChest(game)).toBe(true);
    const items = tutorialGearChest(game, rollItem);
    expect(items.map(i => i.baseKey)).toEqual(['Longsword', 'Wand', 'Shortsword']);
    expect(items.every(i => i.rarity === 'uncommon')).toBe(true);
    /* the flag rides the quest (and so the save) */
    expect(game.activeQuest.gearChestOpened).toBe(true);
    expect(isTutorialGearChest(game)).toBe(false);
    expect(isTutorialGearChest({ ...game, activeQuest: makeTutorialQuest(), questFloor: 2 })).toBe(false);
  });

  it('runs a held-back screen straight away when no card is waiting', async () => {
    const { whenCardsIdle } = await import('../src/game/tutorial.js');
    let ran = false;
    whenCardsIdle(() => { ran = true; });
    expect(ran).toBe(true);
  });

  it('has the cards from the playtest notes, and no loot wheel anywhere', async () => {
    const { TUTORIAL_CARDS } = await import('../src/game/tutorial.js');
    const { TIPS, HELP_TABS } = await import('../src/game/help_ui.js');
    for (const k of ['startLevelUp', 'equipGear', 'roomSearched', 'partyWipe']) expect(TUTORIAL_CARDS[k], k).toBeTruthy();
    expect(TUTORIAL_CARDS.crawl.body).toMatch(/manual/i);
    expect(TUTORIAL_CARDS.crawl.body).toMatch(/Exit/);
    expect(TUTORIAL_CARDS.potion.body).toMatch(/out of turn/);
    const all = JSON.stringify([TUTORIAL_CARDS, TIPS, HELP_TABS]);
    expect(all).not.toMatch(/loot wheel|spin the|spins the/i);
  });

  it('forces the first camp challenge and teaches AI Priorities at the second camp', async () => {
    const { tutorialForcesCampChallenge, tutorialIsAiCamp } = await import('../src/game/tutorial.js');
    const at = floor => ({ activeQuest: { tutorial: true }, questFloor: floor });
    /* finishDungeon has already advanced questFloor when the camp opens */
    expect(tutorialForcesCampChallenge(at(2))).toBe(true);
    expect(tutorialForcesCampChallenge(at(3))).toBe(false);
    expect(tutorialIsAiCamp(at(3))).toBe(true);
    expect(tutorialIsAiCamp(at(2))).toBe(false);
    expect(tutorialForcesCampChallenge({ activeQuest: { story: true }, questFloor: 2 })).toBe(false);
  });
});
