/**
 * D&D-style initiative — the turn order that drives tactical combat.
 *
 * ACTIONS are serialized into an initiative order without touching any of the
 * scattered attack code: an entity may only act when its attack cooldown is
 * "ready" (<= 0), and this module lets only the current actor's cooldown reach
 * 0 while freezing everyone else's. One creature acts per spotlight, in
 * initiative order, round by round — just like tabletop. Movement is locked to
 * the current actor and budgeted in cells by turn_engine.js.
 *
 * This module is also the **timekeeper for status effects**. `TURN_TIME` is a
 * real-time pacing knob and says nothing about how long a round "is" in the
 * fiction — with early turn advance a round can resolve in well under a
 * second. So buff/debuff durations are measured against `game.fxNow`, the
 * combat clock advanced here at a fixed ROUND_SECONDS per full pass of the
 * order, and frozen entirely between fights. `_endCombatEffects` then wipes
 * the slate when the last aggroed monster drops. See conditions.js.
 *
 * Mixed onto Game.prototype in game.js.
 */
import { mod } from './srd.js';
import { ROUND_SECONDS, clearCombatEffects } from './conditions.js';

/* Seconds each combatant holds the spotlight before the turn passes.
   Phase 1: raised from 0.8s so a tactical actor has time to spend its
   movement budget (moveStep) AND take its action within one spotlight.
   Manual mode (Phase 4) will override this to pause until the player ends
   the turn. Tunable playtest knob alongside COMBAT_MOVE_BOOST. */
