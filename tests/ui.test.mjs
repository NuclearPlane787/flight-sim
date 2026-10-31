// Screens: the pure parts (ILS-style deviations, fuel estimate, coastline LOD, end lookup).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ilsDeviation, findEnd, buildCoast, thresholdOf, NM } from '../src/ui/common.js';
import { fuelEstimate, LIMITS } from '../src/ui/setup.js';
import { mockAirports } from './dev-ui-mock.js';

const DEG = Math.PI / 180;
const airports = mockAirports();
const info = findEnd(airports, 'RKPC', '07');

// A point d metres before the threshold, `right` metres right of the centreline, h metres above the runway.
function at(d, right, h) {
  const e = info.end, a = e.hdgGridDeg * DEG, ux = Math.sin(a), uy = Math.cos(a);
  const [tx, ty] = thresholdOf(e);
  return { pos: { x: tx - ux * d + uy * right, y: ty - uy * d - ux * right, z: e.elevM + h } };
}

test('on the 3° path and the centreline: centred diamonds', () => {
  const d = 8 * NM, h = Math.tan(3 * DEG) * (d + 300);
  const r = ilsDeviation(at(d, 0, h), info);
  assert.ok(r.visible);
  assert.ok(Math.abs(r.locDots) < 0.01 && Math.abs(r.gsDots) < 0.01, JSON.stringify(r));
});

test('right of course: diamond left; above the path: diamond low', () => {
  const d = 8 * NM, h = Math.tan(3.4 * DEG) * (d + 300);
  const r = ilsDeviation(at(d, 300, h), info);
  assert.ok(r.locDots < 0, 'loc diamond should sit left');
  assert.ok(Math.abs(r.gsDots - 1) < 0.05, 'gs 0.4° high = one dot, diamond below: ' + r.gsDots);
});

test('hidden behind the runway or far off the course', () => {
  assert.equal(ilsDeviation(at(-3000, 0, 300), info).visible, false);
  assert.equal(ilsDeviation(at(5000, 5000, 300), info).visible, false); // 45° off
  assert.equal(ilsDeviation(at(5000, 2500, 300), info).visible, true);  // 26.6° off
});

test('course is the runway magnetic heading (07 ≈ 066°)', () => {
  const r = ilsDeviation(at(5000, 0, 300), info);
  assert.ok(Math.abs(r.courseMag - 66) < 1.5, String(r.courseMag));
});

test('fuel estimate: Gimpo–Jeju about 4 t, within the tanks', () => {
  const f = fuelEstimate(243);
  assert.ok(f.total >= 3700 && f.total <= 4300, String(f.total));
  assert.ok(fuelEstimate(3000).total > LIMITS.FUEL_MAX, 'long trips exceed the tanks (setup caps them)');
  assert.equal(LIMITS.FUEL_MAX, 18864);
});

test('coastline levels of detail shrink', () => {
  const ring = Array.from({ length: 2000 }, (_, i) => { const a = i / 2000 * 2 * Math.PI; return [Math.cos(a) * 50000 + Math.sin(a * 37) * 30, Math.sin(a) * 50000]; });
  const c = buildCoast({ land: [ring], water: [] });
  const n = c.land[0].levels.map((f) => f.length / 2);
  assert.ok(n[0] === 2000 && n[1] < n[0] && n[3] < n[1], n.join());
  assert.equal(c.lod(10), 0);
  assert.equal(c.lod(5000), 3);
});
