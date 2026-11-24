// The terrain: a GPU clipmap. Nested square rings of one grid follow the camera, each
// twice the step of the one inside it, snapped to twice their own step so they don't swim.
// Heights come from the data textures in the vertex shader (terrainHeight(), the same
// maths as heightfield.js), odd vertices morph onto the coarser grid towards each ring's
// edge so nothing pops, and every vertex drops by the Earth's curvature (d^2 / 2R) from
// the camera. Over the sea the heights clamp at 0 m, so this mesh is also the sea surface.
//
// One material for every ring: a ring's step and centre come from its model matrix.

import * as THREE from '../../vendor/three.module.js';
import { seaFloor } from './glsl.js';   // v0.7.0: the ground's floor (max(h, 0.0) in East Asia; none where land lies below the sea)
import { dataUrl } from './regions.js';   // v0.7.0: the fine cover from the page's region's folder
import { FINE_GLSL, createFineCover, setFineOrigin } from './finecover.js';
import { GROUND_GLSL, euGroundGlsl } from './ground.js';
import { REGION } from './regions.js';   // v0.7.1: Europe's fields (ground.js's euGroundGlsl())
// v0.7.7 (country): Europe's countryside by the country raster (ground.js's FIELDS77, ?fields77=0; off, this file's
// shader text is v0.7.6's).
import { FIELDS77, euZoneData, EU_ZONE_FALLBACK } from './ground.js';
import { geoRules, loadLocalRules } from './region.js';
const EU77 = REGION.id === 'europe' && FIELDS77;
import { TOWNS77, SUBURBS77, TOWNS77_UNIFORMS, TOWNS77_GLSL, SUBURB77_GLSL, GARDEN77_GLSL } from './cities.js';   // v0.7.7 towns (the towns subagent's): a town's river drawn from the 31 m cover; the suburbs' gardens
const T77 = REGION.id === 'europe' && TOWNS77;
const S77 = T77 && SUBURBS77;
import { TREES78, PARK78_UNIFORMS, ground78Frag } from './parks78.js';   // v0.7.8 trees (the trees subagent's)
import { SNOW78, snow78Frag } from './ground.js';   // v0.7.8 snow (the trees subagent's)
import { TOWNS79, FAR79_UNIFORMS, far79Frag, setCentres79, update79 } from './fartowns.js';   // v0.7.9 towns (the towns subagent's): the far towns by day
function euZoneTexture() {
  const make = (z) => {
    const t = new THREE.DataTexture(z.data, z.nx, z.ny, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.needsUpdate = true;
    return t;
  };
  const tex = { value: make(EU_ZONE_FALLBACK) }, box = { value: new THREE.Vector4(...EU_ZONE_FALLBACK.box) };
  const fill = (g) => {
    if (!g || !g.countryValues || !g.countryHeader) return;
    const z = euZoneData(g.countryHeader, g.countryValues);
    tex.value.dispose();
    tex.value = make(z);
    box.value.set(...z.box);
  };
  const g = geoRules();
  if (g) fill(g);
  else loadLocalRules(dataUrl(import.meta.url, '../../')).then(fill, () => {});
  return { uEuZone: tex, uEuZoneBox: box };
}

export const GRID = 128;          // quads per ring side
export const LEVELS = 13;         // steps 2 m .. 8192 m; the outer ring reaches ~520 km
export const STEP0 = 2;           // m, the finest step
const EARTH_R = 6371000;          // m, as curveDrop() (frame.js's EARTH_RADIUS)
const PEAK = 2000;                // m, at least: above Korea's highest ground (Hallasan 1,947 m); v0.6.0 raises it to the data's highest

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
  // v0.6.0: the high ground's rock and snow, and (Part 7) the fine cover's window round the camera
  // (finecover.js) and the field mosaic (ground.js), whose uniforms go into the shared set before
  // any material copies it. Both behind v0.6.0's flags until v0.7.0, always on since: HIGH and
  // GROUND stay names so the shader's text below is v0.6.4's character for character.
  const HIGH = true;
  const GROUND = true;
  const fine = GROUND ? createFineCover(uniforms, { baseUrl: dataUrl(import.meta.url, '../../') }) : null;
  if (GROUND) setFineOrigin(uniforms, { x: 0, y: 0 });
  const ringGeo = gridGeometry(GRID, GRID / 4 - 1);
  const fillGeo = gridGeometry(GRID / 2, 0);
  const extra = {
    uGridHalf: { value: GRID / 2 },
    uHighGround: { value: 0 },   // v0.6.0: 1 when the ground the GPU holds passes 2,100 m (rock and snow up there)
  };
  if (EU77) Object.assign(extra, euZoneTexture());   // v0.7.7 (country)
  if (S77) Object.assign(extra, TOWNS77_UNIFORMS);   // v0.7.7 suburbs (towns): the centres' boxes, shared with cities.js
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
      ${HIGH ? 'centroid varying float vHighH;' : ''}
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
        float h = ${seaFloor('flattenRunways(m, raw, zone)')};
        // Outside the baked map: open sea.
        if (natOutside(m)) { h = 0.0; raw = -40.0; }
        wp.y = h;
        vec3 rel = wp - uCamPos;
        wp.y -= curveDrop(rel.xz);
        vMap = m;
        vRel = wp - uCamPos;
        vRawH = raw;
        ${HIGH ? 'vHighH = raw;' : ''}
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
      ${GROUND ? FINE_GLSL + (REGION.id === 'europe' ? euGroundGlsl(GROUND_GLSL) : GROUND_GLSL) : ''}
      ${chunks.AIRCRAFT_LIGHTS_GLSL || 'vec3 aircraftLights(vec3 p, vec3 n) { return vec3(0.0); }'}${GROUND && S77 ? TOWNS77_GLSL + SUBURB77_GLSL + GARDEN77_GLSL : ''}
      varying vec2 vMap;
      varying vec3 vRel;
      varying float vRawH, vPw, vZone;
      ${HIGH ? 'centroid varying float vHighH;\n      uniform float uHighGround;' : ''}
      #include <logdepthbuf_pars_fragment>

      vec2 decodeN(vec2 rg) { return rg * (255.0 / 127.0) - (128.0 / 127.0); }

      void main() {
        #include <logdepthbuf_fragment>
        vec2 m = vMap;
        vec3 rel = vRel;
        float dist = length(rel);
        vec2 uv = natUv(m);
        bool outside = natOutside(m);

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
        ${GROUND ? `// v0.6.0 Part 7: the fine cover (31 m) near the camera, while one of its pixels is
        // still a screen pixel or so; the 250 m cover beyond, and where there is none.
        vec2 gfp = finePos(uCamPos.xz + rel.xz);
        float glod = max(length(dFdx(gfp)), length(dFdy(gfp))) * 31.25;      // metres a screen pixel covers here
        float fineW = uFineOn * smoothstep(0.0, 48.0, fineInside(gfp)) * (1.0 - smoothstep(24.0, 64.0, glod));
        fineW *= 1.0 - smoothstep(0.25, 0.75, cov.a);                         // not inside an airfield (airport-mask.js marks it)
        vec4 fLo = vec4(0.0), fHi = vec4(0.0);
        vec4 cov250 = cov;                                                    // the 250 m shares, before the fine cover
        if (fineW > 0.0) {
          fineMix(gfp, fLo, fHi);
          fineW *= 1.0 - fHi.w;
          cov.r = mix(cov.r, fLo.x, fineW);
          cov.g = mix(cov.g, fLo.y, fineW);
          cov.b = mix(cov.b, fLo.z, fineW);
        }` : ''}
        // Break the 250 m cells up with noise so the cover edges look natural.
        float wob = vnoise(m * 0.012) - 0.5 + 0.5 * (vnoise(m * 0.05) - 0.5);
        float forest = smoothstep(0.35, 0.65, cov.r + wob * 0.5);
        float urban = smoothstep(0.30, 0.60, cov.b + wob * 0.4);
        float farm = smoothstep(0.30, 0.60, cov.g + wob * 0.4) * (1.0 - urban);
        ${GROUND ? '// v0.6.1: no fields inside an airfield (airport-mask.js clears its forest and built-up cover, not its farm share:\n        // the ground between the aprons and round the remote stands was tilled plots): the airfield\'s own grass.\n        farm *= 1.0 - smoothstep(0.86, 0.98, cov250.a);' : ''}

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
        ${GROUND ? 'float treeLine;\n        vec3 fields = fieldMosaic(gfp, paddy, m, glod, slope, vRawH, treeLine);' : 'vec3 fields = fieldColor(m, paddy, detailFade);'}${REGION.id === 'europe' ? '\n        // v0.7.1, Europe: the dry country\'s grass is straw, not green (ground.js\'s euZone(); East Asia\'s text has none of this).\n        float euGz = 0.0, euDz = 0.0;\n        euZone(m, euGz, euDz);\n        grass = mix(grass, vec3(0.150, 0.132, 0.075) * (0.80 + 0.4 * tex1), euDz * 0.8);' : ''}${EU77 ? '\n        // v0.7.7: in a polder\'s district the whole farmed ground is its strips, the land cover\'s grassland too (not bands of it).\n        farm = max(farm, euPol * (1.0 - urban) * (1.0 - smoothstep(0.86, 0.98, cov250.a)));' : ''}
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
        ${GROUND ? `// Grassland and scrub (the fine cover's): not a lawn. Patches of taller, darker growth and
        // scattered bushes over it, a paler dry sward between.
        float rough = fineW * smoothstep(0.45, 0.65, fHi.x + wob * 0.3);${EU77 ? '\n        rough *= 1.0 - euPol;                                              // v0.7.7: a polder\'s grassland is its strips' : ''}
        if (rough > 0.0) {
          float clump = smoothstep(0.50, 0.68, vnoise(m * 0.028 + 3.0)) * 0.55 + smoothstep(0.62, 0.74, vnoise(m * 0.11 + 11.0)) * 0.35;
          vec3 sward = mix(vec3(0.105, 0.105, 0.052), vec3(0.085, 0.10, 0.045), vnoise(m * 0.006 + 1.0));${REGION.id === 'europe' ? '\n          sward = mix(sward, vec3(0.165, 0.145, 0.082), euDz * 0.8);' : ''}
          alb = mix(alb, mix(sward, canopy * 1.25, clump), rough * 0.85);
        }
        alb = mix(alb, canopy * 0.9, treeLine * farm);                       // the tree lines between districts
        // Bare ground (river bars, tidal flats, quarries) and marsh, where the fine cover has them.
        // (The water's distances, taken here once and outside any branch: their texture reads want
        // their derivatives. The sea's and the rivers' edges further down use the same two.)
        float sea0 = outside ? -5000.0 : seaDistance(m, vRawH), inl0 = outside ? 5000.0 : inlandDistance(m);
        float bare = fineW * smoothstep(0.4, 0.6, fHi.y + wob * 0.3);
        if (bare > 0.0) {
          // v0.6.1: not one pale sheet (ground.js's bareGround). The graders' passes and the wheel tracks only on
          // flat ground well away from the water: a river's bars and a shore's flats are bare too, and nobody drives there.
          float made = (1.0 - smoothstep(0.03, 0.08, slope)) * smoothstep(150.0, 400.0, outside ? 0.0 : min(sea0, inl0));
          ${EU77 ? `// v0.7.7: WorldCover's class 6 is bare ground or snow. Below the snow line it is earth (darker and warmer than
          // v0.7.6's pale sheet), and in a town the town's own ground (rail yards, building sites), not a white strip.
          // The graders' lots and wheel tracks (bareGround()'s made) only in a town: not a 250 m grid across the Bardenas.
          vec3 bg77 = bareGround(gfp, glod, m, tex2, made * smoothstep(0.05, 0.30, cov250.b)) * mix(vec3(0.80, 0.75, 0.66), vec3(1.0), smoothstep(1900.0, 2600.0, vRawH));
          bg77 = mix(bg77, city, smoothstep(0.15, 0.55, cov250.b) * 0.75);
          alb = mix(alb, bg77, bare);` : 'alb = mix(alb, bareGround(gfp, glod, m, tex2, made), bare);'}
        }
        alb = mix(alb, mix(vec3(0.07, 0.085, 0.045), vec3(0.11, 0.10, 0.05), tex1), fineW * smoothstep(0.4, 0.6, fHi.z + wob * 0.3));` : ''}
        ${GROUND ? 'canopy *= canopyCrowns(gfp, glod, normalize(vec2(uSunDir.x, -uSunDir.z) + 1e-4));' : ''}
        alb = mix(alb, canopy, forest);
        ${GROUND ? `// Built-up pixels in farm country, outside the towns: glass (the land cover maps the plains'
        // greenhouses as built-up), not concrete.
        float glassy = fineW * (1.0 - smoothstep(0.12, 0.30, cov250.b)) * smoothstep(0.10, 0.30, cov250.g + cov250.a * 0.0) * (1.0 - smoothstep(0.03, 0.06, slope));
        glassy *= smoothstep(0.50, 0.58, glassPatch(gfp));                    // about two built-up patches in five are glass; the others are villages (v0.6.1: an exact lattice's value, which the CPU shares)
        if (glassy > 0.0) city = mix(city, greenhouseGround(gfp, glod), glassy);
        // Villages and the towns' edges: lots with yards and gardens, not one sheet of concrete.
        // (Everywhere but the densest centres: the suburbs' 250 m cells are nearly all built-up too.)
        float village = fineW * (1.0 - glassy) * (1.0 - smoothstep(0.80, 0.97, cov250.b));
        if (village > 0.0) city = mix(city, villageGround(gfp, glod), village);${S77 ? `
        // v0.7.7 suburbs (the towns subagent's block): gardens between the terraces cities.js draws (the same block rule).
        if (urban > 0.0) { float g77; vec3 gc77 = garden77(m, glod, g77); if (g77 > 0.0) city = mix(city, gc77, g77); }` : ''}` : ''}
        alb = mix(alb, city, urban);
        alb = mix(alb, rock, smoothstep(0.55, 0.75, slope + 0.15 * (tex1 - 0.5)));
        ${EU77 ? `// v0.7.7: an airfield's grass takes its place's tone (straw in the dry country, as the grass round it) and a soft,
        // wandering edge instead of the flat zone's rectangle.
        vec3 afg77 = mix(vec3(0.075, 0.095, 0.035), vec3(0.10, 0.11, 0.045), tex2);
        afg77 = mix(afg77, vec3(0.150, 0.132, 0.075) * (0.85 + 0.3 * tex2), euDz * 0.8);
        alb = mix(alb, afg77, smoothstep(0.35, 1.0, vZone + 0.25 * wob) * 0.85);` : 'alb = mix(alb, mix(vec3(0.075, 0.095, 0.035), vec3(0.10, 0.11, 0.045), tex2), smoothstep(0.3, 0.9, vZone));'}
        // Mountain tops above ~1,400 m: thinner, browner vegetation.
        alb = mix(alb, vec3(0.13, 0.10, 0.06), smoothstep(1300.0, 1800.0, vRawH) * 0.6);
        ${HIGH ? `        // v0.6.0: above anything in Korea (Hallasan 1,947 m): bare rock from about 2,300 m and
        // November's snow from about 2,700 m, less on the steepest faces (Fuji, the Japan Alps).
        // Only when the ground the GPU holds reaches that high (uHighGround: never over Korea
        // alone), and from a centroid-sampled height: at a ridge seen edge-on the plain varying
        // extrapolates past the triangle and would sprinkle snow on the skyline.
        if (uHighGround > 0.5) {
          float bare = smoothstep(2200.0, 2600.0, vHighH + 200.0 * (tex1 - 0.5));
          alb = mix(alb, rock * 0.85, bare);
          float cap = smoothstep(2650.0, 3050.0, vHighH + 300.0 * (tex2 - 0.5)) * (1.0 - 0.7 * smoothstep(0.55, 0.9, slope));
          alb = mix(alb, vec3(0.60, 0.63, 0.68) * (0.92 + 0.12 * tex1), cap);
        }` : ''}

        // Water: the sea (with beaches) and inland water.
        float sea = ${GROUND ? 'sea0' : 'outside ? -5000.0 : seaDistance(m, vRawH)'};
        float inl = ${GROUND ? 'inl0' : 'outside ? 5000.0 : inlandDistance(m)'};
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
        ${GROUND ? '// Ponds, canals and reservoirs too small for the 250 m water field.\n        if (fineW > 0.0 && fLo.w > 0.0) wInl = max(wInl, fineW * smoothstep(0.44, 0.56, fineWater(gfp) + wob * 0.08) * (1.0 - wSea) * (1.0 - smoothstep(0.3, 0.9, vZone)));' : ''}${GROUND && T77 ? `
        // v0.7.7 towns (the towns subagent's block): in a town, a river or canal within 250 m of the 250 m field's bank takes
        // its edge from the 31 m cover (too wide or soft-edged at 250 m: the Thames, the Main, the Ebro), the field's own
        // water left where the cover has none of it only outside towns.
        if (wInl > 0.0 && fineW > 0.0 && inl > -250.0) {
          float tTown = fineW * smoothstep(0.20, 0.40, cov250.b) * (1.0 - smoothstep(0.3, 0.9, vZone));
          if (tTown > 0.0) wInl = mix(wInl, smoothstep(0.42, 0.58, fineWater(gfp) + wob * 0.06) * (1.0 - wSea), tTown);
        }` : ''}
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
  // v0.7.8 trees (the trees subagent's block): a real centre's park drawn as parkland (parks78.js); off, v0.7.7's text.
  if (TREES78 && GROUND) { mat.fragmentShader = ground78Frag(mat.fragmentShader); Object.assign(mat.uniforms, PARK78_UNIFORMS); }
  if (SNOW78 && REGION.id === 'europe') mat.fragmentShader = snow78Frag(mat.fragmentShader);   // v0.7.8 snow (ground.js): Europe's snow line by latitude
  if (TOWNS79 && GROUND) { mat.fragmentShader = far79Frag(mat.fragmentShader); Object.assign(mat.uniforms, FAR79_UNIFORMS); }   // v0.7.9 towns (fartowns.js); off, v0.7.8's text
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

  // v0.6.0: the clip window (glsl.js, CLIP_WINDOW) refills round the camera; the uploads go
  // to the GPU from the fill mesh's onBeforeRender (it draws every frame), where the renderer is.
  const clip = uniforms.__clip || null;
  // v0.6.0: the nearest patches and runways (glsl.js), and the highest ground the GPU holds.
  const near = uniforms.__near || null, peakOf = uniforms.__peak || null;
  if (clip || near || fine) fill.onBeforeRender = (renderer) => { if (clip) clip.flush(renderer); if (near && near.flush) near.flush(renderer); if (fine) fine.flush(renderer); };

  const ringTris = ringGeo.index.count / 3, fillTris = fillGeo.index.count / 3;
  const place = (mesh, s, camMap, origin) => {
    const cx = Math.floor(camMap.x / (2 * s) + 0.5) * 2 * s;
    const cy = Math.floor(camMap.y / (2 * s) + 0.5) * 2 * s;
    mesh.matrix.makeScale(s, 1, s);
    mesh.matrix.setPosition(cx - origin.x, 0, -(cy - origin.y));
    mesh.matrixWorldNeedsUpdate = true;
  };

  return {
    group, material: mat, fine,
    finest: 0,
    setCentres79: (c) => { if (TOWNS79) setCentres79(c); },   // v0.7.9 towns: the real centres' masks (world.js)
    // camMap: the camera's map position; agl: its height above the ground (m).
    update(camMap, origin, agl) {
      if (clip) clip.update(camMap);
      if (fine) { fine.update(camMap); setFineOrigin(uniforms, origin); }
      if (near) near.update(camMap);
      if (TOWNS79) update79(camMap);   // v0.7.9 towns
      // Skip the rings that are small compared with the height above the ground.
      let f = 0;
      while (f < LEVELS - 3 && GRID / 2 * STEP0 * 2 ** f < agl * 1.5) f++;
      this.finest = f;
      // Leave out the outer rings that lie wholly beyond the horizon: from height h a peak
      // of PEAK m is in sight up to sqrt(2Rh) + sqrt(2R PEAK); a ring starts (in max-norm)
      // at least (GRID/4 - 2) steps from the camera. Ground past that is hidden behind the
      // Earth's curve (the sea is in this mesh), so the picture doesn't change.
      const alt = Math.max(mat.uniforms.uCamAlt ? mat.uniforms.uCamAlt.value : agl, agl, 0);
      // v0.6.0: PEAK, or the highest ground in the data the GPU holds when that's higher (Fuji).
      const peak = peakOf && peakOf.m > PEAK ? peakOf.m : PEAK;
      mat.uniforms.uHighGround.value = peak > 2100 ? 1 : 0;
      const sight = (Math.sqrt(2 * EARTH_R * alt) + Math.sqrt(2 * EARTH_R * peak)) * 1.05;
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
