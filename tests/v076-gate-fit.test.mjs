// v0.7.6, part 7: the stands at Centrair, Itami, Hiroshima and Cheongju ("Found while building v0.7.5": the aircraft
// stands 30 to 50 m out from the terminal and the jet bridges don't reach it). The cause is the game's own: every
// aircraft is parked with its nose on the stand point (gate-flow.js, traffic-layout.js), but the stand's stop bar and
// the jet bridge were laid out for an aircraft whose reference point is on it, 21 m further on. gateFit(icao) lays
// them out for the nose on the point at those four (apron-geom.js); every other airport draws what it drew.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as G from '../src/world/apron-geom.js';
import { NOSE_X, GEAR } from '../src/geometry.js';

const airport = (icao) => JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url), 'utf8'));
const terms = (a) => (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => G.openRing(b.points));

test('the table: the four airports, and nothing else without the switch', () => {
  assert.deepEqual([...G.GATE_FIT].sort(), ['RJGG', 'RJOA', 'RJOO', 'RKTU']);
  for (const i of ['RJGG', 'RJOO', 'RJOA', 'RKTU']) assert.equal(G.gateFit(i), true, i);
  // v0.7.8 (changed on purpose): the fit is at every airport by default (GATES78); with FS_GATES78=0 the table alone, as it was.
  for (const i of ['RJNK', 'RKJK', 'RJTT', 'RKSI', 'EGLL', 'LEZG']) assert.equal(G.gateFit(i), G.GATES78, i);
  assert.equal(G.NOSE_AT, NOSE_X);
});

test('without the fit both functions give what v0.7.5 gave (the default arguments)', () => {
  const s = { ref: '1', x: 10, y: -4, hdgGridDeg: 30 };
  const term = [[-60, 60], [80, 60], [80, 100], [-60, 100]];
  assert.deepEqual(G.standMarks(s), G.standMarks(s, false));
  assert.deepEqual(G.jetBridge(s, [term]), G.jetBridge(s, [term], 80, false));
  const m = G.standMarks({ ref: '1', x: 0, y: 0, hdgGridDeg: 0 });
  assert.ok(Math.abs(m.stop.y - G.NOSE_WHEEL) < 1e-9);
  const jb = G.jetBridge({ x: 0, y: 0, hdgGridDeg: 0 }, [[[-40, 40], [40, 40], [40, 80], [-40, 80]]]);
  assert.ok(Math.abs(jb.door.y - G.DOOR_FWD) < 1e-9 && Math.abs(jb.door.x + G.FUSE_HALF) < 1e-9);
});

test('with the fit: the stop bar under the nose wheel, the door where the L1 door is, the bridge clear of the nose', () => {
  const s = { ref: '1', x: 0, y: 0, hdgGridDeg: 0 };                 // the nose at (0, 0), looking north
  const m = G.standMarks(s, true);
  assert.ok(Math.abs(m.stop.y - (G.NOSE_WHEEL - NOSE_X)) < 1e-9, `${m.stop.y}`);   // 5.3 m behind the nose
  const wall = [[-60, 40], [60, 40], [60, 80], [-60, 80]];           // a wall straight ahead, 40 m from the nose
  const jb = G.jetBridge(s, [wall], 80, true);
  assert.ok(jb);
  assert.ok(Math.abs(jb.door.y - (G.DOOR_FWD - NOSE_X)) < 1e-9 && Math.abs(jb.door.x + G.GATE_FIT_HALF) < 1e-9);   // 4 m behind the nose, on the left
  assert.ok(G.GATE_FIT_HALF >= 3 && G.GATE_FIT_HALF > G.FUSE_HALF);   // the cab's face clear of a 777's nose (about 2.8 m out where the cab ends)
  assert.ok(Math.abs(jb.root.y - 40) < 1e-6 && jb.root.x < -8, `the root on the wall, out to the left: ${jb.root.x}`);
  // the tunnel passes the nose's tip more than 3 m to its left
  const t = (0 - jb.cab.y) / (jb.root.y - jb.cab.y), xAtNose = jb.cab.x + (jb.root.x - jb.cab.x) * t;
  assert.ok(xAtNose < -3, `${xAtNose}`);
  assert.ok(jb.length > 40 && jb.length < 50, `${jb.length}`);
});

test('the nose wheel and the door really are where the fit puts them (geometry.js)', () => {
  assert.ok(GEAR.nose && Number.isFinite(GEAR.nose.x));
  assert.ok(Math.abs(GEAR.nose.x - G.NOSE_WHEEL) < 0.5);
  assert.ok(NOSE_X - G.DOOR_FWD > 3 && NOSE_X - G.DOOR_FWD < 6);     // the A321's L1 door, about 4 m behind the nose's tip
});

