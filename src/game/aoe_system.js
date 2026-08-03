/**
 * Modular Persistent AoE Zone System for Dungeon Crawlers.
 *
 * Manages persistent 3D spell zones, concentration attachment, smooth lerp movement,
 * 5e SRD once-per-turn save tracking, turn start/end triggers, and visual archetypes
 * (cylinder, sphere, aura, ground, cloud, wall).
 */

import { roll } from './srd.js';
import { spellDC } from './spells.js';

export class PersistentAoEZoneManager {
  constructor() {
    this.zones = [];
  }

  /**
   * Spawns a persistent Area of Effect (AoE) zone.
   * @param {object} game Engine / combat context
   * @param {object} caster Entity casting the spell
   * @param {string} spellKey SPELLS registry key
   * @param {number} x Target world X coordinate
   * @param {number} z Target world Z coordinate
   * @param {number} radius Radius of effect in world units
   * @param {object} options Zone options (shape, movement, dur, saveAbility, damageType, etc.)
   */
  spawnZone(game, caster, spellKey, x, z, radius, options = {}) {
    const color = options.color || 0xffffff;
    const shape = options.shape || (options.cylinderBeam ? 'cylinder' : 'ground');
    const movement = options.movement || (spellKey === 'spiritGuardians' ? 'attached' : 'stationary');
    const dur = options.dur || null;

    // Create 3D visual without self-expiring timer (managed by zone lifecycle)
    const visual = game.fxAoEVisual({ x, z }, color, radius, null, { ...options, shape });

    const zone = {
      id: 'z_' + Math.floor(Math.random() * 1000000),
      caster,
      spellKey,
      x,
      z,
      radius,
      visual,
      dur,
      elapsed: 0,
      options,
      shape,
      movement,
      savesThisTurn: new Set(),
      affectedTargets: new Set(),
      slotLevel: options.slotLevel || 2,
      saveAbility: options.saveAbility || 'con',
      damageType: options.damageType || 'radiant',
      isMoving: false,
      startX: x,
      startZ: z,
      targetX: x,
      targetZ: z,
      moveT: 0,
      moveDuration: 0.5
    };

    if (!game.activeAoEZones) game.activeAoEZones = [];
    game.activeAoEZones.push(zone);
    this.zones.push(zone);
    return zone;
  }

  /**
   * Smoothly glides a zone to a new target location over moveDuration seconds.
   */
  moveZone(zone, newX, newZ, moveDuration = 0.5) {
    if (!zone) return;
    zone.startX = zone.x;
    zone.startZ = zone.z;
    zone.targetX = newX;
    zone.targetZ = newZ;
    zone.moveT = 0;
    zone.moveDuration = moveDuration || 0.5;
    zone.isMoving = true;
  }

  /**
   * Disposes and removes a persistent AoE zone.
   */
  removeZone(game, zone) {
    if (!zone) return;
    if (game && game.activeAoEZones) {
      const idx = game.activeAoEZones.indexOf(zone);
      if (idx >= 0) game.activeAoEZones.splice(idx, 1);
    }
    const idx2 = this.zones.indexOf(zone);
    if (idx2 >= 0) this.zones.splice(idx2, 1);

    if (zone.visual && game && game.fxRemoveAoEVisual) {
      game.fxRemoveAoEVisual(zone.visual);
    }
  }

  /**
   * Frame update tick for all active zones.
   */
  updateZones(game, dt) {
    const activeList = game.activeAoEZones || this.zones;
    if (!activeList || !activeList.length) return;

    for (let i = activeList.length - 1; i >= 0; i--) {
      const zone = activeList[i];
      zone.elapsed += dt;

      // Caster dead/inactive -> remove zone
      if (zone.caster.data.hp <= 0 || zone.caster.active === false) {
        this.removeZone(game, zone);
        continue;
      }

      // Smooth position interpolation (lerp with cubic ease-in-out)
      if (zone.isMoving) {
        zone.moveT = (zone.moveT || 0) + dt;
        const progress = Math.min(1.0, zone.moveT / (zone.moveDuration || 0.5));
        const ease = progress * progress * (3 - 2 * progress);
        zone.x = zone.startX + (zone.targetX - zone.startX) * ease;
        zone.z = zone.startZ + (zone.targetZ - zone.startZ) * ease;

        if (zone.visual && zone.visual.group) {
          zone.visual.group.position.set(zone.x, 0.33, zone.z);
        }
        if (progress >= 1.0) {
          zone.x = zone.targetX;
          zone.z = zone.targetZ;
          zone.isMoving = false;
        }
      } else if (zone.movement === 'attached') {
        // Caster-attached moving auras (e.g. Spirit Guardians)
        zone.x = zone.caster.x;
        zone.z = zone.caster.z;
        if (zone.visual && zone.visual.group) {
          zone.visual.group.position.set(zone.x, 0.33, zone.z);
        }
      } else if (zone.visual && zone.visual.group) {
        zone.visual.group.position.set(zone.x, 0.33, zone.z);
      }

      // Interval tick processing
      const TICK_INTERVAL = 1.0;
      zone.tickTimer = (zone.tickTimer || 0) - dt;

      if (zone.tickTimer <= 0) {
        zone.tickTimer = TICK_INTERVAL;

        const list = (zone.caster._side === 'mon' ? game.heroes : game.monsters) || [];
        const targets = list.filter(m =>
          m.data && m.data.hp > 0 && m.active !== false && Math.hypot(m.x - zone.x, m.z - zone.z) <= zone.radius
        );

        if (targets.length > 0) {
          for (const m of targets) {
            if (zone.spellKey === 'moonbeam') {
              if (!zone.savesThisTurn.has(m)) {
                zone.savesThisTurn.add(m);
                game.resolveMoonbeamDamage(zone, m);
              }
            } else if (zone.spellKey === 'spiritGuardians') {
              const dc = spellDC(zone.caster);
              let dmg = roll(3, 8, zone.caster.data.dmgBonus || 0);
              if (game.spellSave(m, 'wis', dc, { magic: true })) dmg = Math.floor(dmg / 2);
              game.spellDamage(m, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
            } else if (zone.spellKey === 'wallOfFire') {
              const dc = spellDC(zone.caster);
              let dmg = roll(5, 8, zone.caster.data.dmgBonus || 0);
              if (game.spellSave(m, 'dex', dc, { magic: true })) dmg = Math.floor(dmg / 2);
              game.spellDamage(m, dmg, zone.caster, false, { dmgType: 'fire', magical: true });
            }
          }
        }
      }

      // Real-time duration check (if specified)
      if (zone.dur != null && zone.elapsed >= zone.dur) {
        this.removeZone(game, zone);
      }
    }
  }

  /**
   * Resets per-turn save records when an actor starts its turn, and checks standing zone triggers.
   */
  processTurnZones(game, actor) {
    const activeList = game.activeAoEZones || this.zones;
    if (!activeList || !activeList.length || !actor) return;

    for (const zone of activeList) {
      if (zone.savesThisTurn) zone.savesThisTurn.delete(actor);
      if (zone.spellKey === 'moonbeam') {
        const isOpposing = zone.caster._side !== actor._side;
        if (isOpposing && Math.hypot(actor.x - zone.x, actor.z - zone.z) <= zone.radius) {
          if (!zone.savesThisTurn.has(actor)) {
            zone.savesThisTurn.add(actor);
            game.resolveMoonbeamDamage(zone, actor);
          }
        }
      }
    }
  }
}

export const aoeZoneManager = new PersistentAoEZoneManager();
