// v0.5.0: the Warehouse's pure parts (src/ui/warehouse.js): the live numbers and their warnings, the edits,
// what rebuilds the model, the orbit; the menu's flag; the picker's design card (setup.js).
// v0.5.2: the KSP editor's: the parts' names, a part's edits (its twin following), where a part dropped on the
// airframe goes (the surface under the pointer, the mount, the snapped station), picking a part with the pointer,
// the thrust's line and its checks (lopsided thrust, the CG's move, no engines), undo and redo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readout, editDesign, editPart, placement, hitAirframe, partBoxes, partBox, rayBox, pickPart, thrustLine, createHistory,
  partLabel, partWhere, viewKey, orbitTurn, orbitWheel, WARN,
} from '../src/ui/warehouse.js';
import { WAREHOUSE_ON, warehouseEnabled } from '../src/ui/menu.js';
import { designCardHtml } from '../src/ui/setup.js';
import { newDesign, designDef, designNumbers, normalizeDesign, addPart, removePart, airframe, mountRange, engineParts } from '../src/sim/designs.js';
import { TYPES } from '../src/sim/types.js';
import { ENGINE_TYPES } from '../src/sim/engine-types.js';

const noEngines = (d) => engineParts(d).reduce((x, p) => removePart(x, p.id), d);

test('the three bases pass every check', () => {
  for (const b of Object.keys(TYPES)) {
    const r = readout(newDesign(b));
    assert.equal(r.worst, 'ok', `${b}: ${JSON.stringify(r.issues)}`);
    assert.equal(r.engines.length, 2);
    assert.ok(r.canSave);
    assert.ok(r.rows.every((x) => x.level === 'ok'));
    assert.equal(r.rows.find((x) => x.k === 'yaw').value, 'balanced');
    assert.equal(r.rows.find((x) => x.k === 'cg').value, 'the same');
  }
});

test('a GE90 pair on the A321 touches (red), and 1.5 m of gear clears it', () => {
  const d = editDesign(newDesign('a321neo'), 'engine', 'ge90-115b');
  const r = readout(d);
  assert.equal(r.worst, 'bad');
  assert.ok(r.engines.every((e) => e.restLvl === 'bad' && e.clearRestM <= 0));
  assert.ok(r.issues.some((i) => i.level === 'bad' && /scrape/.test(i.text)));
  const long = readout(editDesign(d, 'gearExtendM', 1.5));
  assert.ok(long.engines.every((e) => e.restLvl !== 'bad' && e.tsLvl !== 'bad'));
  assert.ok(long.numbers.tailStrikeDeg > r.numbers.tailStrikeDeg, 'the tail-strike angle grows with the gear');
  assert.ok(!long.issues.some((i) => /scrape|strikes/.test(i.text)));
});

test('a pylon past its limit is red; near it amber', () => {
  const d = newDesign('b777-300er');
  const hot = readout(editDesign(d, 'thrustScale', 2));
  assert.ok(hot.engines.every((e) => e.pylonFrac > 1 && e.pyLvl === 'bad'));
  assert.ok(hot.issues.some((i) => i.level === 'bad' && /pylon/.test(i.text)));
  for (let k = 1; k <= 1.6; k += 0.05) {
    const r = readout(editDesign(d, 'thrustScale', k));
    for (const e of r.engines) assert.equal(e.pyLvl, e.pylonFrac > 1 ? 'bad' : e.pylonFrac > WARN.pylonFrac ? 'warn' : 'ok');
  }
});

test('the numbers are designNumbers(designDef(d)), the engines named by their parts', () => {
  const d = newDesign('b777-300er', { count: 4 });
  const r = readout(d), n = designNumbers(designDef(d));
  assert.equal(r.numbers.oewKg, n.oewKg);
  assert.equal(r.numbers.thrustToWeight, n.thrustToWeight);
  assert.deepEqual(r.engines.map((e) => e.label), ['GE90-115B · left wing', 'GE90-115B · left wing', 'GE90-115B · right wing', 'GE90-115B · right wing']);
  assert.ok(r.rows.find((x) => x.k === 'tw').value === n.thrustToWeight.toFixed(2));
});

