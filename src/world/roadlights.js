// v0.7.9 (briefs/V0-7-9.md part 3, Shane: "random specs of lights that don't actually look like a city … some
// moving along highways to look like cars"): the main roads lit at night, and the cars on the motorways.
//
// The roads are OSM's motorways, trunks, primary roads and motorway links inside the cities, baked by
// tools/bake_region_roads.py into one small gzipped file per 64 km cell of the region's lattice (<base>roads/,
// indexed by roads.json). The cells within ROAD_RADIUS_M of the camera are fetched, gunzipped (the browser's
// DecompressionStream, off the main thread) and cut into pieces of at most PIECE_M, one parse a frame at most.
// Each piece is one instance; the vertex shader places its slots on the GPU:
//   - streetlights: a lamp every LAMP_SPACING[class] metres of the line (counted from the line's start, so the
//     pieces join with no seam), thinned with distance in rings (every 2nd lamp past 6 km, 4th past 12 km, 8th past
//     24 km, each kept lamp standing for those it drops), brighter and whiter on the bigger roads; the colour mix by
//     country (LED white in Korea and Japan, a mix in China, sodium in Europe's streets, whiter on its motorways);
//   - cars, on the motorways and trunks within CAR_RADIUS_M: white headlights where a car comes towards the camera,
//     red tail lights where it goes away, on each carriageway (a two-way line's two streams a lane each side of it,
//     on the country's side of the road), thinning late at night by the place's local hour. A car's place is a
//     pure function of the game's clock and the line: car n of a stream stands at n * CAR_S + jitter(n) ± P along
//     the line, P = (clock seconds × the stream's speed) mod (CAR_S × CAR_WRAP), computed in doubles on the CPU;
//     its presence and jitter hash n mod CAR_WRAP, so the pattern repeats exactly when P wraps. No state: a jump, a
//     rewind or the predicted path changes nothing, and two frames at the same clock draw the same cars.
// The instance lists are rebuilt only when the camera crosses a REBUILD_M cell or a new road cell has been parsed,
// at most once a frame, into preallocated arrays (one upload). Two draw calls: the lamps and the cars. A look only:
// nothing in the sim reads them. Behind ?lights79=0 (node FS_LIGHTS79=0) none of this is made (world.js).

import * as THREE from '../../vendor/three.module.js';
import { countryAt, rulesAt } from './region.js';

function lookSwitch(q, env) {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp(`[?&]${q}=([01])\\b`).exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env[env] === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const LIGHTS79 = lookSwitch('lights79', 'FS_LIGHTS79');

export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'motorway_link'];
export const PIECE_M = 300;            // a piece's longest (m)
export const LAMP_SPACING = [40, 36, 30, 32];   // m, by class
export const LAMP_SLOTS = Math.ceil(PIECE_M / 30) + 1;   // 11: enough for the closest spacing
export const ROAD_RADIUS_M = 40000;    // road cells within this of the camera are loaded and drawn
export const CAR_RADIUS_M = 14000;     // cars only this close
export const REBUILD_M = 2000;
export const FAR_X = 4;                // a far piece is FAR_X × longer, its lamps FAR_X × further apart (every 4th lamp)
export const NEAR_CELL_M = 12000;      // a cell whose nearest point is further than this draws its far pieces         // the instance lists are rebuilt when the camera crosses a cell this big
export const CAR_S = 36;               // m between car slots in a stream
export const CAR_WRAP = 4096;          // a stream's pattern repeats every CAR_S × CAR_WRAP metres of travel
export const CAR_SPEEDS = [22, 25.5, 28, 31.5];   // m/s, the four speed classes
export const CAR_SLOTS = Math.ceil(PIECE_M / CAR_S) + 1;   // per stream
const LEFT_HAND = new Set(['JP', 'GB', 'IE', 'GG', 'JE', 'IM']);

// Cars by the local hour (0..24): the share of the slots taken. Thinnest at about 3 in the morning.
const DENSITY = [[0, 0.45], [1, 0.32], [2, 0.22], [3, 0.16], [4, 0.18], [5, 0.34], [6, 0.66], [7, 0.92], [9, 0.85],
  [12, 0.8], [17, 1.0], [19, 1.0], [21, 0.8], [23, 0.58], [24, 0.45]];
