/* ══ Metamagic — the sorcerer's sorcery-point spends ══
 *
 * features.js owns the data (METAMAGIC, the point pool, Flexible Casting).
 * This module decides which option a cast gets and applies it. It is mixed
 * into the combat methods (combat.js), so `this` is the game.
 *
 *   Twinned     a single-target spell is cast a second time, free, on another
 *               foe (h._freeCastKey makes markSpellUsed skip the slot)
 *   Quickened   an action spell goes out on the bonus action (combat.js
 *               tryCastBonusSpell / manualPerformSpell), so the action is left
 *               for a cantrip or weapon attack
 *   Heightened  the main target's first save against the spell is at
 *               disadvantage (spellSave reads target._heightened)
 *   Empowered   arms the same 1s-and-2s reroll the Empowered Spell talent uses
 *               (spells.js SPELL_ROLL.empower)
 *   Subtle      the cast can't be counterspelled (checkCounterspellInterrupt
 *               reads caster._subtleCast)
 *
 * One option per spell, plus Empowered on top, as in 5e. The AI spends; a
 * manual player arms options from the spell drawer (h._mmArmed), and the next
 * spell they cast takes whichever armed options fit it.
 */
import { METAMAGIC, hasMetamagic, hasFeature, sorceryPointsLeft, spendSorceryPoints } from './features.js';
import { SPELL_ROLL } from './spells.js';
import { spellDamageProfile } from './turn_planner.js';

/* Single-target in this game's casts, but several targets (or none) in the
   rules — twinning them would be a free second volley. */
const NO_TWIN = new Set(['chaosBolt', 'sleep', 'timeStop', 'wish', 'counterspell', 'magicMissile',
  'scorchingRay', 'eldritchBlast', 'chainLightning']);
const TWIN_RANGE = 12;          // tiles (60 ft), the range most of these spells reach
const COUNTER_RANGE = 12;       // matches checkCounterspellInterrupt

function turnKey(game) {
  const ini = game.initiative;
  return ini && ini.active ? `${ini.round}:${ini.idx}` : `t${Math.floor((game.fxNow || 0) * 2)}`;
}

/** A spell Twinned can copy: aimed at one foe, not concentration, no area. */
export function isTwinnable(key, sp) {
  if (!sp || NO_TWIN.has(key) || sp.concentration || sp.reaction || sp.passive) return false;
  if ((sp.level || 0) < 1) return false;
  if (sp.aoeRadius || sp.area || (sp.ai && (sp.ai.aoeRadius || sp.ai.aoeOrigin))) return false;
  const ai = sp.ai || {};
  if (ai.buffTarget || ['cluster', 'selfHurt', 'hurtAlly', 'never'].includes(ai.when)) return false;
  if (ai.targetType === 'singleBurst' || sp.targetType === 'self' || sp.targetType === 'party') return false;
  return true;
}

const _forcesSave = new Map();
/** True when the spell's cast rolls a saving throw through game.spellSave. */
export function spellForcesSave(key, sp) {
  if (_forcesSave.has(key)) return _forcesSave.get(key);
  const v = !!(sp && typeof sp.cast === 'function' && sp.cast.toString().includes('spellSave'));
  _forcesSave.set(key, v);
  return v;
}

/** Can this Metamagic option be put on this spell at all? */
export function metamagicFits(mmKey, key, sp) {
  if (!sp || (sp.level || 0) < 1) return false;
  switch (mmKey) {
    case 'twinned':    return isTwinnable(key, sp);
    case 'quickened':  return sp.bonusAction !== true && sp.castingTime !== 'bonus' && !sp.reaction;
    case 'heightened': return spellForcesSave(key, sp);
    case 'empowered':  return !!spellDamageProfile(key, sp);
    case 'subtle':     return true;
    default:           return false;
  }
}

/** Sorcery points the option costs on this spell. */
export function metamagicCost(mmKey, sp) {
  const mm = METAMAGIC[mmKey];
  if (!mm) return 0;
  return mm.cost === 'level' ? Math.max(1, (sp && sp.level) || 1) : mm.cost;
}

