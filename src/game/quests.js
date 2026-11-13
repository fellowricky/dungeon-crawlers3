/**
 * Quest generator for the World Map.
 * Generates thematic, multi-floor dungeons with pre-rolled rewards scaled to party strength.
 *
 * Legendaries are quest-exclusive: harder/longer quests have higher odds; the
 * hardest offered quest always guarantees a legendary reward.
 */
import { rollItem, rollLegendary, perkText, ilvlText, bonusText, TIER } from './items.js';
import { MONSTER_THEMES, DUNGEON_MONSTER_MAP, monsterSpawnsIn, dungeonMonsterIds, monsterName, getCuratedBossEncounter, getCuratedMonsterRoster, MONSTERS_ALL, getThemeForMonster } from './srd.js';

import {
  QUEST_EMBARK, QUEST_VICTORY, PHASE_RUMORS, ALLY_PERSONAS,
  CHAIN_SUBTITLES, CHAIN_EMBARK
} from './quest_story.js';
import { pickPin, planRoute, snapPin } from './world_regions.js';

/* The five dungeon themes. This is the whole vocabulary for a *quest* theme —
   the overland biomes (moor, forest, mire, holdfast, boneyard, …) are floor
   themes only, used by the prologue and by hand-authored story floorPlans, and
   must never end up on a quest object. */
export const DUNGEON_THEMES = ['ancient', 'verdant', 'frost', 'grim', 'molten'];
const THEMES = DUNGEON_THEMES;

/** Overland biome -> the dungeon theme it reads as, for repairing bad data. */
const BIOME_TO_DUNGEON = {
  forest: 'verdant', sporewood: 'verdant',
  mire: 'grim', boneyard: 'grim', moor: 'grim',
  holdfast: 'ancient', ruinfield: 'ancient',
  ashfield: 'molten', snowfield: 'frost'
};

/** Coerce any theme string to one of the five dungeon themes. */
export function asDungeonTheme(theme, rng = Math.random) {
  if (THEMES.includes(theme)) return theme;
  return BIOME_TO_DUNGEON[theme] || THEMES[Math.floor(rng() * THEMES.length)];
}

const getQuestXpBase = () => parseFloat(globalThis.localStorage?.getItem('dc_quest_xp_base') || '100');
const getQuestXpCoeff = () => parseFloat(globalThis.localStorage?.getItem('dc_quest_xp_coeff') || '50');
const getSideXpMult = () => parseFloat(globalThis.localStorage?.getItem('dc_side_xp_mult') || '1');

