// v0.6.1: Yancheng Nanyang (ZSYN), the ninth new airport, baked as v0.6.0's eight were
// (tools/bake_region_airports.py ZSYN, tools/bake_region_patches.py patch yancheng) and listed as
// *pending*: the manifest's airportsPending/patchesPending, read only with ?pending=1 (FS_PENDING=1).
// With the region and pending on: the data's shape, the runway, the patch's flattening, the stands
// and holds, a route from every stand to both runway ends' holds, a taxi-in route after landing,
// China's rules there and the new routes. With pending off, nothing of ZSYN is listed.
// Skips cleanly while the data isn't there.
//   python3 tools/cpu-guard.py -- node --test tests/v061-yancheng.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setEastAsia, setPending, setGeoRules, terrainSpec, countryAt, rulesAt } from '../src/world/region.js';
import { createGeoRules } from '../src/world/geo-rules.js';
import { convergence, greatCircle } from '../src/world/frame.js';
import { createAirports, pavementEnd } from '../src/world/runways.js';
import { buildTaxiGraph, routeFromStand, snapToGraph, standsFor, regionRules } from '../src/ground/taxi.js';
import { standHeading } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { airportGroups } from '../src/ui/setup.js';

const DATA = new URL('../data/', import.meta.url);
const has = (rel) => existsSync(new URL(rel, DATA));
const HAVE = has('airports/ZSYN.json') && has('terrain/patch-yancheng.i16.gz') && has('manifest.json');
const skip = !HAVE && 'ZSYN data not baked';
const load = (i) => JSON.parse(readFileSync(new URL(`airports/${i}.json`, DATA), 'utf8'));
const manifest = () => JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
const DEG = Math.PI / 180;
const NM = 1852;
const wrapd = (a) => ((a + 540) % 360) - 180;

