// The terrain: a GPU clipmap. Nested square rings of one grid follow the camera, each
// twice the step of the one inside it, snapped to twice their own step so they don't swim.
// Heights come from the data textures in the vertex shader (terrainHeight(), the same
// maths as heightfield.js), odd vertices morph onto the coarser grid towards each ring's
// edge so nothing pops, and every vertex drops by the Earth's curvature (d^2 / 2R) from
// the camera. Over the sea the heights clamp at 0 m, so this mesh is also the sea surface.
//
// One material for every ring: a ring's step and centre come from its model matrix.

import * as THREE from '../../vendor/three.module.js';

export const GRID = 128;          // quads per ring side
export const LEVELS = 13;         // steps 2 m .. 8192 m; the outer ring reaches ~520 km
export const STEP0 = 2;           // m, the finest step
const EARTH_R = 6371000;          // m, as curveDrop() (frame.js's EARTH_RADIUS)
const PEAK = 2000;                // m, above the highest ground in the map (Hallasan 1,947 m)

// A grid of GRID x GRID quads with integer vertex coordinates -GRID/2..GRID/2 (scene x, z),
// leaving out the quads inside |i|,|j| < hole (hole 0 = a full grid).
function gridGeometry(n, hole) {
  const h = n / 2, verts = n + 1;
  const pos = new Float32Array(verts * verts * 3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const o = (j * verts + i) * 3;
    pos[o] = i - h; pos[o + 1] = 0; pos[o + 2] = j - h;
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = i - h, z0 = j - h;
    if (hole > 0 && x0 >= -hole && x0 + 1 <= hole && z0 >= -hole && z0 + 1 <= hole) continue;
    const a = j * verts + i, b = a + 1, c = a + verts, d = c + 1;
    // Alternate the diagonal by quadrant so the rings are symmetric.
    if ((x0 < 0) === (z0 < 0)) idx.push(a, c, b, b, c, d);
    else idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createTerrain(scene, uniforms, chunks) {
  const ringGeo = gridGeometry(GRID, GRID / 4 - 1);
  const fillGeo = gridGeometry(GRID / 2, 0);
  const extra = {
    uGridHalf: { value: GRID / 2 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uniforms, extra),
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.NOISE_GLSL}
      ${chunks.HEIGHT_GLSL}
      uniform float uGridHalf;
      varying vec2 vMap;
      varying vec3 vRel;
      varying float vRawH, vPw, vZone;
      #include <logdepthbuf_pars_vertex>
      void main() {
        float s = modelMatrix[0][0];                     // this ring's step (m)
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        // Morph odd vertices onto the coarser grid towards the ring's outer edge.
        vec2 dc = wp.xz - uCamPos.xz;
        float d = max(abs(dc.x), abs(dc.y));
        float H = uGridHalf * s;
        float morph = smoothstep(0.62 * H, 0.90 * H, d);
        vec2 odd = fract(position.xz * 0.5) * 2.0;       // 1 on odd grid lines
        wp.xz -= odd * s * morph;
        vec2 m = sceneToMap(wp);
        float pw, zone;
        float raw = rawHeight(m, pw);
        float h = max(flattenRunways(m, raw, zone), 0.0);
        // Outside the baked map: open sea.
        vec2 uv = natUv(m);
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { h = 0.0; raw = -40.0; }
        wp.y = h;
        vec3 rel = wp - uCamPos;
        wp.y -= curveDrop(rel.xz);
        vMap = m;
        vRel = wp - uCamPos;
        vRawH = raw;
        vPw = pw;
        vZone = zone;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.NOISE_GLSL}
      ${chunks.HEIGHT_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.WATER_GLSL}
      ${chunks.FIELDS_GLSL}
      ${chunks.AIRCRAFT_LIGHTS_GLSL || 'vec3 aircraftLights(vec3 p, vec3 n) { return vec3(0.0); }'}
      varying vec2 vMap;
      varying vec3 vRel;
      varying float vRawH, vPw, vZone;
      #include <logdepthbuf_pars_fragment>

      vec2 decodeN(vec2 rg) { return rg * (255.0 / 127.0) - (128.0 / 127.0); }

      void main() {
        #include <logdepthbuf_fragment>
        vec2 m = vMap;
        vec3 rel = vRel;
        float dist = length(rel);
        vec2 uv = natUv(m);
        bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));

        // Normal (map ENU), from the national normal map, the 30 m patches where present.
        vec2 nn = decodeN(texture(uNormal, uv).rg);
        if (vPw > 0.0) {
          for (int k = 0; k < ${chunks.MAX_PATCHES}; k++) {
            if (k >= uPatchCount) break;
            vec4 r = uPatchRect[k], dim = uPatchDim[k];
            float w = patchWeight(r, dim, m);
            if (w <= 0.0) continue;
            vec2 fxy = (m - r.xy) / r.z;
            vec2 puv = vec2(fxy.x, fxy.y + r.w) / dim.zw;
            nn = mix(nn, decodeN(texture(uPatchN, puv).rg), w);
          }
        }
        nn *= 1.0 - vZone;                                 // airfields are flat
        float slope = length(nn);                          // ~ sin(slope angle)

        // Fine procedural relief near the camera, as a normal perturbation.
        float near = 1.0 - smoothstep(200.0, 2500.0, dist);
        if (near > 0.0) {
          float e = 1.5;
          vec2 q = m * 0.11;
          float n0 = fbm3(q), nx = fbm3(q + vec2(e * 0.11, 0.0)), ny = fbm3(q + vec2(0.0, e * 0.11));
          nn += vec2(n0 - nx, n0 - ny) * (0.9 + 2.0 * slope) * near * (1.0 - vZone);
        }
        vec3 nMap = vec3(nn, sqrt(max(1.0 - dot(nn, nn), 0.05)));
        vec3 n = normalize(vec3(nMap.x, nMap.z, -nMap.y));  // scene frame

        // Land cover (macro, real). Without the cover layer: forest on the slopes.
        vec4 cov = uHasCover > 0.5 ? texture(uCover, uv) : vec4(0.0);
        if (uHasCover < 0.5) {
          cov.r = smoothstep(0.06, 0.2, slope) * step(30.0, vRawH);
          cov.g = (1.0 - cov.r) * (1.0 - smoothstep(0.02, 0.06, slope)) * (1.0 - smoothstep(150.0, 400.0, vRawH));
        }
        // Break the 250 m cells up with noise so the cover edges look natural.
        float wob = vnoise(m * 0.012) - 0.5 + 0.5 * (vnoise(m * 0.05) - 0.5);
        float forest = smoothstep(0.35, 0.65, cov.r + wob * 0.5);
        float urban = smoothstep(0.30, 0.60, cov.b + wob * 0.4);
        float farm = smoothstep(0.30, 0.60, cov.g + wob * 0.4) * (1.0 - urban);

        // Distance-faded detail.
        float detailFade = (1.0 - smoothstep(2500.0, 9000.0, dist)) * (1.0 - smoothstep(1000.0, 1800.0, uCamAgl));
        float tex1 = vnoise(m * 0.03), tex2 = vnoise(m * 0.21), tex3 = vnoise(m * 1.3);

        // Grass and scrub, autumn-dry.
        vec3 grass = mix(vec3(0.075, 0.085, 0.036), vec3(0.115, 0.110, 0.050), tex1);
        grass *= 0.85 + 0.3 * mix(0.5, tex2, detailFade);
        // Forest: dark canopy, mottled, with patches of autumn colour.
        vec3 canopy = mix(vec3(0.032, 0.050, 0.022), vec3(0.050, 0.065, 0.028), tex1);
        float autumn = smoothstep(0.55, 0.8, vnoise(m * 0.004 + 3.0)) * 0.7;
        canopy = mix(canopy, vec3(0.13, 0.065, 0.025), autumn * smoothstep(0.3, 0.7, tex2));
        canopy *= 0.75 + 0.5 * mix(0.5, tex3 * 0.6 + tex2 * 0.4, near + detailFade * 0.5);
        // Fields and paddies (paddies on flat, low valley floors).
        float paddy = (1.0 - smoothstep(0.015, 0.04, slope)) * (1.0 - smoothstep(120.0, 350.0, vRawH));
        vec3 fields = fieldColor(m, paddy, detailFade);
        // Built-up ground: concrete and asphalt with a street grid.
        vec3 city = mix(vec3(0.085, 0.085, 0.083), vec3(0.14, 0.135, 0.125), tex2);
        city = mix(city, canopy * 1.2, 0.35 * smoothstep(0.45, 0.75, vnoise(m * 0.02 + 9.0)));   // parks and street trees
        vec2 sg = abs(fract(m / 400.0) - 0.5) * 400.0;
        float street = 1.0 - smoothstep(6.0, 9.0 + fwidth(m.x) * 2.0, min(sg.x, sg.y));          // arterial roads between blocks
        city = mix(city, vec3(0.045, 0.045, 0.05), street * 0.6 * (1.0 - smoothstep(3000.0, 9000.0, dist)));
        // Rock on steep slopes, and the airfields' mown grass.
        vec3 rock = mix(vec3(0.13, 0.12, 0.105), vec3(0.20, 0.19, 0.17), tex2);

        vec3 alb = grass;
        alb = mix(alb, fields, farm);
        alb = mix(alb, canopy, forest);
        alb = mix(alb, city, urban);
        alb = mix(alb, rock, smoothstep(0.55, 0.75, slope + 0.15 * (tex1 - 0.5)));
        alb = mix(alb, mix(vec3(0.075, 0.095, 0.035), vec3(0.10, 0.11, 0.045), tex2), smoothstep(0.3, 0.9, vZone));
        // Mountain tops above ~1,400 m: thinner, browner vegetation.
        alb = mix(alb, vec3(0.13, 0.10, 0.06), smoothstep(1300.0, 1800.0, vRawH) * 0.6);

        // Water: the sea (with beaches) and inland water.
        float sea = outside ? -5000.0 : seaDistance(m, vRawH);
        float inl = outside ? 5000.0 : inlandDistance(m);
        // Wobble the river banks a little near the camera (the data is a 250 m grid).
        inl += (vnoise(m * 0.011) - 0.5) * 40.0 * (1.0 - smoothstep(4000.0, 12000.0, dist)) * (1.0 - smoothstep(-300.0, -150.0, -abs(inl)));
        float aa = max(fwidth(sea), 0.5);
        float beach = (1.0 - smoothstep(10.0, 35.0 + aa, sea)) * (1.0 - smoothstep(4.0, 10.0, vRawH)) * (1.0 - urban);
        alb = mix(alb, mix(vec3(0.33, 0.29, 0.21), vec3(0.25, 0.22, 0.16), smoothstep(0.0, 12.0, sea) * 0.0 + tex2 * 0.3), beach);

        // v0.4.0: wet ground darkens; snow whitens the land (the forests less: it falls through; steep rock stays bare).
        if (uWet > 0.0) alb *= 1.0 - 0.28 * uWet;
        if (uSnow > 0.0) alb = mix(alb, vec3(0.50, 0.53, 0.58) * (0.92 + 0.12 * tex2), uSnow * (1.0 - 0.5 * forest) * (1.0 - 0.45 * urban) * (1.0 - smoothstep(0.6, 0.85, slope)));
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 light = uSunColor * ndl * 2.4 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1;
        // The A321's landing and taxi lamps (glsl.js), a pool on the grass and fields; lost in
        // daylight, so it fades in with the night.
        light += aircraftLights(uCamPos + rel, n);   // main.js already scales the lamps by uNight
        vec3 col = alb * light;

        float wSea = 1.0 - smoothstep(-aa, aa, sea);
        float aai = max(fwidth(inl), 0.5);
        float wInl = (1.0 - smoothstep(-aai, aai, inl)) * (1.0 - wSea);
        if (wSea + wInl > 0.001) {
          float depth = wSea > 0.0 ? clamp(-sea / 1500.0, 0.0, 1.0) : clamp(-inl / 150.0, 0.0, 1.0);
          vec3 wc = waterShade(m, rel, depth, wInl / max(wSea + wInl, 1e-3));
          col = mix(col, wc, wSea + wInl);
        }

        gl_FragColor = vec4(applyHaze(col, rel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  mat.extensions = mat.extensions || {};

  const group = new THREE.Group();
  group.name = 'terrain';
  const rings = [];
  for (let k = 0; k < LEVELS; k++) {
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain-ring${k}`;
    group.add(mesh);
    rings.push(mesh);
  }
  const fill = new THREE.Mesh(fillGeo, mat);
  fill.frustumCulled = false;
  fill.matrixAutoUpdate = false;
  fill.name = 'terrain-fill';
  group.add(fill);
  scene.add(group);

  const ringTris = ringGeo.index.count / 3, fillTris = fillGeo.index.count / 3;
  const place = (mesh, s, camMap, origin) => {
    const cx = Math.floor(camMap.x / (2 * s) + 0.5) * 2 * s;
    const cy = Math.floor(camMap.y / (2 * s) + 0.5) * 2 * s;
    mesh.matrix.makeScale(s, 1, s);
    mesh.matrix.setPosition(cx - origin.x, 0, -(cy - origin.y));
    mesh.matrixWorldNeedsUpdate = true;
  };

  return {
    group, material: mat,
    finest: 0,
    // camMap: the camera's map position; agl: its height above the ground (m).
    update(camMap, origin, agl) {
      // Skip the rings that are small compared with the height above the ground.
      let f = 0;
      while (f < LEVELS - 3 && GRID / 2 * STEP0 * 2 ** f < agl * 1.5) f++;
      this.finest = f;
      // Leave out the outer rings that lie wholly beyond the horizon: from height h a peak
      // of PEAK m is in sight up to sqrt(2Rh) + sqrt(2R PEAK); a ring starts (in max-norm)
      // at least (GRID/4 - 2) steps from the camera. Ground past that is hidden behind the
      // Earth's curve (the sea is in this mesh), so the picture doesn't change.
      const alt = Math.max(mat.uniforms.uCamAlt ? mat.uniforms.uCamAlt.value : agl, agl, 0);
      const sight = (Math.sqrt(2 * EARTH_R * alt) + Math.sqrt(2 * EARTH_R * PEAK)) * 1.05;
      let last = LEVELS - 1;
      while (last > f + 2 && (GRID / 4 - 2) * STEP0 * 2 ** last > sight) last--;
      this.coarsest = last;
      let tris = 0;
      for (let k = 0; k < LEVELS; k++) {
        const on = k >= f && k <= last;
        rings[k].visible = on;
        if (on) { place(rings[k], STEP0 * 2 ** k, camMap, origin); tris += ringTris; }
      }
      place(fill, STEP0 * 2 ** f, camMap, origin);
      tris += fillTris;
      return { tris, drawCalls: last - f + 2 };
    },
  };
}
