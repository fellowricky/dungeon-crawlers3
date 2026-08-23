/* Batch C — Charge / Pounce / Trampling Charge (onHit riders that add the
 * extra charge damage and knock the target prone). DCs from the statblocks.
 */
const CHARGE = { sprite: 'sandblast_0', color: 12558432 };

export default {
  'giant-goat': {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 13 },
      dice: [2, 4, 0],
      dmgType: 'bludgeoning',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'giant-boar': {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 13 },
      dice: [2, 6, 0],
      dmgType: 'slashing',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'giant-elk': {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 14 },
      dice: [2, 6, 0],
      dmgType: 'bludgeoning',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  centaur: {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      dice: [3, 6, 0],
      dmgType: 'piercing',
      ...CHARGE,
    },
  },
  'minotaur-skeleton': {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 14 },
      dice: [2, 8, 0],
      dmgType: 'piercing',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'death-yak': {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 14 },
      dice: [2, 8, 0],
      dmgType: 'piercing',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  unicorn: {
    append: {
      key: 'charge',
      label: 'Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 15 },
      dice: [2, 8, 0],
      dmgType: 'piercing',
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'dire-elephant': {
    append: {
      key: 'trampling-charge',
      label: 'Trampling Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 12 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  mammoth: {
    append: {
      key: 'trampling-charge',
      label: 'Trampling Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 18 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  triceratops: {
    append: {
      key: 'trampling-charge',
      label: 'Trampling Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 13 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  gorgon: {
    append: {
      key: 'trampling-charge',
      label: 'Trampling Charge',
      trigger: 'onHit',
      save: { ab: 'str', dc: 16 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'saber-toothed-tiger': {
    append: {
      key: 'pounce',
      label: 'Pounce',
      trigger: 'onHit',
      save: { ab: 'str', dc: 14 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
  'weretiger-hybrid': {
    append: {
      key: 'pounce',
      label: 'Pounce',
      trigger: 'onHit',
      save: { ab: 'str', dc: 14 },
      effect: { key: 'prone', dur: 4 },
      ...CHARGE,
    },
  },
};
