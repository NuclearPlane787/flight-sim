// v0.6.0: buildPavement's chunks (apron.js, the airports built near the camera in slices) rest on two
// properties of apron-geom.js: clipSoupOutside works triangle by triangle in order, and refineSoup's
// stack refines the last triangle first. So clipping chunks in order and refining chunks last first
// gives exactly refineSoup(clipSoupOutside(whole)). Checked here on every new and old airport's aprons,
// over bumpy ground (so the refinement splits), with the chunk size apron.js uses.
// Run: node --test tests/apron-chunks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { clipSoupOutside, refineSoup, subdivideSoup, drawnRunwayRects, openRing, signedArea, dedupePolys } from '../src/world/apron-geom.js';

const CHUNK = 6 * 16;
const ICAOS = ['RKSS', 'RKPC', 'RKSI', 'ZSPD', 'RJTT', 'RJAA', 'RKPK', 'ZSSS', 'RJBB', 'RJFF', 'ZSQD', 'ZSYN'];   // (ZSYN: v0.6.1)
const ground = (x, y) => 3 * Math.sin(x / 37) * Math.cos(y / 53) + 0.5 * Math.sin((x + y) / 7);

function chunked(whole, rects) {
  const clipped = [], out = [];
  for (let i = 0; i < whole.length; i += CHUNK) clipSoupOutside(whole.length <= CHUNK ? whole : whole.slice(i, i + CHUNK), rects, clipped);
  for (let end = clipped.length; end > 0; end -= CHUNK) {
    for (const v of refineSoup(clipped.length <= CHUNK ? clipped : clipped.slice(Math.max(0, end - CHUNK), end), ground)) out.push(v);
  }
  return out;
}

test('pavement chunks: the same triangles in the same order as in one go', () => {
  let polys = 0, tris = 0;
  for (const icao of ICAOS) {
    const a = JSON.parse(readFileSync(new URL(`../data/airports/${icao}.json`, import.meta.url)));
    const rects = drawnRunwayRects(a, 0.05);
    for (const ap of dedupePolys(a.aprons || [])) {
      let ring = openRing(ap.points);
      if (ring.length < 3) continue;
      if (signedArea(ring) < 0) ring = ring.slice().reverse();
      const faces = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
      const soup = [];
      for (const f of faces) for (const k of f) soup.push(ring[k][0], ring[k][1]);
      const whole = subdivideSoup(soup, 30);
      const one = refineSoup(clipSoupOutside(whole, rects), ground);
      const many = chunked(whole, rects);
      assert.equal(many.length, one.length, `${icao}: length`);
      for (let i = 0; i < one.length; i++) if (one[i] !== many[i]) assert.fail(`${icao}: differs at ${i}`);
      polys++; tris += one.length / 6;
    }
  }
  assert.ok(polys > 50 && tris > 10000, `${polys} aprons, ${tris} triangles`);
});
