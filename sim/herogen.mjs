/**
 * Party generation, deterministic leveling, and auto-gearing for the balance
 * simulator.
 *
 * Everything here reuses the game's AUTHORITATIVE rules from src/game so the
 * simulator tracks the real game as it evolves:
 *   - makeHero / recalc          — construction + derived-stat math
 *   - grantXp / applyLevelGrants  — the real level-up ladder
 *   - spendAbilityPoint / spendSkillPoint / pickSubclass / resolveChoice
 *                                 — the real progression choices
 *   - rollItem / canEquip / aggregateEquipment — the real loot + equip rules
 *
 * The only opinions this file adds are the "recommended build" policy: how a
 * simulated hero spends its stat points, skill points, feats, and subclass —
 * chosen to be a sensible, offense-leaning-but-not-degenerate build so classes
 * are compared on an even footing. Tweak POLICY below to explore other builds.
 */
import {
  RACES, CLASSES, ABILITIES, SUBCLASSES,
  makeHero, recalc, grantXp, XP_TABLE, MAX_LEVEL,
  spendAbilityPoint, spendSkillPoint, pickSubclass, needsSubclass,
  canEquip, mod, HERO_NAMES,
} from '../src/game/srd.js';
import { resolveChoice } from '../src/game/features.js';
import { SPELL_POOLS } from '../src/game/spells.js';
import { rollItem } from '../src/game/items.js';
import { SPELL_DAMAGE, spellExpected } from './combat_sim.mjs';

/* ------------------------------------------------------------------ */
/* Build policy — the "recommended" hero. Edit here to test variants.  */
/* ------------------------------------------------------------------ */
export const POLICY = {
  /* Standard array assigned best-first along each class's statPriority. */
  statArray: [15, 14, 13, 12, 10, 8],
  /* When a level grants an ASI-or-feat choice, take the ASI (raw stats) so the
     comparison stays about class chassis, not feat cleverness. */
  preferASI: true,
  /* Ranks are poured into skills in this bonus-key priority order (higher =
     filled first), each up to its per-skill max. Offense-leaning. */
  skillWeight: { atk: 6, dmg: 5, heal: 4, hp: 3, crit: 3, ac: 2, speed: 1 },
};

const CLASS_KEYS = Object.keys(CLASSES);
const RACE_KEYS = Object.keys(RACES);
let _nameCounter = 0;

function pickFrom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

/** SRD (canonical) subclass key for a class — the entry flagged `srd:true`. */
function srdSubclassKey(classKey) {
  const table = SUBCLASSES[classKey] || {};
  const keys = Object.keys(table);
  return keys.find(k => table[k].srd) || keys[0] || null;
}

/**
 * Build the pre-racial base-stat block: the standard array assigned to the
 * class's statPriority (best stat gets the highest value). makeHero adds the
 * racial bonus on top.
 */
function recommendedBaseStats(classKey) {
  const priority = CLASSES[classKey].statPriority;
  const stats = {};
  priority.forEach((ab, i) => { stats[ab] = POLICY.statArray[i]; });
  // any ability not in the priority list (shouldn't happen) defaults to 8
  for (const ab of ABILITIES) if (stats[ab] == null) stats[ab] = 8;
  return stats;
}

/** Create one level-1 hero of the given (or random) race/class. */
export function makeSimHero(rng, { classKey = null, raceKey = null, name = null } = {}) {
  const cls = classKey || pickFrom(CLASS_KEYS, rng);
  const race = raceKey || pickFrom(RACE_KEYS, rng);
  const base = recommendedBaseStats(cls);
  const visual = { gender: rng() < 0.5 ? 'male' : 'female', hair: 'bangs/adult',
                   skinColor: '#ffccaa', hairColor: '#663311' };
  const hName = name || HERO_NAMES[(_nameCounter++) % HERO_NAMES.length] + '-' + cls;
  const h = makeHero(hName, race, cls, base, visual);
  return h;
}

/**
 * Generate a random adventuring party.
 * @param rng        seeded rng
 * @param size       party size (default 4)
 * @param opts.classes  optional fixed class list (length == size)
 * @param opts.uniqueClasses  avoid duplicate classes when true (default true)
 */
