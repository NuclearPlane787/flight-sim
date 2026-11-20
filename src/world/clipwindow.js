// The GPU's clip window over the 250 m tiles (v0.6.0, V060.md Part 1 step 3). Pure: no DOM, no
// three.js, so node can check it cell for cell. glsl.js turns its arrays into textures.
//
// One window of N x N texels per layer (heights, normals, water, cover). Texel (p, q) holds
// global l0 cell (gi, gj) with gi = p (mod N), gj = q (mod N), where the global index counts
// from the lattice's origin (Korea's south-west corner, the tile store's x0, y0). So a map
// position's texture coordinate is (m − x0) / (N · cell) whatever the window's position, and
// a repeating texture wraps it: the shaders' natUv() and clouds.js's cover lookup stay as they
// were, with uNatSize = N.
//
// Two modes:
// - fit: the whole extent fits in N (Korea: 3,200 cells, N = 4096). The window is then the
//   extent itself, fixed (nx × ny = the extent's cells, texel = cell − extent origin), drawn
//   with ClampToEdge: the national texture, cell for cell, at the same size, so the texture
//   coordinates, the mips and the edge clamp are v0.5.8's to the bit. (A 4096² window over
//   Korea with RepeatWrapping holds the same cells, but the float uv differs by an ulp here and
//   there, which moved 0.002 % of the pixels by up to 10 levels; and the wrap is not the
//   clamp at the extent's north edge, which has land.)
// - follow: a toroidal N² window (N a power of two), global cell g at texel g & (N − 1),
//   RepeatWrapping, following the camera in whole tiles, refilled a tile at a time (step()).
// The window holds global cells [oi, oi + nx) × [oj, oj + ny). A cell outside the data's extent
// holds the extent's nearest edge cell (the old national texture's ClampToEdge, and what the
// tiles' borders hold). base (bi, bj): the global cell at texel 0 (uNat's origin).
//
// The region (v0.6.0, the evening sitting): a following window fills in blocks of one tile
// (512 x 512 cells), the nearest to the camera first, at most one a step, each from what the
// store has there: a baked 250 m tile; open sea; or, where there is no 250 m data (the margin
// beyond the fine box, and its unbaked corner tiles), the 1 km level upsampled with the store's
// own bilinear arithmetic. A block whose tile isn't resident yet is asked for (store.request)
// and filled when it is. valid() is then the largest rectangle of filled blocks round the
// camera's own (the shaders draw open sea outside it), so a window that has just jumped shows
// ground as soon as the blocks round the camera are in, and a window that shifts a row keeps
// everything it already had. With a 4096 window and a hysteresis of 3/4 tile, the ground is
// held to at least 416 km from the camera, past the horizon at 45,000 ft (418 km at sea level).
//
// Normals: normalsRG() of glsl.js over the whole extent, computed per cell from the tiles (the
// border of 2 holds each cell's neighbours), clamped at the extent's edge as normalsRG clamps
// at the grid's.

export const CLIP_N = 4096;

