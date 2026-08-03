import { describe, it, expect } from 'vitest';

describe('Hero Menu Skills Tab Proficiencies Display', () => {
  it('formats armor and weapon proficiencies correctly for martial and caster classes', async () => {
    const { CLASSES } = await import('../src/game/srd.js');
    
    // Fighter: Heavy armor, Shields, Martial weapons
    const fighterCls = CLASSES.fighter;
    expect(fighterCls.armorProf).toBe('heavy');
    expect(fighterCls.shieldProf).toBe(true);
    expect(fighterCls.weaponProf).toBe('martial');

    // Rogue: Light armor, Simple + Rapier/Shortsword/Longsword
    const rogueCls = CLASSES.rogue;
    expect(rogueCls.armorProf).toBe('light');
    expect(rogueCls.shieldProf).toBe(false);
    expect(rogueCls.weaponSpecific).toContain('Rapier');

    // Wizard: Unarmored (none), Simple weapons
    const wizardCls = CLASSES.wizard;
    expect(wizardCls.armorProf).toBe('none');
    expect(wizardCls.weaponProf).toBe('simple');
  });
});
