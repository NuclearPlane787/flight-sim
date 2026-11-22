// v0.7.7 towns (a probe, not a unit test): an estimate in node of the generated buildings that stand on the 31 m cover's
// water, with ?towns77 off and on, round three cities. A port of cities.js's slot placement for Europe (euVert(),
// towns77Vert()): the block's and slot's hashes, the courtyard and grid layouts, the keep test's cover and noise, the
// 250 m water field's 30 m / 25 m clearances, the real centre's mask (centres-worker.js's buildCentre()), the
// towns77 edge thinning and its water test. Left out (approximate): the slope and runway tests, the camera's distance
// thinning (every block within 8 km counts), the country raster (each city's own mix given). Run from GameDump:
//   FS_REGION=europe node games/flight-sim/tests/v077-towns-watercount.mjs
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tiledTerrain, DATA } from './tile-terrain.mjs';
import { toMap } from '../src/world/frame.js';
import { parseCentre, buildCentre, CELL_M } from '../src/world/centres-worker.js';

const BLOCK = 400;
const ihash = (x, y, s) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2246822519 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 16777216;
};
const fract = (v) => v - Math.floor(v);
const hash12 = (x, y) => { let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); };
const vnoise = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1); return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const fine = JSON.parse(readFileSync(new URL('terrain/fine/fine.json', DATA), 'utf8'));
const files = new Set(fine.files), uni = fine.uniform || {}, subs = new Map();
function fineClass(x, y) {   // the cover's class + 1 at map (x, y); 0 no data
  const px = Math.floor((x - fine.x0) / fine.px), py = Math.floor((y - fine.y0) / fine.px);
  const si = Math.floor(px / fine.sub), sj = Math.floor(py / fine.sub);
  const ti = Math.floor(si / fine.perTile), tj = Math.floor(sj / fine.perTile);
  const name = `${ti}_${tj}_${si - ti * fine.perTile}_${sj - tj * fine.perTile}`;
  if (!files.has(name)) return name in uni ? uni[name] + 1 : 0;
  if (!subs.has(name)) subs.set(name, gunzipSync(readFileSync(new URL(`terrain/fine/${name}.u8.gz`, DATA))));
  const b = subs.get(name);
  return b[(py - sj * fine.sub) * fine.sub + (px - si * fine.sub)] + 1;   // the file holds the class, the texture the class + 1
}

