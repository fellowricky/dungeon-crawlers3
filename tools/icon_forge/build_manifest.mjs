/* Enumerate every UI icon the game needs, with the emoji it currently uses and
   a generated Krea2 prompt. Item bases are deliberately excluded -- the existing
   placeholder art for those is strong enough to keep.

   Prompts are templated, not authored: the label is doing the visual work and
   the palette comes from the damage type or category. That is good for maybe
   four in five; the picker's "regenerate" flag is how the rest get fixed. */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { SPELLS } from '../../src/game/spells.js';
import { EFFECTS } from '../../src/game/conditions.js';
import { DAMAGE_TYPE_ICONS } from '../../src/game/constants.js';
import { ABILITY_ICON } from '../../src/game/ui.js';
import { SLOT_LABEL } from '../../src/game/items.js';
import { FACILITY_DEFINITIONS, TECH_TREE, RUNE_RECIPES, SLAYING_ORDERS, INJURY_TYPES } from '../../src/game/guild.js';

const TAIL = 'crisp pixel-perfect lines, bold dark outline, clean readable ' +
  'silhouette at very small size, limited palette, flat cel shading, chunky ' +
  'pixel blocks, the object fills the frame edge to edge with only a thin ' +
  'margin, centered, isolated on a pure solid white background, no scene, ' +
  'no ground, no shadow, no text, no border, no frame.';

/* Damage type drives palette so a fire spell and a frost spell never collide. */
const PALETTE = {
  fire: 'hot orange and yellow with deep red shadow',
  cold: 'pale cyan and white with a deep blue core',
  lightning: 'bright yellow-white with violet edges',
  thunder: 'stormy grey-blue with white highlights',
  acid: 'acid green and yellow-green',
  poison: 'sickly green and dark violet',
  necrotic: 'bone white and dark purple-black',
  radiant: 'warm white and pale gold',
  force: 'magenta and pale blue',
  psychic: 'violet and pink',
  slashing: 'cold steel grey with a bright edge',
  piercing: 'cold steel grey with a bright point',
  bludgeoning: 'iron grey and dark brown',
};

const titleize = k => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
const icons = [];
let seed = 700000;

function add(category, id, label, current, hint, palette) {
  icons.push({
    id: `${category}__${id}`, category, key: id, label,
    current: current || '',
    seed: seed++,
    prompt: `16-bit pixel art game UI icon representing ${label}, a single ` +
      `centered symbolic object that reads instantly at 20 pixels. THE ICON: ` +
      `${hint}. Palette: ${palette || 'muted steel and stone with one accent colour'}. ` + TAIL,
  });
}

for (const [k, s] of Object.entries(SPELLS))
  add('spell', k, s.label, '', `a bold emblem for the spell "${s.label}" - one clear object or glyph, not a scene`, PALETTE[s.dmgType]);

/* The emoji a status currently shows are declared as local consts in three
   files, not exported, so they are scraped once into current_status_icons.json
   by sync_current_icons.py. Without them the picker has nothing to compare
   the generated art against, which is the whole point of the review. */
const CURRENT_STATUS = JSON.parse(readFileSync('tools/icon_forge/current_status_icons.json', 'utf8'));

for (const [k, e] of Object.entries(EFFECTS))
  add('status', k, e.label, CURRENT_STATUS[k] || '', `a bold symbol for the "${e.label}" condition - one clear object or glyph`,
      e.category === 'buff' ? 'warm white and pale gold' : 'sickly green and dark violet');

for (const [k, ico] of Object.entries(DAMAGE_TYPE_ICONS))
  add('damage', k, titleize(k), ico, `a bold ${k} damage symbol - one clear object`, PALETTE[k]);

/* 98 of the 142 ABILITY_ICON keys are the spell keys verbatim -- an ability
   row for Fireball is the same Fireball. Those alias onto the spell icon
   instead of generating a second, subtly different piece of art for the same
   thing. A handful of '...Class' duplicates and renamed spells alias too. */
const ALIASES = {
  actionSurgeClass: 'ability__actionSurge',
  cunningActionClass: 'ability__cunningAction',
  wildShapeClass: 'ability__wildShape',
  burningHands: 'spell__dragonBreathSpell',
  moveMoonbeam: 'spell__moonbeam',
};
const aliases = {};
for (const [k, ico] of Object.entries(ABILITY_ICON)) {
  if (SPELLS[k]) { aliases['ability__' + k] = 'spell__' + k; continue; }
  if (ALIASES[k]) { aliases['ability__' + k] = ALIASES[k]; continue; }
  addAbility(k, ico);
}
writeFileSync('tools/icon_forge/aliases.json', JSON.stringify(aliases, null, 1));

