// v0.6.3: Beijing Capital (ZBAA), baked as Yancheng was in v0.6.1 (tools/bake_region_airports.py ZBAA,
// tools/bake_region_patches.py patch beijing-capital) and listed as *pending*: the manifest's airportsPending /
// patchesPending, read only with ?pending=1 (FS_PENDING=1). With the region and pending on: the data's shape, the
// three runways against OurAirports (after the map frame's scale, +0.23 % here) and the open secondary sources'
// lights and ILS, the patch's flattening, the stands (code E where the geometry fits them), the holds, a route from
// every stand to a hold of every runway end, taxi-in after landing, China's rules and the new routes.
// Holds whether ZBAA is pending or listed (airportsRegion). Skips cleanly while the data isn't there.
//   python3 tools/cpu-guard.py -- node --test tests/v063-zbaa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setEastAsia, setPending, setGeoRules, terrainSpec, countryAt, rulesAt } from '../src/world/region.js';
import { createGeoRules } from '../src/world/geo-rules.js';
import { convergence, greatCircle, scaleFactor } from '../src/world/frame.js';
import { createAirports, pavementEnd } from '../src/world/runways.js';
import { buildTaxiGraph, routeFromStand, snapToGraph, standsFor, regionRules } from '../src/ground/taxi.js';
import { standHeading, pointInPoly } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { airportGroups } from '../src/ui/setup.js';

const ICAO = 'ZBAA', PATCH = 'beijing-capital';
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
// China's AIP not being readable): ALSF-II, TDZ and centreline lights at all six ends, one PAPI-4L an end.
const RUNWAYS = { '18L/36R': [3800, 60], '01/19': [3800, 60], '18R/36L': [3200, 50] };
const OA = { '01': [40.058914, 116.617599], '19': [40.092834, 116.612297], '18L': [40.089359, 116.594833],
  '36R': [40.055527, 116.600166], '18R': [40.102112, 116.569695], '36L': [40.073479, 116.574165] };
const ILS = { '01': 'II', '19': 'I', '18L': 'I', '36R': 'III', '18R': 'I', '36L': 'I' };
const ELEV_FT = { '01': 94, '19': 84, '18L': 110, '36R': 99, '18R': 116, '36L': 107 };

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
const withPending = async (fn) => { setEastAsia(true); setPending(true); try { return await fn(); } finally { setPending(false); } };

const LISTED = HAVE && (manifest().airportsRegion || []).includes(`airports/${ICAO}.json`);
test(`the manifest: ${ICAO} pending (unlisted without the switch) or in the region's list, never with the region off`, { skip }, () => {
  setEastAsia(true); setPending(false);
  const m = manifest();
  const off = terrainSpec(m, false), on = terrainSpec(m, true);
  assert.ok(!off.airports.some((f) => f.includes(ICAO)) && !off.patches.some((p) => p.id === PATCH), 'region off: neither');
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
  const m = manifest(), on = terrainSpec(m, true);
  assert.ok(on.airports.includes(`airports/${ICAO}.json`));
  const p = on.patches.find((q) => q.id === PATCH);
  assert.ok(p, 'the patch is listed');
  assert.deepEqual(Object.keys(p), Object.keys(m.patchesRegion[0]));
  assert.equal(p.cell, 30);
  assert.ok(Number.isInteger(p.x0) && Number.isInteger(p.y0) && p.x0 % 30 === 0 && p.y0 % 30 === 0, 'cell-aligned integers, as the others');
  const off = terrainSpec(m, false);
  assert.ok(!off.airports.some((f) => f.includes(ICAO)) && !off.patches.some((q) => q.id === PATCH), 'Korea\'s lists stay Korea\'s');
}));

