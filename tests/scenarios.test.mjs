// The scenario store (src/scenarios.js): slots, names, refused writes, the
// migration from v0.1.4, and the menu's texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ScenarioStore, INDEX_KEY, SCEN_PREFIX, LASTFLIGHT_KEY, LOGBOOK_KEY, NAME_MIN, NAME_MAX,
  cleanName, nameOk, migrate, legacyId, whereText, savedText, afternoonKst, newId, DEFAULT_PLAN, typeName, copyName,
} from '../src/scenarios.js';

// A Storage-like Map. `limit`: setItem throws (like QuotaExceededError) for values longer than it.
function mem(init = {}, limit = Infinity) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > limit) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
const T0 = Date.UTC(2026, 10, 1, 5, 0); // Sun 1 Nov 2026 14:00 KST
const state = (n = 0) => ({ v: 1, plan: { origin: 'RKSS' }, sim: { x: n } });

test('names: cleaned, 3 to 40 characters', () => {
  assert.equal(cleanName('  Test \t  A\n'), 'Test A');
  assert.equal(cleanName('x'.repeat(60)).length, NAME_MAX);
  assert.equal(nameOk('ab'), false);
  assert.equal(nameOk(' a  b '), true);
  assert.equal(NAME_MIN, 3);
});

test('ids are short, url-safe and unique', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(newId(T0));
  assert.equal(ids.size, 500);
  for (const id of ids) { assert.match(id, /^[0-9a-z]+$/); assert.ok(id.length <= 14); }
});

test('create, get, write, list newest first', () => {
  const s = new ScenarioStore(mem());
  assert.deepEqual(s.list(), []);
  assert.equal(s.newest(), null);
  const a = s.create('Test A', state(1), { route: 'RKSS 14R → RKPC 07', where: 'On the runway at RKSS' }, { now: T0 });
  assert.equal(a.ok, true);
  assert.equal(a.entry.name, 'Test A');
  const b = s.create('  Test   B ', state(2), {}, { now: T0 + 1000 });
  assert.equal(b.entry.name, 'Test B');
  assert.notEqual(a.id, b.id);
  assert.deepEqual(s.list().map((e) => e.name), ['Test B', 'Test A']);
  const rec = s.get(a.id);
  assert.deepEqual(rec, { v: 1, id: a.id, name: 'Test A', savedAt: T0, state: state(1) });
  assert.equal(s.get('nope'), null);

  assert.deepEqual(s.write(a.id, state(3), { where: 'FL350, 120 nm to RKPC' }, T0 + 5000), { ok: true });
  assert.deepEqual(s.list().map((e) => e.name), ['Test A', 'Test B']);
  assert.equal(s.newest().id, a.id);
  assert.deepEqual(s.get(a.id).state, state(3));
  assert.deepEqual(s.newest().summary, { route: 'RKSS 14R → RKPC 07', where: 'FL350, 120 nm to RKPC' });
  assert.equal(s.newest().created, T0);
  assert.deepEqual(s.write('nope', state(), {}), { ok: false, error: 'missing' });
  assert.deepEqual(s.create('ab', state()), { ok: false, error: 'name' });
  assert.ok(s.approxBytes() > 100);
});

test('duplicate names are allowed; defaultName is the lowest free N', () => {
  const s = new ScenarioStore(mem());
  assert.equal(s.defaultName(), 'Scenario 1');
  s.create('Scenario 1', state()); s.create('Scenario 3', state());
  assert.equal(s.defaultName(), 'Scenario 2');
  s.create('Scenario 2', state());
  assert.equal(s.defaultName(), 'Scenario 4');
  assert.equal(s.create('Scenario 1', state()).ok, true);
  assert.equal(s.list().filter((e) => e.name === 'Scenario 1').length, 2);
});

test('rename: good and bad names; order kept', () => {
  const s = new ScenarioStore(mem());
  const a = s.create('Alpha', state(), {}, { now: T0 });
  s.create('Bravo', state(), {}, { now: T0 + 1 });
  assert.deepEqual(s.rename(a.id, '  Charlie  '), { ok: true });
  assert.equal(s.entry(a.id).name, 'Charlie');
  assert.equal(s.get(a.id).name, 'Charlie');
  assert.equal(s.entry(a.id).savedAt, T0);
  assert.deepEqual(s.list().map((e) => e.name), ['Bravo', 'Charlie']);
  assert.deepEqual(s.rename(a.id, ' x '), { ok: false, error: 'name' });
  assert.deepEqual(s.rename(a.id, '\u0001\u0002'), { ok: false, error: 'name' });
  assert.equal(s.entry(a.id).name, 'Charlie');
  assert.deepEqual(s.rename('nope', 'Delta'), { ok: false, error: 'missing' });
});