export function carDensity(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let k = 1; k < DENSITY.length; k++) {
    if (h <= DENSITY[k][0]) {
      const [h0, d0] = DENSITY[k - 1], [h1, d1] = DENSITY[k];
      return d0 + (d1 - d0) * (h - h0) / (h1 - h0);
    }
  }
  return DENSITY[0][1];
}

// The four speed classes' phases (m) at a clock time (epoch ms), in doubles: (t × v) mod (CAR_S × CAR_WRAP).
export function carPhases(ms, out = new Float64Array(4)) {
  const t = ms / 1000, W = CAR_S * CAR_WRAP;
  for (let c = 0; c < 4; c++) { const p = (t * CAR_SPEEDS[c]) % W; out[c] = p < 0 ? p + W : p; }
  return out;
}

// The integer hash the shader uses (a mirror for the tests): 0..1.
export function hash01(a, b) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}
const HASH_GLSL = /* glsl */ `
  float rhash(int a, int b) {
    uint h = (uint(a) * 0x27d4eb2du) ^ (uint(b) * 0x165667b1u);
    h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
    h = (h ^ (h >> 12u)) * 0x297a2d39u;
    h = h ^ (h >> 15u);
    return float(h) / 4294967296.0;
  }`;

// The cars of one stream on one piece at a clock phase P (m): the arcs along the piece (0..len) where a car stands,
// as the shader places them (density: carDensity()'s share; seedI: the line's integer seed; dir +1 with the line,
// -1 against it). A mirror of the shader's rule for the tests.
export function carsOnPiece(s0, len, P, density, seedI, dir) {
  const out = [];
  const ph = dir > 0 ? P : -P;
  const n0 = Math.floor((s0 - ph) / CAR_S);
  for (let j = 0; j < CAR_SLOTS; j++) {
    const n = n0 + j, nw = ((n % CAR_WRAP) + CAR_WRAP) % CAR_WRAP;
    if (hash01(nw, seedI * 2 + (dir > 0 ? 0 : 1)) >= density) continue;
    const s = n * CAR_S + hash01(nw, seedI + 7919) * CAR_S * 0.6 + ph - s0;
    if (s >= 0 && s < len) out.push(s);
  }
  return out;
}

// One road cell's file (FSR1, tools/bake_region_roads.py) → its lines: { cls, flags, x: Float64Array, y } in metres
// from the cell's south-west corner.
export function parseRoadTile(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'FSR1') throw new Error('roadlights: not an FSR1 file');
  const nl = dv.getUint32(4, true);
  let o = 12 + 4 * nl;
  const lines = new Array(nl);
  for (let k = 0; k < nl; k++) {
    const cls = dv.getUint8(12 + 4 * k), flags = dv.getUint8(13 + 4 * k), m = dv.getUint16(14 + 4 * k, true);
    const x = new Float64Array(m), y = new Float64Array(m);
    let px = dv.getUint16(o, true), py = dv.getUint16(o + 2, true); o += 4;
    x[0] = px; y[0] = py;
    for (let v = 1; v < m; v++) { px += dv.getInt16(o, true); py += dv.getInt16(o + 2, true); o += 4; x[v] = px; y[v] = py; }
    lines[k] = { cls, flags, x, y };
  }
  return lines;
}

// A cell's lines cut into pieces of at most PIECE_M: the instance data, 8 floats a piece: ax, ay, bx, by (map m),
// then s0 (the arc from the line's start), cls + 4 × flags (bit 0 one way, bit 1 left-hand traffic, bit 2 a far piece:
// FAR_X × PIECE_M long, a lamp every FAR_X × spacing, the same lamps as every FAR_X-th near one), led (0..1, the
// country's share of white lamps) and seed (the line's integer seed). Returns { lamps, cars, nLamps, nCars }, cars
// holding the motorways' and trunks' pieces only. meta(x, y) → { led, left } for a line (by its first vertex).
export function buildPieces(lines, x0, y0, cellKey, meta, far = false) {
  const PL = far ? PIECE_M * FAR_X : PIECE_M;
  let n = 0, nc = 0;
  for (const l of lines) for (let v = 1; v < l.x.length; v++) {
    const k = Math.max(1, Math.ceil(Math.hypot(l.x[v] - l.x[v - 1], l.y[v] - l.y[v - 1]) / PL));
    n += k; if (l.cls <= 1 && !far) nc += k;
  }
  const lamps = new Float32Array(n * 8), cars = new Float32Array(nc * 8);
  let a = 0, c = 0;
  lines.forEach((l, li) => {
    const m = meta(x0 + l.x[0], y0 + l.y[0]);
    const flags = (l.flags & 1) | (m.left ? 2 : 0) | (far ? 4 : 0);
    const seed = ((cellKey * 131071) ^ (li * 2654435761)) & 0xffffff;
    let s = 0;
    for (let v = 1; v < l.x.length; v++) {
      const ax = x0 + l.x[v - 1], ay = y0 + l.y[v - 1], bx = x0 + l.x[v], by = y0 + l.y[v];
      const L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / PL));
      for (let q = 0; q < k; q++) {
        const t0 = q / k, t1 = (q + 1) / k;
        const rec = [ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1,
          s + L * t0, l.cls + 4 * flags, m.led, seed];
        lamps.set(rec, a * 8); a++;
        if (l.cls <= 1 && !far) { cars.set(rec, c * 8); c++; }
      }
      s += L;
    }
  });
  return { lamps, cars, nLamps: n, nCars: nc };
}

