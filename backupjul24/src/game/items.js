/**
 * Item & loot system. Items are plain data carrying a `bonuses` object so the
 * rules layer (srd.js) can aggregate equipment without importing this module
 * cyclically for generation (dependency is one-way for pure helpers).
 *
 * Item shape:
 *   baseKey, slot, rarity, ilvl, affixes[{key,n}], perk?, bonuses{}, visuals...
 *
 * bonuses shape (all optional, additive, FLAT keys so aggregateEquipment's
 * generic numeric summing keeps working):
 *   str dex con int wis cha  — ability score bonuses
 *   ac atk dmg hp            — combat bonuses
 *   crit                     — lowers crit threshold (1 => crit on 19-20)
 *   heal                     — added to Cure Wounds / healing
 *   speed                    — exploration movement multiplier (0.1 = +10%)
 *   move                     — combat movement, in feet
 *   saveStr…saveCha          — per-ability saving throw bonuses
 *   elemFire…elemPsychic     — flat bonus damage of a type
 *   slot1…slot9              — extra leveled spell slots
 *   skills{}                 — nested per-skill map (kit gear only)
 *
 * ─── POWER MODEL ────────────────────────────────────────────────────────
 * Every bonus has a POINT COST and every item has a POINT BUDGET, both defined
 * in loot_budget.json and computed by budget.js. Generation spends the budget;
 * it does not scale numbers by rarity tier. Consequences worth knowing:
 *
 *   - The BASE ITEM is charged against the budget, so an expensive base simply
 *     cannot fit in a low-ilvl budget. That is why there is no minimum-floor
 *     table any more — the old hand-maintained one has been deleted.
 *   - Rarity is a DROP CHANCE plus a budget multiplier and an affix-line count.
 *     It is not a gate: every rarity is rollable at every depth.
 *   - ilvl comes from the QUEST TIER and the loot source, never from the floor
 *     the party is standing on.
 *   - Gear does NOT attune. Every item's stats are frozen at the ilvl it was
 *     found at, so a drop is always compared against a fixed baseline.
 *
 * Legendaries carry one combat perk and are the only rarity that can. The perk
 * is BUDGET-EXEMPT — its power comes from the found-ilvl band (perkBand) — so a
 * low-ilvl legendary can still afford its own defining feature.
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
  { key:'boots',  label:'Boots',   icon:'🥾' },
  { key:'kit1',   label:'Kit',     icon:'🎒' },
  { key:'kit2',   label:'Kit',     icon:'🧰' }
];
export const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s.key,s.label]));
/* which equip-slot(s) an item's `slot` field can occupy */
export function slotsFor(itemSlot){
  if(itemSlot==='ring') return ['ring1','ring2'];
  if(itemSlot==='kit') return ['kit1','kit2'];
  if(itemSlot==='shield') return ['offhand'];
  return [itemSlot];
}

/* Bag category tabs derive from an item's logical `slot` field (not the equip
   key). Maps every value in BASES to one of the four bag tabs. */
export function itemCategory(it){
  if(!it) return 'other';
  switch(it.slot){
    case 'weapon': return 'weapon';
    case 'helm': case 'armor': case 'gloves': case 'boots': case 'shield': return 'armor';
    case 'amulet': case 'ring': return 'accessory';
    case 'dye': return 'other';
    default: return 'other'; /* kit + anything unforeseen */
  }
}

/* Skill display labels — mirrors SKILLS in srd.js, duplicated here to keep
   items.js free of a cyclic import back into the rules layer (see file header).
   Used to format kit skill bonuses in bonusText. */
export const SKILL_LABEL = {
  athletics:'Athletics', acrobatics:'Acrobatics', sleightOfHand:'Sleight of Hand',
  stealth:'Stealth', arcana:'Arcana', history:'History', investigation:'Investigation',
  nature:'Nature', religion:'Religion', animalHandling:'Animal Handling', insight:'Insight',
  medicine:'Medicine', perception:'Perception', survival:'Survival', deception:'Deception',
  intimidation:'Intimidation', performance:'Performance', persuasion:'Persuasion'
};

/* armor proficiency ranks */
export const PROF_RANK = { none:0, light:1, medium:2, heavy:3 };

/* D&D 5e weapon type ranks — simple (0) < martial (1) */
export const WEAPON_TYPE = { simple:'simple', martial:'martial' };
export const WEAPON_RANK = { simple:0, martial:1 };

/* rarities: weight is the base drop weight; mult scales gold value;
   affixes = how many secondary stat rolls it gets on top of the base.
   Legendary is quest-only and never appears in weighted random rolls. */
import ITEMS_DATA from './items.json' with { type: 'json' };
import {
  getTuning, bonusesCost, baseCost, itemBudget, affixBudget, baseAffordable,
  rarityWeight, rarityHasPerk, affixSlotsFor, sourceIlvl, bonusLabel, slotLevelOf,
  baseChassisCost,
} from './budget.js';

/* Re-exported so callers (and the loot editor) reach the pricing engine through
   the item layer rather than importing two modules. */
export {
  getTuning, setTuning, defaultTuning, bonusesCost, baseCost, itemBudget,
  affixBudget, bonusLabel, sourceIlvl, costGroups, unitCost,
} from './budget.js';

