/**
 * Item & loot system. Items are plain data carrying a `bonuses` object so the
 * rules layer (srd.js) can aggregate equipment without importing this module
 * cyclically for generation (dependency is one-way for pure helpers).
 *
 * Item shape:
 *   baseKey, slot, rarity, ilvl, affixKeys[], perk?, bonuses{}, visuals...
 *
 * bonuses shape (all optional, additive):
 *   str dex con int wis cha  — ability score bonuses
 *   ac atk dmg hp            — combat bonuses
 *   crit                     — lowers crit threshold (1 => crit on 19-20)
 *   heal                     — added to Cure Wounds / healing
 *   speed                    — movement multiplier bonus (0.1 = +10%)
 *
 * Legendaries: quest rewards only. Always carry one combat perk and bond to
 * the wearer's level while equipped.
 */

/* equipment slots, in display order */
export const SLOTS = [
  { key:'helm',   label:'Helm',    icon:'🪖' },
  { key:'amulet', label:'Amulet',  icon:'📿' },
  { key:'armor',  label:'Armor',   icon:'🧥' },
  { key:'gloves', label:'Gloves',  icon:'🧤' },
  { key:'weapon', label:'Weapon',  icon:'⚔️' },
  { key:'offhand',label:'Off-hand',icon:'🛡️' },
  { key:'ring1',  label:'Ring',    icon:'💍' },
  { key:'ring2',  label:'Ring',    icon:'💍' },
  { key:'boots',  label:'Boots',   icon:'🥾' }
];
export const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s.key,s.label]));
/* which equip-slot(s) an item's `slot` field can occupy */
export function slotsFor(itemSlot){
  if(itemSlot==='ring') return ['ring1','ring2'];
  if(itemSlot==='shield') return ['offhand'];
  return [itemSlot];
}

/* armor proficiency ranks */
export const PROF_RANK = { none:0, light:1, medium:2, heavy:3 };

/* D&D 5e weapon type ranks — simple (0) < martial (1) */
export const WEAPON_TYPE = { simple:'simple', martial:'martial' };
export const WEAPON_RANK = { simple:0, martial:1 };

/* rarities: weight is the base drop weight; mult scales gold value;
   affixes = how many secondary stat rolls it gets on top of the base.
   Legendary is quest-only and never appears in weighted random rolls. */
export const RARITIES = {
  common:    { name:'',          color:'#b4b0a4', weight:50,  mult:1.0, affixes:0 },
  uncommon:  { name:'Fine',      color:'#5fd46a', weight:26,  mult:1.7, affixes:1 },
  rare:      { name:'Enchanted', color:'#5aa0f0', weight:14,  mult:2.5, affixes:2 },
  epic:      { name:'Ancient',   color:'#b06cf0', weight:6,   mult:3.5, affixes:2 },
  legendary: { name:'Fabled',    color:'#e8a83f', weight:0,   mult:4.8, affixes:2 }
};
export const RARITY_ORDER = ['common','uncommon','rare','epic','legendary'];
export const TIER = { common:0, uncommon:1, rare:2, epic:3, legendary:4 };

/* ─── Legendary perks ─────────────────────────────────────────────────── */
export const PERKS = {
  cleave: {
    id:'cleave', name:'Cleave',
    desc:'On hit, deal 45% damage to a nearby foe.',
    hooks:['onHit'], slots:['weapon']
  },
  lifesteal: {
    id:'lifesteal', name:'Bloodthirst',
    desc:'Heal for 18% of damage dealt on hit.',
    hooks:['onHit'], slots:['weapon']
  },
  execute: {
    id:'execute', name:'Execute',
    desc:'+35% damage vs enemies below 30% HP.',
    hooks:['onHit'], slots:['weapon']
  },
  burn: {
    id:'burn', name:'Immolate',
    desc:'Hits ignite the foe for bonus fire damage over time.',
    hooks:['onHit'], slots:['weapon']
  },
  firstStrike: {
    id:'firstStrike', name:'First Strike',
    desc:'Your opening blow each fight deals +50% damage.',
    hooks:['onHit'], slots:['weapon']
  },
  critSurge: {
    id:'critSurge', name:'Crit Surge',
    desc:'Critical hits deal +4 bonus damage.',
    hooks:['onCrit'], slots:['weapon']
  },
  chain: {
    id:'chain', name:'Arc Chain',
    desc:'Ranged/magic hits have a 40% chance to arc to a second foe.',
    hooks:['onHit'], slots:['weapon']
  },
  manaFont: {
    id:'manaFont', name:'Mana Font',
    desc:'15% chance on hit to restore a spell slot.',
    hooks:['onHit'], slots:['weapon']
  },
  riposte: {
    id:'riposte', name:'Riposte',
    desc:'When hit in melee, retaliate for 3 + half level damage.',
    hooks:['onDamaged'], slots:['weapon','offhand']
  },
  thorns: {
    id:'thorns', name:'Thorns',
    desc:'Attackers take 2 + floor(level/3) damage.',
    hooks:['onDamaged'], slots:['armor','offhand','amulet']
  },
  phaseStep: {
    id:'phaseStep', name:'Phase Step',
    desc:'On kill, briefly gain +4 AC for 3 seconds.',
    hooks:['onKill'], slots:['boots','weapon','ring']
  },
  keenEdge: {
    id:'keenEdge', name:'Keen Edge',
    desc:'Widen critical range by 1 (stacks with other sources).',
    hooks:['passive'], slots:['weapon'],
    passive:{ crit:1 }
  },
  bulwark: {
    id:'bulwark', name:'Bulwark',
    desc:'+1 AC and +8 HP while equipped.',
    hooks:['passive'], slots:['armor','offhand','helm'],
    passive:{ ac:1, hp:8 }
  },
  windwalker: {
    id:'windwalker', name:'Windwalker',
    desc:'+12% move speed while equipped.',
    hooks:['passive'], slots:['boots','amulet','ring'],
    passive:{ speed:0.12 }
  }
};

const PERK_LIST = Object.values(PERKS);

