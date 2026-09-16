/* Batch K — petrification (upgraded from `restrained` to the new `petrified`
 * effect) plus giant-spider Web and the orange-brain Blinding Spittle.
 */
const gaze = (dc, key, label) => ({
  key, label, trigger: 'cycle',
  save: { ab: 'con', dc },
  effect: { key: 'petrified', dur: 60, repeatSave: true },
  sprite: 'cloud_calc_dust_0',
  color: 12558432,
});

export default {
  /* basilisk / medusa / cockatrice: petrify for real now */
  basilisk: {
    abilities: gaze(12, 'petrifying-gaze', 'Petrifying Gaze'),
  },
  medusa: {
    abilities: [
      gaze(14, 'petrifying-gaze', 'Petrifying Gaze'),
      {
        key: 'snake-hair', label: 'Snake Hair', trigger: 'onHit',
        chance: 0.4,
        save: { ab: 'con', dc: 14 },
        dice: [2, 4, 0], dmgType: 'poison',
        effect: { key: 'poisoned', dur: 6 },
        sprite: 'cloud_poison_0', color: 5025356,
      },
    ],
  },
  cockatrice: {
    abilities: {
      key: 'bite', label: 'Bite', trigger: 'onHit',
      save: { ab: 'con', dc: 11 },
      effect: { key: 'petrified', dur: 60, repeatSave: true },
      sprite: 'cloud_calc_dust_0',
      color: 12558432,
    },
  },
  'caustic-shrike': {
    append: {
      key: 'bite', label: 'Bite', trigger: 'onHit',
      save: { ab: 'con', dc: 11 },
      effect: { key: 'petrified', dur: 60, repeatSave: true },
      sprite: 'cloud_calc_dust_0',
      color: 12558432,
    },
  },

  /* gorgon Petrifying Breath */
  gorgon: {
    append: {
      key: 'petrifying-breath', label: 'Petrifying Breath', trigger: 'cycle',
      save: { ab: 'con', dc: 16 },
      effect: { key: 'petrified', dur: 60, repeatSave: true },
      aoe: 2.8,
      sprite: 'cloud_calc_dust_0',
      color: 12558432,
    },
  },

  /* giant-spider Web — restrained by webbing */
  'giant-spider': {
    append: {
      key: 'web', label: 'Web', trigger: 'cycle',
      save: { ab: 'str', dc: 12 },
      effect: { key: 'restrained', dur: 6, repeatSave: true },
      sprite: 'net_trap',
      color: 12558432,
    },
  },

  /* giant-orange-brain Blinding Spittle */
  'giant-orange-brain': {
    append: {
      key: 'blinding-spittle', label: 'Blinding Spittle', trigger: 'cycle',
      save: { ab: 'dex', dc: 13 },
      effect: { key: 'blinded', dur: 60, repeatSave: true },
      aoe: 2.2,
      sprite: 'cloud_yellow_smoke',
      color: 8947848,
    },
  },
};
