// v0.7.9, part 5: the gates' leftovers ("Found while building v0.7.8"). apron-geom.js GATES79 (?gates79=0 or
// FS_GATES79=0 gives the pushed v0.7.8's gates): each type's nose wheel on the stop bar; a bridge at more of the gates
// that had none (a long link, or round an elbow from a wall ahead and right), never over another stand's aircraft; a
// gate nobody stands at with its bridge drawn back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import * as G from '../src/world/apron-geom.js';
import * as A321 from '../src/geometry.js';
import * as B789 from '../src/geometry-b787-9.js';
import * as B77W from '../src/geometry-b777-300er.js';
import { AIRLINER_TYPES } from '../src/world/traffic-models.js';
import { placeParked } from '../src/world/traffic-layout.js';
import { stopAhead } from '../src/ground/taxi.js';
import { createSim } from '../src/sim/sim.js';
import { typeById } from '../src/sim/types.js';
import { createGateFlow } from '../src/ground/gate-flow.js';

const ON = G.GATES79;
const HASH = fileURLToPath(new URL('./v078-gates-hash.mjs', import.meta.url));
// The pushed v0.7.8's answer from tests/v078-gates-hash.mjs, taken from the frozen tree at the start of v0.7.9's run.
const V078 = 'a8860b4bda3782e64ff2fcc7d2322d55567d6366f6d2b5ddc1f05a56cb7189ac stands 9952 gates 2480 bridges 2299';
const airports = function* () {
  for (const dir of ['../data/airports/', '../data/europe/airports/']) {
    const base = new URL(dir, import.meta.url);
    for (const f of readdirSync(base).filter((n) => /^[A-Z]{4}\.json$/.test(n)).sort()) yield JSON.parse(readFileSync(new URL(f, base), 'utf8'));
  }
};
const airport = (icao, dir = 'airports') => JSON.parse(readFileSync(new URL(`../data/${dir}/${icao}.json`, import.meta.url), 'utf8'));
const terms = (a) => (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => G.openRing(b.points));
const BAR = G.NOSE_AT - G.NOSE_WHEEL;   // the stop bar: this far behind the stand point (5.3 m)

test('switched off (FS_GATES79=0), every stand and bridge at every airport is the pushed v0.7.8\'s, and nothing is shifted', () => {
  const out = execFileSync(process.execPath, [HASH], { env: { ...process.env, FS_GATES79: '0' }, encoding: 'utf8' }).trim();
  assert.equal(out, V078);
  const off = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import * as G from ${JSON.stringify(new URL('../src/world/apron-geom.js', import.meta.url).href)}; console.log(G.GATES79, G.noseWheelShift(7), G.noseWheelShift(5.89))`],
  { env: { ...process.env, FS_GATES79: '0' }, encoding: 'utf8' }).trim();
  assert.equal(off, 'false 0 0');
  // ... and ?gates78=0 switches v0.7.9's gates off with v0.7.8's
  const off78 = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import * as G from ${JSON.stringify(new URL('../src/world/apron-geom.js', import.meta.url).href)}; console.log(G.GATES78, G.GATES79)`],
  { env: { ...process.env, FS_GATES78: '0' }, encoding: 'utf8' }).trim();
  assert.equal(off78, 'false false');
});

test('each type\'s nose wheel stands on the stop bar: how far its nose goes past the stand point', { skip: !ON }, () => {
  const wheelBehindNose = (g) => g.NOSE_X - g.GEAR.nose.x;
  assert.ok(Math.abs(wheelBehindNose(A321) - BAR) < 0.02, 'the bar is the A321\'s');
  assert.equal(stopAhead(A321), 0);
  assert.ok(Math.abs(stopAhead(B789) - 0.12) < 0.02, `787-9 ${stopAhead(B789)}`);
  assert.ok(Math.abs(stopAhead(B77W) - 0.60) < 0.02, `777-300ER ${stopAhead(B77W)}`);
  for (const g of [A321, B789, B77W]) assert.ok(Math.abs(wheelBehindNose(g) - stopAhead(g) - BAR) < 0.02);
  assert.equal(G.noseWheelShift(AIRLINER_TYPES[0].noseGearX), 0, 'the parked narrowbody: its wheel is 0.2 m ahead of the bar, left');
  assert.ok(Math.abs(G.noseWheelShift(AIRLINER_TYPES[1].noseGearX) - 1.7) < 0.01, 'the parked widebody');
  assert.equal(G.noseWheelShift(undefined), 0); assert.equal(G.noseWheelShift(NaN), 0);
  assert.equal(stopAhead(null), 0); assert.equal(stopAhead({ NOSE_X: 20 }), 0);
});

