/* Monster ability builder — makes the SRD stat-block text MECHANICAL.
   Scans each monster's statblock.traits/actions for save-forcing abilities
   (DC N <ability> saving throw), parses the canonical numbers (DC, dice,
   damage type, half-on-save, rider conditions), and writes an `abilities`
   array in the game's fx shape (see monster_ai.js _castAbilityFx):

     { key, label, trigger: 'onHit'|'cycle'|'aura'|'onDeath',
       save:{ab,dc,half?}, dice?, dmgType?, effect:{key,dur?,repeatSave?,dotDmg?,drainHp?},
       aoe?, every?, sprite, color }

   Also emits passive flags consumed by the engine:
     packTactics / undeadFortitude / magicResistance / regen

   Run: node tools/build_abilities.mjs           (dry-run: prints the table)
        node tools/build_abilities.mjs --write   (writes monsters.json)
   Idempotent — regenerates the `abilities` field from scratch each run. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'src/game/monsters.json');
const WRITE = process.argv.includes('--write');

const monsters = JSON.parse(fs.readFileSync(GAME, 'utf8'));

/* ---------- sprite / color routing ---------- */
const DMG_FX = {
  fire:        { sprite:'cloud_fire_1',   color:0xff7a30 },
  cold:        { sprite:'frost_0',        color:0x7fd4ff },
  lightning:   { sprite:'zap_2',          color:0x7090ff },
  acid:        { sprite:'acid_venom',     color:0x4cae4c },
  poison:      { sprite:'cloud_poison_0', color:0x4cae4c },
  necrotic:    { sprite:'cloud_neg_1',    color:0x6a3080 },
  radiant:     { sprite:'goldaura_1',     color:0xffd34a },
  thunder:     { sprite:'sandblast_1',    color:0xd0a0ff },
  psychic:     { sprite:'cloud_gloom_new',color:0x9b59b6 },
  force:       { sprite:'magic_bolt_1',   color:0xb08cff },
  bludgeoning: { sprite:'rock_0',         color:0xbfa060 },
  piercing:    { sprite:'needle_0',       color:0xbfa060 },
  slashing:    { sprite:'sandblast_0',    color:0xbfa060 },
};
const EFF_FX = {
  poisoned:   { sprite:'cloud_poison_0', color:0x4cae4c },
  paralyzed:  { sprite:'silenced',       color:0x8090c0 },
  restrained: { sprite:'net_trap',       color:0xbfa060 },
  frightened: { sprite:'cloud_gloom_new',color:0x9b59b6 },
  charmed:    { sprite:'quad_glow',      color:0xe8a8ff },
  blinded:    { sprite:'cloud_black_smoke', color:0x888899 },
  stunned:    { sprite:'disjunct_0',     color:0xffd34a },
  prone:      { sprite:'sandblast_0',    color:0xbfa060 },
  slowed:     { sprite:'cloud_blue_smoke', color:0x8fd4e8 },
  incapacitated: { sprite:'cloud_gloom_new', color:0x999999 },
  drained:    { sprite:'drain_red_1',    color:0xb070d0 },
  corroded:   { sprite:'cloud_acid_0',   color:0xd0a060 },
  charmedTeam:{ sprite:'quad_glow',      color:0xe8a8ff },
};

/* ---------- text parsing ---------- */
const SAVE_RE = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\w* saving throw/i;
const AB_KEY = { strength:'str', dexterity:'dex', constitution:'con', intelligence:'int', wisdom:'wis', charisma:'cha' };

