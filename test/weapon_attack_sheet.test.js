import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

if (typeof globalThis.Image === 'undefined') globalThis.Image = class { set src(_) {} };

import { HeroSprite, SLASH_ONLY_WEAPONS } from '../src/game/sprite_animator.js';

const LPC_WEAPON = path.resolve(__dirname, '../public/lpc/weapon');
const resolve = (baseKey, visualWeapon) =>
  HeroSprite.prototype.resolveAttackAction.call({ equipment: { weapon: { baseKey, visualWeapon } }, hero: { classKey: 'rogue' } });

describe('weapon attack animation resolves to a sheet the weapon has', () => {
  it('rapier slashes (its art has no thrust sheet); spear and dagger still thrust', () => {
    expect(resolve('rapier', 'sword/rapier')).toBe('slash');
    expect(resolve('scythe', 'polearm/scythe')).toBe('slash');
    expect(resolve('spear', 'polearm/spear')).toBe('thrust');
    expect(resolve('dagger', 'sword/dagger')).toBe('thrust');
  });

  it('every weapon an item uses has the sheet its attack resolves to', () => {
    const items = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/game/items.json'), 'utf8'));
    const seen = new Map();
    JSON.stringify(items, (k, v) => {
      if (v && typeof v === 'object' && typeof v.visualWeapon === 'string' && !v.visualWeapon.startsWith('ranged/'))
        seen.set(v.visualWeapon, (v.baseKey || v.name || '').toLowerCase());
      return v;
    });
    expect(seen.size).toBeGreaterThan(0);
    const missing = [];
    for (const [vw, baseKey] of seen) {
      const dir = path.join(LPC_WEAPON, vw);
      if (!fs.existsSync(path.join(dir, 'walk.png'))) continue; // not an LPC weapon layer
      const action = resolve(baseKey, vw);
      if (!fs.existsSync(path.join(dir, `${action}.png`))) missing.push(`${vw} -> ${action}`);
    }
    expect(missing).toEqual([]);
  });

  it('SLASH_ONLY_WEAPONS entries really lack thrust.png and have slash.png', () => {
    for (const vw of SLASH_ONLY_WEAPONS) {
      expect(fs.existsSync(path.join(LPC_WEAPON, vw, 'slash.png'))).toBe(true);
      expect(fs.existsSync(path.join(LPC_WEAPON, vw, 'thrust.png'))).toBe(false);
    }
  });
});
