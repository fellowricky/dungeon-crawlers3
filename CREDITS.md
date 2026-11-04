# Credits

This game incorporates assets from multiple sources. License terms for each
are documented below. If you contribute new assets, please update this file
and respect the license policy in the "Adding New Assets" section.

---

## Code

| Source | License | Notes |
|---|---|---|
| **Dungeon Forge** by Majid Manzarpour | MIT | Base framework |
| **pixelfx** by Patch (with Hugo Duprez) | MIT | `src/vendor/pixelfx/` — the effect core plus the status, holy, shadow, nature, pickups and arcane effects behind Blight and the status auras (`src/render/status_auras.js`), drawn live in game (`src/render/pixelfx_live.js`); `src/render/pfx/storm_cloud.js`, `status_sleep.js`, `beam.js`, `missile.js`, `magic_missile.js` and `wisp.js` are modified copies of its `lightning/storm-cloud`, `status/sleep`, `arcane/arcane-beam`, `arcane/arcane-missiles`, `projectiles/magic-missile` and `critters/wisp`; the holy and flame pillars are vendored as-is. License + notices alongside |
| **Universal LPC Spritesheet Character Generator** | GPL-3.0 | `lpc_repo/` — used to assemble the hero spritesheets in `public/lpc/` |
| All other project code | MIT | See `LICENSE` |

---

## Art — CC0 (no attribution required, commercial OK)