/** Deterministic PRNG for stable sequel offers. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const themed = (table, theme) => table[theme] || table.generic || [];
const pickRng = (arr, rng) => arr[Math.floor(rng() * arr.length)];

const FANTASY_LOCATIONS = {
  ancient: ["Vault", "Sepulcher", "Archives", "Sanctum", "Ruins", "Temple", "Tombs", "Monolith"],
  verdant: ["Canopy", "Glade", "Wilds", "Overgrowth", "Gardens", "Grove", "Thicket", "Brambles"],
  frost: ["Sepulcher", "Glacier", "Sanctum", "Caverns", "Hold", "Peak", "Frostbite Crypt", "Icebound Lair"],
  grim: ["Crypt", "Bastion", "Spire", "Prison", "Gallows", "Keep", "Shadowlands", "Abyss"],
  molten: ["Crucible", "Forge", "Core", "Fissure", "Chasm", "Caldera", "Vent", "Rift"]
};

const FANTASY_NAMES = [
  "Eldoria", "Gloomhaven", "Blackwood", "Frostfall", "Sunken Reach", "Whisperwind", "Bloodstone",
  "Shadowfang", "Ironclad", "Veridia", "Solitude", "Skypoint", "Duskwood", "Stormpeak", "Deepwood",
  "Runeheim", "Helspire", "Oakhaven", "Wyrmtooth", "Cinderfell"
];

const STORY_TEMPLATES = {
  ancient: [
    "Rumors speak of a forgotten library buried deep beneath the sands of {name}, holding relics of a lost civilization.",
    "A deep stone archive has been unearthed in {name}. Archeologists fled after waking its guardians.",
    "An ancient precursor vault has begun emitting strange energy pulses near {name}. Neutralize the threat.",
    "A sanctum of ancient sages in {name} is rumored to contain powerful enchanted equipment."
  ],
  verdant: [
    "A corrupted miasma is spreading from the overgrown druid ruins of {name}.",
    "Gigantic toxic flora and mutated spiders have overrun the deep botanical caves of {name}.",
    "Vines and thorns have sealed off a treasure house in {name}. Clear the aggressive vegetation.",
    "The forest spirits of {name} have been maddened by dark magic. Calm them by force."
  ],
  frost: [
    "The Glacial Spire near {name} has begun frozen storms that threaten nearby settlements.",
    "A frozen tomb holding ancient cryo-relics in {name} has been breached by frost trolls.",
    "We need a party to venture into the ice caverns of {name} and retrieve a winter crystal.",
    "An icebound cult in {name} is preparing a ritual to bring an eternal winter. Stop them."
  ],
  grim: [
    "The dark catacombs of {name} have grown restless. Undead forces are gathering under a necromancer.",
    "A shadow curse has settled over the old keep of {name}. Cleanse the corruption at its heart.",
    "Evil entities have turned the ruined prison of {name} into a breeding ground for horrors.",
    "A grim cult is harvesting souls in the shadow realm of {name}. Wipe them out."
  ],
  molten: [
    "A volcanic fissure has breached the lower dungeons of {name}, flooding them with fire elementals.",
    "Deep in the earth under {name}, the Molten Forge burns under the control of hostile magma beasts.",
    "Brave explorers are needed to seal a rift leaking primordial fire near {name}.",
    "A fire dragon's brood has taken nest in the magma caverns of {name}. Cleanse the tunnels."
  ]
};

// Fallback pin spots, used only if a theme has no reachable doorstep painted
// on the world map (world_biomes.json). Normal pins come from pickPin.
const MAP_POSITIONS = [
  { x: 22, y: 40 }, // West
  { x: 50, y: 28 }, // North
  { x: 74, y: 50 }, // East
  { x: 42, y: 68 }, // South
  { x: 30, y: 18 }, // North-West
  { x: 68, y: 22 }, // North-East
  { x: 84, y: 72 }, // South-East
  { x: 56, y: 52 }  // Center
];

function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

/**
 * A quest's dungeon size: the 3-10 roll that legendary odds, reward rarity and
 * hardness are keyed on. Before the painted world map this WAS q.floors. Now
 * the travel days are added on top of the dungeon, so a far quest is a longer
 * trip, not a bigger prize. Quests saved before routes fall back to q.floors.
 */
export function questSize(q) {
  return q.dungeonSize || (q.floors | 0);
}

/** Dungeon floors a size buys: the old two-floor prologue (one on a size-3 quest) taken off. */
export function dungeonFloorsFor(size) {
  return size >= 4 ? size - 2 : size - 1;
}

/**
 * Give a quest its road from the guild hub to its pin (world_regions.planRoute)
 * and its floor count: one overland floor per day of travel, then the dungeon.
 * Seeded from q.seed, so the same quest always walks the same road. A pin that
 * can't be reached keeps the legacy prologue shape (floors = size).
 */
function routeQuest(q, size) {
  q.dungeonSize = size;
  q.dungeonFloors = dungeonFloorsFor(size);
  const route = q.mapLocation
    ? planRoute(q.mapLocation.x, q.mapLocation.y, q.theme, mulberry32(((q.seed | 0) ^ 0x5bd1e995) >>> 0))
    : null;
  if (route) {
    q.route = route;
    q.floors = route.days + q.dungeonFloors;
  } else {
    q.route = null;
    q.floors = size;
  }
  return q;
}

