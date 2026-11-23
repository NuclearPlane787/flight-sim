// Runways that cross (v0.1.4): one surface where they meet, and the ground on every runway is
// that runway's surface.
//   python3 tools/cpu-guard.py -- node --test tests/runways.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAirports, profileAt, runwayCrossings, pavementEnd, RUNWAY_SHOULDER_M, CROSSINGS78 } from '../src/world/runways.js';
import { createHeightfield } from '../src/world/heightfield.js';

const here = new URL('..', import.meta.url).pathname;
const load = (icao) => JSON.parse(readFileSync(here + `data/airports/${icao}.json`, 'utf8'));
const axisOf = (r) => {
  const p0 = pavementEnd(r.ends[0]), p1 = pavementEnd(r.ends[1]), len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return { p0, len, ux: (p1.x - p0.x) / len, uy: (p1.y - p0.y) / len };
};
const straight = (r, s, len) => r.ends[0].elevM + (r.ends[1].elevM - r.ends[0].elevM) * Math.min(Math.max(s / len, 0), 1);

test('Jeju: 07/25 is the primary; 13/31 bends to meet it at its edges and is cut there', () => {
  const ap = load('RKPC');
  runwayCrossings(ap);
  const A = ap.runways.find((r) => r.id === '07/25'), B = ap.runways.find((r) => r.id === '13/31');
  assert.ok(A.rank > B.rank, 'the longer runway ranks higher');
  assert.equal(A.knots.length, 0);
  assert.equal(A.cutBy.length, 0);
  // v0.7.8 (changed on purpose): four bends a crossing (runways.js CROSSINGS78), each where one of 07/25's drawn edges
  // meets one of 13/31's two sides; with FS_CROSSINGS78=0 the two of v0.1.4, where its centreline meets those edges.
  assert.equal(B.knots.length, CROSSINGS78 ? 4 : 2);
  assert.equal(B.cutBy.length, 1);
  assert.equal(B.cutBy[0], A);
  const a = axisOf(A), b = axisOf(B);
  for (const [s, h] of B.knots) {
    // (v0.7.8: the bend is on 07/25's edge at one of 13/31's sides, v m to its left; before, on its centreline)
    const hwB = B.widthM / 2 + RUNWAY_SHOULDER_M, sides = CROSSINGS78 ? [-hwB, hwB] : [0];
    const hit = sides.map((v) => {
      const x = b.p0.x + b.ux * s - b.uy * v, y = b.p0.y + b.uy * s + b.ux * v;
      return { sA: (x - a.p0.x) * a.ux + (y - a.p0.y) * a.uy, across: -(x - a.p0.x) * a.uy + (y - a.p0.y) * a.ux };
    }).find((q) => Math.abs(Math.abs(q.across) - (A.widthM / 2 + RUNWAY_SHOULDER_M)) < 0.01);
    assert.ok(hit, "the bend is on 07/25's drawn edge");
    const sA = hit.sA;
    assert.ok(Math.abs(h - straight(A, sA, a.len)) < 1e-6, '13/31 meets 07/25 there');
    assert.ok(Math.abs(profileAt(B, s) - h) < 1e-9);
    assert.ok(Math.abs(h - straight(B, s, b.len)) < 0.5, `a small bend (${(h - straight(B, s, b.len)).toFixed(2)} m)`);
  }
  assert.equal(profileAt(B, 0), B.ends[0].elevM, 'the ends keep their published elevations');
  assert.equal(profileAt(B, b.len), B.ends[1].elevM);
});

test("the ground on every runway is that runway's surface (before v0.1.4, 0.69 m off on Jeju's 07/25)", () => {
  for (const icao of ['RKSS', 'RKPC', 'RKSI']) {
    const { airports } = createAirports([load(icao)]);
    const hf = createHeightfield({}, { airports: [load(icao)] });   // its own copy, as the game's heightfield loads its own
    for (const r of airports[0].runways) {
      const ax = axisOf(r);
      let worst = 0, n = 0;
      for (let s = 0; s <= ax.len; s += 10) {
        const x = ax.p0.x + ax.ux * s, y = ax.p0.y + ax.uy * s;
        const P = (r.cutBy || [])[0];   // on a longer runway that crosses this one, the ground is that runway's
        if (P) { const pa = axisOf(P); if (Math.abs(-(x - pa.p0.x) * pa.uy + (y - pa.p0.y) * pa.ux) <= P.widthM / 2 + RUNWAY_SHOULDER_M) continue; }
        worst = Math.max(worst, Math.abs(hf.heightAt(x, y) - profileAt(r, s, airports[0].elevM)));
        n++;
      }
      assert.ok(n > 100, `${icao} ${r.id}: sampled`);
      assert.ok(worst < 0.005, `${icao} ${r.id}: the ground is ${worst.toFixed(3)} m off the runway's surface`);
    }
  }
});
