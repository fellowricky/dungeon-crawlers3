import * as THREE from 'three';
import {
  createDefaultParticleEffect,
  createDefaultParticleEmitter,
  normalizeParticleEffect
} from 'nixie-fx';
import { ThreeVfxRenderer } from 'nixie-fx/three';

let vfxRenderer = null;

const STANDARD_SPARK_CURVE = {
  mode: 'curve',
  value: 1.0,
  min: 0.0,
  max: 1.0,
  curve: [
    { x: 0.0, y: 1.0 },
    { x: 0.5, y: 0.7 },
    { x: 1.0, y: 0.0 }
  ]
};

/**
 * Helper to build a fully normalized NixieFX particle effect preset.
 */
function createSampleEffect(type) {
  const effect = createDefaultParticleEffect(type, type);
  effect.targetProfile = 'three-world-3d';

  const emitter = createDefaultParticleEmitter('e1', type);
  emitter.modules.velocity = true;
  emitter.modules.forces = true;
  emitter.modules.size = true;
  emitter.modules.color = true;

  if (type === 'hit_sparks') {
    // Sharp physical weapon impact splash sparks (crisp silver-white & steel gold)
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.95, 0.70, 1.0],
        intensity: 1.8
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'crit_sparks') {
    // Large golden shockwave splash for critical strikes
    emitter.maxParticles = 30;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 24, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'circle',
      radius: 0.08,
      emitFrom: 'edge'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.25, max: 0.45 },
      size: { mode: 'random', min: 0.07, max: 0.13 },
      velocity: {
        mode: 'vector',
        min: [-3.4, 2.8, -3.4],
        max: [3.4, 5.5, 3.4]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.85, 0.15, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.40
    };
  } else if (type === 'blunt_impact') {
    // Stone fragments & dust impact splash for bludgeoning weapons
    emitter.maxParticles = 12;
    emitter.duration = 0.26;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 8, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.025,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.16, max: 0.26 },
      size: { mode: 'random', min: 0.03, max: 0.05 },
      velocity: {
        mode: 'vector',
        min: [-0.9, 1.0, -0.9],
        max: [0.9, 2.0, 0.9]
      },
      color: {
        mode: 'constant',
        color: [0.80, 0.90, 1.0, 1.0],
        intensity: 1.4
      }
    };
    emitter.forces = {
      gravity: 9.0,
      gravityValue: { mode: 'constant', value: 9.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'pierce_sparks') {
    // Sharp needle splash sparks for piercing weapons
    emitter.maxParticles = 18;
    emitter.duration = 0.35;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 14, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.04,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.20, max: 0.35 },
      size: { mode: 'random', min: 0.05, max: 0.09 },
      velocity: {
        mode: 'vector',
        min: [-2.2, 2.4, -2.2],
        max: [2.2, 4.8, 2.2]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.95, 0.80, 1.0],
        intensity: 1.8
      }
    };
    emitter.forces = {
      gravity: 8.5,
      gravityValue: { mode: 'constant', value: 8.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.40
    };
  } else if (type === 'fire_sparks') {
    // Deep blazing flame orange & red impact splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.32, 0.02, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'frost_sparks') {
    // Vivid icy cyan & azure blue frost splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [0.10, 0.75, 1.0, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'acid_sparks') {
    // Intense neon lime-green caustic acid splash droplets
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [0.15, 1.0, 0.05, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'poison_sparks') {
    // Deep toxic emerald green poison splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.5, 2.1, -2.5],
        max: [2.5, 4.4, 2.5]
      },
      color: {
        mode: 'constant',
        color: [0.08, 0.95, 0.25, 1.0],
        intensity: 2.0
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'lightning_sparks') {
    // Electric neon violet-blue lightning splash
    emitter.maxParticles = 20;
    emitter.duration = 0.35;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.18, max: 0.35 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-3.0, 2.4, -3.0],
        max: [3.0, 5.0, 3.0]
      },
      color: {
        mode: 'constant',
        color: [0.65, 0.40, 1.0, 1.0],
        intensity: 2.4
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.40
    };
  } else if (type === 'holy_sparks') {
    // Radiant divine golden sunbeam splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.85, 0.20, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'dark_sparks') {
    // Deep necrotic shadow-purple soul splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.5, 2.1, -2.5],
        max: [2.5, 4.4, 2.5]
      },
      color: {
        mode: 'constant',
        color: [0.75, 0.15, 1.0, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'force_sparks') {
    // Arcane magenta force energy splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.6, 2.2, -2.6],
        max: [2.6, 4.6, 2.6]
      },
      color: {
        mode: 'constant',
        color: [0.95, 0.25, 0.95, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'psychic_sparks') {
    // Vivid psychic hot pink splash
    emitter.maxParticles = 20;
    emitter.duration = 0.38;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 16, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.38 },
      size: { mode: 'random', min: 0.055, max: 0.095 },
      velocity: {
        mode: 'vector',
        min: [-2.5, 2.1, -2.5],
        max: [2.5, 4.4, 2.5]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.20, 0.70, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: 7.5,
      gravityValue: { mode: 'constant', value: 7.5 },
      drag: 0.8,
      dragValue: { mode: 'constant', value: 0.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'torch_embers') {
    // Continuous micro-embers floating upward from wall sconces
    emitter.maxParticles = 14;
    emitter.duration = 1.5;
    emitter.loop = true;
    emitter.spawn = {
      rate: 5,
      shape: 'cylinder',
      radius: 0.04,
      height: 0.08,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.5, max: 1.1 },
      size: { mode: 'random', min: 0.025, max: 0.05 },
      velocity: {
        mode: 'vector',
        min: [-0.15, 0.8, -0.15],
        max: [0.15, 1.8, 0.15]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.7, 0.2, 1.0],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: -0.6,
      gravityValue: { mode: 'constant', value: -0.6 },
      drag: 0.2,
      dragValue: { mode: 'constant', value: 0.2 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.5
    };
  } else if (type === 'campfire_embers') {
    // Campfire sparks rising and drifting
    emitter.maxParticles = 26;
    emitter.duration = 2.0;
    emitter.loop = true;
    emitter.spawn = {
      rate: 12,
      shape: 'cylinder',
      radius: 0.15,
      height: 0.15,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.6, max: 1.4 },
      size: { mode: 'random', min: 0.035, max: 0.07 },
      velocity: {
        mode: 'vector',
        min: [-0.3, 1.0, -0.3],
        max: [0.3, 2.2, 0.3]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.72, 0.2, 1.0],
        intensity: 2.6
      }
    };
    emitter.forces = {
      gravity: -0.5,
      gravityValue: { mode: 'constant', value: -0.5 },
      drag: 0.3,
      dragValue: { mode: 'constant', value: 0.3 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'fire_burst') {
    emitter.maxParticles = 36;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 28, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.12,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.40 },
      size: { mode: 'random', min: 0.05, max: 0.10 },
      velocity: {
        mode: 'vector',
        min: [-3.5, 1.5, -3.5],
        max: [3.5, 5.5, 3.5]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.65, 0.15, 1.0],
        intensity: 2.8
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 1.5,
      dragValue: { mode: 'constant', value: 1.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'frost_nova') {
    emitter.maxParticles = 32;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 25, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.12,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.40 },
      size: { mode: 'random', min: 0.045, max: 0.09 },
      velocity: {
        mode: 'vector',
        min: [-3.5, 1.0, -3.5],
        max: [3.5, 4.8, 3.5]
      },
      color: {
        mode: 'constant',
        color: [0.65, 0.90, 1.0, 1.0],
        intensity: 2.6
      }
    };
    emitter.forces = {
      gravity: 8.0,
      gravityValue: { mode: 'constant', value: 8.0 },
      drag: 1.5,
      dragValue: { mode: 'constant', value: 1.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.4
    };
  } else if (type === 'lightning_burst') {
    emitter.maxParticles = 28;
    emitter.duration = 0.32;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 22, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.1,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.15, max: 0.30 },
      size: { mode: 'random', min: 0.04, max: 0.085 },
      velocity: {
        mode: 'vector',
        min: [-4.5, 1.2, -4.5],
        max: [4.5, 6.0, 4.5]
      },
      color: {
        mode: 'constant',
        color: [0.85, 0.65, 1.0, 1.0],
        intensity: 3.2
      }
    };
    emitter.forces = {
      gravity: 4.0,
      gravityValue: { mode: 'constant', value: 4.0 },
      drag: 1.8,
      dragValue: { mode: 'constant', value: 1.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.35
    };
  } else if (type === 'poison_burst') {
    emitter.maxParticles = 26;
    emitter.duration = 0.42;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 20, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.1,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.20, max: 0.38 },
      size: { mode: 'random', min: 0.04, max: 0.085 },
      velocity: {
        mode: 'vector',
        min: [-2.8, 1.2, -2.8],
        max: [2.8, 4.2, 2.8]
      },
      color: {
        mode: 'constant',
        color: [0.45, 0.98, 0.45, 1.0],
        intensity: 2.5
      }
    };
    emitter.forces = {
      gravity: 10.0,
      gravityValue: { mode: 'constant', value: 10.0 },
      drag: 1.5,
      dragValue: { mode: 'constant', value: 1.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.5
    };
  } else if (type === 'holy_burst' || type === 'divine_smite') {
    emitter.maxParticles = 38;
    emitter.duration = 0.5;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 30, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.12,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.25, max: 0.45 },
      size: { mode: 'random', min: 0.05, max: 0.10 },
      velocity: {
        mode: 'vector',
        min: [-3.5, 1.8, -3.5],
        max: [3.5, 5.8, 3.5]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.95, 0.55, 1.0],
        intensity: 3.0
      }
    };
    emitter.forces = {
      gravity: -0.5,
      gravityValue: { mode: 'constant', value: -0.5 },
      drag: 1.5,
      dragValue: { mode: 'constant', value: 1.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'dark_burst') {
    emitter.maxParticles = 28;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 22, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.12,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.22, max: 0.40 },
      size: { mode: 'random', min: 0.045, max: 0.09 },
      velocity: {
        mode: 'vector',
        min: [-3.0, 1.2, -3.0],
        max: [3.0, 4.5, 3.0]
      },
      color: {
        mode: 'constant',
        color: [0.8, 0.35, 1.0, 1.0],
        intensity: 2.6
      }
    };
    emitter.forces = {
      gravity: 3.0,
      gravityValue: { mode: 'constant', value: 3.0 },
      drag: 1.5,
      dragValue: { mode: 'constant', value: 1.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.5
    };
  } else if (type === 'loot_sparkles') {
    // Golden coin sparkle fountain when opening treasure chests
    emitter.maxParticles = 36;
    emitter.duration = 0.65;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 28, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'circle',
      radius: 0.12,
      emitFrom: 'surface'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.35, max: 0.65 },
      size: { mode: 'random', min: 0.04, max: 0.08 },
      velocity: {
        mode: 'vector',
        min: [-2.5, 3.2, -2.5],
        max: [2.5, 5.8, 2.5]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.9, 0.35, 1.0],
        intensity: 3.0
      }
    };
    emitter.forces = {
      gravity: 12.0,
      gravityValue: { mode: 'constant', value: 12.0 },
      drag: 1.2,
      dragValue: { mode: 'constant', value: 1.2 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.4
    };
  } else if (type === 'portal_vortex') {
    // Swirling magical rune particles around floor exit portal
    emitter.maxParticles = 36;
    emitter.duration = 2.0;
    emitter.loop = true;
    emitter.spawn = {
      rate: 18,
      shape: 'circle',
      radius: 0.6,
      emitFrom: 'edge'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.6, max: 1.4 },
      size: { mode: 'random', min: 0.04, max: 0.075 },
      velocity: {
        mode: 'vector',
        min: [-0.6, 0.8, -0.6],
        max: [0.6, 2.0, 0.6]
      },
      color: {
        mode: 'constant',
        color: [0.55, 0.8, 1.0, 1.0],
        intensity: 2.8
      }
    };
    emitter.forces = {
      gravity: -0.4,
      gravityValue: { mode: 'constant', value: -0.4 },
      drag: 0.5,
      dragValue: { mode: 'constant', value: 0.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'level_up_burst') {
    // Ascending golden sparks for hero level-up
    emitter.maxParticles = 40;
    emitter.duration = 0.75;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 32, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'cylinder',
      radius: 0.2,
      height: 0.15,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.4, max: 0.75 },
      size: { mode: 'random', min: 0.045, max: 0.09 },
      velocity: {
        mode: 'vector',
        min: [-1.2, 3.8, -1.2],
        max: [1.2, 7.0, 1.2]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.95, 0.55, 1.0],
        intensity: 3.2
      }
    };
    emitter.forces = {
      gravity: -1.0,
      gravityValue: { mode: 'constant', value: -1.0 },
      drag: 1.2,
      dragValue: { mode: 'constant', value: 1.2 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.4
    };
  } else if (type === 'projectile_fire_trail') {
    // Fiery sparks trailing behind firebolts
    emitter.maxParticles = 18;
    emitter.duration = 0.25;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 8, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.12, max: 0.25 },
      size: { mode: 'random', min: 0.03, max: 0.06 },
      velocity: {
        mode: 'vector',
        min: [-0.6, 0.3, -0.6],
        max: [0.6, 1.4, 0.6]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.7, 0.15, 1.0],
        intensity: 2.4
      }
    };
    emitter.forces = {
      gravity: 2.0,
      gravityValue: { mode: 'constant', value: 2.0 },
      drag: 1.8,
      dragValue: { mode: 'constant', value: 1.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'projectile_magic_trail') {
    // Arcane glints trailing behind magic missiles
    emitter.maxParticles = 18;
    emitter.duration = 0.25;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 8, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.05,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.12, max: 0.25 },
      size: { mode: 'random', min: 0.03, max: 0.06 },
      velocity: {
        mode: 'vector',
        min: [-0.6, 0.3, -0.6],
        max: [0.6, 1.4, 0.6]
      },
      color: {
        mode: 'constant',
        color: [0.8, 0.55, 1.0, 1.0],
        intensity: 2.4
      }
    };
    emitter.forces = {
      gravity: 0.0,
      gravityValue: { mode: 'constant', value: 0.0 },
      drag: 1.8,
      dragValue: { mode: 'constant', value: 1.8 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'aura_poison') {
    // Toxic bubbling vapor rising from feet of poisoned units
    emitter.maxParticles = 16;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 6, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'circle',
      radius: 0.15,
      emitFrom: 'surface'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.35, max: 0.70 },
      size: { mode: 'random', min: 0.03, max: 0.06 },
      velocity: {
        mode: 'vector',
        min: [-0.25, 0.8, -0.25],
        max: [0.25, 1.8, 0.25]
      },
      color: {
        mode: 'constant',
        color: [0.4, 0.95, 0.4, 0.9],
        intensity: 2.2
      }
    };
    emitter.forces = {
      gravity: -0.4,
      gravityValue: { mode: 'constant', value: -0.4 },
      drag: 0.6,
      dragValue: { mode: 'constant', value: 0.6 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.5
    };
  } else if (type === 'aura_bless') {
    // Golden sparkling glints rising around blessed units
    emitter.maxParticles = 16;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 6, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'cylinder',
      radius: 0.18,
      height: 0.25,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.35, max: 0.70 },
      size: { mode: 'random', min: 0.03, max: 0.06 },
      velocity: {
        mode: 'vector',
        min: [-0.2, 0.6, -0.2],
        max: [0.2, 1.5, 0.2]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.9, 0.45, 0.95],
        intensity: 2.6
      }
    };
    emitter.forces = {
      gravity: -0.4,
      gravityValue: { mode: 'constant', value: -0.4 },
      drag: 0.5,
      dragValue: { mode: 'constant', value: 0.5 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'aura_rage' || type === 'rage_sparks') {
    // Upward drifting stream of intense ruby red sparks around raging units
    emitter.maxParticles = 18;
    emitter.duration = 0.45;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 7, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'cylinder',
      radius: 0.16,
      height: 0.25,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.35, max: 0.65 },
      size: { mode: 'random', min: 0.03, max: 0.06 },
      velocity: {
        mode: 'vector',
        min: [-0.2, 1.2, -0.2],
        max: [0.2, 2.5, 0.2]
      },
      color: {
        mode: 'constant',
        color: [1.0, 0.12, 0.12, 1.0],
        intensity: 3.0
      }
    };
    emitter.forces = {
      gravity: -0.6,
      gravityValue: { mode: 'constant', value: -0.6 },
      drag: 0.4,
      dragValue: { mode: 'constant', value: 0.4 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.45
    };
  } else if (type === 'door_splinters') {
    // Wood splinters and dust when doors are opened or smashed
    emitter.maxParticles = 20;
    emitter.duration = 0.35;
    emitter.loop = false;
    emitter.spawn = {
      rate: 0,
      bursts: [{ time: 0, count: 15, cycles: 1, interval: 0.1, probability: 1 }],
      shape: 'sphere',
      radius: 0.08,
      emitFrom: 'volume'
    };
    emitter.render.blend = 'additive';
    emitter.initializeParticle = {
      lifetime: { mode: 'random', min: 0.18, max: 0.32 },
      size: { mode: 'random', min: 0.03, max: 0.065 },
      velocity: {
        mode: 'vector',
        min: [-2.8, 1.8, -2.8],
        max: [2.8, 4.8, 2.8]
      },
      color: {
        mode: 'constant',
        color: [0.85, 0.65, 0.40, 1.0],
        intensity: 1.8
      }
    };
    emitter.forces = {
      gravity: 14.0,
      gravityValue: { mode: 'constant', value: 14.0 },
      drag: 2.0,
      dragValue: { mode: 'constant', value: 2.0 }
    };
    emitter.billboard = {
      shape: 'circle',
      sizeValue: STANDARD_SPARK_CURVE,
      softness: 0.5
    };
  }

  effect.emitters = [emitter];
  return normalizeParticleEffect(effect);
}

