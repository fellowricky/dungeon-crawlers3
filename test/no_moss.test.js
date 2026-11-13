/**
 * The moss prop (a flat green disc with a green tint under it, from an early
 * prototype) was removed from the game on 2026-11-08 at Zenu's request. No
 * generator path may place it again, and the renderer no longer draws it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES, generateDungeon, generateOverland } from '../src/dungeon/dungeon_generator.js';

describe('no moss', () => {
  it('no overland theme places moss', () => {
    for (const themeKey of Object.keys(THEMES).filter(k => THEMES[k].overland)) {
      for (const seed of [3, 29]) {
        const d = generateOverland({ seed, themeKey, level: 5, mapW: 50, mapH: 300, zones: 9, layout: 'ribbon' });
        expect(d.props.filter(p => p.kind === 'moss').length, `${themeKey} ${seed}`).toBe(0);
      }
    }
  });

  it('no dungeon theme places moss, root breaches and spore nurseries included', () => {
    for (const themeKey of Object.keys(THEMES).filter(k => !THEMES[k].overland)) {
      for (const seed of [3, 29, 71]) {
        const d = generateDungeon({ seed, themeKey, level: 5 });
        expect(d.props.filter(p => p.kind === 'moss').length, `${themeKey} ${seed}`).toBe(0);
      }
    }
  });

  it('the renderer and the editor no longer know it', () => {
    const scene = readFileSync('src/render/dungeon_scene.js', 'utf8');
    expect(scene).not.toMatch(/case 'moss'|mossMask|matMoss/);
    expect(readFileSync('src/render/dungeon_geo.js', 'utf8')).not.toContain('GEO.moss');
    expect(readFileSync('src/dungeon_editor.js', 'utf8')).not.toContain("'Moss fringe'");
  });
});