export const RARITIES = ITEMS_DATA.rarities;
export const RARITY_ORDER = ['common','uncommon','rare','epic','legendary'];
export const TIER = { common:0, uncommon:1, rare:2, epic:3, legendary:4 };

/* ─── Legendary perks ─────────────────────────────────────────────────── */
export const PERKS = ITEMS_DATA.perks;
const PERK_LIST = Object.values(PERKS);

/* ─── Perk power bands ────────────────────────────────────────────────────
   Legendary stats freeze at the ilvl the item was found at; the PERK is what
   scales — its magnitude comes from the found ilvl's band. Passive perks
   (keenEdge/bulwark/windwalker) skip this: their numbers already flow through
   recomputeItemBonuses as flat, unscaled stats. */
export function perkBand(ilvl){
  const l = Math.max(1, ilvl|0);
  return l >= 15 ? 3 : l >= 10 ? 2 : l >= 5 ? 1 : 0;
}
export const PERK_MAGS = ITEMS_DATA.perkMags;
/** Magnitude of a scaling perk at a given found-ilvl (null for passives). */
export function perkMag(id, ilvl){
  const arr = PERK_MAGS[id];
  return arr ? arr[perkBand(ilvl)] : null;
}
/** Perk description with the band's actual numbers baked in. */
export function perkDescFor(id, ilvl){
  const m = perkMag(id, ilvl);
  switch(id){
    case 'cleave':      return `On hit, deal ${Math.round(m*100)}% damage to a nearby foe.`;
    case 'lifesteal':   return `Heal for ${Math.round(m*100)}% of damage dealt on hit.`;
    case 'execute':     return `+${Math.round((m-1)*100)}% damage vs enemies below 30% HP.`;
    case 'burn':        return `Hits ignite the foe for ${m} fire damage per second.`;
    case 'firstStrike': return `Your opening blow each fight deals +${Math.round((m-1)*100)}% damage.`;
    case 'critSurge':   return `Critical hits deal +${m} bonus damage.`;
    case 'chain':       return `Ranged/magic hits have a ${Math.round(m*100)}% chance to arc to a second foe.`;
    case 'manaFont':    return `${Math.round(m*100)}% chance on hit to restore a spell slot.`;
    case 'riposte':     return `When hit in melee, retaliate for ${m} damage.`;
    case 'thorns':      return `Attackers take ${m} damage.`;
    case 'phaseStep':   return `On kill, briefly gain +${m} AC for 3 seconds.`;
    default:            return PERKS[id]?.desc || '';
  }
}

/** Theme-flavored perk weights for quest legendaries. */
export const THEME_PERK_BIAS = ITEMS_DATA.themePerkBias;

/* base item templates: primary bonus + slot + icon. `prof` on armor gates it
   behind class armor training. */
export const BASES = ITEMS_DATA.bases;
const BASE_SLOTS = Object.keys(BASES);
/* Slots eligible for the default (uniform) random slot pick. Kits are excluded
   here and rolled via a low-probability branch instead (see KIT_DROP_RATE),
   so random drops still favor combat gear. */
const BASE_SLOTS_NONKIT = BASE_SLOTS.filter(s => s !== 'kit');
/* Share of random loot that rolls an adventuring-gear kit (~5-10% target). */
const KIT_DROP_RATE = 0.07;

/** Look up a base template by slot + name. */
export function getBase(slot, baseKey){
  const list = BASES[slot];
  if(!list) return null;
  return list.find(b => b.name === baseKey) || null;
}

/* The old hand-maintained BASE_MIN_FLOOR table (120 entries) is GONE, and the
   `minFloors` key has been removed from items.json along with it. What a base
   can afford is now DERIVED: its cost is charged against the item budget, so a
   Claymore cannot fit at low ilvl without anything gating it explicitly.
   `budget.earliestIlvl()` reports the resulting unlock level for display. */

/**
 * Pick a base for `slot` that the budget can afford, biased toward bases that
 * USE most of it — otherwise an ilvl-20 roll would keep handing out Clubs, since
 * a cheap base is affordable at every level.
 */
function pickAffordableBase(slot, ilvl, rarity, rng){
  const list = BASES[slot];
  if(!list || !list.length) return null;
  const budget = itemBudget(slot, ilvl, rarity);
  const { baseMinShare } = getTuning().basePricing;

  const affordable = list.filter(b => baseAffordable(slot, ilvl, rarity, b));
  if(!affordable.length){
    /* Below every base's price: hand back the cheapest so a slot is never empty. */
    return list.reduce((lo, b) => baseCost(slot, b) < baseCost(slot, lo) ? b : lo, list[0]);
  }
  /* Prefer the meaty end of what's affordable; fall back to all of it early on
     when nothing yet clears the minimum share. */
  const meaty = affordable.filter(b => baseCost(slot, b) >= budget * baseMinShare);
  return pick(meaty.length ? meaty : affordable, rng);
}

/* secondary affixes pulled for higher rarities */
export const AFFIXES = ITEMS_DATA.affixes;
const AFFIX_BY_KEY = Object.fromEntries(AFFIXES.map(a => [a.key, a]));
const AFFIX_BY_LABEL = Object.fromEntries(AFFIXES.map(a => [a.label, a]));

let _uid = 1;
const pick = (arr, rng) => arr[Math.floor(rng()*arr.length)];

