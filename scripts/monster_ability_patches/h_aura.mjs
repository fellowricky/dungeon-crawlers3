/* Batch H — auras (stench/fear/fire/darkness), onDamaged retaliation
 * (heated body / barbed hide), and the mephit death bursts + elemental claws.
 */
const POISON = { sprite: 'cloud_poison_0', color: 5025356 };
const FIRE = { sprite: 'cloud_fire_1', color: 16742960 };

export default {
  /* ── Auras ── */
  'green-death': {
    append: {
      key: 'stench', label: 'Stench', trigger: 'aura',
      save: { ab: 'con', dc: 13 },
      effect: { key: 'poisoned', dur: 6 },
      aoe: 1.8, every: 4, ...POISON,
    },
  },
  'pit-fiend': {
    append: {
      key: 'fear-aura', label: 'Fear Aura', trigger: 'aura',
      save: { ab: 'wis', dc: 21 },
      effect: { key: 'frightened', dur: 8 },
      aoe: 2.5, every: 4,
      sprite: 'cloud_gloom_new', color: 10181046,
    },
  },
  fiend: {
    append: {
      key: 'fear-aura', label: 'Fear Aura', trigger: 'aura',
      save: { ab: 'wis', dc: 21 },
      effect: { key: 'frightened', dur: 8 },
      aoe: 2.5, every: 4,
      sprite: 'cloud_gloom_new', color: 10181046,
    },
  },
  balor: {
    append: {
      key: 'fire-aura', label: 'Fire Aura', trigger: 'aura',
      save: { ab: 'dex', dc: 21, half: true },
      dice: [2, 8, 0], dmgType: 'fire',
      aoe: 1.8, every: 4, ...FIRE,
    },
  },
  balrug: {
    append: {
      key: 'fire-aura', label: 'Fire Aura', trigger: 'aura',
      save: { ab: 'dex', dc: 21, half: true },
      dice: [2, 8, 0], dmgType: 'fire',
      aoe: 1.8, every: 4, ...FIRE,
    },
  },
  manes: {
    append: {
      key: 'fetid-cloud', label: 'Fetid Cloud', trigger: 'aura',
      save: { ab: 'con', dc: 11 },
      effect: { key: 'poisoned', dur: 8 },
      aoe: 1.8, every: 4, ...POISON,
    },
  },
  darkmantle: {
    append: {
      key: 'darkness-aura', label: 'Darkness Aura', trigger: 'aura',
      save: { ab: 'con', dc: 11 },
      effect: { key: 'blinded', dur: 6 },
      aoe: 2.0, every: 4,
      sprite: 'cloud_black_smoke', color: 8947848,
    },
  },

  /* ── onDamaged retaliation ── */
  remorhaz: {
    append: {
      key: 'heated-body', label: 'Heated Body', trigger: 'onDamaged',
      chance: 1, dice: [1, 10, 0], dmgType: 'fire',
      sprite: 'heataura_0', color: 16742960,
    },
  },
  azer: {
    abilities: [
      {
        key: 'heated-body', label: 'Heated Body', trigger: 'onDamaged',
        chance: 1, dice: [1, 8, 0], dmgType: 'fire',
        sprite: 'heataura_0', color: 16742960,
      },
      {
        key: 'heated-weapons', label: 'Heated Weapons', trigger: 'onHit',
        chance: 0.5, dice: [1, 6, 0], dmgType: 'fire',
        sprite: 'heataura_0', color: 16742960,
      },
    ],
  },
  'barbed-devil': {
    append: {
      key: 'barbed-hide', label: 'Barbed Hide', trigger: 'onDamaged',
      chance: 1, dice: [1, 10, 0], dmgType: 'piercing',
      sprite: 'needle_0', color: 12632256,
    },
  },
  hellion: {
    append: {
      key: 'barbed-hide', label: 'Barbed Hide', trigger: 'onDamaged',
      chance: 1, dice: [1, 10, 0], dmgType: 'piercing',
      sprite: 'needle_0', color: 12632256,
    },
  },

  /* ── Mephit death bursts + elemental claws ── */
  'steam-mephit': { append: [
    {
      key: 'death-burst', label: 'Death Burst', trigger: 'onDeath',
      save: { ab: 'dex', dc: 10, half: true },
      dice: [1, 8, 0], dmgType: 'fire', aoe: 2.0, ...FIRE,
    },
    {
      key: 'claws', label: 'Claws', trigger: 'onHit',
      dice: [1, 4, 0], dmgType: 'fire', sprite: 'flame_1', color: 16742960,
    },
  ]},
  'magma-mephit': { append: [
    {
      key: 'death-burst', label: 'Death Burst', trigger: 'onDeath',
      save: { ab: 'dex', dc: 11, half: true },
      dice: [2, 6, 0], dmgType: 'fire', aoe: 2.0, ...FIRE,
    },
    {
      key: 'claws', label: 'Claws', trigger: 'onHit',
      dice: [1, 4, 0], dmgType: 'fire', sprite: 'flame_1', color: 16742960,
    },
  ]},
  'ice-mephit': { append: [
    {
      key: 'death-burst', label: 'Death Burst', trigger: 'onDeath',
      save: { ab: 'dex', dc: 10, half: true },
      dice: [1, 8, 0], dmgType: 'cold', aoe: 2.0,
      sprite: 'frost_0', color: 8377599,
    },
    {
      key: 'claws', label: 'Claws', trigger: 'onHit',
      dice: [1, 4, 0], dmgType: 'cold', sprite: 'frost_0', color: 8377599,
    },
  ]},
  'dust-mephit': {
    append: {
      key: 'death-burst', label: 'Death Burst', trigger: 'onDeath',
      save: { ab: 'con', dc: 10 },
      effect: { key: 'blinded', dur: 60, repeatSave: true },
      aoe: 2.0, sprite: 'cloud_yellow_smoke', color: 8947848,
    },
  },
};