test('remove', () => {
  const st = mem(), s = new ScenarioStore(st);
  const a = s.create('Alpha', state()), b = s.create('Bravo', state());
  assert.equal(s.remove(a.id), true);
  assert.equal(st.getItem(SCEN_PREFIX + a.id), null);
  assert.deepEqual(s.list().map((e) => e.id), [b.id]);
  assert.equal(s.remove(a.id), false);
});

// v0.3.2: Duplicate (Shane: "I've found that I want to test various from certain points").
test('copyName: (copy), then (copy 2), (copy 3); a copy of a copy counts on; long names fit', () => {
  assert.equal(copyName('Test'), 'Test (copy)');
  assert.equal(copyName('Test', new Set(['Test (copy)'])), 'Test (copy 2)');
  assert.equal(copyName('Test (copy)', new Set(['Test (copy)'])), 'Test (copy 2)');
  assert.equal(copyName('Test (copy 2)', new Set(['Test (copy)', 'Test (copy 2)'])), 'Test (copy 3)');
  const long = 'x'.repeat(NAME_MAX);
  const c = copyName(long);
  assert.equal(c.length, NAME_MAX);
  assert.ok(c.endsWith(' (copy)'));
  assert.ok(nameOk(copyName('abc')));
});

test('duplicate: the same state, summary and type under a new id, at the top; the original untouched', () => {
  const st = mem(), s = new ScenarioStore(st);
  const a = s.create('FL410 point', { ...state(7), plan: { origin: 'RKSS', type: 'b777-300er' } }, { route: 'RKSS 14R → RKPC 07', where: 'FL410, 100 nm to RKPC' }, { now: T0 });
  const b = s.create('Other', state(2), {}, { now: T0 + 1000 });
  const recA0 = st.getItem(SCEN_PREFIX + a.id), idxA0 = JSON.stringify(s.entry(a.id));
  const d = s.duplicate(a.id, { now: T0 + 5000 });
  assert.equal(d.ok, true);
  assert.notEqual(d.id, a.id);
  assert.equal(d.entry.name, 'FL410 point (copy)');
  assert.equal(d.entry.type, 'b777-300er');
  assert.deepEqual(d.entry.summary, { route: 'RKSS 14R → RKPC 07', where: 'FL410, 100 nm to RKPC' });
  assert.equal(d.entry.legacy, undefined);
  assert.deepEqual(s.get(d.id).state, s.get(a.id).state);
  assert.deepEqual(s.list().map((e) => e.name), ['FL410 point (copy)', 'Other', 'FL410 point']);
  assert.equal(st.getItem(SCEN_PREFIX + a.id), recA0, 'the original record untouched');
  assert.equal(JSON.stringify(s.entry(a.id)), idxA0, 'the original entry untouched');
  // Saving the copy leaves the original as it was, and the other way round.
  s.write(d.id, state(99), {}, T0 + 6000);
  assert.deepEqual(s.get(a.id).state.sim, { x: 7 });
  assert.deepEqual(s.get(d.id).state, state(99));
  // Again: (copy 2); a copy of the copy too.
  assert.equal(s.duplicate(a.id, { now: T0 + 7000 }).entry.name, 'FL410 point (copy 2)');
  assert.equal(s.duplicate(d.id, { now: T0 + 8000 }).entry.name, 'FL410 point (copy 3)');
  assert.equal(s.duplicate(b.id, { name: 'Named', now: T0 + 9000 }).entry.name, 'Named');
  assert.deepEqual(s.duplicate('nope'), { ok: false, error: 'missing' });
});

