/**
 * Loot budget & pricing engine — the single source of truth for what a gear
 * bonus is WORTH and how much power an item is allowed to carry.
 *
 * Every number lives in loot_budget.json; nothing is hardcoded here. The loot
 * editor imports this same module and calls `setTuning()` to preview changes
 * live, so the editor can never drift from the game.
 *
 * THE MODEL
 *   budget(slot, ilvl, rarity) = (intercept + perIlvl*ilvl) * slotWeight * rarityMult
 *   affixBudget = budget - baseCost(base)
 *
 * The base item being charged against the budget is what removes the need for a
 * hand-maintained minimum-floor table: a Claymore simply does not fit inside a
 * low-ilvl budget, so it cannot drop there. Nothing gates it explicitly.
 *
 * SCALE. Two anchors are fixed by design decree — +1 attack = 10 points and
 * +1 AC = 20 — and everything else was measured against them by the valuation
 * harness (`node sim/value.mjs`). See sim/README.md for the method, and for the
 * bonuses it structurally cannot measure (they carry analytical estimates).
 *
 * This module is pure data + arithmetic: no RNG, no item mutation. Generation
 * lives in items.js.
 */
import DEFAULT_TUNING from './loot_budget.json' with { type: 'json' };

/* Live tuning. Cloned so the editor's overrides can never mutate the import. */
let T = structuredClone(DEFAULT_TUNING);

/** Replace the live tuning (loot editor preview / imported drafts). */
export function setTuning(next) {
  T = structuredClone(next || DEFAULT_TUNING);
  return T;
}
/** Current live tuning (the editor renders its knobs from this). */
export function getTuning() { return T; }
/** Pristine on-disk tuning — the editor's "reset to defaults". */
export function defaultTuning() { return structuredClone(DEFAULT_TUNING); }

/* ─── Bonus key taxonomy ────────────────────────────────────────────────
   Bonus keys are kept FLAT (saveDex, elemFire, slot3) rather than nested, so
   aggregateEquipment's generic numeric summing keeps working untouched. */

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const SAVE_KEYS = ABILITY_KEYS.map(a => 'save' + a[0].toUpperCase() + a.slice(1));
export const ELEM_TYPES = ['fire', 'cold', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'psychic'];
export const ELEM_KEYS = ELEM_TYPES.map(t => 'elem' + t[0].toUpperCase() + t.slice(1));
export const SLOT_SPELL_KEYS = Array.from({ length: 9 }, (_, i) => 'slot' + (i + 1));

/* Warding: flat damage reduction against one elemental type (wardFire…). */
export const WARD_KEYS = ELEM_TYPES.map(t => 'ward' + t[0].toUpperCase() + t.slice(1));

/* Bane: flat bonus damage against one creature type (baneUndead…). The types
   are the monsters.json `type` values; "swarm of tiny beasts" counts as beast. */
export const BANE_TYPES = ['beast', 'humanoid', 'undead', 'fiend', 'monstrosity', 'fey',
  'elemental', 'giant', 'ooze', 'construct', 'dragon', 'aberration', 'celestial', 'plant'];
export const BANE_KEYS = BANE_TYPES.map(t => 'bane' + t[0].toUpperCase() + t.slice(1));

/* Steadfast: +N to saving throws against a GROUP of conditions. Grouped so
   the affix pool isn't twenty near-identical lines. */
export const STEADFAST_GROUPS = {
  steadMind: { label: 'Mind', conditions: ['frightened', 'charmed', 'dominated', 'mocked'] },
  steadBody: { label: 'Body', conditions: ['poisoned', 'stunned', 'incapacitated', 'drained'] },
  steadMove: { label: 'Movement', conditions: ['paralyzed', 'restrained', 'slowed', 'rooted', 'prone'] },
};
export const STEADFAST_KEYS = Object.keys(STEADFAST_GROUPS);

/* Bonus keys whose value is a PERCENT, so tooltips print "+5% Magic Find". */
export const PCT_KEYS = ['magicFind', 'goldFind', 'potionHeal'];

/** Damage type behind a `wardFire`-style key, or null. */
export function wardTypeOf(key) {
  if (!key.startsWith('ward')) return null;
  const t = key.slice(4).toLowerCase();
  return ELEM_TYPES.includes(t) ? t : null;
}
/** Creature type behind a `baneUndead`-style key, or null. */
export function baneTypeOf(key) {
  if (!key.startsWith('bane')) return null;
  const t = key.slice(4).toLowerCase();
  return BANE_TYPES.includes(t) ? t : null;
}