test('a gate start puts each type\'s nose wheel on the bar, and its door where the bridge is told it is', { skip: !ON }, () => {
  const ap = airport('RKSI');
  let seen = 0;
  for (const id of ['a321neo', 'b787-9', 'b777-300er']) {
    const type = typeById(id);
    if (!type) continue;
    seen++;
    const sim = createSim();
    const gate = createGateFlow({ sim, airports: [ap] });
    gate.setType(type);
    const r = gate.start({ origin: 'RKSI', depRunway: ap.runways[0].ends[0].ident, fuelKg: 12000, payloadKg: 9000 });
    assert.ok(r && gate.stand, `${id}: a gate start`);
    const s = sim.state, st = gate.stand, h = st.hdgGridDeg * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h);
    const wheel = [s.pos.x + fx * type.geo.GEAR.nose.x, s.pos.y + fy * type.geo.GEAR.nose.x];
    const bar = [st.x - fx * BAR, st.y - fy * BAR];
    assert.ok(Math.hypot(wheel[0] - bar[0], wheel[1] - bar[1]) < 0.02, `${id}: the nose wheel ${Math.hypot(wheel[0] - bar[0], wheel[1] - bar[1]).toFixed(3)} m from the bar`);
    // the door main.js hands the bridge (GATE_DOOR.back less the shift) is where the aircraft's door is
    const D = type.geo.GATE_DOOR, back = D.back - stopAhead(type.geo);
    const nose = [s.pos.x + fx * type.geo.NOSE_X, s.pos.y + fy * type.geo.NOSE_X];
    const doorAc = [nose[0] - fx * D.back, nose[1] - fy * D.back], doorJb = [st.x - fx * back, st.y - fy * back];
    assert.ok(Math.hypot(doorAc[0] - doorJb[0], doorAc[1] - doorJb[1]) < 0.02, `${id}: the door`);
  }
  assert.ok(seen >= 2, `${seen} types`);
});

test('a parked widebody stands with its nose wheel on the bar, and its bridge finds its door', { skip: !ON }, () => {
  for (const [icao, dir] of [['RKSI', 'airports'], ['EGLL', 'europe/airports']]) {
    const ap = airport(icao, dir), parked = placeParked(ap, { wide: true }), T = terms(ap);
    let wide = 0, onBar = 0, narrow = 0;
    for (const p of parked) {
      // (some of Incheon's refs name two positions: the one this aircraft stands at)
      const s = ap.stands.filter((t) => String(t.ref) === String(p.stand)).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (!s) continue;
      const [dx, dy] = G.hdgVec(s.hdgGridDeg);
      // the nose past the point, along the aircraft's own heading (the layout's standHeading(), radians)
      const off = (p.x - s.x) * Math.sin(p.hdg) + (p.y - s.y) * Math.cos(p.hdg);
      if (p.type === 1) {
        wide++;
        // on the bar, or backed off from a wall in the layout's 3 m steps
        assert.ok([1.7, 0, -3, -6, -9, -12].some((v) => Math.abs(off - v) < 0.02), `${icao} ${p.stand}: ${off.toFixed(2)}`);
        if (Math.abs(off - 1.7) < 0.02) {
          onBar++;
          const d = G.parkedDoor(s, p);
          if (d && s.gate) {
            assert.ok(Math.abs(d.back - (G.PARKED_DOORS[1].back - 1.7)) < 0.02, `${icao} ${p.stand}: the door ${d.back}`);
            const jb = G.jetBridge(s, T, 80, true, d, G.gateMore(ap));
            if (jb) assert.ok(Math.abs((jb.door.x - p.x) * dx + (jb.door.y - p.y) * dy + G.PARKED_DOORS[1].back) < 0.02, `${icao} ${p.stand}: the cab at the door`);
          }
        }
      } else { narrow++; assert.ok([0, -3, -6, -9, -12].some((v) => Math.abs(off - v) < 0.02), `${icao} ${p.stand}: ${off.toFixed(2)}`); }
    }
    assert.ok(wide >= 10 && onBar >= wide * 0.8 && narrow > 20, `${icao}: ${wide} widebodies, ${onBar} on the bar, ${narrow} narrowbodies`);
  }
});

