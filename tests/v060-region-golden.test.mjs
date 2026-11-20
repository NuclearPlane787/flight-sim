// v0.6.0: the three golden flights as the game flies them with EAST_ASIA_ON on: over the REGION's
// tiles (data/terrain/r0, loaded as the tests' "game" terrain), with all eleven airports'
// runways flattened and the local rules installed (WMM2025 beyond South Korea). They still match
// v0.5.8's recordings to 1e-9: South Korea's heights are the same doubles from the region's
// tiles, and inside south-korea.poly magVar() is the plane. (The golden modules load their
// terrain when imported, so the flag is set first and they are imported after it.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setEastAsia, EAST_ASIA_ON } from '../src/world/region.js';
import { manifest } from './tile-terrain.mjs';

const HAVE = !!manifest().tilesRegion;
const wasOn = EAST_ASIA_ON;
setEastAsia(true);
const { loadNodeRules } = await import('./v060-rules-helpers.mjs');
loadNodeRules();
const A = HAVE ? await import('./golden-a321-flight.mjs') : null;
const B = HAVE ? await import('./golden-boeing-flight.mjs') : null;

test('the region on: the golden A321 flight over the region\'s tiles matches to 1e-9', { skip: !HAVE }, () => {
  const gold = JSON.parse(gunzipSync(readFileSync(A.FIXTURE)).toString());
  const now = A.fly();
  assert.equal(now.rows.length, gold.rows.length);
  let worst = 0, where = '';
  gold.rows.forEach((row, i) => row.forEach((v, j) => { const d = Math.abs(v - now.rows[i][j]); if (d > worst) { worst = d; where = `${A.FIELDS[j]} at row ${i}`; } }));
  assert.ok(worst <= 1e-9, `worst difference ${worst} (${where})`);
  assert.deepEqual(now.end.modes, gold.end.modes);
});

for (const type of ['b787-9', 'b777-300er']) {
  test(`the region on: the golden ${type} flight over the region's tiles matches to 1e-9`, { skip: !HAVE }, () => {
    const gold = JSON.parse(gunzipSync(readFileSync(B.fixtureOf(type))).toString());
    const now = B.fly(type);
    assert.equal(now.rows.length, gold.rows.length);
    const { worst, where } = B.goldenWorst(gold, now, B.FIELDS);
    assert.ok(worst <= 1e-9, `worst difference ${worst} (${where})`);
  });
}

test('the region on: the flights flew the region\'s terrain with eleven airports', { skip: !HAVE }, async () => {
  assert.equal(EAST_ASIA_ON, true);
  assert.ok(wasOn === true || wasOn === false);
  // The terrain the golden modules loaded is the region's: Fuji stands in it (Korea's tiles
  // end 400 km east of the origin), and Haneda's and Pudong's runways are flattened in it.
  const { toMap } = await import('../src/world/frame.js');
  for (const M of [A, B]) {
    const hf = M.TILED.hf || M.TILED;
    const [fx, fy] = toMap(35.3606, 138.7274);
    await hf.tiles.whenReady(fx, fy, 2000, 'test-fuji');
    assert.ok(hf.heightAt(fx, fy) > 3500, `Fuji's summit in the flights' terrain: ${hf.heightAt(fx, fy).toFixed(0)} m`);
    const icaos = (hf.airports || M.TILED.airports || []).map((a) => a.icao);
    if (icaos.length) assert.equal(icaos.length, 17, icaos.join(' '));   // (eleven until v0.6.1's Yancheng, twelve until v0.6.3's five)
    hf.tiles.release('test-fuji');
  }
});