const part = (name) => {
  const header = JSON.parse(readFileSync(new URL(name + '.json', DATA), 'utf8'));
  const buf = gunzipSync(readFileSync(new URL(header.file, DATA)));
  return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const geo = HAVE ? createGeoRules({ magvar: part('magvar'), country: part('country') }) : null;

// as main.js boots a stand without a lead-in (all of Yancheng's have one)
const bootAirport = () => {
  const ap = load('ZSYN');
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  return ap;
};
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
const withPending = async (fn) => { setEastAsia(true); setPending(true); try { return await fn(); } finally { setPending(false); } };

// While it was checked ZSYN sat in the manifest's airportsPending (read only with ?pending=1);
// once through its check it moved to airportsRegion. Either way: nothing of it with the region off.
const LISTED = HAVE && (manifest().airportsRegion || []).includes('airports/ZSYN.json');
test('the manifest: ZSYN pending (unlisted without the switch) or in the region\'s list, never with the region off', { skip }, () => {
  setEastAsia(true); setPending(false);
  const m = manifest();
  const off = terrainSpec(m, false), on = terrainSpec(m, true);
  assert.ok(!off.airports.some((f) => f.includes('ZSYN')) && !off.patches.some((p) => p.id === 'yancheng'), 'region off: no ZSYN, no patch');
  if (LISTED) {
    assert.ok(on.airports.includes('airports/ZSYN.json') && on.patches.some((p) => p.id === 'yancheng'), 'listed with its patch');
    // (Twelve when Yancheng was listed; seventeen since v0.6.3's five; twenty-three since v0.6.4's six. No airport twice.)
    assert.equal(on.airports.length, 23);
    assert.equal(new Set(on.airports).size, on.airports.length);
    assert.ok(!(m.airportsPending || []).includes('airports/ZSYN.json') && !(m.patchesPending || []).some((p) => p.id === 'yancheng'), 'not pending any more');
  } else {
    assert.deepEqual(m.airportsPending, ['airports/ZSYN.json']);
    assert.equal(m.patchesPending.length, 1);
    assert.ok(!on.airports.some((f) => f.includes('ZSYN')) && !on.patches.some((p) => p.id === 'yancheng'), 'pending: not listed without the switch');
    assert.equal(on.airports.length, 11);
  }
});

test('pending on: terrainSpec adds ZSYN and its patch to the region\'s lists (and only with the region)', { skip }, () => withPending(() => {
  const m = manifest(), on = terrainSpec(m, true);
  assert.ok(on.airports.includes('airports/ZSYN.json'));
  // (Twelve when this was written; seventeen since v0.6.3's five were listed, and nothing waits in airportsPending.)
  assert.equal(on.airports.length, 23 + (m.airportsPending || []).length);   // (17 until v0.6.4's six were listed)
  assert.equal(new Set(on.airports).size, on.airports.length, 'no airport listed twice');
  const p = on.patches.find((q) => q.id === 'yancheng');
  assert.ok(p, 'the patch is listed');
  assert.deepEqual(Object.keys(p), Object.keys(m.patchesRegion[0]));
  assert.equal(p.cell, 30);
  const off = terrainSpec(m, false);
  assert.ok(!off.airports.some((f) => f.includes('ZSYN')) && !off.patches.some((q) => q.id === 'yancheng'), 'Korea\'s lists stay Korea\'s');
}));

test('ZSYN: the shape is Korea\'s (RKSI.json) and the eight\'s, with its names', { skip }, () => {
  const ap = load('ZSYN'), RKSI = load('RKSI'), ZSQD = load('ZSQD');
  assert.deepEqual(Object.keys(ap), Object.keys(ZSQD));
  assert.deepEqual(Object.keys(ap).filter((k) => k !== 'shortName'), Object.keys(RKSI));
  assert.equal(ap.icao, 'ZSYN');
  assert.equal(ap.shortName, 'Yancheng');
  assert.equal(ap.name, 'Yancheng Nanyang International Airport');
  for (const r of ap.runways) {
    assert.deepEqual(Object.keys(r), Object.keys(RKSI.runways[0]));
    for (const e of r.ends) assert.deepEqual(Object.keys(e), Object.keys(RKSI.runways[0].ends[0]));
  }
  for (const k of ['taxiways', 'aprons', 'stands', 'holdingPositions', 'buildings', 'serviceRoads']) assert.ok(ap[k].length > 0, `${k}: ${ap[k].length}`);
  assert.ok(Math.abs(ap.lat - 33.43) < 0.02 && Math.abs(ap.lon - 120.20) < 0.02);
  assert.ok(Math.abs(ap.magVarDeg - geo.wmmVar(ap.origin[0], ap.origin[1])) < 0.01, `magVarDeg ${ap.magVarDeg} is the WMM grid's`);
  assert.ok(regionRules(ap), 'the region\'s taxi rules apply');
});

test('ZSYN: one runway 04/22, 2,800 x 50 m, 3 m, headings true/grid/magnetic', { skip }, () => {
  const ap = load('ZSYN');
  assert.equal(ap.runways.length, 1);
  const [r] = ap.runways;
  assert.equal(r.id, '04/22');
  assert.ok(Math.abs(r.lengthM / 2800 - 1) < 0.01, `${r.lengthM} m`);
  assert.equal(r.widthM, 50);
  assert.ok(Math.abs(ap.elevM - 3) < 0.5, `elevM ${ap.elevM}`);
  const { findRunwayEnd } = createAirports([ap]);
  const [e0, e1] = r.ends;
  assert.deepEqual([e0.ident, e1.ident], ['04', '22']);
  const p0 = pavementEnd(e0), p1 = pavementEnd(e1);
  assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - r.lengthM) < 0.2);
  // the open nav-data listings' bearings (SkyVector 043, airports4xp 044/224) carry an older variation: WMM2025 at
  // 2026.0 (-6.85) on OSM's true 38.5 gives 045.4/225.4. Within 2 deg of 044/224, and exactly true - WMM.
  const PUB = { '04': 44, '22': 224 };
  for (const [e, o] of [[e0, e1], [e1, e0]]) {
    assert.ok(Math.abs(e.elevM - 3) < 0.5);
    assert.equal(e.displacedM, 0);
    assert.ok(findRunwayEnd('ZSYN', e.ident), `${e.ident}: findRunwayEnd`);
    assert.ok(Math.abs(wrapd(e.hdgGridDeg - (e.hdgTrueDeg - convergence(e.lon) / DEG))) < 0.02, `${e.ident}: grid vs true`);
    assert.ok(Math.abs(wrapd(e.hdgMagDeg - (e.hdgTrueDeg - geo.wmmVar(e.x, e.y)))) < 0.02, `${e.ident}: mag = true - WMM`);
    assert.ok(Math.abs(wrapd(e.hdgMagDeg - PUB[e.ident])) < 2, `${e.ident}: ${e.hdgMagDeg} M vs the listings' ${PUB[e.ident]}`);
    assert.ok(Math.abs(wrapd(e.hdgMagDeg - parseInt(e.ident, 10) * 10)) < 6, `${e.ident}: ${e.hdgMagDeg} M near its ident`);
    assert.ok(Math.abs(wrapd(e.hdgTrueDeg - o.hdgTrueDeg - 180)) < 0.2, 'reciprocal');
    // the ICAO default for a precision runway ([EST]); 50 m wide: no centreline lights
    assert.equal(e.ils, 'I');
    assert.equal(e.papi, 'left');
    assert.equal(e.papiDeg, 3);
    assert.equal(e.approachLights, 'ALSF-I');
    assert.equal(e.centrelineLights, false);
  }
  // OurAirports' ends (public domain) within 60 m of the thresholds
  const OA = { '04': [33.418488, 120.195839], '22': [33.438221, 120.2146] };
  for (const e of r.ends) {
    const off = Math.hypot((OA[e.ident][0] - e.lat) * 111320, (OA[e.ident][1] - e.lon) * 111320 * Math.cos(e.lat * DEG));
    assert.ok(off < 60, `${e.ident}: ${off.toFixed(0)} m from OurAirports' end`);
  }
});