export function makeParty(rng, size = 4, opts = {}) {
  if (opts.classes) return opts.classes.map(c => makeSimHero(rng, { classKey: c }));
  const chosen = [];
  const used = new Set();
  while (chosen.length < size) {
    const c = pickFrom(CLASS_KEYS, rng);
    if (opts.uniqueClasses !== false && used.has(c) && used.size < CLASS_KEYS.length) continue;
    used.add(c);
    chosen.push(makeSimHero(rng, { classKey: c }));
  }
  return chosen;
}

/* ------------------------------------------------------------------ */
/* Deterministic auto-leveling                                         */
/* ------------------------------------------------------------------ */

/** Ordered stat targets for spending ability points: primary chassis first. */
function abilitySpendOrder(h) {
  // statPriority already ranks the class's stats; keep CON high for survival.
  const pr = CLASSES[h.classKey].statPriority.slice();
  // ensure con is at least 3rd priority so nobody is made of glass
  const withoutCon = pr.filter(a => a !== 'con');
  return [withoutCon[0], 'con', ...withoutCon.slice(1)];
}

/** Ordered class-skill keys by POLICY.skillWeight (highest first). */
function skillSpendOrder(h) {
  const list = (CLASSES[h.classKey].skills || []).slice();
  const weightOf = s => Math.max(...Object.keys(s.b || {}).map(k => POLICY.skillWeight[k] || 0), 0);
  return list.sort((a, b) => weightOf(b) - weightOf(a));
}

/** Resolve every pending progression choice a fresh level-up produced. */
export function resolvePendingProgression(h) {
  /* 1. Subclass at level 3 — take the canonical SRD option. */
  if (needsSubclass(h)) {
    const key = srdSubclassKey(h.classKey);
    if (key) pickSubclass(h, key);
  }

  /* 2. Feature choices (ASI-or-feat, fighting style, spell picks). */
  for (const choice of (h.pendingChoices || []).slice()) {
    const opts = choice.options || [];
    let opt = null;
    if (choice.pick === 'asiOrFeat') {
      opt = POLICY.preferASI ? opts.find(o => o.kind === 'asi') : opts.find(o => o.kind === 'feat');
      opt = opt || opts[0];
      if (opt) resolveChoice(h, choice.id, opt.key);
    } else if (choice.pick === 'spell') {
      /* Spell choices carry no options list — the pool is SPELL_POOLS[class][tier].
         Pick the highest-damage spell we have a combat model for; if none, take
         the first pool entry (a utility/heal spell) so the slot isn't wasted. */
      const pool = (SPELL_POOLS[choice.classKey] && SPELL_POOLS[choice.classKey][choice.tier]) || [];
      let pickId = null, bestExp = -1;
      for (const id of pool) {
        if (h.knownSpells.includes(id)) continue;
        const exp = SPELL_DAMAGE[id] ? spellExpected(id, h.level, 3) : 0;
        if (exp > bestExp) { bestExp = exp; pickId = id; }
      }
      if (!pickId) pickId = pool.find(id => !h.knownSpells.includes(id)) || pool[0];
      if (pickId) resolveChoice(h, choice.id, pickId);
    } else {
      opt = opts[0]; // fightingStyle and anything else: first listed
      if (opt) resolveChoice(h, choice.id, opt.key);
    }
  }

  /* 3. Spend banked ability points (ASIs bank points via resolveChoice). */
  const abilOrder = abilitySpendOrder(h);
  let guard = 100;
  while (h.pendingAbility > 0 && guard-- > 0) {
    let spent = false;
    for (const ab of abilOrder) {
      if (h.stats[ab] < 20 && spendAbilityPoint(h, ab)) { spent = true; break; }
    }
    if (!spent) break; // everything capped at 20
  }

  /* 4. Spend banked class-skill points. */
  const skillOrder = skillSpendOrder(h);
  guard = 100;
  while (h.pendingSkill > 0 && guard-- > 0) {
    let spent = false;
    for (const s of skillOrder) {
      if ((h.skills[s.key] || 0) < s.max && spendSkillPoint(h, s.key)) { spent = true; break; }
    }
    if (!spent) break;
  }

  recalc(h);
}

