// City lights at night: streetlights, brighter commercial cores and the arterials, as point
// sprites over the built-up cover ("like looking out from a plane window").
//
// Like cities.js, the ground is cut into blocks on a grid snapped to the map, seeded by the
// block's map index, so the lights are the same every run. Each block has the same set of
// light slots (slotLayout): streets along two of its edges, the paths between the rows of
// an apartment complex, extra lights on the edges and spots (signs, shopfronts) used only
// where the city is densest. The vertex shader places every slot on the GPU: it rotates the
// layout with the block (the same angle as cities.js's buildings at level 0), reads the
// built-up cover at the light, drops it off water, runways and thin cover, sits it on
// terrainHeight() and picks its colour.
//
// Distance: LEVELS rings, each with blocks twice as big as the one inside it (400 m, 800 m,
// ... 6.4 km), so the lights thin out with distance (a quarter of the density per ring)
// while each far light stands for more lamps. A light fades from one ring to the next by its
// own hash (no seam). One instanced Points draw per ring: LEVELS draw calls in all. The CPU
// lists only the blocks with built-up cover (refilled when the camera crosses a block of
// that ring), so fields and the sea submit nothing. Off (visible = false) by day.

import * as THREE from '../../vendor/three.module.js';

export const LIGHT_BLOCK = 400;    // m, the finest ring's block (cities.js's BLOCK)
export const LIGHT_HALF = 20;      // blocks each side of the camera, per ring
export const LIGHT_LEVELS = 5;     // rings: ±8, 16, 32, 64, 128 km
const FADE_A = 0.6, FADE_B = 0.9;  // a ring hands over to the next between these × its half-size

// Slot kinds (the layout's z): 0 a street on the block's edge, 1 an inner path, 2 an extra
// edge light in dense areas, 3 a commercial spot (sign, shopfront, floodlit forecourt).
export const KIND = { street: 0, inner: 1, dense: 2, spot: 3 };

// The light slots of one block, in block units (-0.5..0.5, x along the rows, y across), with
// their kind: [x, y, kind] per slot. Deterministic. The inner paths at y = ±0.09, ±0.27 and
// x = ±0.156 run between cities.js's apartment rows (72 m apart) and columns (125 m).
export function slotLayout() {
  const s = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const t = -0.5 + (i + 0.5) / N;
    s.push([t, -0.5, KIND.street], [-0.5, t, KIND.street]);           // south and west edges
    for (const y of [-0.27, -0.09, 0.09, 0.27]) s.push([t, y, KIND.inner]);
    for (const x of [-0.156, 0.156]) s.push([x, t, KIND.inner]);
    s.push([t + 0.5 / N, -0.5, KIND.dense], [-0.5, t + 0.5 / N, KIND.dense]);
  }
  // Spots: a seeded scatter over the block (a fixed sequence, not Math.random).
  let h = 0x9e3779b9;
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  for (let i = 0; i < 16; i++) s.push([rnd() - 0.5, rnd() - 0.5, KIND.spot]);
  return s;
}

// Can a block hold a light? True when any cover texel near it is built-up (>= 7/255, as
// cities.js). cov: the RGBA8 cover grid; nat {x, y, z: cell}; size {x: nx, y: ny}. The
// answers are cached per (level, block).
export function makeBlockTest(cov, nat, size) {
  const cache = new Map();
  return function blockUrban(level, bx, by) {
    if (!cov) return true;
    const key = (level * 4096 + (bx + 2048)) * 4096 + (by + 2048);
    let v = cache.get(key);
    if (v !== undefined) return v;
    const B = LIGHT_BLOCK * 2 ** level, cell = nat.z, nx = size.x, ny = size.y;
    // The layout rotates by up to ~25°, so take the block's circumscribed square, plus a cell.
    const r = B * 0.72 + cell;
    const cx = (bx + 0.5) * B - nat.x, cy = (by + 0.5) * B - nat.y;
    const i0 = Math.max(Math.ceil((cx - r) / cell - 0.5), 0), i1 = Math.min(Math.floor((cx + r) / cell - 0.5), nx - 1);
    const j0 = Math.max(Math.ceil((cy - r) / cell - 0.5), 0), j1 = Math.min(Math.floor((cy + r) / cell - 0.5), ny - 1);
    v = false;
    for (let j = j0; j <= j1 && !v; j++) for (let i = i0; i <= i1; i++) if (cov[(j * nx + i) * 4 + 2] >= 7) { v = true; break; }
    if (cache.size > 300000) cache.clear();
    cache.set(key, v);
    return v;
  };
}