function parseSave(desc) {
  const m = SAVE_RE.exec(desc);
  if (!m) return null;
  return { ab: AB_KEY[m[2].toLowerCase()], dc: +m[1] };
}
/* "taking 22 (4d10) lightning damage on a failed save" / "takes 14 (4d6) fire damage" */
function parseSaveDice(desc) {
  const m = /tak(?:ing|es?) \d+ \((\d+)d(\d+)(?:\s*\+\s*(\d+))?\) (\w+) damage/i.exec(desc);
  if (!m) return null;
  return { dice: [+m[1], +m[2], +m[3] || 0], dmgType: m[4].toLowerCase(),
           half: /half as much damage/i.test(desc) };
}
/* condition keywords following the save ("be X", "becomes X", "is X") */
const COND = (w) => new RegExp(`(?:be|becomes?|is) (?:magically )?${w}`);
function parseCondition(desc) {
  /* RAW spider/centipede/wasp paralysis only kicks in at 0 HP — drop that
     clause so the everyday failed save is damage-only */
  let d = desc.toLowerCase();
  const zero = d.indexOf('reduces the target to 0 hit points');
  if (zero >= 0) d = d.slice(0, zero);
  if (COND('paralyzed').test(d)) return 'paralyzed';
  if (COND('petrified').test(d) || /begins? to turn to stone/.test(d)) return 'restrained'; // petrify ≈ held fast
  if (COND('poisoned').test(d)) return 'poisoned';
  if (COND('frightened').test(d)) return 'frightened';
  if (COND('charmed').test(d)) return 'charmed';
  if (COND('restrained').test(d) || /is grappled|grappled \(escape/.test(d)) return 'restrained';
  if (COND('stunned').test(d)) return 'stunned';
  if (COND('blinded').test(d)) return 'blinded';
  if (/knocked prone|falls prone/.test(d)) return 'prone';
  if (/speed is reduced|speed is halved/.test(d)) return 'slowed';
  return null;
}
/* game-seconds duration from SRD wording (until-rest is reserved for the
   drained/corroded specials — parsed conditions always get a duration) */
function parseDur(desc, cond) {
  const d = desc.toLowerCase();
  if (cond === 'charmed') return 12;
  if (/1 minute/.test(d)) return 8;
  if (/until the end of .* next turn|1 round/.test(d)) return 4;
  return 6;
}

/* ---------- tier budgets: the game re-tiers monsters (guardian-naga is CR 4
   in-game) but statblock text keeps original SRD numbers — cap parsed dice
   damage and DCs so a T2 spawn can't hit with CR-10 numbers. ---------- */
const DMG_CAP = { 1:8, 2:14, 3:22, 4:34, 5:50 };
const DC_CAP  = { 1:12, 2:13, 3:15, 4:17, 5:19 };
function capDice(dice, tier) {
  const cap = DMG_CAP[tier] || 50;
  const per = (dice[1] + 1) / 2;
  const avg = dice[0] * per + (dice[2] || 0);
  if (avg <= cap) return dice;
  const n = Math.max(1, Math.floor((cap - (dice[2] || 0)) / per));
  return [n, dice[1], dice[2] || 0];
}
function capDC(dc, tier) { return Math.min(dc, DC_CAP[tier] || 19); }

const CYCLE_NAME = /breath|presence|glare|gaze|song|charm(?!ed)|scare|moan|visage|whirlwind|whelm|spray|spit|screech|storm|wall of ice|blinding spittle|trampling|^charge$|leap|engulf|crush|lightning/i;
const AURA_NAME  = /stench|fetid cloud|spores|gibbering|aberrant ground|consume life/i;
const DEATH_NAME = /death burst|death throes/i;

/* ---------- per-id overrides & extras (curation wins over parsing) ---------- */
/* marker: also keep what the generic parser finds (override entries win on key collision) */
const KEEP_PARSED = Symbol('keepParsed');
const SKIP_ABILITY = {
  ghost: ['Possession'],                     // possession is out of scope — visage is the hook
  'guardian-naga': ['Spit Poison'],          // bite rider is enough; naga is T2
  'bearded-devil': ['Glaive'],               // one rider (beard poison) is enough
};
const OVERRIDE = {
  /* rust monster: THE anti-AC-stack ability — corrode armor until rest */
  'rust-monster': [{
    key:'antennae', label:'Corroding Antennae', trigger:'onHit',
    save:{ ab:'dex', dc:11 }, effect:{ key:'corroded' },
    sprite:EFF_FX.corroded.sprite, color:EFF_FX.corroded.color,
  }],
  /* life drainers: necrotic rider + max-HP drain until rest */
  wight:   [ lifeDrain(13, [1,6,2]) ],
  wraith:  [ lifeDrain(14, [4,8,3]) ],
  specter: [ lifeDrain(10, [3,6,0]) ],
  'will-o-wisp': [ lifeDrain(10, [2,8,0]) ],
  /* swallowers: held + acid DoT */
  behir:    [ swallow(14, 4), KEEP_PARSED ],
  remorhaz: [ swallow(15, 5) ],
  /* mummy rot: the cursed fist eats vitality until a rest; glare parses on its own */
  mummy: [{
    key:'rotting-fist', label:'Rotting Fist', trigger:'onHit',
    save:{ ab:'con', dc:12 }, dice:[3,6,0], dmgType:'necrotic',
    effect:{ key:'drained', drainHp:5 },
    sprite:EFF_FX.drained.sprite, color:EFF_FX.drained.color,
  }, KEEP_PARSED ],
  /* the mouther's maddening babble — brief scrambled wits near it */
  'gibbering-mouther': [{
    key:'gibbering', label:'Gibbering', trigger:'aura',
    save:{ ab:'wis', dc:10 }, effect:{ key:'incapacitated', dur:3 },
    aoe:2.2, every:4,
    sprite:EFF_FX.incapacitated.sprite, color:EFF_FX.incapacitated.color,
  }, {
    key:'aberrant-ground', label:'Aberrant Ground', trigger:'aura',
    save:{ ab:'str', dc:10 }, effect:{ key:'slowed', dur:4 },
    aoe:1.8, every:4,
    sprite:'cloud_calc_dust_0', color:0x8a7a4a,
  }, {
    key:'knockdown', label:'Bites Knockdown', trigger:'onHit',
    save:{ ab:'str', dc:10 }, effect:{ key:'prone', dur:4 },
    sprite:EFF_FX.prone.sprite, color:EFF_FX.prone.color,
  }, KEEP_PARSED ],
  /* engulf/constrict-style grabs parsed poorly from text */
  'gelatinous-cube': [{
    key:'engulf', label:'Engulf', trigger:'cycle',
    save:{ ab:'dex', dc:12 }, dice:[3,6,0], dmgType:'acid',
    effect:{ key:'restrained', dur:8, repeatSave:true, dotDmg:3 },
    sprite:'cloud_acid_1', color:0x9fe07a,
  }],
  /* wolves: bite is an attack — prone rider on hit */
  wolf:      [ knockdown(11) ],
  'dire-wolf':[ knockdown(13) ],
  warg:      [ knockdown(13) ],
  /* gazer: 4 eye rays (daze, fear, frost, telekinetic) */
  gazer: [
    { key:'dazingRay', label:'Dazing Ray', trigger:'cycle', every:2, save:{ ab:'wis', dc:12 }, effect:{ key:'charmed', dur:6, repeatSave:true }, sprite:'quad_glow', color:15247615 },
    { key:'fearRay', label:'Fear Ray', trigger:'cycle', every:2, save:{ ab:'wis', dc:12 }, effect:{ key:'frightened', dur:6 }, sprite:'cloud_gloom_new', color:10180534 },
    { key:'frostRay', label:'Frost Ray', trigger:'cycle', every:2, save:{ ab:'dex', dc:12, half:true }, dice:[3,6,0], dmgType:'cold', sprite:'frost_0', color:8377599 },
    { key:'telekineticRay', label:'Telekinetic Ray', trigger:'cycle', every:2, save:{ ab:'str', dc:12 }, effect:{ key:'slowed', dur:4 }, sprite:'magic_bolt_1', color:11570431 }
  ],
};
function lifeDrain(dc, dice) {
  return { key:'lifeDrain', label:'Life Drain', trigger:'onHit',
    save:{ ab:'con', dc, half:true }, dice, dmgType:'necrotic',
    effect:{ key:'drained', drainHp:5 },
    sprite:EFF_FX.drained.sprite, color:EFF_FX.drained.color };
}
function swallow(dc, dot) {
  return { key:'swallow', label:'Swallow', trigger:'onHit', chance:0.35,
    save:{ ab:'dex', dc }, effect:{ key:'restrained', dur:8, repeatSave:true, dotDmg:dot },
    sprite:'net_trap', color:0xbfa060 };
}
function knockdown(dc) {
  return { key:'knockdown', label:'Takedown', trigger:'onHit',
    save:{ ab:'str', dc }, effect:{ key:'prone', dur:4 },
    sprite:EFF_FX.prone.sprite, color:EFF_FX.prone.color };
}
/* grapple-only actions (no saving-throw text — escape DC): constrictors & friends */
const GRAPPLERS = {
  'constrictor-snake':       { dc:14, dot:2 },
  'giant-constrictor-snake': { dc:16, dot:4 },
  anaconda:                  { dc:16, dot:4 },
  crocodile:                 { dc:12, dot:2 },
  alligator:                 { dc:13, dot:2 },
  'giant-frog':              { dc:11, dot:1 },
  'giant-toad':              { dc:13, dot:2 },
  darkmantle:                { dc:13, dot:2 },
  mimic:                     { dc:13, dot:2 },
  roper:                     { dc:15, dot:3 },
  chuul:                     { dc:14, dot:2 },
  otyugh:                    { dc:13, dot:2 },
};

/* ---------- passive trait flags ---------- */
function passiveFlags(m) {
  const out = {};
  const traits = m.statblock?.traits || [];
  for (const t of traits) {
    if (/^pack tactics/i.test(t.name)) out.packTactics = true;
    if (/^undead fortitude/i.test(t.name)) out.undeadFortitude = true;
    if (/^magic resistance/i.test(t.name)) out.magicResistance = true;
    const rg = /regains (\d+) hit points at the start of its turn/i.exec(t.desc || '');
    if (rg) out.regen = +rg[1];
  }
  return out;
}

/* ---------- main classification ---------- */
function buildAbilities(m) {
  if (m.tier === 'boss') return null;            // bosses keep BOSS_SPELLS
  const sb = m.statblock;
  if (!sb) return null;

  let out = [];
  const skip = SKIP_ABILITY[m.id] || [];
  const over = OVERRIDE[m.id];
  const keepParsed = over && over.includes(KEEP_PARSED);
  if (over && !keepParsed) return over.length ? over : null;
  if (over && keepParsed) {
    out.push(...over.filter(x => x !== KEEP_PARSED));
  }

  const all = [
    ...(sb.traits || []).map(t => ({ ...t, kind:'trait' })),
    ...(sb.actions || []).map(a => ({ ...a, kind:'action' })),
  ];

  for (const t of all) {
    if (skip.includes(t.name)) continue;
    let save = parseSave(t.desc || '');
    let saveDice = parseSaveDice(t.desc || '');
    let cond = parseCondition(t.desc || '');

    /* Fallback parsing for actions/traits that deal elemental/special damage or carry conditions without explicit "DC XX" wording */
    if (!save) {
      /* Extract elemental damage type and dice */
      const dmgMatch = /(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s*(fire|cold|acid|lightning|poison|necrotic|radiant|psychic|force)\s*damage/i.exec(t.desc || '');
      const hasDrain = /blood loss|life drain|drain|hp drain|maximum hit points|absorb/i.test(t.desc || '');
      const isRangedSpell = /ranged (?:spell|weapon) attack/i.test(t.desc || '') && t.name !== 'Shortbow' && t.name !== 'Longbow';
      
      if (dmgMatch || cond || hasDrain || isRangedSpell) {
        const defaultDC = DC_CAP[m.tier || 1] || 12;
        const abAttr = (cond === 'prone' || cond === 'restrained') ? 'str' :
                       (cond === 'frightened' || cond === 'charmed') ? 'wis' :
                       (dmgMatch && (dmgMatch[4].toLowerCase() === 'fire' || dmgMatch[4].toLowerCase() === 'lightning' || dmgMatch[4].toLowerCase() === 'acid')) ? 'dex' : 'con';
        save = { ab: abAttr, dc: defaultDC };
        if (dmgMatch) {
          saveDice = { dice: capDice([+dmgMatch[1], +dmgMatch[2], +dmgMatch[3] || 0], m.tier), dmgType: dmgMatch[4].toLowerCase(), half: true };
        }
        if (hasDrain && !cond) cond = 'drained';
      }
    }

    if (!saveDice && !cond) continue;            // save with no bite we can model
    if (!save) save = { ab: 'con', dc: DC_CAP[m.tier || 1] || 12 };

    const isAura = AURA_NAME.test(t.name);
    const isDeath = DEATH_NAME.test(t.name);
    const isCycle = !isAura && !isDeath && (CYCLE_NAME.test(t.name) || t.kind === 'trait' || /ranged (?:spell|weapon)/i.test(t.desc || ''));
    const trigger = isDeath ? 'onDeath' : isAura ? 'aura' : isCycle ? 'cycle' : 'onHit';

    const ab = {
      key: t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label: t.name.replace(/\s*\(.*\)$/, ''),
      trigger,
      save: { ...save, dc: capDC(save.dc, m.tier), ...(saveDice && saveDice.half ? { half:true } : {}) },
    };
    if (saveDice) { ab.dice = capDice(saveDice.dice, m.tier); ab.dmgType = saveDice.dmgType; }
    if (cond) {
      ab.effect = { key: cond, dur: parseDur(t.desc || '', cond) };
      if (['paralyzed','restrained','stunned','charmed','frightened'].includes(cond)) ab.effect.repeatSave = true;
    }
    /* AoE radii by shape keywords */
    if (trigger === 'cycle' && /cone|line|each creature|within \d+ f(ee|oo)t/i.test(t.desc || '')) {
      ab.aoe = /presence|moan|visage|gibbering/i.test(t.name) ? 3.2 : 2.8;
    }
    if (trigger === 'aura') { ab.aoe = 1.8; ab.every = 3; }
    if (trigger === 'onDeath') ab.aoe = 2.2;

    const fx = (ab.dmgType && DMG_FX[ab.dmgType]) || (cond && EFF_FX[cond]) || { sprite:'magic_bolt_1', color:0xb08cff };
    ab.sprite = fx.sprite; ab.color = fx.color;
    out.push(ab);
  }

  /* grapplers (escape-DC actions with no saving-throw wording) */
  if (GRAPPLERS[m.id]) {
    const g = GRAPPLERS[m.id];
    out.push({
      key:'constrict', label:'Constrict', trigger:'onHit', chance:0.5,
      save:{ ab:'str', dc:capDC(g.dc, m.tier) },
      effect:{ key:'restrained', dur:8, repeatSave:true, dotDmg:g.dot },
      sprite:'net_trap', color:0xbfa060,
    });
  }
  if (over && keepParsed) {
    const curated = over.filter(x => x !== KEEP_PARSED);
    const keys = new Set(curated.map(a => a.key));
    out = [...curated, ...out.filter(a => !keys.has(a.key))];
  }

  return out.length ? out : null;
}

/* ---------- run ---------- */
let nAbil = 0, nFlags = 0;
const report = [];
for (const m of monsters) {
  delete m.abilities;
  for (const k of ['packTactics','undeadFortitude','magicResistance','regen']) delete m[k];

  const flags = passiveFlags(m);
  Object.assign(m, flags);
  if (Object.keys(flags).length) nFlags++;

  const abs = buildAbilities(m);
  if (abs) {
    m.abilities = abs;
    nAbil++;
    report.push(`T${m.tier} ${m.id.padEnd(24)} ${abs.map(a =>
      `${a.trigger}:${a.label}${a.save ? ` DC${a.save.dc} ${a.save.ab.toUpperCase()}` : ''}` +
      `${a.dice ? ` ${a.dice[0]}d${a.dice[1]}${a.dice[2] ? '+' + a.dice[2] : ''} ${a.dmgType}${a.save?.half ? ' ½' : ''}` : ''}` +
      `${a.effect ? ` →${a.effect.key}${a.effect.dur != null ? ` ${a.effect.dur}s` : ' (rest)'}` : ''}`
    ).join('  |  ')}${Object.keys(flags).length ? '   [' + Object.keys(flags).join(',') + ']' : ''}`);
  } else if (Object.keys(flags).length) {
    report.push(`T${m.tier} ${m.id.padEnd(24)} [${Object.keys(flags).join(',')}]`);
  }
}

report.sort();
console.log(report.join('\n'));
const nonBoss = monsters.filter(x => x.tier !== 'boss').length;
console.log(`\n${nAbil} monsters with abilities (${(100 * nAbil / nonBoss).toFixed(0)}% of ${nonBoss} non-boss), ${nFlags} with passive flags.`);

if (WRITE) {
  fs.writeFileSync(GAME, JSON.stringify(monsters, null, 1) + '\n');
  console.log(`written → ${GAME}`);
} else {
  console.log('(dry-run — pass --write to apply)');
}
