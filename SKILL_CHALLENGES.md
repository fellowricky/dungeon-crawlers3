# Skill Challenge System — Design Document

## Overview

A non-combat skill check system that triggers automatically during dungeon exploration. When a challenge fires, a UI overlay appears showing: the challenge flavor text, which hero is attempting it, the skill being tested (with stat/prof bonus), a simulated d20 roll, and the outcome. Challenges are resolved by the party member with the highest total bonus in the relevant skill.

Challenges replace some combat rooms, appear alongside cleared rooms, or exist as standalone rooms. Their effects are purely non-combat: loot, shortcuts, healing, info, gold, temporary buffs, or new path options.

---

## 1. Trigger Points

There are three ways a challenge can fire:

### A. Challenge Room (room type)
A new room type added to Dungeon Forge's generation alongside `combat/elite/treasure/shrine/boss/entrance`. The generator sprinkles 1-3 per floor. When the party enters and all monsters are cleared (the room is "done"), the challenge fires automatically.

### B. Post-Clear Event
After any combat room is cleared, a random skill from a subset of skills has a ~20-35% chance to fire a check. This represents the heroes searching the room, noticing something, or improvising. The available skills depend on the room type:

| Room Type         | Eligible Skills                                 |
|-------------------|-------------------------------------------------|
| combat (normal)   | Investigation, Perception, Survival, Nature     |
| elite             | Investigation, History, Arcana, Intimidation    |
| treasure          | Sleight of Hand, Perception, Investigation      |
| shrine            | Religion, Arcana, Insight                       |
| boss              | History, Arcana, Religion, Perception           |

