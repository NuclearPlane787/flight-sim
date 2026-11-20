// The dense centres' builder (briefs/V0-6-0.md Part 6 step 2): OpenStreetMap's footprints (ODbL), baked by
// tools/bake_region_buildings.py into data/centres/<id>.bin.gz, parsed, triangulated and turned into
// vertex buffers. No DOM and no three.js here: centres.js imports these functions (node's tests, and
// a fallback without workers), and the same file runs as a module Worker that builds one centre per
// message off the main thread (fetch, gunzip, parse, build; the buffers transferred back). The
// worker does nothing between messages.
//
// The file format (little-endian, after gunzip): a 12-byte header u32 magic 'FSB1', u32 count,
// u32 vertexCount; count records of 8 bytes (u16 height dm, u16 minHeight dm, u8 nVerts, u8 flags,
// u16 reserved); then every record's vertices, i16 x, i16 y in 0.5 m units east and north of the
// centre's origin. Rings: the outer ring, counter-clockwise, not closed, maybe concave. Records sorted
// by 500 m cell (row-major from the box's south-west corner, by the mean of the vertices), then by
// height descending.
//
// The buffers (per vertex 20 bytes; the shader in centres.js reads them):
//   aP  Int16 x4, normalized (the shader multiplies by 32767): x, y (0.5 m, map east/north of the
//       origin), h (dm above the ground: 0 at the foot, minHeight at a raised part's base, the top on
//       the roof), along (0.25 m along the wall from the ring's first vertex, wrapped at 8 km)
//   aB  Int16 x4, normalized: the building's centre x, y (0.5 m), its top (dm), packed: the radius
//       (m, 0..4095) + 4096 x flags (bit 0 the height estimated, bit 1 a building:part)
//   aN  Int8 x4, normalized: the normal (map east, north, up) and 1 on a roof, 0 on a wall
// Two tiers: the tall (top >= TALL_M), sorted by height descending so a prefix of the index buffer is
// "everything at least this tall"; and the low, in chunks of CHUNK_CELLS x CHUNK_CELLS cells, one
// index range per chunk, chunk-row-major, so the chunks of one row within reach are one range.

export const MAGIC = 0x31425346;          // 'F','S','B','1' read as a little-endian u32
export const CELL_M = 500;
export const TALL_M = 35;                 // the tall tier: top at least this
export const CHUNK_CELLS = 4;             // the low tier's chunks: 4 x 4 cells (2 km)
export const AVIATION_M = 150;            // red obstruction lights on anything this tall
export const ALONG_WRAP = 19200;          // along wraps at 9,600 m (in 0.5 m units)
// The mask rule (see maskRule): a 500 m cell's procedural block gives way to the real buildings when
// the data carries it: at least MASK_MIN_COUNT kept buildings covering MASK_MIN_COVER of the cell, or
// a few big ones covering MASK_BIG_COVER.
export const MASK_MIN_COUNT = 12, MASK_MIN_COVER = 0.10, MASK_BIG_COVER = 0.20;

// ---------------------------------------------------------------- parsing

export function parseCentre(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (ab.byteLength < 12) throw new Error('centres: file too short');
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('centres: bad magic');
  const count = dv.getUint32(4, true), vertexCount = dv.getUint32(8, true);
  const vbase = 12 + count * 8;
  if (ab.byteLength !== vbase + vertexCount * 4) throw new Error(`centres: size ${ab.byteLength} != ${vbase + vertexCount * 4}`);
  const height = new Uint16Array(count), minHeight = new Uint16Array(count);
  const nVerts = new Uint8Array(count), flags = new Uint8Array(count), vstart = new Uint32Array(count + 1);
  let v = 0;
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 8;
    height[i] = dv.getUint16(o, true);
    minHeight[i] = dv.getUint16(o + 2, true);
    nVerts[i] = dv.getUint8(o + 4);
    flags[i] = dv.getUint8(o + 5);
    vstart[i] = v;
    v += nVerts[i];
  }
  vstart[count] = v;
  if (v !== vertexCount) throw new Error(`centres: vertex count ${v} != ${vertexCount}`);
  // The vertices as one Int16Array (x, y pairs); little-endian read explicitly (portable).
  const xy = new Int16Array(vertexCount * 2);
  for (let k = 0; k < vertexCount * 2; k++) xy[k] = dv.getInt16(vbase + k * 2, true);
  return { count, vertexCount, height, minHeight, nVerts, flags, vstart, xy };
}

