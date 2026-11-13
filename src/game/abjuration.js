/* ══ Abjuration — the Abjurer wizard's Arcane Ward, and Counterspell ══
 *
 * features.js owns the ward's data (isAbjurer, wardMaxFor, restoreArcaneWard;
 * the pool is d.wardHp / d.wardMax, sized in srd.js recalc). This module is
 * mixed into the combat methods (combat.js), so `this` is the game.
 *
 *   Arcane Ward       soaks damage meant for the abjurer, after their temp HP
 *                     (applyIncomingDamage → absorbArcaneWard). It is NOT reset
 *                     per fight: every spell slot the abjurer spends recharges
 *                     it by 2 × the slot level (spendSlot → abjurerAfterSlot).
 *   Projected Ward    the subclass active, as a reaction: an ally within 6
 *                     tiles (any distance at Wardmaster, L18) about to take a
 *                     heavy or lethal hit has it soaked by the same ward.
 *   Spell Breaker     (L10) the abjurer always knows Counterspell, adds their
 *                     proficiency bonus to the check against a spell above
 *                     3rd level, and keeps the slot when the check fails.
 *   Spell Resistance  (L14) half damage from spells, advantage on saves
 *                     against them (conditions.js rollSaveDetail).
 *
 * Counterspell itself lives here too. It used to fire only one way: monsters
 * countered the party's spells, but a hero who learned it just played an
 * animation and wasted a 3rd-level slot. Now any hero who knows it reacts to
 * a monster's spell that is worth a slot (_castAbilityFx → heroCounterspell).
 */
import { isAbjurer, restoreArcaneWard, hasSlotFor, spendSlotFor } from './features.js';
import { SPELLS } from './spells.js';
import { getEffectMods, hasEffect } from './conditions.js';

const PROJECT_RANGE = 6;          // tiles (30 ft)
const COUNTER_RANGE = 12;         // tiles (60 ft), same as the monsters' counter

const castMod = (d) => {
  const v = (d.effStats && d.effStats[d._classAtk || 'int']) ?? 10;
  return Math.floor((v - 10) / 2);
};
const profOf = (d) => 2 + Math.floor(((d.level || 1) - 1) / 4);

/** Can this hero cast Counterspell right now (known, a 3rd+ slot, a reaction)? */
export function canCounterspell(h) {
  const d = h && h.data;
  if (!d || d.hp <= 0 || h.dead || h.reactionUsed || d.inWildShape) return false;
  const knows = (d.knownSpells && d.knownSpells.includes('counterspell')) || isAbjurer(d, 10);
  if (!knows || !hasSlotFor(d, 3)) return false;
  if (hasEffect(h, 'silenced') || getEffectMods(h).incapacitated) return false;
  return true;
}

