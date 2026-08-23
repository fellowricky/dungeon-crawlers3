/* Batch B — onHit poison riders (bites/stings/crossbow bolts that deal extra
 * poison damage or inflict the poisoned condition). DCs come from the statblock.
 */
const POISON = { sprite: 'cloud_poison_0', color: 5025356 };

export default {
  homunculus: {
    append: {
      key: 'bite-poison',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 10 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  'flying-snake': {
    append: {
      key: 'bite-poison',
      label: 'Venomous Bite',
      trigger: 'onHit',
      dice: [3, 4, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'giant-ant': {
    append: {
      key: 'bite-poison',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11 },
      dice: [3, 6, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'giant-mite': {
    append: {
      key: 'bite-poison',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11, half: true },
      dice: [3, 6, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'deep-elf-fighter': {
    append: {
      key: 'hand-crossbow',
      label: 'Poisoned Crossbow',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  'deep-elf-knight': {
    append: {
      key: 'hand-crossbow',
      label: 'Poisoned Crossbow',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  'deep-elf-blademaster': {
    append: {
      key: 'hand-crossbow',
      label: 'Poisoned Crossbow',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  'deep-elf-master-archer': {
    append: {
      key: 'hand-crossbow',
      label: 'Poisoned Crossbow',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  sprite: {
    append: {
      key: 'shortbow-poison',
      label: 'Poisoned Shortbow',
      trigger: 'onHit',
      save: { ab: 'con', dc: 10 },
      effect: { key: 'poisoned', dur: 60 },
      ...POISON,
    },
  },
  'giant-blowfly': {
    append: {
      key: 'sting',
      label: 'Sting',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11, half: true },
      dice: [3, 6, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  bumblebee: {
    append: {
      key: 'sting',
      label: 'Sting',
      trigger: 'onHit',
      save: { ab: 'con', dc: 11, half: true },
      dice: [3, 6, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'swarm-of-poisonous-snakes': {
    append: {
      key: 'bites',
      label: 'Bites',
      trigger: 'onHit',
      save: { ab: 'con', dc: 10, half: true },
      dice: [4, 6, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  drider: {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13 },
      dice: [2, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'naga-warrior': {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13, half: true },
      dice: [3, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'greater-naga': {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13, half: true },
      dice: [3, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'naga-ritualist': {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 13, half: true },
      dice: [3, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'naga-mage': {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 12, half: true },
      dice: [2, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
  'naga-sharpshooter': {
    append: {
      key: 'bite',
      label: 'Bite',
      trigger: 'onHit',
      save: { ab: 'con', dc: 12, half: true },
      dice: [2, 8, 0],
      dmgType: 'poison',
      ...POISON,
    },
  },
};
