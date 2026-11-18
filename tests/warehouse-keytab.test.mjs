// v0.5.6: the warehouse's keys tab (src/ui/warehouse.js keyTab() and its helpers, over src/keys.js). Shane,
// 2026-11-18: "Move the keybinding settings thing to the warehouse, where you can attach keybindings by selecting plane
// parts like the engines, where they open a little tab and you can change the key by pressing on top of a little key
// icon. For example, an engine would have r/f as the controls. This is similar to Besiege."
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyTab, keyScopeOf, engineIndex, twinIndex, keyLabelOf, KEY_PART } from '../src/ui/warehouse.js';
import { newDesign, addPart, setMirror, designDef } from '../src/sim/designs.js';
import { emptyStore, bindKey, bindEngineKey, bindingOf } from '../src/keys.js';

const capsText = (row) => row.caps.map((c) => (c.empty ? '·' : c.text));

test('the scope: a stock type’s own keys, a design’s (its base type’s until changed)', () => {
  const d = newDesign('b787-9', { id: 'dx' });
  assert.deepEqual(keyScopeOf(d, true), { scope: 'type:b787-9', base: null });
  assert.deepEqual(keyScopeOf(d, false), { scope: 'design:dx', base: 'type:b787-9' });
  assert.deepEqual(KEY_PART, { wing: 'wing', tailplane: 'tailplane', fin: 'fin', body: 'fuselage' });
});

test('an engine’s tab: R/F as the others, then its own keys with its mirror twin; the all-engines row stays editable', () => {
  const d = newDesign('a321neo', { id: 'stock-a321neo' }), def = designDef(d);
  const [p1, p2] = d.parts;
  assert.equal(engineIndex(def, p1.id), 0);
  assert.equal(engineIndex(def, p2.id), 1);
  assert.equal(twinIndex(d, def, p1.id), 1);
  const sc = keyScopeOf(d, true);
  let st = emptyStore();
  let t = keyTab(d, def, st, sc, { part: p1.id });
  assert.equal(t.part, 'engine');
  assert.deepEqual(t.engine, { i: 0, twin: 1, engines: [0, 1], own: false, with: [0] });
  assert.equal(t.rows[0].label, 'Engine 1 and 2 (its twin): as the others');
  assert.deepEqual(t.rows[0].caps.map((c) => [c.cap, c.text, !!c.follow]), [['eng:up', 'R', true], ['eng:down', 'F', true]]);
  assert.ok(t.rows[1].all);
  assert.deepEqual(t.rows[1].up.map((c) => c.cap), ['thrustUp:0']);
  assert.deepEqual(t.rows[1].down.map((c) => c.text), ['F']);
  // Without its twin (a type's Mirror off): engine 1 alone.
  assert.deepEqual(keyTab(d, def, st, sc, { part: p1.id }, { twinOn: false }).engine.engines, [0]);
  // Its up key changed: its own (and its twin's), the down unbound until set; R stays the all-engines key.
  st = bindEngineKey(st, sc, [0, 1], 1, 'KeyU').store;
  t = keyTab(d, def, st, sc, { part: p2.id });
  assert.equal(t.rows[0].label, 'Engine 2 and 1 (its twin): its own');
  assert.deepEqual(t.rows[0].caps.map((c) => [c.text, !!c.empty, !!c.follow]), [['U', false, false], ['', true, false]]);
  assert.equal(t.rows[0].own, true);
  assert.deepEqual(t.rows[1].up.map((c) => c.text), ['R']);
  // A design: its engines unmirrored each have their own tab (no twin); it flies the A321neo's keys until it has its own.
  const dd = setMirror(newDesign('a321neo', { id: 'd2' }), 'p1', false);
  const ddef = designDef(dd);
  assert.equal(twinIndex(dd, ddef, 'p1'), null);
  t = keyTab(dd, ddef, st, keyScopeOf(dd), { part: 'p1' });
  assert.deepEqual(t.engine.engines, [0]);
  assert.equal(t.rows[0].label, 'Engine 1: its own');
  assert.deepEqual(t.engine.with, [0, 1], 'the base type’s group');
});