test('an aircraft that isn\'t at a stand gives it no door (Incheon\'s refs that name two positions)', { skip: !ON }, () => {
  const ap = airport('RKSI'), parked = placeParked(ap, { wide: true });
  let far = 0, near = 0;
  for (const p of parked) {
    for (const s of ap.stands.filter((t) => String(t.ref) === String(p.stand))) {
      const d = G.parkedDoor(s, p), dist = Math.hypot(s.x - p.x, s.y - p.y);
      if (dist > 20) { far++; assert.equal(d, null, `${p.stand}: ${dist.toFixed(0)} m away`); }
      else if (d) { near++; assert.ok(d.back > 0 && d.back < 20, `${p.stand}: ${d.back}`); }
    }
  }
  assert.ok(far >= 4 && near > 150, `${far} far, ${near} near`);
  const src = readFileSync(new URL('../src/world/world.js', import.meta.url), 'utf8');
  assert.ok(/GATES79 \? \(t\.a\.stands \|\| \[\]\)\.reduce/.test(src), 'world.js takes the nearest stand of the ref');
});

test('31 more gates are bridged, each new bridge clear of its own aircraft, of every other stand\'s, of the neighbours\' bridges and of every building', { skip: !ON }, () => {
  let gates = 0, old = 0, long = 0, elbow = 0;
  const by = {};
  for (const a of airports()) {
    const T = terms(a);
    for (const s of (a.stands || []).filter((x) => x.gate)) {
      gates++;
      const jb = G.jetBridge(s, T, 80, true, null, G.gateMore(a));
      if (!jb) continue;
      if (!jb.how) { old++; assert.ok(!jb.elbow && jb.length <= 82); continue; }
      by[a.icao] = (by[a.icao] || 0) + 1;
      const [dx, dy] = G.hdgVec(s.hdgGridDeg), lx = -dy, ly = dx;
      const rel = (p) => [(p.x - s.x) * dx + (p.y - s.y) * dy, (p.x - s.x) * lx + (p.y - s.y) * ly];
      const pts = jb.elbow ? [jb.root, jb.elbow, jb.cab] : [jb.root, jb.cab];
      if (jb.how === 'long') { long++; assert.ok(!jb.elbow && jb.length > 80 && jb.length <= G.GATE_LONG_M + 2, `${a.icao} ${s.ref}: ${jb.length}`); assert.ok(rel(jb.root)[1] >= -G.GATE_FIT_HALF - 1e-6); }
      else {
        elbow++;
        assert.equal(jb.how, 'elbow');
        const e = rel(jb.elbow), r = rel(jb.root);
        assert.ok(Math.abs(e[0] - G.GATE_ELBOW_FWD) < 1e-6 && Math.abs(e[1] - G.GATE_ELBOW_SIDE) < 1e-6, `${a.icao} ${s.ref}: the elbow`);
        assert.ok(r[0] >= G.GATE_ELBOW_FWD - 1e-6, `${a.icao} ${s.ref}: the root ${r[0].toFixed(1)} m ahead`);
        assert.ok(Math.hypot(jb.root.x - jb.elbow.x, jb.root.y - jb.elbow.y) <= G.GATE_ELBOW_MAX + 1e-6);
        assert.ok(Math.abs(jb.length - (Math.hypot(jb.root.x - jb.elbow.x, jb.root.y - jb.elbow.y) + Math.hypot(jb.cab.x - jb.elbow.x, jb.cab.y - jb.elbow.y))) < 1e-6);
      }
      for (let k = 0; k + 1 < pts.length; k++) {
        // its own aircraft: no nearer the centreline than 2.3 m from 2 m ahead of the nose's tip (a parked widebody's
        // is 1.7 m past the point) to 44 m behind it
        for (let t = 0; t <= 1; t += 0.02) {
          const [f, l] = rel({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t });
          assert.ok(!(f <= 2 && f >= -44 && Math.abs(l) < 2.3), `${a.icao} ${s.ref}: the tunnel over its own nose (${f.toFixed(1)}, ${l.toFixed(1)})`);
        }
        // every other stand's aircraft
        if (k + 2 < pts.length || !jb.elbow) assert.ok(G.bridgeClear(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, s, a.stands), `${a.icao} ${s.ref}: leg ${k} over another stand`);
        // no leg crosses a building that isn't a terminal (the code review's third finding: Frankfurt's C14)
        for (const r of G.gateMore(a).others) for (let i = 0; i < r.length; i++) {
          const p = r[i], q = r[(i + 1) % r.length];
          assert.ok(G.segSegDist(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, p[0], p[1], q[0], q[1]) > 0, `${a.icao} ${s.ref}: leg ${k} through a building`);
        }
        // the neighbouring gates' bridges (v0.7.8's rules): never within 4 m of one
        for (const t of a.stands) {
          if (t === s || !t.gate || Math.hypot(t.x - s.x, t.y - s.y) < 25 || Math.hypot(t.x - s.x, t.y - s.y) > 200) continue;
          const nb = G.jetBridge(t, T, 80, true);
          if (nb) assert.ok(G.segSegDist(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, nb.root.x, nb.root.y, nb.cab.x, nb.cab.y) >= 4 - 1e-9, `${a.icao} ${s.ref}: leg ${k} across ${t.ref}'s bridge`);
        }
      }
    }
  }
  assert.equal(gates, 2480);
  assert.equal(old, 2299, 'the gates v0.7.8 bridged, by its own rules');
  assert.deepEqual([long, elbow], [4, 27]);
  assert.equal(by.EGLL, 1); assert.ok(by.RKSI === 3 && by.LFPG === 3 && by.ZSQD === 1);
});