function addAbility(k, ico) {
  add('ability', k, titleize(k), ico, `a bold emblem for the "${titleize(k)}" ability - one clear object or glyph`);
}

for (const [k, lab] of Object.entries(SLOT_LABEL))
  add('slot', k, lab, '', `an empty ${lab} equipment slot silhouette - a simple dark outline of a ${lab}, flat and unlit`, 'dark slate grey only, nearly monochrome');

for (const [k, f] of Object.entries(FACILITY_DEFINITIONS))
  add('facility', k, f.label || titleize(k), '', `a small building emblem for the "${f.label || titleize(k)}" guild facility`);
for (const k of Object.keys(TECH_TREE)) add('tech', k, titleize(k), '', `an upgrade emblem for "${titleize(k)}"`);
for (const k of Object.keys(RUNE_RECIPES)) add('rune', k, titleize(k), '', `a carved rune stone glyph for "${titleize(k)}"`, 'grey stone with one glowing accent');
for (const k of Object.keys(SLAYING_ORDERS)) add('order', k, titleize(k), '', `a heraldic order badge for "${titleize(k)}"`);
for (const k of Object.keys(INJURY_TYPES)) add('injury', k, titleize(k), '', `a medical injury symbol for "${titleize(k)}"`, 'blood red and bandage white');

/* Hand-written visual hints beat the templated description by a wide margin,
   and they are also what a regeneration must start from -- without this merge
   regen.py would quietly fall back to the generic wording and produce a worse
   result than the run being retried. */
/* Four more emoji maps live as local consts in ui_save_slots.js, menus.js,
   skills.js and quest_events.js. They were missed in the first pass and are
   listed literally here rather than imported, because they are not exported. */
const CLASSES = ['fighter','rogue','cleric','wizard','barbarian','bard','druid',
                 'monk','paladin','ranger','sorcerer','warlock'];
const CREATURE_TYPES = ['beast','humanoid','undead','fiend','monstrosity','fey',
                        'elemental','giant','ooze','construct','dragon','aberration','celestial'];
const REWARDS = ['item','gold','potion','heal','shortRest','buff','secret','shortcut',
                 'reveal','info','tempHp','xp','cleanse','abilityCharge','summonAlly','buffEffect'];
const QUEST_KINDS = ['cleric','merc','scout'];
for (const k of CLASSES) add('class', k, titleize(k), '', `a class emblem for the ${k}`);
for (const k of CREATURE_TYPES) add('ctype', k, titleize(k), '', `a creature-type emblem for ${k}`);
for (const k of REWARDS) add('reward', k, titleize(k), '', `a reward emblem for ${titleize(k)}`);
for (const k of QUEST_KINDS) add('qkind', k, titleize(k), '', `a quest-giver emblem for a ${k}`);

/* World, resource, biome and gameplay-marker icons -- the emoji that had no
   equivalent in any earlier category. UI chrome (locks, checks, arrows, cogs)
   is deliberately NOT here: it is interface furniture, not fantasy objects,
   and wants a flatter treatment than this recipe gives. */
const WORLD = ['guildhall','archive','tavern','shop','monument','medal','forest','mushroom',
               'wood','iron','toolkit','oil','grain','stone',
               'volcano','desert','mountain','water','voidsky',
               'crit','dice','marker','footsteps','wilted','star','dialogue','palette',
               'torch','hint','luck','spend','finish','ambush','growth','cloak','anchor'];
for (const k of WORLD) add('world', k, titleize(k), '', `an emblem for ${titleize(k)}`);

let hints = {};
for (const hf of ['hints.json', 'hints_misc.json', 'hints_spells.json', 'hints_abilities.json', 'hints_extra.json', 'hints_world.json']) {
  try { Object.assign(hints, JSON.parse(readFileSync('tools/icon_forge/' + hf, 'utf8'))); } catch {}
}
for (const ic of icons) {
  const h = hints[ic.id];
  if (!h) continue;
  const [hint, palette] = h;
  ic.prompt = ic.prompt
    .replace(/THE ICON: .*?\. Palette: [^.]*\./s, `THE ICON: ${hint}. Palette: ${palette}.`);
  ic.hinted = true;
}

mkdirSync('tools/icon_forge', { recursive: true });
writeFileSync('tools/icon_forge/icons.json', JSON.stringify(icons, null, 1));
const by = {};
for (const i of icons) by[i.category] = (by[i.category] || 0) + 1;
console.log('total', icons.length, JSON.stringify(by));
