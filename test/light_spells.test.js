import { describe, it, expect } from 'vitest';
import { SPELLS, SPELL_POOLS } from '../src/game/spells.js';
import { canSee, isOutlined } from '../src/game/light_rules.js';
import { applyEffect, hasEffect } from '../src/game/conditions.js';
import { aoeZoneManager } from '../src/game/aoe_system.js';
import { VIRTUAL_LIGHTS, DARK_ZONES, clearLightRegistry, addDarkZone, setLightProbe } from '../src/game/light_sources.js';
import { combatMethods } from '../src/game/combat.js';
import { makeHero, MONSTERS_BY_ID } from '../src/game/srd.js';

const mon = (id, o = {}) => ({ x: 2, z: 0, active: true, lightState: 'dark', data: { ...MONSTERS_BY_ID[id], id, hp: 30, maxHp: 30, name: id }, ...o });
const game = (extra = {}) => ({
  ...combatMethods, monsters: [], heroes: [], fxNow: 0, initiative: { active: true },
  logs: [], fxLog(t) { this.logs.push(t); }, fxText() {}, fxSprite() {}, playAbilityFx() {}, markSpellUsed() {},
  refreshHud() {}, fxUpdateManualBar() {}, isHostileMonster: () => true,
  damaged: [], spellDamage(m, dmg) { this.damaged.push([m.data.id, dmg]); m.data.hp -= dmg; return dmg; },
  spellSave: () => false,
  ...extra
});

