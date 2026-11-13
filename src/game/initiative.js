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
import { canSee } from './light_rules.js';
import { ROUND_SECONDS, clearCombatEffects } from './conditions.js';
import { featInitiativeBonus } from './features.js';
import { Trace } from './ai_trace.js';
import { Motion, describeActor } from './motion_debug.js';
import { beginTurnFx } from './fx_clock.js';
import { actionAnimBusy } from './turn_engine.js';
import { firstRunTip } from './help_ui.js';

/* Seconds each combatant holds the spotlight before the turn passes.
   Phase 1: raised from 0.8s so a tactical actor has time to spend its
   movement budget (moveStep) AND take its action within one spotlight.
   Manual mode (Phase 4) will override this to pause until the player ends
   the turn. Tunable playtest knob alongside COMBAT_MOVE_BOOST. */
export const TURN_TIME = 0.6;

/* Deadlock breaker. Time spent legitimately waiting on animations is NOT
   counted against this (see updateInitiative) — it measures an actor being
   STUCK, not an actor being watched. Without that exemption a long spell plus
   its read buffer would trip the breaker and clearEffects() would wipe the
   animation mid-flight, which is the opposite of what the pacing is for. */
const STUCK_CEILING = 2.5;

const rollD20 = () => 1 + Math.floor(Math.random() * 20);

