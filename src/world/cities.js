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
import { seaFloor } from './glsl.js';   // v0.7.0: the ground's floor (max(h, 0.0) in East Asia; none where land lies below the sea)
import { coverReader } from './clipwindow.js';
import { countryAt } from './region.js';
import { REGION_ID } from './regions.js';

const BLOCK = 400;          // m
const HALF = 20;            // blocks each side of the camera: ±8 km
const SLOTS = 15;           // 3 columns x 5 rows per block (Korea's)
// v0.6.0 Part 6: each country's own mix. A block's country goes to the shader in
// its slot index (slot + 64 x code); Japan's blocks have 30 slots (5 x 6), China's 20 (4 x 5).
// v0.6.3: Russia (Vladivostok's Soviet-era slab blocks on its hills) takes Korea's apartment-slab mix.
const COUNTRY_CODE = { KR: 0, KP: 0, other: 0, JP: 1, CN: 2, RU: 0 };
// v0.7.0, a stand-in until Europe's own mixes are written (briefs/V0-7-0.md Part 6: perimeter blocks, pitched roofs,
// terraces, towers only in clusters): a country this table doesn't know takes the region's default, and Europe's is
// Japan's mix (rows of two- and three-storey houses, mid-rise blocks, few towers), the nearest of the three to a low
// old European town. East Asia's default stays Korea's, as it was.
// v0.7.0 Part 6: Europe's own mixes (codes 3 to 7, drawn by EU_GEOM and EU_LOOK below; East Asia never sees them):
// 3 Britain and Ireland (brick terraces and semis under slate), 4 France (perimeter blocks under zinc, houses under
// slate, terracotta in the south), 5 Germany and the centre (perimeter blocks and houses under red-brown tile), 6 the
// south (pale blocks under terracotta), 7 the Low Countries and Denmark (as 5, in brick under dark tile). 4 to 7 share
// one geometry; only the walls and roofs differ. A European country not listed takes 5.
const EU_CODE = {
  GB: 3, IE: 3, GI: 3,
  FR: 4, MC: 4,
  DE: 5, AT: 5, CH: 5, LU: 5, LI: 5, PL: 5, CZ: 5, SK: 5, HU: 5, SI: 5, SE: 5, NO: 5,
  ES: 6, PT: 6, IT: 6, AD: 6, HR: 6, BA: 6, ME: 6, RS: 6, AL: 6, MA: 6,
  NL: 7, BE: 7, DK: 7,
};
const DEFAULT_CODE = REGION_ID === 'europe' ? 5 : 0;
const CODES = REGION_ID === 'europe' ? EU_CODE : COUNTRY_CODE;
const COUNTRY_SLOTS = [SLOTS, 30, 20, 20, 20, 20, 20, 20];   // Europe's: 4 x 5, fewer and bigger buildings than Japan's 30
// A country's mix as the CPU picks it (for tests): its code and its slots per block.
export function cityMixOf(country) {
  const code = CODES[country] ?? DEFAULT_CODE;
  return { code, slots: COUNTRY_SLOTS[code] };
}
const MAX_SLOTS = 30;
export const CITY_MAX_AGL = 4500;   // m above the ground: no buildings above this
// v0.6.1: the blocks in 4 x 4 tiles of 10 x 10 (HALF * 2 = TILES * TB), culled by the view.
const TILES = 4, TB = (2 * HALF) / TILES;
const TILE_MARGIN = 120;          // m round a tile's square: a building reaches up to about 75 m past its block (275 m from the centre)

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

