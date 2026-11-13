/* ============================================================================
   appearance.js — the catalogue of hero looks.

   Single source of truth for every cosmetic option the character creator
   offers and for the layer paths those options resolve to, so the creator
   preview (ui.js), the portraits and the in-dungeon sprites (sprite_animator.js)
   can never drift apart.

   Assets live under public/lpc/ and are mirrored from the vendored
   Universal-LPC-Spritesheet repo by scripts/sync_lpc_hair.sh. Re-run that
   script after adding entries here that point at new art.
   ============================================================================ */

/* Long styles ship split across bg / mg / fg sheets so the hair can fall both
   behind and in front of the body. Everything else is one flat sheet.
   Keys are the style value without the trailing body variant.

   Known upstream gap: relm_ponytail, xlong_braidl/r and topknot_long have no
   `hurt` sheet for their bg (and fg) parts, so those bands drop out of the
   hurt/death animation. The layer loader tolerates a missing sheet, so this
   costs a frame of hair rather than a broken sprite. */
const MULTIPART_HAIR = {
  'bangslong2':        ['bg', 'fg'],
  'braid':             ['bg', 'fg'],
  'braid2':            ['bg', 'fg'],
  'bunches':           ['bg', 'fg'],
  'curls_large_xlong': ['bg', 'fg'],
  'high_ponytail':     ['bg', 'fg'],
  'long_band':         ['bg', 'fg'],
  'long_center_part':  ['bg', 'fg'],
  'long_tied':         ['bg', 'fg'],
  'ponytail':          ['bg', 'fg'],
  'ponytail2':         ['bg', 'fg'],
  'princess':          ['bg', 'fg'],
  'relm_ponytail':     ['bg', 'mg', 'fg'],
  'relm_xlong':        ['bg', 'fg'],
  'sara':              ['bg', 'fg'],
  'shoulderl':         ['bg', 'fg'],
  'shoulderr':         ['bg', 'fg'],
  'single':            ['bg', 'fg'],
  'wavy':              ['bg', 'fg'],
  'xlong':             ['bg', 'fg'],
  'xlong_wavy':        ['bg', 'fg'],
  /* extensions */
  'extensions/bangs/xlong_braidl':  ['bg', 'fg'],
  'extensions/bangs/xlong_braidr':  ['bg', 'fg'],
  'extensions/ponytails/relm_ponytail': ['bg', 'fg'],
  'extensions/ponytails/topknot_long':  ['bg', 'fg']
};

/* ---------------------------------------------------------------- hair ---- */
/* Grouped for the picker's <optgroup>s. Values are `<style>/<variant>`; the
   sync script normalises every style to an `adult` variant. */
