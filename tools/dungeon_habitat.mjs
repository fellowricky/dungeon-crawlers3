/* Per-monster dungeon habitat scorer.
   Assigns each monster a score for each of the 5 dungeon types from its OWN
   data (statblock immunities, breath/attack damage types, traits, creature
   type, size, name/id keywords) — NOT from its creature-type family. This is
   the granular layer the family groups (DUNGEON_MONSTER_MAP) can't express:
   a red dragon (fire-immune) belongs in Molten while a green dragon
   (poison-immune, Amphibious) belongs in the Verdant forest.

   Rules are data-driven below. Each match adds `score` to a dungeon and records
   a `reason`. The top-scoring dungeons are the monster's proposed habitat.

   Exports:
     scoreMonster(m)      -> { scores:{ancient,molten,frost,grim,verdant}, reasons:[...] }
     proposeDungeons(m)   -> ['ancient', ...] sorted by score desc, top N
     PROPOSE_TOP          -> how many dungeons a proposal includes
*/
export const DUNGEONS = ['ancient', 'molten', 'frost', 'grim', 'verdant'];
export const DUNGEON_LABEL = {
  ancient: 'Ancient Ruins', molten: 'Molten Depths', frost: 'Frostfell',
  grim: 'Grim Crypts', verdant: 'Verdant Wilds',
};
export const PROPOSE_TOP = 3;

/* ---------- rule table: { test(m), score, dungeon, reason } ---------- */
const R = [];
const rule = (test, score, dungeon, reason) => R.push({ test, score, dungeon, reason });

const hasImm = (m, dmg) => ((m.statblock || {}).immune || []).some(
  x => x.toLowerCase().split(',').map(s => s.trim()).includes(dmg.toLowerCase()));
const hasRes = (m, dmg) => ((m.statblock || {}).resist || []).some(
  x => x.toLowerCase().split(',').map(s => s.trim()).includes(dmg.toLowerCase()));
const hasTrait = (m, re) => ((m.statblock || {}).traits || [])
  .some(t => re.test(t.name) || re.test(t.desc || ''));
const hasAction = (m, re) => ((m.statblock || {}).actions || [])
  .some(a => re.test(a.name));
const hasAbility = (m, re) => (m.abilities || [])
  .some(a => re.test(a.key || '') || re.test(a.label || ''));
const hay = m => `${m.id} ${m.name} ${m.type} ${(m.tags || []).join(' ')}`.toLowerCase();

/* ---------- elemental climate: immunities + breath damage ----------
   Immunity is only a climate identity for creatures whose body IS that element
   (dragon/giant/elemental/construct). Undead, oozes, beasts and fiends often
   carry fire/cold/poison immunity as flavour (a ghost is cold-immune because it
   is dead, not because it lives in an ice cave), so their immunity is not a
   habitat signal — their breath attacks and keywords still are. */
const BODY_TYPES = new Set(['dragon', 'giant', 'elemental', 'construct']);
const bodyImm = (m, dmg) => BODY_TYPES.has(TYPE_WORD(m)) && hasImm(m, dmg);

rule(m => bodyImm(m, 'fire'), 40, 'molten', 'immune to fire');
rule(m => bodyImm(m, 'cold'), 40, 'frost', 'immune to cold');
rule(m => bodyImm(m, 'poison'), 12, 'verdant', 'immune to poison');
rule(m => bodyImm(m, 'acid'), 14, 'verdant', 'immune to acid');
rule(m => bodyImm(m, 'acid'), 10, 'mire', 'immune to acid (swamp)');
rule(m => bodyImm(m, 'lightning'), 10, 'molten', 'immune to lightning (forged heat)');
rule(m => bodyImm(m, 'necrotic'), 10, 'grim', 'immune to necrotic');
rule(m => bodyImm(m, 'radiant'), 8, 'ancient', 'immune to radiant (holy ruin)');

rule(m => /fire|heat|flame|scorch|ember|magma|lava/i.test(
  [m.statblock.actions.map(a => a.name).join(' '),
   (m.abilities || []).map(a => (a.key || a.label || '')).join(' ')].join(' ')), 20, 'molten', 'fire attacks');
