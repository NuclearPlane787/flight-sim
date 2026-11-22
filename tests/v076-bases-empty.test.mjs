// v0.7.6, part 3 (Shane, 2026-11-22: the military aprons "Empty"): no parked aircraft at Europe's bases. Their stands
// are the player's own ramp spots, so the parked traffic's share rule would stand airliners on the free ones:
// traffic-layout.js's NO_PARKED keeps them empty. Zaragoza is a joint airport: its civil apron gets airliners as any
// airport's does, and its military side has no stand to park on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeParked, createVehicles, NO_PARKED } from '../src/world/traffic-layout.js';

const file = (icao) => new URL(`../data/europe/airports/${icao}.json`, import.meta.url);
const airport = (icao) => JSON.parse(readFileSync(file(icao), 'utf8'));
const BASES = ['ETAR', 'EGQS', 'EGUL', 'EGVA', 'LERT'];

test('the table: the five bases without a civil apron, and not Zaragoza', () => {
  assert.deepEqual([...NO_PARKED].sort(), BASES.slice().sort());
  assert.equal(NO_PARKED.has('LEZG'), false);
});

for (const icao of BASES) {
  test(`${icao}: ramp spots for the player, no gate, no parked aircraft and no ground vehicles`, () => {
    const a = airport(icao);
    assert.ok(a.stands.length >= 3 && a.stands.length <= 8, `${a.stands.length} spots`);
    assert.equal(a.stands.filter((s) => s.gate).length, 0, 'no gate at a base');
    assert.deepEqual(placeParked(a), []);
    assert.deepEqual(placeParked(a, { fill: 1 }), []);
    assert.equal(createVehicles(a).vehicles.length, 0);      // no tugs, buses or baggage trains on a base's roads
  });
}

test('Zaragoza: airliners and ground vehicles on its civil apron, as at any airport', () => {
  const a = airport('LEZG');
  const parked = placeParked(a);
  assert.ok(parked.length >= 5, `${parked.length} parked`);
  assert.ok(createVehicles(a).vehicles.length >= 5);
  // an older airport is untouched by the table
  const g = JSON.parse(readFileSync(new URL('../data/europe/airports/LXGB.json', import.meta.url), 'utf8'));
  assert.ok(placeParked(g).length >= 1);
});