export const metamagicMethods = {
  /** Arcane Apotheosis (L20): the first option each turn is free. */
  _mmFreeNow(h) {
    return hasFeature(h.data, 'arcaneApotheosis') && h._mmFreeTurn !== turnKey(this);
  },

  /** Points the hero could spend on an option right now (free counts as enough). */
  _mmAffordable(h, mmKey, sp) {
    return this._mmFreeNow(h) || sorceryPointsLeft(h.data) >= metamagicCost(mmKey, sp);
  },

  /** Pay for an option. Returns false (and spends nothing) when the hero can't. */
  payMetamagic(h, mmKey, sp) {
    if (this._mmFreeNow(h)) { h._mmFreeTurn = turnKey(this); return true; }
    const ok = spendSorceryPoints(h.data, metamagicCost(mmKey, sp));
    if (ok) this.refreshAbilityHud();
    return ok;
  },

  /** A living foe in reach who could counterspell this caster. */
  _mmCounterThreat(h) {
    return (this.monsters || []).some(m => {
      if (!m || m.dead || m.active === false || m.reactionUsed || !(m.data && m.data.hp > 0)) return false;
      if (Math.hypot(m.x - h.x, m.z - h.z) > COUNTER_RANGE) return false;
      const d = m.data;
      const knows = (d.knownSpells && d.knownSpells.includes('counterspell'))
        || (d.spellPool && Object.values(d.spellPool).flat().includes('counterspell'))
        || hasFeature(m, 'counterspell');
      if (!knows) return false;
      const s = d.slots;
      if (typeof s === 'number') return s > 0;
      return !!s && Object.keys(s).some(k => +k >= 3 && s[k] > 0);
    });
  },

  /** The foe a Twinned copy goes to: the nearest other living, active one. */
  _mmTwinPartner(h, foe) {
    let best = null, bestD = Infinity;
    for (const m of this.monsters || []) {
      if (!m || m === foe || m.dead || m.active === false || !(m.data && m.data.hp > 0)) continue;
      const dist = Math.hypot(m.x - h.x, m.z - h.z);
      if (dist <= TWIN_RANGE && dist < bestD) { best = m; bestD = dist; }
    }
    return best;
  },

  /**
   * Decide the Metamagic for one cast. Never spends — applyMetamagicPre does.
   * Returns null or { primary: 'twinned'|'heightened'|'subtle'|null,
   * empower: bool, partner }.
   */
  planMetamagic(h, key, sp, foe, opts = {}) {
    const d = h && h.data;
    if (!d || !d.metamagic || !d.metamagic.length || !sp || (sp.level || 0) < 1) return null;
    if (h._freeCastKey === key) return null;           // a twin's copy, or a feature's free cast
    const plan = { primary: null, empower: false, partner: null };
    const hostile = !!(foe && (this.monsters || []).includes(foe));
    const big = hostile && (foe.isBoss || (this.monsterEliteRoom && this.monsterEliteRoom(foe)));
    let budget = sorceryPointsLeft(d);
    const take = (mmKey) => {
      const c = this._mmFreeNow(h) && !plan.primary && !plan.empower ? 0 : metamagicCost(mmKey, sp);
      if (c > budget) return false;
      budget -= c;
      return true;
    };

    if (opts.manual) {
      const armed = h._mmArmed || {};
      for (const k of ['subtle', 'twinned', 'heightened']) {
        if (plan.primary || !armed[k] || !hasMetamagic(d, k) || !metamagicFits(k, key, sp)) continue;
        if (k === 'twinned') {
          const partner = hostile ? this._mmTwinPartner(h, foe) : null;
          if (!partner || !take(k)) continue;
          plan.partner = partner;
        } else if (k === 'heightened') {
          if (!hostile || !take(k)) continue;
        } else if (!take(k)) continue;
        plan.primary = k;
      }
      if (armed.empowered && hasMetamagic(d, 'empowered') && metamagicFits('empowered', key, sp) && take('empowered')) {
        plan.empower = true;
      }
      return plan.primary || plan.empower ? plan : null;
    }

    /* AI: Subtle only when a counterspell is actually waiting; Twin whenever a
       second foe is in reach (it doubles the spell); Heighten saves its points
       for the foes whose save matters. */
    if (hasMetamagic(d, 'subtle') && this._mmCounterThreat(h) && take('subtle')) {
      plan.primary = 'subtle';
    } else if (hostile && hasMetamagic(d, 'twinned') && metamagicFits('twinned', key, sp)) {
      const partner = this._mmTwinPartner(h, foe);
      if (partner && take('twinned')) { plan.primary = 'twinned'; plan.partner = partner; }
    }
    if (!plan.primary && big && hasMetamagic(d, 'heightened') && metamagicFits('heightened', key, sp)
        && take('heightened')) {
      plan.primary = 'heightened';
    }
    /* Empower spends a point the hero can spare, on a spell worth it, and not
       on one the talent already empowered this turn. */
    if (hasMetamagic(d, 'empowered') && metamagicFits('empowered', key, sp)
        && (big || (sp.level || 0) >= 3) && !(SPELL_ROLL.empower && SPELL_ROLL.empower.owner === h && SPELL_ROLL.empower.live())
        && budget - metamagicCost('empowered', sp) >= 1 && take('empowered')) {
      plan.empower = true;
    }
    return plan.primary || plan.empower ? plan : null;
  },

  /** Pay for the plan and arm its effects ahead of the cast. Drops anything
   *  the hero turns out unable to pay for. */
  applyMetamagicPre(h, key, sp, foe, plan) {
    if (!plan) return null;
    const name = h.data.name, label = sp.label || key;
    if (plan.primary && !this.payMetamagic(h, plan.primary, sp)) plan.primary = null;
    if (plan.empower && !this.payMetamagic(h, 'empowered', sp)) plan.empower = false;
    if (plan.primary === 'subtle') {
      h._subtleCast = true;
      this.fxLog(`✴️ ${name} casts ${label} subtly — no word, no gesture to counter.`, 'crit');
    } else if (plan.primary === 'heightened' && foe) {
      const game = this, tk = turnKey(this);
      foe._heightened = { by: h, live: () => turnKey(game) === tk };
      this.fxLog(`✴️ ${name} heightens ${label} — ${foe.data.name} saves at disadvantage.`, 'crit');
    } else if (plan.primary === 'twinned' && plan.partner) {
      this.fxLog(`✴️ ${name} twins ${label} onto ${plan.partner.data.name}.`, 'crit');
    }
    if (plan.empower) {
      const game = this, tk = turnKey(this);
      SPELL_ROLL.empower = { owner: h, live: () => turnKey(game) === tk };
      this.fxLog(`✴️ ${name} empowers ${label} — 1s and 2s are rerolled.`, 'crit');
    }
    if (plan.primary || plan.empower) {
      this.fxText('METAMAGIC', this._v3(h.x, 1.6, h.z), '#e67e22');
    }
    if (h._mmArmed) h._mmArmed = null;     // manual toggles are spent by the cast that used them
    return plan.primary || plan.empower ? plan : null;
  },

  /** After the cast: the Twinned copy, and clearing the per-cast flags. */
  applyMetamagicPost(h, key, sp, plan, alive, slotLevel, ok) {
    h._subtleCast = false;
    if (!plan || !ok || plan.primary !== 'twinned' || !plan.partner) return;
    const partner = plan.partner;
    const fire = () => {
      if (!h.data || h.data.hp <= 0 || !partner || partner.dead || !(partner.data && partner.data.hp > 0)) return;
      h._freeCastKey = key;               // markSpellUsed: this copy costs no slot
      try { sp.cast(this, h, partner, alive, slotLevel, null); }
      finally { if (h._freeCastKey === key) h._freeCastKey = null; }
    };
    /* after the first copy's half-second charge, so the two read as two casts */
    if (typeof this.fxDelay === 'function') this.fxDelay(0.8, fire);
    else fire();
  }
};