export function createClipWindow(store, opts = {}) {
  const N0 = opts.N || CLIP_N;
  if (N0 & (N0 - 1)) throw new Error('clipwindow: N must be a power of two');
  const lat = store.lattice;
  const TILE = lat.tile, B = lat.border, S = TILE + 2 * B, CELL = lat.cell;
  const { i0: I0, j0: J0, i1: I1, j1: J1 } = lat.extent;
  const spec = store.spec;
  const sea = spec.sea || { h: -160, w: [0, 255], c: [0, 0, 0, 0] };
  const listed = new Set(spec.levels[0].tiles);
  const scale = opts.heightScale || spec.heightScale || 0.25;
  const k = scale / (2 * CELL);
  const has = store.has;
  const fit = I1 - I0 <= N0 && J1 - J0 <= N0;
  const NX = fit ? I1 - I0 : N0, NY = fit ? J1 - J0 : N0, N = fit ? Math.max(NX, NY) : N0;
  const MASK = fit ? -1 : N0 - 1;
  const BI = fit ? I0 : 0, BJ = fit ? J0 : 0;

  // opts.lean (the game, over the region): no CPU copy of the window's heights, normals and water
  // (100 MB at 4096²): h, n and w are then one block's scratch (512²), filled by a step and
  // uploaded before the next; only the cover keeps its mirror (the cities' block tests read it).
  const lean = !!opts.lean && !fit && !!lat.l1 && I0 % TILE === 0 && I1 % TILE === 0 && J0 % TILE === 0 && J1 % TILE === 0;
  const HN = lean ? TILE * TILE : NX * NY;
  const h = has.h ? new Int16Array(HN) : null;
  const n = has.h ? new Uint8Array(HN * 2) : null;
  const w = has.w ? new Uint8Array(HN * 2) : null;
  const c = has.c ? new Uint8Array(NX * NY * 4) : null;

  // Window origin per axis: fixed and centred when the extent fits, else tile-snapped round the camera.
  function originFor(cam, lo, hi) {
    if (fit) return lo;
    let o = Math.round((cam - N / 2) / TILE) * TILE;
    if (lat.l1) return o;      // the region: the margin beyond the 250 m data is ground too (the 1 km level)
    const a = Math.floor(lo / TILE) * TILE, b = Math.ceil(hi / TILE) * TILE - N;
    if (o < a) o = a; else if (o > b) o = b;
    return o;
  }

  const win = { oi: 0, oj: 0, N, nx: NX, ny: NY, fit, mask: MASK, bi: BI, bj: BJ, cell: CELL, x0: lat.x0, y0: lat.y0 };
  let tileCache = new Map();
  let missing = false;
  function tileOf(ti, tj) {
    const key = ti + '_' + tj;
    let t = tileCache.get(key);
    if (t === undefined) {
      if (!listed.has(key)) t = null;
      else { t = store.tileGrid(key); if (!t) { t = 'missing'; } }
      tileCache.set(key, t);
    }
    if (t === 'missing') { missing = true; return null; }
    return t;
  }
  const clampI = (i) => (i < I0 ? I0 : i >= I1 ? I1 - 1 : i);
  const clampJ = (j) => (j < J0 ? J0 : j >= J1 ? J1 - 1 : j);

  // Height (raw int) of extent cell (ci, cj).
  function cellH(ci, cj) {
    const ti = Math.floor(ci / TILE), tj = Math.floor(cj / TILE);
    const t = tileOf(ti, tj);
    if (!t || !t.height) return sea.h;
    return t.height[(cj - tj * TILE + B) * S + (ci - ti * TILE + B)];
  }

  // Fill global cells [gi0, gi1) × [gj0, gj1) (inside the window).
  function fill(gi0, gj0, gi1, gj1) {
    tileCache = new Map();
    missing = false;
    for (let gj = gj0; gj < gj1; gj++) {
      const cj = clampJ(gj), tj = Math.floor(cj / TILE), lj = cj - tj * TILE + B;
      const jm = cj > J0 ? cj - 1 : J0, jp = cj < J1 - 1 ? cj + 1 : J1 - 1;
      const q = (gj - BJ) & MASK;
      for (let gi = gi0; gi < gi1; gi++) {
        const ci = clampI(gi), ti = Math.floor(ci / TILE), li = ci - ti * TILE + B;
        const p = (gi - BI) & MASK, o = q * NX + p;
        const t = tileOf(ti, tj);
        const s = lj * S + li;
        if (h) {
          h[o] = t && t.height ? t.height[s] : sea.h;
          // normalsRG's arithmetic, its edge clamp being the extent's.
          const im = ci > I0 ? ci - 1 : I0, ip = ci < I1 - 1 ? ci + 1 : I1 - 1;
          let a, b, cc, d;
          if (t && t.height) {
            // The tile's border holds the neighbours; outside the extent it holds the edge cell,
            // so read the clamped neighbours through their own offsets.
            const A = t.height;
            a = A[s + (im - ci)]; b = A[s + (ip - ci)]; cc = A[s + (jm - cj) * S]; d = A[s + (jp - cj) * S];
          } else if (!t && !listed.has(ti + '_' + tj)) {
            a = b = cc = d = sea.h;          // an open-sea tile: its border is open sea too
          } else {
            a = cellH(im, cj); b = cellH(ip, cj); cc = cellH(ci, jm); d = cellH(ci, jp);
          }
          if (a < 0) a = 0; if (b < 0) b = 0; if (cc < 0) cc = 0; if (d < 0) d = 0;
          const gx = (b - a) * k, gy = (d - cc) * k;
          const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          n[o * 2] = Math.round(128 - 127 * gx * inv);
          n[o * 2 + 1] = Math.round(128 - 127 * gy * inv);
        }
        if (w) {
          if (t && t.water) { w[o * 2] = t.water[s * 2]; w[o * 2 + 1] = t.water[s * 2 + 1]; }
          else { w[o * 2] = sea.w[0]; w[o * 2 + 1] = sea.w[1]; }
        }
        if (c) {
          if (t && t.cover) { const z = s * 4; c[o * 4] = t.cover[z]; c[o * 4 + 1] = t.cover[z + 1]; c[o * 4 + 2] = t.cover[z + 2]; c[o * 4 + 3] = t.cover[z + 3]; }
          else { c[o * 4] = sea.c[0]; c[o * 4 + 1] = sea.c[1]; c[o * 4 + 2] = sea.c[2]; c[o * 4 + 3] = sea.c[3]; }
        }
      }
    }
    return !missing;
  }

  // The texel rectangles of global cells [gi0, gi1) × [gj0, gj1), split where they wrap.
  function texelRects(gi0, gj0, gi1, gj1) {
    const out = [];
    const xs = [], ys = [];
    for (let a = gi0; a < gi1;) { const p = (a - BI) & MASK, len = Math.min(gi1 - a, NX - p); xs.push([p, len]); a += len; }
    for (let a = gj0; a < gj1;) { const q = (a - BJ) & MASK, len = Math.min(gj1 - a, NY - q); ys.push([q, len]); a += len; }
    for (const [y, hh] of ys) for (const [x, ww] of xs) out.push({ x, y, w: ww, h: hh });
    return out;
  }

  const queue = [];        // follow mode: the blocks of the window still to fill, [gi0, gj0, gi1, gj1] (kept for the tests: empty when idle)
  const uploads = [];      // texel rects filled since the last flush (glsl.js uploads them)

  // ---- follow mode: blocks ------------------------------------------------------------
  const l1 = lat.l1 || null;                       // the 1 km level, when the store reads one beyond l0
  const L1 = l1 ? spec.levels[1] : null;
  const covered = spec.levels[0].covered ? new Set(spec.levels[0].covered) : null;
  const listed1 = L1 ? new Set(L1.tiles) : null;
  const aligned = I0 % TILE === 0 && I1 % TILE === 0 && J0 % TILE === 0 && J1 % TILE === 0;
  const filled = new Map();                        // 'ti_tj' -> the block's highest height (raw units)
  let camTi = 0, camTj = 0;                        // the camera's block
  const HYST = Math.floor(TILE * 3 / 4);
  // What a block (one tile's cells) is filled from: 'l0' (the old per-cell fill: a baked tile,
  // open sea, or the extent's edge cell beyond it when there is no 1 km level) or 'l1'.
  function blockKind(ti, tj) {
    if (!l1 || !aligned) return 'l0';
    const inExt = ti * TILE >= I0 && (ti + 1) * TILE <= I1 && tj * TILE >= J0 && (tj + 1) * TILE <= J1;
    if (inExt && (!covered || covered.has(ti + '_' + tj))) return 'l0';
    return 'l1';
  }
  const state1 = (key) => (store.peek ? store.peek(key) : (store.tileGrid && store.tileGrid(key) ? 'ready' : undefined));
  // Is a block's data resident? Asks the store for it if not.
  function blockReady(ti, tj) {
    if (blockKind(ti, tj) === 'l0') {
      const key = ti + '_' + tj;
      if (!listed.has(key) || ti * TILE < I0 || ti * TILE >= I1 || tj * TILE < J0 || tj * TILE >= J1) return true;   // sea, or clamped cells
      if (store.tileGrid(key)) return true;
      if (store.request) store.request(key);
      return false;
    }
    const k1 = Math.floor(ti * TILE * CELL / (l1.cell * L1.tile)) + '_' + Math.floor(tj * TILE * CELL / (l1.cell * L1.tile));
    if (!listed1.has(k1)) return true;             // open sea at 1 km too
    if (store.tileGrid('l1:' + k1)) return true;
    if (store.request) store.request('l1:' + k1);
    return false;
  }

  // Fill a block from the 1 km level: each 250 m cell the store's bilinear of the 1 km cells
  // (tilestore.js bilinLv: fx = (x − x0) / cell − 0.5, clamped at the level's extent), the
  // normals by central differences of those heights, as normalsRG. Beyond the 1 km extent: sea.
  const R = l1 ? Math.round(l1.cell / CELL) : 4;   // 250 m cells per 1 km cell
  let hbuf = null, hbufKey = '', hbufTop = -32768;
  const L1_ROWS = 32;                              // rows of a 1 km block filled a step (1 to 5 ms in Chrome)
  const partial = new Map();                       // 'ti_tj' -> the next row of a block being filled from l1
  // Per column and row of the block's 514-wide buffer: the 1 km cell (its index in the tile's
  // grid), the weight, and whether it lies outside the 1 km extent or this tile.
  const W1 = TILE + 2;
  const colI = new Int32Array(W1), colT = new Float64Array(W1), colO = new Uint8Array(W1);
  const rowI = new Int32Array(W1), rowT = new Float64Array(W1), rowO = new Uint8Array(W1);
  function l1Axis(g0, lo, hi, t1, T1, B1, S1, idx, wt, off) {
    const m = hi - 1;
    for (let a = 0; a < W1; a++) {
      let f = (g0 + a - 1 + 0.5) / R - 0.5;
      off[a] = f < lo - 0.5 || f > m + 0.5 ? 1 : 0;
      if (f < lo) f = lo; else if (f > m) f = m;
      let i = Math.floor(f);
      if (i >= m) i = m - 1;
      wt[a] = f - i;
      idx[a] = i - t1 * T1 + B1;
      if (idx[a] < 0 || idx[a] > S1 - 2) off[a] = 1;   // not in this 1 km tile (only beyond the extent)
    }
  }
  // Rows [r0, r1) of the block (1-based inside the buffer). Returns the block's highest height.
  function fillL1(ti, tj, r0 = 1, r1 = TILE + 1) {
    const T1 = L1.tile, B1 = L1.border, S1 = T1 + 2 * B1, e1 = l1.extent;
    const t1i = Math.floor(ti * TILE / (R * T1)), t1j = Math.floor(tj * TILE / (R * T1));
    const g = listed1.has(t1i + '_' + t1j) ? store.tileGrid('l1:' + t1i + '_' + t1j) : null;
    const gi0 = ti * TILE, gj0 = tj * TILE, W = W1;
    const gh = g && g.height, gw = g && g.water, gc = g && g.cover;
    l1Axis(gi0, e1.i0, e1.i1, t1i, T1, B1, S1, colI, colT, colO);
    l1Axis(gj0, e1.j0, e1.j1, t1j, T1, B1, S1, rowI, rowT, rowO);
    let top = hbufTop;
    if (h && hbufKey !== ti + '_' + tj) {
      hbuf = hbuf || new Float32Array(W * W);
      top = -32768;
      for (let b = 0; b < W; b++) {
        const ty = rowT[b], kb = rowI[b] * S1, ob = rowO[b] || !gh;
        for (let a = 0; a < W; a++) {
          let v = sea.h;
          if (!ob && !colO[a]) {
            const k1 = kb + colI[a], tx = colT[a];
            const A = gh[k1], ab = A + (gh[k1 + 1] - A) * tx, C = gh[k1 + S1];
            v = ab + ((C + (gh[k1 + S1 + 1] - C) * tx) - ab) * ty;
          }
          hbuf[b * W + a] = v;
          if (v > top) top = v;
        }
      }
      hbufKey = ti + '_' + tj; hbufTop = top;
    }
    const s0 = sea.w[0], s1 = sea.w[1];
    for (let b = r0; b < r1; b++) {
      const q = (gj0 + b - 1 - BJ) & MASK, ty = rowT[b], kb = rowI[b] * S1, ob = rowO[b];
      let oc = q * NX + ((gi0 - BI) & MASK), o = lean ? (b - 1) * TILE : oc;
      for (let a = 1; a <= TILE; a++, o++, oc++) {
        const in1 = !ob && !colO[a], k1 = kb + colI[a], tx = colT[a];
        if (h) {
          const hb = b * W + a;
          h[o] = Math.round(hbuf[hb]);
          let A = hbuf[hb - 1], Bv = hbuf[hb + 1], C = hbuf[hb - W], D = hbuf[hb + W];
          if (A < 0) A = 0; if (Bv < 0) Bv = 0; if (C < 0) C = 0; if (D < 0) D = 0;
          const gx = (Bv - A) * k, gy = (D - C) * k, inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          n[o * 2] = 128.5 - 127 * gx * inv;          // a Uint8Array truncates: Math.round for these positives
          n[o * 2 + 1] = 128.5 - 127 * gy * inv;
        }
        if (w) {
          if (gw && in1) {
            for (let ch = 0; ch < 2; ch++) {
              const z = k1 * 2 + ch, A = gw[z], ab = A + (gw[z + 2] - A) * tx, C = gw[z + S1 * 2];
              w[o * 2 + ch] = ab + ((C + (gw[z + S1 * 2 + 2] - C) * tx) - ab) * ty + 0.5;
            }
          } else { w[o * 2] = s0; w[o * 2 + 1] = s1; }
        }
        if (c) {
          if (gc && in1) {
            for (let ch = 0; ch < 4; ch++) {
              const z = k1 * 4 + ch, A = gc[z], ab = A + (gc[z + 4] - A) * tx, C = gc[z + S1 * 4];
              c[oc * 4 + ch] = ab + ((C + (gc[z + S1 * 4 + 4] - C) * tx) - ab) * ty + 0.5;
            }
          } else { c[oc * 4] = sea.c[0]; c[oc * 4 + 1] = sea.c[1]; c[oc * 4 + 2] = sea.c[2]; c[oc * 4 + 3] = sea.c[3]; }
        }
      }
    }
    return top;
  }

  // The region's fast paths. A baked tile's block: its rows copied, the normals from its own
  // border cells (normalsRG's arithmetic). An open-sea block: the sea's values.
  function fillTile(ti, tj, t) {
    const gi0 = ti * TILE, gj0 = tj * TILE, p0 = (gi0 - BI) & MASK;
    const A = t.height;
    let top = -32768;
    for (let r = 0; r < TILE; r++) {
      const oc = ((gj0 + r - BJ) & MASK) * NX + p0, o0 = lean ? r * TILE : oc, s0 = (r + B) * S + B;
      if (h) {
        h.set(A.subarray(s0, s0 + TILE), o0);
        for (let a = 0, s = s0, o = o0 * 2; a < TILE; a++, s++, o += 2) {
          const v = A[s];
          if (v > top) top = v;
          let x0 = A[s - 1], x1 = A[s + 1], y0 = A[s - S], y1 = A[s + S];
          if (x0 < 0) x0 = 0; if (x1 < 0) x1 = 0; if (y0 < 0) y0 = 0; if (y1 < 0) y1 = 0;
          const gx = (x1 - x0) * k, gy = (y1 - y0) * k, inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          n[o] = 128.5 - 127 * gx * inv;        // a Uint8Array truncates: Math.round for these positives
          n[o + 1] = 128.5 - 127 * gy * inv;
        }
      }
      if (w) { if (t.water) w.set(t.water.subarray(s0 * 2, (s0 + TILE) * 2), o0 * 2); else for (let a = 0; a < TILE; a++) { w[(o0 + a) * 2] = sea.w[0]; w[(o0 + a) * 2 + 1] = sea.w[1]; } }
      if (c) { if (t.cover) c.set(t.cover.subarray(s0 * 4, (s0 + TILE) * 4), oc * 4); else c.fill(0, oc * 4, (oc + TILE) * 4); }
    }
    return top;
  }
  function fillSea(ti, tj) {
    const gi0 = ti * TILE, gj0 = tj * TILE, p0 = (gi0 - BI) & MASK;
    for (let r = 0; r < TILE; r++) {
      const oc = ((gj0 + r - BJ) & MASK) * NX + p0, o0 = lean ? r * TILE : oc;
      if (h) { h.fill(sea.h, o0, o0 + TILE); n.fill(128, o0 * 2, (o0 + TILE) * 2); }
      if (w) for (let a = 0; a < TILE; a++) { w[(o0 + a) * 2] = sea.w[0]; w[(o0 + a) * 2 + 1] = sea.w[1]; }
      if (c) for (let a = 0; a < TILE; a++) c.set(sea.c, (oc + a) * 4);
    }
    return sea.h;
  }

  // The highest height (raw units) in a filled rectangle of the window.
  function topOf(gi0, gj0, gi1, gj1) {
    let top = -32768;
    if (!h) return top;
    for (let gj = gj0; gj < gj1; gj++) {
      const q = (gj - BJ) & MASK;
      for (let gi = gi0; gi < gi1; gi++) { const v = h[q * NX + ((gi - BI) & MASK)]; if (v > top) top = v; }
    }
    return top;
  }

  // The blocks of the window not filled yet, the nearest to the camera first.
  function listQueue() {
    queue.length = 0;
    for (let tj = win.oj / TILE; tj < (win.oj + NY) / TILE; tj++) for (let ti = win.oi / TILE; ti < (win.oi + NX) / TILE; ti++) {
      if (!filled.has(ti + '_' + tj)) queue.push([ti * TILE, tj * TILE, (ti + 1) * TILE, (tj + 1) * TILE]);
    }
    const d = (r) => Math.max(Math.abs(r[0] / TILE - camTi), Math.abs(r[1] / TILE - camTj)) * 100 + Math.abs(r[0] / TILE - camTi) + Math.abs(r[1] / TILE - camTj);
    queue.sort((p, q) => d(p) - d(q));
  }

  // Centre the window on map (x, y) (the camera); returns true if it moved.
  function moveTo(x, y) {
    const ci = Math.floor((x - lat.x0) / CELL), cj = Math.floor((y - lat.y0) / CELL);
    if (fit) return false;
    const ni = originFor(ci, I0, I1), nj = originFor(cj, J0, J1);
    const clampT = (t, o, nn) => Math.max(o / TILE, Math.min((o + nn) / TILE - 1, t));
    let moved = false;
    if (ni !== win.oi || nj !== win.oj) {
      // Hysteresis: move only once the camera is three quarters of a tile off the centre.
      const di = Math.abs(ci - (win.oi + N / 2)), dj = Math.abs(cj - (win.oj + N / 2));
      if (di > HYST || dj > HYST || !started) {
        win.oi = ni; win.oj = nj; moved = true;
        // Blocks the new window drops: their texels are other blocks' now.
        for (const key of [...filled.keys()]) {
          const [a, b] = key.split('_').map(Number);
          if (a * TILE < ni || a * TILE >= ni + NX || b * TILE < nj || b * TILE >= nj + NY) filled.delete(key);
        }
        for (const key of [...partial.keys()]) {
          const [a, b] = key.split('_').map(Number);
          if (a * TILE < ni || a * TILE >= ni + NX || b * TILE < nj || b * TILE >= nj + NY) partial.delete(key);
        }
      }
    }
    started = true;
    const ti = clampT(Math.floor(ci / TILE), win.oi, NX), tj = clampT(Math.floor(cj / TILE), win.oj, NY);
    if (moved || ti !== camTi || tj !== camTj || !queue.length) { camTi = ti; camTj = tj; listQueue(); }
    return moved;
  }
  let started = false;

  // Fill one block (the nearest whose data is resident; the others are asked for): returns its
  // texel rects ([] for a strip of a 1 km block still in hand), or null when nothing was filled
  // (idle, or waiting for tiles).
  function step() {
    if (fit) return null;
    let asked = 0;
    for (let q = 0; q < queue.length; q++) {
      const [gi0, gj0, gi1, gj1] = queue[q];
      const ti = gi0 / TILE, tj = gj0 / TILE;
      // The scratch holds one block: a 1 km block in hand is finished before another starts.
      if (lean && partial.size && !partial.has(ti + '_' + tj)) continue;
      if (!blockReady(ti, tj)) { if (++asked >= 6) break; continue; }
      const key = ti + '_' + tj;
      let top;
      if (blockKind(ti, tj) === 'l1' && !listed1.has(Math.floor(ti * TILE / (R * L1.tile)) + '_' + Math.floor(tj * TILE / (R * L1.tile)))) {
        top = fillSea(ti, tj);                       // open sea at 1 km too
      } else if (blockKind(ti, tj) === 'l1') {
        // A strip of rows a step; the block counts (and uploads) once its last strip is in.
        const r0 = partial.get(key) || 1, r1 = Math.min(TILE + 1, r0 + L1_ROWS);
        top = fillL1(ti, tj, r0, r1);
        if (r1 <= TILE) { partial.set(key, r1); win.last = key + ' l1 rows ' + r0; return []; }
        partial.delete(key);
      } else if (l1 && aligned) {
        const t = listed.has(key) ? store.tileGrid(key) : null;
        top = t && (t.height || !h) ? fillTile(ti, tj, t) : fillSea(ti, tj);
      } else { if (!fill(gi0, gj0, gi1, gj1)) continue; top = topOf(gi0, gj0, gi1, gj1); }
      filled.set(key, top);
      win.last = key + ' ' + blockKind(ti, tj);      // for the frame-time checks: what the last step filled
      queue.splice(q, 1);
      const rects = texelRects(gi0, gj0, gi1, gj1);
      uploads.push(...rects);
      return rects;
    }
    return null;
  }

  // The largest rectangle of filled blocks grown from the camera's own, in global cells
  // (half-open). Empty (zero area) while the camera's block isn't in.
  function validFollow() {
    const bx0 = win.oi / TILE, by0 = win.oj / TILE, bx1 = bx0 + NX / TILE, by1 = by0 + NY / TILE;
    const has = (a, b) => filled.has(a + '_' + b);
    if (!has(camTi, camTj)) return [camTi * TILE, camTj * TILE, camTi * TILE, camTj * TILE];
    let a0 = camTi, a1 = camTi + 1, b0 = camTj, b1 = camTj + 1;
    const col = (a) => { for (let b = b0; b < b1; b++) if (!has(a, b)) return false; return true; };
    const row = (b) => { for (let a = a0; a < a1; a++) if (!has(a, b)) return false; return true; };
    for (let grew = true; grew;) {
      grew = false;
      if (a0 > bx0 && col(a0 - 1)) { a0--; grew = true; }
      if (a1 < bx1 && col(a1)) { a1++; grew = true; }
      if (b0 > by0 && row(b0 - 1)) { b0--; grew = true; }
      if (b1 < by1 && row(b1)) { b1++; grew = true; }
    }
    let v = [a0 * TILE, b0 * TILE, a1 * TILE, b1 * TILE];
    // Without a 1 km level the cells beyond the extent hold its edge cells: not valid ground.
    if (!l1 || !aligned) v = [Math.max(I0, v[0]), Math.max(J0, v[1]), Math.min(I1, v[2]), Math.min(J1, v[3])];
    return v;
  }

  if (fit) {
    // Korea: the window is the extent, filled once, fixed.
    win.oi = I0; win.oj = J0;
    fill(I0, J0, I0 + NX, J0 + NY);
  } else {
    // Following: open sea until the blocks come (step()), centred on the extent to start with.
    if (h) h.fill(sea.h);
    if (n) n.fill(128);
    if (w) for (let o = 0; o < HN; o++) { w[o * 2] = sea.w[0]; w[o * 2 + 1] = sea.w[1]; }
    if (c && sea.c.some(Boolean)) for (let o = 0; o < NX * NY; o++) c.set(sea.c, o * 4);
    const ci = Math.floor((I0 + I1) / 2), cj = Math.floor((J0 + J1) / 2);
    win.oi = originFor(ci, I0, I1); win.oj = originFor(cj, J0, J1);
    camTi = Math.floor(ci / TILE); camTj = Math.floor(cj / TILE);
    listQueue();
  }

  return {
    N, nx: NX, ny: NY, fit, lean, tile: TILE, win, h, n, w, c, queue, uploads,
    moveTo, step, texelRects,
    // The texel of global cell (gi, gj), for tests.
    texel: (gi, gj) => (((gj - BJ) & MASK) * NX + ((gi - BI) & MASK)),
    // The cells the shaders may read, in global cells, half-open: [i0, j0, i1, j1]. Korea's fixed
    // window: the extent. Following: the filled blocks round the camera (see validFollow).
    valid: () => (fit ? [Math.max(I0, win.oi), Math.max(J0, win.oj), Math.min(I1, win.oi + NX), Math.min(J1, win.oj + NY)] : validFollow()),
    // The highest ground the window holds (m), for the clipmap's horizon cull; −Infinity when unknown.
    peak: () => { let m = -Infinity; for (const v of filled.values()) if (v > m) m = v; return m === -Infinity ? m : m * scale; },
    pending: () => queue.length,
    blockKind,
    extent: { i0: I0, j0: J0, i1: I1, j1: J1 },
  };
}

