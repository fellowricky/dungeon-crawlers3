/* Batch I — onKill self-buffs: gnoll Rampage / orc Aggressive for the family
 * members that lacked them. Copies the existing gnoll/orc entries.
 */
const rampage = { key: 'rampage', label: 'Rampage', trigger: 'onKill',
  buff: { key: 'bloodlust', dur: 5 }, sprite: 'gold_sparkles_1' };
const aggressive = { key: 'aggressive', label: 'Aggressive', trigger: 'onKill',
  buff: { key: 'bloodlust', dur: 4 }, sprite: 'gold_sparkles_1' };

export default {
  'giant-hyena': { append: rampage },
  'orc-whelp': { append: aggressive },
  'orc-warrior': { append: aggressive },
  'orc-priest': { append: aggressive },
  'orc-knight': { append: aggressive },
  'orc-high-priest': { append: aggressive },
  'orc-wizard': { append: aggressive },
  'orc-sorcerer': { append: aggressive },
};
