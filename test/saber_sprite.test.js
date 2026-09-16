import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildLayerPaths } from '../src/game/appearance.js';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('Saber (Cutlass) Sprite Layers', () => {
  it('resolves both front and behind saber layers', () => {
    const visual = { gender: 'male' };
    const equipment = {
      weapon: { visualWeapon: 'sword/saber' }
    };

    const paths = buildLayerPaths(visual, equipment);
    expect(paths.weapon).toBe('weapon/sword/saber');
    expect(paths.weapon_behind).toBe('weapon_behind/sword/saber');
  });

  it('does not render a longsword behind the body when wielding a cutlass', () => {
    const saber = 'public/lpc/weapon_behind/sword/saber/walk.png';
    const longsword = 'public/lpc/weapon_behind/sword/longsword/walk.png';
    expect(existsSync(saber)).toBe(true);
    expect(existsSync(longsword)).toBe(true);
    expect(sha(saber)).not.toBe(sha(longsword));
  });

  it('saber behind sheets match the LPC source saber, not a longsword copy', () => {
    const cases = [
      ['public/lpc/weapon_behind/sword/saber/walk.png',
       'lpc_repo/spritesheets/weapon/sword/saber/universal_behind/walk/saber.png'],
      ['public/lpc/weapon_behind/sword/saber/hurt.png',
       'lpc_repo/spritesheets/weapon/sword/saber/universal_behind/hurt/saber.png'],
    ];
    for (const [dst, src] of cases) {
      expect(existsSync(src), `missing source ${src}`).toBe(true);
      expect(sha(dst)).toBe(sha(src));
    }
  });

  it('other swords keep their own behind walk sheets (not longsword copies)', () => {
    const pairs = {
      katana: 'lpc_repo/spritesheets/weapon/sword/katana/walk/behind/katana.png',
      scimitar: 'lpc_repo/spritesheets/weapon/sword/scimitar/walk/behind/scimitar.png',
      longsword_alt: 'lpc_repo/spritesheets/weapon/sword/longsword_alt/walk/behind/longsword_alt.png',
    };
    for (const [name, src] of Object.entries(pairs)) {
      const dst = `public/lpc/weapon_behind/sword/${name}/walk.png`;
      expect(existsSync(src), `missing source ${src}`).toBe(true);
      expect(existsSync(dst), `missing dest ${dst}`).toBe(true);
      expect(sha(dst)).toBe(sha(src));
    }
  });
});
