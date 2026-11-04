import { describe, it, expect } from 'vitest';
import { FLOOR, WALL } from '../src/game/constants.js';
import {
  pathfindingMethods,
  buildSolidProps,
  buildSightBlockers,
  HALF_COVER_PROP_KINDS,
  isHalfCoverCell
} from '../src/game/pathfinding.js';
import { combatMethods } from '../src/game/combat.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { STEP } from '../src/dungeon/elevation.js';

describe('3D Line of Sight & Cover System', () => {
  function makeHarness(W = 10, H = 10, opts = {}) {
    const grid = new Uint8Array(W * H).fill(FLOOR);
    const height = new Int8Array(W * H).fill(0);
    const ramp = new Uint8Array(W * H).fill(0);
    const d = {
      W, H, grid, height, ramp,
      props: opts.props || [],
      rooms: [{ id: 0, cx: 5, cy: 5, w: 8, h: 8, type: 0 }]
    };
    d.solidProps = buildSolidProps(d);
    d.sightBlockers = buildSightBlockers(d, d.solidProps);

    const game = {
      D: d,
      heroes: [],
      monsters: [],
      wx: (x) => x - W / 2 + 0.5,
      wz: (y) => y - H / 2 + 0.5,
      cellOf: (x, z) => {
        const cx = Math.round(x + W / 2 - 0.5), cy = Math.round(z + H / 2 - 0.5);
        return (cx < 0 || cy < 0 || cx >= W || cy >= H) ? -1 : cy * W + cx;
      },
      _v3: (x, y, z) => ({ x, y, z }),
      fxLog: () => {},
      fxText: () => {},
      fxPlaySfx: () => {},
      fxProjectile: () => {},
      fxImpactDelay: (delay, fn) => fn(),
      ...pathfindingMethods,
      ...combatMethods,
      ...monsterAiMethods
    };
    return { game, d };
  }

  describe('3D Elevation-Aware Line of Sight', () => {
    it('blocks LOS through walls and tall sight-blocking pillars', () => {
      const { game, d } = makeHarness(10, 10, {
        props: [{ kind: 'pillar', x: 5, y: 5, roomId: 0 }]
      });
      // Wall block test
      d.grid[5 * 10 + 2] = WALL;
      const x0 = game.wx(2), z0 = game.wz(3);
      const x1 = game.wx(2), z1 = game.wz(7);
      expect(game.hasLOS(x0, z0, x1, z1)).toBe(false);

      // Pillar block test
      const px0 = game.wx(5), pz0 = game.wz(3);
      const px1 = game.wx(5), pz1 = game.wz(7);
      expect(game.hasLOS(px0, pz0, px1, pz1)).toBe(false);
    });

    it('blocks LOS when an elevated floor tier sits between two ground-level units', () => {
      const { game, d } = makeHarness(10, 10);
      // Shooter at (2, 5), Target at (8, 5) both at ground height 0
      // Raised tier at (5, 5) with height = 2 (1.6m high platform)
      d.height[5 * 10 + 5] = 2;

      const x0 = game.wx(2), z0 = game.wz(5);
      const x1 = game.wx(8), z1 = game.wz(5);

      // Without height, flat ground LOS would be clear
      expect(game.hasLOS(x0, z0, x1, z1)).toBe(false);
    });

    it('allows LOS when shooting from elevated ground downward', () => {
      const { game, d } = makeHarness(10, 10);
      // Shooter on elevated podium at (5, 5) with height = 2
      // Target on ground at (8, 5) with height = 0
      d.height[5 * 10 + 5] = 2;

      const x0 = game.wx(5), z0 = game.wz(5);
      const x1 = game.wx(8), z1 = game.wz(5);

      expect(game.hasLOS(x0, z0, x1, z1)).toBe(true);
    });
  });

  describe('D&D 5e Cover System', () => {
    it('classifies low waist-high props as half cover rather than sight blocking', () => {
      expect(HALF_COVER_PROP_KINDS.has('table')).toBe(true);
      expect(HALF_COVER_PROP_KINDS.has('coffin')).toBe(true);
      expect(HALF_COVER_PROP_KINDS.has('altarTable')).toBe(true);
      expect(HALF_COVER_PROP_KINDS.has('pillar')).toBe(false); // Pillars are full sight blockers
    });

    it('grants Total Cover when a thick pillar completely blocks the target', () => {
      const { game } = makeHarness(10, 10, {
        props: [{ kind: 'pillar', x: 5, y: 5, roomId: 0 }]
      });
      const attacker = { x: game.wx(5), z: game.wz(2) };
      const target = { x: game.wx(5), z: game.wz(8) };

      const cover = game.getCover(attacker, target);
      expect(cover.type).toBe('total');
    });

    it('grants Half Cover (+2 AC, +2 DEX) when target is behind a low table', () => {
      const { game } = makeHarness(10, 10, {
        props: [{ kind: 'table', x: 5, y: 5, roomId: 0 }]
      });
      const attacker = { x: game.wx(5), z: game.wz(2) };
      const target = { x: game.wx(5), z: game.wz(8) };

      const cover = game.getCover(attacker, target);
      expect(cover.type).toBe('half');
      expect(cover.acBonus).toBe(2);
      expect(cover.dexBonus).toBe(2);
    });

    it('grants Half Cover when an intervening creature stands in the line of fire', () => {
      const { game } = makeHarness(10, 10);
      const attacker = { x: game.wx(5), z: game.wz(2) };
      const target   = { x: game.wx(5), z: game.wz(8) };
      const bystander = { x: game.wx(5), z: game.wz(5), data: { hp: 20 } };

      game.heroes.push(attacker, bystander);
      game.monsters.push(target);

      const cover = game.getCover(attacker, target);
      expect(cover.type).toBe('half');
      expect(cover.acBonus).toBe(2);
    });

    it('grants No Cover when line of fire is completely open', () => {
      const { game } = makeHarness(10, 10);
      const attacker = { x: game.wx(2), z: game.wz(3) };
      const target   = { x: game.wx(8), z: game.wz(3) };

      const cover = game.getCover(attacker, target);
      expect(cover.type).toBe('none');
      expect(cover.acBonus).toBe(0);
    });
  });

  describe('Monster AI Ranged LOS Enforcement', () => {
    it('prevents a ranged monster from attacking through a solid wall or pillar', () => {
      const { game, d } = makeHarness(10, 10, {
        props: [{ kind: 'pillar', x: 5, y: 5, roomId: 0 }]
      });

      const monster = {
        x: game.wx(5), z: game.wz(2),
        data: { name: 'Skeleton Archer', ranged: true, rngRange: 10, atk: 4, hp: 12 },
        actUsed: false
      };
      const hero = {
        x: game.wx(5), z: game.wz(8),
        data: { name: 'Fighter', hp: 25, ac: 16 }
      };

      game.monsters.push(monster);
      game.heroes.push(hero);

      let shotFired = false;
      game.monsterRangedAttack = () => { shotFired = true; };

      // In monsterRanged, it should abort if no LOS
      game.monsterRanged(monster, hero, 0.016);
      expect(shotFired).toBe(false);
      expect(monster.actUsed).toBe(false);
    });
  });
});
