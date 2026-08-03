# Dungeon Crawlers — Class Balance Report

Generated: 2026-08-01T06:06:12.513Z

**Config:** seed `1337` · 3 parties × 4 heroes · levels 1–3 · 2 encounters/level · 12 hero-runs sampled

## Class Summary (sorted by damage-per-round)

| Class | N | DPR | z⚔ | Dmg/Enc | Taken/Enc | z🛡 | Heal/Enc | Kills/Enc | Hit% | Crit% | Down/Enc | KOs |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Wizard | 1 | 16.3 | **+2.45** | 40.8 | 11.3 | -0.89 | 0 | 0.5 | 75.0% | 12.5% | 0.33 | 1 |
| Ranger | 1 | 10.7 | +0.83 | 32 | 2 | **+1.52** | 0 | 1.67 | 94.1% | 11.8% | 0 | 0 |
| Bard | 1 | 9.9 | +0.61 | 26.3 | 9.2 | -0.33 | 5.8 | 1.33 | 71.4% | 21.4% | 0.17 | 1 |
| Sorcerer | 1 | 9.6 | +0.52 | 28.7 | 3.7 | +1.09 | 0 | 1 | 50.0% | 0.0% | 0.17 | 1 |
| Rogue | 1 | 7.3 | -0.12 | 22 | 7.3 | +0.14 | 0 | 0.33 | 73.3% | 6.7% | 0 | 0 |
| Cleric | 2 | 6.8 | -0.27 | 27.7 | 5.3 | +0.68 | 7.8 | 1.25 | 51.6% | 0.0% | 0.08 | 1 |
| Barbarian | 1 | 6.5 | -0.35 | 19.5 | 5.5 | +0.61 | 0 | 0.5 | 72.2% | 11.1% | 0 | 0 |
| Paladin | 1 | 5.3 | -0.69 | 26.7 | 15.7 | **-2.01** | 2.2 | 0.83 | 53.3% | 6.7% | 0.17 | 1 |
| Druid | 1 | 4.6 | -0.91 | 22 | 8.7 | -0.21 | 0 | 0.5 | 31.6% | 0.0% | 0.17 | 1 |
| Monk | 1 | 4.4 | -0.95 | 24.2 | 5.7 | +0.57 | 0 | 1.17 | 47.1% | 2.9% | 0.17 | 1 |
| Beast | 1 | 3.8 | -1.12 | 10.8 | 12.3 | -1.15 | 0 | 0.67 | 52.9% | 0.0% | 0.17 | 1 |

> `z⚔` = offense (DPR) standard-deviations from the cross-class mean; `z🛡` = defense (higher means takes *less* damage than average). `|z| ≥ 1.5` is flagged below.

## Outliers — who runs away from the pack?

- **🔥 Over-performing damage (z⚔ ≥ 1.5):** Wizard (DPR 16.3, z **+2.45**)
- **🥶 Under-performing damage (z⚔ ≤ -1.5):** none
- **🛡 Unusually durable (z🛡 ≥ 1.5):** Ranger (2 taken/enc)
- **💀 Unusually fragile (z🛡 ≤ -1.5):** Paladin (15.7 taken/enc, 1 floor-KOs)

**DPR spread:** 16.3 (Wizard) → 3.8 (Beast) — top class does **4.27×** the bottom class's damage-per-round.

## Damage-per-round by level

| Lvl | Wizard | Ranger | Bard | Sorcer | Rogue | Cleric | Barbar | Paladi | Druid | Monk | Beast |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5.9 | 5.5 | 4.6 | 1.9 | 4.2 | 2.4 | 4.8 | 4.3 | 1.7 | 1.6 | 2 |
| 2 | 27.5 | 10.1 | 8.6 | 17.6 | 6 | 6.4 | 7 | 5.1 | 5 | 5.4 | 3.6 |
| 3 | 24.8 | 17.6 | 15.3 | 11.8 | 13 | 11.1 | 7.8 | 6.3 | 5.6 | 5.8 | 5.8 |

## Methodology & fidelity

- **Character math is the real game's.** Heroes are built with `makeHero`, leveled through the real `grantXp`/`applyLevelGrants` ladder (features, Extra Attack, subclass milestones, spell slots), and re-geared from real `rollItem` loot they can actually equip (`canEquip`). Damage uses `heroDamage` + `featBonusDamage`; monster offense mirrors `monster_ai.js`.
- **Combat is abstracted, not spatial.** The real combat loop is real-time and THREE.js-coupled, so this harness models it as clean rounds (one action each per round, shared cadence). Positioning, pathfinding, and cooldown clocks are removed.
- **Modeled feature layer:** Extra Attack, off-hand, Action Surge, Flurry, sneak attack, rage, divine smite, favored enemy, Second Wind, healer casting, and a few conditional subclass procs. Flat subclass/skill/gear bonuses flow automatically through `recalc`. Extend `FEATURE_LAYER` blocks in `combat_sim.mjs` as the game grows.
- **Controls:** monsters pick targets uniformly at random (no positional aggro) so survivability differences trace to AC/HP/mitigation; every class is built with the same "recommended" policy (standard array by stat priority, ASIs over feats) so the comparison is chassis-vs-chassis.
- **Sneak attack** assumes a flanking ally whenever the party has another living member.
- **Metrics:** `DPR` = damage per round while engaged (the cleanest speed-of-kill measure). `Down/Enc` = times knocked to 0 HP per encounter. `KOs` = distinct floors where the hero was knocked out (revived on the long rest between floors — the sim has no permadeath).