const activeEffects = new Map(); // instance -> remainingLifetime
const effectLibrary = new Map();
const persistentInstances = [];
const persistentSpecs = [];

// Prepopulate standard effect presets
const PRESET_KEYS = [
  'hit_sparks',
  'crit_sparks',
  'blunt_impact',
  'pierce_sparks',
  'fire_sparks',
  'frost_sparks',
  'acid_sparks',
  'poison_sparks',
  'lightning_sparks',
  'holy_sparks',
  'dark_sparks',
  'force_sparks',
  'psychic_sparks',
  'torch_embers',
  'campfire_embers',
  'fire_burst',
  'divine_smite',
  'holy_burst',
  'frost_nova',
  'lightning_burst',
  'poison_burst',
  'dark_burst',
  'loot_sparkles',
  'portal_vortex',
  'level_up_burst',
  'projectile_fire_trail',
  'projectile_magic_trail',
  'aura_poison',
  'aura_bless',
  'aura_rage',
  'rage_sparks',
  'door_splinters'
];
for (const k of PRESET_KEYS) {
  effectLibrary.set(k, createSampleEffect(k));
}

/**
 * Initialize the NixieFX Three.js runtime renderer.
 */
export function initNixieVfx(scene, camera) {
  if (!scene || !camera) return null;
  if (!vfxRenderer) {
    vfxRenderer = new ThreeVfxRenderer({
      scene,
      camera
    });
  } else {
    vfxRenderer.mount(scene);
    vfxRenderer.camera = camera;
  }
  vfxRenderer.root.renderOrder = 35;
  return vfxRenderer;
}