// The blocks ring `level` draws around the camera (map x, y): relative indices [i, j, ...]
// to the snapped cell floor(cam / B). It skips blocks that aren't built-up, and (above level
// 0) blocks wholly inside the finer ring's hand-over, with a block's margin for the camera
// moving before the next refill.
export function levelBlocks(level, camX, camY, blockUrban, out = []) {
  out.length = 0;
  const B = LIGHT_BLOCK * 2 ** level;
  const cx = Math.floor(camX / B), cy = Math.floor(camY / B);
  const rIn = level > 0 ? FADE_A * LIGHT_HALF * B / 2 : -1;
  for (let j = -LIGHT_HALF; j < LIGHT_HALF; j++) for (let i = -LIGHT_HALF; i < LIGHT_HALF; i++) {
    const bx = cx + i, by = cy + j;
    if (rIn > 0) {
      const fx = Math.max(Math.abs(bx * B - camX), Math.abs((bx + 1) * B - camX));
      const fy = Math.max(Math.abs(by * B - camY), Math.abs((by + 1) * B - camY));
      if (Math.hypot(fx, fy) + B < rIn) continue;
    }
    if (!blockUrban(level, bx, by)) continue;
    out.push(i, j);
  }
  return out;
}

// The light's colour, as the shader mixes it (for the tests and the docs): led is the
// district's share of LED lamps (0..1), dense the built-up cover (0..1), h a hash (0..1).
// Sodium orange, or LED white, more of them white where the city is densest.
export function lightColor(led, dense, h) {
  const white = Math.min(1, led + Math.max(dense - 0.7, 0) * 1.0);
  return h < white ? 'led' : 'sodium';
}