/** Theme-flavored perk weights for quest legendaries. */
const THEME_PERK_BIAS = {
  ancient: ['keenEdge','manaFont','chain','bulwark'],
  verdant: ['lifesteal','thorns','windwalker','riposte'],
  frost:   ['firstStrike','execute','bulwark','phaseStep'],
  grim:    ['lifesteal','execute','critSurge','riposte'],
  molten:  ['burn','cleave','critSurge','thorns']
};

/* base item templates: primary bonus + slot + icon. `prof` on armor gates it
   behind class armor training. */
const BASES = {
  weapon: [
    { name:'Club',          weaponType:'simple', icon:'dcss/item/weapon/club.png', prim:{}, visualWeapon:'blunt/mace', visualColor:'#8d5524', light:true },
    { name:'Rusty Dagger',  weaponType:'simple', icon:'dcss/item/weapon/dagger_old.png', prim:{}, visualWeapon:'sword/dagger', visualColor:'#8f7777', finesse:true, light:true, thrown:true },
    { name:'Wooden Wand',   weaponType:'simple', icon:'dcss/item/wand/gem_wood.png', prim:{}, visualWeapon:'magic/wand', visualColor:'#a17043' },
    { name:'Dagger',        weaponType:'simple', icon:'dcss/item/weapon/dagger.png', prim:{atk:1, crit:1}, visualWeapon:'sword/dagger', finesse:true, light:true, thrown:true },
    { name:'Shortsword',    weaponType:'martial', icon:'dcss/item/weapon/short_sword_1.png', prim:{atk:1, dmg:1}, visualWeapon:'sword/longsword', finesse:true, light:true },
    { name:'Longsword',     weaponType:'martial', icon:'dcss/item/weapon/long_sword_1.png', prim:{atk:2, dmg:1}, visualWeapon:'sword/longsword', versatile:true },
    { name:'Greatsword',    weaponType:'martial', icon:'dcss/item/weapon/greatsword_1.png', prim:{atk:2, dmg:2}, twoHanded:true, visualWeapon:'sword/longsword_alt', heavy:true },
    { name:'Rapier',        weaponType:'martial', icon:'dcss/item/weapon/rapier_1.png', prim:{atk:2, crit:1}, visualWeapon:'sword/rapier', finesse:true },
    { name:'Mace',          weaponType:'simple', icon:'dcss/item/weapon/mace_1.png', prim:{atk:1, dmg:2}, visualWeapon:'blunt/mace' },
    { name:'Warhammer',     weaponType:'martial', icon:'dcss/item/weapon/war_hammer.png', prim:{dmg:2}, visualWeapon:'blunt/hammer', versatile:true },
    { name:'Spear',         weaponType:'simple', icon:'dcss/item/weapon/spear.png', prim:{atk:2, dmg:1}, visualWeapon:'polearm/spear', versatile:true, thrown:true },
    { name:'Battleaxe',     weaponType:'martial', icon:'dcss/item/weapon/axe.png', prim:{dmg:2, crit:1}, visualWeapon:'blunt/waraxe', versatile:true },
    { name:'Shortbow',      weaponType:'simple', icon:'dcss/item/weapon/ranged/shortbow_1.png', prim:{atk:1, dmg:1}, range:5, twoHanded:true, visualWeapon:'ranged/bow' },
    { name:'Longbow',       weaponType:'martial', icon:'dcss/item/weapon/ranged/longbow.png', prim:{atk:2, dmg:2}, range:8, twoHanded:true, visualWeapon:'ranged/bow', heavy:true },
    { name:'Wand',          weaponType:'simple', icon:'dcss/item/wand/wand_silver.png', prim:{atk:1, int:1}, range:6, visualWeapon:'magic/wand' },
    { name:'Staff',         weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{dmg:1, wis:1}, twoHanded:true, visualWeapon:'magic/wand', visualColor:'#8d5524', versatile:true },
    { name:'Diamond Staff', weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{atk:1, int:2, wis:1}, twoHanded:true, visualWeapon:'magic/diamond', visualColor:'#5c4033', versatile:true },
    { name:'Gnarled Staff', weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{atk:1, wis:2}, twoHanded:true, visualWeapon:'magic/gnarled', visualColor:'#8b5a2b', versatile:true },
    { name:'Loop Staff',    weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{atk:1, int:1, wis:2}, twoHanded:true, visualWeapon:'magic/loop', visualColor:'#7b4a1b', versatile:true },
    { name:'S Staff',       weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{atk:1, int:3}, twoHanded:true, visualWeapon:'magic/s', visualColor:'#4b2a0b', versatile:true },
    { name:'Simple Staff',  weaponType:'simple', icon:'dcss/item/weapon/quarterstaff.png', prim:{atk:1, wis:1}, twoHanded:true, visualWeapon:'magic/simple', visualColor:'#8d5524', versatile:true },
    { name:'Dragonspear',   weaponType:'martial', icon:'dcss/item/weapon/spear.png', prim:{atk:2, dmg:3}, twoHanded:true, visualWeapon:'polearm/dragonspear', heavy:true, reach:true },
    { name:'Halberd',       weaponType:'martial', icon:'dcss/item/weapon/spear.png', prim:{atk:1, dmg:3, crit:1}, twoHanded:true, visualWeapon:'polearm/halberd', heavy:true, reach:true },
    { name:'Longspear',     weaponType:'martial', icon:'dcss/item/weapon/spear.png', prim:{atk:3, dmg:2}, twoHanded:true, visualWeapon:'polearm/longspear', heavy:true, reach:true },
    { name:'Flail',         weaponType:'martial', icon:'dcss/item/weapon/mace_1.png', prim:{atk:2, dmg:2}, visualWeapon:'blunt/flail' },
    { name:'Katana',        weaponType:'martial', icon:'dcss/item/weapon/katana.png', prim:{atk:3, crit:1}, visualWeapon:'sword/katana', versatile:true },
    { name:'Saber',         weaponType:'martial', icon:'dcss/item/weapon/scimitar.png', prim:{atk:2, speed:0.05}, visualWeapon:'sword/saber', finesse:true },
    { name:'Scimitar',      weaponType:'martial', icon:'dcss/item/weapon/scimitar.png', prim:{atk:1, dmg:2, crit:1}, visualWeapon:'sword/scimitar', finesse:true, light:true },
    { name:'Arming Sword',  weaponType:'martial', icon:'dcss/item/weapon/short_sword_1.png', prim:{atk:2, dmg:2}, visualWeapon:'sword/arming', versatile:true },
    { name:'Crossbow',      weaponType:'martial', icon:'dcss/item/weapon/ranged/shortbow_1.png', prim:{atk:2, dmg:3}, range:6, twoHanded:true, visualWeapon:'ranged/crossbow', heavy:true, loading:true },
    { name:'Hand Axe',      weaponType:'simple', icon:'dcss/item/weapon/axe.png', prim:{atk:1, dmg:2}, visualWeapon:'blunt/waraxe', light:true, thrown:true }
  ],
  shield: [
    { name:'Buckler',     icon:'dcss/item/armor/shields/buckler_1.png', prim:{ac:1}, visualShield:'round' },
    { name:'Kite Shield', icon:'dcss/item/armor/shields/shield_2_kite.png', prim:{ac:2}, visualShield:'kite' },
    { name:'Tower Shield',icon:'dcss/item/armor/shields/large_shield_1.png', prim:{ac:2, hp:4}, visualShield:'crusader/fg' }
  ],
  helm: [
    { name:'Cap',            icon:'dcss/item/armor/headgear/cap_1.png', prim:{ac:1}, visualHelm:'cloth/leather_cap', visualColor:'#8d5524' },
    { name:'Circlet',        icon:'dcss/item/armor/headgear/elven_leather_helm.png', prim:{int:1, wis:1}, visualHelm:'headband/thick' },
    { name:'Wizard Hat',     icon:'dcss/item/armor/headgear/wizard_hat_1.png', prim:{int:1, wis:1}, visualHelm:'magic/large' },
    { name:'Tricorne Hat',   icon:'dcss/item/armor/headgear/hat_1.png', prim:{cha:1, dex:1}, visualHelm:'pirate/tricorne/basic' },
    { name:'Barbuta',        icon:'dcss/item/armor/headgear/helmet_3.png', prim:{ac:1, hp:2}, visualHelm:'helmet/barbuta' },
    { name:'Bascinet',       icon:'dcss/item/armor/headgear/helmet_4.png', prim:{ac:2}, visualHelm:'helmet/bascinet' },
    { name:'Kettle Helm',    icon:'dcss/item/armor/headgear/helmet_2.png', prim:{ac:2, dex:-1}, visualHelm:'helmet/kettle' },
    { name:'Horned Helm',    icon:'dcss/item/armor/headgear/crested_helmet.png', prim:{ac:2, str:1}, visualHelm:'helmet/horned' },
    { name:'Spangenhelm',    icon:'dcss/item/armor/headgear/helmet_2.png', prim:{ac:2, hp:5}, visualHelm:'helmet/spangenhelm' },
    { name:'Armet',          icon:'dcss/item/armor/headgear/helmet_5.png', prim:{ac:3}, visualHelm:'helmet/armet' },
    { name:'Close Helm',     icon:'dcss/item/armor/headgear/helmet_5.png', prim:{ac:3, hp:3}, visualHelm:'helmet/close' },
    { name:'Sugarloaf Helm', icon:'dcss/item/armor/headgear/plumed_helmet.png', prim:{ac:3, hp:6}, visualHelm:'helmet/sugarloaf' },
    { name:'Great Helm',     icon:'dcss/item/armor/headgear/helmet_1.png', prim:{ac:3, hp:8}, visualHelm:'helmet/greathelm' },
    { name:'Cloth Hood',     icon:'dcss/item/armor/headgear/wizard_hat_2.png', prim:{ac:1, dex:1}, visualHelm:'cloth/hood', visualColor:'#333333' },
    { name:'Mail Coif',      icon:'dcss/item/armor/headgear/helmet_coif.png', prim:{ac:2}, visualHelm:'helmet/mail', visualColor:'#a9a9a9' }
  ],
  armor: [
    /* 5e AC model: body armor SETS the AC base (armorBase) by category (prof).
       Dex is applied per category in recalc (light=full, medium=max+2, heavy=0);
       'none' torsos are cloth → unarmored (base 10 + Dex). Non-AC stats (hp/int/
       dex) stay as item bonuses; AC no longer double-counts through prim.ac. */
    { name:'Torn Robe',    icon:'dcss/item/armor/torso/robe_1_old.png', prim:{}, prof:'none', visualTorso:'clothes/robe', visualColor:'#7c6858' },
    { name:'Peasant Shirt',icon:'dcss/item/armor/torso/animal_skin_1.png', prim:{}, prof:'none', visualTorso:'clothes/shortsleeve/shortsleeves', visualColor:'#d6cbb1' },
    { name:'Tabard',       icon:'dcss/item/armor/torso/robe_2.png', prim:{hp:2}, prof:'none', visualTorso:'jacket/tabard', visualLegs:'none' },
    { name:'Robe',         icon:'dcss/item/armor/torso/robe_1.png', prim:{int:1}, prof:'none', visualTorso:'clothes/robe', visualColor:'#3a66b2' },
    { name:'Leather Armor',icon:'dcss/item/armor/torso/leather_armor_1.png', prim:{}, armorBase:11, prof:'light', visualTorso:'armour/leather' },
    { name:'Chain Shirt',  icon:'dcss/item/armor/torso/chain_mail_1.png', prim:{hp:4}, armorBase:13, prof:'medium', visualTorso:'chainmail' },
    { name:'Legion Armor', icon:'dcss/item/armor/torso/chain_mail_2.png', prim:{hp:6}, armorBase:14, prof:'medium', visualTorso:'armour/legion', visualShoulders:'legion' },
    { name:'Plate Armor',  icon:'dcss/item/armor/torso/plate_1.png', prim:{hp:8}, armorBase:18, prof:'heavy', visualTorso:'armour/plate', visualLegs:'armour/plate' },
    { name:'Sleeveless Tunic',icon:'dcss/item/armor/torso/robe_2.png', prim:{dex:1}, prof:'none', visualTorso:'clothes/sleeveless', visualColor:'#a0522d' },
    { name:'Leather Vest', icon:'dcss/item/armor/torso/leather_armor_1.png', prim:{dex:1}, armorBase:11, prof:'light', visualTorso:'clothes/vest', visualColor:'#5c4033' }
  ],
  gloves: [
    { name:'Gloves',          icon:'dcss/item/armor/hands/glove_1.png', prim:{atk:1}, visualGloves:'arms/hands/gloves' },
    { name:'Leather Bracers', icon:'dcss/item/armor/hands/gauntlet_1.png', prim:{ac:1}, visualGloves:'arms/bracers' },
    { name:'Gauntlets',       icon:'dcss/item/armor/hands/gauntlet_1.png', prim:{str:1}, visualGloves:'arms/armour/plate' },
    { name:'Mage Gloves',     icon:'dcss/item/armor/hands/glove_3.png', prim:{int:1, wis:1}, visualGloves:'arms/hands/gloves' }
  ],
  boots: [
    { name:'Sandals',       icon:'dcss/item/armor/feet/boots_4_green.png', prim:{speed:0.05}, visualShoes:'sandals' },
    { name:'Boots',         icon:'dcss/item/armor/feet/boots_1_brown_new.png', prim:{speed:0.1}, visualShoes:'shoes/basic' },
    { name:'Rimmed Boots',  icon:'dcss/item/armor/feet/boots_1_brown_new.png', prim:{speed:0.08, hp:2}, visualShoes:'boots/rimmed' },
    { name:'Swift Boots',   icon:'dcss/item/armor/feet/boots_2_jackboots.png', prim:{speed:0.18, dex:1}, visualShoes:'shoes/basic' },
    { name:'Ranger Boots',  icon:'dcss/item/armor/feet/boots_3_stripe_new.png', prim:{speed:0.12, dex:1}, visualShoes:'boots/fold' },
    { name:'Ghillie Shoes', icon:'dcss/item/armor/feet/boots_1_brown_new.png', prim:{speed:0.15, dex:1}, visualShoes:'shoes/ghillies' },
    { name:'Greaves',       icon:'dcss/item/armor/feet/boots_iron_2.png', prim:{ac:1, hp:2}, visualShoes:'armour/plate' },
    { name:'Steel Greaves', icon:'dcss/item/armor/feet/boots_iron_2.png', prim:{ac:1, hp:4}, visualShoes:'armour/plate' }
  ],
  ring: [
    { name:'Ring of Protection', icon:'dcss/item/ring/iron.png', prim:{ac:1} },
    { name:'Ring of Might',      icon:'dcss/item/ring/gold.png', prim:{str:1} },
    { name:'Ring of Precision',  icon:'dcss/item/ring/emerald.png', prim:{atk:1} },
    { name:'Ring of Vigor',      icon:'dcss/item/ring/ruby.png', prim:{hp:5} },
    { name:'Ring of the Adept',  icon:'dcss/item/ring/diamond.png', prim:{int:1, wis:1} }
  ],
  amulet: [
    { name:'Amulet of Health',   icon:'dcss/item/amulet/crystal_red.png', prim:{con:1, hp:4} },
    { name:'Amulet of Fury',     icon:'dcss/item/amulet/celtic_red.png', prim:{dmg:1} },
    { name:'Amulet of Warding',  icon:'dcss/item/amulet/celtic_yellow.png', prim:{ac:1, hp:3} },
    { name:'Amulet of Insight',  icon:'dcss/item/amulet/eye_cyan.png', prim:{wis:1, heal:2} }
  ]
};
const BASE_SLOTS = Object.keys(BASES);