/** Damage type behind an `elemFire`-style key, or null. */
export function elemTypeOf(key) {
  if (!key.startsWith('elem')) return null;
  const t = key.slice(4);
  return t.charAt(0).toLowerCase() + t.slice(1);
}
/** Spell level behind a `slot3`-style key, or null. */
export function slotLevelOf(key) {
  const m = /^slot([1-9])$/.exec(key);
  return m ? +m[1] : null;
}
/** Ability behind a `saveDex`-style key, or null. */
export function saveAbilityOf(key) {
  if (!key.startsWith('save')) return null;
  const a = key.slice(4).toLowerCase();
  return ABILITY_KEYS.includes(a) ? a : null;
}

/* ─── Cost of a single bonus ────────────────────────────────────────────── */

/**
 * Points per 1 unit of `key`. Returns 0 for keys with no price.
 * Always a whole number — the budget system spends integers, and a fraction of
 * a point is far inside the valuation harness's measurement error anyway.
 */
export function unitCost(key) {
  return Math.round(rawUnitCost(key));
}

/* Unrounded per-unit cost. Percent keys (Magic Find, potion healing) are
   priced below a point per percent, so bonusCost rounds the TOTAL for those
   rather than each unit — otherwise they would all price at zero. */
function rawUnitCost(key) {
  const c = T.costs;
  if (key in c && typeof c[key] === 'number') return c[key];
  if (wardTypeOf(key)) return c.ward || 0;
  if (baneTypeOf(key)) return c.bane || 0;
  if (STEADFAST_GROUPS[key]) return c.steadfast || 0;
  return unitCostDerived(key);
}

function unitCostDerived(key) {
  const c = T.costs;

  const lvl = slotLevelOf(key);
  if (lvl != null) return Math.round(c.spellSlotBase + lvl * c.spellSlotPerLevel);

  const elem = elemTypeOf(key);
  if (elem) return Math.round(c.elem * (T.elemTypeMult[elem] ?? 1));

  if (saveAbilityOf(key)) return Math.round(c.save);

  return 0;
}

/** Points for `value` units of `key`. */
export function bonusCost(key, value) {
  if (!value) return 0;
  const raw = rawUnitCost(key);
  /* Whole-number unit costs keep the old exact arithmetic; only fractional
     direct costs (percent keys) round the total. */
  return Number.isInteger(raw) ? raw * value : Math.round(raw * value);
}

/**
 * Total points in a bonuses object. Handles the nested `skills` map (kit gear)
 * alongside the flat numeric keys.
 */
export function bonusesCost(bonuses) {
  if (!bonuses) return 0;
  let total = 0;
  for (const k in bonuses) {
    if (k === 'skills') {
      for (const s in bonuses.skills) total += T.costs.skill * bonuses.skills[s];
      continue;
    }
    total += bonusCost(k, bonuses[k]);
  }
  return Math.round(total);
}

/* ─── Cost of a base item ───────────────────────────────────────────────── */

/** Average roll of an `[n, sides]` dice pair. */
function diceAvg(d) { return d ? d[0] * (d[1] + 1) / 2 : 0; }

/**
 * What a base template costs out of an item's budget: its damage dice above the
 * free reference die, its armor class above unarmored, and its `prim` block.
 *
 * Two-handed weapons get a discount because they consume the off-hand slot;
 * body armor is priced from its authored tier rather than its AC, so the three
 * weight classes can share unlock levels despite different AC numbers.
 */
/**
 * Cost of a base's CHASSIS only — its damage dice and armor class, but NOT its
 * `prim` bonus block.
 *
 * The split matters: `recomputeItemBonuses` folds `prim` into the item's
 * `bonuses`, so anything adding chassis + bonuses (item value, audits, the
 * editor's spend readout) must use this and not `baseCost`, or it counts `prim`
 * twice.
 */
