/**
 * Tiny shared scratch objects used across systems (avoid per-frame allocs).
 */
import * as THREE from 'three';

export const _v = new THREE.Vector3();