test('a wing tank’s tab is its drop; a hold tank and ballast have no keys', () => {
  let d = newDesign('a321neo', { id: 'd3' });
  d = addPart(d, { kind: 'tank', mount: 'wing', side: 1, s: 6 }, { mirror: true });
  d = addPart(d, { kind: 'tank', mount: 'hold', x: 0 }, { mirror: false });
  d = addPart(d, { kind: 'ballast', x: 0 }, { mirror: false });
  const def = designDef(d), sc = keyScopeOf(d);
  const wing = d.parts.find((p) => p.kind === 'tank' && p.mount === 'wing');
  const hold = d.parts.find((p) => p.kind === 'tank' && p.mount === 'hold');
  const ball = d.parts.find((p) => p.kind === 'ballast');
  assert.ok(wing && hold && ball, JSON.stringify(d.parts));
  let t = keyTab(d, def, emptyStore(), sc, { part: wing.id });
  assert.equal(t.part, 'tank');
  assert.deepEqual(t.rows.map((r) => [r.id, capsText(r)]), [['dropTanks', ['·']]]);
  const st = bindKey(emptyStore(), sc, 'dropTanks', 'KeyU').store;
  t = keyTab(d, def, st, sc, { part: wing.id });
  assert.deepEqual(t.rows[0].caps.map((c) => c.text), ['U', '+']);
  for (const p of [hold, ball]) {
    const x = keyTab(d, def, st, sc, { part: p.id });
    assert.equal(x.rows.length, 0);
    assert.match(x.note, /No keys/);
  }
});

test('the airframe’s tabs: the wing (ailerons, flaps by the type’s detents, spoilers), the tailplane, the fin, the fuselage', () => {
  const a = newDesign('a321neo', { id: 'stock-a321neo' }), b = newDesign('b777-300er', { id: 'stock-b777-300er' });
  const da = designDef(a), db = designDef(b);
  const w = keyTab(a, da, emptyStore(), keyScopeOf(a, true), { af: 'wing' });
  assert.equal(w.part, 'wing');
  assert.deepEqual(w.rows.map((r) => r.label), ['Roll left (ailerons)', 'Roll right (ailerons)', 'Flaps up a step', 'Flaps down a step',
    'Flaps to 0', 'Flaps to 1', 'Flaps to 2', 'Flaps to 3', 'Flaps to FULL', 'Speed brakes', 'Arm the ground spoilers']);
  assert.deepEqual(capsText(w.rows[0]), ['A', '+']);
  assert.deepEqual(capsText(w.rows[4]), ['·'], 'the detents are unbound');
  assert.deepEqual(capsText(w.rows[10]), ['Shift+C', '+']);
  const wb = keyTab(b, db, emptyStore(), keyScopeOf(b, true), { af: 'wing' });
  assert.equal(wb.rows[4].label, 'Flaps to UP');
  assert.equal(keyLabelOf(bindingOf('flap4'), db), 'Flaps to 30');
  // The tailplane: the elevator, and a Boeing's trim.
  assert.deepEqual(keyTab(a, da, emptyStore(), keyScopeOf(a, true), { af: 'tailplane' }).rows.map((r) => r.id), ['pitchDown', 'pitchUp']);
  assert.deepEqual(keyTab(b, db, emptyStore(), keyScopeOf(b, true), { af: 'tailplane' }).rows.map((r) => r.id), ['pitchDown', 'pitchUp', 'trimDown', 'trimUp']);
  assert.deepEqual(keyTab(a, da, emptyStore(), keyScopeOf(a, true), { af: 'fin' }).rows.map((r) => [r.id, capsText(r)[0]]), [['yawLeft', 'Q'], ['yawRight', 'E']]);
  const f = keyTab(a, da, emptyStore(), keyScopeOf(a, true), { af: 'body' });
  assert.equal(f.part, 'fuselage');
  assert.deepEqual(f.rows.map((r) => [r.id, capsText(r)[0]]), [['gear', 'G'], ['brakes', 'Space'], ['parkingBrake', 'B']]);
  // Changed on the type: its tab shows it (and a design on it, until it has its own).
  const st = bindKey(emptyStore(), keyScopeOf(a, true), 'gear', 'KeyN').store;
  assert.equal(capsText(keyTab(a, da, st, keyScopeOf(a, true), { af: 'body' }).rows[0])[0], 'N');
  const d = newDesign('a321neo', { id: 'd4' });
  assert.equal(capsText(keyTab(d, designDef(d), st, keyScopeOf(d), { af: 'body' }).rows[0])[0], 'N');
});
