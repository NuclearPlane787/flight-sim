// v0.6.3: Beijing Daxing (ZBAD), baked as Yancheng was in v0.6.1 (tools/bake_region_airports.py ZBAD,
// tools/bake_region_patches.py patch beijing-daxing) and listed as *pending*: the manifest's airportsPending /
// patchesPending, read only with ?pending=1 (FS_PENDING=1). With the region and pending on: the data's shape, the
// four runways against OurAirports (after the map frame's scale, +0.15 % here; three trimmed off OSM's blast pads)
// and the open secondary sources' lights and ILS, the patch's flattening, the stands (code E where the geometry fits them), the holds, a route from
// every stand to a hold of every runway end, taxi-in after landing, China's rules and the new routes.
// Holds whether ZBAD is pending or listed (airportsRegion). Skips cleanly while the data isn't there.
//   python3 tools/cpu-guard.py -- node --test tests/v063-zbad.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setPending, setGeoRules, terrainSpec, countryAt, rulesAt } from '../src/world/region.js';

import { createGeoRules } from '../src/world/geo-rules.js';
import { convergence, greatCircle, scaleFactor } from '../src/world/frame.js';
import { createAirports, pavementEnd } from '../src/world/runways.js';
import { buildTaxiGraph, routeFromStand, snapToGraph, standsFor, regionRules } from '../src/ground/taxi.js';
import { standHeading, pointInPoly } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { airportGroups } from '../src/ui/setup.js';

const ICAO = 'ZBAD', PATCH = 'beijing-daxing';
const DATA = new URL('../data/', import.meta.url);
const has = (rel) => existsSync(new URL(rel, DATA));
const HAVE = has(`airports/${ICAO}.json`) && has(`terrain/patch-${PATCH}.i16.gz`) && has('manifest.json');
const skip = !HAVE && `${ICAO} data not baked`;
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

// The published lengths and widths (OurAirports, public domain) and its ends; the ILS categories from X-Plane 12's
// nav data (airports4xp.info) and the lights from the X-Plane Scenery Gateway's scenery (open secondary sources,
// China's AIP not being readable): ALSF-I at the CAT I ends, the CAT II/III lights at 35L and 01L, nothing at 11L
// (a departure end: no approach lights, no PAPI, no ILS), centreline lights on all four runways (17R/35L's too though
// 45 m wide), one PAPI-4L at every other end. [length, width, tolerance]: 11L/29R is OSM's own (+0.48 %: its ends
// 18 m past OurAirports' at 11L, by the stopway OSM maps apart, and 38 m at 29R); the other three are trimmed to the
// published length times the frame's scale (TRIM_BOTH), so they match it.
const RUNWAYS = { '17L/35R': [3800, 60, 0.001], '17R/35L': [3800, 45, 0.001], '11L/29R': [3800, 60, 0.006], '01L/19R': [3400, 60, 0.001] };
const OA = { '01L': [39.471298, 116.431000], '19R': [39.501701, 116.427002], '11L': [39.516701, 116.431], '29R': [39.5089, 116.473999],
  '17L': [39.517906, 116.396111], '35R': [39.483929, 116.401474], '17R': [39.517075, 116.387337], '35L': [39.483101, 116.3927] };
const ILS = { '01L': 'III', '19R': 'I', '11L': null, '29R': 'I', '17L': 'I', '35R': 'I', '17R': 'I', '35L': 'II' };
const ALS = { '01L': 'ALSF-II', '19R': 'ALSF-I', '11L': null, '29R': 'ALSF-I', '17L': 'ALSF-I', '35R': 'ALSF-I', '17R': 'ALSF-I', '35L': 'ALSF-II' };
const ELEV_FT = { '01L': 73, '19R': 83, '11L': 69, '29R': 69, '17L': 76, '35R': 76, '17R': 76, '35L': 76 };
// OurAirports' 01L/19R ends are 27-38 m off the runway's axis (rounded), and OSM's 29R end is 38 m past its 29R:
// further from the thresholds than the others'
const OA_OFF_M = { '01L': 45, '19R': 45, '29R': 45 };

