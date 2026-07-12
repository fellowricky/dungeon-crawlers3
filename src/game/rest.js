/**
 * Rest system — two recharge clocks only:
 *   short rest  — shrines, rest-flavored skill checks
 *   long rest   — clearing a dungeon floor
 *
 * Spell slots remain a spendable pool:
 *   short → partial recover (warlocks full)
 *   long  → full recover
 */
import { hasFeature, totalSlots, recoverSlots } from './features.js';
import { drawBar } from './entities.js';
import { log, updatePartyFrames } from './ui.js';
import { clearEffectsByTag } from './conditions.js';

/** Normalize legacy `day` flag → `long`. */
export function ensureAbilityUsed(h) {
  if (!h.abilityUsed) h.abilityUsed = { short: false, long: false };
  if (h.abilityUsed.day !== undefined) {
    h.abilityUsed.long = !!(h.abilityUsed.long || h.abilityUsed.day);
    delete h.abilityUsed.day;
  }
  if (h.abilityUsed.long === undefined) h.abilityUsed.long = false;
  if (h.abilityUsed.short === undefined) h.abilityUsed.short = false;
  return h.abilityUsed;
}

/**
 * Short rest for one hero data object.
 * @param {object} h hero data
 * @param {{ fullHeal?: boolean, songOfRest?: boolean }} [opts]
 */
export function applyShortRestToHero(h, opts = {}) {
  ensureAbilityUsed(h);
  h.abilityUsed.short = false;
  h.secondWindUsed = false;
  h.smiteUsed = false;
  h.tidesUsed = false;

  /* Spell slots (leveled). Warlock Pact Magic refills fully on a short rest;
     other casters recover the lowest expended slot (Arcane Recovery: more). */
  if (totalSlots(h.slotsMax) > 0) {
    if (h.classKey === 'warlock') {
      h.slots = { ...h.slotsMax };
    } else {
      const gain = hasFeature(h, 'arcaneRecovery')
        ? Math.max(1, Math.ceil(totalSlots(h.slotsMax) / 2))
        : 1;
      recoverSlots(h, gain);
    }
  }

  /* Heal slots — recover one */
  if (h.healSlotsMax) {
    h.healSlots = Math.min(h.healSlotsMax, (h.healSlots || 0) + 1);
  }

  /* Lay on Hands — recover half the pool (min 5) */
  if (h.layOnHandsMax) {
    const gain = Math.max(5, Math.floor(h.layOnHandsMax / 2));
    h.layOnHands = Math.min(h.layOnHandsMax, (h.layOnHands || 0) + gain);
  }

  if (opts.fullHeal && h.hp > 0) {
    h.hp = h.maxHp;
  } else if (opts.songOfRest !== false && hasFeature(h, 'songOfRest') && h.hp > 0 && h.hp < h.maxHp) {
    h.hp = Math.min(h.maxHp, h.hp + 4 + h.level);
  }
}

/**
 * Long rest for one hero data object (full recharge).
 * HP is left to the caller (floor transitions often set a partial floor).
 */
export function applyLongRestToHero(h) {
  ensureAbilityUsed(h);
  h.abilityUsed.short = false;
  h.abilityUsed.long = false;
  h.secondWindUsed = false;
  h.smiteUsed = false;
  h.tidesUsed = false;
  h.rageUsed = false;

  if (totalSlots(h.slotsMax) > 0) h.slots = { ...h.slotsMax };
  if (h.healSlotsMax) h.healSlots = h.healSlotsMax;
  if (h.layOnHandsMax) h.layOnHands = h.layOnHandsMax;
}

/**
 * Party short rest. Returns true if anything meaningful recharged.
 * @param {object} game
 * @param {{ fullHeal?: boolean, silent?: boolean, reason?: string }} [opts]
 */
export function partyShortRest(game, opts = {}) {
  if (!game?.heroes?.length) return false;
  for (const hero of game.heroes) {
    applyShortRestToHero(hero.data, {
      fullHeal: !!opts.fullHeal,
      songOfRest: true
    });
    hero.uncannyUsed = false;
    if (opts.fullHeal && hero.ent?.bar) {
      drawBar(hero.ent.bar, Math.max(0, hero.data.hp / hero.data.maxHp));
    } else if (hero.ent?.bar && hero.data.hp > 0) {
      drawBar(hero.ent.bar, Math.max(0, hero.data.hp / hero.data.maxHp));
    }
  }
  if (!opts.silent) {
    const why = opts.reason || 'short rest';
    log(opts.fullHeal
      ? `⛺ The party takes a short rest (${why}) — healed, abilities and resources restored.`
      : `⛺ The party takes a short rest (${why}) — short-rest abilities recharged.`, 'heal');
  }
  updatePartyFrames(game.heroes.map(h => h.data));
  return true;
}

/**
 * Party long rest (floor clear). Full ability + resource recharge.
 * @param {object} game
 * @param {{ silent?: boolean, reason?: string }} [opts]
 */
export function partyLongRest(game, opts = {}) {
  if (!game?.heroes?.length) return false;
  for (const hero of game.heroes) {
    applyLongRestToHero(hero.data);
    hero.raging = false;
    hero.tempHp = 0;
    hero.uncannyUsed = false;
    hero._foughtThisCombat = false;
    hero.conc = null;   // concentration drops on a long rest / floor change
    clearEffectsByTag(hero, 'skill');   // skill-check boons/debuffs expire on floor change
    if (hero.ent?.bar && hero.data.hp > 0) {
      drawBar(hero.ent.bar, Math.max(0, hero.data.hp / hero.data.maxHp));
    }
  }
  if (!opts.silent) {
    const why = opts.reason || 'floor cleared';
    log(`🌙 Long rest (${why}) — all abilities and spell slots restored.`, 'heal');
  }
  updatePartyFrames(game.heroes.map(h => h.data));
  return true;
}

/** True if a short-rest ability charge is available. */
export function canUseShort(h) {
  ensureAbilityUsed(h);
  return !h.abilityUsed.short;
}

/** True if a long-rest ability charge is available. */
export function canUseLong(h) {
  ensureAbilityUsed(h);
  return !h.abilityUsed.long;
}

export function markShortUsed(h) {
  ensureAbilityUsed(h);
  h.abilityUsed.short = true;
}

export function markLongUsed(h) {
  ensureAbilityUsed(h);
  h.abilityUsed.long = true;
}
