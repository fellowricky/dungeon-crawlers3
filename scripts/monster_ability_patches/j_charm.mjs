/* Batch J — charm / enslave / intoxicating touch (the `charmed` condition,
 * which blocks attacking the charmer). Uses the harpy luring-song shape.
 */
const charm = (dc, key, label, trigger = 'cycle') => ({
  key, label, trigger,
  save: { ab: 'wis', dc },
  effect: { key: 'charmed', dur: 12, repeatSave: true },
  sprite: 'quad_glow',
  color: 15247615,
});

export default {
  'succubus-incubus': { append: charm(15, 'charm', 'Charm') },
  aboleth: { append: charm(14, 'enslave', 'Enslave') },
  lamia: { append: charm(14, 'intoxicating-touch', 'Intoxicating Touch', 'onHit') },
};
