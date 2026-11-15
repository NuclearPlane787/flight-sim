// v0.5.4: a design renamed in the warehouse is renamed in the scenarios that fly it (src/scenarios.js's
// renameDesign, told by src/designs-store.js's onDesignRename): the Load list's summary.design and the saved
// state's copy of the design's name; its parts, the other scenarios and the logbook stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioStore, SCEN_PREFIX, LOGBOOK_KEY, stateDesignId, renamedState } from '../src/scenarios.js';
import { DesignStore, onDesignRename } from '../src/designs-store.js';

// A Storage-like Map (one localStorage for both stores, as in the page). `full`: setItem throws.
class Mem {
  constructor() { this.m = new Map(); this.full = false; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.full) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const T0 = Date.UTC(2026, 10, 15, 5, 0);
// A saved state flying design `d` (the sim's snapshot and the plan each carry a copy), or a type.
const flying = (d) => ({ v: 1, plan: { origin: 'RKSS', dest: 'RKPC', type: d.base, design: d }, sim: { type: d.base, design: d, x: 1 } });
const typeState = { v: 1, plan: { origin: 'RKSS', dest: 'RKPC', type: 'a321neo' }, sim: { type: 'a321neo', x: 2 } };

function setup() {
  const s = new Mem(), designs = new DesignStore(s), scen = new ScenarioStore(s);
  const a = designs.create('a321neo', { name: 'Long legs' }).design;
  const b = designs.create('a321neo', { name: 'Short hop' }).design;
  return { s, designs, scen, a, b };
}

test('the state helpers: which design it flies, and its copies renamed (only the name)', () => {
  const { a } = setup();
  const st = flying(a);
  assert.equal(stateDesignId(st), a.id);
  assert.equal(stateDesignId(typeState), null);
  assert.equal(stateDesignId({ v: 1, plan: { design: a } }), a.id);   // a fresh scenario: the plan's only
  const r = renamedState(st, a.id, 'Longer legs');
  assert.notEqual(r, st);
  assert.equal(r.sim.design.name, 'Longer legs');
  assert.equal(r.plan.design.name, 'Longer legs');
  assert.deepEqual({ ...r.sim.design, name: a.name }, a);   // the parts and the airframe as saved
  assert.equal(st.sim.design.name, 'Long legs');            // the original untouched
  assert.equal(renamedState(st, 'other', 'X y z'), st);     // nothing of that id: the same object
  assert.equal(renamedState(typeState, a.id, 'X y z'), typeState);
});

test('summary.designId is kept from now on (create, write, duplicate)', () => {
  const { scen, a } = setup();
  const c = scen.create('One', flying(a), { route: 'RKSS–RKPC', design: a.name, designId: a.id }, { now: T0 });
  assert.equal(c.entry.summary.designId, a.id);
  assert.ok(scen.write(c.id, flying(a), { route: 'RKSS–RKPC', where: 'FL350', design: a.name, designId: a.id }, T0 + 1000).ok);
  assert.equal(scen.entry(c.id).summary.designId, a.id);
  const d = scen.duplicate(c.id, { now: T0 + 2000 });
  assert.equal(d.entry.summary.designId, a.id);
  // A type's scenario has neither.
  const t = scen.create('Two', typeState, { route: 'RKSS–RKPC' }, { now: T0 });
  assert.equal(t.entry.summary.design, undefined);
  assert.equal(t.entry.summary.designId, undefined);
});

test('renameDesign: every scenario flying it, by summary.designId or (older) the saved design.id; nothing else', () => {
  const { s, scen, a, b } = setup();
  s.setItem(LOGBOOK_KEY, JSON.stringify([{ design: 'Long legs', scenarioId: 'x' }]));
  const one = scen.create('One', flying(a), { route: 'RKSS–RKPC', where: 'FL350', design: a.name, designId: a.id }, { now: T0 }).id;
  // From before v0.5.4: no designId in the summary, the state says which.
  const old = scen.create('Old', flying(a), { route: 'RKSS–RKPC', where: 'Parked', design: a.name }, { now: T0 + 1 }).id;
  assert.equal(scen.entry(old).summary.designId, undefined);
  const other = scen.create('Other', flying(b), { route: 'RKSS–RKPC', design: b.name, designId: b.id }, { now: T0 + 2 }).id;
  const plain = scen.create('Plain', typeState, { route: 'RKSS–RKPC' }, { now: T0 + 3 }).id;
  const before = { other: s.getItem(SCEN_PREFIX + other), plain: s.getItem(SCEN_PREFIX + plain), log: s.getItem(LOGBOOK_KEY) };
  const order = scen.list().map((e) => e.id), saved = scen.entry(one).savedAt;

  assert.equal(scen.renameDesign(a.id, '  Longer   legs '), 2);
  for (const id of [one, old]) {
    const e = scen.entry(id), rec = scen.get(id);
    assert.equal(e.summary.design, 'Longer legs');
    assert.equal(e.summary.designId, a.id);   // backfilled for the old one
    assert.equal(rec.state.sim.design.name, 'Longer legs');
    assert.equal(rec.state.plan.design.name, 'Longer legs');
    assert.deepEqual(rec.state.sim.design.parts, a.parts);   // only the name
    assert.equal(rec.state.sim.x, 1);
    assert.equal(rec.name, id === one ? 'One' : 'Old');      // the scenario keeps its own name
  }
  assert.equal(scen.entry(one).summary.where, 'FL350');
  assert.equal(scen.entry(one).savedAt, saved);              // the list keeps its order
  assert.deepEqual(scen.list().map((e) => e.id), order);
  assert.equal(scen.entry(other).summary.design, 'Short hop');
  assert.equal(s.getItem(SCEN_PREFIX + other), before.other);
  assert.equal(s.getItem(SCEN_PREFIX + plain), before.plain);
  assert.equal(s.getItem(LOGBOOK_KEY), before.log);           // the logbook keeps its names
  assert.equal(scen.renameDesign('nobody', 'Whatever'), 0);
  assert.equal(scen.renameDesign(a.id, 'ab'), 0);             // too short: nothing
  assert.equal(scen.entry(one).summary.design, 'Longer legs');
});

test('renameDesign: a refused write changes nothing', () => {
  const { s, scen, a } = setup();
  const one = scen.create('One', flying(a), { route: 'RKSS–RKPC', design: a.name, designId: a.id }, { now: T0 }).id;
  const two = scen.create('Two', flying(a), { route: 'RKSS–RKPC', design: a.name, designId: a.id }, { now: T0 + 1 }).id;
  const snap = new Map(s.m);
  s.full = true;
  assert.equal(scen.renameDesign(a.id, 'Longer legs'), 0);
  s.full = false;
  assert.deepEqual(new Map(s.m), snap);
  assert.equal(scen.get(one).state.sim.design.name, 'Long legs');
  assert.equal(scen.entry(two).summary.design, 'Long legs');
});

test('the designs store tells a rename (Rename, or Save under a new name), and nothing else', () => {
  const { designs, a } = setup();
  const heard = [];
  const off = onDesignRename((id, name) => heard.push([id, name]));
  try {
    assert.ok(designs.rename(a.id, 'Longer legs').ok);
    assert.ok(designs.save({ ...designs.get(a.id), name: 'Longest legs' }).ok);   // the editor's name, then Save
    assert.ok(designs.save({ ...designs.get(a.id) }).ok);                         // the same name: no rename
    assert.ok(designs.create('a321neo').ok);                                       // a new design: no rename
    assert.ok(designs.duplicate(a.id).ok);                                         // a copy: no rename
    assert.deepEqual(heard, [[a.id, 'Longer legs'], [a.id, 'Longest legs']]);
  } finally { off(); }
  designs.rename(a.id, 'Not heard');
  assert.equal(heard.length, 2);
});

test('end to end: the warehouse renames, the scenarios follow (as menu.js wires it)', () => {
  const { scen, designs, a } = setup();
  const one = scen.create('One', flying(a), { route: 'RKSS–RKPC', design: a.name, designId: a.id }, { now: T0 }).id;
  const off = onDesignRename((id, name) => scen.renameDesign(id, name));
  try {
    designs.rename(a.id, 'Ferry legs');
    assert.equal(scen.entry(one).summary.design, 'Ferry legs');
    assert.equal(scen.get(one).state.sim.design.name, 'Ferry legs');
  } finally { off(); }
});
