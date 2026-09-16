# Stat blocks - the twelve overnight factions

Dungeon levels 2 to 6 across molten, frost, verdant and grim. **Nothing here is
wired into the game.** Numbers are fitted to the medians of the 518 monsters
already shipped, not to the 5e DMG table, because this game runs lower DPR than
the SRD - abilities and `attacksPerTurn` carry a lot of the threat.

| CR | ac | hp | atk | dmg |
|---|---|---|---|---|
| 1/4 | 13 | 13 | +4 | 5.5 |
| 1/2 | 12 | 16 | +4 | 5.5 |
| 1 | 14 | 28 | +4 | 7.5 |
| 2 | 13 | 39 | +5 | 9.0 |
| 3 | 14 | 52 | +6 | 10.0 |
| 4 | 14 | 75 | +6 | 10.0 |

Role shape on top of that row: **ranged** -1 ac and one hp die fewer; **caster**
lowest hp plus a `cantripClass` and control; **tank** +3 ac, one hp die more, -1
atk, one damage step down; **elite** two attacks or one genuinely nasty ability;
**boss** three abilities, always a cycle plus an on-hit or on-damaged plus an
on-bloodied.

**Creature type is a balance lever, not flavour.** `conditions.js` grants blanket
condition immunity by type and a statblock cannot opt back down: `plant` and
`construct` are immune to blinded, deafened, frightened, paralyzed, poisoned,
stunned and unconscious outright. That is deliberate for the Rimewrights and the
Old Growth - it is their whole identity - and deliberately avoided everywhere else.

---

## Cinderkin - molten level 2 - CR 1/4

**The hook.** Chip damage and crowd punishment. Individually trivial, and they all pop when they die, so the wrong answer is to stand in the middle of them swinging.

*type `fiend`; resist fire. Boss at CR 1.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Cinder Scamp** | 1/4 | 13 | 11 | +4 to hit, 1d6+2 (avg 6) | 35 ft | small |
| ranged | **Cinder Flinger** | 1/4 | 12 | 9 | +4 to hit, 1d6+1 (avg 4) | 30 ft | small |
| caster | **Cinder Witch** | 1/4 | 12 | 7 | +4 to hit, 1d8 (avg 4) | 30 ft | small |
| tank | **Cinder Lumper** | 1/4 | 15 | 16 | +3 to hit, 1d6+1 (avg 4) | 20 ft | small |
| elite | **Cinder Darter** | 1/4 | 14 | 9 | +5 to hit, 1d4+2 (avg 4) x2 | 45 ft | small |
| boss | **The Hearthmother** | 1 | 14 | 33 | +5 to hit, 1d8+3 (avg 8) | 20 ft | large |

**Cinder Scamp** (warrior)  
- *Cracked Through.* Its charcoal hide is split in a hundred places and something bright is behind every crack.
- **Ember Pop** (`onDeath`) - DC 10 DEX, half on save, 1d6 fire, AoE 1.6

**Cinder Flinger** (ranged)  
*ranged 7, fire*  
- *Scoop and Throw.* It carries its ammunition in its bare hands and does not appear to mind.
- **Ember Pop** (`onDeath`) - DC 10 DEX, half on save, 1d6 fire, AoE 1.6

**Cinder Witch** (caster)  
*ranged 7, fire; casts as sorcerer*  
- *Borrowed Heat.* It has no fire of its own. It takes a handful from the nearest fire and throws that.
- **Scald** (`cycle`) - every 4 rd, 2x only, DC 11 DEX, half on save, 1d8 fire, AoE 2.0

**Cinder Lumper** (tank)  
- *Slag-Caked.* Years of spatter have set into a shell over its back. It is not armour and it was not intended as armour.
- **Smother** (`onHit`) - DC 11 STR, prone 2r, 25% of hits

**Cinder Darter** (elite)  
*flying*  
- *Winged.* Membrane wings burned through in a dozen places. It flies anyway, badly and very fast.
- **Ember Pop** (`onDeath`) - DC 10 DEX, half on save, 1d6 fire, AoE 1.6

**The Hearthmother** (boss)  
- *They All Came Out Of Her.* Bloated, seamed and glowing. The scamps are hers and she is still making more.
- *Banked Fire.* She burns low and steady rather than bright. Cutting her open is how you get the bright part.
- **Belch of Coals** (`cycle`) - every 3 rd, DC 12 DEX, half on save, 2d6 fire, AoE 2.6
- **Hearth Heat** (`aura`) - every 4 rd, DC 12 CON, half on save, 1d6 fire, AoE 1.8
- **Spill the Brood** (`onBloodied`) - allies gain bloodlust

---

## Slagbound - molten level 3 - CR 1/2

**The hook.** Attrition that gets worse the longer it runs. Every one of them is burning to death already and gets hotter as it goes. Cold vulnerability is the stated counterplay.

