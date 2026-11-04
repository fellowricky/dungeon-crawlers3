/* Palette ramps (dark -> bright) for recolouring pixelfx effects, beyond the
   core PAL set. Shared by status auras and body effects. */
export const RAMPS = {
  necrotic: ['#0a0c07', '#161d0e', '#26321a', '#3d4d22', '#5f702c', '#8b9a3e', '#bcc77a', '#eef2c8'],
  acid:     ['#151405', '#2e2c08', '#55520c', '#8a8a10', '#c2c81c', '#e8f05a', '#fafcb8'],
  spectral: ['#0c0a12', '#22203a', '#46466e', '#7a7fa8', '#b8bedc', '#eef0ff'],
  faerie:   ['#1a0a24', '#3c1450', '#6a2a8c', '#a24cc8', '#d488f0', '#f6c8ff', '#ffffff'],
  /* PAL.night with its top steps lifted: straight night (top #2f2956) all but vanishes on the floor */
  hush:     ['#07060d', '#131026', '#241f44', '#3a3470', '#5a52a0', '#8a84d0', '#c8c4f4'],
  /* Restrained: PAL.bone's wrapping (web silk, rope) with a pale glow in place of the roots' green */
  silkGlow: ['#3a352c', '#8a806c', '#e4dcc8', '#fffaf0'],
  marked:   ['#04140f', '#0a2a22', '#11483a', '#178f72', '#1abc9c', '#6ce8c8', '#c8fff0', '#ffffff'],  // the game's Marked teal
};

/** An 8-step ramp from a spell's own colours: near-black up through `color`,
 *  across toward `core`, to white — so a beam or burst keyed by a spell's
 *  color/coreColor gets a palette without one being authored for it. */
export function rampFrom(color, core = 0xffffff) {
  const ch = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const [r, g, b] = ch(color), [R, G, B] = ch(core);
  const dark = [0.07, 0.16, 0.3, 0.52, 0.78].map(k => hex(r * k, g * k, b * k));
  return [...dark, hex(r, g, b), hex(r + (R - r) * 0.6, g + (G - g) * 0.6, b + (B - b) * 0.6), '#ffffff'];
}