export const abjurationMethods = {
  /** The abjurer's own ward soaks what got past their temp HP. */
  absorbArcaneWard(h, dmg, detail = null) {
    const d = h.data;
    if (!(dmg > 0) || !d || !(d.wardHp > 0) || !isAbjurer(d)) return dmg;
    const soak = Math.min(d.wardHp, dmg);
    d.wardHp -= soak;
    /* the hit's own log line says how much the ward soaked */
    if (detail) detail.wardAbsorbed = (detail.wardAbsorbed || 0) + soak;
    this.refreshAbilityHud();
    return dmg - soak;
  },

  /**
   * Projected Ward: a nearby abjurer's reaction soaks a heavy hit on an ally.
   * "Heavy" is a fifth of the ally's health or more, or anything that would
   * drop them — the ward is a finite pool, so it is not spent on scratches.
   */
  projectArcaneWard(target, dmg, detail = null) {
    /* party members only — a familiar or summon is not worth the ward */
    if (!(dmg > 0) || !target || !target.data || target.companion) return dmg;
    const td = target.data;
    const lethal = dmg >= td.hp;
    if (!lethal && dmg < Math.max(5, td.maxHp * 0.2)) return dmg;
    let best = null;
    for (const a of this.heroes || []) {
      if (a === target || !a.data || a.data.hp <= 0 || a.reactionUsed || !(a.data.wardHp > 0)) continue;
      if (!isAbjurer(a.data)) continue;
      const reach = (a.data.level || 0) >= 18 ? Infinity : PROJECT_RANGE;
      if (Math.hypot(a.x - target.x, a.z - target.z) > reach) continue;
      if (getEffectMods(a).incapacitated) continue;
      if (!best || a.data.wardHp > best.data.wardHp) best = a;
    }
    if (!best) return dmg;
    const bd = best.data;
    const soak = Math.min(bd.wardHp, dmg);
    bd.wardHp -= soak;
    best.reactionUsed = true;
    if (detail) detail.wardAbsorbed = (detail.wardAbsorbed || 0) + soak;
    this.fxLog(`🔷 ${bd.name} projects the Arcane Ward over ${td.name} — it takes ${soak} of the blow`
      + `${bd.wardHp <= 0 ? ' and shatters' : ` (${bd.wardHp} left)`}.`, 'heal');
    if (this.playAbilityFx) this.playAbilityFx(best, 'shield', { at: target, spell: true });
    this.refreshAbilityHud();
    return dmg - soak;
  },

  /** Spell Resistance (L14): half damage from spells. */
  abjurerSpellResist(h, dmg, magical, detail = null) {
    if (!magical || !(dmg > 0) || !isAbjurer(h.data, 14)) return dmg;
    if (detail) detail.resisted = true;
    return Math.floor(dmg / 2);
  },

  /** An abjurer spent a spell slot: the ward regains 2 × the slot's level. */
  abjurerAfterSlot(h, slotLevel) {
    const d = h && h.data;
    if (!d || !(d.wardMax > 0) || !isAbjurer(d)) return 0;
    const got = restoreArcaneWard(d, 2 * Math.max(1, slotLevel || 1));
    if (got > 0 && this.fxText && this._v3) this.fxText(`+${got} ward`, this._v3(h.x, 1.4, h.z), '#8fd4e8');
    return got;
  },

  /** Is this monster spell worth a 3rd-level slot to stop? */
  _counterWorth(m, sp, fx) {
    if (!sp || (sp.level || 0) < 1) return false;
    if (fx.blink) return false;
    if (m.isBoss || (this.monsterEliteRoom && this.monsterEliteRoom(m))) return true;
    if ((sp.level || 0) >= 3) return true;
    if (fx.aoe || fx.effect) return true;
    if (fx.dice) return fx.dice[0] * (fx.dice[1] + 1) / 2 + (fx.dice[2] || 0) >= 12;
    return false;
  },

  /**
   * A hero's Counterspell against a monster casting `key`. Called before the
   * spell resolves; true means it was stopped and nothing else happens.
   * Up to 3rd level it simply fails; above, the hero rolls d20 + casting
   * modifier (+ proficiency with Spell Breaker) against 10 + the spell level.
   */
  heroCounterspell(m, key, fx, label) {
    const sp = key && SPELLS[key];
    if (!sp || !fx || !m || !this._counterWorth(m, sp, fx)) return false;
    const lvl = sp.level || 1;
    let best = null;
    for (const h of this.heroes || []) {
      if (h.companion || !canCounterspell(h)) continue;
      if (Math.hypot(h.x - m.x, h.z - m.z) > COUNTER_RANGE) continue;
      /* an abjurer first: Spell Breaker makes theirs the surer one */
      if (!best || (isAbjurer(h.data, 10) && !isAbjurer(best.data, 10))) best = h;
    }
    if (!best) return false;
    const d = best.data, breaker = isAbjurer(d, 10);
    best.reactionUsed = true;
    let ok = true, detail = '';
    if (lvl > 3) {
      const d20 = 1 + Math.floor(Math.random() * 20);
      const bonus = castMod(d) + (breaker ? profOf(d) : 0);
      ok = d20 + bonus >= 10 + lvl;
      detail = `(${d20} + ${bonus} = ${d20 + bonus} vs DC ${10 + lvl})`;
    }
    const slotLv = (ok || !breaker) ? spendSlotFor(d, 3) : 0;
    if (slotLv) this.abjurerAfterSlot(best, slotLv);
    this.playAbilityFx(best, 'counterspell', { at: m, spell: true, scale: 2.0 });
    if (ok) {
      this.fxText('countered!', this._v3(m.x, 1.2, m.z), '#4080ff');
      this.fxLog(`🚫 ${d.name} counterspells ${m.data.name}'s ${label}!`, 'crit', detail ? { detail } : undefined);
    } else {
      this.fxText('counter failed', this._v3(m.x, 1.2, m.z), '#9aa');
      this.fxLog(`🚫 ${d.name} tries to counter ${m.data.name}'s ${label} — it pushes through`
        + `${breaker ? ' (Spell Breaker keeps the slot)' : ''}.`, 'roll', { detail });
    }
    this.refreshAbilityHud();
    this.refreshHud();
    return ok;
  }
};
