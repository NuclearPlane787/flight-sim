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
import { FINE_GLSL, FINE_PX } from './finecover.js';   // v0.7.7 towns: the 31 m cover's water, in Europe's blended town only

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
// v0.7.7 (briefs/V0-7-7.md part 1, the towns): one switch for the part, on by default, read once at import from the
// page's query (?towns77=0) or in node from FS_TOWNS77=0, as apron.js's lookSwitch(). Off, Europe's town is v0.7.6's
// shader text character for character, and centres.js draws the courtyards roofed (it imports this switch).
export function towns77Switch() {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]towns77=([01])\b/.exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.FS_TOWNS77 === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const TOWNS77 = towns77Switch();
export const TOWNS77_CENTRES = 4;      // the nearest ready centres' boxes the shader blends round
// v0.7.7 towns: Europe's town (euVert()'s text) -> the blended one. Eight splices at anchors that must each occur once,
// every one inside Europe's own branches (ctry >= 3): East Asia never compiles this.
//  - the town round a real centre: towns77Dist() is the distance (m) from a block's centre to the nearest ready centre's
//    box (0 inside); tFar rises from 0 within 500 m of it to 1 at 3 km and beyond (and where no centre is near);
//  - perimeter blocks round courtyards only where it's dense enough, the threshold rising with tFar and wandering with a
//    seeded noise of the position (vnoise: a function of the map position only), and then only a share of those blocks
//    (a block hash under 0.85 near a centre, 0.30 far from one, wandering with the noise), so far from a centre (Dijon,
//    the far bank at Zaragoza) most of the town is houses and small flats, with a block here and there;
//  - each courtyard block's size by the block's hash and a second noise, its storeys falling by up to two with tFar;
//  - the dense blocks that aren't courtyards near a centre mostly flats of three to eight floors; the flats thinning out
//    with tFar: past the centre, low houses;
//  - round a centre's box the generated town thins to about half over a band whose line wanders by +-250 m (so no
//    straight edge where the real footprints stop), and inside the box, in the cells the real buildings don't take;
//  - no generated building where the 31 m cover (finecover.js's water class) has water under its middle or either end;
//  - the roofs' mix drifting by the first noise and with tFar (more of each mix's first tone further out).
export const TOWNS77_GLSL = /* glsl */ `
      // v0.7.7 towns: the nearest ready real centres' boxes, relative to the scene origin (x0, y0, x1, y1).
      uniform vec4 uCtr[${TOWNS77_CENTRES}];
      uniform float uCtrN;
      float towns77Dist(vec2 p) {
        float d = 1e6;
        for (int k = 0; k < ${TOWNS77_CENTRES}; k++) {
          if (float(k) >= uCtrN) break;
          vec4 b = uCtr[k];
          d = min(d, length(max(max(b.xy - p, p - b.zw), vec2(0.0))));
        }
        return d;
      }
`;
// v0.7.7 towns, part 3 (the low suburbs) on a switch of its own: ?suburbs77=0 (node FS_SUBURBS77=0), on by default and
// meaningful only with towns77 on. Off, towns77 keeps its blend round the centres, the block sizes and heights by place,
// the roofs' drift and the river rule, and the town keeps v0.7.6's courtyard rule.
export function suburbs77Switch() {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]suburbs77=([01])\b/.exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.FS_SUBURBS77 === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const SUBURBS77 = TOWNS77 && suburbs77Switch();
// The suburbs' rule as GLSL, shared by the town's vertex shader and the terrain's (its garden ground), so the two agree
// block for block. Needs TOWNS77_GLSL, NOISE_GLSL's ihash() and vnoise(), uCover and natUv(). mcAbs: the 400 m block's
// centre on the map; cRel: the same relative to the scene origin; thr0: the mix's courtyard threshold (v0.7.6's), used
// for a village only: the suburbs' rule takes 0.5 everywhere, so the terrain's gardens (which don't know the block's
// country) agree with the buildings in Britain too.
//  - a village (the cover within 1.6 km round the block, four samples, under 0.22 on average) keeps v0.7.6's rule;
//  - else courtyard blocks only above a threshold that rises with tFar (0 within 500 m of a ready centre's box, 1 at
//    3 km and where none is near) and wanders with a noise of the position, and only for a hashed share of the blocks
//    (0.85 near, 0.45 far);
//  - the other built-up blocks, a hashed share rising with tFar, are filled with terraces (t77Block() == 1).
export const SUBURB77_GLSL = /* glsl */ `
      float t77Dense(vec2 mAbs) { return uHasCover > 0.5 ? texture(uCover, natUv(mAbs)).b : 0.0; }
      bool t77Village(vec2 mcAbs) {
        float a = t77Dense(mcAbs + vec2(1600.0, 0.0)) + t77Dense(mcAbs - vec2(1600.0, 0.0)) + t77Dense(mcAbs + vec2(0.0, 1600.0)) + t77Dense(mcAbs - vec2(0.0, 1600.0));
        return a * 0.25 < 0.22;
      }
      int t77Block(ivec2 bc, vec2 mcAbs, vec2 cRel, float dense, float thr0) {   // 0 courtyards, 1 terraces, 2 the rest
        float tFar = smoothstep(500.0, 3000.0, towns77Dist(cRel)), tN = vnoise(mcAbs * 0.0011);
        if (t77Village(mcAbs)) return dense > thr0 ? 0 : 2;
        if (dense > 0.5 + 0.16 * tFar + (tN - 0.5) * 0.16 && ihash(bc, 25u) < mix(0.85, 0.30, tFar) + (tN - 0.5) * 0.4) return 0;
        if (!(dense > 0.3 && ihash(bc, 26u) < 0.55 + 0.3 * tFar)) return 2;
        // (round 3) a terrace block with no terrace-able neighbour takes the neighbours' kind: no lone patch
        int nb = 0;
        for (int k = 0; k < 4; k++) {
          ivec2 o = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
          if (t77Dense(mcAbs + vec2(o) * 400.0) > 0.3 && ihash(bc + o, 26u) < 0.55 + 0.3 * tFar) nb++;
        }
        return nb > 0 ? 1 : 2;
      }
      // (round 3) a terrace quarter's own layout, by its hashes (the town and the terrain read the same): rows 3 to 6,
      // across (most) or along the quarter, or none (a green); qi: the quarter (0 or 1 each way).
      void t77Quarter(ivec2 bc, ivec2 qi, out int nRows, out bool turned, out bool green) {
        ivec2 qk = bc * 2 + qi;
        nRows = 3 + int(floor(ihash(qk, 28u) * 2.999));   // 3 to 5: a block's slots hold five rows a quarter (the code review's second look: with 6, the sixth was never drawn and the quarter stood lopsided)
        turned = ihash(qk, 27u) < 0.28;
        green = ihash(qk, 29u) < 0.10;
      }
`;
// v0.7.7 suburbs: the uniforms of the nearest ready centres, one pair of objects shared by the town's material and the
// terrain's (terrain.js puts them in its own uniforms with suburbs77 on), so both read the boxes cities.js sets.
export const TOWNS77_UNIFORMS = { uCtr: { value: Array.from({ length: TOWNS77_CENTRES }, () => new THREE.Vector4()) }, uCtrN: { value: 0 } };
// v0.7.7 suburbs: the terrain's ground under a block of terraces (t77Block() == 1): in each quarter, garden plots between
// the five rows (lawn in several greens, a hedge between plots, a few trees' darker tones), the streets left to the
// town's own ground. m: the map point; lod: metres a pixel. Returns the colour, and in w how much of it to take.
export const GARDEN77_GLSL = /* glsl */ `
      vec3 garden77(vec2 m, float lod, out float w) {
        w = 0.0;
        vec2 bcf = floor(m / 400.0), mc = (bcf + 0.5) * 400.0;
        ivec2 bc = ivec2(bcf);
        // (round 3b) only as far as the houses they belong to (drawn within 8 km and below 4,500 m): full to 6 km of true
        // distance from the camera to the point, none by 7.8 km, a smooth function of distance only
        float far = length(vec3(m - uOrigin - vec2(uCamPos.x, -uCamPos.z), max(uCamAgl, 0.0)));
        if (far > 7800.0) return vec3(0.0);
        float dn = t77Dense(mc);
        int tb = t77Block(bc, mc, mc - uOrigin, dn, 0.5);
        if (tb == 0 || (tb == 2 && (dn < 0.3 || t77Village(mc)))) return vec3(0.0);   // gardens under the terraces, and lighter under the other low blocks
        float ang = (ihash(bc, 22u) - 0.5) * 1.0, ca = cos(ang), sa = sin(ang);
        vec2 d = m - mc, q = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);   // the block's own frame (cities.js's lp)
        vec2 v = q - sign(q) * 95.0;                                           // from the quarter's middle
        // (round 3) the gardens reach the street with a ragged hedge line, no pad; a turned quarter's plots run the other way
        int nR = 5; bool turned = false, green = false;
        if (tb == 1) t77Quarter(bc, ivec2(step(0.0, q)), nR, turned, green);
        if (turned) v = v.yx;
        float rag = (vnoise(m * 0.045) - 0.5) * 6.0;
        float inside = (1.0 - smoothstep(84.0 + rag, 88.0 + rag, abs(v.x))) * (1.0 - smoothstep(84.0 - rag, 88.0 - rag, abs(v.y))) * (tb == 1 ? 1.0 : 0.6);
        if (inside <= 0.0) return vec3(0.0);
        float pitch = 150.0 / float(nR);
        // (the code review's second look) The rows stand at (k - (nR - 1) / 2) pitches: whole pitches for 3 or 5 rows, half pitches for 4.
        // The plots' boundaries must fall midway between two rows either way, so an even count shifts the cells by half a pitch.
        float vy = v.y + 0.5 * pitch * float(1 - nR % 2);
        vec2 cell = floor(vec2(v.x / 8.0, (vy + 0.5 * pitch) / pitch)), f = vec2(fract(v.x / 8.0), fract((vy + 0.5 * pitch) / pitch));
        if (green) { cell = floor(v / 24.0); f = fract(v / 24.0); }            // a green: a few big lawns
        ivec2 pc = bc * 64 + ivec2(cell) + ivec2(sign(q) * 17.0);
        float h0 = ihash(pc, 61u), h1 = ihash(pc, 62u);
        vec3 lawn = mix(vec3(0.074, 0.104, 0.044), vec3(0.108, 0.126, 0.058), h0);
        lawn = mix(lawn, vec3(0.120, 0.112, 0.085), step(0.82, h1));            // a patio, a shed's roof
        lawn = mix(lawn, vec3(0.040, 0.060, 0.030), step(h1, 0.16) * (1.0 - smoothstep(0.25, 0.45, length(f - 0.5))));   // a tree
        float hedge = 1.0 - smoothstep(0.06, 0.06 + lod / 8.0 + 0.04, min(f.x, 1.0 - f.x));
        lawn = mix(lawn, vec3(0.045, 0.062, 0.032), hedge * 0.7);
        vec3 avg = vec3(0.086, 0.106, 0.050);
        w = inside * 0.92 * (1.0 - smoothstep(6000.0, 7800.0, far));
        return mix(lawn, avg, smoothstep(3.0, 12.0, lod));
      }
`;
export function towns77Vert(src, suburbs = SUBURBS77) {
  const once = (a) => { const i = src.indexOf(a); if (i < 0 || src.indexOf(a, i + 1) >= 0) throw new Error('cities: towns77Vert anchor ' + JSON.stringify(a)); return i; };
  // [anchor, replacement, part]: 2 the blend and the river (towns77), 3 the suburbs (suburbs77 too)
  const R = [
    ['      const float BLOCK = ', (a) => TOWNS77_GLSL + (suburbs ? SUBURB77_GLSL : '') + FINE_GLSL + a, 2],
    ['          bool town = dense > (ctry == 3 ? 0.62 : 0.5);', () => `          float tD = towns77Dist(centre), tFar = smoothstep(500.0, 3000.0, tD);   // v0.7.7 towns
          float tN = vnoise(mc * 0.0011), tN2 = vnoise(mc * 0.0031 + 17.0);
          ${suburbs ? 'int tB = t77Block(bc, mc, centre, dense, ctry == 3 ? 0.62 : 0.5);   // v0.7.7 suburbs: 0 courtyards, 1 terraces, 2 the rest\n          bool town = tB == 0;' : 'bool town = dense > (ctry == 3 ? 0.62 : 0.5);'}`, 2],
    ['              float bw = 118.0 + 30.0 * bh, bd = 13.0 + 3.0 * sh1;', () => '              float bw = (100.0 + 50.0 * bh) * (0.70 + 0.55 * tN2), bd = 12.0 + 5.0 * sh1;   // v0.7.7 towns', 2],
    ['              size = vec3(bw, ((ctry == 3 ? 4.0 : 5.0) + floor(3.0 * sh3)) * 3.2, bd);', () => '              size = vec3(bw, max(3.0, (ctry == 3 ? 4.0 : 5.0) + floor(3.0 * sh3) - floor(2.0 * tFar + 1.2 * (tN2 - 0.5) + 0.5)) * 3.2, bd);   // v0.7.7 towns', 2],
    ['        keep *= step(30.0, sea) * step(25.0, inl) * step(length(nn), 0.3) * step(zone, 0.001);', (a) => a + `
        if (ctry > 2) {
          // v0.7.7 towns: thinned round a real centre's box (a wandering band, no straight line), and off the 31 m water.
          float tE = towns77Dist(centre) + (vnoise(mc * 0.0031 + 17.0) - 0.5) * 500.0;
          keep *= step(ihash(${'sk'}, 37u), 0.45 + 0.55 * smoothstep(-150.0, 450.0, tE));
          if (uFineOn > 0.5) {
            vec2 fp = finePos(vec2(pc.x, -pc.y));
            if (fineInside(fp) > 2.0) {
              vec2 ax = vec2(cos(rot), sin(rot)) * (0.5 * size.x / ${FINE_PX.toFixed(2)});
${suburbs ? '              int f0 = fineTexel(ivec2(floor(fp)) + uFineOrg), f1 = fineTexel(ivec2(floor(fp + ax)) + uFineOrg), f2 = fineTexel(ivec2(floor(fp - ax)) + uFineOrg);\n              if (f0 == 1 || f1 == 1 || f2 == 1 || (kind == 3.0 && (f0 == 2 || f1 == 2 || f2 == 2))) keep = 0.0;   // (suburbs: no house on water or in a wood)' : '              if (fineTexel(ivec2(floor(fp)) + uFineOrg) == 1 || fineTexel(ivec2(floor(fp + ax)) + uFineOrg) == 1 || fineTexel(ivec2(floor(fp - ax)) + uFineOrg) == 1) keep = 0.0;'}
            }
          }
        }`, 2],
    ['          bool sud = mc.y < -110000.0;', (a) => `          rr = clamp(rr + 0.35 * (vnoise(mc * 0.0011) - 0.5) - 0.12 * smoothstep(500.0, 3000.0, towns77Dist(centre)), 0.0, 0.999);   // v0.7.7 towns
${suburbs ? '          if (kind == 3.0) { float rn = clamp(vnoise(mc * 0.0009 + 5.0) * 1.2 - 0.1 + (rr - 0.5) * 0.08, 0.0, 0.999); rr = ctry == 5 || ctry == 6 ? rn * 0.75 : 0.3 + 0.7 * rn; }   // v0.7.7 suburbs: one tile family a neighbourhood, a little varied\n' : ''}` + a, 2],
    ['          } else if (dense > 0.35 && sh2 > 0.5) {', () => '          } else if (dense > 0.35 + 0.2 * tFar && sh2 > 0.5 + 0.12 * tFar - 0.5 * max(dense - 0.5, 0.0) * (1.0 - tFar)) {   // v0.7.7 suburbs: flats in the dense blocks near a centre, fewer past it', 3],
    ['            size = vec3(24.0 + 22.0 * sh0, (3.0 + floor(3.0 * sh3)) * 3.0, 12.0 + 4.0 * sh1);', () => '            size = vec3(24.0 + 22.0 * sh0, (3.0 + floor(3.0 * sh3) + (dense > 0.6 ? floor(3.0 * (1.0 - tFar) * sh0) : 0.0)) * 3.0, 12.0 + 4.0 * sh1);   // v0.7.7 suburbs: taller near a centre', 3],
    ['            size = vec3(seg * (1.0 + floor(1.9 * sh0)), (2.0 + step(0.75, sh3)) * 2.9, 9.0 + 3.0 * sh1);', () => `            seg = 7.0 + 2.5 * sh2;   // v0.7.7 suburbs: the houses in terraces of five to nine (four to six across), 9 to 11 m deep
            size = vec3(seg * (sh1 > 0.6 ? 4.0 + floor(2.9 * sh0) : 5.0 + floor(4.9 * sh0)), (2.0 + step(0.75, sh3)) * 2.9, 9.0 + 2.0 * sh1);`, 3],
    ['          if (town) {', () => `          if (tB == 1) {
            // v0.7.7 suburbs: a block of terraces: in each of its four quarters five terraces across it, 31 m apart (9 to 11 m
            // of houses and a garden's depth behind), each one instance with its ridge along the row (the shader's vSeg).
            int qd = si < 16 ? si / 4 : si - 16, tr = si < 16 ? si % 4 : 4;
            ivec2 qi = ivec2(qd % 2, qd / 2);
            vec2 qc = (vec2(qi) - 0.5) * 190.0;
            int nR; bool turned, green;
            t77Quarter(bc, qi, nR, turned, green);
            float pitch = 150.0 / float(nR);                   // (round 3) 3 to 5 rows: the gardens 20 to 40 m deep
            kind = 3.0; seg = 6.5 + 2.5 * sh2;
            float len = (140.0 + 20.0 * bh) * (sh2 < 0.3 ? 0.40 + 0.25 * sh1 : 0.75 + 0.25 * sh1);   // some rows broken short
            vec2 o = vec2((sh0 - 0.5) * (150.0 - len) * 0.9, (float(tr) - 0.5 * float(nR - 1)) * pitch);
            lp = qc + (turned ? vec2(o.y, o.x) : o);
            if (turned) rot += 1.5708;
            size = vec3(len, (2.0 + step(0.7, sh3)) * 2.9, 9.0 + 2.0 * sh1);
            if (tr >= nR || green) size = vec3(0.0);           // the quarter's rows past its count, or a green
            sh3 *= 0.5;
          } else if (town) {`, 3],
    ['        vApt = kind == 0.0 || kind == 6.0 ? 1.0 : 0.0;', (a) => `        if (ctry > 2) {   // v0.7.7 suburbs (round 3): within 600 m of a real centre's box, its paler roofs and walls
          float tP = 1.0 - smoothstep(0.0, 600.0, towns77Dist(centre) + (vnoise(mc * 0.0031 + 17.0) - 0.5) * 300.0);
          vRoof = mix(vRoof, vec3(0.23, 0.23, 0.225) * (0.9 + 0.2 * sh1), 0.55 * tP);
          vTint = mix(vTint, vec3(0.40, 0.39, 0.36) * (0.92 + 0.16 * sh2), 0.35 * tP);
        }
` + a, 3],
    ['          if (!town && bh < 0.3 && si >= 18) {', () => '          if (!town && tB != 1 && bh < 0.3 && si >= 18) {', 3],
  ];
  const use = R.filter((e) => e[2] === 2 || suburbs);
  for (const [a] of use) once(a);
  for (const [a, f] of use) { const b = f(a); src = src.replace(a, () => b); }
  return src;
}
// ---- v0.7.8 towers (briefs/V0-7-8.md part 4, the trees subagent's block) ----
// The generator kept its towers out of an airport's boundary and its first kilometres of final: generated towers stood
// in a wall just beyond Itami's fence and tall dark blocks under Kunsan's final to 18. Now a generated building is low
// (two or three storeys, 6 or 9 m) where it stands
//  - within about TOWERS78_MARGIN of the airfield: the cover's airfield mark (airport-mask.js: 255 inside the boundary,
//    200 one cell round it) at the building or TOWERS78_MARGIN east, west, north or south of it, so the airport's own
//    boundary, per airport, from data the shader already has;
//  - under a runway's extended centreline: from its end to TOWERS78_FINAL out, TOWERS78_HALF either side of the
//    centreline at the end, widening by TOWERS78_SPLAY a metre out (the runways are the uniforms the shader already
//    reads: the nearest MAX_RUNWAYS flattening rects, so nothing in the text differs by airport).
// All four [EST]. The switch: ?towers78=0 (node FS_TOWERS78=0): off, the town's text is v0.7.7's character for character.
export function towers78Switch() {
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]towers78=([01])\b/.exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.FS_TOWERS78 === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const TOWERS78 = towers78Switch();
// (HALF and SPLAY as ICAO Annex 14's approach surface for a precision runway: an inner edge 300 m wide, 15 % each side.)
// (FINAL 4 km, not the brief's "about 3 km": Kunsan's cluster of tall blocks stands 3.1 to 3.5 km out on 18's final, about
// 250 m left of the line, measured on v078-tra-trees78-rkjk-18-final.png.)
export const TOWERS78_MARGIN = 500, TOWERS78_FINAL = 4000, TOWERS78_HALF = 150, TOWERS78_SPLAY = 0.15;
export function towers78Vert(src) {
  const once = (a) => { const n = src.split(a).length - 1; if (n !== 1) throw new Error(`cities: towers78 anchor found ${n} times: ${a.slice(0, 50)}`); };
  const A = 'float keep = step(sh3 * 0.4 + 0.18, cov.b';
  const B = 'if (abs(uu) < uRwyB[r].x + 400.0 && abs(vv) < uRwyB[r].y + 260.0) keep = 0.0;\n';
  const C = 'vec3 s3 = size * vec3(1.0, grow, 1.0) * keep;';
  for (const a of [A, B, C]) once(a);
  const f = (v) => v.toFixed(2);
  src = src.replace(A, () => `float low78 = 0.0, near78 = 0.0;   // v0.7.8 towers: low here (1), an airport's runway near (1)\n        ${A}`);
  src = src.replace(B, () => `${B}          float al78 = abs(uu) - uRwyB[r].x;   // v0.7.8 towers: metres past the runway's end (below 0 alongside it)
          if (al78 < ${f(TOWERS78_FINAL)} && abs(vv) < uRwyB[r].y + ${f(TOWERS78_HALF)} + ${f(TOWERS78_SPLAY)} * max(al78, 0.0)) low78 = 1.0;
          if (al78 < ${f(TOWERS78_FINAL + 1500)} && abs(vv) < ${f(TOWERS78_FINAL + 1500)}) near78 = 1.0;
`);
  src = src.replace(C, () => `// v0.7.8 towers: near an airport, the airfield's mark within the margin (the boundary, per airport); then low.
        if (low78 < 0.5 && near78 > 0.5 && uHasCover > 0.5) {
          float a78 = max(max(texture(uCover, natUv(m + vec2(${f(TOWERS78_MARGIN)}, 0.0))).a, texture(uCover, natUv(m - vec2(${f(TOWERS78_MARGIN)}, 0.0))).a),
                          max(texture(uCover, natUv(m + vec2(0.0, ${f(TOWERS78_MARGIN)}))).a, texture(uCover, natUv(m - vec2(0.0, ${f(TOWERS78_MARGIN)}))).a));
          if (max(a78, cov.a) > 0.3) low78 = 1.0;
        }
        if (low78 > 0.5) size.y = min(size.y, (2.0 + floor(2.0 * sh3)) * 3.0);
        ${C}`);
  return src;
}
// ---- end of v0.7.8 towers ----
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
  // v0.7.7 towns: Europe's town blended round the real centres (towns77Vert()); off, v0.7.6's text and uniforms.
  const T77 = REGION_ID === 'europe' && TOWNS77;
  if (T77) {
    mat.vertexShader = towns77Vert(mat.vertexShader);
    u.uCtr = TOWNS77_UNIFORMS.uCtr;
    u.uCtrN = TOWNS77_UNIFORMS.uCtrN;
  }
  if (TOWERS78) mat.vertexShader = towers78Vert(mat.vertexShader);   // v0.7.8 towers (last, over either region's text); off, v0.7.7's
  let ctrBoxes = null, ctrList = [], ctrOx = NaN, ctrOy = NaN, ctrGX = NaN, ctrGY = NaN, ctrMV = -1;
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
    // v0.7.7 towns: fn() -> the ready real centres' boxes (centres.js's boxes()); read when the grid or the mask moves.
    setCentreBoxes(fn) { ctrBoxes = fn || null; gridX = NaN; },
    towns77: T77,
    // frustum (v0.6.1): the view's THREE.Frustum in scene coordinates; without one every tile is drawn.
    update(camMap, origin, agl, frustum = null) {
      const on = agl < CITY_MAX_AGL;
      mesh.visible = on;
      const cx = Math.floor(camMap.x / BLOCK), cy = Math.floor(camMap.y / BLOCK);
      if (T77) {
        // v0.7.7 towns: the nearest ready centres (the terrain's gardens read them at every height too), listed again only
        // when the camera's block or the centres' mask moves, and set relative to the origin only when it moves.
        const mv = maskVersion ? maskVersion() : 0;
        if (cx !== ctrGX || cy !== ctrGY || mv !== ctrMV) {
          ctrGX = cx; ctrGY = cy; ctrMV = mv;
          const px = (cx + 0.5) * BLOCK, py = (cy + 0.5) * BLOCK;
          const d = (b) => Math.hypot(Math.max(b[0] - px, 0, px - b[2]), Math.max(b[1] - py, 0, py - b[3]));
          ctrList = (ctrBoxes ? ctrBoxes() : []).map((b) => [d(b), b]).filter((e) => e[0] < 20000).sort((a, b) => a[0] - b[0]).slice(0, TOWNS77_CENTRES).map((e) => e[1]);
          ctrOx = NaN;
        }
        if (origin.x !== ctrOx || origin.y !== ctrOy) {
          ctrOx = origin.x; ctrOy = origin.y;
          ctrList.forEach((b, k) => u.uCtr.value[k].set(b[0] - origin.x, b[1] - origin.y, b[2] - origin.x, b[3] - origin.y));
          u.uCtrN.value = ctrList.length;
        }
      }
      if (!on) return { instances: 0, tris: 0, drawCalls: 0 };
      if (cov && cov.version() !== coverVer) { coverVer = cov.version(); blockCache.clear(); gridX = NaN; }
      if (maskVersion && maskVersion() !== maskVer) { maskVer = maskVersion(); gridX = NaN; }
      if (cx !== gridX || cy !== gridY) {
        gridX = cx; gridY = cy; fill(cx, cy);
      }
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