// v0.7.0 Part 6: Europe's mixes, spliced into the vertex shader's text only when REGION_ID is 'europe' (euVert()):
// a branch before Japan's for codes 3 to 7, Europe's walls before `vTint = tint;` and roofs after `vSeg = seg;`. The
// kinds are the existing ones (3 a row of houses with vSeg, 4 a mid-rise, 5 a tower) plus 9, a church (its nave and
// spire, plain boxes that only Europe's colour block names). East Asia's text is the template below, untouched.
const EU_GEOM = /* glsl */ `        if (ctry >= 3) {
          // v0.7.0 Europe: 4 x 5 slots. Where it's densely built, four perimeter blocks round courtyards (five to
          // seven storeys; Britain's four to six), each side a slot, and a low building or (rarely, densest, not in
          // Britain) a post-war tower of 8 to 16 floors in each courtyard. Elsewhere Britain's terraces (semis at the
          // edges) in parallel streets; the continent's houses and small blocks of flats; a village church.
          col = si % 4; row = si / 4;
          ang = (ba - 0.5) * 1.0; rot = ang;
          lp = vec2((float(col) - 1.5) * 95.0, (float(row) - 2.0) * 76.0) + (vec2(sh0, sh1) - 0.5) * vec2(10.0, 8.0);
          bool town = dense > (ctry == 3 ? 0.62 : 0.5);
          if (town) {
            int qd = si < 16 ? si / 4 : si - 16;
            vec2 qc = (vec2(float(qd % 2), float(qd / 2)) - 0.5) * 190.0;
            if (si < 16) {
              int sd = si % 4;
              float bw = 118.0 + 30.0 * bh, bd = 13.0 + 3.0 * sh1;
              kind = 4.0;
              size = vec3(bw, ((ctry == 3 ? 4.0 : 5.0) + floor(3.0 * sh3)) * 3.2, bd);
              if (sd < 2) {
                lp = qc + vec2(0.0, (float(sd) - 0.5) * (bw - bd));
              } else {
                lp = qc + vec2((float(sd) - 2.5) * (bw - bd), 0.0);
                size.x = bw - 2.0 * bd;
                rot += 1.5708;
              }
              sh3 *= 0.5;                                    // the keep test: a block's sides stay together more often
            } else if (dense > 0.7 && bt > 0.95 && ctry != 3) {
              kind = 5.0;                                    // a tower: 8 to 16 floors
              lp = qc;
              size = vec3(22.0 + 10.0 * sh0, (8.0 + floor(9.0 * sh3 * sh3)) * 3.0, 20.0 + 8.0 * sh1);
            } else {
              kind = 4.0;                                    // a courtyard's workshop or school: 1 or 2 floors
              lp = qc + (vec2(sh0, sh1) - 0.5) * 30.0;
              size = vec3(18.0 + 14.0 * sh2, (1.0 + floor(2.0 * sh3)) * 3.5, 12.0 + 8.0 * sh0);
            }
          } else if (ctry == 3) {
            kind = 3.0;                                      // terraces of 8 to 13 houses; semis (2 or 4) at the edges
            bool semi = dense < 0.3;
            seg = semi ? 7.5 + 2.0 * sh2 : 5.0 + 1.5 * sh2;
            size = vec3(seg * (semi ? 2.0 + 2.0 * floor(1.6 * sh0) : 8.0 + floor(6.0 * sh0)), (2.0 + step(0.8, sh3)) * 2.9, 8.5 + 2.5 * sh1);
            if (dense > 0.45 && sh2 > 0.85) {
              kind = 4.0;                                    // a parade of shops, a block of flats: 3 to 6 floors
              seg = 0.0;
              size = vec3(30.0 + 20.0 * sh0, (3.0 + floor(4.0 * sh3)) * 3.0, 14.0 + 6.0 * sh1);
            }
          } else if (dense > 0.35 && sh2 > 0.5) {
            kind = 4.0;                                      // small blocks of flats: 3 to 5 floors
            size = vec3(24.0 + 22.0 * sh0, (3.0 + floor(3.0 * sh3)) * 3.0, 12.0 + 4.0 * sh1);
            rot += sh0 > 0.6 ? 1.5708 : 0.0;
          } else {
            kind = 3.0;                                      // houses, one to two to a slot: 2 or 3 floors
            seg = 10.0 + 3.0 * sh2;
            size = vec3(seg * (1.0 + floor(1.9 * sh0)), (2.0 + step(0.75, sh3)) * 2.9, 9.0 + 3.0 * sh1);
            rot += sh1 > 0.6 ? 1.5708 : 0.0;
          }
          if (!town && bh < 0.3 && si >= 18) {
            kind = 9.0;                                      // a church: the nave (19) and its spire (18) at its west end
            seg = 0.0;
            sh2 = 0.9; sh3 = 0.0;                            // kept together, and at any distance
            rot = ang;
            lp = vec2(si == 18 ? -16.0 : 0.0, 38.0);
            size = si == 18 ? vec3(6.0, 30.0 + 16.0 * bt, 6.0) : vec3(28.0, 13.0, 12.0);
          }
        } else `;
