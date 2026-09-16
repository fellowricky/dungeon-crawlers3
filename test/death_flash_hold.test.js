import { describe, it, expect, vi } from 'vitest';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { combatMethods } from '../src/game/combat.js';

/* The killing blow must still flash and recoil before the body dissolves.
   killMonster used to clear flashT and reset the sprite colour on the spot, so
   the one hit that most deserves the feedback was the only one that never got
   it. The dissolve now waits out a hold, and because updateMonsters skips dead
   monsters entirely, the flash has to be ticked from the death path itself. */

const deadMonster = (holdT) => ({
  x: 0, z: 0, dead: true,
  data: { name: 'Skeletal Swordsman', hp: 0, maxHp: 20, scale: 1 },
  _deathAnim: { t: 0, dur: 1.85, kind: 'evaporate', baseScaleX: 1.5, baseScaleY: 1.5, started: false, pixAcc: 0, holdT },
  ent: {
    grp: { visible: true, position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    anim: { mesh: { material: { color: { r: 3.4, g: 3, b: 2.9, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } }, rotation: 0 }, position: { x: 0.05, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, set(x, y) { this.x = x; this.y = y; } } } },
    flashT: 0.4
  }
});

function mkGame(over = {}) {
  const g = {
    monsters: [], heroes: [],
    fxUpdateFlash: vi.fn(),
    fxBeginEvaporate: vi.fn(),
    fxSetEvaporate: vi.fn(() => null),
    fxEvaporatePixels: vi.fn(),
    ...over
  };
  Object.assign(g, monsterAiMethods);
  Object.assign(g, over);
  return g;
}

describe('killing-blow flash hold', () => {
  it('killMonster arms a hold rather than cancelling the flash', () => {
    const g = { fxHitFlashSeconds: () => 0.4, fxLog() {}, refreshHud() {}, bestiary: {}, monsters: [], heroes: [] };
    Object.assign(g, combatMethods);
    const m = deadMonster(0);
    m.dead = false;
    m._deathAnim = null;

    g.killMonster(m, null);

    expect(m._deathAnim.holdT).toBe(0.4);
    /* The flash must survive the kill — clearing it was the original bug. */
    expect(m.ent.flashT).toBe(0.4);
  });

  it('does not start the dissolve while the hold is running', () => {
    const g = mkGame();
    const m = deadMonster(0.4);
    g.monsters = [m];

    g.updateMonsterVisuals(0.016, 0, 1, 0);

    expect(g.fxBeginEvaporate).not.toHaveBeenCalled();
    expect(m._deathAnim.started).toBe(false);
    expect(m._deathAnim.t).toBe(0);          // dissolve clock has not begun
    /* ...and the flash is being driven, since updateMonsters skips the dead. */
    expect(g.fxUpdateFlash).toHaveBeenCalledWith(m.ent, 0.016);
  });

  it('leaves the flash colour alone during the hold', () => {
    const g = mkGame();
    const m = deadMonster(0.4);
    g.monsters = [m];

    g.updateMonsterVisuals(0.016, 0, 1, 0);

    /* The dissolve resets colour to white every frame; during the hold it must
       not run, or the flash is eaten on the frame it starts. */
    expect(m.ent.anim.mesh.material.color.r).toBe(3.4);
  });

  it('hands the sprite over in a clean state once the hold expires', () => {
    const g = mkGame();
    const m = deadMonster(0.01);
    g.monsters = [m];

    g.updateMonsterVisuals(0.016, 0, 1, 0);

    expect(m._deathAnim.started).toBe(true);
    expect(g.fxBeginEvaporate).toHaveBeenCalled();
    const mesh = m.ent.anim.mesh;
    expect(mesh.material.color.r).toBe(1);   // tint cleared before dissolving
    expect(mesh.scale.x).toBe(1.5);          // punch undone
    expect(m.ent.flashT).toBe(0);
  });
});
