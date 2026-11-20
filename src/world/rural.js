// Buildings in the countryside (v0.6.0 Part 7, behind GROUND_ON): villages on the fine cover's
// built-up pixels outside the city blocks, farmhouses scattered among the fields, and big low
// sheds (warehouses, factories) on the built-up ground near the towns. Until now nothing stood
// outside the cities at all.
//
// One instanced mesh of gabled houses round the camera (±4 km), placed on the GPU like the
// cities' blocks: a slot per 62.5 m cell (two fine pixels), seeded by the cell's index (the same
// every run), kept where the fine cover (finecover.js's window) says built-up or, rarely, crop.
// v0.6.1: only the slots that can hold a building are drawn. The CPU reads the same fine cover
// and the same hashes (candidateCells(), exact integers) and lists a superset of what the
// shader keeps, so the picture is the same and instanceCount falls from 16,384 to the few
// hundred or thousand cells with a village, a shed or a farmhouse (229k triangles before).
// Each country has its own look (the camera's country, region.js): Korea's blue, orange and grey
// steel roofs over white walls; Japan's dark tiles; the Yangtze delta's three- and four-storey
// village houses. A few warm windows at night.
// Positions come from fine-pixel integers and small offsets (V060.md, "Precision far from the
// origin"), never from float32 map metres.

import * as THREE from '../../vendor/three.module.js';
import { FINE_GLSL, FINE_PX, ihash } from './finecover.js';
import { countryAt } from './region.js';
import { coverReader } from './clipwindow.js';

const CELL_PX = 2;                 // fine pixels a slot cell (62.5 m)
const HALF = 64;                   // cells each side of the camera: ±4 km
const SNAP = 16;                   // the list's anchor moves a kilometre at a time
const SPAN = 2 * HALF + SNAP - 1;  // cells a side the list covers: ±HALF round every camera cell of one anchor
const X0 = -400000, Y0 = -400000;  // the fine lattice's origin (finecover.js)


// The cells of the SPAN x SPAN square from (ai - HALF, aj - HALF) that may hold a building: the
// shader's own rule (its fine pixel built-up or crop, the hashes, the 250 m built-up share),
// with a margin wherever a float could fall either side, so this is never short of what the
// shader keeps (it still decides; a cell listed and not kept draws nothing). texel(P, Q): the
// fine cover's class + 1; urbanAt(x, y, lohi): the least and the most built-up share (0..1) of
// the four 250 m cells round the point, between which the shader's bilinear sample lies.
// Writes the cells' offsets from the anchor into `out` (pairs) and returns how many.
export function candidateCells(ai, aj, texel, urbanAt, out) {
  const E = 1e-6, UM = 0.01, lohi = [0, 0];
  let n = 0;
  for (let j = -HALF; j < -HALF + SPAN; j++) for (let i = -HALF; i < -HALF + SPAN; i++) {
    const cx = ai + i, cy = aj + j;
    const h0 = ihash(cx, cy, 71), h1 = ihash(cx, cy, 72);
    // The building's own pixel: floor(0.25 + 1.5 h); both where h sits on the step.
    const px0 = h0 < 0.5 - E ? 0 : 1, px1 = h0 > 0.5 + E ? 1 : 0;       // px1..px0
    const py0 = h1 < 0.5 - E ? 0 : 1, py1 = h1 > 0.5 + E ? 1 : 0;
    let built = false, crop = false;
    for (let b = py1; b <= py0; b++) for (let a = px1; a <= px0; a++) {
      const fc = texel(cx * CELL_PX + a, cy * CELL_PX + b);
      if (fc === 6) built = true; else if (fc === 5) crop = true;
    }
    if (!built && !crop) continue;
    const h2 = ihash(cx, cy, 73);
    let keep = crop && h2 <= 0.022 + E;
    if (!keep && built) {
      urbanAt(X0 + (cx * CELL_PX + 0.25 + 1.5 * h0) * FINE_PX, Y0 + (cy * CELL_PX + 0.25 + 1.5 * h1) * FINE_PX, lohi);
      keep = (lohi[0] < 0.34 + UM && h2 <= 0.82 + E) || (ihash(cx, cy, 75) >= 0.86 - E && lohi[1] > 0.12 - UM && lohi[0] < 0.6 + UM);
    }
    if (keep) { out[n * 2] = i; out[n * 2 + 1] = j; n++; }
  }
  return n;
}
export const RURAL_MAX_AGL = 3500; // m above the ground: nothing above this
const COUNTRY = { KR: 0, KP: 0, other: 0, JP: 1, CN: 2 };