// The country's lamps: the share of white LED (Korea's and Japan's cities whiter, China a mix, Europe's streets
// sodium) and the side of the road.
export function countryMeta(cc) {
  const led = cc === 'KR' || cc === 'JP' ? 0.85 : cc === 'CN' ? 0.5 : cc === 'KP' ? 0.15 : cc === 'RU' ? 0.3 : 0.22;
  return { led, left: LEFT_HAND.has(cc) };
}

const COMMON_VERT = /* glsl */ `
  attribute vec4 seg;    // ax, ay, bx, by (map m)
  attribute vec4 info;   // s0, cls + 4 flags, led, seed
  varying vec3 vCol;
  #include <logdepthbuf_pars_vertex>
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); }
  float extinct(vec3 rel, float d3) {
    float e0 = exp(-max(uCamAlt, 0.0) / HAZE_H);
    float od = abs(rel.y) < 1.0 ? HAZE_SIGMA0 * e0 * d3
             : HAZE_SIGMA0 * HAZE_H * d3 / rel.y * (e0 - exp(-max(uCamAlt + rel.y, 0.0) / HAZE_H));
    od += fogDepth(rel, d3);
    return exp(-0.6 * od);
  }
  void place(vec3 wp) {
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float dd = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.5 + dd * 0.002) / max(dd, 1e-3), 0.5);
    gl_Position = projectionMatrix * mv;
  }`;

