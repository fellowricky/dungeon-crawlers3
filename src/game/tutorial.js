/**
 * The tutorial — a short guided quest offered to every new party.
 *
 * It is an ordinary story-style quest (fixed seed, authored cast per floor,
 * same contract startQuest / _loadFloor / completeQuest already consume) plus
 * a `tutorial: true` marker. While it runs, every first-run tip (help_ui.js
 * `firstRunTip`) is shown as a pausing card instead of a toast, and it is shown
 * every time the tutorial is played — a returning player starting a new party
 * gets the refresher too. Outside the tutorial, tips stay one-shot toasts.
 *
 *   floor 1  overland forest   the crawl, fog, the first fight, a chest
 *   camp     merchant camp     long rest, the camp challenge, the potion shop
 *   floor 2  ancient           a treasure room, a shrine, a skill challenge
 *   camp     merchant camp     tuning party AI (AI Priorities)
 *   floor 3  ancient           Grik, Kobold Chief
 *
 * No quest reward: the party keeps only what it finds on the way.
 */

import { setTipInterceptor, setReplayTutorial } from './help_ui.js';

/* menus.js drags in the whole DOM layer; load it only when a card needs it,
   so the quest data here stays importable from tests. */
const openPartyTab = tab => import('./menus.js').then(m => m.openMenu(tab));

export const TUTORIAL_QUEST_ID = 'tutorial';

/** A fresh copy each time — quest objects are mutated while they run. */
export function makeTutorialQuest() {
  return {
    id: TUTORIAL_QUEST_ID,
    story: true,          // authored-cast spawn path, no auto prologue
    tutorial: true,
    name: 'Learning the Ropes',
    siteName: 'The Grikvein Warren',
    place: 'Grikvein Warren',
    locType: 'Warren',
    theme: 'ancient',
    level: 1,
    floors: 3,
    seed: 20260929,
    /* Gentler than a story mission's default 1.3: fewer spawn points per
       room, so a fresh level-1 party of any make-up gets through. */
    threatMult: 0.8,
    finalBossId: 'kobold-chief',
    finalBossName: 'Grik, Kobold Chief',
    bossHpMult: 1.1,
    rewardGold: 0,
    rewardXp: 0,
    rewardItem: null,
    itemLevel: 1,
    floorPlan: [
      { mapKind: 'overland', theme: 'forest', name: 'The Road to the Warren',
        mapW: 58, mapH: 84, zones: 5,
        monsters: { 1: ['giant-rat', 'grey-rat'], 2: ['kobold-scrapper', 'kobold-slinger'] } },
      { mapKind: 'dungeon', theme: 'ancient', name: 'The Warren Gate',
        monsters: { 1: ['kobold-scrapper', 'giant-rat'], 2: ['kobold-slinger', 'kobold-shieldback'] } },
      { mapKind: 'dungeon', theme: 'ancient', name: "Grik's Hall",
        monsters: { 1: ['kobold-scrapper', 'kobold-slinger'], 2: ['kobold-shaman', 'kobold-shieldback', 'kobold-warden'],
                    boss: ['kobold-chief'] } }
    ],
    description:
      'A short guided run for a new company: a forest road, the gate of a kobold warren, ' +
      'and the kobold chief who holds it. Cards along the way explain each part of the game ' +
      'the first time it comes up.',
    embarkText:
      'The road out of the village runs into the trees. Somewhere past them, kobolds have ' +
      'dug into the old stone. A good first job for a company that has never worked together.',
    victoryText:
      'Grik is down and the warren is quiet. The company has done its first job, and the ' +
      'world map is waiting.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: false,
    storyChallenges: [
      {
        floor: 2,
        zone: 'combat',
        challenge: {
          name: 'The Rigged Tunnel', type: 'room', reward: { kind: 'potion' },
          desc: 'The kobolds have strung the next tunnel with tripwires and loose ceiling stones. Kobolds are small, weak and very good at this.',
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Spot the wires first',
              win: 'Every wire found and stepped over. Behind the last one, a kobold stash with a healing draught in it.',
              lose: 'Nothing obvious. The party picks its way through slowly and finds nothing.' },
            { tier: 'standard', skill: 'investigation', label: 'Work out how the traps are rigged',
              win: 'All the wires run to one anchor stone. Pull it and the whole tunnel is safe, and the trapmaker left supplies behind.',
              lose: 'The rigging makes no sense. The party goes around the long way.' },
            { tier: 'risky', skill: 'acrobatics', label: 'Dance through at speed', failEffect: 'damage',
              win: 'Through the wires without touching one, and straight into the stash the kobolds were guarding.',
              lose: 'One wire too many. A ceiling stone finds a shoulder.' }
          ]
        }
      }
    ]
  };
}