// A unit house: x along the ridge (-0.5..0.5), z across, walls y 0..1, the ridge at y 2 (the
// shader scales the walls and the roof's rise apart). Attribute part: 0 wall, 1 roof.
function houseGeometry() {
  const P = [], N = [], K = [];
  const tri = (a, b, c, n, k) => { P.push(...a, ...b, ...c); N.push(...n, ...n, ...n); K.push(k, k, k); };
  const quad = (a, b, c, d, n, k) => { tri(a, b, c, n, k); tri(a, c, d, n, k); };
  const x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5;
  quad([x0, 0, z1], [x1, 0, z1], [x1, 1, z1], [x0, 1, z1], [0, 0, 1], 0);        // long walls
  quad([x1, 0, z0], [x0, 0, z0], [x0, 1, z0], [x1, 1, z0], [0, 0, -1], 0);
  quad([x1, 0, z1], [x1, 0, z0], [x1, 1, z0], [x1, 1, z1], [1, 0, 0], 0);        // gable ends
  quad([x0, 0, z0], [x0, 0, z1], [x0, 1, z1], [x0, 1, z0], [-1, 0, 0], 0);
  tri([x1, 1, z1], [x1, 1, z0], [x1, 2, 0], [1, 0, 0], 0);
  tri([x0, 1, z0], [x0, 1, z1], [x0, 2, 0], [-1, 0, 0], 0);
  quad([x0, 1, z1], [x1, 1, z1], [x1, 2, 0], [x0, 2, 0], [0, 0.8, 0.6], 1);      // the two slopes
  quad([x1, 1, z0], [x0, 1, z0], [x0, 2, 0], [x1, 2, 0], [0, 0.8, -0.6], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(K, 1));
  return g;
}

