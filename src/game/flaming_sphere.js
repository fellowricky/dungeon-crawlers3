/**
 * Flaming Sphere's rules (5e): a ball of fire that fills a tile. It can't be attacked and has no turn of
 * its own. Anyone, friend or foe, who ends a turn beside it burns; the caster rolls it up to 30 ft as a
 * bonus action, and ramming a creature burns that creature and stops the sphere.
 *
 * The body is a reservation-only entity: not in game.heroes or game.monsters, so nothing targets it, but
 * its `_side` belongs to nobody, so pathfinding treats its tile as an enemy's for every mover.
 */
import { spellDC } from './spells.js';

export const SPHERE_REACH = 1.5;   // the 8 tiles around it, diagonals included
export const SPHERE_MOVE = 6;      // tiles per bonus action
const STEP_SEC = 0.14;             // the glide, per tile

function roll(count, sides, bonus = 0) {
  let t = bonus;
  for (let i = 0; i < count; i++) t += Math.floor(Math.random() * sides) + 1;
  return t;
}
const alive = (m) => m && m.data && m.data.hp > 0 && m.active !== false && !m.dead;
const beside = (m, b) => Math.hypot(m.x - b.x, m.z - b.z) <= SPHERE_REACH;
const everyone = (game) => [...(game.heroes || []), ...(game.monsters || [])].filter(alive);
const sideOf = (game, h) => ((game.monsters || []).includes(h) ? game.monsters : game.heroes) || [];
const foesOf = (game, h) => ((game.monsters || []).includes(h) ? game.heroes : game.monsters) || [];

/** Burn one creature: DEX save for half. */
export function burnCreature(game, zone, m) {
  const c = zone.caster;
  const dice = 2 + Math.max(0, (zone.slotLevel || 2) - 2);
  let dmg = Math.max(1, roll(dice, 6, c.data?.dmgBonus || 0));
  const saved = game.spellSave(m, 'dex', spellDC(c), { magic: true });
  if (saved) dmg = Math.floor(dmg / 2);
  game.spellDamage(m, dmg, c, false, { dmgType: 'fire', magical: true });
  game.fxLog(`🔥 ${m.data.name} ${saved ? 'saves (half dmg)' : 'fails save'} vs Flaming Sphere! (${dmg} fire)`, saved ? 'roll' : 'crit');
}

/** The end of `actor`'s turn: each sphere it stands beside burns it. */
export function burnAtTurnEnd(game, actor) {
  for (const zone of game.activeAoEZones || []) {
    if (zone.spellKey !== 'flamingSphere' || !zone.body) continue;
    if (alive(actor) && beside(actor, zone.body)) burnCreature(game, zone, actor);
  }
}

function neighbours(game, cell) {
  const W = game.D.W, H = game.D.H || Math.floor(game.D.grid.length / W);
  const cx = cell % W, cy = Math.floor(cell / W), out = [];
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const x = cx + ox, y = cy + oy;
    if ((ox || oy) && x >= 0 && x < W && y >= 0 && y < H) out.push(y * W + x);
  }
  return out;
}
const cellPos = (game, c) => ({ x: game.wx(c % game.D.W), z: game.wz(Math.floor(c / game.D.W)) });
const countBeside = (list, p) => list.filter((m) => alive(m) && beside(m, p)).length;

/** A body for the sphere on the free tile beside `foe` that catches the most foes and fewest friends. */
export function placeSphereBody(game, h, foe) {
  const body = { x: foe.x, z: foe.z, active: true, _side: 'sphere', reservedCell: -1, data: { name: 'Flaming Sphere', hp: 1, maxHp: 1, flying: true } };
  if (!game.D || !game.cellOf || !game.reserveCell) {   // the VFX editor: one tile toward the caster
    const d = Math.hypot(h.x - foe.x, h.z - foe.z) || 1;
    body.x = foe.x + (h.x - foe.x) / d;
    body.z = foe.z + (h.z - foe.z) / d;
    return body;
  }
  const home = game.cellOf(foe.x, foe.z);
  const reach = game._doorFreeCellsNear(home, 1, body);
  let best = -1, bestScore = Infinity;
  for (const c of neighbours(game, home)) {
    if (!reach.has(c) || game.isCellOccupiedAny(c, body)) continue;
    const p = cellPos(game, c);
    const score = countBeside(sideOf(game, h), p) * 3 - countBeside(foesOf(game, h), p) + Math.hypot(p.x - h.x, p.z - h.z) * 0.01;
    if (score < bestScore) { best = c; bestScore = score; }
  }
  if (best >= 0) {
    Object.assign(body, cellPos(game, best));
    game.reserveCell(body, best);
  } else game.placeAtFreeCell(body, foe.x, foe.z, { radius: 3 });
  return body;
}

