/**
 * Editor drafts vs. project files — a three-way merge.
 *
 * The loot editor keeps its work in localStorage. It used to save the WHOLE
 * data file and load it back verbatim, so any later change to the project file
 * (new affixes, a pricing rule, a new cost) was silently shadowed by the stale
 * copy in the browser. Helms kept their old tier pricing in the editor for
 * exactly that reason.
 *
 * Now a draft is stored as { v: 2, baseline, data }: `baseline` is the project
 * file as it was when the draft was made. On load, `mergeDraft` keeps only what
 * the user actually CHANGED from that baseline and takes everything else from
 * the current file:
 *
 *   draft value === baseline value  -> user didn't touch it -> use current file
 *   draft value !== baseline value  -> user edited it       -> keep the draft
 *
 * Arrays of records (bases, affixes) merge per record, matched by `key` or
 * `name`, so editing one helm doesn't freeze the whole helm list.
 *
 * Pure functions, no DOM — unit tested in test/editor_draft_merge.test.js.
 */

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
}

/** Identity of a record inside an array, or null if it has none. */
const idOf = r => (isObj(r) ? (r.key ?? r.name ?? r.id ?? null) : null);
const isRecordArray = a => Array.isArray(a) && a.length > 0 && a.every(r => idOf(r) != null);

/** Three-way merge. Returns a fresh value; inputs are not mutated. */
export function mergeDraft(baseline, current, draft) {
  if (draft === undefined) return clone(current);
  if (deepEqual(draft, baseline)) return clone(current);       // untouched
  if (current === undefined) return clone(draft);               // draft-only addition

  if (isObj(draft) && isObj(current) && isObj(baseline)) {
    const out = {};
    const keys = new Set([...Object.keys(current), ...Object.keys(draft)]);
    for (const k of keys) {
      const inBase = k in baseline, inDraft = k in draft, inCur = k in current;
      if (!inDraft && inBase) continue;                          // user deleted it
      if (!inCur && inBase && deepEqual(draft[k], baseline[k])) continue;   // file deleted it
      const v = mergeDraft(baseline[k], current[k], draft[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  if (isRecordArray(current) && Array.isArray(draft) && Array.isArray(baseline)
      && draft.every(r => idOf(r) != null)) {
    const byId = arr => new Map(arr.map(r => [idOf(r), r]));
    const B = byId(baseline), D = byId(draft);
    const out = [];
    for (const r of current) {
      const id = idOf(r);
      if (!D.has(id) && B.has(id)) continue;                     // user deleted it
      out.push(mergeDraft(B.get(id), r, D.get(id)));
    }
    const curIds = new Set(current.map(idOf));
    for (const r of draft) {
      const id = idOf(r);
      if (!curIds.has(id) && !B.has(id)) out.push(clone(r));     // user added it
    }
    return out;
  }

  return clone(draft);                                           // edited leaf / changed shape
}

/** Fill what the draft is missing from `current`, recursively (legacy
 *  drafts): absent keys, and absent records in record arrays (new affixes). */
export function fillMissing(draft, current) {
  if (isRecordArray(current) && Array.isArray(draft) && draft.every(r => idOf(r) != null)) {
    const have = new Set(draft.map(idOf));
    const byId = new Map(current.map(r => [idOf(r), r]));
    const out = draft.map(r => (byId.has(idOf(r)) ? fillMissing(r, byId.get(idOf(r))) : r));
    for (const r of current) if (!have.has(idOf(r))) out.push(clone(r));
    return out;
  }
  if (!isObj(draft) || !isObj(current)) return draft;
  const out = { ...draft };
  for (const k in current) {
    if (!(k in out)) out[k] = clone(current[k]);
    else out[k] = fillMissing(out[k], current[k]);
  }
  return out;
}

/** Paths where `a` differs from `b` ("bases.helm.Bascinet.acBase"). Used to
 *  show what an old draft is overriding. `_`-prefixed notes are ignored. */
export function diffPaths(a, b, prefix = '', out = []) {
  if (deepEqual(a, b)) return out;
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k.startsWith('_')) continue;
      diffPaths(a[k], b[k], prefix ? prefix + '.' + k : k, out);
    }
    return out;
  }
  if (isRecordArray(a) && isRecordArray(b)) {
    const B = new Map(b.map(r => [idOf(r), r]));
    for (const r of a) diffPaths(r, B.get(idOf(r)), prefix + '.' + idOf(r), out);
    return out;
  }
  out.push(prefix || '(root)');
  return out;
}

/** Wrap data for storage with the baseline it was edited from. */
export function packDraft(data, baseline) {
  return JSON.stringify({ v: 2, baseline, data });
}

/**
 * Read a stored draft against the current project file.
 * Returns { data, legacy } — `legacy` is true for an old whole-file draft, which
 * can't be merged (its baseline is unknown) and so still overrides the file.
 */
export function unpackDraft(raw, current) {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.v === 2 && 'baseline' in parsed) {
    return { data: mergeDraft(parsed.baseline, current, parsed.data), legacy: false };
  }
  return { data: fillMissing(parsed, current), legacy: true };
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