const LAMP_VERT = /* glsl */ `
  uniform float uLampSlots;
  void main() {
    int cls = int(mod(info.y, 4.0));
    int flags = int(info.y / 4.0);
    vec2 A = seg.xy, B = seg.zw;
    vec2 ab = B - A;
    float L = length(ab);
    bool far = (flags & 4) == 4;
    float sp = cls == 0 ? ${LAMP_SPACING[0].toFixed(1)} : cls == 1 ? ${LAMP_SPACING[1].toFixed(1)} : cls == 2 ? ${LAMP_SPACING[2].toFixed(1)} : ${LAMP_SPACING[3].toFixed(1)};
    if (far) sp *= ${FAR_X.toFixed(1)};
    int n = int(ceil(info.x / sp - 1e-4)) + gl_VertexID;
    float s = float(n) * sp - info.x;
    if (L < 0.5 || s >= L) { hide(); return; }
    vec2 dir = ab / L;
    // A two-way road's lamps stand on alternate sides.
    float side = (flags & 1) == 1 ? 0.0 : (n % 2 == 0 ? 1.0 : -1.0) * (cls == 2 ? 7.0 : 10.0);
    vec2 m = A + dir * s + vec2(dir.y, -dir.x) * side;
    vec2 pc = m - uOrigin;
    vec2 dc = pc - vec2(uCamPos.x, -uCamPos.z);
    float dist = length(dc);
    // Rings: every lamp to 6 km, every 2nd to 12, 4th to 24, 8th beyond; a kept lamp stands for those dropped.
    // (A far piece's lamp n is near lamp FAR_X n: it keeps every lamp to 24 km, every 2nd beyond.)
    int stride = dist < 6000.0 ? 1 : dist < 12000.0 ? 2 : dist < 24000.0 ? 4 : 8;
    if (far ? (stride == 8 && n % 2 != 0) : (n % stride != 0)) { hide(); return; }
    stride = far ? max(stride, ${FAR_X}) : stride;
    float fade = 1.0 - smoothstep(${(ROAD_RADIUS_M * 0.8).toFixed(1)}, ${ROAD_RADIUS_M.toFixed(1)}, dist);
    if (fade <= 0.0) { hide(); return; }
    float seedF = info.w;
    float h0 = rhash(n, int(seedF)), h1 = rhash(n + 7, int(seedF) + 3);
    float hgt = terrainHeight(m);
    vec3 wp = vec3(pc.x, hgt + 10.0, -pc.y);
    vec3 rel = wp - uCamPos;
    wp.y -= curveDrop(rel.xz);
    rel = wp - uCamPos;
    float d3 = length(rel);
    // Colour: the bigger roads whiter (LED), the rest by the country's mix and a seeded variety by line and lamp.
    vec3 SODIUM = vec3(1.0, 0.50, 0.16), LED = vec3(0.86, 0.92, 1.0), WARM = vec3(1.0, 0.82, 0.6);
    float led = clamp(info.z + (cls == 0 || cls == 3 ? 0.35 : cls == 1 ? 0.2 : 0.0) + (rhash(int(seedF), 91) - 0.5) * 0.3, 0.0, 1.0);
    vec3 c = rhash(int(seedF), 92) < led ? (h1 < 0.2 ? WARM : LED) : SODIUM;
    float I = cls == 0 ? 1.55 : cls == 1 ? 1.35 : cls == 3 ? 1.2 : 1.0;
    I *= sqrt(float(stride)) * fade;
    I *= clamp(pow(2600.0 * sqrt(float(stride)) / max(d3, 1.0), 0.85), 0.0, 1.0);
    I *= 0.8 + 0.4 * h0;
    I *= uNight * (1.0 + 0.6 * uSnow);
    vCol = c * extinct(rel, d3) * I * 1.5;
    float px = (cls <= 1 ? 5.0 : 4.0) * uPxScale / max(d3, 1.0);
    gl_PointSize = clamp(px, 2.0, 6.0) * step(0.002, I);
    place(wp);
    #include <logdepthbuf_vertex>
  }`;

const CAR_VERT = /* glsl */ `
  uniform vec4 uCarPhase;     // the four speed classes' phases (m)
  uniform float uCarDensity;  // the share of slots taken, by the local hour
  void main() {
    int flags = int(info.y / 4.0);
    bool oneway = (flags & 1) == 1, left = (flags & 2) == 2;
    int stream = gl_VertexID / ${CAR_SLOTS};
    int j = gl_VertexID - stream * ${CAR_SLOTS};
    if (oneway && stream == 1) { hide(); return; }
    vec2 A = seg.xy, B = seg.zw;
    vec2 ab = B - A;
    float L = length(ab);
    if (L < 0.5) { hide(); return; }
    int seedI = int(info.w);
    int sc = (seedI + stream) % 4;
    float P = sc == 0 ? uCarPhase.x : sc == 1 ? uCarPhase.y : sc == 2 ? uCarPhase.z : uCarPhase.w;
    float ph = stream == 0 ? P : -P;
    int n = int(floor((info.x - ph) / ${CAR_S.toFixed(1)})) + j;
    int nw = n - ${CAR_WRAP} * int(floor(float(n) / ${CAR_WRAP}.0));
    if (rhash(nw, seedI * 2 + stream) >= uCarDensity) { hide(); return; }
    float s = float(n) * ${CAR_S.toFixed(1)} + rhash(nw, seedI + 7919) * ${(CAR_S * 0.6).toFixed(1)} + ph - info.x;
    if (s < 0.0 || s >= L) { hide(); return; }
    vec2 dir = ab / L;
    vec2 mv = stream == 0 ? dir : -dir;                 // the car's heading
    vec2 right = vec2(mv.y, -mv.x);
    float lane = rhash(nw, seedI + 31) < 0.5 ? 1.0 : 2.0;
    float off = oneway ? (lane - 1.5) * 3.5 : (lane - 0.5) * 3.5;
    vec2 m = A + dir * s + right * (left ? -off : off);
    vec2 pc = m - uOrigin;
    vec2 dc = pc - vec2(uCamPos.x, -uCamPos.z);
    float dist = length(dc);
    float fade = 1.0 - smoothstep(${(CAR_RADIUS_M * 0.6).toFixed(1)}, ${CAR_RADIUS_M.toFixed(1)}, dist);
    if (fade <= 0.0) { hide(); return; }
    float hgt = terrainHeight(m);
    vec3 wp = vec3(pc.x, hgt + 1.2, -pc.y);
    vec3 rel = wp - uCamPos;
    wp.y -= curveDrop(rel.xz);
    rel = wp - uCamPos;
    float d3 = length(rel);
    // Coming towards the camera: the headlights; going away: the tail lights.
    bool towards = dot(vec3(mv.x, 0.0, -mv.y), rel) < 0.0;
    vec3 c = towards ? vec3(1.0, 0.9, 0.7) : vec3(1.0, 0.06, 0.03);
    float I = (towards ? 1.6 : 2.3) * fade;
    I *= clamp(pow(1500.0 / max(d3, 1.0), 0.8), 0.0, 1.0);
    I *= uNight;
    vCol = c * extinct(rel, d3) * I * 1.6;
    float px = 2.5 * uPxScale / max(d3, 1.0);   // (smaller than a streetlight's glow)
    gl_PointSize = clamp(px, 1.8, 3.5) * step(0.002, I);
    place(wp);
    #include <logdepthbuf_vertex>
  }`;

