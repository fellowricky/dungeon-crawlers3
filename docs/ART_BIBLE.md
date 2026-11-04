# Dungeon Crawlers — Art Reference Bible

*A style and subject reference for generating art that belongs in this game. Everything here describes what is already in the game; match it, don't reinvent it.*

---

## 1. The game in one paragraph

**Dungeon Crawlers** is an idle, party-based dungeon crawler: four adventurers built on the D&D SRD 5.1 rules crawl procedurally generated dungeons on their own while the player manages the meta-game (party, gear, guild, quests). It runs in **Three.js** — the dungeon is a real 3D scene of instanced stone, torches and props seen from a raised three-quarter camera — but every **creature, hero, effect and icon is 2D pixel art** billboarded into that 3D world. Think *a 16-bit sprite game living inside a moody low-poly diorama*. The tone is grim-fantasy, lit by torchlight, with a dry sense of humour in the naming ("Shaped Like A Stump", "Grows Them, Then Throws Them").

---

## 2. Look and feel

### 2.1 The two layers

| Layer | What it is | Style |
|---|---|---|
| **World** | 3D dungeon: floors, walls, wall caps, props (crates, barrels, bookshelves, altars, statues, urns, weapon racks), point-light torches, fog of war | Low-poly, flat-shaded, **dark**. Colour comes almost entirely from light sources. Walls and floors are desaturated stone in the theme's cast; the theme's *accent* colour lives in the flames, the glowing spawn rings, liquid pools and fog tint. |
| **Sprites** | Heroes, monsters, bosses, familiars, spell VFX, UI icons | **16-bit pixel art**, bold dark outline, flat cel shading, limited palette, clean readable silhouette. Heroes are layered paper-doll sprites; monsters are drawn to the conventions in §2.3. |

The camera looks down at the floor from a raised three-quarter angle, so creatures are drawn **side-on, facing right**, standing upright.

### 2.2 Palette and UI

- **Global mood:** near-black backgrounds (`#101418`–`#161a22`), cold bone text `#d0d4d8`, **tarnished brass** accents `#b99d63` / `#c1a974`, bronze hairline borders. No glassmorphism, no rounded corners — **0px radius everywhere**. Healing is `#58b76e` green.
- **Font:** `VT323` (pixel monospace) for everything.
- **UI icons:** one centred symbolic object, bold dark outline, two or three colours — a glyph, not a picture. Used for abilities, classes, damage types, guild facilities, quest kinds and rewards.
- **Guild hall art:** painted building illustrations — the one place the game uses painterly rather than pixel art; muted, torch-warm, weathered timber and stone.

### 2.3 How creatures are drawn

Every creature in the game follows the same conventions, so anything new has to as well:

- **16-bit pixel art**: crisp lines, bold dark outline, flat cel shading, limited palette, a silhouette that reads at a glance.
- **One creature, full body, facing right, standing idle**, isolated on a plain background — no scene, no ground, no cast shadow.
- **Scale is stated, not implied.** Say "knee-high", "half again a man's height", "three times a man's height". A kobold and a frost giant are drawn to the same frame; the description is what makes one small.
- **Mooks are not heroes.** Rank-and-file creatures are squat, lumpen, unglamorous — no heroic proportions, no muscle definition. Bosses may be heroic, larger and richer.
- **Finery is earned by rank.** Low-level creatures look *poor*: rags, scrap, bare skin, nothing. Chain, iron, brass and gold arrive one rank at a time. Never give a level-1 creature good armour because it looks better.
- **Every biome has a palette rule** (see §3): molten bodies are dark with heat only as an accent; the frost hold has no warm brown; grim undead have no green in the flesh; verdant is earth and leaf under warm gold light.
- **Weapons point the way the body faces.** If a creature holds a spear, the head is in front of it, on the right.
- **Named specifics beat adjectives.** "Dirty white surgical linen wound in overlapping strips, stained brown at the seams" produces a creature; "creepy bandaged zombie" does not.

A shipped example of the level of specificity that works (Grim, "Suture-Thing"):

