import { describe, it, expect } from 'vitest';
import { fogMethods } from '../src/game/fog.js';

describe('Fog of War Object Hiding', () => {
  it('zero-scales instance matrix when sunk below floor in _writeInstanceMatrix', () => {
    const mockMesh = {
      userData: {
        set: {
          px: [10], py: [-999], pz: [10],
          rx: [0], ry: [0], rz: [0],
          sx: [1], sy: [1], sz: [1]
        }
      },
      setMatrixAt(i, matrix) {
        this.lastMatrix = matrix;
      },
      instanceMatrix: { needsUpdate: false }
    };

    const game = {};
    Object.assign(game, fogMethods);

    game._writeInstanceMatrix(mockMesh, 0);

    expect(mockMesh.instanceMatrix.needsUpdate).toBe(true);
    // Matrix elements 0, 5, 10 are scale components — expect 0 when sunk
    expect(mockMesh.lastMatrix.elements[0]).toBe(0);
    expect(mockMesh.lastMatrix.elements[5]).toBe(0);
    expect(mockMesh.lastMatrix.elements[10]).toBe(0);
  });
});
