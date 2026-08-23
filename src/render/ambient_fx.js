/**
 * AMBIENT & ATMOSPHERIC PARTICLE ENGINE
 * Manages torch sconce micro-embers and environmental liquid ripples using NixieFX.
 */
import * as THREE from 'three';
import {
  playNixieEffect,
  stopNixieEffect
} from './nixie_vfx.js';

let _currentThemeKey = null;
const _activeTorchEmitters = new Map(); // torchKey -> nixieInstance

/**
 * Initialize ambient atmosphere for a newly built dungeon floor.
 */
export function initAmbientFX(scene, camera, themeName, entrancePos = null) {
  clearAmbientFX();
  _currentThemeKey = themeName || 'Dungeon';
}

/**
 * Update localized torch emitters within party proximity.
 */
export function updateAmbientFX(partyPos, visibleTorches = [], dt = 0.016) {
  if (!partyPos) return;

  // Manage localized micro-embers for torches within visible camera range (< 14 units)
  const currentVisibleKeys = new Set();
  const maxTorches = 16;
  let count = 0;

  for (const torch of visibleTorches) {
    if (count >= maxTorches) break;
    const dist = Math.hypot(torch.x - partyPos.x, torch.z - partyPos.z);
    if (dist > 14) continue;

    const key = `${torch.x.toFixed(1)}_${torch.z.toFixed(1)}`;
    currentVisibleKeys.add(key);

    if (!_activeTorchEmitters.has(key)) {
      const inst = playNixieEffect('torch_embers', new THREE.Vector3(torch.x, (torch.y || 1.1), torch.z), {
        duration: null,
        scale: 0.4
      });
      if (inst) {
        _activeTorchEmitters.set(key, inst);
      }
    }
    count++;
  }

  // Despawn torch emitters that are no longer within range
  for (const [key, inst] of _activeTorchEmitters.entries()) {
    if (!currentVisibleKeys.has(key)) {
      stopNixieEffect(inst);
      _activeTorchEmitters.delete(key);
    }
  }
}

/**
 * Trigger dynamic water/liquid step ripples and splash droplets.
 */
export function triggerLiquidSplashFX(pos, liquidType = 'water') {
  const effectKey = liquidType === 'lava'
    ? 'torch_embers'
    : liquidType === 'acid' || liquidType === 'poison'
    ? 'poison_burst'
    : 'frost_nova';

  playNixieEffect(effectKey, new THREE.Vector3(pos.x, 0.15, pos.z), {
    duration: 0.35,
    scale: 0.35
  });
}

/**
 * Clear all ambient emitters on floor transition or scene destruction.
 */
export function clearAmbientFX() {
  for (const inst of _activeTorchEmitters.values()) {
    stopNixieEffect(inst);
  }
  _activeTorchEmitters.clear();
  _currentThemeKey = null;
}