test('at the four airports every gate that had a bridge has one still, none over 80 m, each to the door behind the nose', () => {
  for (const icao of ['RJGG', 'RJOO', 'RJOA', 'RKTU']) {
    const a = airport(icao), T = terms(a);
    let had = 0, has = 0;
    for (const s of a.stands.filter((x) => x.gate)) {
      const o = G.jetBridge(s, T), n = G.jetBridge(s, T, 80, true);
      if (o) { had++; assert.ok(n, `${icao} ${s.ref} lost its bridge`); }
      if (!n) continue;
      has++;
      const [dx, dy] = G.hdgVec(s.hdgGridDeg);
      const f = (n.door.x - s.x) * dx + (n.door.y - s.y) * dy;
      assert.ok(Math.abs(f - (G.DOOR_FWD - NOSE_X)) < 1e-6, `${icao} ${s.ref}`);
      // v0.7.9 (GATES79): a gate bridged by one of the new rules: a long link to 110 m, or round an elbow (the root
      // at least GATE_ELBOW_FWD ahead of the stand point on either side, the elbow to the nose's left). The old rules
      // below hold for every other bridge, as they did.
      if (n.how) {
        assert.ok(G.GATES79 && !o, `${icao} ${s.ref}: a new rule only where the old ones found nothing`);
        if (n.how === 'long') assert.ok(n.length > 80 && n.length <= G.GATE_LONG_M + 2, `${icao} ${s.ref}: ${n.length}`);
        else {
          assert.equal(n.how, 'elbow');
          assert.ok((n.root.x - s.x) * dx + (n.root.y - s.y) * dy >= G.GATE_ELBOW_FWD - 1e-6, `${icao} ${s.ref}: the root ahead of the nose`);
          assert.ok((n.elbow.x - s.x) * -dy + (n.elbow.y - s.y) * dx > 9, `${icao} ${s.ref}: the elbow on the left`);
        }
        continue;
      }
      assert.ok(n.length >= 4 && n.length <= 82, `${icao} ${s.ref}: ${n.length}`);
      // the root not inside the aircraft's nose: ahead of the tip, or more than 3 m out to the left of the door
      const rx = n.root.x - n.door.x, ry = n.root.y - n.door.y;
      assert.ok(rx * -dy + ry * dx >= 3 - 1e-6 || rx * dx + ry * dy >= NOSE_X - G.DOOR_FWD + 3 - 1e-6, `${icao} ${s.ref}`);
      assert.ok(rx * -dy + ry * dx >= -G.GATE_FIT_HALF - 1e-6, `${icao} ${s.ref}: the root right of the centreline`);
    }
    assert.ok(had >= 4 && has >= had, `${icao}: ${had} before, ${has} with the fit`);
  }
});

// The code review's count: with the fit switched on everywhere, five of Munich's bridges ran from a root right of the
// centreline across the nose. No fitted bridge's tunnel passes within 2.3 m of its aircraft's centreline now, at any
// airport of either region.
test('with the fit on everywhere, no bridge crosses a fuselage', () => {
  let n = 0, crossing = [];
  for (const dir of ['../data/airports/', '../data/europe/airports/']) {
    for (const f of readdirSync(new URL(dir, import.meta.url)).filter((x) => /^[A-Z]{4}\.json$/.test(x))) {
      const a = JSON.parse(readFileSync(new URL(dir + f, import.meta.url), 'utf8')), T = terms(a);
      if (!T.length) continue;
      for (const s of a.stands.filter((x) => x.gate)) {
        const jb = G.jetBridge(s, T, 80, true); if (!jb) continue;
        n++;
        const [dx, dy] = G.hdgVec(s.hdgGridDeg);
        // the tunnel's closest approach to the centreline between the nose and 44 m behind it
        let worst = Infinity;
        // (v0.7.9: an elbowed bridge's tunnel runs cab, elbow, root)
        const pts = jb.elbow ? [jb.cab, jb.elbow, jb.root] : [jb.cab, jb.root];
        for (let k = 0; k + 1 < pts.length; k++) {
          for (let t = 0; t <= 1; t += 0.02) {
            const x = pts[k].x + (pts[k + 1].x - pts[k].x) * t - s.x, y = pts[k].y + (pts[k + 1].y - pts[k].y) * t - s.y;
            const f2 = x * dx + y * dy, l = x * -dy + y * dx;
            if (f2 <= 0 && f2 >= -44) worst = Math.min(worst, Math.abs(l));
          }
        }
        if (worst < 2.3) crossing.push(`${a.icao} ${s.ref} ${worst.toFixed(1)}`);
      }
    }
  }
  assert.ok(n > 2000, `${n} bridges`);
  assert.deepEqual(crossing, []);
});
