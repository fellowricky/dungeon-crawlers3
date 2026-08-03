# Emoji Icon Audit

Every emoji/symbol currently used as a UI icon in `src/` (excludes `backupjul24/` and `lpc_repo/`, which are a backup and a third-party repo). Grouped by what the icon *represents* so you can commission/pixel-art a matching replacement set. File:line refs point at the first few uses of each — most appear repeated across `entities.js`, `menus.js`, `bestiary.js`, `combat.js`, and `skills.js` since those files re-declare the same status/class icon maps.

## Classes & Combat Roles
| Icon | Meaning | Where |
|---|---|---|
| ⚔ | Melee / warrior / attack | combat.js:45, menus.js:26, entities.js:118 |
| 🏹 | Ranged / archer / bow | menus.js:26, dungeon_scene.js:227 |
| 🗡 | Dagger / rogue | skills.js:63, combat.js:961 |
| 🪓 | Axe | menus.js:27 |
| 🥋 | Monk / martial arts | menus.js:27 |
| 🛡 | Shield / defender / armor class | entities.js:117, menus.js:28, combat.js:847 |
| 🔮 | Arcane / wizard / sorcery | menus.js:26, guild.js:70, spells.js:563 |
| ✨ | Holy / general magic / buff | entities.js:116, combat.js:67 |
| 🎵🎶 | Bard / music / performance | menus.js:27, combat.js:914,942 |
| 🌿 | Druid / nature magic | menus.js:27, spells.js:366 |
| 🧚 | Fairy / fey magic | entities.js:139, combat.js:1926 |

## Status Effects & Damage Types
| Icon | Meaning | Where |
|---|---|---|
| 🔥 | Fire damage/burning | entities.js:132, spells.js:186,251,540 |
| ⚡ | Lightning/shock/energy | entities.js:115, spells.js:279,436,598 |
| ❄ | Cold/frost | menus.js:1199, spells.js:1204,1338 |
| 🩸 | Bleed | entities.js:142, spells.js:1182 |
| 💀☠ | Death/poison/lethal | menus.js:28, combat.js:2249,2375 |
| 💜 | Curse/psychic | entities.js:125, combat.js:2217 |
| 🌀 | Confusion | entities.js:128, combat.js:1022 |
| 💫 | Stun/dizzy | entities.js:129, combat.js:1014 |
| 🕸 | Web/restrain | entities.js:130, spells.js:849 |
| 😱 | Fear | entities.js:126 |
| 🤢 | Disease/nausea | entities.js:127 |
| 😡 | Rage/anger buff | entities.js:114, combat.js:888,2794 |
| 💤 | Sleep | entities.js:136, spells.js:685,690 |
| 🔇 | Silence | entities.js:134, spells.js:1051 |
| ✖✗ | Negated/failed | entities.js:135, skills.js:3339 |
| ✓✅ | Success/hit | bestiary.js:549, skills.js:3356 |
| 📉 | Weaken/debuff | entities.js:138 |
| 🥀 | Wither/decay | entities.js:137 |
| 💪 | Strength buff | spells.js:825,831 |
| 💚💙 | Heal / mana restore | combat.js:2783, skills.js:65,2515 |
| 💥 | Impact/explosion | combat.js:1141, spells.js:492,1487 |
| 💨 | Haste/speed/dash | combat.js:832,858,2751, spells.js:1035 |
| 🍀 | Luck buff | combat.js:1103 |
| 🌈 | Charm/misc buff | combat.js:1895 |
| 🧿 | Ward/protection charm | spells.js:634,639,759,1075,1083 |
| 🔗 | Chain/bind effect | spells.js:658,664,1422,1428 |
| 👑 | Leader/boss marker | combat.js:2502 |

## Creatures / Bestiary
| Icon | Meaning | Where |
|---|---|---|
| 👾 | Generic monster placeholder | test_skills.js:466, bestiary.js:1223 |
| 🧍 | Player/humanoid marker | test_skills.js:456, bestiary.js:1216 |
| 🐻 | Bear (companion/beast) | entities.js:119, combat.js:899,927 |
| 🐺 | Wolf | entities.js:120, combat.js:998 |
| 👥 | Party/group | entities.js:121, skills.js:3256 |
| 👼😇 | Angel/celestial | entities.js:123, menus.js:1182 |
| 👁 | Eye/watcher/beholder-type | entities.js:124, menus.js:1182 |
| 🐉🐲 | Dragon | combat.js:1883, menus.js:1180,1182 |
| 😈 | Demon/imp | combat.js:1916, menus.js:1180 |
| 🗿 | Golem/statue | menus.js:1181 |
| 🫧 | Ooze/slime | menus.js:1181 |
| 👻 | Ghost/undead | spells.js:708 |
| 🐌 | Slow/snail creature | spells.js:734 |

## Resources & Economy
| Icon | Meaning | Where |
|---|---|---|
| 🪙 | Gold coin | game.js:1547, shop.js:29, worldmap.js:763 |
| 💰 | Money/wealth | inventory.js:169,207, shop.js:66 |
| 💎 | Gems/treasure | quest_events.js:453,523 |
| 🎁 | Reward/gift | game.js:1572, skills.js:2271 |
| ★⭐🌟 | Star / rating / favorite | game.js:816,1571, inventory.js:240 |
| 📈 | XP/level-up progress | inventory.js:252 |
| 🏅 | Achievement badge | inventory.js:253, quest_events.js:359 |
| 💸 | Cost/expense | skills.js:2959 |