*type `fiend`; resist fire; vulnerable cold. Boss at CR 1.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Slagbound Hauler** | 1/2 | 13 | 16 | +4 to hit, 1d8+2 (avg 6) | 30 ft | medium |
| ranged | **Ladle-Slinger** | 1/2 | 12 | 14 | +4 to hit, 1d6+2 (avg 6) | 30 ft | medium |
| caster | **Slagbound Stoker** | 1/2 | 12 | 11 | +4 to hit, 1d8 (avg 4) | 30 ft | medium |
| tank | **Slagbound Anvilback** | 1/2 | 16 | 22 | +3 to hit, 1d6+1 (avg 4) | 20 ft | medium |
| elite | **Slagbound Crucible** | 1/2 | 13 | 18 | +4 to hit, 1d8+2 (avg 6) | 25 ft | medium |
| boss | **The Slag Overseer** | 1 | 15 | 33 | +5 to hit, 2d6+2 (avg 9) | 30 ft | medium |

**Slagbound Hauler** (warrior)  
- *Still Chained.* The chain runs from a collar to nothing. Whatever it was fastened to is somewhere behind you.
- **Open Seam** (`onBloodied`) - allies gain bloodlust

**Ladle-Slinger** (ranged)  
*ranged 7, fire*  
- *Long Ladle.* A foundry ladle on a two-metre haft, used exactly as it was designed to be used, at people.
- **Splash** (`onHit`) - DC 11 DEX, half on save, 1d6 fire, 30% of hits

**Slagbound Stoker** (caster)  
*ranged 8, fire; casts as sorcerer*  
- *Furnace Chest.* Its ribcage stands open and there is a working furnace inside it. It feeds it while it walks.
- **Stoke** (`cycle`) - every 4 rd, allies gain bloodlust, AoE 2.4
- **Draw the Draught** (`cycle`) - every 5 rd, 2x only, DC 12 CON, blinded 6r, AoE 2.0

**Slagbound Anvilback** (tank)  
- *An Anvil Is Bolted To It.* Nobody removed it and it has stopped trying to remove it itself.
- **Anvil Drop** (`onHit`) - DC 12 STR, prone 2r, 30% of hits

**Slagbound Crucible** (elite)  
- *Already Burst.* The crucible it carried split open some time ago. It kept walking and the contents are still in it.
- **Runoff** (`aura`) - every 4 rd, DC 11 DEX, half on save, 1d4 fire, AoE 1.6
- **Boil Over** (`onDeath`) - DC 12 DEX, half on save, 2d6 fire, AoE 2.2

**The Slag Overseer** (boss)  
- *Holds the Other End.* Every chain in the room runs back to its fist.
- *Not One Of Them.* It is not burning. It is the only thing down here that is not.
- **Crack the Chain** (`cycle`) - every 3 rd, DC 13 DEX, restrained 3r, save ends, AoE 2.4
- **Back to Work** (`cycle`) - every 5 rd, allies gain bloodlust, AoE 3.0
- **Drive Them Forward** (`onBloodied`) - allies gain hasted, AoE 3.0

---

## Emberguard - molten level 4 - CR 1

**The hook.** The first tier that fights as a unit - pack tactics, a shield line and a Houndmaster who makes everything near him better. Break the formation, not the soldiers.

*type `fiend`; resist fire. Boss at CR 2.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Emberguard Legionary** | 1 | 15 | 28 | +4 to hit, 1d8+3 (avg 8) | 30 ft | medium |
| ranged | **Emberguard Javelin** | 1 | 14 | 22 | +5 to hit, 1d8+3 (avg 8) | 30 ft | medium |
| caster | **Emberguard Pyromancer** | 1 | 13 | 18 | +4 to hit, 1d10 (avg 6) | 30 ft | medium |
| tank | **Emberguard Bulwark** | 1 | 18 | 33 | +4 to hit, 1d8+2 (avg 6) | 20 ft | medium |
| elite | **Emberguard Houndmaster** | 1 | 15 | 28 | +5 to hit, 1d8+3 (avg 8) x2 | 35 ft | medium |
| boss | **The Emberguard Centurion** | 2 | 17 | 46 | +5 to hit, 2d6+3 (avg 10) x2 | 30 ft | medium |

**Emberguard Legionary** (warrior)  
*pack tactics*  
- *Drilled.* It has been taught to fight beside somebody, and it is noticeably worse alone.

**Emberguard Javelin** (ranged)  
*ranged 8, fire*  
- *Heated Points.* The javelins ride in a rack of coals on its back and come out white at the tip.
- **Sear** (`onHit`) - DC 12 CON, weakenedDmg 6r, 30% of hits

**Emberguard Pyromancer** (caster)  
*ranged 9, fire; casts as wizard*  
- *Legion Fire.* Not a gift and not a bloodline. It was trained, out of a book, by the legion.
- **Wall of Coals** (`cycle`) - every 4 rd, DC 13 DEX, half on save, 2d6 fire, AoE 2.6
- **Kindle** (`cycle`) - every 5 rd, 2x only, allies gain bloodlust, AoE 2.6

**Emberguard Bulwark** (tank)  
- *The Line.* A tower shield of blackened iron with a firing slit. Where it stands, the corridor is that wide.
- **Shield Drive** (`onHit`) - DC 13 STR, prone 2r, 30% of hits