// The built-up cover (the cover's blue channel, 0..255) as the CPU reads it: cities.js's and
// citylights.js's block tests (which blocks can hold a building or a light). Cells (i, j) count
// from uNat's origin, as the shaders' natUv() does. Returns null without cover.
// - fit (Korea), no clip window, or a plain RGBA8 grid (coverGrid(data, nx, ny)): the grid
//   indexed directly, as before; callers clamp to [lo, hi] (0 .. nx − 1, the texture's edge
//   clamp), so the results are the old ones to the bit.
// - follow: the toroidal window, texel = global cell & (N − 1). Only the cells the GPU holds
//   (uNatExt: the window ∩ the extent, the intersection of the old and new window while it
//   refills) read their cover; any other cell reads 0. lo, hi are unbounded (the callers
//   don't clamp), and version() changes whenever that valid rectangle does, so the callers
//   drop their cached answers and list their blocks again once new tiles are in.
export function coverGrid(data, nx, ny) {
  return { fit: true, lo: [0, 0], hi: [nx - 1, ny - 1], at: (i, j, ch = 2) => data[(j * nx + i) * 4 + ch], version: () => 0 };   // (ch, v0.6.1: 0 forest, 2 built-up, 3 the airfields' mark)
}

export function coverReader(uniforms) {
  const tex = uniforms.uCover && uniforms.uCover.value;
  const data = uniforms.uHasCover && uniforms.uHasCover.value > 0.5 && tex && tex.image && tex.image.data;
  if (!data) return null;
  const clip = uniforms.__clip;
  const cw = clip && clip.window;
  const sz = uniforms.uNatSize.value;
  if (!cw || cw.fit) return coverGrid(data, sz.x, sz.y);
  const c = cw.c, W = cw.win, e = uniforms.uNatExt.value;
  let ver = 0, ex = e.x, ey = e.y, ez = e.z, ew = e.w;
  return {
    fit: false,
    lo: [-Infinity, -Infinity], hi: [Infinity, Infinity],
    at: (i, j, ch = 2) => (i < ex || i > ez || j < ey || j > ew ? 0 : c[cw.texel(i + W.bi, j + W.bj) * 4 + ch]),
    version() {
      if (e.x !== ex || e.y !== ey || e.z !== ez || e.w !== ew) { ex = e.x; ey = e.y; ez = e.z; ew = e.w; ver++; }
      return ver;
    },
  };
}
