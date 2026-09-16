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

  it('keeps particles visible when anchored to revealed overland cells', () => {
    const mockPosArray = [0, 0, 0,  1, 0, 1];
    const mockParts = {
      userData: {
        fogCells: [5, 12],
        origY: [0.3, 0.4]
      },
      geometry: {
        getAttribute(name) {
          if (name === 'position') return { array: mockPosArray, needsUpdate: false };
        }
      }
    };

    const game = {
      engine: {
        getMeshes: () => ({}),
        getLights: () => [],
        getParticles: () => mockParts,
        getStandalone: () => []
      },
      revealed: { 5: 1 }, // Cell 5 is revealed, cell 12 is unrevealed
      D: { W: 10, H: 10, roomId: new Int32Array(100).fill(-1) }
    };
    Object.assign(game, fogMethods);

    game._applyPropFog([], new Uint8Array(100)); // seen is all 0s (overland)

    expect(mockPosArray[1]).toBe(0.3); // Cell 5 (revealed) -> kept origY
    expect(mockPosArray[4]).toBe(-999); // Cell 12 (unrevealed) -> sunk to HIDE_Y
  });
});