**Emberguard Houndmaster** (elite)  
*pack tactics*  
- *Two Chains, One Hand.* The hounds are not in the sprite. They are implied by how much slack he keeps.
- **Set On** (`cycle`) - every 4 rd, allies gain hasted, AoE 2.6

**The Emberguard Centurion** (boss)  
- *Transverse Crest.* Iron, not horsehair, and set across rather than along. You can tell which one he is from anywhere in the room.
- *Holds the Line Himself.* He has never ordered a withdrawal and is not equipped to.
- **Close Ranks** (`cycle`) - every 4 rd, allies gain blessed, AoE 3.2
- **Brand** (`onHit`) - DC 13 CON, half on save, 1d10 fire, 30% of hits
- **No Step Back** (`onBloodied`) - allies gain bloodlust, AoE 3.2

---

## Brasscoat - molten level 5 - CR 2

**The hook.** Officers. Every one of them makes the others harder to kill, so the target-priority question finally has a real answer. First tier with outright fire immunity.

*type `fiend`; immune fire. Boss at CR 3.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Brasscoat Praetor** | 2 | 17 | 38 | +5 to hit, 2d6+3 (avg 10) | 30 ft | medium |
| ranged | **Brasscoat Arbalest** | 2 | 15 | 32 | +6 to hit, 2d6+3 (avg 10) | 25 ft | medium |
| caster | **Brasscoat Priest** | 2 | 15 | 33 | +5 to hit, 1d10+2 (avg 8) | 30 ft | medium |
| tank | **Brasscoat Immolate** | 2 | 19 | 44 | +4 to hit, 1d10+2 (avg 8) | 20 ft | medium |
| elite | **Brasscoat Flayer** | 2 | 16 | 38 | +6 to hit, 1d10+3 (avg 8) x2 | 35 ft | medium |
| boss | **The Brasscoat Legate** | 3 | 18 | 52 | +6 to hit, 2d8+4 (avg 13) x2 | 30 ft | medium |

**Brasscoat Praetor** (warrior)  
*pack tactics*  
- *Brass Is Rank.* The plate underneath is the same blackened iron the legionaries wear. The brass on top of it is the promotion.
- **Run Through** (`onHit`) - DC 13 CON, wounded 8r, 25% of hits

**Brasscoat Arbalest** (ranged)  
*ranged 10, piercing*  
- *Windlass.* A siege crossbow braced against the hip. It fires rarely and it does not miss twice.
- **Pin** (`onHit`) - DC 14 STR, restrained 3r, save ends, 30% of hits

**Brasscoat Priest** (caster)  
*ranged 9, fire; casts as cleric*  
- *Keeps the Furnace.* There is a god down here and it is the foundry itself. He is its clergy and he is not being metaphorical.
- **Stoke the Faithful** (`cycle`) - every 4 rd, heal 13, AoE 2.6
- **Consecrate in Heat** (`cycle`) - every 5 rd, 2x only, DC 14 WIS, frightened 8r, AoE 2.8

**Brasscoat Immolate** (tank)  
- *Sealed In.* A brass furnace-suit with no visor and no seam. Whatever agreed to be sealed inside it does not come out.
- **Radiant Heat** (`aura`) - every 3 rd, DC 13 CON, half on save, 1d8 fire, AoE 1.8

**Brasscoat Flayer** (elite)  
- *Barbed Chain.* Three metres of it, kept moving. The brass links are hot from friction alone.
- **Hook and Draw** (`onHit`) - DC 14 STR, prone 2r, 35% of hits

**The Brasscoat Legate** (boss)  
- *Brass To The Throat.* Full brass over full iron. Nothing about the silhouette is subtle and nothing about it is decorative.
- *Speaks For The Legion.* Everything below CR 3 in this dungeon is technically his correspondence.
- **Legion, Advance** (`cycle`) - every 4 rd, allies gain hasted, AoE 3.4
- **Brand of Office** (`cycle`) - every 3 rd, DC 15 DEX, half on save, 3d6 fire, AoE 2.8
- **Hold the Foundry** (`onBloodied`) - allies gain bloodlust, AoE 3.4

---

## Ironmaw - molten level 6 - CR 3

**The hook.** Retaliation. Iron riveted through their own hides, and every one of them answers being hit. The first faction where the question is whether you can afford to keep attacking it.

*type `fiend`; immune fire. Boss at CR 4.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Ironmaw Warden** | 3 | 17 | 52 | +6 to hit, 2d8+4 (avg 13) | 30 ft | large |
| ranged | **Ironmaw Spitter** | 3 | 16 | 44 | +6 to hit, 2d8+4 (avg 13) | 25 ft | large |
| caster | **The Ironmaw Voice** | 3 | 15 | 46 | +6 to hit, 2d6+3 (avg 10) | 30 ft | large |
| tank | **Ironmaw Bastion** | 3 | 20 | 65 | +5 to hit, 2d6+3 (avg 10) | 15 ft | large |
| elite | **Houndbrand** | 3 | 16 | 52 | +7 to hit, 2d6+4 (avg 11) x2 | 45 ft | large |
| boss | **The Ironmaw Overlord** | 4 | 19 | 75 | +7 to hit, 2d10+4 (avg 15) x2 | 30 ft | huge |

