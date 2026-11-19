// The local rules' data by map position (V060.md, Part 5 steps 1 and 4): WMM2025's magnetic
// variation and the country, from tools/bake_wmm.py and tools/bake_country.py. Pure: no DOM,
// so it runs in workers and node too. Synchronous once loaded.
//
//   const geo = await loadGeoRules('data/');          // fetches the four files
//   const geo = createGeoRules({ magvar, country });  // or from data already in hand
//   geo.wmmVar(x, y)    -> degrees, east positive (WMM2025 at epoch 2026.0, sea level), bilinear
//   geo.countryAt(x, y) -> 'KR' | 'KP' | 'JP' | 'CN' | 'other' (the sea takes its nearest land's)
//   geo.seaAt(x, y)     -> true where the cell is sea
//   geo.krBlend(x, y)   -> 0 inside south-korea.poly (exactly), rising to 1 about 50 km outside it
//   geo.magVarAt(x, y, plane) -> the game's variation: `plane` (frame.js's plane, passed in) where
//                          krBlend is 0, the same double; WMM2025 where it is 1; blended between
//
// krmask (optional; data/krmask.json + krmask.u8.gz from tools/bake_krmask.py, whose header says
// how it is encoded): without it krBlend is 1 everywhere, so magVarAt is WMM2025 everywhere.
//
// magvar / country: { header, values }, the header being data/magvar.json or data/country.json
// and the values the gunzipped grid (an Int16Array / Uint8Array, or their ArrayBuffer). Both
// grids are cell-centred in the map frame (src/world/frame.js), row 0 the south row. Outside a
// grid the nearest edge cell answers. This does not replace frame.js's magVar(): South Korea
// keeps its plane exactly (V060.md, "Magnetic variation"), and the blend lives there.

export const COUNTRY_NAMES = ['sea', 'KR', 'KP', 'JP', 'CN', 'other'];
const SEA_BIT = 8;

function grid(part, Typed) {
  const h = part.header;
  let v = part.values;
  if (v instanceof ArrayBuffer) v = new Typed(v);
  else if (ArrayBuffer.isView(v) && !(v instanceof Typed)) v = new Typed(v.buffer, v.byteOffset, v.byteLength / Typed.BYTES_PER_ELEMENT);
  if (v.length !== h.nx * h.ny) throw new Error(`geo-rules: ${h.file} has ${v.length} cells, not ${h.nx} x ${h.ny}`);
  return { x0: h.x0, y0: h.y0, cell: h.cell, nx: h.nx, ny: h.ny, scale: h.scale ?? 1, v };
}

export function createGeoRules({ magvar, country, krmask = null }) {
  const M = grid(magvar, Int16Array);
  const C = grid(country, Uint8Array);
  const K = krmask ? grid(krmask, Uint8Array) : null;
  const mMaxX = M.nx - 1, mMaxY = M.ny - 1;
  const kUnit = K ? krmask.header.unitM : 0, kBand = K ? krmask.header.bandM : 1;
  const kX1 = K ? K.x0 + K.nx * K.cell : 0, kY1 = K ? K.y0 + K.ny * K.cell : 0;

  // The blend weight: smoothstep of the baked distance beyond the margin over the band. The
  // four taps of a point inside the poly all store 0, so it returns 0 exactly there.
  function krBlend(x, y) {
    if (K === null || x < K.x0 || y < K.y0 || x >= kX1 || y >= kY1) return 1;
    let fx = (x - K.x0) / K.cell - 0.5, fy = (y - K.y0) / K.cell - 0.5;
    const maxX = K.nx - 1, maxY = K.ny - 1;
    fx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
    fy = fy < 0 ? 0 : fy > maxY ? maxY : fy;
    let i = Math.floor(fx), j = Math.floor(fy);
    if (i >= maxX) i = maxX - 1;
    if (j >= maxY) j = maxY - 1;
    const u = fx - i, w = fy - j, k = j * K.nx + i, v = K.v;
    const q00 = v[k], q10 = v[k + 1], q01 = v[k + K.nx], q11 = v[k + K.nx + 1];
    if ((q00 | q10 | q01 | q11) === 0) return 0;
    const a = q00 + (q10 - q00) * u, b = q01 + (q11 - q01) * u;
    let t = (a + (b - a) * w) * kUnit / kBand;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  // V060.md, "Magnetic variation": the plane exactly where the weight is 0, WMM where it is 1.
  function magVarAt(x, y, plane) {
    const w = krBlend(x, y);
    if (w === 0) return plane;
    const m = wmmVar(x, y);
    return w === 1 ? m : plane + (m - plane) * w;
  }

  function wmmVar(x, y) {
    let fx = (x - M.x0) / M.cell - 0.5, fy = (y - M.y0) / M.cell - 0.5;
    fx = fx < 0 ? 0 : fx > mMaxX ? mMaxX : fx;
    fy = fy < 0 ? 0 : fy > mMaxY ? mMaxY : fy;
    let i = Math.floor(fx), j = Math.floor(fy);
    if (i >= mMaxX) i = mMaxX - 1;
    if (j >= mMaxY) j = mMaxY - 1;
    const u = fx - i, w = fy - j, k = j * M.nx + i, v = M.v;
    const a = v[k] + (v[k + 1] - v[k]) * u;
    const b = v[k + M.nx] + (v[k + M.nx + 1] - v[k + M.nx]) * u;
    return (a + (b - a) * w) * M.scale;
  }

  function cellOf(x, y) {
    let i = Math.floor((x - C.x0) / C.cell), j = Math.floor((y - C.y0) / C.cell);
    i = i < 0 ? 0 : i >= C.nx ? C.nx - 1 : i;
    j = j < 0 ? 0 : j >= C.ny ? C.ny - 1 : j;
    return C.v[j * C.nx + i];
  }

  return {
    wmmVar,
    countryAt: (x, y) => COUNTRY_NAMES[cellOf(x, y) & 7] || 'other',
    seaAt: (x, y) => (cellOf(x, y) & SEA_BIT) !== 0,
    krBlend,
    magVarAt,
    hasKrMask: K !== null,
    magvarHeader: magvar.header,
    countryHeader: country.header,
  };
}

async function gunzip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geo-rules: ${url}: HTTP ${res.status}`);
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

// src: a base URL ending in '/' (where magvar.json, country.json, krmask.json and their grids
// live), or the data itself ({ magvar, country, krmask } as createGeoRules takes it).
export async function loadGeoRules(src) {
  if (src && typeof src === 'object' && src.magvar) return createGeoRules(src);
  const base = String(src || 'data/');
  const [mh, ch, kh] = await Promise.all(['magvar.json', 'country.json', 'krmask.json'].map(async (f) => {
    const res = await fetch(base + f);
    if (!res.ok) throw new Error(`geo-rules: ${base + f}: HTTP ${res.status}`);
    return res.json();
  }));
  const [mv, cv, kv] = await Promise.all([gunzip(base + mh.file), gunzip(base + ch.file), gunzip(base + kh.file)]);
  return createGeoRules({ magvar: { header: mh, values: mv }, country: { header: ch, values: cv }, krmask: { header: kh, values: kv } });
}
