# Marketing Campaign — Dungeon Crawlers

**Goal:** Steam wishlists, pointing at a paid release.
**Constraints:** solo dev, ~2–3 hrs/week on marketing, voice-only (no face on camera).
**Written:** 2026-08-06 · Game state: v0.2, playable, ~20-chapter arc designed, pixel UI pass in flight.

---

## 0. The strategic reality (read this first)

Wishlists do not come from posting a lot. For a solo dev the distribution is roughly:

| Source | Share of a typical solo-dev wishlist total |
|---|---|
| Steam's own surfaces (Next Fest, Popular Upcoming, tag pages, "More Like This") | the majority |
| 2–5 external spikes (one Reddit post that hits, one streamer, one aggregator) | most of the rest |
| Steady weekly social drip | small, but it *creates* the spikes and compounds |

Numbers below (Popular Upcoming ~7–10k wishlists, first-week wishlist→sale conversion ~10–20%) are
community benchmarks, not published by Valve. Treat as direction, not promise.

The implication for a 2–3 hr/week budget: **spend disproportionately on the one-time assets that
multiply every visit forever** (name, capsule, trailer, store page, demo) and keep the recurring
cadence deliberately small and batched. A great store page converts every visitor for years. A great
tweet converts once.

**Single call-to-action for the entire campaign, from the day the page is live: "Wishlist on Steam."**
Not Discord, not the newsletter, not the web build. One CTA. Everything else is a supporting link.

---

## 1. Positioning

### The hook

> **An idle dungeon crawler that actually runs D&D 5e.**
> Real initiative order, spell slots, opportunity attacks, two-weapon fighting, concentration —
> a full SRD 5.1 rules engine. Then it plays itself while you watch.

The tension in that sentence *is* the marketing. "Idle" promises zero effort; "actual 5e rules"
promises depth. Most idle games fake their combat with a damage number. Yours resolves a real
d20 against a real AC and you can watch it happen in 3D. That contrast is the whole pitch and it
should appear in the Steam short description, the trailer's first 5 seconds, and every Reddit title.

### Who this is actually for (in priority order)

1. **The incremental/idle audience.** Largest, most reachable, most underserved by quality. They
   remember *Clickpocalypse 2* with real affection and nothing has replaced it. `r/incremental_games`
   is unusually welcoming to in-development posts. **This is your primary audience — build for them.**
2. **5e players who want a D&D thing running in the background.** Enormous, diffuse, hard to target,
   but converts hard when reached. The "it's real SRD rules" claim is aimed squarely at them.
3. **Roguelite/dungeon-crawler generalists.** Big but crowded; you win them via Steam tags, not posts.

### Differentiators, ranked by how well they sell

1. Genuine 5e rules under an idle loop (nobody else does this)
2. It's *watchable* — 3D procedural dungeons, not a spreadsheet
3. Party building and gear with real 5e weapon properties
4. A 20-chapter authored story arc with a genuinely good twist (see `STORY_ARC.md` — the Charter
   being a sacrificial contract, and the idle grind itself being the theme, is strong. **Do not
   spoil it.** Tease "the Guild is counting something" and let people theorize.)
5. Per-hero AI priority knobs — the automation-tuning audience loves this; lead with it for
   `r/incremental_games` and the Automation tag.

### Name

**Rename before the store page goes up.** "Dungeon Crawlers" is a genre descriptor: unsearchable on
Steam, untrademarkable, and invisible in a thread title. Criteria for the replacement — two words or
one compound, zero existing Steam results, speaks to the *Charter/ledger* premise rather than to
"dungeon."

**Rejected: "Dungeons and the Delvers."** Three reasons, descending severity:
1. *Dungeons & Delvers* is an existing published tabletop RPG line (Awful Good Games, David Guyll
   & Melissa Fisher — Black Book, Red Book, multiple Kickstarters). Same genre, adjacent market,
   actively selling. Adding "the" reads as a typo of theirs, not as distance from them.
2. The "Dungeons and ___" construction is the single shape to avoid while shipping SRD 5.1 content.
   The SRD's CC-BY-4.0 grant covers rules text and explicitly conveys **no trademark rights**;
   the compliance line is "do not imply affiliation with D&D." That name walks at it.
3. "and the" is grammatically awkward and lengthens the title for no gain.

