/**
 * Run one balance job inside the REAL game (browser, dev server).
 *
 * A job is: build a party at a level, embark on a real generated quest at a
 * chosen floor, and play that floor in fast-forward with the bot making the
 * level-up and gear choices. The game's own update() is stepped at a fixed
 * 1/60 s — the same as a steady 60 fps — as many times as fit in each slice,
 * and drawing is skipped. Nothing about the rules is stubbed or replaced.
 */
import { SIM } from '../../src/game/sim_flags.js';
import { GuildManager } from '../../src/game/guild.js';
import { buildPartyFrames, updateResources } from '../../src/game/ui.js';
import { generateQuests } from '../../src/game/quests.js';
import { addToInventory } from '../../src/game/items.js';
import { buildParty } from './party.js';
import { resolveProgression, autoEquip, describeHero, mulberry32 } from './bot.js';

const STEP = 1 / 60;
const SLICE_MS = 24;          // stepping per slice before yielding to timers/async
const TEND_EVERY = 90;        // steps between bot check-ins (1.5 game seconds)
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, what) {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > timeoutMs) throw new Error('timed out waiting for ' + what);
    await sleep(50);
  }
}

/* A yield that background/hidden pages do not throttle the way timers are. */
const chan = new MessageChannel();
let _resume = null;
chan.port1.onmessage = () => { const r = _resume; _resume = null; if (r) r(); };
const yieldNow = () => new Promise(r => { _resume = r; chan.port2.postMessage(0); });

function withSeededRandom(seed, fn) {
  const real = Math.random;
  Math.random = mulberry32(seed | 0);
  try { return fn(); } finally { Math.random = real; }
}

/** Pick the quest floor a job asks for: a number, or 'road' / 'dungeon' / 'boss'. */
function roadDays(q) { return Math.max(0, Math.min(q.floors - 1, (q.route && q.route.days) | 0)); }
function resolveFloor(q, want) {
  if (typeof want === 'number') return Math.max(1, Math.min(q.floors, want));
  const days = roadDays(q);                 // the first `days` floors are the overland road
  if (want === 'boss') return q.floors;
  if (want === 'road') return days ? 1 : 1;
  return Math.min(q.floors, days + 1);      // first floor of the dungeon itself
}

function launch(g, job) {
  const party = buildParty({ level: job.level, seed: job.partySeed, classes: job.classes, size: job.partySize });
  g.heroes = party.heroes.map(d => ({ data: d }));
  g.leaderIdx = 0;
  g.storedHeroes = []; g.townShopInventory = []; g.townTavernHirePool = [];
  g.gold = party.gold; g.potions = { heal: 0, greater: 0, superior: 0, ...party.potions };
  g.inventory = [];
  for (const it of party.bag) addToInventory(g.inventory, it, g);
  g.dungeonLevel = job.level;
  g.activeQuest = null; g.questFloor = 0;
  g.questChains = { active: [], log: [] };
  g.legendaryPity = 0; g.storyProgress = {};
  g.controlMode = 'auto';
  g.guild = new GuildManager(g);

  document.body.classList.remove('title-open');
  for (const id of ['titlescreen', 'worldmapscreen', 'setup', 'overlay', 'wm-sysmenu']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }
  buildPartyFrames(g.heroes.map(h => h.data));
  updateResources(g);
  if (typeof g.updateModeToggleUI === 'function') g.updateModeToggleUI();

  const q = withSeededRandom(job.questSeed, () => generateQuests(job.level, 1, { levelOffsets: [0] })[0]);
  if (job.theme) q.theme = job.theme;
  q.startFloor = resolveFloor(q, job.floor == null ? 'dungeon' : job.floor);
  g.startQuest(q);
  return { party, quest: q };
}