export function baseChassisCost(slot, base) {
  if (!base) return 0;
  const bp = T.basePricing;
  let cost = 0;

  /* Weapon damage dice, priced against the free reference die. */
  if (base.dmg) {
    const above = diceAvg(base.dmg) - diceAvg([1, bp.damageDieRef]);
    if (above > 0) cost += above * T.costs.dmg;
    /* Versatile: the two-handed grip steps the die up one size (srd.js
       versatileDie), but only with an EMPTY off-hand — the wielder pays for it
       by giving up a shield. So it is charged a share of the step, not all of
       it. Two-handed bases never get the step, so they are never charged. */
    if (base.versatile && !base.twoHanded) {
      const sides = base.dmg[1] || 4;
      const step = base.dmg[0] * (Math.min(12, sides + 2) - sides) / 2;
      cost += step * T.costs.dmg * (bp.versatileShare ?? 0.5);
    }
    if (base.melee === false) cost *= bp.rangedMult;
    if (base.twoHanded) cost *= bp.twoHandedDiscount;
  }

  /* Armor and helms are priced from their authored `tier`, NOT from their AC.

     Every other base derives its cost from what it does, but these cannot: the
     weight classes are meant to share unlock levels while their AC numbers
     differ (armor light 11 / medium 13 / heavy 14 all unlock together), and a
     class's AC steps are not uniform — heavy climbs 14,16,17,18,20. No constant
     per-class offset can line those rows up, so alignment has to be authored.
     A base's `tier` says which rung it sits on; `tierIlvl[slot]` says which item
     level that rung unlocks at.

     The maths is slot-agnostic — cost and budget both carry `slotWeight`, so a
     helm tier lands on its ilvl exactly as an armor tier does. Any slot listed
     in `tierIlvl` gets this treatment; slots absent from it (shields) keep
     pricing off `acBase` below. Helms are deliberately NOT tiered: their
     AC is priced like an AC affix (+1 AC = costs.ac), so a +2 AC helm costs
     exactly what +2 AC from an affix would.

     The charge is the whole base-share of that level's budget, which is exactly
     what makes the base land there: `baseAffordable` allows up to
     `baseMaxShare` of the budget, so pricing at the floor of that share is the
     largest cost still affordable at the target level and nowhere earlier.
     Retune pacing via `tierIlvl`; move a base between rungs via its `tier` in
     items.json. Both are self-consistent — there is no solver to run and no
     narrow band to miss, which is the point of authoring it.

     Note the deliberate consequence: a top-tier piece eats ~90% of its budget
     at its unlock level, so it arrives nearly bare and only gains affixes as
     the party outlevels it. */
  const tiers = (bp.tierIlvl || {})[slot];
  /* Only a base that actually PROTECTS pays for a tier. A cloth hood or hat
     with acBase 0 has no intrinsic stat, so its tier is just an unlock rung:
     charging it would give a bare Rag Hood a power score with nothing behind
     it. Such a base costs 0 and spends its whole budget on affixes. */
  const protective = (base.armorBase > 0) || (base.acBase > 0);
  const tierPriced = tiers && tiers.length && protective;
  if (tierPriced) {
    /* A protective base with no tier is a data error. Charge it the LAST rung
       so the failure mode is "does not drop until late" rather than a cheap
       chassis carrying a full affix budget. */
    const idx = base.tier != null
      ? Math.min(Math.max(base.tier - 1, 0), tiers.length - 1)
      : tiers.length - 1;
    cost += Math.floor(itemBudget(slot, tiers[idx], 'common') * bp.baseMaxShare);
  } else if (base.acBase) {
    /* Chassis AC — a shield's own protection. This is what the item physically
       IS (like a sword's damage die), not a magical bonus, so it lives on the
       base rather than in `bonuses` and never appears as an affix. Base items
       carry NO stat bonuses; every stat comes from affixes. */
    cost += base.acBase * T.costs.ac;
  }

  return Math.round(cost);
}

/** Full cost of a base against the budget: chassis + its `prim` block. */
export function baseCost(slot, base) {
  if (!base) return 0;
  return baseChassisCost(slot, base) + bonusesCost(base.prim);
}

/* ─── Budgets ───────────────────────────────────────────────────────────── */

/** Total points an item of this slot / ilvl / rarity is allowed to carry. */
export function itemBudget(slot, ilvl, rarity) {
  const b = T.budget;
  const lvl = Math.max(0, Math.min(b.maxIlvl, ilvl | 0));
  const w = T.slotWeight[slot] ?? 1;
  const m = T.rarityMult[rarity] ?? 1;
  return Math.round((b.intercept + b.perIlvl * lvl) * w * m);
}

/** Budget left for affixes once the base is paid for (never negative). */
export function affixBudget(slot, ilvl, rarity, base) {
  return Math.max(0, itemBudget(slot, ilvl, rarity) - baseCost(slot, base));
}

/** Can this base fit inside the budget at all, leaving room to spare? */
export function baseAffordable(slot, ilvl, rarity, base) {
  const budget = itemBudget(slot, ilvl, rarity);
  return baseCost(slot, base) <= budget * T.basePricing.baseMaxShare;
}

/**
 * Lowest item level at which a base can start dropping, DERIVED from its cost.
 *
 * This is what replaced the old hand-maintained `minFloors` table: nothing gates
 * a base explicitly, it simply can't fit in a budget that can't afford it. Read
 * this to display an unlock level; never store one.
 *
 * Returns null if the base never becomes affordable within the ilvl range.
 */
export function earliestIlvl(slot, base, rarity = 'common') {
  for (let ilvl = 0; ilvl <= T.budget.maxIlvl; ilvl++) {
    if (baseAffordable(slot, ilvl, rarity, base)) return ilvl;
  }
  return null;
}

/** Total points an existing item is actually carrying (for audits + the editor).
 *  Uses the CHASSIS cost because `item.bonuses` already contains the base's
 *  `prim` block — see baseChassisCost. */