**Also rejected, collisions verified 2026-08-06:**
- *Dungeon Delvers* / *Dungeon Delver* — taken
- *Marching Order* — a solo/co-op dungeon-delving RPG zine (Crumbling Keep). Adjacent market.
- *Hirelings* — *Root: Hirelings & Landmarks* (Dire Wolf Digital), plus *Hireling* on itch.io

### Do NOT put "Idle" in the title

Counter-intuitive but important for a **paid** release. "Idle" in a Steam title reads as
free-to-play mobile and suppresses perceived value — and the incumbent in this exact niche
(*Idle Champions*, see §6) genuinely *is* F2P. Standing next to it with "Idle" in the name invites
the wrong comparison. Let the `Idler` tag, the short description, and a subtitle do the genre work.
Steam indexes the full title string, so a subtitle costs nothing in search.

### Tone is a selection criterion, not just clarity

`STORY_ARC.md` is **grim**: monsters fleeing something worse, a charter that is a sacrificial
contract with good marketing, a hermit who has counted adventurer deaths for forty years and found
the number held constant. Warm, alliterative, ampersand-style titles (*Torch & Tally*) read cozy —
shopkeeper sim, coffee-shop sim — and mis-sell the game. The title must carry institutional cold.

### The naming lesson (learned the hard way, ~10 collision searches)

**Generic dark-fantasy vocabulary is exhaustively mined.** Ash, ashen, deep, deeper, corpse, grave,
delve, endless, still, torch, hollow — every combination is taken, usually several times, usually by
a game in this exact genre. Every candidate that survived a collision check came from **this
project's own story vocabulary**. Draw from `STORY_ARC.md`, not from a dark-fantasy word pool.

Also note: **"low fantasy" is bureaucratic, not gothic.** The register is indentures, tithes,
charters, ledgers, bad paperwork with lethal consequences — not skulls and demons. Names that carry
institutional coldness fit this game better than names that carry atmosphere alone.

### Shortlist — verified collision-free (2026-08-06)

| Name | Signals | Trade-off |
|---|---|---|
| **Torch & Tithe** ⭐ | *Torch* = dungeon-native and inherently precarious (it burns down, it gutters). *Tithe* = a compulsory payment to an institution — cold and faintly menacing with no skulls in it. Together: the plot. Every company that signs the charter and dies pays into a seal nobody disclosed. **That is a tithe.** | None significant |
| **Torchfall** | Simpler, ominous — a torch going out. One word, ownable. | Less specific about what the game is |
| **Deepwick** | Coined compound, maximally ownable. A wick burning down in the deep. | Reads slightly abstract |
| **The Bone Census** | Ch6 title. *Census* = an institution counting corpses as routine. | Too dark — over-corrects past the target register |
| **The Long Roll** | Ch4 memorial rite. Military drum-call / roll-call of the dead / endless dice roll. | Excellent register, weakest genre clarity |
| **Marrowfen** | Ch5 location. Invented compound, unmistakably dark fantasy. | Says nothing about the game; leans entirely on the subtitle |

### Calibrating tone — the useful middle

Three data points bracket the target register:
- *Torch & Tally* — **too cozy** (shopkeeper sim)
- *The Bone Census* — **too dark** (horror)
- *Torch & Tithe* — dark fantasy: **bureaucratic menace, not gore**

The winning register is institutional dread. Low fantasy's horror is a contract, not a corpse.

**Rejected, with reasons:**
- *Torch & Tally* — clear, but tonally cozy; mis-sells a bleak game
- *The Endless Company* — "Endless" is Amplitude Studios' franchise (Endless Space/Legend, and
  **Endless Dungeon**, a roguelite dungeon game). Would read as an Amplitude product in-genre.
- *Ashen Company* / *Company of Ash* — *Tales of Soravos: Ashen Company* (Pathfinder 2e tactical
  RPG) and *Sellswords: Ashen Company* (mercenary RTS). Same space, twice.
- *The Indenture* — taken; visual novel on Steam
- *Tallowlight* — too near *Tallowmere*, a Steam dungeon roguelite
- *Corpse Road* — clear, but reads horror on Steam beside the *Corpse Party* shelf
- *Autodelve* — clear, but reads as a tool rather than a place; explains the mechanism, evokes nothing
- *Ever Deeper* — *Everdeeper* exists on itch.io
- *Feed the Deep* — taken; Lovecraftian roguelike, 20–50k owners
- *Deeper Still* — taken; immersive sim
- *Grave Shift* — two *Graveyard Shift* games; pulls toward horror
- *Passive Perception* — clever, but risks reading as detective/horror
- *The Retainers* — clear on Steam, but FFXIV owns the term colloquially
- *Deepshift* — reads modern rather than fantasy
- *Torches and Tales* / *Tale of Torches* — cozier than *Torch & Tally*, not darker; and
  **Bandai Namco's "Tales of" franchise** (20+ games) dominates that search space. *Torches of
  Fate* also already occupies the neighbourhood.