/** Look up a base template by slot + name. */
export function getBase(slot, baseKey){
  const list = BASES[slot];
  if(!list) return null;
  return list.find(b => b.name === baseKey) || null;
}

/* Minimum floor a base can start dropping on. Weak/basic gear drops from the
   start; stronger bases unlock as the party descends, so there's always a
   next upgrade to chase. (Starter items bypass this via makeStarterItem.) */
const BASE_MIN_FLOOR = {
  'Wand':2, 'Circlet':2, 'Gauntlets':2, 'Mage Gloves':2, 'Barbuta':2, 'Rimmed Boots':2,
  'Longsword':3, 'Rapier':3, 'Mace':3, 'Battleaxe':3, 'Shortbow':3, 'Staff':3,
  'Kite Shield':3, 'Chain Shirt':3, 'Swift Boots':3, 'Greaves':3,
  'Ring of the Adept':3, 'Amulet of Health':3, 'Bascinet':3, 'Kettle Helm':3,
  'Wizard Hat':3, 'Tricorne Hat':3, 'Ranger Boots':3,
  'Simple Staff':3, 'Loop Staff':3, 'Arming Sword':3, 'Scimitar':3, 'Hand Axe':3, 'Mail Coif':3,
  'Great Helm':4, 'Horned Helm':4, 'Spangenhelm':4, 'Legion Armor':4, 'Ghillie Shoes':4, 'Steel Greaves':4,
  'Gnarled Staff':4, 'Diamond Staff':4, 'Flail':4, 'Saber':4, 'Crossbow':4,
  'Greatsword':5, 'Spear':5, 'Longbow':5, 'Tower Shield':5, 'Plate Armor':5, 'Close Helm':5,
  'S Staff':5, 'Longspear':5, 'Halberd':5, 'Katana':5,
  'Sugarloaf Helm':6, 'Dragonspear':6
};