const EU_WALLS = /* glsl */ `        if (ctry >= 3) {
          // v0.7.0 Europe's walls: Britain's red and stock brick and white stucco; France's limestone blocks and pale
          // render; Germany's render and some brick; the Low Countries' brick; the south's cream, ochre and white.
          tint = kind == 5.0 ? mix(vec3(0.26, 0.27, 0.28), vec3(0.36, 0.36, 0.35), sh0)
               : kind == 9.0 ? vec3(0.36, 0.34, 0.30)
               : ctry == 3 ? (sh0 < 0.75 ? mix(vec3(0.24, 0.13, 0.09), vec3(0.31, 0.19, 0.13), sh2) : mix(vec3(0.36, 0.35, 0.32), vec3(0.42, 0.40, 0.36), sh2))
               : ctry == 4 ? (kind == 4.0 && dense > 0.5 ? mix(vec3(0.40, 0.38, 0.33), vec3(0.45, 0.42, 0.36), sh2) : mix(vec3(0.36, 0.34, 0.30), vec3(0.42, 0.40, 0.35), sh2))
               : ctry == 5 ? (sh0 < 0.3 ? mix(vec3(0.24, 0.14, 0.10), vec3(0.30, 0.19, 0.13), sh2) : mix(vec3(0.35, 0.34, 0.31), vec3(0.42, 0.40, 0.36), sh2))
               : ctry == 7 ? (sh0 < 0.8 ? mix(vec3(0.22, 0.12, 0.08), vec3(0.30, 0.17, 0.11), sh2) : mix(vec3(0.36, 0.35, 0.33), vec3(0.42, 0.41, 0.38), sh2))
               : (sh0 < 0.45 ? mix(vec3(0.42, 0.38, 0.30), vec3(0.46, 0.41, 0.32), sh2) : sh0 < 0.75 ? mix(vec3(0.42, 0.32, 0.21), vec3(0.47, 0.36, 0.24), sh2) : mix(vec3(0.40, 0.40, 0.38), vec3(0.45, 0.45, 0.43), sh2));
        }
`;
const EU_ROOFS = /* glsl */ `
        if (ctry >= 3) {
          // v0.7.0 Europe's roofs: slate in Britain and on churches; zinc on France's blocks, slate on its houses
          // (terracotta south of about 46 N); red-brown tile in Germany; dark tile in the Low Countries; terracotta south.
          bool sud = mc.y < -110000.0;
          vRoof = kind == 5.0 ? vec3(0.17, 0.17, 0.165) * (0.8 + 0.4 * sh1)
                : ctry == 3 || kind == 9.0 ? (rr < 0.8 ? vec3(0.10, 0.105, 0.12) * (0.85 + 0.3 * sh1) : vec3(0.21, 0.11, 0.08))
                : ctry == 4 ? (sud ? (rr < 0.8 ? mix(vec3(0.27, 0.12, 0.07), vec3(0.33, 0.17, 0.10), sh1) : vec3(0.24, 0.25, 0.26))
                             : kind == 4.0 ? (rr < 0.75 ? vec3(0.24, 0.25, 0.26) * (0.9 + 0.2 * sh1) : vec3(0.13, 0.14, 0.16))
                             : (rr < 0.7 ? vec3(0.12, 0.125, 0.14) : vec3(0.24, 0.12, 0.08)))
                : ctry == 7 ? (rr < 0.6 ? vec3(0.10, 0.095, 0.095) : vec3(0.22, 0.11, 0.08))
                : ctry == 5 ? (rr < 0.7 ? mix(vec3(0.22, 0.10, 0.07), vec3(0.27, 0.13, 0.09), sh1) : vec3(0.12, 0.11, 0.11))
                : (rr < 0.85 ? mix(vec3(0.27, 0.12, 0.07), vec3(0.33, 0.17, 0.10), sh1) : vec3(0.24, 0.23, 0.21));
        }`;