rule(m => /cold|frost|ice|freez|snow/i.test(
  [m.statblock.actions.map(a => a.name).join(' '),
   (m.abilities || []).map(a => (a.key || a.label || '')).join(' ')].join(' ')), 20, 'frost', 'cold attacks');
rule(m => /poison|venom|toxic/i.test(
  [m.statblock.actions.map(a => a.name).join(' '),
   (m.abilities || []).map(a => (a.key || a.label || '')).join(' ')].join(' ')), 12, 'verdant', 'poison attacks');
rule(m => /acid/i.test(
  [m.statblock.actions.map(a => a.name).join(' '),
   (m.abilities || []).map(a => (a.key || a.label || '')).join(' ')].join(' ')), 12, 'verdant', 'acid attacks');

/* ---------- traits ---------- */
rule(m => TYPE_WORD(m) !== 'giant' && hasTrait(m, /amphib/i), 16, 'verdant', 'Amphibious');
rule(m => TYPE_WORD(m) !== 'giant' && hasTrait(m, /water breathing/i), 14, 'verdant', 'Water Breathing');
rule(m => TYPE_WORD(m) !== 'giant' && hasTrait(m, /ice walk/i), 22, 'frost', 'Ice Walk');
rule(m => hasTrait(m, /spider climb/i), 10, 'ancient', 'Spider Climb (ruins)');
rule(m => hasTrait(m, /spider climb/i), 8, 'verdant', 'Spider Climb (canopy)');
rule(m => hasTrait(m, /incorporeal|ethereal|intangible/i), 14, 'grim', 'Incorporeal');
rule(m => hasTrait(m, /water form/i), 14, 'verdant', 'Water Form');
rule(m => hasTrait(m, /heated body/i), 20, 'molten', 'Heated Body');
rule(m => hasTrait(m, /regen/i), 5, 'grim', 'Regeneration (darkness)');
rule(m => hasTrait(m, /plant|camouflage|false appearance/i), 12, 'verdant', 'vegetation traits');
rule(m => hasTrait(m, /sunlight sensitivity/i), 12, 'grim', 'Sunlight Sensitivity (underground)');
rule(m => hasTrait(m, /sunlight sensitivity/i), 8, 'ancient', 'Sunlight Sensitivity (deep ruins)');

/* ---------- creature types & keywords ---------- */
const TYPE_WORD = m => (m.type || '').toLowerCase();
const has = (m, re) => re.test(hay(m));

rule(m => has(m, /\b(undead|skeleton|zombie|ghost|wraith|wight|specter|mummy|vampire|lich|shadow|bone)\b/), 32, 'grim', 'undead');
rule(m => has(m, /\b(undead|skeleton|zombie|ghost|wraith|wight|specter|mummy|vampire|lich|shadow|bone)\b/), 12, 'ancient', 'undead (catacombs)');
rule(m => has(m, /\b(plant|treant|shambler|shrieker|fungus|mushroom|vine|spore)\b/), 32, 'verdant', 'plant life');
rule(m => has(m, /\b(fey|sprite|pixie|satyr|faun|dryad|nymph|unicorn|pegasus|spriggan|centaur)\b/), 26, 'verdant', 'fey/nature');
rule(m => has(m, /\b(fey|elf)\b/), 12, 'ancient', 'fey (elven ruins)');
rule(m => has(m, /\b(ooze|jelly|pudding|cube|blob|slime)\b/), 20, 'ancient', 'ooze (dungeon slimes)');
rule(m => has(m, /\b(ooze|jelly|pudding|cube|blob|slime)\b/), 10, 'grim', 'ooze (seepage)');
rule(m => has(m, /\b(construct|golem|armor|sword|shield)\b/), 22, 'ancient', 'construct (forgotten keep)');
rule(m => has(m, /\b(golem)\b/), 12, 'molten', 'golem (forged)');
rule(m => has(m, /\b(elemental)\b/) && has(m, /(fire|magma|lava|steam|ember|heat)/), 34, 'molten', 'fire elemental');
rule(m => has(m, /\b(elemental)\b/) && has(m, /(ice|cold|frost|snow)/), 34, 'frost', 'ice elemental');
rule(m => has(m, /\b(elemental)\b/) && has(m, /(water|aqua|tidal)/), 20, 'verdant', 'water elemental');
rule(m => has(m, /\b(elemental)\b/) && has(m, /(earth|stone|clay|rock)/), 16, 'ancient', 'earth elemental (ruins)');
rule(m => has(m, /\b(devil|demon|fiend|imp|balor|pit fiend|abyss)\b/) && has(m, /(fire|balor|hell|magma|brimstone)/), 22, 'molten', 'hellfire fiend');
rule(m => has(m, /\b(devil|demon|fiend|imp|balor|pit fiend|abyss)\b/), 18, 'grim', 'fiend (crypt corruption)');

