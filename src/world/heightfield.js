// Terrain heights, water and land cover on the CPU, from the baked grids in data/.
// Pure: no DOM, no three.js, so it runs in the page, in workers and in node.
//
//   const hf = await loadHeightfield('data/');      // or an absolute URL in a worker
//   hf.heightAt(x, y)   metres above MSL (never below 0: the sea is the surface at 0)
//   hf.waterAt(x, y)    true over the sea or inland water
//   hf.coverAt(x, y)    { forest, farm, urban }, each 0..1
//
// heightAt does exactly what the terrain shader does (terrain-glsl.js): bilinear on the
// cell-centred national grid, the 30 m patches blended in at their edges, the runways
// flattened to their published elevations, clamped at 0. Missing layers fall back to a
// flat sea-level world, so nothing breaks while the bake is still running.

import { runwayRects } from './runways.js';

export const PATCH_BLEND = 600;      // m: patches fade in over this band inside their edge
export const FLAT_MARGIN_U = 90;     // m beyond each runway end that's flattened
export const FLAT_MARGIN_V = 90;     // m each side of the runway edge that's flattened
export const FLAT_BLEND = 300;       // m over which the flattening fades out

// ------------------------------------------------------------------------- loading

// Fetch a gzipped binary and return its ArrayBuffer, or null if it's missing.
export async function fetchGz(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // Python's http.server sends .gz as application/gzip without Content-Encoding,
    // so the body is still compressed; a server that decodes it would send it plain.
    const enc = res.headers.get('content-encoding');
    if (enc && enc.includes('gzip')) return await res.arrayBuffer();
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  } catch (e) {
    return null;
  }
}

export async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

const resolve = (rel, base) => new URL(rel, base).href;

function baseHref(baseUrl) {
  let b = baseUrl || 'data/';
  if (!b.endsWith('/')) b += '/';
  const here = (typeof location !== 'undefined') ? location.href : 'file:///';
  return new URL(b, here).href;
}

// Load everything the manifest lists. Missing files are skipped (logged, not thrown).
// opts.airports: an already loaded airports list (else they're fetched for the flattening).
export async function loadHeightfield(baseUrl, opts = {}) {
  const base = baseHref(baseUrl);
  const manifest = (await fetchJson(resolve('manifest.json', base))) || {};
  const scale = manifest.heightScale || 0.25;
  const nat = manifest.national || null;
  const layers = { heightScale: scale, national: null, patches: [], coastPatches: [], manifest };

  const jobs = [];
  if (nat) {
    const g = { x0: nat.x0, y0: nat.y0, cell: nat.cell, nx: nat.nx, ny: nat.ny, height: null, water: null, cover: null };
    layers.national = g;
    const n = g.nx * g.ny;
    if (nat.height) jobs.push(fetchGz(resolve(nat.height, base)).then((b) => { if (b && b.byteLength === n * 2) g.height = new Int16Array(b); }));
    if (nat.water) jobs.push(fetchGz(resolve(nat.water, base)).then((b) => { if (b && b.byteLength === n * 2) g.water = new Uint8Array(b); }));
    if (nat.cover) jobs.push(fetchGz(resolve(nat.cover, base)).then((b) => { if (b && b.byteLength === n * 4) g.cover = new Uint8Array(b); }));
  }
  for (const p of manifest.patches || []) {
    const g = { id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, height: null };
    jobs.push(fetchGz(resolve(p.height, base)).then((b) => {
      if (b && b.byteLength === g.nx * g.ny * 2) { g.height = new Int16Array(b); layers.patches.push(g); }
    }));
  }
  for (const p of manifest.coastPatches || []) {
    const g = { id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, coast: null };
    jobs.push(fetchGz(resolve(p.coast, base)).then((b) => {
      if (b && b.byteLength === g.nx * g.ny) { g.coast = new Uint8Array(b); layers.coastPatches.push(g); }
    }));
  }
  let airports = opts.airports || null;
  if (!airports && manifest.airports) {
    jobs.push(Promise.all(manifest.airports.map((f) => fetchJson(resolve(f, base))))
      .then((list) => { airports = list.filter(Boolean); }));
  }
  await Promise.all(jobs);
  // Keep the patch order stable (the GPU atlas uses the same order).
  layers.patches.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  layers.coastPatches.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHeightfield(layers, { airports: airports || [] });
}

// ------------------------------------------------------------------------- sampling

// Bilinear on a cell-centred grid (row 0 south). get(i, j) reads a cell. Clamps at the edges.
function bilinear(g, x, y, get) {
  let fx = (x - g.x0) / g.cell - 0.5, fy = (y - g.y0) / g.cell - 0.5;
  const mx = g.nx - 1, my = g.ny - 1;
  if (fx < 0) fx = 0; else if (fx > mx) fx = mx;
  if (fy < 0) fy = 0; else if (fy > my) fy = my;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i >= mx) i = mx - 1;
  if (j >= my) j = my - 1;
  const tx = fx - i, ty = fy - j;
  const a = get(i, j), b = get(i + 1, j), c = get(i, j + 1), d = get(i + 1, j + 1);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