/** Quest commitment score — used to rank "hardest" for the pity legendary. */
export function questHardness(q) {
  return (q.level || 1) * 2 + questSize(q) * 3 + Math.max(0, (q.level || 1) - 1);
}

/**
 * Legendary chance from quest floor count.
 * Only 10-floor dungeons can yield legendaries. Deliberately scarce (was
 * 50-75% pre-2026-07-15 — legendaries every board); the pity counter
 * (LEGENDARY_PITY) is the bad-luck backstop.
 */
export function legendaryChance(floors, level, partyLevel) {
  if (floors < 10) return 0;
  let p = 0.22;
  if (level > partyLevel) p += 0.15;
  return Math.min(0.40, p);
}

/** 10-floor quest clears without a legendary before one is guaranteed. */
export const LEGENDARY_PITY = 3;

/* ================= quest phases (special floors) ================= */

const PHASE_TYPES = ['ambush', 'puzzle', 'ally', 'gauntlet', 'foreshadow'];
const PHASE_WEIGHTS = { ambush: 3, puzzle: 3, ally: 2, gauntlet: 2, foreshadow: 2 };

/**
 * Roll narrative-beat floors for a quest. Floors 3-5 get 1 phase, 6-8 get 2,
 * 9-10 get 3 — on distinct floors in [2, floors-1], spaced >= 2 apart, no
 * duplicate phase types per quest.
 */
function rollPhases(q, rng, opts = {}) {
  const floors = q.floors;
  if (floors < 3) return [];
  let count = floors <= 5 ? 1 : floors <= 8 ? 2 : 3;
  if (opts.minPhases) count = Math.max(count, opts.minPhases);

  const candidates = [];
  for (let f = 2; f <= floors - 1; f++) candidates.push(f);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = [];
  for (const f of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every(c => Math.abs(c - f) >= 2)) chosen.push(f);
  }
  chosen.sort((a, b) => a - b);

  const typePool = [];
  for (const t of PHASE_TYPES) {
    if (t === 'foreshadow' && floors < 4) continue;
    for (let i = 0; i < PHASE_WEIGHTS[t]; i++) typePool.push(t);
  }
  const forced = opts.forceTypes ? [...opts.forceTypes] : [];
  const used = new Set();
  const phases = [];
  for (const floor of chosen) {
    let type;
    if (forced.length) {
      type = forced.shift();
    } else {
      let guard = 0;
      do { type = typePool[Math.floor(rng() * typePool.length)]; } while (used.has(type) && guard++ < 25);
    }
    used.add(type);
    const data = {};
    if (type === 'ally') {
      /* two candidate personas of different kinds — the pre-floor choice is WHO joins */
      const kinds = ['cleric', 'merc', 'scout'];
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
      }
      data.candidates = kinds.slice(0, 2).map(k => ({
        kind: k, idx: Math.floor(rng() * ALLY_PERSONAS[k].length)
      }));
    }
    phases.push({
      floor, type,
      rumor: pickRng(PHASE_RUMORS[type], rng),
      choice: null, resolved: false, data
    });
  }
  return phases;
}

/* ================= side objectives ================= */

const FAMILY_PLURAL = {
  'Goblinoid': 'goblinoids', 'Undead': 'undead', 'Vermin': 'vermin',
  'Beasts': 'beasts', 'Orc Horde': 'horde-kin', 'Draconic': 'dragonkind',
  'Elemental': 'elementals', 'Fiendish': 'fiends', 'Fey': 'fey',
  'Giantkind': 'giantkind', 'Drow & Shadow': 'shadow-dwellers'
};