/**
 * Pre-compile and warmup all particle shader programs during the loading screen.
 */
export function warmupNixieVfx(scene, camera) {
  if (!vfxRenderer && scene && camera) {
    initNixieVfx(scene, camera);
  }
  if (!vfxRenderer) return;
  for (const k of PRESET_KEYS) {
    try {
      const inst = playNixieEffect(k, [0, -999, 0], { duration: 0.05, scale: 0.01 });
      if (inst) {
        stopNixieEffect(inst);
      }
    } catch (e) {}
  }
}

/**
 * Play a NixieFX particle effect at a world position.
 */
export function playNixieEffect(effectKey, position, options = {}) {
  if (!vfxRenderer) return null;

  // Limit max concurrent burst effects to maintain locked 60 FPS
  if (activeEffects.size >= 24) {
    const oldest = activeEffects.keys().next().value;
    if (oldest) stopNixieEffect(oldest);
  }

  let effectDef = typeof effectKey === 'string' ? effectLibrary.get(effectKey) : effectKey;
  if (!effectDef) {
    if (typeof effectKey === 'string') {
      effectDef = createSampleEffect(effectKey);
      effectLibrary.set(effectKey, effectDef);
    }
  }
  if (!effectDef) return null;

  try {
    const px = Array.isArray(position) ? (position[0] || 0) : (position?.x || 0);
    const py = Array.isArray(position) ? (position[1] !== undefined ? position[1] : 0.6) : (position?.y !== undefined ? position.y : 0.6);
    const pz = Array.isArray(position) ? (position[2] || 0) : (position?.z || 0);
    const sc = options.scale || 1.0;

    const instance = vfxRenderer.createEffect(effectDef, {
      seed: options.seed !== undefined ? options.seed : Math.floor(Math.random() * 100000),
      position: [px, py, pz],
      scale: [sc, sc, sc]
    });

    if (instance) {
      instance.setRenderOrder(35);
      const dur = options.duration !== undefined ? options.duration : 0.35;
      if (dur !== null && dur > 0) {
        activeEffects.set(instance, dur);
      }
      return instance;
    }
  } catch (err) {
    console.warn('NixieFX play error:', err);
  }

  return null;
}

