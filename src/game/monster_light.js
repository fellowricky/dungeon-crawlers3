/* ── monsters & light ───────────────────────────────────────────────────────
   docs/LIGHT_IDEAS.md 17, 18, 37–43. Most traits are read from the SRD
   statblock text the monsters already carry (Sunlight Sensitivity, Sunlight
   Weakness, Shadow Stealth, Illumination…); the rest are design calls keyed
   by id (ghostly glow, torch-bearers, light-snuffers, drawn-to-light).
   Pure data — the behaviours live in monster_ai.js and the visuals in
   render/sprite_lighting.js. */

const FT = 5;
const traitNames = d => ((d && d.statblock && d.statblock.traits) || []).map(t => (t && t.name) || '');
const traitDesc = (d, name) => {
  const t = ((d && d.statblock && d.statblock.traits) || []).find(x => x && x.name === name);
  return (t && (t.desc || t.text)) || '';
};

const FIRE = 0xff9a4a, WISP = 0x9fe8ff, GHOST = 0xb8d0ff, FIREFLY = 0xc8ff7a;

/* "sheds bright light in a 10-foot radius and dim light for an additional 10 ft" */
function parseIllumination(desc) {
  const m = /bright light in a (\d+)(?:-\s*to\s*(\d+))?-foot radius and dim light (?:for|in) an additional (\d+)?/i.exec(desc || '');
  if (!m) return null;
  const bright = (m[2] ? 10 : +m[1]) / FT;               // a variable 5–20 ft light sits at 10 ft
  const extra = m[3] ? +m[3] / FT : bright;
  return { bright, dim: bright + extra };
}

/** Light traits for a monster (cached on its data). */
export function monsterLightTraits(m) {
  const d = m && (m.data || m);
  if (!d) return {};
  if (d._lightTraits) return d._lightTraits;
  const id = (d.id || d.monsterId || d.key || '').toLowerCase();
  const names = traitNames(d);
  const has = n => names.includes(n);
  const t = {
    sunlightSensitive: has('Sunlight Sensitivity'),
    sunlightWeak: has('Sunlight Weakness'),
    shadowStealth: has('Shadow Stealth'),
    vampire: /vampire/.test(id) || has('Vampire Weaknesses'),
    drawnToLight: /moth/.test(id),
    douser: /^goblin|^cultist|-goblin\b|-cultist\b/.test(id) && !/hobgoblin/.test(id),
    darknessAura: (d.abilities || []).some(a => a && a.key === 'darkness-aura') ? 2 : 0,
    glow: null
  };
  /* 37: shedding light — from the statblock where it says so */
  for (const n of names) {
    if (!/illumination/i.test(n)) continue;
    const r = parseIllumination(traitDesc(d, n)) || { bright: 2, dim: 4 };
    t.glow = { ...r, color: /wisp|moth/.test(id) ? WISP : /firefly/.test(id) ? FIREFLY : FIRE };
  }
  if (!t.glow) {
    if (/phoenix/.test(id)) t.glow = { bright: 6, dim: 12, color: FIRE };
    else if (/fire-bat|salamander|ember-swarm/.test(id)) t.glow = { bright: 0, dim: 2, color: FIRE };
    /* 38: ghostly dim glow */
    else if (/^ghost$|specter|spectre|banshee/.test(id)) t.glow = { bright: 0, dim: 2, color: GHOST };
    /* 42: torch-bearers — the torcbearer always, an orc or hobgoblin patrol sometimes */
    else if (/torcbearer/.test(id)) t.glow = { bright: 2, dim: 4, color: FIRE, torch: true };
  }
  d._lightTraits = t;
  return t;
}

/** The light a monster sheds right now, or null. Orc and hobgoblin patrols
 *  carry a torch one time in three (decided once per monster). */
export function monsterGlow(m) {
  if (!m || !m.data || m.data.hp <= 0) return null;
  const t = monsterLightTraits(m);
  if (t.glow) return t.glow;
  const id = (m.data.id || '').toLowerCase();
  if (/^orc|hobgoblin/.test(id)) {
    if (m._torchRoll === undefined) m._torchRoll = Math.random() < 1 / 3;
    if (m._torchRoll) return { bright: 2, dim: 4, color: FIRE, torch: true };
  }
  return null;
}
