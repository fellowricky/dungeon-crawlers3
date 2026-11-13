/* ══ Wild Magic sorcerer ══
 *
 * Mixed into the combat methods (combat.js), so `this` is the game.
 *
 *   Wild Magic Surge  after a spell paid for with a slot, roll a d20: on a 1
 *                     the magic surges (WILD_SURGES, a d20 table of our own —
 *                     11 boons, 6 backfires, 3 oddities). combat.js
 *                     markSpellUsed calls wildMagicAfterSlot.
 *   Tides of Chaos    the subclass active: advantage on one attack roll
 *                     (combat.js buildAttackOpts) or a reroll of a failed save
 *                     (wildSaveAfterFail). Once spent, the next slotted spell
 *                     surges for certain, and that surge gives Tides back.
 *   Bend Luck (6)     1 sorcery point, once a round: +1d4 to an ally's failed
 *                     save, or −1d4 on an enemy attack about to hit an ally.
 *   Controlled Chaos (10)  surges roll twice and keep the better.
 *   Spell Bombardment (14) once a turn, a spell damage die that lands on its
 *                     top face is rolled again and added (spells.js roll).
 *   Tamed Surge (18)  once per long rest, a backfire is turned into a boon.
 */
import { applyEffect, ROUND_SECONDS } from './conditions.js';
import { hasCharge, spendCharge, restoreSorceryPoints, spendSorceryPoints, sorceryPointsLeft } from './features.js';
import { SPELL_ROLL } from './spells.js';
import { addVirtualLight, addDarkZone } from './light_sources.js';
import { gridDist } from './combat_eval.js';

function d(n) { return Math.floor(Math.random() * n) + 1; }
function dice(n, s) { let t = 0; for (let i = 0; i < n; i++) t += d(s); return t; }
function turnKey(game) {
  const ini = game.initiative;
  return ini && ini.active ? `${ini.round}:${ini.idx}` : `t${Math.floor((game.fxNow || 0) * 2)}`;
}
function roundKey(game) {
  return game.initiative && game.initiative.active ? game.initiative.round : -1;
}

/** Is this hero (entity or data) a Wild Magic sorcerer of at least `lv`? */
export function isWildMage(h, lv = 3) {
  const x = h && (h.data || h);
  return !!(x && x.classKey === 'sorcerer' && x.subclass === 'wildmagic' && (x.level || 1) >= lv);
}

/** Does this hero have Tides of Chaos (the subclass, or a legacy grant)? */
export function hasTides(h) {
  const x = h && (h.data || h);
  return !!(x && (isWildMage(x) || (x.features && x.features.includes('tidesOfChaos'))));
}

/* Damage dice for the surge blasts: 2d6 at level 3, a die more every 3 levels. */
const surgeDice = (lv) => 1 + Math.ceil((lv || 1) / 3);

const living = (list) => (list || []).filter(e => e && e.data && e.data.hp > 0 && !e.dead && e.active !== false);
const near = (list, p, r) => list.filter(e => Math.hypot(e.x - p.x, e.z - p.z) <= r);