/**
 * Stop and dispose an active effect instance.
 */
export function stopNixieEffect(instance) {
  if (!instance) return;
  activeEffects.delete(instance);
  if (vfxRenderer && typeof vfxRenderer.removeEffect === 'function') {
    vfxRenderer.removeEffect(instance, true);
  }
}

/**
 * Clear all persistent level particle effects on level transition.
 */
export function clearPersistentNixieEffects() {
  for (const inst of persistentInstances) {
    stopNixieEffect(inst);
  }
  persistentInstances.length = 0;
  persistentSpecs.length = 0;
  for (const inst of activeEffects.keys()) {
    stopNixieEffect(inst);
  }
  activeEffects.clear();
}

/**
 * Register a continuous particle emitter (e.g. campfire).
 */
export function registerPersistentNixieEffect(effectKey, position, options = {}) {
  const spec = { effectKey, position, options, inst: null };
  persistentSpecs.push(spec);

  const g = typeof globalThis !== 'undefined' ? globalThis.game : null;
  const needGate = options.roomId !== undefined && g && g.visitedRooms;
  if (!needGate || g.visitedRooms[options.roomId]) {
    const inst = playNixieEffect(effectKey, position, { ...options, duration: null });
    if (inst) {
      inst._pos = position;
      inst._spec = spec;
      spec.inst = inst;
      persistentInstances.push(inst);
      return inst;
    }
  }
  return null;
}

