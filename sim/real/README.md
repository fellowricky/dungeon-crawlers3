# Real-game balance runs

Plays the **real game** in hidden browsers, in fast-forward, and records every
fight. Unlike `sim/run_headless.mjs`, nothing is stubbed: it is the same `Game`
class, floor generator, spawn system, loot and AI the player gets.

## Run a batch

The dev server must be running (`npm run dev`, port 5173).

```sh
node sim/real/runner.mjs --level 5 --runs 24 --workers 8
```

| Flag | Default | Meaning |
|---|---|---|
| `--level N` | 1 | party level and quest level |
| `--runs N` | 8 | number of floors to play |
| `--workers N` | 4 | hidden browsers running at once |
| `--floor X` | dungeon | `road` (first overland day), `dungeon` (first floor below), `boss` (last floor), or a floor number |
| `--floors N` | 1 | floors per run (the bot just clicks Descend at the camp) |
| `--seed N` | 1 | same seed = same parties and quests |
| `--classes a,b,c,d` | random | fix the party's classes |
| `--maxGameMin N` | 60 | give up on a floor after this much game time |
| `--show` | off | visible browser windows, to watch a run |

Output goes to `sim/reports/real_L<level>_<floor>_<time>.jsonl` (one record per
run) and a `.md` summary. Re-summarise any records with
`node sim/real/report.mjs <file.jsonl> [...]`.

Watch a single job in a normal browser tab:

```
http://localhost:5173/?sim&job={"level":5,"partySeed":11,"questSeed":21,"floor":"dungeon"}
```

The result lands on `window.__simResult`.

## What a run is

1. `party.js` builds a party at the level: level by level, with the bot's picks
   at each level-up and a ration of loot rolled from the game's item tables.
   A level 1 party is exactly a new game's party.
2. `run.js` drops that party into the game, generates a real quest of that level
   with the game's own quest generator, and embarks on the chosen floor.
3. The game's `update()` is stepped at a fixed 1/60 s. The bot (`bot.js`)
   resolves level-ups and equips upgrades whenever the party is out of combat.
4. The run ends when the floor is cleared, the party wipes, or time runs out.

## What is not the real thing

- **Picture-only work is skipped** (`SIM.fast`, `src/game/sim_flags.js`): drawing,
  the floor's darkness tint, sprite shading, status aura effects. The light
  level the rules read is still computed, by a faster path that `SIM.verify`
  checks against the original (0 mismatches in 12 million comparisons).
- **Built parties are a guess.** `GEAR` in `party.js` sets how much loot, gold and
  potions a party of each level has. It has not been checked against real saves.
- **Picks are random within reason** (`POLICY` in `bot.js`), not a good player's.
- **A wipe ends the run.** The real game respawns the party with a penalty.
- **Game time is not real play time.** Real-time waits (reveals, timers) still
  take real seconds while the game clock runs ahead.
- Each job runs on a fresh page; nothing is carried between jobs.

## Traps

- Editing any file a running page has imported makes Vite reload that page and
  the job starts over.
- `runner.mjs` kills its browsers when it finishes. If you kill the runner
  itself, stop the leftover `chrome.exe` processes whose command line contains
  `dc-sim-profiles`.