/* secondary affixes pulled for higher rarities */
const AFFIXES = [
  { key:'str', label:'of Strength',   b:{str:1} },
  { key:'dex', label:'of Agility',    b:{dex:1} },
  { key:'con', label:'of Endurance',  b:{con:1} },
  { key:'int', label:'of Intellect',  b:{int:1} },
  { key:'wis', label:'of Wisdom',     b:{wis:1} },
  { key:'atk', label:'of Accuracy',   b:{atk:1} },
  { key:'dmg', label:'of Wrath',      b:{dmg:1} },
  { key:'ac',  label:'of the Turtle', b:{ac:1} },
  { key:'hp',  label:'of the Bear',   b:{hp:5} },
  { key:'crit',label:'of Ruin',       b:{crit:1} }
];
const AFFIX_BY_KEY = Object.fromEntries(AFFIXES.map(a => [a.key, a]));
const AFFIX_BY_LABEL = Object.fromEntries(AFFIXES.map(a => [a.label, a]));

let _uid = 1;
const pick = (arr, rng) => arr[Math.floor(rng()*arr.length)];

const VISORS = [
  'grated', 'grated_narrow', 'horned', 'pigface', 'pigface_raised',
  'round', 'round_raised', 'slit', 'slit_narrow'
];

// Gear color variations drawn from LPC metal and cloth palettes
const METALS = [
  '#b08a36', // Brass
  '#a26118', // Copper
  '#b54936', // Bronze
  '#52414a', // Dark Iron
  '#726b7e', // Steel
  '#c8d4db', // Silver
  '#e8c25a', // Gold
  '#8fd4e8', // Mithril
  '#252025'  // Obsidian
];
const CLOTHS = [
  '#a32020', // Crimson
  '#2e7d32', // Forest Green
  '#1565c0', // Royal Blue
  '#6a1b9a', // Shadow Purple
  '#8d5524', // Leather Brown
  '#3e2723', // Dark Leather
  '#f5f5f5', // Alabaster White
  '#212121'  // Midnight Black
];