export function itemCost(item, base) {
  return baseChassisCost(item.slot, base) + bonusesCost(item.bonuses);
}

/**
 * How many affix lines an item gets. Rarity sets the floor; ilvl adds more, so
 * a deep item reads as RICHER rather than as the same three lines with bigger
 * numbers. Without this the budget curve outruns affix capacity at high ilvl
 * and items silently underspend.
 */
export function affixLines(rarity, ilvl) {
  const a = T.affixSlots;
  const per = a._perIlvl || 0;
  const extra = per > 0 ? Math.floor(Math.max(0, ilvl | 0) / per) : 0;
  return Math.min(a._max || 99, (a[rarity] ?? 1) + extra);
}

/* ─── Rarity drop weights ───────────────────────────────────────────────── */

/**
 * Drop weight for a rarity at a quest tier. There is no rarity GATE any more —
 * every rarity is rollable at every depth, and scarcity is what makes the top
 * tiers special. The flat rarityMult is what makes that safe: an early epic is
 * a nice find, not a run-breaker.
 */
export function rarityWeight(rarity, tier) {
  const w = T.rarityWeights[rarity];
  if (!w) return 0;
  return Math.max(w.min, Math.min(w.max, w.base + w.perTier * Math.max(0, tier | 0)));
}

/** Whether a rarity is allowed to carry a perk. */
export function rarityHasPerk(rarity) {
  return (T.perks.rarities || []).includes(rarity);
}

/** Max affix lines for a rarity at an ilvl. */
export function affixSlotsFor(rarity, ilvl = 0) {
  return affixLines(rarity, ilvl);
}

/**
 * Item level for a drop from `source` at a quest tier — deliberately NOT a
 * function of which floor the party is standing on.
 */
export function sourceIlvl(source, tier, rng = Math.random) {
  const s = T.sourceIlvl[source] || T.sourceIlvl.chest;
  const spread = s.spread ? Math.floor(rng() * (s.spread * 2 + 1)) - s.spread : 0;
  return Math.max(0, Math.min(T.budget.maxIlvl, (tier | 0) + s.offset + spread));
}

/* ─── Human-readable labels (shared by tooltips and the editor) ─────────── */

export const BONUS_LABEL = {
  ac: 'AC', atk: 'Hit', dmg: 'Dmg', hp: 'HP', crit: 'Crit', heal: 'Heal',
  fightTempHp: 'Fight Temp HP',
  spellDC: 'Spell DC',
  magicFind: 'Magic Find', goldFind: 'Gold Find', potionHeal: 'Potion Healing',
  init: 'Initiative', bloodthirst: 'HP on Kill', oaDmg: 'Opportunity Dmg',
  range: 'Range', concentration: 'Concentration',
  speed: 'Speed', move: 'Move',
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

/** Display label for any bonus key, including the generated families. */
export function bonusLabel(key) {
  if (BONUS_LABEL[key]) return BONUS_LABEL[key];
  const ab = saveAbilityOf(key);
  if (ab) return ab.toUpperCase() + ' Save';
  const el = elemTypeOf(key);
  if (el) return el.charAt(0).toUpperCase() + el.slice(1) + ' Dmg';
  const lv = slotLevelOf(key);
  if (lv) return `L${lv} Spell Slot`;
  const wd = wardTypeOf(key);
  if (wd) return wd.charAt(0).toUpperCase() + wd.slice(1) + ' Ward';
  const bn = baneTypeOf(key);
  if (bn) return 'Dmg vs ' + bn.charAt(0).toUpperCase() + bn.slice(1);
  if (STEADFAST_GROUPS[key]) return STEADFAST_GROUPS[key].label + ' Saves';
  return key;
}

/** Every priceable bonus key, grouped — drives the editor's cost table. */
export function costGroups() {
  return [
    { title: 'Combat', keys: ['ac', 'atk', 'dmg', 'crit', 'hp', 'heal'] },
    { title: 'Movement', keys: ['move', 'speed'] },
    { title: 'Abilities', keys: ABILITY_KEYS },
    { title: 'Saving throws', keys: SAVE_KEYS },
    { title: 'Elemental damage', keys: ELEM_KEYS },
    { title: 'Spell slots', keys: SLOT_SPELL_KEYS },
    { title: 'Loot & utility', keys: ['magicFind', 'goldFind', 'potionHeal', 'init'] },
    { title: 'Caster', keys: ['spellDC', 'concentration'] },
    { title: 'Tactics', keys: ['bloodthirst', 'oaDmg', 'range'] },
    { title: 'Warding', keys: WARD_KEYS },
    { title: 'Steadfast', keys: STEADFAST_KEYS },
    { title: 'Bane', keys: BANE_KEYS },
  ];
}