test('duplicate: the legacy Scenario 1 makes an ordinary copy; a full storage makes none and changes nothing', () => {
  const st = mem({ [LASTFLIGHT_KEY]: JSON.stringify({ ...DEFAULT_PLAN }) }), s = new ScenarioStore(st);
  const leg = migrate(st, T0);
  const d = s.duplicate(leg.id, { now: T0 + 1 });
  assert.equal(d.ok, true);
  assert.equal(d.entry.legacy, undefined);
  assert.equal(legacyId(s.list()), leg.id);
  // The copy's record fits (it's the original's size), but not the index with two long entries.
  const full = mem({}, 600), f = new ScenarioStore(full);
  const a = f.create('Alpha', state(), { where: 'w'.repeat(250) }, { now: T0 });
  assert.equal(a.ok, true);
  const before = [...full.m.entries()];
  assert.deepEqual(f.duplicate(a.id, { now: T0 + 1 }), { ok: false, error: 'quota' });
  assert.deepEqual([...full.m.entries()], before, 'nothing changed');
});

test('a refused write leaves the index and the previous record as they were', () => {
  const st = mem({}, 400), s = new ScenarioStore(st);
  const a = s.create('Alpha', state(1), {}, { now: T0 });
  assert.equal(a.ok, true);
  const idx0 = st.getItem(INDEX_KEY), rec0 = st.getItem(SCEN_PREFIX + a.id);
  const big = { ...state(), blob: 'x'.repeat(1000) };
  assert.deepEqual(s.write(a.id, big, {}, T0 + 9), { ok: false, error: 'quota' });
  assert.equal(st.getItem(INDEX_KEY), idx0);
  assert.equal(st.getItem(SCEN_PREFIX + a.id), rec0);
  assert.deepEqual(s.create('Bravo', big), { ok: false, error: 'quota' });
  assert.equal(st.getItem(INDEX_KEY), idx0);
  assert.equal(st.m.size, 2);
});

test('the record is put back when the index write is refused', () => {
  // The record fits; the index (with a long summary) doesn't.
  const st = mem({}, 300), s = new ScenarioStore(st);
  const a = s.create('Alpha', state(1), {}, { now: T0 });
  const idx0 = st.getItem(INDEX_KEY), rec0 = st.getItem(SCEN_PREFIX + a.id);
  assert.deepEqual(s.write(a.id, state(2), { where: 'w'.repeat(250) }, T0 + 9), { ok: false, error: 'quota' });
  assert.equal(st.getItem(INDEX_KEY), idx0);
  assert.equal(st.getItem(SCEN_PREFIX + a.id), rec0);
  assert.deepEqual(s.create('Bravo', state(), { route: 'r'.repeat(250) }), { ok: false, error: 'quota' });
  assert.equal(st.m.size, 2);
});

test('storage that throws on every access: nothing breaks', () => {
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const s = new ScenarioStore(bad);
  assert.deepEqual(s.list(), []);
  assert.equal(s.get('x'), null);
  assert.equal(s.create('Alpha', state()).error, 'quota');
  assert.equal(s.migrate(T0), null);
  assert.equal(s.approxBytes(), 0);
});

// v0.1.4's keys as Shane's browser holds them.
const LAST = JSON.stringify({ origin: 'RKSS', depRunway: '32L', dest: 'RKSI', arrRunway: '33R', start: 'gate', stand: '7', pax: 180, cargoKg: 1200, fuelKg: 5000, waypoints: [], payloadKg: 18300 });
const LOG = JSON.stringify([{ date: '2026-10-31T09:12:00.000Z', origin: 'RKSS', dest: 'RKSI', score: 0 }, { date: '2026-11-01T01:00:00.000Z', origin: 'RKSI', dest: 'RKPC', score: 80 }]);
const SETTINGS = JSON.stringify({ volume: 0.6, callouts: true });

test('migration from v0.1.4: lastflight + logbook become Scenario 1, old keys untouched', () => {
  const st = mem({ [LASTFLIGHT_KEY]: LAST, [LOGBOOK_KEY]: LOG, 'gamedump:flight-sim:settings': SETTINGS });
  const e = migrate(st, T0);
  assert.equal(e.name, 'Scenario 1');
  assert.equal(e.legacy, true);
  assert.equal(e.summary.route, 'RKSS 32L → RKSI 33R');
  assert.equal(e.summary.where, 'Parked at RKSS stand 7');
  const s = new ScenarioStore(st);
  assert.equal(legacyId(s.list()), e.id);
  const rec = s.get(e.id);
  assert.deepEqual(rec.state.plan, JSON.parse(LAST));
  assert.equal(rec.state.fresh, true);
  assert.equal(rec.state.v, 1);
  assert.deepEqual(rec.state.clock, { ms: Date.UTC(2026, 10, 1, 6, 0), running: true, speed: 1 });
  // Byte for byte.
  assert.equal(st.getItem(LASTFLIGHT_KEY), LAST);
  assert.equal(st.getItem(LOGBOOK_KEY), LOG);
  assert.equal(st.getItem('gamedump:flight-sim:settings'), SETTINGS);
});