**Recommendation: `Torch & Tithe` — subtitle `An Idle Dungeon Crawler`.**

Keeps everything that worked about *Torch & Tally* — rhythm, alliteration, the ampersand shape, the
torch — and swaps only the second word. *Tithe* changes the entire temperature: cold, institutional,
faintly menacing, no gore. Dark fantasy rather than grimdark, which is the stated target.

And it states the twist on the store page without anyone noticing until Ch6.

Before committing, run through: Steam search, USPTO/EUIPO trademark search, `.com` and social
handle availability.

---

## 2. Phases

### Phase 0 — Foundations (weeks 1–3, ~8 hrs total, front-loaded)

The only phase that justifies going over budget. Nothing else works until this is done.

- [ ] **Resolve the LPC license chain.** *Not* the blocker it first appeared to be — see the audit
      in §7. Neither CC-BY-SA nor GPL bans commercial sale, and most LPC assets are disjunctively
      multi-licensed, so you may simply **elect OGA-BY 3.0** (attribution only, no share-alike).
      Three concrete sub-tasks, in priority order:
  - [ ] **Resolve the 87 files with no credit record** — 76 of them are the entire `waist/`
        category, which is undocumented *upstream* too. File an issue against the LPC generator
        repo, or drop belts/sashes. Not a blocker, but the only genuine unknown.
  - [ ] **Replace or drop the 61 stuck categories** (CC-BY-SA/GPL only). Mostly cosmetic — beards,
        ~31 hairstyles, hats, 9 weapons. Real losses: elven ears, muscular body,
        minotaur/wolf/zombie heads. Elven ears matter for a D&D game; source a replacement from
        the permissively-licensed 85% of LPC.
  - [ ] **Write the license election into `CREDITS.md`**, stating explicitly that for
        multi-licensed assets the project elects OGA-BY 3.0, plus a per-asset attribution screen
        in-game. This is the compliance deliverable.
- [ ] **Ship with Steam DRM disabled.** It's optional, and it sidesteps the GPLv3 §3 /
      CC-BY-SA §4(a) anti-technological-measures clauses entirely for any copyleft assets that remain.
- [ ] **Fix the TomMusic SFX redistribution issue** if the repo is ever going public.
- [ ] **Lock the new name.** Steam search, trademark search, domain + social handles.
- [ ] **Steam Direct account.** $100 per app, recoupable after $1,000 adjusted gross revenue.
      Allow ~30 days for tax/banking verification — start this early, it's dead time otherwise.
- [ ] **Reserve the app name** the moment the account clears.
- [ ] **Start a capture habit now:** every playtest session runs with a recorder. Clips cost
      near-zero when captured as a byproduct of work you're already doing, and cost 45 minutes each
      when you have to go set them up later. This single habit is what makes 2 hrs/week viable.

### Phase 1 — Store page (weeks 3–8, ~15 hrs total)

The page is the campaign. Get it live early — it accrues wishlists passively from Steam's own
tag and discovery surfaces the entire time you're building.

**Capsule art (highest-ROI single asset).** The main capsule appears at ~231×87px in most
placements. It must read at thumbnail size: one silhouette, high contrast, the logo legible.
Do not put a party of four on it. You have local generation tooling — but capsule art is the one
asset worth paying a human illustrator for if the budget exists. It is the difference between a
5% and a 12% click-through on every Steam impression you will ever receive.

**Short description (the ~300 chars under the trailer).** Lead with the contradiction:

> A party of adventurers descends without you. Real D&D 5.1 rules — initiative, spell slots,
> opportunity attacks — resolved automatically, in 3D, forever. Build the party, tune their
> instincts, read the ledger, and find out what the Guild is really counting.

**Tags** (order matters — Steam weights the first few; these determine which tag pages you appear on,
which is a large share of your passive wishlists):

`Idler` · `Automation` · `Party-Based RPG` · `Dungeon Crawler` · `RPG` · `Procedural Generation` ·
`Turn-Based Tactics` · `Roguelite` · `Fantasy` · `Story Rich` · `Pixel Graphics` · `Singleplayer` ·
`Character Customization` · `Management` · `Strategy RPG`

