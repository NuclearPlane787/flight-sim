// Greenhouses (v0.6.1): the plains' plastic tunnels as low 3D models near the camera, standing
// exactly on the glass stripes of ground.js's greenhouseGround() (the terrain draws those stripes
// wherever the fine cover's built-up pixels lie in farm country; terrain.js's `glassy`).
//
// One instanced mesh round the camera (about ±0.95 km), placed on the GPU as rural.js places its
// houses. A slot is (block, k, s): the ground's 125 m block (4 fine pixels; integer cell bc), the
// tunnel across it (k) and a 15.625 m segment along it (s). In the block's rotated frame
// q = R(ang) * bl (bl: metres east and north of the block's south-west corner, 0..125; ang a
// multiple of 45 degrees per 250 m, ihash(bc >> 1, 81)), tunnel k's centre line is q.x = 7 (k + 0.5)
// (the stripe's middle, where fract(q.x / 7) = 0.5) and it runs along q.y. Each segment is cut to
// the part of that line whose whole 5.4 m width lies inside the block's square minus its lane, so a
// tunnel ends at the lane in every direction and never pokes into the next block. Segments abut,
// so a row of them reads as one tunnel.
// The CPU lists the slots that can hold a tunnel (greenhouseSlots(): exact hashes, the block's
// fine pixels, the 250 m cover's bounds), a superset of the shader's rule; the shader decides the
// rest (the patch noise, the slope, water, runways). A slot listed and not kept draws nothing.
// Positions come from fine-pixel integers and small offsets (briefs/V0-6-0.md, "Precision far from the
// origin"), never from float32 map metres.

import * as THREE from '../../vendor/three.module.js';
import { FINE_GLSL, FINE_PX, ihash, glassPatch } from './finecover.js';
import { coverReader } from './clipwindow.js';

export const GH_BLOCK_PX = 4;                       // fine pixels a block (ground.js latCell(fp, 4))
export const GH_BLOCK = GH_BLOCK_PX * FINE_PX;      // 125 m
export const GH_PITCH = 7.0;                        // m between tunnels (ground.js: fract(q.x / 7))
export const GH_SEG = FINE_PX / 2;                  // 15.625 m a segment along the tunnel
export const GH_HALF_W = 2.7;                       // half the tunnel's width (m)
export const GH_HEIGHT = 2.7;                       // its height (m)
export const GH_LANE = 3.6;                         // the lane round each block (ground.js: glass from 3.5 m)
export const GH_MIN_LEN = 1.0;                      // a cut segment shorter than this is dropped
export const GH_OPEN = 0.86;                        // ihash(bc, 83) >= this: an open block (no glass)
export const GH_K = [-26, 17];                      // tunnel indices that can reach the block's square (all four directions)
export const GH_S = [-6, 11];                       // segment indices along (q.y spans -88..177 m at 135 and 45 degrees)
export const GH_RB = 8;                             // blocks each side of the camera's block (±1 km)
export const GH_SNAP = 4;                           // the list's anchor moves 500 m at a time
export const GH_SPAN = 2 * GH_RB + GH_SNAP;         // blocks a side the list covers (every camera block of one anchor ±GH_RB)
export const GH_FADE = [780, 940];                  // m (the larger of |dx|, |dy| to the segment's middle): full height, then flat
export const GH_MAX_AGL = 1200;                     // m above the ground: nothing above this (fades from 70 %)
export const GH_SINK = 0.12;                        // m the tunnel stands below the ground's height
export const GH_CAPACITY = 20000;                   // slots the buffer holds (280k triangles at most)
export const GH_TRIS = 14;                          // triangles a segment
const X0 = -400000, Y0 = -400000;                   // the fine lattice's origin (finecover.js)

// The block's direction, as the shader computes it (float32 angle), and its cos and sin.
export function blockDir(bx, by) {
  const a = Math.floor(ihash(bx >> 1, by >> 1, 81) * 4);
  const ang = Math.fround(a * Math.fround(0.7854));
  return { a, ca: Math.cos(ang), sa: Math.sin(ang) };
}

// Clip the interval [t0, t1] (iv) of t to where A + t * B lies in [lo, hi] (the shader's clipSpan).
function clipSpan(iv, A, B, lo, hi) {
  if (Math.abs(B) < 1e-4) { if (A < lo || A > hi) { iv[0] = 1; iv[1] = -1; } return; }
  const t0 = (lo - A) / B, t1 = (hi - A) / B;
  iv[0] = Math.max(iv[0], Math.min(t0, t1)); iv[1] = Math.min(iv[1], Math.max(t0, t1));
}