**Ironmaw Warden** (warrior)  
- *Riveted Through.* The plates are not strapped on. They are nailed into the meat and the meat has grown around them.
- **Backdraft** (`onDamaged`) - DC 14 DEX, half on save, 1d10 fire, 30% of hits

**Ironmaw Spitter** (ranged)  
*ranged 10, fire*  
- *Spits It.* No weapon. It has been holding that in its mouth since before you arrived.
- **Clinging Slag** (`onHit`) - DC 14 DEX, slowed 8r, 35% of hits

**The Ironmaw Voice** (caster)  
*ranged 10, fire; casts as warlock*  
- *Mouth Riveted Shut.* It speaks anyway, and the seams glow when it does.
- **Unmake** (`cycle`) - every 4 rd, DC 15 CON, corroded 10r, AoE 2.6
- **The Order** (`cycle`) - every 5 rd, 2x only, DC 15 WIS, frightened 8r, AoE 3.0

**Ironmaw Bastion** (tank)  
- *A Door With Legs.* It was a gate once. Somebody put a fiend behind it and welded the two together.
- **Backdraft** (`onDamaged`) - DC 15 DEX, half on save, 2d6 fire, 35% of hits

**Houndbrand** (elite)  
- *Muzzled For A Reason.* Horse-sized. The muzzle is iron and it is glowing, which means it has been trying.
- **Run Down** (`onHit`) - DC 15 STR, prone 2r, 35% of hits

**The Ironmaw Overlord** (boss)  
- *What The Legion Is Frightened Of.* Brasscoat outranks Ironmaw on paper. Nobody has ever tried to enforce that.
- *Heat In Every Seam.* Where the iron meets the hide there is a line of white, and it widens as the fight goes on.
- **Furnace Breath** (`cycle`) - every 3 rd, DC 16 DEX, half on save, 4d6 fire, AoE 3.0
- **Answer in Kind** (`onDamaged`) - DC 16 DEX, half on save, 2d8 fire, 40% of hits
- **Open the Seams** (`onBloodied`) - allies gain raging

---

## Hollowkin - frost level 3 - CR 1/2

**The hook.** They snowball. Every one of them heals and speeds up when something dies, so a downed ally is what turns a manageable fight into a bad one. Squat ice-troll drudges in scavenged scrap.

*type `giant`; resist cold. Boss at CR 1.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Hollowkin Drudge** | 1/2 | 13 | 16 | +4 to hit, 1d8+2 (avg 6) | 30 ft | medium |
| ranged | **Hollowkin Slinger** | 1/2 | 12 | 14 | +4 to hit, 1d6+2 (avg 6) | 30 ft | medium |
| caster | **Hollowkin Rimespeak** | 1/2 | 12 | 11 | +4 to hit, 1d8 (avg 4) | 30 ft | medium |
| tank | **Hollowkin Doorstop** | 1/2 | 16 | 22 | +3 to hit, 1d6+1 (avg 4) | 20 ft | medium |
| elite | **Hollowkin Gnasher** | 1/2 | 13 | 14 | +5 to hit, 1d6+3 (avg 6) x2 | 40 ft | medium |
| boss | **The Hollowkin Overseer** | 1 | 15 | 33 | +5 to hit, 2d6+2 (avg 9) | 30 ft | large |

**Hollowkin Drudge** (warrior)  
- *Scavenged.* Everything it wears came off something else, and none of it was measured for it.
- **Feed** (`onKill`) - heal 6

**Hollowkin Slinger** (ranged)  
*ranged 7, bludgeoning*  
- *Rock In A Sock.* A leather sling loaded with whatever the floor of the hold provided.
- **Crack** (`onHit`) - DC 11 CON, slowed 6r, 25% of hits

**Hollowkin Rimespeak** (caster)  
*ranged 8, cold; casts as druid*  
- *Half-Remembered.* It is repeating something it heard a real caster say, and about a third of it works.
- **Freeze Fast** (`cycle`) - every 4 rd, DC 12 CON, half on save, 1d8 cold, slowed 6r, AoE 2.2
- **Hunger Cry** (`cycle`) - every 5 rd, 2x only, allies gain bloodlust, AoE 2.6

**Hollowkin Doorstop** (tank)  
- *That Is A Door.* It is not a shield. It is a door, still on its hinges, torn off something that needed one.
- **Wedge** (`onHit`) - DC 12 STR, prone 2r, 30% of hits

**Hollowkin Gnasher** (elite)  
- *Starved.* Ribs out, jaw overgrown. The hold feeds the useful ones first and it has never been useful.
- **Feed** (`onKill`) - allies gain bloodlust, heal 11

