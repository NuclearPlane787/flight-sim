// The fine land cover round the camera (v0.6.0 Part 7, behind GROUND_ON): ESA WorldCover's
// classes at 31.25 m (data/terrain/fine/, tools/bake_region_fine.py), which drive the near
// ground: where the woods, the fields, the villages and the water really are. The 250 m cover
// (the clip window) takes over beyond it.
//
// The data: global fine pixel (P, Q) covers x in [x0 + P * 31.25, + 31.25), the same for y
// (x0 = y0 = -400 km, the tiles' origin; 8 fine pixels a 250 m cell). Sub-tiles of 1024 x 1024
// pixels (32 km), one byte a pixel, row 0 the south row: `<ti>_<tj>_<a>_<b>.u8.gz` holds sub-tile
// (si, sj) = (ti * 4 + a, tj * 4 + b). fine.json lists the ones with a file (`files`) and the
// ones of a single class (`uniform`: open sea); any other is outside the fine box.
// Classes: 0 water, 1 tree, 2 shrub, 3 grass, 4 crop, 5 built-up, 6 bare or snow, 7 wetland.
//
// The window: one R8 texture of 4096 x 4096 pixels (128 km), toroidal (pixel (P, Q) at texel
// (P & 4095, Q & 4095), RepeatWrapping, read with texelFetch), 4 x 4 sub-tiles following the
// camera. A texel holds the class + 1; 0 means no data (not loaded yet, or outside the box).
// createFineWindow() is the pure part (which sub-tiles, in what order, what is valid), for node;
// createFineCover() adds the fetches, the texture and the uniforms.

import * as THREE from '../../vendor/three.module.js';

export const FINE_PX = 31.25, FINE_SUB = 1024, FINE_N = 4096;
export const FINE_CLASSES = ['water', 'tree', 'shrub', 'grass', 'crop', 'built', 'bare', 'wetland'];
const PER = FINE_N / FINE_SUB;          // sub-tiles a side of the window (4)