// East Asia's vertex shader text -> Europe's: four splices at anchors that must each occur exactly once.
export function euVert(src) {
  const once = (a) => { const i = src.indexOf(a); if (i < 0 || src.indexOf(a, i + 1) >= 0) throw new Error('cities: euVert anchor ' + JSON.stringify(a)); return i; };
  const A = '        if (ctry == 1) {', B = '        vTint = tint;', C = '        vSeg = seg;';
  // (a fourth: a church's walls and spire have no storeys, so no window bands and no lit floors at night; the
  // fragment shader draws both only above 1.5 m of the wall's own height, as rural.js's church does)
  const D = '        vLocal.y = position.y * size.y;';
  once(A); once(B); once(C); once(D);
  return src.replace(A, EU_GEOM + A.trimStart()).replace(B, EU_WALLS + B).replace(C, C + EU_ROOFS).replace(D, D + '\n        if (kind == 9.0) vLocal.y = 0.0;');
}

export function createCities(scene, uniforms, chunks) {
  // v0.6.0 Part 6: the countries' mixes, always compiled in since v0.7.0 (v0.6.0's flags are gone;
  // MIX stays a name so the shader's text below is v0.6.4's character for character).
  const MIX = true;
  const SK = MIX ? 'sk' : 'bc * 16 + ivec2(si, 0)';
  const box = boxGeometry();
  // v0.6.1: the ±8 km of blocks in TILES x TILES tiles of TB x TB blocks (4 km), each its own
  // instanced geometry and mesh on the one material, so a tile behind the camera or beside its
  // view isn't drawn at all (update() tests each tile's box against the view's frustum). The
  // buildings drawn in view are the same ones as before.
  const tiles = [];
  for (let t = 0; t < TILES * TILES; t++) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    const inst = new Float32Array(TB * TB * MAX_SLOTS * 3);
    const slotAttr = new THREE.InstancedBufferAttribute(inst, 3);
    slotAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('slot', slotAttr);
    geo.instanceCount = 0;
    tiles.push({ geo, inst, slotAttr, k: 0, mesh: null, box: new THREE.Box3() });
  }

  // Can block (bx, by) (map index) hold a building? The shader keeps a building only where
  // the cover's built-up share, plus at most 0.15 of noise, reaches 0.18: so 0.03 (8/255).
  // Buildings sit within ~230 m of the block centre, and the bilinear sample reaches one
  // cell further, so any texel centred within 240 m + a cell of the centre counts.
  // v0.6.0: the cover through clipwindow.js's coverReader (the grid itself over Korea; in a
  // following clip window only the cells it holds, and the blocks listed again when it refills).
  const cov = coverReader(uniforms);
  const nat = uniforms.uNat.value;
  const blockCache = new Map();
  let coverVer = cov ? cov.version() : 0;
  function blockBuilt(bx, by) {
    if (!cov) return true;
    const key = bx * 1e6 + by;
    let v = blockCache.get(key);
    if (v !== undefined) return v;
    const cell = nat.z, r = 240 + cell, [lx, ly] = cov.lo, [hx, hy] = cov.hi, at = cov.at;
    const cxm = (bx + 0.5) * BLOCK - nat.x, cym = (by + 0.5) * BLOCK - nat.y;
    const i0 = Math.max(Math.ceil((cxm - r) / cell - 0.5), lx), i1 = Math.min(Math.floor((cxm + r) / cell - 0.5), hx);
    const j0 = Math.max(Math.ceil((cym - r) / cell - 0.5), ly), j1 = Math.min(Math.floor((cym + r) / cell - 0.5), hy);
    v = false;
    // Off the map the texture clamps to its edge texel; those are in range after clamping.
    for (let j = Math.min(j0, hy); j <= Math.max(j1, ly) && !v; j++) {
      for (let i = Math.min(i0, hx); i <= Math.max(i1, lx); i++) if (at(i, j) >= 7) { v = true; break; }
    }
    if (blockCache.size > 200000) blockCache.clear();
    blockCache.set(key, v);
    return v;
  }
  let gridX = NaN, gridY = NaN, blocks = 0;
  // v0.6.0 Part 6: where the real centres' buildings stand (centres.js's maskAt), no procedural block.
  let maskAt = null, maskVersion = null, maskVer = 0;
  function fill(cx, cy) {
    blocks = 0;
    const mix = MIX;
    for (const T of tiles) T.k = 0;
    for (let j = -HALF; j < HALF; j++) for (let i = -HALF; i < HALF; i++) {
      if (!blockBuilt(cx + i, cy + j)) continue;
      if (maskAt && maskAt((cx + i + 0.5) * BLOCK, (cy + j + 0.5) * BLOCK)) continue;
      blocks++;
      // The block's country, by its centre (0, Korea's mix, everywhere unless Part 6 is on).
      const code = mix ? CODES[countryAt((cx + i + 0.5) * BLOCK, (cy + j + 0.5) * BLOCK)] ?? DEFAULT_CODE : 0;
      const ns = COUNTRY_SLOTS[code];
      const T = tiles[Math.floor((j + HALF) / TB) * TILES + Math.floor((i + HALF) / TB)], inst = T.inst;
      let k = T.k;
      for (let s = 0; s < ns; s++) { inst[k++] = i; inst[k++] = j; inst[k++] = s + 64 * code; }
      T.k = k;
    }
    for (const T of tiles) {
      T.geo.instanceCount = T.k / 3;
      T.slotAttr.needsUpdate = true;
      T.slotAttr.clearUpdateRanges();
      T.slotAttr.addUpdateRange(0, Math.max(T.k, 3));
    }
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
      varying float vKind, vDist, vApt, vSeed, vFace;
      ${MIX ? 'varying float vSeg;' : ''}
      #include <logdepthbuf_pars_vertex>
      const float BLOCK = ${BLOCK.toFixed(1)};
      void main() {
        ivec2 bc = ivec2(uGridCell + slot.xy);              // the block's map index
        ${MIX ? `int sz = int(slot.z), ctry = sz / 64, si = sz - ctry * 64;   // the block's country (0 Korea, 1 Japan, 2 China)
        ivec2 sk = bc * 16 + ivec2(si & 15, si >> 4);          // the slot's hash cell (bc * 16 + (si, 0) for Korea's 15)` : 'int si = int(slot.z);'}
        float bh = ihash(bc, 21u), ba = ihash(bc, 22u), bt = ihash(bc, 23u);
        float sh0 = ihash(${SK}, 31u), sh1 = ihash(${SK}, 32u);
        float sh2 = ihash(${SK}, 33u), sh3 = ihash(${SK}, 34u);
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
        ${MIX ? `        float seg = 0.0;                                     // a row of houses: the length of one (m); 0: one building
        if (ctry == 1) {
          // Japan: dense low-rise as most of it (rows of two- and three-storey houses under dark
          // tiled roofs), mid-rise "pencil" buildings along the arterials (the block's rim: the
          // streets run between blocks), and a cluster of towers where it is densest.
          col = si % 5; row = si / 5;
          bool rim = col == 0 || col == 4 || row == 0 || row == 5;
          bool core = dense > 0.62 && bt > 0.88;
          ang = (ba - 0.5) * 1.2; rot = ang;
          lp = vec2((float(col) - 2.0) * 76.0, (float(row) - 2.5) * 62.0) + (vec2(sh0, sh1) - 0.5) * vec2(26.0, 22.0);
          if (core && sh2 > 0.45) {
            kind = 5.0;                                      // a tower: 18 to 42 floors
            size = vec3(26.0 + 14.0 * sh0, (18.0 + floor(24.0 * sh3 * sh3)) * 3.6, 24.0 + 12.0 * sh1);
          } else if ((rim && dense > 0.35 && sh1 > 0.35) || (dense > 0.6 && sh2 > 0.55) || core) {
            kind = 4.0;                                      // mid-rise: 4 to 11 floors, narrow
            size = vec3(12.0 + 12.0 * sh2, (4.0 + floor(8.0 * sh3 * sh3)) * 3.1, 11.0 + 9.0 * sh0);
            rot += sh0 > 0.5 ? 1.5708 : 0.0;
          } else {
            kind = 3.0;                                      // a row of houses: 2 or 3 floors
            seg = 8.0 + 3.0 * sh2;
            size = vec3(seg * (5.0 + floor(4.0 * sh0)), (2.0 + floor(1.6 * sh3)) * 2.9, 9.0 + 3.5 * sh1);   // five to eight houses in a row
            rot += sh1 > 0.6 ? 1.5708 : 0.0;
          }
        } else if (ctry == 2) {
          // China: compounds of tall residential point towers (25 to 35 floors, all of a height),
          // rows of older six-storey slabs and sheds in the outer and older parts, and clusters of
          // skyscrapers where it is densest.
          col = si % 4; row = si / 4;
          ang = (ba - 0.5) * 0.5; rot = ang;
          lp = vec2((float(col) - 1.5) * 95.0, (float(row) - 2.0) * 76.0) + (vec2(sh0, sh1) - 0.5) * vec2(14.0, 10.0);
          if (dense > 0.6 && bt > 0.9) {
            kind = 8.0;                                      // skyscrapers: 28 to 62 floors
            size = vec3(34.0 + 12.0 * sh2, (28.0 + floor(34.0 * sh3 * sh3)) * 3.9, 32.0 + 12.0 * sh1);
            if (sh0 > 0.7) size.y *= 0.35;                   // podiums and lower neighbours
          } else if (dense > 0.42 && bt < 0.40) {
            kind = 6.0;                                      // point towers, one height a compound: older ones 14 to 20 floors, newer 25 to 35
            size = vec3(27.0 + 5.0 * sh2, ((bh < 0.45 ? 14.0 + floor(13.0 * bh) : 25.0 + floor(18.0 * (bh - 0.45))) + floor(2.0 * sh3)) * 2.9, 22.0 + 4.0 * sh0);
            if (sh1 > 0.93) size = vec3(40.0, 9.0, 24.0);    // a kindergarten or shops
          } else {
            kind = 7.0;                                      // older slabs, 5 to 7 floors, in rows
            size = vec3(46.0 + 22.0 * sh2, (5.0 + floor(2.5 * sh3)) * 3.0, 12.0 + 1.5 * sh0);
            if (sh1 > 0.88) size = vec3(60.0 + 30.0 * sh2, 8.0 + 4.0 * sh3, 28.0 + 14.0 * sh0);   // a shed (the blue roofs)
          }
        } else` : ''}
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
        float h = ${seaFloor('flattenRunways(m, raw, zone)')};
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
        ${MIX ? `        if (kind > 2.5) {
          // v0.6.0: Japan's pale render and tile, its towers' glass and pale concrete; China's
          // beige, pink-grey and white towers, its older slabs' cream and brick.
          tint = kind == 3.0 ? mix(vec3(0.34, 0.33, 0.30), vec3(0.27, 0.24, 0.20), sh2)
               : kind == 4.0 ? (sh0 < 0.3 ? mix(vec3(0.24, 0.16, 0.12), vec3(0.30, 0.22, 0.16), sh2) : mix(vec3(0.30, 0.30, 0.29), vec3(0.38, 0.36, 0.33), sh2))
               : kind == 5.0 ? mix(vec3(0.16, 0.20, 0.24), vec3(0.34, 0.34, 0.33), sh0)
               : kind == 6.0 ? (sc < 0.4 ? vec3(0.36, 0.33, 0.28) : sc < 0.7 ? vec3(0.34, 0.29, 0.27) : vec3(0.33, 0.34, 0.35)) * (0.9 + 0.15 * sh2)
               : kind == 7.0 ? (sh0 < 0.35 ? mix(vec3(0.25, 0.15, 0.11), vec3(0.30, 0.20, 0.15), sh2) : mix(vec3(0.30, 0.29, 0.26), vec3(0.36, 0.34, 0.29), sh2))
               : mix(vec3(0.10, 0.17, 0.22), vec3(0.24, 0.29, 0.31), sh0);
        }` : ''}
        vTint = tint;
        float rr = ihash(${SK}, 35u);
        vRoof = rr < 0.55 ? vec3(0.17, 0.17, 0.165) * (0.8 + 0.4 * sh1)
              : rr < 0.75 ? vec3(0.10, 0.14, 0.11)            // green waterproofing
              : rr < 0.88 ? vec3(0.20, 0.10, 0.07)            // terracotta / red
              : vec3(0.26, 0.26, 0.25);                       // pale concrete
        ${MIX ? `// v0.6.0: Japan's houses under dark tile (slate, brown, some blue, some pale metal);
        // China's sheds under blue steel, its slabs under red-brown or grey.
        if (kind == 3.0) vRoof = rr < 0.45 ? vec3(0.085, 0.09, 0.105) : rr < 0.70 ? vec3(0.12, 0.085, 0.065) : rr < 0.82 ? vec3(0.07, 0.10, 0.17) : vec3(0.24, 0.24, 0.245);
        else if (kind == 7.0) vRoof = size.z > 20.0 ? (rr < 0.7 ? vec3(0.07, 0.15, 0.32) : vec3(0.20, 0.20, 0.20)) : (rr < 0.5 ? vec3(0.19, 0.09, 0.07) : vec3(0.17, 0.17, 0.165));
        vSeg = seg;` : ''}
        vApt = kind == 0.0${MIX ? ' || kind == 6.0' : ''} ? 1.0 : 0.0;
        // Night windows: a seed per building, and which face (so opposite faces differ).
        vSeed = ihash(${SK}, 36u);
        vFace = normal.x + 2.0 * normal.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.NOISE_GLSL}
      varying vec3 vRel, vN, vLocal, vTint, vRoof;
      varying float vKind, vDist, vApt, vSeed, vFace;
      ${MIX ? 'varying float vSeg;' : ''}
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vN);
        vec3 alb = vTint;
        vec3 glow = vec3(0.0);     // lit windows at night (emitted, not lit by the sun)
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
          if (uNight > 0.01 && y > 1.5) {
            // Lit windows: one cell per flat (9.6 m) or per two window bays (6.4 m) on each
            // floor; each building has its own share lit (late evening: about a third), most
            // warm, some cool white (LED, a television). Far away the cells average out to that
            // share, so no moire.
            float cellW = vApt > 0.5 && vKind < 1.5 ? 9.6 : 6.4;
            vec2 cid = vec2(floor(along / cellW), floor(y / 2.9));
            float hs = hash12(cid + vec2(vSeed * 913.0 + vFace * 57.0, vSeed * 371.0));
            float share = 0.12 + 0.26 * vSeed;
            float lit = step(hs, share);
            float hk = hash12(cid * 1.37 + vSeed * 77.0 + 3.1);
            vec3 wc = hk < 0.7 ? vec3(1.0, 0.56, 0.24) : (hk < 0.9 ? vec3(0.8, 0.84, 0.95) : vec3(0.45, 0.6, 1.0));
            float dimmer = 0.45 + 0.55 * hash12(cid + 11.7 + vSeed * 19.0);
            float avg = smoothstep(0.5, 1.6, max(fw / 2.9, fwidth(along) / cellW));
            vec3 cellCol = wc * lit * dimmer;
            vec3 meanCol = vec3(1.0, 0.6, 0.3) * share * 0.2;   // dimmer than the true mean: far off, a few bright points read darker than an even wash
            glow = mix(cellCol, meanCol, avg) * w * uNight * 0.9;
          }
          // Ground floor darker; a little weathering towards the base.
          alb *= (0.75 + 0.25 * step(3.0, y)) * (0.85 + 0.15 * smoothstep(0.0, 25.0, y));
        } else {
          alb = vRoof;
        }
        ${MIX ? `        if (vSeg > 0.0) {
          // v0.6.0: a row of houses (Japan): each house its own shade of the wall and the roof,
          // with a dark gap between neighbours, averaged out once a house is a pixel wide.
          float hx = vLocal.x / vSeg, hw = fwidth(hx) + 1e-4;
          float hid = floor(hx);
          float shade = 0.78 + 0.44 * hash12(vec2(hid, vSeed * 311.0));
          float gap = smoothstep(0.0, 0.06 + hw, fract(hx)) * (1.0 - smoothstep(0.94 - hw, 1.0, fract(hx)));
          float far = smoothstep(0.35, 1.2, hw);
          alb *= mix(shade * mix(0.45, 1.0, gap), 0.93, far);
          if (vKind < 0.5) alb *= mix(0.80 + 0.2 * step(0.5, fract(vLocal.z / 12.0 + 0.5)), 0.9, far);   // the ridge: one slope in the light
        }` : ''}
        if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.55, 0.9, n.y));   // v0.4.0: snow on the roofs
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1) + glow;
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  if (REGION_ID === 'europe') mat.vertexShader = euVert(mat.vertexShader);   // v0.7.0: before its first compile
  const mesh = new THREE.Group();          // (still `mesh` to its users: hiding it hides the cities)
  mesh.name = 'cities';
  tiles.forEach((T, t) => {
    T.mesh = new THREE.Mesh(T.geo, mat);
    T.mesh.frustumCulled = false;          // three.js can't know where the shader puts the instances: update() culls
    T.mesh.name = `cities-${t}`;
    T.mesh.visible = false;
    mesh.add(T.mesh);
  });
  scene.add(mesh);
  const tris = 10;   // per instance

  return {
    mesh,
    // The real centres' mask: at(x, y) true where a block is left out; version() rises when it changes.
    setMask(at, version) { maskAt = at || null; maskVersion = version || null; maskVer = version ? version() : 0; gridX = NaN; },
    // frustum (v0.6.1): the view's THREE.Frustum in scene coordinates; without one every tile is drawn.
    update(camMap, origin, agl, frustum = null) {
      const on = agl < CITY_MAX_AGL;
      mesh.visible = on;
      if (!on) return { instances: 0, tris: 0, drawCalls: 0 };
      const cx = Math.floor(camMap.x / BLOCK), cy = Math.floor(camMap.y / BLOCK);
      if (cov && cov.version() !== coverVer) { coverVer = cov.version(); blockCache.clear(); gridX = NaN; }
      if (maskVersion && maskVersion() !== maskVer) { maskVer = maskVersion(); gridX = NaN; }
      if (cx !== gridX || cy !== gridY) { gridX = cx; gridY = cy; fill(cx, cy); }
      u.uGridCell.value.set(cx, cy);
      u.uGridBase.value.set(cx * BLOCK - origin.x, cy * BLOCK - origin.y);
      // Each tile's box in the scene (x east, z south; the buildings stand within ~230 m of their
      // block's centre, so a block's own square and a margin; any height a city stands at).
      let count = 0, calls = 0;
      for (let t = 0; t < tiles.length; t++) {
        const T = tiles[t];
        let vis = T.k > 0;
        if (vis && frustum) {
          const i0 = (t % TILES) * TB - HALF, j0 = Math.floor(t / TILES) * TB - HALF;
          const x0 = (cx + i0) * BLOCK - origin.x, y0 = (cy + j0) * BLOCK - origin.y;
          T.box.min.set(x0 - TILE_MARGIN, -200, -(y0 + TB * BLOCK) - TILE_MARGIN);
          T.box.max.set(x0 + TB * BLOCK + TILE_MARGIN, 4500, -y0 + TILE_MARGIN);
          vis = frustum.intersectsBox(T.box);
        }
        T.mesh.visible = vis;
        if (vis) { count += T.k / 3; calls++; }
      }
      return { instances: count, tris: tris * count, drawCalls: calls, blocks };
    },
  };
}
