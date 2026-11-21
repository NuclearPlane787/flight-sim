// The terrain in tiles (v0.6.0): loads, decodes and caches the 128 km tiles of data/terrain/
// and samples them exactly as heightfield.js sampled Korea's one national grid.
// Pure: no DOM, no three.js, so it runs in the page, in the prediction worker and in node.
//
//   const store = createTileStore(manifest.tilesRegion, { base: 'data/', layers: ['h', 'w', 'c'] });
//   await store.whenReady(x, y, radius);   // the tiles within radius (m) of (x, y) resident
//   store.height(x, y)                     // bilinear, heightScale units (as the old grid's)
//   store.water(x, y, ch)                  // ch 0: sea, 1: inland distance bytes
//   store.cover(x, y, ch)                  // ch 0 forest, 1 farm, 2 built-up (0..255)
//
// The lattice (briefs/V0-6-0.md, "Bit-exact sampling"): l0 cells of 250 m, cell-centred, the origin at
// Korea's south-west corner, extended both ways. The cell index is computed as the old loader
// computed it, fx = (x − x0) / cell − 0.5, clamped only at the region's outer edge; the tile
// and the cell within it by integer arithmetic; the same bilinear expression. Each tile file
// carries a border of its neighbours' cells, so a sample's four cells are always in one tile.
// Tiles that aren't listed are open sea (the manifest's `sea` values). A sample on a tile
// that isn't resident reads open sea and counts a miss: the callers wait with whenReady()
// so that the sim never sees one (store.misses stays 0, which the tests check).

const DEFAULT_MAX_TILES = 96;
const RETRY_MS_DEFAULT = 500;   // (to at most 8 s) a failed tile's next tries: 0.5 s, 1 s, 2 s … 8 s

