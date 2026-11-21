// v0.6.0 Part 1 step 6: the GPU's patches, coast patches and runways are the nearest
// MAX_PATCHES / MAX_RUNWAYS to the camera, in the CPU's order; Korea has no more than the caps,
// so its uniforms are every one, in order, wherever the camera is (its pictures unchanged).
// And the clipmap's PEAK: Korea's highest ground stays under 2,000 m, so its cull is as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createWorldUniforms, nearest, MAX_PATCHES, MAX_RUNWAYS } from '../src/world/glsl.js';
import { tiledTerrain, manifest, DATA } from './tile-terrain.mjs';

const m = manifest();
const HAVE = !!(m.tilesRegion && existsSync(new URL(m.tilesRegion.levels[0].dir, DATA)));

test('nearest: the n nearest, in the list\'s own order; all of a short list', () => {
  const list = [10, 50, 20, 40, 30].map((v, i) => ({ v, i }));
  const d = (e, c) => Math.abs(e.v - c.x);
  assert.deepEqual(nearest(list, 3, { x: 0 }, d).map((e) => e.i), [0, 2, 4]);
  assert.deepEqual(nearest(list, 3, { x: 45 }, d).map((e) => e.i), [1, 3, 4]);
  assert.deepEqual(nearest(list, 5, { x: 45 }, d), list);
  assert.deepEqual(nearest(list, 9, null, d), list);
});

// The region (the evening sitting): more patches than the cap, so the atlases are fixed slots and
// a patch that comes into the nearest set is uploaded into a free one, a little a frame.
test('the region: patches and coasts come into fixed slots as the camera moves; nothing is rebuilt', { skip: !m.tilesRegion }, async () => {
  const { readFileSync } = await import('node:fs');
  const { createTiledHeightfield } = await import('../src/world/heightfield.js');
  const { terrainSpec } = await import('../src/world/region.js');
  const { toMap } = await import('../src/world/frame.js');
  const { readGz, readJson } = await import('./tile-terrain.mjs');
  const aps = terrainSpec(m, true).airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  const hf = await createTiledHeightfield(m, DATA.href, { region: true, airports: aps, readGz, readJson, layers: ['h'] });
  const u = createWorldUniforms(hf);
  const L = hf.layers, near = u.__near;
  assert.ok(L.patches.length > MAX_PATCHES && L.coastPatches.length > MAX_PATCHES && hf.runwayRects.length > MAX_RUNWAYS);
  const hTex = u.uPatchH.value, cTex = u.uCoast.value;
  assert.equal(u.uPatchCount.value, 0);
  // A fake renderer that records what is uploaded where.
  const copies = [];
  const renderer = { copyTextureToTexture: (src, dst, region, at) => copies.push({ w: src.image.width, h: src.image.height, n: src.image.data.length, dst, y: at.y }) };
  const settle = (cam, maxFrames = 400) => {
    let frames = 0, worst = 0;
    for (; frames < maxFrames; frames++) {
      const t0 = performance.now();
      near.update(cam); near.flush(renderer);
      worst = Math.max(worst, performance.now() - t0);
      if (!near.pending && frames > 1) break;
    }
    return { frames, worst };
  };
  const ids = () => near.selection.patches.map((p) => p.id);
  // From far off (the Yellow Sea's middle): the nearest four arrive over some frames, no frame long.
  const sea = toMap(35.5, 123.5);
  const a = settle({ x: sea[0], y: sea[1] });
  assert.equal(u.uPatchCount.value, MAX_PATCHES);
  assert.equal(u.uCoastCount.value, MAX_PATCHES);
  assert.ok(a.frames > 8, `the normals came in slices (${a.frames} frames)`);
  // Over Haneda: its patch and Fuji's are in, in the CPU's order, each in its own slot.
  const tk = toMap(35.55, 139.78);
  settle({ x: tk[0], y: tk[1] });
  assert.ok(ids().includes('haneda-narita') && ids().includes('fuji'), ids().join());
  assert.deepEqual(ids(), L.patches.filter((p) => ids().includes(p.id)).map((p) => p.id), 'the CPU\'s order');
  const rows = [];
  for (let k = 0; k < u.uPatchCount.value; k++) {
    const r = u.uPatchRect.value[k], d = u.uPatchDim.value[k], p = near.selection.patches[k];
    assert.deepEqual([r.x, r.y, r.z, d.x, d.y], [p.x0, p.y0, p.cell, p.nx, p.ny]);
    assert.ok(r.w + p.ny <= d.w && p.nx <= d.z, 'inside the atlas');
    rows.push([r.w, r.w + p.ny]);
  }
  rows.sort((p, q) => p[0] - q[0]);
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k][0] >= rows[k - 1][1], 'slots do not overlap');
  assert.ok(near.selection.coast.some((p) => p.id === 'RJTT'));
  assert.equal(near.selection.runways.length, MAX_RUNWAYS);
  assert.ok(near.selection.runways.some((r) => Math.hypot(r.cx - tk[0], r.cy - tk[1]) < 8000), 'Haneda\'s runways are among the nearest');
  // The atlases are the same textures throughout (nothing rebuilt), and every upload was one patch's rows.
  assert.equal(u.uPatchH.value, hTex); assert.equal(u.uCoast.value, cTex);
  assert.ok(copies.length >= 12 && copies.every((c) => c.n === c.w * c.h || c.n === c.w * c.h * 2));
  // A flight back to Seoul: the set changes on the way, the textures never do.
  const sl = toMap(37.56, 126.8);
  let worst = 0;
  for (let s = 1; s <= 300; s++) {
    const cam = { x: tk[0] + (sl[0] - tk[0]) * s / 300, y: tk[1] + (sl[1] - tk[1]) * s / 300 };
    const t0 = performance.now();
    near.update(cam); near.flush(renderer);
    worst = Math.max(worst, performance.now() - t0);
  }
  settle({ x: sl[0], y: sl[1] });
  assert.ok(ids().includes('incheon-gimpo') && !ids().includes('fuji'), ids().join());
  assert.equal(u.uPatchH.value, hTex);
  console.log(`  slots: worst frame's share on the way back ${worst.toFixed(1)} ms; ${copies.length} uploads in all`);
});