/** 1 optional objective for floors>=2, 2 (distinct kinds) for floors>=5. */
function rollSideObjectives(q, rng) {
  if (q.floors < 2) return [];
  const count = q.floors >= 5 ? 2 : 1;
  const kinds = ['slay', 'gems', 'chests'];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const out = [];
  kinds.slice(0, count).forEach((kind, i) => {
    const so = {
      id: 'so' + (i + 1), kind, have: 0, done: false,
      rewardGold: Math.max(25, Math.round(q.rewardGold * 0.35)),
      rewardXp: Math.max(15, Math.round(q.rewardXp * getSideXpMult()))
    };
    if (kind === 'slay') {
      const themeIdxs = DUNGEON_MONSTER_MAP[q.theme] || [0, 1, 2, 3];
      const fam = MONSTER_THEMES[themeIdxs[Math.floor(rng() * themeIdxs.length)]];
      /* Target creatures that can actually appear in this dungeon — i.e. those
         explicitly whitelisted for the theme in the bestiary. */
      const ids = dungeonMonsterIds(q.theme);
      so.need = Math.max(8, Math.min(20, 6 + 2 * q.floors));
      /* Narrow the whitelist to the family named in the label. Targeting the
         theme's whole roster while the label read "Slay 8 goblinoids" meant
         any kill in the dungeon ticked a family-specific objective. If the
         family has no representative here, keep the generic wording so the
         label never promises a creature the floor can't spawn. */
      const famIds = ids.filter(id => {
        const m = MONSTERS_ALL.find(x => x.id === id);
        return m && getThemeForMonster(m) === fam.name;
      });
      if (famIds.length) {
        so.targetIds = famIds;
        so.label = `Slay ${so.need} ${FAMILY_PLURAL[fam.name] || fam.name.toLowerCase()}`;
      } else if (ids.length) {
        so.targetIds = ids;
        so.label = `Slay ${so.need} monsters`;
      } else {
        so.targetIds = null; /* match any kill */
        so.label = `Slay ${so.need} monsters`;
      }
    } else if (kind === 'gems') {
      so.need = Math.min(5, 2 + Math.floor(q.floors / 3));
      so.label = `Collect ${so.need} arcane gems`;
    } else {
      so.need = 2 + Math.floor(q.floors / 4);
      so.label = `Loot ${so.need} treasure chests`;
    }
    out.push(so);
  });
  return out;
}

/* ================= narrative + feature decoration ================= */

/**
 * Attach story text, final boss, phases and side objectives to a quest.
 * Requires q.place / q.locType / q.theme / q.floors / rewards to be set.
 */
function decorateQuest(q, rng, opts = {}) {
  q.embarkText = pickRng(themed(QUEST_EMBARK, q.theme), rng)
    .replace(/\{place\}/g, q.place)
    .replace(/\{locType\}/g, (q.locType || 'depths').toLowerCase());
  q.victoryText = pickRng(themed(QUEST_VICTORY, q.theme), rng).replace(/\{place\}/g, q.place);
  q.description = q.embarkText;

  const dLevel = q.level || 1;
  const curated = getCuratedBossEncounter(q.theme, dLevel);
  q.bossEncounter = curated;
  q.finalBossId = curated ? curated.bossId : null;
  q.finalBossName = curated ? (curated.bossTitle || curated.name || monsterName(curated.bossId)) : null;
  q.bossIntel = false;

  q.phases = rollPhases(q, rng, opts);
  q.sideObjectives = rollSideObjectives(q, rng);
  q.monsterRoster = getCuratedMonsterRoster(q.theme, dLevel, q.finalBossId);
  if (!q.chain) q.chain = null;
  return q;
}

function rollQuestReward(itemLevel, floors, level, partyLevel, theme, forceLegendary, rng = Math.random) {
  const wantLegendary = forceLegendary || (floors >= 10 && rng() < legendaryChance(floors, level, partyLevel));
  if (wantLegendary) {
    return rollLegendary(itemLevel, rng, { theme });
  }
  /* Scale reward rarity cap + forced floor by quest length */
  let luck = 4, fallback = 'uncommon';
  if (floors >= 7) { luck = 14; fallback = 'epic'; }
  else if (floors >= 4) { luck = 8; fallback = 'rare'; }

  /* Quest rewards roll at the 'quest' source offset with a heavy luck bonus, and
     floor out at a guaranteed rarity so a long dungeon never pays out a common. */
  const item = rollItem(itemLevel, rng, null, { source: 'quest', luck, noLegendary: true });
  if (item && TIER[item.rarity] >= TIER[fallback]) return item;
  return rollItem(itemLevel, rng, null, { source: 'quest', forceRarity: fallback });
}

