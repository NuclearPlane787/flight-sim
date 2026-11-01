// Taxiway lights (src/world/taxilights.js): colours, stop bars at the runway holds, and
// every light on taxiway pavement, none on a runway.
//   node --test games/flight-sim/tests/taxilights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taxiLightLayout, floodMasts } from '../src/world/taxilights.js';
import { holdShortSites, segmentIndex, segDist, runwayLines, TAXI_W } from '../src/world/apron-geom.js';
import { buildTaxiGraph, holdingPointFor } from '../src/ground/taxi.js';
import { RUNWAY_SHOULDER_M } from '../src/world/runways.js';

const load = (icao) => JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url)));
const AIRPORTS = ['RKSI', 'RKSS', 'RKPC'].map((k) => [k, load(k)]);
const LAYOUT = new Map(AIRPORTS.map(([k, a]) => [k, taxiLightLayout(a)]));

// How far (x, y) lies outside the nearest taxiway's pavement (negative: inside).
function outsideTaxiway(a, x, y) {
  let best = Infinity;
  for (const tw of a.taxiways) for (let i = 0; i < tw.points.length - 1; i++) {
    const [ax, ay] = tw.points[i], [bx, by] = tw.points[i + 1];
    best = Math.min(best, segDist(x, y, ax, ay, bx, by).d - (tw.widthM || TAXI_W) / 2);
  }
  return best;
}
function runwayUV(l, x, y) {
  return { u: (x - l.ax) * l.ux + (y - l.ay) * l.uy, v: -(x - l.ax) * l.uy + (y - l.ay) * l.ux };
}

test('each kind has its colour: centre green, edge blue, stop bars red', () => {
  const want = { centre: 'green', edge: 'blue', stopbar: 'red' };
  for (const [k, L] of LAYOUT) {
    const counts = { centre: 0, edge: 0, stopbar: 0 };
    for (const l of L) {
      assert.equal(l.color, want[l.kind], `${k}: a ${l.kind} light is ${l.color}`);
      assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y));
      counts[l.kind]++;
    }
    for (const kind of Object.keys(want)) assert.ok(counts[kind] > 0, `${k}: no ${kind} lights`);
  }
});

test('centreline lights about every 30 m on straights, never closer than 7 m', () => {
  // A straight 600 m taxiway far from any runway: 21 lights, 30 m apart.
  const a = { runways: [], taxiways: [{ widthM: 23, points: [[0, 0], [600, 0]] }], aprons: [], stands: [] };
  const c = taxiLightLayout(a).filter((l) => l.kind === 'centre').sort((p, q) => p.x - q.x);
  assert.equal(c.length, 21);
  for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i].x - c[i - 1].x - 30) < 0.5);
  // A 90° bend of radius 60 m: spaced at 15 m through the curve.
  const arc = [];
  for (let k = 0; k <= 18; k++) { const t = (k / 18) * Math.PI / 2; arc.push([60 * Math.sin(t), 60 - 60 * Math.cos(t)]); }
  const b = taxiLightLayout({ runways: [], taxiways: [{ widthM: 23, points: arc }], aprons: [], stands: [] }).filter((l) => l.kind === 'centre');
  assert.ok(b.length >= 6, `only ${b.length} lights in a 94 m bend`);
});

test('stop bars at the holds of every runway at all three airports', () => {
  for (const [k, a] of AIRPORTS) {
    const L = LAYOUT.get(k), bars = L.filter((l) => l.kind === 'stopbar');
    const holds = holdShortSites(a, segmentIndex(a.taxiways)).filter((h) => h.pattern === 'A');
    // ... and the taxi graph's departure holds (where the aircraft stops).
    const g0 = buildTaxiGraph(a);
    for (const r of a.runways) for (const e of r.ends) { const h = holdingPointFor(g0, e); if (h) holds.push(h); }
    // Each stop-bar light is a few metres from a painted runway hold-short.
    for (const l of bars) {
      const d = Math.min(...holds.map((h) => Math.hypot(h.x - l.x, h.y - l.y)));
      assert.ok(d < (TAXI_W / 2 + 15), `${k}: a stop-bar light ${d.toFixed(0)} m from any hold (painted or the taxi graph's)`);
    }
    // Every runway has stop bars beside it.
    for (const [ri, l] of runwayLines(a).entries()) {
      const near = bars.filter((b) => { const q = runwayUV(l, b.x, b.y); return q.u > -300 && q.u < l.len + 300 && Math.abs(q.v) < 200; });
      assert.ok(near.length > 0, `${k} ${a.runways[ri].id}: no stop bars`);
    }
    // The holding point the departures taxi to (taxi.js) has a stop bar within 40 m.
    const g = buildTaxiGraph(a);
    for (const r of a.runways) for (const e of r.ends) {
      const h = holdingPointFor(g, e);
      // (Jeju 13 has no taxiway hold: the graph falls back to the runway end itself.)
      if (!h || runwayLines(a).some((l) => { const q = runwayUV(l, h.x, h.y); return q.u >= 0 && q.u <= l.len && Math.abs(q.v) < l.hw; })) continue;
      const d = Math.min(...bars.map((b) => Math.hypot(b.x - h.x, b.y - h.y)));
      assert.ok(d < 40, `${k} ${e.ident}: departure hold ${d.toFixed(0)} m from a stop bar`);
    }
  }
});

