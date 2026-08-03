# Dungeon Monster Coverage & CR Balance Report

Generated from the live roster (**410 monsters**) in `src/game/monsters.json`. This is an analysis report only — it does not modify any game data.

**Thematic fit is judged per monster**, not per creature-type family. `tools/dungeon_habitat.mjs` scores each creature against all 5 dungeon types from its own data — elemental immunities, breath/attack damage types, traits (Amphibious, Ice Walk, Spider Climb…), creature type, and name keywords. The top **3** scoring dungeons are its proposed habitat. This is why a red dragon → **Molten** (fire-immune) but a green dragon → **Verdant** (poison-immune, Amphibious) and a white dragon → **Frostfell** (cold-immune, Ice Walk).

**Balance target:** each of the 5 dungeon types should host a similar number of monsters (~**82** each), with an even mix across the 5 CR bands (~**16.4** per band).

## Summary: current vs proposed

| Dungeon | Assigned now | Proposed habitat pool | Strong (top-3) | Target | Misplaced (assigned but no habitat score) |
| --- | --- | --- | --- | --- | --- |
| Ancient Ruins | 104 | 224 | 224 | 82 | 35 |
| Molten Depths | 44 | 62 | 62 | 82 | 29 |
| Frostfell | 61 | 16 | 16 | 82 | 60 |
| Grim Crypts | 46 | 121 | 121 | 82 | 19 |
| Verdant Wilds | 103 | 228 | 228 | 82 | 34 |

## CR band distribution — currently assigned vs proposed habitat

| CR band spread (count per band) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dungeon | CR 0 – ½ | CR ½ – 2 | CR 2 – 4½ | CR 4½ – 8 | CR 8+ | Total | Even target |
| Ancient Ruins (assigned) | 28 | 26 | 18 | 17 | 15 | 104 | 82 |
| Molten Depths (assigned) | 10 | 5 | 7 | 7 | 15 | 44 | 82 |
| Frostfell (assigned) | 12 | 18 | 13 | 12 | 6 | 61 | 82 |
| Grim Crypts (assigned) | 12 | 8 | 7 | 8 | 11 | 46 | 82 |
| Verdant Wilds (assigned) | 31 | 29 | 17 | 16 | 10 | 103 | 82 |
| Ancient Ruins (proposed pool) | 68 | 53 | 34 | 33 | 36 | 224 | 82 |
| Molten Depths (proposed pool) | 5 | 5 | 8 | 15 | 29 | 62 | 82 |
| Frostfell (proposed pool) | 1 | 3 | 1 | 3 | 8 | 16 | 82 |
| Grim Crypts (proposed pool) | 14 | 23 | 20 | 29 | 35 | 121 | 82 |
| Verdant Wilds (proposed pool) | 72 | 56 | 29 | 36 | 35 | 228 | 82 |

## Per-dungeon analysis

### Ancient Ruins (`ancient`)
- Assigned now: **104** · proposed habitat pool: **224** · strong homes (top-3): **224** · target: **82**
- Assigned CR mix: **28 / 26 / 18 / 17 / 15**
- Proposed-pool CR mix: **68 / 53 / 34 / 33 / 36**

### Ancient Ruins — CR band gaps (proposed pool vs target)

| ancient band comparison |
| --- | --- | --- | --- | --- | --- |
| Band | Assigned | Proposed pool | Target | Δ (proposed−target) | Unassigned thematic fills |
| CR 0 – ½ | 28 | 68 | 16.4 | 51.6 | +40 |
| CR ½ – 2 | 26 | 53 | 16.4 | 36.6 | +27 |
| CR 2 – 4½ | 18 | 34 | 16.4 | 17.6 | +16 |
| CR 4½ – 8 | 17 | 33 | 16.4 | 16.6 | +16 |
| CR 8+ | 15 | 36 | 16.4 | 19.6 | +21 |

