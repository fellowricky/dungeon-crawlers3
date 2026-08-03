/**
 * Quest generator for the World Map.
 * Generates thematic, multi-floor dungeons with pre-rolled rewards scaled to party strength.
 *
 * Legendaries are quest-exclusive: harder/longer quests have higher odds; the
 * hardest offered quest always guarantees a legendary reward.
 */
import { rollItem, rollLegendary, perkText, ilvlText, bonusText, TIER } from './items.js';
import { BOSS_IDS, BOSS_MONSTERS, MONSTERS_BY_ID, MONSTER_THEMES, DUNGEON_MONSTER_MAP, monsterName } from './srd.js';
import {
  QUEST_EMBARK, QUEST_VICTORY, PHASE_RUMORS, ALLY_PERSONAS,
  CHAIN_SUBTITLES, CHAIN_EMBARK
} from './quest_story.js';

const THEMES = ['ancient', 'verdant', 'frost', 'grim', 'molten'];

const getQuestXpBase = () => parseFloat(globalThis.localStorage?.getItem('dc_quest_xp_base') || '30');
const getQuestXpCoeff = () => parseFloat(globalThis.localStorage?.getItem('dc_quest_xp_coeff') || '15');
const getSideXpMult = () => parseFloat(globalThis.localStorage?.getItem('dc_side_xp_mult') || '0.30');

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

// Preset spaced map coordinates so nodes never overlap.
// 8 slots: 6 offered quests + up to 2 pinned chain sequels. Keep x <= 84
// so node labels don't clip the right edge.
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