test(`${ICAO}: the shape is Korea's (RKSI.json) and the region's, with its names`, { skip }, () => {
  const ap = load(ICAO), RKSI = load('RKSI'), ZSQD = load('ZSQD');
  assert.deepEqual(Object.keys(ap), Object.keys(ZSQD));
  assert.deepEqual(Object.keys(ap).filter((k) => k !== 'shortName'), Object.keys(RKSI));
  assert.equal(ap.icao, ICAO);
  assert.equal(ap.shortName, 'Beijing Capital');
  assert.equal(ap.name, 'Beijing Capital International Airport');
  for (const r of ap.runways) {
    assert.deepEqual(Object.keys(r), Object.keys(RKSI.runways[0]));
    for (const e of r.ends) assert.deepEqual(Object.keys(e), Object.keys(RKSI.runways[0].ends[0]));
  }
  for (const k of ['taxiways', 'aprons', 'stands', 'holdingPositions', 'buildings', 'serviceRoads']) assert.ok(ap[k].length > 0, `${k}: ${ap[k].length}`);
  assert.ok(ap.taxiways.filter((t) => t.ref).length > 100, 'OSM names its taxiways');
  assert.ok(ap.buildings.some((b) => b.kind === 'terminal' && b.name === 'Terminal 3') && ap.buildings.some((b) => b.name === 'Terminal 2'), 'T2 and T3');
  assert.ok(Math.abs(ap.lat - 40.077) < 0.02 && Math.abs(ap.lon - 116.597) < 0.02);
  assert.ok(Math.abs(ap.elevM - 35.4) < 0.1, `elevM ${ap.elevM}`);
  assert.ok(Math.abs(ap.magVarDeg - geo.wmmVar(ap.origin[0], ap.origin[1])) < 0.01, `magVarDeg ${ap.magVarDeg} is the WMM grid's`);
  assert.ok(regionRules(ap), 'the region\'s taxi rules apply');
});

test(`${ICAO}: three runways, 18L/36R, 01/19, 18R/36L: lengths after the frame's scale, headings, ends, lights`, { skip }, () => {
  const ap = load(ICAO);
  assert.deepEqual(ap.runways.map((r) => r.id).sort(), Object.keys(RUNWAYS).sort());
  const { findRunwayEnd } = createAirports([ap]);
  for (const r of ap.runways) {
    const [pub, width] = RUNWAYS[r.id];
    const k = scaleFactor((r.ends[0].lat + r.ends[1].lat) / 2);
    assert.ok(k > 1.002 && k < 1.0025, `the frame's scale at Beijing ${k}`);
    assert.ok(Math.abs(r.lengthM / k / pub - 1) < 0.004, `${r.id}: ${r.lengthM} map m = ${(r.lengthM / k).toFixed(0)} m vs ${pub} m`);
    assert.equal(r.widthM, width);
    const [e0, e1] = r.ends;
    assert.deepEqual([e0.ident, e1.ident], r.id.split('/'));
    const p0 = pavementEnd(e0), p1 = pavementEnd(e1);
    assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - r.lengthM) < 0.2);
    for (const [e, o] of [[e0, e1], [e1, e0]]) {
      assert.equal(e.displacedM, 0, `${e.ident}: no displaced threshold (OurAirports, the Gateway's scenery)`);
      assert.ok(Math.abs(e.elevM - ELEV_FT[e.ident] * 0.3048) < 0.06, `${e.ident}: ${e.elevM} m, OurAirports ${ELEV_FT[e.ident]} ft`);
      assert.ok(findRunwayEnd(ICAO, e.ident), `${e.ident}: findRunwayEnd`);
      assert.ok(Math.abs(wrapd(e.hdgGridDeg - (e.hdgTrueDeg - convergence(e.lon) / DEG))) < 0.02, `${e.ident}: grid vs true`);
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - (e.hdgTrueDeg - geo.wmmVar(e.x, e.y)))) < 0.02, `${e.ident}: mag = true - WMM`);
      assert.ok(Math.abs(wrapd(e.hdgTrueDeg - o.hdgTrueDeg - 180)) < 0.2, 'reciprocal');
      // WMM2025 here is about 7.6 deg W: true 173.1 / 353.1 is magnetic 180.7 / 000.7 (the idents 18 and 36, and 01/19
      // for the east runway, which China named apart from its parallels)
      const want = { '01': 0.8, '19': 180.8, '18L': 180.7, '36R': 0.7, '18R': 180.7, '36L': 0.7 }[e.ident];
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - want)) < 0.3, `${e.ident}: ${e.hdgMagDeg} M`);
      // the open secondary sources
      assert.equal(e.ils, ILS[e.ident], `${e.ident}: ILS`);
      assert.equal(e.approachLights, 'ALSF-II');
      assert.equal(e.approachLightsM, 900);
      assert.equal(e.tdzLights, true);
      assert.equal(e.centrelineLights, true);
      assert.equal(e.papi, 'left');
      assert.equal(e.papiDeg, 3);
      // OurAirports' ends (public domain) within 30 m of the thresholds, and its bearing within 0.3 deg
      const off = Math.hypot((OA[e.ident][0] - e.lat) * 111320, (OA[e.ident][1] - e.lon) * 111320 * Math.cos(e.lat * DEG));
      assert.ok(off < 30, `${e.ident}: ${off.toFixed(0)} m from OurAirports' end`);
      const [la, lo] = OA[e.ident], [lb, lob] = OA[o.ident];
      const brg = Math.atan2((lob - lo) * Math.cos(la * DEG), lb - la) / DEG;
      assert.ok(Math.abs(wrapd(e.hdgTrueDeg - brg)) < 0.3, `${e.ident}: true ${e.hdgTrueDeg} vs OurAirports ${brg.toFixed(2)}`);
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

