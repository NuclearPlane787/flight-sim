// v0.7.8, part 1: the gates at every airport ("Found while building v0.7.6"). The stop bar and the jet bridge's cab
// stood 21 m ahead of the aircraft they serve wherever the fit wasn't used; v0.7.6 fitted four airports. Now the fit is
// everywhere by default (apron-geom.js GATES78; ?gates78=0 or FS_GATES78=0 gives the pushed v0.7.7's gates), the
// lead-in line ends at the stop bar, and a gate's cab stands at the front door of the aircraft at that gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import * as G from '../src/world/apron-geom.js';
import { GATE_DOOR as A321_DOOR, NOSE_X, GEAR } from '../src/geometry.js';
import { GATE_DOOR as B787_DOOR } from '../src/geometry-b787-9.js';
import { GATE_DOOR as B777_DOOR } from '../src/geometry-b777-300er.js';
import { B787_9, B777_300ER } from '../src/widebody-specs.js';

const HASH = fileURLToPath(new URL('./v078-gates-hash.mjs', import.meta.url));
const run = (env) => execFileSync(process.execPath, [HASH], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
// The frozen v0.7.7's answer from the same script (every stand's paint and every gate's bridge, both regions, but the
// three airports part 3 may bake again): taken from the pushed tree at the start of v0.7.8's run.
const V077 = '858065d1678334c86ff42c00ee0a28c46a94410184dd0f0b15dbe16d3257d4cf stands 9952 gates 2480 bridges 1869';

const airports = function* () {
  for (const dir of ['../data/airports/', '../data/europe/airports/']) {
    const base = new URL(dir, import.meta.url);
    for (const f of readdirSync(base).filter((n) => /^[A-Z]{4}\.json$/.test(n)).sort()) yield JSON.parse(readFileSync(new URL(f, base), 'utf8'));
  }
};
const terms = (a) => (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => G.openRing(b.points));

test('switched off (FS_GATES78=0), every stand and bridge at every airport is the pushed v0.7.7\'s', () => {
  assert.equal(run({ FS_GATES78: '0', FS_GATEFIT: '' }), V077);
});

test('on by default: the fit at every airport, and more gates bridged than before', () => {
  assert.equal(G.GATES78, process.env.FS_GATES78 !== '0');
  if (!G.GATES78) return;
  for (const i of ['RKSI', 'RJTT', 'EGLL', 'LFPG', 'EDDF', 'LEBL', 'RJGG']) assert.equal(G.gateFit(i), true, i);
  const out = run({ FS_GATES78: '', FS_GATEFIT: '' });
  assert.notEqual(out, V077);
  assert.ok(+/bridges (\d+)/.exec(out)[1] > 1869, out);
});

test('the lead-in line ends at the stop bar (within 6 cm) at all but a few stands whose mapped line runs the other way', () => {
  let n = 0, odd = 0;
  for (const a of airports()) for (const s of a.stands || []) {
    const m = G.standMarks(s, true), e = m.lead[m.lead.length - 1];
    const ahead = (e[0] - m.stop.x) * m.stop.dx + (e[1] - m.stop.y) * m.stop.dy;
    n++;
    if (G.GATES78 && Math.abs(ahead) > 0.06) odd++;   // (switched off, v0.7.7's line runs on to the stand point)
    // the bar itself: the nose wheel of an aircraft whose nose is on the stand point
    const f = (m.stop.x - s.x) * m.stop.dx + (m.stop.y - s.y) * m.stop.dy;
    assert.ok(Math.abs(f - (G.NOSE_WHEEL - NOSE_X)) < 1e-6);
  }
  assert.ok(n > 9000 && odd <= 12, `${odd} of ${n}`);   // 7 at the start of v0.7.8: Nantes's R2 to R7, Incheon's R19 and R64
});

test('trimLeadAt(): cut where the line crosses the bar; a line short of it or wholly past it is left whole', () => {
  const stop = { x: 0, y: 0, dx: 0, dy: 1 };
  assert.deepEqual(G.trimLeadAt([[0, -60], [0, -10], [0, 5.3]], stop), [[0, -60], [0, -10], [0, 0]]);
  assert.deepEqual(G.trimLeadAt([[4, -60], [2, -2], [0, 2], [0, 5.3]], stop), [[4, -60], [2, -2], [1, 0]]);
  const short = [[0, -60], [0, -1]];
  assert.equal(G.trimLeadAt(short, stop), short);
  const past = [[0, 5.3], [0, 0.5]];
  assert.equal(G.trimLeadAt(past, stop), past);
  assert.deepEqual(G.trimLeadAt([[0, -60], [0, 0], [0, 5.3]], stop), [[0, -60], [0, 0]]);   // a point on the bar: no second one
});

test('the doors: each type\'s own, from its geometry', () => {
  assert.deepEqual(A321_DOOR, { back: NOSE_X - G.DOOR_FWD, half: G.FUSE_HALF, sill: G.DOOR_SILL });
  assert.equal(B787_DOOR.back, B787_9.cabin.doors[0]);
  assert.equal(B777_DOOR.back, B777_300ER.cabin.doors[0]);
  assert.ok(B787_DOOR.back > 6 && B787_DOOR.back < 6.6 && B777_DOOR.back > 6.5 && B777_DOOR.back < 7.1);   // further back than the A321's 4 m
  assert.ok(B787_DOOR.half > 2.89 && B777_DOOR.half > 3.10 && B777_DOOR.half > B787_DOOR.half);        // outside the widest fuselage
  assert.ok(B787_DOOR.sill > A321_DOOR.sill && B777_DOOR.sill >= B787_DOOR.sill);
  assert.deepEqual(G.GATE_DOOR_DEFAULT, { back: 4, half: G.GATE_FIT_HALF, sill: G.DOOR_SILL });
  assert.ok(Math.abs(GEAR.nose.x - G.NOSE_WHEEL) < 0.5);
});

test('jetBridge() with a door: the cab at that door, the default where none is given, nothing without the fit', () => {
  const s = { ref: '1', x: 10, y: -4, hdgGridDeg: 30, gate: true };
  const [dx, dy] = G.hdgVec(30), lx = -dy, ly = dx;
  const term = [[-200, 60], [200, 60], [200, 100], [-200, 100]];
  const d0 = G.jetBridge(s, [term], 80, true), d4 = G.jetBridge(s, [term], 80, true, G.GATE_DOOR_DEFAULT);
  assert.deepEqual(d4.door, d0.door); assert.deepEqual(d4.root, d0.root);
  for (const D of [A321_DOOR, B787_DOOR, B777_DOOR]) {
    const jb = G.jetBridge(s, [term], 80, true, D);
    assert.ok(jb, 'a bridge');
    const f = (jb.door.x - s.x) * dx + (jb.door.y - s.y) * dy, l = (jb.door.x - s.x) * lx + (jb.door.y - s.y) * ly;
    assert.ok(Math.abs(f + D.back) < 1e-9 && Math.abs(l - D.half) < 1e-9, `${f} ${l}`);
    assert.equal(jb.sill, D.sill);
  }
  assert.deepEqual(G.jetBridge(s, [term], 80, false, B777_DOOR), G.jetBridge(s, [term], 80, false));   // no fit, no door
  assert.equal(d0.sill, undefined);
});

test('parkedDoor(): the parked types\' doors, moved back with a nose the layout moved back; null off the heading', () => {
  const st = { x: 100, y: 50, hdgGridDeg: 90 };
  assert.deepEqual(G.parkedDoor(st, { type: 0, x: 100, y: 50, hdg: Math.PI / 2, lenScale: 1 }), G.PARKED_DOORS[0]);
  assert.deepEqual(G.parkedDoor(st, { type: 1, x: 97, y: 50, hdg: Math.PI / 2, lenScale: 1 }), { ...G.PARKED_DOORS[1], back: 9.3 });
  assert.equal(G.parkedDoor(st, { type: 0, x: 100, y: 50, hdg: Math.PI / 2 + 0.2, lenScale: 1 }), null);
  assert.equal(G.parkedDoor(st, { type: 0, x: 100, y: 50, hdg: Math.PI / 2, lenScale: 0.8 }).back, 3.2);
});

test('at the six airports of the check, every gate bridged before is bridged with each type\'s door, but a handful', () => {
  for (const [icao, dir] of [['RKSI', 'airports'], ['RJTT', 'airports'], ['EGLL', 'europe/airports'], ['LFPG', 'europe/airports'], ['EDDF', 'europe/airports'], ['LEBL', 'europe/airports']]) {
    const a = JSON.parse(readFileSync(new URL(`../data/${dir}/${icao}.json`, import.meta.url), 'utf8')), T = terms(a);
    let had = 0, lost = 0, has = 0;
    for (const s of a.stands.filter((x) => x.gate)) {
      const o = G.jetBridge(s, T);
      if (o) had++;
      for (const D of [A321_DOOR, B787_DOOR, B777_DOOR]) {
        const n = G.jetBridge(s, T, 80, true, D);
        if (o && !n) lost++;
        if (!n) continue;
        has++;
        assert.ok(n.length >= 4 && n.length <= 82, `${icao} ${s.ref}: ${n.length}`);
        const [dx, dy] = G.hdgVec(s.hdgGridDeg), rx = n.root.x - n.door.x, ry = n.root.y - n.door.y;
        // the root clear of the nose (ahead of its tip by 3 m, or 3 m out to the left of the door) and never right of the centreline
        assert.ok(rx * -dy + ry * dx >= 3 - 1e-6 || rx * dx + ry * dy >= D.back + 3 - 1e-6, `${icao} ${s.ref}`);
        assert.ok(rx * -dy + ry * dx >= -D.half - 1e-6, `${icao} ${s.ref}: the root right of the centreline`);
      }
    }
    assert.ok(has >= had * 3 && lost <= 12, `${icao}: ${had} bridged before, ${has} of ${had * 3} now, ${lost} lost`);
  }
});
