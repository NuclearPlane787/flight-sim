// v0.6.0, the region's terrain (data/terrain/r0, r1, the manifest's tilesRegion): South Korea's
// heights, water and cover the same doubles as Korea's own tiles (briefs/V0-6-0.md, "Korea unchanged,
// exactly"), the new ground where it should be (Fuji, the new airports' runways, the margin's
// 1 km level), loaded by distance with no misses, and the GPU's clip window following the
// camera over it block by block. Skipped while the region's tiles aren't in data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { createClipWindow } from '../src/world/clipwindow.js';
import { terrainSpec, REGION_EXTENT, FINE_EXTENT } from '../src/world/region.js';
import { toMap } from '../src/world/frame.js';
import { runwayRects } from '../src/world/runways.js';
import { tiledTerrain, manifest, readGz, readJson, DATA } from './tile-terrain.mjs';

const m = manifest();
const HAVE = !!m.tilesRegion;
const spec = terrainSpec(m, true);
const airportsAll = spec.airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));

const region = (opts = {}) => createTiledHeightfield(m, DATA.href, { region: true, airports: airportsAll, readGz, readJson, ...opts });

test('the region: the manifest lists its tiles, patches and airports; the extents match region.js', { skip: !HAVE }, () => {
  assert.equal(spec.region, true);
  assert.equal(spec.airports.length, 12);   // v0.6.1: Yancheng
  assert.equal(spec.patches.length, 10);    // and its patch
  assert.equal(spec.coastPatches.length, 8);
  const t = m.tilesRegion, l0 = t.levels[0], l1 = t.levels[1];
  assert.deepEqual(FINE_EXTENT, { x0: t.x0 + l0.extent.i0 * l0.cell, y0: t.y0 + l0.extent.j0 * l0.cell, x1: t.x0 + l0.extent.i1 * l0.cell, y1: t.y0 + l0.extent.j1 * l0.cell });
  assert.deepEqual(REGION_EXTENT, { x0: t.x0 + l1.extent.i0 * l1.cell, y0: t.y0 + l1.extent.j0 * l1.cell, x1: t.x0 + l1.extent.i1 * l1.cell, y1: t.y0 + l1.extent.j1 * l1.cell });
  // With the flag off (the default) the game reads Korea's own tiles and three airports.
  const off = terrainSpec(m, false);
  assert.equal(off.region, false);
  assert.equal(off.tiles, m.tiles);
  assert.deepEqual(off.airports, m.airports);
  // Every airport of the region inside the 250 m data.
  for (const a of airportsAll) {
    const [x, y] = a.origin;
    assert.ok(x > FINE_EXTENT.x0 && x < FINE_EXTENT.x1 && y > FINE_EXTENT.y0 && y < FINE_EXTENT.y1, a.icao);
  }
});

