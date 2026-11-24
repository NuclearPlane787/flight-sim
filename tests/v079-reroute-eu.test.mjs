// v0.7.9 part 4, Prague's stand 3 to 24 (the lead, after the `taxi` subagent's diagnosis): the route planned after a
// pushback could leave BEHIND the nose where two ways to the runway are nearly as long (Prague's Z ring: 588 m one
// way, 586 m the other), and the aircraft had to turn round in the junction; the airports' day run left the pavement
// there (49 of 515 samples). gate-flow.js reroute() now plans from further along the taxiway the nose points down
// (REROUTE_*), and routeOffNose() measures a route's first leg against a heading.
//   FS_REGION=europe node --test tests/v079-reroute-eu.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { createSim } = await import('../src/sim/sim.js');
  const { createGateFlow, routeOffNose, routeTurnsBack, REROUTE_OFF_NOSE, REROUTE_REACH_M, REROUTE_MORE_M, REROUTE_TURN_DEG, REROUTE_TURN_M } = await import('../src/ground/gate-flow.js');
  const { buildTaxiGraph, routeFromStand, snapToGraph } = await import('../src/ground/taxi.js');
  const load = (i) => JSON.parse(readFileSync(new URL(`../data/europe/airports/${i}.json`, import.meta.url), 'utf8'));
  const DEG = Math.PI / 180;
  // A gate start at a stand, the pushback run to its end: the sim, the flow and the route shown for the taxi.
  const pushed = (ap, ref, end) => {
    const sim = createSim(), gate = createGateFlow({ sim, airports: [ap] });
    const r0 = gate.start({ origin: ap.icao, stand: ref, depRunway: end, fuelKg: 9000, payloadKg: 9000 });
    assert.ok(r0 && gate.phase === 'parked', `${ap.icao} ${ref}: a gate start`);
    gate.onKey('pushback');
    for (let t = 0; t < 900 && gate.phase === 'pushback'; t += 0.1) gate.update(0.1, { yaw: 0 });
    assert.equal(gate.phase, 'taxi', `${ap.icao} ${ref}: the pushback finished`);
    return { sim, gate };
  };

  test('routeOffNose: the first leg of over 3 m against a heading, in degrees', () => {
    const r = { points: [[0, 0], [0, 1], [0, 2], [10, 2], [10, 50]] };     // 2 m north, then east
    assert.ok(Math.abs(routeOffNose(r, 90 * DEG) - 0) < 12, 'the first leg over 3 m runs east-north-east');
    assert.ok(routeOffNose(r, 270 * DEG) > 168);
    assert.equal(routeOffNose({ points: [[0, 0], [0, 100]] }, 0), 0);
    assert.equal(Math.round(routeOffNose({ points: [[0, 0], [0, 100]] }, 180 * DEG)), 180);
    assert.equal(Math.round(routeOffNose({ points: [[0, 0], [100, 0]] }, 0)), 90);
    assert.equal(routeOffNose({ points: [[0, 0]] }, 1), 0); assert.equal(routeOffNose(null, 1), 0);
    assert.equal(REROUTE_OFF_NOSE, 90);
  });

  test('Prague, stand 3 to 24: after the pushback the route leaves ahead of the nose, where it left 180 degrees behind it', () => {
    const ap = load('LKPR'), { sim, gate } = pushed(ap, '3', '24');
    const s = sim.state, r = gate.route;
    assert.ok(routeOffNose(r, s.hdg) < 30, `${routeOffNose(r, s.hdg).toFixed(0)} degrees off the nose`);
    assert.equal(r.runway, '24'); assert.ok(r.hold);
    // what the shortest way from the pushback's end does: it leaves behind the nose (the fault, still what a plain plan gives)
    const g = buildTaxiGraph(ap), end = ap.runways.flatMap((q) => q.ends).find((e) => e.ident === '24');
    const plain = routeFromStand(g, { x: s.pos.x + Math.sin(s.hdg) * 8, y: s.pos.y + Math.cos(s.hdg) * 8 }, end);
    assert.ok(routeOffNose(plain, s.hdg) > 150, `the plain plan: ${routeOffNose(plain, s.hdg).toFixed(0)} degrees`);
    // the way ahead is no detour: within REROUTE_MORE_M of the way behind (here a few metres)
    assert.ok(r.lengthM < plain.lengthM + 60, `${r.lengthM.toFixed(0)} m against ${plain.lengthM.toFixed(0)} m`);
    assert.ok(r.lengthM <= plain.lengthM + REROUTE_MORE_M);
    // the route starts at the aircraft (8 m ahead of the reference point, on its taxiway) and every point of its lead lies on a taxiway
    assert.ok(Math.hypot(r.points[0][0] - (s.pos.x + Math.sin(s.hdg) * 8), r.points[0][1] - (s.pos.y + Math.cos(s.hdg) * 8)) < 16);
    let run = 0;
    for (let i = 1; i < r.points.length && run < REROUTE_REACH_M; i++) {
      run += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
      assert.ok(snapToGraph(g, r.points[i][0], r.points[i][1]).d < 16, `point ${i} is ${snapToGraph(g, r.points[i][0], r.points[i][1]).d.toFixed(1)} m off the taxiways`);
    }
    assert.ok(r.text && /24/.test(r.text), r.text);
    // the instruction begins with the taxiway the aircraft is on (A1), and each named run has its length
    assert.equal(r.refs[0], 'A1'); assert.equal(r.refs.length, r.refLens.length);
    assert.ok(r.refLens.every((m) => m > 0) && Math.abs(r.refLens.reduce((x, y) => x + y, 0) - r.lengthM) < 0.35 * r.lengthM);
  });

  // The code review's third look: the lead is the taxiways' own way from the aircraft, so its names are theirs and
  // come first (Venice's 326 to 22L begins on M), and a lead never runs onto a runway.
  test('the lead\'s taxiways are named before the route\'s own', () => {
    const ap = load('LIPZ'), { sim, gate } = pushed(ap, '326', '22L'), s = sim.state, r = gate.route;
    assert.ok(routeOffNose(r, s.hdg) <= REROUTE_OFF_NOSE);
    const g = buildTaxiGraph(ap);
    // the named taxiways under the route's first 200 m, in order, are the first of its refs
    const under = [];
    let run = 0;
    for (let i = 1; i < r.points.length && run < REROUTE_REACH_M; i++) {
      run += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
      const e = snapToGraph(g, r.points[i][0], r.points[i][1]).edge;
      assert.ok(!e.runway, `the lead's point ${i} is on a runway`);
      if (e.ref && under[under.length - 1] !== e.ref) under.push(e.ref);
    }
    assert.ok(under.length >= 1);
    assert.equal(r.refs[0], under[0], `${r.refs.join(' ')} against ${under.join(' ')} under the lead`);
    // (a point at a junction snaps to either taxiway, so only the first is held to; the lead's own runs are the rule)
    assert.equal(r.refs.length, r.refLens.length);
    assert.equal(r.refs[0], 'M');
    for (let i = 1; i < r.refs.length; i++) assert.notEqual(r.refs[i], r.refs[i - 1], r.refs.join(' '));
  });

  // The code review's fourth look: a way that goes ahead and doubles back through the next junction is no mend
  // (Cologne Bonn's B10 to 24 turned 154° at 104 m; Cheongju's 6L 151° at 36 m).
  test('routeTurnsBack: a turn of over 135° onto a leg of over 3 m within the first 150 m', () => {
    assert.deepEqual([REROUTE_TURN_DEG, REROUTE_TURN_M], [135, 150]);
    const pts = (...p) => ({ points: p });
    assert.equal(routeTurnsBack(pts([0, 0], [0, 100], [5, 0])), true, 'north 100 m, then back south');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 100], [100, 100])), false, 'a right angle');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 100], [60, 40])), false, 'exactly 135° is not over it');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 100], [50, 30])), true, '144°');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 200], [5, 0])), false, 'the turn is past 150 m');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 200], [5, 0]), 250), true);
    assert.equal(routeTurnsBack(pts([0, 0], [0, 50], [0.5, 48], [40, 60])), false, 'a leg of under 3 m is not a turn');
    assert.equal(routeTurnsBack(pts([0, 0], [0, 50])), false); assert.equal(routeTurnsBack(null), false);
    // Prague's own turn from A1 onto AA's fillet is about 120°: kept (the test pilot holds the pavement through it)
    const ap = load('LKPR'), { gate } = pushed(ap, '3', '24');
    assert.equal(routeTurnsBack(gate.route), false);
  });

  test('after a pushback no route of these stands doubles back within 150 m unless the plain plan is all there is', () => {
    let n = 0;
    for (const [icao, ref, endId] of [['EDDK', 'B10', '24'], ['LIPZ', '324', '22L'], ['EDDL', 'B03', '23R'], ['LSZH', 'A03', '14'], ['LKPR', '3', '24']]) {
      const ap = load(icao);
      if (!ap.stands.some((q) => String(q.ref) === ref)) continue;
      const { sim, gate } = pushed(ap, ref, endId), s = sim.state, r = gate.route;
      n++;
      assert.ok(routeOffNose(r, s.hdg) <= REROUTE_OFF_NOSE && !routeTurnsBack(r), `${icao} ${ref}: ${routeOffNose(r, s.hdg).toFixed(0)}° off the nose, turns back ${routeTurnsBack(r)}`);
      // and it crosses no more runways than the plain plan did
      const g = buildTaxiGraph(ap), end = ap.runways.flatMap((q) => q.ends).find((e) => e.ident === endId);
      const plain = routeFromStand(g, { x: s.pos.x + Math.sin(s.hdg) * 8, y: s.pos.y + Math.cos(s.hdg) * 8 }, end);
      assert.ok(r.crossings.length <= plain.crossings.length, `${icao} ${ref}: ${r.crossings.length} crossings against ${plain.crossings.length}`);
    }
    assert.ok(n >= 4, `${n} cases`);
  });

  test('no taxiway is named twice in a row or in an A, B, A, B stutter at the lead\'s junctions (Zurich\'s A03 to 14)', () => {
    const ap = load('LSZH'), { sim, gate } = pushed(ap, 'A03', '14'), r = gate.route;
    assert.ok(routeOffNose(r, sim.state.hdg) <= REROUTE_OFF_NOSE);
    for (let i = 1; i < r.refs.length; i++) assert.notEqual(r.refs[i], r.refs[i - 1], r.refs.join(' '));
    assert.ok(!(r.refs[0] === r.refs[2] && r.refs[1] === r.refs[3]), r.refs.join(' '));
    assert.equal(r.refs[0], 'Inner');
    // the way ahead crosses 10/28 once, as the way behind did (on an unnamed link there, so its names had no runway)
    assert.deepEqual(r.crossings.length, 1);
    assert.ok(r.refs.some((x) => /^RWY 10\/28/.test(x)) && /runway 10\/28/.test(r.text), `the crossing is named: ${r.text}`);
  });

  test('a route that already leaves ahead of the nose is the plain plan, point for point', () => {
    let same = 0;
    for (const [icao, ref, endId] of [['LKPR', '5', '24'], ['EGLL', '218', '27R'], ['EDDF', 'A13', '25C']]) {
      const ap = load(icao), st = ap.stands.find((q) => String(q.ref) === ref);
      if (!st) continue;
      const { sim, gate } = pushed(ap, ref, endId), s = sim.state;
      const g = buildTaxiGraph(ap), end = ap.runways.flatMap((q) => q.ends).find((e) => e.ident === endId);
      const plain = routeFromStand(g, { x: s.pos.x + Math.sin(s.hdg) * 8, y: s.pos.y + Math.cos(s.hdg) * 8 }, end);
      if (routeOffNose(plain, s.hdg) > REROUTE_OFF_NOSE) continue;
      same++;
      assert.deepEqual(gate.route.points, plain.points, `${icao} ${ref}`);
      assert.equal(gate.route.lengthM, plain.lengthM);
    }
    assert.ok(same >= 2, `${same} cases`);
  });
}