test('ZSYN: the 30 m patch flattens the airfield to the runway\'s surface', { skip }, () => withPending(async () => {
  const { createTiledHeightfield } = await import('../src/world/heightfield.js');
  const readGz = async (rel) => { try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch (e) { return null; } };
  const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
  const m = manifest(), ap = load('ZSYN');
  const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 60 });
  assert.ok(hf.layers.patches.some((p) => p.id === 'yancheng'), 'the patch is loaded');
  await hf.tiles.whenReady(ap.origin[0], ap.origin[1], 12000, 'test');
  const [e0, e1] = ap.runways[0].ends;
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const x = e0.x + (e1.x - e0.x) * f, y = e0.y + (e1.y - e0.y) * f;
    const h = hf.heightAt(x, y);
    assert.ok(Math.abs(h - 3.0) < 0.6, `${(f * 100).toFixed(0)} % along: ground ${h.toFixed(2)} m, the runway 3.0 m`);
  }
  // the apron too (a stand's stop point)
  for (const st of ap.stands) assert.ok(Math.abs(hf.heightAt(st.x, st.y) - 3.0) < 0.6, `stand ${st.ref}`);
}));

test('ZSYN: stands (numbered, code C spacing) and holds; which types get stands', { skip }, () => withPending(() => {
  const ap = bootAirport();
  assert.equal(ap.stands.length, 20);
  assert.ok(ap.stands.every((s) => /^(0[1-9]|1\d|20)$/.test(s.ref)), 'numbered 01 to 20 by the bake (OSM has no numbers)');
  assert.equal(new Set(ap.stands.map((s) => s.ref)).size, 20);
  for (const s of ap.stands) {
    assert.ok(s.leadIn.length >= 2);
    const L = s.leadIn.at(-1);
    assert.ok(Math.hypot(L[0] - s.x, L[1] - s.y) < 0.2, `${s.ref}: the lead-in ends at the stop point`);
    // each stand points away from the runway (square to it, the terminal side: grid ~313 deg)
    assert.ok(Math.abs(wrapd(s.hdgGridDeg - 312.75)) < 5, `${s.ref}: ${s.hdgGridDeg}`);
  }
  // nearest neighbours 38-50 m apart: a code C row (wingspan 36 m)
  for (const s of ap.stands) {
    const n = Math.min(...ap.stands.filter((t) => t !== s).map((t) => Math.hypot(t.x - s.x, t.y - s.y)));
    assert.ok(n > 38 && n < 50, `${s.ref}: nearest stand ${n.toFixed(0)} m`);
  }
  assert.equal(standsFor(ap, typeById('a321neo')), ap.stands);
  // A 4C aerodrome: no stand for the widebodies, whatever the made-up apron's geometry would allow (taxi.js AIP_STANDS).
  assert.equal(standsFor(ap, typeById('b787-9')).length, 0);
  assert.equal(standsFor(ap, typeById('b777-300er')).length, 0);
  // the holds: every one made by the bake ([EST]), named after its taxiway, 90 m from the centreline or short of A
  const g = buildTaxiGraph(ap), rect = g.rects[0];
  assert.ok(ap.holdingPositions.length >= 2 && ap.holdingPositions.every((h) => h.est === true && typeof h.ref === 'string'));
  assert.equal(g.holds.length, ap.holdingPositions.length, 'every hold snaps to the graph');
  for (const h of g.holds) assert.ok(h.clM >= rect.half + 12 && h.clM < 120, `${h.ref}: ${h.clM.toFixed(0)} m from the centreline`);
}));

