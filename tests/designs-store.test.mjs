// v0.5.0: the warehouse's designs store (src/designs-store.js): one JSON list under gamedump:flight-sim:designs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DesignStore, DESIGNS_KEY } from '../src/designs-store.js';
import { normalizeDesign, newDesign } from '../src/sim/designs.js';

class Mem {
  constructor() { this.m = new Map(); this.full = false; this.writes = 0; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { if (this.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } this.writes++; this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('the key is the game\'s prefix', () => {
  assert.equal(DESIGNS_KEY, 'gamedump:flight-sim:designs');
  assert.ok(DESIGNS_KEY.startsWith('gamedump:flight-sim:'));
});

test('create, list, get: newest first, normalized, free names', () => {
  const st = new DesignStore(new Mem());
  assert.deepEqual(st.list(), []);
  const a = st.create('a321neo');
  const b = st.create('a321neo');
  const c = st.create('b777-300er', { count: 4, engine: 'ge90-115b' });
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.design.name, 'My A321neo');
  assert.equal(b.design.name, 'My A321neo 2');
  assert.equal(c.design.name, 'My 777-300ER');
  assert.equal(c.design.count, 4);
  assert.equal(c.design.stations.length, 2);
  const ids = st.list().map((d) => d.id);
  assert.deepEqual(ids, [c.design.id, b.design.id, a.design.id]);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(st.get(c.design.id), c.design);
  assert.equal(st.get('nope'), null);
  // A design is its base exactly until changed.
  const base = newDesign('a321neo', { id: a.design.id, name: a.design.name });
  assert.deepEqual(a.design, base);
});

test('save normalizes and replaces in place; out-of-range values clamp', () => {
  const st = new DesignStore(new Mem());
  const a = st.create('b787-9').design, b = st.create('a321neo').design;
  const r = st.save({ ...a, thrustScale: 9, gearExtendM: -3, oewDeltaKg: 1e9, count: 5, engine: 'nope' });
  assert.ok(r.ok);
  assert.equal(r.design.thrustScale, 3);
  assert.equal(r.design.gearExtendM, 0);
  assert.equal(r.design.count, 2);
  assert.equal(r.design.engine, 'genx-1b');
  assert.deepEqual(r.design, normalizeDesign(r.design));
  assert.deepEqual(st.list().map((d) => d.id), [b.id, a.id], 'the order stays');
});

test('duplicate names a copy, rename checks the name, remove drops it', () => {
  const st = new DesignStore(new Mem());
  const a = st.create('a321neo', { engine: 'ge90-115b', gearExtendM: 1.5 }).design;
  const c1 = st.duplicate(a.id), c2 = st.duplicate(a.id);
  assert.equal(c1.design.name, 'My A321neo (copy)');
  assert.equal(c2.design.name, 'My A321neo (copy 2)');
  assert.notEqual(c1.design.id, a.id);
  assert.equal(c1.design.engine, 'ge90-115b');
  assert.equal(c1.design.gearExtendM, 1.5);
  assert.deepEqual(st.duplicate('nope'), { ok: false, error: 'missing' });
  assert.deepEqual(st.rename(a.id, 'x'), { ok: false, error: 'name' });
  assert.deepEqual(st.rename('nope', 'Long enough'), { ok: false, error: 'missing' });
  const r = st.rename(a.id, '  GE90   on a  321 ');
  assert.ok(r.ok);
  assert.equal(st.get(a.id).name, 'GE90 on a 321');
  assert.equal(st.remove(a.id), true);
  assert.equal(st.get(a.id), null);
  assert.equal(st.remove(a.id), false);
  assert.equal(st.list().length, 2);
});

test('storage full: nothing changes, and the error says so', () => {
  const mem = new Mem(), st = new DesignStore(mem);
  const a = st.create('a321neo').design;
  const before = mem.getItem(DESIGNS_KEY);
  mem.full = true;
  assert.deepEqual(st.create('b787-9'), { ok: false, error: 'quota' });
  assert.equal(st.save({ ...a, thrustScale: 2 }).ok, false);
  assert.equal(st.duplicate(a.id).error, 'quota');
  assert.equal(st.rename(a.id, 'Another name').error, 'quota');
  assert.equal(st.remove(a.id), false);
  assert.equal(mem.getItem(DESIGNS_KEY), before);
  assert.equal(st.list().length, 1);
});

test('no storage, broken JSON, junk entries: an empty or cleaned list, never a throw', () => {
  const none = new DesignStore(null);
  assert.deepEqual(none.list(), []);
  assert.equal(none.create('a321neo').ok, false);
  const blocked = new DesignStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.deepEqual(blocked.list(), []);
  assert.equal(blocked.save(newDesign('a321neo')).ok, false);
  const mem = new Mem();
  mem.m.set(DESIGNS_KEY, '{not json');
  assert.deepEqual(new DesignStore(mem).list(), []);
  const good = newDesign('b777-300er', { id: 'dgood' });
  mem.m.set(DESIGNS_KEY, JSON.stringify([null, 3, { base: 'concorde', id: 'x' }, { base: 'a321neo' }, good, { ...good, name: 'dupe id' }, { ...good, id: 'dbig', thrustScale: 50 }]));
  const l = new DesignStore(mem).list();
  assert.deepEqual(l.map((d) => d.id), ['dgood', 'dbig']);
  assert.equal(l[1].thrustScale, 3);
});