// fine: finecover.js's object (terrain.fine). Without it (an older caller) every slot is
// drawn, as in v0.6.0.
export function createRural(scene, uniforms, chunks, { fine = null } = {}) {
  const base = houseGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  geo.setAttribute('part', base.getAttribute('part'));
  const LISTED = !!fine;
  const cells = new Float32Array((LISTED ? SPAN * SPAN : (2 * HALF) ** 2) * 2);
  let k = 0;
  if (!LISTED) for (let j = -HALF; j < HALF; j++) for (let i = -HALF; i < HALF; i++) { cells[k++] = i; cells[k++] = j; }
  const cellAttr = new THREE.InstancedBufferAttribute(cells, 2);
  if (LISTED) cellAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('cell', cellAttr);
  geo.instanceCount = LISTED ? 0 : cells.length / 2;
  const u = Object.assign({}, uniforms, {
    uRCell: { value: new THREE.Vector2() },      // the list's anchor cell (v0.6.0: the camera's slot cell), an integer
    uCountry: { value: 0 },
    uGlassOn: { value: 1 },                      // 0 with ?greenhouses=0 (no tunnels: the houses stand on the glass ground, as v0.6.0)
  });
  // The list: made again when the anchor moves and when the fine cover's window or the 250 m
  // cover's (clipwindow.js's coverReader: the very texels the shader samples) changes.
  let listAi = NaN, listAj = NaN, listVersion = -1, covVersion = -1, listN = 0;
  const cov = LISTED ? coverReader(uniforms) : null;
  const nat = uniforms.uNat.value;
  const urbanAt = (x, y, lohi) => {
    if (!cov) { lohi[0] = lohi[1] = 0; return; }
    const i = Math.floor((x - nat.x) / nat.z - 0.5), j = Math.floor((y - nat.y) / nat.z - 0.5);
    const cl = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const i0 = cl(i, cov.lo[0], cov.hi[0]), i1 = cl(i + 1, cov.lo[0], cov.hi[0]), j0 = cl(j, cov.lo[1], cov.hi[1]), j1 = cl(j + 1, cov.lo[1], cov.hi[1]);
    const a = cov.at(i0, j0), b = cov.at(i1, j0), c = cov.at(i0, j1), d = cov.at(i1, j1);
    lohi[0] = Math.min(a, b, c, d) / 255; lohi[1] = Math.max(a, b, c, d) / 255;
  };
  const relist = (ai, aj) => {
    listN = candidateCells(ai, aj, fine.reader(), urbanAt, cells);
    cellAttr.clearUpdateRanges(); cellAttr.addUpdateRange(0, Math.max(listN * 2, 2)); cellAttr.needsUpdate = true;
    geo.instanceCount = listN;
    listAi = ai; listAj = aj; listVersion = fine.version; covVersion = cov ? cov.version() : 0;
  };
  const RANGE = HALF * CELL_PX * FINE_PX;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.NOISE_GLSL}
      ${chunks.HEIGHT_GLSL}
      ${FINE_GLSL}
      uniform ivec2 uRCell;
      uniform int uCountry;
      uniform float uGlassOn;
      attribute vec2 cell;
      attribute float part;
      varying vec3 vRel, vN, vWall, vRoof, vLocal;
      varying float vPart, vSeed, vShed;
      #include <logdepthbuf_pars_vertex>
      void main() {
        ivec2 c = uRCell + ivec2(cell);
        float h0 = ihash(c, 71u), h1 = ihash(c, 72u), h2 = ihash(c, 73u), h3 = ihash(c, 74u), h4 = ihash(c, 75u);
        vec2 jit = 0.25 + 1.5 * vec2(h0, h1);                      // inside the cell, in fine pixels
        ivec2 P = c * ${CELL_PX} + ivec2(floor(jit));              // the building's own fine pixel
        vec2 pm = (vec2(c * ${CELL_PX} - uFineOrg) - uFineFrac + jit) * ${FINE_PX.toFixed(2)};   // metres east, north of the scene origin
        vec3 wp = vec3(pm.x, 0.0, -pm.y);
        vec2 m = sceneToMap(wp);
        int fc = fineTexel(P);
        float inside = uFineOn * step(1.0, fineInside(vec2(P - uFineOrg) + 0.5));
        vec4 cov = uHasCover > 0.5 ? texture(uCover, natUv(m)) : vec4(0.0);
        // What stands here: a village house on a built-up pixel outside the city blocks, a big
        // shed on built-up ground at a town's edge, a farmhouse among the fields now and then.
        float built = fc == 6 ? 1.0 : 0.0, crop = fc == 5 ? 1.0 : 0.0;
        float town = smoothstep(0.22, 0.34, cov.b);                // the cities' blocks take over
        float shed = built * step(0.86, h4) * step(0.12, cov.b);
        float keep = inside * max(built * (1.0 - town) * step(h2, 0.82), max(shed * (1.0 - smoothstep(0.45, 0.6, cov.b)), crop * step(h2, 0.022)));
        float pw, zone;
        float raw = rawHeight(m, pw);
        float gh = max(flattenRunways(m, raw, zone), 0.0);
        vec2 nn = texture(uNormal, natUv(m)).rg * (255.0 / 127.0) - (128.0 / 127.0);
        keep *= step(cov.a, 0.2) * step(zone, 0.001) * step(length(nn), 0.32) * step(20.0, seaDistance(m, raw)) * step(15.0, inlandDistance(m));
        // v0.6.1: not on glass ground (terrain.js's glassy, at the building's pixel), where
        // greenhouses.js's tunnels stand now: a house there would rise through them.
        float glassy = (1.0 - smoothstep(0.12, 0.30, cov.b)) * smoothstep(0.10, 0.30, cov.g) * (1.0 - smoothstep(0.03, 0.06, length(nn)))
                     * smoothstep(0.50, 0.58, glassPatch(vec2(P - uFineOrg) + 0.5));
        keep *= 1.0 - built * step(0.5, glassy) * uGlassOn;
        // Thin out towards the edge of the range and with height.
        vec2 dc = pm - vec2(uCamPos.x, -uCamPos.z);
        float dist = length(dc);
        keep *= step(smoothstep(${(RANGE * 0.5).toFixed(1)}, ${(RANGE * 0.97).toFixed(1)}, dist), h3 * 0.8 + 0.1);
        float grow = (1.0 - smoothstep(${(RANGE * 0.82).toFixed(1)}, ${(RANGE * 0.98).toFixed(1)}, max(abs(dc.x), abs(dc.y))))
                   * (1.0 - smoothstep(${(RURAL_MAX_AGL * 0.7).toFixed(1)}, ${RURAL_MAX_AGL.toFixed(1)}, uCamAgl));
        // Its size: length along the ridge, the wall's height, the depth, the roof's rise.
        vec3 size; float rise;
        if (shed > 0.5 && built > 0.5) { size = vec3(28.0 + 30.0 * h0, 6.0 + 3.5 * h1, 16.0 + 14.0 * h3); rise = 1.2 + 1.2 * h2; }
        else if (uCountry == 2) { size = vec3(10.0 + 5.0 * h0, 8.5 + 3.2 * floor(h3 * 2.0), 8.0 + 3.0 * h1); rise = size.z * 0.22; }    // three or four storeys
        else if (uCountry == 1) { size = vec3(9.0 + 5.0 * h0, 3.0 + 2.8 * step(0.35, h3), 7.0 + 2.5 * h1); rise = size.z * 0.30; }
        else { size = vec3(9.5 + 6.0 * h0, 3.0 + 2.8 * step(0.6, h3), 7.0 + 3.0 * h1); rise = size.z * 0.26; }
        size *= keep; rise *= keep;
        // Houses in a hamlet face much the same way (a direction per 250 m), each a little off it.
        float ang = ihash(c >> 2, 76u) * 3.14159 + (h4 - 0.5) * 0.5;
        float cr = cos(ang), sr = sin(ang);
        vec3 p = vec3(position.x * size.x, (min(position.y, 1.0) * size.y + max(position.y - 1.0, 0.0) * rise) * grow, position.z * size.z);
        vec2 q = vec2(cr * p.x - sr * (-p.z), sr * p.x + cr * (-p.z));
        wp = vec3(pm.x + q.x, gh - 1.0 * keep + p.y, -(pm.y + q.y));
        vec3 rel = wp - uCamPos;
        wp.y -= curveDrop(rel.xz);
        vRel = wp - uCamPos;
        vec3 nl = part > 0.5 ? normalize(vec3(0.0, size.z * 0.5, sign(normal.z) * rise)) : normal;
        vec2 nq = vec2(cr * nl.x - sr * (-nl.z), sr * nl.x + cr * (-nl.z));
        vN = vec3(nq.x, nl.y, -nq.y);
        vLocal = vec3(position.x * size.x, min(position.y, 1.0) * size.y, position.z * size.z);
        vPart = part; vSeed = h4; vShed = shed * built;
        // The look. Korea: white and cream walls, steel roofs in blue, orange-red, grey, green.
        // Japan: pale render and timber, dark tiles (slate, brown, a few blue). China: white
        // walls, dark grey or red tile. Sheds: pale walls, grey or blue steel.
        vec3 wall = mix(vec3(0.34, 0.33, 0.31), vec3(0.28, 0.25, 0.21), h1);
        vec3 roof;
        if (shed > 0.5 && built > 0.5) { wall = vec3(0.30, 0.31, 0.31); roof = h2 < 0.5 ? vec3(0.20, 0.21, 0.22) : (uCountry == 1 ? vec3(0.16, 0.17, 0.18) : vec3(0.08, 0.17, 0.34)); }
        else if (uCountry == 1) roof = h2 < 0.5 ? vec3(0.07, 0.075, 0.085) : h2 < 0.78 ? vec3(0.10, 0.075, 0.06) : h2 < 0.9 ? vec3(0.06, 0.09, 0.15) : vec3(0.20, 0.20, 0.205);
        else if (uCountry == 2) { wall = mix(vec3(0.36, 0.36, 0.35), vec3(0.30, 0.29, 0.27), h1); roof = h2 < 0.55 ? vec3(0.085, 0.085, 0.09) : h2 < 0.85 ? vec3(0.19, 0.08, 0.06) : vec3(0.08, 0.15, 0.30); }
        else roof = h2 < 0.34 ? vec3(0.07, 0.16, 0.34) : h2 < 0.60 ? vec3(0.33, 0.12, 0.06) : h2 < 0.85 ? vec3(0.17, 0.17, 0.175) : vec3(0.08, 0.20, 0.13);
        vWall = wall; vRoof = roof;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.NOISE_GLSL}
      varying vec3 vRel, vN, vWall, vRoof, vLocal;
      varying float vPart, vSeed, vShed;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vN);
        vec3 alb = vPart > 0.5 ? vRoof : vWall;
        vec3 glow = vec3(0.0);
        if (vPart < 0.5) {
          // Windows: a dark band a floor, broken along the wall; averaged out far away.
          float along = abs(n.x) > abs(n.z) ? vLocal.z : vLocal.x;
          float fl = fract(vLocal.y / 2.9), win = smoothstep(0.34, 0.42, fl) * (1.0 - smoothstep(0.72, 0.8, fl));
          float bay = smoothstep(0.18, 0.28, fract(along / 3.4)) * (1.0 - smoothstep(0.72, 0.82, fract(along / 3.4)));
          float fw = max(fwidth(vLocal.y), fwidth(along));
          float w = mix(win * bay, 0.14, smoothstep(0.3, 1.2, fw)) * (1.0 - 0.7 * vShed);
          alb = mix(alb, vec3(0.05, 0.06, 0.07), w * 0.8);
          if (uNight > 0.01) {
            // A few warm windows: a house in three has someone up.
            vec2 cid = vec2(floor(along / 3.4), floor(vLocal.y / 2.9));
            float lit = step(hash12(cid + vSeed * 371.0), 0.5) * step(vSeed, 0.34) * (1.0 - vShed);
            glow = vec3(1.0, 0.58, 0.26) * mix(lit * win * bay, 0.03 * step(vSeed, 0.34), smoothstep(0.3, 1.2, fw)) * uNight * 0.8;
          }
        } else if (vShed > 0.5) {
          alb *= 0.9 + 0.1 * step(0.5, fract(vLocal.x / 1.1));     // the sheeting's ribs
        }
        if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.5, 0.9, n.y));
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1) + glow;
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'rural';
  scene.add(mesh);
  const TRIS_EACH = base.getAttribute('position').count / 3;
  return {
    mesh,
    get listed() { return listN; },
    setGlass(on) { u.uGlassOn.value = on ? 1 : 0; },
    // camMap: the camera's map position; agl: its height above the ground (m).
    update(camMap, origin, agl) {
      const on = agl < RURAL_MAX_AGL && uniforms.uFineOn && uniforms.uFineOn.value > 0.5;
      mesh.visible = !!on;
      if (!on) return { tris: 0, drawCalls: 0 };
      const s = CELL_PX * FINE_PX;
      const ci = Math.floor((camMap.x - X0) / s), cj = Math.floor((camMap.y - Y0) / s);
      u.uCountry.value = COUNTRY[countryAt(camMap.x, camMap.y)] || 0;
      if (!LISTED) { u.uRCell.value.set(ci, cj); return { tris: TRIS_EACH * geo.instanceCount, drawCalls: 1 }; }
      const ai = Math.floor(ci / SNAP) * SNAP, aj = Math.floor(cj / SNAP) * SNAP;
      if (ai !== listAi || aj !== listAj || fine.version !== listVersion || (cov && cov.version() !== covVersion)) relist(ai, aj);
      u.uRCell.value.set(ai, aj);
      mesh.visible = listN > 0;
      return listN > 0 ? { tris: TRIS_EACH * listN, drawCalls: 1 } : { tris: 0, drawCalls: 0 };
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
