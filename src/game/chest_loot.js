import { roll, subclassOf } from './srd.js';
import { rollChestLoot, addToInventory } from './items.js';
import { log, updateResources } from './ui.js';
import { refreshMenus } from './menus.js';
import { onChestLooted } from './quest_events.js';
import { trackGold, trackLoot } from './run_stats.js';
import { playSfx } from './audio.js';
import { playNixieEffect } from '../render/nixie_vfx.js';
import { firstRunTip } from './help_ui.js';
import { revealItems, cancelItemReveal } from './item_reveal.js';

/* Chests open in the world: the lid swings back on the model itself
   (3d/generic/chest_anim.glb — rattle, beat, slow creak, settle) and the haul
   arrives through the loot feed and the party-frame pulse as the lid clears.
   This replaced a full-screen roulette wheel that paused the run for a spin
   whose result was decided before it started. */

let _g = null;
let _pending = [];   // loot timers still to fire, cancelled on level change

/* the lid is mostly open around here: rattle (0.6s) + beat + most of the creak */
const REVEAL_AT = 1.5;

export function initChestLoot(game) {
  _g = game;
}

/* Cancel any haul still waiting on a lid — the level it belonged to is gone. */
export function cancelPendingChestLoot() {
  for (const t of _pending) clearTimeout(t);
  _pending = [];
  cancelItemReveal();
}

/* `at` is the chest's world position ({x, z}); the lid animation and the
   sparkle are addressed by it. Without it the loot is still handed out, just
   without the in-world beat (headless / instanced-fallback chests). */
export function lootChest(chest, at = null) {
  if (!_g || chest.looted) return;
  chest.looted = true;              // claimed now; the proximity check runs every frame
  firstRunTip('chest');

  const gold = rollChestGold();
  const potion = rollChestPotion();
  const items = rollChestLoot(_g.activeQuest ? _g.activeQuest.level : _g.dungeonLevel, Math.random, _g.questFloor || 0);

  playSfx('chestOpen', { volume: 0.8 });
  let delay = 0;
  if (at && typeof at.x === 'number' && typeof at.z === 'number') {
    const dur = (typeof _g.openChest === 'function') ? _g.openChest(at.x, at.z) : 0;
    if (dur > 0) {
      delay = Math.min(REVEAL_AT, dur * 0.65) * 1000;
      const t = setTimeout(() => {
        playNixieEffect('loot_sparkles', { x: at.x, y: 0.35, z: at.z }, { scale: 0.9, duration: 0.8 });
      }, delay);
      _pending.push(t);
    } else {
      playNixieEffect('loot_sparkles', { x: at.x, y: 0.35, z: at.z }, { scale: 0.9, duration: 0.8 });
    }
  }

  if (delay > 0) {
    const t = setTimeout(() => {
      _pending = _pending.filter(x => x !== t);
      applyLoot(gold, potion, items);
    }, delay);
    _pending.push(t);
  } else {
    applyLoot(gold, potion, items);
  }
}

function rollChestGold() {
  const alive = _g.heroes.filter(h => h.data.hp > 0);
  let g = 25 * _g.dungeonLevel + roll(3, 20);
  const thiefBonus = Math.max(0, ...alive.map(h => {
    const sc = subclassOf(h.data);
    return (sc && sc.chestGold) || 0;
  }));
  if (thiefBonus) g = Math.round(g * (1 + thiefBonus));
  return g;
}

function rollChestPotion() {
  if (Math.random() >= 0.6) return null;
  return (_g.dungeonLevel >= 3 && Math.random() < 0.4) ? 'greater' : 'heal';
}

function applyLoot(gold, potion, items) {
  if (!_g) return;
  _g.gold += gold;
  trackGold(_g, gold);
  if (potion === 'greater') _g.potions.greater++;
  else if (potion === 'heal') _g.potions.heal++;

  for (const it of items) { addToInventory(_g.inventory, it, _g); trackLoot(_g, it); }
  updateResources(_g);
  refreshMenus(_g);
  onChestLooted(_g);

  if (typeof _g.notifyLootFeedback === 'function') {
    _g.notifyLootFeedback({ gold, items, potion });
  }

  log(`\u{1FA99} The party loots a chest: ${gold} gold.`, 'treasure');
  if (potion) log(`  \u{21B3} a ${potion === 'greater' ? 'Greater Healing' : 'Healing'} Potion.`, 'treasure');
  for (const it of items) log(`  \u{21B3} ${it.name}!`, 'treasure');
  revealItems(items);   // rare-or-better finds get a card; the rest just flowed through the feed
}