export function createTileStore(spec, opts = {}) {
  if (!spec || !spec.levels || !spec.levels.length) throw new Error('tilestore: no tiles in the manifest');
  const X0 = spec.x0, Y0 = spec.y0;
  const sea = spec.sea || { h: -160, w: [0, 255], c: [0, 0, 0, 0] };
  const wanted = new Set(opts.layers || ['h', 'w', 'c']);
  let maxTiles = opts.maxTiles || DEFAULT_MAX_TILES;
  const read = opts.readGz || defaultReader(opts.base || 'data/');
  const RETRY_MS = opts.retryMs ?? RETRY_MS_DEFAULT, RETRY_MAX_MS = Math.max(RETRY_MS, opts.retryMaxMs ?? 8000);
  let onTile = opts.onTile || null;     // (tile) => void: edits a freshly decoded l0 tile (the airport mask)

  // A level: its cells, tiles and extent (half-open, in its own cells), on the shared origin.
  function makeLevel(L, ext, pre) {
    const lv = { L, pre, TILE: L.tile, B: L.border, S: L.tile + 2 * L.border, CELL: L.cell,
      I0: ext.i0, J0: ext.j0, I1: ext.i1, J1: ext.j1, listed: new Set(L.tiles),
      // The tiles baked at this level (with a file or open sea); the others in the extent read the
      // next level (the region's l0 rectangle has unbaked corners). Absent: every tile is baked.
      covered: L.covered ? new Set(L.covered) : null };
    lv.mx0 = X0 + lv.I0 * lv.CELL; lv.mx1 = X0 + lv.I1 * lv.CELL;   // the extent in map metres
    lv.my0 = Y0 + lv.J0 * lv.CELL; lv.my1 = Y0 + lv.J1 * lv.CELL;
    return lv;
  }
  const lv0 = makeLevel(spec.levels[0], spec.extent, '');
  // The 1 km level is read where there is no 250 m data: only when its extent reaches beyond
  // the 250 m one (the region's margin). Over Korea alone it never is.
  const L1 = spec.levels[1];
  const lv1 = L1 && L1.extent && (X0 + L1.extent.i0 * L1.cell < lv0.mx0 || X0 + L1.extent.i1 * L1.cell > lv0.mx1 ||
    Y0 + L1.extent.j0 * L1.cell < lv0.my0 || Y0 + L1.extent.j1 * L1.cell > lv0.my1) ? makeLevel(L1, L1.extent, 'l1:') : null;
  const TILE = lv0.TILE, B = lv0.B, S = lv0.S, CELL = lv0.CELL;
  const I0 = lv0.I0, J0 = lv0.J0, I1 = lv0.I1, J1 = lv0.J1;
  const ext = spec.extent;

  const tiles = new Map();              // key ('ti_tj' for l0, 'l1:ti_tj') → { lv, ti, tj, state, h, w, c, promise, stamp }
  let clock = 0;
  const pins = new Map();               // who → Set of keys it asked for last
  const store = { misses: 0, loads: 0, evictions: 0, failures: 0 };

  const tileRange = (lv, lo, hi, n0, n1) => {
    // Cells lo..hi (clamped to the extent, since a sample outside clamps to the edge cells).
    const a = Math.max(n0, Math.min(n1 - 1, lo)), b = Math.max(n0, Math.min(n1 - 1, hi));
    return [Math.floor(a / lv.TILE), Math.floor(b / lv.TILE)];
  };

  function load(lv, ti, tj) {
    const k = lv.pre + ti + '_' + tj, name = ti + '_' + tj;
    let t = tiles.get(k);
    if (t) { t.stamp = ++clock; return t.promise; }
    t = { lv, ti, tj, state: 'loading', h: null, w: null, c: null, promise: null, stamp: ++clock };
    tiles.set(k, t);
    if (lv.covered && !lv.covered.has(name)) { t.state = 'l1'; t.promise = Promise.resolve(t); return t.promise; }
    if (!lv.listed.has(name)) { t.state = 'sea'; t.promise = Promise.resolve(t); return t.promise; }
    const base = `${lv.L.dir}${name}.`, S2 = lv.S * lv.S;
    // A listed tile's files must all arrive. One that fails (a dropped request, a short read) is
    // asked for again, a little later each time, and the tile stays 'loading' until it is whole:
    // isReady() is false and whenReady() waits, so the loader holds the sim's steps. It never
    // becomes 'ready' with a layer missing: that read as open sea on one side (the page or the
    // worker) and as land on the other.
    const attempt = () => {
      const jobs = [];
      if (wanted.has('h') && !t.h) jobs.push(read(base + 'h.i16.gz').then((b) => { if (b && b.byteLength === S2 * 2) t.h = new Int16Array(b); }, () => {}));
      if (wanted.has('w') && !t.w) jobs.push(read(base + 'w.rg8.gz').then((b) => { if (b && b.byteLength === S2 * 2) t.w = new Uint8Array(b); }, () => {}));
      if (wanted.has('c') && !t.c) jobs.push(read(base + 'c.rgba8.gz').then((b) => { if (b && b.byteLength === S2 * 4) t.c = new Uint8Array(b); }, () => {}));
      return Promise.all(jobs).then(() => {
        if (tiles.get(k) !== t) return t;        // evicted while loading
        const whole = (!wanted.has('h') || t.h) && (!wanted.has('w') || t.w) && (!wanted.has('c') || t.c);
        if (!whole) {
          store.failures++;
          t.tries = (t.tries || 0) + 1;
          const wait = Math.min(RETRY_MS * 2 ** (t.tries - 1), RETRY_MAX_MS);
          return new Promise((res) => { const id = setTimeout(res, wait); if (id && id.unref) id.unref(); }).then(() => (tiles.get(k) === t ? attempt() : t));
        }
        t.state = 'ready';
        store.loads++;
        if (onTile && t.c && lv === lv0) onTile(tileGrid(t));
        trim();
        return t;
      });
    };
    t.promise = attempt();
    return t.promise;
  }

  // A tile as a plain grid (the shape heightfield.js's grids and airport-mask.js take).
  function tileGrid(t) {
    const lv = t.lv;
    return { x0: X0 + (t.ti * lv.TILE - lv.B) * lv.CELL, y0: Y0 + (t.tj * lv.TILE - lv.B) * lv.CELL, cell: lv.CELL, nx: lv.S, ny: lv.S,
      height: t.h, water: t.w, cover: t.c, key: lv.pre + t.ti + '_' + t.tj };
  }

  function levelKeys(lv, x, y, r, out) {
    const [ta, tb] = tileRange(lv, Math.floor((x - r - X0) / lv.CELL) - 1, Math.floor((x + r - X0) / lv.CELL) + 1, lv.I0, lv.I1);
    const [ua, ub] = tileRange(lv, Math.floor((y - r - Y0) / lv.CELL) - 1, Math.floor((y + r - Y0) / lv.CELL) + 1, lv.J0, lv.J1);
    for (let tj = ua; tj <= ub; tj++) for (let ti = ta; ti <= tb; ti++) out.push([lv, ti, tj]);
  }
  // Outside the 250 m extent (with a cell's margin)?
  const beyond0 = (x, y, r) => x - r < lv0.mx0 + CELL || x + r > lv0.mx1 - CELL || y - r < lv0.my0 + CELL || y + r > lv0.my1 - CELL;
  function keysAround(x, y, r) {
    const out = [];
    levelKeys(lv0, x, y, r, out);
    if (lv1 && (beyond0(x, y, r) || (lv0.covered && out.some(([, a, b]) => !lv0.covered.has(a + '_' + b))))) levelKeys(lv1, x, y, r, out);
    return out;
  }
  const keyOf = (lv, ti, tj) => lv.pre + ti + '_' + tj;

  // Resolves once every tile within r of (x, y) is resident. `who` pins them (the aircraft,
  // the camera, the departure, the arrival): pinned tiles are never evicted.
  function whenReady(x, y, r = 0, who = null) {
    const list = keysAround(x, y, r);
    if (who) pins.set(who, new Set(list.map(([lv, a, b]) => keyOf(lv, a, b))));
    return Promise.all(list.map(([lv, a, b]) => load(lv, a, b))).then(() => undefined);
  }

  function isReady(x, y, r = 0) {
    for (const [lv, a, b] of keysAround(x, y, r)) {
      const t = tiles.get(keyOf(lv, a, b));
      if (!t || t.state === 'loading') return false;
    }
    return true;
  }

  // Every listed l0 tile in the extent (Korea's 35 today: the same data the old loader read whole).
  function loadAll() {
    const [ta, tb] = tileRange(lv0, I0, I1 - 1, I0, I1), [ua, ub] = tileRange(lv0, J0, J1 - 1, J0, J1);
    const jobs = [];
    for (let tj = ua; tj <= ub; tj++) for (let ti = ta; ti <= tb; ti++) jobs.push(load(lv0, ti, tj));
    return Promise.all(jobs).then(() => undefined);
  }

  function pinned(k) {
    for (const s of pins.values()) if (s.has(k)) return true;
    return false;
  }

  // Release the least recently asked-for tiles beyond maxTiles, never a pinned one.
  function trim() {
    let n = 0;
    for (const t of tiles.values()) if (t.state === 'ready') n++;
    if (n <= maxTiles) return;
    const order = [...tiles.entries()].filter(([k, t]) => t.state === 'ready' && !pinned(k)).sort((p, q) => p[1].stamp - q[1].stamp);
    for (const [k] of order) {
      if (n <= maxTiles) break;
      tiles.delete(k); n--; store.evictions++;
    }
  }

  // ---------------------------------------------------------------- sampling

  // Bilinear in a level's cells, the old heightfield.js's arithmetic to the bit on l0.
  // layer: 'h' | 'w' | 'c', stride and ch: the interleaving. seaV: the open sea's value.
  function bilinLv(lv, x, y, layer, stride, ch, seaV) {
    let fx = (x - X0) / lv.CELL - 0.5, fy = (y - Y0) / lv.CELL - 0.5;
    const mx = lv.I1 - 1, my = lv.J1 - 1;
    if (fx < lv.I0) fx = lv.I0; else if (fx > mx) fx = mx;
    if (fy < lv.J0) fy = lv.J0; else if (fy > my) fy = my;
    let i = Math.floor(fx), j = Math.floor(fy);
    if (i >= mx) i = mx - 1;
    if (j >= my) j = my - 1;
    const tx = fx - i, ty = fy - j;
    const T = lv.TILE, ti = Math.floor(i / T), tj = Math.floor(j / T);
    const t = tiles.get(lv.pre + ti + '_' + tj);
    if (t && t.state === 'l1' && lv1) return bilinLv(lv1, x, y, layer, stride, ch, seaV);   // an unbaked l0 tile
    let a, b, c, d;
    const arr = t && t[layer];
    if (arr) {
      const li = i - ti * T + lv.B, lj = j - tj * T + lv.B;
      const k = (lj * lv.S + li) * stride + ch, kr = lv.S * stride;
      a = arr[k]; b = arr[k + stride]; c = arr[k + kr]; d = arr[k + kr + stride];
    } else {
      if (!t || t.state !== 'sea') store.misses++;
      a = b = c = d = seaV;
    }
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
  // l0 inside its extent; the 1 km level beyond it (when there is one).
  function bilin(x, y, layer, stride, ch, seaV) {
    if (lv1 && (x < lv0.mx0 || x > lv0.mx1 || y < lv0.my0 || y > lv0.my1)) return bilinLv(lv1, x, y, layer, stride, ch, seaV);
    return bilinLv(lv0, x, y, layer, stride, ch, seaV);
  }

  // The extent as one grid, from the resident l0 tiles (open sea where a tile has no file): the
  // GPU's textures read this until the clip window (briefs/V0-6-0.md Part 1, step 3) replaces it. Over
  // Korea it is the old national grid, cell for cell.
  function assemble() {
    const nx = I1 - I0, ny = J1 - J0;
    const g = { x0: X0 + I0 * CELL, y0: Y0 + J0 * CELL, cell: CELL, nx, ny, height: null, water: null, cover: null };
    if (wanted.has('h')) g.height = new Int16Array(nx * ny).fill(sea.h);
    if (wanted.has('w')) { g.water = new Uint8Array(nx * ny * 2); for (let k = 0; k < nx * ny; k++) { g.water[k * 2] = sea.w[0]; g.water[k * 2 + 1] = sea.w[1]; } }
    if (wanted.has('c')) { g.cover = new Uint8Array(nx * ny * 4); if (sea.c.some(Boolean)) for (let k = 0; k < nx * ny; k++) g.cover.set(sea.c, k * 4); }
    for (const t of tiles.values()) {
      if (t.state !== 'ready' || t.lv !== lv0) continue;
      const ci0 = Math.max(I0, t.ti * TILE), ci1 = Math.min(I1, (t.ti + 1) * TILE);
      const cj0 = Math.max(J0, t.tj * TILE), cj1 = Math.min(J1, (t.tj + 1) * TILE);
      if (ci1 <= ci0 || cj1 <= cj0) continue;
      const w = ci1 - ci0;
      for (let j = cj0; j < cj1; j++) {
        const src = (j - t.tj * TILE + B) * S + (ci0 - t.ti * TILE + B), dst = (j - J0) * nx + (ci0 - I0);
        if (g.height && t.h) g.height.set(t.h.subarray(src, src + w), dst);
        if (g.water && t.w) g.water.set(t.w.subarray(src * 2, (src + w) * 2), dst * 2);
        if (g.cover && t.c) g.cover.set(t.c.subarray(src * 4, (src + w) * 4), dst * 4);
      }
    }
    return g;
  }

  // For the GPU's clip window (clipwindow.js): a tile by its key ('ti_tj', or 'l1:ti_tj' at the
  // 1 km level). peek(): 'ready' | 'loading' | 'sea' | 'l1' | undefined, without touching the
  // cache's order. request(): start loading it, unpinned (the window fills from it once, then
  // the cache may drop it again).
  const parseKey = (key) => {
    const one = key.startsWith('l1:'), [a, b2] = (one ? key.slice(3) : key).split('_').map(Number);
    return [one ? lv1 : lv0, a, b2];
  };
  store.peek = (key) => { const t = tiles.get(key); return t ? t.state : undefined; };
  store.request = (key) => { const [lv, a, b2] = parseKey(key); if (lv) load(lv, a, b2); };
  store.assemble = assemble;
  // Set the edit for tiles decoded from now on; with `now`, apply it to the resident tiles too.
  store.setOnTile = (fn, now = true) => {
    onTile = fn;
    if (now && fn) for (const t of tiles.values()) if (t.state === 'ready' && t.c && t.lv === lv0) fn(tileGrid(t));
  };
  store.height = (x, y) => bilin(x, y, 'h', 1, 0, sea.h);
  store.water = (x, y, ch) => bilin(x, y, 'w', 2, ch, sea.w[ch]);
  store.cover = (x, y, ch) => bilin(x, y, 'c', 4, ch, sea.c[ch]);
  store.whenReady = whenReady;
  store.isReady = isReady;
  store.loadAll = loadAll;
  store.release = (who) => { pins.delete(who); trim(); };
  // v0.6.4: raise the cap (never lower it): heightfield.js keeps room for the flight beside the airports' pinned tiles.
  store.setMaxTiles = (n) => { if (Number.isFinite(n) && n > maxTiles) maxTiles = Math.floor(n); return maxTiles; };
  store.maxTiles = () => maxTiles;
  store.pinnedKeys = () => { const out = new Set(); for (const set of pins.values()) for (const k of set) out.add(k); return [...out]; };
  store.resident = () => [...tiles.entries()].filter(([, t]) => t.state === 'ready').map(([k]) => k);
  store.tileGrid = (k) => { const t = tiles.get(k); return t && t.state === 'ready' ? tileGrid(t) : null; };
  store.has = { h: wanted.has('h'), w: wanted.has('w'), c: wanted.has('c') };
  store.spec = spec;
  store.lattice = { x0: X0, y0: Y0, cell: CELL, tile: TILE, border: B, extent: ext, l1: lv1 ? { cell: lv1.CELL, extent: lv1.L.extent } : null };
  return store;
}

// Reads a gzipped file relative to base: fetch() in the browser and the worker (the .gz
// handling as heightfield.js's fetchGz), the disk in node (file: URLs).
function defaultReader(base) {
  let b = base;
  if (!b.endsWith('/')) b += '/';
  const here = (typeof location !== 'undefined') ? location.href : 'file:///';
  const href = new URL(b, here).href;
  if (href.startsWith('file:')) {
    let mods = null;
    return async (rel) => {
      try {
        mods = mods || await Promise.all([import('node:fs/promises'), import('node:zlib')]);
        const [fs, zlib] = mods;
        const buf = zlib.gunzipSync(await fs.readFile(new URL(rel, href)));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch (e) { return null; }
    };
  }
  return async (rel) => {
    try {
      const res = await fetch(new URL(rel, href).href);
      if (!res.ok) return null;
      const enc = res.headers.get('content-encoding');
      if (enc && enc.includes('gzip')) return await res.arrayBuffer();
      const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).arrayBuffer();
    } catch (e) { return null; }
  };
}
