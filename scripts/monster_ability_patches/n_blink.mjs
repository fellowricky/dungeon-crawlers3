/* Batch N — Blink / Teleport / Ethereal Jaunt (OA-free reposition).
 * `blink.range` is in cells; the monster snaps to a nearby unoccupied floor
 * cell (preferring one nearer its target) without provoking opportunity
 * attacks.
 */
const blink = (range) => ({
  key: 'teleport',
  label: 'Teleport',
  trigger: 'cycle',
  blink: { range },
  sprite: 'cloud_tloc_energy',
  color: 9421032,
});

export default {
  'blink-dog': { append: blink(4) },
  'phase-spider': { append: blink(3) },
  ghost: { append: blink(4) },
  unicorn: { append: blink(5) },
  marilith: { append: blink(4) },
  nalfeshnee: { append: blink(4) },
};
