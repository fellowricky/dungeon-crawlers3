/**
 * Quest generator for the World Map.
 * Generates thematic, multi-floor dungeons with pre-rolled rewards scaled to party strength.
 *
 * Legendaries are quest-exclusive: harder/longer quests have higher odds; the
 * hardest offered quest always guarantees a legendary reward.
 */
import { rollItem, rollLegendary, perkText, ilvlText, bonusText } from './items.js';

const THEMES = ['ancient', 'verdant', 'frost', 'grim', 'molten'];

const FANTASY_LOCATIONS = {
  ancient: ["Vault", "Sepulcher", "Archives", "Sanctum", "Ruins", "Temple", "Tombs", "Monolith"],
  verdant: ["Canopy", "Glade", "Wilds", "Overgrowth", "Gardens", "Grove", "Thicket", "Brambles"],
  frost: ["Glacier", "Caverns", "Hold", "Peak", "Frostbite Crypt", "Icebound Lair", "Tundra", "Rime"],
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

// Preset spaced map coordinates so nodes never overlap
const MAP_POSITIONS = [
  { x: 22, y: 40 }, // North-West
  { x: 50, y: 28 }, // North-East
  { x: 74, y: 50 }, // South-East
  { x: 42, y: 68 }  // South-West
];

function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

/** Quest commitment score — used to rank "hardest" for guaranteed legendary. */
export function questHardness(q) {
  return (q.level || 1) * 2 + (q.floors || 1) * 3 + Math.max(0, (q.level || 1) - 1);
}

/**
 * Legendary chance from quest profile (before the guaranteed-hardest rule).
 * Short easy quests rarely yield legendaries; long/hard ones often do.
 */
export function legendaryChance(floors, level, partyLevel) {
  let p = 0.10;
  if (floors >= 4) p = 0.28;
  if (floors >= 7) p = 0.50;
  if (level > partyLevel) p += 0.15;
  if (floors >= 9 && level >= partyLevel) p = Math.max(p, 0.65);
  return Math.min(0.85, p);
}

function rollQuestReward(itemLevel, floors, level, partyLevel, theme, forceLegendary, rng = Math.random) {
  const wantLegendary = forceLegendary || rng() < legendaryChance(floors, level, partyLevel);
  if (wantLegendary) {
    return rollLegendary(itemLevel, rng, { theme });
  }
  // Strong epic/rare quest prize — still better than random trash
  const item = rollItem(itemLevel, rng, null, { ilvl: itemLevel, maxRarityIdx: 3 });
  // Bias quest non-legendaries toward rare+
  if (item.rarity === 'common' || item.rarity === 'uncommon') {
    return rollItem(itemLevel, rng, null, { ilvl: itemLevel, forceRarity: floors >= 5 ? 'epic' : 'rare' });
  }
  return item;
}

export function generateQuests(partyLevel, count = 3) {
  const quests = [];
  const themePool = shuffleArray(THEMES);
  const locationPool = shuffleArray(MAP_POSITIONS);
  const pl = Math.max(1, partyLevel|0);

  for (let i = 0; i < count; i++) {
    const theme = themePool[i % themePool.length];
    const mapPos = locationPool[i % locationPool.length];

    const place = FANTASY_NAMES[Math.floor(Math.random() * FANTASY_NAMES.length)];
    const locType = FANTASY_LOCATIONS[theme][Math.floor(Math.random() * FANTASY_LOCATIONS[theme].length)];
    const name = `The ${locType} of ${place}`;

    const templates = STORY_TEMPLATES[theme];
    const description = templates[Math.floor(Math.random() * templates.length)].replace('{name}', place);

    const level = Math.max(1, pl + Math.floor(Math.random() * 3) - 1); // partyLevel - 1 to +1
    const floors = 1 + Math.floor(Math.random() * 10); // 1 to 10 floors

    const seed = 1 + Math.floor(Math.random() * 888888);

    const itemLevel = level + Math.floor(floors / 2);
    // Placeholder reward — finalized after we know the hardest quest
    const rewardGold = Math.round((50 + 25 * level) * floors * (0.9 + Math.random() * 0.2));
    const rewardXp = Math.round((30 + 15 * level) * floors);

    quests.push({
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
      description,
      mapLocation: mapPos,
      isLegendaryReward: false
    });
  }

  // Guarantee the hardest offered quest drops a legendary
  let hardestIdx = 0;
  let hardestScore = -1;
  for (let i = 0; i < quests.length; i++) {
    const s = questHardness(quests[i]);
    if (s > hardestScore) { hardestScore = s; hardestIdx = i; }
  }

  for (let i = 0; i < quests.length; i++) {
    const q = quests[i];
    const forceLeg = i === hardestIdx;
    q.rewardItem = rollQuestReward(q.itemLevel, q.floors, q.level, pl, q.theme, forceLeg);
    q.isLegendaryReward = q.rewardItem.rarity === 'legendary';
  }

  return quests;
}

/** Short HTML-ish plain text for quest reward preview. */
export function formatRewardItemLine(item) {
  if (!item) return '';
  const bits = [`${item.name}`, `(${item.rarity}`, ilvlText(item) + ')'];
  const stats = bonusText(item);
  const perk = perkText(item);
  return { title: item.name, rarity: item.rarity, color: item.color, stats, perk, ilvl: ilvlText(item) };
}