/* ---------------- the first chest ----------------
   The chest on the tutorial's first floor always holds one plain upgrade per
   hero, picked for the hero's class, so the "equip it" card has something to
   teach with whatever party was made. Every pick is a real low-level weapon
   the class is proficient with, one step up from its starting kit. */
export const TUTORIAL_UPGRADES = {
  fighter:   { slot: 'weapon', baseKey: 'Longsword' },
  barbarian: { slot: 'weapon', baseKey: 'Greataxe' },
  paladin:   { slot: 'weapon', baseKey: 'Longsword' },
  cleric:    { slot: 'weapon', baseKey: 'Mace' },
  rogue:     { slot: 'weapon', baseKey: 'Shortsword' },
  bard:      { slot: 'weapon', baseKey: 'Rapier' },
  ranger:    { slot: 'weapon', baseKey: 'Shortbow' },
  monk:      { slot: 'weapon', baseKey: 'Spear' },
  druid:     { slot: 'weapon', baseKey: 'Staff' },
  wizard:    { slot: 'weapon', baseKey: 'Wand' },
  sorcerer:  { slot: 'weapon', baseKey: 'Wand' },
  warlock:   { slot: 'weapon', baseKey: 'Wand' }
};

/** Is this chest the tutorial's fixed first chest? (first floor, first chest) */
export function isTutorialGearChest(game) {
  return isTutorialActive(game) && (game.questFloor | 0) === 1 && !game.activeQuest.gearChestOpened;
}

/**
 * The fixed first chest: one uncommon, item-level-1 upgrade per real hero.
 * `rollItem` is passed in (items.js) so this module stays free of the item
 * tables and importable from tests on its own.
 */
export function tutorialGearChest(game, rollItem, rng = Math.random) {
  /* on the quest, so it rides the save: a reload can't hand it out twice */
  if (game.activeQuest) game.activeQuest.gearChestOpened = true;
  const heroes = (game.heroes || []).filter(h => !h.companion && h.data);
  const items = [];
  for (const h of heroes) {
    const pick = TUTORIAL_UPGRADES[h.data.classKey];
    if (!pick) continue;
    const it = rollItem(1, rng, pick.slot, { baseKey: pick.baseKey, forceRarity: 'uncommon', ilvl: 1 });
    if (it) items.push(it);
  }
  return items;
}

/* ---------------- the cards ----------------
   One per tip key. `target` is a CSS selector the card points at (it pulses
   while the card is up); `action` adds a second button that does something. */