function rollVisualColor(slot, rarityKey, rng) {
  // 60% of common drops retain their standard sprite sheet colors
  if (rarityKey === 'common' && rng() < 0.6) return null;
  if (slot === 'ring' || slot === 'amulet') return null;

  if (slot === 'weapon' || slot === 'shield' || slot === 'helm' || (slot === 'armor' && rng() < 0.4)) {
    return pick(METALS, rng);
  } else {
    return pick(CLOTHS, rng);
  }
}

/* Highest rarity random loot allows. Legendaries are quest-only. */
function maxRarityIdx(floor){
  if(floor>=12) return 3;   // epic
  if(floor>=7)  return 2;   // rare
  if(floor>=3)  return 1;   // uncommon
  return 0;                // floors 1—2: common only
}
function rollRarity(floor, rng, maxIdx = null){
  const cap = maxIdx != null ? Math.min(maxIdx, maxRarityIdx(floor)) : maxRarityIdx(floor);
  const boost = 1 + floor*0.04;          // deeper floors tilt toward rarer loot
  let total=0; const w=[];
  for(let idx=0; idx<=cap; idx++){
    w[idx] = RARITIES[RARITY_ORDER[idx]].weight * Math.pow(boost, idx);
    total += w[idx];
  }
  let r = rng()*total;
  for(let idx=0; idx<=cap; idx++){ r -= w[idx]; if(r<=0) return RARITY_ORDER[idx]; }
  return 'common';
}

/* Combat bonuses (ac/atk/dmg/crit) are king in d20 math, so they scale in
   small integer steps by rarity tier + ilvl — never by the raw rarity multiplier,
   which would make high-ilvl pieces absurd. HP and gold value can scale more
   freely; ability scores cap at +2 from a single source. */
export function scaleBonus(key, baseVal, tier, ilvl){
  const lvl = Math.max(1, ilvl|0);
  switch(key){
    case 'ac':
    case 'atk':
    case 'dmg':
      return baseVal + Math.floor(tier/2) + Math.floor(lvl/8);   // +0..+2 tier, slow ilvl creep
    case 'crit':
      return baseVal + (tier>=3 ? 1 : 0);
    case 'hp':
      return Math.round(baseVal * (1 + tier*0.6)) + Math.floor(lvl/2)*2;
    case 'speed':
      return +(baseVal * (1 + tier*0.15)).toFixed(2);
    case 'heal':
      return baseVal + Math.floor(tier/2) + Math.floor(lvl/10);
    case 'str': case 'dex': case 'con': case 'int': case 'wis': case 'cha':
      return baseVal + (tier>=2 ? 1 : 0);                          // +1, or +2 at rare+
    default:
      return baseVal;
  }
}

/** Recompute `item.bonuses` (and display name) from base + affixes + ilvl + perk. */
export function recomputeItemBonuses(item){
  if(!item) return item;
  const base = getBase(item.slot, item.baseKey);
  const rarityKey = item.rarity || 'common';
  const R = RARITIES[rarityKey] || RARITIES.common;
  const tier = TIER[rarityKey] ?? 0;
  const ilvl = Math.max(1, item.ilvl|0);
  const bonuses = {};

  const addB = (src, isAffix) => {
    if(!src) return;
    for(const k in src){
      const v = scaleBonus(k, src[k], isAffix ? Math.max(0, tier-1) : tier, ilvl);
      bonuses[k] = (bonuses[k]||0) + v;
    }
  };

  if(base) addB(base.prim, false);
  else if(item._legacyPrim) addB(item._legacyPrim, false);

  const affixKeys = item.affixKeys || [];
  let suffix = '';
  for(const key of affixKeys){
    const aff = AFFIX_BY_KEY[key];
    if(!aff) continue;
    addB(aff.b, true);
    if(!suffix) suffix = ' ' + aff.label;
  }

  /* passive perk stats (keen edge, bulwark, etc.) */
  if(item.perk && item.perk.id && PERKS[item.perk.id]?.passive){
    addB(PERKS[item.perk.id].passive, false);
  }

  item.bonuses = bonuses;
  item.color = R.color;

  /* rebuild name unless it's a named unique */
  if(!item.uniqueName){
    const prefix = R.name ? R.name + ' ' : '';
    const baseName = base?.name || item.baseKey || 'Relic';
    item.name = prefix + baseName + suffix;
  } else {
    item.name = item.uniqueName;
  }

  item.value = Math.round((5 + ilvl*7) * R.mult * (1 + Object.keys(bonuses).length*0.8) * (item.perk ? 1.9 : 1));
  return item;
}

