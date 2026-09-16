import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyEffect, hasEffect, getEffect, getEffectMods, tickEffects,
  clearEffectsByTag, rollSaveDetail, EFFECTS
} from '../src/game/conditions.js';
import { CLASS_SAVES } from '../src/game/srd.js';
import { monsterAiMethods } from '../src/game/monster_ai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monsters = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/game/monsters.json'), 'utf8'));

describe('Monster abilities data (monsters.json)', () => {
  const withAbilities = monsters.filter(m => m.abilities && m.abilities.length);

  it('covers the majority of the roster', () => {
    /* Phases A–H expanded ability coverage well past the original 30% "lean"
       guard. The lower bound still catches accidental purges; the upper bound
       just keeps the roster from being 100% ability-padded (plain attackers
       and flavor-only monsters are expected). */
    const share = withAbilities.length / monsters.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.9);
  });

  it('every ability entry is well-formed and references real registry keys', () => {
    const triggers = ['onHit', 'cycle', 'aura', 'onDeath', 'onDamaged', 'onKill', 'onBloodied'];
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    for (const m of withAbilities) {
      for (const ab of m.abilities) {
        expect(triggers, `${m.id}:${ab.key} trigger`).toContain(ab.trigger);
        expect(ab.label, `${m.id}:${ab.key} label`).toBeTruthy();
        if (ab.save) {
          expect(abilities, `${m.id}:${ab.key} save.ab`).toContain(ab.save.ab);
          expect(ab.save.dc).toBeGreaterThanOrEqual(8);
          /* Cap allows for high-tier bosses (SRD legitimately reaches DC 24 —
             ancient red/gold/silver dragon breaths). Trash mobs stay in the
             11-15 range. */
          expect(ab.save.dc).toBeLessThanOrEqual(24);
        }
        if (ab.effect) {
          expect(EFFECTS, `${m.id}:${ab.key} effect key`).toHaveProperty(ab.effect.key);
          /* only the until-rest specials may omit a duration */
          if (ab.effect.dur == null) expect(['drained', 'corroded']).toContain(ab.effect.key);
        }
        /* an ability must do SOMETHING — dice, a status effect, a kill-heal,
           a bloodied/kill self-buff, a blink/teleport, or pure visual flavor
           via fxOnly. */
        expect(
          !!(ab.dice || ab.effect || ab.fxOnly || ab.heal || ab.buff || ab.blink),
          `${m.id}:${ab.key} has dice, effect, heal, buff, blink, or fxOnly`
        ).toBe(true);
        if (ab.sprite) {
          const p = path.join(ROOT, 'public/dcss/effect', ab.sprite + '.png');
          expect(fs.existsSync(p), `${m.id}:${ab.key} sprite ${ab.sprite}`).toBe(true);
        }
      }
    }
  });

  it('signature monsters carry their SRD abilities', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    expect(byId['rust-monster'].abilities.some(a => a.effect?.key === 'corroded')).toBe(true);
    expect(byId['ghoul'].abilities.some(a => a.effect?.key === 'paralyzed')).toBe(true);
    expect(byId['hell-hound'].abilities.some(a => /breath/i.test(a.label))).toBe(true);
    expect(byId['harpy'].abilities.some(a => a.effect?.key === 'charmed')).toBe(true);
    expect(byId['wight'].abilities.some(a => a.effect?.key === 'drained')).toBe(true);
    expect(byId['magmin'].abilities.some(a => a.trigger === 'onDeath')).toBe(true);
    expect(byId['ghast'].abilities.some(a => a.trigger === 'aura')).toBe(true);
    expect(byId['wolf'].packTactics).toBe(true);
    expect(byId['zombie'].undeadFortitude).toBe(true);
    expect(byId['troll'].regen).toBeGreaterThan(0);
  });

  /* ─────────── Phase A–G regression: each phase added a specific
     engine capability + a batch of data entries. These tests pin the
     contract so a future revert can't silently drop a phase. ─────────── */

  it('Phase A: death-burst monsters carry an onDeath ability', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    for (const id of ['magmin', 'balor', 'efreeti', 'fire-elemental',
                      'ice-fiend', 'salamander', 'shadow-dragon-ancient',
                      'hellion', 'cacodemon']) {
      const has = byId[id].abilities?.some(a => a.trigger === 'onDeath');
      expect(has, `${id} should have an onDeath ability`).toBe(true);
    }
  });

  it('Phase B: aura monsters (mechanical + fxOnly flavor)', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    // Mechanical auras apply an effect or dice.
    expect(byId['hellion'].abilities.some(a => a.trigger === 'aura' && a.dice)).toBe(true);
    expect(byId['mummy-lord'].abilities.some(a => a.trigger === 'aura' && a.effect)).toBe(true);
    expect(byId['shadow-dragon-ancient'].abilities.some(a => a.trigger === 'aura')).toBe(true);
    // fxOnly flavor auras — no dice, no effect, just a glow telegraph.
    expect(byId['giant-fire-beetle'].abilities.some(a => a.trigger === 'aura' && a.fxOnly === true)).toBe(true);
    expect(byId['giant-firefly'].abilities.some(a => a.fxOnly === true)).toBe(true);
    expect(byId['fire-bat'].abilities.some(a => a.fxOnly === true)).toBe(true);
    expect(byId['will-o-wisp'].abilities.some(a => a.fxOnly === true)).toBe(true);
  });

  it('Phase C: onHit riders on flagship monsters and partial-impl top-ups', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    expect(byId['medusa'].abilities.some(a => a.trigger === 'onHit' && a.effect?.key === 'poisoned')).toBe(true);
    expect(byId['ettercap'].abilities.some(a => a.trigger === 'onHit' && a.effect?.key === 'restrained')).toBe(true);
    expect(byId['wight-king'].abilities.some(a => a.trigger === 'onHit' && a.effect?.key === 'frightened')).toBe(true);
    expect(byId['reaper-lord'].abilities.some(a => a.trigger === 'onHit' && a.effect?.key === 'drained')).toBe(true);
    expect(byId['bugbear'].abilities.some(a => a.trigger === 'onHit' && a.dice)).toBe(true);
    expect(byId['purple-worm'].abilities.some(a => a.trigger === 'onHit' && a.effect?.key === 'prone')).toBe(true);
  });

  it('Phase D: cycle spells on flagship bosses', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    for (const id of ['shadow-dragon-ancient', 'hellion', 'tormentor',
                      'vampire-knight', 'vampire-mage', 'wight-king',
                      'reaper-lord', 'mummy-priest', 'greater-mummy',
                      'guardian-mummy', 'guardian-serpent', 'harpy-matriarch',
                      'orc-warlord', 'fey-queen', 'goblin-king',
                      'broodmother-spider', 'drow-matron', 'adult-gold-dragon',
                      'wizard', 'cloud-giant', 'green-hag']) {
      const has = byId[id].abilities?.some(a => a.trigger === 'cycle');
      expect(has, `${id} should have a cycle ability`).toBe(true);
    }
  });

  it('Phase E: at-spawn variants unlock dual-weapon monsters', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    // Currently-locked-ranged monsters should have variants AND no longer
    // carry a hard-locked `ranged: true` flag.
    for (const id of ['goblin', 'kobold', 'skeleton', 'hobgoblin',
                      'orc', 'gnoll', 'manticore', 'salamander', 'fire-giant']) {
      expect(byId[id].variants, `${id} should have variants`).toEqual(['melee', 'ranged']);
      expect(byId[id].ranged, `${id} should no longer be hard-locked ranged`).toBeUndefined();
      expect(byId[id].rngRange, `${id} should keep rngRange`).toBeGreaterThan(0);
    }
    // Currently-melee monsters should gain variants without losing anything.
    for (const id of ['bugbear', 'ogre', 'medusa', 'wight', 'stone-giant',
                      'hill-giant', 'frost-giant', 'cloud-giant', 'treant',
                      'centaur', 'drow', 'satyr']) {
      expect(byId[id].variants, `${id} should have variants`).toEqual(['melee', 'ranged']);
    }
  });

  it('Phase F: new triggers (onDamaged / onKill / onBloodied) on signature monsters', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    // onDamaged: retaliation against attacker
    expect(byId['fire-elemental'].abilities.some(a => a.trigger === 'onDamaged')).toBe(true);
    expect(byId['salamander'].abilities.some(a => a.trigger === 'onDamaged')).toBe(true);
    // onKill: self-buff / self-heal
    expect(byId['gnoll'].abilities.some(a => a.trigger === 'onKill' && a.buff)).toBe(true);
    expect(byId['orc'].abilities.some(a => a.trigger === 'onKill' && a.buff)).toBe(true);
    expect(byId['vampire-spawn'].abilities.some(a => a.trigger === 'onKill' && a.heal)).toBe(true);
    // onBloodied: enrage-style
    expect(byId['flesh-golem'].abilities.some(a => a.trigger === 'onBloodied')).toBe(true);
    expect(byId['orc-warlord'].abilities.some(a => a.trigger === 'onBloodied')).toBe(true);
  });

  it('Phase G: multiattack on dragons, giants, and flagship bosses', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));

    /* Counts follow the SRD Multiattack entries. This test previously asserted
       a hand-tuned ramp (young dragons 2, troll 2, balor 3, tarrasque 3) that
       the expanded bestiary replaced with the SRD values. Whether to reinstate
       a game-balance ramp is an open design question — see the bug tracker —
       but the data should not silently disagree with the test meanwhile. */

    // Dragons: bite + 2 claws at every age band.
    expect(byId['adult-red-dragon'].attacksPerTurn).toBe(3);
    expect(byId['shadow-dragon-ancient'].attacksPerTurn).toBe(3);
    expect(byId['young-red-dragon'].attacksPerTurn).toBe(3);

    // Giants: one big swing each, 2 across the board.
    for (const id of ['stone-giant', 'hill-giant', 'frost-giant', 'cloud-giant', 'fire-giant']) {
      expect(byId[id].attacksPerTurn, `${id} should attack twice`).toBe(2);
    }

    // Troll: bite + 2 claws.
    expect(byId['troll'].attacksPerTurn).toBe(3);
    // Undead leaders: 2.
    expect(byId['wight-king'].attacksPerTurn).toBe(2);
    expect(byId['vampire-knight'].attacksPerTurn).toBe(2);
    // Balor: longsword + whip.
    expect(byId['balor'].attacksPerTurn).toBe(2);
    // Tarrasque: bite, 2 claws, horns, tail.
    expect(byId['tarrasque'].attacksPerTurn).toBe(5);

    /* Whatever the tuning, every flagship attacker must swing more than once —
       that is what the multiattack pass was for. */
    for (const id of ['adult-red-dragon', 'young-red-dragon', 'troll', 'balor', 'tarrasque']) {
      expect(byId[id].attacksPerTurn, `${id} should multiattack`).toBeGreaterThan(1);
    }
  });

  it('Phase H: full-roster ability pass — drains, breaths, flags, blink, invis', () => {
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    const has = (id, pred) => byId[id]?.abilities?.some(pred) === true;

    /* Strength / Life Drain → drained (until a rest) */
    for (const id of ['shadow', 'shadow-fiend', 'freezing-wraith', 'shadow-wraith']) {
      expect(has(id, a => a.effect?.key === 'drained'), `${id} should drain`).toBe(true);
    }
    /* Mephit death bursts */
    for (const id of ['steam-mephit', 'magma-mephit', 'ice-mephit', 'dust-mephit']) {
      expect(has(id, a => a.trigger === 'onDeath'), `${id} should explode on death`).toBe(true);
    }
    /* Dragon breath coverage: wyrmlings through ancients, incl. the gas breaths */
    expect(has('brass-dragon-wyrmling', a => a.effect?.key === 'unconscious')).toBe(true);
    expect(has('copper-dragon-wyrmling', a => a.effect?.key === 'slowed')).toBe(true);
    expect(has('silver-dragon-wyrmling', a => a.effect?.key === 'paralyzed')).toBe(true);
    for (const id of ['adult-red-dragon', 'ancient-red-dragon', 'adult-blue-dragon',
                      'ancient-white-dragon', 'young-brass-dragon', 'dragon-turtle']) {
      expect(has(id, a => a.trigger === 'cycle' && a.dice), `${id} should have a breath`).toBe(true);
    }
    /* Frightful presence on adult/ancient dragons */
    for (const id of ['adult-blue-dragon', 'ancient-copper-dragon', 'golden-dragon-ancient']) {
      expect(has(id, a => a.effect?.key === 'frightened'), `${id} should frighten`).toBe(true);
    }
    /* Petrify now uses the real petrified condition */
    for (const id of ['basilisk', 'medusa', 'cockatrice', 'caustic-shrike', 'gorgon']) {
      expect(has(id, a => a.effect?.key === 'petrified'), `${id} should petrify`).toBe(true);
    }
    /* Rampage / aggressive onKill buffs */
    expect(has('giant-hyena', a => a.trigger === 'onKill' && a.buff)).toBe(true);
    for (const id of ['orc-warrior', 'orc-priest', 'orc-knight', 'orc-wizard']) {
      expect(has(id, a => a.trigger === 'onKill' && a.buff), `${id} aggressive`).toBe(true);
    }
    /* Invisibility self-buff */
    for (const id of ['imp', 'quasit', 'sprite', 'invisible-stalker', 'green-hag']) {
      expect(has(id, a => a.buff?.key === 'invisible'), `${id} should go invisible`).toBe(true);
    }
    /* Blink / teleport reposition */
    for (const id of ['blink-dog', 'phase-spider', 'ghost', 'unicorn', 'marilith']) {
      expect(has(id, a => a.blink), `${id} should blink`).toBe(true);
    }
    /* Shared flags */
    expect(byId['troll-family']?.regen).toBeUndefined(); // sentinel
    for (const id of ['deep-troll', 'iron-troll', 'rock-troll', 'vampire-knight', 'oni']) {
      expect(byId[id].regen, `${id} regen`).toBeGreaterThan(0);
    }
    expect(byId['sahuagin'].bloodFrenzy).toBe(true);
    expect(byId['hobgoblin'].martialAdvantage).toBe(true);
    expect(byId['swarm-of-rats'].swarm).toBe(true);
    expect(byId['grey-rat'].packTactics).toBe(true);
    expect(byId['giant-vulture'].packTactics).toBe(true);
    expect(byId['night-hag'].magicResistance).toBe(true);
    expect(byId['unicorn'].magicResistance).toBe(true);
    /* Deep-dwarf Enlarge */
    for (const id of ['deep-dwarf-berserker', 'deep-dwarf-artificer', 'deep-dwarf-death-knight']) {
      expect(has(id, a => a.trigger === 'onBloodied' && a.buff?.key === 'enlarged'),
        `${id} enlarge`).toBe(true);
    }
  });

  it('engine: monsterAiMethods exposes the new trigger hooks', () => {
    /* All four original triggers + the three Phase-F additions should be
       callable on the monsterAiMethods mixin. */
    expect(typeof monsterAiMethods.tickMonsterAuras).toBe('function');
    expect(typeof monsterAiMethods.applyOnHitAbilities).toBe('function');
    expect(typeof monsterAiMethods.monsterDeathBurst).toBe('function');
    expect(typeof monsterAiMethods.applyOnDamagedAbilities).toBe('function');
    expect(typeof monsterAiMethods.applyOnKillAbilities).toBe('function');
    expect(typeof monsterAiMethods.applyOnBloodiedAbilities).toBe('function');
  });

  it('engine: bloodlust effect registered for rampage / berserk buffs', () => {
    expect(EFFECTS.bloodlust).toBeDefined();
    expect(EFFECTS.bloodlust.dmgBonus).toBeGreaterThan(0);
    expect(EFFECTS.bloodlust.speedMul).toBeGreaterThan(1);
    /* applied to a monster: getEffectMods surfaces the modifiers */
    const m = { data: { type: 'humanoid' } };
    applyEffect(m, 'bloodlust', { duration: 5, elapsed: 0 });
    const mods = getEffectMods(m);
    expect(mods.dmgBonus).toBeGreaterThanOrEqual(2);
    expect(mods.speedMul).toBeGreaterThan(1);
  });

  it('VFX: every ability sprite resolves to a file on disk', () => {
    /* The data-layer regression: every `ab.sprite` reference must point at
       a real PNG file. Catches typos and bad re-points immediately. The
       DCSS family lives in public/dcss/effect/, the Kenney family is
       prefixed `kny_` and lives in the same directory. */
    const fxDir = path.join(ROOT, 'public/dcss/effect');
    const files = new Set(fs.readdirSync(fxDir).filter(f => f.endsWith('.png')));
    const checked = [], missing = [];
    for (const m of withAbilities) {
      for (const ab of m.abilities) {
        if (!ab.sprite) continue;
        checked.push(`${m.id}/${ab.key}:${ab.sprite}`);
        if (!files.has(ab.sprite + '.png')) missing.push(`${m.id}/${ab.key}:${ab.sprite}`);
      }
    }
    expect(missing, `missing sprite files: ${missing.join(', ')}`).toEqual([]);
    expect(checked.length, 'total sprite references checked').toBeGreaterThan(140);
  });

  it('VFX: damage-type → sprite-family de-duplication (Phase VFX polish)', () => {
    /* Phase VFX polish assigned each damage type its own visual identity.
       Verify the canonical mappings survived. */
    const byId = Object.fromEntries(monsters.map(m => [m.id, m]));
    // Force damage (wizard magic missile) → magic_bolt family
    const mm = byId['wizard'].abilities.find(a => a.key === 'magic-missile');
    expect(mm.sprite).toMatch(/^magic_bolt_\d$/);
    // Cold breath (white dragons) → icicle family
    for (const id of ['young-white-dragon', 'adult-white-dragon', 'white-dragon-wyrmling']) {
      const ab = byId[id].abilities.find(a => /cold|breath/i.test(a.key));
      expect(ab.sprite).toMatch(/^icicle_\d$/);
    }
    // Lightning breath (behir, blue-dragon) → cloud_storm family
    for (const id of ['behir', 'blue-dragon-wyrmling']) {
      const ab = byId[id].abilities.find(a => /lightning|breath/i.test(a.key));
      expect(ab.sprite).toMatch(/^cloud_storm_\d$/);
    }
    // Petrifying gaze → cloud_calc_dust family
    for (const id of ['basilisk', 'medusa']) {
      const ab = byId[id].abilities.find(a => /petrify|gaze/i.test(a.key));
      expect(ab.sprite).toMatch(/^cloud_calc_dust_\d$/);
    }
    // Necrotic boss death-bursts → cloud_neg family
    expect(byId['shadow-dragon-ancient'].abilities.find(a => a.trigger === 'onDeath').sprite)
      .toMatch(/^cloud_neg_\d$/);
    expect(byId['cacodemon'].abilities.find(a => a.trigger === 'onDeath').sprite)
      .toMatch(/^cloud_neg_\d$/);
    // fxOnly glow auras → heataura family (not cloud_fire)
    for (const id of ['giant-fire-beetle', 'giant-firefly', 'fire-bat']) {
      const ab = byId[id].abilities.find(a => a.fxOnly === true);
      expect(ab.sprite).toMatch(/^heataura_\d$/);
    }
    // Will-o-wisp flicker → orb_glow family
    expect(byId['will-o-wisp'].abilities.find(a => a.fxOnly === true).sprite)
      .toMatch(/^orb_glow_\d$/);
    // Buff/heal triggers now carry sprites (engine renders them)
    expect(byId['flesh-golem'].abilities.find(a => a.trigger === 'onBloodied').sprite)
      .toMatch(/^flame_\d$/);
    expect(byId['gnoll'].abilities.find(a => a.trigger === 'onKill').sprite)
      .toMatch(/^gold_sparkles_\d$/);
    expect(byId['vampire-spawn'].abilities.find(a => a.trigger === 'onKill').sprite)
      .toMatch(/^drain_red_\d$/);
  });

  it('VFX: Kenney CC0 sprites integrated for gap damage types', () => {
    /* The Kenney Particle Pack fills gaps DCSS can't cover (slashing arc,
       radiant/holy burst, etc.). 27 curated sprites prefixed `kny_`. */
    const fxDir = path.join(ROOT, 'public/dcss/effect');
    const knyFiles = fs.readdirSync(fxDir).filter(f => f.startsWith('kny_') && f.endsWith('.png'));
    expect(knyFiles.length, 'Kenney sprite count').toBeGreaterThanOrEqual(20);
    // Spot-check the gap-filling sprites
    for (const stem of ['kny_slash_0', 'kny_star_0', 'kny_spark_0', 'kny_magic_0',
                        'kny_claw_0', 'kny_smoke_0', 'kny_dust_0', 'kny_light_0',
                        'kny_glyph_0', 'kny_scorch_0']) {
      expect(fs.existsSync(path.join(fxDir, stem + '.png')),
        `${stem} should exist (gap-filling Kenney sprite)`).toBe(true);
    }
  });
});

