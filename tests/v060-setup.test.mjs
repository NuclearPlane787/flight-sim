// v0.6.0 Part 4 (steps 1 and 5): the flight setup over eleven airports, the fuel rule over 120–970 nm, and the
// places named on the home page's ticket, the Load list and the logbook. With the region off, v0.5.8's strings.
//   node --test tests/v060-setup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setEastAsia } from '../src/world/region.js';
import { loadNodeRules, uninstallNodeRules } from './v060-rules-helpers.mjs';
import {
  fuelEstimate, regionTrip, REGION_FUEL, airportGroups, airportOption, airportShort, airportCountry,
  placeLabels, miniRegionFrame, MINI_LABEL,
} from '../src/ui/setup.js';
import { typeById } from '../src/sim/types.js';
import { standList } from '../src/ground/gate-flow.js';
import { flightCard, shortPlace, placeText } from '../src/ui/home-card.js';
import { whereText, flightFields } from '../src/scenarios.js';
import { logTimes, fmtLocal, placesText } from '../src/ui/logbook.js';
import { kstMs } from '../src/clock.js';

const ICAOS = ['RKSS', 'RKPC', 'RKSI', 'ZSPD', 'RJTT', 'RJAA', 'RKPK', 'ZSSS', 'RJBB', 'RJFF', 'ZSQD'];   // the manifest's order
const AIRPORTS = ICAOS.map((id) => JSON.parse(readFileSync(new URL(`../data/airports/${id}.json`, import.meta.url), 'utf8')));
const byIcao = (id) => AIRPORTS.find((a) => a.icao === id);
// main.js's lookup for the home page and the Load list
const place = (icao) => { const a = byIcao(icao); return a ? (a.shortName || shortPlace(a.name)) : null; };
setEastAsia(false);   // the flag-off tests below, whatever the shipped default
const withRegion = (fn) => { setEastAsia(true); loadNodeRules(); try { return fn(); } finally { uninstallNodeRules(); setEastAsia(false); } };

// ---- the lists ----

test('flag off: the list text is v0.5.8\'s', () => {
  assert.equal(airportOption(byIcao('RKSS')), 'RKSS · Seoul Gimpo International Airport');
  assert.equal(airportOption(byIcao('RKPC')), 'RKPC · Jeju International Airport');
});

test('flag on: eleven airports grouped Korea, Japan, China, each by its short name', () => withRegion(() => {
  const g = airportGroups(AIRPORTS);
  assert.deepEqual(g.map((x) => x.label), ['Korea', 'Japan', 'China']);
  assert.deepEqual(g.map((x) => x.airports.map((a) => a.icao)), [['RKSS', 'RKSI', 'RKPK', 'RKPC'], ['RJTT', 'RJAA', 'RJBB', 'RJFF'], ['ZSPD', 'ZSSS', 'ZSQD']]);
  const text = Object.fromEntries(AIRPORTS.map((a) => [a.icao, airportOption(a)]));
  assert.deepEqual(text, {
    RKSS: 'RKSS · Gimpo', RKPC: 'RKPC · Jeju', RKSI: 'RKSI · Incheon', ZSPD: 'ZSPD · Pudong', RJTT: 'RJTT · Haneda', RJAA: 'RJAA · Narita',
    RKPK: 'RKPK · Gimhae', ZSSS: 'ZSSS · Hongqiao', RJBB: 'RJBB · Kansai', RJFF: 'RJFF · Fukuoka', ZSQD: 'ZSQD · Qingdao',
  });
  // the country by the code's region, the same as the country raster says at each airport
  for (const a of AIRPORTS) assert.equal(airportCountry(a), { RK: 'KR', RJ: 'JP', ZS: 'CN' }[a.icao.slice(0, 2)]);
  // an airport the order doesn't know goes to the end of its country, by its code
  const extra = { icao: 'RKTN', name: 'Daegu International Airport', origin: [0, 0] };
  assert.deepEqual(airportGroups([...AIRPORTS, extra])[0].airports.map((a) => a.icao), ['RKSS', 'RKSI', 'RKPK', 'RKPC', 'RKTN']);
  assert.equal(airportShort(extra), 'Daegu');
}));