/** Preview bonuses at a given ilvl without mutating the item. */
export function previewBonuses(item, ilvl){
  const clone = {
    ...item,
    ilvl,
    bonuses: {},
    affixKeys: item.affixKeys ? [...item.affixKeys] : [],
    perk: item.perk
  };
  recomputeItemBonuses(clone);
  return clone.bonuses;
}

/** Effective ilvl for display / combat (legendaries bond to wearer). */
export function effectiveIlvl(item, heroLevel){
  if(!item) return 1;
  const base = Math.max(1, item.ilvl|0);
  if(item.rarity === 'legendary' && heroLevel) return Math.max(base, heroLevel);
  return base;
}

function buildVisuals(slot, base, rarityKey, rng){
  const visualColor = base.visualColor || rollVisualColor(slot, rarityKey, rng);
  const visualVisor = (slot === 'helm' && base.name !== 'Cap' && base.name !== 'Circlet' && base.name !== 'Cloth Hood' && base.name !== 'Mail Coif' && rng() < 0.4)
    ? pick(VISORS, rng) : null;

  let visualShoulders = base.visualShoulders || null;
  let visualSleeves = null;
  if (slot === 'armor') {
    if (base.name === 'Plate Armor') {
      visualShoulders = rng() < 0.8 ? pick(['pauldrons', 'bauldron', 'mantal'], rng) : null;
    } else if (base.name === 'Legion Armor') {
      visualShoulders = 'legion';
    } else if (base.name === 'Chain Shirt' && rng() < 0.5) {
      visualShoulders = 'epaulets';
    } else if ((base.name === 'Robe' || base.name === 'Torn Robe') && rng() < 0.6) {
      visualSleeves = 'clothes/longsleeve/longsleeves';
    }
  }

  let visualCrystal = null;
  let crystalColor = null;
  if (slot === 'weapon' && base.visualWeapon && base.visualWeapon.startsWith('magic/')) {
    visualCrystal = 'magic/crystal';
    crystalColor = pick(['#ff3333', '#3333ff', '#33ff33', '#ffa500', '#ffff33', '#ff33ff', '#33ffff'], rng);
  }

  return {
    visualTorso: base.visualTorso,
    visualLegs: base.visualLegs,
    visualWeapon: base.visualWeapon,
    visualHelm: base.visualHelm,
    visualShield: base.visualShield,
    visualColor,
    visualVisor,
    visualShoulders,
    visualSleeves,
    visualCrystal,
    crystalColor,
    visualShoes: base.visualShoes || null,
    visualGloves: base.visualGloves || null
  };
}

function rollAffixKeys(count, usedPrimKeys, rng){
  const used = new Set(usedPrimKeys || []);
  const keys = [];
  for(let i=0;i<count;i++){
    const options = AFFIXES.filter(a => !used.has(a.key));
    if(!options.length) break;
    const aff = pick(options, rng);
    used.add(aff.key);
    keys.push(aff.key);
  }
  return keys;
}

function makeItemRecord(slot, base, rarityKey, ilvl, affixKeys, perk, rng){
  const R = RARITIES[rarityKey];
  const visuals = buildVisuals(slot, base, rarityKey, rng);
  const item = {
    id: 'i'+(_uid++),
    baseKey: base.name,
    slot,
    icon: base.icon,
    rarity: rarityKey,
    color: R.color,
    ilvl: Math.max(1, ilvl|0),
    floor: Math.max(1, ilvl|0), // legacy field kept for saves/UI
    affixKeys: affixKeys || [],
    perk: perk || null,
    prof: base.prof || 'none',
    bonuses: {},
    ...visuals
  };
  /* propagate D&D 5e gameplay properties from base -> item */
  if(base.weaponType) item.weaponType = base.weaponType;
  if(base.twoHanded) item.twoHanded = true;
  if(base.range != null) item.range = base.range;
  if(base.finesse) item.finesse = true;
  if(base.light) item.light = true;
  if(base.heavy) item.heavy = true;
  if(base.reach) item.reach = true;
  if(base.thrown) item.thrown = true;
  if(base.versatile) item.versatile = true;
  if(base.loading) item.loading = true;
  if(base.armorBase) item.armorBase = base.armorBase;
  recomputeItemBonuses(item);
  return item;
}

/**
 * Generate one random item scaled to a dungeon floor / ilvl.
 * Random loot never exceeds epic.
 */
export function rollItem(floor, rng=Math.random, forceSlot=null, opts={}){
  const ilvl = Math.max(1, (opts.ilvl != null ? opts.ilvl : floor)|0);
  const slot = forceSlot || pick(BASE_SLOTS, rng);
  const base = pick(BASES[slot], rng);

  let rarityKey = opts.forceRarity || rollRarity(Math.max(floor, ilvl), rng, opts.maxRarityIdx);
  // Hard cap: random generation never yields legendary
  if(rarityKey === 'legendary' && !opts.allowLegendary) rarityKey = 'epic';

  const R = RARITIES[rarityKey];
  const affixKeys = rollAffixKeys(R.affixes, Object.keys(base.prim||{}), rng);
  return makeItemRecord(slot, base, rarityKey, ilvl, affixKeys, null, rng);
}

/** Pick a perk valid for a slot, optionally biased by quest theme. */
export function rollPerk(slot, theme=null, rng=Math.random){
  const itemSlot = slot === 'shield' ? 'offhand' : slot;
  let pool = PERK_LIST.filter(p => !p.slots || p.slots.includes(itemSlot) || p.slots.includes(slot));
  if(!pool.length) pool = PERK_LIST.filter(p => p.slots?.includes('weapon'));
  if(!pool.length) return { id:'lifesteal', name:PERKS.lifesteal.name, desc:PERKS.lifesteal.desc };

  const bias = theme && THEME_PERK_BIAS[theme];
  if(bias && rng() < 0.55){
    const themed = pool.filter(p => bias.includes(p.id));
    if(themed.length) {
      const p = pick(themed, rng);
      return { id:p.id, name:p.name, desc:p.desc };
    }
  }
  const p = pick(pool, rng);
  return { id:p.id, name:p.name, desc:p.desc };
}

