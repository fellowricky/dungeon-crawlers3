/**
 * The "player" for real-game balance runs: makes the level-up picks and gear
 * choices a person would otherwise click through, and logs every pick so the
 * report can attribute results to builds.
 *
 * Picks are random but sane (see POLICY). Everything goes through the same
 * rules functions the Party screen calls, so a bot-built hero is a legal hero.
 */
import {
  CLASSES, SUBCLASSES, SKILLS, needsSubclass, pickSubclass, spendAbilityPoint,
  spendSkillPoint, spendSkillRank, recalc, canEquip,
} from '../../src/game/srd.js';
import { resolveChoice, FIGHTING_STYLES } from '../../src/game/features.js';
import { itemPoints, isRune } from '../../src/game/items.js';

export const POLICY = {
  featChance: 0.5,          // ASI-or-feat: how often the feat is taken
  psWeight: 0.15,           // how much raw Power Score counts beside derived stats when comparing gear
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/* ── progression ─────────────────────────────────────────────────────────── */

function usesRanged(h) {
  const p = h.weaponProfile;
  return !!(p && (p.ranged || p.isRanged || (p.range || 0) > 2));
}

function chooseOption(h, choice, rng) {
  let opts = (choice.options || []).slice();
  if (!opts.length) return null;
  if (choice.pick === 'asiOrFeat') {
    const feats = opts.filter(o => o.kind === 'feat'), asi = opts.filter(o => o.kind === 'asi');
    if (feats.length && (!asi.length || rng() < POLICY.featChance)) return pick(feats, rng);
    return asi[0] || opts[0];
  }
  if (choice.pick === 'fightingStyle') {
    const ranged = usesRanged(h);
    const fit = opts.filter(o => {
      const s = FIGHTING_STYLES[o.key] || {};
      if (s.rangedOnly && !ranged) return false;
      if (s.meleeOnly && ranged) return false;
      return true;
    });
    if (fit.length) opts = fit;
  }
  return pick(opts, rng);
}

function abilityOrder(h) {
  const pr = CLASSES[h.classKey].statPriority.slice();
  const rest = pr.filter(a => a !== 'con');
  return [rest[0], 'con', ...rest.slice(1)];
}

/**
 * Resolve everything a hero has waiting: subclass, feature choices, ability
 * points, talents and skill ranks. `api` lets the caller route the picks through
 * the live game's own methods (which refresh the UI and save); without it the
 * rules functions are called directly. Returns the list of picks made.
 */
export function resolveProgression(h, rng, api = null) {
  const picks = [];
  if (needsSubclass(h)) {
    const key = pick(Object.keys(SUBCLASSES[h.classKey] || {}), rng);
    if (key && (api ? api.chooseSubclass(h, key) : pickSubclass(h, key))) picks.push({ lvl: h.level, kind: 'subclass', key });
  }
  let guard = 60;
  while ((h.pendingChoices || []).length && guard-- > 0) {
    const choice = h.pendingChoices[0];
    const opt = chooseOption(h, choice, rng);
    if (!opt) { h.pendingChoices.shift(); continue; }
    const ok = api ? api.chooseFeature(h, choice.id, opt.key) : resolveChoice(h, choice.id, opt.key).ok;
    if (!ok) { h.pendingChoices.shift(); continue; }
    picks.push({ lvl: h.level, kind: choice.pick === 'asiOrFeat' ? opt.kind : choice.pick, key: opt.feat || opt.key });
  }
  const order = abilityOrder(h);
  guard = 60;
  while (h.pendingAbility > 0 && guard-- > 0) {
    const ab = order.find(a => h.stats[a] < 20);
    if (!ab) break;
    if (!(api ? api.allocateAbility(h, ab) : spendAbilityPoint(h, ab))) break;
    picks.push({ lvl: h.level, kind: 'ability', key: ab });
  }
  guard = 60;
  while (h.pendingSkill > 0 && guard-- > 0) {
    const open = (CLASSES[h.classKey].skills || []).filter(s => (h.skills[s.key] || 0) < s.max);
    if (!open.length) break;
    const s = pick(open, rng);
    if (!(api ? api.allocateSkill(h, s.key) : spendSkillPoint(h, s.key))) break;
    picks.push({ lvl: h.level, kind: 'talent', key: s.key });
  }
  guard = 60;
  const skillKeys = Object.keys(SKILLS);
  while ((h.pendingSkillRank || 0) > 0 && guard-- > 0) {
    const k = pick(skillKeys, rng);
    if (api) api.allocateSkillRank(h, k); else spendSkillRank(h, k);
  }
  if (!api) recalc(h);
  return picks;
}

/* ── gear ────────────────────────────────────────────────────────────────── */

const GEAR_SLOTS = new Set(['weapon', 'armor', 'helm', 'gloves', 'boots', 'ring', 'amulet', 'shield']);
const mod = v => Math.floor((v - 10) / 2);

/** How strong this hero is right now, from the game's own derived stats. Only
 *  ever used to answer "is this item an upgrade for this hero". */
export function heroPower(h) {
  const p = h.weaponProfile || h.cantripProfile;
  let hit = 0;
  if (p && p.dmg) {
    const am = (p.cantripScale || p.noAbilityMod) ? 0 : mod((h.effStats || h.stats)[p.ability] || 10);
    hit = p.dmg[0] * (p.dmg[1] + 1) / 2 + am + (h.dmgBonus || 0);
  }
  let ps = 0;
  for (const k in (h.equipment || {})) ps += itemPoints(h.equipment[k]) || 0;
  return h.maxHp * 0.5 + h.ac * 4 + (h.atkBonus || 0) * 3 + hit * 3 + (h.healBonus || 0) * 2 + ps * POLICY.psWeight;
}

/** Score the hero with `item` worn, without leaving anything changed. */
function trialPower(h, item) {
  const eq = h.equipment, saved = { ...eq }, hp = h.hp;
  const slot = item.slot === 'shield' ? 'offhand' : item.slot;
  if (item.slot === 'shield' && eq.weapon && eq.weapon.twoHanded) return -Infinity;
  if (item.slot === 'weapon' && item.twoHanded) delete eq.offhand;
  eq[slot] = item;
  recalc(h);
  const s = heroPower(h);
  for (const k of Object.keys(eq)) delete eq[k];
  Object.assign(eq, saved);
  recalc(h);
  h.hp = Math.min(hp, h.maxHp);
  return s;
}

/**
 * Hand out the bag: repeatedly give the single best upgrade to whoever gains
 * most from it, until nothing in the bag improves anyone. `bag()` returns the
 * current item list; `equip(hero, item)` performs the real equip and returns
 * truthy on success.
 */
export function autoEquip(heroes, bag, equip) {
  const changes = [];
  const failed = new Set();
  let guard = 80;
  while (guard-- > 0) {
    let best = null;
    for (const item of bag()) {
      if (!item || failed.has(item) || isRune(item) || !GEAR_SLOTS.has(item.slot)) continue;
      for (const h of heroes) {
        if (h.hp <= 0 || !canEquip(h, item)) continue;
        const gain = trialPower(h, item) - heroPower(h);
        if (gain > 0.01 && (!best || gain > best.gain)) best = { h, item, gain };
      }
    }
    if (!best) break;
    if (!equip(best.h, best.item)) { failed.add(best.item); continue; }
    changes.push({ hero: best.h.name, item: best.item.name, slot: best.item.slot, ps: itemPoints(best.item) });
  }
  /* consumable trinkets and kits: fill an empty slot, nothing cleverer */
  for (const item of bag().slice()) {
    if (!item || (item.slot !== 'trinket' && item.slot !== 'kit')) continue;
    const h = heroes.find(x => x.hp > 0 && !x.equipment[item.slot] && canEquip(x, item));
    if (h && equip(h, item)) changes.push({ hero: h.name, item: item.name, slot: item.slot, ps: 0 });
  }
  return changes;
}

/** Compact, comparable description of a hero for the run record. */
export function describeHero(h) {
  const gear = {};
  for (const k in (h.equipment || {})) {
    const it = h.equipment[k];
    if (it) gear[k] = { name: it.name, rarity: it.rarity, ilvl: it.ilvl, ps: itemPoints(it) || 0 };
  }
  return {
    name: h.name, cls: h.classKey, race: h.raceKey, lvl: h.level, sub: h.subclass || null,
    stats: { ...h.stats }, maxHp: h.maxHp, ac: h.ac, atk: h.atkBonus || 0,
    style: h.fightingStyle || null, feats: (h.feats || []).slice(), spells: (h.knownSpells || []).slice(),
    invocations: (h.invocations || []).slice(), talents: { ...(h.skills || {}) },
    gear, gearPs: Object.values(gear).reduce((a, g) => a + g.ps, 0),
  };
}
