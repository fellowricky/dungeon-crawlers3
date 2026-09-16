import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeLootFloatText, makeFloatText, updateFloatTexts } from '../src/game/entities.js';

if (typeof globalThis.document === 'undefined') {
  const dummyCtx = {
    font: '', measureText: () => ({ width: 10 }), strokeText: () => {},
    fillText: () => {}, clearRect: () => {}, fillRect: () => {},
    beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
    rect: () => {}, roundRect: () => {}
  };
  const dummyEl = {
    setAttribute: () => {}, addEventListener: () => {}, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    getContext: () => dummyCtx,
    querySelector: () => dummyEl,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {}
  };
  globalThis.document = {
    createElement: () => dummyEl, createElementNS: () => dummyEl,
    getElementById: () => null, querySelector: () => dummyEl, querySelectorAll: () => [], body: dummyEl
  };
}

describe('Floating Loot & Indicator Stacking', () => {
  it('pushes existing float indicators upward to form a clean vertical stack without overlapping', () => {
    const scene = new THREE.Scene();
    const pos = new THREE.Vector3(0, 2.0, 0);

    // 1. Spawn Gold Indicator
    makeLootFloatText(scene, pos, 'gold', 50);
    const spritesBefore = scene.children.filter(c => c.isSprite && c.renderOrder === 80);
    expect(spritesBefore.length).toBe(1);
    const sprite1 = spritesBefore[0];
    const initialY1 = sprite1.position.y;

    // 2. Spawn Gear Indicator at same location
    makeLootFloatText(scene, pos, 'gear', { name: 'Shortsword', rarity: 'uncommon' });
    const spritesAfter = scene.children.filter(c => c.isSprite && c.renderOrder === 80);
    expect(spritesAfter.length).toBe(2);
    const sprite2 = spritesAfter[1];

    // Sprite1 should have been pushed UP by the new indicator
    expect(sprite1.position.y).toBeGreaterThan(initialY1);
    expect(sprite1.position.y).toBeGreaterThan(sprite2.position.y);
    expect(sprite1.position.y - sprite2.position.y).toBeGreaterThanOrEqual(0.4);
  });

  it('maintains strict non-overlapping vertical separation for multiple sequential loot pickups', () => {
    const scene = new THREE.Scene();
    const pos = new THREE.Vector3(5, 2.0, 5);

    makeLootFloatText(scene, pos, 'gold', 100);
    makeLootFloatText(scene, pos, 'gear', { name: 'Chain Mail', rarity: 'rare' });
    makeLootFloatText(scene, pos, 'gear', { name: 'Potion of Healing', rarity: 'uncommon' });
    makeLootFloatText(scene, pos, 'gear', { name: 'Greatsword of Flame', rarity: 'legendary' });

    const sprites = scene.children.filter(c => c.isSprite && c.renderOrder === 80);
    expect(sprites.length).toBe(4);

    // Sprites are spawned in order 0 (oldest), 1, 2, 3 (newest at bottom)
    // Verify ascending Y coordinates from newest (at bottom) to oldest (at top)
    expect(sprites[3].position.y).toBeLessThan(sprites[2].position.y);
    expect(sprites[2].position.y).toBeLessThan(sprites[1].position.y);
    expect(sprites[1].position.y).toBeLessThan(sprites[0].position.y);

    // Each adjacent pair must have at least 0.5 units of vertical separation
    expect(sprites[2].position.y - sprites[3].position.y).toBeGreaterThanOrEqual(0.5);
    expect(sprites[1].position.y - sprites[2].position.y).toBeGreaterThanOrEqual(0.5);
    expect(sprites[0].position.y - sprites[1].position.y).toBeGreaterThanOrEqual(0.5);
  });
});