**The Hollowkin Overseer** (boss)  
- *Has The Keys.* A ring of them at the belt, most for doors that no longer exist. It is the only one of them the hold speaks to.
- *Fed First.* Half again the size of the others and the only reason for that is priority.
- **Drive Them** (`cycle`) - every 4 rd, allies gain hasted, AoE 3.0
- **Hoarfrost Swipe** (`cycle`) - every 3 rd, DC 12 DEX, half on save, 2d6 cold, AoE 2.4
- **Eat the Fallen** (`onKill`) - allies gain bloodlust, heal 16

---

## Rimewrights - frost level 4 - CR 1

**The hook.** Nothing you say to them lands. `construct` type means blanket immunity to blinded, deafened, frightened, paralyzed, poisoned, stunned and unconscious - the control-heavy party's tools all go dead for one dungeon level and they have to kill things instead.

*type `construct`; resist cold. Boss at CR 2.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Rimewright Glassblade** | 1 | 16 | 28 | +5 to hit, 1d8+3 (avg 8) | 40 ft | medium |
| caster | **Rimewright Monolith** | 1 | 15 | 22 | +4 to hit, 1d10 (avg 6) | 0 ft | large |
| tank | **Rimewright Hoarplate** | 1 | 18 | 33 | +4 to hit, 1d8+2 (avg 6) | 20 ft | medium |
| elite | **Rimewright Lash** | 1 | 15 | 28 | +6 to hit, 1d10+3 (avg 8) | 50 ft | medium |
| boss | **The Wintersmith** | 2 | 17 | 46 | +5 to hit, 2d6+3 (avg 10) x2 | 15 ft | large |

**Rimewright Glassblade** (warrior)  
- *Blades Are Its Arms.* They taper out of the elbow. When one shatters it grows a shorter one.
- *Made In Its Maker's Image.* The Wintersmith built this one back when it was still copying people. It has not made that mistake since.
- **Cold Edge** (`onHit`) - DC 12 CON, half on save, 1d6 cold, 30% of hits

**Rimewright Monolith** (caster)  
*ranged 10, cold; casts as artificer*  
- *Weather Inside It.* A rough opening is cut clean through it, and a small complete blizzard is turning in the gap.
- *It Does Not Come To You.* Speed 0. It was planted where it stands and it fights from there or not at all.
- **Squall** (`cycle`) - every 3 rd, DC 13 DEX, half on save, 2d6 cold, AoE 2.8
- **Whiteout** (`cycle`) - every 5 rd, 2x only, DC 13 WIS, blinded 6r, AoE 2.4

**Rimewright Hoarplate** (tank)  
- *Built As A Wall.* It has no weapon and no offensive function in its design. What it does to you is incidental to standing there.
- *No Morale To Break.* It does not check whether the fight is going well. Nothing in it is capable of the question.
- **Glacial Press** (`onHit`) - DC 13 STR, restrained 3r, save ends, 30% of hits

**Rimewright Lash** (elite)  
- *No Legs, No Waiting.* Twelve tapering segments ringed with backward-swept spines. It is the fastest thing on the level.
- *Blunt Wedge, No Jaw.* There is nothing at the front of it that looks like a head, and it does not need one to reach you.
- **Coil** (`onHit`) - DC 13 STR, restrained 3r, save ends, 35% of hits

**The Wintersmith** (boss)  
- *It Is A Workshop, Not A Person.* A mass of ice with six working arms, each ending in a chisel or a hammer head rather than a hand. Every Rimewright in the hold came off those arms.
- *Unfinished Work.* There is something half-made in the hollow at the front of it. It will not be finished now.
- **Raise a Wright** (`cycle`) - every 5 rd, 2x only, allies gain blessed, AoE 3.2
- **Deep Cold** (`cycle`) - every 3 rd, DC 14 CON, half on save, 3d6 cold, slowed 8r, AoE 2.8
- **Reforge** (`onBloodied`) - heal 26

---

## Huscarls - frost level 5 - CR 2

**The hook.** Positioning. The harpooner pulls you out of your line, the shieldwall stops you leaving, and the berserker gets to whoever you were protecting. Proper giant-kin soldiers, half again a man's height.

*type `giant`; resist cold. Boss at CR 3.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Huscarl Axeman** | 2 | 16 | 38 | +5 to hit, 2d8+3 (avg 12) | 30 ft | large |
| ranged | **Huscarl Harpooner** | 2 | 15 | 32 | +6 to hit, 2d6+3 (avg 10) | 30 ft | large |
| caster | **Huscarl Stormspeak** | 2 | 15 | 33 | +5 to hit, 1d10+2 (avg 8) | 30 ft | large |
| tank | **Huscarl Shieldwall** | 2 | 19 | 44 | +4 to hit, 1d10+2 (avg 8) | 20 ft | large |
| elite | **Huscarl Berserker** | 2 | 14 | 44 | +6 to hit, 2d8+4 (avg 13) x2 | 40 ft | large |
| boss | **The Thegn** | 3 | 18 | 52 | +6 to hit, 2d10+4 (avg 15) x2 | 30 ft | large |

