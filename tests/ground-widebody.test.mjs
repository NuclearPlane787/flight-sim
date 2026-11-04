// Stands for widebodies (V030.md, Part 1 item 5): a code E type gets stands that fit at all three
// airports, the parked traffic keeps clear of it, its pushback has room, and the A321neo is untouched.
// The numbers below are a local mock: the Boeings' own data modules are Part 2's and Part 3's.
//   python3 tools/cpu-guard.py -- node --test tests/ground-widebody.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { createGateFlow, standList } from '../src/ground/gate-flow.js';
import { buildTaxiGraph, routeFromStand, snapToGraph, standsFor, pushMinBack, lineBehind } from '../src/ground/taxi.js';
import { createPushback } from '../src/ground/pushback.js';
import { placeParked, blockedByPlayer, standHeading, sizedFootprint, rectsOverlap, pointInPoly, WINGTIP_CLEARANCE, CLEAR } from '../src/world/traffic-layout.js';
import * as A321 from '../src/geometry.js';

const here = new URL('..', import.meta.url).pathname;
const ICAOS = ['RKSS', 'RKPC', 'RKSI'];
const load = (i) => JSON.parse(readFileSync(here + `data/airports/${i}.json`, 'utf8'));
// As main.js does at boot: stands without a lead-in take their heading from the taxi lines.
function bootAirport(i) {
  const ap = load(i);
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
  return ap;
}
const AP = Object.fromEntries(ICAOS.map((i) => [i, bootAirport(i)]));
const B789 = typeById('b787-9');
const B77W = typeById('b777-300er');
const A32N = typeById('a321neo');
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const sizeOf = (t) => ({ span: t.geo.SPAN, length: t.geo.LENGTH });

function flowFor(type, opts = {}) {
  const sim = createSim();
  const gate = createGateFlow({ sim, airports: Object.values(AP), ...opts });
  if (type) gate.setType(type);
  return { sim, gate };
}

test('standsFor: below code E, the same stands in the same order, and standList as ever', () => {
  for (const i of ICAOS) {
    const ap = AP[i];
    assert.equal(standsFor(ap, A32N), ap.stands, `${i}: the data's own array`);
    assert.equal(standsFor(ap, null), ap.stands);
    assert.deepEqual(standList(ap, A32N).map((s) => s.ref), standList(ap).map((s) => s.ref));
    assert.equal(standList(ap).length, ap.stands.filter((s) => s.ref).length);
  }
  assert.deepEqual(standsFor(null, B77W), [], 'no airport, no stands');
});