describe('Stacking effects (corroded / drained)', () => {
  it('corroded stacks -1 AC per application', () => {
    const hero = { data: { type: 'humanoid' } };
    applyEffect(hero, 'corroded', { elapsed: 0, tag: 'rest' });
    applyEffect(hero, 'corroded', { elapsed: 1, tag: 'rest' });
    applyEffect(hero, 'corroded', { elapsed: 2, tag: 'rest' });
    expect(getEffect(hero, 'corroded').stacks).toBe(3);
    expect(getEffectMods(hero).acBonus).toBe(-3);
  });

  it('until-rest effects persist through ticks and clear by tag', () => {
    const hero = { data: { type: 'humanoid' } };
    applyEffect(hero, 'corroded', { elapsed: 0, tag: 'rest' });
    tickEffects(hero, 99999);   // no duration → survives any elapsed time
    expect(hasEffect(hero, 'corroded')).toBe(true);
    clearEffectsByTag(hero, 'rest');
    expect(hasEffect(hero, 'corroded')).toBe(false);
  });
});

describe('Saving throws', () => {
  it('class save proficiencies add proficiency to the roll', () => {
    expect(CLASS_SAVES.fighter).toEqual(['str', 'con']);
    /* hero with saves populated (as recalc does): proficient save uses the total */
    const hero = { data: { effStats: { con: 14, dex: 10 }, saves: { con: 5 } } };
    let hi = 0, lo = 0;
    for (let i = 0; i < 200; i++) {
      const r = rollSaveDetail(hero, 'con', 10);
      expect(r.mod).toBe(5);            // proficient: stat-block style total
      hi++;
    }
    const r2 = rollSaveDetail(hero, 'dex', 10);
    expect(r2.mod).toBe(0);             // non-proficient: bare ability mod
  });

  it('magic resistance grants advantage on saves vs magic', () => {
    /* statistical: advantaged saves should succeed more often */
    const plain = { data: { effStats: { wis: 10 } } };
    const resistant = { data: { effStats: { wis: 10 }, magicResistance: true } };
    let a = 0, b = 0;
    for (let i = 0; i < 3000; i++) {
      if (rollSaveDetail(plain, 'wis', 12, { magic: true }).saved) a++;
      if (rollSaveDetail(resistant, 'wis', 12, { magic: true }).saved) b++;
    }
    expect(b).toBeGreaterThan(a);
  });
});