test('every airport has its runways, each end an ident and a threshold', () => {
  const ends = Object.fromEntries(AIRPORTS.map((a) => [a.icao, a.runways.flatMap((r) => r.ends.map((e) => e.ident))]));
  assert.equal(ends.ZSPD.length, 10);
  assert.equal(ends.RJTT.length, 8);
  for (const a of AIRPORTS) for (const r of a.runways) for (const e of r.ends) assert.ok(e.ident && Number.isFinite(e.x) && Number.isFinite(e.y), `${a.icao} ${e.ident}`);
});

test('the small map: the region fits, and no label covers another label or a dot', () => {
  const W = 300, H = 300;
  const { k, cx, cy } = miniRegionFrame(AIRPORTS, W, H);
  const dots = AIRPORTS.map((a) => [a.icao, W / 2 + (a.origin[0] - cx) * k, H / 2 - (a.origin[1] - cy) * k, a.icao]);
  for (const [id, x, y] of dots) assert.ok(x > 10 && x < W - 10 && y > 10 && y < H - 10, `${id} on the map at ${x.toFixed(0)}, ${y.toFixed(0)}`);
  // the close pairs are a few px apart at this scale
  const d = (p, q) => Math.hypot(dots.find((x) => x[0] === p)[1] - dots.find((x) => x[0] === q)[1], dots.find((x) => x[0] === p)[2] - dots.find((x) => x[0] === q)[2]);
  assert.ok(d('ZSPD', 'ZSSS') < 10 && d('RJTT', 'RJAA') < 12, `pairs ${d('ZSPD', 'ZSSS').toFixed(1)} px, ${d('RJTT', 'RJAA').toFixed(1)} px`);
  for (const order of [dots, [...dots].reverse()]) {
    const L = placeLabels(order, W, H, MINI_LABEL);
    for (let i = 0; i < L.length; i++) {
      const b = L[i].box;
      assert.ok(b[0] >= 0 && b[2] <= W && b[1] >= 0 && b[3] <= H, `${L[i].id} inside`);
      for (let j = 0; j < i; j++) {
        const c = L[j].box;
        assert.ok(!(b[0] < c[2] && b[2] > c[0] && b[1] < c[3] && b[3] > c[1]), `${L[i].id}'s label over ${L[j].id}'s`);
      }
      for (const [id, x, y] of order) {
        const r = MINI_LABEL.dotR;
        assert.ok(!(x + r > b[0] && x - r < b[2] && y + r > b[1] && y - r < b[3]), `${L[i].id}'s label over ${id}'s dot`);
      }
    }
  }
});

test('the stand lists at the big airports: hundreds, so the setup filters them (more than 60)', () => {
  const n = (id, t) => standList(byIcao(id), typeById(t)).length;
  for (const id of ['ZSPD', 'RJAA', 'ZSQD']) assert.ok(n(id, 'a321neo') > 60, `${id} ${n(id, 'a321neo')}`);
  assert.ok(n('ZSPD', 'a321neo') > 600 && n('ZSPD', 'b777-300er') > 300);
  // a code E stand list is the code E stands only
  for (const id of ['ZSPD', 'RJAA', 'ZSQD']) assert.ok(n(id, 'b777-300er') < n(id, 'a321neo'));
});

// ---- the fuel rule ----

// The sim's trips (kg) by tests/v060-fuel-sim.mjs (v0.6.0's sim, 2026-11-19): each type's take-off, climb, cruise at its
// Mach (A321neo M0.78, 787-9 M0.85, 777-300ER M0.84), idle descent and approach at the best level that fits, ISA, still
// air, at its setup's default load.
export const SIM_TRIP = {
  a321neo: { 120: 1046, 300: 2074, 480: 2925, 640: 3689, 960: 5263 },
  'b787-9': { 120: 2370, 300: 4723, 480: 6526, 640: 8112, 960: 11316 },
  'b777-300er': { 120: 3192, 300: 6135, 480: 8448, 640: 10518, 960: 14699 },
};
const oldTrip = (id, d) => { const f = typeById(id).fuel; return f.climbKg + f.perNm * d; };