/**
 * Quest-only legendary. Solid stats (epic-like affix count) + one perk.
 * Slightly fewer raw affixes than a pure stat-stick so the perk is the prize.
 */
export function rollLegendary(ilvl, rng=Math.random, opts={}){
  const slot = opts.forceSlot || pick(BASE_SLOTS, rng);
  const base = pick(BASES[slot], rng);
  const affixKeys = rollAffixKeys(RARITIES.legendary.affixes, Object.keys(base.prim||{}), rng);
  const perk = opts.perk || rollPerk(slot, opts.theme, rng);
  const item = makeItemRecord(slot, base, 'legendary', Math.max(1, ilvl|0), affixKeys, perk, rng);
  // Legendary metals lean flashy
  if(!base.visualColor && (slot === 'weapon' || slot === 'shield' || slot === 'helm' || slot === 'armor')){
    item.visualColor = pick(['#e8c25a','#8fd4e8','#252025','#c8d4db','#b06cf0'], rng);
  }
  return item;
}

/** Create a tier-0 starter item by base name */
export function makeStarterItem(slot, baseName) {
  const base = BASES[slot].find(b => b.name === baseName);
  if (!base) return null;
  const item = {
    id: 'i'+(_uid++),
    baseKey: base.name,
    name: base.name,
    slot,
    icon: base.icon,
    rarity: 'common',
    color: RARITIES.common.color,
    ilvl: 1,
    floor: 0,
    affixKeys: [],
    perk: null,
    bonuses: {},
    prof: base.prof || 'none',
    value: 0,
    starter: true, // intentionally zero-bonus tutorial gear
    visualTorso: base.visualTorso,
    visualLegs: base.visualLegs,
    visualWeapon: base.visualWeapon,
    visualHelm: base.visualHelm,
    visualShield: base.visualShield,
    visualColor: base.visualColor || null,
    visualVisor: null,
    visualShoulders: base.visualShoulders || null,
    visualShoes: base.visualShoes || null,
    visualGloves: base.visualGloves || null
  };
  /* propagate D&D 5e weapon gameplay properties from base -> item */
  if(base.weaponType) item.weaponType = base.weaponType;
  if(base.twoHanded) item.twoHanded = true;
  if(base.range != null) item.range = base.range;
  if(base.finesse) item.finesse = true;
  if(base.light) item.light = true;
  if(base.heavy) item.heavy = true;
  if(base.reach) item.reach = true;
  if(base.thrown) item.thrown = true;
  if(base.versatile) item.versatile = true;
  if(base.loading) item.loading = true;
  if(base.armorBase) item.armorBase = base.armorBase;
  return item;
}

/** Loot roll for a chest: 1—3 items, scaled to floor.
 *  Each item has a 50% chance to roll one tier higher than the floor normally allows. */
export function rollChestLoot(floor, rng=Math.random){
  const n = 1 + (rng()<0.5?0:1) + (rng()<0.22?1:0);
  const items = [];
  for(let i=0;i<n;i++){
    const boosted = rng() < 0.5;
    const tier = boosted ? Math.min(maxRarityIdx(floor) + 1, 3) : undefined;
    items.push(rollItem(floor, rng, undefined, tier !== undefined ? { maxRarityIdx: tier } : {}));
  }
  return items;
}

