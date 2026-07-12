/**
 * D&D-style initiative, layered on the real-time combat loop.
 *
 * Movement stays fully real-time — heroes and monsters keep repositioning every
 * frame. Only ACTIONS (attacks / spells / abilities) are serialized into an
 * initiative order. This is achieved without touching any of the scattered
 * attack code: an entity may only act when its attack cooldown is "ready"
 * (<= 0), and this module lets only the current actor's cooldown reach 0 while
 * freezing everyone else's. One creature acts per spotlight, in initiative
 * order, round by round — just like tabletop.
 *
 * Mixed onto Game.prototype in game.js.
 */
import { mod } from './srd.js';
import { updateInitiativeTracker } from './ui.js';

/* seconds each combatant holds the spotlight before the turn passes */
export const TURN_TIME = 0.8;

const rollD20 = () => 1 + Math.floor(Math.random() * 20);

/** Initiative modifier: heroes use DEX; monsters derive theirs from speed. */
function initMod(e) {
  if (e._side === 'hero') return mod((e.data.effStats && e.data.effStats.dex) || 10);
  const spd = (e.data && e.data.speed) || 3;
  return Math.max(-3, Math.min(5, Math.round(spd - 3)));   // nimble = higher
}

export const initiativeMethods = {
  _initReset() {
    this.initiative = { active: false, order: [], idx: 0, round: 0, timer: 0 };
  },

  _actorAlive(e) {
    if (!e) return false;
    return e._side === 'hero' ? e.data.hp > 0 : (e.active && e.data.hp > 0);
  },

  /** Alive heroes + active (aggroed) living monsters, tagged with their side. */
  _initParticipants() {
    const parts = [];
    for (const h of this.heroes) if (h.data.hp > 0) { h._side = 'hero'; parts.push(h); }
    for (const m of this.monsters) if (m.active && m.data.hp > 0) { m._side = 'mon'; parts.push(m); }
    return parts;
  },

  _currentActor() {
    const o = this.initiative.order;
    return (this.initiative.active && o.length && this.initiative.idx < o.length) ? o[this.initiative.idx] : null;
  },

  isCurrentActor(e) { return this.initiative && this.initiative.active && this._currentActor() === e; },

  /** Give the current actor a single "ready" pulse so it can act once. */
  _beginTurn() {
    const a = this._currentActor();
    if (a) a.cd = 0;
    updateInitiativeTracker(this);
  },

  _rollInitiative(parts) {
    for (const e of parts) { e._init = rollD20() + initMod(e); e._initTb = Math.random(); }
    parts.sort((a, b) => b._init - a._init || initMod(b) - initMod(a) || b._initTb - a._initTb);
    this.initiative.order = parts;
    this.initiative.idx = 0;
    this.initiative.round = 1;
    this.initiative.timer = TURN_TIME;
    this.initiative.active = true;
    this._beginTurn();
  },

  /** Insert a late-joining combatant into the order at its rolled position. */
  _insertActor(e) {
    e._init = rollD20() + initMod(e);
    e._initTb = Math.random();
    let i = this.initiative.order.findIndex(o => o._init < e._init);
    if (i < 0) i = this.initiative.order.length;
    this.initiative.order.splice(i, 0, e);
    if (i <= this.initiative.idx) this.initiative.idx++;   // keep the pointer on the same actor
    updateInitiativeTracker(this);
  },

  _advanceTurn() {
    const o = this.initiative.order;
    if (!o.length) { this.initiative.active = false; return; }
    let guard = 0;
    do {
      this.initiative.idx++;
      if (this.initiative.idx >= o.length) { this.initiative.idx = 0; this.initiative.round++; }
      guard++;
    } while (guard <= o.length && !this._actorAlive(o[this.initiative.idx]));
    this.initiative.timer = TURN_TIME;
    this._beginTurn();
  },

  /**
   * Drive initiative once per combat frame. Called before updateMonsters so the
   * current actor's "ready" pulse is set before any acting happens this frame.
   */
  updateInitiative(dt) {
    const parts = this._initParticipants();
    const engaged = parts.some(e => e._side === 'mon');

    if (!engaged) {                       // no live aggroed monsters → combat over
      if (this.initiative.active) { this._initReset(); updateInitiativeTracker(this); }
      return;
    }

    if (!this.initiative.active) { this._rollInitiative(parts); return; }

    /* fold in anyone who joined the fight after it started (late aggro, etc.) */
    for (const e of parts) if (!this.initiative.order.includes(e)) this._insertActor(e);

    /* current actor died mid-spotlight → pass the turn immediately */
    if (!this._actorAlive(this._currentActor())) { this._advanceTurn(); return; }

    this.initiative.timer -= dt;
    if (this.initiative.timer <= 0) this._advanceTurn();
  }
};