test('flag off: the rule is v0.5.8\'s on every type and distance', () => {
  for (const id of Object.keys(SIM_TRIP)) for (const d of [0, 120, 243, 300, 480, 640, 960, 3000]) {
    const f = typeById(id).fuel, trip = oldTrip(id, d);
    assert.deepEqual(fuelEstimate(d, id), { trip: Math.round(trip), total: Math.ceil((trip * 1.05 + f.holdKg + f.taxiKg) / 100) * 100 });
  }
});

test('flag on: the trip within 2 % of the sim at 120, 300, 480, 640 and 960 nm on each type (v0.5.8\'s was 30 to 120 % over)', () => withRegion(() => {
  for (const [id, row] of Object.entries(SIM_TRIP)) for (const [d, sim] of Object.entries(row)) {
    const e = fuelEstimate(Number(d), id), err = e.trip / sim - 1;
    assert.ok(Math.abs(err) < 0.02, `${id} ${d} nm: rule ${e.trip} kg, sim ${sim} kg (${(err * 100).toFixed(1)} %)`);
    assert.ok(oldTrip(id, Number(d)) / sim - 1 > 0.25, 'the old rule was well over the sim here');
    const f = typeById(id).fuel;
    assert.equal(e.total, Math.ceil((e.trip * 1.05 + f.holdKg + f.taxiKg) / 100) * 100);
    assert.equal(e.trip, Math.round(regionTrip(Number(d), id)));
  }
  // smooth and rising
  for (const id of Object.keys(REGION_FUEL)) for (let d = 10; d < 1000; d += 10) assert.ok(regionTrip(d, id) > regionTrip(d - 10, id));
  // a type the region's table doesn't have keeps its own line
  const BIG = { ...typeById('a321neo'), id: 'big', fuel: { climbKg: 3000, perNm: 20, holdKg: 3500, taxiKg: 500 } };
  assert.deepEqual(fuelEstimate(100, BIG), { trip: 5000, total: Math.ceil((5000 * 1.05 + 4000) / 100) * 100 });
  // a design scales with its per-nm against its base's
  const D = { ...typeById('b787-9'), fuel: { ...typeById('b787-9').fuel, perNm: typeById('b787-9').fuel.perNm * 1.2 } };
  assert.ok(Math.abs(regionTrip(500, D) / regionTrip(500, 'b787-9') - 1.2) < 1e-12);
}));

test('the A321neo carries enough for Hongqiao–Haneda (960 nm) with a full cabin, inside MTOW, MZFW and the tanks', () => withRegion(() => {
  const T = typeById('a321neo'), L = T.limits;
  const zfw = L.OEW + L.PAX_MAX * L.PAX_KG + T.defaults.cargoKg;
  const fuel = fuelEstimate(960, T).total;
  assert.ok(zfw <= L.MZFW, `ZFW ${zfw}`);
  assert.ok(fuel <= L.FUEL_MAX, `fuel ${fuel}`);
  assert.ok(zfw + fuel <= L.MTOW, `TOW ${zfw + fuel}`);
  assert.ok(zfw + fuel - fuelEstimate(960, T).trip <= L.MLW, 'and lands under MLW');
}));

// ---- the names ----

const entry = (summary) => ({ id: 's1', name: 'East', type: 'a321neo', summary });
const saved = (facts, route) => ({ route, where: whereText({ ...facts, destIcao: facts.dest }), ...flightFields(facts) });

