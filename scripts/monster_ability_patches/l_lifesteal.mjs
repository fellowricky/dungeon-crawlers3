/* Batch L — Blood Drain / Draining Kiss (onHit lifesteal + bleed/max-HP drain).
 * `heal:true` heals the monster for the damage dealt; `heal:N` is a flat amount.
 */
export default {
  stirge: {
    append: {
      key: 'blood-drain', label: 'Blood Drain', trigger: 'onHit',
      heal: 2,
      effect: { key: 'wounded', dur: 4, dotDmg: 2 },
      sprite: 'drain_red_1',
      color: 11563216,
    },
  },
  'giant-mosquito': {
    append: {
      key: 'blood-drain', label: 'Blood Drain', trigger: 'onHit',
      heal: 2,
      effect: { key: 'wounded', dur: 4, dotDmg: 2 },
      sprite: 'drain_red_1',
      color: 11563216,
    },
  },
  'succubus-incubus': {
    append: {
      key: 'draining-kiss', label: 'Draining Kiss', trigger: 'onHit',
      save: { ab: 'con', dc: 15 },
      dice: [3, 6, 0], dmgType: 'necrotic',
      heal: true,
      effect: { key: 'drained', drainHp: 3 },
      sprite: 'drain_red_2',
      color: 11546672,
    },
  },
};