const bootAirport = () => {
  const ap = load(ICAO);
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  return ap;
};
const rectOf = (g, rw) => g.rects.find((r) => Math.abs(r.len - Math.hypot(rw.ends[1].x - rw.ends[0].x, rw.ends[1].y - rw.ends[0].y)) < 2
  && Math.hypot(r.ax + r.ux * r.len / 2 - (rw.ends[0].x + rw.ends[1].x) / 2, r.ay + r.uy * r.len / 2 - (rw.ends[0].y + rw.ends[1].y) / 2) < 5);
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
// z = a x + b y + c through [[x, y, z]] by least squares (the bake's field_plane())
function fitPlane(P) {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, sxz = 0, syz = 0;
  for (const [x, y, z] of P) { sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sz += z; sxz += x * z; syz += y * z; }
  const n = P.length, M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxz, syz, sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = (k) => M.map((row, i) => row.map((c, j) => (j === k ? v[i] : c)));
  const [a, b, c] = [0, 1, 2].map((k) => det(col(k)) / D);
  return (x, y) => a * x + b * y + c;
}
const withPending = async (fn) => { setPending(true); try { return await fn(); } finally { setPending(false); } };

const LISTED = HAVE && (manifest().airportsRegion || []).includes(`airports/${ICAO}.json`);
test(`the manifest: ${ICAO} pending (unlisted without the switch) or in the region's list`, { skip }, () => {
  setPending(false);
  const m = manifest();
  const on = terrainSpec(m);   // (v0.7.0: the region-off lists and their assertions went with the flag)
  const pend = (m.airportsPending || []).includes(`airports/${ICAO}.json`), pendP = (m.patchesPending || []).some((p) => p.id === PATCH);
  if (LISTED) {
    assert.ok(on.airports.includes(`airports/${ICAO}.json`) && on.patches.some((p) => p.id === PATCH), 'listed with its patch');
    assert.ok(!pend && !pendP, 'not pending any more');
  } else {
    assert.ok(pend && pendP, 'pending: the airport and its patch in the pending lists');
    assert.ok(!on.airports.some((f) => f.includes(ICAO)) && !on.patches.some((p) => p.id === PATCH), 'pending: not listed without the switch');
  }
});

test(`pending on: terrainSpec adds ${ICAO} and its patch to the region's lists (and only with the region)`, { skip }, () => withPending(() => {
  const m = manifest(), on = terrainSpec(m);
  assert.ok(on.airports.includes(`airports/${ICAO}.json`));
  const p = on.patches.find((q) => q.id === PATCH);
  assert.ok(p, 'the patch is listed');
  assert.deepEqual(Object.keys(p), Object.keys(m.patchesRegion[0]));
  assert.equal(p.cell, 30);
  assert.ok(Number.isInteger(p.x0) && Number.isInteger(p.y0) && p.x0 % 30 === 0 && p.y0 % 30 === 0, 'cell-aligned integers, as the others');
    // (v0.7.0: the region-off assertion, Korea's lists without it, went with the flag)
}));

test(`${ICAO}: the shape is Korea's (RKSI.json) and the region's, with its names`, { skip }, () => {
  const ap = load(ICAO), RKSI = load('RKSI'), ZSQD = load('ZSQD');
  assert.deepEqual(Object.keys(ap), Object.keys(ZSQD));
  assert.deepEqual(Object.keys(ap).filter((k) => k !== 'shortName'), Object.keys(RKSI));
  assert.equal(ap.icao, ICAO);
  assert.equal(ap.shortName, 'Daxing');
  assert.equal(ap.name, 'Beijing Daxing International Airport');
  for (const r of ap.runways) {
    assert.deepEqual(Object.keys(r), Object.keys(RKSI.runways[0]));
    for (const e of r.ends) assert.deepEqual(Object.keys(e), Object.keys(RKSI.runways[0].ends[0]));
  }
  for (const k of ['taxiways', 'aprons', 'stands', 'holdingPositions', 'buildings', 'serviceRoads']) assert.ok(ap[k].length > 0, `${k}: ${ap[k].length}`);
  assert.ok(ap.taxiways.filter((t) => t.ref).length > 100, 'OSM names its taxiways');
  assert.ok(ap.buildings.some((b) => b.kind === 'terminal' && b.name === 'Terminal Building'), 'the terminal');
  assert.ok(Math.abs(ap.lat - 39.501) < 0.02 && Math.abs(ap.lon - 116.414) < 0.02);
  assert.ok(Math.abs(ap.elevM - 29.9) < 0.1, `elevM ${ap.elevM} (OurAirports' 98 ft; the field is flattened to its runways' plane)`);
  assert.ok(Math.abs(ap.magVarDeg - geo.wmmVar(ap.origin[0], ap.origin[1])) < 0.01, `magVarDeg ${ap.magVarDeg} is the WMM grid's`);
  assert.ok(regionRules(ap), 'the region\'s taxi rules apply');
});

