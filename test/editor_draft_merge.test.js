import { describe, it, expect } from 'vitest';
import { mergeDraft, packDraft, unpackDraft, diffPaths, fillMissing } from '../src/editor_draft_merge.js';

/* The loot editor used to save whole data files to localStorage and load them
   back verbatim, so project-file changes (new affixes, helm AC pricing) never
   showed up in the editor. These pin the three-way merge that replaced it. */

const base = {
  costs: { ac: 20, atk: 12 },
  basePricing: { tierIlvl: { armor: [1, 4], helm: [1, 7] } },
  bases: { helm: [{ name: 'Bascinet', acBase: 2 }, { name: 'Cap', acBase: 0 }] },
  affixes: [{ key: 'str', max: 3 }],
};

describe('mergeDraft', () => {
  it('takes file changes the user never touched', () => {
    const current = structuredClone(base);
    delete current.basePricing.tierIlvl.helm;              // the helm pricing change
    current.affixes.push({ key: 'baneUndead', max: 10 });   // new affixes
    current.costs.bane = 4;                                  // new cost
    const draft = structuredClone(base);
    const out = mergeDraft(base, current, draft);
    expect(out.basePricing.tierIlvl.helm).toBeUndefined();
    expect(out.affixes.map(a => a.key)).toEqual(['str', 'baneUndead']);
    expect(out.costs.bane).toBe(4);
  });

  it('keeps what the user edited', () => {
    const current = structuredClone(base);
    current.costs.atk = 10;
    const draft = structuredClone(base);
    draft.costs.ac = 25;
    draft.bases.helm[1].acBase = 1;
    const out = mergeDraft(base, current, draft);
    expect(out.costs.ac).toBe(25);         // user edit kept
    expect(out.costs.atk).toBe(10);        // file edit taken
    expect(out.bases.helm[1].acBase).toBe(1);
    expect(out.bases.helm[0].acBase).toBe(2);
  });

  it('merges record arrays per record, keeping user-added records', () => {
    const current = structuredClone(base);
    current.bases.helm[0].acBase = 3;
    const draft = structuredClone(base);
    draft.bases.helm.push({ name: 'Homemade Helm', acBase: 1 });
    const out = mergeDraft(base, current, draft);
    expect(out.bases.helm.map(h => h.name)).toEqual(['Bascinet', 'Cap', 'Homemade Helm']);
    expect(out.bases.helm[0].acBase).toBe(3);
  });
});

describe('stored drafts', () => {
  it('a v2 draft round-trips through pack/unpack', () => {
    const draft = structuredClone(base);
    draft.costs.ac = 30;
    const current = structuredClone(base);
    current.costs.bane = 4;
    const { data, legacy } = unpackDraft(packDraft(draft, base), current);
    expect(legacy).toBe(false);
    expect(data.costs).toEqual({ ac: 30, atk: 12, bane: 4 });
  });

  it('an old whole-file draft is flagged, filled in, and its overrides listed', () => {
    const current = structuredClone(base);
    delete current.basePricing.tierIlvl.helm;
    current.costs.bane = 4;
    current.affixes.push({ key: 'baneUndead', max: 10 });
    const { data, legacy } = unpackDraft(JSON.stringify(base), current);
    expect(legacy).toBe(true);
    expect(data.costs.bane).toBe(4);                                   // new keys filled
    expect(data.affixes.map(a => a.key)).toContain('baneUndead');      // new records filled
    expect(diffPaths(data, current)).toEqual(['basePricing.tierIlvl.helm']);
  });

  it('fillMissing leaves existing values alone', () => {
    expect(fillMissing({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: 3 });
  });
});