test(`${ICAO}: stands (OSM's numbers), which types get stands (code E where the real airport parks them), holds`, { skip }, () => withPending(() => {
  const ap = bootAirport();
  assert.ok(ap.stands.length > 350, `${ap.stands.length} stands`);
  assert.equal(new Set(ap.stands.map((s) => s.ref)).size, ap.stands.length, 'every ref once');
  assert.ok(ap.stands.filter((s) => /^R\d+$/.test(s.ref)).length < 25, 'nearly all numbered by OSM or a gate');
  const B = ap.boundary;
  for (const s of ap.stands) {
    assert.ok(pointInPoly(s.x, s.y, B), `${s.ref}: inside the aerodrome`);
    // (OSM's lead-in ways run either way: the bake keeps their order, and the stop is the end nearer no taxi line)
    if (s.leadIn) assert.ok([s.leadIn[0], s.leadIn.at(-1)].some((L) => Math.hypot(L[0] - s.x, L[1] - s.y) < 0.5), `${s.ref}: the lead-in ends at the stop`);
  }
  assert.equal(standsFor(ap, typeById('a321neo')), ap.stands);
  const e787 = standsFor(ap, typeById('b787-9')).map((s) => s.ref), e777 = standsFor(ap, typeById('b777-300er')).map((s) => s.ref);
  assert.ok(e787.length > 250 && e777.length > 250, `code E: 787 ${e787.length}, 777 ${e777.length}`);
  // Terminal 3's piers (T3C 5xx contact stands, T3E 4xx/3xx) and Terminal 2's 2xx: the widebody gates
  for (const ref of ['501', '505', '525', '535', '307', '321', '451', '208', '214']) assert.ok(e777.includes(ref), `777 at stand ${ref}`);
  const g = buildTaxiGraph(ap);
  assert.ok(ap.holdingPositions.length >= 30 && ap.holdingPositions.every((h) => h.est === true && typeof h.ref === 'string'), 'OSM maps none: made ([EST])');
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
  assert.equal(n, ap.stands.length * 6);
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
  assert.equal(n, 30);
}));

test(`${ICAO}: China by the country raster, China's rules`, { skip }, () => {
  setEastAsia(true);
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

test(`${ICAO} in the setup: China's first, then Daxing, then Pudong`, { skip }, () => {
  const aps = ['RKSI', 'ZSPD', 'ZSSS', ICAO].map(load);
  const cn = airportGroups(aps).find((x) => x.country === 'CN');
  assert.deepEqual(cn.airports.map((a) => a.icao), [ICAO, 'ZSPD', 'ZSSS']);
});

test('the new routes: Incheon, Pudong and (once baked) Shenyang to Beijing Capital', { skip }, () => {
  const ids = ['RKSI', 'ZSPD', ICAO].concat(has('airports/ZYTX.json') ? ['ZYTX'] : []);
  const ap = Object.fromEntries(ids.map((i) => [i, load(i)]));
  const nm = (a, b) => greatCircle(ap[a].lat, ap[a].lon, ap[b].lat, ap[b].lon) / NM;
  const map = (a, b) => Math.hypot(ap[a].origin[0] - ap[b].origin[0], ap[a].origin[1] - ap[b].origin[1]) / NM;
  for (const [a, b, want] of [['RKSI', ICAO, 486.8], ['ZSPD', ICAO, 593.3], ['ZYTX', ICAO, 326.4]]) {
    if (!ap[a]) continue;
    const d = nm(a, b);
    console.log(`  ${a}–${b}: ${d.toFixed(1)} nm (great circle), ${map(a, b).toFixed(1)} nm on the map`);
    assert.ok(Math.abs(d - want) < 2, `${a}–${b}: ${d.toFixed(1)} nm`);
    assert.ok(Math.abs(map(a, b) / d - 1) < 0.01, 'the map within 1 % of the great circle');
  }
});
