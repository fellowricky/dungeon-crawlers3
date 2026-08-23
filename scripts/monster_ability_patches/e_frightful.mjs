/* Batch E — Frightful Presence / Dreadful Glare / Horror Nimbus (cycle frighten).
 * Dragon DCs from statblocks; the established adult-white shape is copied.
 */
const fright = (dc, aoe = 3.2) => ({
  key: 'frightful-presence',
  label: 'Frightful Presence',
  trigger: 'cycle',
  save: { ab: 'wis', dc },
  effect: { key: 'frightened', dur: 8, repeatSave: true },
  aoe,
  sprite: 'cloud_gloom_new',
  color: 10181046,
});

export default {
  'adult-red-dragon': { append: fright(19) },
  'adult-gold-dragon': { append: fright(21) },
  tarrasque: { append: fright(17) },
  'golden-dragon': { append: fright(21) },
  'iron-dragon-ancient': { append: fright(16) },
  'golden-dragon-ancient': { append: fright(24) },
  'adult-blue-dragon': { append: fright(17) },
  'adult-green-dragon': { append: fright(16) },
  'adult-black-dragon': { append: fright(16) },
  'adult-silver-dragon': { append: fright(18) },
  'adult-brass-dragon': { append: fright(16) },
  'adult-bronze-dragon': { append: fright(17) },
  'adult-copper-dragon': { append: fright(16) },
  'ancient-red-dragon': { append: fright(21) },
  'ancient-black-dragon': { append: fright(19) },
  'ancient-blue-dragon': { append: fright(20) },
  'ancient-green-dragon': { append: fright(19) },
  'ancient-white-dragon': { append: fright(16) },
  'ancient-silver-dragon': { append: fright(21) },
  'ancient-brass-dragon': { append: fright(18) },
  'ancient-bronze-dragon': { append: fright(20) },
  'ancient-copper-dragon': { append: fright(19) },

  /* Dreadful Glare — mummy-priest (mummy/guardian/greater/mummy-lord already carry it) */
  'mummy-priest': {
    append: {
      key: 'dreadful-glare',
      label: 'Dreadful Glare',
      trigger: 'cycle',
      save: { ab: 'wis', dc: 11 },
      effect: { key: 'frightened', dur: 4, repeatSave: true },
      sprite: 'cloud_gloom_new',
      color: 10181046,
    },
  },

  /* Horror Nimbus — nalfeshnee */
  nalfeshnee: {
    append: {
      key: 'horror-nimbus',
      label: 'Horror Nimbus',
      trigger: 'cycle',
      save: { ab: 'wis', dc: 15 },
      effect: { key: 'frightened', dur: 8, repeatSave: true },
      aoe: 2.8,
      sprite: 'cloud_gloom_new',
      color: 10181046,
    },
  },

  /* Roar — androsphinx */
  androsphinx: {
    append: {
      key: 'roar',
      label: 'Roar',
      trigger: 'cycle',
      save: { ab: 'wis', dc: 18 },
      effect: { key: 'frightened', dur: 8, repeatSave: true },
      aoe: 3.2,
      sprite: 'cloud_gloom_new',
      color: 10181046,
    },
  },

  /* Horrific Appearance — sea-hag (frightened on sight; Death Glare's
     "kill a frightened creature" rider is too narrow to model) */
  'sea-hag': {
    append: {
      key: 'horrific-appearance',
      label: 'Horrific Appearance',
      trigger: 'cycle',
      save: { ab: 'wis', dc: 11 },
      effect: { key: 'frightened', dur: 8, repeatSave: true },
      aoe: 2.8,
      sprite: 'cloud_gloom_new',
      color: 10181046,
    },
  },
};