/* The table. Each `run(game, h)` does the effect and returns the log line. */
export const WILD_SURGES = [
  /* ── boons ── */
  { id: 'detonation', kind: 'good', label: 'Arcane Detonation', run(g, h) {
    const foe = g._surgeFoe(h);
    if (!foe) return 'raw force crackles out and finds nothing to hit';
    const n = surgeDice(h.data.level);
    for (const m of near(living(g.monsters), foe, 2)) g.spellDamage(m, dice(n, 6), h, false, { dmgType: 'force', magical: true });
    g.playAbilityFx(h, 'wildSurge', { at: foe, spell: true });
    return `the air around ${foe.data.name} detonates (${n}d6 force)`;
  } },
  { id: 'echo', kind: 'good', label: 'Spell Echo', run(g, h) {
    const lv = g._surgeRefundSlot(h);
    return lv ? `the spell echoes back — a level-${lv} slot returns` : 'the spell echoes, but there was nothing to return';
  } },
  { id: 'haste', kind: 'good', label: 'Quicksilver', run(g, h) {
    applyEffect(h, 'hasted', { duration: ROUND_SECONDS * 2, elapsed: g.fxNow, source: h });
    return `${h.data.name} moves at double speed`;
  } },
  { id: 'shield', kind: 'good', label: 'Spectral Shield', run(g, h) {
    applyEffect(h, 'shielded', { duration: ROUND_SECONDS * 2, elapsed: g.fxNow, source: h });
    return 'a spectral shield hovers close (+5 AC)';
  } },
  { id: 'wellspring', kind: 'good', label: 'Wellspring', run(g, h) {
    const got = restoreSorceryPoints(h.data, d(4));
    g.refreshAbilityHud();
    return got ? `power wells up — +${got} sorcery point${got === 1 ? '' : 's'}` : 'power wells up, but the font is already full';
  } },
  { id: 'bloom', kind: 'good', label: 'Vital Bloom', run(g, h) {
    const amt = dice(2, 8) + (h.data.level || 1);
    g.healHero(h, amt, h);
    return 'warm light closes wounds';
  } },
  { id: 'arcs', kind: 'good', label: 'Wild Arcs', run(g, h) {
    const foes = near(living(g.monsters), h, 8).sort(() => Math.random() - 0.5).slice(0, 3);
    if (!foes.length) return 'lightning crawls over the floor, harmless';
    const n = Math.max(1, Math.ceil(surgeDice(h.data.level) / 2));
    for (const m of foes) g.spellDamage(m, dice(n, 10), h, false, { dmgType: 'lightning', magical: true });
    g.playAbilityFx(h, 'wildSurge', { at: foes[0], alsoAt: foes, spell: true });
    return `lightning leaps to ${foes.length} foe${foes.length === 1 ? '' : 's'} (${n}d10 each)`;
  } },
  { id: 'luck', kind: 'good', label: 'Lucky Streak', run(g, h) {
    for (const a of living(g.heroes)) applyEffect(a, 'blessed', { duration: ROUND_SECONDS * 2, elapsed: g.fxNow, source: h });
    return 'luck sparkles over the whole party (blessed)';
  } },
  { id: 'vanish', kind: 'good', label: 'Fade Out', run(g, h) {
    applyEffect(h, 'invisible', { duration: ROUND_SECONDS * 2, elapsed: g.fxNow, source: h });
    return `${h.data.name} flickers out of sight`;
  } },
  { id: 'foresight', kind: 'good', label: 'Glimpse Ahead', run(g, h) {
    applyEffect(h, 'foresight', { duration: ROUND_SECONDS, elapsed: g.fxNow, source: h });
    return 'a glimpse of the next moment (advantage, +3 AC)';
  } },
  { id: 'mirrors', kind: 'good', label: 'Mirror Burst', run(g, h) {
    applyEffect(h, 'mirrorImages', { duration: ROUND_SECONDS * 3, elapsed: g.fxNow, source: h, data: { images: 2 } });
    return 'two shimmering doubles step out';
  } },
  /* ── backfires ── */
  { id: 'selfBlast', kind: 'bad', label: 'Wild Detonation', run(g, h) {
    const n = Math.max(1, Math.ceil(surgeDice(h.data.level) / 2));
    for (const m of near(living(g.monsters), h, 2)) g.spellDamage(m, dice(n, 6), h, false, { dmgType: 'fire', magical: true });
    for (const a of near(living(g.heroes), h, 2)) g._surgeHurtHero(a, dice(n, 6), 'fire');
    g.playAbilityFx(h, 'wildSurge', { at: h, spell: true });
    return `the magic bursts in ${h.data.name}'s own hands (${n}d6 fire to everyone close)`;
  } },
  { id: 'panic', kind: 'bad', label: 'Dread', run(g, h) {
    applyEffect(h, 'frightened', { duration: ROUND_SECONDS, elapsed: g.fxNow, source: h });
    return `${h.data.name} is gripped by sudden terror (frightened)`;
  } },
  { id: 'feed', kind: 'bad', label: 'Mana Feast', run(g, h) {
    const foes = near(living(g.monsters), h, 4);
    for (const m of foes) g._surgeHealMonster(m, dice(2, 6));
    return foes.length ? 'the stray magic is drunk up by the nearest foes' : 'the stray magic soaks into the stone';
  } },
  { id: 'leak', kind: 'bad', label: 'Leak', run(g, h) {
    const lose = Math.min(sorceryPointsLeft(h.data), d(4));
    if (lose) { spendSorceryPoints(h.data, lose); g.refreshAbilityHud(); }
    return lose ? `power bleeds away — −${lose} sorcery point${lose === 1 ? '' : 's'}` : 'the font gutters, already empty';
  } },
  { id: 'root', kind: 'bad', label: 'Leaden Feet', run(g, h) {
    applyEffect(h, 'rooted', { duration: ROUND_SECONDS, elapsed: g.fxNow, source: h });
    return `${h.data.name}'s feet turn to lead`;
  } },
  { id: 'mute', kind: 'bad', label: 'Butterfly Tongue', run(g, h) {
    applyEffect(h, 'silenced', { duration: ROUND_SECONDS, elapsed: g.fxNow, source: h });
    return `${h.data.name}'s words come out as moths (silenced)`;
  } },
  /* ── oddities ── */
  { id: 'glow', kind: 'odd', label: 'Witchlight', run(g, h) {
    addVirtualLight({ follow: h, bright: 2, dim: 4, color: 0xffb060, ttl: ROUND_SECONDS * 10 });
    return `${h.data.name} glows like a lantern — easy to see, for friend and foe`;
  } },
  { id: 'fog', kind: 'odd', label: 'Murk', run(g, h) {
    addDarkZone({ x: h.x, z: h.z, r: 2, ttl: ROUND_SECONDS * 3, spell: true });
    return 'a bank of magical murk rolls out';
  } },
  { id: 'color', kind: 'odd', label: 'Hue Shift', run(g, h) {
    const hue = ['blue', 'green', 'violet', 'gold'][d(4) - 1];
    return `${h.data.name}'s skin turns ${hue} for a while. Nothing else happens.`;
  } }
];
const RANK = { good: 2, odd: 1, bad: 0 };

