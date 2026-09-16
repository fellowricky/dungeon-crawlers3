/**
 * SRD 5.1 rules kit — ability scores, d20 combat math, classes, races,
 * monsters, XP thresholds. Mechanics from the Systems Reference Document 5.1
 * by Wizards of the Coast LLC, licensed under CC-BY-4.0.
 */
import {
  aggregateEquipment, PROF_RANK, WEAPON_RANK, makeStarterItem,
  migrateItem, getBase
} from './items.js';
import {
  featureBonuses, spellSlotsFor, seedNewHeroProgression, migrateProgression,
  applyLevelGrants, initProgressionFields, pendingChoiceCount, hasFeature,
  totalSlots, equipmentGrants, hasDualWielder, featACBonus, isCasterClass,
  SKILL_POINTS_PER_LEVEL
} from './features.js';
export { SKILL_POINTS_PER_LEVEL };
import { getRaceDefaults, migrateVisualColors } from './appearance.js';

/* ---------------- dice ---------------- */
export function d(n){ return 1 + Math.floor(Math.random()*n); }
/**
 * Advantage-aware d20: adv > 0 rolls twice take highest, adv < 0 twice take
 * lowest, 0 rolls once. Callers sum +1/-1 sources — 5e advantage and
 * disadvantage cancel to a single straight roll.
 */
export function d20Roll(adv = 0){
  const a = d(20);
  if (!adv) return a;
  const b = d(20);
  return adv > 0 ? Math.max(a, b) : Math.min(a, b);
}
export function roll(count, sides, bonus=0){
  let t = bonus;
  for(let i=0;i<count;i++) t += d(sides);
  return t;
}
/* 4d6 drop lowest, the classic stat roll */
export function rollStat(){
  const r = [d(6), d(6), d(6), d(6)].sort((a,b)=>b-a);
  return r[0]+r[1]+r[2];
}
export const mod = score => Math.floor((score-10)/2);
export const fmtMod = m => (m>=0?'+':'')+m;

export const ABILITIES = ['str','dex','con','int','wis','cha'];
export const ABILITY_LABEL = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };

export const SKILLS = {
  athletics: { label: 'Athletics', ability: 'str' },
  acrobatics: { label: 'Acrobatics', ability: 'dex' },
  sleightOfHand: { label: 'Sleight of Hand', ability: 'dex' },
  stealth: { label: 'Stealth', ability: 'dex' },
  arcana: { label: 'Arcana', ability: 'int' },
  history: { label: 'History', ability: 'int' },
  investigation: { label: 'Investigation', ability: 'int' },
  nature: { label: 'Nature', ability: 'int' },
  religion: { label: 'Religion', ability: 'int' },
  animalHandling: { label: 'Animal Handling', ability: 'wis' },
  insight: { label: 'Insight', ability: 'wis' },
  medicine: { label: 'Medicine', ability: 'wis' },
  perception: { label: 'Perception', ability: 'wis' },
  survival: { label: 'Survival', ability: 'wis' },
  deception: { label: 'Deception', ability: 'cha' },
  intimidation: { label: 'Intimidation', ability: 'cha' },
  performance: { label: 'Performance', ability: 'cha' },
  persuasion: { label: 'Persuasion', ability: 'cha' }
};

/* Skill ranks: every level-up banks SKILL_POINTS_PER_LEVEL points in
   h.pendingSkillRank, spent on the SKILLS above (h.skillRanks[key]) for a flat
   +1 each on top of ability mod + proficiency. Capped per skill.
   NOTE the deliberately similar names — h.skills / h.pendingSkill are the
   older per-CLASS talent tree (CLASSES[k].skills), a different system. */
export const SKILL_RANK_MAX = 5;

/* proficiency bonus by level (SRD table) */
export const profBonus = lvl => 2 + Math.floor((lvl-1)/4);

/* 5e class saving-throw proficiencies. Proficient saves get the proficiency
   bonus on top of the ability mod (see recalc → h.saves; rollSave prefers
   data.saves over the bare ability mod). This is what lets a fighter shrug
   off poison (CON) while still fearing Fireball (DEX) and Fear (WIS). */
/* Damage types a gear `elem*` affix can carry. Mirrors ELEM_TYPES in budget.js;
   duplicated here so the rules layer doesn't import the pricing layer. */
export const ELEM_DAMAGE_TYPES = ['fire','cold','lightning','acid','poison','necrotic','radiant','force','psychic'];

/**
 * TIER-0 starting kit. Every entry is a ZERO-POINT base: no `prim` block, a d4
 * die, and body armor that sets no AC floor (so a level-1 hero is genuinely
 * unarmored at 10 + Dex).
 *
 * This is deliberate. Classes used to start in a Longsword and a Chain Shirt,
 * which meant a level-1 Club drop was strictly WORSE than free gear and the
 * first hour of loot felt like nothing. Now the very first drop of a level-1
 * quest is an upgrade. Class identity is carried by the SHAPE of the weapon
 * (finesse / focus / two-handed / ranged), never by its numbers.
 *
 * `armor` names the mechanical chassis (both chassis are identical: no prim, no
 * AC floor, prof 'none'). `look` re-skins and re-names that chassis per class so
 * a fresh party doesn't line up in twelve identical beige shirts. Nothing in
 * `look` touches a single number — it is purely which LPC sheets get drawn.
 *
 * Only sheets with the full animation set are used here: `waist/belt_mage` and
 * `waist/buckles` ship no thrust/shoot upstream, so a caster wearing one would
 * lose their belt on every wand attack.
 */
export const STARTER_GEAR = {
  fighter: { weapon: 'Club', armor: 'Peasant Shirt', look: {
    name: 'Sparring Leathers', torso: 'armour/leather', legs: 'pants_leather',
    belt: 'belt_double', color: '#8a5f36' } },

  barbarian: { weapon: 'Club', armor: 'Peasant Shirt', look: {
    name: 'Hide Wraps', torso: 'clothes/sleeveless', legs: 'fur',
    belt: 'belt_leather', shoulders: 'bauldron', color: '#9c6a3c' } },

  paladin: { weapon: 'Club', armor: 'Peasant Shirt', look: {
    name: 'Squire\'s Tabard', torso: 'jacket/tabard',
    sleeves: 'clothes/longsleeve/longsleeve', legs: 'pants_slate',
    belt: 'belt_double', color: '#3f5fb0' } },

  cleric: { weapon: 'Club', armor: 'Peasant Shirt', look: {
    name: 'Acolyte\'s Vestments', torso: 'clothes/tunic',
    sleeves: 'clothes/longsleeve/longsleeves', legs: 'hose',
    belt: 'belt_robe', color: '#c09a3e' } },

  rogue: { weapon: 'Rusty Dagger', armor: 'Peasant Shirt', look: {
    name: 'Cutpurse\'s Blacks', torso: 'clothes/longsleeve/longsleeve2',
    legs: 'pants_charcoal', belt: 'belt_leather', color: '#3c3c48' } },

  bard: { weapon: 'Rusty Dagger', armor: 'Peasant Shirt', look: {
    name: 'Busker\'s Motley', torso: 'clothes/vest',
    sleeves: 'clothes/longsleeve/laced', legs: 'cuffed',
    belt: 'belt_loose', cape: 'trim', color: '#8b3fa8' } },

  ranger: { weapon: 'Frayed Sling', armor: 'Peasant Shirt', look: {
    name: 'Trailworn Tunic', torso: 'clothes/tunic', legs: 'pants_walnut',
    belt: 'belt_leather', cape: 'solid', color: '#4c6a38' } },

  monk: { weapon: 'Cracked Staff', armor: 'Torn Robe', look: {
    name: 'Novice\'s Wrap', torso: 'clothes/sleeveless', legs: 'hose',
    belt: 'sash', color: '#b05f2a' } },

  druid: { weapon: 'Cracked Staff', armor: 'Torn Robe', look: {
    name: 'Mossbound Robe', torso: 'clothes/robe',
    sleeves: 'clothes/longsleeve/longsleeves', legs: 'hose',
    belt: 'belt_robe', shoulders: 'mantal', color: '#4f7a3f' } },

  wizard: { weapon: 'Wooden Wand', armor: 'Torn Robe', look: {
    name: 'Apprentice\'s Robe', torso: 'clothes/robe',
    sleeves: 'clothes/longsleeve/longsleeves_cuffed', legs: 'hose',
    belt: 'belt_robe', color: '#33509c' } },

  sorcerer: { weapon: 'Wooden Wand', armor: 'Torn Robe', look: {
    name: 'Bloodline Robe', torso: 'clothes/robe',
    sleeves: 'clothes/longsleeve/scoop', legs: 'hose',
    belt: 'sash', color: '#a32e3c' } },

  warlock: { weapon: 'Wooden Wand', armor: 'Torn Robe', look: {
    name: 'Pact-Marked Robe', torso: 'clothes/robe',
    sleeves: 'clothes/longsleeve/longsleeve2_cardigan', legs: 'hose',
    belt: 'belt_robe', cape: 'tattered', color: '#5b2f86' } },
};

export const CLASS_SAVES = {
  fighter:   ['str','con'],
  rogue:     ['dex','int'],
  cleric:    ['wis','cha'],
  wizard:    ['int','wis'],
  barbarian: ['str','con'],
  bard:      ['dex','cha'],
  druid:     ['int','wis'],
  monk:      ['str','dex'],
  paladin:   ['wis','cha'],
  ranger:    ['str','dex'],
  sorcerer:  ['con','cha'],
  warlock:   ['wis','cha'],
  wolf:      ['str','dex'],
  familiar:  ['dex','wis'],
};

/* XP needed to REACH each level (index = level) — tripled after level 2 */
const default_xp_table = [0, 0, 71, 1181, 3038, 5768, 9518, 14382, 20770, 28601, 37957, 49099, 62044, 77132, 94486, 113533, 133904, 155690, 178818, 203264, 229068];
let loaded_xp_table = default_xp_table;
try {
  const stored = globalThis.localStorage?.getItem('dc_xp_table');
  if (stored) loaded_xp_table = JSON.parse(stored);
} catch (e) {}
export const XP_TABLE = loaded_xp_table;
export const MAX_LEVEL = 20;

/* ---------------- races (SRD) ---------------- */
export const RACES = {
  /* `speed`    — continuous-move multiplier (gear/skill balance; feeds speedMult)
   * `speedFt`  — base D&D 5e speed in feet, used by the tactical turn engine
   *              (turn_engine.cellsForSpeed) to derive a per-turn cell budget.
   *              Small races (dwarf/gnome/halfling) are 25 ft; all others 30 ft. */
  human:      { label:'Human',    bonus:{str:1,dex:1,con:1,int:1,wis:1,cha:1}, speed:1.0, speedFt:30, trait:'Versatile: +1 to every ability score.' },
  dwarf:      { label:'Hill Dwarf', bonus:{con:2,wis:1}, speed:0.9, speedFt:25, hpPerLevel:1, trait:'Dwarven Toughness: +1 HP per level.' },
  elf:        { label:'High Elf', bonus:{dex:2,int:1}, speed:1.1, speedFt:30, critFinesse:true, trait:'Keen Senses: Proficiency in Perception. Crits on 19–20 with ranged attacks.', skills: ['perception'] },
  halfling:   { label:'Lightfoot Halfling', bonus:{dex:2,cha:1}, speed:1.0, speedFt:25, lucky:true, trait:'Lucky: rerolls natural 1s on attack rolls.' },
  halforc:    { label:'Half-Orc', bonus:{str:2,con:1}, speed:1.0, speedFt:30, savageCrit:true, trait:'Savage Attacks: Proficiency in Intimidation. +1 damage die on melee crits.', skills: ['intimidation'] },
  dragonborn: { label:'Dragonborn', bonus:{str:2,cha:1}, speed:1.0, speedFt:30, trait:'Draconic Ancestry: resistance to elemental damage.' },
  gnome:      { label:'Rock Gnome', bonus:{int:2,con:1}, speed:0.9, speedFt:25, trait:'Gnome Cunning: +2 on saving throws against magic.' },
  halfelf:    { label:'Half-Elf', bonus:{cha:2,dex:1,con:1}, speed:1.0, speedFt:30, trait:'Skill Versatility: Proficiency in 2 extra skills of choice.', skills: ['deception', 'persuasion'] },
  tiefling:   { label:'Tiefling', bonus:{cha:2,int:1}, speed:1.0, speedFt:30, trait:'Hellish Resistance: +1 AC and fire resistance.' },
  /* Not a player option — the stat block behind the ranger's wolf companion.
     `internal` keeps it out of every race picker; see PLAYABLE_RACES. */
  wolf:       { label:'Wolf', internal:true, bonus:{str:2,dex:2,con:2,int:0,wis:2,cha:0}, speed:1.2, speedFt:40, trait:'Pack Tactics: Advantage on attacks when near an ally.' },
  familiar:   { label:'Familiar', internal:true, bonus:{str:0,dex:2,con:0,int:0,wis:2,cha:0}, speed:1.2, speedFt:40, trait:'Flyby: Agile natural attacks.' }
};


/* ---------------- classes (SRD) ----------------
   statPriority: rolled stats are assigned best-first in this order.
   attack: the weapon/cantrip profile used by the auto-battler. */
