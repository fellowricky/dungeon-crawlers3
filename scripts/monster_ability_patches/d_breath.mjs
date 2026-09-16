/* Batch D — Breath weapons (cycle abilities). Each dragon/drake/mephit gets a
 * `cycle` breath matching its statblock DC + dice. Metallic dragons with two
 * breaths (fire+sleep, acid+slowing, cold+paralyzing, fire+weakening) get both
 * entries; `tryMonsterCycleAbility` picks one at random per cast.
 */
const breath = (key, label, dc, ab, dice, dmgType, sprite, color) => ({
  key, label, trigger: 'cycle',
  save: { ab, dc, half: true },
  dice, dmgType, aoe: 2.8, sprite, color,
});
const gas = (key, label, dc, ab, effect, sprite, color) => ({
  key, label, trigger: 'cycle',
  save: { ab, dc },
  effect: { key: effect, dur: 60, repeatSave: true },
  aoe: 2.8, sprite, color,
});

const FIRE = [16742960, 'cloud_fire_1'];
const COLD = [8377599, 'icicle_0'];
const POISON = [5025356, 'cloud_poison_0'];
const ACID = [5025356, 'acid_venom'];
const LIGHTNING = [7377151, 'cloud_storm_1'];
const SLEEP = [8947848, 'cloud_blue_smoke'];
const SLOW = [9421032, 'cloud_blue_smoke'];
const PARALYZE = [8425664, 'silenced'];
const WEAKEN = [13670528, 'cloud_neg_1'];

