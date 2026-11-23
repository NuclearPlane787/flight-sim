// v0.7.8 part 4 (briefs/V0-7-8.md, the `trees` subagent): trees kept off the real centres' buildings and the landmarks,
// and the centres' parks drawn as parkland (lawns and scattered broadleaf trees), not conifer forest.
//
// Found (v0.7.5's pictures-only review): the instanced trees (detail.js) and the ground's canopy (terrain.js) follow the
// cover's tree class, and inside a real centre nothing told them where its buildings stand, so trees grew through
// Hiroshima's Peace Park museum and a conifer forest stood round the Dome and both castles.
//
// The shape: each real centre's footprints rasterised once, in the centres' worker as the centre loads (raster78()),
// into a two-channel mask over the centre's box (about 10 m a pixel, at most 2048 a side):
//   R: 255 on a footprint, grown by one pixel (a tree's crown may not stand in a wall);
//   G: the parkland share: 255 within PARK_NEAR_M of the town's fabric (50 m cells whose 150 m neighbourhood is at least
//      PARK_URBAN built over), falling to 0 at PARK_FAR_M, so a park inside the town is parkland and a forested hill at
//      a box's edge, away from the streets, stays forest (a lone temple in a wood is not "the town's fabric").
// The nearest ready centre's mask (within PICK_M of its box) is bound to uPark78 with its box; the landmarks nearest the
// camera are discs in uLmk78 (no tree within a landmark's footprint radius, inside a centre or not).
// The switch: ?trees78=0 (node FS_TREES78=0): off, no shader text changes, no uniform is added and the worker rasterises
// nothing (v0.7.7's drawing exactly). This module has no three.js import: the worker loads it.

export function trees78Switch() {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]trees78=([01])\b/.exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.FS_TREES78 === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const TREES78 = trees78Switch();

export const PX_M = 10;             // the mask's pixel (m), larger only where the box is over 20 km a side
export const MAX_SIDE = 2048;
export const COARSE_M = 50;         // the fabric's cells
export const PARK_URBAN = 0.10;     // [EST] a 150 m neighbourhood at least this share built over is the town's fabric
export const PARK_NEAR_M = 250;     // [EST] parkland within this of the fabric
export const PARK_FAR_M = 500;      // [EST] forest again from this
export const PARK_DENSITY = 0.16;   // [EST] the share of the trees a forest would have that a park keeps
export const LMK_N = 8;             // the landmarks' discs the shaders read
export const PICK_M = 20000;        // a centre's mask is bound while the camera is within this of its box