// Where tunnel k of a block runs: the along-interval [t0, t1] (metres of q.y) in which its whole
// width lies inside [lo, hi]^2 of the block (bl). Across axis in bl: (ca, -sa); along: (sa, ca).
// m: a margin, positive to widen (the CPU's generous side). Writes into iv; returns iv.
export function tunnelSpan(ca, sa, k, m = 0, iv = [0, 0]) {
  const lo = GH_LANE - m, hi = GH_BLOCK - GH_LANE + m, w = GH_HALF_W - m, cq = GH_PITCH * (k + 0.5);
  iv[0] = -1e4; iv[1] = 1e4;
  for (const side of [-w, w]) {
    const qx = cq + side;
    clipSpan(iv, qx * ca, sa, lo, hi);       // bl.x = qx ca + t sa
    clipSpan(iv, -qx * sa, ca, lo, hi);      // bl.y = -qx sa + t ca
  }
  return iv;
}

// A segment's cut [a, b] along its tunnel, or null if shorter than minLen.
export function segmentCut(iv, s, minLen = GH_MIN_LEN) {
  const a = Math.max(s * GH_SEG, iv[0]), b = Math.min((s + 1) * GH_SEG, iv[1]);
  return b - a > minLen ? [a, b] : null;
}

// The blocks of the GH_SPAN x GH_SPAN square from (ai - GH_RB, aj - GH_RB), nearest to the
// middle of the anchor's SNAP x SNAP first (where the camera is), so a full buffer drops the far ones.
const ORDER = (() => {
  const o = [], c = GH_SNAP / 2;
  for (let j = -GH_RB; j < -GH_RB + GH_SPAN; j++) for (let i = -GH_RB; i < -GH_RB + GH_SPAN; i++) o.push([i, j, (i + 0.5 - c) ** 2 + (j + 0.5 - c) ** 2]);
  o.sort((p, q) => p[2] - q[2]);
  return o.map(([i, j]) => [i, j]);
})();

const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

// The slots that may hold a tunnel segment, for the blocks round anchor block (ai, aj): a superset
// of the shader's rule. texel(P, Q): the fine cover's class + 1 (built-up is 6); coverAt(x0, y0,
// x1, y1, mm): the 250 m cover's least built-up share, most farm share and least airfield mark
// (0..1) over the texels the shader's bilinear samples in that map rectangle can touch, into
// mm[0..2]; null: no cover (the shader keeps nothing). Writes (block offset i, j from the anchor,
// k, s) into `out` (four floats a slot), at most `cap` slots; returns how many.
// patch(px, py): the glass patch's value at a fine pixel (finecover.js's glassPatch; a test may pass its own).
export function greenhouseSlots(ai, aj, texel, coverAt, out, cap = GH_CAPACITY, patch = glassPatch) {
  if (!coverAt) return 0;
  const E = 1e-6, M = 0.02, R = 0.15, CM = 0.01, KEEP = 0.5;
  const mm = [0, 0, 0], iv = [0, 0], px = new Uint8Array(16);
  cap = Math.min(cap, Math.floor(out.length / 4));
  let n = 0;
  for (const [i, j] of ORDER) {
    const bx = ai + i, by = aj + j;
    if (ihash(bx, by, 83) >= GH_OPEN + E) continue;                 // an open block (both kept where unsure)
    let any = false;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) { const c = texel(bx * GH_BLOCK_PX + a, by * GH_BLOCK_PX + b); px[b * 4 + a] = c; if (c === 6) any = true; }
    if (!any) continue;
    const x0 = X0 + bx * GH_BLOCK, y0 = Y0 + by * GH_BLOCK;
    coverAt(x0 - 1, y0 - 1, x0 + GH_BLOCK + 1, y0 + GH_BLOCK + 1, mm);
    // The shader keeps where each factor of `glassy` is over KEEP; drop only where one certainly isn't.
    if (1 - smooth(0.12, 0.30, mm[0] - CM) <= KEEP - 1e-3) continue;
    if (smooth(0.10, 0.30, mm[1] + CM) <= KEEP - 1e-3) continue;
    if (mm[2] - CM > 0.2) continue;
    const { ca, sa } = blockDir(bx, by);
    for (let k = GH_K[0]; k <= GH_K[1]; k++) {
      tunnelSpan(ca, sa, k, M, iv);
      if (iv[1] - iv[0] <= GH_MIN_LEN - 0.2) continue;
      const cq = GH_PITCH * (k + 0.5);
      for (let s = GH_S[0]; s <= GH_S[1]; s++) {
        const cut = segmentCut(iv, s, GH_MIN_LEN - 0.2);
        if (!cut) continue;
        const tm = 0.5 * (cut[0] + cut[1]);
        const mx = cq * ca + tm * sa, my = -cq * sa + tm * ca;      // the middle in bl (m)
        // Its fine pixel, or any within R of it (the shader's float32 may fall either side).
        const pa0 = Math.max(0, Math.floor((mx - R) / FINE_PX)), pa1 = Math.min(3, Math.floor((mx + R) / FINE_PX));
        const pb0 = Math.max(0, Math.floor((my - R) / FINE_PX)), pb1 = Math.min(3, Math.floor((my + R) / FINE_PX));
        let built = false;
        for (let pb = pb0; pb <= pb1 && !built; pb++) for (let pa = pa0; pa <= pa1; pa++) if (px[pb * 4 + pa] === 6) { built = true; break; }
        if (!built) continue;
        // The glass patch (finecover.js's glassPatch, the same lattice as the shader's): the shader keeps
        // at 0.54 and over (smoothstep(0.50, 0.58) at a half); a margin for its float32.
        if (patch(bx * GH_BLOCK_PX + mx / FINE_PX, by * GH_BLOCK_PX + my / FINE_PX) < 0.53) continue;
        if (n >= cap) return n;
        out[n * 4] = i; out[n * 4 + 1] = j; out[n * 4 + 2] = k; out[n * 4 + 3] = s;
        n++;
      }
    }
  }
  return n;
}

