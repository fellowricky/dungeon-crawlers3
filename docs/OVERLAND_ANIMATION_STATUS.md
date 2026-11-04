# Overland animation run — complete and wired 2026-10-03

All 40 creatures are wired into `monsters.json` by `scratch/ov_wire.py` (records in `scratch/ov_records.py`, test `test/overland_roster.test.js`). Helmed Horror: idle from `ovhh` (green-key re-render, frame 2 patched), attack from `ovmag`. The rest of this file is the run's history.

## Before wiring

All 80 clips (40 creatures, idle + attack) are rendered and built in `scratch/ov{blu,grn,mag}_built/`.
Rejected seeds were moved (not deleted) to `ComfyUI/output/DC_ov*/_rejected/`. Next step is Zenu's
approval of the review strips, then wiring into `monsters.json` (see "Then" below). Open question:
Leucrotta attack is a small bite with little reach - reroll with a bigger lunge only if Zenu asks.

---

*History: paused 2026-10-02 to free the GPU, resumed 2026-10-03.*


The 40 picked overland/bandit sprites (see `docs/OVERLAND_ROSTER.xlsx`) are being animated with H3,
idle + attack, two seeds per clip. Paused at Zenu's request to free the GPU. Nothing is wired into
`monsters.json` yet.

## To resume

```
python scratch/ov_resume.py      # re-queues the 16 cancelled clips exactly as they were
```

Then, when the queue is empty:

```
python scratch/tier_build.py ovmag
python scratch/tier_build.py ovblu
python scratch/tier_build.py ovgrn
```

Each build takes 10+ minutes; run them in the background. ComfyUI python is
`G:\Data\Packages\ComfyUI\venv\Scripts\python.exe` (needed for tier_build; `ov_resume.py` runs on either).

## Where each batch stands

Batches are grouped by measured chroma key (`scratch/ov_prep.py`).

| Batch | Creatures | Rendered | Built | Status |
|---|--:|---|---|---|
| `ovblu` (blue key) | 14 | all 56 base clips | yes | 25/28 good; 3 rerolls pending |
| `ovgrn` (green key) | 4 | all 16 base clips | yes | 6/8 good; 2 rerolls pending |
| `ovmag` (magenta key) | 22 | 82 of 88 | **no** | needs Bandit Queen attack + Bullywug Shellback idle/attack, then build |

## Cancelled clips (what `ov_resume.py` re-queues)

**Never rendered — `ovmag`**
- Bandit Queen attack (2 seeds)
- Bullywug Shellback idle (2 seeds)
- Bullywug Shellback attack (2 seeds)

**Rerolls of clips that came back wrong**
- `ovblu` Revenant attack — H3 seed has two white blow-out frames, H3b1 pumps dark. New seeds H3b2/H3b3.
- `ovblu` Bandit Archer attack — barely moved and never shot (base is already at full draw). Prompt rewritten: loose, reach for quiver, nock, redraw.
- `ovblu` Bandit Bruiser idle — middle frames wash out pale; metrics don't catch it.
- `ovgrn` Peryton attack — antlers vanish mid-strike, reads as an eagle. Prompt now pins the antlered head.
- `ovgrn` Quickling attack — dagger vanishes, ends empty-handed. Prompt now pins the dagger.

## After the rerolls land — check by eye

- **Bandit Bruiser idle**: tier_build picks by measurement and the washed-out H3b1 scores fine, so it may
  pick it again. Look at the strip; if needed, move `H3b1_bandit_bruiser_idle_*` out of
  `ComfyUI/output/DC_ovblu/` and rebuild.
- Re-run `tier_build.py` for `ovblu` and `ovgrn` so the new seeds are considered (it tries H3, H3b1, H3b2, H3b3).
- False "WALKING?" flags already checked and fine: Revenant idle, Yeti idle, Crawling Claw idle, Peryton idle.

## Then

1. Review strips → Zenu approves (`scratch/anim_review_<batch>.png`, made with `scratch/anim_review_strip.py`).
2. Write the `monsters.json` records: CRs and biomes from `docs/OVERLAND_ROSTER.xlsx`, sheets from
   `scratch/<batch>_built/`, copied to `public/sprites/<PascalName>/{Idle,Attack}/`.
3. Regenerate `docs/BIOME_TIER_TRACKER.xlsx` and update the Obsidian biome tracker.

## Files

| What | Where |
|---|---|
| Base prompts (Krea2) | `scratch/ov_make_prompts.py` → `ov_prompts.json` |
| Key + pad prep | `scratch/ov_prep.py` → `ov{blu,grn,mag}_keys.json`, `_raw/`, `_padded/` |
| H3 prompts | `scratch/ov_gen_h3.py` → `ov{blu,grn,mag}_h3_prompts.json` |
| Queue all / resume | `scratch/ov_go.py` / `scratch/ov_resume.py` (+ `ov_queue_snapshot.json`) |
| Built sheets + QC | `scratch/ov{blu,grn}_built/`, `ov*_build_report.json` |
| Render output | `G:\Data\Packages\ComfyUI\output\DC_ov{blu,grn,mag}\` |
