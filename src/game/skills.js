/**
 * Skill Challenge System
 *
 * Non-combat skill checks that trigger automatically during dungeon exploration.
 * When a challenge fires, a UI overlay shows the challenge text, which hero is
 * attempting it, the skill being tested, a simulated d20 roll, and the outcome.
 * Challenges are resolved by the party member with the highest total bonus.
 *
 * Integrated into game.js — all data, logic, and UI lives here.
 */
import { SKILLS, mod, d as die, roll as d20roll } from './srd.js';
import { rollItem } from './items.js';
import { log, updateResources, updatePartyFrames } from './ui.js';

/* ================================================================
   Module State — no global leaks
   ================================================================ */
let G = null;                          // game controller reference
let _challengesFired = new Set();      // room IDs where a challenge has fired
let _activeChallenge = null;           // challenge currently showing in overlay
let _resolveOverlay = null;            // callback to close the overlay promise
let _autoContinueTimer = null;         // timeout for auto-continue after 15s

/* ================================================================
   Challenge Data — all ~50 challenges from the design doc
   Each entry:
     skill   — key from SKILLS in srd.js
     name    — title shown in the overlay
     type    — 'room' | 'postClear' | 'camp'
     dc      — base difficulty (scaled by dungeonLevel)
     desc    — flavor text
     onSuccess — { text, reward: { kind, ... } }
     onFailure — { text, effect }
   ================================================================ */
