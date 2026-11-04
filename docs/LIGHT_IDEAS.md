# Light & Darkness — Idea List (for approval)

Status: **approved 2026-10-25.** Everything ✅ except **22, 23 and 36** (❌), with two
changes:
- **24, oil flask:** also leaves a lasting fire patch that damages anyone walking on it.
- **25, Driftglobe:** takes a **Kit slot**, not the trinket slot.

Build order:
1. Core rules and senses (1–6, 15, 52, 53, 55, 57)
2. Stealth (7–13, 49)
3. Darkvision visuals (14)
4. Monsters (17, 18, 37–43)
5. Items (19–21, 24, 25)
6. Spells and class abilities (26–35, 50, 51, 54)
7. World (44–48)
8. Settings (56)

Built on the light system already in place (`docs/LIGHT_AND_DARKVISION.md`):
- bright / dim / dark status on every creature;
- the steady light map;
- carried-light radii;
- darkvision on dwarves and tieflings (removed 2026-10-26; monsters only now).

House rule: **every benefit has a cost.** That can be a talent point, spell pick, slot,
action, gold, a consumable, or a drawback. Each idea names its own.

Format: **What it does.** *Cost:* … · *Hooks into:* …

---

## A. Core darkness rules
The foundation; most other ideas lean on these.

1. **Unseen target.** Attacking a creature standing in darkness that you can't see
   (no darkvision, no light on it) is at disadvantage. Unseen creatures can't be singled
   out by targeted spells. *Cost:* applies to both sides. *Hooks into:* the existing
   `invisible` condition path, `lightStateOf`.
2. **Unseen attacker.** Attacking from darkness at a target that can't see you is at
   advantage. The attack reveals you until you move back into darkness. *Cost:* you
   give up your light to use it. *Hooks into:* the same path.
3. **Dim light hampers Perception.** Perception checks are at disadvantage in dim light,
   covering trap and secret-door spotting and skill-check challenges. *Cost:* explorers
   want light. *Hooks into:* `skills.js` challenges.
4. **Light gives you away.** A hero carrying a light is noticed by monsters from about
   50% further away. A hero in the dark with no light is noticed from about 30% closer.
   *Cost:* the price of carrying a torch. *Hooks into:* monster aggro and sight radius
   in `monster_ai.js`.
5. **Monster darkvision matters.** Monsters with a darkvision value (already in
   `monsters.json`) ignore rules 1–2 within their range, so many dungeon natives see
   you in the dark. *Cost:* the dark isn't always safe. *Hooks into:* monster
   `darkvision` data.
6. **Surprise in dark rooms.** Monsters resting in a dark room the party enters without
   light or darkvision start the fight hidden (a free first round or initiative bonus).
   *Cost:* scouting with light. *Hooks into:* initiative and room engage.

## B. Rogue & stealth
7. **Shadow Strike (rogue talent).** The first attack each fight made from dim or dark
   light gets +1 Sneak Attack die (or a 19–20 crit range). *Cost:* a talent point, and
   you must forgo light. *Hooks into:* rogue talent tree, Sneak Attack.
8. **Hide needs shadow.** The rogue's Cunning Action Hide (and any Hide) only works
   from dim or dark tiles. A hidden rogue counts as unseen (rule 2) until they attack.
   *Cost:* positioning. *Hooks into:* conditions, rule 2.
9. **Assassin: Shadow Kill.** Assassinate's auto-crit also applies against targets in
   darkness that haven't acted yet. *Cost:* subclass choice. *Hooks into:* the Assassin
   subclass.
10. **Thief: Snuff.** Spend an action to extinguish an adjacent wall torch, candle or
    brazier, making a dark pocket you can fight from. It's permanent for the floor and
    can be relit (idea 33). *Cost:* an action, and the party loses that light too.
    *Hooks into:* the steady light map (sources can be switched off).
11. **Skulker feat (existing) gets teeth.** You can Hide in dim light (not just dark),
    dim light doesn't hinder your Perception, and a missed attack from hiding doesn't
    reveal you. *Cost:* a feat pick. *Hooks into:* the existing `Skulker` feat.

## C. Monk — Way of Shadow (existing subclass)
12. **Shadow Step.** Bonus action: teleport from one dim or dark tile to another dim or
    dark tile within 12 tiles; your next melee attack is at advantage. *Cost:* bonus
    action, and only works between shadows. *Hooks into:* the Way of Shadow subclass.
