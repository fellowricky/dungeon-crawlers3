# Dungeon Crawlers — Class Balance Simulator

A headless Monte-Carlo harness that generates **randomized parties**, levels
them **1 → 20** with proper level-ups and level-appropriate gear, fights a floor
of encounters at every level, and reports rich combat statistics so you can spot
which classes **run away from the pack** (or lag behind) and tune accordingly.

It reuses the game's own rules code, so as the game evolves the numbers stay
honest with minimal upkeep.

## Quick start

```sh
node sim/run.mjs                          # default sweep (150 parties → L20)
node sim/run.mjs --parties 400 --seed 7   # bigger, reproducible run
node sim/run.mjs --maxLevel 20 --encounters 8 --partySize 5
node sim/run.mjs --quiet                  # write reports without console dump
```

Reports are written to `sim/reports/`:
- `balance_latest.md` / `balance_<timestamp>.md` — human-readable report
- `balance_latest.json` / `balance_<timestamp>.json` — full machine-readable data

### CLI flags

| Flag | Default | Meaning |
|---|---|---|
| `--parties N` | 150 | number of randomized parties to simulate |
| `--partySize N` | 4 | heroes per party |
| `--maxLevel N` | 20 | level each party is raised to |
| `--encounters N` | 6 | encounters per level (one "floor", boss-capped) |
| `--seed N` | 1337 | RNG seed — same seed ⇒ identical run |
| `--quiet` | off | suppress progress + console report |

A run of ~250 parties (1000 hero-runs) to level 20 takes ~15s.

## What the report tells you

- **Class Summary** — per-class averages sorted by damage-per-round (DPR), with
  `z⚔` (offense) and `z🛡` (defense) z-scores versus the cross-class mean.
- **Outliers** — classes flagged at `|z| ≥ 1.5` (the "runaways" and the laggards),
  plus the top-to-bottom DPR spread ratio.
- **Damage-per-round by level** — a level 1–20 power curve per class. This is
  where feature spikes show up (e.g. martials jumping at L5 and L11 as Extra
  Attack comes online).
- **Metrics:** `DPR`, damage dealt/taken/healed per encounter, kills/encounter,
  hit%, crit%, knockdowns/encounter, and floor-KOs.

## How it works (architecture)

```
run.mjs          CLI + orchestration: build party → level 1..20 → fight floors → report
 ├─ rng.mjs      seeded Math.random so a whole run is reproducible from one seed
 ├─ herogen.mjs  party generation, deterministic auto-leveling, auto-gearing
 ├─ combat_sim.mjs   turn-based encounter model + per-hero stats + spell + perk layers
 └─ report.mjs   aggregation, z-scores, Markdown + JSON output

value.mjs        SEPARATE entry point: prices gear affixes + perks in points
```

---

# Gear valuation harness (`value.mjs`)

Answers *"what is +1 of X actually worth?"* so the loot budget system can price
every bonus in one currency instead of by feel.

```sh
node sim/value.mjs                                  # default sweep
node sim/value.mjs --trials 120 --levels 3,7,12,17
node sim/value.mjs --only cleave,lifesteal --quiet  # anchors always included
```

Writes `sim/reports/value_latest.md` and `value_latest.json`.

| Flag | Default | Meaning |
|---|---|---|
| `--trials N` | 40 | paired trials per candidate **per level** |
| `--levels a,b,c` | 3,7,12,17 | character levels sampled |
| `--partySize N` | 4 | heroes per party |
| `--encounters N` | 6 | encounters in the offense gauntlet |
| `--defenseBouts N` | 4 | punching-bag wipes per defense arm |
| `--seed N` | 4242 | base RNG seed |
| `--only k1,k2` | all | measure just these candidate keys |

## Method

**Paired A/B trials with common random numbers.** Each candidate is measured by
building a party from a seed, levelling it, and running it through a gauntlet
twice — once clean, once with the candidate injected as a synthetic equipped
item. Both arms rebuild from the same seed and reset to the same combat stream,
so they share their rolls until the candidate itself causes divergence.

**Two metrics, measured in separate modes** so they cannot contaminate each other:

- **O (offense)** — a normal gauntlet. Party damage dealt per hero-round.
- **D (defense)** — a "punching bag" encounter whose monsters have their HP
  inflated so far they cannot die, run until the party wipes. D is the number of
  monster attacks absorbed.

The separate defense mode is the load-bearing part. An earlier version measured
defense inside the normal gauntlet, normalising damage taken per monster attack.
That still leaked: killing faster ends the fight sooner and shifts the mix of
incoming attacks away from bosses, so `+1 atk` scored ~half the defensive gain of
`+1 AC`. That made the anchor equation degenerate (denominator ≈ 0) and blew the
solved weight up to ~142, producing confident-looking nonsense. With immortal
monsters, offense cannot shorten the fight, so ΔD for a pure-offense bonus
averages to ~0 — while mitigation, HP, healing and lifesteal all still register.

## The exchange rate is *not* invented here

The design fixes two anchors by decree: **+1 atk = 10 points** and
**+1 AC = 20 points**. The harness measures ΔO and ΔD for both, then solves for
the single weight `w` in

```
value = ΔO% + w · ΔD%
```

that makes those two anchors land on 10 and 20. Every other bonus is priced with
that same `w`. So the offense/defense exchange rate stays the designer's call,
and everything else is measured consistently against it.

The report prints a **conditioning** percentage — how large the solve's
denominator is relative to the AC arm's own defensive gain. Above ~50% is
healthy; a low value means defense is leaking into the offense anchor again and
the costs should not be trusted.

## Reading the report

