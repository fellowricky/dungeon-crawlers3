/**
 * Audio coverage — guards the promise that every spell, class feature and
 * monster ability has *a place* for its sound effect.
 *
 * These tests do not require the audio to exist. A slot may be declared and
 * unrecorded (empty file list in audio.js); what they forbid is an ability
 * with no slot at all, a slot name that is a typo, and a recorded slot whose
 * .wav files are not actually on disk.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SPELL_SFX, SFX_SLOTS, SFX_FALLBACK, resolveSfx,
  CANTRIP_SFX, DMG_TYPE_SFX, SOUND_META,
} from '../src/game/audio.js';
import { ABILITY_FX } from '../src/game/combat.js';
import { SPELLS } from '../src/game/spells.js';
import { BOSS_SPELL_FX } from '../src/game/monster_ai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOUND_DIR = path.join(ROOT, 'public/sounds');

const abilityKeys = [...new Set([
  ...Object.keys(ABILITY_FX),
  ...Object.keys(SPELLS),
  ...Object.keys(BOSS_SPELL_FX),
])];

describe('SFX slot registry', () => {
  it('gives every slot either audio files or a documented fallback chain', () => {
    for (const [slot, files] of Object.entries(SFX_SLOTS)) {
      expect(Array.isArray(files), `${slot} must map to an array of variants`).toBe(true);
      const target = SFX_FALLBACK[slot];
      if (target) expect(SFX_SLOTS[target], `${slot} falls back to unknown slot ${target}`).toBeDefined();
    }
  });

  it('resolves fallback chains without cycles', () => {
    for (const slot of Object.keys(SFX_SLOTS)) {
      expect(() => resolveSfx(slot)).not.toThrow();
    }
  });

  it('ships the files every recorded slot names', () => {
    const missing = [];
    for (const [slot, files] of Object.entries(SFX_SLOTS)) {
      for (const f of files) {
        if (!fs.existsSync(path.join(SOUND_DIR, f))) missing.push(`${slot}: ${f}`);
      }
    }
    expect(missing, `sound files referenced but not on disk:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('Spell / ability sound coverage', () => {
  it('maps every ability, spell and boss spell to a slot', () => {
    const unmapped = abilityKeys.filter(k => !SPELL_SFX[k]);
    expect(unmapped, `abilities with no sound slot:\n${unmapped.join(', ')}`).toEqual([]);
  });

  it('only names slots that exist', () => {
    const bad = Object.entries(SPELL_SFX)
      .filter(([, slot]) => !SFX_SLOTS[slot])
      .map(([k, slot]) => `${k} → ${slot}`);
    expect(bad, `sound slots that do not exist:\n${bad.join('\n')}`).toEqual([]);
  });

  it('has no stale entries for abilities that no longer exist', () => {
    const orphans = Object.keys(SPELL_SFX).filter(k => !abilityKeys.includes(k));
    expect(orphans, `SPELL_SFX entries with no matching ability:\n${orphans.join(', ')}`).toEqual([]);
  });
});

/* The registry is edited through sound_editor.html, so guard the shape the
   editor writes as well as the mappings the game reads. */
describe('sounds.json shape', () => {
  it('routes every caster class and damage type to a real slot', () => {
    const bad = [
      ...Object.entries(CANTRIP_SFX).map(([k, v]) => [`cantrip ${k}`, v]),
      ...Object.entries(DMG_TYPE_SFX).map(([k, v]) => [`damage type ${k}`, v]),
    ].filter(([, slot]) => !SFX_SLOTS[slot]).map(([k, slot]) => `${k} → ${slot}`);
    expect(bad, `routed to slots that do not exist:\n${bad.join('\n')}`).toEqual([]);
  });

  it('gives every slot the metadata the editor needs', () => {
    for (const [name, meta] of Object.entries(SOUND_META)) {
      expect(typeof meta.category, `${name} needs a category`).toBe('string');
      expect(Array.isArray(meta.files), `${name}.files must be an array`).toBe(true);
      expect(typeof meta.note, `${name} needs a note field (may be empty)`).toBe('string');
    }
  });

  /* A slot with real audio that nothing routes to is a spare asset — the
     editor's Library tab surfaces those. A slot with NO audio that nothing
     routes to is dead weight: a placeholder no sound will ever come out of. */
  it('has no unrecorded slot that nothing routes to', () => {
    /* Slots reached by name from a playSfx() call in the source rather than
       through the ability tables. Keep in sync when adding a hard-coded call. */
    const HARD_CODED = new Set([
      'swordAttack', 'swordHit', 'swordBlock', 'swordParry',
      'bowAttack', 'bowHit', 'bowBlock',
      'chestOpen', 'doorOpen', 'gateOpen', 'portcullis', 'lockUnlock',
      'spellBuff', 'spellImpact', 'spellFire',
      'skillRoll', 'skillSuccess', 'skillFail', 'skillCrit', 'skillFumble',
      'lootRare', 'lootLegendary',
    ]);
    const reached = new Set([
      ...HARD_CODED,
      ...Object.values(SPELL_SFX),
      ...Object.values(CANTRIP_SFX),
      ...Object.values(DMG_TYPE_SFX),
      ...Object.values(SFX_FALLBACK),
    ]);
    const unused = Object.keys(SFX_SLOTS)
      .filter(n => !reached.has(n) && !SFX_SLOTS[n].length);
    expect(unused, `placeholder slots nothing routes to — delete them or wire them up:\n${unused.join(', ')}`).toEqual([]);
  });
});