export async function runJob(job) {
  const g = window.__game;
  const errors = [];
  const onErr = e => errors.push(String((e && (e.error && e.error.stack || e.message || e.reason)) || e).slice(0, 500));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  const wall0 = performance.now();
  await waitFor(() => g && g.engine && g.state === 'boot' && document.getElementById('ts-new'), 120000, 'the title screen');
  await sleep(500);

  SIM.fast = job.fast !== false;            // job.fast:false keeps every picture-only pass, for A/B checks
  const { party, quest } = launch(g, job);
  const partyStart = party.heroes.map(describeHero);
  const picks = party.picks;
  await waitFor(() => g.state === 'crawl' && g.D && !g.engine.isAnimating(), 120000, 'the floor to load');
  const loadedMs = performance.now() - wall0;

  const realUpdate = g.update.bind(g);
  g.update = () => {};                       // the render loop keeps ticking; the driver owns game time
  const botRng = mulberry32((job.partySeed | 0) * 31 + 7);
  const api = {
    chooseSubclass: (h, k) => g.chooseSubclass(h, k), chooseFeature: (h, id, k) => g.chooseFeature(h, id, k),
    allocateAbility: (h, a) => g.allocateAbility(h, a), allocateSkill: (h, k) => g.allocateSkill(h, k),
    allocateSkillRank: (h, k) => g.allocateSkillRank(h, k),
  };
  const slotsLeft = d => d.slots ? Object.values(d.slots).reduce((a, b) => a + (b | 0), 0) : 0;
  const pots = () => Object.values(g.potions || {}).reduce((a, b) => a + (b | 0), 0);
  const xpSum = () => g.heroes.reduce((a, h) => a + (h.data.xp || 0), 0);
  const snap = () => g.heroes.map(h => ({ hp: Math.max(0, h.data.hp), max: h.data.maxHp, slots: slotsLeft(h.data) }));

  const startFloor = g.questFloor, floorsWanted = Math.max(1, job.floors || 1);
  const monstersTotal = g.monsters.length;
  const xp0 = xpSum(), gold0 = g.gold, pots0 = pots();
  const fights = []; const gearChanges = [];
  let cur = null, simT = g.elapsed || 0, steps = 0, stepMs = 0, outcome = null, cleared = 0, leftCrawl = false;
  const maxSteps = Math.round((job.maxGameMin || 60) * 60 / STEP);

  const closeFight = (wipe) => {
    const c = cur; cur = null;
    const s1 = snap();
    fights.push({
      floor: c.floor, rounds: c.rounds, gameSec: +(simT - c.t0).toFixed(1),
      foes: [...c.foes.values()], crSum: +[...c.foes.values()].reduce((a, f) => a + (+f.cr || 0), 0).toFixed(2),
      boss: [...c.foes.values()].some(f => f.boss),
      downs: c.downs, wipe: !!wipe,
      hp0: +(c.s0.reduce((a, h) => a + h.hp, 0) / c.s0.reduce((a, h) => a + h.max, 0)).toFixed(3),
      hp1: +(c.minHpSum / s1.reduce((a, h) => a + h.max, 0)).toFixed(3),
      slotsSpent: c.s0.reduce((a, h, i) => a + Math.max(0, h.slots - (s1[i] ? s1[i].slots : 0)), 0),
      potsUsed: Math.max(0, c.pots0 - pots()),
    });
  };
  const observe = () => {
    const active = !!(g.initiative && g.initiative.active);
    const allDown = g.heroes.every(h => h.data.hp <= 0);
    if (active && !cur) cur = { floor: g.questFloor, t0: simT, s0: snap(), pots0: pots(), foes: new Map(), downs: 0, wasDown: new Set(), rounds: 0, minHpSum: Infinity };
    if (cur) {
      for (const e of (g.initiative.order || [])) {
        if (e && e.data && !cur.foes.has(e) && g.monsters.includes(e)) cur.foes.set(e, { name: e.data.name, cr: e.data.cr, hp: e.data.maxHp || e.data.hp, boss: !!(e.isBoss || e.data.isBoss) });
      }
      cur.rounds = Math.max(cur.rounds, g.initiative.round | 0);
      let hpSum = 0;
      for (const h of g.heroes) {
        const down = h.data.hp <= 0; hpSum += Math.max(0, h.data.hp);
        if (down && !cur.wasDown.has(h)) { cur.wasDown.add(h); cur.downs++; }
        if (!down) cur.wasDown.delete(h);
      }
      cur.minHpSum = hpSum;               // HP as the fight stands now; the last value before it closes is the result
      if (allDown) { closeFight(true); outcome = 'wipe'; return; }
      if (!active) closeFight(false);
    } else if (allDown || g._deathChoiceOpen) outcome = 'wipe';
  };
  const tend = () => {
    if (g.state !== 'crawl' || (g.initiative && g.initiative.active)) return;
    for (const h of g.heroes) {
      const d = h.data;
      if (d.hp <= 0) continue;
      if ((d.pendingChoices || []).length || d.pendingAbility > 0 || d.pendingSkill > 0 || (d.pendingSkillRank || 0) > 0 || (d.level >= 3 && !d.subclass)) {
        (picks[d.name] || (picks[d.name] = [])).push(...resolveProgression(d, botRng, api));
      }
    }
    if (g.inventory && g.inventory.length !== tend.lastBag) {
      gearChanges.push(...autoEquip(g.heroes.map(h => h.data), () => g.inventory, (h, it) => { const r = g.equipItem(h, it); return r && r.ok; }));
      tend.lastBag = g.inventory.length;
    }
  };

  try {
    while (!outcome) {
      const t0 = performance.now();
      if (g.state === 'crawl') {
        while (performance.now() - t0 < SLICE_MS && !outcome) {
          simT += STEP; realUpdate(STEP, simT); steps++;
          observe();
          if (steps % TEND_EVERY === 0) tend();
          if (g.state !== 'crawl') break;
          if (steps >= maxSteps) outcome = 'timeout';
        }
        stepMs += performance.now() - t0;
        await yieldNow();
      } else {
        /* Between floors (camp, loading): let the game's own real-time flow run. */
        simT += STEP; realUpdate(STEP, simT);
        if (g.state === 'shop') {
          const shop = document.getElementById('shopscreen'), btn = document.getElementById('shop-descend');
          if (cleared < floorsWanted && shop && shop.classList.contains('show') && btn) btn.click();
        }
        await sleep(16);
      }
      /* A floor is cleared the moment the game leaves the crawl without a wipe
         (to the merchant camp, or to the world map after the last floor). */
      if (!outcome) {
        if (g.state !== 'crawl' && !leftCrawl) { leftCrawl = true; cleared++; }
        else if (g.state === 'crawl' && leftCrawl) leftCrawl = false;
        if (cleared >= floorsWanted || g.state === 'worldmap') outcome = 'cleared';
      }
      if (performance.now() - wall0 > (job.maxWallMin || 20) * 60000) outcome = 'walltime';
    }
  } catch (err) {
    errors.push(String(err && err.stack || err).slice(0, 800));
    outcome = 'error';
  }
  if (cur) closeFight(outcome === 'wipe');
  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);

  const end = snap();
  return {
    id: job.id, job, outcome,
    quest: { name: quest.name, theme: quest.theme, level: quest.level, floors: quest.floors, floor: startFloor,
      mapKind: startFloor <= roadDays(quest) ? 'overland' : 'dungeon', boss: startFloor === quest.floors,
      biome: (g.D && (g.D.themeKey || (g.D.params && g.D.params.themeKey))) || null, seed: quest.seed },
    gameMin: +(steps * STEP / 60).toFixed(2), wallSec: +((performance.now() - wall0) / 1000).toFixed(1),
    loadSec: +(loadedMs / 1000).toFixed(1), steps, stepMs: +(stepMs / Math.max(1, steps)).toFixed(3),
    speed: +((steps * STEP) / Math.max(0.001, stepMs / 1000)).toFixed(1),
    monstersTotal, kills: g.monsters ? Math.max(0, monstersTotal - g.monsters.filter(m => m.data && m.data.hp > 0).length) : null,
    xpGained: xpSum() - xp0, goldGained: g.gold - gold0, potsUsed: Math.max(0, pots0 - pots()),
    endHp: +(end.reduce((a, h) => a + h.hp, 0) / Math.max(1, end.reduce((a, h) => a + h.max, 0))).toFixed(3),
    downs: fights.reduce((a, f) => a + f.downs, 0),
    party: partyStart, partyEnd: g.heroes.map(h => describeHero(h.data)), picks, gearChanges, fights, errors,
  };
}
