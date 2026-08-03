import { describe, it, expect, beforeEach } from 'vitest';
import { COMMAND, validateCommand, turnEngineMethods } from '../src/game/turn_engine.js';
import { exploreMethods } from '../src/game/explore.js';
import { combatMethods } from '../src/game/combat.js';

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
      D: { W: 20, H: 20, grid: new Uint8Array(400), rooms: [{ id: 0, cx: 5, cy: 5 }, { id: 1, cx: 10, cy: 10 }], roomId: new Int32Array(400) },
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

    Object.assign(game, turnEngineMethods, exploreMethods, combatMethods);
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

  it('enforces hero occupancy so heroes cannot stop on the same cell', () => {
    const heroA = game.heroes[0];
    const heroB = {
      data: { name: 'Kyra', hp: 20, maxHp: 20 },
      _side: 'hero',
      x: 5.5, z: 5.5
    };
    game.heroes.push(heroB);

    // Both heroes are at cell 105 (5,5)
    expect(game.cellOf(heroA.x, heroA.z)).toBe(105);
    expect(game.cellOf(heroB.x, heroB.z)).toBe(105);

    // Enforce occupancy when movement stops
    game.enforceHeroUnoccupiedCell(heroA);

    // heroA should have stepped to an adjacent unoccupied cell
    expect(game.cellOf(heroA.x, heroA.z)).not.toBe(105);
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
});
