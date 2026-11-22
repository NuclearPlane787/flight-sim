// v0.7.4 (item 11, Shane's idea: "some kind of colouring on the map that shows elevation, maybe contour lines, or subtle
// changing colours"; the Cowork session's choice): the path map's colour by height. A few steps of tint from low ground
// (the land's own dark green) to high ground (a deeper, warmer tone), a soft hillshade so ridges and valleys read, land
// below sea level (Europe's polders) a pale tone of its own, and a small legend in feet. No contour lines.
//
// From data/map-relief.u8.gz (tools/bake_map_relief.py: the 1 km tiles at 2 km, one byte a cell), turned into one
// image once when it loads (reliefPixels(), pure), drawn by map.js as a scaled part of that image each frame.
//
// RELIEF_BANDS             [{ ft, rgb }] the steps, from `ft` feet up (the legend's)
// POLDER_RGB               land below sea level
// heightOf(v, hmax)        a byte to metres (null for the sea, -1 for land below sea level)
// bandOf(m)                the band index for a height in metres
// reliefPixels(head, u8)   RGBA (north row first) for the image: alpha 0 on the sea
// loadRelief(base)         -> Promise<{ canvas, x0, y0, cell, nx, ny, polders } | null> (null when the file is missing)

export const FT = 3.28084;
export const RELIEF_BANDS = [
  { ft: 0, rgb: [28, 42, 34] },          // the land's own fill (map.js '#1c2a22')
  { ft: 500, rgb: [33, 46, 35] },
  { ft: 1500, rgb: [40, 50, 36] },
  { ft: 3000, rgb: [50, 54, 38] },
  { ft: 5000, rgb: [61, 59, 43] },
  { ft: 8000, rgb: [74, 67, 54] },
  { ft: 12000, rgb: [92, 86, 80] },
];
export const POLDER_RGB = [46, 62, 60];

export function heightOf(v, hmax = 5000) {
  if (v === 0) return null;
  if (v === 1) return -1;
  const t = (v - 2) / 253;
  return hmax * t * t;
}
export function bandOf(m) {
  const ft = m * FT;
  let b = 0;
  for (let i = 0; i < RELIEF_BANDS.length; i++) if (ft >= RELIEF_BANDS[i].ft) b = i;
  return b;
}

// The hillshade: light from the north-west, 45 degrees up, heights exaggerated (a 2 km cell's slopes are gentle), as a
// factor about 1 on flat ground, between SHADE_LO and SHADE_HI.
const SUN_AZ = 315 * Math.PI / 180, SUN_ALT = 45 * Math.PI / 180, Z = 4, SHADE_LO = 0.72, SHADE_HI = 1.3;
export function reliefPixels(head, u8) {
  const { nx, ny, cell } = head, hmax = head.hmax || 5000;
  // (second pass) a second plane, when there is one: how much of the tint and the shade shows (0..255), faded to the
  // plain land colour where the heights end inside the map (East Asia's 1 km data's edge)
  const wt = u8.length >= 2 * nx * ny ? u8.subarray(nx * ny, 2 * nx * ny) : null;
  const B0 = RELIEF_BANDS[0].rgb;
  const H = new Float32Array(nx * ny);
  const lut = new Float32Array(256);
  for (let v = 2; v < 256; v++) lut[v] = heightOf(v, hmax);
  for (let i = 0; i < nx * ny; i++) H[i] = lut[u8[i]];
  const out = new Uint8ClampedArray(nx * ny * 4);
  const lx = Math.sin(SUN_AZ) * Math.cos(SUN_ALT), ly = Math.cos(SUN_AZ) * Math.cos(SUN_ALT), lz = Math.sin(SUN_ALT);
  const bandLut = new Uint8Array(256);
  for (let v = 2; v < 256; v++) bandLut[v] = bandOf(lut[v]);
  for (let j = 0; j < ny; j++) {
    const jn = j < ny - 1 ? j + 1 : j, js = j > 0 ? j - 1 : j;
    const row = (ny - 1 - j) * nx;          // the image's row 0 is the north
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, v = u8[k], o = (row + i) * 4;
      if (v === 0) continue;                 // the sea: transparent
      if (v === 1) { out[o] = POLDER_RGB[0]; out[o + 1] = POLDER_RGB[1]; out[o + 2] = POLDER_RGB[2]; out[o + 3] = 255; continue; }
      const ie = i < nx - 1 ? i + 1 : i, iw = i > 0 ? i - 1 : i;
      const dzdx = (H[j * nx + ie] - H[j * nx + iw]) * Z / ((ie - iw || 1) * cell);
      const dzdy = (H[jn * nx + i] - H[js * nx + i]) * Z / ((jn - js || 1) * cell);
      // the normal (-dzdx, -dzdy, 1) normalised, against the light; divided by the flat ground's lz
      const n = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      let s = ((-dzdx * lx - dzdy * ly + lz) * n) / lz;
      s = s < SHADE_LO ? SHADE_LO : s > SHADE_HI ? SHADE_HI : s;
      const c = RELIEF_BANDS[bandLut[v]].rgb;
      if (wt && wt[k] < 255) {
        const w = wt[k] / 255;
        out[o] = B0[0] + (c[0] * s - B0[0]) * w; out[o + 1] = B0[1] + (c[1] * s - B0[1]) * w; out[o + 2] = B0[2] + (c[2] * s - B0[2]) * w;
      } else { out[o] = c[0] * s; out[o + 1] = c[1] * s; out[o + 2] = c[2] * s; }
      out[o + 3] = 255;
    }
  }
  return out;
}

async function gunzip(res) {
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadRelief(base) {
  try {
    const hr = await fetch(base + 'map-relief.json');
    if (!hr.ok) return null;
    const head = await hr.json();
    const br = await fetch(base + (head.file || 'map-relief.u8.gz'));
    if (!br.ok) return null;
    const u8 = await gunzip(br);
    if (u8.length !== head.nx * head.ny * (head.planes || 1)) return null;
    const px = reliefPixels(head, u8);
    const canvas = document.createElement('canvas');
    canvas.width = head.nx; canvas.height = head.ny;
    canvas.getContext('2d').putImageData(new ImageData(px, head.nx, head.ny), 0, 0);
    let polders = false;
    for (let i = 0; i < head.nx * head.ny; i++) if (u8[i] === 1) { polders = true; break; }
    return { canvas, x0: head.x0, y0: head.y0, cell: head.cell, nx: head.nx, ny: head.ny, polders };
  } catch (e) {
    return null;
  }
}