export const wildMagicMethods = {
  /** Nearest living, active foe — the surge's natural target. */
  _surgeFoe(h) {
    let best = null, bd = Infinity;
    for (const m of living(this.monsters)) {
      const dd = Math.hypot(m.x - h.x, m.z - h.z);
      if (dd < bd) { bd = dd; best = m; }
    }
    return best;
  },

  /** Give back one spent slot (lowest level first). Returns its level or 0. */
  _surgeRefundSlot(h) {
    const dd = h.data;
    if (!dd.slotsMax || typeof dd.slotsMax === 'number' || !dd.slots) return 0;
    for (const lv of Object.keys(dd.slotsMax).map(Number).sort((a, b) => a - b)) {
      if ((dd.slots[lv] || 0) < dd.slotsMax[lv]) { dd.slots[lv] = (dd.slots[lv] || 0) + 1; this.refreshAbilityHud(); return lv; }
    }
    return 0;
  },

  _surgeHurtHero(a, dmg, dmgType) {
    if (!a || !a.data || a.data.hp <= 0) return;
    const mit = {};
    const dealt = this.applyIncomingDamage ? this.applyIncomingDamage(a, dmg, mit, { dmgType, magical: true }) : (a.data.hp -= dmg, dmg);
    if (this.fxHitFlash && a.ent) this.fxHitFlash(a.ent);
    if (this.fxDamageNumber) this.fxDamageNumber(a, dealt, mit, '#ff9a7a');
    else this.fxText(String(dealt), this._v3(a.x, 1.2, a.z), '#ff9a7a');
    if (this.fxDrawBar && a.ent) this.fxDrawBar(a.ent.bar, Math.max(0, a.data.hp / a.data.maxHp));
    if (a.data.hp <= 0) {
      if (a.companion && this.killCompanion) this.killCompanion(a, null);
      else { a.data.hp = 0; a.data.downs = (a.data.downs || 0) + 1; this.fxLog(`💀 ${a.data.name} goes down!`, 'down'); }
    }
    this.refreshHud();
  },

  _surgeHealMonster(m, amt) {
    const before = m.data.hp;
    m.data.hp = Math.min(m.data.maxHp || before, before + amt);
    const got = m.data.hp - before;
    if (got > 0) this.fxText(`+${got}`, this._v3(m.x, 1.3, m.z), '#6ae06a');
  },

  /** Called by markSpellUsed whenever a slot paid for a spell. */
  wildMagicAfterSlot(h, spell) {
    if (!isWildMage(h) || !spell || (spell.level || 0) < 1) return;
    const dd = h.data;
    /* Tides of Chaos spent: this spell surges for certain, and gives it back. */
    const forced = hasTides(dd) && !hasCharge(dd, 'tidesOfChaos');
    const roll = d(20);
    if (!forced && roll !== 1) return;
    if (forced) {
      if (!dd.charges) dd.charges = {};
      dd.charges.tidesOfChaos = 1;
    }
    const go = () => { if (dd.hp > 0) this.rollWildSurge(h, forced); };
    /* after the spell itself has landed */
    if (typeof this.fxDelay === 'function') this.fxDelay(0.9, go);
    else go();
  },

  /** Roll on the table (Controlled Chaos: twice, keep the better) and resolve. */
  rollWildSurge(h, fromTides = false) {
    const dd = h.data;
    const pick = () => WILD_SURGES[d(WILD_SURGES.length) - 1];
    let s = pick();
    if (isWildMage(dd, 10)) {
      const t = pick();
      if (RANK[t.kind] > RANK[s.kind]) s = t;
    }
    let tamed = false;
    if (s.kind === 'bad' && isWildMage(dd, 18) && hasCharge(dd, 'tamedSurge')) {
      spendCharge(dd, 'tamedSurge');
      s = WILD_SURGES.find(x => x.id === 'detonation');
      tamed = true;
    }
    this.fxText('WILD SURGE', this._v3(h.x, 1.7, h.z), s.kind === 'bad' ? '#ff6040' : '#ff8844');
    const what = s.run(this, h);
    const why = fromTides ? ' (Tides of Chaos returns)' : '';
    this.fxLog(`🌀 Wild Magic Surge — ${s.label}${tamed ? ' (tamed)' : ''}: ${what}.${why}`, s.kind === 'bad' ? 'down' : 'crit');
    if (!['detonation', 'arcs', 'selfBlast'].includes(s.id)) {      // those draw their own
      this.playAbilityFx(h, 'wildSurge', { at: h, spell: true });
    }
    this.refreshHud();
    return s;
  },

  /** Tides of Chaos on a failed save: reroll the d20 and keep the better. */
  _tidesOnSave(entity, res) {
    const dd = entity.data;
    if (!hasTides(dd) || !hasCharge(dd, 'tidesOfChaos')) return res;
    if (res.dc - res.mod > 20) return res;            // even a 20 can't pass it
    spendCharge(dd, 'tidesOfChaos');
    const d20 = Math.max(res.d20, d(20));
    const total = d20 + res.mod;
    this.fxText('TIDES', this._v3(entity.x, 1.5, entity.z), '#ff8844');
    this.fxLog(`🌀 ${dd.name} rides the Tides of Chaos on the save (${res.total} → ${total} vs DC ${res.dc}).`,
      total >= res.dc ? 'crit' : 'roll');
    this.refreshAbilityHud();
    return { ...res, d20, total, saved: total >= res.dc };
  },

  /** A wild sorcerer who can Bend Luck for `target` this round (1 point, 6 tiles). */
  _bendLuckSorcerer(target) {
    const rk = roundKey(this);
    for (const s of living(this.heroes)) {
      if (s === target || s.companion || !isWildMage(s, 6)) continue;
      if (s._bendRound === rk || sorceryPointsLeft(s.data) < 1) continue;
      const g = gridDist(this, s, target);
      if (g < 0 || g > 6) continue;
      return s;
    }
    return null;
  },

  /** Bend Luck on an ally's failed save: +1d4, when a d4 can turn it. */
  _bendLuckOnSave(entity, res) {
    if (res.dc - res.total > 4) return res;
    const s = this._bendLuckSorcerer(entity);
    if (!s) return res;
    s._bendRound = roundKey(this);
    spendSorceryPoints(s.data, 1);
    const add = d(4);
    const total = res.total + add;
    this.fxText(`+${add} 🌀`, this._v3(entity.x, 1.5, entity.z), '#ff8844');
    this.fxLog(`🌀 ${s.data.name} bends luck for ${entity.data.name}: +${add} (${res.total} → ${total} vs DC ${res.dc})`,
      total >= res.dc ? 'crit' : 'roll');
    this.refreshAbilityHud();
    return { ...res, total, mod: res.mod + add, saved: total >= res.dc };
  },

  /** SAVE_HOOKS.afterFail, chained after the talents (class_talents.js). */
  wildSaveAfterFail(entity, res) {
    if (!entity || !entity.data || !(this.heroes || []).includes(entity)) return res;
    let r = res;
    if (!r.saved && isWildMage(entity)) r = this._tidesOnSave(entity, r);
    if (!r.saved) r = this._bendLuckOnSave(entity, r);
    return r;
  },

  /** Bend Luck on a monster's attack that would hit an ally: −1d4. Returns
   *  the (possibly lowered) total. Called next to jarringChord in monster_ai. */
  bendLuckAttack(m, target, total, ac, crit) {
    if (crit || total < ac || total - 4 >= ac || !target || !target.data) return total;
    const s = this._bendLuckSorcerer(target);
    if (!s) return total;
    s._bendRound = roundKey(this);
    spendSorceryPoints(s.data, 1);
    const cut = d(4);
    const after = total - cut;
    this.fxText(`-${cut} 🌀`, this._v3(m.x, 1.5, m.z), '#ff8844');
    this.fxLog(`🌀 ${s.data.name} bends luck: −${cut} on ${m.data.name}'s attack (${total} → ${after} vs AC ${ac})`,
      after < ac ? 'crit' : 'roll');
    this.refreshAbilityHud();
    return after;
  },

  /** Spell Bombardment: arm the once-a-turn extra die for this cast. */
  armSpellBombardment(h) {
    if (!isWildMage(h, 14)) return;
    const tk = turnKey(this);
    if (h._bombTurn === tk) return;
    const game = this;
    SPELL_ROLL.bombard = {
      owner: h, used: false, live: () => turnKey(game) === tk,
      onFire: (extra) => {
        h._bombTurn = tk;
        game.fxLog(`🌀 Spell Bombardment — a die rolls high and goes again (+${extra}).`, 'crit');
      }
    };
  }
};