export const TUTORIAL_CARDS = {
  crawl: {
    title: 'Your company plays itself',
    body: 'This is an idle game first: the party explores, fights and loots on its own, and your job is the decisions that matter — gear, level-ups, and how each hero behaves. You can still step in: click the ground to send the party somewhere, or switch to manual mode (M) if you would rather play the fights yourself. The 🗺️ Exit button in the top corner leaves the dungeon at any time. Drag to pan the camera, right-drag to orbit, scroll to zoom; Space pauses.',
    target: '#btn-exit-dungeon'
  },
  startLevelUp: {
    title: 'Choices before you set out',
    body: 'Your heroes have level-up choices waiting already — the badge on the Party button counts them. Make them before you go any further: open the Party screen (press K for attributes, or click Party) and spend every point.',
    target: '#nav-party'
  },
  overlandFog: {
    title: 'Overland maps',
    body: 'Outside, the map starts shrouded and brightens as the party travels the road. Each clearing along the way can hold a fight, a chest or a campsite. The camp at the far end is the end of the floor.'
  },
  initiative: {
    title: 'Your first fight',
    body: 'Everyone rolled initiative, and turns now go in that order (the bar at the top). The heroes act on their own, but you can take over: press M, or click the mode button, to play a turn yourself. Press M again to hand it back.',
    target: '#mode-toggle-btn'
  },
  manual: {
    title: 'Manual control',
    body: 'Click a square to move and a monster to attack. Hovering a monster shows your hit chance. Red squares provoke an attack if you leave them. The Action and Bonus buttons hold spells and abilities. Press E to end the turn.',
    target: '#manual-combat-bar'
  },
  firstKill: {
    title: 'Experience',
    body: 'Each kill gives the party experience. A hero who drops to 0 HP is downed, not dead: they get back up at 30% HP once the fight ends, or sooner if someone heals them. If everyone goes down, you choose between respawning and fleeing the dungeon.'
  },
  potion: {
    title: 'Healing potions',
    body: 'A hero is below half health. You can drink a potion yourself at any moment, even out of turn: click the potion bar or press 1, 2 or 3, and it heals the most wounded hero. Or let the AI handle it: each hero drinks on their own turn once they fall below the potion threshold set in their AI Priorities.',
    target: '#potionbar'
  },
  chest: {
    title: 'Chests and loot',
    body: 'Chests drop their loot straight into the party\'s bag as the lid opens. An item\'s Power Score (PS) is the quick comparison. Open the Party screen (I) to compare it with what a hero wears and equip it.'
  },
  equipGear: {
    title: 'Equip your finds',
    body: 'That chest held an upgrade for every hero. Open the Party screen (I), pick a hero, and equip their new weapon from the bag: hover an item to compare it with what they are holding. Gear the party does not need can be sold later.',
    target: '#nav-party'
  },
  roomSearched: {
    title: 'Searching rooms',
    body: 'Once a room is cleared, the party searches it and can turn up hidden gold or a potion. A room only counts as cleared once it has been searched, so the party finishes that before moving on.'
  },
  partyWipe: {
    title: 'The party has fallen',
    body: 'Everyone is down. Respawn brings the party back at the floor entrance, fully rested, at the cost of a quarter of your bag and gold. Flee abandons the quest and returns to the world map with your loot safe. The 🗺️ Exit button in the top corner does the same at any time, even when things are going well.',
    target: '#btn-exit-dungeon'
  },
  shrine: {
    title: 'Campsites',
    body: 'The party has found a campsite and pitches camp for a short rest: HP back, and short-rest abilities like Second Wind, Ki and Warlock slots return. The full long rest comes when a floor is cleared.'
  },
  treasureRoom: {
    title: 'A treasure room',
    body: 'Vaults like this hold a large chest and piles of wealth, and they are often guarded. The party will go out of its way to clear them.'
  },
  skillChallenge: {
    title: 'Skill challenges',
    body: 'Not every problem is a fight. Pick an approach and the hero best at that skill rolls against the difficulty. Safe approaches are easy with small rewards; risky ones pay more but a failure can hurt.'
  },
  merchantCamp: {
    title: 'The merchant camp',
    body: 'Clearing a floor is a long rest: full HP and every spell slot back. Between floors the party camps with a merchant. Sometimes something happens at camp: a social skill check whose boon carries into the next floor. The camp shop sells potions. Leave camp to go on to the next floor.'
  },
  aiPriorities: {
    title: 'Tuning your heroes',
    body: 'Each hero\'s behaviour in auto mode is set on the Party screen\'s AI Priorities tab: who they target, how freely they spend spells and abilities, when they drink a potion, and how they move. Open it now and change one setting on one hero, for example raise a fragile caster\'s potion threshold.',
    action: { label: 'Open AI Priorities', run: () => openPartyTab('ai') }
  },
  levelUp: {
    title: 'Level up',
    body: 'A hero has points to spend. Press K for the attributes tab. The Party button pulses while something is waiting.'
  },
  concentration: {
    title: 'Concentration',
    body: 'That spell needs concentration. It lasts while the caster keeps it up, only one at a time, and taking damage can break it.'
  },
  bossRoom: {
    title: 'The boss',
    body: 'This is the last floor, and its boss ends the quest. Bosses hit much harder than anything before them: watch the party\'s health and use potions early.'
  },
  questComplete: {
    title: 'Quest complete',
    body: 'The results screen shows what the run earned. From here you pick quests on the world map, and the Guild is where your company grows between runs. That is the whole loop: good luck.'
  }
};

/* ---------------- runtime ---------------- */

let _game = null;
let _queue = [];
let _showing = null;
let _shownThisRun = new Set();
let _idleWaiters = [];

export function isTutorialActive(game = _game) {
  return !!(game && game.activeQuest && game.activeQuest.tutorial);
}

/** Wire the tutorial into the tip system. Called once from Game init. */
export function initTutorial(game) {
  _game = game;
  setTipInterceptor(key => {
    if (!isTutorialActive() || !TUTORIAL_CARDS[key]) return false;
    if (_shownThisRun.has(key)) return true;   // once per run, but swallow the toast too
    _shownThisRun.add(key);
    enqueueCard(key);
    return true;
  });
  setReplayTutorial(() => {
    if (!_game || _game.activeQuest || _game.state !== 'worldmap') return false;
    startTutorial();
    return true;
  });
}

/** Embark on the tutorial quest. */
export function startTutorial() {
  _shownThisRun = new Set();
  _queue = [];
  const q = makeTutorialQuest();
  return import('./worldmap.js').then(m => m.launchTutorialQuest(q));
}

/** Should this camp's social challenge be forced to fire? (First camp only,
 *  so every player sees one.) */
export function tutorialForcesCampChallenge(game) {
  return isTutorialActive(game) && (game.questFloor | 0) === 2;
}

/** Is this camp the one that teaches AI Priorities? */
export function tutorialIsAiCamp(game) {
  return isTutorialActive(game) && (game.questFloor | 0) === 3;
}

