# Combat AI review (2026-11-09)

Why heroes and monsters make dumb choices, and the plan to fix it. The AI Priorities tab is
deliberately out of scope until the core is rebuilt (it becomes a set of weights on the new planner).

## Phase 1 — done (2026-11-09)

**Correction to the review below.** More groundwork already existed than the first read credited:
`combat_eval.js` already had a shared damage ledger (`commitDamage`/`effectiveHp`, so focus fire was already
coordinated), HP-scale `damageValue`, `slotCost` and a grid-true Dash rule. What was missing was the
*comparison*. So Phase 1 is one evaluator, **`src/game/turn_planner.js`**, plugged into the decision points the
ladder already has, rather than a rewrite of `heroCombat`. That kept every existing fix intact.

What it does:

- **Real area footprints.** Lines and cones are aimed as lines and cones (`spellArea` / `areaTargets` /
  `bestAim`). Lightning Bolt used to be scored as an 8-tile disc; that one mismatch caused most of the lone-target
  AoEs. Lightning Bolt, Wall of Fire, Sunbeam and Fire Breath now declare `area` in spells.js.
- **Damage spells must beat attacking** (`offensiveSpellPlan`). Value = expected damage on everything caught (dice
  read from the spell's own description, times the save/hit chance, capped at remaining HP, plus kill value) minus
  the slot's worth, compared against the hero's basic attack. Bonus-action spells only have to beat nothing.
  Lingering damage counts two rounds. The class-feature Fireball goes through the same plan.
- **Target choice** (`targetPlanBonus`): whole turns of walking cost about a turn of attacks, measured along the
  real route for distant foes (a wall can turn 13 tiles into 108). A monster in melee with a soft ally gets a bonus
  scaled by how hard it is hitting them; melee heroes get the larger bonus.
- **Dash** (`dashSavesATurn` + `foeClosingTiles`): the gap closes from both ends. No Dash at a melee foe that will walk
  to us anyway, and no Dash along a long detour to something close by that can come to us.
- **Monster abilities** (`planMonsterAbility`): area abilities aim at the thickest clump and wait while the party is
  spread out. Heals wait for someone hurt; self-buffs aren't recast while active.
- **Kill switch** `PLANNER.on` / `PLANNER.monsters` for A/B runs.

Measured (`sim/run_headless.mjs`, 24 parties × L1–14 × 3 fights = 1008 fights, seed 4242, old AI → planner):

| Behaviour | Old AI | Planner |
|---|---|---|
| Hero AoE catching ≤1 creature | 21.8% | **0%** |
| Single-target slot on a foe the basic attack would finish | 1.2% | **0.1%** |
| Avg targets per hero AoE | 2.44 | **2.98** |
| Value per slot level | 14.7 | **15.3** |
| Caster left exposed by a melee hero who could reach | 15.5% | **10.9%** |
| Monster AoE catching ≤1 hero | 39.3% | **10.1%** |
| Wipes (hero planner only / both) | 49 | 49 / 60 |

Dungeon floors (`sim/dungeon_probe.mjs`, 24 floors, 72 fights): hero Dashes 514 → 315; reversals right after a
Dash 16 → 4; 4+-tile turn-to-turn walk-backs 20 → 13 (heroes), 9 → 6 (monsters); caster exposed 15.4% → 5.1%.

The extra wipes come from the monsters, not the heroes. With the hero planner alone, wipes are level with the old AI.

Still open: small 2–3 tile shuffles between turns (ranged positioning) rose a little; a few mid-Dash re-paths
change the goal cell (reservation / approachCellNear). Phases 2–5 below still stand. Phase 2's "shared round
blackboard" already exists as the ledger, so Phase 2 is about roles/formation and healer triage.

Tools: `node sim/run_headless.mjs [--noPlanner] [--noMonsterPlanner]` (arena), `node sim/dungeon_probe.mjs
[--noPlanner] [--samples]` (generated floors, `--samples` prints the decisions behind walk-back turns). Tests:
`test/turn_planner.test.js`.

## Phase 5 — AI Priorities tab on the planner (2026-11-10, not yet play-tested)

Zenu chose to keep the chip rows and add a Role row (no sliders).

- **Combat Role** (new row, `aiPrefs.role`): Auto / Tank / Striker / Artillery / Healer. `heroRole` returns the
  pick (`roleOverride`), so it steers tank formation and who counts as backline. Auto shows what the build reads
  as. Without Kite or Hold Ground set, a picked role also leans the weapon/cantrip choice (Artillery 0.8 toward
  the cantrip, Tank/Striker 0.25 toward the weapon). A picked Healer heals at +15% HP; any other picked role at −10%.
- **Ability & Spell Budget follows the danger level** (`BUDGET_CLEANUP`, `CONSERVATIVE_DANGER`):
  - Conservative: nothing until danger ≥ 0.5, then it spends like Balanced (`getAbilityUseWeight(h, game)`; the
    old one-argument call stays a hard 0).
  - Balanced: the Phase 4 cleanup (danger < 0.15, ≤ 3 rounds).
  - Unleash: holds back only when danger < 0.05 and ≤ 1.5 rounds remain, roughly the last foe.
- Target Focus, Combat Positioning and Auto-Potion already fed the planner's scorer and are unchanged.
- Tests: Phase 5 block in `test/fight_outlook.test.js`.

## Phase 4 — done (2026-11-10), plus the danger level

Zenu saw a party that was in no danger still drinking potions and casting spells at the end of a fight. Every
spender used to ask "is this foe worth it?" one foe at a time; nothing looked at the whole fight.

**Fight outlook** (`fightOutlook` in `turn_planner.js`, switch `PLANNER.thrift`, sim flag `--noThrift`):
- rounds to win = foes' remaining HP ÷ the party's expected damage per round
- expected loss = foes' damage per round × max(1, 0.6 × rounds to win)
- **danger** 0..1 = that loss as a share of party HP (losing half the party's HP = 1). Floors: 0.5 for a downed
  ally, 0.6 for someone who could drop next round or a boss above 30% HP, 0.3 for a healthy elite.
- **cleanup** = danger < 0.15 and rounds to win ≤ 3 (`THRIFT` holds the thresholds).

What it changes:
- In cleanup, no slots, scrolls, buff/heal potions, Ki, charges, Rage, Action Surge, Wild Shape, Bardic
  Inspiration, Lay on Hands or subclass actives (`combat._thrifty`, also inside `_worthSpending`). Exceptions:
  a heal for an ally who is down, and a cure potion. Free spells still compete.
- Outside cleanup, a damage slot's price follows the danger: 1.4× at no danger, down to the old 0.5× at full danger.
- No foes at all is *not* cleanup (nothing to judge), so out-of-combat logic is unchanged.

**Decision log.** With the AI trace on (`window.__aiTrace(true)`, then `__aiTraceDump()`), each spell pick
records `plans`: the top three options with scores and the danger reading, and `thrift` lines say why a hero
held back ("saving resources: 0.4 rounds to win, ~3 of 210 party HP at stake").

**Scenario tests:** `test/fight_outlook.test.js` (16): the outlook on scripted boards, cleanup blocking slots,
potions and class features (even on a dying boss), big spells still coming out against healthy ogres, no
Fireball on one goblin and a 2 HP rat, and the decision log. The older pinned behaviours stay in
`test/turn_planner.test.js`.

Measured (cleanup off → on):

| | Arena (1008 fights, seed 4242) | Dungeon (24 floors, 72 fights, seed 7) |
|---|---|---|
| Slot levels spent in an already-won fight | 2016 (14.6% of all) → **0** | 79 (15.2%) → **0** |
| Slot levels spent overall | 13841 → 11168 (−19%) | 519 → 474 |
| Value per slot level | 15.4 → **17.4** | 11.3 → 11.6 |
| Hero knockdowns / fight | 0.60 → 0.55 | 0.29 → 0.26 |
| Wipes | 53 → 51 | 0 → 0 |

The sim parties carry no trinket potions, so potion use in won fights isn't measured there (tests cover it).

## Phase 3 — done (2026-11-09)

Monsters on the same rules. Switches: `PLANNER.monsters` (abilities, boss spells) and `PLANNER.monsterMoves`
(movement and target reach).

The new monster metrics found the biggest waste in the AI: in **a quarter to a third of the turns where a monster
could reach a hero, it never attacked.** Three causes, all fixed:

- **Disengage mid-approach** (monsterChase). A bloodied monster next to a hero spent its Action on Disengage to walk
  on to its chosen target, then arrived unable to attack. It now swings at whoever is in reach.
- **Flanks that don't fit the move.** The "wrap round to the far side" goal often lay a tile or two past the
  monster's movement, so it ended next to nobody. Flanking is now used only when the walk fits this turn.
- **Fleeing whenever bloodied** (monsterTacticalAction, monsterKite). Bloodied (35%) monsters and pinned shooters
  Disengaged and ran, which wastes the whole turn. Now a monster flees only when the next round would likely drop it
  (`inMortalDanger`), or when it is a ranged/skirmisher kiter. A pinned shooter fires first, then backs off.

Also:
- **End-of-walk fallback:** a monster adjacent to a hero, whose target isn't reachable this turn, attacks the adjacent
  hero instead of walking off into an opportunity attack.
- **Reach in target choice** (`monsterTargetReach`): +3 for a hero it can hit this turn (route checked on its own turn,
  cached), a penalty per extra turn of detour, −25 for no route. Shooters score heroes they have a shot at.
- **Boss spells go through `planMonsterAbility`.** Fireball waits for a clump; Fear and Hold skip heroes already
  affected; Mass Cure waits for a wound. Spell cadence banks while a boss waits for a good moment.
- **Single-target conditions are never put on a hero who already has one;** area conditions only count unaffected
  heroes.

Recharge (5e "Recharge 5–6") was **not** added. The planner already holds abilities until they're good, and the
cadence counter banks meanwhile, so the random-ability problem is gone without changing ability frequency.

Measured (old monster rules → Phase 3):

| | Arena (1008 fights) | Dungeon (216 fights) |
|---|---|---|
| Idle monster turns (hero reachable, no attack) | 25.5% → **7.7%** | 32.6% → **12.5%** |
| Opportunity attacks monsters walk into / fight | 1.00 → **0.19** | 0.88 → **0.40** |
| Hero knockdowns / fight | 0.48 → 0.69 | 0.25 → 0.41 |
| Wipes | 54 → 74 (5.4% → 7.3%) | 9 → 9 |

**Difficulty went up**, as you'd expect when monsters stop wasting a quarter of their turns. That is a balance
question, not an AI one; the tuning knob is monster damage or HP, or `PLANNER.monsterMoves = false`.

## Phase 2 — done (2026-11-09)

Roles, formation and triage, all in `turn_planner.js`. Each piece has its own switch: `PLANNER.phase2`, plus
`triage`, `formation` and `safeSpots`.

- **Roles** (`heroRole`) are derived from the build every turn: tank (melee fighter/paladin/barbarian, heavy armour or
  shield), healer (knows a heal), artillery (ranged), striker (other melee). Nothing is stored; Phase 5's Priorities
  tab is where roles get overridden.
- **Tank formation** (`tankFormationBonus`): a *free* tank prefers the monster about to reach a caster and is pulled
  back from fights far from the backline while the backline is threatened.
- **Safe firing spots** (`standRisk`): among firing positions reachable this turn, a ranged hero picks the one fewest
  melee monsters can hit.
- **Heal triage** (`healTriage`): downed allies first, then whoever is about to drop (`inMortalDanger`), then HP that
  actually restores. A non-urgent heal that would mostly overheal waits. Lay on Hands uses the same urgent target.

**What the sims caught.** The first version doubled dungeon knockdowns (0.38 vs 0.19 per fight). Isolating each part
showed formation and safe spots were the cause:
- A tank already in melee peeled off to intercept a newcomer. That cost an opportunity attack and let its first
  monster walk onto the casters.
- "Safe" firing tiles on the far side of the fight were reached by walking past the monsters.

Fixed: no interception while the tank is engaged, and only casters/shooters count as backline. Safety only ranks
tiles reachable this turn.

Measured after the fix (dungeon probe, seeds 7+8, 216 fights each; arena 1008 fights):

| | No Phase 2 | Phase 2 |
|---|---|---|
| Dungeon knockdowns | 53 | **42** (−21%) |
| Dungeon caster left exposed | 8.6% | **5.7%** |
| Dungeon wipes | 6 | 7 |
| Dungeon knockdowns with safe spots off | — | 58 (so safe spots stay on) |
| Arena knockdowns / fight | 0.51 | 0.51 |
| Arena heals going to a safe ally while another was in danger | 3.4% | **2.7%** |
| Arena wipes | 60 | 66 (inside run-to-run noise) |

Phase 2 helps where the geometry matters (corridors, doors) and is neutral in the open arena. The tie-break jitter
in `pickHeroTarget` was cut to stay below the distance tiebreak; Phase 1's smaller per-tile weight had made "nearer
of two equal foes" a coin flip.

Still open: ranged heroes in melee is unchanged (~31% arena, 11–23% dungeon). Monsters walk up to shooters on their
own turn, and the fix for that is the shooter's step-back after shooting, not where it stands.

## The root cause

Neither side **plans a turn**. Both are reactive rule ladders that re-decide every frame:

- **Heroes**: `heroCombat` (combat.js ~1852) is a ladder of ~40 independent checks evaluated every frame.
  Movement is owned by at least five systems that don't know about each other: tactical dash paths
  (`heroTacticalAction` / `dashSavesATurn`), `combatMove` (orbit/shuffle at weapon reach),
  `heroPostAttackWithdraw`, `combatCatchup`, `heroApproachRoute`.
- **Monsters**: `runMonsterBehavior` (monster_ai.js 704) is a fixed priority chain: cycle ability → ranged
  kite/shoot → tactical action → chase/melee.

Every option is scored on its **own ad hoc scale** (spell "priority points", target "threat points",
distance weights). Nothing compares *this* option against *the alternatives* in common units, so there is no
way for the AI to notice "a cantrip does the same job" or "this move gets undone next frame".

## How each reported symptom falls out of that

| Symptom | Cause in code |
|---|---|
| Dash somewhere, then walk back | The dash rule itself is sound, but after the dash a different movement system (withdraw / orbit / catch-up) re-decides the position on the next frame. No system owns "where I end this turn". |
| Big spell on a nearly dead foe | `_scoreSpellForTarget` / `_pickKnownSpell` (combat.js ~3650–3900): score = `priority + lvl*3 − slot cost`, and **any score > 0 casts**. The overkill guard uses a crude damage estimate (`4 + lvl*3.5`) and a capped −14 penalty. It never asks "would the cantrip / weapon attack kill it anyway?" |
| AoE on a single creature | Heroes: `bestAoECenter` needs `minTargets: 2`, but a foe on 2 HP counts as a full target, so "goblin + dying rat" qualifies. Class abilities (Dragon Breath etc.) count bodies, not value. **Monsters: no gate at all.** `tryMonsterCycleAbility` picks a *random* cycle ability every N attacks and centres the AoE on its current target, however many heroes are in the radius (`_castAbilityFx` ~1496). |
| Tank abandons the casters | `pickHeroTarget` (combat.js 732) is greedy per hero: an efficiency/kill score with a distance penalty of only 0.15 per tile. There are no roles, no notion of protecting anyone (unless the `guard_backline` pref is set), and no cost for turns spent travelling or opportunity attacks taken. |

Other weak spots found on the way:

- **No party coordination.** Each hero picks a target alone. Two heroes can both spend big hits on one target
  that the first one kills, and the second wastes their turn or swings at a corpse-to-be.
- **Resource use is random, not reasoned.** A random "conservation gate" sits on top of the spell scores.
  Nothing knows how many fights are left before a rest, so slots are hoarded or dumped by dice.
- **Monster targeting ignores reach and cost.** `pickMonsterTarget` (monster_ai.js 527) is threat + distance + jitter + a
  flat bonus for soft classes. It doesn't consider turns to reach, OAs it would take getting there, or whether
  it can actually hit that target this turn.
- **Monster abilities are cadence-driven.** "Every Nth attack, use a random ability" means a breath weapon
  goes off on one hero while three stand clumped a step away, and a heal or buff fires with no one to use it on.
- **No "why did it do that?" tool.** There is no record of what alternatives were considered, so bad
  choices can't be diagnosed from a bug report.

## The fix: one turn planner for both sides

### Phase 1 — Turn planner core (the major improvement)

At the **start** of each turn, build candidate plans and score them all in the **same unit**
(expected HP-equivalent value), then **commit** to the winner for the rest of the turn.

- **Candidates**: `{ end cell, action, bonus action }`.
  - End cells: reachable with walk or dash, capped to a sensible set (current cell, attack cells per target, safe/cover cells, guard cell).
  - Actions: weapon attack on X, each usable spell on each sensible target or AoE spot, Dodge, Disengage, Help, heal.
- **Score = gain − cost − risk**:
  - **Gain**: expected damage, capped at the target's **remaining** HP (overkill is worth nothing). Plus a kill bonus worth the threat that kill removes (the target's DPR × rounds it would have lived). Plus control value and heals that prevent a downed ally.
  - **Cost**: slot or charge value, scaled by how scarce it is (slots left vs. expected fights before rest). Plus the Action itself when dashing.
  - **Risk**: expected incoming damage at the end cell (enemies that can reach it, OAs taken getting there).
- **Commit**: the executor walks the chosen path and performs the action. It only replans on an
  invalidating event (target died, path blocked, pushed or teleported, new foe appeared). The per-frame
  movement systems become *executors* of the plan, not deciders. That kills dash-and-back at the root.
- **Baseline comparison falls out for free.** A 3rd-level slot on a 4 HP goblin loses to the cantrip because the
  gain is capped at 4 and the slot costs something. AoE value counts only HP it would actually remove,
  so "one goblin + one dying rat" loses to a single-target attack.

This reuses what `combat_eval.js` already has (`effectiveHp`, `damageValue`, `heroAttackEv`, `slotCost`,
`bestAoECenter`, `monsterDpr`): the pieces exist, they just aren't combined into one comparison.

### Phase 2 — Roles and party coordination

- **Roles**, derived from class/build and overridable later by the Priorities tab:
  tank/guard, striker, controller, healer.
  - The tank's plans get a formation term: value for standing between threats and the casters, and a penalty for ending a turn far from the backline while foes can reach it.
  - Chasing a far mob is allowed only when it scores better *including* that penalty.
- **Shared round blackboard**: damage already planned against each target this round. Later heroes see that the goblin is
  "already dead" and choose something else. This gives real focus fire without overkill.
- **Healer triage** on *predicted* damage (who is about to drop given the foes in reach), not on current HP % alone.

### Phase 3 — Monsters on the same planner

- Monster abilities become candidates scored like hero spells:
  - AoE abilities search for the best centre over heroes (mirror of `bestAoECenter`) and need real value in the radius.
  - Heals and buffs need a valid recipient.
- Replace "random ability every N attacks" with **recharge** (5e-style Recharge 5–6, or a cooldown).
  Monsters then use an ability when it is good, not when the counter says so.
- Target choice uses the planner's terms (can I reach and hit them this turn, what does getting there cost), keeping the
  existing flavour: pack focus, drawn to light, soft-caster preference for tactical monsters.
- Combat styles (brute, skirmisher, tank, berserker…) become weight presets on the planner, so a berserker still charges recklessly
  *on purpose*.

### Phase 4 — Verification harness

- **Headless scenario tests**: scripted boards that pin each known dumb behaviour. Examples:
  - The tank stays with the casters when a lone rat is across the room.
  - No Fireball on 1 goblin + 1 rat at 2 HP.
  - No 3rd-level slot on a 4 HP foe.
  - No dash followed by a walk back.
  - A monster breath weapon waits for or seeks a clump.
- **Decision log** (debug overlay / combat-log toggle): the top 3 plans and their scores each turn. A
  "why did it do that?" report can then be answered from the log.

### Phase 5 — AI Priorities tab

Once the planner is in, the tab maps onto its weights (aggression, protect allies, resource thrift, focus
fire, risk tolerance). That is the easy, last step, as Zenu said.

## Suggested order

Phase 1 lands first for **heroes only**, behind the existing ladder's reflexes. Keep the safety reflexes (fleeing hazards, OA-aware
disengage) as hard constraints on candidates. Then Phase 4 tests alongside it, then Phase 2, then Phase 3
(monsters), then Phase 5. Each phase is playable on its own.