/** Initiative modifier: heroes use DEX; monsters derive theirs from speed. */
function initMod(e) {
  if (e._side === 'hero') return mod((e.data.effStats && e.data.effStats.dex) || 10) + featInitiativeBonus(e.data)   // Alert: +5
    + (e.data.initBonus || 0);   // Vigilance affix
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
    for (const m of this.monsters) if (m.active && m.data.hp > 0) {
      /* A dominated creature keeps its turn but is not a hostile: 'ally' so
         `engaged` below cannot be held open by the party's own thrall. */
      m._side = (typeof this.isDominated === 'function' && this.isDominated(m)) ? 'ally' : 'mon';
      parts.push(m);
    }
    return parts;
  },

  _currentActor() {
    const o = this.initiative.order;
    return (this.initiative.active && o.length && this.initiative.idx < o.length) ? o[this.initiative.idx] : null;
  },

  /**
   * The single gate every action path consults — combat.js, monster_ai.js,
   * turn_engine.js and pathfinding.js all ask this before letting an entity
   * move, attack or cast.
   *
   * `_awaitingReveal` returns false for EVERYONE, which is what actually
   * freezes the field during the combat-start roll-off. Parking
   * `updateInitiative` was not enough on its own: `_rollInitiative` sets
   * `active = true` and `idx = 0` before the reveal begins, so `_currentActor()`
   * already resolved to the top of the order and that combatant was free to act
   * through the whole animation — a hero would open with a spell before the
   * dice had finished landing.
   */
  isCurrentActor(e) {
    return !!(this.initiative
      && this.initiative.active
      && !this.initiative._awaitingReveal
      && this._currentActor() === e);
  },

  _beginTurn() {
    /* Reset the presentation beat. Every turn starts at ROUTINE, so even a
       silent turn settles briefly instead of snapping to the next actor; what
       the actor then does upgrades it. See fx_clock.js. */
    beginTurnFx();
    this.initiative._turnAge = 0;
    if (this._camDir) {
      this._camDir.subject = null;
      this._camDir.subjectUntil = 0;
    }
    if (typeof globalThis.clearCombatActionFocus === 'function') {
      globalThis.clearCombatActionFocus();
    }
    if (this.clearPendingMove) this.clearPendingMove();
    if (this.cancelAttackTargeting) this.cancelAttackTargeting();
    if (this.cancelSpellTargeting) this.cancelSpellTargeting();
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
      a._actionSurged = false;
      a._pendingAttacks = 0;
      a._castQueued = false;
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
      /* Spells that keep acting each round (Spiritual Weapon, Call Lightning…) */
      if (this.processTurnSustained) this.processTurnSustained(a);
    }
    this.fxUpdateInitTracker();
  },

  _rollInitiative(parts) {
    firstRunTip('initiative');
    for (const e of parts) { e._init = rollD20() + initMod(e); e._initTb = Math.random(); }
    /* Surprise from the dark (docs/LIGHT_IDEAS.md 6): whoever no enemy can see
       when the fight opens gets +5 — monsters lurking in an unlit room get
       the jump on a party without light, and a party creeping in the dark
       gets the jump on them. */
    const isMon = e => !!(this.monsters && this.monsters.includes(e));
    const hidden = { heroes: 0, monsters: 0 };
    for (const e of parts) {
      const foes = parts.filter(o => isMon(o) !== isMon(e) && o.data && o.data.hp > 0);
      if (foes.length && !foes.some(o => canSee(o, e))) {
        e._init += 5;
        if (this.D && this.D.timeOfDay === 'night') e._init += 2;   // 48: night ambushes bite harder
        hidden[isMon(e) ? 'monsters' : 'heroes']++;
      }
    }
    if (hidden.monsters && this.fxLog) this.fxLog('🌑 Something moves in the dark — the enemy strikes first!', 'crit');
    if (hidden.heroes && this.fxLog) this.fxLog('🌑 The party slips out of the dark and takes them by surprise!', 'crit');
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

    /* Combat-start roll-off. While it plays, nobody acts — updateInitiative
       parks on _awaitingReveal below and turn 1 begins when it finishes. If the
       reveal is disabled, unavailable (headless) or declines, fall straight
       through to the old behaviour. */
    const aliveRows = this.initiative.order.filter(e => this._actorAlive(e));
    /* Raise the freeze BEFORE starting the reveal, and lower it again only if
       the reveal declines. Setting it afterwards would leave a window in which
       `active` is true and idx is 0 — i.e. the top of the order is already the
       current actor and free to swing. */
    this.initiative._awaitingReveal = true;
    const revealing = !!(this.fxBeginInitiativeReveal &&
      this.fxBeginInitiativeReveal(this.initiative.order, aliveRows));
    if (revealing) return;
    this.initiative._awaitingReveal = false;

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
    /* Time Stop: the caster gets 1d4+1 turns in a row while everyone else is
       frozen. No clock advance either — no time passes for anyone else. */
    const cur = o[this.initiative.idx];
    /* The end of a turn. A burn here can kill the last foe and end the fight. */
    if (cur && this.processTurnEndZones) {
      this.processTurnEndZones(cur);
      if (!this.initiative.active) return;
    }
    if (cur && cur._timeStopTurns > 0 && cur.data && cur.data.hp > 0) {
      cur._timeStopTurns--;
      this.fxLog(`⏳ Time stands still — ${cur.data.name} acts again (${cur._timeStopTurns} more).`, 'sys');
      this.initiative.timer = TURN_TIME;
      this._beginTurn();
      return;
    }
    /* One spotlight has been spent — bank its share of the round before the
       next actor's effects are ticked, so durations burn down in rounds. */
    this._advanceCombatClock();
    let guard = 0;
    do {
      this.initiative.idx++;
      if (this.initiative.idx >= o.length) {
        this.initiative.idx = 0;
        this.initiative.round++;
        /* New round — clear the party's damage ledger. It records how much
           damage each hero has already promised to each monster this round so
           the rest of the party can route around targets that are already
           dead-on-arrival (see combat_eval.effectiveHp). */
        this.combatIntent = { allocated: new Map(), round: this.initiative.round };
        Trace._round = this.initiative.round;
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
    /* Before the effect sweep wipes 'dominated' and hands the creature back
       its own will next to a party that just won. */
    if (typeof this.resolveDominatedAtCombatEnd === 'function') this.resolveDominatedAtCombatEnd();
    if (typeof this.talentsFightEnd === 'function') this.talentsFightEnd();   // Arcane Recovery
    const seen = new Set();
    let cleared = 0;
    for (const e of this.initiative.order) {
      if (!e || seen.has(e)) continue;
      seen.add(e);
      delete e._auraProcessed;
      cleared += clearCombatEffects(e);
      /* Per-fight bookkeeping that predates the EFFECTS registry and so isn't
         reachable from clearCombatEffects. */
      if (e._side === 'mon' || e._side === 'ally') { e.burn = null; e.acid = null; e.cutWordsUntil = 0; e._noRegenUntil = 0; }
      this.fxStatusTray(e);
    }
    for (const h of this.heroes) {
      if (seen.has(h)) continue;
      seen.add(h);
      cleared += clearCombatEffects(h);
      this.fxStatusTray(h);
    }
    for (const h of this.heroes) {
      if (h.data && h.data.hp > 0 && typeof this.clearEntityPath === 'function') this.clearEntityPath(h);
    }
    /* Concentration can't outlive the spells it was holding up. */
    for (const h of this.heroes) if (h.conc && this.breakConcentration) this.breakConcentration(h, 'the fight ended');
    for (const h of this.heroes) { h.sustained = null; h._timeStopTurns = 0; }
    /* A creature still banished when the fight ends comes back (5e: it
       returns when the spell ends) — asleep, to be met again. */
    for (const m of this.monsters || []) if (m._banished) { this.returnBanished(m); m.active = false; m._threat = null; }

    if (cleared) {
      this.fxLog(`— the fight ends; ${cleared} lingering effect${cleared > 1 ? 's fade' : ' fades'} —`, 'sys');
      this.refreshHud();
    }
  },

  /**
   * Drive initiative once per combat frame. Called before updateMonsters so the
   * current actor's "ready" pulse is set before any acting happens this frame.
   */
  /** The current turn just did something (a follow-up strike fired): it is
      being watched, not stuck, so the deadlock breaker's clock restarts. */
  markTurnProgress() {
    if (this.initiative && this.initiative.active) this.initiative._turnAge = 0;
  },

  updateInitiative(dt) {
    /* The boss intro owns the screen: no roll-off may start under it. It is
       armed in the same frame, just before this runs, so without this the dice
       landed on top of the opening shot. The roll happens when it ends. */
    if (this.bossCutscene) return;
    const parts = this._initParticipants();
    const engaged = parts.some(e => e._side === 'mon');

    if (!engaged) {                       // no live aggroed monsters → combat over
      if (this.initiative.active) {
        this._endCombatEffects();
        this._initReset();
        this.initiative._awaitingReveal = false;
        if (this.fxResetPacing) this.fxResetPacing();
        this.fxUpdateInitTracker();
      }
      return;
    }

    if (!this.initiative.active) { this._rollInitiative(parts); return; }

    /* Roll-off in progress: hold every actor until the dice have landed in the
       rail, then start turn 1 exactly once. */
    if (this.initiative._awaitingReveal) {
      /* Real seconds, not combat-scaled — see game.js rawDt. */
      const playing = this.fxTickInitiativeReveal
        ? this.fxTickInitiativeReveal(this.rawDt != null ? this.rawDt : dt)
        : false;
      if (playing) return;
      this.initiative._awaitingReveal = false;
      this._beginTurn();
      return;
    }

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

    /* Is the screen still saying something? Either an effect is playing or this
       turn's read buffer hasn't elapsed. fx_clock.js owns both; in headless the
       hook is stubbed and this is always false, so the sim runs at full speed. */
    const presenting = this.fxHasActiveFX()
      || (this.fxTurnReady ? !this.fxTurnReady() : false);

    /* Hard ceiling: absolute deadlock breaker. Even when presenting, if 4 seconds
       pass without the turn making PROGRESS, forcibly clear hanging effects and
       advance. Progress, not the turn's start: a three-shot Multiattack is
       three full draw-release cycles back to back (see scheduleFollowUpStrike),
       and each strike that fires resets the age through markTurnProgress —
       otherwise a legitimately long volley tripped this every time, wiping
       its own arrows and zones mid-flight and snapping to the next actor. */
    this.initiative._turnAge = (this.initiative._turnAge || 0) + dt;
    const ceiling = presenting ? 4.0 : STUCK_CEILING;
    if (this.initiative._turnAge > ceiling) {
      console.warn('[initiative] Turn stuck ceiling hit (' + this.initiative._turnAge.toFixed(1) + 's) for actor:', cur?.data?.name || 'unknown', 'forcing turn advance',
        describeActor(this, cur),
        { presenting: !!presenting, lastMoves: Motion.dump(cur && cur.data && cur.data.name) });
      if (this.clearEffects && this.engine?.scene) this.clearEffects(this.engine.scene, { keepPersistentAoE: true });
      if (cur) {
        cur._pendingAttacks = 0;
        cur.moving = false;
        cur.actUsed = true;
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(cur);
      }
      this.initiative._turnAge = 0;
      this._advanceTurn();
      return;
    }

    /* Animation lock: in-flight visuals, an unfinished read buffer, or pending
       multi-attacks all hold the spotlight. This is the fix for casters being
       talked over — a spell's flight now blocks the next actor, where previously
       only the projectile pool was consulted and composite animations were
       invisible to this check entirely. */
    if (presenting || (cur && cur._pendingAttacks > 0)) return;
    /* A hero's cast or swing plays to its last frame before the spotlight
       moves on (combat.js heroCombat's busy gate holds the hero meanwhile). */
    if (cur && actionAnimBusy(cur, this)) return;

    /* Paced turn advance for AI actors (monsters or auto-mode heroes): the actor
       has acted, stopped moving, resolved its multi-attacks — and `presenting`
       above has already confirmed the visuals finished and the beat's dwell
       elapsed. The dwell length scales with what happened (routine hit vs. crit
       vs. kill); see BEAT_BUFFER in fx_clock.js. */
    if (cur && cur.actUsed && !cur.moving && (!cur._pendingAttacks || cur._pendingAttacks <= 0)) {
      this._advanceTurn();
      return;
    }

    /* Advance when the actor has exhausted movement and isn't going anywhere,
       even if it never got to use its action (e.g. target is unreachable). */
    if (cur && !cur.moving && (cur.moveLeft != null && cur.moveLeft <= 0) &&
        (!cur.path || cur.pathI >= cur.path.length)) {
      this._advanceTurn(); return;
    }

    /* Timer fallback: if actor is actively walking a valid path with remaining budget (e.g. Dash),
       keep timer refreshed so movement isn't truncated mid-sprint. A 1.5s watchdog prevents
       an actor stuck on an obstacle from refreshing the timer indefinitely. */
    if (cur && cur.moving && cur.path && cur.pathI < cur.path.length && (cur.moveLeft || 0) > 0) {
      cur._moveWaitT = (cur._moveWaitT || 0) + dt;
      if (cur._moveWaitT < 1.5) {
        this.initiative.timer = TURN_TIME;
      } else {
        cur.moving = false;
        if (typeof this.clearEntityPath === 'function') this.clearEntityPath(cur);
      }
    } else {
      if (cur) cur._moveWaitT = 0;
      this.initiative.timer -= dt;
      if (this.initiative.timer <= 0) this._advanceTurn();
    }
  }
};
