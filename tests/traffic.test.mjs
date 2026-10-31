// Airport life: parked aircraft placement, vehicles and the low-poly models.
//   node --test games/flight-sim/tests/traffic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  placeParked, blockedByPlayer, createVehicles, chainRoads, makePath, pathAt, rectsOverlap, standHeading, pointInPoly,
} from '../src/world/traffic-layout.js';
import { AIRLINER_TYPES, buildAirliner, buildAirlinerFar, buildVehicle } from '../src/world/traffic-models.js';
import { LIVERIES } from '../src/world/liveries-other.js';

const DIR = new URL('../data/airports/', import.meta.url);
const ICAOS = ['RKSS', 'RKPC', 'RKSI'];
const have = (icao) => existsSync(new URL(`${icao}.json`, DIR));
const load = (icao) => JSON.parse(readFileSync(new URL(`${icao}.json`, DIR)));

for (const icao of ICAOS) {
  test(`${icao}: parked aircraft are seeded, ~70% full, and never overlap`, { skip: !have(icao) && 'no airport data' }, () => {
    const a = load(icao);
    const P = placeParked(a), Q = placeParked(a);
    assert.deepEqual(P.map((p) => [p.stand, p.type, p.livery, p.x, p.y]), Q.map((p) => [p.stand, p.type, p.livery, p.x, p.y]));
    const share = P.length / a.stands.length;
    assert.ok(share > 0.6 && share <= 0.71, `fill ${share.toFixed(2)}`);
    // Footprints carry a 2 m margin; with it they still don't touch (4 m wingtip gaps).
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      for (const r of P[i].fp) for (const s of P[j].fp) assert.ok(!rectsOverlap(r, s), `${P[i].stand} overlaps ${P[j].stand}`);
    }
    // No nose inside a building.
    for (const p of P) for (const b of a.buildings) assert.ok(!pointInPoly(p.x, p.y, b.points), `${p.stand} nose in a building`);
    // Widebodies only at Incheon; every livery used.
    const wide = P.filter((p) => p.type === 1).length;
    if (icao === 'RKSI') assert.ok(wide > 30, `${wide} widebodies`); else assert.equal(wide, 0);
    for (let l = 0; l < LIVERIES.length; l++) assert.ok(P.some((p) => p.livery === l), `livery ${l} unused`);
  });

  test(`${icao}: the player's stand is kept free`, { skip: !have(icao) && 'no airport data' }, () => {
    const a = load(icao);
    const P = placeParked(a);
    const p = P[5];
    const hidden = blockedByPlayer(a, P, p.stand);
    assert.ok(hidden.has(5));
    assert.ok(hidden.size < 6, `${hidden.size} hidden`);
    assert.equal(blockedByPlayer(a, P, 'no-such-stand').size, 0);
  });

  test(`${icao}: vehicles drive the service roads, deterministically and cheaply`, { skip: !have(icao) && 'no airport data' }, () => {
    const a = load(icao);
    const f = createVehicles(a), g = createVehicles(a);
    assert.ok(f.drivers.length >= 20 && f.drivers.length <= 40, `${f.drivers.length} drivers`);
    for (const d of f.drivers) assert.ok(d.speed >= 5 && d.speed <= 10);
    for (let i = 0; i < 600; i++) { f.step(1 / 60); g.step(1 / 60); }
    assert.deepEqual(f.vehicles.map((v) => [v.x, v.y]), g.vehicles.map((v) => [v.x, v.y]));
    // Every vehicle is within a lane of its road's centreline.
    for (const d of f.drivers) {
      const P = d.path.pts;
      for (const u of d.units) {
        let best = Infinity;
        for (let i = 0; i < P.length - 1; i++) {
          const [ax, ay] = P[i], [bx, by] = P[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
          const t = Math.min(Math.max(((u.v.x - ax) * dx + (u.v.y - ay) * dy) / L2, 0), 1);
          best = Math.min(best, Math.hypot(ax + dx * t - u.v.x, ay + dy * t - u.v.y));
        }
        assert.ok(best < 4.5, `vehicle ${best.toFixed(1)} m off its lane`);
      }
    }
    // Cost: well under the 0.2 ms per frame budget.
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) f.step(1 / 60);
    const ms = (performance.now() - t0) / 1000;
    assert.ok(ms < 0.05, `${ms.toFixed(4)} ms per step`);
  });
}

