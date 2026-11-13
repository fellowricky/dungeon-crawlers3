import { describe, it, expect } from 'vitest';
import { beginFightSpoils, holdFightLoot, noteFightSpoil, finishFightSpoils, isHoldingSpoils, cancelFightSpoils } from '../src/game/spoils.js';

const hero = (name, extra = {}) => ({ data: { name, classKey: 'fighter', hp: 20, level: 1, kills: 0, dmgDealt: 0, dmgTaken: 0, downs: 0, xp: 0, ...extra } });

function makeGame() {
  return { gold: 100, initiative: { round: 1 }, heroes: [hero('Aldric'), hero('Mira', { classKey: 'wizard' }), { ...hero('Wolf'), companion: true }] };
}

describe('fight spoils', () => {
  it('holds nothing outside a fight, so drops are announced the old way', () => {
    const g = makeGame();
    expect(isHoldingSpoils(g)).toBe(false);
    expect(holdFightLoot(g, { name: 'Sword' })).toBe(false);
    expect(finishFightSpoils(g)).toBeNull();
  });

  it("reports the fight's share of each hero's lifetime counters, the gold and the held items", () => {
    const g = makeGame();
    g.heroes[0].data.dmgDealt = 500;            // lifetime damage from earlier fights
    beginFightSpoils(g);
    expect(isHoldingSpoils(g)).toBe(true);
    const [a, m] = g.heroes;
    a.data.dmgDealt += 30; a.data.kills += 2; a.data.dmgTaken += 12; a.data.xp += 6;
    m.data.healDone = 14;
    m.data.dmgDealt += 45; m.data.kills += 1; m.data.xp += 6; m.data.downs += 1; m.data.hp = 0;
    g.gold += 37;
    g.initiative.round = 3;
    holdFightLoot(g, { name: 'Sword', rarity: 'rare' });
    noteFightSpoil(g, '2 Knowledge Tomes');
    g.initiative.round = 1;                     // initiative resets as the fight ends
    const r = finishFightSpoils(g);

    expect(isHoldingSpoils(g)).toBe(false);
    expect(r.heroes.map((h) => h.name)).toEqual(['Aldric', 'Mira']);   // companions aren't in the report
    expect(r.heroes[0]).toMatchObject({ dmgDealt: 30, kills: 2, dmgTaken: 12, xp: 6, alive: true });
    expect(r.heroes[1]).toMatchObject({ dmgDealt: 45, healDone: 14, downs: 1, alive: false });
    expect(r.totals).toEqual({ kills: 3, dmgDealt: 75, dmgTaken: 12, healDone: 14, downs: 1 });
    expect(r.mvp).toBe('Mira');
    expect(r.xpEach).toBe(6);
    expect(r.gold).toBe(37);
    expect(r.items).toEqual([{ name: 'Sword', rarity: 'rare' }]);
    expect(r.notes).toEqual(['2 Knowledge Tomes']);
    expect(r.rounds).toBe(3);
    expect(r.wiped).toBe(false);
  });

  it('flags a wipe, and a cancelled tally reports nothing', () => {
    const g = makeGame();
    beginFightSpoils(g);
    for (const h of g.heroes) h.data.hp = 0;
    expect(finishFightSpoils(g).wiped).toBe(true);
    beginFightSpoils(g);
    cancelFightSpoils(g);
    expect(finishFightSpoils(g)).toBeNull();
  });

  it('notes a level-up made in the fight', () => {
    const g = makeGame();
    beginFightSpoils(g);
    g.heroes[0].data.level = 2;
    expect(finishFightSpoils(g).heroes[0].levelUp).toBe(true);
  });
});
