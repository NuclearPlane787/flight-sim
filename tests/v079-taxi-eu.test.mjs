// v0.7.9 part 4 and part 5's Fairford line (subagent taxi): the taxi routes v0.7.8 didn't reach, in Europe.
// - Glasgow (EGPF): OSM's taxiway A loops past 23's end and stops 167 m beyond the pavement, joined to nothing; its holds A1
//   and A2 were the routes' holds for 23. They stay painted but are no route's end (HOLD_NO_ROUTE in
//   tools/bake_region_airports.py, "noRoute" in the file, skipped by taxi.js): every route to 23 holds at B1, where AD 2.20's
//   full-length take-off begins its back-track.
// - Lossiemouth (EGQS): the taxi-in no longer runs to D Apron's north-west taxilane 16 m ahead of a spot's nose and turns
//   back 60 m along the lead-in (gate-flow.js LEADIN_START): it turns in from taxiway D behind.
// - Fairford (EGVA): the 27 hardstands OSM leaves unjoined, 7 to 53 m from the taxiways, joined by 25 m strips (PAVE_JOIN).
//   FS_REGION=europe node --test tests/v079-taxi-eu.test.mjs      (FS_TAXI79_DATA=<airports folder> reads a staged copy)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url)) {
  const { buildTaxiGraph, routeFromStand } = await import('../src/ground/taxi.js');
  const { createGateFlow, alongRunwayM, LEADIN_START } = await import('../src/ground/gate-flow.js');
  const DIR = process.env.FS_TAXI79_DATA ? process.env.FS_TAXI79_DATA.replace(/\/?$/, '/') : new URL('../data/europe/airports/', import.meta.url);
  const load = (i) => JSON.parse(readFileSync(new URL(i + '.json', DIR instanceof URL ? DIR : 'file://' + DIR), 'utf8'));

  test('Glasgow: A1 and A2 painted but no route ends there; every route to 23 holds at B1, none along the runway', () => {
    const ap = load('EGPF');
    const nr = ap.holdingPositions.filter((h) => h.noRoute).map((h) => h.ref).sort();
    assert.deepEqual(nr, ['A1', 'A2']);
    assert.equal(ap.holdingPositions.length, 15, 'all of OSM\'s holds still in the file (painted)');
    const g = buildTaxiGraph(ap);
    assert.equal(g.holds.length, 13);
    assert.ok(!g.holds.some((h) => h.ref === 'A1' || h.ref === 'A2'));
    const e23 = ap.runways[0].ends.find((e) => e.ident === '23'), e05 = ap.runways[0].ends.find((e) => e.ident === '05');
    for (const st of ap.stands) {
      const r = routeFromStand(g, st, e23);
      assert.ok(r && r.hold, `${st.ref} → 23: a route`);
      assert.equal(r.hold.ref, 'B1', `${st.ref} → 23 holds at ${r.hold.ref}`);
      assert.ok(alongRunwayM(g, r.points) < 1, `${st.ref} → 23: along the runway`);
      const r5 = routeFromStand(g, st, e05);
      assert.ok(r5 && r5.hold, `${st.ref} → 05: a route`);
    }
  });

  // The turn where the taxi-in's route meets the stand's lead-in: at the lead-in's start A, between the leg into A and the
  // lead-in A → stand (degrees). v0.7.8: about 180 at each of Lossiemouth's spots (the route came from ahead of the nose).
  function leadInTurns(ap) {
    const out = [];
    for (const [e, o] of ap.runways.flatMap((rw) => [[rw.ends[0], rw.ends[1]], [rw.ends[1], rw.ends[0]]])) {
      const L = Math.hypot(o.x - e.x, o.y - e.y), ux = (o.x - e.x) / L, uy = (o.y - e.y) / L;
      for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        const state = { onGround: true, gs: 10, hdg: Math.atan2(ux, uy), pos: { x: e.x + ux * L * frac, y: e.y + uy * L * frac, z: 0 } };
        const gate = createGateFlow({ sim: { state, type: null }, airports: [ap] });
        const r = gate.afterLanding(state);
        assert.ok(r, `${e.ident} from ${frac * 100} %: a route`);
        const st = ap.stands.find((s) => s.ref === r.stand), A = st.leadIn[0], P = r.points;
        const k = P.findIndex((p) => Math.hypot(p[0] - A[0], p[1] - A[1]) < 0.6);
        assert.ok(k > 0, `${e.ident} from ${frac * 100} %: the route passes the lead-in's start`);
        const a1 = Math.atan2(A[0] - P[k - 1][0], A[1] - P[k - 1][1]), a2 = Math.atan2(st.x - A[0], st.y - A[1]);
        out.push({ at: `${e.ident}@${frac} → ${st.ref}`, turn: Math.abs(((a2 - a1) * 180 / Math.PI + 540) % 360 - 180) });
      }
    }
    return out;
  }

  test('Lossiemouth: every taxi-in turns into its spot\'s lead-in by 100 degrees or less (no hairpin); without LEADIN_START it is one', () => {
    const ap = load('EGQS');
    assert.deepEqual([...LEADIN_START], ['EGQS'], 'the rule is Lossiemouth\'s alone');
    const on = leadInTurns(ap);
    assert.equal(on.length, 20);
    for (const t of on) assert.ok(t.turn <= 100, `${t.at}: a ${t.turn.toFixed(0)} degree turn into the lead-in`);
    LEADIN_START.delete('EGQS');
    try {
      const off = leadInTurns(ap);
      assert.ok(off.every((t) => t.turn > 170), `without the rule: ${off.map((t) => t.turn.toFixed(0)).join(' ')}`);
    } finally { LEADIN_START.add('EGQS'); }
  });

  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const inside = (px, py, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
  // (tests/v078-bases.test.mjs's gapToPavement: a ring's gap to the taxiways at their half width and to the other aprons)
  function gapToPavement(a, ring, self) {
    const pts = [];
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2); for (let k = 0; k < n; k++) pts.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); }
    let best = Infinity;
    for (const [x, y] of pts) {
      for (const t of a.taxiways) for (let i = 0; i + 1 < t.points.length; i++) best = Math.min(best, segDist(x, y, t.points[i], t.points[i + 1]) - t.widthM / 2);
      for (const ap of a.aprons) {
        if (ap === self) continue;
        if (inside(x, y, ap.points)) return 0;
        for (let i = 0; i + 1 < ap.points.length; i++) best = Math.min(best, segDist(x, y, ap.points[i], ap.points[i + 1]));
      }
    }
    return Math.max(best, 0);
  }

  test('Fairford: every hardstand joined to pavement (v0.7.8: 27 of them 7 to 53 m apart); the strips clear of the runway', () => {
    const a = load('EGVA');
    const strips = a.aprons.filter((p) => p.synthetic && p.points.length === 5);
    assert.ok(strips.length >= 27, `${strips.length} strips`);
    let n = 0;
    for (const ap of a.aprons) {
      if (ap.synthetic) continue;
      const g = gapToPavement(a, ap.points, ap);
      assert.ok(g < 3, `a hardstand ${g.toFixed(1)} m from any pavement`);
      n++;
    }
    assert.equal(n, 33);
    const r = a.runways[0], [e0, e1] = r.ends;
    for (const s of strips) for (const [x, y] of s.points) assert.ok(segDist(x, y, [e0.x, e0.y], [e1.x, e1.y]) > r.widthM / 2 + 30, 'a strip within 30 m of the runway');
  });
}