test('lights sit on taxiway pavement, none on a runway', () => {
  for (const [k, a] of AIRPORTS) {
    const lines = runwayLines(a);
    for (const l of LAYOUT.get(k)) {
      const out = outsideTaxiway(a, l.x, l.y);
      const slack = l.kind === 'edge' ? 1.5 : 0.5;
      assert.ok(out <= slack, `${k}: a ${l.kind} light ${out.toFixed(1)} m off the taxiway pavement`);
      for (const r of lines) {
        const q = runwayUV(r, l.x, l.y);
        // (A stop bar may stand on the shoulder where the taxi graph holds at the edge.)
        const on = q.u > 0 && q.u < r.len && Math.abs(q.v) < r.hw + (l.kind === 'stopbar' ? 0 : RUNWAY_SHOULDER_M);
        assert.ok(!on, `${k}: a ${l.kind} light on a runway`);
      }
    }
  }
});

test('heights come from the heightfield when one is given', () => {
  const [, a] = AIRPORTS[2];
  const L = taxiLightLayout(a, { heightAt: () => 12 });
  assert.ok(L.every((l) => l.z === 12.25));
});

test('floodlight masts: some at every airport, none near a runway', () => {
  for (const [k, a] of AIRPORTS) {
    const m = floodMasts(a);
    assert.ok(m.length > 10, `${k}: ${m.length} masts`);
    for (const p of m) for (const r of runwayLines(a)) {
      const q = runwayUV(r, p.x, p.y);
      assert.ok(!(q.u > 0 && q.u < r.len && Math.abs(q.v) < r.hw + 60), `${k}: a mast by a runway`);
    }
  }
});

// The runway lights' colours (src/world/airports.js lightLayout), for a pilot heading each way.
// colA shows to a viewer on the side the light's `dir` points to, colB to the other side.
test('runway lights: edge yellow in the last 600 m, centreline red/white then red, threshold green, end red', async () => {
  const { lightLayout } = await import('../src/world/airports.js');
  const { createAirports, pavementEnd } = await import('../src/world/runways.js');
  const { airports } = createAirports([load('RKPC')]);
  const a = airports[0], r = a.runways.find((q) => q.id === '07/25');
  const L = lightLayout({ ...a, runways: [r] }, null);
  const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]);
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / len, uy = (p1.y - p0.y) / len;
  const uv = (l) => ({ u: (l.x - p0.x) * ux + (l.y - p0.y) * uy, v: -(l.x - p0.x) * uy + (l.y - p0.y) * ux });
  const is = (c, name) => {
    const k = { white: [1.0, 0.95, 0.85], yellow: [1.0, 0.72, 0.18], red: [1.0, 0.08, 0.04], green: [0.15, 1.0, 0.35], none: [0, 0, 0] }[name];
    return c.every((x, i) => Math.abs(x - k[i]) < 1e-6);
  };
  let edges = 0, cls = 0, thr = 0;
  for (const l of L) {
    const { u, v } = uv(l);
    const along = l.dir[0] * ux + l.dir[1] * uy;          // +1: colA faces end 1's side
    // Colour for a pilot rolling towards end 1 (seen from smaller u) and towards end 0.
    const toEnd1 = along > 0 ? l.colB : l.colA, toEnd0 = along > 0 ? l.colA : l.colB;
    if (l.kind === 0 && Math.abs(Math.abs(v) - (r.widthM / 2 + 1.5)) < 0.01) {
      edges++;
      assert.ok(is(toEnd1, len - u < 600 ? 'yellow' : 'white'), `edge at u ${u.toFixed(0)} towards end 1`);
      assert.ok(is(toEnd0, u < 600 ? 'yellow' : 'white'), `edge at u ${u.toFixed(0)} towards end 0`);
    }
    if (l.kind === 1 && Math.abs(v - 0.6) < 0.01) {
      cls++;
      const d1 = len - u, d0 = u;
      if (d1 < 299.5) assert.ok(is(toEnd1, 'red'));
      else if (d1 > 900.5) assert.ok(is(toEnd1, 'white'));
      else assert.ok(is(toEnd1, 'red') || is(toEnd1, 'white'));
      if (d0 < 299.5) assert.ok(is(toEnd0, 'red'));
      else if (d0 > 900.5) assert.ok(is(toEnd0, 'white'));
    }
    // Threshold / end bars at a pavement end (no displacement here): green to the approach, red to the runway.
    if (l.kind === 1 && (Math.abs(u) < 0.01 || Math.abs(u - len) < 0.01) && l.size === 0.8) {
      thr++;
      const outward = u < 1 ? -1 : 1;                       // the approach side, in u
      const towardsApproach = Math.sign(along) === outward;
      assert.ok(is(towardsApproach ? l.colA : l.colB, 'green'), 'threshold green to the approach');
      assert.ok(is(towardsApproach ? l.colB : l.colA, 'red'), 'end red to the runway');
    }
  }
  assert.ok(edges > 50 && cls > 100 && thr > 20, `${edges} edge, ${cls} centreline, ${thr} threshold lights`);
  // The approach lights carry a rabbit (sequenced flashers, kind 3), and the PAPI four units.
  assert.ok(L.filter((l) => l.kind === 3).length >= 10);
  assert.equal(L.filter((l) => l.kind === 2).length, 4 * 2);   // 07 and 25, both PAPIs on the left
});
