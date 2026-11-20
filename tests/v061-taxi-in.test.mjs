// v0.6.1: the taxi-in route after landing (gate-flow.js afterLanding, taxiInRule). Narita's from every runway
// end, Korea's three with the region on (they take the region's taxi-in rule since v0.6.1), and Korea's three
// with the region off, which must stay v0.5.8's to the millimetre (the table below was recorded from the code
// before v0.6.1's change, and matches v0.5.8's pushed gate-flow.js).
//   python3 tools/cpu-guard.py -- node --test tests/v061-taxi-in.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGateFlow, alongRunwayM, taxiInRule } from '../src/ground/gate-flow.js';
import { buildTaxiGraph } from '../src/ground/taxi.js';
import { setEastAsia, eastAsiaOn } from '../src/world/region.js';

const here = new URL('..', import.meta.url).pathname;
const load = (i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'));
const KT = 0.514444;
const FLAG0 = eastAsiaOn();
after(() => setEastAsia(FLAG0));

// The game's afterLanding() on runway end `e` (towards `o`) at `frac` of its length, rolling at `gs`.
function land(ap, e, o, frac, gs = 10) {
  const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
  const state = { onGround: true, gs, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
  const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
  return { r: gate.afterLanding(state), gate, state, ux, uy };
}
const ends = (ap) => ap.runways.flatMap((rw) => [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]]);
const FRACS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

// A route, its exit ahead of the aircraft, ending at the stand it names; returns the metres it runs along a
// runway after the exit and the landing runway's rectangle.
function checkRoute(ap, e, frac, { r, gate, state, ux, uy }) {
  const at = `${ap.icao} ${e.ident} from ${Math.round(frac * 100)} %`;
  assert.ok(r, `${at}: a route to a stand`);
  assert.equal(r.kind, 'in');
  const ahead = (r.points[1][0] - state.pos.x) * ux + (r.points[1][1] - state.pos.y) * uy;
  assert.ok(ahead > -15, `${at}: the exit ${ahead.toFixed(0)} m ahead`);
  // (Some of Incheon's refs name two positions: the one the route ends at.)
  const end = r.points[r.points.length - 1];
  const st = ap.stands.find((s) => s.ref === r.stand && Math.hypot(end[0] - s.x, end[1] - s.y) < 1);
  assert.ok(st && Math.hypot(r.standXY[0] - st.x, r.standXY[1] - st.y) < 1e-9, `${at}: ends at stand ${r.stand}`);
  // Sane in length: the taxi after the exit at most 4 times the straight line from the exit to the stand, plus a kilometre.
  const taxi = r.lengthM - Math.hypot(r.points[1][0] - state.pos.x, r.points[1][1] - state.pos.y);
  const straight = Math.hypot(st.x - r.exit[0], st.y - r.exit[1]);
  assert.ok(taxi < 4 * straight + 1000, `${at}: ${taxi.toFixed(0)} m of taxi for ${straight.toFixed(0)} m straight`);
  const g = gate.graphFor(ap.icao);
  return { along: alongRunwayM(g, r.points.slice(2)), rect: g.rects.find((q) => q.idents.includes(e.ident)), at };
}

test('Narita: a taxi-in route from 30 to 90 % of every runway end, its exit ahead, off the runway', () => {
  const ap = load('RJAA');
  let n = 0, worst = 0, where = '';
  for (const [e, o] of ends(ap)) for (const frac of FRACS) for (const gs of [4, 10, 15]) {
    const got = land(ap, e, o, frac, gs);
    const { along, rect, at } = checkRoute(ap, e, frac, got);
    if (along > worst) { worst = along; where = at; }
    // The landing runway isn't named as crossed: no route here comes back onto it (a rapid exit's turn-off isn't a crossing).
    assert.ok(!got.r.crossings.includes(rect.id), `${at}: "${got.r.text}"`);
    n++;
  }
  assert.equal(n, 4 * FRACS.length * 3);
  assert.ok(worst < 100, `the most along a runway after the exit: ${worst.toFixed(0)} m (${where})`);
});

test('Narita 34R: the rapid exit B4 is found (its last edge tagged with the runway ends 2 m past the pavement)', () => {
  const ap = load('RJAA'), rw = ap.runways.find((q) => q.ends.some((x) => x.ident === '34R'));
  const e = rw.ends.find((x) => x.ident === '34R'), o = rw.ends.find((x) => x.ident !== '34R');
  const { r } = land(ap, e, o, 0.5);
  assert.match(r.text, /via B4, /);
});

test('the taxi-in rule: the region\'s airports always, Korea\'s three only with the region on, graphs unmarked', () => {
  try {
    for (const on of [true, false]) {
      setEastAsia(on);
      for (const icao of ['RKSS', 'RKSI', 'RKPC']) {
        const ap = load(icao), g = buildTaxiGraph(ap);
        assert.ok(!g.region, `${icao}'s graph isn't a region graph`);
        assert.equal(taxiInRule(ap, g), on, `${icao} with the region ${on ? 'on' : 'off'}`);
      }
      const nrt = load('RJAA');
      assert.equal(taxiInRule(nrt, buildTaxiGraph(nrt)), true);
    }
  } finally { setEastAsia(FLAG0); }
});

test('Korea with the region on: a taxi-in route from 30 to 90 % of every runway end', () => {
  setEastAsia(true);
  try {
    let n = 0, worst = 0, where = '';
    for (const icao of ['RKSS', 'RKSI', 'RKPC']) {
      const ap = load(icao);
      for (const [e, o] of ends(ap)) for (const frac of FRACS) {
        const got = land(ap, e, o, frac);
        const { along, at } = checkRoute(ap, e, frac, got);
        // Jeju 13/31 has no exit between taxiway P and either end's turn pad: past them the only way is back
        // along the runway (the map's, and the airport's). Everywhere else under 200 m.
        const backtrack = icao === 'RKPC' && ((e.ident === '31' && frac >= 0.5) || (e.ident === '13' && frac >= 0.75));
        if (backtrack) { assert.ok(along < 1000, `${at}: ${along.toFixed(0)} m back along 13/31`); continue; }
        if (along > worst) { worst = along; where = at; }
        n++;
      }
    }
    assert.ok(n > 120, `${n} landings checked`);
    assert.ok(worst < 200, `the most along a runway after the exit: ${worst.toFixed(0)} m (${where})`);
  } finally { setEastAsia(FLAG0); }
});

// v0.5.8's results with the region off (and the same code path): [stand, route length m, exit x, exit y], or
// null for "No taxi route to a stand found". The A321neo, rolling at 10 m/s, no stands occupied.
const V058 = {
  'RKSS 14L 45': ['17', 957.215, -62583.400, 173252.400],
  'RKSS 14L 60': ['12', 1119.861, -62078.700, 172732.600],
  'RKSS 14L 75': ['1', 1322.983, -61520.000, 172177.300],
  'RKSS 32R 45': ['17', 1272.283, -62616.100, 173293.600],
  'RKSS 32R 60': ['34', 2280.597, -63175.644, 173875.584],
  'RKSS 32R 75': ['34', 1740.644, -63175.644, 173875.584],
  'RKSS 14R 45': ['17', 1913.389, -62583.139, 172743.080],
  'RKSS 14R 60': ['17', 1433.670, -62583.139, 172743.080],
  'RKSS 14R 75': null,
  'RKSS 32L 45': null,
  'RKSS 32L 60': null,
  'RKSS 32L 75': null,
  'RKSI 15L 45': ['262', 1439.960, -92690.700, 163484.500],
  'RKSI 15L 60': ['101', 2123.797, -92001.900, 162489.400],
  'RKSI 15L 75': ['101', 1561.965, -92001.900, 162489.400],
  'RKSI 33R 45': ['262', 1439.157, -92690.700, 163484.500],
  'RKSI 33R 60': ['262', 1774.908, -92915.800, 163915.300],
  'RKSI 33R 75': ['254', 3089.927, -93385.000, 164475.200],
  'RKSI 15R 45': ['262', 1029.811, -93034.200, 163245.200],
  'RKSI 15R 60': ['101', 941.312, -92702.200, 162875.500],
  'RKSI 15R 75': ['105', 1042.344, -92338.000, 162255.300],
  'RKSI 33L 45': ['262', 1021.507, -93034.200, 163245.200],
  'RKSI 33L 60': ['262', 1335.458, -93226.300, 163643.900],
  'RKSI 33L 75': ['253', 2696.404, -93724.400, 164239.300],
  'RKSI 16L 45': ['236R', 1146.862, -94670.400, 162110.600],
  'RKSI 16L 60': ['130', 1089.185, -94228.900, 161526.400],
  'RKSI 16L 75': ['131', 1092.794, -93928.800, 161153.800],
  'RKSI 34R 45': ['236R', 884.339, -94670.400, 162110.600],
  'RKSI 34R 60': ['233', 827.510, -94967.400, 162646.700],
  'RKSI 34R 75': ['214', 1105.724, -95309.600, 163147.400],
  'RKSI 16R 45': ['236R', 2116.889, -94871.800, 161660.000],
  'RKSI 16R 60': ['132', 2092.023, -94344.700, 160918.900],
  'RKSI 16R 75': ['132', 1529.903, -94344.700, 160918.900],
  'RKSI 34L 45': ['236R', 1593.860, -95077.800, 161969.100],
  'RKSI 34L 60': ['234', 1497.121, -95301.500, 162415.900],
  'RKSI 34L 75': ['214', 1886.341, -95724.800, 163226.900],
  'RKPC 07 45': ['3', 2207.159, -93407.900, -275197.200],
  'RKPC 07 60': ['3', 1730.993, -93407.900, -275197.200],
  'RKPC 07 75': ['3', 1254.827, -93407.900, -275197.200],
  'RKPC 25 45': ['18', 3904.563, -95659.100, -276540.400],
  'RKPC 25 60': ['18', 3428.397, -95659.100, -276540.400],
  'RKPC 25 75': ['18', 2952.231, -95659.100, -276540.400],
  'RKPC 13 45': ['5', 703.860, -93426.000, -275382.200],
  'RKPC 13 60': ['1A', 462.612, -93196.600, -275545.200],
  'RKPC 13 75': ['1A', 762.683, -92979.200, -275697.000],
  'RKPC 31 45': ['5', 628.816, -93421.300, -275409.800],
  'RKPC 31 60': ['18', 4794.140, -95659.100, -276540.400],
  'RKPC 31 75': ['9', 1822.698, -94052.300, -274915.600],
};

test('Korea with the region off: v0.5.8\'s taxi-in routes exactly', () => {
  setEastAsia(false);
  try {
    let n = 0;
    for (const icao of ['RKSS', 'RKSI', 'RKPC']) {
      const ap = load(icao);
      for (const [e, o] of ends(ap)) for (const frac of [0.45, 0.6, 0.75]) for (const gs of [4, 10, 15]) {
        const key = `${icao} ${e.ident} ${Math.round(frac * 100)}`, want = V058[key];
        assert.ok(want !== undefined, `${key} recorded`);
        const { r } = land(ap, e, o, frac, gs);
        if (want === null) { assert.equal(r, null, `${key}: no route, as in v0.5.8`); n++; continue; }
        assert.ok(r, `${key}: a route, as in v0.5.8`);
        assert.equal(r.stand, want[0], `${key}: stand`);
        assert.ok(Math.abs(r.lengthM - want[1]) < 0.001, `${key}: ${r.lengthM} m, v0.5.8 ${want[1]}`);
        assert.ok(Math.abs(r.exit[0] - want[2]) < 0.001 && Math.abs(r.exit[1] - want[3]) < 0.001, `${key}: the exit`);
        n++;
      }
    }
    assert.equal(n, Object.keys(V058).length * 3);
  } finally { setEastAsia(FLAG0); }
});

test('the region off and on again: the same flow and graph give each its own rule (nothing cached)', () => {
  const ap = load('RKSS'), [e, o] = ends(ap).find(([x]) => x.ident === '32L');
  try {
    const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
    const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * 0.6, y: e.y + uy * L * 0.6, z: 0 } };
    setEastAsia(false);
    const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
    assert.equal(gate.afterLanding(state), null, 'Gimpo 32L from 60 %, region off: none (v0.5.8)');
    setEastAsia(true);
    state.pos.x += ux * 60; state.pos.y += uy * 60;   // past lastTry's 50 m
    const r = gate.afterLanding(state);
    assert.ok(r, 'region on, the same flow and graph: a route');
  } finally { setEastAsia(FLAG0); }
});

