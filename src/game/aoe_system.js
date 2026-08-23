/**
 * Modular Persistent AoE Zone System for Dungeon Crawlers.
 *
 * Manages persistent 3D spell zones, concentration attachment, smooth lerp movement,
 * 5e SRD once-per-turn save tracking, turn start/end triggers, and visual archetypes
 * (cylinder, sphere, aura, ground, cloud, wall).
 */

import { roll } from './srd.js';
import { spellDC } from './spells.js';

/**
 * Checks if a 2D point (px, pz) lies within a straight line segment with half-width.
 * (sx, sz) = start, (ex, ez) = end, halfWidth = thickness / 2.
 */
export function isPointInLineSegment(px, pz, sx, sz, ex, ez, halfWidth = 0.5) {
  const dx = ex - sx;
  const dz = ez - sz;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) {
    return Math.hypot(px - sx, pz - sz) <= halfWidth;
  }
  // Project point onto line segment clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (pz - sz) * dz) / lenSq));
  const projX = sx + t * dx;
  const projZ = sz + t * dz;
  return Math.hypot(px - projX, pz - projZ) <= halfWidth;
}

/**
 * Checks if a point (px, pz) is within a 2D directional cone.
 * (sx, sz) = apex/origin, (dirX, dirZ) = direction vector, range = max distance,
 * halfAngleRad = cone half angle (default ~30 deg / 0.52 rad).
 */
export function isPointInCone(px, pz, sx, sz, dirX, dirZ, range, halfAngleRad = 0.55) {
  const vx = px - sx;
  const vz = pz - sz;
  const dist = Math.hypot(vx, vz);
  if (dist === 0) return true;
  if (dist > range + 0.3) return false;
  const dirDist = Math.hypot(dirX, dirZ) || 1.0;
  const uDirX = dirX / dirDist;
  const uDirZ = dirZ / dirDist;
  const dot = (vx / dist) * uDirX + (vz / dist) * uDirZ;
  return dot >= Math.cos(halfAngleRad);
}

/**
 * Checks if a point (px, pz) is within an active AoE zone (handles radial and line/wall shapes).
 */
export function isPointInAoEZone(px, pz, zone) {
  if (!zone) return false;
  if (zone.shape === 'line' || zone.options?.shape === 'line') {
    const sx = zone.startX != null ? zone.startX : (zone.options?.startX ?? zone.x);
    const sz = zone.startZ != null ? zone.startZ : (zone.options?.startZ ?? zone.z);
    const ex = zone.endX != null ? zone.endX : (zone.options?.endX ?? zone.x);
    const ez = zone.endZ != null ? zone.endZ : (zone.options?.endZ ?? zone.z);
    const halfWidth = (zone.options?.width != null ? zone.options.width : (zone.width || 1.0)) * 0.5;
    return isPointInLineSegment(px, pz, sx, sz, ex, ez, halfWidth + 0.2);
  }
  const cx = zone.spellKey === 'spiritGuardians' ? (zone.caster?.x ?? zone.x) : zone.x;
  const cz = zone.spellKey === 'spiritGuardians' ? (zone.caster?.z ?? zone.z) : zone.z;
  const r = zone.radius || 2.0;
  return Math.hypot(px - cx, pz - cz) <= r;
}

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
      startX: options.startX != null ? options.startX : x,
      startZ: options.startZ != null ? options.startZ : z,
      endX: options.endX != null ? options.endX : x,
      endZ: options.endZ != null ? options.endZ : z,
      width: options.width || 1.0,
      length: options.length || radius * 2,
      angle: options.angle || 0,
      movement,
      savesThisTurn: new Set(),
      affectedTargets: new Set(),
      slotLevel: options.slotLevel || 2,
      saveAbility: options.saveAbility || 'con',
      damageType: options.damageType || 'radiant',
      isMoving: false,
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
      const isOpposing = zone.caster && zone.caster._side !== actor._side;
      if (!isOpposing || !actor.data || actor.data.hp <= 0 || actor.active === false) continue;

      if (isPointInAoEZone(actor.x, actor.z, zone)) {
        if (!zone.savesThisTurn.has(actor)) {
          zone.savesThisTurn.add(actor);
          if (zone.spellKey === 'moonbeam') {
            game.resolveMoonbeamDamage(zone, actor);
          } else if (zone.spellKey === 'wallOfFire') {
            const dc = spellDC(zone.caster);
            let dmg = roll(5, 8, zone.caster.data?.dmgBonus || 0);
            const saved = game.spellSave(actor, 'dex', dc, { magic: true });
            if (saved) dmg = Math.floor(dmg / 2);
            game.spellDamage(actor, dmg, zone.caster, false, { dmgType: 'fire', magical: true });
            game.fxLog(`🔥 ${actor.data?.name || 'Target'} ${saved ? 'saves (half dmg)' : 'fails save'} vs Wall of Fire! (${dmg} fire)`, saved ? 'roll' : 'crit');
          } else if (zone.spellKey === 'spiritGuardians') {
            const dc = spellDC(zone.caster);
            let dmg = roll(3, 8, zone.caster.data?.dmgBonus || 0);
            const saved = game.spellSave(actor, 'wis', dc, { magic: true });
            if (saved) dmg = Math.floor(dmg / 2);
            game.spellDamage(actor, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
            game.fxLog(`👻 ${actor.data?.name || 'Target'} ${saved ? 'saves (half dmg)' : 'fails save'} vs Spirit Guardians! (${dmg} radiant)`, saved ? 'roll' : 'crit');
          }
        }
      }
    }
  }
}

export const aoeZoneManager = new PersistentAoEZoneManager();