export const TURN_TIME = 0.6;

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
    /* The combat clock. Monotonic across the whole run — never rewound, or
       every `until` timestamp already stored on an entity would break. It
       simply stops advancing between fights. See conditions.js for why. */
    if (this.fxNow == null) this.fxNow = 0;
  },

  /** Advance the combat clock by one creature's share of a round.
   *  A full pass of the order = ROUND_SECONDS, however long that took in
   *  real time. This is the only place `fxNow` moves. */
  _advanceCombatClock() {
    const n = Math.max(1, this.initiative.order.length);
    this.fxNow += ROUND_SECONDS / n;
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

  _beginTurn() {
    if (this.clearPendingMove) this.clearPendingMove();
    /* Ensure all combatants adhere strictly to tile centers at start of turn */
    if (this.heroes) {
      for (const h of this.heroes) {
        if (h.data && h.data.hp > 0 && !h.moving && this.snapToTileCenter) this.snapToTileCenter(h);
      }
    }
    if (this.monsters) {
      for (const m of this.monsters) {
        if (m.active && m.data && m.data.hp > 0 && !m.moving && this.snapToTileCenter) this.snapToTileCenter(m);
      }
    }

    const a = this._currentActor();
    if (a) {
      /* Start of turn: refresh the actor's bonus-action economy. One bonus action
         per turn, claimed by whichever fires first — a bonus-action spell, an
         off-hand/Flurry/Frenzy attack, or a bonus-action reflex (Rage, Second
         Wind, Cunning Action, Bardic Inspiration, Fast Hands). See combat.js. */
      a._bonusActed = false;
      a._bonusLeveled = false;
      /* Tactical turn-engine budgets (turn_engine.js). Additive only — these
         fields are dormant until Phase 1 gates movement on moveLeft / canMove.
         Dash adds to moveLeft; everything else spends these flags. */
      this.resetTurnBudgets(a);
      this.initiative._turnAge = 0;
      /* Arm a single target re-decision for this turn. Heroes consume this in
         heroDecideTarget (combat.js) so they commit to a foe for a full round
         instead of flip-flopping between turns. */
      a._canRetarget = true;

      /* Process initiative-driven monster auras according to 5e SRD rules */
      if (this.processTurnAuras) this.processTurnAuras(a);
      if (this.processTurnZones) this.processTurnZones(a);
    }
    this.fxUpdateInitTracker();
  },

  _rollInitiative(parts) {
    for (const e of parts) { e._init = rollD20() + initMod(e); e._initTb = Math.random(); }
    parts.sort((a, b) => b._init - a._init || initMod(b) - initMod(a) || b._initTb - a._initTb);
    this.initiative.order = parts;
    this.initiative.idx = 0;
    this.initiative.round = 1;
    this.initiative.timer = TURN_TIME;
    this.initiative.active = true;

    /* Combat start: stop and reset all movement for heroes and monsters */
    if (this.heroes) {
      for (const h of this.heroes) {
        h.path = null; h.pathI = 0; h.moving = false;
        if (this.snapToTileCenter && h.data && h.data.hp > 0) this.snapToTileCenter(h);
      }
    }
    if (this.monsters) {
      for (const m of this.monsters) {
        m.path = null; m.pathI = 0; m.walk = false; m.moving = false;
        if (this.snapToTileCenter && m.data && m.data.hp > 0) this.snapToTileCenter(m);
      }
    }

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
    this.fxUpdateInitTracker();
  },

  _advanceTurn() {
    const o = this.initiative.order;
    if (!o.length) { this.initiative.active = false; return; }
    /* One spotlight has been spent — bank its share of the round before the
       next actor's effects are ticked, so durations burn down in rounds. */
    this._advanceCombatClock();
    let guard = 0;
    do {
      this.initiative.idx++;
      if (this.initiative.idx >= o.length) {
        this.initiative.idx = 0;
        this.initiative.round++;
        this.fxLog(`⚔️ --- Round ${this.initiative.round} ---`, 'sys');
      }
      guard++;
    } while (guard <= o.length && !this._actorAlive(o[this.initiative.idx]));
    this.initiative.timer = TURN_TIME;
    this._beginTurn();
  },

  /**
   * End-of-combat teardown: buffs and debuffs are strictly per-encounter, so
   * everything the fight produced is wiped here.
   *
   * Scope is deliberate — the whole party plus everyone who was actually in
   * the initiative order. Monsters elsewhere on the floor keep what they were
   * given out of combat (the Intimidation skill-check `bossWeakened` boon is
   * the case that matters: it must survive the skirmishes on the way to the
   * boss and be spent in the boss fight itself).
   *
   * Effects flagged `persist` (drained / corroded) ride through — those end on
   * a rest, not on a fight.
   */
  _endCombatEffects() {
    const seen = new Set();
    let cleared = 0;
    for (const e of this.initiative.order) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      delete e._auraProcessed;
      cleared += clearCombatEffects(e);
      /* Per-fight bookkeeping that predates the EFFECTS registry and so isn't
         reachable from clearCombatEffects. */
      if (e._side === 'mon') { e.burn = null; e.cutWordsUntil = 0; e._noRegenUntil = 0; }
      this.fxStatusTray(e);
    }
    for (const h of this.heroes) {
      if (seen.has(h)) continue;
      seen.add(h);
      cleared += clearCombatEffects(h);
      this.fxStatusTray(h);
    }
    /* Concentration can't outlive the spells it was holding up. */
    for (const h of this.heroes) if (h.conc && this.breakConcentration) this.breakConcentration(h, 'the fight ended');

    if (cleared) {
      this.fxLog(`— the fight ends; ${cleared} lingering effect${cleared > 1 ? 's fade' : ' fades'} —`, 'sys');
      this.refreshHud();
    }
  },

  /**
   * Drive initiative once per combat frame. Called before updateMonsters so the
   * current actor's "ready" pulse is set before any acting happens this frame.
   */
  updateInitiative(dt) {
    const parts = this._initParticipants();
    const engaged = parts.some(e => e._side === 'mon');

    if (!engaged) {                       // no live aggroed monsters → combat over
      if (this.initiative.active) {
        this._endCombatEffects();
        this._initReset();
        this.fxUpdateInitTracker();
      }
      return;
    }

    if (!this.initiative.active) { this._rollInitiative(parts); return; }

    /* fold in anyone who joined the fight after it started (late aggro, etc.) */
    for (const e of parts) if (!this.initiative.order.includes(e)) this._insertActor(e);

    /* current actor died mid-spotlight → pass the turn immediately */
    if (!this._actorAlive(this._currentActor())) { this._advanceTurn(); return; }

    /* Early advance: once an AI actor has taken its action (cd > 0) and
       isn't currently moving, snap to the next combatant immediately.
       The 0.6 s timer remains as a backstop for edge cases (actor gets
       stuck pathfinding and never reaches its target). */
    const cur = this._currentActor();
    const isManualHero = (this.controlMode === 'manual' && cur && cur._side === 'hero');

    if (typeof window !== 'undefined' && window.__updateManualBar) window.__updateManualBar();

    /* In manual mode on a hero's turn, pause timer and early advance.
       The turn waits until the user performs actions or clicks End Turn. */
    if (isManualHero) return;

    /* Animation Lock: wait for active spell, projectile, and attack FX to finish playing */
    if (this.fxHasActiveFX()) return;

    /* Early advance for AI actors (monsters or auto-mode heroes): once an AI
       actor has taken its action (actUsed) and isn't currently moving, snap to
       the next combatant immediately. */
    if (cur && cur.actUsed && !cur.moving) { this._advanceTurn(); return; }

    /* Advance when the actor has exhausted movement and isn't going anywhere,
       even if it never got to use its action (e.g. target is unreachable). */
    if (cur && !cur.moving && (cur.moveLeft != null && cur.moveLeft <= 0) &&
        (!cur.path || cur.pathI >= cur.path.length)) {
      this._advanceTurn(); return;
    }

    /* Timer fallback: if actor is actively walking a valid path with remaining budget (e.g. Dash),
       keep timer refreshed so movement isn't truncated mid-sprint. */
    if (cur && cur.moving && cur.path && cur.pathI < cur.path.length && (cur.moveLeft || 0) > 0) {
      this.initiative.timer = TURN_TIME;
    } else {
      this.initiative.timer -= dt;
      if (this.initiative.timer <= 0) this._advanceTurn();
    }

    /* Hard ceiling: absolute deadlock breaker. No single AI turn should ever
       last more than 3 seconds. If it does, something is stuck — force advance. */
    this.initiative._turnAge = (this.initiative._turnAge || 0) + dt;
    if (!isManualHero && this.initiative._turnAge > 3.0) {
      this._advanceTurn();
    }
  }
};