export function generateQuests(partyLevel, count = 3, opts = {}) {
  const quests = [];
  const themePool = shuffleArray(THEMES);
  /* Pins pinned by chain sequels count as taken, so nodes never overlap. */
  const taken = (opts.excludePositions || []).filter(p => p && typeof p.x === 'number');
  const locationPool = shuffleArray(MAP_POSITIONS);
  const pl = Math.max(1, partyLevel|0);

  for (let i = 0; i < count; i++) {
    const theme = themePool[i % themePool.length];
    /* The pin goes on painted doorstep ground for this theme (world_biomes.json). */
    const mapPos = pickPin(theme, Math.random, taken) || locationPool[i % locationPool.length];
    taken.push(mapPos);

    const place = FANTASY_NAMES[Math.floor(Math.random() * FANTASY_NAMES.length)];
    const locType = FANTASY_LOCATIONS[theme][Math.floor(Math.random() * FANTASY_LOCATIONS[theme].length)];
    const name = `The ${locType} of ${place}`;

    /* opts.levelOffsets pins quest i's level to pl + offset (band contract
       from the world map: 1 below / 4 at / 1 above). Absent → random ±1. */
    const offset = Array.isArray(opts.levelOffsets) && opts.levelOffsets[i] !== undefined
      ? opts.levelOffsets[i]
      : Math.floor(Math.random() * 3) - 1;
    const level = Math.max(1, pl + offset); // clamps to 1 (at pl 1 the "below" quest is just level 1)
    /* Dungeon size 3-10 (the old floor roll). The floors themselves are the
       travel days to the pin (1-4 overland floors, see routeQuest) plus the
       dungeon this size buys (2-8). The last floor stays a dungeon for the boss. */
    const size = 3 + Math.floor(Math.random() * 8);

    const seed = 1 + Math.floor(Math.random() * 888888);

    const itemLevel = level;
    const q = {
      id: `q_${Date.now()}_${i}_${Math.floor(Math.random()*1000)}`,
      name,
      theme,
      level,
      floors: size,
      seed,
      rewardGold: 0,
      rewardXp: 0,
      rewardItem: null,
      itemLevel,
      description: '',
      mapLocation: mapPos,
      isLegendaryReward: false,
      place,
      locType,
      chain: null
    };
    routeQuest(q, size);
    /* Every floor pays, overland days included. Placeholder reward item is
       finalized after we know the hardest quest. */
    q.rewardGold = Math.round((50 + 25 * level) * q.floors * (0.9 + Math.random() * 0.2));
    q.rewardXp = Math.round((getQuestXpBase() + getQuestXpCoeff() * level) * q.floors);
    /* Seeded decoration so a resumed quest keeps identical story/phases. */
    decorateQuest(q, mulberry32(seed));
    quests.push(q);
  }

  /* Pity guarantee: after LEGENDARY_PITY 10-floor clears without a legendary
     (opts.legendaryPity, tracked by the game), force one onto the hardest
     10-floor quest on the board. No 10-floor offer → pity carries over
     (legendaries stay strictly 10-floor). Otherwise rewards roll at the
     normal (scarce) legendaryChance. */
  let pityIdx = -1;
  if ((opts.legendaryPity | 0) >= LEGENDARY_PITY) {
    let best = -1;
    for (let i = 0; i < quests.length; i++) {
      if (questSize(quests[i]) < 10) continue;
      const s = questHardness(quests[i]);
      if (s > best) { best = s; pityIdx = i; }
    }
  }

  for (let i = 0; i < quests.length; i++) {
    const q = quests[i];
    q.rewardItem = rollQuestReward(q.itemLevel, questSize(q), q.level, pl, q.theme, i === pityIdx);
    q.isLegendaryReward = q.rewardItem.rarity === 'legendary';
  }

  return quests;
}