test('parts\' names and places', () => {
  const p = { kind: 'engine', engine: 'genx-1b', mount: 'overwing', side: -1, s: 12.5 };
  assert.equal(partLabel(p), 'GEnx-1B · right over-wing');
  assert.equal(partLabel({ ...p, mount: 'tail', side: 0 }), 'GEnx-1B · tail');
  assert.equal(partLabel({ ...p, mount: 'body', side: 1 }), 'GEnx-1B · left body');
  assert.equal(partLabel({ kind: 'tank', mount: 'wing', side: 1 }), 'Wing tank · left');
  assert.equal(partLabel({ kind: 'tank', mount: 'hold', side: 0 }), 'Hold tank');
  assert.equal(partLabel({ kind: 'ballast' }), 'Ballast');
  assert.equal(partWhere(p, 'b787-9'), '12.50 m out');
  const G = TYPES['b787-9'].geo;
  assert.equal(partWhere({ kind: 'ballast', x: G.NOSE_X - 20 }, 'b787-9'), '20.0 m from the nose');
  assert.equal(partWhere({ ...p, mount: 'tail', side: 0 }, 'b787-9'), 'on the fin');
});

test('the aircraft\'s edits: each field clamped; engine and thrust for every engine', () => {
  const d = addPart(newDesign('b787-9'), { kind: 'engine', engine: 'leap-1a', mount: 'wing', side: 1, s: 15 });
  const A = TYPES['b787-9'].data;
  const e = editDesign(d, 'engine', 'ge90-115b');
  assert.ok(engineParts(e).every((p) => p.engine === 'ge90-115b'));
  assert.deepEqual(editDesign(d, 'engine', 'rr-trent'), normalizeDesign(d));
  assert.ok(engineParts(editDesign(d, 'thrustScale', '7')).every((p) => p.thrust === 3));
  assert.equal(editDesign(d, 'oewFrac', 0.1).oewDeltaKg, Math.round(0.1 * A.OEW));
  assert.equal(editDesign(d, 'oewFrac', -1).oewDeltaKg, Math.round(-0.15 * A.OEW));
  assert.ok(Math.abs(editDesign(d, 'fuelFrac', 2).fuelCapacityKg - 2 * A.FUEL_MAX) <= 10);
  assert.equal(editDesign(d, 'gearExtendM', '0.75').gearExtendM, 0.75);
  assert.equal(editDesign(d, 'registration', 'hl-77x!').registration, 'HL-77X');
  assert.equal(editDesign(d, 'name', 'Big fan').name, 'Big fan');
  assert.deepEqual(editDesign(d, 'what', 1), normalizeDesign(d));
});

