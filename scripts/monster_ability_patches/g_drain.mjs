/* Batch G — Strength/Life Drain (onHit necrotic + until-rest `drained` max-HP
 * reduction). Copies the established wight/specter/wraith shape.
 */
const drain = (dc, dice, drainHp = 5) => ({
  key: 'life-drain',
  label: 'Life Drain',
  trigger: 'onHit',
  save: { ab: 'con', dc, half: true },
  dice,
  dmgType: 'necrotic',
  effect: { key: 'drained', drainHp },
  sprite: 'drain_red_1',
  color: 11563216,
});

export default {
  shadow: {
    append: {
      key: 'strength-drain',
      label: 'Strength Drain',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11, half: true },
      dice: [2, 6, 2],
      dmgType: 'necrotic',
      effect: { key: 'drained', drainHp: 3 },
      sprite: 'drain_red_1',
      color: 11563216,
    },
  },
  'shadow-fiend': {
    append: {
      key: 'strength-drain',
      label: 'Strength Drain',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11, half: true },
      dice: [2, 6, 2],
      dmgType: 'necrotic',
      effect: { key: 'drained', drainHp: 3 },
      sprite: 'drain_red_1',
      color: 11563216,
    },
  },
  'freezing-wraith': { append: drain(13, [3, 8, 2]) },
  'shadow-wraith': { append: drain(13, [3, 8, 2]) },
  'phantasmal-warrior': { append: drain(12, [3, 6, 2]) },
  'barrow-wight': { append: drain(12, [3, 6, 2]) },

  /* Reaper — disease bite that eats max HP until cured */
  reaper: {
    append: {
      key: 'bite-disease',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 12 },
      effect: { key: 'drained', drainHp: 3 },
      sprite: 'drain_red_1',
      color: 11563216,
    },
  },
};
