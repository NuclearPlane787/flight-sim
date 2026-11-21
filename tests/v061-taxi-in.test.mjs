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

const here = new URL('..', import.meta.url).pathname;
const load = (i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'));
const KT = 0.514444;

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

test('the taxi-in rule: the region\'s airports always, Korea\'s three too, graphs unmarked', () => {
  try {
    for (const on of [true]) {   // (v0.7.0: the region-off pass, Korea's three false, went with the flag)
      for (const icao of ['RKSS', 'RKSI', 'RKPC']) {
        const ap = load(icao), g = buildTaxiGraph(ap);
        assert.ok(!g.region, `${icao}'s graph isn't a region graph`);
        assert.equal(taxiInRule(ap, g), on, `${icao} with the region ${on ? 'on' : 'off'}`);
      }
      const nrt = load('RJAA');
      assert.equal(taxiInRule(nrt, buildTaxiGraph(nrt)), true);
    }
  } finally { /* (v0.7.0: no flag to put back) */ }
});

test('Korea with the region on: a taxi-in route from 30 to 90 % of every runway end', () => {
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
  } finally { /* (v0.7.0: no flag to put back) */ }
});

// (v0.7.0: v0.5.8's table of Korea's taxi-in routes with the region off went, with its test and the off-and-on test.)

// v0.6.1 (the review's finding): a runway in the taxi graph is its pavement, not the stretch between its
// landing thresholds. Gimhae 18R's threshold is displaced 600 m (Korea's eAIP); with the rectangle built
// from thresholds the north 600 m of 18R/36L stopped being runway, a landing on 36L that rolled past
// 80 % found no way off, and an 18R departure was sent to a hold abeam the displaced threshold.
test('the region\'s runways in the taxi graph run pavement end to pavement end; Korea\'s keep their thresholds', () => {
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