`±` columns are standard errors. **A bonus whose ΔO and ΔD both sit inside their
error bars is measuring noise, not value** — raise `--trials` before believing a
small number. The per-level table is the noisiest part of the report (it divides
the sample by the number of levels); treat it as a shape, not as figures.

Bonuses the combat model cannot represent report as `unmodeled` rather than
silently pricing at zero — `speed` is the current example, since the abstract
model has no positions or movement.

## What this harness CANNOT price

The two-mode split is what makes offense and defense separable, but it leaves a
gap for effects that *convert one into the other*. These need a hand-set value;
the sim gives a floor, not an answer.

- **Sustain that feeds on your own damage (`lifesteal`)** — in the punching-bag
  mode the monsters cannot die, so lifesteal has an unbounded damage source to
  heal from and the party simply never wipes. Unbounded, it scored **332 points**
  (per-level: 34 → 216 → 620 → 458 — a clear runaway). `--defenseRoundCap`
  bounds it to ~41, but survival past the cap is **censored**, so that number is
  a LOWER BOUND, not a price.
- **Anything gated on a kill (`phaseStep`)** — it procs on kill, nothing can die
  in defense mode, so it never fires; and its benefit (AC after a kill) is not an
  offense stat, so the gauntlet mode misses it too. It falls between both modes
  and scores ~1 point. That is a measurement gap, **not** a finding that the perk
  is worthless.

`thorns` and `riposte` look similar but are fine: their contribution is damage,
which the offense gauntlet measures correctly. Their exact-`0.00%` ΔD is expected
— retaliation does nothing to an immortal monster, so both arms stay bit-identical.

Two further caveats on every number here:

- Candidates are applied to **every hero in the party**, not one item. Consistent
  across candidates, but effects with party-level synergy (several heroes
  cleaving one pack) may read slightly superlinear.
- An exact `0.00% ± 0.00%` ΔD is not a measurement — it means the candidate never
  perturbs the RNG stream in that mode, so both arms replay identically. Correct,
  but it is a structural zero rather than an averaged one.

## Extending it

- **New affix** → add an entry to `CANDIDATES` in `value.mjs`. Anything that
  flows through `recalc` needs nothing else.
- **New perk** → add it to `PERK_MAGS` in `items.json` and implement its proc in
  the `PERK_LAYER` blocks of `combat_sim.mjs`; the sweep picks it up automatically.
- **A stat the engine doesn't have yet** (saving throws, elemental damage,
  granted spell slots, combat movement) **cannot be measured until it exists in
  `recalc`/combat.** Add the mechanic first, then the candidate.

### Fidelity — what's real vs. modeled

**Real (imported from `src/game`, tracks the game automatically):**
- Character construction (`makeHero`), all derived-stat math (`recalc`).
- The level-up ladder (`grantXp` / `applyLevelGrants`): features, Extra Attack,
  subclass milestones, spell slots.
- Progression choices via the real APIs (`spendAbilityPoint`, `spendSkillPoint`,
  `pickSubclass`, `resolveChoice`).
- Loot + equipping (`rollItem`, `canEquip`, `aggregateEquipment`).
- Damage dice (`heroDamage`, `featBonusDamage`, `featExtraAttacks`) and monster
  offense (mirrors `monster_ai.js`: d20 + atk vs AC, crit-doubled dice).
- Spell dice mirrored from `spells.js` into a small table.

**Modeled (the abstraction + feature layer):**
- Combat is **turn-based rounds**, not the real-time spatial engine — positions,
  pathfinding, and cooldown clocks are removed (one action each per round).
- Monsters target heroes **uniformly at random** (no positional aggro) so
  survivability differences trace to AC / HP / mitigation.
- Every hero uses the same **"recommended build"** policy (standard array by stat
  priority, ASIs over feats) — chassis-vs-chassis comparison.
- A hand-written **feature layer** covers the high-impact combat levers: Extra
  Attack, off-hand, Action Surge, Flurry, sneak attack, rage, divine smite,
  favored enemy, Second Wind, Eldritch Blast beams, Agonizing Blast, leveled
  slot spells, healer casting, and a few conditional subclass procs. Flat
  subclass / skill / gear bonuses flow in automatically via `recalc`.

## Extending it as the game grows

The simulator is built to be re-run and extended. Common changes:

- **New class feature that affects combat** → add a small `FEATURE_LAYER` block in
  `combat_sim.mjs` (grep for `FEATURE_LAYER`). Flat stat bonuses need *nothing* —
  they already flow through `recalc`.
- **New damage spell** → add its dice to the `SPELL_DAMAGE` table in
  `combat_sim.mjs` (keys match `SPELL_POOLS` ids in `spells.js`).
- **New conditional subclass proc** → add a `case` in `subclassConditionalDamage`
  (keyed by the subclass `passiveKey`).
- **Try a different "recommended" build** → edit `POLICY` in `herogen.mjs`
  (stat array, ASI-vs-feat preference, skill-spend priority).
- **New metric** → add a field in `initHeroStats` (combat_sim), populate it during
  combat, and surface it in `aggregate` / `renderMarkdown` (report.mjs).

## Known simplifications

- No terrain, line-of-sight, kiting, or focus-fire aggro — a deliberate control.
- Monster saving throws vs. hero spells use a flat "40% chance to halve"
  approximation rather than per-monster save math.
- Warlocks spam multi-beam Eldritch Blast and treat leveled slots as secondary
  (a slight underestimate of their burst).
- Buff/utility/control spells (Hold Person, Bless, Faerie Fire, Slow…) are not
  modeled — only direct damage and healing.

These are the first places to invest if a class's real in-game behavior diverges
from what the sim predicts.