13. **Shadow Arts: Darkness.** Spend ki to cast Darkness (idea 31). *Cost:* ki.
    *Hooks into:* monk ki, the Darkness spell.

## D. Darkvision, races & senses
14. ~~**Darkvision visuals.**~~ *Removed 2026-10-26 along with hero darkvision; monster
    darkvision stays.* Monsters in darkness within a darkvision hero's range are
    drawn in greyscale at readable brightness. A soft grey zone in the dark surrounds
    the hero. *Cost:* darkvision is rare (dwarf/tiefling) and grey-only. *Hooks into:*
    phase 3.
15. **Darkvision in the rules.** *(Monsters only since 2026-10-26.)* Within range, darkness counts as dim for that hero:
    no unseen-target penalty, but dim's Perception penalty applies. *Cost:* still worse
    than real light. *Hooks into:* rules 1 and 3.
16. **Devil's Sight (warlock invocation).** See normally in darkness, including
    magical Darkness, within 24 tiles. Pairs with idea 31 (cast Darkness, then fight
    inside it). *Cost:* an invocation pick. *Hooks into:* warlock invocations.
17. **Sunlight sensitivity.** Kobolds, drow and other dark-dwellers attack at
    disadvantage in bright light. A torch becomes a weapon against them. *Hooks into:*
    monster trait flag.
18. **Blindsight monsters.** Grimlocks and bats ignore light entirely, and hiding in
    shadow doesn't work against them. *Hooks into:* monster trait flag.

## E. Light items & tools
19. **Consumable torches.** Torches stack (up to 99) and burn down while lit. Buy more
    in town. *Cost:* gold and inventory management. *Hooks into:* trinket stacks.
20. **Throw your torch.** Action: throw your torch up to 4 tiles. It lands lit and
    lights that spot for about 10 rounds, then burns out. You're left without light
    until you ready another. *Cost:* the torch, and your own light. *Hooks into:* the
    thrown-item path, light map.
21. **Hood the lantern.** Bonus action: hood or unhood the lantern. Hooded, it gives
    dim light only to 1 tile, for sneaking. *Cost:* bonus action, and you're in the
    dark while hooded. *Hooks into:* the lantern light source.
22. ❌ **Bullseye lantern.** A shop item that casts a 6-tile cone of bright light (12
    dim) in your facing direction, and nothing behind you. *Cost:* gold, and your
    flank is dark. *Hooks into:* a new directional source.
23. ❌ **Sunrod (consumable).** Snap and throw: bright 4 / dim 8 at a spot for about 1
    minute. *Cost:* gold per use. *Hooks into:* thrown items.
24. **Oil flask (consumable).** Thrown: an area of lasting fire that damages anyone who
    walks on or stands in it, and lights the area while it burns. *Cost:* gold per use.
    *Hooks into:* thrown items and zone effects.
25. **Driftglobe (rare magic item, Kit slot).** A floating orb that's like a lantern
    but with no hands needed. It goes in a Kit slot, so the trinket stays free. A rare
    find. *Cost:* a Kit slot and the find.

## F. Spells
26. **Moonbeam** sheds dim light in its beam. *Hooks into:* the Moonbeam zone.
27. **Flaming Sphere** sheds bright 2 / dim 4 around the sphere as it moves.
28. **Faerie Fire** makes outlined targets shed dim light, and they can't benefit from
    darkness: no hiding, no unseen bonuses. *Hooks into:* rules 1, 2, 8.
29. **Sunbeam** surrounds the caster with bright light for its duration.
30. **Wall of Fire** lights its length: bright 1 / dim 2.
31. **Darkness (new 2nd-level spell).** A 3-tile radius of magical darkness that no
    light (torches, Light, lanterns) can penetrate; only Devil's Sight sees in it.
    Concentration. *Cost:* a spell slot, and your own allies are blinded inside too.
32. **Daylight (new 3rd-level spell).** A 12-tile radius of bright light that also
    dispels Darkness. *Cost:* a spell slot.
33. **Kindle.** An action (any hero, using a torch) to light an unlit or snuffed
    sconce or brazier, permanently for the floor. The counterpart to Snuff (10).
    *Cost:* an action, and the light reveals you. *Hooks into:* the light map.
