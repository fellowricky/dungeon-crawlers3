/**
 * Switches for the balance-test harness (sim/real), which plays the real game
 * in fast-forward with nobody watching.
 *
 * `fast` skips work whose only product is the picture: drawing the frame, the
 * floor's darkness tint, per-sprite shading, status aura effects. It must never
 * gate anything the rules read — every site that checks it says what it keeps.
 * Always false in normal play.
 */
export const SIM = { fast: false };
