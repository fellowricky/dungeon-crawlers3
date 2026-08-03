# Story Mode — 20 Chapter Arc

Design doc. Themes/enemy families constrained to `DUNGEON_MONSTER_MAP` (src/game/srd.js:542).
Challenge DSL per `CHALLENGES` (src/game/skills.js). Zones: `entrance` | `boss` | `shrine` |
`treasure` | `combat` | `combat:N`. Rewards: `gold` `item` `potion` `shortcut` `buffEffect` `tempHp`.
Fail effects: `damage` `alert` `debuff` `poison` `frighten` `curse`.

## The spine

Monsters aren't invading — they're fleeing. Something in the deep is pushing everything up.
The old kingdoms bound it, and the binding is fed by adventurers: every company that signs a
charter and dies in the dark pays into a seal nobody disclosed. The Charter the party signs in
Ch1 is a sacrificial contract with good marketing. The crowns look inward because the frontier
is the furnace.

The idle loop is the theme: grinding forever *is the point*, and someone is collecting.

---

## ACT I — THE FRONTIER (1–5)
Small jobs, wrong details. Bright greens giving way to the first stone.

### Ch1 — Embers over Greenrise *(exists)*
- **Map:** `forest` / overland Warcamp · **Enemies:** Goblinoid, Beasts, Vermin
- Existing challenges stand: Snare Line, Defaced Waystone, Palisade Gate.
- **Add one planted detail:** the Goblin King's armor is scavenged from far deeper stone than
  any goblin should reach. Nobody comments on it yet.

### Ch2 — What the Herds Fled
- **Map:** `forest` → Sinkhole · **Enemies:** Beasts, Vermin (goblins conspicuously *absent*)
- **`combat`** — *Drag Marks*: `survival` read the trail / `perception` count the tracks /
  `investigation` reconstruct the panic. Reward `shortcut`. Win text reveals: the herd wasn't
  driven, it *stampeded*, and the goblins ran alongside it.
- **`treasure`** — *The Abandoned Camp*: `sleightOfHand` loot fast / `nature` salvage supplies /
  `athletics` haul the whole cache, fail `damage`. Reward `potion`.
- **`boss`** — *Down the Throat*: `athletics` rope descent / `acrobatics` free-climb, fail
  `damage` / `perception` find the safe ledge. Reward `tempHp`.

### Ch3 — The Empty Watchtower
- **Map:** `ancient` / Ruins · **Enemies:** Goblinoid, Undead, Vermin
- First undead. First stone that predates the kingdom. Stairs under a tower that has no cellar.
- **`entrance`** — *The Unbarred Door*: `investigation` read the duty roster /
  `perception` count the beds / `insight` (see gaps note) — the garrison left *willingly*.
  Reward `buffEffect: inspired`.
- **`combat:2`** — *The Wrong Stair*: `arcana` the masonry isn't local /
  `history` name the builders / `athletics` force the collapsed landing, fail `damage`.
  Reward `shortcut`.
- **`shrine`** — *Garrison Shrine, Still Lit*: `religion` finish their unfinished rite /
  `perception` find what they left as payment / `medicine` read the bloodless bodies.
  Reward `buffEffect`.

### Ch4 — Charter and Seal
- **Map:** `ancient` / Sanctum — Guild proving-vault, *not* a real dungeon crawl in tone.
  Warm, ceremonial, well-lit. Enemies are the Guild's caged training stock.
- **Enemies:** Goblinoid, Vermin (deliberately trivial — this chapter is a party, not a fight)
- **`entrance`** — *The Signing*: `persuasion` negotiate terms / `investigation` actually read
  the clause (the ONE way to see the seal-language early — reward `item`, a copy of the
  contract) / `intimidation` demand more coin. This is the arc's key optional foreshadow.
- **`shrine`** — *The Long Roll*: `history` find your predecessors' names / `religion` observe
  the memorial rite. Reward `buffEffect`.

### Ch5 — The Vault at Marrowfen — **ACT BREAK**
- **Map:** `grim` / Crypt · **Enemies:** Undead, Fiendish
- Guild-assigned retrieval. Forbidden to open the relic. It's a ledger. Your name is in it.
- **`combat`** — *The Fen Road*: `survival` cross the bog / `nature` read safe footing /
  `athletics` wade it, fail `poison`. Reward `gold`.
