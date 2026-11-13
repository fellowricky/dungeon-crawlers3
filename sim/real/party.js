/**
 * Build a party at any level without playing up to it: level by level, with the
 * bot's picks at each level-up and a ration of loot rolled from the game's own
 * item tables at each level, handed out by the same rule the bot uses in play.
 */
import { makeHero, grantXp, XP_TABLE, MAX_LEVEL, CLASSES, RACES, recalc } from '../../src/game/srd.js';
import { rollItem } from '../../src/game/items.js';
import { getRaceDefaults } from '../../src/game/appearance.js';
import { resolveProgression, autoEquip, mulberry32 } from './bot.js';

export const PLAYABLE_CLASSES = Object.keys(CLASSES).filter(k => (CLASSES[k].skills || []).length > 0);
export const PLAYABLE_RACES = Object.keys(RACES).filter(k => k !== 'wolf' && k !== 'familiar');
const STAT_ARRAY = [15, 14, 13, 12, 10, 8];
const NAMES = ['Aldric', 'Bram', 'Kira', 'Garrick', 'Isolde', 'Lyra', 'Fenn', 'Magda', 'Vessa', 'Piotr', 'Elara', 'Torvi', 'Sariel', 'Wren', 'Toby', 'Nyx'];

/* How well-off a built party is. These are guesses until they are checked
   against real saves; every run records its party's gear so they can be. */
export const GEAR = {
  dropsPerHeroLevel: 3,     // loot rolls each hero "finds" per level gained past the first
  goldPerLevel: 60,
  potions: lvl => ({ heal: lvl < 2 ? 2 : lvl < 5 ? 3 : 2, greater: lvl >= 5 ? 1 + Math.floor((lvl - 5) / 4) : 0, superior: lvl >= 11 ? 1 : 0 }),
};

function visualFor(raceKey, gender) {
  const d = getRaceDefaults(raceKey) || {};
  return {
    gender, head: d.head || '', skinColor: d.skinColor || '#f0c896',
    hair: d.hair || (gender === 'female' ? 'long_tied/adult' : 'short/adult'), hairExtension: 'none',
    facialHair: d.facialHair || 'none', hairColor: d.hairColor || '#302018', hairExtColor: '',
    eyeColor: d.eyeColor || '#3a72a0', ears: d.ears || 'none', horns: d.horns || 'none',
    spriteScaleX: d.spriteScaleX || 1.0, spriteScaleY: d.spriteScaleY || 1.0,
  };
}

/**
 * @param spec.level    target level
 * @param spec.seed     party seed (same seed, same party)
 * @param spec.classes  optional fixed class list; otherwise different random classes
 * @param spec.size     party size (default 4)
 * @returns { heroes: heroData[], bag: item[], gold, potions, picks }
 */
export function buildParty(spec) {
  const rng = mulberry32(Math.imul(spec.seed | 0, 2654435761) + 97);
  const level = Math.max(1, Math.min(MAX_LEVEL, (spec.level | 0) || 1));
  const size = spec.size || 4;
  const classes = spec.classes ? spec.classes.slice(0, size) : [];
  const pool = PLAYABLE_CLASSES.filter(c => !classes.includes(c));
  while (classes.length < size && pool.length) classes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);

  /* The item tables and a few rules helpers roll on Math.random; pin it to the
     party seed for the build so the same seed always yields the same party. */
  const realRandom = Math.random;
  Math.random = rng;
  const picks = {};
  const bag = [];
  let heroes;
  try {
    const names = NAMES.slice();
    heroes = classes.map(classKey => {
      const raceKey = PLAYABLE_RACES[Math.floor(rng() * PLAYABLE_RACES.length)];
      const base = {};
      CLASSES[classKey].statPriority.forEach((ab, i) => { base[ab] = STAT_ARRAY[i] != null ? STAT_ARRAY[i] : 8; });
      const name = names.splice(Math.floor(rng() * names.length), 1)[0];
      const h = makeHero(name, raceKey, classKey, base, visualFor(raceKey, rng() < 0.5 ? 'male' : 'female'));
      picks[h.name] = [];
      return h;
    });
    const equip = (h, item) => {
      const slot = item.slot === 'shield' ? 'offhand' : item.slot;
      if (item.slot === 'weapon' && item.twoHanded && h.equipment.offhand) { bag.push(h.equipment.offhand); delete h.equipment.offhand; }
      const old = h.equipment[slot];
      h.equipment[slot] = item;
      const i = bag.indexOf(item); if (i >= 0) bag.splice(i, 1);
      if (old) bag.push(old);
      recalc(h); h.hp = h.maxHp;
      return true;
    };
    for (let lvl = 1; lvl <= level; lvl++) {
      for (const h of heroes) {
        if (h.level < lvl) grantXp(h, Math.max(1, XP_TABLE[lvl] - h.xp));
        picks[h.name].push(...resolveProgression(h, rng));
        /* A level 1 party is a brand-new one: starter kit only, as in the game. */
        for (let i = 0; lvl > 1 && i < GEAR.dropsPerHeroLevel; i++) {
          const it = rollItem(lvl, rng, null, { source: 'chest' });
          if (it) bag.push(it);
        }
      }
      autoEquip(heroes, () => bag, equip);
    }
    for (const h of heroes) { recalc(h); h.hp = h.maxHp; }
  } finally { Math.random = realRandom; }
  /* What nobody wore is what a player would have sold; keep a few consumables. */
  const keep = bag.filter(it => it && (it.slot === 'trinket' || it.slot === 'kit')).slice(0, 4);
  return { heroes, bag: keep, gold: GEAR.goldPerLevel * (level - 1), potions: GEAR.potions(level), picks };
}
