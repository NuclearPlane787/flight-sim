// The map frame against great-circle distances (PLAN.md → Distances).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toMap, toGeo, greatCircle } from '../src/world/frame.js';

// OurAirports reference points.
const RKSS = [37.5583, 126.7906], RKPC = [33.5113, 126.4930], RKSI = [37.4691, 126.4510];

function mapDist(a, b) {
  const [x1, y1] = toMap(...a), [x2, y2] = toMap(...b);
  return Math.hypot(x2 - x1, y2 - y1);
}

test('Gimpo–Jeju is ~451 km, map within 1% of the great circle', () => {
  const gc = greatCircle(...RKSS, ...RKPC);
  assert.ok(Math.abs(gc / 1000 - 451) < 2, `great circle ${gc / 1000} km`);
  const m = mapDist(RKSS, RKPC);
  assert.ok(Math.abs(m - gc) / gc < 0.01, `map ${m / 1000} km vs ${gc / 1000} km`);
});

test('Incheon–Jeju and Gimpo–Incheon within 1%', () => {
  for (const [a, b, km] of [[RKSI, RKPC, 440], [RKSS, RKSI, 32]]) {
    const gc = greatCircle(...a, ...b);
    assert.ok(Math.abs(gc / 1000 - km) / km < 0.02, `gc ${gc / 1000}`);
    const m = mapDist(a, b);
    assert.ok(Math.abs(m - gc) / gc < 0.01);
  }
});

test('toGeo inverts toMap', () => {
  for (const p of [RKSS, RKPC, RKSI, [36, 127.5], [38.5, 130]]) {
    const [la, lo] = toGeo(...toMap(...p));
    assert.ok(Math.abs(la - p[0]) < 1e-8 && Math.abs(lo - p[1]) < 1e-8);
  }
});
