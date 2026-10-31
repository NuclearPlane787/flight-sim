// Cities: simple procedural buildings in the built-up cover (macro real, fine procedural).
//
// The ground around the camera is cut into 400 m "blocks" on a grid snapped to the map.
// Each block, seeded by its map index (the same every run), is an apartment complex (rows
// of 15–30 floor slabs facing roughly south, the Korean look), a dense low-rise area, or a
// few commercial towers, with 15 building slots. One instanced box mesh draws them all;
// the vertex shader places each slot on the GPU: it reads the built-up cover, keeps off
// water and runways, sits the box on terrainHeight(), and thins buildings with distance.
//
// Only blocks that can hold a building are drawn: whenever the camera crosses into another
// block, the CPU lists the blocks with built-up cover anywhere under their slots (read from
// the cover texture's data, the same grid the shader samples) and writes just those. A
// block it leaves out would have had every building dropped by the shader anyway, so the
// picture is the same, without the sea, fields and forest submitting empty boxes.

import * as THREE from '../../vendor/three.module.js';

const BLOCK = 400;          // m
const HALF = 20;            // blocks each side of the camera: ±8 km
const SLOTS = 15;           // 3 columns x 5 rows per block
export const CITY_MAX_AGL = 4500;   // m above the ground: no buildings above this