export const HAIR_GROUPS = [
  { label: 'Short', styles: [
    ['balding',            'Balding'],
    ['buzzcut',            'Buzzcut'],
    ['high_and_tight',     'High & Tight'],
    ['flat_top_fade',      'Flat Top Fade'],
    ['flat_top_straight',  'Flat Top'],
    ['pixie',              'Pixie'],
    ['relm_short',         'Cropped'],
    ['plain',              'Plain'],
    ['mop',                'Mop'],
    ['page',               'Page'],
    ['page2',              'Page (Long)'],
    ['bob',                'Bob'],
    ['bob_side_part',      'Bob, Side Part'],
    ['lob',                'Long Bob'],
    ['idol',               'Idol']
  ]},
  { label: 'Messy & Windblown', styles: [
    ['bedhead',            'Bedhead'],
    ['unkempt',            'Unkempt'],
    ['halfmessy',          'Half Messy'],
    ['messy1',             'Messy'],
    ['messy2',             'Messy (Short)'],
    ['messy3',             'Messy (Tousled)'],
    ['long_messy',         'Long Messy'],
    ['long_messy2',        'Long Messy (Full)'],
    ['cowlick',            'Cowlick'],
    ['cowlick_tall',       'Cowlick (Tall)']
  ]},
  { label: 'Parted & Swept', styles: [
    ['parted',             'Parted'],
    ['parted2',            'Parted (Loose)'],
    ['parted3',            'Parted (Deep)'],
    ['parted_side_bangs',  'Side Bangs'],
    ['parted_side_bangs2', 'Side Bangs (Long)'],
    ['swoop',              'Swoop'],
    ['swoop_side',         'Side Swoop'],
    ['curtains',           'Curtains'],
    ['curtains_long',      'Curtains (Long)'],
    ['bangs',              'Bangs'],
    ['bangsshort',         'Bangs (Short)'],
    ['bangslong',          'Bangs (Long)'],
    ['bangslong2',         'Bangs (Flowing)']
  ]},
  { label: 'Long & Flowing', styles: [
    ['long',               'Long'],
    ['long_straight',      'Long Straight'],
    ['long_center_part',   'Long, Centre Part'],
    ['long_band',          'Long, Headband'],
    ['long_tied',          'Long, Tied Back'],
    ['loose',              'Loose'],
    ['half_up',            'Half Up'],
    ['wavy',               'Wavy'],
    ['xlong',              'Waist Length'],
    ['xlong_wavy',         'Waist Length, Wavy'],
    ['relm_xlong',         'Floor Length'],
    ['princess',           'Princess'],
    ['natural',            'Natural'],
    ['sara',               'Sara'],
    ['shoulderl',          'Over Shoulder (L)'],
    ['shoulderr',          'Over Shoulder (R)'],
    ['single',             'Single Fall']
  ]},
  { label: 'Curly & Coiled', styles: [
    ['afro',               'Afro'],
    ['jewfro',             'Curly Afro'],
    ['curly_short',        'Curly Short'],
    ['curly_short2',       'Curly Crop'],
    ['curly_long',         'Curly Long'],
    /* `curls_large` is deliberately absent — upstream only ships a spellcast
       sheet for it, so it would vanish in every other animation. */
    ['curls_large_xlong',  'Big Curls (Long)'],
    ['cornrows',           'Cornrows'],
    ['twists_fade',        'Twists, Faded'],
    ['twists_straight',    'Twists'],
    ['dreadlocks_short',   'Dreadlocks (Short)'],
    ['dreadlocks_long',    'Dreadlocks (Long)']
  ]},
  { label: 'Tied & Braided', styles: [
    ['ponytail',           'Ponytail'],
    ['ponytail2',          'Ponytail (Low)'],
    ['high_ponytail',      'High Ponytail'],
    ['relm_ponytail',      'Long Ponytail'],
    ['braid',              'Braid'],
    ['braid2',             'Braid (Thick)'],
    ['bunches',            'Bunches'],
    ['pigtails',           'Pigtails'],
    ['pigtails_bangs',     'Pigtails & Bangs'],
    ['bangs_bun',          'Bun & Bangs']
  ]},
  { label: 'Spiked & Wild', styles: [
    ['spiked',             'Spiked'],
    ['spiked2',            'Spiked (Tall)'],
    ['spiked_beehive',     'Beehive'],
    ['spiked_liberty',     'Liberty Spikes'],
    ['spiked_liberty2',    'Liberty Spikes (Wide)'],
    ['spiked_porcupine',   'Porcupine'],
    ['shorthawk',          'Short Mohawk'],
    ['longhawk',           'Long Mohawk']
  ]}
];

/* Hair extensions — braids, ponytails and ties layered *over* a base style.
   Values are relative to the hair root and already include the variant. */
export const HAIR_EXTENSION_GROUPS = [
  { label: 'Side Braids & Locks', styles: [
    ['extensions/bangs/braidl',         'Braid (Left)'],
    ['extensions/bangs/braidr',         'Braid (Right)'],
    ['extensions/bangs/long_straightl', 'Straight Lock (Left)'],
    ['extensions/bangs/long_straightr', 'Straight Lock (Right)'],
    ['extensions/bangs/long_wavyl',     'Wavy Lock (Left)'],
    ['extensions/bangs/long_wavyr',     'Wavy Lock (Right)'],
    ['extensions/bangs/xlong_bangl',    'Long Bang (Left)'],
    ['extensions/bangs/xlong_bangr',    'Long Bang (Right)'],
    ['extensions/bangs/xlong_braidl',   'Long Braid (Left)'],
    ['extensions/bangs/xlong_braidr',   'Long Braid (Right)'],
    ['extensions/bangs/xlong_curlyl',   'Long Curl (Left)'],
    ['extensions/bangs/xlong_curlyr',   'Long Curl (Right)'],
    ['extensions/bangs/xlong_wavyl',    'Long Wave (Left)'],
    ['extensions/bangs/xlong_wavyr',    'Long Wave (Right)']
  ]},
  { label: 'Ponytails & Ties', styles: [
    ['extensions/ponytails/relm_ponytail', 'Trailing Ponytail'],
    ['extensions/ponytails/topknot_long',  'Topknot (Long)'],
    ['extensions/ponytails/topknot_short', 'Topknot (Short)'],
    ['extensions/ties/high_bun',           'High Bun']
  ]}
];