/** Quest commitment score — used to rank "hardest" for the pity legendary. */
export function questHardness(q) {
  return (q.level || 1) * 2 + (q.floors || 1) * 3 + Math.max(0, (q.level || 1) - 1);
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
      const ids = [...new Set([...(fam.monsters[1] || []), ...(fam.monsters[2] || [])])];
      so.need = Math.max(8, Math.min(20, 6 + 2 * q.floors));
      if (ids.length) {
        so.targetIds = ids;
        so.label = `Slay ${so.need} ${FAMILY_PLURAL[fam.name] || fam.name.toLowerCase()}`;
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
  let selectedBossId = null;
  if (BOSS_IDS.length) {
    // Determine boss CR range for final floor
    const dLevel = q.level || 1;
    const floors = q.floors || 1;
    const D = dLevel + Math.max(0, floors - 1) * 0.5;
    const minCR = Math.max(1.0, D * 0.75);
    const maxCR = Math.max(2.0, D * 1.25);

    // Filter bosses by theme. Themes are flat id lists now, so the themed boss
    // pool = bosses whose id appears in any of the dungeon's theme families.
    const themeIdxs = DUNGEON_MONSTER_MAP[q.theme] || [0, 1, 2, 3];
    const allowedBossIds = new Set();
    for (const idx of themeIdxs) {
      const fam = MONSTER_THEMES[idx];
      if (fam && fam.monsters) {
        for (const id of fam.monsters) {
          const spec = MONSTERS_BY_ID[id];
          if (spec && spec.isBoss) allowedBossIds.add(id);
        }
      }
    }

    const bosses = BOSS_MONSTERS;
    let themedBosses = bosses.filter(m => allowedBossIds.has(m.id));
    if (themedBosses.length === 0) {
      themedBosses = bosses;
    }

    // Filter by CR range
    let filtered = themedBosses.filter(m => m.cr >= minCR && m.cr <= maxCR);
    if (filtered.length === 0) {
      // Fallback: entire boss pool filtered by CR
      filtered = bosses.filter(m => m.cr >= minCR && m.cr <= maxCR);
    }

    if (filtered.length === 0) {
      // Fallback: find closest CR to average in target range
      const targetCR = (minCR + maxCR) / 2;
      let closestSpec = themedBosses[0] || bosses[0];
      let minDiff = Infinity;
      const searchPool = themedBosses.length ? themedBosses : bosses;
      for (const spec of searchPool) {
        const diff = Math.abs(spec.cr - targetCR);
        if (diff < minDiff) {
          minDiff = diff;
          closestSpec = spec;
        }
      }
      filtered = closestSpec ? [closestSpec] : [];
    }

    const spec = filtered.length ? filtered[Math.floor(rng() * filtered.length)] : null;
    selectedBossId = spec ? spec.id : null;
  }
  q.finalBossId = selectedBossId;
  q.finalBossName = q.finalBossId ? monsterName(q.finalBossId) : null;
  q.bossIntel = false;
  q.phases = rollPhases(q, rng, opts);
  q.sideObjectives = rollSideObjectives(q, rng);
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
  /* Skip map spots pinned by chain sequels so nodes never overlap. */
  const excluded = opts.excludePositions || [];
  let positions = MAP_POSITIONS.filter(p => !excluded.some(e => e && e.x === p.x && e.y === p.y));
  if (positions.length === 0) positions = MAP_POSITIONS;
  const locationPool = shuffleArray(positions);
  const pl = Math.max(1, partyLevel|0);

  for (let i = 0; i < count; i++) {
    const theme = themePool[i % themePool.length];
    const mapPos = locationPool[i % locationPool.length];

    const place = FANTASY_NAMES[Math.floor(Math.random() * FANTASY_NAMES.length)];
    const locType = FANTASY_LOCATIONS[theme][Math.floor(Math.random() * FANTASY_LOCATIONS[theme].length)];
    const name = `The ${locType} of ${place}`;

    /* opts.levelOffsets pins quest i's level to pl + offset (band contract
       from the world map: 1 below / 4 at / 1 above). Absent → random ±1. */
    const offset = Array.isArray(opts.levelOffsets) && opts.levelOffsets[i] !== undefined
      ? opts.levelOffsets[i]
      : Math.floor(Math.random() * 3) - 1;
    const level = Math.max(1, pl + offset); // clamps to 1 (at pl 1 the "below" quest is just level 1)
    /* 3 is the floor: every quest opens with an overland prologue (1-2 floors,
       see overland_prologue.js) and the last floor must stay a dungeon for the
       final boss, so a 3-floor quest is the shortest shape that still works. */
    const floors = 3 + Math.floor(Math.random() * 8); // 3 to 10 floors

    const seed = 1 + Math.floor(Math.random() * 888888);

    const itemLevel = level;
    // Placeholder reward — finalized after we know the hardest quest
    const rewardGold = Math.round((50 + 25 * level) * floors * (0.9 + Math.random() * 0.2));
    const rewardXp = Math.round((getQuestXpBase() + getQuestXpCoeff() * level) * floors);

    const q = {
      id: `q_${Date.now()}_${i}_${Math.floor(Math.random()*1000)}`,
      name,
      theme,
      level,
      floors,
      seed,
      rewardGold,
      rewardXp,
      rewardItem: null,
      itemLevel,
      description: '',
      mapLocation: mapPos,
      isLegendaryReward: false,
      place,
      locType,
      chain: null
    };
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
      if (quests[i].floors < 10) continue;
      const s = questHardness(quests[i]);
      if (s > best) { best = s; pityIdx = i; }
    }
  }

  for (let i = 0; i < quests.length; i++) {
    const q = quests[i];
    q.rewardItem = rollQuestReward(q.itemLevel, q.floors, q.level, pl, q.theme, i === pityIdx);
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
  const floors = Math.min(10, (entry.floors || 3) + 2);
  const subtitle = pickRng(CHAIN_SUBTITLES[part] || CHAIN_SUBTITLES[2], rng);
  const itemLevel = level + Math.floor(floors / 2);
  const goldMult = part === 3 ? 1.5 : 1.15;
  const mapPos = (entry.mapLocation && typeof entry.mapLocation.x === 'number' && typeof entry.mapLocation.y === 'number')
    ? entry.mapLocation
    : MAP_POSITIONS[seed % MAP_POSITIONS.length];

  const q = {
    id: `q_chain_${entry.chainId}_${part}`,
    name: `${entry.arcTitle} — ${subtitle}`,
    theme: entry.theme,
    level, floors, seed,
    rewardGold: Math.round((50 + 25 * level) * floors * goldMult),
    rewardXp: Math.round((getQuestXpBase() + getQuestXpCoeff() * level) * floors * (part === 3 ? 1.5 : 1)),
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
  /* Sequels always carry at least one phase; the finale always foreshadows its boss. */
  decorateQuest(q, rng, { minPhases: 1, forceTypes: part === 3 ? ['foreshadow'] : null });
  q.embarkText = pickRng(CHAIN_EMBARK[part] || CHAIN_EMBARK[2], rng).replace(/\{place\}/g, entry.place);
  q.description = q.embarkText;

  /* Escalating rewards: part 2 gets +20% legendary odds, part 3 is guaranteed.
     Only 10-floor dungeons can yield legendaries. */
  const wantLeg = floors >= 10 && (part === 3 || rng() < Math.min(0.9, legendaryChance(floors, level, pl) + 0.20));
  q.rewardItem = wantLeg
    ? rollLegendary(itemLevel, rng, { theme: q.theme })
    : rollQuestReward(itemLevel, floors, level, pl, q.theme, false, rng);
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