### C. World / Camp Event
In the merchant camp between floors, a challenge can fire (Persuasion for discounts, Insight for the merchant's riddle, etc.). These are triggered by a "special event" roll when the camp loads.

---

## 2. Challenge Data Structure

Each challenge is a plain object:

```js
{
  skill: 'sleightOfHand',     // which skill key from SKILLS in srd.js
  name: 'Locked Chest',       // title shown in the UI header
  desc: 'An ornate chest with a complex locking mechanism...',  // flavor text
  dc: 14,                     // difficulty class (scaled to dungeonLevel)
  onSuccess: {                // outcome data
    text: 'The lock clicks open! Inside you find...',
    loot: { kind: 'item', count: 1 },  // or 'gold'/'potion'/'heal'/'buff'/'secret'/'shortcut'
    value: null,              // amount of gold or d6 of healing, etc.
  },
  onFailure: {
    text: 'The lock jams. The chest won\'t budge.',
    effect: null,             // 'trap' / 'alarm' / 'poison' / null = nothing happens
    value: null,
  }
}
```

### Reward types

| reward kind     | effect                                            |
|-----------------|---------------------------------------------------|
| `item`          | Drops a `rollItem(dungeonLevel)` into inventory   |
| `gold`          | Adds gold to the party treasury                   |
| `potion`        | Adds a random potion (heal or greater)            |
| `heal`          | Heals the whole party by a few HP                 |
| `buff`          | Grants a floor-long buff (tracked via game state) |
| `secret`        | Reveals a secret room on the minimap              |
| `shortcut`      | Marks the current room as a "nexus" for fast travel |
| `reveal`        | Reveals a portion of the map or the boss location |
| `skip`          | Skips a room (a door opens deeper into the dungeon) |
| `info`          | Logs useful lore or a hint about the boss         |

---

## 3. UI Overlay

A modal overlay following the same pattern as `#shopscreen` and `#worldmapscreen`.

### Layout mockup

```
┌─────────────────────────────────────────┐
│  ⚔  SKILL CHALLENGE          ──── ✕     │  ← header bar
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │   Locked Chest                  │    │  ← challenge name
│  │                                 │    │
│  │   An ornate chest sits against  │    │  ← flavor text
│  │   the far wall, its lock glint- │    │
│  │   ing with uncommon complexity. │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌────────┐                             │
│  │  d20   │        Nyx — Sleight of Hand│  ← hero name & skill
│  │ ┌───┐  │        DEX mod: +3          │
│  │ │ 14│  │        Prof: +2             │
│  │ └───┘  │        Total: +5            │
│  │        │                             │
│  │  Roll: │ 14 + 5 = 19 vs DC 14        │  ← result calculation
│  │        │  ✅ SUCCESS!                │
│  └────────┘                             │
│                                         │
│  The lock clicks open. Inside you find  │  ← outcome text
│  a shimmering shortsword.               │
│                                         │
│  ┌─────────────────────┐                │
│  │    CONTINUE          │                │  ← dismiss button
│  └─────────────────────┘                │
└─────────────────────────────────────────┘
```

### CSS structure

```css
/* Reuse the existing #shopscreen / .cs-frame pattern */
#challengescreen {
  position: fixed; inset: 0; z-index: 52; display: none;
  background: rgba(4,5,9,0.85); backdrop-filter: blur(5px);
  align-items: center; justify-content: center; padding: 24px;
}
#challengescreen.show { display: flex; }

.challenge-frame {
  width: 480px; max-width: 90vw;
  background: rgba(14, 16, 22, 0.96);
  border: 1px solid rgba(200, 170, 90, 0.2);
  border-radius: 12px;
  overflow: hidden;
}

/* Dice area */
.challenge-dice {
  display: flex; align-items: center; gap: 20px;
  padding: 16px 20px;
  margin: 10px 0;
}
.challenge-d20 {
  width: 64px; height: 64px;
  background: rgba(35, 30, 25, 0.8);
  border: 2px solid rgba(200, 170, 90, 0.3);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 700; color: #f0e2c0;
  font-family: 'Georgia', serif;
}
.challenge-d20.success { border-color: #6aea6a; color: #6aea6a; }
.challenge-d20.failure { border-color: #e0483a; color: #e0483a; }
```

### Animation flow

1. Game state pauses (`this.paused = true` / `setPaused(true)`)
2. Overlay fades in (CSS transition, ~200ms)
3. Text appears immediately (name + flavor)
4. Dice area shows with a brief "rolling" animation:
   - D20 box shows a few random numbers cycling for ~600ms
   - Then settles on the final roll value
   - The roll text + success/failure appear
5. Outcome text fades in below
6. "Continue" button appears — player clicks to dismiss
7. Overlay fades out, game resumes

---

## 4. Resolution Logic

### Skill Check Formula

```
total = d20(1-20) + skillBonus(hero, skillKey)

skillBonus = abilityModifier + (proficiency ? profBonus(level) : 0)

Success: total >= DC
Failure: total < DC

Critical: d20 === 20 → auto-success, extra flourish in text
Critical: d20 === 1  → auto-fail, potentially worse outcome
```

### DC Scaling

```
baseDC = 10
dc = baseDC + floor(dungeonLevel * 1.5) + randomVariation(-2, +2)

So at floor 1:   DC 8-12
   at floor 5:   DC 14-18
   at floor 10:  DC 22-26
```

### Hero Selection

When a challenge fires, iterate through `alive` heroes and pick the one with the highest `h.data.skillsDerived[skillKey]`. This is the same computed value that already exists from `recalc()` in `srd.js`:

```js
function skillBonus(h, skillKey) {
  return h.data.skillsDerived?.[skillKey] ?? 0;
}
```

If multiple heroes are tied, pick the one with the highest raw d20 roll (rolled behind the scenes for the tiebreak, not shown in UI — for code purposes any can be chosen since the bonus is the same).

---

## 5. Individual Challenge Ideas by Skill

### Strength — Athletics

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Collapsed Passage** | room | 12 | Clear rubble → shortcut marker appears on minimap (skips 1-2 rooms) | Rubble stays, party takes the long way |
| **Heave the Gate** | room | 14 | Lift a portcullis → access a bonus room with a chest | Gate won't budge, try again? (Can be retried once by a different hero) |
| **Crack the Wall** | post-clear | 16 | Break through a thin wall → hidden cache with gold | Fatigue, nothing gained |

### Dexterity — Acrobatics

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Rope Bridge** | room | 12 | Cross carefully → reach an isolated chest in the middle | The bridge sways violently — party retreats, no access |
| **Shattered Floor** | room | 14 | Leap across crumbling tiles → reach a pedestal with a potion | A tile gives way — the hero who attempted it takes 1d4 fall damage |
| **Narrow Ledge** | room | 15 | Edge along a precipice → discover a hidden alcove with loot | A pebble skitters away — too risky, you turn back |

### Dexterity — Sleight of Hand

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Locked Chest** | room | 13 | Pick the lock → enhanced loot (guaranteed item + gold) | Lock jams — chest is permanently sealed |
| **Trapped Reliquary** | room | 15 | Extract a gem from a pressure-plate pedestal → rare potion or scroll | The mechanism clicks ominously — retreat empty-handed |
| **Disarm the Contraption** | room | 14 | Carefully dismantle a tripwire trigger → safe access to a cache of gold | A dart fires — 1 piercing damage to the attempting hero |

### Dexterity — Stealth

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Sleeping Guardian** | room | 13 | Sneak past a hibernating beast → treasure behind it, untouched | The beast stirs — the party must flee the room (room becomes inaccessible) |
| **Hidden Stash** | post-clear | 11 | Spot and retrieve a cache the monsters had hidden → bonus gold | The stash is booby-trapped with a bell — nothing gained |

### Intelligence — Arcana

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Rune-Sealed Door** | room | 13 | Decipher and deactivate the magical seal → passage to a bonus room | The seal pulses — the door stays shut |
| **Crystal Conduit** | room | 16 | Align floating crystals into resonance → room becomes a teleport nexus for the floor | The crystals dim — alignment fails |
| **Identify Enchantment** | post-clear | 14 | Read magical residue from a defeated caster → reveals the boss room's type/location on the minimap | The residue fades too quickly |

### Intelligence — History

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Annal Tablet** | room | 12 | Translate ancient writing → reveals the floor's layout (all rooms visible on minimap) | The script is too eroded to read |
| **Tomb Rite** | room | 15 | Recall correct burial rites to open a sarcophagus → high-value gear | A spectral wail — nothing happens but it's unsettling |
| **Architect's Insight** | post-clear | 14 | Recognize the room's architectural style — identifies a secret door location | The room looks ordinary |

### Intelligence — Investigation

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Hidden Armory** | post-clear | 12 | Search thoroughly → find a gear item | You find nothing of value |
| **Pressure Plate Puzzle** | room | 14 | Deduce the safe path across a patterned floor → reach a reward pedestal | Wrong step triggers a dart trap — party takes 1d4 damage |
| **Search for Clues** | post-clear | 10 | Find a journal or note → reveals lore text and +50 XP | No clues in this room |

### Intelligence — Nature

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Overgrown Grove** | room | 11 | Harvest rare alchemical herbs → 1-2 free healing potions added to inventory | The plants are common weeds |
| **Mushroom Chamber** | room | 13 | Sort edible from poisonous fungi → the party gains a small HP heal (1d6 distributed) | Sleep spores trigger — the party stands idle for 2 seconds |
| **Toxic Pool** | post-clear | 14 | Identify a safe path through a gas-filled chamber → reach a stash of gold | The gas irritates eyes, nothing found |

### Intelligence — Religion

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Desecrated Shrine** | room | 12 | Purify a corrupted shrine → it becomes usable (full heal for party) | The corruption holds |
| **Heretic's Ward** | room | 15 | Recite the counter-litany to dispel profane symbols → door opens to bonus room | The symbols flash red — the door stays sealed |
| **Holy Symbol** | room | 13 | Recognize a buried relic → recover it for bonus XP (50 × floor) | Just a rock |

### Wisdom — Animal Handling

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Caged Beast** | room | 12 | Befriend a trapped creature → it joins as a pet (finds hidden items, carries potions) until it wanders off next floor | The creature cowers, unreachable |
| **Pack Beast** | room | 10 | Calm a spooked pack mule → it drops cargo (gold + potion) before bolting | It bolts with the goods |
| **Lost Pet** | post-clear | 14 | A lost dog/drake follows your scent. Gain its trust → leads you to its former owner's stash (gear item) | It runs away |

### Wisdom — Insight

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Mimic Sense** | room | 12 | Feel that something is "wrong" with a chest — identify it as a mimic. Party attacks first with advantage (special: this combat check refunds some HP if the mimic is a surprise) | Seems normal — the mimic gets a free hit (party takes minor damage) |
| **Merchant's Riddle** | camp | 14 | See through the merchant's trick → one item is free | You pay normal price, no harm done |
| **Fake Wall** | post-clear | 15 | The room feels slightly too small. Knock on the walls to find a hollow section → secret room with loot | Nothing unusual |

### Wisdom — Medicine

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Sick Wanderer** | room | 12 | Diagnose and treat a wounded NPC → they reward you with a key to a locked door elsewhere on this floor | The ailment is beyond your skill — no reward |
| **Triage Aftermath** | post-clear | 14 | Tend to the party's scrapes and bruises — everyone regains 1d6 HP | The injuries are too fresh |
| **Plague Source** | room | 16 | Identify the source of a contamination → neutralize it for bonus XP | Contamination remains |

### Wisdom — Perception

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Secret Junction** | room | 13 | Notice a hairline crack — find a secret door to a bonus room | The walls are blank |
| **Hidden Switch** | room | 12 | Spot a subtle depression in the floor → activates a hidden elevator to a treasure alcove | Nothing stands out |
| **Ambush Warning** | post-clear | 14 | Notice tracks indicating another monster group in the area — you can choose to leave or stay and fight (bonus XP if you fight) | No sign of anything |
| **Treasure Glint** | post-clear | 11 | Spot a loose stone reflecting torchlight → pry it up for gold | Just a shadow |

### Wisdom — Survival

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Lost Trail** | room | 11 | Read the signs — take a shortcut that skips 1 room toward the boss | The trail leads in circles — no benefit |
| **Forage Supplies** | post-clear | 10 | Scavenge the area → find a potion or 2d10 gold | Nothing useful here |
| **Safe Camp** | post-clear | 13 | Find a well-hidden nook to rest → party regains one ability charge (short-rest tier) per alive hero | Too exposed, no rest |
| **Environment Hazard** | room | 14 | Spot unstable ceiling or shifting sands → guide the party through safely to reach a treasure | The hazard blocks the path |

### Charisma — Deception

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Bluff the Sentinel** | room | 13 | Talk past a spectral or mechanical guard → bypass a combat encounter, claim the room's treasure | The guard doesn't buy it — you must fight, and the guard alerts adjacent rooms (extra adds) |
| **Feign Authority** | post-clear | 15 | Pretend to be inspecting the area on official business → an NPC appears and hands over a tribute (gold) | You're ignored |
| **False Trail** | post-clear | 14 | Plant misdirection convincing enough that a rival adventuring party leaves their supplies behind (gear item) | No one shows up |

### Charisma — Intimidation

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Cower the Scavengers** | room | 11 | Scare off a pack of scavengers blocking a cache → collect their hoard (gold) | They scatter but take the goods with them |
| **Demand Passage** | room | 14 | Refuse a greedy gatekeeper's tribute demand and bully them aside → free passage | They take 20 gold as "tribute" |
| **Awe the Cultist** | post-clear | 16 | Your reputation precedes you — a lone cultist surrenders and reveals the boss's weakness (info: boss gets -2 AC for this floor) | The cultist flees before you can question them |

### Charisma — Performance

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Riddle Court** | room | 14 | Entertain a fey or sphinx with a tale or song → grants a boon: better shop inventory next time | The fey is bored — you're dismissed with nothing |
| **Echoing Alcove** | room | 12 | Play the right notes on a magical instrument → unlocks a hidden compartment with a potion | Discordant noise, nothing happens |
| **Distract the Guard** | room | 15 | Put on a show that draws the attention of a roaming guard, letting someone else slip past to snag treasure | The guard ignores you, no opening |

### Charisma — Persuasion

| Name | Type | DC | Success | Failure |
|------|------|----|---------|---------|
| **Merchant Discount** | camp | 14 | Haggle successfully → all prices reduced by 15% for this shop visit | The merchant holds firm |
| **Freed Captive** | room | 12 | Convince a freed prisoner to share information → reveals a secret room on the minimap | The captive clams up and leaves |
| **Calm the Crowd** | room | 16 | Hostile but hesitant NPCs are on the verge of attacking. Talk them down → room resolves as if cleared, with loot but no XP | They attack anyway |

---

## 6. Implementation Outline

### New files needed

| File | Purpose |
|------|---------|
| `src/game/challenges.js` | Challenge data (all challenges as a lookup table), DC calculation, hero picker, reward dispatcher |
| `src/ui/challenge.css` | Styles for the challenge overlay |
| `src/ui/challenge.js` | DOM construction, dice animation, show/hide |

### Changes to existing files

| File | Change |
|------|--------|
| `src/game/game.js` | Call challenge system in `checkInteractables()` or after room-complete check. Add new room-type tag for Dungeon Forge. Add `setPaused(true/false)` calls around the overlay. |
| `src/index.html` | Add `<div id="challengescreen">` placeholder |
| `src/ui/game.css` | Import the challenge CSS |

### Integration flow (in `game.js`)

```js
// After a room is cleared (in exploreAI or checkInteractables or a new hook):
if(roomCleared && !this._skippedChallenges[roomId]) {
  const challenge = this.pickChallengeForRoom(rid);
  if(challenge) {
    this._skippedChallenges[roomId] = true;
    this.fireChallenge(challenge);
    return; // pause further processing until challenge resolves
  }
}

// fireChallenge(challenge):
// 1. setPaused(true)
// 2. Show overlay
// 3. On "Continue" click → applyReward(challenge.outcome), setPaused(false)
```

### Dungeon Forge integration

Add a `challenge` room type to the generator alongside the existing types. A challenge room:
- Has no monsters (or maybe a trivial encounter that auto-resolves)
- Has a `challengeSkill: 'acrobatics'` property on the room object
- Uses the same width/height as a normal room
- The `heroTargetCell` / `roomDone` logic needs a small tweak: challenge rooms are "complete" once the party enters and the challenge fires

---

## 7. Edge Cases

| Situation | Handling |
|-----------|----------|
| All heroes dead | Skip all challenges until someone revives |
| Challenge fires while paused | Challenges set `this.paused = true`; they own the pause. Deferred until unpaused. |
| Multiple challenges in one room | Only one challenge per room. Post-clear and room-type are mutually exclusive. |
| Hero dies mid-challenge | Not possible — game is paused during the overlay |
| Retries | Challenges are one-shot per room. If a retry mechanism is desired, limit to a specific subset. |
| All skills tied at 0 | The d20 roll itself is the decider. A hero with no proficiency and -1 mod can still succeed on a 20. |
| No alive hero has a skill bonus | Use the raw d20 (skillBonus = 0) — everyone gets a "default" attempt. |

---

## 8. Design Principles

- **No combat impact.** Challenges never directly modify attack rolls, damage, AC, monster HP, or combat outcomes. Rewards are items, gold, information, healing (outside combat), or navigation advantages.
- **Readable at a glance.** The UI shows hero, skill, roll, and outcome in one visual group. The player watches the d20 land — clickpocalypse spectacle.
- **Partial progression.** Failure should feel like "try again next floor" rather than "you're bad at the game." Rewards are bonuses, not necessities.
- **Automatic.** No player input is required beyond clicking "Continue." The system picks the best hero, rolls, and resolves.