// The record's mean vertex (0.5 m units, as stored) and its 500 m cell in the centre's box.
export function recordMean(p, i) {
  const s = p.vstart[i], n = p.nVerts[i];
  let sx = 0, sy = 0;
  for (let k = 0; k < n; k++) { sx += p.xy[(s + k) * 2]; sy += p.xy[(s + k) * 2 + 1]; }
  return [sx / n, sy / n];
}
export function cellOf(info, mx2, my2) {
  const x = info.origin[0] + mx2 / 2, y = info.origin[1] + my2 / 2;
  const ci = Math.min(info.cols - 1, Math.max(0, Math.floor((x - info.box[0]) / CELL_M)));
  const cj = Math.min(info.rows - 1, Math.max(0, Math.floor((y - info.box[1]) / CELL_M)));
  return [ci, cj];
}

// ---------------------------------------------------------------- geometry helpers

// Twice the signed area of a ring (+ counter-clockwise), xs/ys plain arrays or typed.
export function ringArea2(xs, ys, n = xs.length) {
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += xs[j] * ys[i] - xs[i] * ys[j];
  return a;
}

// Ear-clipping triangulation of a simple counter-clockwise ring (concave allowed). Returns a flat
// array of vertex indices into the ring, three per triangle, every triangle counter-clockwise with a
// positive area. Collinear and repeated vertices are dropped (they make no area). A ring that isn't
// simple (OSM has a few) is still covered: when no ear is left the smallest corner goes, and its
// triangle is kept only if it is counter-clockwise.
export function triangulate(xs, ys, n = xs.length, out = []) {
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const cross = (a, b, c) => (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
  // In the closed triangle (a, b, c), counter-clockwise: a vertex on the new diagonal (c, a) blocks
  // the ear too, or the diagonal would run through it. A vertex at the same place as a corner (a
  // ring touching itself) doesn't.
  const inside = (p, a, b, c) => {
    if ((xs[p] === xs[a] && ys[p] === ys[a]) || (xs[p] === xs[b] && ys[p] === ys[b]) || (xs[p] === xs[c] && ys[p] === ys[c])) return false;
    return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    const m = idx.length;
    let clipped = false;
    // Drop collinear (and repeated) vertices first: no area, and they confuse the ear test.
    for (let k = 0; k < m; k++) {
      const a = idx[(k + m - 1) % m], b = idx[k], c = idx[(k + 1) % m];
      if (cross(a, b, c) === 0) { idx.splice(k, 1); clipped = true; break; }
    }
    if (clipped) continue;
    for (let k = 0; k < m; k++) {
      const a = idx[(k + m - 1) % m], b = idx[k], c = idx[(k + 1) % m];
      if (cross(a, b, c) <= 0) continue;                 // reflex: not an ear
      let ok = true;
      for (let q = 0; q < m; q++) {
        const p = idx[q];
        if (p === a || p === b || p === c) continue;
        // Only a reflex vertex can lie inside a convex corner's triangle.
        const pa = idx[(q + m - 1) % m], pc = idx[(q + 1) % m];
        if (cross(pa, p, pc) > 0) continue;
        if (inside(p, a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(a, b, c);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (clipped) continue;
    // No ear: not a simple ring. Cut the corner with the smallest area and go on.
    let best = 0, bestA = Infinity;
    for (let k = 0; k < m; k++) {
      const ar = Math.abs(cross(idx[(k + m - 1) % m], idx[k], idx[(k + 1) % m]));
      if (ar < bestA) { bestA = ar; best = k; }
    }
    const a = idx[(best + m - 1) % m], b = idx[best], c = idx[(best + 1) % m];
    if (cross(a, b, c) > 0) out.push(a, b, c);
    idx.splice(best, 1);
  }
  if (idx.length === 3 && cross(idx[0], idx[1], idx[2]) > 0) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// ---------------------------------------------------------------- the mask rule

// Should a cell's procedural block give way? count: kept buildings in it; cover: the share of the
// cell under their footprints (outlines only, not building:parts, which overlap them).
export function maskRule(count, cover) {
  return (count >= MASK_MIN_COUNT && cover >= MASK_MIN_COVER) || cover >= MASK_BIG_COVER;
}

// ---------------------------------------------------------------- the build

// Is map point (x, y) in a runway's flattening zone (heightfield.js's flatWeight > 0: the runway
// plus 90 m, plus the 300 m blend)? rects: { cx, cy, dx, dy, halfLen, halfWid }.
export const RWY_MARGIN = 90 + 300;
export function onRunwayZone(rects, x, y) {
  for (const r of rects) {
    const ex = x - r.cx, ey = y - r.cy;
    const u = ex * r.dx + ey * r.dy, v = -ex * r.dy + ey * r.dx;
    if (Math.abs(u) < r.halfLen + RWY_MARGIN && Math.abs(v) < r.halfWid + RWY_MARGIN) return true;
  }
  return false;
}

// Build one centre. p: parseCentre()'s; info: its centres.json entry ({ origin, box, cols, rows });
// opts.exclude: [{ x, y, r }] in map metres (the landmarks: every record whose centre is within r of
// one is left out); opts.runways: the runway rects (records on a flattening zone are left out).
export function buildCentre(p, info, opts = {}) {
  const t0 = now();
  const exclude = opts.exclude || [], runways = opts.runways || [];
  const tallM = opts.tallM ?? TALL_M, chunkCells = opts.chunkCells ?? CHUNK_CELLS;
  const ox = info.origin[0], oy = info.origin[1];
  const nRec = p.count;
  const keep = new Uint8Array(nRec);          // 0 out, 1 low, 2 tall
  const mean = new Float64Array(nRec * 2);
  const triCount = new Uint32Array(nRec);     // roof triangles
  const roofTris = [];                        // per record: its roof triangles (ring indices)
  const skipped = { landmark: 0, runway: 0, degenerate: 0 };
  const cells = info.cols * info.rows;
  const cellCount = new Uint32Array(cells), cellArea = new Float64Array(cells);
  const cellOfRec = new Uint32Array(nRec);
  const xs = new Float64Array(256), ys = new Float64Array(256);
  for (let i = 0; i < nRec; i++) {
    const [mx, my] = recordMean(p, i);
    mean[i * 2] = mx; mean[i * 2 + 1] = my;
    const X = ox + mx / 2, Y = oy + my / 2;
    let out = false;
    for (const e of exclude) if ((X - e.x) ** 2 + (Y - e.y) ** 2 < e.r * e.r) { out = true; break; }
    if (out) { skipped.landmark++; roofTris.push(null); continue; }
    if (runways.length && onRunwayZone(runways, X, Y)) { skipped.runway++; roofTris.push(null); continue; }
    const s = p.vstart[i], n = p.nVerts[i];
    for (let k = 0; k < n; k++) { xs[k] = p.xy[(s + k) * 2] / 2; ys[k] = p.xy[(s + k) * 2 + 1] / 2; }
    const a2 = ringArea2(xs, ys, n);
    if (n < 3 || a2 <= 0 || p.height[i] <= p.minHeight[i]) { skipped.degenerate++; roofTris.push(null); continue; }
    const tri = triangulate(xs, ys, n, []);
    if (!tri.length) { skipped.degenerate++; roofTris.push(null); continue; }
    roofTris.push(tri);
    triCount[i] = tri.length / 3;
    keep[i] = p.height[i] / 10 >= tallM ? 2 : 1;
    const [ci, cj] = cellOf(info, mx, my);
    const c = cj * info.cols + ci;
    cellOfRec[i] = c;
    cellCount[c]++;
    if (!(p.flags[i] & 2)) cellArea[c] += a2 / 2;
  }
  const tTri = now();

  // The mask, by the rule.
  const mask = new Uint8Array(cells), cellCover = new Float32Array(cells);
  let masked = 0;
  for (let c = 0; c < cells; c++) {
    cellCover[c] = cellArea[c] / (CELL_M * CELL_M);
    if (maskRule(cellCount[c], cellCover[c])) { mask[c] = 1; masked++; }
  }

  // The order of each tier. Tall: by height descending (stable). Low: by chunk, row-major.
  const tallIdx = [], lowIdx = [];
  for (let i = 0; i < nRec; i++) if (keep[i] === 2) tallIdx.push(i); else if (keep[i] === 1) lowIdx.push(i);
  tallIdx.sort((a, b) => p.height[b] - p.height[a] || a - b);
  const ccols = Math.ceil(info.cols / chunkCells), crows = Math.ceil(info.rows / chunkCells);
  const chunkOf = (i) => {
    const c = cellOfRec[i], ci = c % info.cols, cj = (c - ci) / info.cols;
    return Math.floor(cj / chunkCells) * ccols + Math.floor(ci / chunkCells);
  };
  const lowChunk = new Uint32Array(nRec);
  for (const i of lowIdx) lowChunk[i] = chunkOf(i);
  lowIdx.sort((a, b) => lowChunk[a] - lowChunk[b] || a - b);

  const tall = emitTier(p, tallIdx, roofTris, triCount, mean);
  const low = emitTier(p, lowIdx, roofTris, triCount, mean);
  // The low tier's chunk ranges (index offsets), chunk-row-major, as a prefix: chunk k is
  // [chunkStart[k], chunkStart[k + 1]).
  const chunkStart = new Uint32Array(ccols * crows + 1);
  {
    let r = 0;
    for (let k = 0; k <= ccols * crows; k++) {
      while (r < lowIdx.length && lowChunk[lowIdx[r]] < k) r++;
      chunkStart[k] = r < lowIdx.length ? low.recIndexStart[r] : low.index.length;
    }
    chunkStart[ccols * crows] = low.index.length;
  }
  // The tall tier's tops (m), in its order, and where each building's indices end (a prefix).
  const tallTop = new Float32Array(tallIdx.length);
  tallIdx.forEach((i, k) => { tallTop[k] = p.height[i] / 10; });

  // Aviation lights: the corners of every roof at AVIATION_M or more (the ring's extreme vertices,
  // or the centre for a slim one), one per 4 m.
  const lights = [], seen = new Set();
  for (const i of tallIdx) {
    if (p.height[i] / 10 < AVIATION_M) break;
    const s = p.vstart[i], n = p.nVerts[i], top = p.height[i] / 10;
    const cx = mean[i * 2] / 2, cy = mean[i * 2 + 1] / 2;
    let rad = 0;
    const pts = [];
    const ext = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [ax, ay] of ext) {
      let best = -Infinity, bx = 0, by = 0;
      for (let k = 0; k < n; k++) {
        const x = p.xy[(s + k) * 2] / 2, y = p.xy[(s + k) * 2 + 1] / 2;
        const d = ax * x + ay * y;
        if (d > best) { best = d; bx = x; by = y; }
        rad = Math.max(rad, Math.hypot(x - cx, y - cy));
      }
      pts.push([bx, by]);
    }
    for (const [x, y] of rad < 12 ? [[cx, cy]] : pts) {
      const key = Math.round(x / 4) + ',' + Math.round(y / 4) + ',' + Math.round(top / 4);
      if (seen.has(key)) continue;
      seen.add(key);
      lights.push(x, y, top + 0.6, cx, cy);
    }
  }
  const t1 = now();
  return {
    id: info.id,
    kept: tallIdx.length + lowIdx.length, skipped,
    tall: { aP: tall.aP, aB: tall.aB, aN: tall.aN, index: tall.index, top: tallTop, end: tall.recIndexEnd, count: tallIdx.length, tris: tall.index.length / 3, verts: tall.verts },
    low: { aP: low.aP, aB: low.aB, aN: low.aN, index: low.index, chunkStart, chunkCols: ccols, chunkRows: crows, chunkM: chunkCells * CELL_M, count: lowIdx.length, tris: low.index.length / 3, verts: low.verts },
    lights: new Float32Array(lights),
    mask, cellCount, cellCover, masked,
    ms: { triangulate: tTri - t0, build: t1 - t0 },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// One tier's buffers, for the records in `order`.
function emitTier(p, order, roofTris, triCount, mean) {
  let nv = 0, ni = 0;
  for (const i of order) { const n = p.nVerts[i]; nv += 5 * n; ni += 6 * n + 3 * triCount[i]; }
  const aP = new Int16Array(nv * 4), aB = new Int16Array(nv * 4), aN = new Int8Array(nv * 4);
  const index = new Uint32Array(ni);
  const recIndexStart = new Uint32Array(order.length), recIndexEnd = new Uint32Array(order.length);
  let v = 0, q = 0;
  const xs = new Float64Array(256), ys = new Float64Array(256);
  for (let r = 0; r < order.length; r++) {
    const i = order[r];
    recIndexStart[r] = q;
    const s = p.vstart[i], n = p.nVerts[i];
    const top = p.height[i], base = p.minHeight[i];
    const cx2 = Math.round(mean[i * 2]), cy2 = Math.round(mean[i * 2 + 1]);
    let rad = 0;
    for (let k = 0; k < n; k++) {
      xs[k] = p.xy[(s + k) * 2]; ys[k] = p.xy[(s + k) * 2 + 1];
      rad = Math.max(rad, Math.hypot(xs[k] - cx2, ys[k] - cy2) / 2);
    }
    const packed = Math.min(4095, Math.round(rad)) + 4096 * (p.flags[i] & 3);
    const put = (x2, y2, hdm, along, nx, ny, nz, roof) => {
      const o = v * 4;
      aP[o] = x2; aP[o + 1] = y2; aP[o + 2] = hdm; aP[o + 3] = along;
      aB[o] = cx2; aB[o + 1] = cy2; aB[o + 2] = top; aB[o + 3] = packed;
      aN[o] = nx; aN[o + 1] = ny; aN[o + 2] = nz; aN[o + 3] = roof;
      return v++;
    };
    // Walls: one quad per edge, outward (the ring is counter-clockwise: the outside is on the right).
    let along = 0;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const dx = (xs[k2] - xs[k]) / 2, dy = (ys[k2] - ys[k]) / 2, len = Math.hypot(dx, dy);
      let a0 = Math.round(along * 2) % ALONG_WRAP;
      const l2 = Math.round(len * 2);
      if (a0 + l2 > 32767) a0 -= ALONG_WRAP;            // stays continuous along this wall
      const a1 = a0 + l2;
      along += len;
      if (len < 1e-6) {
        // Keep the vertex count fixed (the counts above); a degenerate quad draws nothing.
        for (let z = 0; z < 4; z++) put(xs[k], ys[k], base, 0, 0, 0, 0, 0);
        for (let z = 0; z < 6; z++) index[q++] = v - 1;
        continue;
      }
      const nx = Math.round((dy / len) * 127), ny = Math.round((-dx / len) * 127);
      const A = put(xs[k], ys[k], base, a0, nx, ny, 0, 0);
      const B = put(xs[k2], ys[k2], base, a1, nx, ny, 0, 0);
      const C = put(xs[k2], ys[k2], top, a1, nx, ny, 0, 0);
      const D = put(xs[k], ys[k], top, a0, nx, ny, 0, 0);
      index[q++] = A; index[q++] = B; index[q++] = C;
      index[q++] = A; index[q++] = C; index[q++] = D;
    }
    // The roof.
    const r0 = v;
    for (let k = 0; k < n; k++) put(xs[k], ys[k], top, 0, 0, 0, 127, 127);
    const tri = roofTris[i];
    for (let t = 0; t < tri.length; t++) index[q++] = r0 + tri[t];
    recIndexEnd[r] = q;
  }
  return { aP, aB, aN, index, recIndexStart, recIndexEnd, verts: v };
}

// ---------------------------------------------------------------- the worker

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`centres: ${url}: ${res.status}`);
  const enc = res.headers.get('content-encoding');
  if (enc && enc.includes('gzip')) return await res.arrayBuffer();
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

// Fetch, parse and build one centre: { url, info, exclude, runways } -> buildCentre()'s result plus
// the timings (ms: fetch, parse, triangulate, build).
export async function loadAndBuild({ url, info, exclude, runways }) {
  const t0 = now();
  const buf = await fetchGz(url);
  const t1 = now();
  const p = parseCentre(buf);
  const t2 = now();
  const r = buildCentre(p, info, { exclude, runways });
  r.ms.fetch = t1 - t0; r.ms.parse = t2 - t1;
  r.bytes = buf.byteLength;
  return r;
}
export function transferList(r) {
  return [r.tall.aP, r.tall.aB, r.tall.aN, r.tall.index, r.tall.top, r.tall.end, r.low.aP, r.low.aB, r.low.aN, r.low.index, r.low.chunkStart, r.lights, r.mask, r.cellCount, r.cellCover].map((a) => a.buffer);
}

const IS_WORKER = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
if (IS_WORKER) {
  self.onmessage = async (e) => {
    const job = e.data;
    try {
      const r = await loadAndBuild(job);
      r.job = job.job;
      self.postMessage(r, transferList(r));
    } catch (err) {
      self.postMessage({ job: job.job, id: job.info && job.info.id, error: String(err && err.message || err) });
    }
  };
}
