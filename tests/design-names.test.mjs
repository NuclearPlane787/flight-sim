// v0.5.8: a design's name is a live reference. Everything that shows one resolves it by the design's id from the designs
// store (src/designs-store.js's nameOf / designName) when it's shown; the name stored beside the id shows only once the
// design is deleted. Here: the store's resolution, the home page's card, the logbook's rows (entries with a designId,
// older ones without, a deleted design) and the saved state's copies as main.js renames them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DesignStore, designName } from '../src/designs-store.js';
import { flightCard } from '../src/ui/home-card.js';
import { designIdOf, designLabel } from '../src/ui/logbook.js';
import { ScenarioStore, renamedState, stateDesignId } from '../src/scenarios.js';

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const made = () => {
  const store = new DesignStore(new Mem());
  const d = store.create('a321neo', { name: 'Alpha' }).design;
  return { store, d };
};

test('nameOf: the stored design\'s name now, by its id', () => {
  const { store, d } = made();
  assert.equal(store.nameOf(d.id, 'Alpha'), 'Alpha');
  assert.ok(store.rename(d.id, 'Bravo').ok);
  assert.equal(store.nameOf(d.id, 'Alpha'), 'Bravo', 'renamed: the new name, whatever the caller stored');
  assert.ok(store.save({ ...store.get(d.id), name: 'Charlie' }).ok);   // the editor's name, then Save
  assert.equal(store.nameOf(d.id, 'Alpha'), 'Charlie');
  assert.equal(store.names().get(d.id), 'Charlie');
});

test('nameOf: a deleted design, an unknown or missing id, no storage: the stored name', () => {
  const { store, d } = made();
  assert.ok(store.remove(d.id));
  assert.equal(store.nameOf(d.id, 'Alpha'), 'Alpha', 'deleted: the name it was stored with');
  assert.equal(store.nameOf('dnope', 'Ghost'), 'Ghost');
  assert.equal(store.nameOf(null, 'Old'), 'Old', 'no id (a save from before the ids)');
  assert.equal(store.nameOf(d.id), null, 'no fallback: null');
  assert.equal(new DesignStore(null).nameOf(d.id, 'Alpha'), 'Alpha', 'storage off');
  // node has no localStorage: the page's store is empty, so designName() gives the fallback
  assert.equal(designName(d.id, 'Alpha'), 'Alpha');
});

test('names(): read again when the stored list changes, by any store over the same storage', () => {
  const mem = new Mem();
  const a = new DesignStore(mem), b = new DesignStore(mem);
  const d = a.create('b787-9', { name: 'Long hauler' }).design;
  assert.equal(b.nameOf(d.id), 'Long hauler');
  b.rename(d.id, 'Longer hauler');   // the warehouse makes its own store
  assert.equal(a.nameOf(d.id), 'Longer hauler');
  const other = new DesignStore(new Mem());
  assert.equal(other.nameOf(d.id, 'x'), 'x', 'another storage has its own names');
  assert.equal(a.nameOf(d.id), 'Longer hauler');
});

test('the home page\'s card names the design as it is now, the stored name once it is deleted', () => {
  const entry = { id: 's1', name: 'Scenario 1', type: 'a321neo', summary: { route: 'RKSS–RKPC', where: 'Taxiing at RKSS', design: 'Alpha', designId: 'd1' } };
  const live = new Map([['d1', 'Bravo']]);
  const nameOf = (id, fb) => live.get(id) ?? fb;
  assert.equal(flightCard(entry, { designName: nameOf }).sub, 'Scenario 1 · Bravo');
  live.delete('d1');
  assert.equal(flightCard(entry, { designName: nameOf }).sub, 'Scenario 1 · Alpha', 'deleted');
  assert.equal(flightCard(entry).sub, 'Scenario 1 · Alpha', 'the default (the page\'s store: none in node)');
  const typeOnly = { ...entry, summary: { route: 'RKSS–RKPC', where: 'Taxiing at RKSS' } };
  assert.equal(flightCard(typeOnly, { designName: () => 'Never' }).sub, 'Scenario 1 · A321neo', 'a type: its name, no lookup');
  assert.equal(flightCard(entry, { designName: () => { throw new Error('x'); } }).sub, 'Scenario 1 · Alpha', 'a failing lookup: the stored name');
});