/* Which visors suit which helmet, keyed by `visualHelm`.
   Only the closed-helm family is listed: on soft hats and hoods the visor floats
   over a bare face, and on the open Roman/brimmed helms (legion, maximus,
   morion, kettle) it fights the cheek guards and brim already in the sprite.
   Helms absent from this map never roll a visor.
   `chance` is per-helm — a great helm reads as unfinished with an open face, a
   nasal helm is complete either way, so the closed family rolls one far more
   often. Visors tint from the helm slot, so they match the rolled metal. */
const HELM_VISORS = {
  'helmet/greathelm':   { chance: 0.75, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow', 'horned'] },
  'helmet/sugarloaf':   { chance: 0.75, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow', 'horned'] },
  'helmet/close':       { chance: 0.75, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow', 'pigface', 'pigface_raised', 'round', 'round_raised'] },
  'helmet/armet':       { chance: 0.60, visors: ['grated', 'grated_narrow', 'pigface', 'slit', 'round'] },
  'helmet/bascinet':    { chance: 0.60, visors: ['pigface', 'pigface_raised', 'grated', 'grated_narrow', 'slit', 'round', 'round_raised'] },
  'helmet/barbuta':     { chance: 0.60, visors: ['slit', 'slit_narrow', 'grated', 'grated_narrow', 'round', 'round_raised'] },
  'helmet/norman':      { chance: 0.35, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow'] },
  'helmet/nasal':       { chance: 0.35, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow'] },
  'helmet/spangenhelm': { chance: 0.35, visors: ['grated', 'grated_narrow', 'slit', 'slit_narrow'] }
};

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
  if (slot === 'ring' || slot === 'amulet' || slot === 'kit') return null;

  if (slot === 'weapon' || slot === 'shield' || slot === 'helm' || (slot === 'armor' && rng() < 0.4)) {
    return pick(METALS, rng);
  } else {
    return pick(CLOTHS, rng);
  }
}

/* NOTE ON `tier`: this is the QUEST TIER — the difficulty variable that also
   drives monster scaling — NOT the 1–10 floor index within a dungeon
   (`questFloor`). Quest tier ≈ party level. It selects the DROP ODDS; the item
   level comes from the tier plus the loot source's offset (budget.sourceIlvl),
   so the same quest drops the same quality of gear on floor 1 and floor 10. */

/**
 * Roll a rarity. There is NO CAP — every rarity is rollable at every tier, and
 * scarcity alone is what makes the top ones special (legendary sits near 0.05%).
 * The flat rarity budget multiplier is what makes removing the gate safe: an
 * early epic is a good find rather than a run-breaker.
 *
 * `luck` (optional) multiplies the non-common weights, letting a chest or a
 * hoard improve the mix without changing what's possible.
 */
function rollRarity(tier, rng, luck = 1){
  const w = RARITY_ORDER.map(r => {
    const base = rarityWeight(r, tier);
    return r === 'common' ? base : base * luck;
  });
  const total = w.reduce((s, x) => s + x, 0);
  if(total <= 0) return 'common';
  let r = rng() * total;
  for(let i = 0; i < w.length; i++){ r -= w[i]; if(r <= 0) return RARITY_ORDER[i]; }
  return 'common';
}

/**
 * Recompute `item.bonuses`, display name and gold value from base + affixes.
 *
 * This is now a pure SUM — the budget was already spent at generation time and
 * the chosen magnitudes are stored on the item. Nothing here scales with rarity
 * or ilvl, which is what makes an item's numbers stable for its whole life.
 */
export function recomputeItemBonuses(item){
  if(!item) return item;
  const base = getBase(item.slot, item.baseKey);
  const rarityKey = item.rarity || 'common';
  const R = RARITIES[rarityKey] || RARITIES.common;
  const ilvl = Math.max(0, item.ilvl|0);
  const G = getTuning().gold;

  /* Adventuring-gear tool: its whole budget buys skill ranks. */
  const toolSkills = base?.toolSkills || item.toolSkills;
  if(item.slot === 'kit' && toolSkills && toolSkills.length){
    const ranks = Math.max(1, Math.floor(itemBudget('kit', ilvl, rarityKey) / getTuning().costs.skill));
    const sb = {};
    if(toolSkills.length <= 1){
      sb[toolSkills[0]] = ranks;
    } else {
      /* Breadth vs depth: a dual-skill tool splits its ranks. */
      const per = Math.max(1, Math.floor(ranks / toolSkills.length));
      for(const sk of toolSkills) sb[sk] = per;
    }
    item.bonuses = { skills: sb };
    item.color = R.color;
    item.toolSkills = [...toolSkills];         // persist for saves
    item.name = item.uniqueName
      || ((R.name ? R.name + ' ' : '') + (base?.name || item.baseKey || 'Tool'));
    item.value = Math.round(G.flat + bonusesCost(item.bonuses) * G.perPoint);
    return item;
  }

  const bonuses = {};
  const add = (src, mult = 1) => {
    if(!src) return;
    for(const k in src) bonuses[k] = (bonuses[k] || 0) + src[k] * mult;
  };

  if(base) add(base.prim);
  else if(item._legacyPrim) add(item._legacyPrim);

  let suffix = '';
  for(const a of (item.affixes || [])){
    const aff = AFFIX_BY_KEY[a.key];
    if(!aff) continue;
    add(aff.b, Math.max(1, a.n | 0));
    if(!suffix) suffix = ' ' + aff.label;
  }

  /* Passive perk stats (Keen Edge, Bulwark, Windwalker) are flat and unscaled. */
  if(item.perk && item.perk.id && PERKS[item.perk.id]?.passive){
    add(PERKS[item.perk.id].passive);
  }

  /* speed is fractional; keep it from accumulating float noise */
  if(bonuses.speed) bonuses.speed = +bonuses.speed.toFixed(2);

  item.bonuses = bonuses;
  item.color = R.color;

  if(!item.uniqueName){
    const prefix = R.name ? R.name + ' ' : '';
    const baseName = base?.name || item.baseKey || 'Relic';
    item.name = prefix + baseName + suffix;
  } else {
    item.name = item.uniqueName;
  }

  /* Value derives from the item's real point cost, so the economy can't drift
     away from the power curve. */
  const points = baseChassisCost(item.slot, base) + bonusesCost(bonuses);
  item.value = Math.round(G.flat + points * G.perPoint + (item.perk ? G.perkBonus : 0));
  return item;
}

/** Total points of power an item carries, INCLUDING any perk. This is the
 *  "how good is it" number — used by tooltips, upgrade comparisons and pity. */
export function itemPoints(item){
  if(!item) return 0;
  return baseChassisCost(item.slot, getBase(item.slot, item.baseKey)) + bonusesCost(item.bonuses);
}

/**
 * Points the item actually SPENT from its budget: base + affixes only.
 *
 * Perks are budget-exempt by design, and the three PASSIVE perks (Bulwark, Keen
 * Edge, Windwalker) grant real stats rather than a proc — so a legendary
 * carrying one legitimately holds more power than its budget. `itemPoints`
 * counts that; this doesn't. Anything checking "did generation stay inside the
 * budget" must use this one.
 */
export function itemSpend(item){
  if(!item) return 0;
  const base = getBase(item.slot, item.baseKey);
  let spend = baseCost(item.slot, base);
  for(const a of (item.affixes || [])){
    const def = AFFIX_BY_KEY[a.key];
    if(def) spend += bonusesCost(def.b) * Math.max(1, a.n | 0);
  }
  return spend;
}

/** Preview bonuses without mutating the item. Stats are frozen, so this simply
 *  reports what the item already carries (signature kept for existing callers). */
export function previewBonuses(item, _ilvl){
  return item?.bonuses || {};
}

/** Effective ilvl for display. Gear never attunes — always the found ilvl. */
export function effectiveIlvl(item, _heroLevel){
  if(!item) return 0;
  return Math.max(0, item.ilvl|0);
}

function buildVisuals(slot, base, rarityKey, rng){
  const visualColor = base.visualColor || rollVisualColor(slot, rarityKey, rng);
  const visorSpec = slot === 'helm' ? HELM_VISORS[base.visualHelm] : null;
  const visualVisor = (visorSpec && rng() < visorSpec.chance)
    ? pick(visorSpec.visors, rng) : null;

  /* Sleeve cuts that read well layered over a robe. */
  const ROBE_SLEEVES = [
    'clothes/longsleeve/longsleeves',
    'clothes/longsleeve/longsleeves_cuffed',
    'clothes/longsleeve/laced',
    'clothes/longsleeve/scoop',
    'clothes/longsleeve/longsleeve2_cardigan'
  ];

  let visualShoulders = base.visualShoulders || null;
  let visualSleeves = null;
  let visualCape = base.visualCape || null;
  if (slot === 'armor') {
    if (base.name === 'Plate Armor') {
      visualShoulders = rng() < 0.8 ? pick(['pauldrons', 'bauldron', 'mantal'], rng) : null;
    } else if (base.name === 'Chain Shirt' && rng() < 0.5) {
      visualShoulders = 'epaulets';
    } else if (base.name === 'Robe' || base.name === 'Torn Robe') {
      // Robes are the plainest torso sheet in the set, so they lean hardest on
      // the extra layers to look like distinct pieces of gear.
      if (rng() < 0.6) visualSleeves = pick(ROBE_SLEEVES, rng);
      if (rng() < 0.35) visualShoulders = 'mantal';
      if (!visualCape && rng() < 0.35) {
        visualCape = base.name === 'Torn Robe' ? 'tattered' : pick(['solid', 'trim'], rng);
      }
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
    visualBracers: base.visualBracers || null,
    visualBelt: base.visualBelt || null,
    visualCape,
    visualCrystal,
    crystalColor,
    visualShoes: base.visualShoes || null,
    visualGloves: base.visualGloves || null,
    visualNeck: base.visualNeck || null
  };
}

/** Cost of one "step" of an affix (its `b` block applied once). */
function affixStepCost(aff){ return bonusesCost(aff.b); }

/** How many steps of an affix are allowed. Its own cap plus ilvl headroom —
 *  without the headroom, deep budgets have nothing left to buy and underspend. */
function affixMaxSteps(aff, ilvl){
  const per = getTuning().affixSlots._maxPerIlvl || 0;
  const extra = per > 0 ? Math.floor(Math.max(0, ilvl | 0) / per) : 0;
  return (aff.max || 3) + extra;
}

/**
 * Is this affix legal on this slot at this ilvl, for this base?
 *
 * A base may narrow the pool with `affixAllow` — an explicit whitelist of affix
 * keys, set per base in the loot editor. ABSENT means "no restriction", so every
 * existing base keeps rolling the full pool; an empty array is a real (if odd)
 * choice meaning "no affixes at all", not the same thing as absent. The
 * whitelist only ever subtracts — the affix's own `slots` / `minIlvl` rules
 * still apply on top.
 */
export function affixEligible(aff, slot, ilvl, base = null){
  if(aff.slots && !aff.slots.includes(slot)) return false;
  if(aff.minIlvl != null && ilvl < aff.minIlvl) return false;
  const allow = base && base.affixAllow;
  if(Array.isArray(allow) && !allow.includes(aff.key)) return false;
  const cost = affixStepCost(aff);
  return cost > 0;                              // unpriced affixes never roll
}

/**
 * Spend an affix budget: pick affix lines and magnitudes until the points run
 * out or the rarity's line limit is reached.
 *
 * Two passes on purpose. The first picks distinct lines with modest magnitudes
 * so items read as a spread of properties rather than one huge number; the
 * second tops existing lines up with whatever is left, so budgets are actually
 * consumed instead of quietly evaporating.
 */
function rollAffixes(slot, ilvl, rarity, base, rng){
  const { minAffixBudget } = getTuning().basePricing;
  let remaining = affixBudget(slot, ilvl, rarity, base);
  const maxLines = affixSlotsFor(rarity, ilvl);
  const used = new Set(Object.keys(base?.prim || {}));
  const out = [];

  const eligible = () => AFFIXES.filter(a =>
    !used.has(a.key) && affixEligible(a, slot, ilvl, base) && affixStepCost(a) <= remaining);

  while(out.length < maxLines && remaining >= minAffixBudget){
    const pool = eligible();
    if(!pool.length) break;
    const aff = pick(pool, rng);
    const step = affixStepCost(aff);
    /* Leave room for the lines still to come, so the first pick can't eat
       everything and leave a "rare" with a single affix. */
    const linesLeft = maxLines - out.length;
    const share = linesLeft > 1 ? remaining / linesLeft : remaining;
    const affordable = Math.max(1, Math.floor(share / step));
    const capped = Math.min(affixMaxSteps(aff, ilvl), affordable);
    const n = 1 + Math.floor(rng() * capped);
    out.push({ key: aff.key, n });
    used.add(aff.key);
    remaining -= n * step;
  }

  /* Top-up pass: pour leftovers into lines that still have headroom. */
  let guard = 40;
  while(remaining >= minAffixBudget && guard-- > 0){
    const room = out.filter(a => {
      const def = AFFIX_BY_KEY[a.key];
      return def && a.n < affixMaxSteps(def, ilvl) && affixStepCost(def) <= remaining;
    });
    if(!room.length) break;
    const a = pick(room, rng);
    a.n++;
    remaining -= affixStepCost(AFFIX_BY_KEY[a.key]);
  }
  return out;
}

function makeItemRecord(slot, base, rarityKey, ilvl, affixes, perk, rng){
  const R = RARITIES[rarityKey];
  const visuals = buildVisuals(slot, base, rarityKey, rng);
  const item = {
    id: 'i'+(_uid++),
    baseKey: base.name,
    slot,
    icon: base.icon,
    rarity: rarityKey,
    color: R.color,
    ilvl: Math.max(0, ilvl|0),
    floor: Math.max(0, ilvl|0), // legacy field kept for saves/UI
    affixes: affixes || [],
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
  if(base.acBase) item.acBase = base.acBase;
  /* weapon-derived attack profile fields (5e): damage dice, melee/ranged, damage type, focus */
  if(base.dmg) item.dmg = base.dmg.slice();
  if(base.melee != null) item.melee = base.melee;
  if(base.dmgType) item.dmgType = base.dmgType;
  if(base.focus) item.focus = true;
  recomputeItemBonuses(item);
  return item;
}

/**
 * Generate one random item for a quest `tier`.
 *
 * `tier` selects the DROP ODDS. The item level comes from `tier` plus the loot
 * source's offset (`opts.source`, default 'chest'), so what you find tracks the
 * quest you took rather than which floor you happen to be standing on.
 *
 * opts:
 *   source      'trash' | 'chest' | 'boss' | 'hoard' | 'quest'   (default 'chest')
 *   ilvl        explicit item level, bypassing the source offset
 *   luck        multiplier on non-common drop weights (chests, hoards)
 *   forceRarity skip the rarity roll entirely
 *   noLegendary re-roll legendaries down to epic (quest rewards handle their own)
 */
export function rollItem(tier, rng=Math.random, forceSlot=null, opts={}){
  const t = Math.max(0, tier|0);
  const ilvl = Math.max(0, (opts.ilvl != null ? opts.ilvl : sourceIlvl(opts.source || 'chest', t, rng))|0);
  // Kits are rare (~7%); the rest of random drops split evenly across combat gear.
  const slot = forceSlot || (rng() < KIT_DROP_RATE ? 'kit' : pick(BASE_SLOTS_NONKIT, rng));

  let rarityKey = opts.forceRarity || rollRarity(t, rng, opts.luck != null ? opts.luck : 1);
  if(rarityKey === 'legendary' && opts.noLegendary) rarityKey = 'epic';

  /* Adventuring-gear tool: no affixes, its whole budget buys skill ranks
     (see recomputeItemBonuses). */
  if(slot === 'kit'){
    const base = pick(BASES.kit, rng);
    return makeItemRecord('kit', base, rarityKey, ilvl, [], null, rng);
  }

  const base = pickAffordableBase(slot, ilvl, rarityKey, rng);
  if(!base) return null;
  const affixes = rollAffixes(slot, ilvl, rarityKey, base, rng);
  /* Only the top rarity carries a perk — that, not raw numbers, is what sets it
     apart now that the rarity budget multiplier is deliberately flat. */
  const perk = rarityHasPerk(rarityKey) ? rollPerk(slot, opts.theme, rng) : null;
  if(perk && PERK_MAGS[perk.id]) perk.desc = perkDescFor(perk.id, ilvl);
  return makeItemRecord(slot, base, rarityKey, ilvl, affixes, perk, rng);
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
 * A guaranteed legendary at a given ilvl (quest rewards, chain finales).
 * Random loot can also roll one — see rollRarity — but only at lottery odds.
 */
export function rollLegendary(ilvl, rng=Math.random, opts={}){
  // Legendaries are combat perks — never roll a kit slot.
  const slot = opts.forceSlot || pick(BASE_SLOTS_NONKIT, rng);
  const lvl = Math.max(0, ilvl|0);
  const base = pickAffordableBase(slot, lvl, 'legendary', rng);
  const affixes = rollAffixes(slot, lvl, 'legendary', base, rng);
  const perk = opts.perk || rollPerk(slot, opts.theme, rng);
  /* Bake the found-ilvl band's numbers into the perk text (stats freeze at
     this ilvl, so the desc stays true for the item's whole life). */
  if(perk && PERK_MAGS[perk.id]) perk.desc = perkDescFor(perk.id, lvl);
  const item = makeItemRecord(slot, base, 'legendary', lvl, affixes, perk, rng);
  // Legendary metals lean flashy
  if(!base.visualColor && (slot === 'weapon' || slot === 'shield' || slot === 'helm' || slot === 'armor')){
    item.visualColor = pick(['#e8c25a','#8fd4e8','#252025','#c8d4db','#b06cf0'], rng);
  }
  return item;
}

/** Create a tier-0 starter item by base name. Zero budget, zero bonuses — the
 *  point is that ANY level-1 drop is an upgrade on it (see STARTER_GEAR in srd.js
 *  for the bottom-of-ladder bases each class begins with). */
export function makeStarterItem(slot, baseName, look = null) {
  const base = BASES[slot].find(b => b.name === baseName);
  if (!base) return null;
  const L = look || {};
  const item = {
    id: 'i'+(_uid++),
    baseKey: base.name,
    name: L.name || base.name,
    starterName: L.name || null,
    slot,
    icon: base.icon,
    rarity: 'common',
    color: RARITIES.common.color,
    ilvl: 0,
    floor: 0,
    affixes: [],
    perk: null,
    bonuses: {},
    prof: base.prof || 'none',
    value: 0,
    starter: true, // intentionally zero-bonus tutorial gear
    visualTorso: L.torso || base.visualTorso,
    visualLegs: L.legs || base.visualLegs,
    /* `sleeves` was missing here for years, so any starter kit that wanted a
       sleeve layer silently lost it — see buildLayerPaths in sprite_animator. */
    visualSleeves: L.sleeves || base.visualSleeves || null,
    visualWeapon: base.visualWeapon,
    visualHelm: base.visualHelm,
    visualShield: base.visualShield,
    visualColor: L.color || base.visualColor || null,
    visualVisor: null,
    visualShoulders: L.shoulders || base.visualShoulders || null,
    visualBracers: L.bracers || base.visualBracers || null,
    visualBelt: L.belt || base.visualBelt || null,
    visualCape: L.cape || base.visualCape || null,
    visualShoes: L.shoes || base.visualShoes || null,
    visualGloves: base.visualGloves || null,
    visualNeck: base.visualNeck || null
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
  if(base.acBase) item.acBase = base.acBase;
  /* weapon-derived attack profile fields (5e): damage dice, melee/ranged, damage type, focus */
  if(base.dmg) item.dmg = base.dmg.slice();
  if(base.melee != null) item.melee = base.melee;
  if(base.dmgType) item.dmgType = base.dmgType;
  if(base.focus) item.focus = true;
  return item;
}

/* ─── Dyes ────────────────────────────────────────────────────────────────
   Cosmetic loot: applying a dye to an equipped, tintable piece of gear sets
   its visualColor (the sprite recolor path in sprite_animator.js already
   honors it). Hexes reuse the LPC METALS/CLOTHS palettes above. */
export const DYE_COLORS = {
  common: [
    { name:'Leather Brown',  hex:'#8d5524' },
    { name:'Forest Green',   hex:'#2e7d32' },
    { name:'Midnight Black', hex:'#212121' },
    { name:'Alabaster White',hex:'#f5f5f5' },
    { name:'Crimson',        hex:'#a32020' },
    { name:'Royal Blue',     hex:'#1565c0' }
  ],
  uncommon: [
    { name:'Copper',         hex:'#a26118' },
    { name:'Bronze',         hex:'#b54936' },
    { name:'Steel',          hex:'#726b7e' },
    { name:'Brass',          hex:'#b08a36' },
    { name:'Shadow Purple',  hex:'#6a1b9a' }
  ],
  rare: [
    { name:'Silver',         hex:'#c8d4db' },
    { name:'Gold',           hex:'#e8c25a' },
    { name:'Mithril',        hex:'#8fd4e8' },
    { name:'Obsidian',       hex:'#252025' }
  ]
};
const DYE_VALUE = { common: 40, uncommon: 90, rare: 200 };
/* rarity odds for a dropped dye */
const DYE_RARITY_WEIGHTS = [ ['common', 60], ['uncommon', 30], ['rare', 10] ];

export function makeDye(rng = Math.random, opts = {}){
  let rarity = opts.rarity;
  if(!rarity){
    let roll = rng() * DYE_RARITY_WEIGHTS.reduce((s, [,w]) => s + w, 0);
    for(const [r, w] of DYE_RARITY_WEIGHTS){ roll -= w; if(roll <= 0){ rarity = r; break; } }
    rarity = rarity || 'common';
  }
  const c = opts.color || pick(DYE_COLORS[rarity], rng);
  /* Plain record (not makeItemRecord): no base/bonuses/visuals. value>0 +
     empty bonuses/affixes keep migrateItem's starter heuristic off it. */
  return {
    id: 'i'+(_uid++),
    baseKey: 'Dye',
    slot: 'dye',
    icon: '🎨',
    name: `${c.name} Dye`,
    rarity,
    color: RARITIES[rarity].color,
    dyeColor: c.hex,
    ilvl: 1,
    floor: 1,
    value: DYE_VALUE[rarity] || 40,
    affixes: [],
    perk: null,
    prof: 'none',
    bonuses: {}
  };
}

const CHEST_DYE_CHANCE = 0.18;

/** Loot roll for a chest: 1—3 gear items (+ occasionally a dye) at the quest
 *  tier. Half the items roll with a luck bonus on the non-common weights, which
 *  improves the mix without changing what's reachable — there is no tier cap to
 *  respect any more. */
export function rollChestLoot(tier, rng=Math.random, questFloor=0){
  const n = 1 + (rng()<0.5?0:1) + (rng()<0.22?1:0);
  const items = [];
  for(let i=0;i<n;i++){
    const opts = { source: 'chest', questFloor };
    if(rng() < 0.5) opts.luck = 2.5;
    const it = rollItem(tier, rng, undefined, opts);
    if(it) items.push(it);
  }
  if(rng() < CHEST_DYE_CHANCE) items.push(makeDye(rng));
  return items;
}

/** Human-readable one-line summary of an item's bonuses. */
export function bonusText(item, heroLevel=null){
  /* Fixed order for the classic stats, then the newer families in a stable
     order so tooltips don't shuffle between renders. */
  const order = ['ac','atk','dmg','hp','crit','heal','str','dex','con','int','wis','cha','move','speed'];
  const bonuses = item.bonuses || {};
  const parts = [];
  const emit = k => {
    const v = bonuses[k];
    if(!v) return;
    if(k === 'speed') parts.push(`+${Math.round(v*100)}% Speed`);
    else if(k === 'crit') parts.push(`+${v} Crit range`);
    else if(k === 'move') parts.push(`+${v} ft Move`);
    else if(slotLevelOf(k)) parts.push(`+${v} ${bonusLabel(k)}`);
    else parts.push(`+${v} ${bonusLabel(k)}`);
  };
  for(const k of order) emit(k);
  /* Saves, elemental damage and spell slots, in whatever order they exist. */
  for(const k in bonuses){
    if(order.includes(k) || k === 'skills') continue;
    emit(k);
  }
  /* Kit gear: per-skill check bonuses. */
  if(bonuses.skills){
    for(const sk in bonuses.skills){
      const v = bonuses.skills[sk];
      if(v) parts.push(`+${v} ${SKILL_LABEL[sk] || sk}`);
    }
  }
  /* Body armor advertises the AC base it sets (not an additive bonus). */
  if(item.armorBase) parts.unshift(`AC ${item.armorBase} (${item.prof})`);
  /* Shields/helms: chassis AC is a property of the item, not a stat bonus, so
     it isn't in `bonuses` and has to be printed explicitly. */
  else if(item.acBase) parts.unshift(`+${item.acBase} AC`);
  /* Weapons show their D&D 5e damage die + type up front. */
  if(item.slot === 'weapon' && item.dmg){
    const tags = [];
    if(item.finesse) tags.push('finesse');
    if(item.light) tags.push('light');
    if(item.thrown) tags.push('thrown');
    if(item.twoHanded) tags.push('two-handed');
    if(item.heavy) tags.push('heavy');
    if(item.reach) tags.push('reach');
    if(item.versatile) tags.push('versatile');
    if(item.loading) tags.push('loading');
    if(item.focus) tags.push('focus');
    const tag = tags.length ? ` (${tags.join(', ')})` : '';
    parts.unshift(`${item.dmg[0]}d${item.dmg[1]} ${item.dmgType || ''}${tag}`.trim());
  }
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

/** Aggregate a hero's equipped items into a single bonuses object. */
export function aggregateEquipment(equipment, heroLevel=null){
  const total = {};
  for(const slot in equipment){
    const it = equipment[slot];
    if(!it) continue;
    migrateItem(it);
    const bonuses = it.bonuses || {};
    for(const k in bonuses){
      if(k === 'skills'){
        /* merge the nested per-skill kit map instead of numeric-adding */
        total.skills = total.skills || {};
        for(const sk in bonuses.skills) total.skills[sk] = (total.skills[sk]||0) + bonuses.skills[sk];
        continue;
      }
      total[k] = (total[k]||0) + bonuses[k];
    }
  }
  return total;
}

/** Retrieve base item stats as a bonusText-style string */
export function getBaseStatsText(slot, name) {
  const base = BASES[slot]?.find(b => name.endsWith(b.name) || name.includes(b.name));
  if (!base) return '';
  /* Bases carry no stat bonuses any more — only chassis. Report that instead of
     the (now always empty) `prim` block. */
  return bonusText({ bonuses: {}, slot, dmg: base.dmg, dmgType: base.dmgType,
                     armorBase: base.armorBase, acBase: base.acBase, prof: base.prof });
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

/** Ensure legacy save items have baseKey / ilvl / affixes. Safe to call repeatedly. */
export function migrateItem(it){
  if(!it) return it;
  /* amulets predating the neck sprite layer: backfill the visual even on
     saves that were already migrated (the flag persists into save files) */
  if (it.slot === 'amulet' && it.visualNeck === undefined) {
    const b = getBase(it.slot, it.baseKey || it.name || '');
    if (b && b.visualNeck) it.visualNeck = b.visualNeck;
  }
  if(it._migrated) return it;

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
      if (it.finesse === undefined && base.finesse) it.finesse = true;
      if (it.light === undefined && base.light) it.light = true;
      if (it.heavy === undefined && base.heavy) it.heavy = true;
      if (it.reach === undefined && base.reach) it.reach = true;
      if (it.thrown === undefined && base.thrown) it.thrown = true;
      if (it.versatile === undefined && base.versatile) it.versatile = true;
      if (it.loading === undefined && base.loading) it.loading = true;
      if (it.armorBase === undefined && base.armorBase) it.armorBase = base.armorBase;
      /* Shields/helms predating the chassis-AC split carried their AC in the
         base's `prim` block, which flowed into `bonuses`. Bases now hold no stat
         bonuses at all, so their protection lives in `acBase` and is read
         directly by recalc — backfill it or an old shield grants nothing. */
      if (it.acBase === undefined && base.acBase) it.acBase = base.acBase;
      /* weapon-derived attack profile fields (5e): dice, melee/ranged, damage type, focus */
      if (it.slot === 'weapon') {
        if (it.dmg === undefined && base.dmg) it.dmg = base.dmg.slice();
        if (it.melee === undefined && base.melee != null) it.melee = base.melee;
        if (it.dmgType === undefined && base.dmgType) it.dmgType = base.dmgType;
        if (it.focus === undefined && base.focus) it.focus = true;
      }
      /* amulets predating the neck sprite layer get their visual backfilled */
      if (it.slot === 'amulet' && it.visualNeck === undefined && base.visualNeck) it.visualNeck = base.visualNeck;
    }
  }
  if(it.ilvl == null) it.ilvl = Math.max(0, it.floor|0);
  /* Budget-rework migration: items used to store bare `affixKeys` and derive
     magnitudes by rarity/ilvl scaling. They now store explicit magnitudes.
     Convert one step per old key and let the budget re-fill the rest below. */
  if(!Array.isArray(it.affixes)){
    const keys = Array.isArray(it.affixKeys) ? it.affixKeys : extractAffixKeysFromName(it.name || '');
    it.affixes = keys.filter(k => AFFIX_BY_KEY[k]).map(k => ({ key: k, n: 1 }));
    delete it.affixKeys;
  }
  if(it.perk && typeof it.perk === 'string'){
    const def = PERKS[it.perk];
    it.perk = def ? { id:def.id, name:def.name, desc:def.desc } : null;
  }
  if(it.rarity === 'legendary' && !it.perk && it.slot !== 'kit'){
    // Legacy legendary without perk — grant a default so it stays special.
    // Tools (kit slot) are tier-5 "legendary" for color only — never perked.
    it.perk = rollPerk(it.slot, null, Math.random);
    if(PERK_MAGS[it.perk.id]) it.perk.desc = perkDescFor(it.perk.id, it.ilvl || 1);
  }
  /* Detect pre-ilvl starter gear: common, no value, floor 0, empty bonuses */
  if(it.starter || (it.rarity === 'common' && (it.floor === 0 || it.floor == null) && (it.value === 0 || it.value == null)
      && !(it.affixes||[]).length && it.bonuses && Object.keys(it.bonuses).length === 0)){
    it.starter = true;
    it.bonuses = {};
    it.value = 0;
    /* Starters get their name forced back to the base to strip affix-derived
       names off legacy items. `starterName` opts out: it is the class-kit name
       chosen in STARTER_GEAR, not something an affix invented. */
    it.name = it.starterName || it.baseKey || it.name;
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

/* ATTUNEMENT IS GONE. Gear used to walk its ilvl up as the hero levelled, which
   meant equipment quietly kept pace whether or not you found anything — so a
   drop could never feel like a find. Every item's stats are now frozen at the
   ilvl it was found at, and upgrades come only from loot. Kept as a no-op so
   any straggling caller stays harmless. */
export function attuneHeroGear(){ return false; }

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
  if(item.rarity === 'legendary') return `ilvl ${base} · fixed at find`;
  return `ilvl ${base}`;
}