/* dragons / drakes keyed by colour -> element */
rule(m => has(m, /\b(red|brass|gold|golden)\s?(dragon|drake|wyrmling)\b/) && TYPE_WORD(m) === 'dragon' || has(m, /(red dragon|brass dragon|golden? dragon|fire drake)/), 40, 'molten', 'fire dragon');
rule(m => has(m, /(white|silver)\s?(dragon|drake|wyrmling)\b/), 40, 'frost', 'cold dragon');
rule(m => has(m, /\b(green)\s?(dragon|drake|wyrmling)\b/), 34, 'verdant', 'green/forest dragon');
rule(m => has(m, /\b(black|copper)\s?(dragon|drake|wyrmling)\b/), 24, 'verdant', 'acid dragon (swamp)');
rule(m => has(m, /\b(blue|bronze)\s?(dragon|drake|wyrmling)\b/), 16, 'ancient', 'storm dragon (high ruins)');
rule(m => has(m, /\b(blue|bronze)\s?(dragon|drake|wyrmling)\b/), 12, 'molten', 'storm dragon (static heat)');
rule(m => has(m, /\b(swamp|forest|death|mottled)\s?(dragon|drake|wyrmling)\b/), 20, 'verdant', 'terrain drake');
rule(m => has(m, /\b(steam|iron|quicksilver)\s?(dragon|drake|wyrmling)\b/), 14, 'molten', 'metallic/steam dragon');
rule(m => has(m, /\b(shadow)\s?(dragon|drake|wyrmling)\b/), 16, 'grim', 'shadow dragon');
rule(m => has(m, /\b(wyvern|lindwurm)\b/), 14, 'ancient', 'wyvern (mountain ruins)');
rule(m => has(m, /\b(wyvern|lindwurm)\b/), 10, 'verdant', 'wyvern (highland)');

/* giants by kind */
rule(m => has(m, /fire giant/), 34, 'molten', 'fire giant');
rule(m => has(m, /frost giant/), 34, 'frost', 'frost giant');
rule(m => has(m, /(stone|hill|earth|clay) giant/), 18, 'ancient', 'earth giant (ruins)');
rule(m => has(m, /(storm|cloud) giant/), 18, 'molten', 'storm giant (crag)');
rule(m => has(m, /(storm|cloud) giant/), 16, 'ancient', 'storm giant (high ruin)');
rule(m => has(m, /\b(remorhaz)\b/), 26, 'frost', 'remorhaz (arctic predator)');
rule(m => has(m, /\b(troll|ogre|ettin|cyclops)\b/), 12, 'molten', 'trollkin (crags)');
rule(m => has(m, /\b(troll)\b/) && /ice|frost|polar|freezing/.test(hay(m)), 26, 'frost', 'ice troll');

/* humanoids & vermin by habitat */
rule(m => has(m, /\b(goblin|kobold|bugbear|hobgoblin|goblinoid)\b/), 20, 'ancient', 'goblinoid (crawl ruins)');
rule(m => has(m, /\b(goblin|kobold)\b/), 10, 'verdant', 'goblinoid (wild edge)');
rule(m => has(m, /\b(orc|gnoll)\b/), 20, 'verdant', 'orc/gnoll (wild horde)');
rule(m => has(m, /\b(orc|gnoll)\b/), 8, 'ancient', 'orc/gnoll (looted ruins)');
rule(m => has(m, /\b(dwarf|deep dwarf|duergar|drow|elf|dark elf)\b/) && /deep|drow|underdark/.test(hay(m)), 16, 'grim', 'underdark humanoid');
rule(m => has(m, /\b(dwarf|elf|halfling)\b/) && /deep|drow|underdark/.test(hay(m)), 8, 'ancient', 'underdark humanoid (deep ruins)');
rule(m => has(m, /\b(merfolk|merrow|sahuagin|sea|naga|fish|shark|octopus|kraken|aquatic|swim)\b/), 18, 'verdant', 'aquatic (rivers/coast)');

