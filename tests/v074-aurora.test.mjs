// v0.7.4, fix 4 (Shane's choice, 2026-11-21: "North only"): Europe's aurora by latitude, strongest over Scotland and
// Denmark, gone by 50 N; East Asia's as it was (no band: the stars' visibility alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auroraByLatitude } from '../src/world/sky.js';
import { REGIONS } from '../src/world/regions.js';

const EU = REGIONS.find ? REGIONS.find((r) => r.id === 'europe') : REGIONS.europe;
const EA = REGIONS.find ? REGIONS.find((r) => r.id !== 'europe') : REGIONS['east-asia'];

// v0.7.6: East Asia has its own band since (Shane: "Band it"; tests/v076-aurora.test.mjs), so "East Asia has none"
// became "a region with no band".
test('Europe has the band, 50 to 56 N', () => {
  assert.deepEqual(EU.aurora, { fadeLat: 50, fullLat: 56 });
  assert.ok(EA);
});

test('no band: exactly 1 everywhere (a region without the entry draws what v0.4.3 drew)', () => {
  for (const lat of [29, 37.5, 43, 60]) { assert.equal(auroraByLatitude(lat, undefined), 1); assert.equal(auroraByLatitude(lat, null), 1); }
});

test("Europe: full at 56 N and north, nothing at 50 N and south, smooth and rising between", () => {
  const f = (lat) => auroraByLatitude(lat, EU.aurora);
  // the brief's seven places, by their airports' latitudes
  const at = { Edinburgh: 55.95, Copenhagen: 55.62, Manchester: 53.35, Amsterdam: 52.31, London: 51.47, Paris: 49.01, Lisbon: 38.77 };
  assert.ok(f(at.Edinburgh) > 0.99 && f(at.Copenhagen) > 0.98, `${f(at.Edinburgh)} ${f(at.Copenhagen)}`);
  assert.ok(f(at.Manchester) > 0.55 && f(at.Manchester) < 0.65, `${f(at.Manchester)}`);
  assert.ok(f(at.Amsterdam) > 0.3 && f(at.Amsterdam) < 0.4, `${f(at.Amsterdam)}`);
  assert.ok(f(at.London) > 0.1 && f(at.London) < 0.2, `${f(at.London)}`);
  assert.equal(f(at.Paris), 0); assert.equal(f(at.Lisbon), 0); assert.equal(f(50), 0);
  assert.equal(f(56), 1); assert.equal(f(57.7), 1); assert.equal(f(62), 1);
  let last = 0;
  for (let lat = 49; lat <= 57; lat += 0.05) { const v = f(lat); assert.ok(v >= last - 1e-12 && v - last < 0.02, `${lat}`); last = v; }
});