test(`${ICAO}: four runways, 17L/35R, 17R/35L, 11L/29R, 01L/19R, none crossing: lengths after the frame's scale, headings, ends, lights`, { skip }, () => {
  const ap = load(ICAO);
  assert.deepEqual(ap.runways.map((r) => r.id).sort(), Object.keys(RUNWAYS).sort());
  const { findRunwayEnd } = createAirports([ap]);
  // none crosses another (11L/29R's west end is 1.7 km north-north-east of 01L/19R's north end)
  const cross = (p, q, u, v) => { const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return d(p, q, u) * d(p, q, v) < 0 && d(u, v, p) * d(u, v, q) < 0; };
  for (const r of ap.runways) for (const o of ap.runways) if (r !== o) assert.ok(!cross(...r.ends.map((e) => e.pavementEnd), ...o.ends.map((e) => e.pavementEnd)), `${r.id} x ${o.id}`);
  for (const r of ap.runways) {
    const [pub, width, tol] = RUNWAYS[r.id];
    const k = scaleFactor((r.ends[0].lat + r.ends[1].lat) / 2);
    assert.ok(k > 1.0014 && k < 1.0017, `the frame's scale at Daxing ${k}`);
    assert.ok(Math.abs(r.lengthM / k / pub - 1) < tol, `${r.id}: ${r.lengthM} map m = ${(r.lengthM / k).toFixed(0)} m vs ${pub} m`);
    assert.equal(r.widthM, width);
    const [e0, e1] = r.ends;
    assert.deepEqual([e0.ident, e1.ident], r.id.split('/'));
    const p0 = pavementEnd(e0), p1 = pavementEnd(e1);
    assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - r.lengthM) < 0.2);
    for (const [e, o] of [[e0, e1], [e1, e0]]) {
      assert.equal(e.displacedM, 0, `${e.ident}: no displaced threshold (OurAirports, the Gateway's scenery; airports4xp's 7 m at 11L/29R taken as 0)`);
      assert.ok(Math.abs(e.elevM - ELEV_FT[e.ident] * 0.3048) < 0.06, `${e.ident}: ${e.elevM} m, OurAirports ${ELEV_FT[e.ident]} ft`);
      assert.ok(findRunwayEnd(ICAO, e.ident), `${e.ident}: findRunwayEnd`);
      assert.ok(Math.abs(wrapd(e.hdgGridDeg - (e.hdgTrueDeg - convergence(e.lon) / DEG))) < 0.02, `${e.ident}: grid vs true`);
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - (e.hdgTrueDeg - geo.wmmVar(e.x, e.y)))) < 0.02, `${e.ident}: mag = true - WMM`);
      assert.ok(Math.abs(wrapd(e.hdgTrueDeg - o.hdgTrueDeg - 180)) < 0.2, 'reciprocal');
      // WMM2025 here is about 7.4 deg W: true 173.0 / 353.0 is magnetic 180.5 / 000.5. The idents are the airport's,
      // not the bearing's: Daxing named its three parallel runways 01L/19R, 17L/35R and 17R/35L, apart on purpose
      const want = { '01L': 0.5, '19R': 180.5, '11L': 110.5, '29R': 290.5, '17L': 180.45, '35R': 0.45, '17R': 180.5, '35L': 0.5 }[e.ident];
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - want)) < 0.3, `${e.ident}: ${e.hdgMagDeg} M`);
      // the open secondary sources
      assert.equal(e.ils, ILS[e.ident], `${e.ident}: ILS`);
      assert.equal(e.approachLights, ALS[e.ident], `${e.ident}: approach lights`);
      assert.equal(e.approachLightsM, ALS[e.ident] ? 900 : 0);
      assert.equal(e.tdzLights, ALS[e.ident] === 'ALSF-II');
      assert.equal(e.centrelineLights, true);
      assert.equal(e.papi, e.ident === '11L' ? null : 'left');
      assert.equal(e.papiDeg, e.ident === '11L' ? null : 3);
      // OurAirports' ends (public domain) within 30 m of the thresholds, and its bearing within 0.3 deg
      const off = Math.hypot((OA[e.ident][0] - e.lat) * 111320, (OA[e.ident][1] - e.lon) * 111320 * Math.cos(e.lat * DEG));
      assert.ok(off < (OA_OFF_M[e.ident] || 30), `${e.ident}: ${off.toFixed(0)} m from OurAirports' end`);
      const [la, lo] = OA[e.ident], [lb, lob] = OA[o.ident];
      const brg = Math.atan2((lob - lo) * Math.cos(la * DEG), lb - la) / DEG;
      assert.ok(Math.abs(wrapd(e.hdgTrueDeg - brg)) < (OA_OFF_M[e.ident] ? 1.5 : 0.3), `${e.ident}: true ${e.hdgTrueDeg} vs OurAirports ${brg.toFixed(2)}`);
    }
  }
});