// A unit box (x, z in -0.5..0.5, y 0..1) without a bottom; normals per face.
function boxGeometry() {
  const P = [], N = [];
  const quad = (a, b, c, d, n) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) N.push(...n); };
  const x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5;
  quad([x0, 0, z1], [x1, 0, z1], [x1, 1, z1], [x0, 1, z1], [0, 0, 1]);
  quad([x1, 0, z0], [x0, 0, z0], [x0, 1, z0], [x1, 1, z0], [0, 0, -1]);
  quad([x1, 0, z1], [x1, 0, z0], [x1, 1, z0], [x1, 1, z1], [1, 0, 0]);
  quad([x0, 0, z0], [x0, 0, z1], [x0, 1, z1], [x0, 1, z0], [-1, 0, 0]);
  quad([x0, 1, z1], [x1, 1, z1], [x1, 1, z0], [x0, 1, z0], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

export function createCities(scene, uniforms, chunks) {
  const box = boxGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', box.getAttribute('position'));
  geo.setAttribute('normal', box.getAttribute('normal'));
  const n = (2 * HALF) ** 2 * SLOTS;
  const inst = new Float32Array(n * 3);
  const slotAttr = new THREE.InstancedBufferAttribute(inst, 3);
  slotAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('slot', slotAttr);
  geo.instanceCount = 0;

  // Can block (bx, by) (map index) hold a building? The shader keeps a building only where
  // the cover's built-up share, plus at most 0.15 of noise, reaches 0.18: so 0.03 (8/255).
  // Buildings sit within ~230 m of the block centre, and the bilinear sample reaches one
  // cell further, so any texel centred within 240 m + a cell of the centre counts.
  const covTex = uniforms.uCover && uniforms.uCover.value;
  const cov = uniforms.uHasCover && uniforms.uHasCover.value > 0.5 && covTex && covTex.image && covTex.image.data;
  const nat = uniforms.uNat.value, nsz = uniforms.uNatSize.value;
  const blockCache = new Map();
  function blockBuilt(bx, by) {
    if (!cov) return true;
    const key = bx * 1e6 + by;
    let v = blockCache.get(key);
    if (v !== undefined) return v;
    const cell = nat.z, nx = nsz.x, ny = nsz.y, r = 240 + cell;
    const cxm = (bx + 0.5) * BLOCK - nat.x, cym = (by + 0.5) * BLOCK - nat.y;
    const i0 = Math.max(Math.ceil((cxm - r) / cell - 0.5), 0), i1 = Math.min(Math.floor((cxm + r) / cell - 0.5), nx - 1);
    const j0 = Math.max(Math.ceil((cym - r) / cell - 0.5), 0), j1 = Math.min(Math.floor((cym + r) / cell - 0.5), ny - 1);
    v = false;
    // Off the map the texture clamps to its edge texel; those are in range after clamping.
    for (let j = Math.min(j0, ny - 1); j <= Math.max(j1, 0) && !v; j++) {
      for (let i = Math.min(i0, nx - 1); i <= Math.max(i1, 0); i++) if (cov[(j * nx + i) * 4 + 2] >= 7) { v = true; break; }
    }
    if (blockCache.size > 200000) blockCache.clear();
    blockCache.set(key, v);
    return v;
  }
  let gridX = NaN, gridY = NaN, blocks = 0;
  function fill(cx, cy) {
    let k = 0;
    blocks = 0;
    for (let j = -HALF; j < HALF; j++) for (let i = -HALF; i < HALF; i++) {
      if (!blockBuilt(cx + i, cy + j)) continue;
      blocks++;
      for (let s = 0; s < SLOTS; s++) { inst[k++] = i; inst[k++] = j; inst[k++] = s; }
    }
    geo.instanceCount = k / 3;
    slotAttr.needsUpdate = true;
    slotAttr.clearUpdateRanges();
    slotAttr.addUpdateRange(0, Math.max(k, 3));
  }

  const u = Object.assign({}, uniforms, {
    uGridBase: { value: new THREE.Vector2() },
    uGridCell: { value: new THREE.Vector2() },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.NOISE_GLSL}
      ${chunks.HEIGHT_GLSL}
      uniform vec2 uGridBase, uGridCell;
      attribute vec3 slot;            // block i, j (relative to the snapped grid), slot index
      varying vec3 vRel, vN, vLocal, vTint, vRoof;
      varying float vKind, vDist, vApt;
      #include <logdepthbuf_pars_vertex>
      const float BLOCK = ${BLOCK.toFixed(1)};
      void main() {
        ivec2 bc = ivec2(uGridCell + slot.xy);              // the block's map index
        int si = int(slot.z);
        float bh = ihash(bc, 21u), ba = ihash(bc, 22u), bt = ihash(bc, 23u);
        float sh0 = ihash(bc * 16 + ivec2(si, 0), 31u), sh1 = ihash(bc * 16 + ivec2(si, 0), 32u);
        float sh2 = ihash(bc * 16 + ivec2(si, 0), 33u), sh3 = ihash(bc * 16 + ivec2(si, 0), 34u);
        vec2 centre = uGridBase + (slot.xy + 0.5) * BLOCK;   // map metres relative to the origin
        // Block centre on the map, for the cover.
        vec2 mc = uOrigin + centre;
        vec4 covB = uHasCover > 0.5 ? texture(uCover, natUv(mc)) : vec4(0.0);
        float dense = covB.b;
        // Kind of block: apartments where it's densely built, else low-rise, some towers.
        float kind = dense > 0.55 && bt < 0.62 ? 0.0 : (bt > 0.93 && dense > 0.5 ? 2.0 : 1.0);
        float ang = kind == 0.0 ? (ba - 0.5) * 0.7 : (ba - 0.5) * 1.6;
        int col = si % 3, row = si / 3;
        vec2 lp;
        vec3 size;                                           // length (local x), height, depth
        float rot = ang;
        if (kind == 0.0) {
          lp = vec2((float(col) - 1.0) * 125.0, (float(row) - 2.0) * 72.0) + (vec2(sh0, sh1) - 0.5) * vec2(16.0, 8.0);
          size = vec3(58.0 + 36.0 * sh2, (15.0 + floor(16.0 * sh3)) * 2.9, 13.0 + 2.0 * sh0);
          if (sh1 > 0.9) size = vec3(26.0 + 10.0 * sh2, (4.0 + floor(4.0 * sh3)) * 3.5, 22.0); // a school or shops
          else if (sh3 > 0.92 && bh > 0.35) size = vec3(32.0 + 8.0 * sh2, (32.0 + floor(18.0 * sh0)) * 2.9, 24.0); // a newer tower block
        } else if (kind == 1.0) {
          lp = vec2((float(col) - 1.0) * 125.0, (float(row) - 2.0) * 72.0) + (vec2(sh0, sh1) - 0.5) * vec2(70.0, 40.0);
          size = vec3(22.0 + 26.0 * sh2, (2.0 + floor(6.0 * sh3 * sh3)) * 3.3, 16.0 + 14.0 * sh1);
          rot += (sh0 - 0.5) * 0.4;
          if (sh2 > 0.85 && dense > 0.4) size.y = (12.0 + floor(14.0 * sh3)) * 3.0;     // a mid-rise
        } else {
          lp = vec2((float(col) - 1.0) * 125.0, (float(row) - 2.0) * 72.0) + (vec2(sh0, sh1) - 0.5) * vec2(30.0, 20.0);
          size = vec3(28.0 + 16.0 * sh2, (18.0 + floor(30.0 * sh3)) * 3.6, 28.0 + 10.0 * sh1);
        }
        float ca = cos(ang), sa = sin(ang);
        vec2 off = vec2(ca * lp.x - sa * lp.y, sa * lp.x + ca * lp.y);
        vec2 pc = centre + off;                              // building centre, map rel. origin
        vec2 m = uOrigin + pc;
        vec2 uv = natUv(m);
        vec4 cov = uHasCover > 0.5 ? texture(uCover, uv) : vec4(0.0);
        float pw, zone;
        float raw = rawHeight(m, pw);
        float h = max(flattenRunways(m, raw, zone), 0.0);
        vec2 nn = texture(uNormal, uv).rg * (255.0 / 127.0) - (128.0 / 127.0);
        float sea = seaDistance(m, raw), inl = inlandDistance(m);
        // Keep off water, runways (and 250 m around them), steep slopes; follow the cover.
        float keep = step(sh3 * 0.4 + 0.18, cov.b + (vnoise(m * 0.004) - 0.5) * 0.3);
        keep *= step(30.0, sea) * step(25.0, inl) * step(length(nn), 0.3) * step(zone, 0.001);
        for (int r = 0; r < ${chunks.MAX_RUNWAYS}; r++) {
          if (r >= uRwyCount) break;
          vec2 d = m - uRwyA[r].xy;
          float uu = dot(d, uRwyA[r].zw), vv = -d.x * uRwyA[r].w + d.y * uRwyA[r].z;
          if (abs(uu) < uRwyB[r].x + 400.0 && abs(vv) < uRwyB[r].y + 260.0) keep = 0.0;
        }
        // Thin out with distance, and shrink into the ground at the edge of the ring.
        vec2 dc = pc - vec2(uCamPos.x, -uCamPos.z);
        float dist = length(dc);
        float range = ${(HALF * BLOCK).toFixed(1)};
        keep *= step(smoothstep(range * 0.45, range * 0.95, dist) * 0.6, sh2 * 0.6 + 0.2);
        float grow = 1.0 - smoothstep(range * 0.8, range * 0.97, max(abs(dc.x), abs(dc.y)));
        grow *= 1.0 - smoothstep(${(CITY_MAX_AGL * 0.7).toFixed(1)}, ${CITY_MAX_AGL.toFixed(1)}, uCamAgl);
        vec3 s3 = size * vec3(1.0, grow, 1.0) * keep;
        vec3 p = position * s3;
        // Rotate in the map plane, then to the scene (x, -y).
        float cr = cos(rot), sr = sin(rot);
        vec2 q = vec2(cr * p.x - sr * (-p.z), sr * p.x + cr * (-p.z));   // local z -> map -y
        vec3 wp = vec3(pc.x + q.x, h - 2.0 + p.y + (position.y > 0.5 ? 2.0 : 0.0) * keep, -(pc.y + q.y));
        vec3 rel = wp - uCamPos;
        wp.y -= curveDrop(rel.xz);
        vRel = wp - uCamPos;
        vec2 nq = vec2(cr * normal.x - sr * (-normal.z), sr * normal.x + cr * (-normal.z));
        vN = vec3(nq.x, normal.y, -nq.y);
        vLocal = position * size;
        vLocal.y = position.y * size.y;
        vKind = abs(normal.z) > 0.5 ? 1.0 : (abs(normal.x) > 0.5 ? 2.0 : 0.0);   // long face, end wall, roof
        vDist = dist;
        // Facade colours. Apartments: each complex has its own scheme (off-white, cream, beige,
        // pale grey, a few warmer or bluer), each slab a little off it. Low-rise: brick, tile and
        // render. Towers: glass and grey stone. Roofs: grey concrete, green or terracotta.
        float sc = ihash(bc, 24u);
        vec3 apt = sc < 0.30 ? vec3(0.36, 0.355, 0.335)       // off-white
                 : sc < 0.52 ? vec3(0.36, 0.33, 0.27)         // cream
                 : sc < 0.70 ? vec3(0.31, 0.28, 0.23)         // beige
                 : sc < 0.86 ? vec3(0.27, 0.275, 0.28)        // pale grey
                 : sc < 0.94 ? vec3(0.33, 0.27, 0.22)         // warm (salmon)
                 : vec3(0.25, 0.28, 0.31);                    // blue-grey
        vec3 tint = kind == 0.0 ? apt * (0.88 + 0.2 * sh2)
                  : kind == 1.0 ? (sh0 < 0.4 ? mix(vec3(0.22, 0.12, 0.08), vec3(0.28, 0.17, 0.11), sh2)   // brick
                                : mix(vec3(0.24, 0.23, 0.21), vec3(0.36, 0.32, 0.27), sh2))               // render, tile
                  : mix(vec3(0.12, 0.16, 0.20), vec3(0.30, 0.31, 0.32), sh0);
        vTint = tint;
        float rr = ihash(bc * 16 + ivec2(si, 0), 35u);
        vRoof = rr < 0.55 ? vec3(0.17, 0.17, 0.165) * (0.8 + 0.4 * sh1)
              : rr < 0.75 ? vec3(0.10, 0.14, 0.11)            // green waterproofing
              : rr < 0.88 ? vec3(0.20, 0.10, 0.07)            // terracotta / red
              : vec3(0.26, 0.26, 0.25);                       // pale concrete
        vApt = kind == 0.0 ? 1.0 : 0.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      varying vec3 vRel, vN, vLocal, vTint, vRoof;
      varying float vKind, vDist, vApt;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vN);
        vec3 alb = vTint;
        float fade = 1.0 - smoothstep(1500.0, 5000.0, vDist);
        if (vKind > 0.5) {
          // Floors every 2.9 m: a band of windows (and balconies on the long faces).
          float y = vLocal.y;
          float along = vKind > 1.5 ? vLocal.z : vLocal.x;
          float fl = fract(y / 2.9);
          float win = smoothstep(0.30, 0.36, fl) * (1.0 - smoothstep(0.80, 0.86, fl));
          float colw = vKind > 1.5 ? 0.25 : smoothstep(0.08, 0.16, fract(along / 3.2)) * (1.0 - smoothstep(0.84, 0.92, fract(along / 3.2)));
          float fw = max(fwidth(y), fwidth(along));
          float w;
          if (vApt > 0.5 && vKind < 1.5) {
            // Apartment long faces: one unit every 9.6 m, a light wall pier and the stair core
            // between units, balcony glazing across the rest. The units stay readable as
            // vertical stripes from a few km, after the floors have averaged out.
            float uu = along / 9.6, uw = fwidth(uu) + 1e-4;
            float fu = fract(uu);
            float glz = smoothstep(0.0, 0.10 + uw, fu) * (1.0 - smoothstep(0.80 - uw, 0.86, fu));
            glz = mix(0.45, 1.0, mix(glz, 0.8, smoothstep(0.25, 0.6, uw)));
            float wf = win * step(1.5, y);
            w = glz * mix(wf, 0.62, smoothstep(0.4, 1.4, fw));
          } else {
            w = win * colw * step(1.5, y);
            // Average the pattern out once a floor is only a few pixels tall (no moire).
            w = mix(w, 0.3, smoothstep(0.4, 1.4, fw));
          }
          vec3 glass = vec3(0.045, 0.055, 0.065);
          alb = mix(alb, glass, w * mix(0.75, 0.95, fade));
          // Ground floor darker; a little weathering towards the base.
          alb *= (0.75 + 0.25 * step(3.0, y)) * (0.85 + 0.15 * smoothstep(0.0, 25.0, y));
        } else {
          alb = vRoof;
        }
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'cities';
  scene.add(mesh);
  const tris = 10;   // per instance

  return {
    mesh,
    update(camMap, origin, agl) {
      const on = agl < CITY_MAX_AGL;
      mesh.visible = on;
      if (!on) return { instances: 0, tris: 0, drawCalls: 0 };
      const cx = Math.floor(camMap.x / BLOCK), cy = Math.floor(camMap.y / BLOCK);
      if (cx !== gridX || cy !== gridY) { gridX = cx; gridY = cy; fill(cx, cy); }
      mesh.visible = geo.instanceCount > 0;
      u.uGridCell.value.set(cx, cy);
      u.uGridBase.value.set(cx * BLOCK - origin.x, cy * BLOCK - origin.y);
      const count = geo.instanceCount;
      return { instances: count, tris: tris * count, drawCalls: count > 0 ? 1 : 0, blocks };
    },
  };
}