/**
 * Level a hero up to `targetLevel`, resolving choices and re-gearing at each
 * step exactly as a player progressing through the dungeon would. Feeds real
 * XP through grantXp so the true level ladder (features, extra attacks,
 * subclass milestones, spell slots) is exercised.
 */
export function levelHeroTo(h, targetLevel, rng) {
  targetLevel = Math.min(targetLevel, MAX_LEVEL);
  while (h.level < targetLevel) {
    const need = XP_TABLE[h.level + 1] - h.xp;
    grantXp(h, Math.max(1, need));       // advances exactly one level
    resolvePendingProgression(h);
    upgradeGear(h, h.level, rng);        // find level-appropriate gear
  }
  return h;
}

/** Level an entire party in lockstep. */
export function levelPartyTo(party, targetLevel, rng) {
  for (const h of party) levelHeroTo(h, targetLevel, rng);
  return party;
}

/* ------------------------------------------------------------------ */
/* Auto-gearing — equip level-appropriate loot                          */
/* ------------------------------------------------------------------ */

/* equipment slots a hero can hold; 'shield' items live in the 'offhand' slot */
const GEAR_SLOTS = ['weapon', 'armor', 'helm', 'gloves', 'boots', 'ring', 'amulet', 'shield'];

/**
 * A monotonic "is this loadout stronger?" score built from the game's own
 * derived stats after recalc. Not a balance metric — only used to decide
 * whether a freshly rolled item is an upgrade worth equipping.
 */
export function powerScore(h) {
  const p = h.weaponProfile || h.cantripProfile;
  let hitDmg = 0;
  if (p) {
    const abilityMod = (p.cantripScale || p.noAbilityMod) ? 0 : mod(h.effStats[p.ability] || 10);
    const dice = p.dmg[0] * (p.dmg[1] + 1) / 2;
    hitDmg = dice + abilityMod + (h.dmgBonus || 0);
  }
  const attacks = 1; // relative only; extra-attack applies equally across gear choices
  return h.maxHp * 0.5 + h.ac * 4 + (h.atkBonus || 0) * 3 + hitDmg * attacks * 3 + (h.healBonus || 0) * 2;
}

/**
 * Try to upgrade each gear slot with a fresh level-appropriate roll. Rolls a
 * few candidates per slot, keeps the best equippable one that raises
 * powerScore. Deterministic given the seeded rng.
 */
export function upgradeGear(h, level, rng, { candidatesPerSlot = 3 } = {}) {
  for (const slot of GEAR_SLOTS) {
    const equipSlot = slot === 'shield' ? 'offhand' : slot;
    // a shield in the offhand only makes sense if this class can hold one and
    // isn't already dual-wielding a weapon there
    if (slot === 'shield' && h.equipment.offhand && h.equipment.offhand.slot === 'weapon') continue;

    let best = null, bestScore = -Infinity;
    const current = h.equipment[equipSlot];
    for (let c = 0; c < candidatesPerSlot; c++) {
      /* Chest-tier loot at the party's level. `luck` leans the rarity mix up a
         little so a simulated party stays plausibly geared — it improves the
         odds without changing what's reachable, since the rarity gate is gone. */
      const item = rollItem(level, Math.random, slot, {
        ilvl: level,
        source: 'chest',
        luck: 3,
      });
      if (!item || !canEquip(h, item)) continue;
      // trial-equip and measure
      h.equipment[equipSlot] = item;
      recalc(h);
      const s = powerScore(h);
      if (s > bestScore) { bestScore = s; best = item; }
      h.equipment[equipSlot] = current; // revert between trials
    }
    // commit the best candidate if it beats what we have
    h.equipment[equipSlot] = current;
    recalc(h);
    const curScore = powerScore(h);
    if (best && bestScore > curScore) {
      h.equipment[equipSlot] = best;
      recalc(h);
    }
  }
  // restore to full after re-gearing (mirrors the game's recalc-on-equip heal clamp)
  h.hp = h.maxHp;
  return h;
}
