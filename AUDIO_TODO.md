# Audio TODO — sound slots awaiting real files

Every spell, class feature and monster ability in the game resolves to a
**named sound slot**. A slot with an empty file list is declared but
unrecorded: the call site already asks for it, and `playSfx()` substitutes its
`fallback` until real audio exists.

**The registry is data:** `src/game/sounds.json` (slots, ability routing,
per-class cantrips, damage-type routing). `src/game/audio.js` imports it.

**To fill a slot in:** drop the files under `public/sounds/…`, then open the
**Sound Editor** (`sound_editor.html`, linked from the game's system menu, or
`http://localhost:<port>/sound_editor.html` under `npm run dev`), pick the
slot, add the files, clear its fallback, and hit *Save to Project*. Nothing
else changes — no call sites, no spell definitions.

Hand-editing `sounds.json` works too; the editor is just faster and lets you
audition before committing.

`test/audio_coverage.test.js` fails the build if an ability is added without a
slot, a slot name is misspelled, a listed file is not on disk, a fallback
chain loops, or a placeholder slot has nothing routing to it.

## The editor at a glance

| Tab | Answers |
|---|---|
| **Slots** | What sounds exist, which are still placeholders, what plays in their place, which abilities depend on each |
| **Spells & Abilities** | Does every spell / feature / boss spell point somewhere sane — filter by "slot silent" or "using fallback" to find the gaps |
| **Cantrips & Damage Types** | Per-class cantrip routing, and the damage-type fallbacks monster abilities use |
| **Audio Library** | What's on disk: orphaned files nothing uses, and slots pointing at files that aren't there |

Play buttons everywhere audition the *unsaved* state with the same rate jitter
and volume curve the game uses, so a preview matches the dungeon.

## Recorded (files exist)

`swordAttack` `swordHit` `swordBlock` `swordParry` `bowAttack` `bowHit`
`bowBlock` `chestOpen` `doorOpen` `gateOpen` `portcullis` `lockUnlock`
`spellFire` `spellFireSpray` `spellBuff` `spellIce` `spellIceStorm`
`spellFreeze` `spellIceWall` `spellRock` `spellRockStorm` `spellRockWall`
`spellWater` `spellWave` `spellImpact`

## Magic schools — declared, unrecorded

| Slot | Wanted sound | Currently plays | Abilities |
|---|---|---|---|
| `spellArcane` | dry force *thump*, no element | `spellImpact` | magic missile, chaos bolt, wild surge, tides of chaos, magic weapon |
| `spellLightning` | crack + rolling thunder | `spellRockStorm` | call lightning, lightning bolt |
| `spellThunder` | concussive boom | `spellRockStorm` | thunderwave, thunderous smite, shatter |
| `spellHoly` | choral swell / radiant chime | `spellBuff` | divine smite, guiding bolt, spirit guardians, sacred weapon, guided strike |
| `spellNecrotic` | wet drain / life siphon | `spellWave` | inflict wounds, vampiric touch, blight, arms of Hadar |
| `spellCurse` | low sour hex whisper | `spellWave` | hex, bane, bestow curse, ray of enfeeblement |
| `spellMind` | woozy descending shimmer | `spellFreeze` | sleep, slow, hold person/monster, fear, blindness, silence, hideous laughter, darkness |
| `spellNature` | creaking vines / rustle | `spellRockWall` | entangle, web, grease, faerie fire, barkskin |
| `spellAcid` | hissing corrosive splash | `spellWater` | acid arrow |
| `spellSummon` | materialising shimmer | `spellBuff` | spiritual weapon, companion strike |

## Support / martial — declared, unrecorded

| Slot | Wanted sound | Currently plays | Abilities |
|---|---|---|---|
| `spellHeal` | warm restorative chime | `spellBuff` | cure wounds, healing word, mass heals, restorations, lay on hands, preserve life, second wind |
| `spellWard` | metallic barrier snap | `spellBuff` | shield, shield of faith, protection from evil, death ward, indomitable, patient defense, bear totem |
| `spellBlessing` | light ascending sparkle | `spellBuff` | bless, lucky, rallying cry, fey presence, fiendish blessing |
| `spellHaste` | quick rising whoosh | `spellBuff` | haste, action surge, remarkable athlete |
| `spellSong` | lute flourish / vocal jab | `spellBuff` | bardic inspiration, combat song, cutting words |
| `spellStealth` | cloth + smoke displacement | `spellBuff` | misty step, shadow step, cunning action, fast hands |
| `spellMark` | sharp target ping | `spellImpact` | hunter's mark, vow of enmity, colossus slayer |
| `warCry` | guttural roar | `spellBuff` | rage, frenzy, bloodlust |
| `martialFlourish` | rapid multi-strike whir | `swordAttack` | flurry of blows, quivering palm, deathstrike |

## Class cantrips — declared, unrecorded

Cantrip casts used to all play the generic fire-buff whoosh regardless of class.
Each caster now asks for its own slot.

| Slot | Class | Cantrip | Currently plays |
|---|---|---|---|
| `cantripFireBolt` | wizard, sorcerer | Fire Bolt | `spellFire` |
| `cantripSacredFlame` | cleric | Sacred Flame | `spellHoly` → `spellBuff` |
| `cantripProduceFlame` | druid | Produce Flame | `spellFireSpray` |
| `cantripEldritchBlast` | warlock | Eldritch Blast | `spellArcane` → `spellImpact` |
| `cantripViciousMockery` | bard | Vicious Mockery | `spellSong` → `spellBuff` |
| `cantripRayOfFrost` | artificer | Ray of Frost | `spellIce` |

## Skill challenges — declared, **silent** on purpose

These have no fallback: a sword clang under a Persuasion check would be worse
than nothing. They are wired up in `skills.js` and go live the moment files land.

| Slot | Wanted sound |
|---|---|
| `skillRoll` | per-tick d20 tumble |
| `skillSuccess` | short positive sting |
| `skillFail` | short negative sting |
| `skillCrit` | bright triumphant flourish (nat 20) |
| `skillFumble` | comedic thud (nat 1) |

## Spare assets

`spellIceWall` (Ice Wall 1/2.wav) has real audio but nothing routes to it —
there's no ice-wall spell yet. Kept as the natural slot if one is added; the
Library tab flags it as unused.

## Not yet slotted at all

Game events that still have no sound and no slot — out of scope of the
spell/skill pass, listed so they aren't forgotten:

- level up / XP gain
- hero drops to 0 HP, hero death, party wipe
- monster death
- gold and loot pickup, potion quaff, shop buy/sell
- trap spring
- quest accept / complete
- floor descend, boss room reveal (`portcullis` covers the gate, not the sting)
- UI clicks and menu open/close
