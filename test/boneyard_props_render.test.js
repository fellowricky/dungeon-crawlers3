/**
 * Every prop the overland generator places has to be something the renderer
 * can draw. The generator and dungeon_scene.js are edited separately, and the
 * scene's prop switch silently skips a kind it has no model for, so when the
 * scene lost its Boneyard wiring (2026-11) the map still generated its
 * mausoleums and open graves and simply showed nothing, and the blocker trees
 * fell back to the old procedural ones.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { THEMES, generateOverland } from '../src/dungeon/dungeon_generator.js';

const scene = readFileSync(new URL('../src/render/dungeon_scene.js', import.meta.url), 'utf8');
/* graveFenceBlock is a collision-only marker: its fence is the drawn graveFence */
const NOT_DRAWN = new Set(['graveFenceBlock']);
const known = kind => NOT_DRAWN.has(kind) || scene.includes(`${kind}:`) || scene.includes(`'${kind}'`);
const OVERLAND = Object.keys(THEMES).filter(k => THEMES[k].overland);

describe('overland props reach the renderer', () => {
  for (const themeKey of OVERLAND) {
    it(`${themeKey}: every placed kind is known to dungeon_scene.js`, () => {
      const kinds = new Set();
      for (const seed of [3, 11, 29, 47]) {
        const d = generateOverland({ seed, themeKey, level: 5, mapW: 50, mapH: 300, zones: 9, layout: 'ribbon' });
        for (const p of d.props) kinds.add(p.kind);
      }
      expect([...kinds].filter(k => !known(k))).toEqual([]);
    });
  }
});

describe('Boneyard models', () => {
  const grim = scene.slice(scene.indexOf('  Grim: {'), scene.indexOf('  Molten: {'));

  it('walls the map in dead trees, not the procedural fallback', () => {
    expect(scene).toMatch(/const BONEYARD_TREES = \[.*'deadOak'.*\]/);
    expect(scene).toMatch(/if \(isBoneyard\) \{\s*for \(const k of BONEYARD_TREES\)/);
    expect(THEMES.boneyard.blockerGeo).toBe('tree');
    /* its 'deadtree' lives in the Mire folder */
    expect(scene).toMatch(/boneyard: \['Mire'\]/);
  });

  it('registers each graveyard model, and the file ships in public/', () => {
    const entries = [...grim.matchAll(/(\w+):\s*'([^']+\.opt\.glb)'/g)];
    const keys = entries.map(m => m[1]);
    for (const k of ['deadOak', 'deadHawthorn', 'deadSnag', 'gallowsTree', 'stoneCross', 'woodMarkerA', 'woodMarkerB',
      'mausoleumA', 'mausoleumB', 'mausoleumC', 'lychgate', 'openGrave', 'stoneBench']) expect(keys, k).toContain(k);
    for (const [, k, file] of entries)
      expect(existsSync(new URL(`../public/3d/Grim/${file}`, import.meta.url)), `${k}: ${file}`).toBe(true);
  });

  it('sinks open graves and bakes the dead turf and cobbled road', () => {
    expect(scene).toMatch(/if \(p\.sink && p\.sinkCells\)/);
    expect(scene).toMatch(/sepia: GT\.sepia, road: GT\.surface/);
    expect(scene).toMatch(/TH\.deadGrass \? matDeadGrass : matSwampGrass/);
  });
});
