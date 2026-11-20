// v0.6.3: the checks shared by the north-east's three new airports (tests/v063-uhww.test.mjs, v063-zytx.test.mjs,
// v063-zytl.test.mjs), each baked as Yancheng was in v0.6.1 (tools/bake_region_airports.py, bake_region_patches.py)
// and listed as *pending* (the manifest's airportsPending / patchesPending / coastPatchesPending, read only with
// ?pending=1, FS_PENDING=1). With the region and pending on: the data's shape, the runway against its published or
// open secondary values (its length after the map frame's scale), the patch's flattening, the stands and which types
// get them, a route from every stand to a hold of every runway end, taxi-in after landing, every straight-in final's
// clearance over the terrain, and the routes. Holds whether the airport is pending or listed (airportsRegion).
// Skips cleanly while the data isn't there. Not a test file itself (no .test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setEastAsia, setPending, setGeoRules, terrainSpec, countryAt } from '../src/world/region.js';
import { createGeoRules } from '../src/world/geo-rules.js';
import { convergence, greatCircle, scaleFactor } from '../src/world/frame.js';
import { createAirports, pavementEnd, profileAt, runwayCrossings } from '../src/world/runways.js';
import { buildTaxiGraph, routeFromStand, snapToGraph, standsFor, regionRules } from '../src/ground/taxi.js';
import { standHeading, pointInPoly } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';

const DATA = new URL('../data/', import.meta.url);
export const has = (rel) => existsSync(new URL(rel, DATA));
export const load = (i) => JSON.parse(readFileSync(new URL(`airports/${i}.json`, DATA), 'utf8'));
const manifest = () => JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
const DEG = Math.PI / 180;
const NM = 1852;
const FT = 0.3048;
const wrapd = (a) => ((a + 540) % 360) - 180;
const dms = (s) => { const v = s.slice(0, -1), n = /[NS]/.test(s.slice(-1)) ? 2 : 3;
  return Number(v.slice(0, n)) + Number(v.slice(n, n + 2)) / 60 + Number(v.slice(n + 2)) / 3600; };