- **`treasure`** — *The Sealed Case*: `sleightOfHand` open it without a trace **(story flag:
  `read_ledger_early`)** / `arcana` sense what's inside without opening / `perception` note the
  Guild's own wax seal is *newer than the case*. Reward `item`.
- **`boss`** — *The Vault Warden*: `religion` it was a person once / `intimidation` /
  `stealth` party, fail `alert`. Reward `tempHp`.

---

## ACT II — THE RISING (6–10)
The pattern. Widening scope, first true descent.

### Ch6 — The Bone Census
- **Map:** `grim` / Gallows · **Enemies:** Undead, Drow & Shadow
- A hermit archivist counting adventurer deaths for forty years. The number is held *constant*.
- **`combat`** — *Forty Years of Names*: `investigation` cross-reference the tallies /
  `history` recognize a famous company that officially retired / `arcana` the ink is warded.
  Reward `item`.
- **`shrine`** — *The Counting Stone*: `religion` / `perception` / `arcana` overload it,
  fail `curse`. Reward `buffEffect`.

### Ch7 — Rivals ⚠️ **GAP**
- **Map:** `verdant` / Thicket — an ambush on the road, not a dungeon
- **Enemies:** *needs a new family.* The Ninefold Blades are a rival human company. Nothing in
  `MONSTER_THEMES` covers armed humanoid mercenaries. **Recommend adding family `11 Mercenary`**
  (bandit/veteran/knight/mage SRD blocks) and a theme key `road: [11, 4, 3]`. Without it, the
  closest cheat is Orc Horde, which loses the "they are you, three years on" punch entirely.
- **`entrance`** — *Parley*: `persuasion` talk them down (skips a whole combat zone —
  reward `shortcut`) / `insight` read their fear / `intimidation` fail `alert`.
- **`boss`** — *Their Captain*: `insight` she wants to lose / `history` name her dead company /
  `athletics` end it clean.

### Ch8 — Deeper Than Maps
- **Map:** `ancient` / Monolith · **Enemies:** Undead, Fey, Vermin
- First true under-halls. Architecture that isn't monster-built and isn't dwarven either.
- **`combat`** — *The Descending Hall*: `arcana` the stone remembers a shape /
  `investigation` the halls are built to funnel *upward* traffic, not down /
  `athletics` force a jammed valve-door, fail `damage`. Reward `shortcut`.
- **`shrine`** — *Fey Squatters*: `deception` bargain in riddle / `nature` offer proper tribute /
  `arcana` bind them, fail `debuff`. Reward `buffEffect`.
- **`treasure`** — *The Toll Room*: coins from every kingdom, all of them adventurers' pay,
  all of it flowing *down*. `investigation` / `sleightOfHand` / `religion`. Reward `gold`.

### Ch9 — The Refugee War
- **Map:** `verdant` / Wilds — overland, large · **Enemies:** Orc Horde, Beasts, Vermin
- A warlord uniting the surface monsters. Not to conquer — to stampede. He's right.
- **`entrance`** — *The Refugee Column*: `insight` these are families, not an army /
  `persuasion` win passage / `stealth` party, fail `alert`. Reward `buffEffect`.
- **`combat:2`** — *Break the Warline*: `intimidation` / `athletics` / `survival` flank
  through the burn. Reward `tempHp`.
- **`boss`** — *The Horn*: `history` the horn is Guild-made / `arcana` / `sleightOfHand` steal
  it mid-fight, fail `damage`. Reward `item`.

### Ch10 — The Horn of the Under-King — **ACT BREAK**
- **Map:** `molten` / Fissure · **Enemies:** Elemental, Giantkind, Draconic
- The warlord's last stand at the vent he was running *from*. Dies saying: *"you are the wall,
  and the wall is hungry."* The Guild promotes you out of expendability.
- **`combat`** — *The Vent Road*: `survival` time the eruptions / `acrobatics` fail `damage` /
  `nature`. Reward `shortcut`.
- **`shrine`** — *The Old Forge-Shrine*: giantkind made the seal's *hardware*.
  `history` / `religion` / `arcana` fail `damage`. Reward `item`.
- **`boss`** — *The Under-King*: `insight` he wants to be stopped / `intimidation` /
  `athletics`. Reward `tempHp`.

---

## ACT III — THE FURNACE (11–15)
Complicity. The palette turns grim and stays there.