// The mask for one centre. p: parseCentre()'s (records' rings in 0.5 m units from info.origin); info: { origin, box }.
// -> { w, h, px, box: [x0, y0, x1, y1], data: Uint8Array(w * h * 2) (R, G) }. Rows run north from the box's south edge.
export function raster78(p, info) {
  const [bx0, by0, bx1, by1] = info.box, ox = info.origin[0], oy = info.origin[1];
  const px = Math.max(PX_M, (bx1 - bx0) / MAX_SIDE, (by1 - by0) / MAX_SIDE);
  const w = Math.max(1, Math.ceil((bx1 - bx0) / px)), h = Math.max(1, Math.ceil((by1 - by0) / px));
  const foot = new Uint8Array(w * h);
  const xs = new Float64Array(256), ys = new Float64Array(256), cross = new Float64Array(256);
  for (let i = 0; i < p.count; i++) {
    const s = p.vstart[i], n = p.nVerts[i];
    if (n < 3) continue;
    let ylo = Infinity, yhi = -Infinity, xlo = Infinity, xhi = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = (ox + p.xy[(s + k) * 2] / 2 - bx0) / px, y = (oy + p.xy[(s + k) * 2 + 1] / 2 - by0) / px;
      xs[k] = x; ys[k] = y;
      if (y < ylo) ylo = y; if (y > yhi) yhi = y; if (x < xlo) xlo = x; if (x > xhi) xhi = x;
    }
    const j0 = Math.max(0, Math.ceil(ylo - 0.5)), j1 = Math.min(h - 1, Math.floor(yhi - 0.5));
    if (j1 < j0) {
      // smaller than a pixel row: its middle pixel
      const ci = Math.floor((xlo + xhi) / 2), cj = Math.floor((ylo + yhi) / 2);
      if (ci >= 0 && cj >= 0 && ci < w && cj < h) foot[cj * w + ci] = 1;
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      const yc = j + 0.5;
      let nc = 0;
      for (let k = 0, l = n - 1; k < n; l = k++) {
        const ya = ys[l], yb = ys[k];
        if ((ya > yc) !== (yb > yc)) cross[nc++] = xs[l] + ((yc - ya) / (yb - ya)) * (xs[k] - xs[l]);
      }
      if (nc < 2) continue;
      const c = Array.prototype.slice.call(cross, 0, nc).sort((a, b) => a - b);
      for (let q = 0; q + 1 < nc; q += 2) {
        const i0 = Math.max(0, Math.ceil(c[q] - 0.5)), i1 = Math.min(w - 1, Math.floor(c[q + 1] - 0.5));
        for (let ii = i0; ii <= i1; ii++) foot[j * w + ii] = 1;
      }
      // a ring narrower than a pixel on this row: the pixel it lies in
      if (c[nc - 1] - c[0] < 1) { const ii = Math.floor((c[0] + c[nc - 1]) / 2); if (ii >= 0 && ii < w) foot[j * w + ii] = 1; }
    }
  }
  // The fabric: 50 m cells' built share, then their 3 x 3 neighbourhoods' share at least PARK_URBAN.
  const cw = Math.max(1, Math.ceil((w * px) / COARSE_M)), ch = Math.max(1, Math.ceil((h * px) / COARSE_M));
  const built = new Float64Array(cw * ch), area = new Float64Array(cw * ch);
  for (let j = 0; j < h; j++) {
    const cj = Math.min(ch - 1, Math.floor(((j + 0.5) * px) / COARSE_M));
    for (let i = 0; i < w; i++) {
      const c = cj * cw + Math.min(cw - 1, Math.floor(((i + 0.5) * px) / COARSE_M));
      area[c]++; built[c] += foot[j * w + i];
    }
  }
  const INF = 1e9, dist = new Float64Array(cw * ch).fill(INF);
  for (let cj = 0; cj < ch; cj++) for (let ci = 0; ci < cw; ci++) {
    let b = 0, a = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i2 = ci + di, j2 = cj + dj;
      if (i2 < 0 || j2 < 0 || i2 >= cw || j2 >= ch) continue;
      b += built[j2 * cw + i2]; a += area[j2 * cw + i2];
    }
    if (a > 0 && b / a >= PARK_URBAN) dist[cj * cw + ci] = 0;
  }
  // Chamfer distance (cells; 1 and 1.414), two passes.
  const D = Math.SQRT2;
  for (let cj = 0; cj < ch; cj++) for (let ci = 0; ci < cw; ci++) {
    const k = cj * cw + ci;
    let d = dist[k];
    if (ci > 0) d = Math.min(d, dist[k - 1] + 1);
    if (cj > 0) { d = Math.min(d, dist[k - cw] + 1); if (ci > 0) d = Math.min(d, dist[k - cw - 1] + D); if (ci < cw - 1) d = Math.min(d, dist[k - cw + 1] + D); }
    dist[k] = d;
  }
  for (let cj = ch - 1; cj >= 0; cj--) for (let ci = cw - 1; ci >= 0; ci--) {
    const k = cj * cw + ci;
    let d = dist[k];
    if (ci < cw - 1) d = Math.min(d, dist[k + 1] + 1);
    if (cj < ch - 1) { d = Math.min(d, dist[k + cw] + 1); if (ci < cw - 1) d = Math.min(d, dist[k + cw + 1] + D); if (ci > 0) d = Math.min(d, dist[k + cw - 1] + D); }
    dist[k] = d;
  }
  const share = new Float64Array(cw * ch);
  for (let k = 0; k < share.length; k++) {
    const m = dist[k] * COARSE_M, t = Math.min(Math.max((m - PARK_NEAR_M) / (PARK_FAR_M - PARK_NEAR_M), 0), 1);
    share[k] = 1 - t * t * (3 - 2 * t);
  }
  const data = new Uint8Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    // the coarse share bilinear at the pixel's centre (no 50 m steps on the ground)
    const fy = Math.min(Math.max(((j + 0.5) * px) / COARSE_M - 0.5, 0), ch - 1), cj = Math.min(Math.floor(fy), ch - 1), cj1 = Math.min(cj + 1, ch - 1), ty = fy - cj;
    for (let i = 0; i < w; i++) {
      let f = 0;
      for (let dj = -1; dj <= 1 && !f; dj++) for (let di = -1; di <= 1; di++) {
        const i2 = i + di, j2 = j + dj;
        if (i2 >= 0 && j2 >= 0 && i2 < w && j2 < h && foot[j2 * w + i2]) { f = 1; break; }
      }
      const fx = Math.min(Math.max(((i + 0.5) * px) / COARSE_M - 0.5, 0), cw - 1), ci = Math.min(Math.floor(fx), cw - 1), ci1 = Math.min(ci + 1, cw - 1), tx = fx - ci;
      const g = (share[cj * cw + ci] * (1 - tx) + share[cj * cw + ci1] * tx) * (1 - ty) + (share[cj1 * cw + ci] * (1 - tx) + share[cj1 * cw + ci1] * tx) * ty;
      data[(j * w + i) * 2] = f ? 255 : 0;
      data[(j * w + i) * 2 + 1] = Math.round(g * 255);
    }
  }
  return { w, h, px, box: [bx0, by0, bx0 + w * px, by0 + h * px], data };
}

