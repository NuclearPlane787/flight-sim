// v0.7.4 part 9, item 4: Venice's land floor by the water mask, not a box (ROADMAP, "Found while building v0.7.3").
// v0.7.3's LAND_FLOOR (tools/bake_region_patches.py) raised every cell of the patch's land mask under 1 m inside a box
// round the old city, and that mask counts inland water as land: the lagoon round the city (WorldCover's water on OSM's
// land) went from about -2 m to 1 m inside the box and stayed at about -2 m outside it, a step of up to 3 m in the water
// at the box's edge. v0.7.4 raises land only (not the sea, not inland water) and eases the floor off over 300 m outside
// the box. Checked here on the installed patch (data/europe/terrain/patch-venice.i16.gz) and on the ground the game
// reads (heightfield.js), in Europe's frame:
//   - four lines across the old box's four edges, over open lagoon on both sides: the water level has no step over 0.1 m;
//   - the old city's islands stand on the floor, 1 m (v0.7.3's heights, within 0.1 m), above that water.
//   FS_REGION=europe node --test tests/v074-venice-floor.test.mjs
import { inRegion } from './region-run.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

if (inRegion('europe', import.meta.url)) {
  const DATA = new URL('../data/europe/', import.meta.url);
  const BOX = [640500, -141500, 650500, -134500];    // v0.7.3's box (x0, y0, x1, y1, map m)
  // [name, the fixed coordinate (a row or column of the patch's cell centres), the axis it runs along, the edge, which way
  // is out, how far each way (m)]: each line runs from that far outside the edge to as far inside it, over water the
  // bake's own mask calls inland water on both sides (and on the rows beside it), away from the box's corners. The north
  // edge's open water is narrower (240 m each way). Chosen with a probe over the baked masks (the patches subagent's).
  const LINES = [['west', -139875, 'x', BOX[0], -1, 600], ['east', -137295, 'x', BOX[2], 1, 600], ['south', 642645, 'y', BOX[1], -1, 600], ['north', 646725, 'y', BOX[3], 1, 240]];
  // Old-city points (lat, lon): San Marco, Rialto, Cannaregio, Castello, Dorsoduro.
  const CITY = [[45.4341, 12.3388], [45.4381, 12.3359], [45.4450, 12.3260], [45.4340, 12.3530], [45.4310, 12.3270]];
  const m = JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
  const P = m.patchesRegion.find((p) => p.id === 'venice');
  const raw = gunzipSync(readFileSync(new URL(P.height, DATA)));
  const H = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const cellH = (x, y) => H[Math.floor((y - P.y0) / P.cell) * P.nx + Math.floor((x - P.x0) / P.cell)] * m.heightScale;
  const along = (fixed, axis, edge, out, reach, step) => {
    const pts = [];
    for (let d = -reach; d <= reach + 1e-6; d += step) { const v = edge + out * d; pts.push(axis === 'x' ? [v, fixed] : [fixed, v]); }
    return pts;
  };

  test('Venice: the patch\'s lagoon is level across the old LAND_FLOOR box\'s four edges (no step over 0.1 m)', () => {
    for (const [name, fixed, axis, edge, out, reach] of LINES) {
      const v = along(fixed, axis, edge, out, reach, P.cell).map(([x, y]) => cellH(x, y));
      let worst = 0;
      for (let i = 1; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - v[i - 1]));
      console.log(`  ${name} edge: ${v.length} cells, the water ${Math.min(...v).toFixed(2)} to ${Math.max(...v).toFixed(2)} m, the largest step ${worst.toFixed(2)} m`);
      assert.ok(Math.max(...v) < 0.5, `${name}: water, not raised land (${Math.max(...v)} m)`);
      assert.ok(worst <= 0.1, `${name}: a step of ${worst.toFixed(2)} m in the water across the box's edge`);
    }
  });

  test('Venice: the ground the game reads: the lagoon level across the edges, the old city on its 1 m floor above it', async () => {
    const { createTiledHeightfield } = await import('../src/world/heightfield.js');
    const { toMap } = await import('../src/world/frame.js');
    const readGz = async (rel) => { try { const b = gunzipSync(readFileSync(new URL(rel, DATA))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } catch (e) { return null; } };
    const readJson = async (rel) => JSON.parse(readFileSync(new URL(rel, DATA), 'utf8'));
    const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: [], readGz, readJson, layers: ['h', 'w'], maxTiles: 40 });
    await hf.tiles.whenReady((BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2, 9000, 'test');
    for (const [name, fixed, axis, edge, out, far] of LINES) {
      const reach = far - 15;     // (inside the cells sampled above: bilinear between their centres)
      const pts = along(fixed, axis, edge, out, reach, 10);
      const v = pts.map(([x, y]) => hf.heightAt(x, y));
      const wet = pts.filter(([x, y]) => hf.waterAt(x, y)).length;
      let worst = 0;
      for (let i = 1; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - v[i - 1]));
      console.log(`  ${name} edge (heightAt every 10 m): ${wet} of ${pts.length} points water to the game, the largest step ${worst.toFixed(3)} m`);
      assert.ok(wet >= pts.length * 0.8, `${name}: the line is the lagoon's water to the game (${wet} of ${pts.length})`);
      assert.ok(worst <= 0.1, `${name}: a step of ${worst.toFixed(2)} m`);
    }
    const water = Math.max(...LINES.map(([, fixed, axis, edge]) => cellH(...(axis === 'x' ? [edge, fixed] : [fixed, edge]))));
    for (const [la, lo] of CITY) {
      const [x, y] = toMap(la, lo), g = cellH(x, y);
      console.log(`  old city ${la}, ${lo}: the patch ${g.toFixed(2)} m, the game's ground ${hf.heightAt(x, y).toFixed(2)} m`);
      assert.ok(Math.abs(g - 1.0) <= 0.1, `${la}, ${lo}: ${g} m, v0.7.3's floor 1 m`);
      assert.ok(g > water + 0.5, `${la}, ${lo}: above the lagoon's ${water} m (the highest of the four lines' water at the edge)`);
    }
  });
}
