// v0.5.7: the warehouse's keys tab (src/ui/warehouse.js keyTab() and its helpers, over src/keys.js). Shane's decisions:
// only the block's keys are set there (7–0, U–P, J–;, M–/), each aircraft's own; each engine its own thrust up and down,
// one engine at a time (a mirror twin is its own part with its own keys), by part id for designs and by index for the
// stock types; a wing tank's tab has the drop; the wing, tailplane, fin and fuselage lose their keys (the Controls
// page's); the engine's tab says which keys move every engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyTab, keyScopeOf, engineIndex, engineSlotOf, engineNamer, allEnginesLine } from '../src/ui/warehouse.js';
import { newDesign, addPart, setMirror, designDef, resolveDef } from '../src/sim/designs.js';
import { emptyStore, bindKey, bindEngineKey, bindDropKey, engineSlots } from '../src/keys.js';

const capsText = (row) => row.caps.map((c) => (c.empty ? '·' : c.text));

test('the scope: a stock type’s own keys, a design’s own (no fallback to its base type)', () => {
  const d = newDesign('b787-9', { id: 'dx' });
  assert.deepEqual(keyScopeOf(d, true), { scope: 'type:b787-9', base: null });
  assert.deepEqual(keyScopeOf(d, false), { scope: 'design:dx', base: null });
});

test('an engine’s tab: its own up and down (none to start), one engine at a time, and the all-engines line', () => {
  const d = newDesign('a321neo', { id: 'stock-a321neo' }), def = designDef(d);
  const [p1, p2] = d.parts;
  assert.equal(engineIndex(def, p1.id), 0);
  assert.equal(engineIndex(def, p2.id), 1);
  // A stock type's engines are stored by index; a design's by part id.
  assert.equal(engineSlotOf(d, def, p2.id, true), '1');
  assert.equal(engineSlotOf(d, def, p2.id, false), p2.id);
  const sc = keyScopeOf(d, true);
  let st = emptyStore();
  let t = keyTab(d, def, st, sc, { part: p1.id }, { stock: true });
  assert.equal(t.part, 'engine');
  assert.deepEqual(t.engine, { i: 0, slot: '0' });
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].label, 'Engine 1: its own thrust');
  assert.deepEqual(t.rows[0].caps.map((c) => [c.cap, !!c.empty]), [['eng:up', true], ['eng:down', true]]);
  assert.deepEqual(t.all, { up: ['KeyR'], down: ['KeyF'] });
  assert.equal(allEnginesLine(t.all), 'R and F move all the engines, this one too (set on the Controls page).');
  // Its up key: U. The twin has none (Mirror no longer pairs keys).
  st = bindEngineKey(st, sc.scope, '0', 1, 'KeyU').store;
  t = keyTab(d, def, st, sc, { part: p1.id }, { stock: true });
  assert.deepEqual(capsText(t.rows[0]), ['U', '·']);
  assert.deepEqual(capsText(keyTab(d, def, st, sc, { part: p2.id }, { stock: true }).rows[0]), ['·', '·']);
  // The all-engines keys as the Controls page binds them.
  const g = bindKey(bindKey(st, 'thrustUp', 'Digit4').store, 'thrustDown', 'Digit5').store;
  assert.equal(allEnginesLine(keyTab(d, def, g, sc, { part: p1.id }, { stock: true }).all), '4 and 5 move all the engines, this one too (set on the Controls page).');
  assert.equal(allEnginesLine({ up: ['KeyR'], down: [] }), 'R moves all the engines up, this one too (set on the Controls page).');
  assert.equal(allEnginesLine({ up: [], down: [] }), 'The all-engines thrust has no keys: set them on the Controls page.');
  // An engine's name in a note, by its slot.
  assert.equal(engineNamer(d, def, true)('1'), 'engine 2');
  assert.equal(engineNamer(d, def, true)('5'), null);
});

test('a stock type’s keys editor numbers each engine as the type flies it (the left one is engine 1)', () => {
  for (const id of ['a321neo', 'b787-9', 'b777-300er']) {
    const d = newDesign(id, { id: `stock-${id}` }), def = designDef(d), flown = resolveDef(id);
    assert.deepEqual(engineSlots(flown), ['0', '1']);
    for (const p of d.parts) {
      const slot = engineSlotOf(d, def, p.id, true);
      assert.equal(Math.sign(flown.geo.ENGINES[Number(slot)].y), p.side, `${id} ${p.id}`);
    }
  }
});

test('a design’s engines by part id: the tab follows the part, whatever its place in the sim’s order', () => {
  let d = newDesign('a321neo', { id: 'd2' });
  d = addPart(d, { kind: 'engine', engine: d.parts[0].engine, mount: 'wing', side: 1, s: 10 }, { mirror: true });
  const def = designDef(d), sc = keyScopeOf(d);
  // p3 (left outboard) is engine 1 in the sim; p1 engine 2.
  assert.equal(engineIndex(def, 'p3'), 0);
  assert.equal(engineIndex(def, 'p1'), 1);
  const st = bindEngineKey(emptyStore(), sc.scope, 'p3', -1, 'KeyJ').store;
  const t = keyTab(d, def, st, sc, { part: 'p3' });
  assert.equal(t.rows[0].label, 'Engine 1: its own thrust');
  assert.deepEqual(t.engine, { i: 0, slot: 'p3' });
  assert.deepEqual(capsText(t.rows[0]), ['·', 'J']);
  assert.deepEqual(capsText(keyTab(d, def, st, sc, { part: 'p4' }).rows[0]), ['·', '·'], 'its mirror twin has its own');
  assert.equal(engineNamer(d, def)('p3'), 'engine 1');
  assert.equal(engineNamer(d, def)('p9'), null);
  // Unmirrored, the same.
  const dd = setMirror(newDesign('a321neo', { id: 'd3' }), 'p1', false);
  assert.deepEqual(keyTab(dd, designDef(dd), emptyStore(), keyScopeOf(dd), { part: 'p1' }).engine, { i: 0, slot: 'p1' });
});

test('a wing tank’s tab is the drop (from the block, Shift too); a hold tank and ballast have no keys', () => {
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
  assert.deepEqual(t.rows.map((r) => [!!r.drop, capsText(r)]), [[true, ['·']]]);
  const st = bindDropKey(emptyStore(), sc.scope, 'Shift+KeyP').store;
  t = keyTab(d, def, st, sc, { part: wing.id });
  assert.deepEqual(capsText(t.rows[0]), ['Shift+P']);
  for (const p of [hold, ball]) {
    const x = keyTab(d, def, st, sc, { part: p.id });
    assert.equal(x.rows.length, 0);
    assert.match(x.note, /No keys/);
  }
});

test('the wing, tailplane, fin and fuselage have no keys in the warehouse: theirs are the Controls page’s', () => {
  const a = newDesign('a321neo', { id: 'stock-a321neo' }), da = designDef(a);
  for (const af of ['wing', 'tailplane', 'fin', 'body']) {
    const t = keyTab(a, da, emptyStore(), keyScopeOf(a, true), { af });
    assert.equal(t.rows.length, 0, af);
    assert.match(t.note, /Controls page, the same for every aircraft/, af);
  }
});
