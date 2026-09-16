/**
 * AI decision trace — a record of what each hero decided on its turn, and why.
 *
 * The combat log tells you what HAPPENED ("Sir Gareth misses the ogre"). It
 * never told you what the AI was *thinking*, which made awkward behaviour
 * ("the paladin keeps running around instead of attacking") almost impossible
 * to diagnose: you could see the symptom and only guess at the branch that
 * caused it.
 *
 * This records one entry per decision point, tagged with the hero and the turn,
 * so a whole turn can be replayed as a sequence of choices. It is OFF by
 * default and every call site is a single `if (Trace.on)` check, so it costs
 * nothing in normal play.
 *
 * Turn it on:
 *   in game    — window.__aiTrace(true), then window.__aiTraceDump()
 *   in the sim — attachAiMetrics() enables it and reports the worst turns
 *
 * The point of the `why` field is to be readable out loud. "moved: target out
 * of reach (4.2 > 1.4)" is useful; "branch 3" is not.
 */

export const Trace = {
  on: false,
  /* Ring buffer — a long fight would otherwise grow without bound. */
  max: 4000,
  entries: [],

  enable(v = true) { this.on = !!v; if (!v) this.clear(); },
  clear() { this.entries.length = 0; },

  /**
   * @param {object} e      the acting entity
   * @param {string} event  short machine-ish tag: 'target' | 'move' | 'attack' | …
   * @param {string} why    human-readable reason, the bit you actually read
   * @param {object} [data] optional structured extras
   */
  /** Optional sink, so decisions can be mirrored into the in-game combat log
   *  (see game.__aiTraceLog) without this module knowing anything about the UI. */
  sink: null,

  record(e, event, why, data = null) {
    if (!this.on) return;
    const d = e && e.data;
    if (this.sink) {
      try { this.sink(e, event, why); } catch { /* a broken sink must never break combat */ }
    }
    this.entries.push({
      t: Date.now(),
      name: (d && d.name) || '?',
      cls: (d && d.classKey) || '',
      hp: d ? `${d.hp}/${d.maxHp}` : '',
      round: this._round ?? -1,
      event,
      why,
      data,
    });
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  },

  /** Entries grouped into turns: one group per contiguous run by the same actor. */
  turns() {
    const out = [];
    let cur = null;
    for (const en of this.entries) {
      if (!cur || cur.name !== en.name || cur.round !== en.round) {
        cur = { name: en.name, cls: en.cls, round: en.round, hp: en.hp, steps: [] };
        out.push(cur);
      }
      cur.steps.push(en);
    }
    return out;
  },

  /** Turns where the actor never produced anything — the ones worth reading. */
  idleTurns() {
    return this.turns().filter(t =>
      !t.steps.some(s => s.event === 'attack' || s.event === 'cast' || s.event === 'heal'));
  },

  /** Flat, readable dump. `filter` narrows by hero name or class. */
  format(filter = null) {
    const lines = [];
    for (const t of this.turns()) {
      if (filter && t.name !== filter && t.cls !== filter) continue;
      lines.push(`── ${t.name} (${t.cls}) hp ${t.hp} · round ${t.round}`);
      for (const s of t.steps) lines.push(`     ${s.event.padEnd(9)} ${s.why}`);
    }
    return lines.join('\n');
  },
};

/** Wire window.__aiTrace / __aiTraceDump so it can be driven from the console. */
export function installTraceConsole() {
  if (typeof window === 'undefined') return;
  window.__aiTrace = (v = true) => { Trace.enable(v); return `AI trace ${v ? 'ON' : 'OFF'}`; };
  window.__aiTraceDump = (filter) => Trace.format(filter);
  window.__aiTraceIdle = (filter) => Trace.idleTurns()
    .filter(t => !filter || t.name === filter || t.cls === filter)
    .map(t => `── ${t.name} (${t.cls}) hp ${t.hp} · round ${t.round}\n`
      + t.steps.map(s => `     ${s.event.padEnd(9)} ${s.why}`).join('\n'))
    .join('\n');
  window.__aiTraceRaw = () => Trace.entries;
}
