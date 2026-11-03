// The airport ground on the real terrain (v0.2.1), through apron.js's own builders: no taxiway,
// apron or stand pavement on a runway, none dipping under the ground anywhere, and the paint
// over the pavement (its lead lines on the runway's own surface).
//   python3 tools/cpu-guard.py -- node --test tests/apron-ground.test.mjs     (about 10 s: it unpacks the terrain)
// Shane, 2026-11-03: "Some taxiways at Jeju airport still clip strangely with the runway." In v0.2.0
// the taxiways ran half across the runways they join, 8 cm up (drawn over the runway from low
// down), and long flat triangles dipped up to 0.58 m under the ground on Jeju's parallel taxiway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadHeightfield } from '../src/world/heightfield.js';
import { buildPavement, buildPaint } from '../src/world/apron.js';
import { drawnRunwayRects, inRect, dedupePolys } from '../src/world/apron-geom.js';

// The heightfield loads with fetch(); here it reads the files.
globalThis.fetch = async (url) => {
  try { return new Response(readFileSync(fileURLToPath(url))); } catch { return new Response(null, { status: 404 }); }
};
const hf = await loadHeightfield(new URL('../data/', import.meta.url).href);
const ground = (x, y) => hf.heightAt(x, y);
const load = (icao) => JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url)));

for (const icao of ['RKPC', 'RKSS', 'RKSI']) {
  test(`${icao}: the pavement is off the runways and never under the ground`, () => {
    const a = load(icao), [ox, oy] = a.origin;
    const g = buildPavement(a, ox, oy, ground, dedupePolys(a.aprons || []));
    const p = g.getAttribute('position').array, rects = drawnRunwayRects(a, 0.05);
    let tris = 0, onRunway = 0, worst = Infinity, where = null;
    for (let i = 0; i < p.length; i += 9) {
      tris++;
      const P = [0, 3, 6].map((k) => [p[i + k] + ox, -p[i + k + 2] + oy]), H = [p[i + 1], p[i + 4], p[i + 7]];
      const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
      if (rects.some((r) => inRect(r, cx, cy))) onRunway++;
      for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
        const w = 4 - u - v, x = (P[0][0] * u + P[1][0] * v + P[2][0] * w) / 4, y = (P[0][1] * u + P[1][1] * v + P[2][1] * w) / 4;
        const d = (H[0] * u + H[1] * v + H[2] * w) / 4 - ground(x, y);
        if (d < worst) { worst = d; where = [Math.round(x), Math.round(y)]; }
      }
    }
    assert.ok(tris > 3000, `${tris} triangles`);
    assert.equal(onRunway, 0, `${onRunway} triangles on a runway`);
    // 8 cm up, split until the flat pieces keep within 2 cm of the ground's shape: at least 3 cm up
    // everywhere (the worst is about 4 cm, at Jeju).
    assert.ok(worst > 0.03, `the pavement is ${worst.toFixed(3)} m over the ground at ${where} (v0.2.0: down to −0.58 m at Jeju)`);
  });

  test(`${icao}: the paint follows the ground, and its lead lines lie on the runway`, () => {
    const a = load(icao), [ox, oy] = a.origin;
    const g = buildPaint(a, ox, oy, ground, dedupePolys(a.aprons || []), '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ').geo;
    const p = g.getAttribute('position').array, lay = g.getAttribute('lay').array, idx = g.getIndex().array;
    const rects = drawnRunwayRects(a);
    let worst = Infinity, lead = 0, leadOff = 0;
    // Each line segment is a quad (v0 v1 v3, v0 v3 v2): v0 at its start, v2 at its end.
    for (let i = 0; i < idx.length; i += 6) {
      const a0 = idx[i], b0 = idx[i + 5];
      const A = [p[a0 * 3] + ox, -p[a0 * 3 + 2] + oy, p[a0 * 3 + 1]], B = [p[b0 * 3] + ox, -p[b0 * 3 + 2] + oy, p[b0 * 3 + 1]];
      for (let k = 0; k <= 8; k++) {
        const x = A[0] + (B[0] - A[0]) * k / 8, y = A[1] + (B[1] - A[1]) * k / 8, h = A[2] + (B[2] - A[2]) * k / 8;
        const d = h - ground(x, y);
        if (lay[a0] > 0.5) {
          lead++;
          if (Math.abs(d) > 0.01) leadOff++;
        } else worst = Math.min(worst, d);
      }
      if (lay[a0] > 0.5) assert.ok(rects.some((r) => inRect({ ...r, u0: r.u0 - 1, u1: r.u1 + 1, hw: r.hw + 1 }, A[0], A[1])), 'a lead line is on a runway');
    }
    assert.ok(lead > 100, `${lead} lead-line samples`);
    assert.equal(leadOff, 0, `${leadOff} lead-line samples off the runway's surface by more than 1 cm`);
    // 10 cm up, kept within 3 cm of the ground at each segment's middle: about 5 cm at the least.
    assert.ok(worst > 0.04, `the paint is ${worst.toFixed(3)} m over the ground at its lowest`);
  });
}