**Huscarl Axeman** (warrior)  
- *Two Hands, No Shield.* The trade is deliberate. The shieldwall behind him is the shield.
- **Cleave** (`onHit`) - DC 14 CON, wounded 8r, 25% of hits

**Huscarl Harpooner** (ranged)  
*ranged 9, piercing*  
- *Chained To Him.* The harpoon is not thrown away. It is thrown and then reeled, and so is whatever it went into.
- **Reel In** (`onHit`) - DC 14 STR, restrained 3r, save ends, 40% of hits

**Huscarl Stormspeak** (caster)  
*ranged 10, cold; casts as druid*  
- *Weather As A Weapon.* Not a priest. A specialist, the way the harpooner is a specialist.
- **Hailfall** (`cycle`) - every 3 rd, DC 14 DEX, half on save, 3d6 cold, AoE 3.0
- **Bitter Wind** (`cycle`) - every 5 rd, 2x only, DC 14 STR, prone 2r, AoE 3.0

**Huscarl Shieldwall** (tank)  
- *Overlaps.* The shields are cut to interlock with the next one along. One of them is a wall; two of them is a decision about where the fight happens.
- **Hold Fast** (`onHit`) - DC 14 STR, restrained 2r, save ends, 35% of hits

**Huscarl Berserker** (elite)  
- *Went Through The Line.* Not around it. The hold's own shieldwall opens for him and closes behind him.
- **Fury** (`onBloodied`) - allies gain raging

**The Thegn** (boss)  
- *Sworn, Not Hired.* The huscarls are the Jarl's household. This one is the household's.
- *Ring-Giver.* The arm rings are payment already made, to men who are standing beside him.
- **Form the Wall** (`cycle`) - every 4 rd, allies gain blessed, AoE 3.4
- **Sweeping Axe** (`cycle`) - every 3 rd, DC 15 DEX, half on save, 3d8 slashing, AoE 2.6
- **The Oath Holds** (`onBloodied`) - allies gain bloodlust, AoE 3.4

---

## JarlsCourt - frost level 6 - CR 3

**The hook.** Area denial. Frost giants proper, twice a man's height, and every one of them takes a piece of the room away from you. The hold's owners, met last.

*type `giant`; immune cold. Boss at CR 4.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Court Iceward** | 3 | 17 | 52 | +6 to hit, 2d10+4 (avg 15) | 30 ft | huge |
| ranged | **Court Stonecaster** | 3 | 16 | 44 | +6 to hit, 2d10+4 (avg 15) | 25 ft | huge |
| caster | **Court Wintersinger** | 3 | 15 | 46 | +6 to hit, 2d6+3 (avg 10) | 30 ft | huge |
| tank | **Court Glacierback** | 3 | 20 | 65 | +5 to hit, 2d8+3 (avg 12) | 15 ft | huge |
| elite | **Wyrmhound** | 3 | 17 | 52 | +7 to hit, 2d8+4 (avg 13) x2 | 50 ft | large |
| boss | **The Jarl** | 4 | 19 | 75 | +7 to hit, 3d8+4 (avg 18) x2 | 30 ft | huge |

**Court Iceward** (warrior)  
- *Twice Your Height.* The reach alone changes where you are allowed to stand.
- **Frost Blade** (`onHit`) - DC 15 CON, slowed 8r, 30% of hits

**Court Stonecaster** (ranged)  
*ranged 11, bludgeoning*  
- *Throws Masonry.* It is not carrying ammunition. It is disassembling the room and the room is the hold.
- **Crushing Throw** (`onHit`) - DC 15 STR, prone 2r, 35% of hits

**Court Wintersinger** (caster)  
*ranged 11, cold; casts as cleric*  
- *Sings The Weather In.* The hold has no roof over this chamber. That was a choice and she is the reason it works.
- **Killing Cold** (`cycle`) - every 3 rd, DC 16 CON, half on save, 4d6 cold, AoE 3.2
- **The Long Dark** (`cycle`) - every 5 rd, 2x only, DC 16 WIS, frightened 10r, AoE 3.2

**Court Glacierback** (tank)  
- *Carries The Cold On Him.* A shelf of blue ice grown over both shoulders, thick enough that it is load-bearing.
- **Avalanche** (`onHit`) - DC 16 STR, prone 3r, 35% of hits

**Wyrmhound** (elite)  
- *Iron-Armoured.* Barded like a warhorse, kept like a dog, and the size of neither.
- **Drag Down** (`onHit`) - DC 15 STR, prone 2r, 35% of hits

**The Jarl** (boss)  
- *The Hold Is His.* Every tier of this dungeon has been his household staff. This is the household.
- *Does Not Rise At First.* He is seated when you come in, and stays seated for as long as that is credible.
- **Winter Comes In** (`cycle`) - every 3 rd, DC 17 CON, half on save, 4d8 cold, slowed 8r, AoE 3.4
- **Shatter the Floor** (`cycle`) - every 4 rd, DC 17 DEX, prone 3r, AoE 3.4
- **Stand Up** (`onBloodied`) - allies gain giantStrength

---

## BlackbogCoven - verdant level 5 - CR 2