test(`${ICAO}: the 30 m patch, and the ground on each runway and at the stands`, { skip }, () => withPending(async () => {
  const { createTiledHeightfield } = await import('../src/world/heightfield.js');
  const readGz = async (rel) => { try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch (e) { return null; } };
  const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
  const m = manifest(), ap = load(ICAO);
  const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 60 });
  assert.ok(hf.layers.patches.some((p) => p.id === PATCH), 'the patch is loaded');
  await hf.tiles.whenReady(ap.origin[0], ap.origin[1], 12000, 'test');
  // along each runway: the straight line between its ends' elevations (runways.js rectElev)
  for (const r of ap.runways) {
    const [e0, e1] = r.ends;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const h = hf.heightAt(e0.x + (e1.x - e0.x) * f, e0.y + (e1.y - e0.y) * f), want = e0.elevM + (e1.elevM - e0.elevM) * f;
      assert.ok(Math.abs(h - want) < 0.6, `${r.id} ${(f * 100).toFixed(0)} % along: ground ${h.toFixed(2)} m, the runway ${want.toFixed(2)} m`);
    }
  }
  // the stands: the field is flattened to the least-squares plane through the runway ends' elevations
  // (bake_region_patches.py FIELD_PLANE: OurAirports' elevM stands 3-8 m above the ground here), so each stand is
  // on that plane, or in a runway's flat zone between it and the runway's surface; level under the aircraft
  const E = ap.runways.flatMap((r) => r.ends), mx = E.reduce((a, e) => a + e.x, 0) / E.length, my = E.reduce((a, e) => a + e.y, 0) / E.length;
  const plane = fitPlane(E.map((e) => [e.x - mx, e.y - my, e.elevM]));
  const lo = Math.min(...E.map((e) => e.elevM)), hi = Math.max(...E.map((e) => e.elevM));
  let onPlane = 0, worst = 0;
  const steep = [];
  for (const st of ap.stands) {
    const h = hf.heightAt(st.x, st.y), p = plane(st.x - mx, st.y - my);
    assert.ok(h > lo - 0.6 && h < hi + 0.6, `stand ${st.ref}: ${h.toFixed(2)} m`);
    if (Math.abs(h - p) < 0.3) onPlane++;
    const d = [[20, 0], [-20, 0], [0, 20], [0, -20]].map(([dx, dy]) => hf.heightAt(st.x + dx, st.y + dy));
    const dz = Math.max(...d) - Math.min(...d);
    worst = Math.max(worst, dz);
    if (dz > 0.4) steep.push(`${st.ref} ${dz.toFixed(2)}`);
    // under 2.5 % everywhere (the steepest are remote stands in a runway's flat zone, where the field's plane meets
    // the runway's own surface)
    assert.ok(dz < 1.0, `stand ${st.ref}: ${dz.toFixed(2)} m across 40 m`);
  }
  assert.ok(steep.length < ap.stands.length * 0.05, `over 1 % at ${steep.length} stands: ${steep.join(', ')}`);
  assert.ok(onPlane > ap.stands.length * 0.8, `${onPlane} of ${ap.stands.length} stands on the field's plane`);
  console.log(`  stands: ${onPlane} of ${ap.stands.length} on the plane, the steepest ${worst.toFixed(2)} m across 40 m; over 0.4 m: ${steep.join(', ') || 'none'}`);
}));

