import { describe, it, expect } from 'vitest';
import { getCuratedTacticalRoom, getCuratedTacticalRooms, isRoomStyleEnabled, TACTICAL_ROOMS_RAW } from '../src/game/srd.js';

describe('Curated Tactical Rooms', () => {
  it('loads tactical_rooms.json defaults properly', () => {
    const all = getCuratedTacticalRooms();
    expect(all).toBeDefined();
    expect(all.swarm).toBeDefined();
    expect(all.swarm.ancient).toBeDefined();
    expect(all.swarm.molten).toBeDefined();
    expect(all.swarm.enabledThemes).toContain('ancient');
    expect(all.swarm.enabledThemes).toContain('molten');
  });

  it('correctly retrieves each level from 1 to 20 for Infestation (swarm)', () => {
    // Level 1
    const l1 = getCuratedTacticalRoom('swarm', 'ancient', 1);
    expect(l1).toEqual(['giant-rat', 'giant-bat', 'skeleton']);

    // Level 2
    const l2 = getCuratedTacticalRoom('swarm', 'ancient', 2);
    expect(l2).toEqual(['giant-rat', 'giant-bat', 'skeleton']);

    // Level 4
    const l4 = getCuratedTacticalRoom('swarm', 'ancient', 4);
    expect(l4).toEqual(['giant-centipede', 'swarm-of-bats', 'swarm-of-rats']);

    // Level 8
    const l8 = getCuratedTacticalRoom('swarm', 'ancient', 8);
    expect(l8).toEqual(['giant-centipede', 'brain-worm-swarm']);

    // Level 20
    const l20 = getCuratedTacticalRoom('swarm', 'ancient', 20);
    expect(l20).toEqual(['broodmother-spider']);
  });

  it('correctly checks whether a room style is enabled for a given biome', () => {
    // Swarm is enabled for ancient and molten
    expect(isRoomStyleEnabled('swarm', 'ancient')).toBe(true);
    expect(isRoomStyleEnabled('swarm', 'molten')).toBe(true);

    // Necromantic graveyard is only in grim and ancient by default
    expect(isRoomStyleEnabled('necromantic', 'ancient')).toBe(true);
    expect(isRoomStyleEnabled('necromantic', 'grim')).toBe(true);
    expect(isRoomStyleEnabled('necromantic', 'frost')).toBe(false);

    // Brood nest is in verdant, forest, mire, moor by default
    expect(isRoomStyleEnabled('nest', 'verdant')).toBe(true);
    expect(isRoomStyleEnabled('nest', 'ancient')).toBe(false);
  });

  it('correctly retrieves theme-specific vermin for Molten dungeons', () => {
    const moltenSwarm = getCuratedTacticalRoom('swarm', 'molten', 1);
    expect(moltenSwarm).toContain('cinder-rat');
    expect(moltenSwarm).toContain('ash-mite');
    expect(moltenSwarm).toContain('fire-bat');
  });

  it('returns null if a room style is disabled for a biome', () => {
    // nest is disabled in ancient by default
    const disabled = getCuratedTacticalRoom('nest', 'ancient', 1);
    expect(disabled).toBeNull();
  });

  it('handles unknown styles or missing themes cleanly with null', () => {
    const unknown = getCuratedTacticalRoom('non_existent_style', 'ancient', 1);
    expect(unknown).toBeNull();

    const missingTheme = getCuratedTacticalRoom('swarm', 'unknown_theme', 1);
    expect(missingTheme).toBeNull();
  });
});