test('ZSYN: from every stand a route to the hold of both runway ends', { skip }, () => withPending(() => {
  const ap = bootAirport(), g = buildTaxiGraph(ap), rect = g.rects[0];
  for (const st of ap.stands) for (const end of ap.runways[0].ends) {
    const r = routeFromStand(g, st, end);
    assert.ok(r && r.points.length >= 2, `${st.ref} → ${end.ident}: a route`);
    for (let k = 1; k < r.points.length; k++) {
      const m = [(r.points[k - 1][0] + r.points[k][0]) / 2, (r.points[k - 1][1] + r.points[k][1]) / 2];
      assert.ok(snapToGraph(g, m[0], m[1]).d < 0.5, `${st.ref} → ${end.ident}: leg ${k} on the graph`);
    }
    const h = r.points.at(-1);
    assert.ok(r.hold && r.hold.est, `${st.ref} → ${end.ident}: ends at a hold`);
    assert.ok(clM(rect, h) >= rect.half + 12, `${st.ref} → ${end.ident}: hold ${clM(rect, h).toFixed(0)} m from the centreline`);
    assert.ok(Math.hypot(h[0] - end.x, h[1] - end.y) < 300, `${st.ref} → ${end.ident}: the hold near the end`);
    assert.ok(alongRunwayM(g, r.points) < 1, `${st.ref} → ${end.ident}: never along the runway`);
    assert.deepEqual(r.crossings, [], 'no runway to cross: one runway, every stand on its north-west side');
  }
}));

test('ZSYN: after landing, a taxi-in route from 45, 60 and 75 % along both runway ends', { skip }, () => withPending(async () => {
  const { createGateFlow } = await import('../src/ground/gate-flow.js');
  const ap = load('ZSYN'), rw = ap.runways[0];
  let n = 0;
  for (const [e, o] of [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]]) {
    const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
    for (const frac of [0.45, 0.6, 0.75]) {
      const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
      const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
      const r = gate.afterLanding(state);
      const at = `${e.ident} from ${frac * 100} %`;
      assert.ok(r, `${at}: a route to a stand`);
      assert.equal(r.kind, 'in');
      const ahead = (r.points[1][0] - state.pos.x) * ux + (r.points[1][1] - state.pos.y) * uy;
      assert.ok(ahead > -15, `${at}: the exit ${ahead.toFixed(0)} m ahead`);
      const st = ap.stands.find((s) => s.ref === r.stand), end = r.points.at(-1);
      assert.ok(st && Math.hypot(end[0] - st.x, end[1] - st.y) < 120, `${at}: ends at stand ${r.stand}`);
      const al = alongRunwayM(gate.graphFor('ZSYN'), r.points.slice(2));
      assert.ok(al < 30, `${at}: ${al.toFixed(0)} m back along the runway after the exit`);
      n++;
    }
  }
  assert.equal(n, 6);
}));

test('ZSYN: China by the country raster, China\'s rules (3,000 m / 3,600 m, [EST] as Hongqiao\'s and Qingdao\'s)', { skip }, () => {
  setEastAsia(true);
  setGeoRules(geo);
  try {
    const ap = load('ZSYN');
    assert.equal(countryAt(ap.origin[0], ap.origin[1]), 'CN');
    for (const e of ap.runways[0].ends) assert.equal(countryAt(e.x, e.y), 'CN');
    const r = rulesAt(ap.origin[0], ap.origin[1]);
    assert.equal(r.country, 'CN');
    assert.equal(r.transAltM, 3000);
    assert.equal(r.transLevelM, 3600);
    assert.equal(r.timeZone, 'Asia/Shanghai');
    assert.equal(r.metricAlt, true);
  } finally { setGeoRules(null); }
});

test('ZSYN in the setup: listed in China between Hongqiao and Qingdao (south to north along the coast)', { skip }, () => {
  const aps = ['RKSI', 'ZSPD', 'ZSSS', 'ZSQD', 'ZSYN'].map(load);
  const cn = airportGroups(aps).find((x) => x.country === 'CN');
  assert.deepEqual(cn.airports.map((a) => a.icao), ['ZSPD', 'ZSSS', 'ZSYN', 'ZSQD']);
});

test('the new routes: Incheon–Yancheng ~390 nm, Yancheng–Pudong ~160 nm, Yancheng–Qingdao ~175 nm', { skip }, () => {
  const ap = Object.fromEntries(['RKSI', 'ZSYN', 'ZSPD', 'ZSQD'].map((i) => [i, load(i)]));
  const nm = (a, b) => greatCircle(ap[a].lat, ap[a].lon, ap[b].lat, ap[b].lon) / NM;
  const map = (a, b) => Math.hypot(ap[a].origin[0] - ap[b].origin[0], ap[a].origin[1] - ap[b].origin[1]) / NM;
  for (const [a, b, want] of [['RKSI', 'ZSYN', 390], ['ZSYN', 'ZSPD', 159], ['ZSYN', 'ZSQD', 176]]) {
    const d = nm(a, b);
    console.log(`  ${a}–${b}: ${d.toFixed(1)} nm (great circle), ${map(a, b).toFixed(1)} nm on the map`);
    assert.ok(Math.abs(d - want) < 3, `${a}–${b}: ${d.toFixed(1)} nm`);
    assert.ok(Math.abs(map(a, b) / d - 1) < 0.01, 'the map within 1 % of the great circle');
  }
});

