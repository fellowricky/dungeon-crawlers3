/**
 * Quest generator for the World Map.
 * Generates thematic, multi-floor dungeons with pre-rolled rewards scaled to party strength.
 */
import { rollItem } from './items.js';

const THEMES = ['ancient', 'verdant', 'frost', 'grim', 'molten'];

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

export function generateQuests(partyLevel, count = 3) {
  const quests = [];
  const themePool = shuffleArray(THEMES);
  const locationPool = shuffleArray(MAP_POSITIONS);

  for (let i = 0; i < count; i++) {
    const theme = themePool[i % themePool.length];
    const mapPos = locationPool[i % locationPool.length];

    // Pick names
    const place = FANTASY_NAMES[Math.floor(Math.random() * FANTASY_NAMES.length)];
    const locType = FANTASY_LOCATIONS[theme][Math.floor(Math.random() * FANTASY_LOCATIONS[theme].length)];
    const name = `The ${locType} of ${place}`;

    // Description
    const templates = STORY_TEMPLATES[theme];
    const description = templates[Math.floor(Math.random() * templates.length)].replace('{name}', place);

    // Scaling difficulty
    const level = Math.max(1, partyLevel + Math.floor(Math.random() * 3) - 1); // partyLevel - 1 to partyLevel + 1
    const floors = Math.floor(Math.random() * 10) + 1; // 1 to 10 floors

    // Deterministic base seed
    const seed = 1 + Math.floor(Math.random() * 888888);

    // Pre-roll a guaranteed item reward matching the difficulty
    // Higher floor quests yield higher tier items (+ floors/2)
    const itemLevel = level + Math.floor(floors / 2);
    const rewardItem = rollItem(itemLevel);

    // Gold/XP rewards
    const rewardGold = Math.round((40 + 20 * level) * floors * (0.9 + Math.random() * 0.2));
    const rewardXp = Math.round((25 + 12 * level) * floors);

    quests.push({
      id: `q_${Date.now()}_${i}_${Math.floor(Math.random()*1000)}`,
      name,
      theme,
      level,
      floors,
      seed,
      rewardGold,
      rewardXp,
      rewardItem,
      description,
      mapLocation: mapPos
    });
  }

  return quests;
}