test('stand headings follow Gimpo\'s lead-in lines', { skip: !have('RKSS') && 'no airport data' }, () => {
  const a = load('RKSS');
  // A lead-in taxiway line ending within 10 m of a stand: the heading runs along it.
  let n = 0, ok = 0;
  for (const s of a.stands) {
    for (const t of a.taxiways) {
      let P = t.points;
      if (Math.hypot(P[0][0] - s.x, P[0][1] - s.y) < Math.hypot(P[P.length - 1][0] - s.x, P[P.length - 1][1] - s.y)) P = P.slice().reverse();
      const e = P[P.length - 1], q = P[P.length - 2];
      if (Math.hypot(e[0] - s.x, e[1] - s.y) > 10 || Math.hypot(e[0] - q[0], e[1] - q[1]) < 8) continue;
      n++;
      const h = standHeading(a, s), hl = Math.atan2(e[0] - q[0], e[1] - q[1]);
      if (Math.abs(Math.atan2(Math.sin(h - hl), Math.cos(h - hl))) < 0.2) ok++;
      break;
    }
  }
  assert.ok(n > 10 && ok / n > 0.9, `${ok}/${n} aligned`);
});

test('road chaining and path walking', () => {
  const roads = [{ points: [[0, 0], [100, 0]] }, { points: [[100, 0], [100, 100]] }, { points: [[300, 0], [400, 0]] }];
  const c = chainRoads(roads);
  assert.equal(c.length, 2);
  assert.equal(c.find((r) => r.points.length === 3).points.length, 3);
  const p = makePath([[0, 0], [100, 0], [100, 100]], false);
  assert.equal(p.length, 200);
  const o = pathAt(p, 150, {});
  assert.ok(Math.abs(o.x - 100) < 1e-9 && Math.abs(o.y - 50) < 1e-9);
  assert.ok(Math.abs(o.hdg - 0) < 1e-9);    // heading north (grid)
  // Keep right: driving east, the offset path is south of the centreline.
  const r = makePath([[0, 0], [100, 0]], false, 2);
  assert.ok(Math.abs(r.pts[0][1] + 2) < 1e-9);
});

test('models stay within their triangle budgets', () => {
  for (const T of AIRLINER_TYPES) {
    const m = buildAirliner(T);
    assert.ok(m.triangles <= 8000, `${T.name} ${m.triangles}`);
    const n = m.position.length / 3;
    for (const i of m.index) assert.ok(i < n);
    // Nose tip at x = 0, tail at -length; nothing below the ground.
    let minX = 0, maxX = -1e9, minZ = 1e9, maxY = 0;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, m.position[i * 3]); maxX = Math.max(maxX, m.position[i * 3]);
      maxY = Math.max(maxY, Math.abs(m.position[i * 3 + 1])); minZ = Math.min(minZ, m.position[i * 3 + 2]);
    }
    assert.ok(Math.abs(maxX) < 0.01 && Math.abs(minX + T.length) < 1.5, `${T.name} x ${minX}..${maxX}`);
    assert.ok(Math.abs(maxY - T.span / 2) < 0.6, `${T.name} span ${2 * maxY}`);
    assert.ok(minZ > -0.01, `${T.name} min z ${minZ}`);
  }
  for (const k of ['tug', 'bus', 'cart', 'fuel']) assert.ok(buildVehicle(k).triangles <= 300, k);
});

test('liveries are made up', () => {
  const real = /korean air|asiana|jeju air|jin air|t'?way|air busan|air seoul|eastar|aero k|air premia|fly gangwon/i;
  for (const L of LIVERIES) assert.ok(!real.test(L.name), L.name);
  assert.equal(LIVERIES[0].name, 'Nuclear Airlines');
});

// The distance tier for parked aircraft (beyond 2 km) stays cheap.
test('far airliner models stay under 300 triangles', () => {
  for (const T of AIRLINER_TYPES) {
    const m = buildAirlinerFar(T);
    const tris = m.triangles ?? (m.index ? m.index.length / 3 : m.positions.length / 9);
    assert.ok(tris <= 300, `${T.id || T.name}: ${tris}`);
  }
});