function loadingScreenUp() {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById('dungeon-loading-overlay');
  return !!(el && el.classList.contains('active'));
}

function enqueueCard(key) {
  /* Headless (tests, sims): nothing can show a card, and a queued one would
     hold back every screen waiting on whenCardsIdle forever. */
  if (typeof document === 'undefined') return;
  _queue.push(key);
  pump();
}

function pump() {
  if (_showing || !_queue.length || typeof document === 'undefined') return;
  /* A card that fires while the floor is still loading waits for the
     curtain, or it would be read over a loading bar and dismissed blind. */
  if (loadingScreenUp()) { setTimeout(pump, 300); return; }
  const key = _queue.shift();
  const card = TUTORIAL_CARDS[key];
  if (!card) { pump(); return; }
  _showing = key;
  if (_game) _game.setPaused(true);
  renderCard(key, card);
}

/** Is a tutorial card on screen right now? */
export function isTutorialCardShowing() {
  return !!_showing;
}

/**
 * Run `fn` once no tutorial card is showing or queued — immediately if none
 * is. Used to hold back a screen (a skill challenge, the camp) until the card
 * that explains it has been read, instead of stacking the card on top of it.
 */
export function whenCardsIdle(fn) {
  if (!_showing && !_queue.length) { fn(); return; }
  _idleWaiters.push(fn);
}

/* A screen that owns the pause (shop, skill check, party screen, death
   choice…) keeps it when the last card closes; otherwise the game resumes. */
function modalOwnsPause() {
  if (!_game || _game.state !== 'crawl') return true;
  if (typeof document === 'undefined') return false;
  return !!document.querySelector(
    '#charscreen.show, #challengescreen.show, #item-reveal.show, #floor-beat.show, #deathchoicescreen.show, #boss-card.show, #shopscreen.show');
}

function host() {
  let el = document.getElementById('tutorial-card');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutorial-card';
    document.body.appendChild(el);
  }
  return el;
}

function renderCard(key, card) {
  const el = host();
  el.innerHTML = `
    <div class="tut-panel" role="dialog" aria-labelledby="tut-title">
      <div class="tut-kicker">Tutorial</div>
      <h3 id="tut-title" class="tut-title"></h3>
      <p class="tut-body"></p>
      <div class="tut-actions">
        ${card.action ? '<button class="btn tut-action"></button>' : ''}
        <button class="btn primary tut-ok">Got it</button>
      </div>
    </div>`;
  el.querySelector('.tut-title').textContent = card.title;
  el.querySelector('.tut-body').textContent = card.body;
  const spot = card.target ? document.querySelector(card.target) : null;
  if (spot) spot.classList.add('tut-spot');
  el.classList.add('show');

  const close = () => {
    if (spot) spot.classList.remove('tut-spot');
    el.classList.remove('show');
    _showing = null;
    if (_queue.length) { pump(); return; }
    /* Screens held back for the cards open first, so they can claim the
       pause before it is released. */
    const waiters = _idleWaiters; _idleWaiters = [];
    for (const fn of waiters) { try { fn(); } catch (e) { console.warn('tutorial idle waiter', e); } }
    if (_game && !_showing && !modalOwnsPause()) _game.setPaused(false);
  };
  el.querySelector('.tut-ok').addEventListener('click', close);
  const actBtn = el.querySelector('.tut-action');
  if (actBtn) {
    actBtn.textContent = card.action.label;
    actBtn.addEventListener('click', () => {
      close();
      card.action.run();   // opens a screen that pauses on its own
    });
  }
}

/**
 * The "Learn the ropes?" offer, shown to every new party after the intro
 * crawl. Calls onPlay or onSkip exactly once.
 */
export function showTutorialOffer({ onPlay, onSkip }) {
  if (typeof document === 'undefined') { onSkip && onSkip(); return; }
  const el = host();
  el.innerHTML = `
    <div class="tut-panel tut-offer" role="dialog" aria-labelledby="tut-title">
      <div class="tut-kicker">A new company</div>
      <h3 id="tut-title" class="tut-title">Learn the ropes?</h3>
      <p class="tut-body">A short guided run: three floors against a kobold warren, with cards
      that explain each part of the game as it comes up. There is no quest reward, but the
      party keeps everything it finds. You can replay it later from How to Play.</p>
      <div class="tut-actions">
        <button class="btn tut-skip">Skip to the world map</button>
        <button class="btn primary tut-play">Play the tutorial (recommended)</button>
      </div>
    </div>`;
  el.classList.add('show');
  let done = false;
  const finish = fn => {
    if (done) return;
    done = true;
    el.classList.remove('show');
    fn && fn();
  };
  el.querySelector('.tut-play').addEventListener('click', () => finish(onPlay));
  el.querySelector('.tut-skip').addEventListener('click', () => finish(onSkip));
}
