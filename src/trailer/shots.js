/**
 * TRAILER SHOTS — pure data. Everything about what gets filmed lives here so
 * new shots never touch the harness.
 *
 * A shot is:
 *   name      output prefix, and the frame-dump folder name
 *   duration  seconds
 *   fps       frames per second of the render (and of the final encode)
 *   size      [w, h] DELIVERY resolution, independent of window size
 *   supersample  render at this multiple of `size` and let ffmpeg scale back
 *             down. Available, but 1 by default: 2 does smooth texel crawl, and
 *             it also visibly softens the pixel art, which is the look. Costs
 *             4x the fill rate (measured 18 fps -> 3.4 fps).
 *   hw        false to force CPU (libx264) encoding. Defaults to true — NVENC
 *             measured both faster and smaller here; see the note in
 *             capture.js.
 *   crf       x264 quality for the mp4 render; lower is better and bigger.
 *             18 is a visually-lossless master; 16 roughly doubles the file
 *             again for little visible gain on pixel art.
 *   party     array of hero specs (see party.js), or null for an empty stage
 *   orbit     { yaw, speed, pitch, zoom } — speed is radians/second,
 *             zoom is 55/zoom world units of half-height (higher = tighter)
 *   beats     [{ at, ... }] environment changes, `at` in seconds
 *
 * A beat's fields are handed straight to Stage.forge(). `animate: true` plays
 * the staggered rise — the world building itself around the party. That is the
 * transition; there is no cut.
 *
 * `walk: { seconds, speed, heading }` lays the beat out as a crossing: the
 * leader starts at one edge of the room and walks through it for `seconds`,
 * with the camera locked on them the whole way. Set `seconds` to the beat's own
 * length so the crossing finishes as the environment changes.
 *
 * Give `heading` on the FIRST beat only. It locks for the rest of the shot, and
 * that is what makes the orbit read as one unbroken rotation: the camera's yaw
 * advances continuously, so the viewer is really reading the angle between
 * camera and party. Let a later beat re-derive its own heading and that angle
 * snaps, which looks like a cut no matter how smooth the yaw was.
 */

/** THEME_KEYS from dungeon_generator, for reference when authoring beats:
 *  ancient molten frost grim verdant forest moor mire holdfast boneyard
 *  ruinfield ashfield snowfield sporewood */


import { tierForBeat } from './gear.js';

/**
 * Build an evenly-paced tour from a list of [themeKey, level] stops.
 *
 * Times are derived, not hand-written, so the running order can be shuffled by
 * moving a line. Only the first stop carries a heading (it locks for the whole
 * shot — see Stage.resolveHeading) and only the first is pre-settled; every
 * later stop plays the rise, which is the transition.
 */
function tour(name, stops, { fps, beat, speed, size, orbit, crf, supersample }) {
  return {
    name, fps, size, party: null, orbit, crf, supersample,
    duration: stops.length * beat,
    beats: stops.map(([themeKey, level], i) => ({
      at: i * beat,
      themeKey,
      level,
      /* Gear climbs with the scenery — see gear.js. */
      gear: tierForBeat(i, stops.length),
      /* Deterministic but unrelated per stop, so no two biomes inherit the
         same floor plan. */
      seed: (0x9e37 + i * 7919) >>> 0,
      animate: i > 0,
      walk: { seconds: beat, speed, ...(i === 0 ? { heading: [1, 0] } : {}) }
    }))
  };
}

/**
 * Every biome, ordered as a descent: open wilderness, then the thresholds
 * paired with the dungeon each one is the doorstep of (see the `threshold`
 * field in THEMES), ending underground. Levels ramp 1 -> 20 so the gear and
 * monster tier climb with the scenery once those are wired in.
 */
const BIOME_TOUR = [
  ['forest',     1], ['moor',       2], ['mire',      3], ['holdfast',  4],
  ['ruinfield',  5], ['ancient',    7],
  ['ashfield',   9], ['molten',    11],
  ['snowfield', 12], ['frost',     14],
  ['sporewood', 15], ['verdant',   17],
  ['boneyard',  18], ['grim',      20]
];

export const SHOTS = {
  /* The proving shot: the lead hero walks across a forest clearing with the
     camera locked on them and swinging slowly behind, then the world changes
     under their feet and they keep walking. If this reads, the full
     progression montage is the same thing twelve more times. */
  swap_test: {
    name: 'swap_test',
    duration: 8,
    fps: 60,
    size: [1920, 1080],
    party: null,                 /* null -> DEFAULT_PARTY */
    orbit: { yaw: Math.PI / 4, speed: 0.13, pitch: 0.60, zoom: 10.0 },
    beats: [
      { at: 0, themeKey: 'forest',  seed: 20260820, level: 1, animate: false,
        walk: { seconds: 4, speed: 1.7, heading: [1, 0] } },
      { at: 4, themeKey: 'ancient', seed: 90210,    level: 6, animate: true,
        walk: { seconds: 4, speed: 1.7 } }
    ]
  },


  /* Every biome in one continuous take: fourteen environments rising and
     falling away under a party that never stops walking, while the camera makes
     most of one slow revolution around them.

     Beats are 3s. That is about as quick as a swap can be and still read — the
     level's rise animation runs ~2.15s (animEnd + tail), so a shorter beat
     would cut to the next biome before this one finished building. */
  biome_tour: tour('biome_tour', BIOME_TOUR, {
    fps: 30,
    beat: 3,
    speed: 1.7,
    size: [1920, 1080],
    supersample: 1,
    crf: 18,
    /* Pitch a touch higher than the two-beat shots: looking further down the
       near wall stops it standing between the camera and the party as the
       orbit swings past. */
    orbit: { yaw: Math.PI / 4, speed: 0.13, pitch: 0.70, zoom: 10.0 }
  }),

  /* Same shot, quarter cost — for eyeballing changes fast. */
  swap_quick: {
    name: 'swap_quick',
    duration: 6,
    fps: 30,
    size: [1280, 720],
    party: null,
    orbit: { yaw: Math.PI / 4, speed: 0.18, pitch: 0.60, zoom: 10.0 },
    beats: [
      { at: 0, themeKey: 'forest',  seed: 20260820, level: 1, animate: false,
        walk: { seconds: 3, speed: 1.7, heading: [1, 0] } },
      { at: 3, themeKey: 'ancient', seed: 90210,    level: 6, animate: true,
        walk: { seconds: 3, speed: 1.7 } }
    ]
  }
};

export const DEFAULT_SHOT = 'swap_test';