test('the clearance: a leg over another stand\'s fuselage or wing is refused, the stand\'s own alternates are not counted', () => {
  const me = { x: 0, y: 0, hdgGridDeg: 0 }, other = { x: 50, y: 40, hdgGridDeg: 0 }, alt = { x: 8, y: -3, hdgGridDeg: 0 };
  assert.ok(G.bridgeClear(-10, 60, 5, 0, me, [me, other]));                 // well to the left
  assert.ok(!G.bridgeClear(40, 60, 60, 30, me, [me, other]), 'across its nose');
  assert.ok(!G.bridgeClear(20, 20, 30, 0, me, [me, other]), 'over its left wing');
  assert.ok(G.bridgeClear(20, 60, 30, 48, me, [me, other]), 'ahead of its nose by more than 7 m');
  assert.ok(G.bridgeClear(0, 30, 8, 0, me, [me, alt]), 'an alternate position of the same stand');
  assert.ok(!G.bridgeClear(-10, 60, 5, 0, me, [me, other], [[-20, 20, 20, 30]]), 'across a neighbour\'s bridge');
  assert.ok(G.bridgeClear(-10, 60, 5, 0, me, [me, other], [[-60, 20, -30, 30]]), 'clear of a neighbour\'s bridge');
  // a building in the way: the leg may not cross its outline (the ring carries its box, as gateMore()'s do)
  const shed = [[-8, 20], [0, 20], [0, 30], [-8, 30]]; shed.bb = [-8, 20, 0, 30];
  const far = [[100, 100], [110, 100], [110, 110], [100, 110]]; far.bb = [100, 100, 110, 110];
  assert.ok(!G.bridgeClear(-10, 60, 5, 0, me, [me], null, [far, shed]), 'through a building');
  assert.ok(G.bridgeClear(-10, 60, 5, 0, me, [me], null, [far]), 'a building elsewhere');
  // Frankfurt's C14: the long link through a 10 m building is refused
  const fra = airport('EDDF', 'europe/airports'), c14 = fra.stands.find((q) => String(q.ref) === 'C14');
  assert.ok(c14 && G.jetBridge(c14, terms(fra), 80, true, null, { stands: fra.stands }) && !G.jetBridge(c14, terms(fra), 80, true, null, G.gateMore(fra)));
  const m = G.gateMore(fra);
  assert.ok(m === G.gateMore(fra) && m.others.length > 100 && m.others.every((r) => r.bb && r.bb[0] <= r.bb[2]) && m.stands === fra.stands);
  assert.equal(G.segSegDist(0, 0, 10, 0, 5, -5, 5, 5), 0);
  assert.equal(G.segSegDist(0, 0, 10, 0, 0, 3, 10, 3), 3);
  assert.ok(Math.abs(G.segSegDist(0, 0, 10, 0, 13, 4, 20, 4) - 5) < 1e-9);
});