test('a part\'s edits: its twin follows; mounts change with their stations; the tail takes one engine', () => {
  const d = newDesign('b777-300er'), id = d.parts[0].id, tw = d.parts[0].pair;
  const R = mountRange(d.base, d.parts[0]);
  const far = editPart(d, id, 's', '99');
  assert.equal(far.parts.find((p) => p.id === id).s, R.hi);
  assert.equal(far.parts.find((p) => p.id === tw).s, R.hi);
  const over = editPart(d, id, 'mount', 'overwing');
  assert.ok(over.parts.every((p) => p.mount === 'overwing'));
  const body = editPart(d, id, 'mount', 'body');
  const Rb = mountRange(d.base, body.parts[0]);
  assert.ok(body.parts.every((p) => p.mount === 'body' && p.x === (Rb.lo + Rb.hi) / 2));
  // From the nose: the slider's value is the distance back from the nose.
  const G = TYPES[d.base].geo, back = editPart(body, id, 'xn', String(G.NOSE_X - Rb.lo + 0.0));
  assert.equal(back.parts.find((p) => p.id === id).x, Rb.lo);
  const tail = editPart(d, id, 'mount', 'tail');
  assert.equal(engineParts(tail).length, 1);
  assert.equal(engineParts(tail)[0].side, 0);
  // A second engine can't go in the tail.
  const two = addPart(tail, { kind: 'engine', engine: 'genx-1b', mount: 'wing', side: 1, s: 20 });
  const wid = two.parts.find((p) => p.mount === 'wing').id;
  assert.deepEqual(editPart(two, wid, 'mount', 'tail'), two);
  // Off the tail: onto the left side.
  const off = editPart(tail, id, 'mount', 'wing');
  assert.equal(engineParts(off)[0].side, 1);
  assert.equal(editPart(d, id, 'engine', 'leap-1a').parts.filter((p) => p.engine === 'leap-1a').length, 2);
  assert.equal(editPart(d, id, 'mirror', false).parts.every((p) => p.pair === null), true);
  assert.equal(editPart(d, id, 'remove').parts.length, 0);
  assert.equal(editPart(d, id, 'thrust', '1.25').parts.every((p) => p.thrust === 1.25), true);
  assert.deepEqual(editPart(d, 'nope', 's', 3), normalizeDesign(d));
});

test('the surface under the pointer: each wing from above, the rear fuselage from the side, the fin', () => {
  for (const base of Object.keys(TYPES)) {
    const a = airframe(base), G = TYPES[base].geo;
    for (const side of [1, -1]) {
      const y = side * (a.ys + 0.5 * (a.tipY - a.ys)), x = a.leX(Math.abs(y)) - 0.5 * a.chord(Math.abs(y));
      const h = hitAirframe(base, [x, y, 60], [0, 0, -1]);
      assert.equal(h.on, 'wing', `${base} ${side}`);
      assert.ok(Math.abs(h.x - x) < 1e-9 && Math.abs(h.y - y) < 1e-9);
      assert.ok(h.z > a.lower(Math.abs(y)) && h.z < a.upper(Math.abs(y)), 'on the mid-surface');
    }
    const b = hitAirframe(base, [a.tailCone + 2, -80, 0.2], [0, 1, 0]);
    assert.equal(b.on, 'body');
    assert.ok(Math.abs(b.y + G.FUSELAGE_WIDTH / 2) < 0.01, 'on the fuselage\'s right side');
    const t = hitAirframe(base, [a.finLe - 1, 80, G.FUSELAGE_HEIGHT / 2 + 2], [0, -1, 0]);
    assert.equal(t.on, 'tail');
    assert.equal(hitAirframe(base, [0, 0, 80], [0, 0, 1]), null, 'pointing away: nothing');
  }
});