test('the region: South Korea reads the same doubles as Korea\'s own tiles', { skip: !HAVE }, async () => {
  // Korea's heightfield as the flag-off game has it (its three airports), and the region's with
  // the same three, so the runways' flattening is the same and only the tiles differ.
  const { hf: kor, airports: aps3 } = await tiledTerrain({ layers: ['h', 'w', 'c'], coasts: true });
  // (cover2: false: the cover compared here is c, Korea's own bytes. With GROUND_ON the game reads
  // Korea's re-aggregated cover, c2, instead: the last test in this file checks that.)
  const reg = await createTiledHeightfield(m, DATA.href, { region: true, airports: aps3, readGz, readJson, layers: ['h', 'w', 'c'], maxTiles: 400, cover2: false });
  // Points well inside Geofabrik's south-korea.poly: the mainland from 34.3 to 37.5 N west of
  // 128.9 E (south of the DMZ, west of Tsushima), Jeju, and 20 km round each Korean airport.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  for (let k = 0; k < 26000; k++) pts.push(toMap(34.3 + rnd() * 3.2, 126.1 + rnd() * 2.8));
  for (let k = 0; k < 4000; k++) pts.push(toMap(33.1 + rnd() * 0.6, 126.1 + rnd() * 0.9));
  for (const a of aps3) for (let k = 0; k < 4000; k++) pts.push([a.origin[0] + (rnd() - 0.5) * 40000, a.origin[1] + (rnd() - 0.5) * 40000]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  await reg.tiles.whenReady((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + 1000, 'test');
  let bad = 0;
  const a = {}, b = {};
  for (const [x, y] of pts) {
    kor.coverAt(x, y, a); reg.coverAt(x, y, b);
    // The region adds Gimhae's 30 m patch (briefs/V0-6-0.md's one exception): skip the points it reaches.
    const inGimhae = reg.layers.patches.some((p) => p.id === 'gimhae' && x > p.x0 && y > p.y0 && x < p.x0 + p.nx * p.cell && y < p.y0 + p.ny * p.cell);
    if (!inGimhae && (kor.rawHeight(x, y) !== reg.rawHeight(x, y) || kor.heightAt(x, y) !== reg.heightAt(x, y))) bad++;
    if (kor.inlandDistance(x, y) !== reg.inlandDistance(x, y)) bad++;
    if (a.forest !== b.forest || a.farm !== b.farm || a.urban !== b.urban) bad++;
    // The sea's distance: the same from the tiles; near Gimhae the region has its 10 m coast patch too.
    const nearNew = reg.layers.coastPatches.some((p) => p.id === 'RKPK' && x > p.x0 && y > p.y0 && x < p.x0 + p.nx * p.cell && y < p.y0 + p.ny * p.cell);
    if (!nearNew && kor.seaDistance(x, y) !== reg.seaDistance(x, y)) bad++;
  }
  assert.equal(bad, 0, `${bad} of ${pts.length} points differ`);
  assert.equal(reg.tiles.misses, 0);
  assert.equal(kor.tiles.misses, 0);
});

test('the region: Fuji, the new runways and the margin\'s 1 km level; tiles by distance, no misses', { skip: !HAVE }, async () => {
  const hf = await region({ layers: ['h', 'w', 'c'], airportTiles: true });
  const T = hf.tiles;
  assert.equal(T.misses, 0);
  // Every airport's tiles are in and pinned: its runway ends sit on their published elevations.
  for (const a of airportsAll) {
    assert.ok(T.isReady(a.origin[0], a.origin[1], 30000), a.icao);
    for (const r of a.runways) for (const e of r.ends) {
      if (e.displacedM > 0) continue;   // x, y is the landing threshold; elevM the pavement end's
      const h = hf.heightAt(e.x, e.y);
      assert.ok(Math.abs(h - e.elevM) < 0.6, `${a.icao} ${e.ident}: ground ${h.toFixed(2)} m, published ${e.elevM}`);
    }
  }
  assert.equal(hf.runwayRects.length, airportsAll.reduce((n, a) => n + a.runways.length, 0));
  assert.equal(runwayRects(airportsAll).length, 30);   // (29 until v0.6.1's Yancheng)
  // Fuji's summit (the 30 m patch): within 60 m of 3,776 m; the 250 m data alone is lower.
  const [fx, fy] = toMap(35.3606, 138.7274);
  await T.whenReady(fx, fy, 20000, 'test');
  let top = 0;
  for (let dy = -1500; dy <= 1500; dy += 30) for (let dx = -1500; dx <= 1500; dx += 30) top = Math.max(top, hf.heightAt(fx + dx, fy + dy));
  assert.ok(top > 3716 && top < 3790, `Fuji ${top.toFixed(0)} m`);
  // Tokyo Bay is sea, central Tokyo is built-up, the Kanto hills are forest.
  const at = async (lat, lon) => { const [x, y] = toMap(lat, lon); await T.whenReady(x, y, 2000, 'test'); return [x, y]; };
  let [x, y] = await at(35.45, 139.85);
  assert.ok(hf.waterAt(x, y) && hf.heightAt(x, y) === 0, 'Tokyo Bay');
  [x, y] = await at(35.69, 139.70);
  assert.ok(hf.coverAt(x, y).urban > 0.5, 'Shinjuku is built-up');
  [x, y] = await at(31.23, 121.47);
  assert.ok(hf.coverAt(x, y).urban > 0.5, 'Shanghai is built-up');
  // The margin (no 250 m data): the 1 km level. Paektu-san's plateau, north of the fine box.
  [x, y] = await at(41.99, 128.08);
  assert.ok(x < REGION_EXTENT.x1 && y > FINE_EXTENT.y1, 'Paektu lies in the margin');
  assert.ok(hf.heightAt(x, y) > 1800, `Paektu ${hf.heightAt(x, y).toFixed(0)} m from the 1 km level`);
  // Open sea far from anything: 0 m, water.
  [x, y] = await at(30.5, 131.5);
  assert.ok(hf.waterAt(x, y) && hf.heightAt(x, y) === 0, 'the Pacific');
  assert.equal(T.misses, 0);
});

test('the region: the clip window follows the camera in blocks, from the tiles and the 1 km level', { skip: !HAVE }, async () => {
  const hf = await region({ layers: ['h', 'w', 'c'], maxTiles: 40 });
  const T = hf.tiles;
  const cw = createClipWindow(T, { N: 4096 });
  assert.ok(!cw.fit);
  const settle = async (x, y) => {
    cw.moveTo(x, y);
    let filled = 0, worst = 0;
    for (let guard = 0; guard < 4000 && cw.pending(); guard++) {
      const t0 = performance.now();
      const r = cw.step();
      if (r) { if (r.length) filled++; worst = Math.max(worst, performance.now() - t0); assert.ok(r.length <= 4); }
      else await new Promise((res) => setTimeout(res, 2));   // waiting for the tiles it asked for
    }
    assert.equal(cw.pending(), 0);
    return { filled, worst };
  };
  // Over Tokyo: nothing valid at first, then the whole window.
  const [tx, ty] = toMap(35.68, 139.77);
  cw.moveTo(tx, ty);
  let v = cw.valid();
  assert.ok(v[2] - v[0] === 0, 'nothing valid before the first block');
  const a = await settle(tx, ty);
  assert.equal(a.filled, 64);
  v = cw.valid();
  assert.deepEqual([v[2] - v[0], v[3] - v[1]], [4096, 4096]);
  // The camera at least 416 km from every edge.
  const ci = Math.floor((tx - cw.win.x0) / 250), cj = Math.floor((ty - cw.win.y0) / 250);
  assert.ok(Math.min(ci - v[0], v[2] - ci, cj - v[1], v[3] - cj) * 250 >= 416000);
  // The window's cells are the store's: a baked tile's cell for cell, the margin's from the 1 km level.
  const cellAt = (x, y) => [Math.floor((x - cw.win.x0) / 250), Math.floor((y - cw.win.y0) / 250)];
  let [gi, gj] = cellAt(tx, ty);
  await T.whenReady(tx, ty, 1000, 'test');
  const cx = cw.win.x0 + (gi + 0.5) * 250, cy = cw.win.y0 + (gj + 0.5) * 250;
  assert.equal(cw.h[cw.texel(gi, gj)], T.height(cx, cy));
  assert.equal(cw.c[cw.texel(gi, gj) * 4 + 2], T.cover(cx, cy, 2));
  assert.ok(cw.peak() > 3000, `the window's highest ground ${cw.peak()} m (Fuji's 250 m cells)`);
  // East of Tokyo the window reaches past the 250 m data: those blocks are the 1 km level's (open Pacific here).
  assert.equal(cw.blockKind(15, 3), 'l1');
  assert.equal(cw.blockKind(8, 3), 'l0');
  // Over Aomori the window holds Hokkaido, in the margin: land from the 1 km level, the store's bilinear.
  const [ax, ay] = toMap(40.82, 140.74);
  await settle(ax, ay);
  const [nx, ny] = toMap(42.9, 141.3);
  [gi, gj] = cellAt(nx, ny);
  assert.equal(cw.blockKind(Math.floor(gi / 512), Math.floor(gj / 512)), 'l1');
  await T.whenReady(nx, ny, 1000, 'test');
  const mx = cw.win.x0 + (gi + 0.5) * 250, my = cw.win.y0 + (gj + 0.5) * 250;
  assert.equal(cw.h[cw.texel(gi, gj)], Math.round(T.height(mx, my)), 'the 1 km level, the store\'s bilinear');
  assert.ok(T.height(mx, my) > 0, 'land at 42.9 N 141.3 E');
  assert.equal(cw.w[cw.texel(gi, gj) * 2], Math.round(T.water(mx, my, 0)));
  assert.equal(cw.c[cw.texel(gi, gj) * 4], Math.round(T.cover(mx, my, 0)));
  await settle(tx, ty);
  // Fly to Seoul in steps: the window shifts a column at a time and keeps what it had.
  const [sx, sy] = toMap(37.56, 126.8);
  let moves = 0, refilled = 0;
  for (let s = 1; s <= 30; s++) {
    const x = tx + (sx - tx) * s / 30, y = ty + (sy - ty) * s / 30;
    if (cw.moveTo(x, y)) {
      moves++;
      const vv = cw.valid();
      assert.ok(vv[2] - vv[0] >= 4096 - 1024 && vv[3] - vv[1] >= 4096 - 1024, 'what it already had stays valid');
    }
    refilled += (await settle(x, y)).filled;
  }
  assert.ok(moves >= 5, `moved ${moves} times`);
  assert.ok(refilled >= 40 && refilled < 64 * 3, `${refilled} blocks refilled`);
  [gi, gj] = cellAt(sx, sy);
  await T.whenReady(sx, sy, 1000, 'test');
  assert.equal(cw.h[cw.texel(gi, gj)], T.height(cw.win.x0 + (gi + 0.5) * 250, cw.win.y0 + (gj + 0.5) * 250));
  console.log(`  clip window: first fill ${a.filled} blocks, worst block ${a.worst.toFixed(1)} ms; ${moves} moves, ${refilled} blocks refilled; store loads ${T.loads}, evictions ${T.evictions}`);
});

test('the region: a lean clip window fills one block at a time into its scratch; only the cover keeps a mirror', { skip: !HAVE }, async () => {
  const hf = await region({ layers: ['h', 'w', 'c'], maxTiles: 40 });
  const T = hf.tiles;
  const cw = createClipWindow(T, { N: 4096, lean: true });
  assert.ok(cw.lean && !cw.fit);
  assert.equal(cw.h.length, 512 * 512); assert.equal(cw.n.length, 512 * 512 * 2); assert.equal(cw.w.length, 512 * 512 * 2);
  assert.equal(cw.c.length, 4096 * 4096 * 4);
  const [tx, ty] = toMap(35.68, 139.77);
  cw.moveTo(tx, ty);
  let blocks = 0, l0 = 0, l1 = 0;
  for (let guard = 0; guard < 6000 && cw.pending(); guard++) {
    const r = cw.step();
    if (!r) { await new Promise((res) => setTimeout(res, 2)); continue; }
    if (!r.length) continue;                      // a strip of a 1 km block: the scratch isn't whole yet
    blocks++;
    assert.equal(r.length, 1); assert.deepEqual([r[0].w, r[0].h], [512, 512]);
    const [key, kind] = cw.win.last.split(' '), [ti, tj] = key.split('_').map(Number);
    // The scratch is this block, row 0 its south row: check cells against the store.
    for (const [a, b] of [[0, 0], [511, 511], [100, 300], [317, 42]]) {
      const x = cw.win.x0 + (ti * 512 + a + 0.5) * 250, y = cw.win.y0 + (tj * 512 + b + 0.5) * 250;
      await T.whenReady(x, y, 300, 'test');
      const want = kind === 'l0' ? T.height(x, y) : Math.round(T.height(x, y));
      assert.equal(cw.h[b * 512 + a], want, `${key} ${kind} cell ${a},${b}`);
      assert.equal(cw.c[cw.texel(ti * 512 + a, tj * 512 + b) * 4 + 2], Math.round(T.cover(x, y, 2)), 'the cover in its mirror');
    }
    if (kind === 'l0') l0++; else l1++;
    cw.uploads.length = 0;                        // (the GPU's part: glsl.js uploads the scratch before the next step)
  }
  assert.equal(blocks, 64);
  assert.ok(l0 >= 40 && l1 >= 8, `${l0} blocks from 250 m tiles, ${l1} from the 1 km level`);
  assert.equal(cw.valid()[2] - cw.valid()[0], 4096);
});

// v0.6.0 Part 7: South Korea's cover re-aggregated from the fine cover's source (c2 files), read
// only by a store made with cover2 (the game with GROUND_ON); the heights and the water are the
// same bytes either way, and without cover2 the cover is c's.
test('the region: c2 (Korea\'s re-aggregated cover) is read only with cover2, and changes the cover alone', async () => {
  const { createTileStore } = await import('../src/world/tilestore.js');
  const { terrainSpec } = await import('../src/world/region.js');
  const { manifest, readGz } = await import('./tile-terrain.mjs');
  const spec = terrainSpec(manifest(), true).tiles;
  const list = spec.levels[0].cover2 || [];
  if (!list.length) return;
  assert.ok(list.every((n) => spec.levels[0].tiles.includes(n)), 'every c2 tile is a listed tile');
  const asked = [];
  const rd = (log) => async (rel) => { log.push(rel); return readGz(rel); };
  const a = [], b = [];
  const A = createTileStore(spec, { readGz: rd(a) }), B = createTileStore(spec, { readGz: rd(b), cover2: true });
  const x = -40000, y = -20000;                       // Seoul: tile 2_2
  await A.whenReady(x + 15000, y + 15000, 25000, 't'); await B.whenReady(x + 15000, y + 15000, 25000, 't');
  assert.ok(a.some((f) => f.endsWith('2_2.c.rgba8.gz')) && !a.some((f) => f.includes('.c2.')), 'without cover2: c');
  assert.ok(b.some((f) => f.endsWith('2_2.c2.rgba8.gz')) && !b.some((f) => f.endsWith('2_2.c.rgba8.gz')), 'with cover2: c2 in place of c');
  let differs = 0;
  for (let i = 0; i < 400; i++) {
    const px = x + (i % 20) * 1500, py = y + Math.floor(i / 20) * 1500;
    assert.equal(A.height(px, py), B.height(px, py));
    assert.equal(A.water(px, py, 0), B.water(px, py, 0)); assert.equal(A.water(px, py, 1), B.water(px, py, 1));
    if (A.cover(px, py, 2) !== B.cover(px, py, 2) || A.cover(px, py, 0) !== B.cover(px, py, 0)) differs++;
    assert.ok(B.cover(px, py, 2) >= A.cover(px, py, 2) - 1e-9, 'the built-up share is never less than the old one');
  }
  assert.ok(differs > 20, `the cover differs at ${differs} of 400 points round Seoul`);
  assert.equal(A.misses + B.misses, 0);
});
