/* Batch F — Grapple / Constrict / Swallow / Engulf (restrained + acid/blood dot).
 * Uses the established constrict shape (save str → restrained with repeat saves,
 * plus a per-round dotDmg to represent being held/consumed).
 */
const constrict = (dc, dot = 2, key = 'constrict', label = 'Constrict') => ({
  key, label, trigger: 'onHit',
  save: { ab: 'str', dc },
  effect: { key: 'restrained', dur: 8, repeatSave: true, dotDmg: dot },
  sprite: 'net_trap',
  color: 12558432,
});
const swallow = (dc, dot = 5, key = 'swallow', label = 'Swallow') => ({
  key, label, trigger: 'cycle',
  save: { ab: 'str', dc },
  effect: { key: 'restrained', dur: 8, repeatSave: true, dotDmg: dot },
  sprite: 'net_trap',
  color: 12558432,
});

export default {
  'giant-octopus': {
    append: constrict(16, 3, 'tentacles', 'Tentacles'),
  },
  couatl: {
    append: constrict(15, 2),
  },
  behir: {
    append: constrict(16, 4),
  },
  'blink-frog': {
    append: constrict(11, 1),
  },
  'shambling-mound': {
    append: swallow(14, 5, 'engulf', 'Engulf'),
  },
  tarrasque: {
    append: swallow(20, 8),
  },
};