/**
 * Stop persistent particle effects near a world position (e.g. extinguishing a campfire).
 */
export function stopPersistentNixieEffectsNear(x, z, radius = 2.5) {
  for (let i = persistentSpecs.length - 1; i >= 0; i--) {
    const spec = persistentSpecs[i];
    const pos = spec.position;
    const px = Array.isArray(pos) ? pos[0] : (pos?.x ?? 0);
    const pz = Array.isArray(pos) ? pos[2] : (pos?.z ?? 0);
    if (Math.hypot(px - x, pz - z) <= radius) {
      if (spec.inst) {
        stopNixieEffect(spec.inst);
        const idx = persistentInstances.indexOf(spec.inst);
        if (idx >= 0) persistentInstances.splice(idx, 1);
      }
      persistentSpecs.splice(i, 1);
    }
  }
}

/**
 * Tick the NixieFX renderer once per animation frame with automatic garbage collection.
 */
export function updateNixieVfx(dt) {
  if (!vfxRenderer) return;

  const g = typeof globalThis !== 'undefined' ? globalThis.game : null;
  if (g && g.visitedRooms) {
    for (const spec of persistentSpecs) {
      if (spec.options.roomId !== undefined) {
        const vis = !!g.visitedRooms[spec.options.roomId];
        if (vis && !spec.inst) {
          spec.inst = playNixieEffect(spec.effectKey, spec.position, { ...spec.options, duration: null });
          if (spec.inst) {
            spec.inst._pos = spec.position;
            spec.inst._spec = spec;
            persistentInstances.push(spec.inst);
          }
        } else if (!vis && spec.inst) {
          stopNixieEffect(spec.inst);
          const idx = persistentInstances.indexOf(spec.inst);
          if (idx >= 0) persistentInstances.splice(idx, 1);
          spec.inst = null;
        }
      }
    }
  }

  // Advance lifetimes and clean up expired instances
  const step = Math.min(dt || 0.016, 0.05);
  for (const [inst, remaining] of activeEffects.entries()) {
    const next = remaining - step;
    if (next <= 0) {
      stopNixieEffect(inst);
    } else {
      activeEffects.set(inst, next);
    }
  }

  vfxRenderer.update(step);
}