const FRAG = /* glsl */ `
  varying vec3 vCol;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 7.0), halo = exp(-r2 * 2.2) * 0.25;
    gl_FragColor = vec4(vCol * (core * 1.3 + halo), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The shader text, for the tests (chunks: glsl.js's).
export function roadShaders(chunks) {
  const head = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.HEIGHT_GLSL}\n${chunks.ATMOS_GLSL}\n${HASH_GLSL}\n${COMMON_VERT}\n`;
  return { lamp: head + LAMP_VERT, car: head + CAR_VERT, frag: FRAG };
}

async function fetchGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`roadlights: ${url} ${res.status}`);
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// The part (world.js): createRoadLights(scene, uniforms, chunks, { baseUrl }). update({ camMap }) each frame;
// setClock(ms) whenever the clock moves (world.js passes sky.setTime's).
export function createRoadLights(scene, uniforms, chunks, { baseUrl = 'data/', loader = fetchGz, fetchJson = null } = {}) {
  const sh = roadShaders(chunks);
  const group = new THREE.Group();
  group.name = 'road-lights';
  group.visible = false;
  scene.add(group);

  function makeDraw(name, vertexShader, slots, extra, cap0) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(slots * 3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, uniforms, extra), vertexShader, fragmentShader: sh.frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    pts.name = name;
    group.add(pts);
    const d = { geo, mat, pts, cap: 0, seg: null, info: null, count: 0 };
    grow(d, cap0);
    geo.instanceCount = 0;
    return d;
  }
  function grow(d, cap) {
    d.cap = cap;
    d.segArr = new Float32Array(cap * 4); d.infoArr = new Float32Array(cap * 4);
    d.seg = new THREE.InstancedBufferAttribute(d.segArr, 4); d.seg.setUsage(THREE.DynamicDrawUsage);
    d.info = new THREE.InstancedBufferAttribute(d.infoArr, 4); d.info.setUsage(THREE.DynamicDrawUsage);
    d.geo.setAttribute('seg', d.seg); d.geo.setAttribute('info', d.info);
    // three.js keeps the instance count the first attributes allowed (_maxInstanceCount) and draws no more than it:
    // forget it, so the grown arrays are drawn in full.
    delete d.geo._maxInstanceCount;
  }
  const lamps = makeDraw('road-lamps', sh.lamp, LAMP_SLOTS, { uLampSlots: { value: LAMP_SLOTS } }, 40000);
  const phases = new THREE.Vector4();
  const cars = makeDraw('road-cars', sh.car, 2 * CAR_SLOTS, { uCarPhase: { value: phases }, uCarDensity: { value: 0.5 } }, 12000);

  let index = null, failed = false;
  const cells = new Map();       // key → { state: 'loading' | 'raw' | 'ready' | 'bad', buf, lamps, cars, cx, cy }
  const queue = [];              // cells fetched and waiting for their parse
  let gx = NaN, gy = NaN, dirty = false;
  let clockMs = null, hourMs = NaN, hourZone = '', localHour = 21;
  const _ph = new Float64Array(4);
  const fmt = new Map();

  (async () => {
    try {
      index = fetchJson ? await fetchJson(baseUrl + 'roads/roads.json') : await (await fetch(baseUrl + 'roads/roads.json')).json();
      if (!index || index.version !== 1) { index = null; failed = true; } else dirty = true;
    } catch { failed = true; }
  })();

  function wanted(camMap) {
    const out = [];
    if (!index) return out;
    const C = index.cell, R = ROAD_RADIUS_M;
    const i0 = Math.floor((camMap.x - R - index.x0) / C), i1 = Math.floor((camMap.x + R - index.x0) / C);
    const j0 = Math.floor((camMap.y - R - index.y0) / C), j1 = Math.floor((camMap.y + R - index.y0) / C);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i}_${j}`;
      if (!index.tiles[key]) continue;
      const cx = index.x0 + (i + 0.5) * C, cy = index.y0 + (j + 0.5) * C;
      const dx = Math.max(Math.abs(camMap.x - cx) - C / 2, 0), dy = Math.max(Math.abs(camMap.y - cy) - C / 2, 0);
      if (dx * dx + dy * dy <= R * R) out.push([key, i, j]);
    }
    return out;
  }
  const metaCache = new Map();
  const meta = (x, y) => {
    let cc = 'XX';
    try { cc = countryAt(x, y) || 'XX'; } catch { /* rules not loaded */ }
    let m = metaCache.get(cc);
    if (!m) { m = countryMeta(cc); metaCache.set(cc, m); }
    return m;
  };

  function rebuild(camMap) {
    const list = wanted(camMap);
    // Fetch the cells near that aren't in yet (each parsed in a later frame, which rebuilds again).
    for (const [key, i, j] of list) {
      if (cells.has(key)) continue;
      const C = index.cell;
      const c = { state: 'loading', i, j, cx: index.x0 + (i + 0.5) * C, cy: index.y0 + (j + 0.5) * C };
      cells.set(key, c);
      loader(baseUrl + 'roads/' + index.tiles[key].file)
        .then((buf) => { c.buf = buf; c.state = 'raw'; queue.push(c); })
        .catch(() => { c.state = 'bad'; });
    }
    let nl = 0, nc = 0;
    const use = [];
    const C = index.cell;
    const near = (c, R) => {
      const dx = Math.max(Math.abs(camMap.x - c.cx) - C / 2, 0), dy = Math.max(Math.abs(camMap.y - c.cy) - C / 2, 0);
      return dx * dx + dy * dy <= R * R;
    };
    for (const [key] of list) {
      const c = cells.get(key);
      if (c && c.state === 'ready') { c.useFar = !near(c, NEAR_CELL_M); use.push(c); nl += c.useFar ? c.nFar : c.nLamps + c.nFar; }
    }
    // Cars only from the cells within reach of their radius.
    const carCells = use.filter((c) => near(c, CAR_RADIUS_M));
    nc = carCells.reduce((s, c) => s + c.nCars, 0);
    fill(lamps, use, nl, 'lamps', camMap);
    fill(cars, carCells, nc, 'cars', camMap);
  }
  // Copy the cells' pieces into the draw's arrays. For the lamps of a cell that reaches within NEAR_CELL_M: its near
  // pieces whose middle is within NEAR_CELL_M of the camera and its far pieces whose middle is beyond (a far lamp is
  // the same lamp as every FAR_X-th near one, so the two meet with at most a piece's overlap at the ring).
  function fill(d, use, n, what, cam) {
    if (n > d.cap) grow(d, Math.ceil(n * 1.3));
    let o = 0;
    const R2 = NEAR_CELL_M * NEAR_CELL_M;
    // (And no piece whose middle is past the draw's own radius, plus a rebuild cell: the shader fades them out anyway.)
    const RM = (what === 'cars' ? CAR_RADIUS_M : ROAD_RADIUS_M) + REBUILD_M, RM2 = RM * RM;
    const copy = (src, test) => {
      const k = src.length / 8;
      for (let p = 0; p < k; p++) {
        const s = p * 8;
        const mx = (src[s] + src[s + 2]) * 0.5 - cam.x, my = (src[s + 1] + src[s + 3]) * 0.5 - cam.y, m2 = mx * mx + my * my;
        if (m2 > RM2) continue;
        if (test !== 0 && (m2 <= R2) !== (test > 0)) continue;
        const t = o * 4;
        d.segArr[t] = src[s]; d.segArr[t + 1] = src[s + 1]; d.segArr[t + 2] = src[s + 2]; d.segArr[t + 3] = src[s + 3];
        d.infoArr[t] = src[s + 4]; d.infoArr[t + 1] = src[s + 5]; d.infoArr[t + 2] = src[s + 6]; d.infoArr[t + 3] = src[s + 7];
        o++;
      }
    };
    for (const c of use) {
      if (what !== 'lamps') copy(c[what], 0);
      else if (c.useFar) copy(c.far, 0);
      else { copy(c.lamps, 1); copy(c.far, -1); }
    }
    d.count = o;
    d.geo.instanceCount = o;
    for (const a of [d.seg, d.info]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(o * 4, 4)); }
  }

  function updateHour(camMap) {
    if (clockMs == null) return;
    if (Math.abs(clockMs - hourMs) < 30000) return;
    hourMs = clockMs;
    let zone = 'UTC';
    try { zone = rulesAt(camMap.x, camMap.y).timeZone || 'UTC'; } catch { /* rules not loaded */ }
    let f = fmt.get(zone);
    if (!f) {
      try { f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); } catch { f = null; }
      fmt.set(zone, f);
    }
    hourZone = zone;
    if (f) {
      const parts = f.formatToParts(new Date(clockMs));
      const h = +(parts.find((p) => p.type === 'hour') || {}).value, mi = +(parts.find((p) => p.type === 'minute') || {}).value;
      if (Number.isFinite(h)) localHour = h + (Number.isFinite(mi) ? mi / 60 : 0);
    }
  }

  const NONE = { drawCalls: 0, tris: 0, lights: 0 }, STATS = { drawCalls: 0, tris: 0, lights: 0 };   // (one object each: no allocation a frame)
  const part = {
    object: group,
    setClock(ms) { if (Number.isFinite(ms)) clockMs = ms; },
    get index() { return index; },
    get counts() { return { lampPieces: lamps.count, carPieces: cars.count, cells: [...cells.values()].filter((c) => c.state === 'ready').length, hour: localHour, zone: hourZone }; },
    update({ camMap }) {
      const on = uniforms.uNight.value >= 0.01 && !!index;
      group.visible = on;
      if (!on) return NONE;
      // Parse one fetched cell a frame (the fetches start in rebuild()).
      if (queue.length) {
        const c = queue.shift();
        try {
          const lines = parseRoadTile(c.buf);
          const C = index.cell;
          const x0 = index.x0 + c.i * C, y0 = index.y0 + c.j * C, key = (c.i * 4099 + c.j) | 0;
          const r = buildPieces(lines, x0, y0, key, meta), f = buildPieces(lines, x0, y0, key, meta, true);
          Object.assign(c, { lamps: r.lamps, cars: r.cars, nLamps: r.nLamps, nCars: r.nCars, far: f.lamps, nFar: f.nLamps, state: 'ready', buf: null });
          dirty = true;
        } catch { c.state = 'bad'; c.buf = null; }
      }
      // Drop cells far out of reach (twice the radius), so a long flight doesn't keep them all.
      if (cells.size > 24 && dirty) {
        for (const [key, c] of cells) {
          if (c.state === 'loading' || c.state === 'raw') continue;
          if (Math.hypot(camMap.x - c.cx, camMap.y - c.cy) > 2 * ROAD_RADIUS_M + index.cell) cells.delete(key);
        }
      }
      const cx = Math.floor(camMap.x / REBUILD_M), cy = Math.floor(camMap.y / REBUILD_M);
      if (cx !== gx || cy !== gy || dirty) { gx = cx; gy = cy; dirty = false; rebuild(camMap); }
      // The clock: the cars' phases (doubles here, floats on the GPU) and the hour's density.
      updateHour(camMap);
      const ms = clockMs == null ? 0 : clockMs;
      carPhases(ms, _ph);
      phases.set(_ph[0], _ph[1], _ph[2], _ph[3]);
      cars.mat.uniforms.uCarDensity.value = carDensity(localHour);
      lamps.pts.visible = lamps.count > 0;
      cars.pts.visible = cars.count > 0;
      STATS.drawCalls = (lamps.pts.visible ? 1 : 0) + (cars.pts.visible ? 1 : 0);
      STATS.lights = lamps.count * LAMP_SLOTS + cars.count * 2 * CAR_SLOTS;   // slots submitted (the shader drops the empty ones)
      return STATS;
    },
  };
  return part;
}