// The code review's fourth finding: 22 gates with an aircraft parked off the stand's heading (no door known) had
// their bridges drawn back as if empty.
test('a gate somebody stands at with no door known keeps the default bridge', { skip: !ON }, () => {
  assert.deepEqual(G.GATE_OCCUPIED, { occupied: true });
  const apron = readFileSync(new URL('../src/world/apron.js', import.meta.url), 'utf8'), world = readFileSync(new URL('../src/world/world.js', import.meta.url), 'utf8');
  assert.ok(apron.includes('const door = at && at.back != null ? at : null;') && apron.includes('retract: !at }'), 'apron.js: retract only where nothing is at the gate');
  assert.ok(/doors\.set\(String\(p\.stand\), GATE_OCCUPIED\)/.test(world) && world.includes('playerDoor || GATE_OCCUPIED'), 'world.js marks the gate occupied');
  // at Gimpo and Incheon some parked aircraft stand off their stands' headings: parkedDoor() has no door for them
  let off = 0;
  for (const icao of ['RKSS', 'RKSI']) {
    const ap = airport(icao);
    for (const p of placeParked(ap, { wide: icao === 'RKSI' })) {
      const s = ap.stands.filter((t) => String(t.ref) === String(p.stand)).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (s && s.gate && !G.parkedDoor(s, p) && Math.hypot(s.x - p.x, s.y - p.y) < 40) off++;
    }
  }
  assert.ok(off >= 5, `${off} parked at a gate with no door known`);
});

test('a gate nobody stands at has its bridge drawn back; a door given holds the cab at the door', { skip: !ON }, () => {
  let n = 0;
  for (const [icao, dir] of [['EGLL', 'europe/airports'], ['ZSQD', 'airports'], ['RKSI', 'airports']]) {
    const a = airport(icao, dir), T = terms(a);
    for (const s of a.stands.filter((x) => x.gate)) {
      const out = G.jetBridge(s, T, 80, true, null, G.gateMore(a)), back = G.jetBridge(s, T, 80, true, null, { ...G.gateMore(a), retract: true });
      assert.equal(!!out, !!back, `${icao} ${s.ref}`);
      if (!out) continue;
      n++;
      assert.deepEqual(back.root, out.root);
      const from = out.elbow || out.root, d0 = Math.hypot(out.door.x - from.x, out.door.y - from.y), d1 = Math.hypot(back.door.x - from.x, back.door.y - from.y);
      assert.ok(Math.abs(d1 - Math.min(d0, Math.max(d0 * G.GATE_RETRACT, 6))) < 1e-6, `${icao} ${s.ref}: ${d0} -> ${d1}`);
      assert.ok(back.length < out.length + 1e-9);
      // drawn back along the tunnel's last leg: the door on the line from the wall (or the elbow) to where it was
      const cr = (back.door.x - from.x) * (out.door.y - from.y) - (back.door.y - from.y) * (out.door.x - from.x);
      assert.ok(Math.abs(cr) < 1e-6 * (1 + d0 * d0));
      const D = B77W.GATE_DOOR;
      assert.deepEqual(G.jetBridge(s, T, 80, true, D, { ...G.gateMore(a), retract: true }), G.jetBridge(s, T, 80, true, D, G.gateMore(a)), 'with an aircraft at the gate, not drawn back');
    }
  }
  assert.ok(n > 250, `${n} bridges`);
});