### Ch11 — The Hall of Standing Contracts
- **Map:** `grim` / Bastion — Guild inner sanctum · **Enemies:** Fiendish, Drow & Shadow
- Thousands of charters, still warm, still drawing.
- **`entrance`** — *Past the Clerks*: `deception` forge a writ / `persuasion` /
  `stealth` party, fail `alert`. Reward `shortcut`.
- **`combat`** — *The Drawing Room*: `arcana` trace where the power goes /
  `investigation` find your own charter / `sleightOfHand` steal it, fail `curse`.
  Reward `item`.
- **`boss`** — *The Notary*: `insight` / `religion` / `intimidation`. Reward `tempHp`.

### Ch12 — Someone You Knew
- **Map:** `grim` / Prison · **Enemies:** Undead, Fiendish
- A fallen party member — or Rowena's kin from Ch1 — found alive down here. Not undead.
  *Employed.* The strongest emotional beat in the arc; keep the enemy count low and the
  challenge count high.
- **`entrance`** — *The Recognition*: `insight` they know you / `medicine` what's keeping them
  alive / `persuasion` reach them. Reward `buffEffect`.
- **`shrine`** — *Their Quarters*: they've decorated. `perception` / `investigation` /
  `history`. Reward `item`.
- **`boss`** — *Let Them Go*: `medicine` release them cleanly / `religion` last rites /
  `athletics` carry them out, fail `damage` **(story flag: `carried_them_out`)**.

### Ch13 — The Sealwright
- **Map:** `ancient` / Archives · **Enemies:** Undead, Fey (thin — this is a conversation map)
- An architect of the binding. Ancient, unrepentant, and gets the best speech in the game:
  the alternative was worse, and it still is.