/* --------------------------------------------------------- facial hair ---- */
export const FACIAL_HAIR_GROUPS = [
  { label: 'Beards', styles: [
    ['beard/5oclock_shadow', 'Stubble'],
    ['beard/basic',          'Short Beard'],
    ['beard/trimmed',        'Trimmed Beard'],
    ['beard/medium',         'Full Beard'],
    ['beard/winter',         'Wild Beard']
  ]},
  { label: 'Moustaches', styles: [
    ['mustache/basic',      'Moustache'],
    ['mustache/chevron',    'Chevron'],
    ['mustache/french',     'French'],
    ['mustache/handlebar',  'Handlebar'],
    ['mustache/horseshoe',  'Horseshoe'],
    ['mustache/lampshade',  'Lampshade'],
    ['mustache/walrus',     'Walrus'],
    ['mustache/bigstache',  'Big Stache']
  ]}
];

/* ============================== recolouring ===============================
   LPC character sheets are drawn in one reference tone and recoloured at
   runtime. The recolour replaces the hue and saturation while keeping each
   pixel's *relative* shading, so the pixel art's highlights and shadows
   survive.

   `matchLightness` additionally slides the whole sheet so its average
   lightness lands on the swatch's own lightness. Without it a swatch's
   lightness is thrown away entirely and #4a2f1c (dark brown) renders
   identically to #e8c878 (blonde) — they share a hue and a rough saturation.
   Character layers (skin, hair, beards, eyes) use it; equipment dyes do not,
   because item `visualColor` values were authored against the older
   hue-and-saturation-only behaviour.
   ========================================================================= */

export function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3), 16), parseInt(hex.slice(3,5), 16), parseInt(hex.slice(5,7), 16)];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
export function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255)
  ];
}

/* How far the shading may be squeezed to fit a very dark or very light tint
   before we accept some clipping instead. Dropping to 0 would flatten a sheet
   into a silhouette; 1 would clip hard at both ends. */
const MIN_CONTRAST = 0.55;
const L_FLOOR = 0.02, L_CEIL = 0.99;

/**
 * Recolour an RGBA buffer in place.
 * @param {Uint8ClampedArray} d  pixel data from getImageData
 * @param {string} tintHex
 * @param {boolean} matchLightness  slide shading onto the tint's lightness
 */