test('flag on: the ticket names the new airports ("En route to Haneda", "At Pudong, stand 112"), its stats too', () => withRegion(() => {
  const air = flightCard(entry(saved({ onGround: false, altFt: 37000, distNm: 412, origin: 'RKSS', dest: 'RJTT' }, 'RKSS–RJTT')), { place });
  assert.equal(air.title, 'En route to Haneda');
  assert.deepEqual(air.stats, [{ value: 'FL370', label: 'Flight level' }, { value: '412 nm', label: 'Remaining' }]);
  const park = flightCard(entry(saved({ onGround: true, phase: 'parked', icao: 'ZSPD', stand: '112', origin: 'RKSS', dest: 'ZSPD', landed: true }, 'RKSS–ZSPD')), { place });
  assert.equal(park.title, 'At Pudong, stand 112');
  assert.deepEqual(park.stats, [{ value: 'Gimpo', label: 'From' }, { value: 'Pudong', label: 'To' }]);
  const fresh = flightCard(entry({ route: 'ZSSS–RJTT', where: 'Not flown yet' }), { place });
  assert.equal(fresh.title, 'Hongqiao to Haneda');
  assert.deepEqual(fresh.stats.map((s) => s.value), ['Hongqiao', 'Haneda']);
  for (const id of ['RJAA', 'RJBB', 'RJFF', 'RKPK', 'ZSQD']) assert.equal(flightCard(entry(saved({ onGround: true, phase: 'taxi', icao: id, origin: id, dest: 'RKSS' }, `${id}–RKSS`)), { place }).title, `Taxiing at ${place(id)}`);
  // the Load list's text
  assert.equal(placeText(whereText({ onGround: true, phase: 'parked', icao: 'ZSPD', stand: '112' }), place), 'Parked at Pudong stand 112');
  assert.equal(placeText(whereText({ onGround: false, altFt: 37000, distNm: 412, destIcao: 'RJTT' }), place), 'FL370, 412 nm to Haneda');
  assert.equal(placeText('Pushing back at RKSS', place), 'Pushing back at Gimpo');
  assert.equal(placeText('On the runway at XXXX', place), 'On the runway at XXXX');
}));

test('flag off: the ticket\'s stats and the Load list\'s text as v0.5.8 (codes)', () => {
  const park = flightCard(entry(saved({ onGround: true, phase: 'parked', icao: 'RKPC', stand: '12', origin: 'RKSS', dest: 'RKPC' }, 'RKSS–RKPC')), { place });
  assert.equal(park.title, 'At Jeju, stand 12');
  assert.deepEqual(park.stats, [{ value: 'RKSS', label: 'From' }, { value: 'RKPC', label: 'To' }]);
  assert.equal(placeText('Parked at RKPC stand 12', place), 'Parked at RKPC stand 12');
});

test('the logbook: a Gimpo–Pudong flight in each end\'s zone and names; old entries as KST; nothing new with the flag off', () => {
  const dep = kstMs(2026, 11, 19, 15, 0), air = 2 * 3600 + 5 * 60;
  const args = { clockMs: dep + (air + 40) * 1000, speed: 1, nowT: 1000 + air + 40, touchdownT: 1000 + air, liftoffT: 1000, origin: byIcao('RKSS'), dest: byIcao('ZSPD') };
  assert.deepEqual(logTimes(args), {});
  withRegion(() => {
    const t = logTimes(args);
    assert.deepEqual(t, { local: { dep, depZone: 'Asia/Seoul', depName: 'KST', arr: dep + air * 1000, arrZone: 'Asia/Shanghai', arrName: 'CST' }, places: { origin: 'Gimpo', dest: 'Pudong' } });
    const e = { date: new Date(dep + air * 1000 + 40e3).toISOString(), route: 'RKSS–ZSPD', ...t };
    assert.deepEqual(fmtLocal(e), { day: 'Thu 19 Nov 2026', time: '15:00 KST → 16:05 CST' });
    assert.equal(placesText(e), 'Gimpo → Pudong');
    // an old entry: its date read back as KST
    assert.deepEqual(fmtLocal({ date: '2026-11-01T05:05:00.000Z', route: 'RKSS–RKPC' }), { day: 'Sun 1 Nov 2026', time: '14:05 KST' });
    assert.equal(placesText({ route: 'RKSS–RKPC' }), '');
    // stopped clock: no time passes back from now
    const st = logTimes({ ...args, speed: 0 });
    assert.equal(st.local.arr, st.local.dep);
    // no lift-off (a final start): the arrival only
    assert.deepEqual(fmtLocal({ local: logTimes({ ...args, liftoffT: null }).local }), { day: 'Thu 19 Nov 2026', time: '16:05 CST' });
  });
});
