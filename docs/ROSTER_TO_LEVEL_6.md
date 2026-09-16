# Roster to level 6 — twelve faction concepts

Generated overnight 2026-09-08. **Nothing here is wired into the game.** These are
concepts plus base sprites for review; the stat records, animations and encounter
wiring come after you have picked what survives.

Ancient is already complete to level 6. These twelve factions close every
remaining gap in the other four themes.

| theme | level | CR | faction | replaces boss |
|---|---|---|---|---|
| molten | 2 | ¼ | **Cinderkin** | `hell-hound` |
| molten | 3 | ½ | **Slagbound** | `bearded-devil` |
| molten | 4 | 1 | **Emberguard** | `salamander` |
| molten | 5 | 2 | **Brasscoat** | `fire-elemental` |
| molten | 6 | 3 | **Ironmaw** | `barbed-devil` |
| frost | 3 | ½ | **Hollowkin** | `polar-bear` |
| frost | 4 | 1 | **Rimewrights** | `giant-frog` |
| frost | 5 | 2 | **Huscarls** | `young-white-dragon` |
| frost | 6 | 3 | **Jarl's Court** | `frost-giant` |
| verdant | 5 | 2 | **Blackbog Coven** | `green-hag` |
| verdant | 6 | 3 | **Old Growth** | `young-green-dragon` |
| grim | 6 | 3 | **The Cerement** | `guardian-mummy` |

---

## Molten — the foundry and its legion

Molten was the emptiest biome in the game: one finished level and nothing
purpose-built above CR ⅛. So rather than five unrelated gap-fills, all five tiers
are **one culture seen at five ranks**. The molten dungeon is a volcanic foundry
held by an infernal legion, and you meet it from the bottom of the hierarchy up.

That gives molten the thing it has never had — an escalation with a *reason*. By
level 6 you are not fighting a bigger devil, you are fighting further up a chain
of command you have been climbing since level 2.

**L2 · Cinderkin** — knee-high scamps with cracked charcoal hide. Scamp, Flinger,
Witch, Lumper, Darter (winged), and a bloated Hearthmother they all came out of.
**Wear nothing at all.**

**L3 · Slagbound** — the thralls that feed the furnace. Chained, aproned, split
open with light showing through. Hauler, Ladle-Slinger, Stoker (a furnace burning
in its open chest), Anvilback, and a Crucible that has burst and kept walking.
**Scrap chain and slag only.**

**L4 · Emberguard** — the first real soldiers. Legionary, Javelin, Pyromancer,
Bulwark, Houndmaster, and a Centurion. **First real blackened iron.**

**L5 · Brasscoat** — veterans and officers. Praetor, Arbalest, Priest, Immolate
(a sealed brass furnace-suit), Flayer, and a Legate. **Brass added as rank.**

**L6 · Ironmaw** — the wardens the legion is frightened of. Iron riveted directly
through their own hides. Warden, Spitter, Voice, Bastion, a horse-sized muzzled
Houndbrand, and the Overlord. **Iron and brass with heat in every seam.**

### Palette decision worth arguing with

The obvious failure mode for a fire biome is that everything turns orange mush and
nothing reads on a lava floor. So **the bodies are dark** — charcoal, basalt,
blackened iron — and the heat is a **thin accent only**: glowing cracks, eye-light,
a hot blade edge. Never whole glowing limbs. It also leaves the blue/green axis
completely empty for the chroma key.

---

## Frost — the hold above the tribe

Levels 1–2 are done: crystalline vermin, then the Whitewake ice-hunters. The
conceit for the rest is that **the Whitewake are not the power here, they are
refugees in it.** Everything above them belongs to a frost giant's hold, and the
four tiers are its household.

This also uses the biome's own data: snowfield's family weighting is **Giantkind
9**, the highest single weight in the game and completely unused until now.

**L3 · Hollowkin** — squat ice-troll drudges in scavenged scrap. Drudge, Slinger,
Rimespeak, Doorstop (shields with a door it tore off something), a starved
Gnasher, and an Overseer with the keys.

**L4 · Rimewrights** — ice constructs the hold builds. Geometric, faceted,
iron-banded, no faces — just slits of cold light. Shard, Needler, Chorus (weather
turning inside its open ribs), Bulwark, Glassblade, and the Wintersmith that
builds the others.

**L5 · Huscarls** — proper giant-kin soldiers, half again a man's height. Axeman,
Harpoon (chained, so it can pull you), Stormspeak, Shieldwall, Berserker, Thegn.

**L6 · Jarl's Court** — frost giants proper, twice a man's height. Iceward,
Stonecaster, Wintersinger, Glacierback, an iron-armoured Wyrmhound, and the Jarl.

### The separation problem

Frost's danger is that the Whitewake and the hold blur into "cold people in
layers." So they are built to opposite palettes: the **Whitewake are dark brown
fur and bone-white plate**; the **hold is blue-grey skin, black iron, pale ice and
silver**, with no warm brown anywhere. If any tier here reads as more Whitewake,
that is the note to give me.

---

## Verdant — going big on purpose

Four verdant tiers exist and three of them are person-sized forest folk: ants,
spiders, myconids, spriggans. They had started to blur. Both new tiers
**deliberately break scale and silhouette.**

**L5 · Blackbog Coven** — green hags. Crone, Hexspitter, Greenmother, a hugely
bloated Swollen, a sewn-together Stitchling servant, and an ancient Grandmother
in a breastplate of stolen gold rings. They wear **no armour but carry wealth** —
hoarded human jewellery — which reads as older and worse than kit.

**L6 · Old Growth** — the trees. Sapling, Thornlobber, Heartwood, a stump-shaped
Bulwark, a spindly black-barked Stalker, and a colossal Elder three times a man's
height. **They wear nothing, ever.**

---

## Grim — an inversion of its own tier 5

Grim's tier 5, the Unrelieved, had one rule: **nothing matches.** A barrow filled
over centuries, so every wight is kitted in the fashion of a different era —
mismatched rust, verdigris, barrow gold.

**L6 · The Cerement** is the exact opposite. Uniform, ritual, matched — every one
of them wrapped and masked the same way, because these were prepared **by the same
hands on the same day.** Pale linen, black resin, gold leaf and lapis against tier
5's mismatched corrosion. Bearer, Archer, Lector, Shieldbearer, an Unwound one
whose rites were botched, and the Guardian the chamber was built to house.

---

## Conventions held throughout

- **Six per faction**: warrior, ranged, caster, tank, elite, boss — the shape every
  shipped faction uses, so the role filters in `spawnMonster` all have something
  to find.
- **Armour budget spent deliberately per theme**, never all at once. Molten's ladder
  is the clearest: nothing → chain → iron → brass → iron-and-brass-with-heat.
- **A non-humanoid in most tiers** for silhouette variety — the winged Darter, the
  Houndbrand, the Wyrmhound, the Stalker, the whole Old Growth and Rimewright
  tiers.
- **No slug contains the substring "ant"**, which the family classifier reads as
  Vermin (it is what mis-sorts "treant").
- **Every palette leaves one colour axis empty** for the chroma key — but the key
  is still measured per faction, never inherited. Verdant tiers 3 and 4 landed on
  *opposite* keys one rung apart.

## What is NOT done here

Stat records, CR calibration, animations, encounter wiring, tests. Deliberately —
you asked for concepts and base sprites to review first, and the expensive half of
the pipeline should only run on designs that survive that review.