/**
 * Materialize a chain sequel quest from a persisted questChains.active entry.
 * Fully deterministic from the entry (seeded rng), so re-opening the world
 * map always shows the same offer at the same pinned location.
 */
export function generateSequelQuest(entry, partyLevel) {
  const part = entry.part;
  const seed = ((entry.baseSeed * 31 + part * 7919) % 888888) + 1;
  const rng = mulberry32(seed);
  const pl = Math.max(1, partyLevel | 0);
  const level = Math.max((entry.level || 1) + 1, pl);
  /* entry.dungeonSize is the parent's size; entries saved before routes only
     have floors, which was the same number then. */
  const size = Math.min(10, (entry.dungeonSize || entry.floors || 3) + 2);
  const subtitle = pickRng(CHAIN_SUBTITLES[part] || CHAIN_SUBTITLES[2], rng);
  const itemLevel = level + Math.floor(size / 2);
  const goldMult = part === 3 ? 1.5 : 1.15;
  /* Belt and braces: an old save may hold a chain entry seeded from a story
     mission, whose theme is an overland biome. Sequels are dungeons. */
  const theme = asDungeonTheme(entry.theme, rng);
  /* The sequel returns to the parent's pin. Pins saved before the painted
     world map sat on fixed spots, so snap them onto this theme's doorstep. */
  const saved = entry.mapLocation && typeof entry.mapLocation.x === 'number' && typeof entry.mapLocation.y === 'number'
    ? entry.mapLocation : null;
  const mapPos = (saved && snapPin(theme, saved.x, saved.y))
    || pickPin(theme, mulberry32(seed + 1))
    || MAP_POSITIONS[seed % MAP_POSITIONS.length];

  const q = {
    id: `q_chain_${entry.chainId}_${part}`,
    name: `${entry.arcTitle} — ${subtitle}`,
    theme,
    level, floors: size, seed,
    rewardGold: 0,
    rewardXp: 0,
    rewardItem: null,
    itemLevel,
    description: '',
    mapLocation: mapPos,
    isLegendaryReward: false,
    place: entry.place,
    locType: entry.locType,
    chain: {
      chainId: entry.chainId, part, arcTitle: entry.arcTitle,
      place: entry.place, locType: entry.locType, baseSeed: entry.baseSeed
    }
  };
  routeQuest(q, size);
  q.rewardGold = Math.round((50 + 25 * level) * q.floors * goldMult);
  q.rewardXp = Math.round((getQuestXpBase() + getQuestXpCoeff() * level) * q.floors * (part === 3 ? 1.5 : 1));
  /* Sequels always carry at least one phase; the finale always foreshadows its boss. */
  decorateQuest(q, rng, { minPhases: 1, forceTypes: part === 3 ? ['foreshadow'] : null });
  q.embarkText = pickRng(CHAIN_EMBARK[part] || CHAIN_EMBARK[2], rng).replace(/\{place\}/g, entry.place);
  q.description = q.embarkText;

  /* Escalating rewards: part 2 gets +20% legendary odds, part 3 is guaranteed.
     Only 10-floor dungeons can yield legendaries. */
  const wantLeg = size >= 10 && (part === 3 || rng() < Math.min(0.9, legendaryChance(size, level, pl) + 0.20));
  q.rewardItem = wantLeg
    ? rollLegendary(itemLevel, rng, { theme: q.theme })
    : rollQuestReward(itemLevel, size, level, pl, q.theme, false, rng);
  q.isLegendaryReward = q.rewardItem.rarity === 'legendary';
  return q;
}

/** Short HTML-ish plain text for quest reward preview. */
export function formatRewardItemLine(item) {
  if (!item) return '';
  const bits = [`${item.name}`, `(${item.rarity}`, ilvlText(item) + ')'];
  const stats = bonusText(item);
  const perk = perkText(item);
  return { title: item.name, rarity: item.rarity, color: item.color, stats, perk, ilvl: ilvlText(item) };
}