test('where a dropped part goes: its mount from the surface, its station snapped and in range', () => {
  const base = 'a321neo', a = airframe(base);
  const onWing = { on: 'wing', x: a.leX(9.13) - 1, y: -9.13, z: 0 };
  assert.deepEqual(placement(base, { kind: 'engine', engine: 'genx-1b' }, onWing), { kind: 'engine', engine: 'genx-1b', mount: 'wing', side: -1, s: 9.25 });
  assert.equal(placement(base, { kind: 'engine', engine: 'genx-1b', over: true }, onWing).mount, 'overwing');
  const R = mountRange(base, { kind: 'engine', engine: 'genx-1b', mount: 'wing' });
  assert.equal(placement(base, { kind: 'engine', engine: 'genx-1b' }, { ...onWing, y: 0.5 }).s, +R.lo.toFixed(2), 'kept to the range');
  const onBody = { on: 'body', x: -8.1, y: 1.9, z: 0 };
  const pb = placement(base, { kind: 'engine', engine: 'leap-1a' }, onBody);
  const Rb = mountRange(base, pb);
  assert.equal(pb.mount, 'body'); assert.equal(pb.side, 1);
  assert.equal(pb.x, Math.min(Rb.hi, Math.max(Rb.lo, -8)));
  assert.deepEqual(placement(base, { kind: 'engine', engine: 'leap-1a' }, { on: 'tail', x: -15, y: 0, z: 3 }), { kind: 'engine', engine: 'leap-1a', mount: 'tail', side: 0 });
  // Tanks and ballast: a wing tank only on the wing, a hold tank and ballast only off it.
  assert.equal(placement(base, { kind: 'tank', mount: 'wing' }, onBody), null);
  assert.equal(placement(base, { kind: 'tank', mount: 'hold' }, onWing), null);
  assert.equal(placement(base, { kind: 'ballast' }, onWing), null);
  const t = placement(base, { kind: 'tank', mount: 'wing' }, onWing);
  assert.deepEqual([t.mount, t.side, t.kg], ['wing', -1, 3000]);
  const h = placement(base, { kind: 'tank', mount: 'hold' }, onBody);
  assert.deepEqual([h.mount, h.side, h.kg], ['hold', 0, 2000]);
  assert.equal(placement(base, { kind: 'ballast' }, onBody).kg, 1000);
  assert.equal(placement(base, { kind: 'ballast' }, null), null);
});

test('picking a part: a nacelle from the side; not through the wing; the hold\'s parts through the skin', () => {
  let d = addPart(newDesign('a321neo'), { kind: 'engine', engine: 'genx-1b', mount: 'wing', side: 1, s: 10 });
  d = addPart(d, { kind: 'tank', mount: 'hold', x: 0, kg: 2000 });
  const boxes = partBoxes(d);
  assert.equal(boxes.length, 5);
  const g = boxes.find((b) => b.kind === 'engine' && b.y > 9);
  assert.equal(pickPart(d, [g.x, 60, g.z], [0, -1, 0]), g.id);
  // From straight above, over the wing's chord: the wing hides it.
  const a = airframe('a321neo'), x = a.leX(10) - 0.05 * a.chord(10);
  assert.ok(rayBox([x, 10, 60], [0, 0, -1], g) !== null, 'the ray does pass through its box');
  assert.equal(pickPart(d, [x, 10, 60], [0, 0, -1]), null);
  const h = boxes.find((b) => b.mount === 'hold');
  assert.equal(pickPart(d, [h.x, 0, 60], [0, 0, -1]), h.id);
  assert.equal(rayBox([0, 0, 50], [0, 0, 1], h), null);
  const pb = partBox('a321neo', { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 4000 });
  assert.equal(pb.shape, 'pod');
});

test('the thrust\'s line: balanced on the bases; one engine yaws; toe-in cancels; pitch up adds nose-up', () => {
  const d = newDesign('a321neo'), def = designDef(d), n = designNumbers(def);
  const L = thrustLine(def, n.cgX);
  assert.equal(L.yawNm, 0); assert.ok(L.pitchNm > 0, 'engines under the CG pitch the nose up');
  const one = editPart(editPart(d, d.parts[0].id, 'mirror', false), d.parts[1].id, 'remove');
  const r = readout(one);
  const T0 = TYPES.a321neo.data.T0_ENGINE, y0 = TYPES.a321neo.geo.ENGINES[0].y;
  assert.ok(Math.abs(Math.abs(r.line.yawNm) - T0 * y0) < 1e-6 * T0 * y0, 'a lone engine: its thrust × its station');
  assert.equal(r.rows.find((x) => x.k === 'yaw').level, 'warn', 'as much as an engine failure: amber');
  const toe = designDef(editPart(d, d.parts[0].id, 'yaw', 6));
  assert.ok(Math.abs(thrustLine(toe, n.cgX).yawNm) < 1e-6);
  const up = designDef(editPart(d, d.parts[0].id, 'pitch', 6));
  assert.ok(thrustLine(up, n.cgX).pitchNm > L.pitchNm);
  // A GE90 alone on an A321: far past an engine failure: red.
  const big = readout(editPart(one, one.parts[0].id, 'engine', 'ge90-115b'));
  assert.equal(big.rows.find((x) => x.k === 'yaw').level, 'bad');
  assert.ok(big.issues.some((i) => i.level === 'bad' && /Lopsided/.test(i.text)));
});