// Weight (0..1) of a patch at (x, y): 1 inside, fading to 0 over PATCH_BLEND at its edges.
export function patchWeight(p, x, y) {
  const e = Math.min(x - p.x0, p.x0 + p.nx * p.cell - x, y - p.y0, p.y0 + p.ny * p.cell - y) - p.cell;
  if (e <= 0) return 0;
  if (e >= PATCH_BLEND) return 1;
  const t = e / PATCH_BLEND;
  return t * t * (3 - 2 * t);
}

// Runway flattening weight for one rect at local (u along, v across); 0 outside its zone.
export function flatWeight(r, u, v) {
  const du = Math.abs(u) - (r.halfLen + FLAT_MARGIN_U);
  const dv = Math.abs(v) - (r.halfWid + FLAT_MARGIN_V);
  const d = Math.max(du, dv);
  if (d <= 0) return 1;
  if (d >= FLAT_BLEND) return 0;
  const t = 1 - d / FLAT_BLEND;
  return t * t * (3 - 2 * t);
}

// Build the helper from loaded layers (also used by the tests with synthetic grids).
export function createHeightfield(layers, opts = {}) {
  const scale = layers.heightScale || 0.25;
  const nat = layers.national && layers.national.height ? layers.national : null;
  const natW = layers.national && layers.national.water ? layers.national : null;
  const natC = layers.national && layers.national.cover ? layers.national : null;
  const patches = layers.patches || [];
  const coast = layers.coastPatches || [];
  const rects = runwayRects(opts.airports || []);

  const hNat = nat ? (i, j) => nat.height[j * nat.nx + i] : null;
  const seaNat = natW ? (i, j) => natW.water[(j * natW.nx + i) * 2] : null;
  const inlandNat = natW ? (i, j) => natW.water[(j * natW.nx + i) * 2 + 1] : null;
  for (const p of patches) p._get = (i, j) => p.height[j * p.nx + i];
  for (const p of coast) p._get = (i, j) => p.coast[j * p.nx + i];

  // Raw data height (may be negative over the sea), before flattening and clamping.
  function rawHeight(x, y) {
    let h = nat ? bilinear(nat, x, y, hNat) * scale : 0;
    for (let k = 0; k < patches.length; k++) {
      const p = patches[k];
      if (x < p.x0 || y < p.y0 || x > p.x0 + p.nx * p.cell || y > p.y0 + p.ny * p.cell) continue;
      const w = patchWeight(p, x, y);
      if (w <= 0) continue;
      const hp = bilinear(p, x, y, p._get) * scale;
      h += (hp - h) * w;
    }
    return h;
  }

  function heightAt(x, y) {
    let h = rawHeight(x, y);
    for (let k = 0; k < rects.length; k++) {
      const r = rects[k];
      const dx = x - r.cx, dy = y - r.cy;
      if (dx * dx + dy * dy > r.reach2) continue;
      const u = dx * r.dx + dy * r.dy, v = -dx * r.dy + dy * r.dx;
      const w = flatWeight(r, u, v);
      if (w <= 0) continue;
      let t = (u + r.halfLen) / (2 * r.halfLen);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const e = r.e0 + (r.e1 - r.e0) * t;
      h += (e - h) * w;
    }
    return h > 0 ? h : 0;
  }

  // Signed distance (m, + on land) to the sea coastline; the 10 m patches win where present.
  function seaDistance(x, y) {
    for (let k = 0; k < coast.length; k++) {
      const p = coast[k];
      if (x < p.x0 + p.cell || y < p.y0 + p.cell || x > p.x0 + (p.nx - 1) * p.cell || y > p.y0 + (p.ny - 1) * p.cell) continue;
      const d = (bilinear(p, x, y, p._get) - 128) * 2;
      if (Math.abs(d) < 250) return d;
    }
    if (natW) return (bilinear(natW, x, y, seaNat) - 128) * 20;
    // No water layer: below 0 is sea (the bake pushes the sea under 0); no data at all is sea.
    return nat ? rawHeight(x, y) * 20 : -1000;
  }

  function inlandDistance(x, y) {
    if (!natW) return 2560;
    return (bilinear(natW, x, y, inlandNat) - 128) * 20;
  }

  function waterAt(x, y) {
    return seaDistance(x, y) < 0 || inlandDistance(x, y) < 0;
  }

  function coverAt(x, y, out = {}) {
    if (!natC) { out.forest = 0; out.farm = 0; out.urban = 0; return out; }
    const c = natC.cover, nx = natC.nx;
    out.forest = bilinear(natC, x, y, (i, j) => c[(j * nx + i) * 4]) / 255;
    out.farm = bilinear(natC, x, y, (i, j) => c[(j * nx + i) * 4 + 1]) / 255;
    out.urban = bilinear(natC, x, y, (i, j) => c[(j * nx + i) * 4 + 2]) / 255;
    return out;
  }

  return {
    heightAt, waterAt, coverAt, seaDistance, inlandDistance, rawHeight,
    layers, runwayRects: rects,
    info: { height: !!nat, water: !!natW, cover: !!natC, patches: patches.length, coastPatches: coast.length },
  };
}
