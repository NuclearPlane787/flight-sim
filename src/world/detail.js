// Surface detail (fine, procedural, seeded by map position so it never changes between runs):
//   - field plots in farmland, with rice paddies on flat valley floors: a pattern in the
//     terrain's fragment shader (FIELDS_GLSL), fading out with distance and height;
//   - instanced simple trees in forest cover, placed on the GPU around the camera.

import * as THREE from '../../vendor/three.module.js';
import { GROUND_ON } from './region.js';
import { FINE_GLSL } from './finecover.js';

// ------------------------------------------------------------------ field plots (GLSL)

// Needs NOISE_GLSL. Returns the farmland colour (linear RGB) at map position m.
// paddy: 0..1 (flat valley floor), fade: 1 = full plot pattern, 0 = just the average colour.
export const FIELDS_GLSL = /* glsl */ `
vec3 fieldColor(vec2 m, float paddy, float fade) {
  // Late October: harvested paddies (straw, stubble, wet mud), some green winter crops,
  // bare tilled soil, greenhouses (white) here and there.
  // Macro variation (a few km): whole districts greener (winter crops, fallow) or browner
  // (tilled), so farmland reads as a patchwork from cruise, not one flat beige.
  float mv = 0.6 * vnoise(m * 0.0007 + 5.0) + 0.4 * vnoise(m * 0.0031 + 2.0);
  vec3 tintM = mix(vec3(0.80, 0.94, 0.80), vec3(1.0), smoothstep(0.30, 0.55, mv));
  tintM = mix(tintM, vec3(1.02, 0.86, 0.80), smoothstep(0.60, 0.80, mv));
  vec3 avg = mix(vec3(0.115, 0.104, 0.054), vec3(0.150, 0.122, 0.060), paddy) * tintM;
  if (fade <= 0.001) return avg;
  // Plot grid, rotated per ~700 m district so it doesn't look like graph paper.
  ivec2 dc = ivec2(floor(m / 700.0));
  float ang = (ihash(dc, 7u) - 0.5) * 1.2;
  float ca = cos(ang), sa = sin(ang);
  vec2 p = vec2(ca * m.x - sa * m.y, sa * m.x + ca * m.y);
  vec2 size = paddy > 0.5 ? vec2(36.0, 95.0) : vec2(70.0, 140.0);   // discrete: a varying size warps the grid
  // Rows of plots: each row gets its own offset so the plot edges don't line up.
  float row = floor(p.y / size.y);
  p.x += ihash(ivec2(int(row), dc.x), 3u) * size.x;
  vec2 c = floor(p / size);
  vec2 fr = fract(p / size);
  float h = ihash(ivec2(c) + dc * 1000, 11u);
  vec3 col;
  if (paddy > 0.5) {
    col = h < 0.55 ? vec3(0.27, 0.21, 0.09)       // straw stubble
        : h < 0.80 ? vec3(0.17, 0.12, 0.065)      // wet mud
        : h < 0.93 ? vec3(0.30, 0.24, 0.10)       // not yet cut, golden
        : vec3(0.10, 0.13, 0.055);                // green
  } else {
    col = h < 0.30 ? vec3(0.15, 0.17, 0.06)       // green crop
        : h < 0.55 ? vec3(0.19, 0.13, 0.07)       // tilled soil
        : h < 0.80 ? vec3(0.24, 0.20, 0.10)       // stubble
        : h < 0.93 ? vec3(0.13, 0.15, 0.07)       // fallow grass
        : h < 0.985 ? vec3(0.12, 0.13, 0.06) : vec3(0.21, 0.22, 0.22);   // greenhouses (rare)
  }
  col *= 0.85 + 0.3 * vnoise(m * 0.08 + h * 50.0);
  // Bunds and field edges: thin lighter lines between the plots (antialiased).
  vec2 e = min(fr, 1.0 - fr) * size;
  vec2 w = fwidth(p) * 0.7 + 0.01;
  float edge = 1.0 - smoothstep(0.8, 0.8 + w.x + w.y, min(e.x, e.y));
  col = mix(col, vec3(0.16, 0.16, 0.08), edge * 0.7);
  return mix(avg, col * mix(vec3(1.0), tintM, 0.6) * 0.85, fade);
}
`;