for (const i of ICAOS) {
  test(`${i}: code E stands exist, and each clears buildings and has a pushback line`, () => {
    const ap = AP[i], g = buildTaxiGraph(ap);
    for (const type of [B789, B77W]) {
      const list = standsFor(ap, type);
      assert.ok(list.length >= 5, `${i}: ${list.length} code E stands`);
      assert.ok(list.some((s) => s.gate), `${i}: at least one is a gate`);
      assert.equal(standsFor(ap, type), list, 'cached');
      for (const s of list) {
        const h = standHeading(ap, s);
        const parked = sizedFootprint({ span: 65, length: type.geo.LENGTH }, s.x, s.y, h);
        for (const b of ap.buildings) assert.ok(!pointInPoly(parked[0].cx, parked[0].cy, b.points), `${s.ref} in a building`);
        const rx = s.x - Math.sin(h) * type.geo.NOSE_X, ry = s.y - Math.cos(h) * type.geo.NOSE_X;
        const line = lineBehind(g, rx, ry, h, pushMinBack(type.geo));
        assert.ok(line, `${s.ref}: a taxi line behind`);
        assert.ok(line.s >= type.geo.LENGTH - type.geo.NOSE_X, `${s.ref}: the line (${line.s.toFixed(0)} m) is behind the tail`);
      }
      console.log(`  ${i} ${type.id}: ${list.length} of ${ap.stands.length} stands, ${list.filter((s) => s.gate).length} gates. First: ${list.slice(0, 8).map((s) => s.ref).join(' ')}`);
    }
  });

  test(`${i}: the first code E stand has a route to every runway end, and its pushback ends on the line (wheelbase 31 m)`, () => {
    const ap = AP[i], type = B77W;
    const { sim, gate } = flowFor(type);
    const ref = standsFor(ap, type)[0].ref;
    for (const rw of ap.runways) for (const end of rw.ends) {
      const r = gate.start({ origin: i, stand: ref, depRunway: end.ident, fuelKg: 40000, payloadKg: 30000 });
      assert.ok(r && r.points.length >= 2, `${ref} → ${end.ident}: a route`);
      assert.ok(routeFromStand(gate.graphFor(i), { x: r.points[0][0], y: r.points[0][1] }, end), 'routeFromStand');
      const s = sim.state, st = gate.stand;
      const nose = [s.pos.x + Math.sin(s.hdg) * type.geo.NOSE_X, s.pos.y + Math.cos(s.hdg) * type.geo.NOSE_X];
      assert.ok(d(nose, [st.x, st.y]) < 0.01, 'the type\'s nose on the stop mark');
      assert.ok(Math.abs(gate.pushback.state.radius) >= 12 * 31 / 16.91 - 1e-9, 'a turn the longer wheelbase can make');
      gate.onKey('pushback');
      for (let t = 0; t < 900 && gate.phase === 'pushback'; t += 0.1) gate.update(0.1, { yaw: 0 });
      assert.equal(gate.phase, 'taxi', `${ref} → ${end.ident}: pushback finished`);
      const at = snapToGraph(gate.graphFor(i), s.pos.x, s.pos.y);
      assert.ok(at.d < 8.5, `ends on the taxi lines (${at.d.toFixed(1)} m off)`);
      assert.ok(gate.route, 'a route after the pushback');
      assert.equal(gate.route.runway, end.ident);
      assert.ok(gate.route.points.length >= 2);
    }
  });

  test(`${i}: the parked traffic keeps clear of a code E aircraft`, () => {
    const ap = AP[i], parked = placeParked(ap);
    let freed = 0, n = 0;
    for (const s of standsFor(ap, B77W).filter((q) => q.gate).slice(0, 12)) {
      const hide = blockedByPlayer(ap, parked, s.ref, sizeOf(B77W));
      parked.forEach((p, k) => { if (p.stand === s.ref) assert.ok(hide.has(k), `${s.ref} itself is free`); });
      // Every parked aircraft left is outside wingtip clearance.
      const me = sizedFootprint(sizeOf(B77W), s.x, s.y, standHeading(ap, s), WINGTIP_CLEARANCE - CLEAR);
      parked.forEach((p, k) => { if (!hide.has(k)) for (const a of me) for (const b of p.fp) assert.ok(!rectsOverlap(a, b), `${s.ref}: ${p.stand} too close`); });
      freed += hide.size; n++;
    }
    assert.ok(n > 0);
    assert.ok(freed / n <= 6, `about ${(freed / n).toFixed(1)} freed per stand`);
    console.log(`  ${i}: ${(freed / n).toFixed(1)} parked aircraft freed per code E gate`);
    assert.equal(blockedByPlayer(ap, parked, 'no-such-stand', sizeOf(B77W)).size, 0);
  });

  test(`${i}: gate.pushPath frees what the pushback would run into`, () => {
    const ap = AP[i], parked = placeParked(ap), type = B77W;
    const { gate } = flowFor(type);
    const end = ap.runways[0].ends[0];
    gate.start({ origin: i, depRunway: end.ident, fuelKg: 40000, payloadKg: 30000 });
    const path = gate.pushPath();
    assert.ok(path.length > 3);
    assert.ok(d(path[0], [gate.stand.x, gate.stand.y]) < 1e-6, 'the path starts with the nose on the stop mark');
    const hide = blockedByPlayer(ap, parked, gate.stand.ref, { ...sizeOf(type), path });
    for (const [x, y, h] of path) {
      const fp = sizedFootprint(sizeOf(type), x, y, h);
      parked.forEach((p, k) => { if (!hide.has(k)) for (const a of fp) for (const b of p.fp) assert.ok(!rectsOverlap(a, b), `${p.stand} in the way`); });
    }
    console.log(`  ${i} ${gate.stand.ref}: ${hide.size} parked aircraft freed with the pushback's path`);
  });

  test(`${i}: after landing, a code E stand and the type's own nose for the arrival`, () => {
    const ap = AP[i], type = B77W;
    // Every stand taken: one still has to be offered (the traffic then frees it).
    const { sim, gate } = flowFor(type, { occupied: () => ap.stands.map((s) => s.ref) });
    const rw = ap.runways[0], [a, b] = rw.ends;
    const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const x = a.x + ux * len * 0.4, y = a.y + uy * len * 0.4, hdg = Math.atan2(ux, uy);
    sim.reset({ x, y, hdg, onGround: true, fuelKg: 8000 });
    sim.setGroundPose(x, y, hdg, 10);
    const r = gate.afterLanding(sim.state);
    assert.ok(r, 'a route');
    const st = standsFor(ap, type).find((s) => s.ref === r.stand);
    assert.ok(st, `stand ${r.stand} is a code E stand`);
    const h = st.hdgGridDeg * Math.PI / 180;
    // Placed as an A321neo would be, this aircraft's nose is 14 m past the mark: only its own counts.
    const nearNose = (noseX) => { sim.setGroundPose(st.x - Math.sin(h) * noseX, st.y - Math.cos(h) * noseX, h, 0); gate.update(1 / 60); return gate.phase; };
    assert.equal(nearNose(A321.NOSE_X), 'taxi-in', 'not arrived with the nose 14 m past the mark');
    assert.equal(nearNose(type.geo.NOSE_X), 'arrived');
  });
}

