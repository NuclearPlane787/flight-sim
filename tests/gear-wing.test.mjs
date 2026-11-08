// v0.3.1: the main gear hangs from fixed structure, not from the flap cove, on all three types, and
// the gear doors are panels that show from both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { FLAP_IN_LE_X, slab, foilPiece, foilPoint } from '../src/aircraft.js';
import { GEAR as A321_GEAR, WING as A321_WING } from '../src/geometry.js';
import { inboardFlapLE } from '../src/widebody.js';
import { B787_9, B777_300ER } from '../src/widebody-specs.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test("the A321's inner flap starts behind the main gear's leg, and the wing sits where Airbus draws it", () => {
  const g = A321_GEAR.left;
  // The leg's radius is 0.15 m: its back is at x − 0.15, and the flap's nose must be behind that.
  assert.ok(FLAP_IN_LE_X < g.x - 0.15 - 0.15, `flap leading edge at ${FLAP_IN_LE_X.toFixed(2)}, leg at ${g.x}`);
  // Airbus AC 2-2-0 (top view): the root's trailing edge 1.33 m behind the main gear.
  const teRoot = A321_WING.rootX - A321_WING.rootChord;
  assert.ok(Math.abs(g.x - teRoot - 1.33) < 0.01, `root trailing edge ${(g.x - teRoot).toFixed(2)} m behind the gear`);
});

for (const spec of [B787_9, B777_300ER]) {
  test(`${spec.id}: the inboard flap starts behind the main gear's leg and its side stay`, () => {
    const g = spec.geo.GEAR.left, fl = inboardFlapLE(spec);
    // The leg (radius 0.2 m) at y = g.y, and the side stay's top up to 1.7 m inboard of it.
    for (let y = Math.max(fl.y0, g.y - 1.8); y <= g.y + 0.3; y += 0.1) {
      assert.ok(fl.xAt(y) <= g.x - 0.44, `at y ${y.toFixed(1)} the flap's nose is at ${fl.xAt(y).toFixed(2)}, the leg at ${g.x}`);
    }
    // It still meets the outboard surfaces at hingeF: the line ends where it used to.
    assert.ok(fl.x1 < fl.x0 + 1e-9, 'the line runs aft (or level) towards the outboard end');
  });
}

test('a door panel has an inside: its back faces point the other way', () => {
  const rows = [];
  for (let i = 0; i <= 2; i++) rows.push([V(i, 0, 0), V(i, 1, 0), V(i, 2, 0)]);
  const { outer, back } = slab(rows, 0.05, () => V(0, 0, -1));
  const faceN = (g) => {
    const p = g.attributes.position, idx = g.index.array, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    A.fromBufferAttribute(p, idx[0]); B.fromBufferAttribute(p, idx[1]); C.fromBufferAttribute(p, idx[2]);
    return B.sub(A).cross(C.sub(A)).normalize();
  };
  assert.ok(faceN(outer).z < -0.99, 'the outer face looks down');
  assert.ok(faceN(back[0]).z > 0.99, 'the inner face looks up');
  assert.equal(back.length, 5, 'the inner face and four rims');
  const zs = back[0].attributes.position.array.filter((_, i) => i % 3 === 2);
  assert.ok(zs.every((z) => Math.abs(z - 0.05) < 1e-6), 'the inner face is the thickness inward');
});

test('a rounded nose bulges forward of the cut, closed at its ends', () => {
  const sec = (y) => ({ le: V(0, y, 0), chord: 4, t: 0.12, c: V(-1, 0, 0), n: V(0, 0, 1), camber: 0 });
  const flat = foilPiece([sec(0), sec(2)], 0.7, 1);
  const round = foilPiece([sec(0), sec(2)], 0.7, 1, { nose: 1 });
  const maxX = (gs) => Math.max(...gs.flatMap((g) => [...g.attributes.position.array].filter((_, i) => i % 3 === 0)));
  const cut = foilPoint(sec(0), 0.7, 0).x;
  assert.ok(Math.abs(maxX(flat) - cut) < 1e-6, 'the flat piece ends at the cut');
  assert.ok(maxX(round) > cut + 0.03, `the rounded one reaches ${(maxX(round) - cut).toFixed(3)} m forward`);
  assert.equal(round.length, flat.length + 2, 'the two nose end caps');
});
