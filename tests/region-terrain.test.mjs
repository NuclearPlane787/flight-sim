// v0.6.0, the region's terrain (data/terrain/r0, r1, the manifest's tilesRegion): the new ground where it should be (Fuji, the new airports' runways, the margin's
// 1 km level), loaded by distance with no misses, and the GPU's clip window following the
// camera over it block by block. Skipped while the region's tiles aren't in data/. (v0.7.0: the
// comparisons with Korea's own tiles went with them, and c2 became c.)
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
const spec = terrainSpec(m);
const airportsAll = spec.airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));

const region = (opts = {}) => createTiledHeightfield(m, DATA.href, { region: true, airports: airportsAll, readGz, readJson, ...opts });

test('the region: the manifest lists its tiles, patches and airports; the extents match region.js', { skip: !HAVE }, () => {
  assert.equal(spec.region, true);
  assert.equal(spec.airports.length, 23);   // v0.6.1: Yancheng (12); v0.6.3: Beijing's two, Shenyang, Dalian, Vladivostok (17); v0.6.4: New Chitose, Aomori, Sendai, Niigata, Pyongyang, Wonsan
  assert.equal(spec.patches.length, 21);    // and a patch each
  assert.equal(spec.coastPatches.length, 13);   // v0.6.3: Dalian's and Vladivostok's; v0.6.4: Wonsan's, Sendai's, Niigata's
  assert.equal(new Set(spec.airports).size, spec.airports.length, 'no airport listed twice');
  const t = m.tilesRegion, l0 = t.levels[0], l1 = t.levels[1];
  assert.deepEqual(FINE_EXTENT, { x0: t.x0 + l0.extent.i0 * l0.cell, y0: t.y0 + l0.extent.j0 * l0.cell, x1: t.x0 + l0.extent.i1 * l0.cell, y1: t.y0 + l0.extent.j1 * l0.cell });
  assert.deepEqual(REGION_EXTENT, { x0: t.x0 + l1.extent.i0 * l1.cell, y0: t.y0 + l1.extent.j0 * l1.cell, x1: t.x0 + l1.extent.i1 * l1.cell, y1: t.y0 + l1.extent.j1 * l1.cell });
  // (v0.7.0: the flag-off assertions, Korea's own tiles and three airports, went with the flag.)
  // Every airport of the region inside the 250 m data.
  for (const a of airportsAll) {
    const [x, y] = a.origin;
    assert.ok(x > FINE_EXTENT.x0 && x < FINE_EXTENT.x1 && y > FINE_EXTENT.y0 && y < FINE_EXTENT.y1, a.icao);
  }
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
  assert.equal(runwayRects(airportsAll).length, 50);   // (29 until v0.6.1's Yancheng, 30 until v0.6.3, 40 until v0.6.4: New Chitose's 2, Sendai's 2, Niigata's 2, Wonsan's 2, Aomori's, Pyongyang's)
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
  // Paektu-san: in the margin until v0.6.3, whose tiles took the 250 m data north to Vladivostok. Its plateau from
  // the 250 m level now, and Beijing's plain west of v0.6.2's edge.
  [x, y] = await at(41.99, 128.08);
  assert.ok(y > 624000 && y < FINE_EXTENT.y1, 'Paektu lies north of v0.6.2\'s 250 m data, inside v0.6.3\'s');
  assert.ok(hf.heightAt(x, y) > 1800, `Paektu ${hf.heightAt(x, y).toFixed(0)} m from the 250 m level`);
  [x, y] = await at(39.905, 116.397);
  assert.ok(x < -912000 && x > FINE_EXTENT.x0, 'Beijing lies west of v0.6.2\'s 250 m data, inside v0.6.3\'s');
  assert.ok(hf.coverAt(x, y).urban > 0.5, 'Beijing is built-up');
  assert.ok(hf.heightAt(x, y) > 20 && hf.heightAt(x, y) < 80, `Beijing's centre ${hf.heightAt(x, y).toFixed(0)} m`);
  // The margin (no 250 m data): the 1 km level. Wutai Shan's plateau, west of the 250 m data.
  [x, y] = await at(39.08, 113.57);
  assert.ok(x > REGION_EXTENT.x0 && x < FINE_EXTENT.x0, 'Wutai Shan lies in the margin');
  assert.ok(hf.heightAt(x, y) > 1800, `Wutai Shan ${hf.heightAt(x, y).toFixed(0)} m from the 1 km level`);
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
  // Over Aomori the window holds Hokkaido's north, in the margin: land from the 1 km level, the store's bilinear.
  // (42.9 N 141.3 E until v0.6.4, whose tiles took the 250 m data over Hokkaido to y = 1,008 km: Nayoro's basin, north of it, now.)
  const [ax, ay] = toMap(40.82, 140.74);
  await settle(ax, ay);
  const [nx, ny] = toMap(44.55, 142.45);
  assert.ok(ny > FINE_EXTENT.y1, 'the point lies north of the 250 m data');
  [gi, gj] = cellAt(nx, ny);
  assert.equal(cw.blockKind(Math.floor(gi / 512), Math.floor(gj / 512)), 'l1');
  await T.whenReady(nx, ny, 1000, 'test');
  const mx = cw.win.x0 + (gi + 0.5) * 250, my = cw.win.y0 + (gj + 0.5) * 250;
  assert.equal(cw.h[cw.texel(gi, gj)], Math.round(T.height(mx, my)), 'the 1 km level, the store\'s bilinear');
  assert.ok(T.height(mx, my) > 0, 'land at 44.55 N 142.45 E');
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

// v0.6.0 Part 7: South Korea's cover re-aggregated from the fine cover's source (the c2 files, read in place of c
// with GROUND_ON). v0.7.0: the c2 files became the tiles' c, Korea's old cover in them retired, and the manifest's
// cover2 list went; this checks the store asks for c alone. (Its comparisons with the old c went with it.)
test('the region: Korea\'s tiles read their cover from c, and no c2 file or list is left', async () => {
  const { createTileStore } = await import('../src/world/tilestore.js');
  const { terrainSpec } = await import('../src/world/region.js');
  const { manifest, readGz } = await import('./tile-terrain.mjs');
  const spec = terrainSpec(manifest()).tiles;
  assert.equal(spec.levels[0].cover2, undefined, 'no cover2 list');
  const a = [];
  const A = createTileStore(spec, { readGz: async (rel) => { a.push(rel); return readGz(rel); } });
  const x = -40000, y = -20000;                       // Seoul: tile 2_2
  await A.whenReady(x + 15000, y + 15000, 25000, 't');
  assert.ok(a.some((f) => f.endsWith('2_2.c.rgba8.gz')) && !a.some((f) => f.includes('.c2.')), 'c, never c2');
  assert.ok(A.cover(x, y, 2) >= 0 && A.misses === 0);
});
