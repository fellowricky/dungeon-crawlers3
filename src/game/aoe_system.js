/**
 * Modular Persistent AoE Zone System for Dungeon Crawlers.
 *
 * Manages persistent 3D spell zones, concentration attachment, smooth lerp movement,
 * 5e SRD once-per-turn save tracking, turn start/end triggers, and visual archetypes
 * (cylinder, sphere, aura, ground, cloud, wall).
 */

import { roll } from './srd.js';
import { spellDC } from './spells.js';
import { applyEffect, hasEffect } from './conditions.js';
import { groundY } from '../dungeon/elevation.js';

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

    const baseElev = typeof game.groundYAt === 'function' ? game.groundYAt(x, z)
            : (game.D && typeof groundY === 'function' ? groundY(game.D, x, z) : 0);
    const y = options.y != null ? options.y : baseElev;

    // Create 3D visual without self-expiring timer (managed by zone lifecycle)
    const visual = game.fxAoEVisual({ x, y, z }, color, radius, null, { ...options, shape, y });

    const zone = {
      id: 'z_' + Math.floor(Math.random() * 1000000),
      caster,
      spellKey,
      x,
      y,
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

        const curY = zone.y != null ? zone.y : (zone.visual?.group?.position?.y ?? 0);
        zone.y = curY;
        if (zone.visual && zone.visual.group) {
          zone.visual.group.position.set(zone.x, curY, zone.z);
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
        const curY = typeof game.groundYAt === 'function' ? game.groundYAt(zone.x, zone.z)
                   : (game.D && typeof groundY === 'function' ? groundY(game.D, zone.x, zone.z) : (zone.y ?? 0));
        zone.y = curY;
        if (zone.visual && zone.visual.group) {
          zone.visual.group.position.set(zone.x, curY, zone.z);
        }
      } else if (zone.visual && zone.visual.group) {
        const curY = zone.y != null ? zone.y : (zone.visual.group.position?.y ?? 0);
        zone.y = curY;
        zone.visual.group.position.set(zone.x, curY, zone.z);
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
      if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
      zone.savesThisTurn.delete(actor);

      // 1. If actor is the caster starting their turn with an attached aura (e.g. Spirit Guardians)
      if (zone.caster === actor && zone.movement === 'attached') {
        zone.savesThisTurn.clear();
        const opposingList = actor._side === 'hero' ? (game.monsters || []) : (game.heroes || []);
        for (const foe of opposingList) {
          if (!foe.data || foe.data.hp <= 0 || foe.active === false || foe.dead) continue;
          if (isPointInAoEZone(foe.x, foe.z, zone)) {
            if (!zone.savesThisTurn.has(foe)) {
              zone.savesThisTurn.add(foe);
              if (zone.spellKey === 'spiritGuardians') {
                const dc = spellDC(zone.caster);
                let dmg = roll(3, 8, zone.caster.data?.dmgBonus || 0);
                const saved = game.spellSave(foe, 'wis', dc, { magic: true });
                if (saved) dmg = Math.floor(dmg / 2);
                game.spellDamage(foe, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
                game.fxLog(`👻 ${foe.data?.name || 'Target'} is engulfed by Spirit Guardians — ${saved ? 'saves (half dmg)' : 'fails save'}! (${dmg} radiant)`, saved ? 'roll' : 'crit');
              }
            }
          }
        }
      }

      // 2. If actor is an opposing creature starting its turn in the zone
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
          } else if (zone.spellKey === 'entangle') {
            // Creature starting turn in entangle must make STR save or be restrained
            if (!hasEffect(actor, 'restrained')) {
              const dc = spellDC(zone.caster);
              const saved = game.spellSave(actor, 'str', dc, { magic: true });
              if (!saved) {
                applyEffect(actor, 'restrained', {
                  duration: 60,
                  elapsed: game.fxNow,
                  source: zone.caster,
                  repeatSave: { ability: 'str', dc, every: 6 }
                });
                if (zone.caster?.conc?.targets) {
                  zone.caster.conc.targets.push({ e: actor, key: 'restrained' });
                }
                game.fxLog(`🌿 ${actor.data?.name || 'Target'} is ensnared by Entangle — RESTRAINED!`, 'crit');
              } else {
                game.fxLog(`🌿 ${actor.data?.name || 'Target'} avoids the grasping vines (STR save).`, 'miss');
              }
            }
          } else if (zone.spellKey === 'web') {
            if (!hasEffect(actor, 'restrained')) {
              const dc = spellDC(zone.caster);
              const saved = game.spellSave(actor, 'dex', dc, { magic: true });
              if (!saved) {
                applyEffect(actor, 'restrained', {
                  duration: 60,
                  elapsed: game.fxNow,
                  source: zone.caster,
                  repeatSave: { ability: 'str', dc, every: 6 }
                });
                if (zone.caster?.conc?.targets) {
                  zone.caster.conc.targets.push({ e: actor, key: 'restrained' });
                }
                game.fxLog(`🕸 ${actor.data?.name || 'Target'} is caught in webs — RESTRAINED!`, 'crit');
              }
            }
          }
        }
      }
    }
  }

  /**
   * Evaluates hazard triggers when an actor enters or traverses a grid cell.
   * Called per-waypoint step from turn_engine moveStep.
   */
  processStepZones(game, actor, fromCell, toCell) {
    const activeList = game.activeAoEZones || this.zones;
    if (!activeList || !activeList.length || !actor || !game.D) return;
    const { W } = game.D;
    const toX = typeof game.wx === 'function' ? game.wx(toCell % W) : ((toCell % W) + 0.5);
    const toZ = typeof game.wz === 'function' ? game.wz(Math.floor(toCell / W)) : (Math.floor(toCell / W) + 0.5);
    const fromX = typeof game.wx === 'function' ? game.wx(fromCell % W) : ((fromCell % W) + 0.5);
    const fromZ = typeof game.wz === 'function' ? game.wz(Math.floor(fromCell / W)) : (Math.floor(fromCell / W) + 0.5);

    for (const zone of activeList) {
      if (!actor.data || actor.data.hp <= 0 || actor.active === false) continue;

      // 1. Attached mobile auras (e.g. Spirit Guardians moving with the caster)
      if (zone.movement === 'attached' && zone.caster === actor) {
        const opposingEntities = actor._side === 'hero' ? (game.monsters || []) : (game.heroes || []);
        for (const foe of opposingEntities) {
          if (!foe.data || foe.data.hp <= 0 || foe.active === false || foe.dead) continue;
          if (Math.hypot(foe.x - toX, foe.z - toZ) <= (zone.radius || 3.0)) {
            if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
            if (!zone.savesThisTurn.has(foe)) {
              zone.savesThisTurn.add(foe);
              if (zone.spellKey === 'spiritGuardians') {
                const dc = spellDC(zone.caster);
                let dmg = roll(3, 8, zone.caster.data?.dmgBonus || 0);
                const saved = game.spellSave(foe, 'wis', dc, { magic: true });
                if (saved) dmg = Math.floor(dmg / 2);
                game.spellDamage(foe, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
                game.fxLog(`👻 ${foe.data?.name || 'Target'} enters Spirit Guardians — ${saved ? 'saves (half dmg)' : 'fails save'}! (${dmg} radiant)`, saved ? 'roll' : 'crit');
              }
            }
          }
        }
      }

      /* Entangle / web / grease are environmental: 5e they snare anyone who
         walks into the weeds, including allies. Other zones stay hostile-only. */
      const envHazard = zone.spellKey === 'entangle' || zone.spellKey === 'web' || zone.spellKey === 'grease';
      const isOpposing = zone.caster && zone.caster._side !== actor._side;
      if (!envHazard && !isOpposing) continue;

      const inTo = isPointInAoEZone(toX, toZ, zone);
      if (!inTo) continue;
      const inFrom = isPointInAoEZone(fromX, fromZ, zone);

      // Entangle: difficult terrain + saving throw against being restrained upon entering
      if (zone.spellKey === 'entangle') {
        if (!hasEffect(actor, 'restrained')) {
          if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
          if (!zone.savesThisTurn.has(actor)) {
            zone.savesThisTurn.add(actor);
            const dc = spellDC(zone.caster);
            const saved = game.spellSave(actor, 'str', dc, { magic: true });
            if (!saved) {
              applyEffect(actor, 'restrained', {
                duration: 60,
                elapsed: game.fxNow,
                source: zone.caster,
                repeatSave: { ability: 'str', dc, every: 6 }
              });
              if (zone.caster?.conc?.targets) {
                zone.caster.conc.targets.push({ e: actor, key: 'restrained' });
              }
              game.fxLog(`🌿 Grasping vines snare ${actor.data?.name || 'Foe'} — RESTRAINED!`, 'crit');
              actor.moveLeft = 0;
              if (typeof game.clearEntityPath === 'function') game.clearEntityPath(actor);
              else { actor.path = null; actor.pathI = 0; }
              break;
            } else {
              game.fxLog(`🌿 ${actor.data?.name || 'Foe'} pulls free from grasping vines (STR save)!`, 'roll');
            }
          }
        }
      } else if (zone.spellKey === 'spikeGrowth') {
        // Spike Growth: 2d4 piercing damage per 5 ft moved (each cell entered)
        const dmg = roll(2, 4, zone.caster.data?.dmgBonus || 0);
        game.spellDamage(actor, dmg, zone.caster, false, { dmgType: 'piercing', magical: true });
        game.fxLog(`🌵 Spikes pierce ${actor.data?.name || 'Target'} as it moves! (${dmg} piercing)`, 'crit');
        if (actor.data && actor.data.hp <= 0) break;
      } else if (zone.spellKey === 'web') {
        if (!hasEffect(actor, 'restrained')) {
          if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
          if (!zone.savesThisTurn.has(actor)) {
            zone.savesThisTurn.add(actor);
            const dc = spellDC(zone.caster);
            const saved = game.spellSave(actor, 'dex', dc, { magic: true });
            if (!saved) {
              applyEffect(actor, 'restrained', {
                duration: 60,
                elapsed: game.fxNow,
                source: zone.caster,
                repeatSave: { ability: 'str', dc, every: 6 }
              });
              if (zone.caster?.conc?.targets) {
                zone.caster.conc.targets.push({ e: actor, key: 'restrained' });
              }
              game.fxLog(`🕸 Webbing snares ${actor.data?.name || 'Foe'} — RESTRAINED!`, 'crit');
              actor.moveLeft = 0;
              if (typeof game.clearEntityPath === 'function') game.clearEntityPath(actor);
              else { actor.path = null; actor.pathI = 0; }
              break;
            } else {
              game.fxLog(`🕸 ${actor.data?.name || 'Foe'} evades the sticky webs (DEX save)!`, 'roll');
            }
          }
        }
      } else if (zone.spellKey === 'spiritGuardians') {
        // Creature enters Spirit Guardians for the first time on a turn
        if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
        if (!zone.savesThisTurn.has(actor)) {
          zone.savesThisTurn.add(actor);
          const dc = spellDC(zone.caster);
          let dmg = roll(3, 8, zone.caster.data?.dmgBonus || 0);
          const saved = game.spellSave(actor, 'wis', dc, { magic: true });
          if (saved) dmg = Math.floor(dmg / 2);
          game.spellDamage(actor, dmg, zone.caster, false, { dmgType: 'radiant', magical: true });
          game.fxLog(`👻 ${actor.data?.name || 'Target'} enters Spirit Guardians — ${saved ? 'saves (half dmg)' : 'fails save'}! (${dmg} radiant)`, saved ? 'roll' : 'crit');
          if (actor.data && actor.data.hp <= 0) break;
        }
      } else if (zone.spellKey === 'wallOfFire') {
        if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
        if (!zone.savesThisTurn.has(actor)) {
          zone.savesThisTurn.add(actor);
          const dc = spellDC(zone.caster);
          let dmg = roll(5, 8, zone.caster.data?.dmgBonus || 0);
          const saved = game.spellSave(actor, 'dex', dc, { magic: true });
          if (saved) dmg = Math.floor(dmg / 2);
          game.spellDamage(actor, dmg, zone.caster, false, { dmgType: 'fire', magical: true });
          game.fxLog(`🔥 ${actor.data?.name || 'Target'} enters Wall of Fire — ${saved ? 'saves (half dmg)' : 'fails save'}! (${dmg} fire)`, saved ? 'roll' : 'crit');
          if (actor.data && actor.data.hp <= 0) break;
        }
      } else if (zone.spellKey === 'grease') {
        if (!inFrom && !hasEffect(actor, 'prone')) {
          if (!zone.savesThisTurn) zone.savesThisTurn = new Set();
          if (!zone.savesThisTurn.has(actor)) {
            zone.savesThisTurn.add(actor);
            const dc = spellDC(zone.caster);
            const saved = game.spellSave(actor, 'dex', dc, { magic: true });
            if (!saved) {
              applyEffect(actor, 'prone', { duration: 6, elapsed: game.fxNow, source: zone.caster });
              game.fxLog(`🛢 ${actor.data?.name || 'Foe'} slips on grease and falls PRONE!`, 'crit');
              actor.moveLeft = Math.floor((actor.moveLeft || 0) / 2);
            }
          }
        }
      }
    }
  }

  /**
   * Checks if a dungeon grid cell is difficult terrain created by an active AoE zone.
   * Flying creatures ignore difficult terrain on the floor.
   */
  isDifficultTerrain(game, cell, mover = null) {
    const activeList = game.activeAoEZones || this.zones;
    if (!activeList || !activeList.length || cell < 0 || !game.D) return false;
    if (mover && typeof game.canFly === 'function' && game.canFly(mover)) return false;
    const { W } = game.D;
    const wx = typeof game.wx === 'function' ? game.wx(cell % W) : ((cell % W) + 0.5);
    const wz = typeof game.wz === 'function' ? game.wz(Math.floor(cell / W)) : (Math.floor(cell / W) + 0.5);
    for (const z of activeList) {
      if (z.options?.difficultTerrain || z.spellKey === 'entangle' || z.spellKey === 'web' || z.spellKey === 'spikeGrowth' || z.spellKey === 'grease' || z.spellKey === 'spiritGuardians') {
        if (isPointInAoEZone(wx, wz, z)) return true;
      }
    }
    return false;
  }
}

export const aoeZoneManager = new PersistentAoEZoneManager();