const part = (name) => {
  const header = JSON.parse(readFileSync(new URL(name + '.json', DATA), 'utf8'));
  const buf = gunzipSync(readFileSync(new URL(header.file, DATA)));
  return { header, values: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const readGz = async (rel) => { try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch (e) { return null; } };
const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
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
// z = a x + b y + c through the points' (x, y, elevM), least squares (bake_region_patches.py field_plane())
function lsqPlane(P) {
  const mx = P.reduce((s, p) => s + p.x, 0) / P.length, my = P.reduce((s, p) => s + p.y, 0) / P.length;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of P) { const x = p.x - mx, y = p.y - my; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * p.elevM; syz += y * p.elevM; sz += p.elevM; }
  const det = sxx * syy - sxy * sxy, a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det, c = sz / P.length;
  return (x, y) => c + a * (x - mx) + b * (y - my);
}
// v0.6.4 (cfg.fieldSurface 'runways'): each runway's straight profile between its ends, blended by 1 / (1 + d^2) of the
// distance to its centreline (bake_region_patches.py field_runways(), FIELD_RUNWAYS: Sendai, Niigata)
function runwaySurface(runways) {
  const R = runways.map((r) => { const [a, b] = r.ends, L = Math.hypot(b.x - a.x, b.y - a.y); return { a, b, L, ux: (b.x - a.x) / L, uy: (b.y - a.y) / L }; });
  return (x, y) => {
    let n = 0, d = 0;
    for (const { a, b, L, ux, uy } of R) {
      const t = Math.max(0, Math.min(L, (x - a.x) * ux + (y - a.y) * uy)), dd = Math.hypot(x - a.x - ux * t, y - a.y - uy * t), w = 1 / (1 + dd * dd);
      n += w * (a.elevM + ((b.elevM - a.elevM) * t) / L); d += w;
    }
    return n / d;
  };
}
const withPending = async (fn) => { setEastAsia(true); setPending(true); try { return await fn(); } finally { setPending(false); } };

// cfg: { icao, patch, coast (bool), shortName, name, latLon, elevM, runway: { id, lengthM, widthM, source }
//   (or runways: [{ id, lengthM, widthM, source }, ...] for more than one: v0.6.4, New Chitose),
//   ends: { ident: { elevFt, displacedM, ils, approachLights, approachLightsM (900 if absent), papi ('left' if absent), centreline (true if absent), tdz, papiDeg, pubMag, pubMagTol, thr: [lat, lon] | ['dms', 'dms'], thrTolM } },
//   stands: { min, max, refs (some that must exist), gates, e787 / e777: { min, max, include } },
//   alongRunway: { m, byEnd: { ident: m }, byStand: { ref: m }, reason } (the most a stand's route may run along a runway:
//     the largest of the stand's, the end's and the airport-wide m; 1 m if none is given),
//   identTolDeg (5 if absent: how far the magnetic heading may be from the ident's; v0.6.4, New Chitose's 01/19 read 002/182 M),
//   knownTaxiIn: { 'ident@frac': reason } (a landing with no exit ahead in OSM; logged, must stay so),
//   farHolds: { ident: { m, reason } } (v0.6.4: an end whose nearest hold in OSM's taxiways is over 600 m from it),
//   crossingProfile: true (v0.6.4: two runways cross: the shorter's ground checked against runwayCrossings()'s profile),
//   fieldSurface: 'runways' (v0.6.4: the field flattened to its runways' profiles, not a plane: FIELD_RUNWAYS),
//   lowFinals: { ident: reason } (ends whose 3° final is known to pass under 60 m over the ground; logged, not hidden),
//   routes: [[a, b, nm]], countries: [...] }
export function airportSuite(cfg) {
  const { icao: ICAO, patch: PATCH } = cfg;
  const HAVE = has(`airports/${ICAO}.json`) && has(`terrain/patch-${PATCH}.i16.gz`) && has('manifest.json');
  const skip = !HAVE && `${ICAO} data not baked`;
  const geo = HAVE ? createGeoRules({ magvar: part('magvar'), country: part('country') }) : null;
  const bootAirport = () => {
    const ap = load(ICAO);
    for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
    return ap;
  };
  const LISTED = HAVE && (manifest().airportsRegion || []).includes(`airports/${ICAO}.json`);
  const RUNWAYS = cfg.runways || [cfg.runway];

  test(`the manifest: ${ICAO} pending (unlisted without the switch) or in the region's list, never with the region off`, { skip }, () => {
    setEastAsia(true); setPending(false);
    const m = manifest();
    const off = terrainSpec(m, false), on = terrainSpec(m, true);
    assert.ok(!off.airports.some((f) => f.includes(ICAO)) && !off.patches.some((p) => p.id === PATCH), 'region off: neither');
    assert.ok(!off.coastPatches.some((p) => p.id === ICAO), 'region off: no coast patch');
    const pend = (m.airportsPending || []).includes(`airports/${ICAO}.json`), pendP = (m.patchesPending || []).some((p) => p.id === PATCH);
    if (LISTED) {
      assert.ok(on.airports.includes(`airports/${ICAO}.json`) && on.patches.some((p) => p.id === PATCH), 'listed with its patch');
      assert.ok(!pend && !pendP, 'not pending any more');
      if (cfg.coast) assert.ok((m.coastPatchesRegion || []).some((p) => p.id === ICAO), 'its coast patch listed');
    } else {
      assert.ok(pend && pendP, 'pending: the airport and its patch in the pending lists');
      if (cfg.coast) assert.ok((m.coastPatchesPending || []).some((p) => p.id === ICAO), 'its coast patch in coastPatchesPending');
      assert.ok(!on.airports.some((f) => f.includes(ICAO)) && !on.patches.some((p) => p.id === PATCH), 'pending: not listed without the switch');
      assert.ok(!on.coastPatches.some((p) => p.id === ICAO), 'pending: no coast patch without the switch');
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
    if (cfg.coast) {
      const c = (m.coastPatchesPending || []).concat(m.coastPatchesRegion || []).find((q) => q.id === ICAO);
      assert.ok(c, 'a coast patch in the manifest');
      assert.deepEqual(Object.keys(c), Object.keys(m.coastPatchesRegion[0]));
      assert.ok(has(c.coast), `${c.coast} on disk`);
    }
    const off = terrainSpec(m, false);
    assert.ok(!off.airports.some((f) => f.includes(ICAO)) && !off.patches.some((q) => q.id === PATCH), 'Korea\'s lists stay Korea\'s');
  }));

  test(`${ICAO}: the shape is Korea's (RKSI.json) and the region's, with its names`, { skip }, () => {
    const ap = load(ICAO), RKSI = load('RKSI'), ZSQD = load('ZSQD');
    assert.deepEqual(Object.keys(ap), Object.keys(ZSQD));
    assert.deepEqual(Object.keys(ap).filter((k) => k !== 'shortName'), Object.keys(RKSI));
    assert.equal(ap.icao, ICAO);
    assert.equal(ap.shortName, cfg.shortName);
    assert.equal(ap.name, cfg.name);
    for (const r of ap.runways) {
      assert.deepEqual(Object.keys(r), Object.keys(RKSI.runways[0]));
      for (const e of r.ends) assert.deepEqual(Object.keys(e), Object.keys(RKSI.runways[0].ends[0]));
    }
    for (const k of ['taxiways', 'aprons', 'stands', 'holdingPositions', 'buildings', 'serviceRoads']) assert.ok(ap[k].length > 0, `${k}: ${ap[k].length}`);
    assert.ok(Math.abs(ap.lat - cfg.latLon[0]) < 0.02 && Math.abs(ap.lon - cfg.latLon[1]) < 0.02);
    assert.ok(Math.abs(ap.elevM - cfg.elevM) < 0.1, `elevM ${ap.elevM}`);
    assert.ok(Math.abs(ap.magVarDeg - geo.wmmVar(ap.origin[0], ap.origin[1])) < 0.01, `magVarDeg ${ap.magVarDeg} is the WMM grid's`);
    if (cfg.pubVar !== undefined) assert.ok(Math.abs(ap.magVarDeg - cfg.pubVar) < 1, `magVarDeg ${ap.magVarDeg} vs the AIP's ${cfg.pubVar}`);
    assert.ok(regionRules(ap), 'the region\'s taxi rules apply');
  });

  test(`${ICAO}: runway ${RUNWAYS.map((q) => q.id).join(', ')}: its length after the frame's scale, width, ends, headings, lights (${RUNWAYS[0].source})`, { skip }, () => {
    const ap = load(ICAO);
    assert.deepEqual(ap.runways.map((r) => r.id), RUNWAYS.map((q) => q.id), 'the runways (nothing closed or under construction)');
    const { findRunwayEnd } = createAirports([ap]);
    for (const [r, want] of ap.runways.map((q, i) => [q, RUNWAYS[i]])) {
    const k = scaleFactor((r.ends[0].lat + r.ends[1].lat) / 2);
    const trueLen = r.lengthM / k;
    console.log(`  ${ICAO} ${r.id}: ${r.lengthM} map m, the frame's scale ${k.toFixed(5)}, so ${trueLen.toFixed(0)} m against ${want.lengthM} m (${((trueLen / want.lengthM - 1) * 100).toFixed(2)} %)`);
    assert.ok(Math.abs(trueLen / want.lengthM - 1) < 0.006, `${r.id}: ${trueLen.toFixed(0)} m vs ${want.lengthM} m`);
    assert.equal(r.widthM, want.widthM);
    const [e0, e1] = r.ends;
    assert.deepEqual([e0.ident, e1.ident], r.id.split('/'));
    const p0 = pavementEnd(e0), p1 = pavementEnd(e1);
    assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.y - p0.y) - r.lengthM) < 0.2, 'lengthM is the pavement\'s');
    for (const [e, o] of [[e0, e1], [e1, e0]]) {
      const c = cfg.ends[e.ident];
      const f = findRunwayEnd(ICAO, e.ident);
      assert.ok(f, `${e.ident}: findRunwayEnd`);
      assert.ok(Math.abs(e.displacedM - c.displacedM) < 0.5, `${e.ident}: displaced ${e.displacedM} m, want ${c.displacedM}`);
      assert.ok(Math.abs(f.ldaM - (r.lengthM - e.displacedM)) < 0.2);
      assert.ok(Math.abs(e.elevM - c.elevFt * FT) < 0.06, `${e.ident}: ${e.elevM} m, ${c.elevFt} ft`);
      assert.ok(Math.abs(wrapd(e.hdgGridDeg - (e.hdgTrueDeg - convergence(e.lon) / DEG))) < 0.02, `${e.ident}: grid vs true`);
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - (e.hdgTrueDeg - geo.wmmVar(e.x, e.y)))) < 0.02, `${e.ident}: mag = true - WMM`);
      assert.ok(Math.abs(wrapd(e.hdgTrueDeg - o.hdgTrueDeg - 180)) < 0.2, 'reciprocal');
      assert.ok(Math.abs(wrapd(e.hdgMagDeg - parseInt(e.ident, 10) * 10)) <= (cfg.identTolDeg ?? 5), `${e.ident}: ${e.hdgMagDeg} M rounds to its ident`);
      if (c.pubMag != null) assert.ok(Math.abs(wrapd(e.hdgMagDeg - c.pubMag)) < c.pubMagTol, `${e.ident}: ${e.hdgMagDeg} M vs the published ${c.pubMag}`);
      if (c.trueBrg !== undefined) assert.ok(Math.abs(wrapd(e.hdgTrueDeg - c.trueBrg)) < 0.1, `${e.ident}: true ${e.hdgTrueDeg} vs the published ${c.trueBrg}`);
      assert.equal(e.ils, c.ils, `${e.ident}: ILS`);
      assert.equal(e.approachLights, c.approachLights);
      assert.equal(e.approachLightsM, c.approachLightsM ?? 900);
      assert.equal(e.tdzLights, c.tdz);
      assert.equal(e.centrelineLights, c.centreline ?? true);
      assert.equal(e.papi, 'papi' in c ? c.papi : 'left');
      assert.equal(e.papiDeg, c.papiDeg);
      const [la, lo] = typeof c.thr[0] === 'string' ? c.thr.map(dms) : c.thr;
      const off = Math.hypot((la - e.lat) * 111320, (lo - e.lon) * 111320 * Math.cos(e.lat * DEG));
      assert.ok(off < c.thrTolM, `${e.ident}: the threshold ${off.toFixed(0)} m from the ${c.thrSource}'s`);
      console.log(`  ${e.ident}: true ${e.hdgTrueDeg.toFixed(2)}, magnetic ${e.hdgMagDeg.toFixed(2)} (WMM2025 ${geo.wmmVar(e.x, e.y).toFixed(2)}), ${e.elevM} m, displaced ${e.displacedM} m, ${off.toFixed(0)} m from the ${c.thrSource}'s threshold`);
    }
    }
  });

  test(`${ICAO}: the 30 m patch: the ground on the runway and at the stands`, { skip }, () => withPending(async () => {
    const { createTiledHeightfield } = await import('../src/world/heightfield.js');
    const m = manifest(), ap = load(ICAO);
    const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 60 });
    assert.ok(hf.layers.patches.some((p) => p.id === PATCH), 'the patch is loaded');
    await hf.tiles.whenReady(ap.origin[0], ap.origin[1], 12000, 'test');
    for (const rw of ap.runways) {
      const [e0, e1] = rw.ends;
      for (let f = 0; f <= 1.0001; f += 0.05) {
        // (cfg.crossingProfile, v0.6.4: two runways that cross: the shorter follows the longer's level across it, as
        // runwayCrossings() draws it, so its profile is the game's, not the straight line between its ends)
        const h = hf.heightAt(e0.x + (e1.x - e0.x) * f, e0.y + (e1.y - e0.y) * f),
          want = cfg.crossingProfile ? (runwayCrossings(ap), profileAt(rw, f * Math.hypot(e1.x - e0.x, e1.y - e0.y), ap.elevM)) : e0.elevM + (e1.elevM - e0.elevM) * f;
        assert.ok(Math.abs(h - want) < 0.6, `${rw.id} ${(f * 100).toFixed(0)} % along: ground ${h.toFixed(2)} m, the runway ${want.toFixed(2)} m`);
      }
    }
    const [e0, e1] = ap.runways[0].ends;
    // the field flattened to the plane through the runway's ends (bake_region_patches.py FIELD_PLANE): with one
    // runway that plane is level across it, so a stand stands at its projection's height on the runway
    const L = Math.hypot(e1.x - e0.x, e1.y - e0.y), ux = (e1.x - e0.x) / L, uy = (e1.y - e0.y) / L;
    const plane = cfg.fieldSurface === 'runways' ? runwaySurface(ap.runways) : ap.runways.length > 1 ? lsqPlane(ap.runways.flatMap((q) => q.ends))
      : (x, y) => e0.elevM + (e1.elevM - e0.elevM) * (((x - e0.x) * ux + (y - e0.y) * uy) / L);
    let worst = 0, steep = 0;
    for (const st of ap.stands) {
      const h = hf.heightAt(st.x, st.y);
      assert.ok(Math.abs(h - plane(st.x, st.y)) < 0.6, `stand ${st.ref}: ${h.toFixed(2)} m, the field's plane ${plane(st.x, st.y).toFixed(2)} m`);
      const d = [[20, 0], [-20, 0], [0, 20], [0, -20]].map(([dx, dy]) => hf.heightAt(st.x + dx, st.y + dy));
      const dz = Math.max(...d) - Math.min(...d);
      worst = Math.max(worst, dz);
      if (dz > 0.4) steep++;
      assert.ok(dz < 1.0, `stand ${st.ref}: ${dz.toFixed(2)} m across 40 m`);
    }
    console.log(`  ${ICAO}: ${ap.stands.length} stands on the field's plane, the steepest ${worst.toFixed(2)} m across 40 m (${steep} over 0.4 m)`);
  }));

  test(`${ICAO}: stands, which types get them, holds`, { skip }, () => withPending(() => {
    const ap = bootAirport(), S = cfg.stands;
    assert.ok(ap.stands.length >= S.min && ap.stands.length <= S.max, `${ap.stands.length} stands`);
    assert.equal(new Set(ap.stands.map((s) => s.ref)).size, ap.stands.length, 'every ref once');
    for (const ref of S.refs) assert.ok(ap.stands.some((s) => s.ref === ref), `stand ${ref}`);
    assert.equal(ap.stands.filter((s) => s.gate).length, S.gates, 'gates (jet bridges or gate nodes in OSM)');
    for (const s of ap.stands) {
      assert.ok(pointInPoly(s.x, s.y, ap.boundary), `${s.ref}: inside the aerodrome`);
      if (s.leadIn) assert.ok([s.leadIn[0], s.leadIn.at(-1)].some((L) => Math.hypot(L[0] - s.x, L[1] - s.y) < 0.5), `${s.ref}: the lead-in ends at the stop`);
    }
    assert.equal(standsFor(ap, typeById('a321neo')), ap.stands);
    for (const [t, want] of [['b787-9', S.e787], ['b777-300er', S.e777]]) {
      const list = standsFor(ap, typeById(t)).map((s) => s.ref);
      console.log(`  ${ICAO} ${t}: ${list.length} of ${ap.stands.length} stands: ${list.slice(0, 16).join(' ')}${list.length > 16 ? ' ...' : ''}`);
      assert.ok(list.length >= want.min && list.length <= want.max, `${t}: ${list.length} stands`);
      for (const ref of want.include || []) assert.ok(list.includes(ref), `${t} at stand ${ref}`);
      for (const ref of list) assert.ok(!want.only || want.only.includes(ref), `${t}: stand ${ref} is not on the published list`);
    }
    const g = buildTaxiGraph(ap);
    assert.ok(ap.holdingPositions.length >= 2 && ap.holdingPositions.every((h) => typeof h.ref === 'string'));
    assert.equal(g.holds.length, ap.holdingPositions.length, 'every hold snaps to the graph');
  }));

  test(`${ICAO}: from every stand a route to a hold of every runway end`, { skip }, () => withPending(() => {
    const ap = bootAirport(), g = buildTaxiGraph(ap), ENDS = ap.runways.flatMap((q) => q.ends);
    let n = 0, worst = 0, longest = 0;
    for (const st of ap.stands) for (const end of ENDS) {
      const rect = g.rects.find((q) => q.idents.includes(end.ident));
      const r = routeFromStand(g, st, end), at = `${st.ref} → ${end.ident}`;
      assert.ok(r && r.points.length >= 2, `${at}: a route`);
      assert.ok(r.hold, `${at}: ends at a hold`);
      for (let k = 1; k < r.points.length; k++) {
        const m = [(r.points[k - 1][0] + r.points[k][0]) / 2, (r.points[k - 1][1] + r.points[k][1]) / 2];
        assert.ok(snapToGraph(g, m[0], m[1]).d < 0.5, `${at}: leg ${k} on the graph`);
      }
      const h = r.points.at(-1);
      assert.ok(clM(rect, h) >= rect.half + 12, `${at}: hold ${clM(rect, h).toFixed(0)} m from the centreline`);
      const dEnd = Math.hypot(h[0] - end.x, h[1] - end.y);
      worst = Math.max(worst, dEnd);
      longest = Math.max(longest, r.lengthM);
      // (cfg.farHolds, v0.6.4: { ident: { m, reason } }: an end reached only from an intersection's hold; logged)
      const far = cfg.farHolds?.[end.ident];
      if (far && dEnd >= 600) console.log(`  ${at}: the hold ${dEnd.toFixed(0)} m from the end (allowed: ${far.reason})`);
      assert.ok(dEnd < (far?.m ?? 600), `${at}: the hold ${dEnd.toFixed(0)} m from the end`);
      const along = alongRunwayM(g, r.points);
      // (The review, 2026-11-21: the allowance was one number for the whole airport, so Niigata's 850 m for stand 10
      // also waved through any other route. It is by end and by stand now: byEnd[ident], byStand[ref], else m, else 1.)
      const AR = cfg.alongRunway || {};
      const allowM = Math.max(AR.byStand?.[st.ref] ?? 0, AR.byEnd?.[end.ident] ?? 0, AR.m ?? 0) || 1;
      if (along >= 1) console.log(`  ${at}: ${along.toFixed(0)} m along the runway (allowed ${allowM} m: ${AR.reason})`);
      assert.ok(along < allowM, `${at}: ${along.toFixed(0)} m along the runway (allowed ${allowM} m)`);
      n++;
    }
    assert.equal(n, ap.stands.length * ENDS.length);
    console.log(`  ${ICAO}: ${n} routes, the longest ${longest.toFixed(0)} m, the farthest hold ${worst.toFixed(0)} m from its end`);
  }));

  test(`${ICAO}: after landing, a taxi-in route from 30 to 90 % along every runway end`, { skip }, () => withPending(async () => {
    const { createGateFlow } = await import('../src/ground/gate-flow.js');
    const ap = load(ICAO);
    let n = 0;
    for (const [e, o] of ap.runways.flatMap((rw) => [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]])) {
      const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
      for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
        const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
        const r = gate.afterLanding(state);
        const at = `${e.ident} from ${frac * 100} %`;
        const known = cfg.knownTaxiIn?.[`${e.ident}@${frac}`];
        if (known) {
          // logged, not hidden: a landing whose taxi-in has no exit ahead in OSM's taxiways; it must still be so
          const al = r ? alongRunwayM(gate.graphFor(ICAO), r.points.slice(2)) : Infinity;
          console.log(`  ${at}: ${r ? al.toFixed(0) + ' m back along the runway' : 'no route'} (known: ${known})`);
          assert.ok(!r || al >= 200, `${at} is listed as known but now taxis in cleanly: take it off the list`);
          n++;
          continue;
        }
        assert.ok(r, `${at}: a route to a stand`);
        assert.equal(r.kind, 'in');
        const ahead = (r.points[1][0] - state.pos.x) * ux + (r.points[1][1] - state.pos.y) * uy;
        assert.ok(ahead > -15, `${at}: the exit ${ahead.toFixed(0)} m ahead`);
        const st = ap.stands.find((s) => s.ref === r.stand), end = r.points.at(-1);
        assert.ok(st && Math.hypot(end[0] - st.x, end[1] - st.y) < 120, `${at}: ends at stand ${r.stand}`);
        const al = alongRunwayM(gate.graphFor(ICAO), r.points.slice(2));
        assert.ok(al < 200, `${at}: ${al.toFixed(0)} m back along the runway after the exit`);
        n++;
      }
    }
    assert.equal(n, 10 * ap.runways.length);
  }));

  test(`${ICAO}: every straight-in 3° final clears the ground from 1 to 15 nm (60 m, as tests/v062-finals.test.mjs)`, { skip }, () => withPending(async () => {
    const { createTiledHeightfield } = await import('../src/world/heightfield.js');
    const m = manifest(), ap = load(ICAO);
    const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: [ap], readGz, readJson, layers: ['h'], maxTiles: 120 });
    const A = createAirports([ap]);
    for (const e of ap.runways.flatMap((q) => q.ends)) {
      const f = A.findRunwayEnd(ICAO, e.ident);
      await hf.tiles.whenReady(f.thrX - f.ux * 8 * NM, f.thrY - f.uy * 8 * NM, 9 * NM, 'test');
      let worst = Infinity, at = 0;
      for (let d = NM; d <= 15 * NM; d += 100) {
        const clear = f.elevM + 15 + Math.tan(3 * DEG) * d - hf.heightAt(f.thrX - f.ux * d, f.thrY - f.uy * d);
        if (clear < worst) { worst = clear; at = d; }
      }
      const low = cfg.lowFinals?.[e.ident];
      console.log(`  ${ICAO} ${e.ident}: the 3° final ${worst.toFixed(0)} m over the ground at its lowest, ${(at / NM).toFixed(1)} nm out${low ? ' (known: ' + low + ')' : ''}`);
      if (low) assert.ok(worst < 60, `${e.ident} is listed as low but clears by ${worst.toFixed(0)} m: take it off the list`);
      else assert.ok(worst >= 60, `${e.ident}: the straight-in final is ${worst.toFixed(0)} m over the ground ${(at / NM).toFixed(1)} nm out`);
    }
  }));

  test(`${ICAO}: the country by the raster`, { skip }, () => {
    setEastAsia(true);
    setGeoRules(geo);
    try {
      const ap = load(ICAO);
      const c = countryAt(ap.origin[0], ap.origin[1]);
      console.log(`  ${ICAO}: countryAt ${c}`);
      assert.ok(cfg.countries.includes(c), `${ICAO}: ${c}`);
      for (const e of ap.runways.flatMap((q) => q.ends)) assert.equal(countryAt(e.x, e.y), c);
    } finally { setGeoRules(null); }
  });

  test(`the routes from ${ICAO}`, { skip }, () => {
    for (const [a, b, want] of cfg.routes) {
      if (!has(`airports/${a}.json`) || !has(`airports/${b}.json`)) continue;
      const A = load(a), B = load(b);
      const d = greatCircle(A.lat, A.lon, B.lat, B.lon) / NM, map = Math.hypot(A.origin[0] - B.origin[0], A.origin[1] - B.origin[1]) / NM;
      console.log(`  ${a}–${b}: ${d.toFixed(1)} nm (great circle), ${map.toFixed(1)} nm on the map`);
      assert.ok(Math.abs(d - want) < 2, `${a}–${b}: ${d.toFixed(1)} nm`);
      assert.ok(Math.abs(map / d - 1) < 0.01, 'the map within 1 % of the great circle');
    }
  });
}