test('a stand the type can\'t use gives the nearest it can, and a usable one is kept', () => {
  const ap = AP.RKSS, type = B77W;
  const { gate } = flowFor(type);
  const usable = standsFor(ap, type);
  const refused = ap.stands.find((s) => s.ref === '505');
  assert.ok(refused && !usable.includes(refused), 'stand 505 (West apron: code B taxilanes) is refused');
  gate.start({ origin: 'RKSS', stand: '505', depRunway: '14R', fuelKg: 40000, payloadKg: 30000 });
  assert.ok(usable.includes(gate.stand));
  for (const s of usable) assert.ok(d([s.x, s.y], [refused.x, refused.y]) >= d([gate.stand.x, gate.stand.y], [refused.x, refused.y]) - 1e-9, 'the nearest');
  gate.start({ origin: 'RKSS', stand: '36', depRunway: '14R', fuelKg: 40000, payloadKg: 30000 });
  assert.equal(gate.stand.ref, '36', 'the International Terminal\'s stand stays');
  gate.start({ origin: 'RKSS', depRunway: '14R', fuelKg: 40000, payloadKg: 30000 });
  assert.equal(gate.stand.ref, '36', 'none asked for: the preferred gate');
});

test('a stand with two positions: the one that fits', () => {
  const ap = AP.RKSI, type = B77W, usable = standsFor(ap, type);
  const ref = usable.map((s) => s.ref).find((r) => ap.stands.filter((s) => s.ref === r).length > 1 && ap.stands.find((s) => s.ref === r) !== usable.find((s) => s.ref === r));
  assert.ok(ref, 'Incheon has one');
  const { gate } = flowFor(type);
  gate.start({ origin: 'RKSI', stand: ref, depRunway: '33L', fuelKg: 40000, payloadKg: 30000 });
  assert.ok(usable.includes(gate.stand), `${ref} is the position that fits`);
});

test('the pushback scales with the wheelbase; the A321neo\'s stays exactly as it was', () => {
  const st = { x: 100, y: 200, hdgGridDeg: 40 };
  const trace = (opts) => {
    const pb = createPushback(st, opts), out = [JSON.stringify(pb.state)];
    pb.toggle();
    for (let i = 0; i < 2000; i++) { const o = pb.update(1 / 60, {}); out.push(o.x, o.y, o.hdgGrid); if (o.done) break; }
    return out;
  };
  const line = { x: 150, y: 120, hdgGrid: 1.1 };
  assert.deepEqual(trace({}), trace({ wheelbase: A321.WHEELBASE }), 'no line');
  assert.deepEqual(trace({ line }), trace({ line, wheelbase: A321.WHEELBASE }), 'with a line');
  const def = createPushback(st, {}).state;
  assert.equal(def.radius, 25);
  assert.equal(def.straightM, 37.5);
  const big = createPushback(st, { wheelbase: 31 }).state;
  assert.ok(Math.abs(big.radius - 25 * 31 / 16.91) < 1e-9);
  assert.ok(Math.abs(big.straightM - 37.5 * 31 / 16.91) < 1e-9);
  // A close line: tighter, but never under the type's minimum.
  const close = createPushback(st, { wheelbase: 31, line: { x: 100 - Math.sin(40 * Math.PI / 180) * 25, y: 200 - Math.cos(40 * Math.PI / 180) * 25, hdgGrid: 40 * Math.PI / 180 + Math.PI / 2 } }).state;
  assert.ok(close.radius >= 12 * 31 / 16.91 - 1e-9, `radius ${close.radius}`);
  assert.equal(pushMinBack(A321), 30, 'the A321neo\'s 30 m stays');
  assert.ok(pushMinBack(B77W.geo) >= B77W.geo.LENGTH - B77W.geo.NOSE_X, 'past the 777\'s tail');
});