### Dungeon Crawl Stone Soup (DCSS) — tiles & effects
- **Paths:** `public/dcss/`, `Sprites/Dungeon Crawl Stone Soup Full/`,
  `public/art/tiles/` (floor/wall atlases baked from DCSS dungeon tiles by
  `tools/build_tile_atlas.py`), `public/art/ground/` (the `dirt_*` grass/dirt
  fringe set, autotiled for the guild compound terrain by
  `src/render/guild_ground.js`), `public/art/ground/grass/` (the `grass_*`
  turf/track set, autotiled into the holdfast overland road by the same file),
  `public/art/ground/cobble/` (`cobble_blood_1_old`-`7_old`, renamed `cobble_0`-`6`: the
  boneyard's cobbled road)
- **Source:** https://github.com/crawl/crawl
- **License:** CC0 1.0 Universal
  - Verified in `Sprites/Dungeon Crawl Stone Soup Full/LICENSE.txt`
  - "Works under CC0 do not require attribution… for any purpose
    whatsoever, including without limitation commercial, advertising
    or promotional purposes."
- **Use:** Monster sprites, item icons, dungeon tiles, all `cloud_*`,
  `flame_*`, `frost_*`, `zap_*`, `magic_bolt_*`, `icicle_*`,
  `cloud_neg_*`, `cloud_calc_dust_*`, `heataura_*`, `orb_glow_*`,
  `cloud_storm_*`, and related effect sprites.

### Kenney Particle Pack
- **Paths:** `public/dcss/effect/kny_*.png`, `Sprites/External_VFX/kenney-particle-pack/`
- **Source:** https://kenney.nl/assets/particle-pack
- **License:** CC0 1.0 Universal
- **Use:** 27 curated 512×512 particle textures for slashing arcs
  (`kny_slash_*`), radiant/holy bursts (`kny_star_*`, `kny_light_*`),
  force sparks (`kny_spark_*`), generic magic blasts (`kny_magic_*`),
  claw strikes (`kny_claw_*`), dust bursts (`kny_dust_*`), smoke
  variants (`kny_smoke_*`), spell glyphs (`kny_glyph_*`), and scorch
  marks (`kny_scorch_*`).

### RPG VFX Pack by System G6 (downloaded, not yet integrated)
- **Path:** `Sprites/External_VFX/rpg_vfx_pack.7z` (41.6 MB, needs manual extraction)
- **Source:** https://opengameart.org/content/rpg-vfx-pack
- **License:** CC0 1.0 Universal
- **Use:** Available for future integration — 8-64 frame image sequences
  for spell impacts, auras, and projectiles. Extract with 7-Zip when ready.

---

## Art — MIT (attribution required, commercial OK)

### pixelfx by Patch
- **Paths:** `public/fx/spells/pfx_*.png` (sheets rendered from the library and
  packed by `scripts/pixelfx_import.py`; each `vfx_animations.json` sheet entry
  names its source effect in `source`)
- **Source:** https://github.com/patch-gg/pixelfx
- **License:** MIT — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez.
  Parts adapt Sprite Fusion's pixel art VFX (Hugo Duprez, MIT) and Hollow
  Crown (rehan-remade, MIT). The library's "Patch Pixel" gallery font is not
  MIT and is not used here.
- **Use:** Spell VFX sprite sheets — Fireball's bolt (`fire/fireball`) and
  blast (`explosions/big-explosion`, first 1.3 s); Cone of Cold's cone
  (`ice/frost-breath`) and per-target freeze (`ice/freeze`); Call Lightning
  (`lightning/lightning-strike`), Ray of Frost (`ice/ice-shatter`), Burning Hands (`fire/fire-breath`, widened to the spell's cone), Arms of Hadar (`shadow/shadow-tendrils`), Bane (`shadow/hex-sigil` in the blood palette), Sacred Flame (`holy/blessing` + `shadow/shadow-flames`, in the holy palette), Ice Storm (`arcane/star-fall` in the ice palette, three layered),
  Sleep (`arcane/rune-circle` + `status/sleep`), Blight
  (`shadow/curse`), and the live Call Lightning cloud (`lightning/storm-cloud`).

---

## Art — CC-BY-SA 3.0 / GPL 3.0 (PRE-EXISTING — attribution + share-alike required)

### Liberated Pixel Cup (LPC) — hero character sprites
- **Paths:** `public/lpc/`, `Sprites/lpc_repo/`
- **Source:** http://lpc.opengameart.org/
- **License:** OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 (varies per asset)
- **Per-asset attribution:** `Sprites/lpc_repo/CREDITS.csv`

**IMPORTANT — Share-Alike Obligations:**
- Derivative works of CC-BY-SA LPC assets must also be licensed under
  CC-BY-SA or a compatible license (e.g., GPL).
- GPL-licensed assets used in a game may require the **entire game** to
  comply with GPL copyleft (source disclosure, etc.) depending on how
  "linking" is interpreted for art assets. This is a known ambiguity in
  the LPC ecosystem.
- The project's MIT `LICENSE` applies to **code only**. LPC art remains
  under its original licenses regardless of the project's code license.
- For a commercial release on DRM-protected platforms (Steam, iOS,
  etc.), legal review of the LPC license chain is recommended.

---

## Fonts — SIL Open Font License 1.1 (attribution required, commercial OK)

- **Path:** `src/ui/fonts/`
- **Faces:** Press Start 2P (CodeMan38), VT323 (Peter Hull),
  Cinzel (Natanael Gama), Alegreya + Alegreya Italic (Juan Pablo del Peral,
  Huerta Tipográfica)
- **License:** SIL OFL 1.1 — self-hosted `.woff2`, unmodified.

---

## Audio — original music

### Title theme, by Aboda
- **Path:** `public/music/Title Screen.mp3`
- **Use:** main-menu theme (loops on the title screen, save-slot picker and
  party setup). Composed for Dungeon Crawlers; credited in the in-game
  credits block.

---

## Audio — custom itch.io licenses (attribution appreciated, commercial OK)

### Castle Tales — Free 30 Pixel Fantasy RPG Tracks, by alkakrab
- **Path:** `public/music/` (30 tracks)
- **Source:** https://alkakrab.itch.io/castle-tales-free-pixel-fantasy-music-pack
- **License:** "Free for commercial use." No attribution requirement stated
  and no redistribution/resale restriction stated; credited anyway in the
  in-game credits block.

### Free Fantasy 200 SFX Pack, by TomMusic (Thomas Devlin)
- **Paths:** `public/sounds/Attacks/`, `public/sounds/Doors Gates and Chests/`,
  `public/sounds/Spells/`
- **Source:** https://tommusic.itch.io/free-fantasy-200-sfx-pack
- **License:** "Royalty-free! You can use this in your projects, commercial
  or otherwise, credit is not mandatory but appreciated. The asset is not to
  be up for resale or redistribution."

`Spells/Spell Charge *.wav` are not from that pack: they are synthesized by
`tools/sfx/make_spell_charge.py`, original to this project.

**⚠️ REDISTRIBUTION WARNING:** the TomMusic terms forbid redistribution.
Shipping the `.wav` files inside a *game build* is the intended use and is
fine, but committing them to a **public** git repo (or any repo where the raw
files can be downloaded on their own) is arguably redistribution. If this
repo is ever made public, move `public/sounds/Attacks`, `Doors Gates and
Chests`, and `Spells` out of version control (`.gitignore` + a download
step) or replace them with CC0 equivalents. This is the exact case the
"Forbidden" list below warns about.

### Narration — project-generated
- **Path:** `public/sounds/Narration/` (1463 files)
- **License:** generated for this project; not third-party. Record the TTS
  engine and its commercial-use terms here if the game is ever released.

---

## 3D Models — CC-BY 4.0 (attribution required, commercial OK)

### Grave Yard Set by talmore
- **Source:** https://sketchfab.com/3d-models/grave-yard-set-e7aab6a1bd1f489383e8749afd879c3e
- **Author:** talmore (Sketchfab)
- **License:** CC-BY 4.0 (Creative Commons Attribution 4.0 International)
- **Use:** Gravestones, crypt sarcophagi, tombstones, and cemetery dressings for the Grim Crypts theme and crypt room archetypes.

### Stylized Coffin by Krystian Zem (@Banketo)
- **Source:** https://sketchfab.com/3d-models/stylized-coffin-b3e390806701493e9ea97aa981ee1368
- **Author:** Krystian Zem (@Banketo on Sketchfab)
- **License:** CC-BY 4.0 (Creative Commons Attribution 4.0 International)
- **Use:** Stylized gothic undead sarcophagus / coffin prop for the Grim theme.

---

## Adding New Assets — Policy

Any new art added to this project **MUST** be one of:

1. **CC0** (preferred — no obligations)
   - Examples: DCSS, Kenney, Brackeys, OGA System G6
2. **CC-BY 4.0** or **MIT** (attribution required — add an entry to this file)
3. **CC-BY-SA** or **GPL** (compatible with existing LPC chain, but extends
   the share-alike/copyleft obligation — add an entry to this file)

**Forbidden:**
- Assets under custom "free for commercial use but no redistribution"
  licenses (e.g., some itch.io packs by Pimen, Pipoya, Frostwindz).
  These cannot be committed to a public git repo.
- Assets with no clear license documentation.
- "Found on Google" / "AI-generated" assets with unclear provenance.

**When in doubt:** choose CC0 sources or consult the project maintainer.