> *One single undead body wrapped in surgical linen, facing right, full body, standing idle. Dirty white surgical linen bandage wound over most of its torso, hips and thighs in overlapping strips, grubby and stained brown with dried blood at the seams, leaving bare patches of skin at the shoulders, forearms and shins. Four arms, two hanging, two raised in front, all bare below the elbow and empty-handed. One lumpen adult corpse crudely sewn together from mismatched parts, the bare skin a cold grey-white and dull pinkish-grey with no green in it at all, thick black cord stitching…*

---

## 3. Biomes

Fourteen themes. Five are **dungeon** themes (the core game). Nine are **overland** themes — open-air maps with the same generator contract — used for the story prologue and as "approach" or "threshold" areas leading into a dungeon. Each theme has a *label*, an *accent* colour (used for its flames, rings, UI chip and fog tint) and a stone cast.

### 3.1 Dungeon themes

| Theme | Accent | Stone / floor cast | Light | Feel |
|---|---|---|---|---|
| **Ancient** | `#e8973f` amber | cool blue-grey stone `#646a78`, walls `#424a58` | warm orange torches | Classic ruined halls and crypt-stone. Goblinoid ladder: kobolds → goblins → hobgoblins → bugbears → gnolls → orcs. Spawn rings glow teal `#3fd0bb`, crystals pale blue. |
| **Molten** | `#ff8642` hot orange | basalt grey walls `#2a2c33`, brown-black floor `#645448` | orange torches, orange hemi/dir light, lava seepage from walls into floor pits | Volcanic foundry held by an infernal legion. **Palette rule: bodies are dark (charcoal, basalt, blackened iron); heat is an accent only — glowing cracks, eye-light, a hot edge.** Armour ladder: nothing → chain → iron → brass → iron-and-brass-with-heat. |
| **Frost** | `#7fd4ff` ice blue | blue-grey stone `#6c7a8e`, walls `#445268` | pale blue flames `#86d9ff` | A frost giant's hold, climbed from the bottom. Above L2, everything belongs to the household: **blue-grey skin, black iron, ice and silver; no warm brown** (brown is reserved for the L2 Whitewake refugees). Spawn rings white/ice. |
| **Grim** | `#9fe66a` sickly green | mossy green-grey stone `#56624e`, walls `#343e2e` | green flames `#8fe05a` | Necropolis and plague-ward. Undead, cultists, chirurgeons. Grim owns *stitched* things. Undead flesh is grey-white / pinkish-grey with **no green in the skin** — the green is in the light. |
| **Verdant** | `#59d68f` leaf green | brown earth floor `#54321e`, near-neutral walls `#5c5c54` showing vine-brick tile | warm gold torches `#ffcf6a`, pool glow | Overgrown forest-ruin. Ants → spiders → myconids → spriggans → hags' fey court → living trees. Spawn rings green on bark. |

### 3.2 Overland themes

All `overland:true` — daylight or dusk, open terrain (Voronoi zones, tree walls, dirt trails, palisades), the same accent-colour discipline.

| Theme | Accent | Ground | Role |
|---|---|---|---|
| **Forest** | `#8fd45a` | green turf `#4a643c`, dirt trails `#6e604d`, dark canopy caps | Story prologue; shares the verdant roster |
| **Moor** | `#c9b877` dry gold | olive heath `#58623f` | Approach to grim |
| **Mire** | `#6f9a72` bog green | black-green mud `#3a4234`, dense fog, greenish flame | Approach to grim; swamp |
| **Holdfast** | `#e0a24a` | — | Approach to ancient; a palisaded warcamp |
| **Boneyard** | `#9fd08a` | — | Threshold of **grim** — the doorstep of the necropolis |
| **Ruinfield** | `#e8973f` | — | Threshold of **ancient** — tumbled stone in the open |
| **Ashfield** | `#ff8642` | — | Threshold of **molten** — cinder plains |
| **Snowfield** | `#7fd4ff` | — | Threshold of **frost** |
| **Sporewood** | `#59d68f` | — | Threshold of **verdant** — fungal forest |

A threshold shares its parent dungeon's accent so the transition reads as *walking into* the biome.