test(`${ICAO}: stands (OSM's numbers, R1.. where it has none), which types get stands, none towards the air force's field, holds`, { skip }, () => withPending(() => {
  const ap = bootAirport();
  assert.ok(ap.stands.length > 350, `${ap.stands.length} stands`);
  assert.equal(new Set(ap.stands.map((s) => s.ref)).size, ap.stands.length, 'every ref once');
  // OSM numbers 118 of its 413 stand ways; the bake numbers the rest R1.. west to east ([EST])
  assert.ok(ap.stands.filter((s) => /^\d{3}$/.test(s.ref)).length > 100, 'OSM\'s numbers');
  assert.ok(ap.stands.filter((s) => /^R\d+$/.test(s.ref)).length > 250, 'the bake\'s R numbers');
  // the PLAAF's Nanjiao field (ZBNY) lies west of 17R/35L, past its own runway: the westernmost stands are the
  // maintenance apron's (601-614), about 450 m west of 17R/35L's centreline
  const west = Math.min(...ap.runways.find((r) => r.id === '17R/35L').ends.map((e) => e.x));
  for (const s of ap.stands) assert.ok(s.x > west - 700, `${s.ref}: ${(west - s.x).toFixed(0)} m west of 17R/35L`);
  const B = ap.boundary;
  for (const s of ap.stands) {
    assert.ok(pointInPoly(s.x, s.y, B), `${s.ref}: inside the aerodrome`);
    // (OSM's lead-in ways run either way: the bake keeps their order, and the stop is the end nearer no taxi line)
    if (s.leadIn) assert.ok([s.leadIn[0], s.leadIn.at(-1)].some((L) => Math.hypot(L[0] - s.x, L[1] - s.y) < 0.5), `${s.ref}: the lead-in ends at the stop`);
  }
  assert.equal(standsFor(ap, typeById('a321neo')), ap.stands);
  const e787 = standsFor(ap, typeById('b787-9')).map((s) => s.ref), e777 = standsFor(ap, typeById('b777-300er')).map((s) => s.ref);
  assert.ok(e787.length > 200 && e777.length > 200, `code E: 787 ${e787.length}, 777 ${e777.length}`);
  // the terminal's piers (OSM's 1xx contact stands) and the remote 4xx: the widebody gates
  for (const ref of ['128', '147', '150', '161', '191', '401', '406']) assert.ok(e777.includes(ref), `777 at stand ${ref}`);
  const g = buildTaxiGraph(ap);
  assert.ok(ap.holdingPositions.length >= 40 && ap.holdingPositions.every((h) => h.est === true && typeof h.ref === 'string'), 'OSM maps none: made ([EST])');
  assert.equal(g.holds.length, ap.holdingPositions.length, 'every hold snaps to the graph');
}));

