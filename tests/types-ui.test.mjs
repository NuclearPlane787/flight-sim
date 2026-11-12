// The aircraft picker's pure parts (src/ui/setup.js): the fuel rule by type, the load after a change of
// type and the card. The dialog itself is in tests/browser-picker.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuelEstimate, fitLoad, typeCardHtml, LIMITS } from '../src/ui/setup.js';
import { TYPE_LIST, typeById } from '../src/sim/types.js';

const A321 = typeById('a321neo');
// A made-up widebody: the shape of a registry entry, with numbers far from the A321's.
const BIG = { ...A321, id: 'big', name: 'Big <one>', registration: 'HL0000',
  limits: { OEW: 130000, MTOW: 250000, MLW: 190000, MZFW: 180000, FUEL_MAX: 100000, PAX_MAX: 300, PAX_KG: 90, CARGO_MAX: 30000 },
  fuel: { climbKg: 3000, perNm: 20, holdKg: 3500, taxiKg: 500 }, defaults: { pax: 250, cargoKg: 8000 } };

test('fuelEstimate keeps its numbers for the A321neo, with or without the type', () => {
  // The numbers of the rule before the registry: 1,100 + 6.2/nm, 5 %, 1,000 hold, 200 taxi, up to 100 kg.
  for (const nm of [0, 1, 100, 243, 244.7, 1000, 3000]) {
    const trip = 1100 + 6.2 * nm;
    const want = { trip: Math.round(trip), total: Math.ceil((trip * 1.05 + 1000 + 200) / 100) * 100 };
    assert.deepEqual(fuelEstimate(nm), want);
    assert.deepEqual(fuelEstimate(nm, A321), want);
    assert.deepEqual(fuelEstimate(nm, 'a321neo'), want);
  }
  assert.deepEqual(fuelEstimate(243), { trip: 2607, total: 4000 });
});

test('fuelEstimate reads the given type', () => {
  assert.deepEqual(fuelEstimate(100, BIG), { trip: 5000, total: Math.ceil((5000 * 1.05 + 3500 + 500) / 100) * 100 });
});

test('LIMITS stays the A321neo\'s', () => {
  assert.equal(LIMITS, A321.limits);
  // v0.4.4: OEW and fuel are the sim's (a321neo.js), not v0.1.0's 50,100 kg and 18,864 kg.
  assert.deepEqual(LIMITS, { OEW: 50500, MTOW: 97000, MLW: 79200, MZFW: 75600, FUEL_MAX: 18510, PAX_MAX: 244, PAX_KG: 84, CARGO_MAX: 9000 });
});

test('fitLoad keeps what fits and resets what does not', () => {
  assert.deepEqual(fitLoad({ pax: 190, cargoKg: 1500 }, BIG), { pax: 190, cargoKg: 1500 });
  assert.deepEqual(fitLoad({ pax: 299, cargoKg: 1000 }, A321), { pax: 190, cargoKg: 1000 }, 'too many seats');
  assert.deepEqual(fitLoad({ pax: 100, cargoKg: 25000 }, A321), { pax: 100, cargoKg: 1500 }, 'too much for the hold');
  // Both within their own limits, together over the A321's MZFW (25,500 kg of payload).
  assert.deepEqual(fitLoad({ pax: 244, cargoKg: 9000 }, A321), { pax: 190, cargoKg: 1500 }, 'over MZFW');
});

test('the default load fits every type in the picker', () => {
  for (const t of TYPE_LIST()) {
    assert.deepEqual(fitLoad(t.defaults, t), t.defaults, t.id);
    assert.ok(t.limits.OEW + t.defaults.pax * t.limits.PAX_KG + t.defaults.cargoKg <= t.limits.MZFW, t.id);
  }
});

test('a card shows the name and the key numbers, escaped', () => {
  const h = typeCardHtml(A321, 'x/a.jpg');
  for (const s of ['A321neo', 'Airbus', '44.5 m', '35.8 m', '97 t', '3,500 nm', 'up to 244', 'CFM LEAP-1A', 'src="x/a.jpg"', 'data-type="a321neo"']) assert.ok(h.includes(s), s);
  assert.ok(typeCardHtml(BIG).includes('Big &lt;one&gt;'));
  assert.ok(!typeCardHtml(A321).includes('<img'), 'no picture, no img');
  const locked = typeCardHtml(A321, '', true);
  assert.ok(locked.startsWith('<div') && !locked.includes('data-type'), 'a locked card is not a choice');
});