- **`entrance`** — *Admittance*: `history` / `persuasion` / `arcana`. Reward `buffEffect`.
- **`boss`** — *The Argument*: unusually, all three approaches "win" differently —
  `persuasion` he concedes the method / `insight` he's been waiting centuries for someone to
  refuse / `intimidation` he simply stops talking. Reward `item` (the seal's true schematic).

### Ch14 — Burn the Ledger
- **Map:** `molten` / Crucible · **Enemies:** Elemental, Draconic
- Open defiance. It works. It thins the seal, and the surface pays immediately.
- **`combat`** — *The Long Climb*: `athletics` fail `damage` / `acrobatics` / `survival`.
  Reward `tempHp`.
- **`boss`** — *Into the Crucible*: `religion` commit it properly / `arcana` unmake it safely
  (**flag: `clean_burn`** — softens Ch15's toll) / `athletics` just throw it in, fail `damage`.

### Ch15 — The Cost of the Gesture — **ACT BREAK**
- **Map:** `forest` — **Greenrise Vale again, same seed as Ch1, now burning.**
  Reuse `seed: 771204` deliberately so players recognize every clearing.
- **Enemies:** Fiendish + Undead over a forest map (⚠️ requires either a per-quest family
  override or a new theme key `blighted: [7, 1, 2]` — the payoff is worth the small engine work)
- **`entrance`** — *The Waystone, Broken*: the Ch2 shrine, defaced again, permanently.
  `religion` / `arcana` / `nature`. No reward on any tier. Let it just be loss.
- **`combat`** — *Evacuate the Vale*: `persuasion` / `athletics` / `survival`, party, fail
  `damage`. Reward `buffEffect`. Number saved scales with `clean_burn`.
- **`boss`** — outlawed; Guild enforcers arrive. `deception` / `stealth` party / `intimidation`.

---

## ACT IV — THE WALL (16–20)
What you build instead. Cold, then deep, then final.

### Ch16 — The Unchartered
- **Map:** `frost` / Hold — a ruined mountain fastness you're claiming · **Enemies:** Beasts,
  Giantkind (clearing out squatters, not fighting the war)
- Rebuild the company from deserters, outlaws, and the Ninefold Blades' survivors.
- **`entrance`** — *The Broken Gate*: `athletics` / `investigation` find the sally port /
  `survival`. Reward `shortcut`.
- **`combat`** — *Winter Stores*: `nature` / `survival` / `sleightOfHand`. Reward `gold`.
- **`shrine`** — *Raise Your Own Standard*: `persuasion` name the company /
  `religion` / `performance` (see gaps). Reward `buffEffect: inspired`, party-wide.

### Ch17 — The Deepest Watchtower
- **Map:** `frost` → deep · **Enemies:** Undead, Giantkind
- Descend past where the seal was meant to hold. See the thing plainly. Not a demon —
  something structural. A wound in the world's floor.
- **`combat:2`** — *Below the Cold*: `survival` / `athletics` fail `damage` / `medicine`
  treat the exposure. Reward `tempHp`.
- **`shrine`** — *The Last Marker*: the deepest thing anyone ever built, and it's a warning
  sign facing *down*. `history` / `religion` / `arcana`. Reward `item`.
- **`boss`** — *The Edge of the Wound*: no monster. `arcana` / `insight` / `religion` —
  all three "win"; what differs is what the party understands. Reward `buffEffect`.

### Ch18 — The Old Kings' Silence
- **Map:** `grim` / Keep — a royal capital, at night · **Enemies:** Fiendish, Drow & Shadow,
  Undead (the crowns' court is not what it appears)
- The crowns finally act: re-sign the seal with an entire generation. Stop them or lose the ending.
- **`entrance`** — *The Court*: `deception` / `persuasion` / `insight` spot the fiend behind
  the throne, reward `item`. Fail `alert`.
- **`combat`** — *The Conscription Rolls*: `investigation` / `sleightOfHand` / `arcana` burn
  them, fail `damage`. Reward `shortcut`.
- **`boss`** — *The Regent*: `intimidation` / `history` / `religion`.

### Ch19 — Every Name in the Ledger
- **Map:** `grim` / Abyss · **Enemies:** Undead — pure, and at maximum density
- The seal's defenders, animated by every adventurer it ever ate. The hardest fight in the game
  is against everyone who died doing your job. **Ideal place to spawn revenants using the
  player's own dead heroes' names from save history** — the single highest-value custom hook
  in this arc.
- **`entrance`** — *The Roll Call*: `religion` name them all / `history` /
  `insight` they aren't attacking, they're *reporting for duty*. Reward `buffEffect`.
- **`combat:3`** — *The Ninefold Blades, Again*: pays off Ch7. `persuasion` / `insight` /
  `intimidation`. Reward `tempHp`.
- **`boss`** — *Ch12's Face*: pays off `carried_them_out`. `medicine` / `religion` / `persuasion`.

### Ch20 — The Last Charter — **CLIMAX**
- **Map:** `molten` — the wound itself, but drop the fire palette to *black and white heat*
  if the renderer allows a tint override · **Enemies:** Elemental, Draconic, + Fiendish
  (⚠️ needs a final-chapter family override; `molten` has no Fiendish)
- The seal can close properly, but it needs a binding *freely given* rather than tricked out of
  people. The company signs — knowingly, this time. That's the whole thematic difference.
- **`entrance`** — *The Descent, Together*: `athletics` party / `religion` / `survival`.
  Reward `tempHp`.
- **`shrine`** — *Write the Terms*: the inverse of Ch4's signing, and it should visually echo
  it. `persuasion` / `history` / `investigation` — this time reading it is mandatory.
  Reward `buffEffect`, party.
- **`boss`** — *The Wound*: `arcana` / `religion` / `athletics`, all party, fail `damage`.
- **Epilogue:** the roster keeps crawling. Endless mode *is* the good ending — the company
  holds the line by consent instead of deception.

---

## Engine gaps this arc assumes

| # | Need | Chapters | Notes |
|---|---|---|---|
| 1 | Monster family `11 Mercenary` + theme `road` | 7, 15, 18 | Human rivals/enforcers have no representation today. Biggest gap. |
| 2 | Per-quest family override (or theme `blighted: [7,1,2]`) | 15, 20 | Fiendish over a forest map; Fiendish in a molten map. |
| 3 | Skills `insight`, `history`, `medicine`, `investigation`, `performance` | throughout | Verify against the skill table in skills.js — I used them heavily because Acts III–IV are social/investigative, not athletic. Substitute if absent. |
| 4 | Seed reuse across chapters | 15 reuses 1 | Already supported (fixed `seed` field); just needs the map to render damaged. |
| 5 | Dead-hero names → revenant spawns | 19 | Optional, but it's the arc's best mechanical-thematic payoff. |
| 6 | Story flags read across chapters | 5, 12, 14, 15, 19 | `quest.storyFlags` exists per-quest; needs promotion to `game.storyProgress` to persist. |