---

## 4. Monsters

530 stat blocks in total; the ones below are the **curated per-biome rosters** — the creatures the player actually meets, level by level. Each dungeon level has one *faction*: five mooks (a warrior, a ranged, a caster, a tank, an elite/beast) and a boss. Factions escalate in CR and in visual richness. Level 1 is CR ⅛; level 6 is CR 3.

Names in **bold** are the faction; the boss follows the em-dash.

### 4.1 Ancient

| L | Faction | Mooks | Boss |
|---|---|---|---|
| 1 | **Grikvein Warren** (kobolds + rats) | Scrapper, Slinger, Shaman, Shieldback, Warden, Giant Rat, Grey Rat | Grik, Kobold Chief |
| 2 | **Nail Crown** (goblins) | Cutter, Archer, Hexer, Shield-Bearer, Sneak | Grot, Nail-Crown |
| 3 | **Red Banner** (hobgoblins) | Legionary, Archer, Devastator, Ironback, Drillmaster | Vurk, the Red-Banner |
| 4 | **Black Maul** (bugbears) | Brute, Javelineer, Bonespeaker, Hidebound, Throatcutter | Ghaur, King of the Four Gates |
| 5 | **Carrion Choir** (gnolls) | Render, Longfang, Marrowchanter, Bonecarl, Carrion Hyena | Hessk, Split-Grin |
| 6 | **Sundered Oath** (orcs) | Oathsworn, Ash-Thrower, Eye-Priest, The Unbroken, Berserker | Gorrukh, the Last Word |

Planned L7+: stone giants and ogre labourers; a medusa's petrified court; a drow raid with a behir; the aboleth's dominated thralls.

### 4.2 Verdant