/** Human-readable one-line summary of an item's bonuses. */
export function bonusText(item, heroLevel=null){
  const order = ['ac','atk','dmg','hp','crit','heal','str','dex','con','int','wis','cha','speed'];
  const label = { ac:'AC', atk:'Hit', dmg:'Dmg', hp:'HP', crit:'Crit', heal:'Heal',
                  str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA', speed:'Speed' };

  let bonuses = item.bonuses || {};
  if(heroLevel && item.rarity === 'legendary'){
    const eff = effectiveIlvl(item, heroLevel);
    if(eff !== item.ilvl) bonuses = previewBonuses(item, eff);
  }

  const parts = [];
  for(const k of order){
    const v = bonuses[k];
    if(!v) continue;
    if(k==='speed') parts.push(`+${Math.round(v*100)}% Speed`);
    else if(k==='crit') parts.push(`+${v} Crit range`);
    else parts.push(`+${v} ${label[k]}`);
  }
  /* Body armor advertises the AC base it sets (not an additive bonus). */
  if(item.armorBase) parts.unshift(`AC ${item.armorBase} (${item.prof})`);
  return parts.join(' — ');
}

/** Perk line for tooltips / detail panels. */
export function perkText(item){
  if(!item?.perk) return '';
  const p = item.perk;
  const def = PERKS[p.id];
  const name = p.name || def?.name || p.id;
  const desc = p.desc || def?.desc || '';
  return `★ ${name} — ${desc}`;
}

/** Aggregate a hero's equipped items into a single bonuses object.
 *  Legendaries use effective ilvl (bonded to hero level). */
export function aggregateEquipment(equipment, heroLevel=null){
  const total = {};
  for(const slot in equipment){
    const it = equipment[slot];
    if(!it) continue;
    migrateItem(it);
    let bonuses = it.bonuses || {};
    if(heroLevel && it.rarity === 'legendary'){
      const eff = effectiveIlvl(it, heroLevel);
      if(eff !== (it.ilvl|0)) bonuses = previewBonuses(it, eff);
    }
    for(const k in bonuses) total[k] = (total[k]||0) + bonuses[k];
  }
  return total;
}

/** Retrieve base item stats as a bonusText-style string */
export function getBaseStatsText(slot, name) {
  const base = BASES[slot]?.find(b => name.endsWith(b.name) || name.includes(b.name));
  if (base && base.prim && Object.keys(base.prim).length > 0) {
    return bonusText({ bonuses: base.prim });
  }
  return '';
}

/* ─── Migration / attunement ──────────────────────────────────────────── */

function findBaseFromName(slot, name){
  const list = BASES[slot];
  if(!list || !name) return null;
  let best = null;
  for(const b of list){
    if(name.includes(b.name) && (!best || b.name.length > best.name.length)) best = b;
  }
  return best;
}

function extractAffixKeysFromName(name){
  const keys = [];
  for(const aff of AFFIXES){
    if(name && name.includes(aff.label)) keys.push(aff.key);
  }
  return keys;
}

/** Ensure legacy save items have baseKey / ilvl / affixKeys. Safe to call repeatedly. */
export function migrateItem(it){
  if(!it || it._migrated) return it;

  if(!it.baseKey){
    const base = findBaseFromName(it.slot, it.name);
    it.baseKey = base?.name || it.name || 'Unknown';
    if(base && !it.icon) it.icon = base.icon;
  }
  /* Re-sync icon path from the base definition — repairs outdated/broken paths */
  {
    const base = getBase(it.slot, it.baseKey);
    if (base && base.icon && it.icon !== base.icon) it.icon = base.icon;
  }
  /* backfill D&D 5e weaponType + gameplay properties for legacy items */
  {
    const base = getBase(it.slot, it.baseKey);
    if (base) {
      if (it.slot === 'weapon' && it.weaponType === undefined && base.weaponType) it.weaponType = base.weaponType;
      if (it.twoHanded === undefined && base.twoHanded) it.twoHanded = true;
      if (it.range === undefined && base.range != null) it.range = base.range;
    }
  }
  if(it.ilvl == null) it.ilvl = Math.max(1, it.floor|0) || 1;
  if(!Array.isArray(it.affixKeys)){
    it.affixKeys = extractAffixKeysFromName(it.name || '');
  }
  if(it.perk && typeof it.perk === 'string'){
    const def = PERKS[it.perk];
    it.perk = def ? { id:def.id, name:def.name, desc:def.desc } : null;
  }
  if(it.rarity === 'legendary' && !it.perk){
    // Legacy legendary without perk — grant a default so it stays special
    it.perk = rollPerk(it.slot, null, Math.random);
  }
  /* Detect pre-ilvl starter gear: common, no value, floor 0, empty bonuses */
  if(it.starter || (it.rarity === 'common' && (it.floor === 0 || it.floor == null) && (it.value === 0 || it.value == null)
      && !(it.affixKeys||[]).length && it.bonuses && Object.keys(it.bonuses).length === 0)){
    it.starter = true;
    it.bonuses = {};
    it.value = 0;
    it.name = it.baseKey || it.name;
    it._migrated = true;
    return it;
  }
  // Recompute if we have a known base (keeps power curve consistent)
  if(getBase(it.slot, it.baseKey)){
    recomputeItemBonuses(it);
  } else if(!it.bonuses){
    it.bonuses = {};
  }
  it._migrated = true;
  return it;
}

export function migrateInventory(list){
  if(!Array.isArray(list)) return;
  for(const it of list) migrateItem(it);
}

/**
 * Bond / attune equipped gear after a hero levels up.
 * - Legendary: ilvl snaps to hero level (grows forever)
 * - Rare / Epic: +1 ilvl per level-up, capped at hero level
 * - Uncommon: +1 ilvl every other level (half rate), cap hero level
 * - Common: no attunement
 * Returns true if any item changed.
 */
export function attuneHeroGear(hero, logFn=null){
  if(!hero?.equipment) return false;
  let changed = false;
  const lvl = hero.level|0;

  for(const slot of Object.keys(hero.equipment)){
    const it = hero.equipment[slot];
    if(!it) continue;
    migrateItem(it);
    if(it.starter) continue; // tutorial gear never attunes — replace it
    const before = it.ilvl|0;
    let next = before;

    if(it.rarity === 'legendary'){
      next = Math.max(before, lvl);
    } else if(it.rarity === 'epic' || it.rarity === 'rare'){
      if(before < lvl) next = Math.min(before + 1, lvl);
    } else if(it.rarity === 'uncommon'){
      if(before < lvl && (lvl % 2 === 0)) next = Math.min(before + 1, lvl);
    }

    if(next !== before){
      it.ilvl = next;
      it.floor = next;
      recomputeItemBonuses(it);
      changed = true;
      if(logFn){
        const verb = it.rarity === 'legendary' ? 'bonds to' : 'attunes to';
        logFn(`  ↳ ${it.name} ${verb} ilvl ${next}`, 'level');
      }
    }
  }
  return changed;
}

/** When equipping a legendary, immediately bond it to the hero's level. */
export function bondLegendaryOnEquip(item, heroLevel){
  if(!item || item.rarity !== 'legendary') return item;
  migrateItem(item);
  const eff = Math.max(item.ilvl|0, heroLevel|0);
  if(eff !== (item.ilvl|0)){
    item.ilvl = eff;
    item.floor = eff;
    recomputeItemBonuses(item);
  }
  return item;
}

/** Collect equipped items that have a perk with a given combat hook. */
export function equippedPerks(hero, hook=null){
  const out = [];
  if(!hero?.equipment) return out;
  for(const slot of Object.keys(hero.equipment)){
    const it = hero.equipment[slot];
    if(!it?.perk) continue;
    migrateItem(it);
    const def = PERKS[it.perk.id];
    if(!def) continue;
    if(hook && !(def.hooks||[]).includes(hook) && !(it.perk.hooks||[]).includes(hook)) continue;
    out.push({ item: it, perk: def, slot });
  }
  return out;
}

/** ilvl label for UI */
export function ilvlText(item, heroLevel=null){
  if(!item) return '';
  const base = Math.max(1, item.ilvl|0);
  if(item.rarity === 'legendary' && heroLevel && heroLevel > base){
    return `ilvl ${base} → ${heroLevel}`;
  }
  if(item.rarity === 'legendary') return `ilvl ${base} · bonds to wearer`;
  return `ilvl ${base}`;
}
