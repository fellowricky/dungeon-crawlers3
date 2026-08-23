/* Batch P — misc fill: ooze corrosion (Corrosive Form) and the two remaining
 * glowing beetles (Illumination fxOnly aura, matching their kin).
 */
const corrode = {
  key: 'corrosive-form',
  label: 'Corrosive Form',
  trigger: 'onHit',
  save: { ab: 'dex', dc: 12 },
  effect: { key: 'corroded' },
  sprite: 'cloud_acid_0',
  color: 13672544,
};
const glow = {
  key: 'illumination',
  label: 'Illumination',
  trigger: 'aura',
  fxOnly: true,
  aoe: 1.8,
  every: 2,
  sprite: 'heataura_0',
  color: 16756314,
};

export default {
  'gray-ooze': { append: corrode },
  'black-pudding': { append: corrode },
  'giant-slug': { append: corrode },
  'giant-amoeba': { append: corrode },
  'boulder-beetle': { append: glow },
  'giant-beetle': { append: glow },
};