// The shaders' uniforms (one set, shared by the trees' and the terrain's materials). uPark78Box: the bound mask's box
// (x0, y0 in map metres, then 1 / its width and height in metres; 0, 0 when none is bound). uLmk78: x, y (map metres),
// r (m), 0. The values are set in place by update78().
export const PARK78_UNIFORMS = {
  uPark78: { value: null },
  uPark78Box: { value: new Float32Array(4) },
  uLmk78: { value: new Float32Array(LMK_N * 4) },
  uLmk78N: { value: 0 },
};

export const PARK78_GLSL = /* glsl */ `
// v0.7.8 trees (parks78.js): the nearest real centre's mask (R footprints, G parkland) and the nearest landmarks.
uniform sampler2D uPark78;
uniform vec4 uPark78Box;
uniform vec4 uLmk78[${LMK_N}];
uniform float uLmk78N;
vec4 park78Tex(vec2 m) {
  vec2 uv = (m - uPark78Box.xy) * uPark78Box.zw;
  if (uPark78Box.z <= 0.0 || uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
  vec2 e = min(uv, 1.0 - uv) / uPark78Box.zw;                    // metres in from the box's edge
  vec4 t = textureLod(uPark78, uv, 0.0);
  t.g *= smoothstep(0.0, 150.0, min(e.x, e.y));
  return t;
}
float park78Built(vec2 m, vec4 t) {
  float b = step(0.25, t.r);
  for (int k = 0; k < ${LMK_N}; k++) {
    if (float(k) >= uLmk78N) break;
    vec4 l = uLmk78[k];
    if (length(m - l.xy) < l.z) b = 1.0;
  }
  return b;
}
`;