test('the A321neo through the gate flow: the same with no type, the sim\'s type, or setType', () => {
  for (const [i, dep] of [['RKSS', '14R'], ['RKPC', '07'], ['RKSI', '33L']]) {
    const refs = standList(AP[i]).filter((s) => s.gate).slice(0, 4).map((s) => s.ref);
    for (const ref of refs) {
      const plan = { origin: i, stand: ref, depRunway: dep, fuelKg: 6000, pax: 180 };
      const a = flowFor(null), b = flowFor(A32N);
      const noType = createSim();
      Object.defineProperty(noType, 'type', { value: undefined });   // a mock sim without one
      const c = createGateFlow({ sim: noType, airports: Object.values(AP) });
      const [ra, rb, rc] = [a.gate.start(plan), b.gate.start(plan), c.start(plan)];
      assert.deepEqual(rb.points, ra.points); assert.deepEqual(rc.points, ra.points);
      assert.deepEqual(b.gate.pushback.state, a.gate.pushback.state);
      assert.deepEqual(c.pushback.state, a.gate.pushback.state);
      assert.equal(a.gate.stand.ref, ref);
      assert.deepEqual(a.gate.serialize().pb, b.gate.serialize().pb);
    }
  }
});

test('a save of a code E flight comes back on the same stand with the same pushback', () => {
  const { sim, gate } = flowFor(B77W);
  const plan = { origin: 'RKSI', stand: standsFor(AP.RKSI, B77W)[0].ref, depRunway: '33L', fuelKg: 40000, payloadKg: 30000 };
  gate.start(plan);
  gate.onKey('pushback');
  for (let t = 0; t < 30; t += 0.1) gate.update(0.1, { yaw: 0 });
  const saved = JSON.parse(JSON.stringify(gate.serialize()));
  const g2 = flowFor(B77W).gate;
  g2.deserialize(saved, plan);
  assert.equal(g2.phase, 'pushback');
  assert.equal(g2.stand, gate.stand);
  assert.deepEqual(g2.pushback.state, gate.pushback.state);
  assert.ok(sim.state.pos.x);
});

// A report, not a limit: the sharpest bends in the routes, over one wheelbase's length, against
// the turn the nosewheel can make (the sim's STEER_TILLER, 75° on the A321neo's data).
test('the sharpest bends on the routes against a 31 m wheelbase', () => {
  const w = B77W.geo.WHEELBASE, steerMin = w / Math.sin(75 * Math.PI / 180);
  for (const i of ICAOS) {
    const ap = AP[i], g = buildTaxiGraph(ap);
    const s = standsFor(ap, B77W)[0];
    const h = standHeading(ap, s), L = lineBehind(g, s.x - Math.sin(h) * 35, s.y - Math.cos(h) * 35, h, pushMinBack(B77W.geo));
    let sharpest = Infinity;
    for (const rw of ap.runways) for (const end of rw.ends) {
      const P = routeFromStand(g, L, end).points;
      for (let k = 1; k < P.length - 1; k++) {
        // Heading in and out of this point, each over half a wheelbase of route.
        const walk = (dir) => {
          let j = k, left = w / 2, x = P[k][0], y = P[k][1];
          while (left > 0 && j + dir >= 0 && j + dir < P.length) {
            const q = P[j + dir], l = d([x, y], q);
            if (l >= left) { x += (q[0] - x) * left / l; y += (q[1] - y) * left / l; left = 0; } else { x = q[0]; y = q[1]; left -= l; j += dir; }
          }
          return [x, y];
        };
        const a = walk(-1), b = walk(1), m = P[k];
        const turn = Math.abs(wrap(Math.atan2(b[0] - m[0], b[1] - m[1]) - Math.atan2(m[0] - a[0], m[1] - a[1])));
        if (turn > 0.02) sharpest = Math.min(sharpest, (d(a, m) + d(m, b)) / turn);
      }
    }
    assert.ok(Number.isFinite(steerMin));
    console.log(`  ${i} stand ${s.ref}: sharpest route bend radius about ${sharpest.toFixed(0)} m over a wheelbase; the nosewheel can turn ${steerMin.toFixed(0)} m`);
  }
});
