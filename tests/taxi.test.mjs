// Taxi graph, routing and pushback. Run from the game folder:
//   python3 tools/cpu-guard.py -- node --test tests/taxi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildTaxiGraph, routeFromStand, routeToStand, freeStand, snapToGraph } from '../src/ground/taxi.js';
import { createPushback } from '../src/ground/pushback.js';

const here = new URL('..', import.meta.url).pathname;

// A small synthetic airport: runway 09/27 along y = −150, a grid of taxiways
// north of it (ends left ~10 m short of each other to test snapping), two
// connectors with holding points, and one taxiway that crosses the runway.
const synth = {
  runways: [{ id: '09/27', widthM: 45, ends: [{ ident: '09', x: -100, y: -150 }, { ident: '27', x: 800, y: -150 }] }],
  taxiways: [
    { ref: 'A', points: [[-50, 0], [300, 0], [750, 0]] },
    { ref: 'B', points: [[-40, 200], [740, 200]] },            // ends 10 m short of C and G
    { ref: 'C', points: [[-50, 0], [-50, 200]] },
    { ref: 'D', points: [[300, -8], [300, 210]] },             // overshoots both ends a bit
    { ref: 'G', points: [[750, -110], [750, 200]] },
    { ref: 'F', points: [[-50, 0], [-50, -110]] },
    { ref: 'H', points: [[400, 0], [400, -300]] },             // crosses the runway
    { ref: 'K', points: [[400, -300], [800, -300]] },
  ],
  holdingPositions: [{ ref: 'F1', x: -50, y: -92 }, { ref: 'G1', x: 752, y: -92 }],
  stands: [
    { ref: '1', x: 100, y: 300, hdgGridDeg: 0, gate: true },
    { ref: '2', x: 500, y: 300, hdgGridDeg: 0, gate: true },
    { ref: 'R1', x: 600, y: 300, hdgGridDeg: 0, gate: false },
  ],
};

const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function checkRoute(graph, r, goal, label) {
  assert.ok(r, `${label}: a route`);
  assert.ok(r.points.length >= 2, `${label}: ≥ 2 points`);
  let sum = 0;
  for (let i = 1; i < r.points.length; i++) {
    const step = d(r.points[i - 1], r.points[i]);
    assert.ok(step > 0, `${label}: no repeated points`);
    // Connected: every leg lies along a graph edge (its midpoint is on the graph).
    const m = [(r.points[i - 1][0] + r.points[i][0]) / 2, (r.points[i - 1][1] + r.points[i][1]) / 2];
    assert.ok(snapToGraph(graph, m[0], m[1]).d < 0.5, `${label}: leg ${i} on the graph`);
    sum += step;
    // Monotone: no U-turns between consecutive legs.
    if (i >= 2) {
      const a = r.points[i - 2], b = r.points[i - 1], c = r.points[i];
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      assert.ok(dot > -0.9 * d(a, b) * d(b, c), `${label}: no reversal at point ${i - 1}`);
    }
  }
  assert.ok(Math.abs(sum - r.lengthM) < 0.01, `${label}: lengthM matches`);
  if (goal) assert.ok(d(r.points[r.points.length - 1], goal) < 1, `${label}: ends at the goal`);
}

test('synthetic graph: snapping, crossings, holds', () => {
  const g = buildTaxiGraph(synth);
  assert.equal(g.holds.length, 2);
  assert.ok(g.runwayCrossings.some(c => c.runway === '09/27'), 'H crosses the runway');
  // B's west end (10 m from C) joined C: one node near (-50, 200) with degree ≥ 2.
  const corner = g.nodes.filter(n => !n.dead && Math.hypot(n.x + 50, n.y - 200) < 15);
  assert.equal(corner.length, 1);
  assert.ok(corner[0].edges.length >= 2);
});

test('synthetic route to 09 ends at F1 and avoids the runway', () => {
  const g = buildTaxiGraph(synth);
  const r = routeFromStand(g, synth.stands[0], synth.runways[0].ends[0]);
  checkRoute(g, r, [-50, -92], '09');
  assert.equal(r.hold.ref, 'F1');
  assert.deepEqual(r.crossings, []);
  assert.equal(r.refs[0], 'B');
  assert.equal(r.refs[r.refs.length - 1], 'F');
  // Shortest: stand 1 projects to (100, 200); B west 150, C 200, F 92 → 442 m.
  assert.ok(Math.abs(r.lengthM - 442) < 15, `length ${r.lengthM}`);
});

test('synthetic route to 27 ends at G1', () => {
  const g = buildTaxiGraph(synth);
  const r = routeFromStand(g, synth.stands[1], synth.runways[0].ends[1]);
  checkRoute(g, r, [750, -92], '27');
  assert.equal(r.hold.ref, 'G1');
  assert.deepEqual(r.refs, ['B', 'G']);
});