34. **Guiding Bolt** makes its target glimmer with dim light until it's next hit, so
    it can't hide in darkness.
35. **Dancing Lights (new cantrip).** Place up to 3 dim-light motes anywhere within 12
    tiles to scout or light a fight remotely. Concentration. *Cost:* a spell pick and
    concentration.
36. ❌ **Continual Flame (new 2nd-level spell).** A permanent light (torch-like) on an
    object. It costs gold in components, and frees a slot like Light does. *Cost:* a
    spell slot plus 50 gold.

## G. Monsters & light
37. **Glowing monsters.** Will-o'-wisp, fire elemental, magmin and ember magmin, azer,
    giant fire beetle, phoenix and the fire bat shed light (the wisp's flickers). They
    can't hide in the dark. *Cost:* a monster trait, rare by design.
38. **Ghostly dim glow.** Ghost, specter and banshee shed a cold, pale dim light, 1–2
    tiles.
39. **Shadow creatures.** Shadows, shadow wraiths, the shadow fiend and shadow dragons
    can hide in dim or dark as a bonus action, and are at disadvantage (or take extra
    radiant damage) in bright light.
40. **Light-snuffers.** The darkmantle has a Darkness Aura, and some goblins and
    cultists throw water at torches. These enemies make the dark on purpose.
41. **Drawn to light.** Ghost moths (and similar) target the hero carrying the
    brightest light. That makes the torch a lure: dangerous, or useful bait.
42. **Torch-bearing enemies.** Torcbearers, and orc or hobgoblin patrols, carry their
    own light. You can see them coming, and they light the fight for you too.
43. **Vampire sunlight weakness.** Bright light from Sunbeam or Daylight burns a
    vampire, and ordinary bright light stops its regeneration.

## H. Dungeon & world
44. **Dark rooms.** The generator makes some rooms unlit (no sconces). Those rooms
    hold more treasure or tougher monsters: a risk-for-reward choice.
45. **Light-only secrets.** Some secret doors, traps and hidden loot only reveal on a
    bright tile; in dim light you need a Perception check.
46. **Glinting treasure.** Chests in dark rooms give off a faint glint, so the player
    can spot loot in the dark without it lighting anything.
47. **Light shrine.** A rare room feature that blesses the party: their lights double
    in radius for the floor. *Cost:* it's a room you have to find.
    *Built as the Shrine of Light:* at most one per floor, on 25% of floors
    (`LIGHT_SHRINE_CHANCE`), always one of that floor's ordinary shrines.
48. **Night overland.** At night, ambushes are more likely, but so is sneaking past
    camps. Campfires make bright refuges.

## I. Class & feat perks
49. **Gloom Stalker-style ranger talent.** Invisible to darkvision while standing in
    darkness, plus an extra attack on the first round of a fight. *Cost:* a talent
    point.
50. **Radiant Flare (cleric talent).** Channel Divinity: a burst that lights a 4-tile
    area brightly for a round and deals radiant damage to undead and shadow creatures.
    *Cost:* Channel Divinity.
51. **Evoker: Blinding Flash.** Spend a spell slot to flash-blind (Blinded, 1 round)
    every creature in darkness near a point. *Cost:* a spell slot.
52. **Alert feat (existing).** Attackers you can't see don't get the unseen-attacker
    advantage against you. *Cost:* a feat pick.
53. **Dungeon Delver feat (existing).** Your Perception ignores dim light's
    disadvantage, and you notice traps in dark tiles too. *Cost:* a feat pick.
54. **Devotion paladin: Sacred Weapon glow.** Sacred Weapon sheds bright 2 / dim 4
    while active. Light as a side effect, with an upkeep cost. *Cost:* Channel
    Divinity.

## J. UI & feedback
55. **Combat log flavour.** Log lines like "strikes from the shadows", "can't see the
    target" and "unseen". Rules you can't see in the log feel like bugs.
56. **Player settings.** A Darkness shading strength option (accessibility), plus an
    option to show light icons on all tiles while hovering in manual mode.
57. **Tooltip explanations.** Hovering the ☀️ / ⛅ / 🌙 badge explains its current
    effects, e.g. "Darkness: attackers who can't see you have disadvantage."
