import { describe, it, expect, beforeEach } from 'vitest';
import { COMMAND, validateCommand, turnEngineMethods } from '../src/game/turn_engine.js';
import { exploreMethods } from '../src/game/explore.js';
import { combatMethods } from '../src/game/combat.js';
import { pathfindingMethods } from '../src/game/pathfinding.js';
import { reservationMethods } from '../src/game/reservation.js';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    font: '',
    measureText: () => ({ width: 10 }),
    strokeText: () => {},
    fillText: () => {},
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {}
  };
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx
  };
  globalThis.document = {
    createElement: () => dummyEl,
    createElementNS: () => dummyEl,
    getElementById: () => null,
    querySelectorAll: () => []
  };
}

describe('Manual Mode & Action Economy', () => {
  let game;

  beforeEach(() => {
    const dummyCtx = {
      font: '',
      measureText: () => ({ width: 10 }),
      strokeText: () => {},
      fillText: () => {},
      clearRect: () => {},
      fillRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {}
    };

    game = {
      controlMode: 'auto',
      engine: { scene: { add: () => {}, remove: () => {} } },
      heroes: [
        {
          data: {
            name: 'Valeros',
            classKey: 'fighter',
            raceKey: 'human',
            hp: 30,
            maxHp: 30,
            level: 1,
            speedMult: 1,
            effStats: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
            weaponProfile: { name: 'Longsword', d: 8, n: 1, type: 'slashing', source: 'weapon' }
          },
          ent: { bar: { g: dummyCtx, cv: { width: 100, height: 10 }, tex: {} } },
          _side: 'hero',
          x: 5, z: 5,
          moveLeft: 6,
          actUsed: false,
          bonusUsed: false,
          cd: 0
        }
      ],
      monsters: [
        {
          data: { id: 'goblin', name: 'Goblin', hp: 12, maxHp: 12 },
          _side: 'mon',
          active: true,
          x: 6, z: 5
        }
      ],
      initiative: { active: true, order: [], idx: 0 },
      D: { W: 20, H: 20, grid: new Uint8Array(400).fill(1), rooms: [{ id: 0, cx: 5, cy: 5 }, { id: 1, cx: 10, cy: 10 }], roomId: new Int32Array(400) },
      roomAnchor: [100, 200],
      visitedRooms: [false, false],
      chests: [],
      shrines: [],
      userGoal: -1,
      targetRoom: -1,
      setControlMode(mode) {
        this.controlMode = (mode === 'manual') ? 'manual' : 'auto';
      },
      toggleControlMode() {
        this.setControlMode(this.controlMode === 'manual' ? 'auto' : 'manual');
      },
      _currentActor() {
        return this.heroes[0];
      },
      findMonsterTarget() {
        return this.monsters[0];
      },
      isCurrentActor(e) {
        return this._currentActor() === e;
      },
      findPath() {
        return [105, 106];
      },
      stepAlong() {
        return false;
      },
      nearFloorCell(c) {
        return c;
      },
      cellOf(x, z) {
        return Math.floor(z) * 20 + Math.floor(x);
      },
      wx(c) { return c; },
      wz(c) { return c; },
      pickNextRoom() { return 1; },
      roomDone() { return false; },
      roomTargetCell() { return 105; }
    };

    Object.assign(game, pathfindingMethods, turnEngineMethods, exploreMethods, combatMethods, reservationMethods);
    /* Re-apply stubs that pathfindingMethods overwrote (pathfindingMethods is
       mixed in only to provide the setEntityPath/clearEntityPath shims; the
       real ones come from reservationMethods below). */
    game.findPath = () => [105, 106];
    game.stepAlong = () => false;
    game.nearFloorCell = (c) => c;
    game.cellOf = (x, z) => Math.floor(z) * 20 + Math.floor(x);
    game.wx = (c) => c;
    game.wz = (c) => c;
    game.playAbilityFx = () => {};
    // Hook stubs (real implementations come from game_hooks.js in the browser)
    game.fxLog = () => {};
    game.fxText = () => {};
    game.fxStatusTray = () => {};
    game.fxDrawBar = () => {};
    game.fxHitFlash = () => {};
    game.fxUpdateManualBar = () => {};
    game.fxUpdateInitTracker = () => {};
    game.refreshHud = () => {};
    game.refreshResources = () => {};
    game.fxAoEVisual = () => ({ group: {} });
    game.fxRemoveAoEVisual = () => {};
    game.fxPlaySfx = () => {};
    game.fxShowBanner = () => {};
    game.fxRefreshMenus = () => {};
    game.fxSchedule = (_ms, fn) => fn();
    game._v3 = (x, y, z) => ({ x, y, z });
    game.triggerHitStop = () => {};
    game.triggerShake = () => {};
    game.triggerSlowMo = () => {};
    game.fxDeathFountain = () => {};
    game.fxMeleeHitVFX = () => {};
    game.fxSlash = () => {};
    game.fxSprite = () => {};
    game.fxProjectile = (_from, _to, _kind, _color, onHit) => { if (onHit) onHit(); };
    game.initiative.order = [game.heroes[0], game.monsters[0]];
  });

  it('toggles between auto and manual control mode', () => {
    expect(game.controlMode).toBe('auto');
    game.toggleControlMode();
    expect(game.controlMode).toBe('manual');
    game.toggleControlMode();
    expect(game.controlMode).toBe('auto');
  });

  it('validates movement and action budgets accurately', () => {
    const hero = game.heroes[0];
    expect(validateCommand({ type: COMMAND.MOVE }, hero).ok).toBe(true);
    expect(validateCommand({ type: COMMAND.ATTACK }, hero).ok).toBe(true);

    hero.actUsed = true;
    expect(validateCommand({ type: COMMAND.ATTACK }, hero).ok).toBe(false);
    expect(validateCommand({ type: COMMAND.BONUS }, hero).ok).toBe(true);

    hero.bonusUsed = true;
    expect(validateCommand({ type: COMMAND.BONUS }, hero).ok).toBe(false);
    expect(validateCommand({ type: COMMAND.END }, hero).ok).toBe(true);
  });

  it('suppresses auto room selection in manual mode during exploration', () => {
    const leader = game.heroes[0];
    game.controlMode = 'manual';
    game.targetRoom = -1;
    game.exploreAI(game.heroes, leader, 0.1);
    expect(leader.moving).toBe(false);
    expect(game.targetRoom).toBe(-1);

    game.controlMode = 'auto';
    game.targetRoom = -1;
    game.pickNextRoom = () => 1;
    game.exploreAI(game.heroes, leader, 0.1);
    expect(game.targetRoom).toBe(1);
  });

  it('handles Dash action by increasing movement budget and setting actUsed', () => {
    const hero = game.heroes[0];
    const initialMove = hero.moveLeft;
    const ok = game.manualPerformCommonAction(hero, 'dash');
    expect(ok).toBe(true);
    expect(hero.actUsed).toBe(true);
    expect(hero.moveLeft).toBeGreaterThan(initialMove);
  });

  it('handles Dodge and Disengage common actions', () => {
    const hero = game.heroes[0];
    hero.actUsed = false;
    expect(game.manualPerformCommonAction(hero, 'dodge')).toBe(true);
    expect(hero.dodgeActive).toBe(true);

    hero.actUsed = false;
    expect(game.manualPerformCommonAction(hero, 'disengage')).toBe(true);
    expect(hero.disengageActive).toBe(true);
  });

  it('handles manual bonus action ability Second Wind', () => {
    const hero = game.heroes[0];
    hero.data.hp = 10;
    hero.data.secondWind = true;
    const ok = game.manualPerformBonusAbility(hero, 'secondWind');
    expect(ok).toBe(true);
    expect(hero.bonusUsed).toBe(true);
    expect(hero.data.secondWindUsed).toBe(true);
    expect(hero.data.hp).toBeGreaterThan(10);
  });

  it('melee attack out of reach with no movement fails (does not auto-walk)', () => {
    const hero = game.heroes[0];
    hero.actUsed = false;
    hero.moveLeft = 0;
    hero.data.weaponProfile = { name: 'Longsword', melee: true, dmg: [1, 8], ability: 'str', source: 'weapon', dmgType: 'slashing' };
    // Goblin normally at (6,5); move it 4 tiles away so melee reach (1) misses.
    const foe = game.monsters[0];
    foe.x = 9; foe.z = 5;
    const ok = game.manualPerformAttack(hero, foe);
    expect(ok).toBe(false);
    expect(hero.actUsed).toBe(false);
  });

  it('thrown attack hits a distant foe without spending movement', () => {
    const hero = game.heroes[0];
    hero.actUsed = false;
    hero.moveLeft = 0;
    hero.data.weaponProfile = { name: 'Handaxe', melee: true, thrown: true, range: 6, dmg: [1, 6], ability: 'str', source: 'weapon', dmgType: 'slashing' };
    const foe = game.monsters[0];
    foe.x = 9; foe.z = 5; // 4 tiles away — within thrown range (6), beyond melee (1)
    let rolledWith = null;
    game.heroAttackRoll = (h, f, alive, opts) => { rolledWith = opts; };
    const ok = game.manualPerformAttack(hero, foe, 'thrown');
    expect(ok).toBe(true);
    expect(hero.actUsed).toBe(true);
    expect(hero.moveLeft).toBe(0); // movement untouched
    expect(rolledWith).not.toBeNull();
    expect(rolledWith.profile.melee).toBe(false);
    expect(rolledWith.profile.thrown).toBe(true);
  });

  it('thrown attack beyond range reports out of range instead of walking', () => {
    const hero = game.heroes[0];
    hero.actUsed = false;
    hero.moveLeft = 6;
    hero.data.weaponProfile = { name: 'Handaxe', melee: true, thrown: true, range: 6, dmg: [1, 6], ability: 'str', source: 'weapon', dmgType: 'slashing' };
    const foe = game.monsters[0];
    foe.x = 5; foe.z = 12; // 7 tiles away — outside 6-tile thrown range
    game.heroAttackRoll = () => { throw new Error('should not roll'); };
    const ok = game.manualPerformAttack(hero, foe, 'thrown');
    expect(ok).toBe(false);
    expect(hero.actUsed).toBe(false);
    expect(hero.moveLeft).toBe(6); // didn't try to walk
  });

  it('prevents hero occupancy collisions via placeAtFreeCell (reservation system)', () => {
    /* The old post-hoc enforceHeroUnoccupiedCell teleport was replaced by the
       reservation system: placeAtFreeCell picks a FREE cell near the requested
       position, so two heroes never land on the same tile in the first place. */
    const heroA = game.heroes[0];           // already at (5,5) = cell 105
    const heroB = {
      data: { name: 'Kyra', hp: 20, maxHp: 20 },
      _side: 'hero',
      x: 5, z: 5
    };
    game.heroes.push(heroB);

    // heroA occupies cell 105 already
    expect(game.cellOf(heroA.x, heroA.z)).toBe(105);

    // Place heroB near the same spot — reservation must route it to a free cell.
    game.placeAtFreeCell(heroB, 5, 5, { radius: 2 });

    // heroB must NOT have landed on heroA's cell.
    expect(game.cellOf(heroB.x, heroB.z)).not.toBe(105);
  });

  it('activates AOE spell targeting mode with ground visual ring', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    const ok = game.manualPerformSpell(hero, 'fireball');
    expect(ok).toBe(true);
    expect(game.targetingState).toBeDefined();
    expect(game.targetingState.active).toBe(true);
    expect(game.targetingState.spellKey).toBe('fireball');
    expect(game.targetingState.radius).toBe(4.0);

    // Cancel targeting
    game.cancelSpellTargeting();
    expect(game.targetingState).toBeNull();
  });

  it('does not ask where to aim Thunderwave, which goes off round the caster', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.slots = { 1: 2 };
    hero.data.knownSpells = ['thunderwave'];
    game.spellDamage = () => {};   // the bench's monsters have no health bar to draw on
    game.manualPerformSpell(hero, 'thunderwave');
    expect(game.targetingState).toBeFalsy();
  });

  it('immediately casts self and party buffs without entering ground targeting', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.slots = { 1: 2 };
    hero.data.knownSpells = ['shield', 'bless'];

    // Shield is self-targeted
    const okShield = game.manualPerformSpell(hero, 'shield');
    expect(okShield).toBe(true);
    expect(game.targetingState).toBeFalsy();

    // Reset action for next cast
    hero.actUsed = false;

    // Bless is party-targeted
    const okBless = game.manualPerformSpell(hero, 'bless');
    expect(okBless).toBe(true);
    expect(game.targetingState).toBeFalsy();
  });

  /* Find Familiar (and the other party-wide buffs that take no target) had no
     targetType, so manual mode sent them into "click a target" aiming mode —
     with nothing to click out of combat, the run just sat there. */
  it('casts targetless summons and party buffs outright instead of aiming them', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.classKey = 'wizard';
    hero.data.level = 9;
    hero.data.slots = { 1: 2, 2: 2, 3: 2, 8: 1, 9: 1 };
    hero.data.charges = hero.data.charges || {};
    game.summons = game.summons || { spawn: () => ({ data: { name: 'Owl Familiar' } }) };
    for (const key of ['findFamiliar', 'passWithoutTrace', 'crusadersMantle', 'mindBlank', 'foresight']) {
      hero.actUsed = false;
      hero.data.knownSpells = [key];
      game.manualPerformSpell(hero, key);
      expect(game.targetingState, `${key} entered targeting mode`).toBeFalsy();
    }
  });

  it('allows casting Cure Wounds on wounded ally in manual mode even above 60% HP', () => {
    const hero = game.heroes[0];
    hero.data.hp = 25; // 25/30 = 83% HP (above AI 60% cutoff)
    hero.data.slots = { 1: 2 };
    hero.data.knownSpells = ['cureWounds'];
    hero.actUsed = false;
    game.controlMode = 'manual';

    const ok = game.manualPerformSpell(hero, 'cureWounds', hero, null, 1);
    expect(ok).toBe(true);
    expect(hero.actUsed).toBe(true);
    expect(hero.data.hp).toBeGreaterThan(25);
  });

  it('manualEndTurn cancels active targeting and pending moves cleanly', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    game.targetingState = { active: true, hero, spellKey: 'fireball' };
    game.attackTargetingState = { active: true, hero };
    game.pendingMoveState = { active: true, hero, goalCell: 105 };

    game.manualEndTurn();
    expect(game.targetingState).toBeNull();
    expect(game.attackTargetingState).toBeNull();
    expect(game.pendingMoveState).toBeNull();
  });

  it('Extra Attack allows attacking a second target after killing the first target', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.features = ['extraAttack'];
    hero.data.weaponProfile = { name: 'Longbow', melee: false, range: 12, dmg: [1, 8], ability: 'dex', source: 'weapon' };

    const foe1 = game.monsters[0];
    foe1.data.hp = 5;
    const foe2 = {
      data: { id: 'goblin_2', name: 'Goblin 2', hp: 12, maxHp: 12 },
      _side: 'mon',
      active: true,
      x: 7, z: 5
    };
    game.monsters.push(foe2);

    // Attack 1: kills foe1
    game.heroPerformAttack = (_h, f) => { f.data.hp = 0; return 0.2; };
    const ok1 = game.manualPerformAttack(hero, foe1);
    expect(ok1).toBe(true);
    expect(foe1.data.hp).toBe(0);
    expect(hero.actUsed).toBe(false);
    expect(hero.attacksLeft).toBe(1);
    expect(hero.attackActionCommitted).toBe(true);

    // Hero moves 10 ft (2 cells) between attacks
    hero.moveLeft -= 2;
    expect(hero.moveLeft).toBe(4);

    // Attack 2: hits foe2 and consumes the remaining attack
    game.heroPerformAttack = (_h, f) => { f.data.hp -= 6; return 0.2; };
    const ok2 = game.manualPerformAttack(hero, foe2);
    expect(ok2).toBe(true);
    expect(foe2.data.hp).toBe(6);
    expect(hero.actUsed).toBe(true);
    expect(hero.attacksLeft).toBe(0);
    expect(hero.attackActionCommitted).toBe(false);
  });

  it('single attack hero sets actUsed on first strike', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.features = [];
    const foe = game.monsters[0];
    foe.data.hp = 12;

    game.heroPerformAttack = (_h, f) => { f.data.hp -= 5; return 0.2; };
    const ok = game.manualPerformAttack(hero, foe);
    expect(ok).toBe(true);
    expect(hero.actUsed).toBe(true);
    expect(hero.attacksLeft).toBe(0);
  });

  it('disallows casting action spell when Attack action has extra attacks remaining', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    hero.data.features = ['extraAttack'];
    hero.data.slots = { 3: 1 };
    hero.data.knownSpells = ['fireball'];
    const foe1 = game.monsters[0];
    foe1.data.hp = 5;

    // First attack kills foe1
    game.heroPerformAttack = (_h, f) => { f.data.hp = 0; return 0.2; };
    game.manualPerformAttack(hero, foe1);
    expect(hero.attacksLeft).toBe(1);
    expect(hero.attackActionCommitted).toBe(true);

    // Try to cast an action spell (Fireball) -> rejected
    const castOk = game.manualPerformSpell(hero, 'fireball');
    expect(castOk).toBe(false);
    expect(hero.actUsed).toBe(false);
  });

  it('re-arms attack targeting if hero has attacks remaining', () => {
    const hero = game.heroes[0];
    game.controlMode = 'manual';
    game.state = 'crawl';
    hero.data.features = ['extraAttack'];
    const foe1 = game.monsters[0];
    foe1.data.hp = 5;

    game.startAttackTargeting(hero, 'thrown');
    expect(game.attackTargetingState).not.toBeNull();
    expect(game.attackTargetingState.active).toBe(true);

    // Simulate clicking foe1 on map
    game.heroPerformAttack = (_h, f) => { f.data.hp = 0; return 0.2; };
    game.commandMove(6, 5);

    expect(foe1.data.hp).toBe(0);
    expect(hero.attacksLeft).toBe(1);
    expect(hero.actUsed).toBe(false);
    expect(game.attackTargetingState).not.toBeNull();
    expect(game.attackTargetingState.active).toBe(true);
    expect(game.attackTargetingState.profileOverride).toBe('thrown');
  });
});
