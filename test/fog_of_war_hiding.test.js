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

  it('hides exit indicator when its room is unvisited and unrevealed, and reveals it when visited', () => {
    const mockExitIndicator = {
      mesh: { visible: true },
      _nixieInst: { id: 'portal' }
    };

    const game = {
      engine: {
        getMeshes: () => ({}),
        getLights: () => [],
        getParticles: () => null,
        getStandalone: () => []
      },
      floorExit: { roomId: 3, x: 2, y: 2 },
      _exitIndicator: mockExitIndicator,
      visitedRooms: new Uint8Array(5),
      revealed: new Uint8Array(100),
      losSeen: new Uint8Array(100),
      D: { W: 10, H: 10, roomId: new Int32Array(100).fill(-1) }
    };
    Object.assign(game, fogMethods);

    // Initial state: room 3 is unvisited
    const visState = new Uint8Array(5); // 0 for room 3
    game._applyPropFog(visState, new Uint8Array(100));

    expect(mockExitIndicator.mesh.visible).toBe(false);
    expect(mockExitIndicator._nixieInst).toBeNull();

    // Now visit room 3
    visState[3] = 2;
    game.visitedRooms[3] = 1;
    game._applyPropFog(visState, new Uint8Array(100));

    expect(mockExitIndicator.mesh.visible).toBe(true);
  });

  it('gates point lights with roomId so unvisited room lights receive fogMult = 0', () => {
    const campfireLight = {
      userData: { roomId: 4, fogMult: 1 }
    };

    const game = {
      engine: {
        getMeshes: () => ({}),
        getLights: () => [campfireLight],
        getParticles: () => null,
        getStandalone: () => []
      },
      visitedRooms: new Uint8Array(5),
      revealed: new Uint8Array(100),
      D: { W: 10, H: 10, roomId: new Int32Array(100).fill(-1) }
    };
    Object.assign(game, fogMethods);

    // Room 4 is unvisited (visState[4] = 0)
    const visState = new Uint8Array(5);
    game._applyPropFog(visState, new Uint8Array(100));

    expect(campfireLight.userData.fogMult).toBe(0);

    // Once room 4 is visited (visState[4] = 2)
    visState[4] = 2;
    game._applyPropFog(visState, new Uint8Array(100));

    expect(campfireLight.userData.fogMult).toBe(1);
  });
});