export function recolorPixels(d, tintHex, matchLightness = false) {
  const [tr, tg, tb] = hexToRgb(tintHex);
  const [th, ts, tl] = rgbToHsl(tr, tg, tb);

  let shift = 0, contrast = 1;
  if (matchLightness) {
    /* Pass 1: where does this sheet's shading currently sit? */
    let sum = 0, n = 0, min = 1, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const l = (Math.max(d[i], d[i+1], d[i+2]) + Math.min(d[i], d[i+1], d[i+2])) / 510;
      sum += l; n++;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    if (n) {
      const mean = sum / n;
      const up = Math.max(1e-4, max - mean), down = Math.max(1e-4, mean - min);
      contrast = Math.min(1, (L_CEIL - tl) / up, (tl - L_FLOOR) / down);
      contrast = Math.max(MIN_CONTRAST, contrast);
      shift = tl - mean * contrast;
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (matchLightness) {
      let [, , l] = rgbToHsl(d[i], d[i+1], d[i+2]);
      l = Math.min(L_CEIL, Math.max(L_FLOOR, l * contrast + shift));
      const [cr, cg, cb] = hslToRgb(th, ts, l);
      d[i] = cr; d[i+1] = cg; d[i+2] = cb;
    } else {
      /* Equipment tint: multiply the tint by the pixel's brightness (its
         brightest channel), not by its colour. Most gear sheets are near-grey,
         where the two are the same, but a sheet drawn in colour (the blue
         tabard, brown leather) was multiplied channel by channel: blue x the
         orange Inferno dye came out dark green. Shading is kept; the hue is
         the tint's. */
      const v = Math.max(d[i], d[i+1], d[i+2]);
      d[i]     = (v * tr) / 255 | 0;
      d[i + 1] = (v * tg) / 255 | 0;
      d[i + 2] = (v * tb) / 255 | 0;
    }
  }
}

/** Layers recoloured as part of the character rather than as dyed equipment. */
const CHARACTER_LAYERS = new Set([
  'body', 'head', 'ears', 'horns', 'horns_behind', 'eyes',
  'hairBehind', 'hairMid', 'hair', 'facialHair',
  'hairExtBehind', 'hairExtMid', 'hairExt'
]);
export const isCharacterLayer = layer => CHARACTER_LAYERS.has(layer);

/* ------------------------------------------------------------- palettes --- */
/* Authored against the recolour above: a swatch's lightness IS the rendered
   lightness, so each ramp runs from near-black to near-white rather than
   being a row of same-brightness hues. Measure a sheet's starting point with
   `node scripts/sheet_lightness.mjs <png>` before adding entries.
   The FIRST entry of each list is that palette's default. */

/* Skin is race-dependent: the body and the beast heads are recoloured from
   their own reference art, and offering pink to an orc just muddies it. */
export const SKIN_PALETTES = {
  human: [
    '#f6d0b4', '#ffe3d0', '#eab98d', '#d9a066', '#c08552',
    '#a06a3c', '#7d4f2b', '#5c3a20', '#43291a', '#2b1a12'
  ],
  orc: [
    '#8fae7a', '#b6d49c', '#9ec284', '#749a5c', '#5a7c46', '#425f33',
    '#2e4526', '#9aa89a', '#6e7d6e', '#4a564a', '#a8b96a', '#6a7a8a'
  ],
  /* Chromatic and metallic dragon scales, dark hides through bright metals. */
  draconic: [
    '#5f9a45', '#7fbf55', '#2f5c2a', '#c2352f', '#7a1c1a', '#2a52be',
    '#7fa8e0', '#1c1c22', '#e8eef2', '#b8c0c8', '#d9b23c', '#b5a642',
    '#c46a34', '#8a4a1f', '#6a3a9a', '#2f7f7a', '#c9b183', '#4a5a6a'
  ],
  /* Infernal bloodlines — these are meant to be loud. Blood and ember reds,
     magenta, violet, cobalt, sulphur, plus ash-black and bone-white extremes
     so a tiefling can read as anything from a devil to a marble statue. */
  tiefling: [
    '#c0182b', '#e8562a', '#7a0a1e', '#dd5566', '#d4308f', '#f2b8c8', '#7a1fbf',
    '#4a0f7a', '#1f3fd0', '#5fc8e8', '#0f8a7a', '#2a6a2a', '#e8c22a',
    '#6a6270', '#241c28', '#efe4e8', '#8a2f10'
  ]
};
const RACE_SKIN = { halforc: 'orc', dragonborn: 'draconic', tiefling: 'tiefling' };
export const skinColorsFor = raceKey => SKIN_PALETTES[RACE_SKIN[raceKey] || 'human'];

/* Naturals first (black through platinum, then reds and greys), then dyes. */
export const HAIR_COLORS = [
  '#0d0a08', '#241a12', '#4a2f1c', '#6b451f', '#8f5f2a', '#b07d3c',
  '#d2a44e', '#e8c878', '#f6e3ae', '#8a2b12', '#c04a1e', '#e8703a',
  '#6e6a62', '#a8a29a', '#e6e2da',
  '#7a1030', '#c8184a', '#5a1f8a', '#a04ad0', '#e88ad0',
  '#1f4a8a', '#3f8fd0', '#7fd8e8', '#1f6a3a', '#5fc04a'
];

export const EYE_COLORS = [
  '#1a1410', '#4a3018', '#7a4a20', '#a87a35', '#d8b03a',
  '#2f6a2f', '#5aa83a', '#2a4a90', '#4477d8', '#7fc8e8',
  '#a83030', '#7a3fa8', '#8a8a96', '#e0e8f0'
];

/* -------------------------------------------------------- race defaults --- */
/* `head` assigns a distinctive LPC head where one fits the race
   (dragonborn -> lizard, half-orc -> orc); the rest read as human and
   differentiate via ears / horns / beard / skin / sprite scaling.
   Colours are drawn from the palettes above so a fresh hero always starts on
   a real swatch. */
const RACE_DEFAULTS = {
  human:      { head:'',           skinColor:'#f6d0b4', hairColor:'#6b451f', ears:'none',  horns:'none',      facialHair:'none',         eyeColor:'#4a3018', spriteScaleX:1.00, spriteScaleY:1.00 },
  elf:        { head:'',           skinColor:'#ffe3d0', hairColor:'#e8c878', ears:'elven', horns:'none',      facialHair:'none',         eyeColor:'#7fc8e8', spriteScaleX:1.00, spriteScaleY:1.08 },
  halfelf:    { head:'',           skinColor:'#ffe3d0', hairColor:'#e8c878', ears:'elven', horns:'none',      facialHair:'none',         eyeColor:'#7fc8e8', spriteScaleX:1.00, spriteScaleY:1.00 },
  dwarf:      { head:'',           skinColor:'#eab98d', hairColor:'#b07d3c', ears:'none',  horns:'none',      facialHair:'beard/medium', eyeColor:'#4a3018', spriteScaleX:1.15, spriteScaleY:0.85 },
  halfling:   { head:'',           skinColor:'#f6d0b4', hairColor:'#6b451f', ears:'none',  horns:'none',      facialHair:'none',         eyeColor:'#7a4a20', spriteScaleX:0.82, spriteScaleY:0.82 },
  gnome:      { head:'',           skinColor:'#f6d0b4', hairColor:'#5fc04a', ears:'elven', horns:'none',      facialHair:'none',         eyeColor:'#5aa83a', spriteScaleX:0.88, spriteScaleY:0.88 },
  halforc:    { head:'orc/male',   skinColor:'#8fae7a', hairColor:'#241a12', ears:'none',  horns:'none',      facialHair:'none',         eyeColor:'#a83030', spriteScaleX:1.00, spriteScaleY:1.00 },
  dragonborn: { head:'lizard/male',skinColor:'#5f9a45', hairColor:'#d2a44e', ears:'dragon',horns:'curled',    facialHair:'none',         eyeColor:'#d8b03a', spriteScaleX:1.00, spriteScaleY:1.00, hornTint:'hair' },
  tiefling:   { head:'',           skinColor:'#c0182b', hairColor:'#241a12', ears:'elven', horns:'backwards', facialHair:'none',         eyeColor:'#d8b03a', spriteScaleX:1.00, spriteScaleY:1.00, hornTint:'skin' }
};
export const getRaceDefaults = raceKey => ({ ...(RACE_DEFAULTS[raceKey] || RACE_DEFAULTS.human) });

/* How a hero's spriteScaleX/Y is spent. A uniform scale (halfling, gnome)
   shrinks the whole figure, which keeps every proportion, so the quad takes it.
   A non-uniform one (dwarf: wider, shorter) is a build, and squashing the whole
   quad squashed the face too. That goes into the body layers at compose time
   instead (sprite_animator.js squatPlan), and the head stays its natural
   shape. Keyed off the visual's own numbers, so saved heroes, which carry a
   copy of the scales, pick this up with no migration. */
export function heroShape(visual) {
  const sx = (visual && visual.spriteScaleX) || 1.0;
  const sy = (visual && visual.spriteScaleY) || 1.0;
  if (Math.abs(sx - sy) < 1e-6) return { quadX: sx, quadY: sy, bodyX: 1, bodyY: 1 };
  return { quadX: 1, quadY: 1, bodyX: sx, bodyY: sy };
}

/* Layers that belong to the head. Under a body build they keep their size and
   ride down with the neck; everything else (body, clothes, gear) is squashed. */
export const HEAD_LAYERS = new Set([
  'horns_behind', 'hairBehind', 'hairExtBehind', 'head', 'eyes', 'ears', 'horns',
  'facialHair', 'hairMid', 'hair', 'hairExtMid', 'hairExt', 'helm', 'visor'
]);

/* Nearest palette entry to an arbitrary hex, by RGB distance. Saved heroes
   carry colours from before the recolour respected lightness — those hexes
   were all authored bright, so replaying them verbatim would turn every old
   party pasty. Snapping them onto the current palette keeps a loaded party
   looking like it did. */
/* Weighted RGB distance (the usual 2/4/3 green-biased approximation). Matching
   on the swatch itself honours the chip the player clicked — the picker always
   drew swatches as their literal hex, even back when the recolour ignored a
   swatch's lightness. Matching instead on what reached the screen would remap
   a chosen black to mid-grey, since that is what black used to render as. */
function nearest(hex, palette){
  if (!hex) return palette[0];
  if (palette.includes(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  let best = palette[0], bestD = Infinity;
  for (const c of palette) {
    const [cr, cg, cb] = hexToRgb(c);
    const d = 2 * (cr - r) ** 2 + 4 * (cg - g) ** 2 + 3 * (cb - b) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Snap a saved hero's colours onto the current palettes. Mutates `visual`. */
export function migrateVisualColors(visual, raceKey){
  if (!visual) return;
  /* Saves predating per-race horn tinting carry no `hornTint`; the horn style
     alone can't identify the race (a dragonborn may wear backswept horns), so
     take it from the race the hero actually is. */
  if (!visual.hornTint) visual.hornTint = getRaceDefaults(raceKey).hornTint || 'hair';
  /* The race build isn't a player choice, just a copy of the race's scales made
     at creation, so a retuned race (taller elves) reaches saved heroes too. */
  if (RACE_DEFAULTS[raceKey] && !visual.singleImage && !visual.animations) {   // companions keep their own
    const rd = RACE_DEFAULTS[raceKey];
    visual.spriteScaleX = rd.spriteScaleX || 1.0;
    visual.spriteScaleY = rd.spriteScaleY || 1.0;
  }
  visual.skinColor = nearest(visual.skinColor, skinColorsFor(raceKey));
  visual.hairColor = nearest(visual.hairColor, HAIR_COLORS);
  visual.eyeColor  = nearest(visual.eyeColor, EYE_COLORS);
  if (visual.hairExtColor) visual.hairExtColor = nearest(visual.hairExtColor, HAIR_COLORS);
}

/* ------------------------------------------------------------- helpers ---- */
const flatten = groups => groups.flatMap(g => g.styles);

/** Every hair value the picker offers, 'none' first. */
export const HAIR_VALUES = ['none', ...flatten(HAIR_GROUPS).map(([k]) => `${k}/adult`)];
export const HAIR_EXTENSION_VALUES = ['none', ...flatten(HAIR_EXTENSION_GROUPS).map(([k]) => `${k}/adult`)];
export const FACIAL_HAIR_VALUES = ['none', ...flatten(FACIAL_HAIR_GROUPS).map(([k]) => k)];

const LABELS = new Map([
  ...flatten(HAIR_GROUPS).map(([k, l]) => [`${k}/adult`, l]),
  ...flatten(HAIR_EXTENSION_GROUPS).map(([k, l]) => [`${k}/adult`, l]),
  ...flatten(FACIAL_HAIR_GROUPS)
]);

/** Human-readable name for any hair / extension / facial-hair value. */
export function labelFor(value){
  if (!value || value === 'none') return 'None';
  return LABELS.get(value) || value.split('/')[0];
}

/* Strip the trailing body variant so the value can be matched against
   MULTIPART_HAIR ('xlong/adult' -> 'xlong'). */
const styleKey = value => value.replace(/\/(adult|male|female|child)$/, '');

/** True when a style renders partly behind the body. */
export function isMultipartHair(value){
  return !!MULTIPART_HAIR[styleKey(value)];
}

/* Resolve one hair-ish value into the sprite paths for each depth band.
   `root` is the asset sub-path ('hair'), `value` the picker value. */
function partPaths(value){
  if (!value || value === 'none') return { bg: null, mg: null, fg: null };
  const parts = MULTIPART_HAIR[styleKey(value)];
  if (!parts) return { bg: null, mg: null, fg: `hair/${value}` };
  return {
    bg: parts.includes('bg') ? `hair/${value}/bg` : null,
    mg: parts.includes('mg') ? `hair/${value}/mg` : null,
    fg: parts.includes('fg') ? `hair/${value}/fg` : null
  };
}

/**
 * Layer paths for a hero's hair + extension, keyed by the layer names both
 * renderers use. Returns nulls for anything the look doesn't have.
 *
 * `suppressed` covers monsters and beast heads (lizard/orc), which have no
 * hair anchor points on their sheets.
 */
export function hairLayerPaths(visual, suppressed = false){
  if (suppressed) {
    return {
      hairBehind: null, hairMid: null, hair: null,
      hairExtBehind: null, hairExtMid: null, hairExt: null
    };
  }
  const h = partPaths(visual.hair);
  const e = partPaths(visual.hairExtension);
  return {
    hairBehind: h.bg, hairMid: h.mg, hair: h.fg,
    hairExtBehind: e.bg, hairExtMid: e.mg, hairExt: e.fg
  };
}

/** Layers tinted with the hair colour (extensions may carry their own). */
export const HAIR_LAYERS = ['hairBehind', 'hairMid', 'hair', 'facialHair'];
export const HAIR_EXT_LAYERS = ['hairExtBehind', 'hairExtMid', 'hairExt'];

/** Tint for a hair-ish layer: extensions fall back to the main hair colour. */
export function hairLayerTint(layer, visual){
  if (HAIR_EXT_LAYERS.includes(layer)) return visual.hairExtColor || visual.hairColor || null;
  return visual.hairColor || null;
}

/* ==========================================================================
   Full-body layer resolution.

   These used to live in sprite_animator.js, which meant the character-creator
   preview kept its own hand-written copy of the same table — and that copy had
   drifted into showing gear no class actually owns. They live here now so the
   preview, the portraits and the in-dungeon sprite all resolve identically.
   ========================================================================== */

/* Draw order, back to front. Roughly follows the LPC generator's zPos values
   (cape bg 5, legs 20, shirts 35, chainmail 50, jacket 55, torso armour and
   shoulders 60, bauldron 65, belts 65-80, gloves/bracers 70, cape fg 85). */
export const LAYER_ORDER = [
  'cape_behind',
  'shield_behind',
  'weapon_crystal_behind',
  'weapon_behind',
  /* the backswept horns' rear half (upstream zPos 7) passes behind the skull */
  'horns_behind',
  /* long hair falls behind the shoulders — these sheets sit under the body */
  'hairBehind',
  'hairExtBehind',
  'body',
  'head',
  'eyes',
  'legs',
  'torso',
  'sleeves',
  'feet',
  'shoulders',
  'bracers',
  'gloves',
  'neck',
  'ears',
  'horns',
  'facialHair',
  'hairMid',
  'hair',
  'hairExtMid',
  'hairExt',
  'helm',
  'visor',
  'cape',
  'shield',
  'weapon',
  'weapon_crystal'
];

/* Shields whose sheets include a behind-the-body half, so the arm reads as
   holding them rather than standing in front. Value = gendered sub-path. */
const SHIELDS_WITH_BACK = new Set([
  'crusader/fg', 'scutum', 'spartan', 'plus', 'two_engrailed'
]);

/* Capes that ship a background sheet (trim is foreground-only). */
const CAPES_WITH_BACK = new Set(['solid', 'tattered']);

/* Weapons that do NOT have a background sheet (or whose background sheet is an incorrect duplicate).
   For example, 'ranged/crossbow' ships with a duplicate bow back-layer sheet, causing heroes equipped
   with a crossbow to render both a bow and a crossbow simultaneously. */
const WEAPONS_WITHOUT_BACK = new Set(['ranged/crossbow']);

// LPC hats that ship as male/female sheets instead of a unisex adult sheet
/** Helm visuals (prefixes) worn over the hair, not covering it: the hair stays drawn. */
export const HELMS_SHOWING_HAIR = ['headband/'];

const GENDERED_HATS = new Set([
  'helmet/barbuta', 'helmet/close', 'helmet/greathelm', 'helmet/sugarloaf',
  'helmet/flattop', 'helmet/sugarloaf_simple'
]);

/* The `horns` slot doubles as the generic head-appendage slot: it also carries
   the LPC fins, which live under head/fins/ rather than head/horns/. Old saves
   store `curl` for what upstream ships as `curled`, so that alias stays. */
/* Only the backswept sheet ships a rear half; the rest are foreground-only.
   Upstream has no bg art for climb or hurt (the horns are out of frame in
   both), so those two are transparent stand-ins to keep the loader quiet. */
const HORN_BACK_PATHS = {
  backwards: 'horns/backwards/bg'
};

const HORN_PATHS = {
  backwards:  'horns/backwards',
  curl:       'horns/curled',
  curled:     'horns/curled',
  fin:        'fins/fin',
  fin_short:  'fins/fin_short'
};

/* Resolve every layer's asset directory for a hero's visual + equipment.
   Values are directories under public/lpc/; append `/${action}.png`. */
export function buildLayerPaths(visual, equipment = {}) {
  const g = visual.gender;
  const isMonster = (g === 'skeleton' || g === 'zombie');
  const customHead = visual.head;
  const clothG = (g === 'muscular' || g === 'teen' || g === 'child') ? 'male' : g;
  const hatG = clothG === 'female' ? 'female' : 'male';

  const w = equipment.weapon ? equipment.weapon.visualWeapon : null;
  const wc = equipment.weapon ? equipment.weapon.visualCrystal : null;
  const t = equipment.armor ? equipment.armor.visualTorso : null;
  const tsleeve = equipment.armor ? equipment.armor.visualSleeves : null;
  const l = equipment.armor ? (equipment.armor.visualLegs || 'pants') : (visual.pants !== undefined ? visual.pants : 'pants');
  const h = equipment.helm ? equipment.helm.visualHelm : null;
  const v = equipment.helm ? equipment.helm.visualVisor : null;
  const sh = equipment.offhand ? equipment.offhand.visualShield : null;
  const f = equipment.boots ? equipment.boots.visualShoes : (visual.shoes !== undefined ? visual.shoes : 'shoes/basic');
  const shld = equipment.armor ? equipment.armor.visualShoulders : null;
  const brc = equipment.armor ? equipment.armor.visualBracers : null;
  const cape = equipment.armor ? equipment.armor.visualCape : null;
  const blt = null; // belt layer removed
  const glv = equipment.gloves ? equipment.gloves.visualGloves : null;
  const nk = null; // Amulet neck sprites removed (too large/overwhelming)

  const sh_behind = (sh && SHIELDS_WITH_BACK.has(sh)) ? `shield_behind/${sh}/${clothG}` : null;

    /* Per-hero cosmetic toggle, set from the Equipment tab. Only the helm and
       visor sprite layers are dropped — the item stays equipped, so its stat
       bonuses and its tint on other layers are untouched. */
    const hideHatsToggle = !!(visual && (visual.hideHelm || visual.hideHat));
    /* A visible helm hides the hair: big styles stuck out from behind the helm
       layer. Beards stay (they sit below the helm line), and so does hair under
       headgear that is worn over it rather than covering it. */
    const helmHidesHair = !!(h && !hideHatsToggle && !HELMS_SHOWING_HAIR.some(pre => h.startsWith(pre)));
    return {
      cape_behind: (cape && CAPES_WITH_BACK.has(cape)) ? `cape_behind/${cape}` : null,
      cape: cape ? `cape/${cape}` : null,
      bracers: brc ? `arms/${brc}/${clothG === 'male' ? 'male' : 'thin'}` : null,
      belt: null,
      shield_behind: sh_behind,
      weapon_crystal_behind: wc ? `weapon_behind/${wc}` : null,
      weapon_behind: (w && !WEAPONS_WITHOUT_BACK.has(w)) ? `weapon_behind/${w}` : null,
      body: `body/bodies/${g}`,
      head: customHead ? `head/heads/${customHead}` : (isMonster ? null : `head/heads/human/${clothG}`),
      eyes: (isMonster || customHead) ? null : `eyes/human/adult/default`,
      ears: (!isMonster && visual.ears && visual.ears !== 'none'
             && (!customHead || visual.ears === 'dragon')) ? `head/ears/${visual.ears}/adult` : null,
      horns: (!isMonster && visual.horns && visual.horns !== 'none' && HORN_PATHS[visual.horns]) ? `head/${HORN_PATHS[visual.horns]}` : null,
      horns_behind: (!isMonster && visual.horns && HORN_BACK_PATHS[visual.horns]) ? `head/${HORN_BACK_PATHS[visual.horns]}` : null,
      legs: (isMonster || l === 'none') ? null : `legs/${l}/${l === 'armour/plate' ? 'male' : clothG}`,
      torso: (isMonster || t === 'none' || !t) ? null : `torso/${t}/${clothG}`,
      sleeves: (isMonster || !tsleeve) ? null : `torso/${tsleeve}/${clothG}`,
      feet: (isMonster || f === 'none') ? null : `feet/${f}/${clothG === 'male' ? 'male' : 'thin'}`,
      shoulders: shld ? `shoulders/${shld}/${shld === 'legion' ? clothG : (clothG === 'male' ? 'male' : 'thin')}` : null,
      gloves: glv ? `${glv}/${clothG === 'male' ? 'male' : 'thin'}` : null,
      neck: nk ? `neck/${nk}/${hatG}` : null,
      facialHair: (isMonster || customHead || !visual.facialHair || visual.facialHair === 'none') ? null : `beards/${visual.facialHair}`,
      ...hairLayerPaths(visual, isMonster || !!customHead || helmHidesHair),
      helm: (h && !hideHatsToggle) ? `hat/${h}/${GENDERED_HATS.has(h) ? hatG : 'adult'}` : null,
      visor: (v && !hideHatsToggle) ? `hat/visor/${v}/adult` : null,
      shield: sh ? (sh === 'round' ? `shield/${sh}` : `shield/${sh}/${clothG}`) : null,
      weapon: w ? `weapon/${w}` : null,
      weapon_crystal: wc ? `weapon/${wc}` : null
    };
}

/* Which equipment slot tints a given layer (visualColor lookup).
   `belt` is deliberately absent — belts stay their native leather/iron so they
   read as separate straps instead of vanishing into a same-coloured torso. */
function tintSlotFor(layer) {
  if (layer === 'helm' || layer === 'visor') return 'helm';
  if (layer === 'shield' || layer === 'shield_behind') return 'offhand';
  if (layer === 'weapon' || layer === 'weapon_behind') return 'weapon';
  if (layer === 'feet') return 'boots';
  if (layer === 'legs' || layer === 'torso' || layer === 'shoulders' || layer === 'sleeves'
      || layer === 'bracers' || layer === 'cape' || layer === 'cape_behind') return 'armor';
  if (layer === 'gloves') return 'gloves';
  if (layer === 'neck') return 'amulet';
  return layer;
}

/** Pick the tint colour for a layer (null = draw untinted). */
export function layerTint(layer, visual, equipment = {}) {
  if (layer === 'body' || layer === 'head' || layer === 'ears') return visual.skinColor || null;
  /* Which swatch drives the keratin is per-race (`hornTint`). A dragonborn's
     horns follow the hair colour — matching the skin buried their curled horns
     in their own scalp, and since a beast head draws no hair layer the hair
     swatch would otherwise do nothing at all for them. A tiefling's horns are
     an outgrowth of the same red hide and stay on the skin swatch.
     No colour set = draw the sheet's native keratin. */
  if (layer === 'horns' || layer === 'horns_behind') {
    return (visual.hornTint === 'skin' ? visual.skinColor : visual.hairColor) || null;
  }
  if (HAIR_LAYERS.includes(layer) || HAIR_EXT_LAYERS.includes(layer)) return hairLayerTint(layer, visual);
  if (layer === 'eyes') return visual.eyeColor || null;
  if (layer === 'weapon_crystal' || layer === 'weapon_crystal_behind') {
    const wItem = equipment.weapon;
    return (wItem && wItem.crystalColor) ? wItem.crystalColor : null;
  }
  const it = equipment[tintSlotFor(layer)];
  return (it && it.visualColor) ? it.visualColor : null;
}
