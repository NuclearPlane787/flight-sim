// v0.7.8, part 5: East Asia's leftovers ("Found while building v0.7.0").
// 1. The 38 border values that differed across neighbour pairs of the shipped 250 m tiles are sealed: 32 in two tiles
//    from their owners' cores (tools/bake_europe_seams.py --seal), 6 in two tiles in a corner whose owner was never
//    baked (--seal-unowned). Here: every pair of neighbouring tiles holds the same heights wherever their grids overlap.
// 2. Hokkaido's ten tiles' 31 m cover is baked again with the 3 x 3 majority filter the earlier batches had
//    (tools/bake_region_fine.py --filter with FS_FINE_REBAKE): the 108 files held by one SHA-256, the index unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';

const R0 = new URL('../data/terrain/r0/', import.meta.url), FINE = new URL('../data/terrain/fine/', import.meta.url);
const TILE = 512, B = 2, S = TILE + 2 * B;

test('the 250 m tiles: every neighbouring pair agrees over the whole overlap of their grids (435 pairs, 0 cells differing)', () => {
  const names = readdirSync(R0).filter((n) => n.endsWith('.h.i16.gz')).map((n) => n.slice(0, -'.h.i16.gz'.length));
  assert.equal(names.length, 146);
  const tiles = new Map(names.map((n) => [n, null]));
  const get = (n) => {
    if (!tiles.get(n)) { const b = gunzipSync(readFileSync(new URL(`${n}.h.i16.gz`, R0))); tiles.set(n, new Int16Array(b.buffer, b.byteOffset, S * S)); }
    return tiles.get(n);
  };
  let pairs = 0, cells = 0, bad = 0;
  for (const n of names) {
    const [ti, tj] = n.split('_').map(Number);
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const u = `${ti + di}_${tj + dj}`;
      if (!tiles.has(u)) continue;
      const A = get(n), C = get(u), ui = ti + di, uj = tj + dj;
      const i0 = Math.max(ti, ui) * TILE - B, i1 = Math.min(ti, ui) * TILE + TILE + B, j0 = Math.max(tj, uj) * TILE - B, j1 = Math.min(tj, uj) * TILE + TILE + B;
      for (let gj = j0; gj < j1; gj++) for (let gi = i0; gi < i1; gi++) {
        cells++;
        if (A[(gj - (tj * TILE - B)) * S + gi - (ti * TILE - B)] !== C[(gj - (uj * TILE - B)) * S + gi - (ui * TILE - B)]) bad++;
      }
      pairs++;
    }
  }
  assert.equal(pairs, 435);
  assert.equal(bad, 0, `${bad} of ${cells} overlapping cells differ`);
});

test("Hokkaido's 31 m cover: the 108 filtered files, the index as it was", () => {
  const idx = JSON.parse(readFileSync(new URL('fine.json', FINE), 'utf8'));
  const hok = (n) => /^(10_8|11_8|12_8|11_9|12_9|13_9|11_10|12_10|13_10|14_10)_/.test(n);
  const files = idx.files.filter(hok).sort(), uniform = Object.keys(idx.uniform).filter(hok);
  assert.equal(files.length, 108); assert.equal(uniform.length, 52);
  const h = createHash('sha256');
  let px = 0;
  for (const n of files) { const b = readFileSync(new URL(`${n}.u8.gz`, FINE)); h.update(n).update(b); px += gunzipSync(b).length; }
  assert.equal(px, 108 * 1024 * 1024);
  assert.equal(h.digest('hex'), 'c3366f60f687b5fcef442da2a0cbf3b47810ec795b59b88611f40fefd7516ade');
});

test('the filter did its work: far fewer lone pixels than a plain bake has (one sub-tile over Sapporo)', () => {
  // a pixel none of whose four neighbours shares its class: 1.03 % of the plain bake of 12_9_1_2, 0.46 % of the filtered one
  const g = gunzipSync(readFileSync(new URL('12_9_1_2.u8.gz', FINE)));
  let lone = 0;
  for (let r = 1; r < 1023; r++) for (let c = 1; c < 1023; c++) {
    const v = g[r * 1024 + c];
    if (g[r * 1024 + c - 1] !== v && g[r * 1024 + c + 1] !== v && g[(r - 1) * 1024 + c] !== v && g[(r + 1) * 1024 + c] !== v) lone++;
  }
  assert.ok(lone / (1022 * 1022) < 0.007, `${lone} lone pixels (${(100 * lone / (1022 * 1022)).toFixed(3)} %)`);
});