// The CPU side: the ready centres' masks (centres.js adds and drops them, with a texture it made), the landmarks'
// discs (centres.js's exclusion discs), and each frame the nearest of each into the uniforms.
const masks = new Map();     // id -> { box, tex }
let lmks = [];
let bound = null, lastLx = NaN, lastLy = NaN;
export function addMask78(id, box, tex) { masks.set(id, { box, tex }); bound = null; }
export function dropMask78(id) {
  const m = masks.get(id);
  masks.delete(id);
  if (m && bound === m) { bound = null; PARK78_UNIFORMS.uPark78.value = null; PARK78_UNIFORMS.uPark78Box.value.fill(0); }
  return m || null;
}
export function setLandmarks78(discs) { lmks = Array.isArray(discs) ? discs : []; lastLx = NaN; }
export function update78(camMap) {
  const x = camMap.x, y = camMap.y;
  let best = null, bd = PICK_M;
  for (const m of masks.values()) {
    const b = m.box, d = Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    if (d < bd) { bd = d; best = m; }
  }
  const U = PARK78_UNIFORMS;
  if (best !== bound) {
    bound = best;
    U.uPark78.value = best ? best.tex : null;
    if (best) { const b = best.box; U.uPark78Box.value.set([b[0], b[1], 1 / (b[2] - b[0]), 1 / (b[3] - b[1])]); }
    else U.uPark78Box.value.fill(0);
  }
  // The landmarks: listed again when the camera has moved 500 m.
  if (!(Math.abs(x - lastLx) < 500 && Math.abs(y - lastLy) < 500)) {
    lastLx = x; lastLy = y;
    const near = lmks.map((l) => [Math.hypot(l.x - x, l.y - y) - l.r, l]).filter((e) => e[0] < 6000).sort((a, b) => a[0] - b[0]).slice(0, LMK_N);
    const v = U.uLmk78.value;
    v.fill(0);
    near.forEach(([, l], k) => { v[k * 4] = l.x; v[k * 4 + 1] = l.y; v[k * 4 + 2] = l.r + 8; });   // (+8 m: a crown's reach)
    U.uLmk78N.value = near.length;
  }
  return bound;
}

// The trees' vertex shader (detail.js's text) -> with the mask. Anchors that must each occur once, or it throws.
function splice(src, anchor, add, where) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`parks78: anchor found ${n} times: ${anchor.slice(0, 60)}`);
  return src.replace(anchor, where === 'before' ? add + anchor : anchor + add);
}
export function trees78Vert(src) {
  let s = splice(src, 'attribute vec2 cell;\n', PARK78_GLSL, 'before');
  // no tree on a footprint or a landmark; in a park, a sixth of the forest's trees
  s = splice(s, '* step(zone, 0.001) * step(cov.b, 0.5);\n',
    `          // v0.7.8 trees: none on a real building or a landmark; a park keeps ${PARK_DENSITY} of a forest's trees.
          vec4 pk78t = park78Tex(m);
          float pk78 = pk78t.g;
          keep *= (1.0 - park78Built(m, pk78t)) * step(r2, forest * 0.92 * mix(1.0, ${PARK_DENSITY.toFixed(2)}, pk78));
`, 'after');
  // a park's trees broadleaf: a lower, rounder crown
  s = splice(s, 'vec3 p = position * vec3(sc * w, sc, sc * w);\n',
    '          if (pk78 > 0.5) { p *= vec3(1.25, 0.62, 1.25); p.y += 0.2 * sc; }   // v0.7.8 trees: broadleaf in a park (a low round crown, lifted clear of the lawn), not a conifer\n', 'after');
  s = splice(s, 'vCol = mix(vCol, vec3(0.040, 0.056, 0.025), (1.0 - thin) * 0.6);\n',
    '          if (pk78 > 0.5) vCol = mix(vec3(0.040, 0.062, 0.022), vec3(0.060, 0.072, 0.028), r2) * (0.9 + 0.2 * r3);   // v0.7.8 trees\n', 'after');
  return s;
}
// The terrain's fragment shader (terrain.js's text) -> a park's tree class drawn as lawn with scattered crowns.
export function ground78Frag(src) {
  let s = splice(src, 'void main() {', PARK78_GLSL, 'before');
  s = splice(s, '        alb = mix(alb, canopy, forest);\n',
    `        // v0.7.8 trees: in a real centre's park the tree class is parkland: mown lawn, scattered broadleaf crowns.
        {
          float pk78 = park78Tex(m).g;
          if (pk78 > 0.0) {
            vec3 lawn = mix(vec3(0.070, 0.092, 0.036), vec3(0.092, 0.108, 0.044), tex1) * (0.92 + 0.16 * tex2);
            float crowns = smoothstep(0.58, 0.66, vnoise(m * 0.055 + 17.0)) * 0.75 + smoothstep(0.70, 0.76, vnoise(m * 0.16 + 5.0)) * 0.25;
            canopy = mix(canopy, mix(lawn, canopy * 1.1, crowns), pk78);
          }
        }
`, 'before');
  return s;
}
