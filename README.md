# 🏰 Dungeon Crawlers — Developer Handoff Guide & Map

Welcome to **Dungeon Crawlers**! This project is an idle party-based dungeon crawler (inspired by *Clickpocalypse*) layered on top of the procedural generator and rendering engine **Dungeon Forge** (found in [src/main.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/main.js)).

The gameplay mechanics adapt the **D&D SRD 5.1** ruleset (advantage, classes, races, subclasses, spell slots, resting, and skill checks) into an automated loop. The party proceduraly crawls through Three.js environments, fights monsters, loots equipment, levels up, and completes multi-floor world-map quests.

---

## 🚀 Quick Start

Ensure you have Node 18+ installed, then run:

```bash
npm install
npm run dev        # Launches the local development server at http://localhost:5173
```

To build a production-ready package:

```bash
npm run build
npm run preview    # Serves the production build locally at http://localhost:4173
```

---

## 🧠 System Architecture

The codebase cleanly splits the game into three layers:
1. **Procedural Rendering Core (Dungeon Forge)**: Contained inside [src/main.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/main.js). It manages the mulberry32 RNG stream, separates rooms, builds Delaunay graphs, rasterizes the grid, places lights/props, and renders tiles via `InstancedMesh`.
2. **Game Orchestration & State**: Managed by the [Game](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/game.js#L123) class in [src/game/game.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/game.js).
3. **Domain Logic Mixins**: The core gameplay logic is modularized across sub-files inside [src/game/](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/). These files export methods that are dynamically assigned to `Game.prototype` at boot:

```javascript
Object.assign(Game.prototype, pathfindingMethods, fogMethods, combatMethods, monsterAiMethods, exploreMethods, inventoryMethods);
```

This mixin pattern allows domain modules to remain organized as separate files while accessing the central game state (`this.heroes`, `this.monsters`, `this.D` for the active dungeon grid, etc.) inside their functions.

---

## 📂 File-by-File Reference

Here is a comprehensive directory map showing exactly what each file does and where specific mechanics live:

### ⚙️ Core Configuration & Orchestration
*   [index.html](file:///g:/ClaudesFolder/dungeon-crawlers/index.html)
    *   **Responsibility**: Canvas mounting point and DOM elements for screens (Setup, World Map, Shop, Character Sheet, Skill Challenge Overlays).
*   [vite.config.js](file:///g:/ClaudesFolder/dungeon-crawlers/vite.config.js)
    *   **Responsibility**: Vite bundler settings.
*   [src/main.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/main.js)
    *   **Responsibility**: The rendering and generation core. Consumes seeds to run the pipeline: scatter → separate → triangulation → MST corridor loops → room roles (treasure/boss/elite) → decoration → post-processing (bloom, tilt-shift, film grain).
*   [src/game/game.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/game.js)
    *   **Responsibility**: Boot controller, save-game loader, tick loop (`update()`), scene transition controller, and camera hookups. Houses the active game state (level, party, gold, active quest chains).
*   [src/game/constants.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/constants.js)
    *   **Responsibility**: Central registry for tuning variables. Houses variables for movement speed, cooldowns, XP distribution, aggro distance, and pathfinding weight penalties.
*   [src/game/shared.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/shared.js)
    *   **Responsibility**: Holds a single global `_v` scratch `THREE.Vector3` instance to prevent per-frame memory allocation and garbage collection overhead.

### 🧭 Movement & Environmental Systems
*   [src/game/pathfinding.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/pathfinding.js)
    *   **Responsibility**: Grid-based pathing and movement safety.
    *   **Key Aspects**:
        *   Uses a uniform-cost BFS search for party/monster pathing.
        *   `buildWallAdj()` prefers pathways centered in corridors/rooms.
        *   `buildChokepoints()` flags doorway/pinch-point tiles so followers slow down to prevent clustering/clipping.
        *   Includes raycasted Line-of-Sight (LOS) checking.
*   [src/game/explore.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/explore.js)
    *   **Responsibility**: Artificial Intelligence governing party exploration, click-to-move overrides, and formation.
    *   **Key Aspects**:
        *   `getFormationSlot()` maps out followers in a wedge-formation offset behind the leader.
        *   `handleStuck()` is a multi-tier stuck recovery mechanism: lateral dodge → repath → yield → teleport.
        *   Drives character interactions with chests, shrines, and gems.
*   [src/game/fog.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/fog.js)
    *   **Responsibility**: Fog of war mapping.
    *   **Key Aspects**:
        *   `buildFogMaps()` correlates grid positions with Three.js `InstancedMesh` indices.
        *   `dimInstances()` / `revealCell()` update instance colors dynamically on the graphics buffer as characters walk.

### ⚔️ Combat & Spellcasting
*   [src/game/combat.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/combat.js)
    *   **Responsibility**: Resolves hero-side combat exchanges, active actions, and spells.
    *   **Key Aspects**:
        *   Triggers attacks, manages ability cooldowns, and updates target coordinates.
        *   Implements flanking mechanics (qualifying Rogues for *Sneak Attack*).
        *   Resolves class features such as Frenzy, Action Surge, Bear Totem, and Smite.
*   [src/game/monster_ai.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/monster_ai.js)
    *   **Responsibility**: AI loop for monsters.
    *   **Key Aspects**:
        *   Aggro activation when heroes enter `AGGRO_RANGE`.
        *   Pursuits and path updates towards targets.
        *   Triggers boss spellcasting sequences (e.g., Fireball, Dragon Breath, Slow) on recurring combat rounds.
*   [src/game/spells.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/spells.js)
    *   **Responsibility**: Registry of all game spells (`SPELLS` and `SPELL_POOLS`). Defines spell ranges, damage/healing formulas, target counts, and status effect application payloads.
*   [src/game/conditions.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/conditions.js)
    *   **Responsibility**: Status effect system tracking `stunned`, `poisoned`, `burning`, `frozen`, and `concentration`. Translates active debuffs into modifiers applied to attack rolls, armor class, or speed.

### 📜 Character Mechanics & D&D Rules
*   [src/game/srd.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/srd.js)
    *   **Responsibility**: The mathematical core of the SRD 5.1 adaptation.
    *   **Key Aspects**:
        *   `d20Roll()` rolls a d20, supporting advantage/disadvantage summation.
        *   `recalc()` rebuilds character stats by stacking base attributes, class rank adjustments, active passives, and equipment modifiers.
        *   Maintains lists of races, classes, abilities, skills, and monster tier configurations.
*   [src/game/features.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/features.js)
    *   **Responsibility**: Character progressions, leveling-up rules, and feat pools.
    *   **Key Aspects**:
        *   Tracks pending choices (ASIs, feats, spells) when a character levels up.
        *   Defines active fighting styles and passive feature triggers (e.g., Uncanny Dodge, Extra Attack).
*   [src/game/rest.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/rest.js)
    *   **Responsibility**: Rest mechanics.
    *   **Key Aspects**:
        *   `partyShortRest()` recovers short-rest cooldowns, partial spell slots (Warlocks fully), and triggers healing (Bard's Song of Rest).
        *   `partyLongRest()` triggers at the end of a floor, resetting all spell slots and long-rest abilities.

### 🎒 Items, Shop & Inventory
*   [src/game/items.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/items.js)
    *   **Responsibility**: Loot generation, equipment configurations, and item affixes.
    *   **Key Aspects**:
        *   Supports 9 equipment slots.
        *   Handles rarity multipliers (common, uncommon, rare, epic, legendary).
        *   Defines special legendary perks (e.g., Cleave, Lifesteal, Speed Boost). Legendaries scale up in power to match the character's level.
*   [src/game/inventory.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/inventory.js)
    *   **Responsibility**: Handles item transactions, equipping/unequipping gear, and JSON-based save game serialization.
*   [src/game/shop.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/shop.js)
    *   **Responsibility**: Controls merchant interactions during the camp phases between floors.
*   [src/game/chest_wheel.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/chest_wheel.js)
    *   **Responsibility**: A spin-wheel UI overlay that resolves chest-opening rewards.

### 🗺️ Quests & Campaigns
*   [src/game/quests.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/quests.js)
    *   **Responsibility**: Procedural generation of quests for the World Map. Pre-rolls dungeon layouts, monster distributions, boss types, and legendary rewards scaled to party levels.
*   [src/game/quest_events.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/quest_events.js)
    *   **Responsibility**: Controls active quest progress and events.
    *   **Key Aspects**:
        *   Loads floor objectives and choice cards.
        *   Spawns temporary mercenary companions.
        *   Populates puzzle gate gems that heroes must retrieve to unlock deeper levels.
*   [src/game/quest_story.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/quest_story.js)
    *   **Responsibility**: Lore strings database containing flavor text, boss rumors, and quest dialogues.
*   [src/game/worldmap.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/worldmap.js)
    *   **Responsibility**: Renders the world map screen overlay showing available quests and completion logs.

### 🎲 Non-Combat Challenges
*   [src/game/skills.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/skills.js)
    *   **Responsibility**: Implements **Skill Challenge System 2.0**.
    *   **Key Aspects**:
        *   Fires skill check card selections during dungeon runs (room completion, merchant camps, or custom challenge rooms).
        *   Players choose between three approach cards (Safe, Standard, Risky) containing different skills, DCs, and reward scaling (Gold, gear, short rests, floor buffs, revealed locations).
        *   Applies floor-long consequences: *Momentum* (stacking success buffs), *Wounded Pride* (failed check stat penalties), and *Alerted* (risky fails spawn extra monsters in unvisited chambers).
        *   Hooks into [entities.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/entities.js) to display sprite animations (e.g., spellcasting, slashing) and assets from `./public/dcss/` during resolution.

### 🎨 Graphics, Layout & User Interface
*   [src/game/entities.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/entities.js)
    *   **Responsibility**: Renders non-grid entity assets inside the Three.js scene (projectiles, floating status text, flashing meshes, health bars, status tray billboards, and slash impact meshes).
*   [src/game/sprite_animator.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/sprite_animator.js)
    *   **Responsibility**: Renders and animates LPC (Liberated Pixel Cup) layered sprites. Rebuilds and coordinates sprite layers (body, head, armor, weapons) to match character directions and movements.
*   [src/game/ui.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/ui.js)
    *   **Responsibility**: Main DOM HUD updater (health frames, level-up notifications, activity log).
*   [src/game/menus.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/menus.js)
    *   **Responsibility**: Manages character sheets, stats distribution, and equipment inventory displays.
*   [src/ui/game.css](file:///g:/ClaudesFolder/dungeon-crawlers/src/ui/game.css)
    *   **Responsibility**: Game HUD, menu layouts, overlays, and animations styling.
*   [src/ui/styles.css](file:///g:/ClaudesFolder/dungeon-crawlers/src/ui/styles.css)
    *   **Responsibility**: Basic CSS reset and panel layout templates.

---

## 🛠️ Code Maintenance Rules

To keep the game codebase clean and this map useful for future developers, please adhere to these practices:

### 1. Maintain Documentation Integrity
*   Whenever a new file is added to `src/game/`, it **must** be cataloged in the **File-by-File Reference** section above, detailing its responsibility, core functions, and dependencies.
*   If a major mechanic is changed or rewritten (e.g., combat recalculation, pathfinding rules, skill challenges), update the respective section in this guide immediately.
*   Do not remove structural developer instructions, setup steps, or licensing credits from this document.

### 2. Pure Functions vs. Game Mixins
*   **Pure Functions**: Math utilities, generation rules, and static lookups should remain pure (no dependencies on the global `Game` instance). Place these in helper modules (e.g., [src/game/srd.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/srd.js), [src/game/items.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/items.js), or [src/game/spells.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/spells.js)).
*   **Mixins**: Only mix functions into `Game.prototype` if they require direct access to active entities, the rendering group, or grid configurations.

### 3. Optimization and GC Guardrails
*   Avoid per-frame object or vector allocations inside core loops (`Game.update()`, pathfinding updates, or entity render checks). Re-use the shared scratch vector `_v` imported from [src/game/shared.js](file:///g:/ClaudesFolder/dungeon-crawlers/src/game/shared.js).
*   When updating colors or states on instanced geometry, flag updates with `.needsUpdate = true` sparingly to avoid CPU-to-GPU memory transfer bottlenecks.