const { hf } = await tiledTerrain({ layers: ['h', 'w', 'c'] });
const idx = JSON.parse(readFileSync(new URL('centres/centres.json', DATA), 'utf8')).centres;
const CITIES = { frankfurt: [50.1103, 8.6744, 5], london: [51.5055, -0.0754, 3], zaragoza: [41.6568, -0.8785, 6] };
for (const [id, [la, lo, ctry]] of Object.entries(CITIES)) {
  const info = idx.find((c) => c.id === id);
  const r = buildCentre(parseCentre(gunzipSync(readFileSync(new URL('centres/' + info.file, DATA)))), info);
  const masked = (x, y) => { const b = info.box; if (x < b[0] || x >= b[2] || y < b[1] || y >= b[3]) return false; const i = Math.floor((x - b[0]) / CELL_M), j = Math.floor((y - b[1]) / CELL_M); return !!r.mask[j * info.cols + i]; };
  const boxD = (x, y) => { const b = info.box; return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3])); };
  const [X, Y] = toMap(la, lo);
  await hf.tiles.whenReady(X, Y, 12000, 'probe');
  const cnt = { off: 0, on: 0, offAll: 0, onAll: 0 };
  const cx = Math.floor(X / BLOCK), cy = Math.floor(Y / BLOCK);
  for (let j = -20; j < 20; j++) for (let i = -20; i < 20; i++) {
    const bx = cx + i, by = cy + j, mcx = (bx + 0.5) * BLOCK, mcy = (by + 0.5) * BLOCK;
    if (masked(mcx, mcy)) continue;
    const dense = hf.coverAt(mcx, mcy).urban;
    const bh = ihash(bx, by, 21), ba = ihash(bx, by, 22), bt = ihash(bx, by, 23);
    for (const on of [false, true]) {
      const tD = boxD(mcx, mcy), tFar = smooth(500, 3000, tD), tN = vnoise(mcx * 0.0011, mcy * 0.0011), tN2 = vnoise(mcx * 0.0031 + 17, mcy * 0.0031 + 17);
      for (let si = 0; si < 20; si++) {
        const skx = bx * 16 + (si & 15), sky = by * 16 + (si >> 4);
        const sh0 = ihash(skx, sky, 31), sh1 = ihash(skx, sky, 32), sh2 = ihash(skx, sky, 33); let sh3 = ihash(skx, sky, 34);
        const col = si % 4, row = Math.floor(si / 4), ang = (ba - 0.5) * 1.0;
        let rot = ang, lpx = (col - 1.5) * 95 + (sh0 - 0.5) * 10, lpy = (row - 2) * 76 + (sh1 - 0.5) * 8, sx = 20;
        const thr0 = ctry === 3 ? 0.62 : 0.5;
        let town = dense > thr0, rim = false;
        if (on) {   // cities.js's t77Block()
          const around = (hf.coverAt(mcx + 1600, mcy).urban + hf.coverAt(mcx - 1600, mcy).urban + hf.coverAt(mcx, mcy + 1600).urban + hf.coverAt(mcx, mcy - 1600).urban) / 4;
          if (around >= 0.22) {
            town = dense > thr0 + 0.16 * tFar + (tN - 0.5) * 0.16 && ihash(bx, by, 25) < 0.85 + (0.30 - 0.85) * tFar + (tN - 0.5) * 0.4;
            rim = !town && dense > 0.3 && ihash(bx, by, 26) < 0.55 + 0.3 * tFar;
          }
        }
        if (rim) {
          const qd = si < 16 ? Math.floor(si / 4) : si - 16, tr = si < 16 ? si % 4 : 4;
          lpx = ((qd % 2) - 0.5) * 190 + (sh0 - 0.5) * 14; lpy = (Math.floor(qd / 2) - 0.5) * 190 + (tr - 2) * 31;
          sx = (140 + 20 * bh) * (0.78 + 0.22 * sh1); sh3 *= 0.5;
        } else if (town) {
          const qd = si < 16 ? Math.floor(si / 4) : si - 16, qx = ((qd % 2) - 0.5) * 190, qy = (Math.floor(qd / 2) - 0.5) * 190;
          if (si < 16) {
            const sd = si % 4, bw = on ? (100 + 50 * bh) * (0.70 + 0.55 * tN2) : 118 + 30 * bh, bd = on ? 12 + 5 * sh1 : 13 + 3 * sh1;
            sx = bw;
            if (sd < 2) { lpx = qx; lpy = qy + (sd - 0.5) * (bw - bd); } else { lpx = qx + (sd - 2.5) * (bw - bd); lpy = qy; sx = bw - 2 * bd; rot += 1.5708; }
            sh3 *= 0.5;
          } else { lpx = qx + (dense > 0.7 && bt > 0.95 && ctry !== 3 ? 0 : (sh0 - 0.5) * 30); lpy = qy + (dense > 0.7 && bt > 0.95 && ctry !== 3 ? 0 : (sh1 - 0.5) * 30); sx = 25; }
        } else sx = 25;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const px = mcx + ca * lpx - sa * lpy, py = mcy + sa * lpx + ca * lpy;
        const cov = hf.coverAt(px, py).urban;
        let keep = sh3 * 0.4 + 0.18 <= cov + (vnoise(px * 0.004, py * 0.004) - 0.5) * 0.3;
        keep = keep && hf.seaDistance(px, py) >= 30 && hf.inlandDistance(px, py) >= 25;
        if (keep && on) {
          const tE = tD + (tN2 - 0.5) * 500;
          if (ihash(skx, sky, 37) > 0.45 + 0.55 * smooth(-150, 450, tE)) keep = false;
          const ax = Math.cos(rot) * 0.5 * sx, ay = Math.sin(rot) * 0.5 * sx;
          if (keep && (fineClass(px, py) === 1 || fineClass(px + ax, py + ay) === 1 || fineClass(px - ax, py - ay) === 1)) keep = false;
        }
        if (!keep) continue;
        cnt[on ? 'onAll' : 'offAll']++;
        if (fineClass(px, py) === 1) cnt[on ? 'on' : 'off']++;
      }
    }
  }
  console.log(`${id}: buildings within 8 km ${cnt.offAll} off, ${cnt.onAll} on; with their middle on the 31 m cover's water: ${cnt.off} off, ${cnt.on} on`);
}
console.log('done');