## Items & Equipment
| Icon | Meaning | Where |
|---|---|---|
| 🧪 | Potion | inventory.js:34, guild.js:40, shop.js:61 |
| ⚗ | Alchemy/brewing | shop.js:62, worldmap.js:195 |
| 🍶 | Flask | shop.js:63 |
| 💍 | Ring | menus.js:37 |
| 🧰 | Tools/misc gear | menus.js:38 |
| 🎒 | Bag/inventory | menus.js:34,61, results.js:148 |
| 📜 | Scroll/quest text | guild.js:80, worldmap.js:334, skills.js:64 |
| 📖 | Book/journal/lore | worldmap.js:461, menus.js:1196,1252 |
| 🛢 | Oil/barrel | combat.js:1596, spells.js:966 |
| 🪵 | Wood/lumber | spells.js:1570 |

## Locations & World Map
| Icon | Meaning | Where |
|---|---|---|
| 🏰 | Guild/castle/town hub | guild.js:10, worldmap.js:1044,1383 |
| ⛺ | Camp/rest site | game.js:1317, rest.js:122,123 |
| 🚪 | Door/exit | game.js:960, quest_events.js:527,535 |
| 🗺 | Map | guild.js:90, worldmap.js:474, quest_events.js:59,278 |
| 📍 | Location pin | explore.js:148,520, menus.js:1160 |
| 🔒🔓 | Locked/unlocked | game.js:871, worldmap.js:387,392,760 |
| 🛒 | Shop/buy | shop.js:145, worldmap.js:629,633 |
| 🍻 | Tavern/drink | worldmap.js:1260,1279,1302,1305 |
| ⚒ | Blacksmith/crafting | guild.js:30, worldmap.js:811,820,1084 |
| 🩺 | Healer | guild.js:50, worldmap.js:915,1096 |
| 🪦 | Graveyard/cemetery | guild.js:60, worldmap.js:948,1109 |
| 🌫 | Fog/mist area | quest_story.js:300, quest_events.js:675 |
| 🌋 | Volcano/hazard biome | menus.js:1201 |
| 🕯 | Candle/dungeon lore icon | menus.js:1200 |

## Actions & Movement (combat log, exploration)
| Icon | Meaning | Where |
|---|---|---|
| 🏃 | Run/flee | entities.js:122, explore.js:490, combat.js:876,2579,2740 |
| 🦶 | Footstep/movement | explore.js:511, dungeon_scene.js:275, combat.js:2564 |
| 👊 | Punch/unarmed strike | combat.js:77,786,2806 |
| ✋ | Block/stop | combat.js:1004 |
| 🙏 | Prayer/bless | combat.js:706 |
| 🤝 | Trade/ally/assist | combat.js:2756, quest_events.js:679, skills.js:65 |
| 🎯 | Target/aim | combat.js:55,2640, game.js:212, spells.js:614 |
| 🎨 | Customize/paint (character creator) | bestiary.js:170,802, inventory.js:117 |
| 🎭 | Disguise/persona | skills.js:2641 |
| 📣 | Shout/taunt | combat.js:1482,1843 |
| 🎤 | Mic/bard performance | combat.js:1907 |
| 🔎🔍 | Search/investigate | explore.js:671, combat.js:1080, quest_events.js:269,681,685 |
| ⚖ | Balance (stat comparison) | menus.js:1027 |
| 🕹 | Controls/input hint | game.js:198 |

## Misc UI Chrome
| Icon | Meaning | Where |
|---|---|---|
| ❔ | Unknown/help tooltip | menus.js:1237,1243 |
| ✕ | Close button | menus.js:79, story_dialog.js:34 |
| 🔽🔼 | Sort/collapse arrows | menus.js:299,300 |
| 🔤 | Alphabetical sort | menus.js:301 |
| 🗗🗖 | Window resize (bestiary editor) | bestiary.js:274 |
| 💾 | Save | bestiary.js:2015 |
| ✏ | Edit | bestiary.js:169,801,928 |
| 📝 | Notes/description | bestiary.js:171,803 |
| 🎲 | Random/dice roll | bestiary.js:266 |
| 🌙 | Night/rest indicator | rest.js:156 |
| 🏁 | Finish/complete | game.js:1541 |
| ↳ ↔ → ✦ ✴ 🟣 | Typographic arrows/dividers/bullets used as inline log markers (not iconography per se) | combat.js, skills.js (throughout) |

## Notes for asset-making
- The **status effect row** (fire/lightning/frost/bleed/poison/stun/etc.) is the highest-value set to replace first — it's reused verbatim in `entities.js`, `menus.js`, and `combat.js` as the single source of truth for buff/debuff icons, so one pixel-icon set covers all three call sites.
- The **class icons** (⚔🏹🗡🪓🥋🛡🔮✨🎵🌿) show up in `menus.js` (class select), `skills.js` (skill tree headers), and `combat.js` (skill buttons) — same deal, one set reused everywhere.
- **World-map building icons** (🏰⛺🚪🗺🔒🛒🍻⚒🩺🪦) are worldmap.js-specific and mostly appear once or twice per building type, tied to `menus.js`'s pixel-UI restyle project already underway.
- Arrows (→ ↳ ↔) and bullet glyphs (✦✴🟣) are used as plain text separators in combat-log strings, not as icons — you likely don't need pixel art for these, just a monospace/pixel font glyph or a small custom separator sprite.
