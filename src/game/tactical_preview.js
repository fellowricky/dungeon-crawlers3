/**
 * Tactical preview — what the player sees BEFORE committing in manual mode.
 *
 * The engine already knows everything a tactician wants: to-hit against the
 * target's effective AC, every advantage/disadvantage source, the damage dice,
 * which squares a hostile threatens. Until now none of it showed until the
 * dice were thrown. These are read-only projections of the same rules
 * heroAttackRoll / heroDamage / provokesOA apply — computed, never rolled, and
 * never spending a charge (buildAttackOpts does, so it is deliberately not
 * reused here).
 *
 * Numbers are "as things stand": Bless is shown as its average (+2.5), a
 * one-shot advantage buff is counted since it WILL be consumed by this attack,
 * and conditional feat damage (Sharpshooter's -5/+10 etc.) is left out
 * because the AI decides those at roll time.
 */

import { mod } from './srd.js';
import { getEffectMods, hasEffect } from './conditions.js';
import { hasFeature } from './features.js';
import { sightAdvantage } from './light_rules.js';
import { provokesOA } from './turn_engine.js';

/** P(d20 roll ≥ need) with nat 1 always missing and nat 20 always hitting. */
export function hitProbability(need, adv = 0) {
  const n = Math.max(2, Math.min(20, need));      // 1 always misses, 20 always hits
  const p = (21 - n) / 20;
  if (adv > 0) return 1 - (1 - p) * (1 - p);
  if (adv < 0) return p * p;
  return p;
}

/**
 * Preview of `hero` attacking `foe` with `profile` (a weapon/cantrip profile).
 * Returns null when there is nothing sensible to say (no profile, dead foe).
 */
export function attackPreview(game, hero, foe, profile) {
  const d = hero && hero.data;
  const fd = foe && foe.data;
  if (!d || !fd || !profile || fd.hp <= 0) return null;

  const selfMods = getEffectMods(hero);
  const foeMods = getEffectMods(foe);
  const reasons = [];
  let adv = 0;
  if (foeMods.defAdvantage) { adv += 1; reasons.push('target impaired'); }
  if (selfMods.atkDisadvantage) { adv -= 1; reasons.push(hasEffect(hero, 'prone') ? 'prone' : 'impaired'); }
  if (selfMods.atkAdvantage) { adv += 1; reasons.push(hasEffect(hero, 'inspired') ? 'inspired' : 'advantage'); }
  const sight = sightAdvantage(hero, foe);
  if (sight.unseenTarget) { adv -= 1; reasons.push('target unseen in the dark'); }
  if (sight.unseenAttacker) { adv += 1; reasons.push('striking from the shadows'); }
  const advWord = adv > 0 ? 'advantage' : adv < 0 ? 'disadvantage' : '';

  const isCantrip = !!(profile.isSave || profile.cantripScale || profile.source === 'cantrip');
  const ability = profile.ability || 'str';
  const abilityMod = mod((d.effStats && d.effStats[ability]) != null ? d.effStats[ability] : 10);

  /* Damage: dice average + the flat bonuses heroDamage adds, floored at 1. */
  const dice = profile.dmg ? profile.dmg[0] : 1;
  const sides = profile.dmg ? profile.dmg[1] : 4;
  const noAbility = profile.cantripScale || profile.noAbilityMod;
  const flat = (noAbility ? 0 : abilityMod) + (d.dmgBonus || 0) + (d.elemDamageTotal || 0);
  let minDmg = Math.max(1, dice * 1 + flat);
  let maxDmg = Math.max(1, dice * sides + flat);
  let avgDmg = Math.max(1, dice * (sides + 1) / 2 + flat);
  const notes = [];
  if (hasFeature(d, 'sneakAttack') || (d.classKey === 'rogue')) {
    const flanked = (game.heroes || []).some(a => a !== hero && a.data && a.data.hp > 0 && Math.hypot(a.x - foe.x, a.z - foe.z) < 1.7);
    if (flanked) {
      const sneakDice = Math.ceil((d.level || 1) / 2);
      minDmg += sneakDice; maxDmg += sneakDice * 6; avgDmg += sneakDice * 3.5;
      notes.push('sneak attack');
    }
  }

  if (isCantrip) {
    /* A save-based cantrip: the target rolls against the caster's DC. Shown
       as the failure chance so the number means the same thing as a hit. */
    return {
      kind: 'save', adv, advWord, reasons, notes,
      hitPct: null, critPct: null, minDmg, maxDmg, avgDmg: Math.round(avgDmg),
      label: profile.name || 'Cantrip'
    };
  }

  let toHit = (d.atkProf || 0) + abilityMod + (selfMods.atkBonus || 0);
  if (selfMods.blessDice) { toHit += 2.5; notes.push('bless +1d4'); }

  const cover = (!profile.melee && game && typeof game.getCover === 'function')
    ? game.getCover(hero, foe)
    : { type: 'none', acBonus: 0, dexBonus: 0 };
  if (cover.type === 'total') {
    notes.push('blocked by cover');
  } else if (cover.acBonus > 0) {
    notes.push(`${cover.type === 'threeQuarters' ? '3/4' : 'half'} cover (+${cover.acBonus} AC)`);
  }

  const foeAc = (fd.ac || 10) + (foeMods.acBonus || 0) + (cover.acBonus && cover.type !== 'total' ? cover.acBonus : 0);
  const need = foeAc - toHit;
  const critRange = d.critRange || 20;
  const hit = (cover.type === 'total') ? 0 : hitProbability(need, adv);
  const crit = (cover.type === 'total') ? 0 : hitProbability(critRange, adv);
  return {
    kind: 'attack', adv, advWord, reasons, notes,
    toHit: Math.round(toHit), foeAc,
    hitPct: Math.round(hit * 100), critPct: Math.round(crit * 100),
    minDmg, maxDmg, avgDmg: Math.round(avgDmg),
    label: profile.name || 'Attack'
  };
}

/** One-line tooltip text for an attack preview. */
export function attackPreviewText(p) {
  if (!p) return '';
  const dmg = `${p.minDmg}–${p.maxDmg} dmg (avg ${p.avgDmg})`;
  const why = p.reasons.length ? ` — ${p.advWord}: ${p.reasons.join(', ')}` : '';
  const extra = p.notes.length ? ` · ${p.notes.join(', ')}` : '';
  if (p.kind === 'save') return `save or take ${dmg}${extra}`;
  return `${p.hitPct}% to hit vs AC ${p.foeAc} · ${p.critPct}% crit · ${dmg}${why}${extra}`;
}

/**
 * Which hostiles get an opportunity attack if `mover` walks `path` (an array
 * of cell indices starting at its own cell). Uses the same hostiles/threat
 * sets the move resolver uses, so the warning matches what will happen.
 */
export function movePreview(game, mover, path) {
  if (!path || path.length < 2 || typeof game.oaHostiles !== 'function') return { provokers: [] };
  const hostiles = game.oaHostiles(mover);
  const seen = new Set();
  const provokers = [];
  for (let i = 1; i < path.length; i++) {
    for (const e of provokesOA(hostiles, path[i - 1], path[i])) {
      if (seen.has(e)) continue;
      seen.add(e);
      provokers.push(e);
    }
  }
  return { provokers };
}

/** Every floor cell any live hostile threatens against `mover` — the danger
    zone to paint on the floor. */
export function threatZone(game, mover) {
  const out = new Set();
  if (typeof game.oaHostiles !== 'function') return out;
  for (const h of game.oaHostiles(mover)) {
    if (!h.threatened) continue;
    for (const c of h.threatened) out.add(c);
  }
  return out;
}