export const CLASSES = {
  fighter: {
    label:'Fighter', color:0xd9a441, hitDie:10, armorProf:'heavy', shieldProf:true, weaponProf:'martial',
    statPriority:['str','con','dex','wis','cha','int'],
    baseAC:16, acDesc:'Chain mail',
    attack:{ name:'Longsword', ability:'str', dmg:[1,8], range:1.5, melee:true },
    feature:'Second Wind: once per dungeon, self-heal when badly hurt.',
    secondWind:true,
    skills:[
      { key:'weaponMaster', name:'Weapon Master', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'brute',        name:'Brute',         max:5, desc:'+1 weapon damage per rank.',    b:{dmg:1} },
      { key:'toughness',    name:'Toughness',     max:5, desc:'+6 max HP per rank.',           b:{hp:6} },
      { key:'guardian',     name:'Guardian',      max:3, desc:'+1 AC per rank.',               b:{ac:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['athletics', 'acrobatics', 'history', 'insight', 'intimidation', 'perception', 'survival']
    }
  },
  rogue: {
    label:'Rogue', color:0x8f95a3, hitDie:8, armorProf:'light', shieldProf:false, weaponProf:'simple', weaponSpecific:['Rapier','Shortsword','Longsword'],
    statPriority:['dex','con','wis','int','cha','str'],
    baseAC:11, acPlusDex:true, acDesc:'Leather armor + Dex',
    attack:{ name:'Shortbow', ability:'dex', dmg:[1,6], range:7, melee:false },
    feature:'Sneak Attack: bonus damage when an ally is adjacent to the target.',
    sneakDice: lvl => Math.ceil(lvl/2),
    skills:[
      { key:'deadlyAim',  name:'Deadly Aim', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'assassin',   name:'Assassin',   max:2, desc:'Crit range widens by 1 per rank (crit on 19, then 18).', b:{crit:1} },
      { key:'evasion',    name:'Evasion',    max:4, desc:'+1 AC per rank.',               b:{ac:1} },
      { key:'fleetfoot',  name:'Fleet-Foot', max:4, desc:'+5 ft Move (1 tile) per rank.',      b:{move:5} }
    ],
    skillChoices: {
      count: 4,
      list: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth']
    }
  },
  cleric: {
    label:'Cleric', color:0x5a8fe8, hitDie:8, armorProf:'medium', shieldProf:true, weaponProf:'simple',
    statPriority:['wis','con','str','cha','dex','int'],
    baseAC:16, acDesc:'Scale mail + shield',
    attack:{ name:'Sacred Flame', ability:'wis', dmg:[1,8], range:6, melee:false, cantripScale:true, isSave:true, saveAbility:'dex' },
    feature:'Cure Wounds: heals the most wounded ally (slots recharge on short/long rest).',
    healer:true,
    skills:[
      { key:'blessedHealer', name:'Blessed Healer', max:5, desc:'+3 healing per rank.',        b:{heal:3} },
      { key:'divineFavor',   name:'Divine Favor',   max:5, desc:'+1 Sacred Flame damage per rank.', b:{dmg:1} },
      { key:'sanctuary',     name:'Sanctuary',      max:3, desc:'+1 AC per rank.',              b:{ac:1} },
      { key:'devotion',      name:'Devotion',       max:4, desc:'+5 max HP per rank.',          b:{hp:5} }
    ],
    skillChoices: {
      count: 2,
      list: ['history', 'insight', 'medicine', 'persuasion', 'religion']
    }
  },
  wizard: {
    label:'Wizard', color:0x9b6cf0, hitDie:6, armorProf:'none', shieldProf:false, weaponProf:'simple',
    statPriority:['int','con','dex','wis','cha','str'],
    baseAC:10, acPlusDex:true, acDesc:'No armor + Dex',
    attack:{ name:'Fire Bolt', ability:'int', dmg:[1,10], range:8, melee:false, cantripScale:true, isSave:true, saveAbility:'dex' },
    feature:'Arcane Study: at level 3, chooses a school with slot-fueled spells.',
    blaster:true,
    skills:[
      { key:'evoker',     name:'Evoker',      max:5, desc:'+1 Fire Bolt damage per rank.', b:{dmg:1} },
      { key:'focused',    name:'Focused',     max:5, desc:'+1 to attack rolls per rank.',  b:{atk:1} },
      { key:'arcaneWard', name:'Arcane Ward', max:5, desc:'+4 max HP per rank.',           b:{hp:4} },
      { key:'mageArmor',  name:'Mage Armor',  max:3, desc:'+1 AC per rank.',               b:{ac:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion']
    }
  },
  barbarian: {
    label:'Barbarian', color:0xe74c3c, hitDie:12, armorProf:'medium', shieldProf:true, weaponProf:'martial',
    statPriority:['str','con','dex','wis','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Unarmored Defense',
    attack:{ name:'Greatsword', ability:'str', dmg:[2,6], range:1.6, melee:true },
    feature:'Rage: enter Rage when hurt (+2 melee dmg, +2 AC, halve incoming dmg).',
    skills:[
      { key:'savageStrikes', name:'Savage Strikes', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'unarmoredToughness', name:'Toughness', max:5, desc:'+6 max HP per rank.', b:{hp:6} },
      { key:'dangerSense', name:'Danger Sense', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'furiousAtk', name:'Furious Attack', max:3, desc:'+1 to attack rolls per rank.', b:{atk:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival']
    }
  },
  bard: {
    label:'Bard', color:0xe8a8ff, hitDie:8, armorProf:'light', shieldProf:false, weaponProf:'simple', weaponSpecific:['Rapier','Shortsword','Longsword'],
    statPriority:['cha','dex','con','wis','str','int'],
    baseAC:11, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Rapier', ability:'cha', dmg:[1,8], range:1.5, melee:true },
    feature:'Bardic Inspiration: grants the whole party advantage on their next attack.',
    healer:true,
    skills:[
      { key:'loreMaster', name:'Lore Master', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'inspirePower', name:'Inspiring Voice', max:5, desc:'+1 healing per rank.', b:{heal:1} },
      { key:'defensiveInsp', name:'Defensive Riffs', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'hearty', name:'Hearty', max:4, desc:'+5 max HP per rank.', b:{hp:5} }
    ],
    skillChoices: {
      count: 3,
      list: ['athletics', 'acrobatics', 'sleightOfHand', 'stealth', 'arcana', 'history', 'investigation', 'nature', 'religion', 'animalHandling', 'insight', 'medicine', 'perception', 'survival', 'deception', 'intimidation', 'performance', 'persuasion']
    }
  },
  druid: {
    label:'Druid', color:0x2ecc71, hitDie:8, armorProf:'medium', shieldProf:true, weaponProf:'simple', weaponSpecific:['Scimitar'],
    statPriority:['wis','con','dex','int','cha','str'],
    baseAC:12, acPlusDex:true, acDesc:'Leather Shield + Hide',
    attack:{ name:'Produce Flame', ability:'wis', dmg:[1,8], range:6, melee:false, cantripScale:true, isSave:true, saveAbility:'wis' },
    feature:'Wild Shape: transforms into a Bear (+20 temp HP, 2d6 claws).',
    healer:true,
    skills:[
      { key:'natureWrath', name:'Nature Wrath', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'wildVitality', name:'Wild Vitality', max:5, desc:'+6 max HP per rank.', b:{hp:6} },
      { key:'barkskin', name:'Barkskin', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'naturalHealer', name:'Natural Healer', max:3, desc:'+3 healing per rank.', b:{heal:3} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'animalHandling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival']
    }
  },
  monk: {
    label:'Monk', color:0x3498db, hitDie:8, armorProf:'none', shieldProf:false, weaponProf:'simple', weaponSpecific:['Shortsword'],
    statPriority:['dex','wis','con','str','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Unarmored Defense',
    attack:{ name:'Unarmed Strike', ability:'dex', dmg:[1,6], range:1.4, melee:true },
    feature:'Ki Pool: spend Ki for Flurry of Blows, Patient Defense, Step of the Wind, and Stunning Strike.',
    skills:[
      { key:'martialArts', name:'Martial Arts', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'unarmoredDef', name:'Unarmored Defense', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'fastMovement', name:'Fast Movement', max:4, desc:'+5 ft Move (1 tile) per rank.', b:{move:5} },
      { key:'kiVitality', name:'Ki Vitality', max:5, desc:'+5 max HP per rank.', b:{hp:5} }
    ],
    skillChoices: {
      count: 2,
      list: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth']
    }
  },
  paladin: {
    label:'Paladin', color:0xf1c40f, hitDie:10, armorProf:'heavy', shieldProf:true, weaponProf:'martial',
    statPriority:['str','cha','con','wis','dex','int'],
    baseAC:16, acDesc:'Chain mail + shield',
    attack:{ name:'Longsword', ability:'str', dmg:[1,8], range:1.5, melee:true },
    feature:'Divine Smite: once per short rest, deal +2d8 radiant damage.',
    skills:[
      { key:'divineSmitePower', name:'Divine Smite', max:5, desc:'+1 attack damage per rank.', b:{dmg:1} },
      { key:'auraOfProtection', name:'Aura of Protection', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'layOnHands', name:'Lay on Hands', max:5, desc:'+3 healing per rank.', b:{heal:3} },
      { key:'holyToughness', name:'Holy Toughness', max:5, desc:'+6 max HP per rank.', b:{hp:6} }
    ],
    skillChoices: {
      count: 2,
      list: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion']
    }
  },
  ranger: {
    label:'Ranger', color:0x1abc9c, hitDie:10, armorProf:'medium', shieldProf:true, weaponProf:'martial',
    statPriority:['dex','wis','con','str','cha','int'],
    baseAC:12, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Longbow', ability:'dex', dmg:[1,8], range:8, melee:false },
    feature:'Favored Enemy: deal +2 extra damage against all monsters.',
    skills:[
      { key:'archeryStyle', name:'Archery Style', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'huntersPrey', name:'Hunters Prey', max:5, desc:'+1 weapon damage per rank.', b:{dmg:1} },
      { key:'natureSurvival', name:'Nature Survival', max:5, desc:'+5 max HP per rank.', b:{hp:5} },
      { key:'elusive', name:'Elusive', max:3, desc:'+1 AC per rank.', b:{ac:1} }
    ],
    skillChoices: {
      count: 3,
      list: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival']
    }
  },
  sorcerer: {
    label:'Sorcerer', color:0xe67e22, hitDie:6, armorProf:'none', shieldProf:false, weaponProf:'simple',
    statPriority:['cha','con','dex','int','wis','str'],
    baseAC:10, acPlusDex:true, acDesc:'No armor + Dex',
    attack:{ name:'Chill Touch', ability:'cha', dmg:[1,8], range:8, melee:false, cantripScale:true, isSave:true, saveAbility:'con' },
    feature:'Tides of Chaos: once per short rest, gain advantage (+5 to hit).',
    blaster:true,
    skills:[
      { key:'draconicMagic', name:'Draconic Magic', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'sorcerousAtk', name:'Sorcerous Attack', max:5, desc:'+1 to attack rolls per rank.', b:{atk:1} },
      { key:'mageShield', name:'Mage Shield', max:3, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'bloodlineToughness', name:'Bloodline Toughness', max:5, desc:'+4 max HP per rank.', b:{hp:4} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion']
    }
  },
  warlock: {
    label:'Warlock', color:0x9b59b6, hitDie:8, armorProf:'light', shieldProf:false, weaponProf:'simple',
    statPriority:['cha','con','dex','wis','int','str'],
    baseAC:11, acPlusDex:true, acDesc:'Leather Armor + Dex',
    attack:{ name:'Eldritch Blast', ability:'cha', dmg:[1,10], range:8, melee:false, cantripScale:true, isSave:true, saveAbility:'cha' },
    feature:'Eldritch Blast: fires 1 beam of force (1d10), +1 beam at level 5.',
    blaster:true,
    skills:[
      { key:'eldritchInvoc', name:'Eldritch Invocation', max:5, desc:'+1 spell damage per rank.', b:{dmg:1} },
      { key:'shadowArmor', name:'Shadow Armor', max:5, desc:'+1 AC per rank.', b:{ac:1} },
      { key:'fiendResilience', name:'Fiendish Vigor', max:5, desc:'+5 max HP per rank.', b:{hp:5} },
      { key:'dreadAtk', name:'Dread Attack', max:3, desc:'+1 to attack rolls per rank.', b:{atk:1} }
    ],
    skillChoices: {
      count: 2,
      list: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion']
    }
  },
  /* Not a player option — the class half of the wolf companion's stat block. */
  wolf: {
    label:'Beast', internal:true, color:0xa0c080, hitDie:10, armorProf:'none', shieldProf:false, weaponProf:'simple',
    statPriority:['dex','str','con','wis','int','cha'],
    baseAC:13, acPlusDex:true, acDesc:'Natural armor + Dex',
    attack:{ name:'Bite', ability:'dex', dmg:[1,8], range:1.5, melee:true },
    feature:'Pack Tactics & Trip Bite.',
    skills:[]
  },
  /* Familiar companion stat block */
  familiar: {
    label:'Familiar', internal:true, color:0x88ccff, hitDie:4, armorProf:'none', shieldProf:false, weaponProf:'simple',
    statPriority:['dex','wis','int','con','str','cha'],
    baseAC:11, acPlusDex:true, acDesc:'Natural armor + Dex',
    attack:{ name:'Talon', ability:'dex', dmg:[1,4], range:1.5, melee:true },
    feature:'Flyby: Agile natural attacks.',
    skills:[]
  }
};
/* Races and classes the player may actually pick, in display order. The wolf
   entries exist only as the ranger companion's stat block and must never show
   up in a picker. */
export const PLAYABLE_RACES = Object.entries(RACES).filter(([, r]) => !r.internal);
export const PLAYABLE_CLASSES = Object.entries(CLASSES).filter(([, c]) => !c.internal);

export function classSkill(classKey, skillKey){
  return (CLASSES[classKey].skills||[]).find(s=>s.key===skillKey);
}

/* ---------------- subclasses ----------------
   Chosen once at level 3. Each grants a passive (pb: same bonus keys as
   skills/gear, folded in by recalc) and an ACTIVE ability the auto-battler
   fires on its own. Actives sit on SRD-style recharge tiers:
     'short' — once per short rest (the party rests between fights)
     'day'   — once per day (recharges when descending to a new floor)
     'slot'  — spends a spell slot from a pool (refilled at shrines + floors)
   Champion / Thief / Life Domain / Evoker are the SRD 5.1 subclasses; the
   second option for each class is built from SRD mechanics. */
export const SUBCLASS_UNLOCK = 3;
export const SUBCLASSES = {
  fighter: {
    champion: { label:'Champion', srd:true,
      passive:'Improved Critical: crit on 19–20. Survivor: every critical hit heals you.', pb:{crit:1}, passiveKey:'survivor',
      active:{ key:'remarkableAthlete', name:'Remarkable Athlete', recharge:'short',
        desc:'Perform at peak physical capacity: +10% speed and +2 AC for 30 seconds.' } },
    guardian: { label:'Banneret',
      passive:'Hold the Line: +1 AC, and +2 more AC while a nearby ally is bloodied.', pb:{ac:1}, passiveKey:'holdTheLine',
      active:{ key:'rallyingCry', name:'Rallying Cry', recharge:'long',
        desc:'When two allies are bloodied, a battle-shout heals every ally 1d10 + level.' } }
  },
  rogue: {
    thief: { label:'Thief', srd:true,
      passive:'Fast Hands: +5 ft Move (1 tile), +25% gold. Opportunist: +1d4 damage to wounded foes.', pb:{move:5}, chestGold:0.25, passiveKey:'opportunist',
      active:{ key:'fastHands', name:'Fast Hands', recharge:'short',
        desc:'Use sleight of hand to throw a smoke bomb, blinding all nearby enemies for 6s.' } },
    /* internal key stays 'nightblade' to preserve existing saves; the SRD/PHB
       subclass this maps to is the Assassin (auto-crit = Assassinate). */
    nightblade: { label:'Assassin',
      passive:'Assassin\'s Mark: +1 weapon damage, and +1d6 against foes still at full health.', pb:{dmg:1}, passiveKey:'assassinsMark',
      active:{ key:'deathstrike', name:'Assassinate', recharge:'short',
        desc:'The first strike against an unwounded foe is an automatic critical hit.' } }
  },
  cleric: {
    life: { label:'Life Domain', srd:true,
      passive:'Disciple of Life: +2 healing, and allies gain temporary HP at the start of each fight.', pb:{heal:2}, passiveKey:'discipleOfLife',
      active:{ key:'preserveLife', name:'Preserve Life', recharge:'long',
        desc:'Channel Divinity: when two allies are badly hurt, heal every ally 2 × level + WIS.' } },
    war: { label:'War Domain',
      passive:'War God’s Favor: +1 to attack rolls, and your first strike each fight has advantage.', pb:{atk:1}, passiveKey:'warBlessing',
      active:{ key:'guidedStrike', name:'Guided Strike', recharge:'short',
        desc:'Against an elite or boss: the next attack gains +10 to hit and +2d8 damage.' } }
  },
  wizard: {
    evoker: { label:'Evoker', srd:true,
      passive:'Empowered Evocation: +2 spell damage; your bolts sometimes arc to a second foe.', pb:{dmg:2}, passiveKey:'sculptedBlast',
      active:{ key:'fireball', name:'Fireball', recharge:'slot',
        desc:'Spend a spell slot to engulf packed enemies in an 8d6 blast.' } },
    abjurer: { label:'Abjurer',
      passive:'Arcane Ward: +1 AC, +6 max HP, and a temp-HP shield at the start of each fight.', pb:{ac:1, hp:6}, passiveKey:'arcaneWard',
      active:{ key:'magicMissile', name:'Magic Missile', recharge:'slot',
        desc:'Spend a spell slot to fire unerring darts — 3 auto-hits of 1d4+1, +1 dart per 4 levels.' } }
  },
  barbarian: {
    berserker: { label:'Berserker', srd:true,
      passive:'Frenzy: +1 melee damage; each kill stokes a stacking damage bonus.', pb:{dmg:1}, passiveKey:'bloodlust',
      active:{ key:'frenzy', name:'Frenzy', recharge:'short',
        desc:'Enter a frenzied rage, instantly attacking again on hit.' } },
    totem: { label:'Totem Warrior',
      passive:'Aspect of the Bear: +1 AC, and take 20% less damage while below half health.', pb:{ac:1}, passiveKey:'bearSpirit',
      active:{ key:'bearTotem', name:'Bear Totem', recharge:'short',
        desc:'Summon the bear spirit, halving all incoming damage for 8 seconds.' } }
  },
  bard: {
    lore: { label:'College of Lore', srd:true,
      passive:'Peerless Skill: +1 to attack rolls, and +1d4 to hit against elites and bosses.', pb:{atk:1}, passiveKey:'peerlessSkill',
      active:{ key:'cuttingWords', name:'Cutting Words', recharge:'short',
        desc:'Lower an elite or boss\'s AC by 4 and speed by 30% for 6 seconds.' } },
    valor: { label:'College of Valor',
      passive:'Combat Inspiration: +1 AC, and each kill heals your most-wounded ally.', pb:{ac:1}, passiveKey:'songOfVictory',
      active:{ key:'combatInspiration', name:'Combat Inspiration', recharge:'short',
        desc:'Play a battle song, granting all allies +3 to hit for 8 seconds.' } }
  },
  druid: {
    land: { label:'Circle of the Land', srd:true,
      passive:'Natural Recovery: +1 spell attack; your kills sometimes restore a spell slot.', pb:{atk:1}, passiveKey:'naturalRecovery',
      active:{ key:'entangle', name:'Entangle', recharge:'short',
        desc:'Roots all nearby enemies for 4 seconds, dealing 1d6 damage.' } },
    moon: { label:'Circle of the Moon',
      passive:'Primal Strike: +1 claw damage, and a hide of temporary HP at the start of each fight.', pb:{dmg:1}, passiveKey:'thickHide',
      active:{ key:'wildShape', name:'Wild Shape', recharge:'short',
        desc:'Transform into your chosen Beast Form with a dedicated health pool and beast stats.' } }
  },
  monk: {
    openhand: { label:'Open Hand', srd:true,
      passive:'Open Hand Technique: +5 ft Move (1 tile); your first hit each fight strikes with extra force.', pb:{move:5}, passiveKey:'openHandTech',
      active:{ key:'quiveringPalm', name:'Quivering Palm', recharge:'short',
        desc:'Deliver a vibrations strike to a boss/elite dealing 4d10 damage.' } },
    shadow: { label:'Way of Shadow',
      passive:'Cloak of Shadows: +1 AC, and +2 more AC while at full health (unseen).', pb:{ac:1}, passiveKey:'cloakOfShadows',
      active:{ key:'shadowStep', name:'Shadow Step', recharge:'short',
        desc:'Teleport behind a foe, gaining +4 to hit and +2d6 damage.' } }
  },
  paladin: {
    devotion: { label:'Oath of Devotion', srd:true,
      passive:'Sacred Weapon: +1 to attack rolls, and +1d6 radiant damage vs undead and fiends.', pb:{atk:1}, passiveKey:'sacredWrath',
      active:{ key:'sacredWeapon', name:'Sacred Weapon', recharge:'short',
        desc:'Bless your blade, adding +4 to hit and +1d8 radiant damage for 8s.' } },
    vengeance: { label:'Oath of Vengeance',
      passive:'Relentless Avenger: +1 weapon damage, and +2 more against wounded foes.', pb:{dmg:1}, passiveKey:'relentless',
      active:{ key:'vowOfEnmity', name:'Vow of Enmity', recharge:'short',
        desc:'Swear an oath, gaining advantage (+5 to hit) against elite/boss targets.' } }
  },
  ranger: {
    hunter: { label:'Hunter', srd:true,
      passive:'Giant Killer: +1 weapon damage, and +2 more against foes still at full health.', pb:{dmg:1}, passiveKey:'giantKiller',
      active:{ key:'colossusSlayer', name:'Colossus Slayer', recharge:'short',
        desc:'Deals +1d8 extra damage if the target is already below max HP.' } },
    beastmaster: { label:'Beast Master',
      passive:'Beast Bond: +1 AC; your companion mends your wounds on each kill.', pb:{ac:1}, passiveKey:'bestialBond',
      active:{ key:'summonCompanion', name:'Summon Companion', recharge:'short',
        desc:'Call forth a loyal wolf companion to fight alongside the party. It persists until dismissed and revives on a short rest.' } }
  },
  sorcerer: {
    draconic: { label:'Draconic Blood', srd:true,
      passive:'Elemental Affinity: +1 AC, +4 max HP, and +2 elemental damage on every hit.', pb:{ac:1, hp:4}, passiveKey:'elementalAffinity',
      active:{ key:'dragonBreath', name:'Dragon Breath', recharge:'short',
        desc:'Breathe fire in a cone, dealing 3d6 damage to all nearby enemies.' } },
    wildmagic: { label:'Wild Magic',
      passive:'Tides of Chaos: +1 spell attack; each fight begins with a random surge of magic.', pb:{atk:1}, passiveKey:'tidesOfChaosPassive',
      active:{ key:'wildSurge', name:'Wild Magic Surge', recharge:'short',
        desc:'Release a surge of wild magic that heals all allies for 1d10 + level.' } }
  },
  warlock: {
    fiend: { label:'The Fiend', srd:true,
      passive:'Dark One\'s Blessing: +1 spell damage, and temporary HP whenever you slay a foe.', pb:{dmg:1}, passiveKey:'darkBlessing',
      active:{ key:'fiendishBlessing', name:'Fiendish Blessing', recharge:'short',
        desc:'Gain +10 temporary HP when starting combat.' } },
    archfey: { label:'The Archfey',
      passive:'Beguiling Defenses: +1 AC; your hits sometimes leave foes frightened.', pb:{ac:1}, passiveKey:'beguiling',
      active:{ key:'feyPresence', name:'Fey Presence', recharge:'short',
        desc:'Charm all nearby enemies, preventing them from attacking for 3 seconds.' } }
  }
};
export const RECHARGE_LABEL = { short:'1 / short rest', long:'1 / long rest', day:'1 / long rest', slot:'spell slots' };

export const WILD_SHAPE_FORMS = {
  bear: {
    key: 'bear',
    label: 'Bear Form',
    icon: '🐻',
    stat: 'con',
    desc: 'Tank Specialization (+4 CON, +2 STR, +2 AC, massive HP pool).',
    sprite: 'sprites/bear.png',
    animations: {
      idle: {
        sprite: 'sprites/Bear/Idle/bear_idle_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 8, loop: true
      },
      attack: {
        sprite: 'sprites/Bear/Attack/bear_attack_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 12, loop: false
      }
    },
    /* Frame size does not set apparent size: the bear is drawn only 34px tall
       inside its 96px frame (35%), where the wolf fills 62px (65%). On the
       shared BeastSprite default of 1.6 the bear therefore rendered at little
       over HALF the wolf's on-screen height — the tank form was the smallest
       beast in the game. 3.1 puts it at ~1.06x the wolf's height and ~1.8x its
       width, which is the bulk a bear should read with.
       Its feet also sit 27px above the frame bottom (the wolf's: 16), so it
       needs its own foot line or the default 4% anchor floats it. */
    scaleX: 3.1,
    scaleY: 3.1,
    anchorY: 27 / 96,
    hpFormula: (level, conM) => 25 + level * 6 + Math.max(0, conM) * 2,
    acBonus: 2,
    statBonus: { con: 4, str: 2 },
    atkBonus: 2,
    dmgBonus: 3
  },
  wolf: {
    key: 'wolf',
    label: 'Wolf Form',
    icon: '🐺',
    stat: 'str',
    desc: 'Offense Specialization (+4 STR, +2 DEX, +1 AC, Expanded Crit Range 18–20).',
    sprite: 'sprites/wolf.png',
    animations: {
      idle: {
        sprite: 'sprites/Wolf/Idle/wolf_idle_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 8, loop: true
      },
      attack: {
        sprite: 'sprites/Wolf/Attack/wolf_attack_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 12, loop: false
      }
    },
    /* Paws sit 16px above the bottom of the 96px frame, so the shared 4%
       anchor left the wolf hovering too — less than the bear, but still off
       the floor. See BeastSprite's anchorY. */
    anchorY: 16 / 96,
    hpFormula: (level, strM) => 18 + level * 5 + Math.max(0, strM) * 2,
    acBonus: 1,
    statBonus: { str: 4, dex: 2 },
    critBonus: 2,
    atkBonus: 3,
    dmgBonus: 4
  },
  eagle: {
    key: 'eagle',
    label: 'Eagle Form',
    icon: '🦅',
    stat: 'dex',
    desc: 'Speed & Evasion Specialization (+4 DEX, +2 WIS, +2 AC, Evasion & Disadvantage to foes).',
    sprite: 'sprites/eagle.png',
    animations: {
      idle: {
        sprite: 'sprites/Eagle/Idle/eagle_idle_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 8, loop: true
      },
      attack: {
        sprite: 'sprites/Eagle/Attack/eagle_attack_spritesheet_96x96.png',
        frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
        fps: 12, loop: false
      }
    },
    /* BeastSprite defaults to 1.6, which suits the bulky bear and wolf sheets
       but rendered the raven-sized eagle far larger than the hero. 1.0 is a
       ~37% reduction and lines the bird up with the other beast forms. */
    scaleX: 1.0,
    scaleY: 1.0,
    hpFormula: (level, dexM) => 14 + level * 4 + Math.max(0, dexM) * 2,
    acBonus: 2,
    statBonus: { dex: 4, wis: 2 },
    evasion: true,
    /* The one form with wings: liquid is not terrain to it, so the druid may
       cross a pool or a lava flow the rest of the party has to walk around.
       Read by canFly (pathfinding.js) straight off the active form. */
    flying: true,
    speedBonus: 1.3
  }
};
export function subclassOf(h){
  return h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
}
export function needsSubclass(h){
  return h.level >= SUBCLASS_UNLOCK && !h.subclass;
}
export function pickSubclass(h, key){
  if(h.subclass || h.level < SUBCLASS_UNLOCK || !SUBCLASSES[h.classKey][key]) return false;
  h.subclass = key;
  h.abilityUsed = { short:false, long:false };
  initProgressionFields(h);
  /* if the hero is already past milestone levels, grant those passives now */
  if(h.level >= 6) applyLevelGrants(h, 6, null, { autosOnly: true });
  if(h.level >= 10) applyLevelGrants(h, 10, null, { autosOnly: true });
  recalc(h);
  if(totalSlots(h.slotsMax) > 0) h.slots = { ...h.slotsMax };
  return true;
}

/* cantrips add a damage die at character levels 5, 11, 17 (SRD cantrip scaling) */
export const cantripDice = lvl => lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1;

/* ---------------- monsters (external JSON with 308 SRD stat blocks) ----------------
   Loaded from monsters.json. CR (Challenge Rating) is the sole balance axis:
   spawn picks a target CR from the dungeon-level curve, then filters this flat
   list by a CR window around it. Curated boss fights are driven by the mission
   (finalBossId / boss_encounters.json), not by a per-monster boss flag. */
import MONSTERS_RAW from './monsters.json' with { type: 'json' };
import BOSS_ENCOUNTERS_RAW from './boss_encounters.json' with { type: 'json' };
import TACTICAL_ROOMS_RAW from './tactical_rooms.json' with { type: 'json' };
import { CR_SCALING_TABLE, getCRScale, crForDungeonLevel, maxCrForDungeonLevel, crToCost as crCost } from './constants.js';

export { BOSS_ENCOUNTERS_RAW, TACTICAL_ROOMS_RAW };

export function getCuratedTacticalRooms() {
  let edits = {};
  try { edits = JSON.parse(globalThis.localStorage?.getItem('dc_tactical_rooms_edits') || '{}'); } catch {}
  if (!edits || Object.keys(edits).length === 0) return TACTICAL_ROOMS_RAW;
  const merged = JSON.parse(JSON.stringify(TACTICAL_ROOMS_RAW));
  for (const [styleKey, styleData] of Object.entries(edits)) {
    if (!merged[styleKey]) merged[styleKey] = {};
    for (const [key, val] of Object.entries(styleData)) {
      if (key === 'enabledThemes') {
        merged[styleKey].enabledThemes = [...val];
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        merged[styleKey][key] = { ...(merged[styleKey][key] || {}), ...val };
      } else {
        merged[styleKey][key] = val;
      }
    }
  }
  return merged;
}

export function isRoomStyleEnabled(styleId, themeKey) {
  const all = getCuratedTacticalRooms();
  const tKey = (themeKey || 'ancient').toLowerCase();
  if (all && all[styleId]) {
    const styleData = all[styleId];
    if (Array.isArray(styleData.enabledThemes)) {
      return styleData.enabledThemes.includes(tKey);
    }
  }
  return true;
}

export function getCuratedTacticalRoom(roomStyle, theme, level = 1) {
  const all = getCuratedTacticalRooms();
  if (!all || !roomStyle) return null;
  const styleData = all[roomStyle];
  if (!styleData) return null;

  const tKey = (theme || 'ancient').toLowerCase();
  if (Array.isArray(styleData.enabledThemes) && !styleData.enabledThemes.includes(tKey)) {
    return null;
  }

  const themeData = styleData[tKey] || styleData['all'];
  if (!themeData) return null;

  const lvl = Math.min(20, Math.max(1, Math.round(level || 1)));

  const sanitize = (list) => {
    if (!Array.isArray(list)) return null;
    const valid = list.filter(id => MONSTERS_BY_ID[id]);
    return valid.length > 0 ? valid : null;
  };

  // 1. Try exact level match (e.g. "1", "2" ... "20")
  if (Array.isArray(themeData[String(lvl)]) && themeData[String(lvl)].length) {
    const s = sanitize(themeData[String(lvl)]);
    if (s) return s;
  }

  // 2. Nearest level check among configured numbered levels
  const numKeys = Object.keys(themeData)
    .map(Number)
    .filter(n => isFinite(n) && n >= 1 && n <= 20 && Array.isArray(themeData[String(n)]) && themeData[String(n)].length)
    .sort((a, b) => a - b);

  if (numKeys.length > 0) {
    let closest = numKeys[0];
    let minDiff = Math.abs(numKeys[0] - lvl);
    for (const k of numKeys) {
      const diff = Math.abs(k - lvl);
      if (diff < minDiff) {
        minDiff = diff;
        closest = k;
      }
    }
    const s = sanitize(themeData[String(closest)]);
    if (s) return s;
  }

  // 3. Try parsing bands like "1-2", "3-5", "6-9", "10+", etc.
  for (const [bandKey, list] of Object.entries(themeData)) {
    if (!Array.isArray(list) || !list.length) continue;
    if (bandKey.endsWith('+')) {
      const min = parseInt(bandKey, 10);
      if (!isNaN(min) && lvl >= min) {
        const s = sanitize(list);
        if (s) return s;
      }
    } else if (bandKey.includes('-')) {
      const [minStr, maxStr] = bandKey.split('-');
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      if (!isNaN(min) && !isNaN(max) && lvl >= min && lvl <= max) {
        const s = sanitize(list);
        if (s) return s;
      }
    }
  }

  // 4. Fallback to first available band for this theme
  const bands = Object.entries(themeData).filter(([_, list]) => Array.isArray(list) && list.length);
  if (bands.length > 0) {
    return sanitize(bands[0][1]);
  }

  return null;
}

export function getCuratedBossEncounters() {
  let edits = {};
  try { edits = JSON.parse(globalThis.localStorage?.getItem('dc_boss_encounters_edits') || '{}'); } catch {}
  if (!edits || Object.keys(edits).length === 0) return BOSS_ENCOUNTERS_RAW;
  return BOSS_ENCOUNTERS_RAW.map(e => edits[e.id] ? { ...e, ...edits[e.id] } : e);
}

export function getCuratedBossEncounter(theme, level) {
  const all = getCuratedBossEncounters();
  const lvl = Math.min(20, Math.max(1, Math.round(level || 1)));
  const tKey = (theme || 'ancient').toLowerCase();
  
  const found = all.find(e => e.theme.toLowerCase() === tKey && e.level === lvl);
  if (found) return found;

  const themeMatches = all.filter(e => e.theme.toLowerCase() === tKey);
  if (themeMatches.length) {
    let closest = themeMatches[0];
    let minDiff = Infinity;
    for (const e of themeMatches) {
      const diff = Math.abs(e.level - lvl);
      if (diff < minDiff) { minDiff = diff; closest = e; }
    }
    return closest;
  }
  return all[0];
}


export function applyCRScalingToMonster(m) {
  if (!m) return m;
  const scale = getCRScale(m.cr || 0);
  if (!scale) return m;

  const scaled = JSON.parse(JSON.stringify(m));

  // 1. Armor Class (AC): Math.floor(baseAC * (1 + acPct / 100))
  if (m.ac != null && scale.acPct) {
    scaled.ac = Math.floor(m.ac * (1 + scale.acPct / 100));
  }

  // 2. To-Hit Bonus (atk): Math.floor(baseAtk * (1 + atkPct / 100))
  if (m.atk != null && scale.atkPct) {
    scaled.atk = Math.floor(m.atk * (1 + scale.atkPct / 100));
  }

  // 3. Hit Points (HP): scale dice count & bonus
  if (m.hp && Array.isArray(m.hp) && scale.hpPct) {
    const mult = 1 + scale.hpPct / 100;
    const count = Math.max(1, Math.floor(m.hp[0] * mult));
    const bonus = m.hp[2] ? Math.floor(m.hp[2] * mult) : 0;
    scaled.hp = [count, m.hp[1], bonus];
  }

  // 4. Ability stats, statblocks, & saves
  if (scale.statPct) {
    const mult = 1 + scale.statPct / 100;
    if (m.effStats) {
      scaled.effStats = {};
      for (const k in m.effStats) {
        scaled.effStats[k] = Math.floor(m.effStats[k] * mult);
      }
    }
    if (m.statblock?.stats) {
      scaled.statblock.stats = {};
      for (const k in m.statblock.stats) {
        scaled.statblock.stats[k] = Math.floor(m.statblock.stats[k] * mult);
      }
    }
    if (m.saves) {
      scaled.saves = {};
      for (const k in m.saves) {
        scaled.saves[k] = Math.floor(m.saves[k] * mult);
      }
    }
  }

  // 5. Derive attack (to-hit) and damage flat bonus from scaled ability scores & proficiency
  const primaryStatKey = m.ranged ? 'dex' : 'str';
  const statVal = scaled.effStats?.[primaryStatKey] ?? scaled.statblock?.stats?.[primaryStatKey] ?? 10;
  const statMod = Math.floor((statVal - 10) / 2);
  const prof = m.statblock?.prof || Math.max(2, Math.floor(((m.cr || 1) - 1) / 4) + 2);

  if (scaled.atk != null) {
    scaled.atk = Math.max(scaled.atk, statMod + prof);
  }

  if (scaled.dmg && Array.isArray(scaled.dmg)) {
    scaled.dmg = [
      scaled.dmg[0],
      scaled.dmg[1],
      Math.max(scaled.dmg[2] || 0, statMod)
    ];
  }

  return scaled;
}

export { MONSTERS_RAW };
export const MONSTERS_ALL = (() => {
  const scaled = MONSTERS_RAW.map(applyCRScalingToMonster);
  let edits = {};
  try { edits = JSON.parse(globalThis.localStorage?.getItem('dc_bestiary_monster_edits') || '{}'); } catch {}
  if (!edits || Object.keys(edits).length === 0) return scaled;
  return scaled.map(m => edits[m.id] ? { ...m, ...edits[m.id] } : m);
})();

/* Flat CR-keyed lookup. The old `tier` field is gone — CR is now the only
   balance axis. Monsters are selected by filtering this array (and the by-id
   map) against a CR window derived from dungeon depth. */
export const MONSTERS_BY_ID = (() => {
  const m = {};
  for (const s of MONSTERS_ALL) m[s.id] = s;
  return m;
})();

/** Display name for a monster id; falls back to a cleaned id. */
export function monsterName(id) {
  if (!id) return 'something ancient';
  const f = MONSTERS_BY_ID[id];
  return f ? f.name : id.replace(/-/g, ' ');
}

/** Spawn-budget cost for a CR — re-exported here because this is where callers
 *  expect it (alongside the spawn pipeline). The curve lives in constants.js. */
export { crToCost } from './constants.js';

/** Sliding CR gradient by dungeon level. Canonical implementation lives in
 *  constants.js so the dungeon generator can price its spawn budget against the
 *  same curve; re-exported here because this is where callers expect it. */
export { crForDungeonLevel, baseCrForDungeonLevel, maxCrForDungeonLevel, crBandIndex } from './constants.js';

/**
 * Dungeon visual theme → monster theme index mapping.
 * Each visual theme maps to 2–3 MONSTER_THEMES entries so monsters feel
 * native to the environment. The generator picks deterministically from
 * this subset instead of using roomId % 4. */
/* Indices reference themesList below:
   0 Goblinoid  1 Undead  2 Vermin  3 Beasts  4 Orc Horde  5 Draconic
   6 Elemental  7 Fiendish  8 Fey  9 Giantkind  10 Drow & Shadow            */
export const DUNGEON_MONSTER_MAP = {
  ancient: [0, 1, 8, 2],  // Goblinoid + Undead + Fey + Vermin (crawling ruins)
  molten:  [6, 5, 9],     // Elemental + Draconic + Giantkind
  frost:   [3, 1, 9],     // Beasts + Undead + Giantkind
  grim:    [1, 7, 10],    // Undead + Fiendish + Drow & Shadow  (was 6=Elemental → magma in crypts)
  verdant: [4, 8, 3, 2],  // Orc Horde + Fey + Beasts + Vermin (spiders/snakes in the wild)
  forest:  [0, 3, 2],     // Goblinoid + Beasts + Vermin (overland warcamp maps)
  /* Overland themes below are story-mission surfaces; missions normally pin an
     exact cast via quest.monsterRoster, so these are fallbacks only. */
  moor:     [3, 2, 1],    // Beasts + Vermin + Undead (open pasture, barrows)
  mire:     [2, 3, 1],    // Vermin + Beasts + Undead (fen crawlers)
  holdfast: [0, 2, 3],    // Goblinoid + Vermin + Beasts (settled ground)
  /* Threshold overlands (prologue floor 2) lean toward their parent dungeon's
     families, so the cast escalates into the dungeon instead of resetting. */
  boneyard:  [1, 3, 2],   // Undead + Beasts + Vermin   → grim
  ruinfield: [0, 2, 1],   // Goblinoid + Vermin + Undead → ancient
  ashfield:  [6, 3, 9],   // Elemental + Beasts + Giantkind → molten
  snowfield: [3, 2, 9],   // Beasts + Vermin + Giantkind → frost
  sporewood: [8, 2, 3],   // Fey + Vermin + Beasts      → verdant
};

const themesList = [
  { name: 'Goblinoid', monsters: [] },
  { name: 'Undead', monsters: [] },
  { name: 'Vermin', monsters: [] },
  { name: 'Beasts', monsters: [] },
  { name: 'Orc Horde', monsters: [] },
  { name: 'Draconic', monsters: [] },
  { name: 'Elemental', monsters: [] },
  { name: 'Fiendish', monsters: [] },
  { name: 'Fey', monsters: [] },
  { name: 'Giantkind', monsters: [] },
  { name: 'Drow & Shadow', monsters: [] }
];

/* Valid monster-theme names — an explicit `theme` field on a monster overrides
   the fuzzy id/type matching below (which mis-sorts e.g. "treant"→Vermin via
   the "ant" substring, or "giant-wasp"→Giantkind). New/imported monsters set
   `theme` directly so their dungeon assignment is deterministic. */
const THEME_NAMES = new Set(themesList.map(t => t.name));

export function getThemeForMonster(m) {
  if (!m || typeof m !== 'object') return 'Unknown';
  if (m.theme && THEME_NAMES.has(m.theme)) return m.theme;
  const id = (m.id || '').toLowerCase();
  const name = (m.name || '').toLowerCase();
  const type = (m.type || '').toLowerCase();
  const tags = (m.tags || []).map(t => t.toLowerCase());

  if (type === 'dragon' || id.includes('dragon') || id.includes('wyvern') || id.includes('drake') || id.includes('lindwurm') || id.includes('basilisk') || id.includes('cockatrice') || id.includes('chimera') || id.includes('hydra')) {
    return 'Draconic';
  }
  if (type === 'undead' || id.includes('ghost') || id.includes('specter') || id.includes('ghoul') || id.includes('zombie') || id.includes('skeleton') || id.includes('mummy') || id.includes('vampire') || id.includes('lich') || id.includes('wraith') || id.includes('shadow') || id.includes('death-knight')) {
    return 'Undead';
  }
  if (tags.includes('goblinoid') || tags.includes('kobold') || id.includes('goblin') || id.includes('kobold') || id.includes('bugbear') || id.includes('hobgoblin')) {
    return 'Goblinoid';
  }
  if (tags.includes('orc') || id.includes('orc') || id.includes('gnoll')) {
    return 'Orc Horde';
  }
  if (type === 'fiend' || id.includes('devil') || id.includes('demon') || id.includes('imp') || id.includes('quasit') || id.includes('succubus') || id.includes('hell-hound') || id.includes('dretch') || id.includes('lemure') || id.includes('manes') || id.includes('vrock') || id.includes('barbed-devil') || id.includes('hezrou') || id.includes('glabrezu') || id.includes('marilith') || id.includes('balor')) {
    return 'Fiendish';
  }
  if (type === 'fey' || id.includes('dryad') || id.includes('satyr') || id.includes('centaur') || id.includes('hag') || id.includes('pixie') || id.includes('sprite') || id.includes('nymph') || id.includes('elf') || id.includes('elven') || id.includes('pegasus') || id.includes('unicorn')) {
    return 'Fey';
  }
  if (type === 'elemental' || type === 'construct' || id.includes('gargoyle') || id.includes('elemental') || id.includes('salamander') || id.includes('efreet') || id.includes('magmin') || id.includes('magma') || id.includes('fire-beetle') || id.includes('mephit') || id.includes('golem')) {
    return 'Elemental';
  }
  /* true giants only (type check, not the "giant-" id prefix): SRD giant
     ANIMALS (giant-rat, giant-badger, …) are type "beast" and must fall
     through to the Vermin/Beasts checks below, not land in Giantkind */
  if (type === 'giant' || id.includes('ogre') || id.includes('troll') || id.includes('ettin') || id.includes('cyclops') || id.includes('minotaur') || id.includes('firbolg') || id.includes('goliath')) {
    return 'Giantkind';
  }
  if (id.includes('drow') || id.includes('shadow') || id.includes('dark') || id.includes('deep') || id.includes('duergar') || id.includes('underdark') || id.includes('drider') || id.includes('medusa') || id.includes('mind-flayer') || id.includes('beholder') || id.includes('spectator') || id.includes('grimlock') || id.includes('roper') || id.includes('choker') || id.includes('hook-horror') || id.includes('rust-monster') || id.includes('ooze') || id.includes('pudding') || id.includes('jelly') || id.includes('cube')) {
    return 'Drow & Shadow';
  }
  if (tags.includes('vermin') || id.includes('spider') || id.includes('scorpion') || id.includes('centipede') || id.includes('rat') || id.includes('ant') || id.includes('beetle') || id.includes('cockroach') || id.includes('mite') || id.includes('slug') || id.includes('snail') || id.includes('fly') || id.includes('mosquito') || id.includes('leech') || id.includes('moth') || id.includes('carrion-crawler') || id.includes('wasp') || id.includes('bee')) {
    return 'Vermin';
  }
  if (type === 'beast' || id.includes('wolf') || id.includes('bear') || id.includes('boar') || id.includes('badger') || id.includes('cat') || id.includes('dog') || id.includes('panther') || id.includes('lion') || id.includes('tiger') || id.includes('dinosaur') || id.includes('snake') || id.includes('viper') || id.includes('adder') || id.includes('weasel') || id.includes('frog') || id.includes('toad') || id.includes('bat') || id.includes('owl') || id.includes('hawk') || id.includes('eagle') || id.includes('vulture') || id.includes('crab') || id.includes('fish') || id.includes('slug') || id.includes('snail')) {
    return 'Beasts';
  }

  if (type === 'beast') return 'Beasts';
  if (type === 'monstrosity') return 'Beasts';
  if (type === 'giant') return 'Giantkind';
  return 'Beasts';
}

for (const m of MONSTERS_ALL) {
  const tName = getThemeForMonster(m);
  const theme = themesList.find(t => t.name === tName);
  if (theme) theme.monsters.push(m.id);
}

export const MONSTER_THEMES = themesList;

/* Per-creature dungeon spawn whitelist.
   A monster's `dungeons` field (array of dungeon-theme keys, e.g. 'ancient')
   is the strict source of truth: a creature appears in a themed dungeon room
   only if its key is listed. A missing/empty `dungeons` array means the
   creature is deliberately kept out of themed spawns (editor seeds the list
   from the creature-type family as a starting point). */
export function monsterSpawnsIn(m, dungeonKey) {
  return Array.isArray(m && m.dungeons) && m.dungeons.includes(dungeonKey);
}

/* Ids of every monster whitelisted for a dungeon theme key. This is the union
   across all creature-type families, so an explicit selection (e.g. a goblin
   in frost) is honoured regardless of DUNGEON_MONSTER_MAP's family assignment. */
export function dungeonMonsterIds(dungeonKey) {
  return MONSTERS_ALL.filter(m => monsterSpawnsIn(m, dungeonKey)).map(m => m.id);
}

/* The distinct CRs a dungeon theme can actually field, ascending.
   The generator prices its spawn budget against this so a room is only ever
   charged for a creature the roster can really produce — otherwise it buys a
   CR-3 slot for 28 points, game.js finds nothing at CR 3 on the roster and
   fields a CR-1 worth 16, and the room silently comes in under-weight. */
export function dungeonMonsterCRs(dungeonKey) {
  const crs = new Set();
  for (const m of MONSTERS_ALL) {
    if (monsterSpawnsIn(m, dungeonKey) && typeof m.cr === 'number' && m.cr > 0) crs.add(m.cr);
  }
  return [...crs].sort((a, b) => a - b);
}

/**
 * Generate a curated mob list for a quest matching its theme and level.
 * Guarantees theme-specific creatures (e.g. Goblins for Goblin/low-level quests)
 * and includes the curated quest final boss.
 */
export function getCuratedMonsterRoster(themeKey, level = 1, finalBossId = null) {
  const theme = (themeKey || 'ancient').toLowerCase();
  const lvl = Math.max(1, Math.round(level || 1));
  const maxCR = maxCrForDungeonLevel(lvl) + 1.5;

  let candidates = dungeonMonsterIds(theme);
  if (!candidates || candidates.length === 0) {
    const familyIndices = DUNGEON_MONSTER_MAP[theme] || [0, 1, 2];
    const familyNames = new Set(familyIndices.map(i => themesList[i]?.name).filter(Boolean));
    candidates = MONSTERS_ALL.filter(m => familyNames.has(getThemeForMonster(m))).map(m => m.id);
  }

  // If level 1 or theme is forest/holdfast/goblin-leaning, ensure goblinoid staples are present
  if (lvl === 1 && (theme === 'ancient' || theme === 'forest' || theme === 'holdfast' || theme === 'ruinfield')) {
    const goblinStaples = ['goblin', 'goblin-boss', 'hobgoblin', 'bugbear', 'kobold'];
    const available = MONSTERS_ALL.filter(m => goblinStaples.includes(m.id)).map(m => m.id);
    if (available.length > 0) candidates = Array.from(new Set([...candidates, ...available]));
  }

  // Filter candidates by CR window suitable for this quest level
  let roster = candidates.filter(id => {
    const m = MONSTERS_BY_ID[id];
    return m && (m.cr == null || m.cr <= maxCR);
  });

  if (roster.length < 3) {
    roster = candidates;
  }

  if (finalBossId && MONSTERS_BY_ID[finalBossId] && !roster.includes(finalBossId)) {
    roster.push(finalBossId);
  }

  return roster.length > 0 ? roster : null;
}

/* ---------------- STORY FLOOR CASTS ----------------
   Story missions author an exact cast per floor, and that cast is NOT subject to
   the CR window, the level ceiling, or the generated-quest spawn budget. A
   goblin warcamp fields goblins at level 1 and at level 5 alike.

   What varies instead is how much of the cast turns up: each floor gets a CR
   budget, and creatures are bought out of the whitelist until it runs out. Cost
   uses the same crToCost curve the room spawn budget uses, so a heavy creature
   crowds out several light ones. */

/** Normalize an authored pool (flat array OR tier-keyed object) into lanes. */
export function storyLanes(pool) {
  if (!pool) return {};
  if (Array.isArray(pool)) return pool.length ? { 1: [...pool] } : {};
  const out = {};
  for (const [k, v] of Object.entries(pool)) {
    if (Array.isArray(v) && v.length) out[k] = [...v];
  }
  return out;
}

/** Every mob id in a pool. The `boss` lane is excluded: it names the floor's
 *  finale, which is spawned separately, not a creature to meet in a corridor. */
export function storyPoolIds(pool) {
  const lanes = storyLanes(pool);
  return Object.keys(lanes)
    .filter(k => k !== 'boss')
    .sort((a, b) => Number(a) - Number(b))
    .flatMap(k => lanes[k]);
}

/** What one creature costs against a floor's CR budget. */
export function storySpawnCost(id) {
  const m = MONSTERS_BY_ID[id];
  return m ? crCost(m.cr || 0) : 0;
}

/** Budget that funds roughly one creature per spawn point the generator laid
 *  out — i.e. "as many monsters as this floor would normally hold, drawn from
 *  the authored cast". Authors raise it for a crowded floor, lower it for a
 *  sparse one. */
export function defaultStoryBudget(pool, slots) {
  const ids = storyPoolIds(pool).filter(id => MONSTERS_BY_ID[id]);
  if (!ids.length || !slots) return 0;
  const mean = ids.reduce((sum, id) => sum + storySpawnCost(id), 0) / ids.length;
  /* Headroom: rooms lock a species per lane, so a floor that happens to lock
     several dear creatures costs more than the flat mean. Without the slack a
     derived floor reliably comes up two or three spawn points short. */
  return Math.round(mean * slots * 1.2);
}

/** Which lane a generator spawn point wants: the layout still decides where the
 *  heavies and the chaff go, the whitelist decides what they are. */
export function storyLaneWeight(sp) {
  if (!sp) return 'mid';
  if (sp.role === 'miniboss' || sp.role === 'boss' || (sp.crOffset ?? 0) >= 1) return 'heavy';
  if (sp.role === 'minion' || (sp.crOffset ?? 0) < 0) return 'light';
  return 'mid';
}

/* Most generator spawn points are unremarkable, so an ordinary slot has to mean
   "rank and file, occasionally an elite" — mapping it straight onto tier 2 would
   fill a goblin camp with hobgoblins and leave the goblins as a garnish. */
function pickLaneKey(laneOrder, weight, rng) {
  if (!laneOrder.length) return null;
  if (weight === 'light') return laneOrder[0];
  if (weight === 'heavy') return laneOrder[laneOrder.length - 1];
  const elite = laneOrder[Math.min(1, laneOrder.length - 1)];
  return rng() < 0.25 ? elite : laneOrder[0];
}

/**
 * Buy a floor's cast out of its whitelist against a CR budget.
 *
 * `slots` is one entry per spawn point the generator produced:
 *   { roomId, weight }  (weight from storyLaneWeight)
 *
 * Returns `{ ids, budget, spent, filled }` where `ids[i]` is the creature for
 * slot i, or null when the budget ran dry — an unfunded slot simply stays empty
 * rather than falling back to an off-cast creature.
 */
export function planStoryFloorCast(pool, slots, opts = {}) {
  const lanes = storyLanes(pool);
  const laneOrder = Object.keys(lanes)
    .filter(k => k !== 'boss' && lanes[k].some(id => MONSTERS_BY_ID[id]))
    .sort((a, b) => Number(a) - Number(b));
  const usable = storyPoolIds(pool).filter(id => MONSTERS_BY_ID[id]);

  const budget = opts.budget != null ? opts.budget : defaultStoryBudget(pool, slots.length);
  const empty = { ids: slots.map(() => null), budget, spent: 0, filled: 0 };
  if (!usable.length || !laneOrder.length) return empty;

  const rng = opts.rng || Math.random;
  const cheapest = Math.min(...usable.map(storySpawnCost));
  const locks = {};
  const ids = [];
  let remaining = budget;

  for (const slot of slots) {
    if (remaining < cheapest) { ids.push(null); continue; }

    const laneKey = pickLaneKey(laneOrder, slot.weight, rng) ?? laneOrder[0];
    const lockKey = `${slot.roomId}|${laneKey}`;

    /* A room keeps one species per lane so encounters read as a warband rather
       than a menagerie — but a lock the remaining budget can't afford is
       dropped rather than blocking the slot. */
    let id = locks[lockKey];
    if (id && storySpawnCost(id) > remaining) id = null;

    if (!id) {
      const affordable = list => list.filter(c => MONSTERS_BY_ID[c] && storySpawnCost(c) <= remaining);
      let cands = affordable(lanes[laneKey] || []);
      if (!cands.length) cands = affordable(usable);
      if (!cands.length) { ids.push(null); continue; }
      id = cands[Math.floor(rng() * cands.length)];
      locks[lockKey] = id;
    }

    remaining -= storySpawnCost(id);
    ids.push(id);
  }

  return { ids, budget, spent: budget - remaining, filled: ids.filter(Boolean).length };
}

/* effectiveLevel = max(dungeonLevel, partyLevel) so over-levelled parties
   still face threatening monsters and under-levelled ones aren't crushed.
   Stats scale via CR_SCALING_TABLE based on the monster's Challenge Rating.

   Returns the spec for ONE monster. How many monsters a room gets is not this
   function's call — the generator's spawn-budget loop already bought that many
   spawn points (dungeon_generator.js, priced on crToCost and capped by
   spawn_budget.json's maxSpawns/spawnCap). This picks the species for a slot
   that has already been paid for. */
export function spawnMonster(targetCR, effectiveLevel, rngPick, allowedNames = null, questInfo = null, role = null, bypassCeiling = false, strictIds = false){
  const qi = questInfo || { dungeonLevel: effectiveLevel, questFloor: 1, floors: 1 };
  const dLevel = qi.dungeonLevel || 1;
  const qFloor = qi.questFloor || 1;
  const D = dLevel + Math.max(0, qFloor - 1) * 0.5;

  /* Target CR: callers pass one derived from crForDungeonLevel; if absent we
     derive it from depth so the function is usable standalone. */
  const tcr = (typeof targetCR === 'number' && targetCR > 0) ? targetCR : crForDungeonLevel(D, rngPick);

  /* CR window: a band around the target. ±50% gives a natural spread so a
     level's spawns vary without drifting outside their weight class. The maxCR
     floor (tcr + 0.5) keeps very low-CR windows from collapsing to nothing. */
  const minCR = Math.max(0, tcr * 0.5);
  let maxCR = Math.max(tcr * 1.5, tcr + 0.5);
  /* Clamp to the anchor curve's max CR so regular spawns never exceed the
     level's ceiling. Only a deliberate boss override (bypassCeiling, passed
     solely by the quest-boss spawn) may field above the curve; every escort —
     dungeon, themed, or overland — is capped regardless of its targetCR, so a
     too-hot targetCR downshifts to a ceiling monster via the fallback below. */
  const anchorMax = maxCrForDungeonLevel(dLevel);
  if (!bypassCeiling) {
    maxCR = Math.min(maxCR, anchorMax);
  }

  let pool = MONSTERS_ALL;
  let exact = false;
  if (allowedNames != null && allowedNames.length > 0) {
    const nameSet = allowedNames instanceof Set ? allowedNames : new Set(allowedNames);
    const themedPool = pool.filter(spec => nameSet.has(spec.id));
    if (strictIds) {
      pool = themedPool;
      exact = true;
    } else if (themedPool.length > 0) {
      pool = themedPool;
    }
  } else if (allowedNames != null) {
    /* Non-null but empty — the caller passed an authoritative (strict) whitelist
       that matched nothing (e.g. a dungeon with no configured creatures). Keep
       the pool empty so no unconfigured creature leaks in via the fallback. */
    pool = [];
  }

  let filtered;
  if (exact) {
    /* Exact curated spawn: bypass CR-window, role filters, and fallback.
       Pick directly from the whitelist. If the whitelist is empty (shouldn't
       happen if the caller cross-checks), fall back to the closest monster. */
    filtered = pool;
  } else {
    /* Fill the slot at the CR it was priced at, and NEVER above it.

       The old ±50% window drew uniformly from [tcr*0.5, tcr*1.5]. Two problems:
       the bestiary is bottom-heavy, so a CR-3 slot priced at 28 points usually
       landed on something worth ~18 (rooms delivered only 84-92% of the budget
       they had already been charged for); and the top half of that window could
       field a creature stronger than the level's controlled strength.

       So: creatures exactly at the target CR first — the roster carries several
       species at each rung, so variety comes from species rather than from
       drifting off-price. Failing that, step DOWN to the dearest CR at or below
       the target. Only if the pool has nothing at or below do we look upward,
       because at that point there is nothing weaker to field.

       The level's ceiling (maxCR) is a HARD cap for every non-boss spawn. An
       exact match at tcr and the at-or-below step both honour it, so a caller
       that asks for a CR above the level (e.g. the floor-scaling elite pack)
       still fields the dearest creature the level actually allows. Only a
       deliberate boss override (bypassCeiling) may field above it. */
    const ceiling = bypassCeiling ? Infinity : maxCR;
    const atCR = pool.filter(spec => spec.cr === tcr && spec.cr <= ceiling);
    if (atCR.length) {
      filtered = atCR;
    } else {
      const atOrBelow = pool.filter(spec => spec.cr <= Math.min(tcr, ceiling));
      if (atOrBelow.length) {
        let bestCR = -1;
        for (const spec of atOrBelow) if (spec.cr > bestCR) bestCR = spec.cr;
        filtered = atOrBelow.filter(spec => spec.cr === bestCR);
      } else {
        /* Nothing weaker exists — take the least-strong option available. */
        let bestCR = Infinity;
        for (const spec of pool) if (spec.cr < bestCR) bestCR = spec.cr;
        filtered = pool.filter(spec => spec.cr === bestCR);
      }
    }
    if (role) {
      let roleFiltered = [];
      if (role === 'caster') {
        roleFiltered = filtered.filter(s => (s.abilities && s.abilities.spells && s.abilities.spells.length > 0) || (s.tags && (s.tags.includes('spellcaster') || s.tags.includes('caster'))) || s.ranged);
      } else if (role === 'ranged') {
        roleFiltered = filtered.filter(s => s.ranged || (s.rngRange && s.rngRange > 2));
      } else if (role === 'tank') {
        roleFiltered = filtered.filter(s => s.ac >= 14 || (s.tags && s.tags.includes('tank')) || (s.hp && s.hp[0] >= 4));
      } else if (role === 'minion') {
        roleFiltered = filtered.filter(s => s.cr < 1);
      } else if (role === 'miniboss' || role === 'boss') {
        roleFiltered = filtered.filter(s => s.cr >= 1);
      }
      if (roleFiltered.length > 0) filtered = roleFiltered;
    }

    if (filtered.length === 0) {
      /* The narrowed pool (theme, roster) has no monsters inside the clamped CR
         window. Relax the CR window BEFORE relaxing the roster: take the
         closest-CR creature the roster does offer, and only fall through to the
         whole bestiary when the roster itself is empty. Widening straight to
         MONSTERS_ALL let off-roster creatures into a themed dungeon whenever a
         CR band happened to be thin — the roster is meant to be authoritative.
         maxCR still caps the search so the level's ceiling is honoured; the cap
         is dropped only if everything available sits above it. */
      const capped = p => p.filter(s => s.cr <= maxCR);
      const searchPool =
        capped(pool).length > 0 ? capped(pool) :
        pool.length > 0 ? pool :
        capped(MONSTERS_ALL).length > 0 ? capped(MONSTERS_ALL) : MONSTERS_ALL;
      let closestSpec = searchPool[0];
      let minDiff = Infinity;
      for (const spec of searchPool) {
        const diff = Math.abs(spec.cr - tcr);
        if (diff < minDiff) { minDiff = diff; closestSpec = spec; }
      }
      filtered = [closestSpec];

      /* NB: this fills the slot with ONE weaker creature, leaving it a little
         under-weight. Do not "make up the difference" by spawning extra bodies
         here — the generator's spawn-budget loop already decided the body count
         for this room and charged its purse for it. Adding monsters at this
         point spends nothing, ignores maxSpawns/spawnCap, and desyncs the
         bestiary's Spawn Budget tab from what the floor actually fields. If a
         theme's rooms come out under-weight, the roster is too thin at that CR
         band — fix it in the Dungeon roster tab. */
    }
  }

  if (filtered.length === 0) {
    const fallbackPool = MONSTERS_ALL.filter(s => s.cr <= maxCR);
    filtered = fallbackPool.length > 0 ? fallbackPool : [MONSTERS_ALL[0]];
  }

  const spec = filtered[Math.floor(rngPick()*filtered.length)];
  let hp = roll(spec.hp[0], spec.hp[1], spec.hp[2]||0);
  let atk = spec.atk;

  if (role === 'minion') {
    hp = Math.max(1, Math.round(hp * 0.65));
  } else if (role === 'miniboss') {
    hp = Math.round(hp * 1.35);
    atk += 1;
  }
  const speedFt = spec.speedFt || Math.round(((spec.speed || 3) * 10) / 5) * 5;
  return {
    name: spec.name, ac: spec.ac, maxHp: hp, hp,
    atk,
    dmg: spec.dmg, xp: Math.round(spec.xp * parseFloat(globalThis.localStorage?.getItem('dc_monster_xp_scale') || '1.0')),
    color: spec.color, scale: spec.scale, speed: spec.speed, speedFt,
    sprite: spec.sprite,          // per-monster DCSS art (mesh falls back to orc.png without it)
    gold: 0,
    ranged: spec.ranged || false,
    rngRange: spec.rngRange || 6,
    id: spec.id,
    /* creature identity for condition immunities + CR-scaled saving throws */
    type: spec.type, tags: spec.tags, cr: spec.cr,
    effStats: spec.effStats ? { ...spec.effStats } : undefined,
    /* Pass through runtime abilities, multiattack count, saves, statblock, & passive traits */
    abilities: spec.abilities ? JSON.parse(JSON.stringify(spec.abilities)) : undefined,
    attacksPerTurn: spec.attacksPerTurn || 1,
    saves: spec.saves ? { ...spec.saves } : {},
    statblock: spec.statblock ? JSON.parse(JSON.stringify(spec.statblock)) : undefined,
    variants: spec.variants ? [...spec.variants] : undefined,
    packTactics: spec.packTactics,
    /* SRD hobgoblin Martial Advantage (+2d6 when an ally is adjacent to the
       target). monster_ai.js reads m.data.martialAdvantage; without this line
       the flag sits in monsters.json and never reaches the spawned monster. */
    martialAdvantage: spec.martialAdvantage,
    undeadFortitude: spec.undeadFortitude,
    magicResistance: spec.magicResistance,
    regen: spec.regen,
    colorBalance: spec.colorBalance ? JSON.parse(JSON.stringify(spec.colorBalance)) : undefined,
    yOffset: spec.yOffset,
    flipX: !!spec.flipX,
    /* Animated idle/attack atlas configs written by the bestiary editor — the
       runtime uses these to swap the static billboard for a sliced sheet. */
    animations: spec.animations ? JSON.parse(JSON.stringify(spec.animations)) : undefined,
    /* Ranged presentation. `cantripClass` names a hero cantrip class so a
       monster caster's basic attack is delivered by fxCantripDelivery — the same
       code and art the heroes use — instead of an arrow; `rangedDmgType` picks
       the element sheet when that class has no composite animation.
       NOTE: this object is an explicit projection of `spec`, not a spread, so a
       field left out here silently never reaches the runtime no matter how
       correct monsters.json looks. */
    cantripClass: spec.cantripClass,
    rangedDmgType: spec.rangedDmgType,
  };
}

/* Hard cap on how many copies of a single creature one room may field. Rooms
   buy a dominant CR and every same-band spawn used to lock onto the first
   species drawn, so a room read as "seven ghouls plus a filler". pickRoomSpecies
   (below) enforces this cap per room while preferring creatures of the room's
   dominant family, so variety keeps the room's vibe. */
export const SPECIES_CAP = 3;

/** Pick the species for one spawn slot in a room, capping duplicates.
 *
 *  bandPool      species ids already rolled for this band/role in this room
 *                (mutated in place: a freshly rolled species is appended)
 *  counts        { [speciesId]: n } fielded so far in this room (read-only here)
 *  anchorFamily  the room's vibe family (getThemeForMonster) of its first species
 *  familyOf      (id) => family string, e.g. getThemeForMonster(MONSTERS_BY_ID[id])
 *  window        candidate species ids within this slot's CR window (roster-scoped,
 *                never empty — the caller falls back to the full roster)
 *  roll(pool)    () => speciesId drawn from `pool` — wraps spawnMonster so a roll
 *                can never import an off-roster creature
 *
 *  Reuses a pool species that is under the cap, preferring the room's own family,
 *  then picks from the window's under-cap species (same-family preferred). Only
 *  when every species in the window is at the cap does it take a duplicate — a
 *  roster band with one creature has nothing else to offer, and an empty slot is
 *  worse. Deterministic: no retry loop that could randomly miss an alternative. */
export function pickRoomSpecies({ bandPool, counts = {}, anchorFamily = null, familyOf = () => null, window, roll }) {
  const underCap = (id) => (counts[id] || 0) < SPECIES_CAP;
  const sameVibe = (id) => !anchorFamily || familyOf(id) === anchorFamily;

  /* 1) Reuse a species this band has already rolled before rolling new ones —
        keeps the room's CR/role mix stable. Prefer the room's vibe family. */
  const reuse = bandPool.find((id) => underCap(id) && sameVibe(id))
    ?? bandPool.find(underCap);
  if (reuse) return reuse;

  /* 2) The window's under-cap species, same family preferred. `window` is already
        CR-windowed so a same-family pick can never drift off the slot's CR. It may
        be null (no roster constraint — an un-themed dungeon), which the roll
        passes straight to spawnMonster for its full-bestiary fallback. */
  const fresh = window ? window.filter(underCap) : [];
  const fam = anchorFamily ? fresh.filter((id) => familyOf(id) === anchorFamily) : fresh;
  const pool = fam.length ? fam : (fresh.length ? fresh : window);

  const id = roll(pool);
  if (!bandPool.includes(id)) bandPool.push(id);
  return id;
}

/* ---------------- hero construction ---------------- */
export const HERO_NAMES = ['Bram','Kira','Aldric','Wren','Doric','Sariel','Toby','Magda','Fenn','Isolde','Garrick','Nyx','Piotr','Vessa','Odo','Lyra'];

export function getDefaultProficiencies(raceKey, classKey) {
  const list = [];
  const race = RACES[raceKey];
  if (race && race.skills) {
    list.push(...race.skills);
  }
  // Standard starting skills for each class
  const classProfs = {
    fighter: ['athletics', 'intimidation'],
    rogue: ['acrobatics', 'sleightOfHand', 'stealth', 'deception'],
    cleric: ['insight', 'religion'],
    wizard: ['arcana', 'history'],
    barbarian: ['athletics', 'survival'],
    bard: ['persuasion', 'performance', 'deception'],
    druid: ['nature', 'perception'],
    monk: ['acrobatics', 'stealth'],
    paladin: ['athletics', 'persuasion'],
    ranger: ['perception', 'survival', 'stealth'],
    sorcerer: ['arcana', 'persuasion'],
    warlock: ['arcana', 'deception']
  };

  /* The suggested loadout is capped by the class's own allowance and filtered
     to skills that class may actually take. Without this a class whose
     defaults ran over `skillChoices.count` started with a free extra
     proficiency the picker never showed and never counted — cleric and wizard
     both shipped three where two are allowed. */
  const choices = (CLASSES[classKey] || {}).skillChoices;
  const allowed = choices ? new Set(choices.list) : null;
  const budget = choices ? choices.count : Infinity;

  let taken = 0;
  for (const p of (classProfs[classKey] || [])) {
    if (list.includes(p)) continue;          // already granted by race
    if (allowed && !allowed.has(p)) continue;
    if (taken >= budget) break;
    list.push(p);
    taken++;
  }
  return list;
}

export function makeHero(name, raceKey, classKey, baseStats = {}, visual = null, chosenProficiencies = null){
  const race = RACES[raceKey], cls = CLASSES[classKey];
  const stats = {};
  const bStats = baseStats || {};
  for(const ab of ABILITIES) stats[ab] = (bStats[ab]||8) + (race.bonus[ab]||0);

  const proficiencies = chosenProficiencies || getDefaultProficiencies(raceKey, classKey);

  const h = {
    name, raceKey, classKey, stats, visual, level:1, xp:0,
    equipment:{}, skills:{}, pendingAbility:0, pendingSkill:0,
    skillRanks:{}, pendingSkillRank:0,
    subclass:null, abilityUsed:{ short:false, long:false }, charges:{},
    secondWind: !!cls.secondWind,
    kills:0, downs:0, dmgDealt:0, dmgTaken:0,
    proficiencies,
    features:[], feats:[], knownSpells:[], pendingChoices:[],
    subclassMilestones:[], fightingStyle:null, spellCd:{},
    progressionVersion:0,
    scale: 1.0,
    aiPrefs:{ targeting:'nearest', movementStyle:'standard', abilityUsage:'balanced', potionTrigger:'emergency' }
  };
  
  const st = STARTER_GEAR[classKey];
  if (st) {
    h.equipment.weapon = makeStarterItem('weapon', st.weapon);
    h.equipment.armor = makeStarterItem('armor', st.armor, st.look);
  }

  seedNewHeroProgression(h);
  recalc(h);
  h.hp = h.maxHp;
  return h;
}

/** Create a level-scaled Wolf companion using wolfsheet1.png sprite sheet. */
export function createWolfCompanion(lvl = 1) {
  const level = Math.max(1, lvl | 0);
  const visual = {
    isWolf: true,
    /* Frame-sliced idle/attack sheets, same block shape as a monster's
       `animations`. WolfSprite checks visual.animations FIRST and it takes
       precedence over both the single-image and wolfsheet1.png atlas modes
       (sprite_animator.js:528), so the old 64x64 sprites/wolf.png and the
       mis-aligned LPC atlas are both bypassed rather than deleted.

       flipX follows the same convention as monsters: it means the SOURCE art
       faces right, so setDirection flips when the wolf moves left. */
    flipX: true,
    /* WolfSprite sizes its quad as 1.125 * spriteScale, with no frameWidth term
       — unlike the monster path, which divides by 32 — so a monster `scale`
       value would be meaningless here. 1.47 puts the wolf's shoulder at ~0.75
       world units against the old sprite's 1.072: the previous 64x64 art was
       nearly square and stood almost as tall as a hero, while this one is a
       true side-on wolf at 87px tall by 128px long, so matching the old HEIGHT
       would have made it half again as wide as before. Sized to read as a wolf
       beside the ranger rather than to preserve the old number. */
    spriteScaleX: 1.47,
    spriteScaleY: 1.47,
    animations: {
      idle: {
        frameWidth: 192, frameHeight: 192, cols: 19, rows: 1,
        fps: 8, loop: true,
        sprite: 'sprites/WarWolf/Idle/war_wolf_idle_spritesheet_192x192.png'
      },
      attack: {
        frameWidth: 192, frameHeight: 192, cols: 19, rows: 1,
        fps: 12, loop: false,
        sprite: 'sprites/WarWolf/Attack/war_wolf_attack_spritesheet_192x192.png'
      },
      /* Optional third state. sprite_animator.js loads 'walk' when present and
         game.js then treats this sprite like an LPC hero: walk while moving,
         idle at rest. A companion without this key keeps its idle running the
         whole time, which is the old behaviour. */
      walk: {
        frameWidth: 192, frameHeight: 192, cols: 19, rows: 1,
        fps: 12, loop: true,
        sprite: 'sprites/WarWolf/Walk/war_wolf_walk_spritesheet_192x192.png'
      }
    }
  };
  const baseStats = {
    str: 14 + Math.floor(level / 4),
    dex: 15 + Math.floor(level / 3),
    con: 14 + Math.floor(level / 4),
    int: 6,
    wis: 12,
    cha: 8
  };
  const data = makeHero('Alpha Wolf', 'wolf', 'wolf', baseStats, visual);
  data.level = level;
  data.isWolf = true;

  const numDice = level >= 7 ? 2 : 1;
  const dieSides = level >= 7 ? 8 : (level >= 4 ? 8 : 6);
  const flatBonus = Math.floor(level / 2);

  data.equipment = {
    weapon: {
      id: 'wolf_bite',
      name: 'Bite',
      type: 'weapon',
      slot: 'weapon',
      baseKey: 'Bite',
      dmg: [numDice, dieSides, flatBonus],
      melee: true,
      range: 1.5,
      finesse: true,
      dmgType: 'piercing'
    }
  };

  recalc(data);
  data.hp = data.maxHp;
  return data;
}

export function createFamiliarCompanion(kind = 'owl', lvl = 1) {
  const level = Math.max(1, lvl | 0);
  const cleanKind = (kind || 'owl').replace('Familiar', '').toLowerCase();
  const profiles = {
    owl: {
      name: 'Owl Familiar',
      sprite: 'sprites/giant_owl.png',
      animations: {
        idle: {
          sprite: 'sprites/Owl/Idle/owl_idle_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 8, loop: true
        },
        attack: {
          sprite: 'sprites/Owl/Attack/owl_attack_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 12, loop: false
        }
      },
      stats: { str: 6, dex: 16 + Math.floor(level / 3), con: 10 + Math.floor(level / 4), int: 10, wis: 14, cha: 10 },
      flying: true,
      weaponName: 'Talon',
      dmg: [1, 4, Math.floor(level / 2)],
      dmgType: 'slashing'
    },
    imp: {
      name: 'Imp Familiar',
      sprite: 'sprites/imp.png',
      animations: {
        idle: {
          sprite: 'sprites/Imp/Idle/imp_idle_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 8, loop: true
        },
        attack: {
          sprite: 'sprites/Imp/Attack/imp_attack_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 12, loop: false
        }
      },
      stats: { str: 10, dex: 14 + Math.floor(level / 4), con: 12 + Math.floor(level / 4), int: 14 + Math.floor(level / 3), wis: 12, cha: 14 },
      flying: true,
      weaponName: 'Sting',
      dmg: [1, 6, Math.floor(level / 2)],
      dmgType: 'fire'
    },
    viper: {
      name: 'Viper Familiar',
      sprite: 'sprites/viper.png',
      animations: {
        idle: {
          sprite: 'sprites/Viper/Idle/viper_idle_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 8, loop: true
        },
        attack: {
          sprite: 'sprites/Viper/Attack/viper_attack_spritesheet_96x96.png',
          frameWidth: 96, frameHeight: 96, cols: 19, rows: 1,
          fps: 12, loop: false
        }
      },
      stats: { str: 8, dex: 16 + Math.floor(level / 3), con: 11 + Math.floor(level / 4), int: 8, wis: 12, cha: 8 },
      weaponName: 'Venom Bite',
      dmg: [1, 4, Math.floor(level / 2)],
      dmgType: 'poison'
    }
  };

  const p = profiles[cleanKind] || profiles.owl;
  /* Frame-sliced idle/attack sheets, when the profile has them, are passed
     through to the visual so WolfSprite plays them instead of the single
     static image. Profiles without them still fall back to singleImage. */
  const visual = { singleImage: true, spriteSheet: p.sprite, spriteScaleX: 0.85, spriteScaleY: 0.85 };
  if (p.animations) visual.animations = p.animations;
  const data = makeHero(p.name, 'familiar', 'familiar', p.stats, visual);
  data.level = level;
  data.isFamiliar = true;
  data.familiarKind = cleanKind;
  /* Owl and imp are on the wing; the viper is not. canFly reads this flag, so
     a flying familiar crosses a pool instead of stalling on the bank while the
     party walks round it. */
  if (p.flying) data.flying = true;
  data.knownSpells = [];
  data.aiPrefs = { targeting: 'nearest', movementStyle: 'standard', abilityUsage: 'balanced', potionTrigger: 'emergency' };

  data.equipment = {
    weapon: {
      id: `familiar_${kind}_attack`,
      name: p.weaponName,
      type: 'weapon',
      slot: 'weapon',
      baseKey: p.weaponName,
      dmg: p.dmg,
      melee: true,
      range: 1.5,
      finesse: true,
      dmgType: p.dmgType
    }
  };

  recalc(data);
  data.hp = data.maxHp;
  return data;
}

/* Fill in any fields a legacy save is missing, then recompute derived stats. */
export function normalizeHero(h){
  if(!h.equipment) h.equipment = {};
  if(!h.skills) h.skills = {};
  if(!h.visual) {
    h.visual = { gender:'male', hair:'bangs/adult', ...getRaceDefaults(h.raceKey) };
  } else {
    delete h.visual.torso;
    delete h.visual.legs;
    delete h.visual.weapon;
  }
  /* Saved colours predate the lightness-aware recolour — snap them onto the
     current palettes so a loaded party still looks the way it was built. */
  migrateVisualColors(h.visual, h.raceKey);
  if(h.pendingAbility === undefined) h.pendingAbility = 0;
  if(h.pendingSkill === undefined) h.pendingSkill = 0;
  /* Class talents: ensure heroes have banked/spent points for odd levels reached (Lv 1, 3, 5...) */
  if (!CLASSES[h.classKey]?.internal) {
    const totalTalentsExpected = Math.ceil(Math.max(1, h.level || 1) / 2);
    const spentTalents = Object.values(h.skills || {}).reduce((sum, r) => sum + (r || 0), 0);
    const currentTotal = (h.pendingSkill || 0) + spentTalents;
    if (currentTotal < totalTalentsExpected) {
      h.pendingSkill = (h.pendingSkill || 0) + (totalTalentsExpected - currentTotal);
    }
  }
  /* Saves from before skill ranks existed: bank the points they'd have earned
     (2 per level-up past 1) so nothing is lost, and start with no ranks spent. */
  if(!h.skillRanks) h.skillRanks = {};
  if(h.pendingSkillRank === undefined)
    h.pendingSkillRank = Math.max(0, (h.level || 1) - 1) * SKILL_POINTS_PER_LEVEL;
  if(h.kills === undefined) h.kills = 0;
  if(h.downs === undefined) h.downs = 0;
  if(h.dmgDealt === undefined) h.dmgDealt = 0;
  if(h.dmgTaken === undefined) h.dmgTaken = 0;
  if(h.subclass === undefined) h.subclass = null;
  if(!h.abilityUsed) h.abilityUsed = { short:false, long:false };
  if(h.abilityUsed.day !== undefined) {
    h.abilityUsed.long = !!(h.abilityUsed.long || h.abilityUsed.day);
    delete h.abilityUsed.day;
  }
  if(h.abilityUsed.long === undefined) h.abilityUsed.long = false;
  if(!h.charges) h.charges = {};
  /* Legacy saves: the old bespoke Cure Wounds pool is gone — healers now cast
     the level-1 slot spell like everyone else. */
  delete h.healSlots;
  delete h.healSlotsMax;


  if (!h.proficiencies) {
    h.proficiencies = getDefaultProficiencies(h.raceKey, h.classKey);
  }

  /* Starter armour used to be one of two shared shirts, so every party lined up
     in the same beige. Re-skin the untouched starter piece to the class kit —
     only the visuals, and only while it is still the original zero-point item
     (a dyed or replaced piece is the player's, and is left alone). */
  const kit = STARTER_GEAR[h.classKey];
  const worn = h.equipment.armor;
  /* `starterName` is the tell: only a kit built before this existed lacks one.
     A dye is the other guard — migrateItem rewrites starter names, so the name
     can't distinguish "untouched" but the colour can. */
  if (kit && kit.look && worn && worn.starter && worn.baseKey === kit.armor
      && !worn.starterName
      && (!worn.visualColor || worn.visualColor === getBase('armor', kit.armor)?.visualColor)) {
    const fresh = makeStarterItem('armor', kit.armor, kit.look);
    if (fresh) {
      worn.name = fresh.name;
      worn.starterName = fresh.starterName;
      worn.visualTorso = fresh.visualTorso;
      worn.visualSleeves = fresh.visualSleeves;
      worn.visualLegs = fresh.visualLegs;
      worn.visualBelt = fresh.visualBelt;
      worn.visualShoulders = fresh.visualShoulders;
      worn.visualCape = fresh.visualCape;
      worn.visualColor = fresh.visualColor;
    }
  }

  /* AI priorities tab — Tactical Directives per-hero settings. Casters open on
     Tactical Kite; everyone else advances to reach. */
  if (!h.aiPrefs) h.aiPrefs = {};
  if (!h.aiPrefs.targeting) h.aiPrefs.targeting = 'nearest';
  if (!h.aiPrefs.movementStyle) {
    h.aiPrefs.movementStyle =
      ['wizard', 'sorcerer', 'warlock', 'ranger'].includes(h.classKey) ? 'kite' : 'standard';
  }
  if (!h.aiPrefs.abilityUsage) h.aiPrefs.abilityUsage = 'balanced';
  if (!h.aiPrefs.potionTrigger) h.aiPrefs.potionTrigger = 'emergency';

  migrateProgression(h);

  /* migrate equipped gear to ilvl / perk schema (legendaries stay at found ilvl) */
  for(const slot of Object.keys(h.equipment)){
    if(h.equipment[slot]) migrateItem(h.equipment[slot]);
  }

  recalc(h);
  if(h.hp === undefined || h.hp > h.maxHp) h.hp = h.maxHp;
  return h;
}

/* Sum a hero's class-skill ranks into a bonuses object. */
export function skillBonuses(h){
  const total = {};
  const list = (h.classKey && CLASSES[h.classKey]?.skills) || [];
  const skills = h.skills || {};
  for(const s of list){
    const rank = skills[s.key] || 0;
    if(!rank) continue;
    for(const k in s.b) total[k] = (total[k]||0) + s.b[k]*rank;
  }
  return total;
}

/* Recompute all derived combat fields from base stats + equipment + skills.
   Called after any change to level, stats, gear, or skills. */
export function recalc(h){
  const cls = (h.classKey && CLASSES[h.classKey]) || CLASSES.druid || { hitDie: 8 };
  const race = (h.raceKey && RACES[h.raceKey]) || RACES.human || {};
  /* Base equipment-proficiency tiers from the class, stamped for features.js
     (which can't import CLASSES) so the feat-offer ladder knows where to start. */
  h._baseArmorRank = PROF_RANK[cls.armorProf || 'none'];
  h._baseWeaponMartial = (cls.weaponProf === 'martial');
  const eq = aggregateEquipment(h.equipment, h.level);
  const sk = skillBonuses(h);
  const sc = h.subclass ? SUBCLASSES[h.classKey][h.subclass] : null;
  const ft = featureBonuses(h);
  const sum = k => (eq[k]||0) + (sk[k]||0) + ((sc && sc.pb && sc.pb[k])||0) + (ft[k]||0);

  /* effective ability scores (base already includes racial + spent points) */
  const eff = {};
  for(const ab of ABILITIES) eff[ab] = h.stats[ab] + sum(ab);
  if (h.inWildShape && h.wildShapeActiveForm && WILD_SHAPE_FORMS[h.wildShapeActiveForm]) {
    const wf = WILD_SHAPE_FORMS[h.wildShapeActiveForm];
    if (wf.statBonus) {
      for (const [sb, val] of Object.entries(wf.statBonus)) {
        eff[sb] = (eff[sb] || 10) + val;
      }
    }
  }
  h.effStats = eff;

  /* class save proficiencies: total bonus (ability mod + proficiency), same
     shape as monster stat-block saves so rollSave treats both alike */
  h.saves = {};
  for(const ab of (CLASS_SAVES[h.classKey] || [])) h.saves[ab] = mod(eff[ab]) + profBonus(h.level);
  /* Gear `saveStr…saveCha` affixes. These apply to EVERY ability, including the
     ones the class isn't proficient in — that's the point of the affix, and it's
     why a save bonus is cheap: it never touches attack or AC math. A
     non-proficient save starts from the bare ability mod. */
  for(const ab of ABILITIES){
    const gear = sum('save' + ab[0].toUpperCase() + ab.slice(1));
    if(!gear) continue;
    h.saves[ab] = (h.saves[ab] != null ? h.saves[ab] : mod(eff[ab])) + gear;
  }

  const conM = mod(eff.con);
  /* HP: full hit die at L1, average thereafter, + CON each level + race + bonuses.
     The flat +8 "adventurer's grit" keeps level-1 heroes from being one-shot
     by a lucky crit (SRD level 1 is glass); it fades to noise at high level. */
  const avg = Math.ceil((cls.hitDie+1)/2);
  h.maxHp = cls.hitDie + 8 + (h.level-1)*avg + h.level*(conM + (race.hpPerLevel||0)) + sum('hp');
  /* life-drain (monster ability): drained max HP stays gone until a rest */
  h.maxHp -= (h.hpDrain || 0);
  h.maxHp = Math.max(1, h.maxHp);
  if(h.hp !== undefined) h.hp = Math.min(h.hp, h.maxHp);

  /* Armor Class (5e model): worn body armor SETS the base by category; Dex is
     applied per category (light = full, medium = max +2, heavy = none), and
     unarmored is 10 + Dex. Shields, rings, helms and enchant affixes add on top
     via sum('ac'). The old per-class baseAC/acPlusDex are no longer used —
     starting armor now drives AC, so an unequipped hero is genuinely unarmored. */
  const armor = h.equipment && h.equipment.armor;
  const armorBase = (armor && armor.armorBase) || 0;
  const dexM = mod(eff.dex);
  let dexAC;
  if(!armorBase) dexAC = dexM;                                  // unarmored: full Dex
  else if(armor.prof === 'heavy') dexAC = 0;                    // heavy: no Dex
  else if(armor.prof === 'medium') dexAC = Math.min(dexM, 2);   // medium: cap +2
  else dexAC = dexM;                                            // light: full Dex
  /* Chassis AC from shields and helms. Base items carry no stat bonuses any
     more, so a shield's protection lives in `acBase` on the item rather than in
     its `bonuses` — read it directly, exactly like body armor's `armorBase`.
     Magical AC (from affixes) still arrives through sum('ac'). */
  let acChassis = 0;
  const eqObj = h.equipment || {};
  for(const slot of Object.keys(eqObj)){
    const it = eqObj[slot];
    if(it && it.acBase) acChassis += it.acBase;
  }
  h.ac = (armorBase || 10) + dexAC + acChassis + sum('ac');
  /* Barbarian / Monk Unarmored Defense — only while wearing no body armor (5e). */
  if(!armorBase){
    /* acChassis rides along so an unarmored barbarian doesn't lose their shield. */
    if(h.classKey === 'barbarian') h.ac = Math.max(h.ac, 10 + dexM + mod(eff.con) + acChassis + sum('ac'));
    if(h.classKey === 'monk')      h.ac = Math.max(h.ac, 10 + dexM + mod(eff.wis) + acChassis + sum('ac'));
  }
  h.ac += featACBonus(h);

  /* weapon-driven attack profiles — cached so combat reads them ~60×/s without
     rebuilding. weaponProfile comes from the equipped weapon; offhandProfile is
     set only when dual-wielding two light weapons (Two-Weapon Fighting); cantripProfile
     is set only for caster classes (cantripScale:true on their class attack). */
  h.weaponProfile = buildWeaponProfile(h, h.equipment && h.equipment.weapon);
  const mh = h.equipment && h.equipment.weapon;
  const oh = h.equipment && h.equipment.offhand;
  /* Two-Weapon Fighting (5e): both weapons must be light — unless the Dual
     Wielder feat relaxes that to any one-handed weapon. */
  const dw = hasDualWielder(h);
  h.offhandProfile = (oh && oh.slot === 'weapon' && !oh.twoHanded
      && mh && !mh.twoHanded
      && (dw || (oh.light && mh.light)))
    ? buildWeaponProfile(h, oh, { offhand:true, noAbilityMod:true })
    : null;
  h.cantripProfile = buildCantripProfile(h);

  /* to-hit bonus: weapon attacks use the weapon profile's ability (finesse→max
     of str/dex, ranged→dex, else str); cantrips/spells keep using the class's
     casting stat. Cache the proficiency + gear portion (atkProf) so any profile
     — main hand, offhand, or cantrip — can recompose its own to-hit bonus. */
  const pb = profBonus(h.level);
  h.atkProf = pb + sum('atk');
  const wpnAb = h.weaponProfile ? h.weaponProfile.ability
    : (h.classKey === 'monk' ? 'dex' : 'str');
  h.atkBonus = h.atkProf + mod(eff[wpnAb]);
  h.cantripAtkBonus = h.cantripProfile
    ? h.atkProf + mod(eff[cls.attack.ability])
    : h.atkBonus;

  /* casting ability for spell DCs / spell mods (consumed by spells.js) */
  h._classAtk = cls.attack.ability;
  h.dmgBonus = sum('dmg');
  h.healBonus = sum('heal');
  h.speedMult = race.speed * (1 + sum('speed'));
  /* Base 5e speed in feet (from RACES[].speedFt) — cached so the tactical
     turn engine (turn_engine.cellsForSpeed) can derive a per-turn cell budget
     without re-importing RACES. Defaults to 30 ft for legacy/unknown races. */
  /* Gear `move` affixes add feet of COMBAT movement — distinct from `speed`
     above, which is the exploration movement multiplier. */
  h.speedFt = (race.speedFt || 30) + sum('move');

  /* Flat bonus damage by type from gear (`elemFire`…`elemPsychic`), applied on
     every damaging hit — see heroDamage. Kept as a map so resistance handling
     and tooltips can tell the types apart rather than seeing one lump. */
  h.elemDamage = {};
  h.elemDamageTotal = 0;
  for(const t of ELEM_DAMAGE_TYPES){
    const v = sum('elem' + t[0].toUpperCase() + t.slice(1));
    if(v){ h.elemDamage[t] = v; h.elemDamageTotal += v; }
  }

  /* crit threshold: 20 by default; gear/skill widen it; elf keen senses widen
     it for any hero with a ranged option (ranged weapon OR caster cantrip). */
  let crit = 20 - sum('crit');
  const wpnMelee = h.weaponProfile ? h.weaponProfile.melee : true;
  if(race.critFinesse && (!wpnMelee || !!h.cantripProfile)) crit -= 1;
  if (h.inWildShape && h.wildShapeActiveForm && WILD_SHAPE_FORMS[h.wildShapeActiveForm]) {
    const wf = WILD_SHAPE_FORMS[h.wildShapeActiveForm];
    if (wf.acBonus) h.ac += wf.acBonus;
    if (wf.critBonus) crit -= wf.critBonus;
    if (wf.speedBonus) h.speedMult *= wf.speedBonus;
    if (wf.atkBonus) h.atkBonus += wf.atkBonus;
    if (wf.dmgBonus) h.dmgBonus += wf.dmgBonus;
  }
  h.critRange = Math.max(16, crit);

  /* seed lastProfile so out-of-turn code (perks, UI) has something to read
     before the first attack overwrites it */
  if(!h.lastProfile) h.lastProfile = h.weaponProfile || h.cantripProfile || unarmedFallback(h);

  /* Cure Wounds is a plain level-1 slot spell (spells.js) granted to healers at
     creation — no separate healSlots pool. See grantHealerCureWounds. */
  /* lay on hands pool */
  if(hasFeature(h, 'layOnHands')) {
    h.layOnHandsMax = 5 * h.level;
    if(h.layOnHands === undefined) h.layOnHands = h.layOnHandsMax;
    h.layOnHands = Math.min(h.layOnHands, h.layOnHandsMax);
  }

  /* monk ki pool (SRD 5e: monk level >= 2) */
  if(h.classKey === 'monk' || hasFeature(h, 'ki')) {
    const prevMax = h.kiMax || 0;
    h.kiMax = h.level >= 2 ? h.level : 0;
    if(h.ki === undefined) {
      h.ki = h.kiMax;
    } else if (h.kiMax > prevMax) {
      h.ki = Math.min(h.kiMax, (h.ki || 0) + (h.kiMax - prevMax));
    } else {
      h.ki = Math.max(0, Math.min(h.ki, h.kiMax));
    }
    h.kiSaveDC = 8 + profBonus(h.level) + mod(eff.wis);
  }

  /* Leveled spell slots (SRD tables): { spellLevel: count }. Casting spends
     the lowest slot ≥ the spell's level — no upcasting. */
  const slotsMax = spellSlotsFor(h.classKey, h.level);
  if(hasFeature(h, 'fontOfMagic')) slotsMax[1] = (slotsMax[1] || 0) + 1;
  /* Gear `slot1…slot9` affixes grant extra leveled slots. Only for heroes who
     already cast — a fighter with a slot-granting ring has nothing to spend it
     on, and handing them an empty pool would just be confusing. */
  if(Object.keys(slotsMax).length){
    for(let lv = 1; lv <= 9; lv++){
      const extra = sum('slot' + lv);
      if(extra) slotsMax[lv] = (slotsMax[lv] || 0) + extra;
    }
  }
  h.slotsMax = slotsMax;
  if(h.slots == null || typeof h.slots === 'number') {
    /* new hero or legacy numeric-pool save — start full */
    h.slots = { ...h.slotsMax };
  } else {
    /* clamp per level; pick up newly gained slot levels at full */
    for(const lv in h.slots) if(!(lv in h.slotsMax)) delete h.slots[lv];
    for(const lv in h.slotsMax) {
      if(h.slots[lv] === undefined || h.slots[lv] > h.slotsMax[lv]) h.slots[lv] = h.slotsMax[lv];
    }
  }

  /* keep secondWind flag in sync with features */
  if(hasFeature(h, 'secondWind') || cls.secondWind) h.secondWind = true;

  // Recalculate derived 5e skills. Kit gear (adventuring-gear slots) contributes
  // per-skill bonuses via eq.skills — a nested map from aggregateEquipment.
  // Spent skill ranks add a flat +1 each on top.
  const skGear = eq.skills || {};
  const skRanks = h.skillRanks || {};
  h.skillsDerived = {};
  for (const [key, skill] of Object.entries(SKILLS)) {
    const abiMod = mod(eff[skill.ability]);
    const isProf = h.proficiencies && h.proficiencies.includes(key);
    h.skillsDerived[key] = abiMod + (isProf ? profBonus(h.level) : 0)
      + (skGear[key] || 0) + (skRanks[key] || 0);
  }

  return h;
}

export function heroAttackBonus(h){ return h.atkBonus; }

/* ─── Attack profile (weapon-driven, D&D 5e) ──────────────────────────
   The basic-attack profile — { name, ability, dmg, range, melee, cantripScale,
   dmgType, source, finesse?, focus?, thrown?, offhand?, noAbilityMod? } — is
   derived from the EQUIPPED WEAPON, not the class. Casters additionally keep
   a cantrip profile and choose per-attack via aiPrefs.rangedPref.
   recalc() caches h.weaponProfile / h.offhandProfile / h.cantripProfile;
   pickAttackProfile(h) resolves the active profile (rolling for casters). */
function abilityForWeapon(item, effStats){
  if (!item || item.melee === false) return 'dex';        // ranged weapon
  if (item.finesse) {
    // finesse (5e): wielder's choice — use the higher of STR/DEX
    return mod(effStats.str) >= mod(effStats.dex) ? 'str' : 'dex';
  }
  return 'str';
}
export function buildWeaponProfile(h, item, opts = {}){
  if (!item || !item.dmg) return null;
  const ability = opts.ability || abilityForWeapon(item, h.effStats);
  return {
    name: item.baseKey || item.name || 'Weapon',
    ability,
    dmg: item.dmg.slice(),
    range: item.range != null ? item.range : 1.5,
    melee: item.melee !== false,
    cantripScale: false,
    dmgType: item.dmgType || 'slashing',
    source: 'weapon',
    finesse: !!item.finesse,
    focus: !!item.focus,
    thrown: !!item.thrown,
    light: !!item.light,
    ...opts
  };
}
const CANTRIP_DMG_TYPE = {
  cleric:'radiant', wizard:'fire', druid:'fire', sorcerer:'necrotic', warlock:'force'
};
/* Class cantrip → SPELLS key, so manual-mode casting (and the cast VFX) use the
   right spell definition. */
export const CANTRIP_SPELL_KEY = {
  cleric:'sacredFlame', wizard:'fireBolt', druid:'produceFlame', sorcerer:'chillTouch', warlock:'eldritchBlast'
};

/* Cantrips target saving throws instead of Armor Class:
   - Fire Bolt: DEX Save
   - Eldritch Blast: CHA Save
   - Chill Touch: CON Save
   - Produce Flame: WIS Save
   - Sacred Flame: DEX Save */
export const CANTRIP_SAVE_ABILITY = {
  sacredFlame: 'dex',
  fireBolt: 'dex',
  produceFlame: 'wis',
  chillTouch: 'con',
  eldritchBlast: 'cha'
};

export function buildCantripProfile(h){
  const cls = CLASSES[h.classKey];
  if (!cls.attack || !cls.attack.cantripScale) return null;
  const a = cls.attack;
  /* Eldritch Spear: the invocation exists to outrange everything else. */
  const range = a.range + (hasFeature(h, 'eldritchSpear') ? 4 : 0);
  /* Eldritch Blast is the one cantrip that does NOT scale by adding dice to a
     single attack — it adds whole beams, each its own attack roll and each
     carrying Agonizing Blast's CHA on its own. Rolling 4d10 once at level 17
     is both the wrong shape and a quiet nerf to Agonizing Blast, which the SRD
     pays out per beam. */
  const beams = CANTRIP_SPELL_KEY[h.classKey] === 'eldritchBlast'
    ? cantripDice(h.level) : 0;
  const nameKey = a.nameKey || CANTRIP_SPELL_KEY[h.classKey] || null;
  const saveAbility = a.saveAbility || CANTRIP_SAVE_ABILITY[nameKey] || 'dex';
  return {
    name: a.name, ability: a.ability, dmg: a.dmg.slice(),
    range, melee: !!a.melee, cantripScale: true, beams,
    nameKey,
    dmgType: CANTRIP_DMG_TYPE[h.classKey] || 'fire', source: 'cantrip',
    isSave: true,
    saveAbility
  };
}
export function unarmedFallback(h){
  if (h.classKey === 'monk') {
    const lvl = h.level || 1;
    const die = lvl >= 17 ? 10 : (lvl >= 11 ? 8 : (lvl >= 5 ? 6 : 4));
    return { name:'Unarmed Strike', ability:'dex', dmg:[1, die], range:1.4, melee:true,
             cantripScale:false, dmgType:'bludgeoning', source:'unarmed' };
  }
  return { name:'Unarmed Strike', ability:'str', dmg:[1,1], range:1.4, melee:true,
           cantripScale:false, dmgType:'bludgeoning', source:'unarmed' };
}
/* Resolve the active attack profile for this turn. For casters, rolls between
   the class cantrip and the equipped weapon based on aiPrefs.rangedPref.
   Martial with a thrown weapon uses the slider to pick thrown vs melee. */
export function pickAttackProfile(h){
  if (h.inWildShape && h.wildShapeActiveForm && WILD_SHAPE_FORMS[h.wildShapeActiveForm]) {
    const wf = WILD_SHAPE_FORMS[h.wildShapeActiveForm];
    const name = wf.key === 'wolf' ? 'Bite' : (wf.key === 'eagle' ? 'Beak & Talons' : 'Claws');
    return {
      name: `${wf.label} ${name}`,
      ability: wf.stat || 'str',
      dmg: wf.key === 'wolf' ? [2, 4] : (wf.key === 'eagle' ? [1, 6] : [2, 6]),
      range: 1.4,
      melee: true,
      cantripScale: false,
      dmgType: wf.key === 'eagle' ? 'piercing' : (wf.key === 'wolf' ? 'piercing' : 'slashing'),
      source: 'wildShape'
    };
  }
  let rp = h.aiPrefs && h.aiPrefs.rangedPref != null ? h.aiPrefs.rangedPref : null;
  if (rp == null) {
    const ms = h.aiPrefs && h.aiPrefs.movementStyle;
    rp = ms === 'kite' ? 0.85 : (ms === 'hold' ? 0.2 : 0.5);
  }
  if (h.cantripProfile) {
    // Focus weapons (wand/staff) keep the caster on their cantrip
    if (!h.weaponProfile || h.weaponProfile.focus) return h.cantripProfile;
    return Math.random() < rp ? h.cantripProfile : h.weaponProfile;
  }
  if (h.weaponProfile && h.weaponProfile.thrown) {
    if (Math.random() < rp) {
      return { ...h.weaponProfile, melee:false, range:Math.max(h.weaponProfile.range || 1.5, 5) };
    }
  }
  return h.weaponProfile || unarmedFallback(h);
}

export function heroDamage(h, crit, profile){
  const p = profile || h.weaponProfile || h.lastProfile;
  if (!p) return roll(1, 1, h.dmgBonus);
  /* A beam profile rolls its own dice once per beam; everything else with
     cantripScale grows a single roll. */
  let dice = (p.cantripScale && !p.beams) ? cantripDice(h.level) : p.dmg[0];
  if (crit) dice *= 2;
  if (crit && RACES[h.raceKey].savageCrit && p.melee) dice += 1;
  /* cantrips and TWF offhand attacks don't add ability mod; weapons do.
     Gear/skill dmg bonus always applies. */
  const noAbility = p.cantripScale || p.noAbilityMod;
  const abilityBonus = noAbility ? 0 : mod(h.effStats[p.ability]);
  /* Flat elemental damage from gear rides along on every hit. Not doubled on a
     crit — it isn't a die, and doubling it would make elemental affixes scale
     with crit rate on top of their own value, which isn't what they're priced for. */
  /* A connecting hit always does at least 1. `roll()` is a plain sum with no
     lower bound, so a negative ability modifier drags a small die to zero or
     below — and this is not an edge case: makeHero defaults any unspecified
     stat to 8 (mod -1), and abilityForWeapon returns 'str' for EVERY
     non-finesse melee weapon. So a caster swinging a quarterstaff rolls
     1d6-1 and whiffs for 0 about one hit in six.

     Both call sites are past their miss check, so reaching here means the blow
     landed. A landed blow that does nothing reads as a bug to the player even
     when the arithmetic is defensible — and a negative would have HEALED the
     target, since both application paths use `hp -= d`. */
  return Math.max(1, roll(dice, p.dmg[1], abilityBonus + h.dmgBonus + (h.elemDamageTotal || 0)));
}

/* level-up: HP grows via recalc; class progression grants features / choices
   (ASI or feat, spells, fighting styles) instead of a free ability point every level. */
export function grantXp(h, amount, log){
  h.xp += amount;
  while(h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level+1]){
    h.level++;
    applyLevelGrants(h, h.level, log, { autosOnly: false });
    if(log) log(`⭐ ${h.name} reaches level ${h.level}!`, 'level');
    /* Gear no longer attunes — item stats are frozen at their found ilvl, so
       levelling up grants nothing to equipment and upgrades come only from loot. */
    recalc(h);
    h.hp = h.maxHp;                       // full heal on level, like a rest
    if(log && h.level===SUBCLASS_UNLOCK && !h.subclass)
      log(`🌟 ${h.name} may choose a subclass! (Level Up menu)`, 'level');
    if(log && pendingChoiceCount(h) > 0)
      log(`📜 ${h.name} has feature choices to make (Level Up menu).`, 'level');
  }
}

/* Spend a banked ability point (+1 to a score, cap 20). Returns success. */
export function spendAbilityPoint(h, ability){
  if(h.pendingAbility<=0 || h.stats[ability]>=20) return false;
  h.stats[ability]++; h.pendingAbility--;
  recalc(h);
  return true;
}
/* Spend a banked skill point on a class skill (respecting its max rank). */
export function spendSkillPoint(h, skillKey){
  const s = classSkill(h.classKey, skillKey);
  if(!s || h.pendingSkill<=0) return false;
  const cur = h.skills[skillKey] || 0;
  if(cur >= s.max) return false;
  h.skills[skillKey] = cur+1; h.pendingSkill--;
  recalc(h);
  return true;
}
/* Spend a banked skill point on a 5e skill (Athletics, Investigation, …).
   Each rank is a flat +1 to that skill's check, capped at SKILL_RANK_MAX. */
export function spendSkillRank(h, skillKey){
  if(!SKILLS[skillKey] || (h.pendingSkillRank||0) <= 0) return false;
  if(!h.skillRanks) h.skillRanks = {};
  const cur = h.skillRanks[skillKey] || 0;
  if(cur >= SKILL_RANK_MAX) return false;
  h.skillRanks[skillKey] = cur+1; h.pendingSkillRank--;
  recalc(h);
  return true;
}
export function pendingPoints(h){
  return (h.pendingAbility||0) + (h.pendingSkill||0) + (h.pendingSkillRank||0)
    + (needsSubclass(h)?1:0) + pendingChoiceCount(h);
}

/* D&D 5e equipment proficiency: separate paths for weapons, armor, and shields.
   Helm/gloves/boots/rings/amulets have no proficiency gate (like 5e magic items). */
export function canEquip(h, item){
  const cls = CLASSES[h.classKey];
  /* Feats can grant proficiency beyond the class baseline (Lightly/Moderately/
     Heavily Armored, Martial Weapon Training). Take the best of class + feats. */
  const grants = equipmentGrants(h);

  /* 1. Shield proficiency — separate from armor (SRD 5.1)
        Barbarian, Cleric, Druid, Fighter, Paladin, Ranger are proficient;
        Moderately Armored grants it to anyone else. */
  if (item.slot === 'shield' && !(cls.shieldProf || grants.shield)) return false;

  /* 2. Weapon proficiency — simple / martial + optional specific weapon lists
        e.g. Bard/Rogue get Rapier+Shortsword+Longsword even though they are martial weapons. */
  if (item.slot === 'weapon') {
    if (cls.weaponSpecific && cls.weaponSpecific.includes(item.baseKey)) return true;
    const wType = item.weaponType || 'simple';
    const profRank = Math.max(WEAPON_RANK[cls.weaponProf || 'simple'],
                              grants.weaponMartial ? WEAPON_RANK.martial : 0);
    return WEAPON_RANK[wType] <= profRank;
  }

  /* 3. Body armor and helms — light / medium / heavy proficiency gate.
        Helms use the SAME ranks as body armor, so cloth hats (prof 'none', the
        Wizard Hat included) stay open to every class exactly as robes do, while
        a great helm needs heavy proficiency. Items predating the helm tags have
        no `prof`; migrateItem backfills it from the base so an old save cannot
        keep a helm its wearer could no longer pick up. */
  if (item.slot === 'armor' || item.slot === 'helm') {
    const armorRank = Math.max(PROF_RANK[cls.armorProf || 'none'], grants.armorRank);
    return PROF_RANK[item.prof || 'none'] <= armorRank;
  }

  /* 4. Gloves, boots, ring, amulet — always equippable (like 5e magic items) */

  /* 5. Trinket slot — a general consumable slot. Scrolls are caster-only;
        potions/charns (casterOnly:false) are usable by any class. */
  if (item.slot === 'trinket') {
    if (item.casterOnly) return isCasterClass(h.classKey);
    return true;
  }

  return true;
}
