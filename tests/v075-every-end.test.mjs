// v0.7.5, part 5 (Shane, 2026-11-22, of Barcelona's 20 missing from the map's Change the route: "I can't select all the
// runways for landing ... Check all the airports in all the regions"): every runway end of every airport, in both
// regions, is offered for a take-off and for a landing. The AIP's one-way use (runways.js ONE_WAY) orders the lists
// and adds a note; it hides nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ONE_WAY, runwayUse, runwayUseNote, useRank, aipLands, aipTakesOff, createAirports, circlingOnly } from '../src/world/runways.js';
import { runwayEndList } from '../src/ui/setup.js';

const dir = (f) => new URL('../data/' + f, import.meta.url);
const load = (folder) => {
  const m = JSON.parse(readFileSync(dir(folder + 'manifest.json'), 'utf8'));
  return [...(m.airports || []), ...(m.airportsRegion || []), ...(m.airportsPending || [])].map((f) => JSON.parse(readFileSync(dir(folder + f), 'utf8')));
};
const ALL = [...load(''), ...load('europe/')];
const endsOf = (a) => a.runways.flatMap((r) => r.ends.map((e) => String(e.ident)));

test('every end of every airport is in both lists, once, the AIP\'s own ends first', () => {
  assert.ok(ALL.length >= 60, `${ALL.length} airports`);
  let n = 0;
  for (const a of ALL) for (const what of ['dep', 'arr']) {
    const list = runwayEndList(a, what), ids = list.map(([i]) => String(i));
    assert.deepEqual([...ids].sort(), endsOf(a).sort(), `${a.icao} ${what}`);
    const ranks = ids.map((i) => useRank(a.icao, i, what));
    assert.deepEqual(ranks, [...ranks].sort(), `${a.icao} ${what}: the order`);
    if (what === 'arr') assert.ok(!circlingOnly(a.icao, ids[0]), `${a.icao}: the default arrival has a straight-in final`);
    assert.equal(ranks[0], 0, `${a.icao} ${what}: the default is an end the AIP uses that way`);
    n += ids.length;
  }
  assert.ok(n >= 2 * 264);
});

// The Cowork session's check of 2026-11-22: the ends v0.7.0 to v0.7.4 hid.
const LANDINGS = [['EDDF', '18'], ['EDDF', '36'], ['LEMD', '14L'], ['LEMD', '14R'], ['LEMD', '36L'], ['LEMD', '36R'], ['LEBL', '20'], ['EHAM', '36L'], ['EHAM', '18L'], ['EDDH', '33']];
const TAKEOFFS = [['EDDF', '07L'], ['EDDF', '25R'], ['EDDF', '36'], ['LEMD', '32L'], ['LEMD', '32R'], ['LEMD', '18L'], ['LEMD', '18R'], ['EHAM', '18R'], ['EHAM', '36R'], ['EDDH', '15']];
test('the ten landings and the ten take-offs that were hidden are offered, last, with the AIP\'s note', () => {
  const by = Object.fromEntries(ALL.map((a) => [a.icao, a]));
  for (const [what, set, was] of [['arr', LANDINGS, aipLands], ['dep', TAKEOFFS, aipTakesOff]]) for (const [icao, ident] of set) {
    assert.equal(was(icao, ident), false, `${icao} ${ident}: the AIP doesn't use it for this`);
    const list = runwayEndList(by[icao], what), k = list.findIndex(([i]) => String(i) === ident);
    assert.ok(k >= 0, `${icao} ${ident} is offered (${what})`);
    assert.match(list[k][1], / in the AIP\)$/, list[k][1]);
    assert.equal(useRank(icao, ident, what), 2);
    for (let j = k + 1; j < list.length; j++) assert.equal(useRank(icao, list[j][0], what), 2, `${icao}: only such ends after ${ident}`);
  }
  // and these are all there are: every end the table marks one-way or unused is in one list or the other
  const marked = Object.entries(ONE_WAY).flatMap(([icao, t]) => Object.entries(t).filter(([, u]) => u !== 'standby').map(([id]) => `${icao} ${id}`)).sort();
  assert.deepEqual([...new Set([...LANDINGS, ...TAKEOFFS].map(([a, b]) => `${a} ${b}`))].sort(), marked);
});

test('a circling-only end comes after the straight-in ones in the arrival list only: Itami, Gimhae, Wonsan, Innsbruck', () => {
  const by = Object.fromEntries(ALL.map((a) => [a.icao, a])), ids = (i, w) => runwayEndList(by[i], w).map(([x]) => String(x));
  assert.deepEqual(ids('RJOO', 'arr'), ['32L', '32R', '14R', '14L']); assert.deepEqual(ids('RJOO', 'dep'), ['14R', '32L', '14L', '32R']);
  assert.deepEqual(ids('RKPK', 'arr'), ['36R', '36L', '18L', '18R']); assert.deepEqual(ids('RKPK', 'dep'), ['18L', '36R', '18R', '36L']);
  assert.deepEqual(ids('ZKWS', 'arr'), ['15R', '15L', '33L', '33R']); assert.deepEqual(ids('LOWI', 'arr'), ['26', '08']);
  assert.match(runwayEndList(by.RJOO, 'arr')[2][1], /circling only\)$/);
});

test('the notes read as the AIP\'s use, and Barcelona\'s 20 is in the landing list', () => {
  assert.equal(runwayUseNote('LEBL', '20'), 'take-offs only in the AIP');
  const lebl = ALL.find((a) => a.icao === 'LEBL');
  assert.ok(runwayEndList(lebl, 'arr').some(([i, t]) => String(i) === '20' && /^RWY 20 {2}\([\d.]+°, [\d,]+ m, take-offs only in the AIP\)$/.test(t)), JSON.stringify(runwayEndList(lebl, 'arr')));
  assert.equal(runwayEndList(lebl, 'arr').at(-1)[0], '20');
});

test('createAirports keeps each file\'s ILS: no end the AIP only takes off from has one, so none appears', () => {
  for (const folder of ['', 'europe/']) {
    const list = load(folder); createAirports(list);
    for (const a of list) for (const r of a.runways) for (const e of r.ends) {
      const u = runwayUse(a.icao, e.ident);
      assert.equal(e.use ?? null, u, `${a.icao} ${e.ident}`);
      if (u === 'takeoff' || u === 'closed') assert.equal(e.ils ?? null, null, `${a.icao} ${e.ident}: the file has no ILS, and the game invents no category`);
    }
  }
});

test('East Asia: no end is one-way; Cheongju\'s air force runway is a standby, after the civil one in both lists', () => {
  for (const a of load('')) for (const id of endsOf(a)) assert.equal(runwayUse(a.icao, id), a.icao === 'RKTU' && ['06R', '24L'].includes(id) ? 'standby' : null, `${a.icao} ${id}`);
  const rktu = load('').find((a) => a.icao === 'RKTU');
  for (const what of ['dep', 'arr']) assert.deepEqual(runwayEndList(rktu, what).map(([i]) => i), ['06L', '24R', '06R', '24L']);
  assert.match(runwayEndList(rktu, 'arr')[2][1], /standby\)$/);
});