test('the logbook: an entry\'s design id, its own or (older) its scenario\'s', () => {
  assert.equal(designIdOf({ design: 'Alpha', designId: 'd1' }), 'd1');
  assert.equal(designIdOf({ design: 'Alpha', designId: 'd1' }, { id: 's1', designId: 'd2' }), 'd1', 'its own wins');
  assert.equal(designIdOf({ design: 'Alpha' }, { id: 's1', designId: 'd1' }), 'd1', 'without one: its scenario\'s');
  assert.equal(designIdOf({ design: 'Alpha' }, { id: 's1' }), null, 'its scenario flies no known design');
  assert.equal(designIdOf({ design: 'Alpha' }), null, 'its scenario is gone');
  assert.equal(designIdOf({ type: 'b787-9' }, { id: 's1', designId: 'd1' }), null, 'a type\'s flight has none');
});

test('the logbook\'s rows: renamed, deleted, and old entries without an id', () => {
  const live = new Map([['d1', 'Bravo']]);
  const nameOf = (id, fb) => live.get(id) ?? fb;
  const scen = { id: 's1', name: 'Scenario 1', designId: 'd1', design: 'Bravo' };
  const withId = { design: 'Alpha', designId: 'd1', scenarioId: 's1' };
  const old = { design: 'Alpha', scenarioId: 's1' };
  const lost = { design: 'Alpha', scenarioId: 'sgone' };
  assert.equal(designLabel(withId, { scenario: scen, nameOf }), 'Bravo', 'renamed');
  assert.equal(designLabel(old, { scenario: scen, nameOf }), 'Bravo', 'no designId: its scenario\'s design, renamed');
  assert.equal(designLabel(lost, { scenario: null, nameOf }), 'Alpha', 'no designId and no scenario: the name it was written with');
  live.delete('d1');
  assert.equal(designLabel(withId, { scenario: scen, nameOf }), 'Bravo', 'deleted: the name its scenario last stored for it');
  assert.equal(designLabel(withId, { scenario: null, nameOf }), 'Alpha', 'deleted, its scenario too: its own');
  assert.equal(designLabel(withId, { scenario: { id: 's1', designId: 'd9', design: 'Other' }, nameOf }), 'Alpha', 'a scenario of another design isn\'t used');
  assert.equal(designLabel({ type: 'a321neo' }, { scenario: scen, nameOf }), null, 'a type\'s flight: none');
  assert.equal(designLabel(withId, {}), 'Alpha', 'no lookup: the stored name');
});

test('a save of a flight held in memory: its copies of the design take the name it has now', () => {
  const st = { v: 1, plan: { origin: 'RKSS', design: { id: 'd1', name: 'Alpha', parts: [] } }, sim: { t: 5, design: { id: 'd1', name: 'Alpha', parts: [] } } };
  const out = renamedState(st, 'd1', 'Bravo');
  assert.equal(out.sim.design.name, 'Bravo');
  assert.equal(out.plan.design.name, 'Bravo');
  assert.equal(out.sim.t, 5);
  assert.equal(st.sim.design.name, 'Alpha', 'the flight\'s own state isn\'t changed');
  assert.equal(renamedState(st, 'd1', 'Alpha'), st, 'the same name: the same object');
  assert.equal(stateDesignId(out), 'd1');
});

test('renameDesign still renames the stored copies (the fallback once the design is deleted)', () => {
  const mem = new Mem(), sc = new ScenarioStore(mem);
  const state = { v: 1, plan: { origin: 'RKSS', design: { id: 'd1', name: 'Alpha' } }, sim: { design: { id: 'd1', name: 'Alpha' } } };
  const r = sc.create('Scenario 1', state, { route: 'RKSS–RKPC', where: 'x', design: 'Alpha', designId: 'd1' });
  assert.ok(r.ok);
  assert.equal(sc.renameDesign('d1', 'Bravo'), 1);
  assert.equal(sc.entry(r.id).summary.design, 'Bravo');
  assert.equal(sc.get(r.id).state.sim.design.name, 'Bravo');
});
