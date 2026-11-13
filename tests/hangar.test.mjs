// v0.5.1: the warehouse's hangar (src/ui/hangar.js): the camera's box and the ray to its walls, the walkways'
// loop, and every type fitting: through the doors, under the roof, clear of the walkways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANGAR, cameraBox, rayExit, walkPath, WALK_LENGTH } from '../src/ui/hangar.js';
import { TYPES } from '../src/sim/types.js';
import { RANGES } from '../src/sim/designs.js';

test('the ray to the camera box: along an axis, on a diagonal, from outside', () => {
  const box = { min: [-10, 0, -20], max: [10, 5, 20] };
  assert.equal(rayExit([0, 1, 0], [1, 0, 0], box), 10);
  assert.equal(rayExit([0, 1, 0], [0, -1, 0], box), 1);
  const s = Math.SQRT1_2;
  assert.ok(Math.abs(rayExit([0, 1, 0], [s, s, 0], box) - 4 / s) < 1e-9);   // the roof (4 up) comes before the wall
  assert.equal(rayExit([20, 1, 0], [1, 0, 0], box), 0);
  const c = cameraBox(-5.73);
  assert.ok(c.min[1] > -5.73 && c.max[1] < -5.73 + HANGAR.eave);
  assert.ok(c.max[2] < HANGAR.door && c.min[2] > HANGAR.back && c.max[0] < HANGAR.halfX);
});

test('the walkways: a closed loop along the walls, never through the parking area', () => {
  assert.ok(Math.abs(WALK_LENGTH - 2 * (2 * HANGAR.walkX) - 2 * (HANGAR.walkFront - HANGAR.walkBack)) < 1e-9);
  const a = walkPath(0), b = walkPath(WALK_LENGTH);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-9);
  for (let s = -50; s < WALK_LENGTH + 50; s += 0.7) {
    const p = walkPath(s);
    const onLine = Math.abs(Math.abs(p.x) - HANGAR.walkX) < 1e-6 || Math.abs(p.z - HANGAR.walkBack) < 1e-6 || Math.abs(p.z - HANGAR.walkFront) < 1e-6;
    assert.ok(onLine, `s ${s}: ${p.x}, ${p.z}`);
    assert.ok(Math.abs(p.x) > 40 || p.z < -50 || p.z > 54, `s ${s} inside the parking area`);
    // the heading points along the loop
    const q = walkPath(s + 0.01);
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.009) assert.ok(Math.abs(Math.atan2(q.x - p.x, q.z - p.z) - p.h) < 1e-6 || Math.abs(Math.abs(Math.atan2(q.x - p.x, q.z - p.z) - p.h) - 2 * Math.PI) < 1e-6);
  }
});

test('every type fits: through the doors, under the roof, clear of the walkways', () => {
  for (const T of Object.values(TYPES)) {
    const G = T.geo, tall = G.HEIGHT + RANGES.gearExtendM[1];
    assert.ok(tall < HANGAR.doorH, `${T.id}: ${tall} m tall against the doors' ${HANGAR.doorH}`);
    assert.ok(G.SPAN / 2 + 3 < HANGAR.walkX - 1.2, `${T.id}: wingtip near the walkway`);
    const noseZ = -G.NOSE_X, tailZ = G.LENGTH - G.NOSE_X;
    assert.ok(noseZ > HANGAR.walkBack + 1.2 + 3, `${T.id}: nose near the back walkway`);
    assert.ok(tailZ < HANGAR.walkFront - 1.2 - 3, `${T.id}: tail near the front walkway`);
    assert.ok(G.SPAN / 2 < HANGAR.open, `${T.id}: wider than the doors' gap`);
  }
});