test('migration with only a logbook: Scenario 1 with the default plan', () => {
  const st = mem({ [LOGBOOK_KEY]: LOG });
  const e = migrate(st, T0);
  assert.equal(e.name, 'Scenario 1');
  assert.equal(e.legacy, true);
  assert.deepEqual(new ScenarioStore(st).get(e.id).state.plan, DEFAULT_PLAN);
  assert.equal(e.summary.where, 'On the runway at RKSS');
  assert.equal(st.getItem(LOGBOOK_KEY), LOG);
  assert.equal(st.getItem(LASTFLIGHT_KEY), null);
});

test('migration runs once only, even after Scenario 1 is deleted', () => {
  const st = mem({ [LASTFLIGHT_KEY]: LAST, [LOGBOOK_KEY]: LOG });
  const s = new ScenarioStore(st);
  const e = s.migrate(T0);
  assert.ok(e);
  assert.equal(s.migrate(T0), null);
  assert.equal(s.list().length, 1);
  s.remove(e.id);
  assert.equal(s.migrate(T0), null);
  assert.deepEqual(s.list(), []);
  assert.equal(legacyId(s.list()), null);
  assert.equal(st.getItem(LOGBOOK_KEY), LOG);
});

test('first run with nothing: no scenario, but the index is written', () => {
  const st = mem();
  assert.equal(migrate(st, T0), null);
  assert.equal(st.getItem(INDEX_KEY), '[]');
  st.setItem(LASTFLIGHT_KEY, LAST); // a v0.2.0 flight later: no migration
  assert.equal(migrate(st, T0), null);
});

test('afternoon KST across the date line', () => {
  assert.equal(afternoonKst(Date.UTC(2026, 9, 31, 16, 0)), Date.UTC(2026, 10, 1, 6)); // 01:00 KST on 1 Nov
  assert.equal(afternoonKst(Date.UTC(2026, 9, 31, 14, 59)), Date.UTC(2026, 9, 31, 6)); // 23:59 KST on 31 Oct
});

test('whereText', () => {
  assert.equal(whereText({ onGround: false, altFt: 34960, distNm: 120.4, destIcao: 'RKPC' }), 'FL350, 120 nm to RKPC');
  assert.equal(whereText({ onGround: false, altFt: 18000, distNm: 60.6, destIcao: 'RKPC' }), 'FL180, 61 nm to RKPC');
  assert.equal(whereText({ onGround: false, altFt: 17990, distNm: 50, destIcao: 'RKPC' }), '18,000 ft, 50 nm to RKPC');
  assert.equal(whereText({ onGround: false, altFt: 4480, distNm: 30.2, destIcao: 'RKPC' }), '4,500 ft, 30 nm to RKPC');
  assert.equal(whereText({ onGround: false, altFt: 420, distNm: 1.4, destIcao: 'RKSI' }), '400 ft, 1 nm to RKSI');
  assert.equal(whereText({ onGround: true, phase: 'parked', icao: 'RKPC', stand: '12' }), 'Parked at RKPC stand 12');
  assert.equal(whereText({ onGround: true, phase: 'arrived', icao: 'RKPC', stand: 12 }), 'Parked at RKPC stand 12');
  assert.equal(whereText({ onGround: true, phase: 'arrived', icao: 'RKPC' }), 'Parked at RKPC');
  assert.equal(whereText({ onGround: true, phase: 'taxi', icao: 'RKSS' }), 'Taxiing at RKSS');
  assert.equal(whereText({ onGround: true, phase: 'taxi-in', icao: 'RKPC' }), 'Taxiing at RKPC');
  assert.equal(whereText({ onGround: true, phase: 'pushback', icao: 'RKSS' }), 'Pushing back at RKSS');
  assert.equal(whereText({ onGround: true, phase: 'none', icao: 'RKSS' }), 'On the runway at RKSS');
  assert.equal(whereText({ onGround: true, phase: 'departed', icao: 'RKPC' }), 'On the runway at RKPC');
});