`Idler` and `Automation` first is deliberate: it puts you in front of the audience most likely to
convert, on the tag pages with the least competition for your specific hook.

**Screenshots** — 5 minimum, in this order (order is the viewing order):

1. Party mid-combat in a lit 3D dungeon, damage numbers and health bars visible — sells the watch
2. Character sheet, 5e stats and equipment visible — sells the depth
3. AI Priorities tab with the sliders — sells the automation hook
4. World map with quest chain — sells the scope
5. A skill-challenge card choice — sells that it isn't purely passive

**Trailer** (60–75s, voiced — this is where your voice-only preference pays off):

| Time | Beat |
|---|---|
| 0:00–0:05 | Cold open on combat, no logo. A d20 roll resolving against an AC, on screen. VO: "It rolls real dice." |
| 0:05–0:20 | The hook stated plainly: real 5e rules, running by itself. Fast cuts of initiative, spell slots, an opportunity attack. |
| 0:20–0:40 | Depth: party building, gear with real weapon properties, the AI priority sliders. |
| 0:40–0:55 | Scope: world map, biome variety, a boss. One line of story tease — "the Guild keeps a ledger." |
| 0:55–1:05 | Logo, "Wishlist Now," Steam page. |

Cut the trailer *last*, from clips already banked by the capture habit. Never shoot a trailer from
scratch.

### Phase 2 — Drip and community (weeks 8–30, the 2–3 hrs/week steady state)

This is the sustainable cadence. Batch it — one session per week, not daily fiddling.

**Weekly (~60–75 min, one sitting):**
- Pick the best clip from the week's capture folder, trim it, caption it
- Post to: Bluesky, X, `r/incremental_games` (only when genuinely substantial), Mastodon if you use it
- Saturday: `r/gamedev` Screenshot Saturday, `#screenshotsaturday`
- Reply to every comment for the first 2 hours. This matters more than the post.

