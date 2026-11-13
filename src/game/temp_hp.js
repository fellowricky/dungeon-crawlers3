/* Temporary HP that stacks across sources.

   d.tempHp stays the single number everything reads and damage drains
   (combat.js absorbTempHp). Alongside it, d.tempHpSrc remembers how much of
   that pool each source put there, so:
     - a DIFFERENT source adds on top (Thick Hide + Inspiring Leader + a potion),
     - the SAME source again only refreshes its own share up to the new amount
       (Dark Blessing on every kill tops itself back up, it doesn't pile up).

   The map is reconciled lazily against d.tempHp on each grant: damage only
   lowers d.tempHp, and the shortfall is taken from the oldest shares first.
   Grants that still write d.tempHp directly (flat "+N" rewards) show up as
   untracked pool and are kept under 'other'. */

function syncTempHpSources(d) {
  const total = Math.max(0, d.tempHp || 0);
  if (total <= 0) { d.tempHp = 0; d.tempHpSrc = {}; return d.tempHpSrc; }
  const map = (d.tempHpSrc && typeof d.tempHpSrc === 'object') ? d.tempHpSrc : {};
  let sum = 0;
  for (const k of Object.keys(map)) sum += Math.max(0, map[k] || 0);
  if (sum > total) {
    let excess = sum - total;
    for (const k of Object.keys(map)) {
      if (excess <= 0) break;
      const take = Math.min(map[k] || 0, excess);
      map[k] = (map[k] || 0) - take;
      excess -= take;
    }
  } else if (sum < total) {
    map.other = (map.other || 0) + (total - sum);
  }
  for (const k of Object.keys(map)) if (!(map[k] > 0)) delete map[k];
  d.tempHpSrc = map;
  return map;
}

/** Give `amount` temp HP from `source` to hero data `d`. Returns how much the
 *  pool actually grew (0 when that source's share was already that high). */
export function grantTempHp(d, source, amount) {
  if (!d || !(amount > 0)) return 0;
  const map = syncTempHpSources(d);
  const key = source || 'other';
  const have = map[key] || 0;
  const add = Math.max(0, Math.round(amount) - have);
  if (add <= 0) return 0;
  map[key] = have + add;
  d.tempHp = (d.tempHp || 0) + add;
  return add;
}