const VERT = /* glsl */ `
  uniform vec2 uCell, uBase;      // the ring's snapped block index; its map corner minus the origin
  uniform float uBlock, uLevel, uHalfM;
  attribute vec2 blk;             // instance: block i, j relative to uCell
  varying vec3 vCol;
  #include <logdepthbuf_pars_vertex>
  vec3 SODIUM = vec3(1.0, 0.46, 0.13);
  vec3 LED = vec3(0.82, 0.88, 1.0);
  vec3 WARMLED = vec3(1.0, 0.80, 0.58);
  void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); }
  void main() {
    ivec2 bc = ivec2(uCell + blk);
    int lv = int(uLevel);
    vec2 centre = uBase + (blk + 0.5) * uBlock;          // map, relative to the origin
    vec2 mc = uOrigin + centre;
    float dense0 = uHasCover > 0.5 ? texture(uCover, natUv(mc)).b : 0.0;
    float ang;
    if (lv == 0) {
      // cities.js's block angle, so the inner paths run between its apartment rows.
      float ba = ihash(bc, 22u), bt = ihash(bc, 23u);
      float kindB = dense0 > 0.55 && bt < 0.62 ? 0.0 : 1.0;
      ang = (ba - 0.5) * (kindB == 0.0 ? 0.7 : 0.9);
    } else {
      ang = (ihash(bc, 40u + uint(lv)) - 0.5) * 0.9;
    }
    float kind = position.z;
    int si = gl_VertexID;
    ivec2 sk = bc * 128 + ivec2(si, lv);
    float h0 = ihash(sk, 51u), h1 = ihash(sk, 52u), h2 = ihash(sk, 53u), h3 = ihash(sk, 54u);
    // Jitter along the street (and a little across), more for the spots.
    vec2 lp = position.xy;
    bool alongX = abs(abs(lp.y) - 0.5) < 0.01 || (kind == 1.0 && abs(abs(lp.x) - 0.156) > 0.01);
    vec2 jit = (vec2(h0, h1) - 0.5) * (kind == 3.0 ? vec2(0.06) : vec2(0.05, 0.006));
    lp += alongX ? jit : jit.yx;
    lp *= uBlock;
    float ca = cos(ang), sa = sin(ang);
    vec2 pc = centre + vec2(ca * lp.x - sa * lp.y, sa * lp.x + ca * lp.y);
    vec2 m = uOrigin + pc;
    vec2 uv = natUv(m);
    // The built-up cover where the light is, and a little noise so the edge of town frays.
    float dense = uHasCover > 0.5 ? texture(uCover, uv).b : 0.0;
    float dn = dense + (vnoise(m * 0.003) - 0.5) * 0.2;
    float need = kind == 0.0 ? 0.10 + 0.30 * h2
               : kind == 1.0 ? 0.30 + 0.35 * h2
               : kind == 2.0 ? 0.62 + 0.2 * h2
               : 0.68 + 0.25 * h2;
    if (dn < need) { hide(); return; }
    // Hand over between the rings by the light's own hash.
    vec2 dc = pc - vec2(uCamPos.x, -uCamPos.z);
    float dist = length(dc);
    float tOut = smoothstep(${FADE_A} * uHalfM, ${FADE_B} * uHalfM, dist);
    float tIn = lv > 0 ? smoothstep(${FADE_A} * uHalfM * 0.5, ${FADE_B} * uHalfM * 0.5, dist) : 1.0;
    if (h3 < tOut || h3 >= tIn) { hide(); return; }
    // Off water (the 250 m distance fields, bilinear: enough for a light) and runways.
    if (uHasWater > 0.5) {
      vec2 w = (texture(uWater, uv).rg * 255.0 - 128.0) * 20.0;
      if (w.r < 30.0 || w.g < 25.0) { hide(); return; }
    }
    for (int r = 0; r < ${'${MAXR}'}; r++) {
      if (r >= uRwyCount) break;
      vec2 d = m - uRwyA[r].xy;
      float uu = dot(d, uRwyA[r].zw), vv = -d.x * uRwyA[r].w + d.y * uRwyA[r].z;
      if (abs(uu) < uRwyB[r].x + 300.0 && abs(vv) < uRwyB[r].y + 200.0) { hide(); return; }
    }
    float hgt = terrainHeight(m);
    vec3 wp = vec3(pc.x, hgt + (kind == 3.0 ? 4.0 + 20.0 * h1 * h1 : 9.0), -pc.y);
    vec3 rel = wp - uCamPos;
    wp.y -= curveDrop(rel.xz);
    rel = wp - uCamPos;
    float d3 = length(rel);

    // Colour: each 1.6 km district has its own share of LED lamps; the densest cores whiter.
    ivec2 dist16 = ivec2(floor(m / 1600.0));
    float led = ihash(dist16, 61u);
    led = led * led * 0.9;
    float white = min(1.0, led + max(dense - 0.7, 0.0) * 1.0);
    float hc = ihash(sk, 55u);
    vec3 c = hc < white ? (ihash(sk, 56u) < 0.35 ? WARMLED : LED) : SODIUM;
    float I = 1.0;
    // Arterials: every fourth block edge at level 0 (1.6 km apart), and every edge from level 2
    // (1.6 km blocks) on, brighter and mostly sodium.
    bool southEdge = abs(position.y + 0.5) < 0.01, westEdge = abs(position.x + 0.5) < 0.01;
    bool arterial = (kind == 0.0 || kind == 2.0) && (lv >= 2 || (southEdge && bc.y % 4 == 0) || (westEdge && bc.x % 4 == 0));
    if (arterial) { I = 1.7; if (hc < 0.75) c = SODIUM; }
    else if (kind == 2.0) I = 1.15;
    if (kind == 1.0) I = 0.7;
    if (kind == 3.0) {
      // Signs and shopfronts: mostly white, some neon.
      float hs = ihash(sk, 57u);
      c = hs < 0.55 ? vec3(1.0, 0.95, 0.88)
        : hs < 0.68 ? vec3(1.0, 0.18, 0.22)
        : hs < 0.78 ? vec3(0.3, 0.55, 1.0)
        : hs < 0.86 ? vec3(0.3, 1.0, 0.55)
        : hs < 0.93 ? vec3(1.0, 0.3, 0.85) : vec3(1.0, 0.75, 0.3);
      I = 1.6;
    }
    // A far light stands for the lamps of a bigger block (each ring a quarter of the density).
    // Each light dims with distance as its glow gets smaller than a pixel.
    float rep = pow(2.0, uLevel);
    I *= clamp(pow(1800.0 * rep / max(d3, 1.0), 0.9), 0.0, 1.0);
    I *= 0.6 + 0.4 * h2;
    // A slight sparkle (the air shimmering), deterministic per light, more at a distance.
    float amp = 0.12 + 0.3 * smoothstep(3000.0, 30000.0, d3);
    float tw = sin(uTime * (2.3 + 5.0 * h0) + 6.2832 * h1) * sin(uTime * (1.1 + 3.1 * h3) + 6.2832 * h2);
    I *= 1.0 + amp * tw;
    // The haze dims it (at night the haze is dark, so no in-scatter): applyHaze's extinction
    // (ATMOS_GLSL's constants, the same optical depth), at 0.6 of its depth so the lights
    // carry through it. Inlined: applyHaze itself also computes the haze colour, twice the cost.
    float e0 = exp(-max(uCamAlt, 0.0) / HAZE_H);
    float od = abs(rel.y) < 1.0 ? HAZE_SIGMA0 * e0 * d3
             : HAZE_SIGMA0 * HAZE_H * d3 / rel.y * (e0 - exp(-max(uCamAlt + rel.y, 0.0) / HAZE_H));
    od += fogDepth(rel, d3);
    vec3 ext = exp(-0.6 * od * mix(vec3(0.85, 1.0, 1.2), vec3(1.0), uFogMix));
    I *= uNight * (1.0 + 0.6 * uSnow);   // v0.4.0: snow on the ground lifts the city's light
    vCol = c * ext * I * 1.6;
    // At least about a pixel; nearer lights a little bigger (a 4 m glow).
    float px = (kind == 3.0 ? 6.0 : 4.0) * uPxScale / max(d3, 1.0);
    gl_PointSize = clamp(px, 2.0, 6.0) * step(0.002, I);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float dd = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.5 + dd * 0.002) / max(dd, 1e-3), 0.5);   // pull in a little: not into the ground
    gl_Position = projectionMatrix * mv;
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

export function createCityLights(scene, uniforms, chunks /* , { heightfield, airports } */) {
  const layout = slotLayout();
  const base = new Float32Array(layout.length * 3);
  layout.forEach((s, k) => base.set(s, k * 3));

  const covTex = uniforms.uCover && uniforms.uCover.value;
  const cov = uniforms.uHasCover && uniforms.uHasCover.value > 0.5 && covTex && covTex.image && covTex.image.data;
  const blockUrban = makeBlockTest(cov || null, uniforms.uNat.value, uniforms.uNatSize.value);

  const group = new THREE.Group();
  group.name = 'city-lights';
  const vertexShader = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.HEIGHT_GLSL}\n${chunks.ATMOS_GLSL}\n`
    + VERT.replace('${MAXR}', String(chunks.MAX_RUNWAYS));
  const rings = [];
  const list = [];
  for (let lv = 0; lv < LIGHT_LEVELS; lv++) {
    const B = LIGHT_BLOCK * 2 ** lv;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));
    const inst = new Float32Array((2 * LIGHT_HALF) ** 2 * 2);
    const attr = new THREE.InstancedBufferAttribute(inst, 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('blk', attr);
    geo.instanceCount = 0;
    const u = Object.assign({}, uniforms, {
      uCell: { value: new THREE.Vector2() },
      uBase: { value: new THREE.Vector2() },
      uBlock: { value: B },
      uLevel: { value: lv },
      uHalfM: { value: LIGHT_HALF * B },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 9;
    pts.name = `city-lights-${lv}`;
    group.add(pts);
    rings.push({ lv, B, geo, attr, inst, u, pts, gx: NaN, gy: NaN });
  }
  group.visible = false;
  scene.add(group);

  function fill(r, camMap) {
    levelBlocks(r.lv, camMap.x, camMap.y, blockUrban, list);
    r.inst.set(list);
    r.geo.instanceCount = list.length / 2;
    r.attr.needsUpdate = true;
    r.attr.clearUpdateRanges();
    r.attr.addUpdateRange(0, Math.max(list.length, 2));
  }

  const NONE = { drawCalls: 0, tris: 0, lights: 0 };
  return {
    object: group,
    slots: layout.length,
    update({ camMap, origin }) {
      const on = uniforms.uNight.value >= 0.01;
      group.visible = on;
      if (!on) return NONE;
      let calls = 0, lights = 0;
      for (const r of rings) {
        const cx = Math.floor(camMap.x / r.B), cy = Math.floor(camMap.y / r.B);
        if (cx !== r.gx || cy !== r.gy) { r.gx = cx; r.gy = cy; fill(r, camMap); }
        r.u.uCell.value.set(cx, cy);
        r.u.uBase.value.set(cx * r.B - origin.x, cy * r.B - origin.y);
        r.pts.visible = r.geo.instanceCount > 0;
        if (r.pts.visible) { calls++; lights += r.geo.instanceCount * layout.length; }
      }
      // lights: slots submitted (the shader drops the ones off the cover); points, no triangles.
      return { drawCalls: calls, tris: 0, lights };
    },
  };
}
