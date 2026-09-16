/* Batch O — Deep-dwarf Enlarge (onBloodied self-buff: magically grows and
 * deals +25% damage for a while, via the `enlarged` effect).
 */
const enlarge = {
  key: 'enlarge',
  label: 'ENLARGED',
  trigger: 'onBloodied',
  buff: { key: 'enlarged', dur: 10 },
  sprite: 'gold_sparkles_1',
};

export default {
  'deep-dwarf-berserker': { append: enlarge },
  'deep-dwarf-artificer': { append: enlarge },
  'deep-dwarf-death-knight': { append: enlarge },
};
