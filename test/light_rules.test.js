import { describe, it, expect } from 'vitest';
import { canSee, sightAdvantage, noteAttackFromDark, noticeRangeMul, perceptionAdv, senseRanges, NOTICE } from '../src/game/light_rules.js';
import { initiativeMethods } from '../src/game/initiative.js';

/* Minimal units: a light state, a position, and the data the senses read. */
const hero = (o = {}) => ({ x: 0, z: 0, lightState: 'bright', data: { name: 'Hero', raceKey: 'human', hp: 10, feats: [], features: [], invocations: [], ...o.data }, ...o, });
const mon = (o = {}) => ({ x: 3, z: 0, lightState: 'bright', data: { name: 'Mon', hp: 10, statblock: { senses: {} }, ...o.data }, ...o });

describe('light & sight rules', () => {
  it('bright and dim targets are seen; a dark one only by a sense that reaches it', () => {
    const h = hero();
    expect(canSee(h, mon({ lightState: 'bright' }))).toBe(true);
    expect(canSee(h, mon({ lightState: 'dim' }))).toBe(true);
    expect(canSee(h, mon({ lightState: 'dark' }))).toBe(false);
    /* heroes have no darkvision — not even dwarves and tieflings */
    for (const raceKey of ['dwarf', 'tiefling']) {
      expect(senseRanges(hero({ data: { raceKey } })).darkvision).toBe(0);
      expect(canSee(hero({ data: { raceKey } }), mon({ lightState: 'dark', x: 2 }))).toBe(false);
    }
  });

  it('monster senses come from the statblock (feet → tiles)', () => {
    const goblin = mon({ data: { statblock: { senses: { darkvision: 60 } } } });
    expect(senseRanges(goblin).darkvision).toBe(12);
    expect(canSee(goblin, hero({ lightState: 'dark', x: 10 }))).toBe(true);
    expect(canSee(goblin, hero({ lightState: 'dark', x: 17 }))).toBe(false);   // 14 tiles off
    const bat = mon({ data: { statblock: { senses: { blindsight: 60 } } } });
    expect(canSee(bat, hero({ lightState: 'dark', x: 10 }))).toBe(true);
  });

  it('attacks: unseen target is disadvantage, unseen attacker is advantage, Alert cancels the latter', () => {
    const h = hero({ lightState: 'dark' });
    const blindMonster = mon({ lightState: 'bright' });             // no darkvision
    expect(sightAdvantage(h, blindMonster)).toMatchObject({ adv: 1, unseenAttacker: true, unseenTarget: false });
    const darkFoe = mon({ lightState: 'dark' });
    expect(sightAdvantage(hero({ lightState: 'bright' }), darkFoe)).toMatchObject({ adv: -1, unseenTarget: true });
    const alertHero = hero({ lightState: 'bright', data: { feats: ['alert'] } });
    expect(sightAdvantage(mon({ lightState: 'dark' }), alertHero).unseenAttacker).toBe(false);
  });

  it('striking from the dark gives you away until you move off the spot', () => {
    const h = hero({ lightState: 'dark' });
    const m = mon();
    expect(canSee(m, h)).toBe(false);
    noteAttackFromDark(h, true);
    expect(canSee(m, h)).toBe(true);
    h.x = 2;                                // stepped back into the shadows
    expect(canSee(m, h)).toBe(false);
  });

  it('Devil\'s Sight sees in the dark and through magical Darkness; darkvision does not pierce it', () => {
    const warlock = hero({ data: { invocations: ['devilsSight'] } });
    const goblin = mon({ x: 0, data: { statblock: { senses: { darkvision: 60 } } } });
    const inDarkness = mon({ lightState: 'dark', _inMagicalDarkness: true });
    expect(canSee(warlock, inDarkness)).toBe(true);
    expect(canSee(goblin, inDarkness)).toBe(false);
    /* magical Darkness blinds even a torch-lit target */
    expect(canSee(hero(), mon({ lightState: 'bright', _inMagicalDarkness: true }))).toBe(false);
  });

  it('an outlined creature (Faerie Fire) cannot hide in the dark', () => {
    expect(canSee(hero(), mon({ lightState: 'dark', _outlined: true }))).toBe(true);
  });

  it('a lit hero is noticed from further; an unseen one from closer', () => {
    const m = mon();
    expect(noticeRangeMul(m, hero({ _lightActive: true }))).toBe(NOTICE.lit);
    expect(noticeRangeMul(m, hero({ lightState: 'dark' }))).toBe(NOTICE.unseen);
    expect(noticeRangeMul(m, hero({ lightState: 'bright' }))).toBe(1);
  });

  it('Perception: disadvantage in dim or dark, except for Dungeon Delver', () => {
    expect(perceptionAdv(hero({ lightState: 'bright' }))).toBe(0);
    expect(perceptionAdv(hero({ lightState: 'dim' }))).toBe(-1);
    expect(perceptionAdv(hero({ lightState: 'dark' }))).toBe(-1);
    expect(perceptionAdv(hero({ lightState: 'dim', data: { feats: ['dungeonDelver'] } }))).toBe(0);
  });

  it('surprise: whoever no enemy can see when the fight opens gets +5 initiative', () => {
    const h = hero({ lightState: 'bright' });
    const lurker = mon({ lightState: 'dark' });          // hero has no darkvision
    const seen = mon({ lightState: 'bright', x: 2 });
    const logs = [];
    const g = {
      ...initiativeMethods,
      heroes: [h], monsters: [lurker, seen],
      initiative: {}, fxLog: (t) => logs.push(t), _actorAlive: () => true, _beginTurn: () => {},
    };
    /* compare against a roll with the lurker visible: +5 exactly */
    const rnd = Math.random;
    let seq = 0;
    Math.random = () => [0.5, 0.1, 0.5, 0.2, 0.5, 0.3][seq++ % 6];
    try {
      g._rollInitiative([h, lurker, seen]);
      const withDark = lurker._init;
      lurker.lightState = 'bright'; seq = 0;
      g._rollInitiative([h, lurker, seen]);
      expect(withDark - lurker._init).toBe(5);
      expect(logs.some(l => /strikes first/.test(l))).toBe(true);
    } finally { Math.random = rnd; }
  });
});