test(`${ICAO}: from every stand a route to a hold of every runway end`, { skip }, () => withPending(() => {
  const ap = bootAirport(), g = buildTaxiGraph(ap);
  let n = 0, worst = 0;
  ap.stands.forEach((st, i) => {
    for (const rw of ap.runways) for (const end of rw.ends) {
      const r = routeFromStand(g, st, end), at = `${st.ref} → ${end.ident}`;
      assert.ok(r && r.points.length >= 2, `${at}: a route`);
      assert.ok(r.hold, `${at}: ends at a hold`);
      const h = r.points.at(-1), rect = rectOf(g, rw);
      assert.ok(rect && clM(rect, h) >= rect.half + 12, `${at}: hold ${rect && clM(rect, h).toFixed(0)} m from its runway's centreline`);
      const dEnd = Math.hypot(h[0] - end.x, h[1] - end.y);
      worst = Math.max(worst, dEnd);
      assert.ok(dEnd < 900, `${at}: the hold ${dEnd.toFixed(0)} m from the end`);
      if (i % 9 === 0) for (let k = 1; k < r.points.length; k++) {
        const m = [(r.points[k - 1][0] + r.points[k][0]) / 2, (r.points[k - 1][1] + r.points[k][1]) / 2];
        assert.ok(snapToGraph(g, m[0], m[1]).d < 0.5, `${at}: leg ${k} on the graph`);
      }
      n++;
    }
  });
  assert.equal(n, ap.stands.length * 8);
  console.log(`  ${n} routes, the farthest hold ${worst.toFixed(0)} m from its end`);
}));

test(`${ICAO}: after landing, a taxi-in route from 30 to 90 % along every runway end`, { skip }, () => withPending(async () => {
  const { createGateFlow } = await import('../src/ground/gate-flow.js');
  const ap = load(ICAO);
  let n = 0;
  for (const rw of ap.runways) for (const [e, o] of [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]]) {
    const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
    for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
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
      const al = alongRunwayM(gate.graphFor(ICAO), r.points.slice(2));
      assert.ok(al < 200, `${at}: ${al.toFixed(0)} m along a runway after the exit`);
      n++;
    }
  }
  assert.equal(n, 40);
}));

test(`${ICAO}: China by the country raster, China's rules`, { skip }, () => {
  
  setGeoRules(geo);
  try {
    const ap = load(ICAO);
    assert.equal(countryAt(ap.origin[0], ap.origin[1]), 'CN');
    for (const r of ap.runways) for (const e of r.ends) assert.equal(countryAt(e.x, e.y), 'CN');
    const r = rulesAt(ap.origin[0], ap.origin[1]);
    assert.equal(r.country, 'CN');
    assert.equal(r.transAltM, 3000);
    assert.equal(r.transLevelM, 3600);
    assert.equal(r.timeZone, 'Asia/Shanghai');
    assert.equal(r.metricAlt, true);
  } finally { setGeoRules(null); }
});

test(`${ICAO} in the setup: China's second, after Beijing Capital, before Pudong`, { skip }, () => {
  const aps = ['RKSI', 'ZSPD', 'ZSSS', ICAO, 'ZBAA'].map(load);
  const cn = airportGroups(aps).find((x) => x.country === 'CN');
  assert.deepEqual(cn.airports.map((a) => a.icao), ['ZBAA', ICAO, 'ZSPD', 'ZSSS']);
});

test('the new routes: Incheon, Pudong and (once baked) Shenyang to Daxing', { skip }, () => {
  const ids = ['RKSI', 'ZSPD', ICAO].concat(has('airports/ZYTX.json') ? ['ZYTX'] : []);
  const ap = Object.fromEntries(ids.map((i) => [i, load(i)]));
  const nm = (a, b) => greatCircle(ap[a].lat, ap[a].lon, ap[b].lat, ap[b].lon) / NM;
  const map = (a, b) => Math.hypot(ap[a].origin[0] - ap[b].origin[0], ap[a].origin[1] - ap[b].origin[1]) / NM;
  for (const [a, b, want] of [['RKSI', ICAO, 486.9], ['ZSPD', ICAO, 566.8], ['ZYTX', ICAO, 346.9]]) {
    if (!ap[a]) continue;
    const d = nm(a, b);
    console.log(`  ${a}–${b}: ${d.toFixed(1)} nm (great circle), ${map(a, b).toFixed(1)} nm on the map`);
    assert.ok(Math.abs(d - want) < 2, `${a}–${b}: ${d.toFixed(1)} nm`);
    assert.ok(Math.abs(map(a, b) / d - 1) < 0.01, 'the map within 1 % of the great circle');
  }
});