### Ancient Ruins — thematically misplaced (assigned here, habitat says no)
These are whitelisted for `ancient` even though the habitat scorer gives `ancient` **zero** points from their data — e.g. a fire creature in a frost cave. Review whether they should be removed (the scorer's reasons below show what they actually fit).

| Monster | CR | Type | Habitat score for Ancient Ruins | Best-fit dungeon (score) |
| --- | --- | --- | --- | --- |
| Giant Owl | 1/4 | beast | 0 | Verdant Wilds (6) |
| Giant Lizard | 1/4 | beast | 0 | Verdant Wilds (20) |
| Crocodile | 1/2 | beast | 0 | Verdant Wilds (20) |
| Cockatrice | 1/2 | monstrosity | 0 | Verdant Wilds (6) |
| Darkmantle | 1/2 | monstrosity | 0 | Verdant Wilds (18) |
| Brain Worm | 1/2 | aberration | 0 | Grim Crypts (12) |
| Hippogriff | 1 | monstrosity | 0 | Verdant Wilds (6) |
| Giant Octopus | 1 | beast | 0 | Verdant Wilds (50) |
| Centaur | 2 | monstrosity | 0 | Verdant Wilds (32) |
| Griffon | 2 | monstrosity | 0 | Verdant Wilds (6) |
| Gazer | 2 | aberration | 0 | Grim Crypts (12) |
| Azer | 2 | elemental | 0 | Molten Depths (60) |
| Deep Troll | 3 | giant | 0 | Molten Depths (12) |
| Bearded Devil | 3 | fiend | 0 | Grim Crypts (18) |
| Doppelganger | 3 | monstrosity | 0 | Verdant Wilds (6) |
| Basilisk | 3 | monstrosity | 0 | Verdant Wilds (6) |
| Cyclops | 3 | giant | 0 | Molten Depths (12) |
| Giant Orange Brain | 3 | aberration | 0 | Grim Crypts (12) |
| Chuul | 4 | aberration | 0 | Verdant Wilds (16) |
| Bulette | 5 | monstrosity | 0 | Verdant Wilds (6) |
| Barbed Devil | 5 | fiend | 0 | Molten Depths (20) |
| Deep Troll Berserker | 5 | giant | 0 | Molten Depths (12) |
| Deep Troll Shaman | 5 | giant | 0 | Molten Depths (12) |
| Daeva | 5 | celestial | 0 | Ancient Ruins (0) |
| Giant Crocodile | 5 | beast | 0 | Verdant Wilds (20) |
| Giant Ape | 7 | beast | 0 | Verdant Wilds (6) |
| Cloaker | 8 | aberration | 0 | Grim Crypts (12) |
| Aboleth | 10 | aberration | 0 | Verdant Wilds (16) |
| Great Orb of Eyes | 11 | aberration | 0 | Grim Crypts (12) |
| Balrug | 12 | fiend | 0 | Grim Crypts (18) |
| Adult Brass Dragon | 13 | dragon | 0 | Molten Depths (80) |
| Adult Copper Dragon | 14 | dragon | 0 | Verdant Wilds (38) |
| Adult Gold Dragon | 17 | dragon | 0 | Molten Depths (80) |
| Dragon Turtle | 17 | dragon | 0 | Verdant Wilds (30) |
| Balor | 19 | fiend | 0 | Molten Depths (22) |

### Ancient Ruins — thematic candidates not yet whitelisted (easy fills)

**CR 0 – ½** (46): Giant Fire Beetle (0), Scorpion (0), Homunculus (0), Stirge (1/8), Giant Weasel (1/8), Poisonous Snake (1/8), Giant Cockroach (1/8), Giant Slug (1/8), Giant Snail (1/8), Giant Firefly (1/8), Giant Bumblebee (1/8), Giant Gecko (1/8), Flying Snake (1/8), Skeleton (1/4), Zombie (1/4), Giant Centipede (1/4), Giant Frog (1/4), Swarm of Rats (1/4), Giant Wolf Spider (1/4), Boulder Beetle (1/4), Fire Bat (1/4), Fire Crab (1/4), Blink Frog (1/4), Constrictor Snake (1/4), Blink Dog (1/4), Sprite (1/4), Grimlock (1/4), Orc (1/2), Shadow (1/2), Satyr (1/2), Thug (1/2), Scout (1/2), Ghost Moth (1/2), Caustic Shrike (1/2), Big Kobold (1/2), Merfolk Fighter (1/2), Giant Wasp (1/2), Swarm of Insects (1/2), Swarm of Centipedes (1/2), Faun (1/2), Wandering Mushroom (1/2), Orc Whelp (1/2), Warhorse Skeleton (1/2), Swarm of Spiders (1/2), Lizardfolk (1/2), Sahuagin (1/2)

**CR ½ – 2** (33): Giant Spider (1), Wolf Spider (1), Ghoul (1), Giant Toad (1), Orc Warrior (1), Orc Priest (1), Tengu Warrior (1), Tengu Conjurer (1), Merfolk Javelineer (1), Merfolk Impaler (1), Specter (1), Ghast (2), Ochre Jelly (2), Ettercap (2), Orc Knight (2), Tengu Reaver (2), Merfolk Aquamancer (2), Naga Warrior (2), Naga Mage (2), Naga Ritualist (2), Ogre Zombie (2), Will-o'-Wisp (2), Water Nymph (2), Spriggan (2), Rock Worm (2), Phantom (2), Oklob Plant (2), Vine Stalker (2), Bronze Dragon Wyrmling (2), Wererat, Hybrid Form (2), Minotaur Skeleton (2), Rug of Smothering (2), Sea Hag (2)

**CR 2 – 4½** (23): Mummy (3), Werewolf (3), Manticore (3), Wight (3), Phase Spider (3), Naga Sharpshooter (3), Lindwurm (3), Blue Dragon Wyrmling (3), Ghost (4), Death Knight (4), Necromancer (4), Phantasmal Warrior (4), Black Pudding (4), Orc Wizard (4), Orc Sorcerer (4), Spriggan Defender (4), Spriggan Druid (4), Spriggan Berserker (4), Spiny Worm (4), Thorn Hunter (4), Wereboar, Hybrid Form (4), Weretiger, Hybrid Form (4), Couatl (4)

**CR 4½ – 8** (24): Wraith (5), Earth Elemental (5), Freezing Wraith (5), Shadow Wraith (5), Eidolon (5), Roper (5), Vampire Spawn (5), Werebear, Hybrid Form (5), Wyvern (6), Evil Wizard (6), Titan Skeleton (6), Profane Servitor (6), Stone Giant (7), Stone Giant Lord (7), Bone Dragon (7), Orc High Priest (7), Spriggan Rider (7), Brain Worm Swarm (7), Shield Guardian (7), Hydra (8), Juggernaut (8), Ancient Lich (8), Shadow Fiend (8), Young Bronze Dragon (8)

**CR 8+** (29): Cloud Giant (9), Treant (9), Bone Devil (9), Stone Golem (10), Shadow Dragon (11), Orc Warbringer (11), Giant Tarantula (11), Barrow Wight (11), Guardian Mummy (12), Wight King (12), Vampire (13), Mummy Priest (13), Orc Warlord (13), The Fey Queen (13), The Goblin King (13), Broodmother Spider (13), Storm Giant (13), Skeletal Champion (14), Vampire Knight (14), Vampire Mage (15), Mummy Lord (15), Iron Golem (16), Planetar (16), Ancient Lich Lord (18), Ancient Shadow Dragon (18), Lich (21), Solar (21), Ancient Bronze Dragon (22), Ancient Blue Dragon (23)

### Molten Depths (`molten`)
- Assigned now: **44** · proposed habitat pool: **62** · strong homes (top-3): **62** · target: **82**
- Assigned CR mix: **10 / 5 / 7 / 7 / 15**
- Proposed-pool CR mix: **5 / 5 / 8 / 15 / 29**

### Molten Depths — CR band gaps (proposed pool vs target)

| molten band comparison |
| --- | --- | --- | --- | --- | --- |
| Band | Assigned | Proposed pool | Target | Δ (proposed−target) | Unassigned thematic fills |
| CR 0 – ½ | 10 | 5 | 16.4 | -11.4 | 0 |
| CR ½ – 2 | 5 | 5 | 16.4 | -11.4 | 0 |
| CR 2 – 4½ | 7 | 8 | 16.4 | -8.4 | +1 |
| CR 4½ – 8 | 7 | 15 | 16.4 | -1.4 | +8 |
| CR 8+ | 15 | 29 | 16.4 | 12.6 | +14 |

### Molten Depths — thematically misplaced (assigned here, habitat says no)
These are whitelisted for `molten` even though the habitat scorer gives `molten` **zero** points from their data — e.g. a fire creature in a frost cave. Review whether they should be removed (the scorer's reasons below show what they actually fit).

| Monster | CR | Type | Habitat score for Molten Depths | Best-fit dungeon (score) |
| --- | --- | --- | --- | --- |
| Giant Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Grey Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Flying Sword | 1/4 | construct | 0 | Ancient Ruins (30) |
| Gnoll | 1/2 | humanoid | 0 | Verdant Wilds (20) |
| Hobgoblin | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Cockatrice | 1/2 | monstrosity | 0 | Verdant Wilds (6) |
| Gnoll Hunter | 1/2 | humanoid | 0 | Verdant Wilds (20) |
| Dust Mephit | 1/2 | elemental | 0 | Verdant Wilds (12) |
| Imp | 1 | fiend | 0 | Grim Crypts (18) |
| Gnoll Sergeant | 1 | humanoid | 0 | Verdant Wilds (20) |
| Animated Armor | 1 | construct | 0 | Ancient Ruins (30) |
| Gargoyle | 2 | elemental | 0 | Verdant Wilds (24) |
| Giant Scorpion | 3 | beast | 0 | Ancient Ruins (26) |
| Bearded Devil | 3 | fiend | 0 | Grim Crypts (18) |
| Death Drake | 4 | dragon | 0 | Grim Crypts (32) |
| Gnoll Shaman | 4 | humanoid | 0 | Verdant Wilds (20) |
| Hobgoblin Captain | 4 | humanoid | 0 | Ancient Ruins (26) |
| Hill Giant | 5 | giant | 0 | Ancient Ruins (18) |
| Earth Elemental | 5 | elemental | 0 | Ancient Ruins (16) |
| Hobgoblin Warlord | 7 | humanoid | 0 | Ancient Ruins (26) |
| Hezrou | 8 | fiend | 0 | Grim Crypts (18) |
| Chain Devil | 8 | fiend | 0 | Grim Crypts (18) |
| Guardian Naga | 10 | monstrosity | 0 | Verdant Wilds (36) |
| Fiend | 10 | fiend | 0 | Grim Crypts (18) |
| Great Orb of Eyes | 11 | aberration | 0 | Grim Crypts (12) |
| Balrug | 12 | fiend | 0 | Grim Crypts (18) |
| Guardian Serpent | 14 | monstrosity | 0 | Verdant Wilds (32) |
| Adult Black Dragon | 14 | dragon | 0 | Verdant Wilds (66) |
| Adult Copper Dragon | 14 | dragon | 0 | Verdant Wilds (38) |

### Molten Depths — thematic candidates not yet whitelisted (easy fills)

**CR 0 – ½** (3): Steam Mephit (1/4), Magmin (1/2), Magma Mephit (1/2)

**CR ½ – 2** (4): Brass Dragon Wyrmling (1), Ogre (2), Ogre Zombie (2), Bronze Dragon Wyrmling (2)

**CR 2 – 4½** (6): Deep Troll (3), Fire Drake (3), Blue Dragon Wyrmling (3), Gold Dragon Wyrmling (3), Ettin (4), Red Dragon Wyrmling (4)

**CR 4½ – 8** (13): Troll (5), Fire Elemental (5), Salamander (5), Flesh Golem (5), Barbed Devil (5), Troll Brute (5), Deep Troll Berserker (5), Deep Troll Earth Mage (5), Deep Troll Shaman (5), Rock Troll (5), Iron Troll (6), Young Brass Dragon (6), Young Bronze Dragon (8)

**CR 8+** (21): Cloud Giant (9), Steam Dragon (9), Young Red Dragon (10), Golden Dragon (10), Young Gold Dragon (10), Stone Golem (10), Remorhaz (11), Efreeti (11), Djinni (11), Quicksilver Dragon (12), Iron Dragon (13), Storm Giant (13), Iron Golem (16), Adult Blue Dragon (16), Adult Red Dragon (17), Ancient Iron Dragon (19), Ancient Brass Dragon (20), Ancient Golden Dragon (22), Ancient Bronze Dragon (22), Ancient Blue Dragon (23), Ancient Red Dragon (24)

### Frostfell (`frost`)
- Assigned now: **61** · proposed habitat pool: **16** · strong homes (top-3): **16** · target: **82**
- Assigned CR mix: **12 / 18 / 13 / 12 / 6**
- Proposed-pool CR mix: **1 / 3 / 1 / 3 / 8**

### Frostfell — CR band gaps (proposed pool vs target)

| frost band comparison |
| --- | --- | --- | --- | --- | --- |
| Band | Assigned | Proposed pool | Target | Δ (proposed−target) | Unassigned thematic fills |
| CR 0 – ½ | 12 | 1 | 16.4 | -15.4 | 0 |
| CR ½ – 2 | 18 | 3 | 16.4 | -13.4 | 0 |
| CR 2 – 4½ | 13 | 1 | 16.4 | -15.4 | 0 |
| CR 4½ – 8 | 12 | 3 | 16.4 | -13.4 | 0 |
| CR 8+ | 6 | 8 | 16.4 | -8.4 | +2 |

### Frostfell — thematically misplaced (assigned here, habitat says no)
These are whitelisted for `frost` even though the habitat scorer gives `frost` **zero** points from their data — e.g. a fire creature in a frost cave. Review whether they should be removed (the scorer's reasons below show what they actually fit).

| Monster | CR | Type | Habitat score for Frostfell | Best-fit dungeon (score) |
| --- | --- | --- | --- | --- |
| Giant Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Grey Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Giant Owl | 1/4 | beast | 0 | Verdant Wilds (6) |
| Drow | 1/4 | humanoid | 0 | Grim Crypts (28) |
| Flying Sword | 1/4 | construct | 0 | Ancient Ruins (30) |
| Gnoll | 1/2 | humanoid | 0 | Verdant Wilds (20) |
| Hobgoblin | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Cockatrice | 1/2 | monstrosity | 0 | Verdant Wilds (6) |
| Ghost Moth | 1/2 | beast | 0 | Grim Crypts (32) |
| Deep Elf Fighter | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Gnoll Hunter | 1/2 | humanoid | 0 | Verdant Wilds (20) |
| Giant Goat | 1/2 | beast | 0 | Verdant Wilds (6) |
| Ghoul | 1 | undead | 0 | Grim Crypts (32) |
| Dire Wolf | 1 | beast | 0 | Verdant Wilds (18) |
| Deep Elf Mage | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Priest | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Knight | 1 | humanoid | 0 | Ancient Ruins (26) |
| Hippogriff | 1 | monstrosity | 0 | Verdant Wilds (6) |
| Gnoll Sergeant | 1 | humanoid | 0 | Verdant Wilds (20) |
| Giant Hyena | 1 | beast | 0 | Verdant Wilds (6) |
| Ghast | 2 | undead | 0 | Grim Crypts (32) |
| Gargoyle | 2 | elemental | 0 | Verdant Wilds (24) |
| Deep Elf Sorcerer | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Conjurer | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Demonologist | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf High Priest | 2 | humanoid | 0 | Ancient Ruins (26) |
| Griffon | 2 | monstrosity | 0 | Verdant Wilds (6) |
| Deep Dwarf Berserker | 2 | humanoid | 0 | Grim Crypts (16) |
| Deep Dwarf Artificer | 2 | humanoid | 0 | Ancient Ruins (36) |
| Awakened Tree | 2 | plant | 0 | Verdant Wilds (44) |
| Deep Troll | 3 | giant | 0 | Molten Depths (12) |
| Doppelganger | 3 | monstrosity | 0 | Verdant Wilds (6) |
| Deep Elf Blademaster | 3 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Summoner | 3 | humanoid | 0 | Ancient Ruins (26) |
| Deep Dwarf Death Knight | 3 | humanoid | 0 | Grim Crypts (48) |
| Cyclops | 3 | giant | 0 | Molten Depths (12) |
| Ghost | 4 | undead | 0 | Grim Crypts (46) |
| Deep Elf Death Mage | 4 | humanoid | 0 | Grim Crypts (48) |
| Deep Elf Annihilator | 4 | humanoid | 0 | Ancient Ruins (26) |
| Greater Naga | 4 | monstrosity | 0 | Verdant Wilds (24) |
| Death Drake | 4 | dragon | 0 | Grim Crypts (32) |
| Gnoll Shaman | 4 | humanoid | 0 | Verdant Wilds (20) |
| Hobgoblin Captain | 4 | humanoid | 0 | Ancient Ruins (26) |
| Bulette | 5 | monstrosity | 0 | Verdant Wilds (6) |
| Hill Giant | 5 | giant | 0 | Ancient Ruins (18) |
| Deep Troll Berserker | 5 | giant | 0 | Molten Depths (12) |
| Deep Troll Earth Mage | 5 | giant | 0 | Ancient Ruins (16) |
| Deep Troll Shaman | 5 | giant | 0 | Molten Depths (12) |
| Daeva | 5 | celestial | 0 | Ancient Ruins (0) |
| Deep Elf Master Archer | 5 | humanoid | 0 | Ancient Ruins (26) |
| Gorgon | 5 | monstrosity | 0 | Ancient Ruins (14) |
| Chimera | 6 | monstrosity | 0 | Molten Depths (20) |
| Angel | 6 | celestial | 0 | Ancient Ruins (12) |
| Hobgoblin Warlord | 7 | humanoid | 0 | Ancient Ruins (26) |
| Aboleth | 10 | aberration | 0 | Verdant Wilds (16) |
| Great Orb of Eyes | 11 | aberration | 0 | Grim Crypts (12) |
| Drow Matron | 13 | humanoid | 0 | Grim Crypts (16) |
| Greater Mummy | 14 | undead | 0 | Grim Crypts (32) |
| Adult Blue Dragon | 16 | dragon | 0 | Molten Depths (22) |
| Adult Gold Dragon | 17 | dragon | 0 | Molten Depths (80) |

### Frostfell — thematic candidates not yet whitelisted (easy fills)

**CR 0 – ½** (1): Ice Mephit (1/2)

**CR ½ – 2** (3): Polar Bear (2), White Dragon Wyrmling (2), Silver Dragon Wyrmling (2)

**CR 2 – 4½** (1): Winter Wolf (3)

**CR 4½ – 8** (2): Young White Dragon (6), Mammoth (6)

**CR 8+** (8): Young Silver Dragon (9), Remorhaz (11), Quicksilver Dragon (12), Adult White Dragon (13), Ice Devil (14), Adult Silver Dragon (16), Ancient White Dragon (20), Ancient Silver Dragon (23)

### Grim Crypts (`grim`)
- Assigned now: **46** · proposed habitat pool: **121** · strong homes (top-3): **121** · target: **82**
- Assigned CR mix: **12 / 8 / 7 / 8 / 11**
- Proposed-pool CR mix: **14 / 23 / 20 / 29 / 35**

### Grim Crypts — CR band gaps (proposed pool vs target)

| grim band comparison |
| --- | --- | --- | --- | --- | --- |
| Band | Assigned | Proposed pool | Target | Δ (proposed−target) | Unassigned thematic fills |
| CR 0 – ½ | 12 | 14 | 16.4 | -2.4 | +2 |
| CR ½ – 2 | 8 | 23 | 16.4 | 6.6 | +15 |
| CR 2 – 4½ | 7 | 20 | 16.4 | 3.6 | +13 |
| CR 4½ – 8 | 8 | 29 | 16.4 | 12.6 | +21 |
| CR 8+ | 11 | 35 | 16.4 | 18.6 | +24 |

### Grim Crypts — thematically misplaced (assigned here, habitat says no)
These are whitelisted for `grim` even though the habitat scorer gives `grim` **zero** points from their data — e.g. a fire creature in a frost cave. Review whether they should be removed (the scorer's reasons below show what they actually fit).

| Monster | CR | Type | Habitat score for Grim Crypts | Best-fit dungeon (score) |
| --- | --- | --- | --- | --- |
| Giant Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Grey Rat | 1/8 | beast | 0 | Ancient Ruins (14) |
| Giant Bat | 1/4 | beast | 0 | Ancient Ruins (14) |
| Swarm of Bats | 1/4 | beast | 0 | Ancient Ruins (14) |
| Flying Sword | 1/4 | construct | 0 | Ancient Ruins (30) |
| Grimlock | 1/4 | humanoid | 0 | Verdant Wilds (12) |
| Hobgoblin | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Darkmantle | 1/2 | monstrosity | 0 | Verdant Wilds (18) |
| Gnoll Hunter | 1/2 | humanoid | 0 | Verdant Wilds (20) |
| Gnoll Sergeant | 1 | humanoid | 0 | Verdant Wilds (20) |
| Animated Armor | 1 | construct | 0 | Ancient Ruins (30) |
| Gargoyle | 2 | elemental | 0 | Verdant Wilds (24) |
| Azer | 2 | elemental | 0 | Molten Depths (60) |
| Gnoll Shaman | 4 | humanoid | 0 | Verdant Wilds (20) |
| Hobgoblin Captain | 4 | humanoid | 0 | Ancient Ruins (26) |
| Flesh Golem | 5 | construct | 0 | Ancient Ruins (30) |
| Hobgoblin Warlord | 7 | humanoid | 0 | Ancient Ruins (26) |
| Adult Black Dragon | 14 | dragon | 0 | Verdant Wilds (66) |
| Androsphinx | 17 | monstrosity | 0 | Verdant Wilds (6) |

### Grim Crypts — thematic candidates not yet whitelisted (easy fills)

**CR 0 – ½** (11): Lemure (0), Kobold (1/8), Manes (1/8), Skeleton (1/4), Zombie (1/4), Drow (1/4), Shadow (1/2), Brain Worm (1/2), Deep Elf Fighter (1/2), Big Kobold (1/2), Warhorse Skeleton (1/2)

**CR ½ – 2** (19): Quasit (1), Deep Elf Mage (1), Deep Elf Priest (1), Deep Elf Knight (1), Specter (1), Gelatinous Cube (2), Ochre Jelly (2), Deep Elf Sorcerer (2), Deep Elf Conjurer (2), Deep Elf Demonologist (2), Deep Elf High Priest (2), Deep Dwarf Berserker (2), Deep Dwarf Artificer (2), Giant Amoeba (2), Gibbering Mouther (2), Ogre Zombie (2), Will-o'-Wisp (2), Phantom (2), Minotaur Skeleton (2)

**CR 2 – 4½** (15): Mummy (3), Wight (3), Phase Spider (3), Deep Elf Blademaster (3), Deep Elf Summoner (3), Deep Dwarf Death Knight (3), Deep Elf Death Mage (4), Deep Elf Annihilator (4), Death Knight (4), Necromancer (4), Phantasmal Warrior (4), Death Drake (4), Chuul (4), Shining Eye (4), Succubus/Incubus (4)

**CR 4½ – 8** (23): Wraith (5), Troll (5), Troll Brute (5), Freezing Wraith (5), Shadow Wraith (5), Eidolon (5), Deep Elf Master Archer (5), Otyugh (5), Vampire Spawn (5), Night Hag (5), Vrock (6), Titan Skeleton (6), Profane Servitor (6), Soul Eater (6), Drider (6), Reaper (7), Executioner (7), Ice Fiend (7), Eye of Devastation (7), Oni (7), Shield Guardian (7), Ancient Lich (8), Shadow Fiend (8)

**CR 8+** (26): Glabrezu (9), Aboleth (10), Shadow Dragon (11), Green Death (11), Blue Death (11), Barrow Wight (11), Guardian Mummy (12), Wight King (12), Erinyes (12), Vampire (13), Mummy Priest (13), Rakshasa (13), Nalfeshnee (13), Ice Devil (14), Skeletal Champion (14), Vampire Knight (14), Cacodemon (15), Tormentor (15), Vampire Mage (15), Mummy Lord (15), Marilith (16), Reaper Lord (17), Ancient Lich Lord (18), Ancient Shadow Dragon (18), Pit Fiend (20), Lich (21)

### Verdant Wilds (`verdant`)
- Assigned now: **103** · proposed habitat pool: **228** · strong homes (top-3): **228** · target: **82**
- Assigned CR mix: **31 / 29 / 17 / 16 / 10**
- Proposed-pool CR mix: **72 / 56 / 29 / 36 / 35**

### Verdant Wilds — CR band gaps (proposed pool vs target)

| verdant band comparison |
| --- | --- | --- | --- | --- | --- |
| Band | Assigned | Proposed pool | Target | Δ (proposed−target) | Unassigned thematic fills |
| CR 0 – ½ | 31 | 72 | 16.4 | 55.6 | +41 |
| CR ½ – 2 | 29 | 56 | 16.4 | 39.6 | +27 |
| CR 2 – 4½ | 17 | 29 | 16.4 | 12.6 | +12 |
| CR 4½ – 8 | 16 | 36 | 16.4 | 19.6 | +20 |
| CR 8+ | 10 | 35 | 16.4 | 18.6 | +25 |

### Verdant Wilds — thematically misplaced (assigned here, habitat says no)
These are whitelisted for `verdant` even though the habitat scorer gives `verdant` **zero** points from their data — e.g. a fire creature in a frost cave. Review whether they should be removed (the scorer's reasons below show what they actually fit).

| Monster | CR | Type | Habitat score for Verdant Wilds | Best-fit dungeon (score) |
| --- | --- | --- | --- | --- |
| Drow | 1/4 | humanoid | 0 | Grim Crypts (28) |
| Hobgoblin | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Brain Worm | 1/2 | aberration | 0 | Grim Crypts (12) |
| Deep Elf Fighter | 1/2 | humanoid | 0 | Ancient Ruins (26) |
| Bugbear | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Mage | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Priest | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Knight | 1 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Sorcerer | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Conjurer | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Demonologist | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf High Priest | 2 | humanoid | 0 | Ancient Ruins (26) |
| Deep Dwarf Berserker | 2 | humanoid | 0 | Grim Crypts (16) |
| Deep Dwarf Artificer | 2 | humanoid | 0 | Ancient Ruins (36) |
| Giant Amoeba | 2 | ooze | 0 | Ancient Ruins (20) |
| Deep Troll | 3 | giant | 0 | Molten Depths (12) |
| Deep Elf Blademaster | 3 | humanoid | 0 | Ancient Ruins (26) |
| Deep Elf Summoner | 3 | humanoid | 0 | Ancient Ruins (26) |
| Deep Dwarf Death Knight | 3 | humanoid | 0 | Grim Crypts (48) |
| Giant Orange Brain | 3 | aberration | 0 | Grim Crypts (12) |
| Deep Elf Death Mage | 4 | humanoid | 0 | Grim Crypts (48) |
| Deep Elf Annihilator | 4 | humanoid | 0 | Ancient Ruins (26) |
| Hobgoblin Captain | 4 | humanoid | 0 | Ancient Ruins (26) |
| Hill Giant | 5 | giant | 0 | Ancient Ruins (18) |
| Deep Troll Berserker | 5 | giant | 0 | Molten Depths (12) |
| Deep Troll Earth Mage | 5 | giant | 0 | Ancient Ruins (16) |
| Deep Troll Shaman | 5 | giant | 0 | Molten Depths (12) |
| Daeva | 5 | celestial | 0 | Ancient Ruins (0) |
| Deep Elf Master Archer | 5 | humanoid | 0 | Ancient Ruins (26) |
| Angel | 6 | celestial | 0 | Ancient Ruins (12) |
| Hobgoblin Warlord | 7 | humanoid | 0 | Ancient Ruins (26) |
| Great Orb of Eyes | 11 | aberration | 0 | Grim Crypts (12) |
| Drow Matron | 13 | humanoid | 0 | Grim Crypts (16) |
| Adult Blue Dragon | 16 | dragon | 0 | Molten Depths (22) |

### Verdant Wilds — thematic candidates not yet whitelisted (easy fills)

**CR 0 – ½** (45): Giant Fire Beetle (0), Scorpion (0), Homunculus (0), Shrieker (0), Stirge (1/8), Giant Weasel (1/8), Poisonous Snake (1/8), Giant Slug (1/8), Giant Snail (1/8), Flying Snake (1/8), Goblin (1/4), Wolf (1/4), Swarm of Rats (1/4), Giant Badger (1/4), Giant Wolf Spider (1/4), Boulder Beetle (1/4), Fire Bat (1/4), Fire Crab (1/4), Blink Frog (1/4), Constrictor Snake (1/4), Blink Dog (1/4), Steam Mephit (1/4), Violet Fungus (1/4), Sprite (1/4), Flying Sword (1/4), Grimlock (1/4), Orc (1/2), Warg (1/2), Satyr (1/2), Deep Gnome (1/2), Rust Monster (1/2), Ghost Moth (1/2), Caustic Shrike (1/2), Big Kobold (1/2), Merfolk Fighter (1/2), Giant Wasp (1/2), Gray Ooze (1/2), Faun (1/2), Wandering Mushroom (1/2), Orc Whelp (1/2), Dust Mephit (1/2), Ice Mephit (1/2), Magma Mephit (1/2), Swarm of Spiders (1/2), Sahuagin (1/2)

**CR ½ – 2** (38): Giant Spider (1), Wolf Spider (1), Harpy (1), Giant Toad (1), Orc Warrior (1), Orc Priest (1), Merfolk Javelineer (1), Merfolk Impaler (1), Grizzly Bear (1), Copper Dragon Wyrmling (1), Giant Vulture (1), Polar Bear (2), Mimic (2), Ochre Jelly (2), Ettercap (2), Orc Knight (2), Merfolk Aquamancer (2), Naga Warrior (2), Naga Mage (2), Naga Ritualist (2), Grick (2), Green Dragon Wyrmling (2), Black Dragon Wyrmling (2), Water Nymph (2), Spriggan (2), Rock Worm (2), Oklob Plant (2), Vine Stalker (2), Bronze Dragon Wyrmling (2), Azer (2), Pegasus (2), Hunter Shark (2), Saber-Toothed Tiger (2), Plesiosaurus (2), Giant Boar (2), Rug of Smothering (2), Merrow (2), Sea Hag (2)

**CR 2 – 4½** (20): Minotaur (3), Manticore (3), Owlbear (3), Phase Spider (3), Naga Sharpshooter (3), Death Yak (3), Lindwurm (3), Swamp Drake (3), Gold Dragon Wyrmling (3), Winter Wolf (3), Elephant (4), Black Pudding (4), Orc Wizard (4), Orc Sorcerer (4), Spriggan Defender (4), Spriggan Druid (4), Spriggan Berserker (4), Spiny Worm (4), Thorn Hunter (4), Lamia (4)

**CR 4½ – 8** (28): Air Elemental (5), Earth Elemental (5), Fire Elemental (5), Water Elemental (5), Roper (5), Vampire Spawn (5), Xorn (5), Shambling Mound (5), Unicorn (5), Giant Shark (5), Triceratops (5), Medusa (6), Wyvern (6), Dire Elephant (6), Invisible Stalker (6), Mammoth (6), Stone Giant (7), Young Black Dragon (7), Stone Giant Lord (7), Orc High Priest (7), Spriggan Rider (7), Brain Worm Swarm (7), Young Copper Dragon (7), Shield Guardian (7), Hydra (8), Young Green Dragon (8), Young Bronze Dragon (8), Tyrannosaurus Rex (8)

**CR 8+** (28): Mottled Dragon (9), Treant (9), Clay Golem (9), Harpy Matriarch (10), Young Gold Dragon (10), Stone Golem (10), Behir (11), Remorhaz (11), Orc Warbringer (11), Giant Tarantula (11), Roc (11), Gynosphinx (11), Vampire (13), Orc Warlord (13), The Fey Queen (13), The Goblin King (13), Broodmother Spider (13), Adult Black Dragon (14), Purple Worm (15), Adult Green Dragon (15), Adult Bronze Dragon (15), Iron Golem (16), Ancient Black Dragon (21), Ancient Copper Dragon (21), Ancient Green Dragon (22), Ancient Bronze Dragon (22), Kraken (23), Tarrasque (30)

## Content gaps — bands where even the full proposed habitat pool falls short
A band is a content gap when the **entire** proposed habitat pool (assigned + easy fills) in that band is smaller than the even-spread target — i.e. even whitelisting every habitat-fit monster, that band cannot reach ~16 creatures, so reaching an even spread there requires adding new monsters. Bands where the pool exceeds the target need no new content, just assignment.
- **Ancient Ruins**: none — every band has enough thematic candidates to reach target
- **Molten Depths**: CR 0 – ½: pool 5/16.4 (assigned 10, fillable -5); CR ½ – 2: pool 5/16.4 (assigned 5, fillable 0); CR 2 – 4½: pool 8/16.4 (assigned 7, fillable 1); CR 4½ – 8: pool 15/16.4 (assigned 7, fillable 8)
- **Frostfell**: CR 0 – ½: pool 1/16.4 (assigned 12, fillable -11); CR ½ – 2: pool 3/16.4 (assigned 18, fillable -15); CR 2 – 4½: pool 1/16.4 (assigned 13, fillable -12); CR 4½ – 8: pool 3/16.4 (assigned 12, fillable -9); CR 8+: pool 8/16.4 (assigned 6, fillable 2)
- **Grim Crypts**: CR 0 – ½: pool 14/16.4 (assigned 12, fillable 2)
- **Verdant Wilds**: none — every band has enough thematic candidates to reach target

## Recommended actions
1. **Assign habitat-fit monsters first.** The "easy fills" lists add creatures to a dungeon at no cost — they are already thematically correct per the habitat scorer but not whitelisted. Prioritize Molten Depths, Grim Crypts, Frostfell.
2. **Remove or rehome misplaced monsters** (listed per dungeon above) so a frost cave doesn't spawn fire creatures and a lava forge doesn't spawn ice ones. The report shows each misplaced creature's best-fit dungeon for rehoming.
3. **Add new monsters only for genuine content gaps** (the "Content gaps" section): bands where even the full habitat pool can't reach the even target. Prefer importing SRD/DCSS monsters whose own data fits the dungeon's climate.
4. **Per-monster overrides are the long-term answer.** A monster with an explicit `dungeons` array already overrides everything, so the game never needs family-based defaults. Once the report’s proposals are applied, `DUNGEON_MONSTER_MAP` becomes only a seed hint, not a rule.

## Appendix
**267** of **410** monsters are whitelisted for none of the 5 dungeon types. These never appear in themed dungeon rooms.
CR spread of the unassigned: CR 0 – ½: 52 · CR ½ – 2: 53 · CR 2 – 4½: 34 · CR 4½ – 8: 55 · CR 8+: 73

**120** monsters have a weak habitat signal (best score < 15) — generic creatures with no strong climate/terrain data. Their proposed home is a soft default; decide these by hand.
Giant Rat, Grey Rat, Giant Bat, Stirge, Giant Weasel, Swarm of Rats, Swarm of Bats, Giant Badger, Giant Owl, Warg, Harpy, Thug, Scout, Cockatrice, Rust Monster, Werewolf, Ogre, Minotaur, Deep Troll, Manticore, Owlbear, Doppelganger, Basilisk, Troll, Bulette, Medusa, Hydra, Air Elemental, Wyvern, Behir, Ettin, Young Dragon, Troll Brute, Purple Worm, Tarrasque, Giant Ant, Giant Cockroach, Giant Fire Beetle, Giant Beetle, Boulder Beetle, Giant Mite, Giant Slug, Giant Snail, Giant Blowfly, Giant Mosquito, Giant Leech, Giant Firefly, Giant Bumblebee, Caustic Shrike, Brain Worm, Griffon, Hippogriff, Tengu Warrior, Tengu Conjurer, Tengu Reaver, Evil Wizard, Giant Alligator, Giant Anaconda, Death Yak, Cyclops, Lindwurm, Giant Orange Brain, Deep Troll Berserker, Deep Troll Shaman, Iron Troll, Rock Troll, Daeva, Angel, Titan, Iron Dragon, Steam Dragon, Phoenix, Ancient Iron Dragon, Harpy Matriarch, Giant Wasp, Swarm of Insects, Swarm of Centipedes, Gibbering Mouther, Otyugh, Cloaker, Pseudodragon, Gazer, Shining Eye, Eye of Devastation, Great Orb of Eyes, Rock Worm, Spiny Worm, Brain Worm Swarm, Giant Leech Swarm, Giant Tarantula, Werebear, Hybrid Form, Wereboar, Hybrid Form, Wererat, Hybrid Form, Weretiger, Hybrid Form, Djinni, Invisible Stalker, Dust Mephit, Xorn, Gorgon, Roc, Oni, Couatl, Solar, Planetar, Giant Ape, Tyrannosaurus Rex, Plesiosaurus, Giant Eagle, Giant Vulture, Giant Goat, Giant Hyena, Swarm of Beetles, Swarm of Poisonous Snakes, Swarm of Ravens, Swarm of Spiders, Swarm of Wasps, Gynosphinx, Androsphinx, Lizardfolk, Grimlock
