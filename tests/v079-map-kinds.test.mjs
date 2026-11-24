// v0.7.9 (map), item 1: each airport's kind (regions.js AIRPORT_KIND, airportKind()). The five pure bases are 'base' and
// are exactly the airports with no parked airliners (traffic-layout.js NO_PARKED); the four shared fields are 'joint';
// every other listed airport is 'civil'; every kind's airport is in the index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORT_INDEX, AIRPORT_KIND, airportKind } from '../src/world/regions.js';
import { NO_PARKED } from '../src/world/traffic-layout.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the map's tooltip over a label, and the wheel's closest zoom, through tests/v079-map-calls.mjs (a child process)
function tips(region, list, map79 = '1') {
  const env = { ...process.env, FS_REGION: region, FS_MAP79: map79 };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'v079-map-calls.mjs'), `--tips=${list}`], { env, encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
test("the map's tooltip names a base's and a joint field's kind; the map zooms to 1 m a pixel (2 with ?map79=0)", () => {
  const eu = tips('europe', 'ETAR,LEZG,EDDF');
  assert.equal(eu.tips.ETAR, 'ETAR, military base: click to fly there instead');
  assert.equal(eu.tips.LEZG, 'LEZG, joint civil and military: click to fly there instead');
  assert.equal(eu.tips.EDDF, 'EDDF: click to fly there instead');
  assert.equal(eu.closestPxPerM, 1);
  const ea = tips('east-asia', 'RKJK');
  assert.equal(ea.tips.RKJK, 'RKJK, joint civil and military: click to fly there instead');
  const off = tips('europe', 'ETAR', '0');
  assert.equal(off.tips.ETAR, 'ETAR: click to fly there instead');
  assert.equal(off.closestPxPerM, 0.5);
});

test('the five pure bases and the four joint airports', () => {
  const of = (k) => Object.keys(AIRPORT_KIND).filter((i) => AIRPORT_KIND[i] === k).sort();
  assert.deepEqual(of('base'), ['EGQS', 'EGUL', 'EGVA', 'ETAR', 'LERT']);
  assert.deepEqual(of('joint'), ['LEZG', 'RJNK', 'RKJK', 'RKTU']);
  assert.deepEqual(of('base'), [...NO_PARKED].sort(), 'a pure base is an airport with no parked airliners');
});

test('every kind is a listed airport; every other airport is civil', () => {
  for (const i of Object.keys(AIRPORT_KIND)) assert.ok(AIRPORT_INDEX[i], i);
  for (const i of Object.keys(AIRPORT_INDEX)) assert.equal(airportKind(i), AIRPORT_KIND[i] || 'civil', i);
  assert.equal(airportKind('RKSI'), 'civil');
  assert.equal(airportKind('ETAR'), 'base');
  assert.equal(airportKind('RKJK'), 'joint');
  assert.equal(airportKind(undefined), 'civil');
  assert.equal(airportKind('XXXX'), 'civil');
});

test('the index entries keep their two fields', () => {
  for (const [i, v] of Object.entries(AIRPORT_INDEX)) assert.equal(v.length, 2, i);
});
