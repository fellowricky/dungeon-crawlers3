import { describe, it, expect } from 'vitest';
import { heroLightSource } from '../src/game/light_sources.js';

describe('the Light cantrip toggle', () => {
  it('shines by default and goes out when the hero turns it off', () => {
    const d = { knownSpells: ['light'], equipment: {} };
    expect(heroLightSource(d)).toBe('light');
    d.lightOff = true;
    expect(heroLightSource(d)).toBe(null);
    d.lightOff = false;
    expect(heroLightSource(d)).toBe('light');
  });

  it('turning it off does not put out a torch the hero carries', () => {
    const d = { knownSpells: ['light'], lightOff: true, equipment: { trinket: { lightSource: 'torch', charges: 5 } } };
    expect(heroLightSource(d)).toBe('torch');
  });
});