/* beasts & vermin */
rule(m => has(m, /\b(spider|scorpion|centipede|drider|web)\b/), 14, 'verdant', 'crawling wilds');
rule(m => has(m, /\b(spider|scorpion|centipede|drider|web)\b/), 12, 'ancient', 'crawling ruins');
rule(m => has(m, /\b(rat|bat|beetle|cockroach|vermin|mite|slug|snail)\b/), 14, 'ancient', 'vermin (ruins)');
rule(m => has(m, /\b(polar bear|winter wolf|mammoth|walrus|arctic|tundra|snow lion)\b/) && /beast|monstrosity|humanoid/.test(TYPE_WORD(m)), 22, 'frost', 'arctic beast');
rule(m => has(m, /\b(wolf|bear|boar|deer|elk|bison|boar)\b/) && /beast|monstrosity|humanoid/.test(TYPE_WORD(m)), 12, 'verdant', 'forest beast');
rule(m => has(m, /\b(snake|viper|adder|constrictor|python|serpent)\b/), 14, 'verdant', 'serpent (wild)');
rule(m => has(m, /\b(lion|tiger|panther|cheetah|rhino|elephant|dino|saur|triceratops|t-rex|trex)\b/), 16, 'verdant', 'savanna/primeval beast');
rule(m => has(m, /\b(crocodile|frog|toad|lizard|gecko|newt|turtle|amphib)\b/), 14, 'verdant', 'wetland amphibian');

/* religious/planar flavor */
rule(m => has(m, /\b(angel|solar|planetar|deva|couatl)\b/), 12, 'ancient', 'celestial (guardian ruin)');
rule(m => has(m, /\b(sphinx|guardian|gargoyle|manticore|chimera|gorgon|hydra)\b/), 14, 'ancient', 'guardian beast (ruins)');
rule(m => has(m, /\b(naga|guardian naga|sphinx)\b/), 10, 'ancient', 'wise guardian');

/* default pushes so nothing is stranded */
rule(m => TYPE_WORD(m) === 'beast' || TYPE_WORD(m) === 'monstrosity', 6, 'verdant', 'beast (default wild)');
rule(m => TYPE_WORD(m) === 'humanoid', 6, 'ancient', 'humanoid (default settled ruins)');
rule(m => TYPE_WORD(m) === 'aberration', 12, 'grim', 'aberration (deep dark)');
rule(m => TYPE_WORD(m) === 'construct', 8, 'ancient', 'construct (default keep)');

function scoreMonster(m) {
  const scores = { ancient: 0, molten: 0, frost: 0, grim: 0, verdant: 0 };
  const reasons = [];
  for (const r of R) {
    try {
      if (r.test(m)) {
        scores[r.dungeon] = (scores[r.dungeon] || 0) + r.score;
        reasons.push({ dungeon: r.dungeon, score: r.score, reason: r.reason });
      }
    } catch { /* malformed monster data: skip rule */ }
  }
  return { scores, reasons };
}

function proposeDungeons(m, top = PROPOSE_TOP) {
  const { scores, reasons } = scoreMonster(m);
  const order = DUNGEONS.slice().sort((a, b) => scores[b] - scores[a]);
  /* only count dungeons the monster actually scores in — a creature with no
     signal for a dungeon should never be "proposed" for it, and ties of zero
     must not collapse into the first dungeon in the list */
  const positive = order.filter(k => scores[k] > 0);
  return {
    top: positive.slice(0, top),
    scores,
    reasons,
  };
}

export { scoreMonster, proposeDungeons, DUNGEON_LABEL as LABEL };
