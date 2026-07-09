# Game modules

Idle party crawler layered on Dungeon Forge (`src/main.js`).  
`game.js` is the **orchestrator**; domain logic lives in the files below.

## Layout

| File | Responsibility |
|------|----------------|
| `game.js` | Boot, dungeon load, main `update()` loop, wipe/finish, camera glue |
| `constants.js` | Tunables (speeds, ranges, save key, theme order) |
| `shared.js` | Shared scratch objects (`_v` Vector3) |
| `pathfinding.js` | BFS paths, LOS, wall repel, nudge, separation |
| `fog.js` | Fog-of-war, room visit / reveal |
| `combat.js` | Hero attacks, spells, subclass actives, damage, kills, loot drops |
| `features.js` | Class progression, feats, fighting styles, spell lists, choices |
| `monster_ai.js` | Monster activation, targeting, chase, attacks, visuals |
| `explore.js` | Party exploration AI, click-to-move, chests/shrines |
| `inventory.js` | Equip/sell/sort, potions, level-up spends, save/load |
| `srd.js` | SRD 5.1 rules data + pure math |
| `items.js` | Loot tables / equipment bonuses |
| `skills.js` | Skill challenge system |
| `quests.js` | World-map quest generation |
| `entities.js` | Meshes, HP bars, projectiles, float text |
| `sprite_animator.js` | LPC layered hero sprites |
| `ui.js` / `menus.js` / `shop.js` | DOM HUD and screens |

## How mixins work

Domain modules export a `*Methods` object. `game.js` assigns them onto `Game.prototype`:

```js
Object.assign(Game.prototype, pathfindingMethods, fogMethods, ...);
```

Methods still use `this` as the live `Game` instance (heroes, dungeon, engine).  
Prefer **pure helpers** (e.g. `buildWallAdj`, `buildFogMaps`) when logic does not need full game state.

## Where to put new work

| If you're changing… | Edit |
|---------------------|------|
| Movement feel / stuck paths | `pathfinding.js` |
| Fog or room-entry flavor | `fog.js` |
| Hit math, spells, drop rates | `combat.js` |
| Level tables, feats, spell pools | `features.js` |
| Monster behavior / aggro / chase | `monster_ai.js` |
| Room order, cohesion, chests | `explore.js` |
| Gear UI actions / save format | `inventory.js` |
| Race/class/monster stats | `srd.js` |
| Loot tables | `items.js` |
| Run flow / floor transitions | `game.js` |
| Generator / Three scene | `../main.js` |

## Engine boundary

- Engine calls `game.onDungeon(d)` after each forge.
- Engine calls `game.update(dt, elapsed)` every frame.
- Game calls `engine.reforge(...)`, `engine.getMeshes()`, camera helpers.
