import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

/* Sprite sheets are decoded and uploaded once per URL; every creature that
   uses one gets a clone sharing the image and THREE source. Stub the loader
   so the test controls when the "image" arrives. */
const loads = [];
vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(function (url, onLoad, _p, onError) {
  const tex = new THREE.Texture();
  loads.push({ url, tex, onLoad, onError });
  return tex;
});
const { sharedSheetTexture, sharedSheetFromLoader, evictSharedSheets, sharedSheetKeys, warmSharedSheet } = await import('../src/game/sprite_atlas.js');

describe('shared sheet textures', () => {
  it('fetches a URL once however many instances ask, and hands each a clone', () => {
    const got = [];
    sharedSheetTexture('sprites/kobold.png', t => got.push(t));
    sharedSheetTexture('sprites/kobold.png', t => got.push(t));
    sharedSheetTexture('sprites/kobold.png', t => got.push(t));
    expect(loads.filter(l => l.url === 'sprites/kobold.png')).toHaveLength(1);
    expect(got).toHaveLength(0);                       // nothing until the image lands
    const l = loads.find(l => l.url === 'sprites/kobold.png');
    l.tex.image = { width: 3648, height: 192 };
    l.onLoad(l.tex);
    expect(got).toHaveLength(3);
    expect(new Set(got).size).toBe(3);                  // three distinct textures…
    expect(got[0]).not.toBe(l.tex);
    expect(got.every(t => t.source === l.tex.source)).toBe(true);   // …one source, one upload
    expect(got.every(t => t.magFilter === THREE.NearestFilter && t.colorSpace === THREE.SRGBColorSpace)).toBe(true);
    /* A late arrival after the load gets a clone immediately. */
    let late = null;
    sharedSheetTexture('sprites/kobold.png', t => { late = t; });
    expect(late && late.source).toBe(l.tex.source);
  });

  it('reports a failed load to every waiter', () => {
    const errs = vi.fn();
    sharedSheetTexture('sprites/missing.png', () => {}, errs);
    sharedSheetTexture('sprites/missing.png', () => {}, errs);
    loads.find(l => l.url === 'sprites/missing.png').onError();
    expect(errs).toHaveBeenCalledTimes(2);
  });

  it('shares a custom-produced sheet (colour-balanced canvas) the same way', () => {
    let produced = 0;
    const produce = (ok) => { produced++; ok(new THREE.Texture()); };
    const a = [], b = [];
    sharedSheetFromLoader('sprites/orc.png#cb1', produce, t => a.push(t));
    sharedSheetFromLoader('sprites/orc.png#cb1', produce, t => b.push(t));
    expect(produced).toBe(1);
    expect(a[0].source).toBe(b[0].source);
  });

  it('evicts sheets the next floor does not use and keeps the rest', () => {
    warmSharedSheet('sprites/bat.png');
    const before = sharedSheetKeys();
    expect(before).toContain('sprites/bat.png');
    const n = evictSharedSheets(k => k.split('#')[0] === 'sprites/kobold.png');
    expect(n).toBeGreaterThan(0);
    const after = sharedSheetKeys();
    expect(after).toEqual(['sprites/kobold.png']);
  });
});
