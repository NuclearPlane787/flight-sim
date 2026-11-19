// V060.md Part 3, first pass: the region's airport JSONs (tools/bake_region_airports.py) hold what
// Korea's do, and the game's loaders read them. Not in the manifest yet (behind EAST_ASIA_ON).
//   python3 tools/cpu-guard.py -- node --test tests/region-airports.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createAirports, runwayCrossings, pavementEnd } from '../src/world/runways.js';
import { convergence, magVar } from '../src/world/frame.js';
import { createGeoRules } from '../src/world/geo-rules.js';
import { buildTaxiGraph, routeFromStand, freeStand, snapToGraph, standsFor, pushMinBack, lineBehind } from '../src/ground/taxi.js';
import { standHeading, sizedFootprint, pointInPoly } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';

const here = new URL('..', import.meta.url).pathname;
const DEG = Math.PI / 180;
const FT = 0.3048;
const load = (i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'));
const SHORT = { RJTT: 'Haneda', RJAA: 'Narita', ZSPD: 'Pudong',
  RKPK: 'Gimhae', ZSSS: 'Hongqiao', RJBB: 'Kansai', RJFF: 'Fukuoka', ZSQD: 'Qingdao' };
// Gimhae is inside south-korea.poly: its variation is frame.js magVar()'s plane, the others the WMM grid's.
const PLANE = new Set(['RKPK']);
// The AIPs' published variation (V060.md, "Magnetic variation"): 8° W at Haneda and Narita, 5°47′ W at
// Pudong (2017). The WMM at 2026.0 may differ by the drift since. The second pass's AIPs weren't read:
// their magVarDeg is checked against the grid (or the plane) only.
const AIP_VAR = { RJTT: -8, RJAA: -8, ZSPD: -5.78, RJBB: -8, RJFF: -8 };
// Second pass: AIP Japan AD 2.19's (I)LS-LOC BRG(MAG) (Kansai 24L's, published as 238, is AD 2.12's true + 8° W).
const PUB_MAG = { RJBB: { '06R': 58.88, '24L': 239.0, '06L': 58.78, '24R': 238.94 },
  RJFF: { '16L': 158.0, '34R': 337.75, '16R': 158.20, '34L': 338.21 } };
// AIP Japan AD 2.12 threshold coordinates (the displaced threshold's where displaced) and AD 2.12/2.13's displacement (m).
const AIP_THR = {
  RJTT: { '16L': ['353346.27N', '1394719.34E', 390], '34R': ['353233.02N', '1394811.34E', 360], '16R': ['353322.47N', '1394618.19E', 480],
    '34L': ['353211.76N', '1394708.41E', 0], '04': ['353256.47N', '1394540.60E', 0], '22': ['353402.88N', '1394637.61E', 0],
    '05': ['353126.41N', '1394812.47E', 0], '23': ['353226.15N', '1394919.61E', 0] },
  RJAA: { '16R': ['354627.80N', '1402205.85E', 0], '34L': ['354435.96N', '1402326.66E', 0], '16L': ['354818.72N', '1402241.19E', 0],
    '34R': ['354708.82N', '1402331.72E', 0] },
  RJBB: { '06R': ['342502.56N', '1351345.40E', 0], '24L': ['342614.04N', '1351531.92E', 0], '06L': ['342542.86N', '1351222.33E', 0],
    '24R': ['342704.58N', '1351424.08E', 0] },
  RJFF: { '16L': ['333548.91N', '1302635.47E', 0], '34R': ['333429.88N', '1302729.47E', 0], '16R': ['333545.49N', '1302628.39E', 0],
    '34L': ['333435.05N', '1302716.52E', 0] },
};
const dms = (s) => { const v = s.slice(0, -1), n = /[NS]/.test(s.slice(-1)) ? 2 : 3;
  return Number(v.slice(0, n)) + Number(v.slice(n, n + 2)) / 60 + Number(v.slice(n + 2)) / 3600; };
const ICAOS = Object.keys(SHORT).filter((i) => existsSync(here + `data/airports/${i}.json`));

const geo = createGeoRules({
  magvar: { header: JSON.parse(readFileSync(here + 'data/magvar.json', 'utf8')), values: gunzipSync(readFileSync(here + 'data/magvar.i16.gz')) },
  country: { header: JSON.parse(readFileSync(here + 'data/country.json', 'utf8')), values: gunzipSync(readFileSync(here + 'data/country.u8.gz')) },
});

// OurAirports' runways (the cross-check; public domain).
function ourAirports() {
  const lines = readFileSync(here + 'reference/raw/ourairports/runways.csv', 'utf8').split('\n');
  const head = lines[0].split(',').map((s) => s.replace(/"/g, ''));
  const out = {};
  for (const ln of lines.slice(1)) {
    const v = ln.split(',').map((s) => s.replace(/"/g, ''));
    const r = Object.fromEntries(head.map((h, k) => [h, v[k]]));
    if (!SHORT[r.airport_ident] || r.closed === '1') continue;
    out[`${r.airport_ident} ${r.le_ident}/${r.he_ident}`] = r;
  }
  return out;
}
const OA = existsSync(here + 'reference/raw/ourairports/runways.csv') ? ourAirports() : null;
const RKSI = load('RKSI');
const bootAirport = (i) => {
  const ap = load(i);
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  return ap;
};
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('the region airports are baked', () => assert.ok(ICAOS.length >= 2, `baked: ${ICAOS.join(' ')}`));

// Part 3's checks (the in-game pass): metres from a runway rectangle's centreline segment, and the metres of a route that
// run along a runway (legs on its pavement within 20 deg of its direction).
const clM = (r, [x, y]) => { const s = Math.max(0, Math.min(r.len, (x - r.ax) * r.ux + (y - r.ay) * r.uy)); return Math.hypot(x - r.ax - r.ux * s, y - r.ay - r.uy * s); };
function alongRunwayM(g, P) {
  let m = 0;
  for (let k = 1; k < P.length; k++) {
    const [ax, ay] = P[k - 1], [bx, by] = P[k], L = Math.hypot(bx - ax, by - ay);
    if (L < 1) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (const r of g.rects) {
      const s = (mx - r.ax) * r.ux + (my - r.ay) * r.uy, c = -(mx - r.ax) * r.uy + (my - r.ay) * r.ux;
      if (s < 0 || s > r.len || Math.abs(c) > r.half) continue;
      if (Math.abs(((bx - ax) * r.ux + (by - ay) * r.uy) / L) > Math.cos(20 * DEG)) m += L;
    }
  }
  return m;
}

test('Gimhae: ILS on 36L and 36R only, the PAPIs kept (Korea\'s eAIP)', () => {
  const a = load('RKPK'), e = Object.fromEntries(a.runways.flatMap((r) => r.ends).map((x) => [x.ident, x]));
  for (const i of ['36L', '36R']) assert.ok(e[i].ils, `${i} has an ILS`);
  for (const i of ['18L', '18R']) { assert.equal(e[i].ils, null, `${i}: no ILS`); assert.ok(e[i].papi, `${i}: a PAPI`); }
});

test('Hongqiao 18L/36R is 57.6 m wide (OSM; the published 3,400 x 57.6 m)', () => {
  assert.equal(load('ZSSS').runways.find((r) => r.id === '18L/36R').widthM, 57.6);
});

test('the region\'s setup lists: sorted, our R-numbered stands after the real numbers', async () => {
  const { standList } = await import('../src/ground/gate-flow.js');
  for (const icao of ICAOS) {
    const a = bootAirport(icao);
    for (const t of ['a321neo', 'b787-9', 'b777-300er']) {
      const list = standList(a, typeById(t)), ours = list.map((s) => /^R\d+$/.test(s.ref));
      assert.ok(ours.every((o, i) => !i || !ours[i - 1] || o), `${icao} ${t}: R stands last`);
      console.log(`  ${icao} ${t}: ${list.length} stands offered (${list.filter((s) => s.gate).length} gates, ${ours.filter(Boolean).length} numbered R by the bake)`);
    }
  }
  // Korea's lists are as they were: Jeju's R stands keep their place by number
  const rkpc = load('RKPC'), list = standList(rkpc, typeById('a321neo'));
  const num = (r) => { const m = String(r).match(/\d+/); return m ? Number(m[0]) : 1e9; };
  const want = rkpc.stands.filter((s) => s.ref).slice().sort((p, q) => (q.gate - p.gate) || (num(p.ref) - num(q.ref)) || String(p.ref).localeCompare(String(q.ref)));
  assert.deepEqual(list.map((s) => s.ref), want.map((s) => s.ref));
});

for (const icao of ICAOS) {
  const ap = load(icao);

  test(`${icao}: the shape is Korea's (RKSI.json), with its shortName`, () => {
    assert.deepEqual(Object.keys(ap).filter((k) => k !== 'shortName'), Object.keys(RKSI));
    assert.equal(ap.shortName, SHORT[icao]);
    const endKeys = Object.keys(RKSI.runways[0].ends[0]);
    for (const r of ap.runways) {
      assert.deepEqual(Object.keys(r), Object.keys(RKSI.runways[0]), `${r.id} keys`);
      for (const e of r.ends) assert.deepEqual(Object.keys(e), endKeys, `${e.ident} keys`);
    }
    for (const k of ['taxiways', 'aprons', 'stands', 'buildings', 'serviceRoads']) assert.ok(ap[k].length > 0, `${k}: ${ap[k].length}`);
    const want = PLANE.has(icao) ? magVar(ap.lat, ap.lon) : geo.wmmVar(ap.origin[0], ap.origin[1]);
    assert.ok(Math.abs(ap.magVarDeg - want) < 0.01, `magVarDeg ${ap.magVarDeg} is the ${PLANE.has(icao) ? 'plane' : 'WMM grid'}'s ${want.toFixed(2)}`);
    if (AIP_VAR[icao] !== undefined) assert.ok(Math.abs(ap.magVarDeg - AIP_VAR[icao]) < 1, `magVarDeg ${ap.magVarDeg} vs the AIP's ${AIP_VAR[icao]}`);
  });

  test(`${icao}: runways: lengths within 1% of OurAirports, thresholds, headings`, () => {
    const { findRunwayEnd } = createAirports([load(icao)]);
    for (const r of ap.runways) {
      const oa = OA && (OA[`${icao} ${r.id}`] || OA[`${icao} ${r.id.split('/').reverse().join('/')}`]);
      assert.ok(oa, `${r.id}: in OurAirports`);
      const oaLen = Number(oa.length_ft) * FT;
      assert.ok(Math.abs(r.lengthM / oaLen - 1) < 0.01, `${r.id}: ${r.lengthM.toFixed(0)} m vs OurAirports ${oaLen.toFixed(0)} m`);
      const [e0, e1] = r.ends;
      const p0 = pavementEnd(e0), p1 = pavementEnd(e1);
      assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - r.lengthM) < 0.2, 'lengthM is the pavement\'s');
      for (const [e, o] of [[e0, e1], [e1, e0]]) {
        const f = findRunwayEnd(icao, e.ident);
        assert.ok(f, `${e.ident}: findRunwayEnd`);
        const pe = pavementEnd(e), po = pavementEnd(o);
        // the threshold is the pavement end moved in by the displacement, on the centreline
        const ux = (po.x - pe.x) / r.lengthM, uy = (po.y - pe.y) / r.lengthM;
        assert.ok(Math.hypot(e.x - (pe.x + ux * e.displacedM), e.y - (pe.y + uy * e.displacedM)) < 0.2, `${e.ident}: threshold`);
        assert.ok(Math.abs(f.ldaM - (r.lengthM - e.displacedM)) < 0.2);
        const side = oa.le_ident === e.ident ? 'le' : 'he';
        // the displacement: the AIP's (Japan), else OurAirports'
        const wantDisp = AIP_THR[icao] ? AIP_THR[icao][e.ident][2] : (Number(oa[`${side}_displaced_threshold_ft`]) || 0) * FT;
        assert.ok(Math.abs(e.displacedM - wantDisp) < 0.2, `${e.ident}: ${e.displacedM} m displaced, published ${wantDisp.toFixed(0)} m`);
        if (AIP_THR[icao]) {
          const [la, lo] = AIP_THR[icao][e.ident].slice(0, 2).map(dms);
          const off = Math.hypot((e.lat - la) * 111000, (e.lon - lo) * 111000 * Math.cos(la * DEG));
          assert.ok(off < 15, `${e.ident}: the threshold is ${off.toFixed(1)} m from the AIP's (AD 2.12)`);
        }
        // headings: grid = true - convergence; mag = true - WMM at the threshold; the ident's number
        const conv = convergence(e.lon) / DEG;
        const wrapd = (a) => ((a + 540) % 360) - 180;
        assert.ok(Math.abs(wrapd(e.hdgGridDeg - (e.hdgTrueDeg - conv))) < 0.02, `${e.ident}: grid vs true`);
        assert.ok(Math.abs(wrapd(f.hdgGridDeg - e.hdgGridDeg)) < 0.02, `${e.ident}: the loader's heading`);
        const mv = PLANE.has(icao) ? magVar(e.lat, e.lon) : geo.wmmVar(e.x, e.y);
        assert.ok(Math.abs(wrapd(e.hdgMagDeg - (e.hdgTrueDeg - mv))) < 0.02, `${e.ident}: mag = true - ${PLANE.has(icao) ? 'plane' : 'WMM'}`);
        // Pudong's five parallels are numbered 15, 16 and 17 by their place, not their bearing (all ~168° M):
        // its AIP publishes the same bearing for each, so they are checked against 17/35. Qingdao's 16/34 and
        // 17/35 are numbered the same way (both ~170° M, as OurAirports has them).
        const n = icao === 'ZSPD' || icao === 'ZSQD' ? (parseInt(e.ident, 10) < 27 ? 170 : 350) : parseInt(e.ident, 10) * 10;
        assert.ok(Math.abs(wrapd(e.hdgMagDeg - n)) <= 5, `${e.ident}: ${e.hdgMagDeg.toFixed(1)}° M rounds to its ident`);
        if (PUB_MAG[icao]) assert.ok(Math.abs(wrapd(e.hdgMagDeg - PUB_MAG[icao][e.ident])) < 1, `${e.ident}: ${e.hdgMagDeg.toFixed(2)}° M vs the AIP's ${PUB_MAG[icao][e.ident]}`);
        assert.ok(Math.abs(wrapd(e.hdgTrueDeg - o.hdgTrueDeg - 180)) < 0.2, `${e.ident}: the ends are reciprocal`);
        // OurAirports' ends are checked where the AIP's aren't (its Narita 16L is 325 m off the AIP's threshold)
        // (Hongqiao 18R/36L's OurAirports ends are given to 0.001°, 290-330 m from OSM's: not checked)
        const coarse = (oa[`${side}_latitude_deg`] || '').split('.')[1]?.length <= 3;
        if (!AIP_THR[icao] && oa[`${side}_latitude_deg`] && !coarse) {
          const ll = [Number(oa[`${side}_latitude_deg`]), Number(oa[`${side}_longitude_deg`])];
          const off = Math.hypot((ll[0] - e.lat) * 111320, (ll[1] - e.lon) * 111320 * Math.cos(e.lat * DEG));
          // OurAirports' end is the threshold or the pavement end, rounded: within the displacement plus 60 m
          assert.ok(off < e.displacedM + 60, `${e.ident}: ${off.toFixed(0)} m from OurAirports' end`);
        }
        assert.ok(['I', 'II', 'II/III', 'III', null].includes(e.ils) && (e.papi === null || (e.papiDeg > 2.5 && e.papiDeg < 4)));
      }
    }
  });

  test(`${icao}: runway crossings are handled (runwayCrossings, as Jeju's)`, () => {
    const a = load(icao);
    runwayCrossings(a);
    const crossed = a.runways.filter((r) => r.cutBy.length);
    for (const r of crossed) assert.equal(r.knots.length, 2, `${r.id}: bends to meet ${r.cutBy[0].id}`);
    console.log(`  ${icao}: ${crossed.length ? crossed.map((r) => `${r.id} crosses ${r.cutBy.map((p) => p.id).join(',')}`).join('; ') : 'no runways cross'}`);
  });

  test(`${icao}: stands have unique refs; code E stands exist for the widebodies`, () => {
    const a = bootAirport(icao), g = buildTaxiGraph(a);
    assert.ok(a.stands.length >= 40, `${a.stands.length} stands`);
    assert.ok(a.stands.every((s) => s.ref), 'every stand has a ref');
    assert.equal(new Set(a.stands.map((s) => s.ref)).size, a.stands.length, 'refs are unique');
    assert.equal(standsFor(a, typeById('a321neo')), a.stands, 'the A321: the data\'s own array');
    for (const type of [typeById('b787-9'), typeById('b777-300er')]) {
      const list = standsFor(a, type);
      assert.ok(list.length >= 5, `${type.id}: ${list.length} code E stands`);
      assert.ok(list.some((s) => s.gate), `${type.id}: at least one is a gate`);
      for (const s of list) {
        const h = standHeading(a, s);
        const parked = sizedFootprint({ span: 65, length: type.geo.LENGTH }, s.x, s.y, h);
        for (const b of a.buildings) assert.ok(!pointInPoly(parked[0].cx, parked[0].cy, b.points), `${s.ref} in a building`);
        const rx = s.x - Math.sin(h) * type.geo.NOSE_X, ry = s.y - Math.cos(h) * type.geo.NOSE_X;
        assert.ok(lineBehind(g, rx, ry, h, pushMinBack(type.geo)), `${s.ref}: a taxi line behind`);
      }
      console.log(`  ${icao} ${type.id}: ${list.length} of ${a.stands.length} stands, ${list.filter((s) => s.gate).length} gates. First: ${list.slice(0, 8).map((s) => s.ref).join(' ')}`);
    }
  });

  test(`${icao}: taxi routes from a gate and from the first code E stand to every runway end`, () => {
    const a = bootAirport(icao), g = buildTaxiGraph(a);
    console.log(`  ${icao}: ${a.taxiways.length} taxiways → ${g.nodes.length} nodes, ${g.holds.length}/${a.holdingPositions.length} holds, ${a.stands.length} stands`);
    const starts = [freeStand(a, []), standsFor(a, typeById('b777-300er'))[0]].filter(Boolean);
    const est = a.holdingPositions.filter((h) => h.est);
    console.log(`  ${icao}: ${a.holdingPositions.length} holds, ${est.length} made by the bake ("est")`);
    for (const h of est) assert.ok(typeof h.ref === 'string' && h.est === true);
    for (const st of starts) {
      for (const rw of a.runways) for (const end of rw.ends) {
        const r = routeFromStand(g, st, end);
        assert.ok(r && r.points.length >= 2, `${icao} stand ${st.ref} → ${end.ident}: a route`);
        for (let k = 1; k < r.points.length; k++) {
          const m = [(r.points[k - 1][0] + r.points[k][0]) / 2, (r.points[k - 1][1] + r.points[k][1]) / 2];
          assert.ok(snapToGraph(g, m[0], m[1]).d < 0.5, `${st.ref} → ${end.ident}: leg ${k} on the graph`);
        }
        assert.ok(d(r.points[r.points.length - 1], [end.x, end.y]) < 1500, `${st.ref} → ${end.ident}: hold near the runway end`);
        // Part 3's checks: the route ends at a hold short of its runway (outside the drawn edge, by the margin
        // derive_holds keeps), and never uses a runway as a taxiway (crossings are fine)
        const rect = g.rects.find((q) => q.idents.includes(end.ident));
        const h = r.points[r.points.length - 1];
        assert.ok(clM(rect, h) >= rect.half + 12, `${st.ref} → ${end.ident}: the hold is ${clM(rect, h).toFixed(0)} m from the centreline (half width ${rect.half})`);
        // (a crossing may jog along the centreline where the taxiways on each side don't line up: Haneda's L4 over
        // 16R/34L meets the far side 99 m down the runway)
        const along = alongRunwayM(g, r.points);
        assert.ok(along < 150, `${st.ref} → ${end.ident}: ${along.toFixed(0)} m along a runway`);
        if (along > 30) console.log(`    (${st.ref} → ${end.ident}: ${along.toFixed(0)} m along a runway while crossing it)`);
        console.log(`    stand ${st.ref} → ${end.ident}: ${r.lengthM.toFixed(0)} m via ${r.refs.join(' ')} to ${r.hold.ref ?? '(no hold)'}${r.crossings.length ? ', crosses ' + r.crossings.join(',') : ''}`);
      }
    }
  });
}

// v0.6.0 (found on 19 Nov with tools of the evening's close): after a landing the game looks for an
// exit ahead and a route to a free stand (gate-flow.js afterLanding). In the map data most of the new
// airports' taxiways aren't joined to the runway's centreline, so a landing on Qingdao 34, Kansai 24R
// or Narita 16R found no exit and the player read "No taxi route to a stand found". For the region's
// airports an unjoined taxiway beside the runway is an exit too, an unreachable stand gives way to the
// next, and a route that runs back along a runway loses to one that doesn't.
test('after landing at each new airport there is a taxi-in route, from anywhere along every runway', async () => {
  const { createGateFlow, alongRunwayM } = await import('../src/ground/gate-flow.js');
  let n = 0, worst = 0, where = '';
  for (const icao of ICAOS) {
    const ap = load(icao);
    for (const rw of ap.runways) for (const [e, o] of [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]]) {
      const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
      for (const frac of [0.45, 0.6, 0.75]) {
        const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
        const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
        const r = gate.afterLanding(state);
        assert.ok(r, `${icao} ${e.ident} from ${frac * 100} %: a route to a stand`);
        assert.equal(r.kind, 'in');
        // The exit is ahead of the aircraft (never a turn back along the runway to reach it).
        const ahead = (r.points[1][0] - state.pos.x) * ux + (r.points[1][1] - state.pos.y) * uy;
        assert.ok(ahead > -15, `${icao} ${e.ident} from ${frac * 100} %: the exit ${ahead.toFixed(0)} m ahead`);
        // The route ends at the stand it names.
        const st = ap.stands.find((s) => s.ref === r.stand), end = r.points[r.points.length - 1];
        assert.ok(st && Math.hypot(end[0] - st.x, end[1] - st.y) < 120, `${icao} ${e.ident}: ends at stand ${r.stand}`);
        const al = alongRunwayM(gate.graphFor(icao), r.points.slice(2));
        if (al > worst) { worst = al; where = `${icao} ${e.ident} from ${frac * 100} %`; }
        n++;
      }
    }
  }
  assert.ok(n >= 8 * 2 * 3);
  assert.ok(worst < 200, `the most of any taxi-in route along a runway after its exit: ${worst.toFixed(0)} m (${where})`);
});

// Korea's three airports keep v0.5.8's exits (only taxiways joined to the centreline), whatever that finds.
test('the taxi-in rules for the region leave Korea\'s graphs alone', async () => {
  const { buildTaxiGraph: build } = await import('../src/ground/taxi.js');
  for (const icao of ['RKSS', 'RKSI', 'RKPC']) assert.ok(!build(load(icao)).region, `${icao} is not a region airport`);
  for (const icao of ICAOS) assert.ok(build(load(icao)).region, `${icao} is`);
});