const CHALLENGES = [
  /* ------- Strength: Athletics ------- */
  {
    skill: 'athletics', name: 'Collapsed Passage', type: 'room', dc: 12,
    desc: 'A pile of rubble blocks the corridor ahead. Someone strong could clear a path through.',
    onSuccess: { text: 'You heave the debris aside, revealing a shortcut deeper into the dungeon.', reward: { kind: 'shortcut' } },
    onFailure: { text: 'The rubble is too dense. The party takes the long way around.', effect: null }
  },
  {
    skill: 'athletics', name: 'Heave the Gate', type: 'room', dc: 14,
    desc: 'A rusted portcullis bars the way to a side chamber. A good lift could get you through.',
    onSuccess: { text: 'With a groan of straining metal, the gate rises. A chest gleams beyond.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The gate won\'t budge. You\'ll need another way in.', effect: null }
  },
  {
    skill: 'athletics', name: 'Crack the Wall', type: 'postClear', dc: 16,
    desc: 'This section of wall sounds hollow. A strong shoulder could break through.',
    onSuccess: { text: 'Stone crumbles away, revealing a hidden cache of gold!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'Just solid rock. The effort leaves you winded but empty-handed.', effect: null }
  },

  /* ------- Dexterity: Acrobatics ------- */
  {
    skill: 'acrobatics', name: 'Rope Bridge', type: 'room', dc: 12,
    desc: 'A frayed rope bridge spans a deep chasm. At its midpoint, a chest is tied to the ropes.',
    onSuccess: { text: 'You cross with fluid grace, claiming the isolated chest.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The bridge sways violently. Too risky — you retreat to solid ground.', effect: null }
  },
  {
    skill: 'acrobatics', name: 'Shattered Floor', type: 'room', dc: 14,
    desc: 'Crumbling tiles span a gap. A potion sits on a pedestal on the far side.',
    onSuccess: { text: 'Light on your feet, you spring across the broken tiles and grab the prize!', reward: { kind: 'potion' } },
    onFailure: { text: 'A tile gives way beneath you! You take a nasty tumble.', effect: 'damage' }
  },
  {
    skill: 'acrobatics', name: 'Narrow Ledge', type: 'room', dc: 15,
    desc: 'A crumbling ledge hugs the wall, barely a foot wide. Something glints in an alcove ahead.',
    onSuccess: { text: 'You edge along with perfect balance and discover a hidden stash of loot.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'A pebble skitters away into the void. Too risky — you turn back.', effect: null }
  },

  /* ------- Dexterity: Sleight of Hand ------- */
  {
    skill: 'sleightOfHand', name: 'Locked Chest', type: 'room', dc: 13,
    desc: 'An ornate chest with a complex locking mechanism sits against the wall.',
    onSuccess: { text: 'The lock clicks open! Inside you find treasure and gold.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The lock jams. The chest won\'t budge.', effect: null }
  },
  {
    skill: 'sleightOfHand', name: 'Trapped Reliquary', type: 'room', dc: 15,
    desc: 'A gem rests on a pressure-plate pedestal. One wrong move could trigger a trap.',
    onSuccess: { text: 'With nerves of steel, you lift the gem without triggering the mechanism.', reward: { kind: 'potion' } },
    onFailure: { text: 'The mechanism clicks ominously. You retreat empty-handed.', effect: null }
  },
  {
    skill: 'sleightOfHand', name: 'Disarm the Contraption', type: 'room', dc: 14,
    desc: 'A tripwire stretches across the passage, connected to something deadly.',
    onSuccess: { text: 'You carefully dismantle the trap, revealing a cache of gold behind it.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'A dart fires from the wall! You take a glancing hit.', effect: 'damage' }
  },

  /* ------- Dexterity: Stealth ------- */
  {
    skill: 'stealth', name: 'Sleeping Guardian', type: 'room', dc: 13,
    desc: 'A hibernating beast blocks the passage to a glittering hoard. Move silently.',
    onSuccess: { text: 'You slip past without a sound, claiming the treasure behind it.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The beast stirs! The party flees the room — the passage is lost.', effect: null }
  },
  {
    skill: 'stealth', name: 'Hidden Stash', type: 'postClear', dc: 11,
    desc: 'The monsters must have hidden something in this room. Search carefully and quietly.',
    onSuccess: { text: 'Tucked behind a loose stone, you find a small pouch of gold.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'The stash is booby-trapped with a bell. The noise alerts nothing, but the prize is lost.', effect: null }
  },

  /* ------- Intelligence: Arcana ------- */
  {
    skill: 'arcana', name: 'Rune-Sealed Door', type: 'room', dc: 13,
    desc: 'Glowing runes pulse on a sealed stone door. Arcane knowledge could deactivate them.',
    onSuccess: { text: 'You trace the counter-runes — the seal dissolves, opening the way to a bonus chamber.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The runes flare but hold. The door stays sealed.', effect: null }
  },
  {
    skill: 'arcana', name: 'Crystal Conduit', type: 'room', dc: 16,
    desc: 'Floating crystals hum with untapped energy. They need to be aligned into resonance.',
    onSuccess: { text: 'The crystals lock into alignment, creating a teleport nexus for this floor.', reward: { kind: 'shortcut' } },
    onFailure: { text: 'The crystals dim. Alignment fails — the resonance eludes you.', effect: null }
  },
  {
    skill: 'arcana', name: 'Identify Enchantment', type: 'postClear', dc: 14,
    desc: 'Magical residue lingers from the defeated caster. Reading it could reveal the boss lair.',
    onSuccess: { text: 'The residue reveals a vision of the boss chamber and its location on your map.', reward: { kind: 'reveal' } },
    onFailure: { text: 'The residue fades too quickly to read.', effect: null }
  },

  /* ------- Intelligence: History ------- */
  {
    skill: 'history', name: 'Annal Tablet', type: 'room', dc: 12,
    desc: 'An ancient stone tablet is carved with intricate script. Translating it could reveal the floor\'s layout.',
    onSuccess: { text: 'You decipher the annals — the entire floor layout is now revealed on your minimap.', reward: { kind: 'reveal' } },
    onFailure: { text: 'The script is too eroded to read. The layout remains a mystery.', effect: null }
  },
  {
    skill: 'history', name: 'Tomb Rite', type: 'room', dc: 15,
    desc: 'A sarcophagus bears funerary inscriptions. The correct burial rites might open it.',
    onSuccess: { text: 'You recite the ancient rites. The sarcophagus opens, yielding high-value gear.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'A spectral wail echoes through the chamber, but nothing else happens.', effect: null }
  },
  {
    skill: 'history', name: 'Architect Insight', type: 'postClear', dc: 14,
    desc: 'The room\'s architectural style is distinctive. It might reveal a hidden feature.',
    onSuccess: { text: 'You recognize the builder\'s mark — a secret door is nearby!', reward: { kind: 'secret' } },
    onFailure: { text: 'The room looks ordinary. No secrets here.', effect: null }
  },

  /* ------- Intelligence: Investigation ------- */
  {
    skill: 'investigation', name: 'Hidden Armory', type: 'postClear', dc: 12,
    desc: 'This room feels like it might have a concealed storage area. Search thoroughly.',
    onSuccess: { text: 'Behind a false wall panel, you discover a piece of gear!', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'You find nothing of value.', effect: null }
  },
  {
    skill: 'investigation', name: 'Pressure Plate Puzzle', type: 'room', dc: 14,
    desc: 'A patterned floor stretches ahead. One wrong step and darts fly. Deduce the safe path.',
    onSuccess: { text: 'You map the safe path and reach the reward pedestal at the center.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'A wrong step triggers a dart trap! The party takes some scratches.', effect: 'damage' }
  },
  {
    skill: 'investigation', name: 'Search for Clues', type: 'postClear', dc: 10,
    desc: 'A discarded journal lies in the corner. It might contain useful information.',
    onSuccess: { text: 'The journal contains lore about this dungeon — and some useful tactical insight.', reward: { kind: 'info' } },
    onFailure: { text: 'No clues in this room. The journal is mostly illegible.', effect: null }
  },

  /* ------- Intelligence: Nature ------- */
  {
    skill: 'nature', name: 'Overgrown Grove', type: 'room', dc: 11,
    desc: 'Rare alchemical herbs grow among the ancient roots. Harvest them carefully.',
    onSuccess: { text: 'You gather several prime specimens — enough for healing potions!', reward: { kind: 'potion' } },
    onFailure: { text: 'The plants are common weeds. Nothing useful here.', effect: null }
  },
  {
    skill: 'nature', name: 'Mushroom Chamber', type: 'room', dc: 13,
    desc: 'A dazzling array of fungi covers the walls. Some are healing — some are deadly poison.',
    onSuccess: { text: 'You sort the edible from the poisonous. The party shares the safe ones for a small heal.', reward: { kind: 'heal' } },
    onFailure: { text: 'Sleep spores trigger! The party stands idle, coughing in the haze.', effect: null }
  },
  {
    skill: 'nature', name: 'Toxic Pool', type: 'postClear', dc: 14,
    desc: 'A pool of bubbling gas fills a low section of the room. A safe path might lead to a stash.',
    onSuccess: { text: 'You identify the clear route through the gas and reach a stash of gold on the far side.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'The gas irritates your eyes. Nothing found.', effect: null }
  },

  /* ------- Intelligence: Religion ------- */
  {
    skill: 'religion', name: 'Desecrated Shrine', type: 'room', dc: 12,
    desc: 'A once-holy shrine has been corrupted by dark energy. It might be purified.',
    onSuccess: { text: 'You perform the purification ritual. The shrine glows with restored light — the party is fully healed!', reward: { kind: 'heal' } },
    onFailure: { text: 'The corruption holds. The shrine remains defiled.', effect: null }
  },
  {
    skill: 'religion', name: 'Heretic Ward', type: 'room', dc: 15,
    desc: 'Profane symbols seal this door. The counter-litany might dispel them.',
    onSuccess: { text: 'Your recitation breaks the ward! The door swings open to a bonus chamber.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The symbols flash red. The door stays sealed.', effect: null }
  },
  {
    skill: 'religion', name: 'Holy Symbol', type: 'room', dc: 13,
    desc: 'A buried relic peeks from the rubble. Its significance is not immediately clear.',
    onSuccess: { text: 'You recognize the holy symbol and recover it carefully — a valuable find!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'Just a rock. Nothing special.', effect: null }
  },

  /* ------- Wisdom: Animal Handling ------- */
  {
    skill: 'animalHandling', name: 'Caged Beast', type: 'room', dc: 12,
    desc: 'A magical creature is trapped in a cage. It looks scared but not hostile.',
    onSuccess: { text: 'You befriend the creature! It follows the party, sniffing out hidden items as you go.', reward: { kind: 'buff' } },
    onFailure: { text: 'The creature cowers in the back of its cage, unreachable.', effect: null }
  },
  {
    skill: 'animalHandling', name: 'Pack Beast', type: 'room', dc: 10,
    desc: 'A spooked pack mule carries valuable goods. Calm it before it bolts.',
    onSuccess: { text: 'You soothe the mule. It drops its cargo — gold and a potion! — before trotting off.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'The mule bolts with the goods. Nothing gained.', effect: null }
  },
  {
    skill: 'animalHandling', name: 'Lost Pet', type: 'postClear', dc: 14,
    desc: 'A lost drake pup sniffs at your pack. Gain its trust and it might lead you somewhere.',
    onSuccess: { text: 'The drake wags its tail and leads you to its former owner\'s stash!', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'It runs away before you can approach.', effect: null }
  },

  /* ------- Wisdom: Insight ------- */
  {
    skill: 'insight', name: 'Mimic Sense', type: 'room', dc: 12,
    desc: 'Something feels wrong about that chest in the corner. Study it before approaching.',
    onSuccess: { text: 'You spot the telltale signs — it\'s a mimic! The party strikes first with the advantage of surprise.', reward: { kind: 'info' } },
    onFailure: { text: 'Seems normal enough. You proceed cautiously but find nothing amiss.', effect: null }
  },
  {
    skill: 'insight', name: 'Merchant Riddle', type: 'camp', dc: 14,
    desc: 'The camp merchant regards you with a sly smile. "Answer my riddle, and one item is yours."',
    onSuccess: { text: 'You see through the merchant\'s trick and claim a free item!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'The riddle stumps you. You pay the normal price.', effect: null }
  },
  {
    skill: 'insight', name: 'Fake Wall', type: 'postClear', dc: 15,
    desc: 'The room feels slightly too small for its outer dimensions. Knock around for hollow spots.',
    onSuccess: { text: 'A section of wall sounds hollow! You break through to a secret room with loot.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'Nothing unusual about these walls.', effect: null }
  },

  /* ------- Wisdom: Medicine ------- */
  {
    skill: 'medicine', name: 'Sick Wanderer', type: 'room', dc: 12,
    desc: 'A wounded NPC lies against the wall, feverish and weak. They might reward your aid.',
    onSuccess: { text: 'You diagnose and treat the ailment. Grateful, they hand you a key to a locked door on this floor.', reward: { kind: 'secret' } },
    onFailure: { text: 'The ailment is beyond your skill. The wanderer slips into restless sleep.', effect: null }
  },
  {
    skill: 'medicine', name: 'Triage Aftermath', type: 'postClear', dc: 14,
    desc: 'After the fight, you tend to the party\'s scrapes and bruises. Proper care helps.',
    onSuccess: { text: 'You bandage wounds and set minor fractures — everyone regains some vitality.', reward: { kind: 'heal' } },
    onFailure: { text: 'The injuries are too fresh for field medicine to help much.', effect: null }
  },
  {
    skill: 'medicine', name: 'Plague Source', type: 'room', dc: 16,
    desc: 'A foul contamination seeps from a crack in the floor. Identify and neutralize the source.',
    onSuccess: { text: 'You identify the contamination and neutralize it. The area is safe now.', reward: { kind: 'info' } },
    onFailure: { text: 'The contamination remains, too hazardous to approach.', effect: null }
  },

  /* ------- Wisdom: Perception ------- */
  {
    skill: 'perception', name: 'Secret Junction', type: 'room', dc: 13,
    desc: 'Something about this room feels off, like there\'s more here than meets the eye.',
    onSuccess: { text: 'You notice a hairline crack in the masonry — a secret door! It leads to a bonus room.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The walls are blank. Nothing hidden here.', effect: null }
  },
  {
    skill: 'perception', name: 'Hidden Switch', type: 'room', dc: 12,
    desc: 'The floor has a subtle pattern. One stone might be a pressure switch.',
    onSuccess: { text: 'You spot the depression in the floor. Stepping on it activates a hidden elevator to a treasure alcove!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'Nothing stands out. Just another room.', effect: null }
  },
  {
    skill: 'perception', name: 'Ambush Warning', type: 'postClear', dc: 14,
    desc: 'The signs are subtle — disturbed dust, a faint smell. You might not be alone.',
    onSuccess: { text: 'You notice tracks! A lurking monster group is nearby. You prepare to face them for bonus rewards.', reward: { kind: 'info' } },
    onFailure: { text: 'No sign of anything lurking nearby.', effect: null }
  },
  {
    skill: 'perception', name: 'Treasure Glint', type: 'postClear', dc: 11,
    desc: 'Torchlight catches something shiny in the rubble. Worth a closer look.',
    onSuccess: { text: 'You pry up a loose stone and find a small cache of gold!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'Just a shadow playing tricks on you.', effect: null }
  },

  /* ------- Wisdom: Survival ------- */
  {
    skill: 'survival', name: 'Lost Trail', type: 'room', dc: 11,
    desc: 'The path ahead forks. One way winds — the other might be a shortcut.',
    onSuccess: { text: 'You read the signs and find a shortcut that cuts straight toward the boss.', reward: { kind: 'shortcut' } },
    onFailure: { text: 'The trail leads in circles. No benefit found.', effect: null }
  },
  {
    skill: 'survival', name: 'Forage Supplies', type: 'postClear', dc: 10,
    desc: 'The area has edible plants and hidden caches if you know where to look.',
    onSuccess: { text: 'You scavenge successfully, finding useful supplies.', reward: { kind: 'potion' } },
    onFailure: { text: 'Nothing useful here.', effect: null }
  },
  {
    skill: 'survival', name: 'Safe Camp', type: 'postClear', dc: 13,
    desc: 'This nook could serve as a safe resting spot — if it\'s as sheltered as it looks.',
    onSuccess: { text: 'You find a well-hidden nook. The party catches its breath, recharging one ability each.', reward: { kind: 'buff' } },
    onFailure: { text: 'Too exposed. No safe place to rest here.', effect: null }
  },
  {
    skill: 'survival', name: 'Environment Hazard', type: 'room', dc: 14,
    desc: 'The ceiling groans under shifting weight. Find the safe path through before it collapses.',
    onSuccess: { text: 'You guide the party through the unstable area safely, reaching a treasure on the far side.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'The hazard blocks the path. You turn back.', effect: null }
  },

  /* ------- Charisma: Deception ------- */
  {
    skill: 'deception', name: 'Bluff the Sentinel', type: 'room', dc: 13,
    desc: 'A spectral sentinel bars the way. It might respond to authority — or a convincing lie.',
    onSuccess: { text: 'Your confident bluff convinces the sentinel you belong here. It stands aside, revealing the room\'s treasure.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The sentinel doesn\'t buy it. It alerts nearby chambers — the fight ahead will be harder.', effect: null }
  },
  {
    skill: 'deception', name: 'Feign Authority', type: 'postClear', dc: 15,
    desc: 'You spot an official-looking courier approaching. A bit of authority might secure a tribute.',
    onSuccess: { text: 'You pose as an inspector so convincingly the courier hands over a tribute of gold!', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'You\'re ignored. The courier passes by.', effect: null }
  },
  {
    skill: 'deception', name: 'False Trail', type: 'postClear', dc: 14,
    desc: 'A rival party\'s tracks cross yours. Plant misdirection to throw them off.',
    onSuccess: { text: 'The rivals follow your false trail and abandon their supplies. You claim the spoils!', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'No one takes the bait.', effect: null }
  },

  /* ------- Charisma: Intimidation ------- */
  {
    skill: 'intimidation', name: 'Cower the Scavengers', type: 'room', dc: 11,
    desc: 'A pack of scavengers has claimed a cache of treasure. They scatter if properly intimidated.',
    onSuccess: { text: 'Your fierce display sends them scurrying! You collect their hoard.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'They scatter, but take the goods with them.', effect: null }
  },
  {
    skill: 'intimidation', name: 'Demand Passage', type: 'room', dc: 14,
    desc: 'A greedy gatekeeper demands tribute. Refuse and bully your way through.',
    onSuccess: { text: 'Your threatening presence convinces the gatekeeper to let you pass for free.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The gatekeeper holds firm. You pay 20 gold as tribute.', effect: null }
  },
  {
    skill: 'intimidation', name: 'Awe the Cultist', type: 'postClear', dc: 16,
    desc: 'A lone cultist recognizes your reputation. Press the advantage.',
    onSuccess: { text: 'The cultist quakes and surrenders, revealing the boss\'s weakness! The boss has -2 AC this floor.', reward: { kind: 'buff' } },
    onFailure: { text: 'The cultist flees before you can question them.', effect: null }
  },

  /* ------- Charisma: Performance ------- */
  {
    skill: 'performance', name: 'Riddle Court', type: 'room', dc: 14,
    desc: 'A fey creature blocks the path, demanding entertainment. Tell a tale or sing a song.',
    onSuccess: { text: 'Your performance delights the fey! It grants a boon — the merchant camp will have better stock.', reward: { kind: 'buff' } },
    onFailure: { text: 'The fey is bored. You\'re dismissed with nothing.', effect: null }
  },
  {
    skill: 'performance', name: 'Echoing Alcove', type: 'room', dc: 12,
    desc: 'A magical instrument sits in an alcove with strange notation. Playing the right notes might unlock something.',
    onSuccess: { text: 'Your melody resonates with the room\'s magic. A hidden compartment slides open!', reward: { kind: 'potion' } },
    onFailure: { text: 'A discordant noise. Nothing happens.', effect: null }
  },
  {
    skill: 'performance', name: 'Distract the Guard', type: 'room', dc: 15,
    desc: 'A roaming guard patrols near a treasure. Put on a show to draw their attention.',
    onSuccess: { text: 'The guard is captivated! Someone else slips past to snag the treasure.', reward: { kind: 'item', count: 1 } },
    onFailure: { text: 'The guard ignores your antics. No opening.', effect: null }
  },

  /* ------- Charisma: Persuasion ------- */
  {
    skill: 'persuasion', name: 'Merchant Discount', type: 'camp', dc: 14,
    desc: 'The merchant quotes a high price. A bit of charm might bring it down.',
    onSuccess: { text: 'Your silver tongue works wonders — all prices reduced by 15% for this visit!', reward: { kind: 'buff' } },
    onFailure: { text: 'The merchant holds firm on prices.', effect: null }
  },
  {
    skill: 'persuasion', name: 'Freed Captive', type: 'room', dc: 12,
    desc: 'A prisoner cowers in a cage. Free them and they might share useful information.',
    onSuccess: { text: 'You convince the prisoner you\'re trustworthy. They reveal the location of a secret room!', reward: { kind: 'secret' } },
    onFailure: { text: 'The captive clams up and leaves without a word.', effect: null }
  },
  {
    skill: 'persuasion', name: 'Calm the Crowd', type: 'room', dc: 16,
    desc: 'Hostile NPCs are on the verge of attacking. Talk them down before blades are drawn.',
    onSuccess: { text: 'Your measured words defuse the tension. The room resolves peacefully with loot but no XP.', reward: { kind: 'gold', value: null } },
    onFailure: { text: 'They attack anyway! Steel yourselves.', effect: null }
  }
];

/* ================================================================
   Room-type to eligible skill mapping (for post-clear challenges)
   ================================================================ */
const POST_CLEAR_SKILLS = {
  combat:    ['investigation', 'perception', 'survival', 'nature'],
  elite:     ['investigation', 'history', 'arcana', 'intimidation'],
  treasure:  ['sleightOfHand', 'perception', 'investigation'],
  shrine:    ['religion', 'arcana', 'insight'],
  boss:      ['history', 'arcana', 'religion', 'perception']
};

/* Camp challenges indexed by skill */
const CAMP_CHALLENGES = {};
for (const c of CHALLENGES) {
  if (c.type === 'camp') {
    if (!CAMP_CHALLENGES[c.skill]) CAMP_CHALLENGES[c.skill] = [];
    CAMP_CHALLENGES[c.skill].push(c);
  }
}

/* Pre-index challenges by skill + type for fast lookup */
const _challengeIndex = {};
for (const c of CHALLENGES) {
  const key = c.skill + ':' + c.type;
  if (!_challengeIndex[key]) _challengeIndex[key] = [];
  _challengeIndex[key].push(c);
}

function _challengesFor(skill, type) {
  return _challengeIndex[skill + ':' + type] || [];
}

/* ================================================================
   DC Calculation
   actualDC = challenge.dc + floor((dungeonLevel - 1) * 1.5) + random(-2, +2)
   ================================================================ */
function calcDC(baseDC, dungeonLevel) {
  const levelScale = Math.floor((dungeonLevel - 1) * 0.8);
  const variation = Math.floor(Math.random() * 5) - 2; // -2 to +2
  return baseDC + levelScale + variation;
}

/* ================================================================
   Skill Bonus Lookup
   Returns the hero's total bonus for a given skill, as computed by recalc()
   ================================================================ */
function skillBonus(hero, skillKey) {
  return hero.data.skillsDerived?.[skillKey] ?? 0;
}

/* ================================================================
   Hero Selection
   Pick the alive hero with the highest bonus for a skill.
   Ties broken by a hidden d20 roll (not shown in UI).
   If no alive heroes have the skill, fall back to raw d20.
   ================================================================ */
function pickBestHero(game, skillKey) {
  const alive = game.heroes.filter(h => h.data.hp > 0);
  if (alive.length === 0) return null;

  let best = null;
  let bestBonus = -Infinity;

  for (const h of alive) {
    const bonus = skillBonus(h, skillKey);
    if (bonus > bestBonus) {
      bestBonus = bonus;
      best = h;
    } else if (bonus === bestBonus && best !== null) {
      // Tiebreak: behind-the-scenes d20 roll
      const myRoll = die(20);
      const bestRoll = best._tiebreak || 0;
      if (myRoll > bestRoll) {
        best = h;
        best._tiebreak = myRoll;
      }
    }
  }

  // Clear tiebreak data
  for (const h of alive) delete h._tiebreak;

  return best || (alive.length > 0 ? alive[0] : null);
}

/* ================================================================
   Post-Clear Challenge Selection
   Has a 25% chance to fire a challenge after a room is cleared.
   Returns a challenge object or null.
   ================================================================ */
function pickPostClearChallenge(roomType, dungeonLevel) {
  const eligibleSkills = POST_CLEAR_SKILLS[roomType];
  if (!eligibleSkills || eligibleSkills.length === 0) return null;

  // 12% chance to fire — down from 25% to reduce frequency
  if (Math.random() > 0.12) return null;

  // Pick a random eligible skill
  const skill = eligibleSkills[Math.floor(Math.random() * eligibleSkills.length)];
  const pool = _challengesFor(skill, 'postClear');
  if (pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ================================================================
   Pick a challenge for a given room
   For challenge rooms, this picks from the room-type pool.
   For standard rooms, this fires post-clear challenges.
   ================================================================ */
export function checkForChallenge(game) {
  // Skip if game is paused, not crawling, or not on a dungeon
  if (game.state !== 'crawl' || game.paused || !game.D) return false;
  if (!game._skillsInited) return false;

  // No alive heroes = no challenges
  const alive = game.heroes.filter(h => h.data.hp > 0);
  if (alive.length === 0) return false;

  // Check each room: if it's "done" (roomDone) and we haven't fired a challenge there
  const { rooms } = game.D;
  for (let rid = 0; rid < rooms.length; rid++) {
    if (_challengesFired.has(rid)) continue;
    if (!game.visitedRooms[rid]) continue;
    if (!game.roomDone(rid)) continue;

    const room = rooms[rid];
    const challenge = pickPostClearChallenge(room.type, game.dungeonLevel);
    if (challenge) {
      _challengesFired.add(rid);
      fireChallenge(game, challenge);
      return true; // challenge fired, game is now paused
    } else {
      // Mark as "checked" even if no challenge fires so we don't re-roll every frame
      _challengesFired.add(rid);
    }
  }

  return false;
}

/* ================================================================
   Fire a Challenge
   1. Pause the game
   2. Pick the best hero
   3. Roll the d20
   4. Show the overlay
   5. Wait for player to click "Continue"
   6. Apply reward/effect
   7. Resume the game
   ================================================================ */
/**
 * Pre-compute reward details so the overlay can show exactly what was earned.
 * Returns { applyArgs, detailText } or null for no-ops.
 */
function precomputeReward(game, reward) {
  if (!reward) return null;
  const lvl = game.dungeonLevel || 1;
  const out = { data: null, detailText: '' };

  switch (reward.kind) {
    case 'item': {
      const count = reward.count || 1;
      const items = [];
      for (let i = 0; i < count; i++) items.push(rollItem(lvl));
      out.data = { kind: 'item', items };
      out.detailText = items.map(it => it.name).join(', ');
      break;
    }
    case 'gold': {
      const gold = getGoldValue(lvl, reward.value);
      out.data = { kind: 'gold', gold };
      out.detailText = `${gold} gold`;
      break;
    }
    case 'potion': {
      const isGreater = Math.random() < 0.3 && lvl >= 3;
      out.data = { kind: 'potion', isGreater };
      out.detailText = isGreater ? 'Greater Healing Potion' : 'Healing Potion';
      break;
    }
    case 'heal': {
      const amounts = [];
      let total = 0;
      for (const h of game.heroes) {
        if (h.data.hp <= 0) { amounts.push(0); continue; }
        const amt = d20roll(1, 6, 2);
        amounts.push(amt);
        total += amt;
      }
      out.data = { kind: 'heal', amounts, total };
      out.detailText = `Party heals ${total} HP`;
      break;
    }
    case 'buff': {
      out.data = { kind: 'buff' };
      out.detailText = 'Floor-long boon';
      break;
    }
    case 'secret': {
      out.data = { kind: 'secret' };
      out.detailText = 'Secret room revealed';
      break;
    }
    case 'shortcut': {
      out.data = { kind: 'shortcut' };
      out.detailText = 'Shortcut nexus';
      break;
    }
    case 'reveal': {
      out.data = { kind: 'reveal' };
      out.detailText = 'Boss location revealed';
      break;
    }
    case 'info': {
      out.data = { kind: 'info' };
      out.detailText = 'Lore & tactical insight';
      break;
    }
    default: {
      const gold = getGoldValue(lvl, reward.value);
      out.data = { kind: 'gold', gold };
      out.detailText = `${gold} gold`;
      break;
    }
  }
  return out;
}

/**
 * Apply a pre-computed reward to the game state.
 */
function applyComputedReward(game, computed, hero) {
  if (!computed || !computed.data) return;
  const d = computed.data;

  switch (d.kind) {
    case 'item': {
      for (const item of d.items) game.inventory.push(item);
      break;
    }
    case 'gold': {
      game.gold += d.gold;
      break;
    }
    case 'potion': {
      if (d.isGreater) game.potions.greater++;
      else game.potions.heal++;
      break;
    }
    case 'heal': {
      const alive = game.heroes.filter(h => h.data.hp > 0);
      alive.forEach((h, i) => {
        if (d.amounts[i] > 0) {
          h.data.hp = Math.min(h.data.maxHp, h.data.hp + d.amounts[i]);
        }
      });
      break;
    }
    case 'buff': {
      if (!game._floorBuffs) game._floorBuffs = [];
      game._floorBuffs.push({ type: challengeBuffType(), source: hero?.name || 'party' });
      break;
    }
    case 'secret': {
      if (game.D && game.D.rooms) {
        const unrevealed = [];
        for (let i = 0; i < game.D.rooms.length; i++) {
          if (game.D.rooms[i].type === 'combat' && !game.visitedRooms[i]) {
            unrevealed.push(i);
          }
        }
        if (unrevealed.length > 0) {
          const target = unrevealed[Math.floor(Math.random() * unrevealed.length)];
          game.visitRoom(target, true);
        }
      }
      break;
    }
    case 'reveal': {
      if (game.D && game.D.boss !== undefined) game.visitRoom(game.D.boss, true);
      break;
    }
    case 'shortcut':
    case 'info':
      // handled by log text already
      break;
  }

  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));
}

export function fireChallenge(game, challenge) {
  const hero = pickBestHero(game, challenge.skill);
  if (!hero) return; // no heroes alive

  const dc = calcDC(challenge.dc, game.dungeonLevel);
  const bonus = hero ? skillBonus(hero, challenge.skill) : 0;
  const d20Roll = die(20);
  const total = d20Roll + bonus;
  const isCrit = d20Roll === 20;
  const isCritFail = d20Roll === 1;
  const success = isCrit ? true : isCritFail ? false : total >= dc;

  // Pre-compute reward details so the overlay can show specifics
  const computedReward = success ? precomputeReward(game, challenge.onSuccess.reward) : null;
  const computedFailure = !success && challenge.onFailure.effect === 'damage'
    ? { detailText: `${hero.data.name} takes 1-4 damage` }
    : null;

  // Pause the game
  game.setPaused(true);

  // Store active challenge state for the overlay
  _activeChallenge = {
    challenge,
    hero: hero ? hero.data : null,
    d20Roll,
    bonus,
    total,
    dc,
    success,
    isCrit,
    isCritFail,
    computedReward,
    computedFailure
  };

  showOverlay(_activeChallenge, () => {
    // Callback when player clicks "Continue"
    if (success) {
      if (challenge.onSuccess.reward) {
        applyComputedReward(game, computedReward, hero);
        log(`✨ ${hero.data.name} succeeds at "${challenge.name}"! ${computedReward ? computedReward.detailText : ''}`, 'treasure');
      }
    } else {
      applyFailure(game, challenge.onFailure, hero);
      log(`❌ ${hero.data.name} fails at "${challenge.name}". ${challenge.onFailure.text}`, 'sys');
    }

    _activeChallenge = null;
    game.setPaused(false);
  });
}

/* ================================================================
   Reward Application
   ================================================================ */
function getGoldValue(dungeonLevel, baseValue) {
  if (baseValue) return baseValue;
  return 15 + die(10) * 2 + dungeonLevel * 5;
}

function applyReward(game, reward, hero) {
  if (!reward) return;

  const kind = reward.kind;
  const lvl = game.dungeonLevel || 1;

  switch (kind) {
    case 'item': {
      const count = reward.count || 1;
      for (let i = 0; i < count; i++) {
        const item = rollItem(lvl);
        game.inventory.push(item);
        log(`  ↳ Reward: ${item.name}!`, 'treasure');
      }
      break;
    }
    case 'gold': {
      const gold = getGoldValue(lvl, reward.value);
      game.gold += gold;
      log(`  ↳ ${gold} gold added to the party treasury.`, 'treasure');
      break;
    }
    case 'potion': {
      if (Math.random() < 0.3 && lvl >= 3) {
        game.potions.greater++;
        log(`  ↳ A Greater Healing Potion!`, 'treasure');
      } else {
        game.potions.heal++;
        log(`  ↳ A Healing Potion!`, 'treasure');
      }
      break;
    }
    case 'heal': {
      let healed = 0;
      for (const h of game.heroes) {
        if (h.data.hp <= 0) continue;
        const amt = d20roll(1, 6, 2);
        h.data.hp = Math.min(h.data.maxHp, h.data.hp + amt);
        healed += amt;
      }
      log(`  ↳ Party restored ${healed} HP total.`, 'heal');
      break;
    }
    case 'buff': {
      // Store a floor-long buff on the game state
      if (!game._floorBuffs) game._floorBuffs = [];
      game._floorBuffs.push({ type: challengeBuffType(reward), source: hero?.name || 'party' });
      log(`  ↳ The party gains a floor-long boon!`, 'heal');
      break;
    }
    case 'secret': {
      // Reveal a random unrevealed room on the minimap
      if (game.D && game.D.rooms) {
        const unrevealed = [];
        for (let i = 0; i < game.D.rooms.length; i++) {
          const r = game.D.rooms[i];
          if (r.type === 'combat' && !game.visitedRooms[i]) {
            unrevealed.push(i);
          }
        }
        if (unrevealed.length > 0) {
          const target = unrevealed[Math.floor(Math.random() * unrevealed.length)];
          game.visitRoom(target, true);
          log(`  ↳ A secret room revealed on the minimap!`, 'treasure');
        } else {
          log(`  ↳ You learn the layout — no hidden rooms remain.`, 'sys');
        }
      }
      break;
    }
    case 'shortcut': {
      // Mark the current room as a shortcut/nexus
      log(`  ↳ This room is now a shortcut nexus!`, 'treasure');
      break;
    }
    case 'reveal': {
      // Reveal boss room or a large area of the map
      if (game.D && game.D.boss !== undefined) {
        game.visitRoom(game.D.boss, true);
        log(`  ↳ The boss room location is revealed!`, 'treasure');
      }
      break;
    }
    case 'info': {
      log(`  ↳ Useful lore or tactical insight gained.`, 'sys');
      break;
    }
    default: {
      // Fallback: small gold reward
      const gold = getGoldValue(lvl, reward.value) || 10 + die(10);
      game.gold += gold;
      log(`  ↳ ${gold} gold found.`, 'treasure');
      break;
    }
  }

  // Refresh UI
  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));
}

function challengeBuffType() {
  // Determine what kind of buff based on which skill challenge succeeded
  if (_activeChallenge) {
    const skill = _activeChallenge.challenge.skill;
    if (skill === 'animalHandling') return 'animalFriend';
    if (skill === 'intimidation') return 'bossWeakness';
    if (skill === 'performance') return 'betterShop';
    if (skill === 'persuasion') return 'merchantDiscount';
    if (skill === 'survival') return 'rested';
  }
  return 'genericBuff';
}

function applyFailure(game, outcome, hero) {
  if (!outcome) return;

  if (outcome.effect === 'damage' && hero) {
    // Apply minor damage to the hero who attempted
    const dmg = d20roll(1, 4);
    hero.data.hp = Math.max(0, hero.data.hp - dmg);
    log(`  ↳ ${hero.data.name} takes ${dmg} damage from the mishap.`, 'down');
  }

  // Refresh UI
  updateResources(game);
  updatePartyFrames(game.heroes.map(h => h.data));
}

function getOutcomeLog(challenge, hero, success) {
  const hName = hero ? hero.data.name : 'The party';
  if (success) {
    return `✨ ${hName} succeeds at "${challenge.name}"! ${challenge.onSuccess.text}`;
  } else {
    return `❌ ${hName} fails at "${challenge.name}". ${challenge.onFailure.text}`;
  }
}

/* ================================================================
   UI Overlay — skill challenge modal
   Follows the #shopscreen / .cs-frame pattern
   ================================================================ */
let _overlayEl = null;
let _diceInterval = null;

export function initSkills(game) {
  G = game;
  game._skillsInited = true;

  // Create the overlay (once)
  if (!document.getElementById('challengescreen')) {
    const ov = document.createElement('div');
    ov.id = 'challengescreen';
    ov.innerHTML = `
      <div class="cs-frame challenge-frame">
        <div class="cs-header">
          <div class="cs-tabs">
            <span style="color:#e8c25a; font-weight:700; font-size:14px; letter-spacing:1px;">⚔ SKILL CHALLENGE</span>
          </div>
        </div>
        <div class="cs-body" style="flex-direction:column; padding:20px 24px;">
          <div class="challenge-text" id="challenge-text">
            <div class="challenge-name" id="challenge-name"></div>
            <div class="challenge-desc" id="challenge-desc"></div>
          </div>
          <div class="challenge-dice" id="challenge-dice">
            <div class="challenge-d20" id="challenge-d20">0</div>
            <div class="challenge-hero">
              <div class="ch-hero-name" id="ch-hero-name"></div>
              <div class="ch-skill-label" id="ch-skill-label"></div>
              <div class="ch-stat" id="ch-stat-bonus"></div>
              <div class="ch-stat" id="ch-stat-prof"></div>
              <div class="ch-stat" id="ch-stat-total"></div>
            </div>
          </div>
          <div class="challenge-result" id="challenge-result">
            <div class="ch-result-math" id="ch-result-math"></div>
            <div class="ch-result-verdict" id="ch-result-verdict"></div>
          </div>
          <div class="challenge-outcome" id="challenge-outcome"></div>
          <div class="challenge-reward" id="challenge-reward"></div>
          <div class="challenge-actions">
            <button id="challenge-continue" class="challenge-btn">CONTINUE</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    // Shared resolve for both manual click and auto-continue timer
    function resolveChallenge() {
      if (_autoContinueTimer) { clearTimeout(_autoContinueTimer); _autoContinueTimer = null; }
      dismissOverlay();
      if (_resolveOverlay) {
        _resolveOverlay();
        _resolveOverlay = null;
      }
    }

    // Continue button
    document.getElementById('challenge-continue').addEventListener('click', resolveChallenge);
  }

  // Inject CSS if not already present
  if (!document.getElementById('skill-challenge-css')) {
    const style = document.createElement('style');
    style.id = 'skill-challenge-css';
    style.textContent = `
      #challengescreen {
        position: fixed; inset: 0; z-index: 52; display: none;
        background: rgba(4,5,9,0.85); backdrop-filter: blur(5px);
        align-items: center; justify-content: center; padding: 24px;
      }
      #challengescreen.show { display: flex; }

      .challenge-frame {
        width: 480px; max-width: 90vw; height: auto;
        background: rgba(14, 16, 22, 0.96);
        border: 1px solid rgba(200, 170, 90, 0.2);
        border-radius: 12px;
        overflow: hidden;
      }
      .challenge-frame .cs-body {
        flex-direction: column !important;
        padding: 20px 24px !important;
        display: flex !important;
      }

      .challenge-text {
        text-align: center;
        margin-bottom: 12px;
      }
      .challenge-name {
        font-size: 20px; font-weight: 700; color: #e8c25a;
        margin-bottom: 8px;
      }
      .challenge-desc {
        font-size: 13px; color: #a8a294; line-height: 1.5;
        padding: 0 8px;
      }

      .challenge-dice {
        display: flex; align-items: center; gap: 20px;
        padding: 16px 20px; margin: 10px 0;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(200,170,90,0.1);
        border-radius: 10px;
      }
      .challenge-d20 {
        width: 72px; height: 72px; flex-shrink: 0;
        background: rgba(35, 30, 25, 0.8);
        border: 2px solid rgba(200, 170, 90, 0.3);
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 32px; font-weight: 700; color: #f0e2c0;
        font-family: 'Georgia', serif;
        transition: border-color 0.3s, color 0.3s;
      }
      .challenge-d20.success { border-color: #6aea6a; color: #6aea6a; }
      .challenge-d20.failure { border-color: #e0483a; color: #e0483a; }
      .challenge-d20.crit { border-color: #ffd34a; color: #ffd34a; text-shadow: 0 0 16px rgba(255,211,74,0.4); }
      .challenge-d20.fumble { border-color: #ff5040; color: #ff5040; text-shadow: 0 0 16px rgba(255,80,64,0.4); }

      .challenge-hero { flex: 1; }
      .ch-hero-name { font-size: 16px; font-weight: 700; color: #f0e6cc; }
      .ch-skill-label { font-size: 12px; color: #8fb0d8; margin: 2px 0 6px; }
      .ch-stat { font-size: 12px; color: #8a8474; }
      .ch-stat b { color: #e8e0cc; }

      .challenge-result {
        text-align: center; padding: 8px 0;
        opacity: 0; transition: opacity 0.4s;
      }
      .challenge-result.show { opacity: 1; }
      .ch-result-math { font-size: 13px; color: #a8a294; margin-bottom: 4px; }
      .ch-result-verdict {
        font-size: 20px; font-weight: 800; letter-spacing: 1px;
      }
      .ch-result-verdict.success { color: #6aea6a; }
      .ch-result-verdict.failure { color: #e0483a; }
      .ch-result-verdict.crit { color: #ffd34a; text-shadow: 0 0 20px rgba(255,211,74,0.3); }

      .challenge-outcome {
        text-align: center; font-size: 13px; color: #c8c0ac;
        line-height: 1.5; padding: 8px 4px; margin: 4px 0 8px;
        opacity: 0; transition: opacity 0.4s;
      }
      .challenge-outcome.show { opacity: 1; }

      .challenge-reward {
        text-align: center; font-size: 14px; font-weight: 700; color: #e8c25a;
        line-height: 1.5; padding: 2px 4px;
        opacity: 0; transition: opacity 0.4s;
      }
      .challenge-reward.show { opacity: 1; }

      .challenge-actions {
        text-align: center; padding: 8px 0 4px;
      }
      .challenge-btn {
        background: linear-gradient(180deg, #b06a28, #8a4e1c); color: #fff;
        border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
        padding: 10px 32px; font-size: 14px; font-weight: 700;
        cursor: pointer; letter-spacing: 1px;
        transition: filter 0.15s;
      }
      .challenge-btn:hover { filter: brightness(1.15); }
    `;
    document.head.appendChild(style);
  }

  log('Skill challenge system ready.', 'sys');
}

function showOverlay(state, onContinue) {
  const ov = document.getElementById('challengescreen');
  if (!ov) return;

  const challenge = state.challenge;
  const heroData = state.hero;
  const skillInfo = SKILLS[challenge.skill];

  // Fill static content
  document.getElementById('challenge-name').textContent = challenge.name;
  document.getElementById('challenge-desc').textContent = challenge.desc;

  const heroName = heroData ? heroData.name : 'Party Member';
  const skillLabel = skillInfo ? skillInfo.label : challenge.skill;
  const abilityLabel = skillInfo ? skillInfo.ability.toUpperCase() : '?';

  document.getElementById('ch-hero-name').textContent = heroName;
  document.getElementById('ch-skill-label').textContent = `${skillLabel} (${abilityLabel})`;

  if (heroData) {
    const abilityMod = heroData.effStats?.[skillInfo?.ability]
      ? mod(heroData.effStats[skillInfo.ability])
      : 0;
    const isProf = heroData.proficiencies?.includes(challenge.skill);
    const pb = isProf ? Math.floor((heroData.level - 1) / 4) + 2 : 0;

    document.getElementById('ch-stat-bonus').innerHTML = `${abilityLabel} mod: <b>${abilityMod >= 0 ? '+' : ''}${abilityMod}</b>`;
    document.getElementById('ch-stat-prof').innerHTML = `Proficiency: <b>${isProf ? `+${pb}` : '—'}</b>`;
    document.getElementById('ch-stat-total').innerHTML = `Total bonus: <b>${state.bonus >= 0 ? '+' : ''}${state.bonus}</b>`;
  } else {
    document.getElementById('ch-stat-bonus').innerHTML = '';
    document.getElementById('ch-stat-prof').innerHTML = '';
    document.getElementById('ch-stat-total').innerHTML = 'Total bonus: <b>+0</b>';
  }

  // Reset result and outcome
  document.getElementById('challenge-result').classList.remove('show');
  document.getElementById('challenge-outcome').classList.remove('show');
  document.getElementById('challenge-outcome').textContent = '';
  const rewardEl = document.getElementById('challenge-reward');
  if (rewardEl) { rewardEl.classList.remove('show'); rewardEl.style.color = '#e8c25a'; rewardEl.textContent = ''; }

  // Store continue callback
  _resolveOverlay = onContinue;

  // Show the overlay
  ov.classList.add('show');

  // Start dice animation with dramatic slowdown
  const d20El = document.getElementById('challenge-d20');
  d20El.className = 'challenge-d20';
  d20El.textContent = '0';

  if (_diceInterval) clearInterval(_diceInterval);

  // Build a sequence of delays that start fast and slow down for suspense
  const rollSequence = [];
  // Phase 1: fast ticks (10 ticks at 40ms)
  for (let i = 0; i < 10; i++) rollSequence.push(40);
  // Phase 2: medium ticks (6 ticks, ramping up)
  for (let i = 0; i < 6; i++) rollSequence.push(70 + i * 6);
  // Phase 3: slow ticks (6 ticks, building to reveal)
  for (let i = 0; i < 6; i++) rollSequence.push(120 + i * 18);
  // Phase 4: final ticks (4 ticks, settling)
  for (let i = 0; i < 4; i++) rollSequence.push(220 + i * 25);

  let seqIdx = 0;

  function nextRollTick() {
    if (seqIdx >= rollSequence.length) {
      // Settle on final roll
      _diceInterval = null;

      d20El.textContent = String(state.d20Roll);
      if (state.isCrit) d20El.className = 'challenge-d20 crit';
      else if (state.isCritFail) d20El.className = 'challenge-d20 fumble';
      else if (state.success) d20El.className = 'challenge-d20 success';
      else d20El.className = 'challenge-d20 failure';

      // Show result
      const resultEl = document.getElementById('challenge-result');
      const mathEl = document.getElementById('ch-result-math');
      const verdictEl = document.getElementById('ch-result-verdict');

      mathEl.textContent = `Roll: ${state.d20Roll} + ${state.bonus} = ${state.total} vs DC ${state.dc}`;

      if (state.isCrit) {
        verdictEl.textContent = '⚡ CRITICAL SUCCESS!';
        verdictEl.className = 'ch-result-verdict crit';
      } else if (state.isCritFail) {
        verdictEl.textContent = '💥 CRITICAL FAILURE!';
        verdictEl.className = 'ch-result-verdict failure';
      } else if (state.success) {
        verdictEl.textContent = '✅ SUCCESS!';
        verdictEl.className = 'ch-result-verdict success';
      } else {
        verdictEl.textContent = '❌ FAILURE';
        verdictEl.className = 'ch-result-verdict failure';
      }

      resultEl.classList.add('show');

      // Show outcome text and reward detail after a brief delay
      setTimeout(() => {
        const outcomeEl = document.getElementById('challenge-outcome');
        const rewardEl = document.getElementById('challenge-reward');
        if (state.success) {
          outcomeEl.textContent = challenge.onSuccess.text;
          if (state.computedReward && state.computedReward.detailText) {
            rewardEl.textContent = `Reward: ${state.computedReward.detailText}`;
            rewardEl.classList.add('show');
          }
        } else {
          outcomeEl.textContent = challenge.onFailure.text;
          if (state.computedFailure && state.computedFailure.detailText) {
            rewardEl.textContent = `${state.computedFailure.detailText}`;
            rewardEl.style.color = '#e0705a';
            rewardEl.classList.add('show');
          }
        }
        outcomeEl.classList.add('show');

        // Start 15s auto-continue timer — player can still click Continue to dismiss sooner
        if (!_autoContinueTimer) {
          _autoContinueTimer = setTimeout(() => {
            const btn = document.getElementById('challenge-continue');
            if (btn) btn.click();
          }, 15000);
        }
      }, 300);

      return;
    }

    // Show random number
    d20El.textContent = String(die(20));
    d20El.className = 'challenge-d20';

    const delay = rollSequence[seqIdx];
    seqIdx++;
    _diceInterval = setTimeout(nextRollTick, delay);
  }

  _diceInterval = setTimeout(nextRollTick, 50);
}

function dismissOverlay() {
  const ov = document.getElementById('challengescreen');
  if (ov) ov.classList.remove('show');
  if (_diceInterval) {
    clearTimeout(_diceInterval);
    _diceInterval = null;
  }
  if (_autoContinueTimer) {
    clearTimeout(_autoContinueTimer);
    _autoContinueTimer = null;
  }
}

/* ================================================================
   Reset dungeon state (called when a new dungeon loads)
   ================================================================ */
export function resetChallengeState() {
  _challengesFired = new Set();
  _activeChallenge = null;
  if (_autoContinueTimer) {
    clearTimeout(_autoContinueTimer);
    _autoContinueTimer = null;
  }
}

/* ================================================================
   Fire a specific camp challenge
   Called during camp/shop events for Persuasion/Insight checks
   ================================================================ */
export function fireCampChallenge(game, skillKey) {
  const pool = _challengesFor(skillKey, 'camp');
  if (pool.length === 0) return false;

  const challenge = pool[Math.floor(Math.random() * pool.length)];
  fireChallenge(game, challenge);
  return true;
}