**The hook.** Curses rather than damage. Every one of them is a save-or-suffer, and their hp is a tier low to pay for it. Green hags who wear no armour and carry hoarded human jewellery instead, which reads as older and worse than kit.

*type `fey`; resist poison. Boss at CR 3.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Blackbog Crone** | 2 | 15 | 33 | +5 to hit, 2d6+3 (avg 10) | 30 ft | medium |
| ranged | **Blackbog Hexspitter** | 2 | 14 | 27 | +6 to hit, 2d6+3 (avg 10) | 30 ft | medium |
| caster | **Blackbog Greenmother** | 2 | 14 | 28 | +5 to hit, 1d10+2 (avg 8) | 30 ft | medium |
| tank | **The Swollen** | 2 | 15 | 50 | +4 to hit, 1d10+2 (avg 8) | 15 ft | large |
| elite | **Blackbog Stitchling** | 2 | 16 | 38 | +6 to hit, 2d6+4 (avg 11) x2 | 35 ft | medium |
| boss | **The Blackbog Grandmother** | 3 | 16 | 52 | +6 to hit, 2d8+4 (avg 13) | 25 ft | large |

**Blackbog Crone** (warrior)  
- *Nails, Not Weapons.* She has never held a sword and does not need to start.
- **Rot Touch** (`onHit`) - DC 14 CON, weakenedDmg 10r, 35% of hits

**Blackbog Hexspitter** (ranged)  
*ranged 9, poison*  
- *Spits It.* Whatever she has been chewing, she has been chewing since before you got here.
- **Blinding Bile** (`onHit`) - DC 14 CON, blinded 6r, 30% of hits

**Blackbog Greenmother** (caster)  
*ranged 10, poison; casts as warlock*  
- *Speaks To It First.* She asks the bog for things and the bog has never once refused her.
- **Sweet Word** (`cycle`) - every 4 rd, DC 15 WIS, charmed 6r
- **Bog Hands** (`cycle`) - every 3 rd, DC 14 STR, restrained 3r, save ends, AoE 2.8

**The Swollen** (tank)  
- *Hugely Bloated.* No armour. There is simply a great deal of her and it is all in the way.
- *Does Not Chase.* She has not moved out of this room in a long time and does not intend to.
- **Swallow Whole** (`onHit`) - DC 15 STR, restrained 4r, save ends, 30% of hits

**Blackbog Stitchling** (elite)  
- *Sewn Together.* It is a servant in the sense that it was assembled to be one, out of the parts of people who were not asked.
- **Unravel** (`onDeath`) - DC 14 WIS, frightened 8r, AoE 2.4

**The Blackbog Grandmother** (boss)  
- *Breastplate Of Rings.* Stolen gold wedding rings, hundreds of them, wired into a plate. She can tell you about any one of them.
- *The Oldest Thing In The Bog.* The others are hers in the way the bog is hers, which is to say completely.
- **The Old Curse** (`cycle`) - every 4 rd, DC 16 WIS, hexMarked 12r
- **Drowning Word** (`cycle`) - every 3 rd, DC 16 CON, half on save, 3d8 poison, AoE 3.0
- **She Calls Them Back** (`onBloodied`) - allies gain bloodlust, AoE 3.4

---

## OldGrowth - verdant level 6 - CR 3

**The hook.** A pure stat check, and the only one in the game. `plant` type grants blanket immunity to blinded, deafened, frightened, paralyzed, poisoned, stunned and unconscious - nothing the party says lands. Huge hp, slow, heavy hits, and fire vulnerability as the single stated answer.

*type `plant`; resist piercing; vulnerable fire. Boss at CR 4.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Old Growth Sapling** | 3 | 16 | 58 | +6 to hit, 2d8+4 (avg 13) | 25 ft | large |
| ranged | **Old Growth Thornlobber** | 3 | 15 | 50 | +6 to hit, 2d8+4 (avg 13) | 20 ft | large |
| caster | **Old Growth Heartwood** | 3 | 15 | 52 | +6 to hit, 2d6+3 (avg 10) | 20 ft | large |
| tank | **Old Growth Bulwark** | 3 | 19 | 78 | +5 to hit, 2d6+3 (avg 10) | 10 ft | huge |
| elite | **Old Growth Stalker** | 3 | 16 | 52 | +7 to hit, 2d8+5 (avg 14) x2 | 45 ft | huge |
| boss | **The Elder** | 4 | 18 | 90 | +7 to hit, 3d8+5 (avg 18) | 15 ft | huge |

**Old Growth Sapling** (warrior)  
- *Young.* Only three metres. It is the smallest thing in this dungeon and it is still twice your height.
- **Root Catch** (`onHit`) - DC 15 STR, restrained 3r, save ends, 30% of hits

**Old Growth Thornlobber** (ranged)  
*ranged 10, piercing*  
- *Grows Them, Then Throws Them.* Seed pods the size of a fist, thrown hard enough to bury.
- **Splinter** (`onHit`) - DC 15 CON, wounded 10r, 30% of hits