test('no engines: red, and Save waits; heavy ballast far aft moves the CG past the limit', () => {
  const r = readout(noEngines(newDesign('b787-9')));
  assert.equal(r.canSave, false);
  assert.equal(r.worst, 'bad');
  assert.match(r.issues[0].text, /No engines/);
  assert.equal(r.rows.find((x) => x.k === 'tw').value, '—');
  const G = TYPES.a321neo.geo;
  let d = newDesign('a321neo');
  for (let k = 0; k < 3; k++) d = addPart(d, { kind: 'ballast', x: -30, kg: 6000 });
  const c = readout(d);
  assert.ok(c.numbers.cgShiftMac < -WARN.cgAftBad);
  assert.equal(c.rows.find((x) => x.k === 'cg').level, 'bad');
  assert.ok(c.issues.some((i) => /aft of the base/.test(i.text)));
  assert.ok(G.NOSE_X > 0);
});

test('parts in each other\'s way are red', () => {
  const d = addPart(newDesign('a321neo'), { kind: 'engine', engine: 'ge90-115b', mount: 'wing', side: 1, s: 6.5 });
  const r = readout(d);
  assert.ok(r.numbers.overlap);
  assert.ok(r.issues.some((i) => i.level === 'bad' && /each other/.test(i.text)));
});

test('undo and redo', () => {
  const h = createHistory(3);
  assert.equal(h.undo('x'), null);
  h.push('a'); h.push('b');
  assert.ok(h.canUndo && !h.canRedo);
  assert.equal(h.undo('c'), 'b');
  assert.equal(h.undo('b'), 'a');
  assert.equal(h.undo('a'), null);
  assert.equal(h.redo('a'), 'b');
  assert.equal(h.redo('b'), 'c');
  assert.equal(h.redo('c'), null);
  h.undo('c'); h.push('d');
  assert.ok(!h.canRedo, 'a new change clears the redo');
  for (const s of ['e', 'f', 'g', 'h']) h.push(s);
  let k = 0; while (h.undo('z') !== null) k++;
  assert.equal(k, 3, 'the oldest steps fall off');
  h.clear();
  assert.ok(!h.canUndo && !h.canRedo);
});

test('the model rebuilds on the parts it draws, the gear and the registration; not on weight, thrust or the hold', () => {
  const d = newDesign('a321neo');
  const k = viewKey(d);
  assert.equal(viewKey(editDesign(d, 'thrustScale', 2)), k);
  assert.equal(viewKey(editDesign(d, 'oewFrac', 0.2)), k);
  assert.equal(viewKey(editDesign(d, 'fuelFrac', 1.5)), k);
  assert.equal(viewKey(addPart(d, { kind: 'ballast', x: 0, kg: 500 })), k);
  assert.equal(viewKey(addPart(d, { kind: 'tank', mount: 'hold', x: 0, kg: 2000 })), k);
  assert.notEqual(viewKey(addPart(d, { kind: 'tank', mount: 'wing', side: 1, s: 10, kg: 2000 })), k);
  assert.notEqual(viewKey(editDesign(d, 'gearExtendM', 1)), k);
  assert.notEqual(viewKey(editPart(d, d.parts[0].id, 's', 8)), k);
  assert.notEqual(viewKey(editPart(d, d.parts[0].id, 'yaw', 3)), k);
  assert.notEqual(viewKey(editDesign(d, 'engine', 'genx-1b')), k);
  assert.notEqual(viewKey(editDesign(d, 'registration', 'HL0001')), k);
  assert.ok(ENGINE_TYPES['genx-1b']);
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