test('routeToStand and freeStand', () => {
  const g = buildTaxiGraph(synth);
  const s = freeStand(synth, ['1']);
  assert.equal(s.ref, '2');
  assert.equal(freeStand(synth, new Set(['1', '2'])).ref, 'R1');
  assert.equal(freeStand(synth, ['1', '2', 'R1']), null);
  assert.equal(freeStand(synth, [], [520, 300]).ref, '2');
  const r = routeToStand(g, [750, -100], s);
  checkRoute(g, r, [500, 200], 'in');
  // Same-edge case.
  const r2 = routeToStand(g, [450, 200], s);
  assert.equal(r2.points.length, 2);
  assert.ok(Math.abs(r2.lengthM - 50) < 0.01);
});

test('pushback: straight back, turn, stop', () => {
  const stand = { x: 100, y: 300, hdgGridDeg: 0 };
  const pb = createPushback(stand, { line: { x: 100, y: 200, hdgGrid: Math.PI / 2 }, preferHdgGrid: -Math.PI / 2 });
  let out = pb.update(0.1, {});
  assert.equal(out.x, 100); assert.equal(out.y, 300);           // idle until P
  pb.toggle();
  let t = 0, maxV = 0, straightDone = false;
  while (!out.done && t < 600) {
    out = pb.update(0.1, {}); t += 0.1; maxV = Math.max(maxV, out.speed);
    if (!straightDone && out.phase === 'straight') assert.ok(Math.abs(out.x - 100) < 1e-6, 'straight back');
    if (out.phase !== 'straight') straightDone = true;
  }
  assert.ok(out.done, 'finishes');
  assert.ok(Math.abs(maxV - 1.5) < 1e-6, '1.5 m/s');
  assert.ok(Math.abs(Math.atan2(Math.sin(out.hdgGrid + Math.PI / 2), Math.cos(out.hdgGrid + Math.PI / 2))) < 1e-6, 'facing west');
  assert.ok(Math.abs(out.y - 200) < 3, `on the line (y ${out.y.toFixed(1)})`);
});

test('pushback: P pauses, Q/E bias the turn', () => {
  const stand = { x: 0, y: 0, hdgGridDeg: 0 };
  const run = steer => {
    const pb = createPushback(stand, {}); pb.toggle();
    let o; for (let i = 0; i < 1500; i++) o = pb.update(0.1, { steer });
    return o;
  };
  const a = run(0), q = run(-1), e = run(1);
  assert.ok(a.done && q.done && e.done);
  // The default turn is to the left (heading decreasing); Q tightens it, E widens it.
  const r = o => Math.hypot(o.x, o.y);
  assert.ok(r(q) < r(a) && r(a) < r(e), `radii ${r(q)} ${r(a)} ${r(e)}`);
  const pb = createPushback(stand, {}); pb.toggle();
  for (let i = 0; i < 50; i++) pb.update(0.1, {});
  pb.update(0.1, { p: true });                                // P: stop
  let o; for (let i = 0; i < 100; i++) o = pb.update(0.1, {});
  assert.equal(o.speed, 0); assert.ok(!o.done);
  const y0 = o.y; o = pb.update(0.1, {}); assert.equal(o.y, y0, 'held');
});

for (const icao of ['RKSS', 'RKPC', 'RKSI']) {
  const file = here + `data/airports/${icao}.json`;
  const ap = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const ok = ap && ap.taxiways && ap.taxiways.length && ap.stands && ap.stands.length;
  test(`real ${icao}`, { skip: ok ? false : 'no airport JSON with taxiways and stands yet' }, () => {
    const g = buildTaxiGraph(ap);
    console.log(`${icao}: ${ap.taxiways.length} taxiways → ${g.nodes.length} nodes, ${g.edges.filter(e => !e.dead).length} edges, ${g.holds.length}/${(ap.holdingPositions || []).length} holds, ${g.runwayCrossings.length} runway-crossing edges, ${ap.stands.length} stands`);
    const stand = freeStand(ap, []);
    // Every runway end must route. Jeju's secondary runway 13/31: in OSM its taxiways form
    // small pieces that join the main network only across runway pavement, so those routes
    // cross or backtrack on 13/31 (the graph's runway centreline chain).
    for (const rw of ap.runways) for (const end of rw.ends) {
      const r = routeFromStand(g, stand, end);
      assert.ok(r, `${icao} ${end.ident}: route`);
      if (icao === 'RKPC' && rw.id === '13/31') assert.ok(r.crossings.includes('13/31'), 'Jeju 13/31 is reached over its pavement');
      checkRoute(g, r, [r.hold.x, r.hold.y], `${icao} ${end.ident}`);
      assert.ok(d(r.points[r.points.length - 1], [end.x, end.y]) < 1500, 'hold near the runway end');
      console.log(`  stand ${stand.ref} → ${end.ident}: ${r.lengthM.toFixed(0)} m via ${r.refs.join(' ')} to ${r.hold.ref ?? '(no hold)'}${r.crossings.length ? ', crosses ' + r.crossings.join(',') : ''}`);
    }
  });
}