**Old Growth Heartwood** (caster)  
*ranged 10, force; casts as druid*  
- *The Wood Remembers.* It does not cast so much as ask, and the whole forest answers at once.
- **The Floor Objects** (`cycle`) - every 3 rd, DC 16 DEX, half on save, 3d8 bludgeoning, restrained 2r, save ends, AoE 3.0
- **Greenmend** (`cycle`) - every 5 rd, heal 20, AoE 3.0

**Old Growth Bulwark** (tank)  
- *Shaped Like A Stump.* Wider than it is tall. It was cut down a long time ago and disagreed.
- *Barely Moves.* Speed 10 ft. Going around it is always an option and it has never minded.
- **Crush** (`onHit`) - DC 16 STR, prone 3r, 35% of hits

**Old Growth Stalker** (elite)  
- *Spindly And Black-Barked.* Too tall, too thin, too fast, and it holds still when you look directly at it.
- **Long Reach** (`onHit`) - DC 16 STR, restrained 3r, save ends, 30% of hits

**The Elder** (boss)  
- *Three Times A Man's Height.* The room was not built to hold it. It got in by being here first.
- *Slow To Decide.* It has been considering this for eleven years and has now finished.
- **The Grove Closes** (`cycle`) - every 3 rd, DC 17 STR, restrained 4r, save ends, AoE 3.4
- **Fell Swing** (`cycle`) - every 4 rd, DC 17 DEX, half on save, 4d8 bludgeoning, AoE 3.0
- **Deep Roots** (`onBloodied`) - heal 32

---

## Cerement - grim level 6 - CR 3

**The hook.** They only fight as a set. The Lector's aura is load-bearing for the whole encounter and killing it first is the intended read - which is the exact inversion of the Unrelieved at tier 5, who fight as individuals because they were never a unit.

*type `undead`; resist necrotic; vulnerable radiant. Boss at CR 4.*

| role | creature | CR | AC | HP | attack | speed | size |
|---|---|---|---|---|---|---|---|
| warrior | **Cerement Bearer** | 3 | 17 | 52 | +6 to hit, 2d8+4 (avg 13) | 30 ft | medium |
| ranged | **Cerement Archer** | 3 | 16 | 44 | +6 to hit, 2d8+4 (avg 13) | 30 ft | medium |
| caster | **Cerement Lector** | 3 | 15 | 46 | +6 to hit, 2d6+3 (avg 10) | 30 ft | medium |
| tank | **Cerement Shieldbearer** | 3 | 20 | 65 | +5 to hit, 2d6+3 (avg 10) | 20 ft | medium |
| elite | **The Unwound** | 3 | 15 | 58 | +7 to hit, 2d8+5 (avg 14) x2 | 40 ft | medium |
| boss | **The Cerement Guardian** | 4 | 19 | 75 | +7 to hit, 3d8+4 (avg 18) | 30 ft | large |

**Cerement Bearer** (warrior)  
- *Matched.* Pale linen, black resin, gold leaf and lapis - identical on every one of them, because the same hands wrapped them on the same day.
- **Grave Chill** (`onHit`) - DC 15 CON, drained 10r, 30% of hits

**Cerement Archer** (ranged)  
*ranged 10, necrotic*  
- *Counted Arrows.* Forty in the quiver, forty when the chamber was sealed, and it has not needed to spend one until now.
- **Marked Shaft** (`onHit`) - DC 15 WIS, hexMarked 10r, 30% of hits

**Cerement Lector** (caster)  
*ranged 10, necrotic; casts as cleric*  
- *Reads The Rite Aloud.* It has been reading since the chamber was closed. Stopping it is how the rest of them stop.
- **The Rite Continues** (`aura`) - every 4 rd, allies gain blessed, AoE 3.2
- **Hollowing Verse** (`cycle`) - every 3 rd, DC 16 CON, half on save, 3d8 necrotic, drained 8r, AoE 3.0

**Cerement Shieldbearer** (tank)  
- *Gilded Tower Shield.* Gold over cedar, uncorroded. Nothing in this chamber has weathered, which is what tells you it was sealed properly.
- **Interpose** (`onHit`) - DC 16 STR, prone 2r, 35% of hits

**The Unwound** (elite)  
- *Botched Rites.* The only one of them that does not match. The wrappings came loose during the rite and were never corrected.
- *Wrong And Knows It.* It moves faster than the others and none of them look at it.
- **Clawing Linen** (`onHit`) - DC 15 STR, restrained 3r, save ends, 35% of hits

**The Cerement Guardian** (boss)  
- *What The Chamber Was Built To House.* Every other body in here was interred to accompany this one.
- *Gold Mask, No Face Behind It.* The mask is a portrait. There is nothing under it that the portrait was taken from.
- **The Seal Breaks** (`cycle`) - every 3 rd, DC 17 CON, half on save, 4d8 necrotic, drained 10r, AoE 3.2
- **Stillness** (`cycle`) - every 5 rd, 2x only, DC 17 WIS, paralyzed 4r, AoE 2.6
- **The Rite Was For This** (`onBloodied`) - allies gain bloodlust, heal 30

---