| L | Faction | Mooks | Boss |
|---|---|---|---|
| 1 | **Ant colony** | Worker, Soldier, Spitter, Drone | The Brood Queen |
| 2 | **Widowsilk** (spiders) | Fang, Slinger, Weaver, Carapace, Stalker | Nyx, the Widowsilk Queen |
| 3 | **Bloomrot** (myconids) | Capfist, Puffcap, Sporespeaker, Bracketback, Thrall | The Bloomrot Sovereign |
| 4 | **Bramblecourt** (spriggans) | Thornblade, Quillcast, Thistlewitch, Heartwood, Wakethorn | The Thorn Warden |
| 5 | **Blackbog Court** (hags + fey servants) | Redcap, Blight Fairy (flying), The Blackbog Daughter, The Grandmother's Toad, Blackbog Hound | The Blackbog Grandmother |
| 6 | **Old Growth** (living trees — fire-vulnerable, condition-immune) | Sapling, Thornlobber, Heartwood, Bulwark ("Shaped Like A Stump"), Stalker (spindly, black-barked) | The Elder (three times a man's height) |

Design note: L1–4 are all *small forest folk*, so L5 and L6 deliberately break scale — the Court is all rider and no body, the Wood is all body and no rider.

Planned L7+: the drowned (merrow, sea hags, drowned knights); the hydra's fen (lizardfolk, crocodile hounds); the chimera's crag (perytons, harpies, manticore); the roc's eyrie (griffon riders, giant eagles); a fey court.

### 4.3 Frost

| L | Faction | Mooks | Boss |
|---|---|---|---|
| 1 | **Crystal vermin** | Rime Crawler, Shard Mantis, Frost Prism, Rime Urchin, Shard Swarm | The Hoarfrost Warden |
| 2 | **Whitewake** (ice hunters, fur and bone — the only warm brown in the biome) | Icebreaker, Spearcaster, Wolf-Speaker, Hearthguard, Snowfang | The White Mother |
| 3 | **Hollowkin** (squat ice-troll drudges in scavenged scrap) | Drudge, Slinger, Rimespeak, Doorstop, Gnasher | Overseer |
| 4 | **Rimewrights** (faceted ice constructs) | Shard, Needler, Chorus, Bulwark, Glassblade; non-humanoid set: Crawler, Shardcloud, Monolith, Boulder, Lash | Wintersmith |
| 5 | **Huscarls** (giant-kin soldiers, half again a man's height) | Axeman, Harpooner, Stormspeak, Shieldwall, Berserk | Thegn |
| 6 | **Jarl's Court** (frost giants proper) | Iceward, Stonecaster, Wintersinger, Glacierback, Wyrmhound | The Jarl |

Planned L7+: golem vaults under the hold; remorhaz warrens (fire-belly beasts under the ice — a warm palette break); the white dragon's cult, then the dragon.

### 4.4 Grim

| L | Faction | Mooks | Boss |
|---|---|---|---|
| 1 | **Grimhost** (skeletons + a cult) | Skeletal Swordsman, Skeletal Bulwark, Skeletal Bowman, Crypt Bat, Cultist, Grave Rat | The Bone-Chanter |
| 2 | **Grave Tithe** (penitent cult) | Tithe-Taker, Nail-Marker, Confessor, Iron Penitent, Flagellant | Keeper of the Tithe (Mother Vellum) |
| 3 | **Pale Harvest** (necromancy) | Risen Drudge, Gorebloat, Harvest Necromancer, Gravebound, Carrion Ghoul | Sarkoth, the Pale Harvest |
| 4 | **Chirurgeons' Ward** (surgical horror) | Suture-Thing, Hook-Hauler, Bonesaw Acolyte, Tallowclad, Sluiceborn | Cauter, the Mending Hand |
| 5 | **The Unrelieved** (barrow wights — *nothing matches*: every piece from a different era) | Cairnsworn, Greenmail, Ashen Archer, Torcbearer, Grave-Hollow | Hald, the Unrelieved |
| 6 | **The Cerement** (the exact inversion — uniform, ritual, matched: linen, resin, gold leaf, lapis) | Bearer, Archer, Lector, Shieldbearer, Unwound | The Guardian |

Planned L7+: a wraith's shadow-court (the first *incorporeal* tier); a vampire's household in one livery; the vampire's mage-covenant; the wight-king's barrow.

### 4.5 Molten

| L | Faction | Mooks | Boss |
|---|---|---|---|
| 1 | **Ember Vents** (vermin) | Ash Mite, Cinder Rat, Ember Magmin, Ash Speaker, Vent Beetle | Ignis, Ember-Swarm Chief |
| 2 | **Cinderkin** (knee-high scamps, cracked charcoal hide) | Scamp, Flinger, Witch, Lumper, Darter | Hearthmother |
| 3 | **Slagbound** (chained thralls who feed the furnace) | Stoker, Slinger, Crucible, Anvilback, Hauler | Overseer |
| 4 | **Emberguard** (the legion's first real soldiers, chain) | Legionary, Javelin, Pyromancer, Bulwark, Houndmaster | Centurion |
| 5 | **Brasscoat** (veterans and officers, brass) | Praetor, Arbalest, Priest, Immolate, Flayer | Legate |
| 6 | **Ironmaw** (wardens the legion fears — iron riveted to the flesh) | Warden, Spitter, Voice, Bastion, Houndbrand | Overlord |

One culture seen at five ranks, met from the bottom of the hierarchy up. Planned L7+: the red dragon's cult; fire giants' forge; the vrock's pit (demons — a green-black, feathered, filthy palette break from the legion's iron); the efreeti's brass city.

### 4.6 Generic SRD roster (any biome)

Beyond the curated factions, the spawn tables also draw on a wide SRD bestiary for the overland and threshold biomes: giant vermin (fireflies, geckos, beetles, centipedes, mites, bats, cockroaches, blowflies, leeches, scorpions), deep elves (blademaster, knight, master archer, priest, mage, conjurer, sorcerer, demonologist), deep dwarves (artificer, berserker, death knight), gnoll hunters and sergeants, hobgoblins, bugbears, dire wolves, giant owls/eagles/elk, hippogriffs and griffons, flying swords, darkmantles, brain worms, imps, gargoyles, doppelgangers, winter wolves, fire crabs, death drakes, ankhegs, giant octopuses. These use the same sprite recipe; when in doubt, draw the SRD creature straight and *poor* (low CR = low armour budget).

### 4.7 Bosses

100 curated boss encounters. Bosses are drawn to the same recipe but **may be heroic in proportion, larger in frame, and richer in kit** than their mooks. The final-floor boss gets an in-engine cutscene, so a strong silhouette matters more than detail.

---

## 5. Player characters

### 5.1 Races (9)

Human, Hill Dwarf, High Elf, Lightfoot Halfling, Half-Orc, Dragonborn, Rock Gnome, Half-Elf, Tiefling.

Heroes are simple layered paper-doll figures — body, hair, beard, hat, cape, gear — so race is expressed through **skin tone, ear shape, horns (tiefling — anything from a devil to a marble statue), dragon ears/scales (dragonborn), orc skin and tusks (half-orc), and size** (halfling/gnome scaled down). If drawing a hero portrait rather than a sprite, keep to the same 16-bit pixel style and these race tells.

### 5.2 Classes (12) and their two subclasses

| Class | Colour | Armour / kit | Signature attack | Defining feature | Subclasses |
|---|---|---|---|---|---|
| **Fighter** | `#d9a441` gold | Chain mail, shield, martial weapons | Longsword | Second Wind | Champion / Banneret |
| **Barbarian** | `#e74c3c` red | Unarmoured, hide, greatsword | Greatsword | Rage | Berserker / Totem Warrior |
| **Paladin** | `#f1c40f` bright gold | Chain mail + shield, martial | Longsword | Divine Smite (radiant) | Oath of Devotion / Oath of Vengeance |
| **Ranger** | `#1abc9c` teal | Leather, longbow | Longbow | Favored Enemy; Beast Master gets a wolf companion | Hunter / Beast Master |
| **Rogue** | `#8f95a3` grey | Leather, shortbow, rapier/shortsword | Shortbow | Sneak Attack | Thief / Assassin |
| **Monk** | `#3498db` blue | Unarmoured, wraps | Unarmed Strike | Ki: Flurry of Blows, Stunning Strike | Open Hand / Way of Shadow |
| **Cleric** | `#5a8fe8` blue | Scale mail + shield, holy symbol | Sacred Flame (radiant) | Cure Wounds | Life Domain / War Domain |
| **Druid** | `#2ecc71` green | Leather + wooden shield, scimitar | Produce Flame | Wild Shape (bear, wolf) | Circle of the Land / Circle of the Moon |
| **Bard** | `#e8a8ff` lilac | Leather, rapier, instrument | Rapier | Bardic Inspiration | College of Lore / College of Valor |
| **Wizard** | `#9b6cf0` violet | Robes, no armour | Fire Bolt | Arcane school | Evoker / Abjurer |
| **Sorcerer** | `#e67e22` orange | Robes, no armour | Chill Touch | Tides of Chaos; Draconic Blood shows scales | Draconic Blood / Wild Magic |
| **Warlock** | `#9b59b6` purple | Leather, pact focus | Eldritch Blast (force beams) | Pact of the Fiend / Archfey | The Fiend / The Archfey |

Colours are the in-game class colours (used for HUD frames, initiative chips and class icons) — use them as the dominant hue for anything class-branded.

### 5.3 Spell VFX

Spell effects are drawn as the effect alone — **no caster in frame** — in the same 16-bit style. Fireball, Faerie Fire, Hold Person, Moonbeam, Shatter and Sleep exist already. Magic-school colour conventions: fire = orange/yellow with deep-red edge; cold = pale blue/white; radiant = gold/white; necrotic = green-black; force = magenta/violet; lightning = white-blue; poison = acid green; psychic = pink/purple.

---

## 6. Quick checklist for any generated image

1. 16-bit pixel art, bold dark outline, flat cel shading, limited palette.
2. One creature, full body, facing right, standing idle, plain background, no ground or shadow.
3. Scale stated relative to a human.
4. Finery scaled to rank — level-1 things look poor.
5. Biome palette rule respected.
6. Bosses may be bigger and heroic; mooks may not.
7. Icons: one centred glyph in two or three colours.