describe('Repeat saves shake off conditions', () => {
  it('a paralyzed entity re-rolls on the repeat-save cadence and can recover', () => {
    /* huge save mod → guaranteed success on the first repeat save */
    const hero = { data: { effStats: { con: 40 } } };
    applyEffect(hero, 'paralyzed', {
      duration: 60, elapsed: 0,
      repeatSave: { ability: 'con', dc: 10, every: 6 },
    });
    expect(hasEffect(hero, 'paralyzed')).toBe(true);
    tickEffects(hero, 7);   // past the first repeat-save checkpoint
    expect(hasEffect(hero, 'paralyzed')).toBe(false);
  });
});

describe('Monster ability primitives (Phase H)', () => {
  it('petrified / enlarged / invisible effect keys are registered', () => {
    expect(EFFECTS.petrified).toBeDefined();
    expect(EFFECTS.petrified.incapacitated).toBe(true);
    expect(EFFECTS.petrified.autoCritMelee).toBe(true);
    expect(EFFECTS.enlarged).toBeDefined();
    expect(EFFECTS.enlarged.dmgMul).toBeGreaterThan(1);
    expect(EFFECTS.invisible).toBeDefined();
    expect(EFFECTS.invisible.invisible).toBe(true);
  });

  it('getEffectMods surfaces the invisible flag', () => {
    const m = { data: { type: 'fiend' } };
    expect(getEffectMods(m).invisible).toBe(false);
    applyEffect(m, 'invisible', { duration: 6, elapsed: 0 });
    expect(getEffectMods(m).invisible).toBe(true);
  });

  it('petrified and enlarged apply their mechanical modifiers', () => {
    const p = { data: { type: 'humanoid' } };
    applyEffect(p, 'petrified', { duration: 6, elapsed: 0 });
    const pm = getEffectMods(p);
    expect(pm.incapacitated).toBe(true);
    expect(pm.autoCritMelee).toBe(true);

    const e = { data: { type: 'humanoid' } };
    applyEffect(e, 'enlarged', { duration: 6, elapsed: 0 });
    const em = getEffectMods(e);
    expect(em.dmgDealtMul).toBeGreaterThan(1);
    expect(em.dmgBonus).toBeGreaterThan(0);
  });

  it('revealInvisible drops the invisible effect (engine hook exposed)', () => {
    expect(typeof monsterAiMethods.revealInvisible).toBe('function');
    const m = { data: { type: 'fiend' } };
    applyEffect(m, 'invisible', { duration: 60, elapsed: 0 });
    expect(hasEffect(m, 'invisible')).toBe(true);
    monsterAiMethods.revealInvisible.call({ fxLog() {}, fxSprite() {}, _v3: () => ({}) }, m);
    expect(hasEffect(m, 'invisible')).toBe(false);
  });
});