// ------------------------------------------------------------------ trees

// Rings of instance grids around the camera. Spacing (m), half size in cells, tree scale.
const TREE_LEVELS = [
  { spacing: 7, half: 40, scale: 1.0 },
  { spacing: 14, half: 40, scale: 1.25 },
  { spacing: 28, half: 40, scale: 1.6 },
];
export const TREE_MAX_AGL = 1000;   // m above the ground: no trees above this
// v0.6.0 Part 7 (behind GROUND_ON): two more rings (clumps, to 2.2 and 4.5 km), trees to 3,000 m
// above the ground, and near the camera the fine cover's own tree pixels (woodlots, the woods'
// real edges) instead of the 250 m forest share.
const TREE_LEVELS_FAR = [
  { spacing: 56, half: 40, scale: 1.7 },
  { spacing: 112, half: 40, scale: 2.0 },
];
const TREE_MAX_AGL_GROUND = 3000;

// A low-poly tree: a short trunk and a 6-sided cone crown (two tiers). Unit height ~1.
function treeGeometry() {
  const pos = [], nrm = [], kind = [];
  const tri = (a, b, c, k, na, nb, nc) => {
    pos.push(...a, ...b, ...c);
    nrm.push(...na, ...nb, ...nc);
    kind.push(k, k, k);
  };
  const cone = (y0, y1, r, k) => {
    const S = 6;
    for (let i = 0; i < S; i++) {
      const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
      const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      const n0 = [Math.cos(a0), 0.5, Math.sin(a0)], n1 = [Math.cos(a1), 0.5, Math.sin(a1)];
      const am = (a0 + a1) / 2;
      tri(p1, p0, [0, y1, 0], k, n1, n0, [Math.cos(am), 0.6, Math.sin(am)]);
    }
  };
  cone(0.25, 1.0, 0.36, 1);
  cone(0.55, 1.12, 0.26, 1);
  // trunk: a thin 3-sided prism (left out: invisible at these sizes, saves 6 triangles a tree)
  for (let i = 0; i < 0; i++) {
    const a0 = (i / 3) * Math.PI * 2, a1 = ((i + 1) / 3) * Math.PI * 2, r = 0.05;
    const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const q0 = [p0[0], 0.3, p0[2]], q1 = [p1[0], 0.3, p1[2]];
    const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
    tri(p1, p0, q0, 0, n, n, n);
    tri(p1, q0, q1, 0, n, n, n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  return g;
}

// Instance cell offsets of a ring (the inner half is left to the finer level).
function ringCells(half, hole) {
  const cells = [];
  for (let j = -half; j < half; j++) for (let i = -half; i < half; i++) {
    if (hole > 0 && i >= -hole && i < hole && j >= -hole && j < hole) continue;
    cells.push(i, j);
  }
  return new Float32Array(cells);
}

export function createTrees(scene, uniforms, chunks) {
  const base = treeGeometry();
  const group = new THREE.Group();
  group.name = 'trees';
  const levels = [];
  let shown = 0;
  const G = GROUND_ON;                                   // fixed at page load: compiled in or not
  const LEVELS = G ? TREE_LEVELS.concat(TREE_LEVELS_FAR) : TREE_LEVELS;
  const MAX_AGL = G ? TREE_MAX_AGL_GROUND : TREE_MAX_AGL;
  LEVELS.forEach((L, k) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = null;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('kind', base.getAttribute('kind'));
    const ring = ringCells(L.half, k === 0 ? 0 : L.half / 2);
    // v0.6.0 Part 7: a ring can also fill its own hole (the cells after the ring's), for when the
    // finer ring inside it is switched off with height (update() below).
    const fill = G && k > 0 ? ringCells(L.half / 2, 0) : null;
    let cells = ring;
    if (fill) { cells = new Float32Array(ring.length + fill.length); cells.set(ring); cells.set(fill, ring.length); }
    const ringCount = ring.length / 2, fullCount = cells.length / 2;
    geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = ringCount;
    const u = {
      ...uniforms,
      uGridBase: { value: new THREE.Vector2() },     // scene position of cell (0,0) of the snapped grid
      uGridCell: { value: new THREE.Vector2() },     // its integer map cell index (exact in float up to 2^24)
      uSpacing: { value: L.spacing },
      uTreeScale: { value: L.scale },
      uRange: { value: L.spacing * L.half },
      uInner: { value: k === 0 ? 0 : L.spacing * L.half / 2 },
      uOuter: { value: k === LEVELS.length - 1 ? 1 : 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `
        ${chunks.UNIFORMS_GLSL}
        ${chunks.NOISE_GLSL}
        ${chunks.HEIGHT_GLSL}
        ${G ? FINE_GLSL : ''}
        uniform vec2 uGridBase, uGridCell;
        uniform float uSpacing, uTreeScale, uRange, uInner, uOuter;
        attribute vec2 cell;
        attribute float kind;
        varying vec3 vRel, vNormal, vCol;
        varying float vKind;
        #include <logdepthbuf_pars_vertex>
        void main() {
          ivec2 ic = ivec2(uGridCell + cell);
          float r0 = ihash(ic, 1u), r1 = ihash(ic, 2u), r2 = ihash(ic, 3u), r3 = ihash(ic, 4u);
          vec2 local = uGridBase + (cell + 0.15 + 0.7 * vec2(r0, r1)) * uSpacing;   // scene x, -z
          vec3 wp = vec3(local.x, 0.0, -local.y);
          vec2 m = sceneToMap(wp);
          vec2 uv = natUv(m);
          vec4 cov = uHasCover > 0.5 ? texture(uCover, uv) : vec4(0.0);
          float pw, zone;
          float raw = rawHeight(m, pw);
          float h = max(flattenRunways(m, raw, zone), 0.0);
          // Without cover data: forest on slopes, like most Korean hills.
          vec2 nn = texture(uNormal, uv).rg * (255.0 / 127.0) - (128.0 / 127.0);
          float slope = length(nn);
          float forest = uHasCover > 0.5 ? cov.r : smoothstep(0.06, 0.2, slope) * step(30.0, raw);
          float wob = vnoise(m * 0.012) - 0.5 + 0.5 * (vnoise(m * 0.05) - 0.5);
          forest = smoothstep(0.35, 0.65, forest + wob * 0.5);
          ${G ? `// The fine cover's own pixel, where the window holds one: a tree pixel or not.
          vec2 tfp = finePos(wp.xz);
          if (uFineOn > 0.5 && fineInside(tfp) > 1.0 && cov.a < 0.2) {   // (not inside an airfield)
            int fc = fineTexel(ivec2(floor(tfp)) + uFineOrg);
            if (fc != 0) forest = fc == 2 ? 1.0 : 0.0;
          }` : ''}
          float sea = seaDistance(m, raw), inl = inlandDistance(m);
          float keep = step(r2, forest * 0.92) * step(4.0, sea) * step(4.0, inl) * step(zone, 0.001) * step(cov.b, 0.5);
          // Thin out towards the edge of the ring and with height above the ground.
          vec2 dc = local - uCamPos.xz * vec2(1.0, -1.0);
          float d = max(abs(dc.x), abs(dc.y));
          float edge = 1.0 - smoothstep(uRange * 0.8, uRange * 0.97, d);
          // The outermost ring ends in a ragged circle instead of a square: trees thin out
          // (fewer, a bit smaller, closer to the ground's canopy colour) over its outer half,
          // with the boundary pushed in and out by noise, so the edge of the tree area doesn't
          // read as a line from a couple of thousand feet.
          float thin = 1.0;
          if (uOuter > 0.5) {
            float dr = length(dc) + (vnoise(m * 0.0035 + 7.0) - 0.5) * 0.3 * uRange;
            thin = 1.0 - smoothstep(uRange * 0.58, uRange * 0.98, dr);
            edge = step(ihash(ic, 5u), thin) * mix(0.55, 1.0, thin);
          }
          float inner = uInner > 0.0 ? smoothstep(uInner * 0.9, uInner * 1.02, d) : 1.0;
          float sc = keep * edge * inner * uTreeScale * (8.0 + 9.0 * r3) * (1.0 - smoothstep(${(MAX_AGL * 0.6).toFixed(1)}, ${MAX_AGL.toFixed(1)}, uCamAgl));
          float w = 1.0 + 0.5 * r0;
          vec3 p = position * vec3(sc * w, sc, sc * w);
          float a = r1 * 6.2832;
          p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
          wp += p;
          wp.y += h - 0.3 * sc;
          vec3 rel = wp - uCamPos;
          wp.y -= curveDrop(rel.xz);
          vRel = wp - uCamPos;
          vNormal = normal;
          vKind = kind;
          // Pines and broadleaf, some in autumn colours.
          vec3 green = mix(vec3(0.022, 0.040, 0.016), vec3(0.040, 0.058, 0.024), r2);
          vec3 autumn = mix(vec3(0.13, 0.045, 0.015), vec3(0.15, 0.10, 0.02), r0);
          ${G ? 'autumn = mix(green, autumn, 0.5) * 0.85;   // Part 7: russet, not orange: against the new ground the bright ones read as traffic cones' : ''}
          vCol = mix(green, autumn, step(0.80, r3) * step(r1, 0.6)${G ? ' * (uSpacing > 30.0 ? 0.35 : 1.0)' : ''});
          vCol = mix(vCol, vec3(0.040, 0.056, 0.025), (1.0 - thin) * 0.6);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        ${chunks.UNIFORMS_GLSL}
        ${chunks.ATMOS_GLSL}
        varying vec3 vRel, vNormal, vCol;
        varying float vKind;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vNormal);
          vec3 alb = vKind < 0.5 ? vec3(0.05, 0.035, 0.02) : vCol;
          if (uSnow > 0.0) alb = mix(alb, vec3(0.45, 0.48, 0.52), uSnow * 0.5 * smoothstep(0.3, 0.85, n.y));   // v0.4.0: snow on the canopies
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 col = alb * (uSunColor * ndl * 2.4 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
          gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = `trees${k}`;
    group.add(mesh);
    levels.push({ L, mesh, u, geo, ringCount, fullCount, inner: u.uInner.value, per: base.getAttribute('position').count / 3, tris: (base.getAttribute('position').count / 3) * geo.instanceCount });
  });
  scene.add(group);

  return {
    group,
    update(camMap, origin, agl) {
      const on = agl < MAX_AGL;
      group.visible = on;
      let tris = 0;
      if (!on) return 0;
      let innerOff = false;
      for (let k = 0; k < levels.length; k++) {
        const { L, mesh, u, tris: t } = levels[k];
        // Snap the grid to whole cells; the instance cell index is relative to it.
        const cx = Math.floor(camMap.x / L.spacing), cy = Math.floor(camMap.y / L.spacing);
        u.uGridCell.value.set(cx, cy);
        u.uGridBase.value.set(cx * L.spacing - origin.x, cy * L.spacing - origin.y);
        if (!G) { mesh.visible = true; tris += t; continue; }
        // v0.6.0 Part 7 (trees now show up to 3,000 m above the ground): a ring is drawn only while
        // the camera is lower than the ring is wide, and the next ring out fills its place.
        // From above, the rings' different densities showed as squares under the aircraft; and a
        // ring of 7 m trees is nothing from 1,000 m up.
        const lv = levels[k];
        const off = k < levels.length - 1 && agl > L.spacing * L.half;
        mesh.visible = !off;
        lv.geo.instanceCount = innerOff ? lv.fullCount : lv.ringCount;
        u.uInner.value = innerOff ? 0 : lv.inner;
        if (!off) tris += lv.per * lv.geo.instanceCount;
        innerOff = off;
      }
      shown = G ? levels.filter((l) => l.mesh.visible).length : levels.length;
      return tris;
    },
    get drawCalls() { return group.visible ? shown : 0; },
  };
}
