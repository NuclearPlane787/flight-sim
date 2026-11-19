// v0.6.0 Part 1: cut Korea's national 250 m grid (heights, water, cover) into 128 km tiles on
// its own lattice, plus a 1 km level averaged from it, and add the `tiles` section to
// data/manifest.json. The values are copied, not resampled: every cell keeps its bits.
//
//   python3 tools/cpu-guard.py --minutes 5 -- node tools/cut_korea_tiles.mjs
//
// The lattice (V060.md, "Bit-exact sampling"): 250 m cells, cell-centred, origin at Korea's
// south-west corner (−400 km, −400 km), extended both ways. A tile is TILE × TILE cells with a
// BORDER of its neighbours' cells on each side, so a bilinear sample (and the GPU's Catmull-Rom
// water taps, and the normals) never straddles two tiles. Cells outside the data's extent are
// the nearest edge cell (the old loader's clamp), so the borders read as the old grid did.
// A tile whose every cell (border included) is open sea has no file: the store fills it with
// the manifest's `sea` values.
//
// Files: data/terrain/<level>/<ti>_<tj>.h.i16.gz (Int16, heightScale units), .w.rg8.gz (R sea,
// G inland distance bytes), .c.rgba8.gz (R forest, G farm, B built-up, A spare). Row 0 south.
// Re-running rewrites identical files only where the content changed (bake each tile once).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.resolve(here, '../data');
export const TILE = 512, BORDER = 2;
const SEA = { h: -160, w: [0, 255], c: [0, 0, 0, 0] };

const man = JSON.parse(readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const nat = man.national;
const NX = nat.nx, NY = nat.ny;
const gz = (f) => gunzipSync(readFileSync(path.join(DATA, f)));
const hBuf = gz(nat.height), wBuf = gz(nat.water), cBuf = gz(nat.cover);
const H = new Int16Array(hBuf.buffer, hBuf.byteOffset, NX * NY);
const W = new Uint8Array(wBuf.buffer, wBuf.byteOffset, NX * NY * 2);
const C = new Uint8Array(cBuf.buffer, cBuf.byteOffset, NX * NY * 4);

const S = TILE + 2 * BORDER;
const clampI = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

function writeIfChanged(file, bytes) {
  const z = gzipSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 });
  if (existsSync(file)) {
    const old = gunzipSync(readFileSync(file));
    if (old.equals(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) return { size: readFileSync(file).length, wrote: false };
  }
  writeFileSync(file, z);
  return { size: z.length, wrote: true };
}

// Cut one level. get*(i, j) read a cell of that level (clamped to its extent).
function cutLevel(id, cell, ni, nj, getH, getW, getC) {
  const dir = path.join(DATA, 'terrain', id);
  mkdirSync(dir, { recursive: true });
  const tiles = [];
  let bytes = 0, wrote = 0, sea = 0;
  const nti = Math.ceil(ni / TILE), ntj = Math.ceil(nj / TILE);
  for (let tj = 0; tj < ntj; tj++) {
    for (let ti = 0; ti < nti; ti++) {
      const h = new Int16Array(S * S), w = new Uint8Array(S * S * 2), c = new Uint8Array(S * S * 4);
      let allSea = true;
      for (let lj = 0; lj < S; lj++) {
        const j = clampI(tj * TILE + lj - BORDER, nj);
        for (let li = 0; li < S; li++) {
          const i = clampI(ti * TILE + li - BORDER, ni);
          const k = lj * S + li;
          h[k] = getH(i, j);
          getW(i, j, w, k * 2);
          getC(i, j, c, k * 4);
          if (allSea && (h[k] !== SEA.h || w[k * 2] !== SEA.w[0] || w[k * 2 + 1] !== SEA.w[1] ||
              c[k * 4] || c[k * 4 + 1] || c[k * 4 + 2] || c[k * 4 + 3])) allSea = false;
        }
      }
      if (allSea) { sea++; continue; }
      const name = `${ti}_${tj}`;
      for (const [suffix, arr] of [['h.i16', h], ['w.rg8', w], ['c.rgba8', c]]) {
        const r = writeIfChanged(path.join(dir, `${name}.${suffix}.gz`), arr);
        bytes += r.size; if (r.wrote) wrote++;
      }
      tiles.push(name);
    }
  }
  console.log(`${id}: ${cell} m, ${ni} x ${nj} cells, ${tiles.length} tiles with files, ${sea} open sea, ${(bytes / 1e6).toFixed(2)} MB, ${wrote} files written`);
  return { id, cell, tile: TILE, border: BORDER, dir: `terrain/${id}/`, extent: { i0: 0, j0: 0, i1: ni, j1: nj }, tiles };
}

// l0: the national grid's own cells.
const l0 = cutLevel('l0', 250, NX, NY,
  (i, j) => H[j * NX + i],
  (i, j, out, o) => { const s = (j * NX + i) * 2; out[o] = W[s]; out[o + 1] = W[s + 1]; },
  (i, j, out, o) => { const s = (j * NX + i) * 4; out[o] = C[s]; out[o + 1] = C[s + 1]; out[o + 2] = C[s + 2]; out[o + 3] = C[s + 3]; });

// l1: 1 km cells, each the mean of its 4 x 4 l0 cells (rounded), on the same origin.
const F = 4, NX1 = Math.ceil(NX / F), NY1 = Math.ceil(NY / F);
function mean(i, j, read) {
  let s = 0, n = 0;
  for (let b = 0; b < F; b++) for (let a = 0; a < F; a++) {
    const ii = i * F + a, jj = j * F + b;
    if (ii < NX && jj < NY) { s += read(ii, jj); n++; }
  }
  return Math.round(s / n);
}
const l1 = cutLevel('l1', 250 * F, NX1, NY1,
  (i, j) => mean(i, j, (a, b) => H[b * NX + a]),
  (i, j, out, o) => { for (let q = 0; q < 2; q++) out[o + q] = mean(i, j, (a, b) => W[(b * NX + a) * 2 + q]); },
  (i, j, out, o) => { for (let q = 0; q < 4; q++) out[o + q] = mean(i, j, (a, b) => C[(b * NX + a) * 4 + q]); });

// The manifest's tiles section (read-modify-write; everything else is kept).
man.tiles = {
  version: 1,
  x0: nat.x0, y0: nat.y0,                 // the lattice's origin (Korea's SW corner), shared by every level
  heightScale: man.heightScale,
  // The data's extent in l0 cells (half-open): sampling clamps here, at the region's outer edge.
  extent: { i0: 0, j0: 0, i1: NX, j1: NY },
  sea: SEA,
  levels: [l0, l1],
};
writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
console.log('manifest.json: tiles section written');
