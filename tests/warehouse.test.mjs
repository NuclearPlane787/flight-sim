// v0.5.0: the Warehouse's pure parts (src/ui/warehouse.js): the live numbers and their warnings, the edits,
// the engines' names, what rebuilds the model, the orbit; the menu's flag; the picker's design card (setup.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readout, editDesign, engineLabel, pairLabel, viewKey, orbitTurn, orbitWheel, WARN } from '../src/ui/warehouse.js';
import { WAREHOUSE_ON, warehouseEnabled } from '../src/ui/menu.js';
import { designCardHtml } from '../src/ui/setup.js';
import { newDesign, designDef, designNumbers, stationRange, normalizeDesign } from '../src/sim/designs.js';
import { TYPES } from '../src/sim/types.js';

test('the three bases pass every check', () => {
  for (const b of Object.keys(TYPES)) {
    const r = readout(newDesign(b));
    assert.equal(r.worst, 'ok', `${b}: ${JSON.stringify(r.issues)}`);
    assert.equal(r.engines.length, 2);
    assert.ok(r.rows.every((x) => x.level === 'ok'));
  }
});

test('a GE90 on the A321 touches (red), and 1.5 m of gear clears it', () => {
  const d = newDesign('a321neo', { engine: 'ge90-115b' });
  const r = readout(d);
  assert.equal(r.worst, 'bad');
  assert.ok(r.engines.every((e) => e.restLvl === 'bad' && e.clearRestM <= 0));
  assert.ok(r.issues[0].level === 'bad' && /touch/.test(r.issues[0].text));
  const long = readout(editDesign(d, 'gearExtendM', 1.5));
  assert.ok(long.engines.every((e) => e.restLvl !== 'bad' && e.tsLvl !== 'bad'));
  assert.ok(long.numbers.tailStrikeDeg > r.numbers.tailStrikeDeg, 'the tail-strike angle grows with the gear');
  assert.ok(!long.issues.some((i) => i.level === 'bad'));
});

test('a pylon past its limit is red; near it amber', () => {
  const d = newDesign('b777-300er');
  const hot = readout(editDesign(d, 'thrustScale', 2));
  assert.ok(hot.engines.every((e) => e.pylonFrac > 1 && e.pyLvl === 'bad'));
  assert.ok(hot.issues.some((i) => i.level === 'bad' && /pylon/.test(i.text)));
  // Each pylon's level follows its own fraction (each pylon's limit has its own small scatter, designs.js).
  for (let k = 1; k <= 1.6; k += 0.05) {
    const r = readout(editDesign(d, 'thrustScale', k));
    for (const e of r.engines) assert.equal(e.pyLvl, e.pylonFrac > 1 ? 'bad' : e.pylonFrac > WARN.pylonFrac ? 'warn' : 'ok');
    if (r.engines.some((e) => e.pyLvl === 'warn') && !r.engines.some((e) => e.pyLvl === 'bad')) assert.equal(r.worst, 'warn');
  }
});

test('the numbers are designNumbers(designDef(d))', () => {
  const d = newDesign('b777-300er', { count: 4 });
  const r = readout(d), n = designNumbers(designDef(d));
  assert.equal(r.numbers.oewKg, n.oewKg);
  assert.equal(r.numbers.thrustToWeight, n.thrustToWeight);
  assert.equal(r.engines.length, 4);
  assert.deepEqual(r.engines.map((e) => e.label), ['Left outboard', 'Left inboard', 'Right inboard', 'Right outboard']);
  assert.ok(r.rows.find((x) => x.k === 'tw').value === n.thrustToWeight.toFixed(2));
});

test('engine and pair names follow designs.js\'s order', () => {
  assert.deepEqual([0, 1].map((i) => engineLabel(i, 2)), ['Left', 'Right']);
  assert.deepEqual([0, 1, 2].map((i) => engineLabel(i, 3)), ['Left', 'Tail', 'Right']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => engineLabel(i, 6)), ['Left outer', 'Left middle', 'Left inner', 'Right inner', 'Right middle', 'Right outer']);
  assert.equal(pairLabel(0, 1), 'Station');
  assert.equal(pairLabel(1, 2), 'Outboard pair');
  assert.equal(pairLabel(2, 3), 'Outer pair');
});