// One segment: a half-ellipse arch of four flat facets over x (across, -1..1) and y (up, 0..1),
// from z = 0 to z = 1 (along), with its two end caps; 26 vertices, 14 triangles, indexed. The
// shader scales it (x by GH_HALF_W, y by the height, z to the segment's cut). Attribute normal: the
// unit shape's (the shader applies the inverse scale). The object frame (across, up, along) maps
// to the scene with a reflection (across x along = up on the map), so each triangle is wound
// clockwise about its outward normal here, which the scene sees anticlockwise from outside.
export function tunnelGeometry() {
  const P = [], N = [], I = [];
  const prof = [];
  for (let i = 0; i <= 4; i++) { const th = Math.PI * i / 4; prof.push([Math.cos(th), Math.sin(th)]); }
  prof[2][0] = 0; prof[4][1] = 0;
  const vert = (p, n) => { P.push(...p); N.push(...n); return P.length / 3 - 1; };
  const tri = (a, b, c, n) => {
    const pa = P.slice(a * 3, a * 3 + 3), pb = P.slice(b * 3, b * 3 + 3), pc = P.slice(c * 3, c * 3 + 3);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) I.push(a, b, c); else I.push(a, c, b);
  };
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), n = [dy / l, -dx / l, 0];
    const a = vert([x0, y0, 0], n), b = vert([x1, y1, 0], n), c = vert([x1, y1, 1], n), d = vert([x0, y0, 1], n);
    tri(a, b, c, n); tri(a, c, d, n);
  }
  for (const z of [0, 1]) {
    const n = [0, 0, z ? 1 : -1];
    const v = prof.map(([x, y]) => vert([x, y, z], n));
    for (let i = 1; i < 4; i++) tri(v[0], v[i], v[i + 1], n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// fine: finecover.js's object (terrain.fine). Without it the layer draws nothing.
export function createGreenhouses(scene, uniforms, chunks, { fine = null } = {}) {
  const base = tunnelGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  geo.setIndex(base.getIndex());
  const slots = new Float32Array(GH_CAPACITY * 4);
  const slotAttr = new THREE.InstancedBufferAttribute(slots, 4);
  slotAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('slot', slotAttr);
  geo.instanceCount = 0;
  const u = Object.assign({}, uniforms, {
    uGBlock: { value: new THREE.Vector2() },     // the list's anchor block (125 m cells of the fine lattice), an integer
  });
  let listAi = NaN, listAj = NaN, listVersion = -1, covVersion = -1, listN = 0;
  let cov = null;
  const nat = uniforms.uNat ? uniforms.uNat.value : null;
  const cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  // The 250 m cover's bounds over the texels any bilinear sample in the rectangle reads.
  const coverAt = (x0, y0, x1, y1, mm) => {
    const i0 = Math.floor((x0 - nat.x) / nat.z - 0.5), i1 = Math.floor((x1 - nat.x) / nat.z - 0.5) + 1;
    const j0 = Math.floor((y0 - nat.y) / nat.z - 0.5), j1 = Math.floor((y1 - nat.y) / nat.z - 0.5) + 1;
    let bmin = 255, gmax = 0, amin = 255;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ii = cl(i, cov.lo[0], cov.hi[0]), jj = cl(j, cov.lo[1], cov.hi[1]);
      bmin = Math.min(bmin, cov.at(ii, jj, 2)); gmax = Math.max(gmax, cov.at(ii, jj, 1)); amin = Math.min(amin, cov.at(ii, jj, 3));
    }
    mm[0] = bmin / 255; mm[1] = gmax / 255; mm[2] = amin / 255;
  };
  const relist = (ai, aj) => {
    listN = cov && nat ? greenhouseSlots(ai, aj, fine.reader(), coverAt, slots, GH_CAPACITY) : 0;
    slotAttr.clearUpdateRanges(); slotAttr.addUpdateRange(0, Math.max(listN * 4, 4)); slotAttr.needsUpdate = true;
    geo.instanceCount = listN;
    listAi = ai; listAj = aj; listVersion = fine.version; covVersion = cov ? cov.version() : -2;
  };
  const LO = GH_LANE, HI = GH_BLOCK - GH_LANE;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.NOISE_GLSL}
      ${chunks.HEIGHT_GLSL}
      ${FINE_GLSL}
      uniform ivec2 uGBlock;
      attribute vec4 slot;
      varying vec3 vRel, vN;
      varying float vAlong, vTint, vSide;
      #include <logdepthbuf_pars_vertex>
      // Clip the interval iv of t to where A + t * B lies in [lo, hi].
      vec2 clipSpan(vec2 iv, float A, float B, float lo, float hi) {
        if (abs(B) < 1e-4) return (A < lo || A > hi) ? vec2(1.0, -1.0) : iv;
        float t0 = (lo - A) / B, t1 = (hi - A) / B;
        return vec2(max(iv.x, min(t0, t1)), min(iv.y, max(t0, t1)));
      }
      void main() {
        ivec2 bc = uGBlock + ivec2(floor(slot.xy + 0.5));         // the block (ground.js's latCell(fp, 4, bc, bl))
        float ang = floor(ihash(bc >> 1, 81u) * 4.0) * 0.7854;     // ground.js's greenhouseGround(), exactly
        float ca = cos(ang), sa = sin(ang);
        vec2 ax = vec2(ca, -sa), al = vec2(sa, ca);                // across and along the tunnels, in bl (east, north)
        float cq = ${f(GH_PITCH)} * (slot.z + 0.5);                // the tunnel's centre line: q.x = 7 (k + 0.5)
        vec2 iv = vec2(-1e4, 1e4);
        float qa = cq - ${f(GH_HALF_W)}, qb = cq + ${f(GH_HALF_W)};
        iv = clipSpan(iv, qa * ca, sa, ${f(LO)}, ${f(HI)});
        iv = clipSpan(iv, -qa * sa, ca, ${f(LO)}, ${f(HI)});
        iv = clipSpan(iv, qb * ca, sa, ${f(LO)}, ${f(HI)});
        iv = clipSpan(iv, -qb * sa, ca, ${f(LO)}, ${f(HI)});
        float a = max(slot.w * ${f(GH_SEG)}, iv.x), b = min((slot.w + 1.0) * ${f(GH_SEG)}, iv.y);
        vec2 blm = cq * ax + (0.5 * (a + b)) * al;                 // the segment's middle in the block (m)
        ivec2 P = bc * ${GH_BLOCK_PX} + clamp(ivec2(floor(blm / ${f(FINE_PX)})), ivec2(0), ivec2(${GH_BLOCK_PX - 1}));
        vec2 borg = vec2(bc * ${GH_BLOCK_PX} - uFineOrg);          // the block's corner, fine pixels from the origin's
        float keep = step(${f(GH_MIN_LEN)}, b - a) * (ihash(bc, 83u) < ${f(GH_OPEN)} ? 1.0 : 0.0);
        keep *= (fineTexel(P) == 6 ? 1.0 : 0.0) * uFineOn * step(24.0, fineInside(borg + blm / ${f(FINE_PX)}));
        if (keep < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        // Glass country (terrain.js's glassy), and no airfield, runway or water, at the middle.
        vec2 pmm = (borg - uFineFrac) * ${f(FINE_PX)} + blm;       // metres east, north of the scene origin
        vec2 mm = sceneToMap(vec3(pmm.x, 0.0, -pmm.y));
        vec4 cov = uHasCover > 0.5 ? texture(uCover, natUv(mm)) : vec4(0.0);
        vec2 nn = texture(uNormal, natUv(mm)).rg * (255.0 / 127.0) - (128.0 / 127.0);
        float glassy = (1.0 - smoothstep(0.12, 0.30, cov.b)) * smoothstep(0.10, 0.30, cov.g) * (1.0 - smoothstep(0.03, 0.06, length(nn)));
        glassy *= smoothstep(0.50, 0.58, glassPatch(borg + blm / ${f(FINE_PX)}));
        float pwm, zonem;
        float rawm = rawHeight(mm, pwm);
        flattenRunways(mm, rawm, zonem);                           // for the zone only
        keep *= step(0.5, glassy) * step(cov.a, 0.2) * step(zonem, 0.001) * step(20.0, seaDistance(mm, rawm)) * step(15.0, inlandDistance(mm));
        // Near the camera only, and low: the height goes to nothing towards the range's edge.
        vec2 dc = pmm - vec2(uCamPos.x, -uCamPos.z);
        float grow = (1.0 - smoothstep(${f(GH_FADE[0])}, ${f(GH_FADE[1])}, max(abs(dc.x), abs(dc.y))))
                   * (1.0 - smoothstep(${f(GH_MAX_AGL * 0.7)}, ${f(GH_MAX_AGL)}, uCamAgl));
        keep *= step(0.05, grow);
        if (keep < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        // The vertex: across x, up y, along z (0..1 over the cut [a, b]); its own ground height.
        float hh = ${f(GH_HEIGHT)} * grow;
        float t = mix(a, b, position.z);
        vec2 pm = (borg - uFineFrac) * ${f(FINE_PX)} + (cq + position.x * ${f(GH_HALF_W)}) * ax + t * al;
        vec3 wp = vec3(pm.x, 0.0, -pm.y);
        vec2 m = sceneToMap(wp);
        float pw, zone;
        float raw = rawHeight(m, pw);
        float gh = max(flattenRunways(m, raw, zone), 0.0);
        wp.y = gh - ${f(GH_SINK)} + position.y * hh;
        vec3 rel = wp - uCamPos;
        wp.y -= curveDrop(rel.xz);
        vRel = wp - uCamPos;
        vec3 nl = normalize(vec3(normal.x / ${f(GH_HALF_W)}, normal.y / hh, normal.z));   // the inverse scale
        vec2 nm = nl.x * ax + nl.z * al;
        vN = vec3(nm.x, nl.y, -nm.y);
        vAlong = t;
        vTint = 0.9 + 0.2 * ihash(bc, 82u);                        // as the ground's glass
        vSide = 1.0 - abs(normal.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.NOISE_GLSL}
      varying vec3 vRel, vN;
      varying float vAlong, vTint, vSide;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vN);
        // Pale film, a touch brighter than the ground's glass stripe (0.31, 0.32, 0.32).
        vec3 alb = vec3(0.33, 0.34, 0.34) * vTint;
        // A faint darker band at each hoop (every 2 m), averaged out once a hoop is under a pixel.
        float hp = abs(fract(vAlong / 2.0) - 0.5) * 2.0;           // 1 at a hoop
        float fw = fwidth(vAlong) / 2.0;
        float band = mix(smoothstep(0.82, 0.94, hp), 0.15, smoothstep(0.15, 0.6, fw));
        alb *= 1.0 - 0.14 * band * vSide;
        if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.5, 0.9, n.y));
        // The terrain's own lighting (terrain.js), so the film sits with the ground's stripes.
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.4 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'greenhouses';
  mesh.visible = false;
  scene.add(mesh);
  return {
    mesh,
    get listed() { return listN; },
    // camMap: the camera's map position; agl: its height above the ground (m).
    update(camMap, origin, agl) {
      const on = !!fine && agl < GH_MAX_AGL && uniforms.uFineOn && uniforms.uFineOn.value > 0.5;
      if (!on) { mesh.visible = false; return { tris: 0, drawCalls: 0 }; }
      if (!cov) cov = coverReader(uniforms);
      const ci = Math.floor((camMap.x - X0) / GH_BLOCK), cj = Math.floor((camMap.y - Y0) / GH_BLOCK);
      const ai = Math.floor(ci / GH_SNAP) * GH_SNAP, aj = Math.floor(cj / GH_SNAP) * GH_SNAP;
      if (ai !== listAi || aj !== listAj || fine.version !== listVersion || (cov ? cov.version() : -2) !== covVersion) relist(ai, aj);
      u.uGBlock.value.set(ai, aj);
      mesh.visible = listN > 0;
      return listN > 0 ? { tris: GH_TRIS * listN, drawCalls: 1 } : { tris: 0, drawCalls: 0 };
    },
    dispose() { scene.remove(mesh); geo.dispose(); base.dispose(); mat.dispose(); },
  };
}