// v0.6.1 (the review's finding): a runway in the taxi graph is its pavement, not the stretch between its
// landing thresholds. Gimhae 18R's threshold is displaced 600 m (Korea's eAIP); with the rectangle built
// from thresholds the north 600 m of 18R/36L stopped being runway, a landing on 36L that rolled past
// 80 % found no way off, and an 18R departure was sent to a hold abeam the displaced threshold.
test('the region\'s runways in the taxi graph run pavement end to pavement end; Korea\'s keep their thresholds', () => {
  setEastAsia(true);
  const pav = (r) => Math.hypot(r.ends[1].pavementEnd[0] - r.ends[0].pavementEnd[0], r.ends[1].pavementEnd[1] - r.ends[0].pavementEnd[1]);
  const thr = (r) => Math.hypot(r.ends[1].x - r.ends[0].x, r.ends[1].y - r.ends[0].y);
  for (const icao of ['RKPK', 'RJTT', 'ZSPD', 'ZSYN']) {
    const ap = load(icao), g = buildTaxiGraph(ap);
    ap.runways.forEach((r, k) => assert.ok(Math.abs(g.rects[k].len - pav(r)) < 0.5, `${icao} ${r.id}: ${g.rects[k].len.toFixed(0)} m in the graph, ${pav(r).toFixed(0)} m of pavement`));
  }
  const jeju = load('RKPC'), gj = buildTaxiGraph(jeju);
  jeju.runways.forEach((r, k) => assert.ok(Math.abs(gj.rects[k].len - thr(r)) < 0.5, `RKPC ${r.id}: v0.5.8's, threshold to threshold`));
  // Gimhae: 18R is displaced, its runway isn't shorter for it.
  const ap = load('RKPK'), rw = ap.runways.find((r) => r.id === '18R/36L');
  const e18 = rw.ends.find((e) => e.ident === '18R'), e36 = rw.ends.find((e) => e.ident === '36L');
  assert.equal(e18.displacedM, 600);
  assert.ok(pav(rw) - thr(rw) > 599 && pav(rw) - thr(rw) < 601);
  // A landing on 36L from the pavement's 80 to 95 %: a route, its exit ahead.
  const p0 = e36.pavementEnd, p1 = e18.pavementEnd, L = pav(rw), ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
  for (const f of [0.5, 0.7, 0.8, 0.85, 0.9, 0.95]) {
    const state = { onGround: true, gs: 5, hdg: Math.atan2(ux, uy), pos: { x: p0[0] + ux * L * f, y: p0[1] + uy * L * f, z: 0 } };
    const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
    const r = gate.afterLanding(state);
    assert.ok(r && r.stand, `36L at ${Math.round(f * 100)} % of the pavement: a route`);
    assert.ok((r.points[1][0] - state.pos.x) * ux + (r.points[1][1] - state.pos.y) * uy > -15, `36L at ${Math.round(f * 100)} %: the exit ahead`);
  }
});