test('savedText', () => {
  const now = new Date(2026, 10, 1, 14, 5).getTime();
  assert.equal(savedText(now - 20e3, now), 'just now');
  assert.equal(savedText(now - 5 * 60e3 - 10e3, now), '5 min ago');
  assert.equal(savedText(now - 59 * 60e3, now), '59 min ago');
  assert.equal(savedText(new Date(2026, 10, 1, 12, 7).getTime(), now), 'Sun 1 Nov 12:07');
  assert.equal(savedText(new Date(2026, 9, 31, 9, 0).getTime(), now), 'Sat 31 Oct 09:00');
  assert.equal(savedText(undefined, now), '—');
});

// ---- The aircraft type (v0.3.0) ----

test('type: a scenario round-trips its type, from the summary or the plan', () => {
  const s = new ScenarioStore(mem());
  const a = s.create('Boeing', { v: 1, plan: { origin: 'RKSS' } }, { route: 'r', where: 'w', type: 'b789' }, { now: T0 });
  assert.equal(a.entry.type, 'b789');
  assert.deepEqual(a.entry.summary, { route: 'r', where: 'w' }, 'the type is the entry\'s, not the summary\'s');
  const b = s.create('From plan', { v: 1, fresh: true, plan: { origin: 'RKSS', type: 'b77w' } }, {}, { now: T0 + 1 });
  assert.equal(s.entry(b.id).type, 'b77w');
  const c = s.create('No type', state(1), {}, { now: T0 + 2 });
  assert.equal(s.entry(c.id).type, 'a321neo');
  // A save keeps the type, whether or not it says so; a new store reads the same.
  assert.equal(s.write(a.id, { v: 1, plan: {} }, { route: 'r2' }, T0 + 3).ok, true);
  assert.equal(s.entry(a.id).type, 'b789');
  assert.equal(s.write(a.id, { v: 1, plan: { type: 'b789' } }, undefined, T0 + 4).ok, true);
  assert.equal(s.entry(a.id).type, 'b789');
  assert.equal(s.rename(a.id, 'Renamed').ok, true);
  assert.equal(new ScenarioStore(s.s).entry(a.id).type, 'b789');
  assert.equal(s.get(b.id).state.plan.type, 'b77w');
});

test('type: a v0.2.2 save, with no type anywhere, reads as the A321neo and keeps working', () => {
  const id = 'old1';
  const old = mem({
    [INDEX_KEY]: JSON.stringify([{ id, name: 'Old flight', created: T0, savedAt: T0, summary: { route: 'RKSS–RKPC', where: 'FL350' } }]),
    [SCEN_PREFIX + id]: JSON.stringify({ v: 1, id, name: 'Old flight', savedAt: T0, state: { v: 1, plan: { origin: 'RKSS' }, sim: { x: 1 } } }),
  });
  const s = new ScenarioStore(old);
  assert.equal(s.entry(id).type, 'a321neo');
  assert.equal(s.list()[0].type, 'a321neo');
  assert.equal(s.newest().type, 'a321neo');
  assert.equal(s.write(id, { v: 1, plan: { origin: 'RKSS' }, sim: { x: 2 } }, { route: 'RKSS–RKPC', where: 'FL350' }, T0 + 1).ok, true);
  assert.equal(s.entry(id).type, 'a321neo');
  assert.equal(s.get(id).state.sim.x, 2);
});

test('type: the migrated Scenario 1 is the A321neo', () => {
  const s = new ScenarioStore(mem({ [LASTFLIGHT_KEY]: JSON.stringify(DEFAULT_PLAN) }));
  assert.equal(s.migrate(T0).type, 'a321neo');
});

test('type: names for the screens', () => {
  assert.equal(typeName('a321neo'), 'A321neo');
  assert.equal(typeName(undefined), 'A321neo');
  assert.equal(typeName(''), 'A321neo');
  assert.equal(typeName('b999'), 'b999', 'an unknown id is not given a wrong name');
});
