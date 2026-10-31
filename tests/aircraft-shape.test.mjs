// The A321neo's shape where v0.1.2 changed it: the nose and cockpit windows, and the engines.
//   node --test games/flight-sim/tests/aircraft-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseSection, fusePoint, windowOutlines, wingLowerZ } from '../src/aircraft.js';
import { NACELLES, NACELLE_DIAMETER, GROUND_Z, EYES } from '../src/geometry.js';

const zExtent = (outline) => {
  const zs = outline.map(([x, th]) => fusePoint(x, th).z);
  return Math.max(...zs) - Math.min(...zs);
};

test('from outside, the windshield is a lower band than the side windows', () => {
  const [windshield, sliding, rear] = windowOutlines();
  assert.ok(zExtent(windshield) < zExtent(sliding) - 0.1, `${zExtent(windshield)} vs ${zExtent(sliding)}`);
  assert.ok(zExtent(windshield) < zExtent(rear) - 0.1);
});

test('the Captain still sees about 17° down over the nose, through the windshield', () => {
  const E = EYES.captain;
  // the windshield's lowest point straight ahead of the eye, and the nose ahead of it
  const below = (x) => { const s = fuseSection(x); return s.hw > E.y ? s.zc + s.up * Math.sqrt(1 - (E.y / s.hw) ** 2) : null; };
  let steepest = -90;
  for (let x = 19.35; x < 21; x += 0.01) {
    const z = below(x);
    if (z !== null) steepest = Math.max(steepest, Math.atan2(z - E.z, x - E.x) * 180 / Math.PI);
  }
  assert.ok(steepest < -17, `the nose rises to ${steepest.toFixed(1)}°`);
  // and the windshield's bottom frame is near that line, not far above it
  const [windshield] = windowOutlines();
  const lowZ = Math.min(...windshield.map(([x, th]) => fusePoint(x, th).z));
  assert.ok(lowZ < E.z - 0.3, `windshield bottom at ${lowZ.toFixed(2)}`);
});

test('the nacelles hang 0.45 m above the ground, clearly below the wing', () => {
  for (const n of NACELLES) {
    assert.ok(Math.abs(n.z - NACELLE_DIAMETER / 2 + GROUND_Z - 0.45) < 1e-9);
    // in front view, the nacelle's top is below the wing's lowest line at the engine
    let lowest = Infinity;
    for (let f = 0; f <= 1; f += 0.02) lowest = Math.min(lowest, wingLowerZ(Math.abs(n.y), f));
    assert.ok(n.z + NACELLE_DIAMETER / 2 < lowest - 0.03, `nacelle top ${(n.z + 1.2).toFixed(2)} vs wing ${lowest.toFixed(2)}`);
  }
});
