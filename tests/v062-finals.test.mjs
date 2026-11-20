// v0.6.2: every runway end's straight-in final (a 15 nm final start, Skip to final: main.js placeOnFinal, 15 m over the
// threshold plus the 3° slope) clears the terrain, except the ends marked circling-only (runways.js CIRCLING_ONLY:
// Gimhae's 18L and 18R, flown by a circle from the approach to 36), whose 3° path runs into the hills: so the game
// offers no straight-in final to those. Skipped while the region's tiles aren't in data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { terrainSpec } from '../src/world/region.js';
import { createAirports, CIRCLING_ONLY, circlingOnly } from '../src/world/runways.js';
import { manifest, readGz, readJson, DATA } from './tile-terrain.mjs';

const m = manifest();
const HAVE = !!m.tilesRegion;
const NM = 1852, DEG = Math.PI / 180;
const CLEAR_M = 60;   // what a straight-in final keeps between itself and the ground, 1 to 15 nm out

test('the circling-only ends: Gimhae 18L and 18R (and since v0.6.4 Wonsan 33L and 33R), marked on the airports, and nothing else', () => {
  assert.deepEqual(CIRCLING_ONLY, { RKPK: ['18L', '18R'], ZKWS: ['33L', '33R'] });
  assert.ok(circlingOnly('ZKWS', '33L') && circlingOnly('ZKWS', '33R') && !circlingOnly('ZKWS', '15R') && !circlingOnly('ZKPY', '35'));
  assert.ok(circlingOnly('RKPK', '18l') && circlingOnly('RKPK', '18R') && !circlingOnly('RKPK', '36L') && !circlingOnly('RKSS', '14R'));
  const aps = createAirports([{ icao: 'RKPK', runways: [{ ends: [{ ident: '18L', x: 0, y: 1000 }, { ident: '36R', x: 0, y: -1000 }] }] }]);
  assert.equal(aps.airports[0].runways[0].ends[0].circling, true);
  assert.equal(aps.airports[0].runways[0].ends[1].circling, undefined);
});

test('every straight-in final clears the ground by 60 m from 1 to 15 nm out, but the circling-only ends', { skip: !HAVE }, async () => {
  const spec = terrainSpec(m, true);
  const aps = spec.airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  const hf = await createTiledHeightfield(m, DATA.href, { region: true, layers: ['h'], airports: aps, readGz, readJson, maxTiles: 400 });
  const A = createAirports(aps);
  const rows = [];
  for (const a of aps) for (const r of a.runways) for (const e of r.ends) {
    const f = A.findRunwayEnd(a.icao, e.ident);
    await hf.tiles.whenReady(f.thrX - f.ux * 8 * NM, f.thrY - f.uy * 8 * NM, 9 * NM, 'test');
    let worst = Infinity, at = 0;
    for (let d = NM; d <= 15 * NM; d += 100) {
      const x = f.thrX - f.ux * d, y = f.thrY - f.uy * d;
      const clear = f.elevM + 15 + Math.tan(3 * DEG) * d - hf.heightAt(x, y);
      if (clear < worst) { worst = clear; at = d; }
    }
    rows.push({ end: `${a.icao} ${e.ident}`, worst, at: at / NM, circling: f.circling });
  }
  rows.sort((p, q) => p.worst - q.worst);
  console.log(rows.slice(0, 8).map((r) => `  ${r.end}: ${r.worst.toFixed(0)} m clear at ${r.at.toFixed(1)} nm${r.circling ? ' (circling only)' : ''}`).join('\n'));
  for (const r of rows) {
    if (r.circling) assert.ok(r.worst < CLEAR_M, `${r.end} is marked circling-only but its final clears the ground by ${r.worst.toFixed(0)} m`);
    else assert.ok(r.worst >= CLEAR_M, `${r.end}: the straight-in final is ${r.worst.toFixed(0)} m over the ground ${r.at.toFixed(1)} nm out`);
  }
  // Every listed airport's circling-only ends were met (2 at Gimhae; 2 more once Wonsan is listed, v0.6.4).
  assert.equal(rows.filter((r) => r.circling).length, aps.reduce((n, a) => n + (CIRCLING_ONLY[a.icao] || []).length, 0));
  assert.ok(rows.filter((r) => r.circling).length >= 2);
});
