/**
 * TRAILER GEAR LADDER — what the party is wearing at each stage of the tour.
 *
 * The point of the montage is that the world AND the party climb together, so
 * each tier is chosen to change the SILHOUETTE, not just the stats: robe to
 * plate, club to claymore, bare head to great helm. At the camera distance the
 * rig films from, silhouette is the only thing that reads.
 *
 * Items are the real `bases` entries from items.json, so what the trailer shows
 * is gear that actually exists in the game. Look-ups are by name and throw if a
 * name is gone — a silent miss would put a hero on screen in their underwear,
 * which is exactly the kind of thing nobody notices until the trailer is cut.
 */
import ITEMS from '../game/items.json' with { type: 'json' };

const bySlot = {};
for (const slot of Object.keys(ITEMS.bases || {})) {
  bySlot[slot] = new Map((ITEMS.bases[slot] || []).map(b => [b.name, b]));
}

/** One real item, tagged with a stable id so HeroSprite's texture cache keys it. */
function item(slot, name) {
  const base = bySlot[slot] && bySlot[slot].get(name);
  if (!base) {
    throw new Error(`[trailer/gear] no ${slot} base named "${name}" in items.json`);
  }
  return { ...base, id: `trailer-${slot}-${name.replace(/\s+/g, '_')}` };
}

const W = n => item('weapon', n);
const A = n => item('armor',  n);
const H = n => item('helm',   n);
const S = n => item('shield', n);

/**
 * Four rungs, matched to the level ramp in the biome tour. Keyed by classKey;
 * a class with no entry at a tier simply keeps what it had.
 */
export const GEAR_TIERS = [
  {
    label: 'scavenged',
    fighter: { weapon: W('Club'),          armor: A('Peasant Shirt') },
    rogue:   { weapon: W('Rusty Dagger'),  armor: A('Sleeveless Tunic') },
    cleric:  { weapon: W('Club'),          armor: A('Tabard') },
    wizard:  { weapon: W('Cracked Staff'), armor: A('Torn Robe') }
  },
  {
    label: 'outfitted',
    fighter: { weapon: W('Shortsword'),  armor: A('Leather Vest'),  helm: H('Cap') },
    rogue:   { weapon: W('Dagger'),      armor: A('Leather Armor'), helm: H('Cloth Hood') },
    cleric:  { weapon: W('Mace'),        armor: A('Padded Armor') },
    wizard:  { weapon: W('Wooden Wand'), armor: A('Robe'),          helm: H('Wizard Hat') }
  },
  {
    label: 'seasoned',
    fighter: { weapon: W('Arming Sword'), armor: A('Studded Leather'), helm: H('Kettle Helm'),
               offhand: S('Buckler') },
    rogue:   { weapon: W('Shortsword'),   armor: A('Studded Leather'), helm: H('Cloth Hood') },
    cleric:  { weapon: W('Warhammer'),    armor: A('Chain Shirt'),     helm: H('Mail Coif') },
    wizard:  { weapon: W('Staff'),        armor: A('Robe'),            helm: H('Wizard Hat') }
  },
  {
    label: 'ironclad',
    fighter: { weapon: W('Longsword'), armor: A('Chain Mail'),  helm: H('Bascinet'),
               offhand: S('Kite Shield') },
    rogue:   { weapon: W('Rapier'),    armor: A('Leather Armor'), helm: H('Feathered Hat') },
    cleric:  { weapon: W('Flail'),     armor: A('Scale Mail'),  helm: H('Nasal Helm'),
               offhand: S('Heater Shield') },
    wizard:  { weapon: W('Gnarled Staff'), armor: A('Robe'),    helm: H('Wizard Hat') }
  },
  {
    label: 'veteran',
    fighter: { weapon: W('Battleaxe'),  armor: A('Half Plate'),   helm: H('Close Helm'),
               offhand: S('Heater Shield') },
    rogue:   { weapon: W('Saber'),      armor: A('Studded Leather'), helm: H('Tricorne Hat') },
    cleric:  { weapon: W('Morningstar'), armor: A('Splint Armor'), helm: H('Spangenhelm'),
               offhand: S('Round Shield') },
    wizard:  { weapon: W('Loop Staff'), armor: A('Robe'),         helm: H('Circlet') }
  },
  {
    label: 'exalted',
    fighter: { weapon: W('Greatsword'), armor: A('Plate Armor'), helm: H('Great Helm') },
    rogue:   { weapon: W('Katana'),     armor: A('Studded Leather'), helm: H('Feathered Hat') },
    cleric:  { weapon: W('Maul'),       armor: A('Splint Armor'), helm: H('Legion Helm'),
               offhand: S('Round Shield') },
    wizard:  { weapon: W('Diamond Staff'), armor: A('Robe'),      helm: H('Circlet') }
  },
  {
    label: 'fabled',
    fighter: { weapon: W('Claymore'), armor: A('Dragonscale Mail'), helm: H('Great Helm') },
    rogue:   { weapon: W('Scythe'),   armor: A('Dragonscale Mail'), helm: H('Plumed Helm') },
    cleric:  { weapon: W('Maul'),     armor: A('Dragonscale Mail'), helm: H('Legion Helm'),
               offhand: S('Dwarven Buckler') },
    wizard:  { weapon: W('Diamond Staff'), armor: A('Robe'),        helm: H('Circlet') }
  }
];

/**
 * An equip function for Party.equip(), for a given rung.
 *
 * Returns `null` for a class the tier does not mention, which Party.equip
 * treats as "leave them as they are".
 */
export function gearAt(tier) {
  const rung = GEAR_TIERS[Math.max(0, Math.min(GEAR_TIERS.length - 1, tier | 0))];
  return member => rung[member.data.classKey] || null;
}

/**
 * One rung every `every` beats, so the party visibly re-equips twice as often
 * as a four-rung ladder managed. With 14 biomes and 7 rungs that is a change
 * every second biome, which is frequent enough to read as progression without
 * looking like a dressing-up game.
 */
export function tierForBeat(index, total, every = 2) {
  return Math.min(GEAR_TIERS.length - 1, Math.floor(index / every));
}