**Monthly (~60–90 min, replaces that week's clip session):**
- One voiced devlog, 6–10 min, on YouTube. Your monthly "big rock."
- **The devlog topics write themselves from your existing dev artifacts** — this is a genuine
  advantage most devs don't have. `sim/` (the Monte-Carlo class-balance simulator), the loot
  point-budget rework, the spawn-budget tier-pricing trap, `tools/build_tile_atlas.py`, the
  turn-engine PHB diagonal-movement math. "I built a simulator to balance 20 D&D classes and the
  results surprised me" is a video that finds an audience well beyond your genre.
- Cross-post the devlog to `r/incremental_games` and `r/gamedev` as a written post with the video
  embedded — the written version consistently outperforms a bare link.

**Quarterly (~2 hrs):**
- Re-cut the trailer with current footage. Refresh screenshots. The store page should never show
  six-month-old builds.

**Community channels — deliberately minimal.** At 2–3 hrs/week, do **not** open a Discord yet. An
empty or unattended Discord actively damages perception, and moderation is an unbounded time sink.
Instead: **a Steam page + an email list** (one embedded signup on a one-page site). Email is the
only channel you own, it converts at launch far better than social, and it costs nothing between
sends. Open the Discord at demo launch, when there's finally something to talk about.

### Phase 3 — Demo + Next Fest (the single biggest lever)

**Steam Next Fest is the highest-wishlist-per-hour event available to you.** Rules: you get one per
game, it must be before release, and you need a playable demo. Valve runs it roughly three times a
year (Feb / June / Oct). It can plausibly out-produce a year of weekly posting in a single week.

Plan the entire campaign backward from a chosen Next Fest:

- **T-4 months:** pick the fest, commit to the date
- **T-2 months:** demo feature-complete and in testing
- **T-6 weeks:** demo live on the page (a demo raises wishlist conversion on its own, independent
  of the fest)
- **T-2 weeks:** press/streamer outreach — small creators who cover idle and incremental games
  specifically, not the big channels. Personalized emails, 20 of them, not 200.
- **During:** livestream if you can bear it (voice-only is fine), answer every single comment,
  patch the demo daily. Visible responsiveness during the fest converts unusually well.

**Demo scoping:** first 2–3 chapters, ending on a deliberate hook — the Ch4 Charter signing, where
`investigation` lets you actually read the clause, is a near-perfect demo ending. It's the moment
the game reveals it's smarter than it looked, and it's a cliffhanger.

### Phase 4 — Launch

- Store page must be live **at least 2 weeks** before release (Steam requirement).
- Announce the date ~4 weeks out; a date announcement is itself a wishlist event.
- Launch discount: 10–15% is standard and measurably improves week-one conversion.
- Email your list on day one. It will likely outperform every social channel combined.

---

## 3. Milestones and honest targets

Calibrated for 2–3 hrs/week, solo, no existing audience. These are checkpoints, not promises.

| Milestone | Wishlists | Read |
|---|---|---|
| Store page live + 1 month | 100–300 | Baseline. Page and tags are functioning. |
| First post that lands on `r/incremental_games` | +200–800 in a few days | Your hook is real. Lean into it. |
| Demo live | +300–1,000 | The game survives contact with players. |
| Next Fest week | +1,000–5,000 | Widest realistic band; depends heavily on capsule and trailer. |
| Launch | 3,000–7,000 total | A solid, self-respecting solo indie launch. |

If you're below 500 wishlists three months after the page goes live, the problem is almost always
the **capsule or the hook**, not the posting frequency. Change the asset, not the cadence.

---

## 4. What to explicitly not do

- **No Discord until the demo.** Unbounded time sink, and an empty server reads as a dead project.
- **No paid ads pre-launch.** Wishlist acquisition via ads does not pay back at indie scale.
- **No daily posting.** Weekly and batched beats daily and erratic, and it's the only thing that
  survives a real dev schedule.
- **No TikTok.** Highest effort-per-wishlist for a slow, systems-heavy game. The format fights you.
- **Don't spoil the Act III–V twist.** It's the best asset in `STORY_ARC.md` and it is worth more as
  a launch-week discussion driver than as a marketing beat.
- **Don't market the engineering to players.** The Delaunay triangulation and the mixin architecture
  belong in the devlogs, aimed at devs. Players want to know what happens when the party opens the door.

---

## 5. This week

1. Open the Steam Direct account — ~30 days of pure waiting, so start the clock first
2. `git pull` in `lpc_repo` (55 commits behind), rerun `scratch/lpc_audit.py`, work the §7 checklist
3. Steam + trademark search on *The Long Roll*, *Delvers*, *Marrowfen*
4. Set up OBS with a hotkey and record every playtest from now on

---

## 6. The incumbent — Idle Champions of the Forgotten Realms

**[Idle Champions of the Forgotten Realms](https://store.steampowered.com/app/627690/Idle_Champions_of_the_Forgotten_Realms/)**
(Codename Entertainment) is the *officially licensed* D&D idle game. Steam since 2017, 140+
Champions, 200+ adventures, 8 campaigns, also on PS4/Xbox/mobile. Free-to-play.

**This is good news, not bad.** It proves the audience exists and is large, and it leaves the
premium end of the niche wide open:

| | Idle Champions | This game |
|---|---|---|
| Rules | Formation clicker; D&D as *theme* | Actual SRD 5.1 engine — initiative, spell slots, OAs, concentration |
| Business model | Free-to-play, champion unlocks, time-gated events | Buy once, own it |
| Presentation | 2D side-on formation lane | 3D procedural dungeons you watch |
| Progression | Champion collection | Party building, 5e levelling, authored 20-chapter arc |

**The positioning line, for the store page and every Reddit post:**

> The D&D idle game that actually runs D&D. Bought once. No champion packs, no energy timers,
> no events you have to show up for.

That last clause is the emotional hook for the substantial slice of the incumbent's audience who
like the concept and resent the monetisation. Say it plainly and often — it is your single
sharpest differentiator, sharper even than the 3D presentation.

**Do not name them in marketing copy.** Punching at a licensed incumbent reads as insecure and
invites their fans to defend them. Describe what you *are*; the comparison lands by itself.

---

## 7. Appendix — LPC sprite licence audit (run 2026-08-06)

Audit joined every PNG under `public/lpc/` against the authoritative per-asset credit records in
`lpc_repo/sheet_definitions/**/*.json` (the source `CREDITS.csv` is generated *from*).
*Not legal advice — engineering triage to scope the work and decide what needs a lawyer.*

**Matching rule matters.** `credits[].file` is a **directory prefix**, not a filename, so each
asset resolves to its longest matching prefix. A naive filename join under-reports badly
(it left 701 files "unattributed" that are in fact fully documented).

| | files | share |
|---|---|---|
| Shipped PNGs | 2,633 | |
| **Clean** — offers OGA-BY / CC-BY / CC0, electable as attribution-only | **2,054** | 78.0% |
| **Stuck** — CC-BY-SA and/or GPL only | **492** (61 categories) | 18.7% |
| **Unknown** — no credit record anywhere | **87** | 3.3% |

Full per-file report: `scratch/lpc_license_report.csv`.
Attribution roster: **60 distinct authors** across 281 shipped asset categories.

### Why this is smaller than it looks

LPC assets are **disjunctively multi-licensed** — `"OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0"` means the
licensee *chooses* which licence to comply with. OGA-BY 3.0 is attribution-only: no share-alike,
no copyleft, commercial use fine. Electing it discharges the obligation for 2,054 of 2,633 files.

Across the full LPC catalogue 85% of records offer a permissive option — so **replacements for the
stuck categories can be sourced from LPC itself**, free and style-matched. No commission needed.

### The generator's baked output renames things

Resolving the audit required four normalisations, all encoded in the script:
- **Palette recolors** — `legs/pants_black/male` → base `legs/pants/male`
- **fg/bg layer splits** — shipped `cape/solid/` vs credits `cape/solid/fg` + `cape/solid/bg`
- **`_behind` layers** — `shield_behind/*`, `weapon_behind/*` reuse `shield/*`, `weapon/*` art
- **Body-base naming** — the female base is called `thin`

Plus a small table of **inferred aliases** (`neck/cross_gold_yellow` → `neck/amulet/cross`, etc.)
marked `REVIEW BEFORE RELYING` in the script. Confirm each visually before publishing credits.

### Upstream is 55 commits ahead

`lpc_repo` sits at `d57c842424`; upstream `origin/master` is at `b2c85f98de`. Pulling adds credit
records that resolve several families. Worth doing before finalising the credits screen.

### The 87 genuinely-unattributed files

- **`waist/` — 76 files, the entire category.** Has **zero** credit records even in current
  upstream. This is an upstream documentation gap, not a defect in this project. Options: file an
  issue against the LPC generator repo, trace the art to its OpenGameArt submission by hand, or
  drop belts/sashes from the character generator. Filing the issue is the good-citizen move and
  costs ten minutes.
- **`weapon_behind/blunt/hammer` (4), `weapon_behind/magic/truewand` (6)** — the forward-facing
  variants resolve via alias; the `_behind` layers need the same confirmation.
- **`wolfsheet1.png` (1)** — not generator output; trace separately.

### The 61 stuck categories

Overwhelmingly cosmetic: 5 beard/moustache sets, ~31 hairstyles, 3 hats, 2 shoe sets, 4 torso
pieces, 1 shield, 9 weapons (flail, waraxe, halberd, scythe, sabre, spear, longspear, trident,
dragonspear).
Deliberate decisions needed on: `head/ears/elven` (elven ears matter for a D&D game),
`body/bodies/muscular`, `head/heads/minotaur|wolf|zombie`, `legs/fur`.

### Compliance checklist

- [ ] `git pull` in `lpc_repo`, rerun the audit
- [ ] Review and confirm the `ALIASES` table in `scratch/lpc_audit.py`
- [ ] Resolve `waist/` — file the upstream issue, or drop the category
- [ ] Replace the stuck categories from permissively-licensed LPC alternatives
- [ ] Rerun until STUCK and UNKNOWN are both zero
- [ ] Generate the in-game credits screen from `lpc_license_report.csv` (60 authors)
- [ ] State the OGA-BY 3.0 election explicitly in `CREDITS.md`
- [ ] Ship with Steam DRM disabled

### What CC-BY-SA / GPL actually do and do not do

- **Do not** prohibit commercial sale. Both explicitly permit it.
- **Do** require share-alike/copyleft: recipients may lawfully redistribute those assets for free.
- **Do** forbid imposing technological restrictions (GPLv3 §3, CC-BY-SA §4(a)) — avoid by shipping
  with Steam DRM off.
- **Do** require per-asset attribution.

### The 63 stuck categories

Mostly cosmetic: 5 beard/moustache sets, ~35 hairstyles, 3 hats, 2 shoe sets, 3 shields/armour
pieces, 5 weapons (flail, waraxe, halberd, scythe, sabre).
Worth deliberately replacing: `head/ears/elven/adult` (elven ears matter for a D&D game),
`body/bodies/muscular`, `head/heads/minotaur|wolf|zombie`.

Audit script: `scratch/lpc_audit.py` — rerun after any sprite change.
