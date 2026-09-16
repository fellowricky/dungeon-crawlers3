/* ─────────────── Gates and the fog of war ───────────────
 * Closed doors were showing up as slabs floating in the dark over corridors
 * the party had never entered. The fog was doing its job — it sinks a hidden
 * instance to HIDE_Y and remembers where it belongs in _origPy — but the door
 * code wrote instance positions directly. Opening ONE door re-syncs every gate
 * on the floor, so a single unlock anywhere lifted every hidden gate on the map
 * back to y = 0.
 *
 * The rule: while the fog holds an instance, the fog owns its py. An owner may
 * update where the instance BELONGS (_origPy, which the fog restores from) but
 * must not touch the live transform.
 */
import { describe, it, expect } from 'vitest';
import { fogMethods, syncDoorInstance, isFogHidden, DOOR_OPEN_Y } from '../src/game/fog.js';

const HIDE_Y = -999;

/** Minimal stand-in for the gate InstancedMesh the scene builds. */
function makeGateMesh(n) {
  const set = {
    n,
    px: [], py: [], pz: [], sx: [], sy: [], sz: [], rx: [], ry: [], rz: [],
    col: [], delay: [], roomIds: []
  };
  for (let i = 0; i < n; i++) {
    set.px.push(i * 2); set.py.push(0); set.pz.push(0);
    set.sx.push(1); set.sy.push(1.8); set.sz.push(1);
    set.rx.push(0); set.ry.push(0); set.rz.push(0);
  }
  const written = [];
  return {
    userData: { set },
    written,
    setMatrixAt(i, m) { written.push({ i, y: m.elements[13], scaleY: m.elements[5] }); },
    instanceMatrix: { needsUpdate: false }
  };
}

const fog = Object.assign({}, fogMethods);

describe('Door visuals respect the fog', () => {
  it('leaves a fog-hidden gate hidden when another door opens', () => {
    const mesh = makeGateMesh(3);
    fog._sinkInstance(mesh, 1);                    // gate 1 is in unexplored dark
    expect(isFogHidden(mesh, 1)).toBe(true);

    /* A door elsewhere opens; the game re-syncs the whole floor. */
    for (let i = 0; i < 3; i++) syncDoorInstance(mesh, i, i === 0);

    expect(mesh.userData.set.py[1], 'a hidden gate was lifted back into view')
      .toBe(HIDE_Y);
    expect(isFogHidden(mesh, 1)).toBe(true);
  });

  it('still updates where a hidden gate belongs, so revealing it is correct', () => {
    const mesh = makeGateMesh(2);
    fog._sinkInstance(mesh, 0);
    syncDoorInstance(mesh, 0, true);               // it opened while out of sight
    expect(mesh.userData.set.py[0]).toBe(HIDE_Y);  // still hidden

    fog._raiseInstance(mesh, 0);                   // party arrives, fog reveals it
    expect(mesh.userData.set.py[0], 'revealed as a closed gate after it opened')
      .toBe(DOOR_OPEN_Y);
  });

  it('writes visible gates normally', () => {
    const mesh = makeGateMesh(2);
    expect(syncDoorInstance(mesh, 0, false)).toBe(true);
    expect(mesh.userData.set.py[0]).toBe(0);
    expect(syncDoorInstance(mesh, 1, true)).toBe(true);
    expect(mesh.userData.set.py[1]).toBe(DOOR_OPEN_Y);
    /* An open gate is scaled away as well as sunk. */
    const openWrite = mesh.written.filter(w => w.i === 1).pop();
    expect(openWrite.scaleY).toBe(0);
  });

  it('scales an open gate to nothing in the SET, not just in one matrix', () => {
    /* Sinking it to DOOR_OPEN_Y is not enough on its own. Other passes rebuild
       a gate's matrix straight from the set arrays — the fog raising a revealed
       cell, settleAll after the intro — and each of them took the full scale
       and put the slab back, hanging in the void under the map where a high
       camera could see it. */
    const mesh = makeGateMesh(1);
    syncDoorInstance(mesh, 0, true);
    const s = mesh.userData.set;
    expect([s.sx[0], s.sy[0], s.sz[0]], 'open gate kept its size').toEqual([0, 0, 0]);

    /* The exact resurrection path: fog hides it, then reveals it again. */
    fog._sinkInstance(mesh, 0);
    fog._raiseInstance(mesh, 0);
    const last = mesh.written[mesh.written.length - 1];
    expect(last.y).toBe(DOOR_OPEN_Y);
    expect(last.scaleY, 'the fog re-drew an opened gate at full size').toBe(0);
  });

  it('restores the original size if a gate is ever closed again', () => {
    const mesh = makeGateMesh(1);
    const want = mesh.userData.set.sy[0];
    syncDoorInstance(mesh, 0, true);
    syncDoorInstance(mesh, 0, false);
    expect(mesh.userData.set.sy[0]).toBe(want);
  });

  it('reports that it declined to write a hidden gate', () => {
    const mesh = makeGateMesh(1);
    fog._sinkInstance(mesh, 0);
    expect(syncDoorInstance(mesh, 0, false)).toBe(false);
  });
});