const activeZone = (h) => (h?.conc?.key === 'flamingSphere' && h.conc.zone?.body ? h.conc.zone : null);

/**
 * Roll the sphere with the caster's bonus action, along the floor and round bodies, as far as its 30 ft
 * allows. Aimed at a creature it rolls up beside them and rams them, if it gets there.
 */
export function moveSphere(game, h, pos, clicked = null) {
  const zone = activeZone(h);
  if (!zone) { game.fxLog('No active Flaming Sphere to move.', 'sys'); return false; }
  if (h._bonusActed || h.bonusUsed) { game.fxLog(`${h.data.name} already used their Bonus Action this turn.`, 'sys'); return false; }
  const body = zone.body;
  const victim = alive(clicked) ? clicked
    : pos ? everyone(game).find((m) => game.cellOf(m.x, m.z) === game.cellOf(pos.x, pos.z)) : null;
  if (!victim && !pos) return false;

  const from = game.cellOf(body.x, body.z);
  let path = [from];
  if (!victim || !beside(victim, body)) {
    const goal = victim ? game.approachCellNear(game.cellOf(victim.x, victim.z), body) : game.cellOf(pos.x, pos.z);
    path = goal === from ? [from] : game.findPath(from, goal, { mover: body });
    if (!path || !path.length) { game.fxLog('The Flaming Sphere can\'t roll there.', 'sys'); return false; }
    path = path.slice(0, SPHERE_MOVE + 1);
  }

  h.bonusUsed = true;
  h._bonusActed = true;
  const end = path[path.length - 1];
  Object.assign(body, cellPos(game, end));
  game.reserveCell(body, end);
  game.fxLog(`🔥 ${h.data.name} rolls the Flaming Sphere${victim ? ` at ${victim.data.name}` : ''}!`, 'roll');

  const steps = path.slice(1);
  steps.forEach((c, i) => game.fxDelay(i * STEP_SEC, () => {
    if (activeZone(h) !== zone) return;
    const p = cellPos(game, c);
    game.moveAoEZone(zone, p.x, p.z, STEP_SEC);
    if (zone.liveFx?.glideTo) zone.liveFx.glideTo(p.x, p.z, STEP_SEC);
  }));
  if (victim && beside(victim, body)) {
    game.fxDelay(steps.length * STEP_SEC, () => {
      if (activeZone(h) === zone && alive(victim)) burnCreature(game, zone, victim);
    });
  }
  if (game.refreshAbilityHud) game.refreshAbilityHud();
  if (game.fxUpdateManualBar) game.fxUpdateManualBar();
  return true;
}

/** The hero AI's use of it: ram the nearest foe in reach whose far side has no friend to scorch. */
export function sphereAiMove(game, h) {
  const zone = activeZone(h);
  if (!zone || h._bonusActed || h.bonusUsed) return false;
  const body = zone.body;
  const foes = foesOf(game, h).filter(alive)
    .map((m) => ({ m, d: Math.hypot(m.x - body.x, m.z - body.z) }))
    .filter((e) => e.d <= SPHERE_MOVE + SPHERE_REACH)
    .sort((a, b) => a.d - b.d);
  for (const { m } of foes) {
    const p = beside(m, body) ? body : cellPos(game, game.approachCellNear(game.cellOf(m.x, m.z), body));
    if (countBeside(sideOf(game, h), p) === 0) return moveSphere(game, h, null, m);
  }
  return false;
}