test('edits: each part, clamped, the stations kept in range and apart', () => {
  let d = newDesign('b787-9');
  d = editDesign(d, 'count', 6);
  assert.equal(d.count, 6); assert.equal(d.stations.length, 3);
  const [lo, hi] = stationRange(d.base, d.engine, 6);
  assert.ok(d.stations.every((y) => y >= lo - 1e-9 && y <= hi + 1e-9));
  d = editDesign(d, 'station', String(lo), 2);   // the outer pair dragged all the way in
  for (let i = 1; i < 3; i++) assert.ok(d.stations[i] > d.stations[i - 1], 'apart and sorted');
  d = editDesign(d, 'count', 3);
  assert.equal(d.count, 3); assert.equal(d.stations.length, 1);
  d = editDesign(d, 'engine', 'leap-1a');
  assert.equal(d.engine, 'leap-1a');
  assert.equal(editDesign(d, 'engine', 'rr-trent').engine, 'leap-1a');
  assert.equal(editDesign(d, 'thrustScale', '7').thrustScale, 3);
  const A = TYPES['b787-9'].data;
  assert.equal(editDesign(d, 'oewFrac', 0.1).oewDeltaKg, Math.round(0.1 * A.OEW));
  assert.equal(editDesign(d, 'oewFrac', -1).oewDeltaKg, Math.round(-0.15 * A.OEW));
  assert.ok(Math.abs(editDesign(d, 'fuelFrac', 2).fuelCapacityKg - 2 * A.FUEL_MAX) <= 10);
  assert.equal(editDesign(d, 'gearExtendM', '0.75').gearExtendM, 0.75);
  assert.equal(editDesign(d, 'registration', 'hl-77x!').registration, 'HL-77X');
  assert.equal(editDesign(d, 'name', 'Big fan').name, 'Big fan');
  assert.deepEqual(editDesign(d, 'what', 1), normalizeDesign(d));
});

test('the model rebuilds on the engines, gear and registration, not on weight or thrust', () => {
  const d = newDesign('a321neo');
  const k = viewKey(d);
  assert.equal(viewKey(editDesign(d, 'thrustScale', 2)), k);
  assert.equal(viewKey(editDesign(d, 'oewFrac', 0.2)), k);
  assert.equal(viewKey(editDesign(d, 'fuelFrac', 1.5)), k);
  assert.notEqual(viewKey(editDesign(d, 'gearExtendM', 1)), k);
  assert.notEqual(viewKey(editDesign(d, 'count', 4)), k);
  assert.notEqual(viewKey(editDesign(d, 'engine', 'genx-1b')), k);
  assert.notEqual(viewKey(editDesign(d, 'registration', 'HL0001')), k);
});

test('the orbit: drag turns, pitch limited, pinch and scroll zoom within limits, a swipe turns', () => {
  const v = { yaw: 0, pitch: 0.2, dist: 60 };
  const t = orbitTurn(v, 100, 0, 800);
  assert.ok(t.yaw < 0 && t.pitch === 0.2);
  assert.ok(orbitTurn(v, 0, 1e5, 800).pitch <= 85 * Math.PI / 180 + 1e-12);
  assert.ok(orbitTurn(v, 0, -1e5, 800).pitch >= -5 * Math.PI / 180 - 1e-12);
  assert.ok(orbitWheel(v, { ctrlKey: true, deltaY: -20, deltaX: 0 }).dist < 60);
  assert.ok(orbitWheel(v, { deltaY: 30, deltaX: 0 }).dist > 60);
  // One event moves at most a step of e^0.5 (a mouse wheel's notch), and the limits hold.
  assert.ok(Math.abs(orbitWheel(v, { deltaY: 1e6, deltaX: 0 }).dist - 60 * Math.exp(0.5)) < 1e-9);
  let z = v; for (let i = 0; i < 20; i++) z = orbitWheel(z, { deltaY: 100, deltaX: 0 }, [12, 400]);
  assert.equal(z.dist, 400);
  for (let i = 0; i < 20; i++) z = orbitWheel(z, { ctrlKey: true, deltaY: -100, deltaX: 0 }, [12, 400]);
  assert.equal(z.dist, 12);
  const s = orbitWheel(v, { deltaY: 0, deltaX: 40 });
  assert.equal(s.dist, 60); assert.ok(s.yaw > 0);
});

// v0.5.0 ships it: the flag went on once a design could be made and flown end to end (STATUS.md).
test('the Warehouse flag: on in v0.5.0, and ?warehouse=1 forces it', () => {
  assert.equal(WAREHOUSE_ON, true);
  assert.equal(warehouseEnabled(''), WAREHOUSE_ON);
  assert.equal(warehouseEnabled('?warehouse=1'), true);
  assert.equal(warehouseEnabled('?x=2&warehouse=1'), true);
  assert.equal(warehouseEnabled('?warehouse=0'), WAREHOUSE_ON);
});

test('the picker\'s design card: name, base, "4 × GE90-115B", a button by the design\'s id', () => {
  const def = designDef(newDesign('b777-300er', { id: 'd4', name: 'Quad <777>', count: 4 }));
  const h = designCardHtml(def, 'x/b.jpg');
  assert.ok(h.includes('data-design="d4"'));
  assert.ok(h.includes('Quad &lt;777&gt;'));
  assert.ok(h.includes('on the 777-300ER'));
  assert.ok(h.includes('4 × GE90-115B'));
  assert.ok(h.includes('<img src="x/b.jpg"'));
  const locked = designCardHtml(def, '', true);
  assert.ok(locked.startsWith('<div') && !locked.includes('data-design'));
});
