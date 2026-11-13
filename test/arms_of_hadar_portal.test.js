import { describe, it, expect } from 'vitest';
import { createFrame, clearFrame, createFx } from '../src/vendor/pixelfx/core/index.js';
import * as portal from '../src/render/pfx/hadar_portal.js';
import { SPELLS } from '../src/game/spells.js';

const mon = (x, z) => ({ x, z, data: { hp: 10 }, active: true });

function castArmsOfHadar(aoeCenter = null) {
  const calls = { fx: [], portal: [] };
  const foe = mon(5, 5);
  const game = {
    monsters: [foe, mon(6, 5), mon(5, 6.5), mon(20, 20)],
    _aoeCenter: aoeCenter,
    markSpellUsed() {}, fxLog() {}, spellDamage() {},
    playAbilityFx(h, key, opts) { calls.fx.push({ key, opts }); if (opts.onImpact) opts.onImpact({ x: opts.at.x, y: 0, z: opts.at.z }); },
    fxHadarPortal(x, z, r) { calls.portal.push({ x, z, r }); },
  };
  const h = { x: 0, z: 0, data: { name: 'Warlock', dmgBonus: 0 } };
  SPELLS.armsOfHadar.cast(game, h, foe);
  return calls;
}

describe('Arms of Hadar: one centred effect over a flat portal', () => {
  it('plays the tentacles once, and opens the portal on the spell radius at the same spot', () => {
    const { fx, portal: p } = castArmsOfHadar();
    expect(fx).toHaveLength(1);
    expect(fx[0].opts.alsoAt).toBeUndefined();
    expect(p).toEqual([{ x: 5, z: 5, r: SPELLS.armsOfHadar.ai.aoeRadius }]);
  });

  it('follows the AI-chosen blast point when one is set, the centre the damage is measured from', () => {
    const { fx, portal: p } = castArmsOfHadar({ x: 5.5, z: 5.5 });
    expect(fx[0].opts.at).toEqual({ x: 5.5, z: 5.5 });
    expect(p[0]).toMatchObject({ x: 5.5, z: 5.5 });
  });

  it('the portal fills its radius while open and ends empty', () => {
    const [W, H] = portal.meta.size, [ox, oy] = portal.meta.origin, R = portal.meta.options.radius;
    const frame = createFrame(W, H);
    const fx = createFx(portal, { x: ox, y: oy });
    const painted = (x, y) => frame.color[(oy + y) * W + (ox + x)] !== 0;
    fx.update(1.2);
    clearFrame(frame);
    fx.draw(frame);
    // the void covers the middle and reaches out near the rim on every side
    for (const [x, y] of [[0, 0], [R * 0.85, 0], [-R * 0.85, 0], [0, R * 0.85], [0, -R * 0.85]]) expect(painted(Math.round(x), Math.round(y))).toBe(true);
    fx.update(portal.meta.duration);
    clearFrame(frame);
    fx.draw(frame);
    expect(frame.color.some((c) => c !== 0)).toBe(false);
  });
});
