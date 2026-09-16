/* Batch M — Invisibility (cycle self-buff). Invisible monsters can't be
 * auto-targeted by heroes and drop invisibility the moment they attack.
 */
const invis = {
  key: 'invisibility',
  label: 'Invisibility',
  trigger: 'cycle',
  buff: { key: 'invisible' },
  sprite: 'cloud_magic_trail_1',
  color: 0xaabbcc,
};

export default {
  imp: { append: invis },
  quasit: { append: invis },
  sprite: { append: invis },
  'invisible-stalker': { append: invis },
  'green-hag': { append: invis },
};