describe('light spells & class light abilities', () => {
  it('Faerie Fire (and Guiding Bolt\'s mark) outline a creature: it cannot hide in the dark', () => {
    const shadow = mon('shadow', { _hidden: true });
    const seer = { x: 0, z: 0, lightState: 'bright', data: { name: 'S', raceKey: 'human', hp: 10, feats: [], features: [], invocations: [] } };
    expect(canSee(seer, shadow)).toBe(false);
    applyEffect(shadow, 'faerieFire', { duration: 60, elapsed: 0 });
    expect(isOutlined(shadow)).toBe(true);
    expect(canSee(seer, shadow)).toBe(true);
    expect(shadow._hidden).toBe(false);
  });

  it('Moonbeam, Flaming Sphere and Wall of Fire shed light that ends with the zone', () => {
    clearLightRegistry();
    const moon = { spellKey: 'moonbeam', x: 1, z: 1, radius: 1.8 };
    const ls = aoeZoneManager._zoneLights(moon);
    expect(ls.length).toBe(1);
    expect(ls[0]).toMatchObject({ bright: 0, dim: 3 });
    expect(aoeZoneManager._zoneLights({ spellKey: 'flamingSphere', x: 0, z: 0, radius: 2 })[0]).toMatchObject({ bright: 2, dim: 4 });
    const wall = aoeZoneManager._zoneLights({ spellKey: 'wallOfFire', x: 6, z: 0, startX: 0, startZ: 0, endX: 12, endZ: 0, length: 12 });
    expect(wall.length).toBeGreaterThanOrEqual(6);
    moon._lights = ls;
    aoeZoneManager.removeZone({ activeAoEZones: [] }, moon);
    expect(VIRTUAL_LIGHTS.has(ls[0])).toBe(false);
    clearLightRegistry();
  });

  it('Darkness makes a zone of magical dark; Daylight dispels it and keeps a darkmantle snuffed', () => {
    clearLightRegistry();
    const g = game({ playAbilityFx: (_h, _k, opts) => opts.onImpact && opts.onImpact() });   // the zone arrives with the mote
    const caster = { x: 0, z: 0, data: makeHero('W', 'human', 'wizard') };
    expect(SPELLS.darkness.cast(g, caster, { x: 5, z: 5 })).toBe(true);
    expect(DARK_ZONES.size).toBe(1);
    const mantle = mon('darkmantle', { x: 6, z: 5 });
    mantle._darkZone = addDarkZone({ follow: mantle, r: 2 });
    expect(DARK_ZONES.size).toBe(2);
    expect(SPELLS.daylight.cast(g, caster, { x: 5, z: 5 })).toBe(true);
    expect(DARK_ZONES.size).toBe(0);
    expect(mantle._darkZone).toBe('dispelled');
    expect([...VIRTUAL_LIGHTS].some(L => L.sunlight && L.bright === 12)).toBe(true);
    clearLightRegistry();
  });

  it('the new spells sit in the right pools', () => {
    const has = (cls, key) => Object.values(SPELL_POOLS[cls] || {}).some(t => t.includes(key));
    for (const c of ['wizard', 'sorcerer', 'bard']) expect(has(c, 'dancingLights')).toBe(true);
    for (const c of ['wizard', 'sorcerer', 'warlock']) expect(has(c, 'darkness')).toBe(true);
    for (const c of ['cleric', 'druid', 'sorcerer']) expect(has(c, 'daylight')).toBe(true);
    expect(SPELLS.dancingLights.cantrip).toBe(true);
  });

  it('Dancing Lights: the AI lights up a foe it cannot see', () => {
    clearLightRegistry();
    const w = { x: 0, z: 0, lightState: 'bright', data: makeHero('W', 'human', 'wizard') };
    w.data.knownSpells.push('dancingLights');
    const lurker = mon('goblin', { x: 6, z: 0, data: { ...MONSTERS_BY_ID.goblin, id: 'goblin', hp: 7, statblock: { senses: {} } } });
    lurker.data.statblock = { senses: {} };
    const g = game({ monsters: [lurker], heroes: [w] });
    w._lightAbilityUsed = {};
    expect(g.tryLightAbilities(w)).toBe('dancingLights');
    expect(VIRTUAL_LIGHTS.size).toBe(3);
    expect(g.tryLightAbilities(w)).toBeNull();          // once a fight
    clearLightRegistry();
  });

  it('Radiant Flare sears undead and shadow creatures nearby, not the living', () => {
    clearLightRegistry();
    const c = { x: 0, z: 0, data: makeHero('C', 'human', 'cleric') };
    c.data.skills.radiantFlare = 1;
    const zombie = mon('zombie', { x: 1 });
    const goblin = mon('goblin', { x: 1.5 });
    const g = game({ monsters: [zombie, goblin], heroes: [c] });
    c._lightAbilityUsed = {};
    expect(g.tryLightAbilities(c)).toBe('radiantFlare');
    expect(g.damaged.map(d => d[0])).toEqual(['zombie']);
    expect(g.tryLightAbilities(c)).toBeNull();
    clearLightRegistry();
  });

  it('Blinding Flash (Evoker) blinds foes lurking in the dark, for a slot', () => {
    clearLightRegistry();
    const w = { x: 0, z: 0, data: makeHero('E', 'human', 'wizard') };
    w.data.subclass = 'evoker';
    const a = mon('goblin', { x: 4 }), b = mon('goblin', { x: 5 });
    const g = game({ monsters: [a, b], heroes: [w] });
    w._lightAbilityUsed = {};
    expect(g.tryLightAbilities(w)).toBe('blindingFlash');
    expect(hasEffect(a, 'blinded') && hasEffect(b, 'blinded')).toBe(true);
    clearLightRegistry();
  });

  it('Shadow Arts (Way of Shadow) spends 2 ki to drown the melee in darkness', () => {
    clearLightRegistry();
    const m = { x: 0, z: 0, data: makeHero('M', 'human', 'monk') };
    m.data.subclass = 'shadow'; m.data.ki = 4; m.data.kiMax = 4;
    const g = game({ monsters: [mon('goblin', { x: 1 }), mon('goblin', { x: -1 })], heroes: [m] });
    m._lightAbilityUsed = {};
    expect(g.tryLightAbilities(m)).toBe('shadowArts');
    expect(DARK_ZONES.size).toBe(1);
    expect(m.data.ki).toBe(2);
    clearLightRegistry();
  });
});
