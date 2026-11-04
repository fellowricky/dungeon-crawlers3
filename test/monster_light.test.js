import { describe, it, expect } from 'vitest';
import { MONSTERS_BY_ID } from '../src/game/srd.js';
import { monsterLightTraits, monsterGlow } from '../src/game/monster_light.js';
import { addDarkZone, addVirtualLight, inDarkZone, tickLightRegistry, clearLightRegistry, VIRTUAL_LIGHTS, DARK_ZONES, heroLightSource } from '../src/game/light_sources.js';
import { canSee } from '../src/game/light_rules.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';
import { makeHero } from '../src/game/srd.js';

const m = (id, o = {}) => ({ x: 0, z: 0, lightState: 'bright', active: true, data: { ...MONSTERS_BY_ID[id], id, hp: 10, maxHp: 10 }, ...o });

describe('monsters & light', () => {
  it('reads light traits from the SRD statblock text', () => {
    expect(monsterLightTraits(m('kobold')).sunlightSensitive).toBe(true);
    expect(monsterLightTraits(m('drow')).sunlightSensitive).toBe(true);
    const sh = monsterLightTraits(m('shadow'));
    expect(sh.sunlightWeak && sh.shadowStealth).toBe(true);
    expect(monsterGlow(m('fire-elemental'))).toMatchObject({ bright: 6, dim: 12 });   // 30 ft + 30 ft
    expect(monsterGlow(m('giant-fire-beetle'))).toMatchObject({ bright: 2, dim: 4 });
    expect(monsterGlow(m('ghost'))).toMatchObject({ bright: 0, dim: 2 });             // ghostly dim
    expect(monsterGlow(m('torcbearer'))).toMatchObject({ torch: true });
    expect(monsterLightTraits(m('goblin')).douser).toBe(true);
    expect(monsterLightTraits(m('hobgoblin')).douser).toBe(false);
    expect(monsterLightTraits(m('ghost-moth')).drawnToLight).toBe(true);
    expect(monsterLightTraits(m('vampire')).vampire).toBe(true);
    expect(monsterLightTraits(m('darkmantle')).darknessAura).toBe(2);
    expect(monsterGlow(m('kobold'))).toBeNull();
  });

  it('blindsight monsters ignore the dark entirely', () => {
    const grim = m('grimlock', { x: 0 });
    const hidingHero = { x: 3, z: 0, lightState: 'dark', _hidden: true, data: { name: 'H', hp: 10 } };
    expect(canSee(grim, hidingHero)).toBe(true);
  });

  it('sunlight sensitivity: a kobold fighting in bright light attacks at disadvantage', () => {
    const g = { ...monsterAiMethods, monsters: [], fxLog() {} };
    const hero = { x: 1, z: 0, lightState: 'bright', data: { name: 'H', hp: 10, maxHp: 10, feats: [] } };
    const lit = m('kobold', { lightState: 'bright' });
    const dimK = m('kobold', { lightState: 'dim' });
    expect(g.monsterAttackAdv(lit, hero)).toBe(g.monsterAttackAdv(dimK, hero) - 1);
  });

  it('registry: darkness zones follow their owner and vanish with it; timed lights expire', () => {
    clearLightRegistry();
    const owner = m('darkmantle', { x: 5, z: 5 });
    addDarkZone({ follow: owner, r: 2 });
    expect(inDarkZone(5.5, 5)).toBe(true);
    expect(inDarkZone(0, 0)).toBe(false);
    owner.x = 0; owner.z = 0;
    expect(inDarkZone(0.5, 0)).toBe(true);
    owner.data.hp = 0;
    tickLightRegistry(0.1);
    expect(DARK_ZONES.size).toBe(0);
    let expired = false;
    addVirtualLight({ x: 0, z: 0, bright: 2, dim: 4, ttl: 1, onExpire: () => { expired = true; } });
    tickLightRegistry(0.5);
    expect(VIRTUAL_LIGHTS.size).toBe(1);
    tickLightRegistry(0.6);
    expect(VIRTUAL_LIGHTS.size).toBe(0);
    expect(expired).toBe(true);
  });

  it('a doused torch gives no light until it dries', () => {
    const d = makeHero('A', 'human', 'fighter');
    expect(heroLightSource(d)).toBe('torch');
    d._dousedT = 5;
    expect(heroLightSource(d)).toBeNull();
    d._dousedT = 0;
    expect(heroLightSource(d)).toBe('torch');
  });
});