export default {
  /* ── Wyrmlings (CR 1–3) ── */
  'brass-dragon-wyrmling': { append: [
    breath('fire-breath', 'Fire Breath', 11, 'dex', [4, 6, 0], 'fire', FIRE[1], FIRE[0]),
    gas('sleep-breath', 'Sleep Breath', 11, 'con', 'unconscious', SLEEP[1], SLEEP[0]),
  ]},
  'bronze-dragon-wyrmling': { append: [
    breath('lightning-breath', 'Lightning Breath', 12, 'dex', [3, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'copper-dragon-wyrmling': { append: [
    breath('acid-breath', 'Acid Breath', 11, 'dex', [4, 8, 0], 'acid', ACID[1], ACID[0]),
    gas('slowing-breath', 'Slowing Breath', 11, 'con', 'slowed', SLOW[1], SLOW[0]),
  ]},
  'gold-dragon-wyrmling': { append: [
    breath('fire-breath', 'Fire Breath', 13, 'dex', [4, 10, 0], 'fire', FIRE[1], FIRE[0]),
    gas('weakening-breath', 'Weakening Breath', 13, 'str', 'weakenedDmg', WEAKEN[1], WEAKEN[0]),
  ]},
  'silver-dragon-wyrmling': { append: [
    breath('cold-breath', 'Cold Breath', 13, 'con', [4, 8, 0], 'cold', COLD[1], COLD[0]),
    gas('paralyzing-breath', 'Paralyzing Breath', 13, 'con', 'paralyzed', PARALYZE[1], PARALYZE[0]),
  ]},

  /* ── Young dragons (CR 6–10) ── */
  'young-brass-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 14, 'dex', [12, 6, 0], 'fire', FIRE[1], FIRE[0]),
    gas('sleep-breath', 'Sleep Breath', 14, 'con', 'unconscious', SLEEP[1], SLEEP[0]),
  ]},
  'young-bronze-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 15, 'dex', [10, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'young-copper-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 14, 'dex', [9, 8, 0], 'acid', ACID[1], ACID[0]),
    gas('slowing-breath', 'Slowing Breath', 14, 'con', 'slowed', SLOW[1], SLOW[0]),
  ]},
  'young-gold-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 17, 'dex', [10, 10, 0], 'fire', FIRE[1], FIRE[0]),
    gas('weakening-breath', 'Weakening Breath', 17, 'str', 'weakenedDmg', WEAKEN[1], WEAKEN[0]),
  ]},
  'young-silver-dragon': { append: [
    breath('cold-breath', 'Cold Breath', 17, 'con', [12, 8, 0], 'cold', COLD[1], COLD[0]),
    gas('paralyzing-breath', 'Paralyzing Breath', 17, 'con', 'paralyzed', PARALYZE[1], PARALYZE[0]),
  ]},

  /* ── Adult dragons (CR 13–17) ── */
  'adult-red-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 21, 'dex', [18, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'adult-black-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 18, 'dex', [12, 8, 0], 'acid', ACID[1], ACID[0]),
  ]},
  'adult-blue-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 19, 'dex', [12, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'adult-green-dragon': { append: [
    breath('poison-breath', 'Poison Breath', 18, 'con', [16, 6, 0], 'poison', POISON[1], POISON[0]),
  ]},
  'adult-brass-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 18, 'dex', [13, 6, 0], 'fire', FIRE[1], FIRE[0]),
    gas('sleep-breath', 'Sleep Breath', 18, 'con', 'unconscious', SLEEP[1], SLEEP[0]),
  ]},
  'adult-bronze-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 19, 'dex', [12, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'adult-copper-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 18, 'dex', [12, 8, 0], 'acid', ACID[1], ACID[0]),
    gas('slowing-breath', 'Slowing Breath', 18, 'con', 'slowed', SLOW[1], SLOW[0]),
  ]},
  'adult-silver-dragon': { append: [
    breath('cold-breath', 'Cold Breath', 20, 'con', [13, 8, 0], 'cold', COLD[1], COLD[0]),
    gas('paralyzing-breath', 'Paralyzing Breath', 20, 'con', 'paralyzed', PARALYZE[1], PARALYZE[0]),
  ]},
  'adult-gold-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 22, 'dex', [16, 10, 0], 'fire', FIRE[1], FIRE[0]),
  ]},

  /* ── Ancient dragons (CR 20+) ── */
  'ancient-red-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 24, 'dex', [26, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'ancient-black-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 22, 'dex', [22, 8, 0], 'acid', ACID[1], ACID[0]),
  ]},
  'ancient-blue-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 23, 'dex', [22, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'ancient-green-dragon': { append: [
    breath('poison-breath', 'Poison Breath', 22, 'con', [22, 6, 0], 'poison', POISON[1], POISON[0]),
  ]},
  'ancient-white-dragon': { append: [
    breath('cold-breath', 'Cold Breath', 22, 'con', [18, 8, 0], 'cold', COLD[1], COLD[0]),
  ]},
  'ancient-brass-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 22, 'dex', [16, 6, 0], 'fire', FIRE[1], FIRE[0]),
    gas('sleep-breath', 'Sleep Breath', 22, 'con', 'unconscious', SLEEP[1], SLEEP[0]),
  ]},
  'ancient-bronze-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 23, 'dex', [16, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'ancient-copper-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 22, 'dex', [16, 8, 0], 'acid', ACID[1], ACID[0]),
    gas('slowing-breath', 'Slowing Breath', 22, 'con', 'slowed', SLOW[1], SLOW[0]),
  ]},
  'ancient-silver-dragon': { append: [
    breath('cold-breath', 'Cold Breath', 24, 'con', [16, 8, 0], 'cold', COLD[1], COLD[0]),
    gas('paralyzing-breath', 'Paralyzing Breath', 24, 'con', 'paralyzed', PARALYZE[1], PARALYZE[0]),
  ]},

  /* ── Special dragons ── */
  'young-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 17, 'dex', [16, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'iron-dragon': { append: [
    breath('acid-breath', 'Acid Breath', 14, 'dex', [11, 8, 0], 'acid', ACID[1], ACID[0]),
  ]},
  'iron-dragon-ancient': { append: [
    breath('acid-breath', 'Acid Breath', 18, 'dex', [12, 8, 0], 'acid', ACID[1], ACID[0]),
  ]},
  'mottled-dragon': { append: [
    breath('poison-breath', 'Poison Breath', 14, 'con', [12, 6, 0], 'poison', POISON[1], POISON[0]),
  ]},
  'quicksilver-dragon': { append: [
    breath('lightning-breath', 'Lightning Breath', 16, 'dex', [10, 10, 0], 'lightning', LIGHTNING[1], LIGHTNING[0]),
  ]},
  'steam-dragon': { append: [
    breath('fire-breath', 'Steam Breath', 17, 'dex', [16, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'golden-dragon': { append: [
    breath('fire-breath', 'Fire Breath', 21, 'dex', [12, 10, 0], 'fire', FIRE[1], FIRE[0]),
    gas('weakening-breath', 'Weakening Breath', 21, 'str', 'weakenedDmg', WEAKEN[1], WEAKEN[0]),
  ]},
  'golden-dragon-ancient': { append: [
    breath('fire-breath', 'Fire Breath', 24, 'dex', [13, 10, 0], 'fire', FIRE[1], FIRE[0]),
    gas('weakening-breath', 'Weakening Breath', 24, 'str', 'weakenedDmg', WEAKEN[1], WEAKEN[0]),
  ]},
  'dragon-turtle': { append: [
    breath('steam-breath', 'Steam Breath', 18, 'con', [15, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},

  /* ── Drakes ── */
  'swamp-drake': { append: [
    breath('poison-breath', 'Poison Breath', 11, 'con', [6, 6, 0], 'poison', POISON[1], POISON[0]),
  ]},
  'forest-drake': { append: [
    breath('poison-breath', 'Poison Breath', 11, 'con', [6, 6, 0], 'poison', POISON[1], POISON[0]),
  ]},
  'death-drake': { append: [
    breath('acid-breath', 'Acid Breath', 11, 'dex', [5, 8, 0], 'acid', ACID[1], ACID[0]),
  ]},
  'fire-drake': { append: [
    breath('fire-breath', 'Fire Breath', 13, 'dex', [7, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},

  /* ── Winter wolf ── */
  'winter-wolf': { append: [
    breath('cold-breath', 'Cold Breath', 12, 'dex', [4, 8, 0], 'cold', COLD[1], COLD[0]),
  ]},

  /* ── Mephits (breaths; death bursts live in batch H) ── */
  'steam-mephit': { append: [
    breath('steam-breath', 'Steam Breath', 10, 'dex', [1, 8, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'magma-mephit': { append: [
    breath('fire-breath', 'Fire Breath', 11, 'dex', [2, 6, 0], 'fire', FIRE[1], FIRE[0]),
  ]},
  'ice-mephit': { append: [
    breath('frost-breath', 'Frost Breath', 10, 'dex', [2, 4, 0], 'cold', COLD[1], COLD[0]),
  ]},
  'dust-mephit': { append: [
    gas('blinding-breath', 'Blinding Breath', 10, 'dex', 'blinded', 'cloud_yellow_smoke', 8947848),
  ]},
};