// glsl.js's ihash(c, s), bit for bit (a 24-bit integer over 2^24, exact in a float): what lets
// the CPU list the cells whose house or tree the shaders will keep (rural.js, detail.js; v0.6.1).
export function ihash(cx, cy, s) {
  let h = (Math.imul(cx, 374761393) + Math.imul(cy, 668265263) + Math.imul(s, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h & 0xffffff) / 16777216;
}

// FINE_GLSL's glassPatch() on the CPU: px, py the continuous fine pixel from the lattice's origin.
export function glassPatch(px, py) {
  const gx = px / 8, gy = py / 8, cx = Math.floor(gx), cy = Math.floor(gy);
  const fx = gx - cx, fy = gy - cy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = ihash(cx, cy, 97), b = ihash(cx + 1, cy, 97), c = ihash(cx, cy + 1, 97), d = ihash(cx + 1, cy + 1, 97);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

export const subName = (si, sj) => {
  const ti = Math.floor(si / 4), tj = Math.floor(sj / 4);
  return `${ti}_${tj}_${si - ti * 4}_${sj - tj * 4}`;
};

// The pure window. index: fine.json. State: which sub-tiles it holds ('si_sj' -> true once
// uploaded), the origin (oi, oj: the south-west sub-tile), the camera's sub-tile.
export function createFineWindow(index) {
  const X0 = index.x0, Y0 = index.y0, PXM = index.px, SUBM = index.sub * index.px;
  const files = new Set(index.files || []), uniform = index.uniform || {};
  const filled = new Set();
  const win = { oi: 0, oj: 0, ci: 0, cj: 0, started: false };
  const inWin = (si, sj) => si >= win.oi && si < win.oi + PER && sj >= win.oj && sj < win.oj + PER;
  return {
    win, filled, subMetres: SUBM,
    // What a sub-tile is: 'file' | a class number (uniform) | null (no data).
    kind(si, sj) { const n = subName(si, sj); return files.has(n) ? 'file' : (n in uniform ? uniform[n] : null); },
    // Follow the camera: the window keeps the camera near its middle (no thrash on an edge).
    // Returns true if the window moved (the sub-tiles it dropped are forgotten).
    moveTo(x, y) {
      const fx = (x - X0) / SUBM, fy = (y - Y0) / SUBM;
      win.ci = Math.floor(fx); win.cj = Math.floor(fy);
      let moved = false;
      // (The camera between 1.25 and 2.75 sub-tiles from the window's south-west corner: a
      // column or a row at a time, 16 km of hysteresis, at least 40 km of fine cover every way.)
      const want = (f, o) => {
        if (!win.started || Math.abs(f - (o + 2)) > 2) return Math.round(f) - 2;
        if (f > o + 2.75) return o + Math.ceil(f - (o + 2.75));
        if (f < o + 1.25) return o - Math.ceil(o + 1.25 - f);
        return o;
      };
      const ni = want(fx, win.oi), nj = want(fy, win.oj);
      if (ni !== win.oi || nj !== win.oj || !win.started) {
        win.oi = ni; win.oj = nj; win.started = true; moved = true;
        for (const k of [...filled]) { const [a, b] = k.split('_').map(Number); if (!inWin(a, b)) filled.delete(k); }
      }
      return moved;
    },
    // The sub-tiles of the window not held yet, the nearest to the camera first.
    missing() {
      const out = [];
      for (let sj = win.oj; sj < win.oj + PER; sj++) for (let si = win.oi; si < win.oi + PER; si++) if (!filled.has(si + '_' + sj)) out.push([si, sj]);
      const d = ([a, b]) => Math.max(Math.abs(a - win.ci), Math.abs(b - win.cj)) * 10 + Math.abs(a - win.ci) + Math.abs(b - win.cj);
      return out.sort((p, q) => d(p) - d(q));
    },
    inWin,
    // The largest rectangle of held sub-tiles grown from the camera's, in fine pixels, half-open
    // [P0, Q0, P1, Q1]; zero area while the camera's own isn't in.
    valid() {
      const has = (a, b) => filled.has(a + '_' + b);
      const S = index.sub;
      if (!has(win.ci, win.cj)) return [win.ci * S, win.cj * S, win.ci * S, win.cj * S];
      let a0 = win.ci, a1 = win.ci + 1, b0 = win.cj, b1 = win.cj + 1;
      const col = (a) => { for (let b = b0; b < b1; b++) if (!has(a, b)) return false; return true; };
      const row = (b) => { for (let a = a0; a < a1; a++) if (!has(a, b)) return false; return true; };
      for (let grew = true; grew;) {
        grew = false;
        if (a0 > win.oi && col(a0 - 1)) { a0--; grew = true; }
        if (a1 < win.oi + PER && col(a1)) { a1++; grew = true; }
        if (b0 > win.oj && row(b0 - 1)) { b0--; grew = true; }
        if (b1 < win.oj + PER && row(b1)) { b1++; grew = true; }
      }
      return [a0 * S, b0 * S, a1 * S, b1 * S];
    },
    // The texel of a sub-tile's south-west pixel.
    texelOf: (si, sj) => [(si * index.sub) & (FINE_N - 1), (sj * index.sub) & (FINE_N - 1)],
    pixelOf: (x, y) => [Math.floor((x - X0) / PXM), Math.floor((y - Y0) / PXM)],
  };
}

async function gunzipUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const enc = res.headers.get('content-encoding');
  if (enc && enc.includes('gzip')) return res.arrayBuffer();
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// The page's part. uniforms: the world's shared uniforms (uFine, uFineExt and uFineOn are added).
// update(camMap) every frame; flush(renderer) from a mesh's onBeforeRender (one sub-tile's
// megabyte a frame at most). Nothing is fetched until the first update.
export function createFineCover(uniforms, { baseUrl = 'data/' } = {}) {
  let base = baseUrl;
  if (!base.endsWith('/')) base += '/';
  const dir = new URL('terrain/fine/', new URL(base, location.href)).href;
  const tex = new THREE.DataTexture(null, FINE_N, FINE_N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = false; tex.flipY = false; tex.unpackAlignment = 1;
  tex.source.dataReady = false;        // storage only (zeroed: no data); the sub-tiles come by copyTextureToTexture
  tex.needsUpdate = true;
  uniforms.uFine = { value: tex };
  uniforms.uFineExt = { value: new THREE.Vector4(0, 0, -1, -1) };   // valid fine pixels, lo.xy .. hi.xy inclusive, from the lattice's origin
  uniforms.uFineOn = { value: 0 };
  let fw = null, loadingIndex = null;
  const loading = new Set(), ready = [];   // ready: [si, sj, Uint8Array] waiting for the GPU
  const at = new THREE.Vector2();
  const constant = new Map();              // class + 1 -> a sub-tile of that value
  const flat = (v) => { let a = constant.get(v); if (!a) { a = new Uint8Array(FINE_SUB * FINE_SUB).fill(v); constant.set(v, a); } return a; };
  const setExt = () => { const v = fw.valid(); uniforms.uFineExt.value.set(v[0], v[1], v[2] - 1, v[3] - 1); uniforms.uFineOn.value = v[2] > v[0] && v[3] > v[1] ? 1 : 0; };
  // v0.6.1: the bytes of the sub-tiles the window holds stay on the CPU too (16 MB at most; the
  // uniform ones share an array), so rural.js can list the cells that can hold a house instead
  // of drawing every slot. `version` counts every change to what is held.
  const held = new Map();                  // 'si_sj' -> Uint8Array (the class + 1 a pixel, as the texture)
  const prune = () => { for (const k of held.keys()) if (!fw.filled.has(k)) held.delete(k); };
  const fine = {
    texture: tex, stats: { loaded: 0, uploads: 0, pending: 0 },
    version: 0,
    get window() { return fw; },
    // A reader of the held pixels for one pass: (P, Q) -> the class + 1, or 0 where nothing is
    // held (global fine pixels, as the shaders' fineTexel() before the wrap).
    // inset: within that many pixels of the edge of the valid rectangle and beyond it (where
    // the shaders' fineInside() stops trusting the window, give or take a pixel) the value has
    // 16 added, for a reader whose caller must know where the shader may fall back to the 250 m
    // cover instead.
    reader(inset = null) {
      if (!fw) return () => 0;
      const oi = fw.win.oi, oj = fw.win.oj, grid = new Array(PER * PER).fill(null);
      for (let b2 = 0; b2 < PER; b2++) for (let a2 = 0; a2 < PER; a2++) grid[b2 * PER + a2] = held.get((oi + a2) + '_' + (oj + b2)) || null;
      const v = inset === null ? null : fw.valid();
      const p0 = v ? v[0] + inset : 0, q0 = v ? v[1] + inset : 0, p1 = v ? v[2] - inset : 0, q1 = v ? v[3] - inset : 0;
      return (P, Q) => {
        const si = Math.floor(P / FINE_SUB) - oi, sj = Math.floor(Q / FINE_SUB) - oj;
        if (si < 0 || sj < 0 || si >= PER || sj >= PER) return 0;
        const d = grid[sj * PER + si];
        const c = d ? d[(Q & (FINE_SUB - 1)) * FINE_SUB + (P & (FINE_SUB - 1))] : 0;
        // In the band the shader may or may not trust (and beyond it): what is held, with 16
        // added, so the caller can allow for both readings.
        return v && c && (P < p0 || P >= p1 || Q < q0 || Q >= q1) ? c | 16 : c;
      };
    },
    update(camMap) {
      if (!fw) {
        if (!loadingIndex) loadingIndex = fetch(dir + 'fine.json').then((r) => (r.ok ? r.json() : null)).then((ix) => { if (ix) fw = createFineWindow(ix); }).catch(() => {});
        return;
      }
      if (fw.moveTo(camMap.x, camMap.y)) { setExt(); prune(); fine.version++; }
      const miss = fw.missing();
      fine.stats.pending = miss.length;
      for (const [si, sj] of miss) {
        const key = si + '_' + sj;
        if (loading.has(key) || ready.some((r) => r[0] === si && r[1] === sj)) continue;
        const kind = fw.kind(si, sj);
        if (kind !== 'file') { ready.push([si, sj, flat(kind === null ? 0 : kind + 1)]); continue; }
        if (loading.size >= 2) break;      // two fetches at a time, the nearest first
        loading.add(key);
        gunzipUrl(dir + subName(si, sj) + '.u8.gz').then((buf) => {
          loading.delete(key);
          let a = flat(0);
          if (buf && buf.byteLength === FINE_SUB * FINE_SUB) { a = new Uint8Array(buf); for (let k = 0; k < a.length; k++) a[k]++; fine.stats.loaded++; }
          ready.push([si, sj, a]);
        }, () => { loading.delete(key); ready.push([si, sj, flat(0)]); });
      }
    },
    flush(renderer) {
      if (!fw || !ready.length) return;
      // The nearest waiting sub-tile still in the window.
      let best = -1;
      for (let k = 0; k < ready.length; k++) {
        const [si, sj] = ready[k];
        if (!fw.inWin(si, sj)) { ready.splice(k--, 1); continue; }
        if (best < 0 || Math.hypot(si - fw.win.ci, sj - fw.win.cj) < Math.hypot(ready[best][0] - fw.win.ci, ready[best][1] - fw.win.cj)) best = k;
      }
      if (best < 0) return;
      const [si, sj, data] = ready.splice(best, 1)[0];
      const src = new THREE.DataTexture(data, FINE_SUB, FINE_SUB, THREE.RedFormat, THREE.UnsignedByteType);
      src.unpackAlignment = 1;
      const [tx, ty] = fw.texelOf(si, sj);
      renderer.copyTextureToTexture(src, tex, null, at.set(tx, ty));
      src.dispose();
      fw.filled.add(si + '_' + sj);
      held.set(si + '_' + sj, data);
      fine.stats.uploads++;
      fine.version++;
      setExt();
    },
    get pending() { return fw ? fw.missing().length : 1; },
    dispose() { tex.dispose(); },
  };
  return fine;
}

// The shaders' side, compiled in only with GROUND_ON. uFineOrg: the scene origin's fine pixel
// (the integer part, set per frame from doubles) and uFineFrac its fraction, so a fragment's
// pixel comes from small numbers wherever the map's origin is (V060.md, "Precision far from
// the origin"). fineAt(rel): the class + 1 (0: none) at scene offset rel.xz from the origin;
// fineMix(rel, ...): the classes' shares under a bilinear footprint, and how valid they are.
export const FINE_GLSL = /* glsl */ `
uniform sampler2D uFine;
uniform vec4 uFineExt;
uniform float uFineOn;
uniform ivec2 uFineOrg;
uniform vec2 uFineFrac;
int fineTexel(ivec2 p) { return int(texelFetch(uFine, p & ${FINE_N - 1}, 0).r * 255.0 + 0.5); }
// The pixel coordinate (continuous, pixel centres at .5) relative to uFineOrg, from scene x, z.
vec2 finePos(vec2 sceneXZ) { return uFineFrac + vec2(sceneXZ.x, -sceneXZ.y) / ${FINE_PX.toFixed(2)}; }
// How far inside the valid window (pixels; negative outside).
float fineInside(vec2 fp) {
  vec2 p = fp + vec2(uFineOrg);
  return min(min(p.x - uFineExt.x, uFineExt.z + 1.0 - p.x), min(p.y - uFineExt.y, uFineExt.w + 1.0 - p.y));
}
// The four pixels round fp and their bilinear weights: shares of tree, crop, built-up, water
// (lo) and grass or shrub, bare, wetland, no data (hi).
void fineMix(vec2 fp, out vec4 lo, out vec4 hi) {
  vec2 q = fp - 0.5, f = fract(q);
  ivec2 b = ivec2(floor(q)) + uFineOrg;
  lo = vec4(0.0); hi = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    int c = fineTexel(b + o);
    if (c == 2) lo.x += w; else if (c == 5) lo.y += w; else if (c == 6) lo.z += w; else if (c == 1) lo.w += w;
    else if (c == 3 || c == 4) hi.x += w; else if (c == 7) hi.y += w; else if (c == 8) hi.z += w; else hi.w += w;
  }
}
// Which built-up patches of farm country are glass and which are villages (v0.6.1; it was a
// float noise of the map position): a smooth value over a 250 m lattice (8 fine pixels) of
// exact hashes, which the CPU works out the same (glassPatch() below), so greenhouses.js lists
// only the tunnels that stand. fp: the continuous fine pixel from uFineOrg (finePos()).
float glassPatch(vec2 fp) {
  vec2 q = floor(fp);
  ivec2 b = ivec2(q) + uFineOrg, c = b >> 3;
  vec2 f = (vec2(b & 7) + (fp - q)) / 8.0, u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ihash(c, 97u), ihash(c + ivec2(1, 0), 97u), u.x), mix(ihash(c + ivec2(0, 1), 97u), ihash(c + ivec2(1, 1), 97u), u.x), u.y);
}
// The water's share under a smoother footprint (a quadratic B-spline over the nine pixels round
// fp): a bank drawn from it at one half is a curve where the four-pixel one steps along a
// diagonal by a pixel (31 m) at a time. For the ponds' and rivers' edges only (nine fetches,
// taken only where the four-pixel footprint already holds some water: v0.6.1).
float fineWater(vec2 fp) {
  vec2 p = fp - 0.5, c = floor(p + 0.5), t = p - c;
  ivec2 b = ivec2(c) + uFineOrg;
  vec3 wx = vec3(0.5 * (0.5 - t.x) * (0.5 - t.x), 0.75 - t.x * t.x, 0.5 * (0.5 + t.x) * (0.5 + t.x));
  vec3 wy = vec3(0.5 * (0.5 - t.y) * (0.5 - t.y), 0.75 - t.y * t.y, 0.5 * (0.5 + t.y) * (0.5 + t.y));
  float s = 0.0;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) if (fineTexel(b + ivec2(i - 1, j - 1)) == 1) s += wx[i] * wy[j];
  return s;
}
`;

// Set the per-frame uniforms FINE_GLSL needs (origin: the scene origin's map x, y, in doubles).
export function setFineOrigin(uniforms, origin, index = { x0: -400000, y0: -400000 }) {
  if (!uniforms.uFineOrg) { uniforms.uFineOrg = { value: new THREE.Vector2() }; uniforms.uFineFrac = { value: new THREE.Vector2() }; }
  const px = (origin.x - index.x0) / FINE_PX, py = (origin.y - index.y0) / FINE_PX;
  const ix = Math.floor(px), iy = Math.floor(py);
  uniforms.uFineOrg.value.set(ix, iy);
  uniforms.uFineFrac.value.set(px - ix, py - iy);
}
