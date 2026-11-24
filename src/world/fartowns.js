// v0.7.9 part 7 (briefs/V0-7-9.md, the `towns` subagent): the towns past the buildings' reach by day. Shane's finding
// ("Found while building v0.7.7"): "Beyond about 8 km, the towns read as flat grey ground." The near town is drawn as
// buildings (cities.js: 400 m blocks within +-8 km of the camera, thinned from 3.6 km, shrunk into the ground between
// 6.4 and 7.76 km, none above 4,500 m over the ground; centres.js: the real centres' low tier within 7.5 km); past
// that, the terrain shader's built-up colour (terrain.js's `city`) was one grey with soft park blotches.
//
// What this adds, spliced into the terrain's fragment shader (far79Frag(), at anchors that must each occur once):
//   - blocks and lots in the built-up ground: cities.js's own 400 m block lattice (the same block index, the same
//     block hashes, so a far block runs the way the near block's buildings run), each block turned by its hash as
//     cities.js turns it by country, its lots on the country's slot lattice (Korea 125 x 72 m, Japan 76 x 62, China and
//     Europe 95 x 76), a roof in each lot of the country's roof palette (cities.js's own colours), the yards and the
//     streets between in the ground's own colour, the block's edge a darker street; lots larger and fuller where the
//     cover is denser; a block in sixteen left open (a campus, a park, a car park);
//   - antialiased exactly, not faded by guesswork: each axis of the lots and the streets is a pulse train box-filtered
//     over the pixel's footprint in that axis (f79Pulse(): the integral of the pulses, differenced), so far off it
//     becomes its own mean and never shimmers; the lots' and the blocks' hashed colours go to the palette's mean as a
//     lot, then a block, falls under a pixel;
//   - the hand-over: painted in as the near buildings go (1 - the share of buildings cities.js still draws at that
//     distance and height: its thinning, its shrinking ring, its height cut; inside a real centre's mask the centre's
//     low tier's own fade), so the town's built share stays the same across the ring and nothing is painted where
//     the buildings stand;
//   - the real centres as a darker, denser mass: the ready centres' 500 m masks (centres.js's meta.mask: where real
//     buildings replace the procedural block) gathered into one small window texture round the camera (FAR79_N cells of
//     FAR79_CELL m, single channel, rebuilt when the camera moves FAR79_MOVE m or a centre comes or goes), sampled
//     bilinearly: fuller lots, darker roofs, shaded streets;
//   - parks and rivers kept: the far town is the `city` colour's replacement only where the cover says built-up (the
//     fine cover's parks and the 250 m cover's woods already lower `urban`); the city's own park blotches empty the lots
//     under them; the water is drawn after the ground, as before.
// Night: albedo only, nothing emitted (the night's ground is dark; city lights are citylights.js's).
// Per pixel: two texture fetches (the centres' window and the cover at the block's centre), one value noise, a handful
// of integer hashes, no loop.
// The switch: ?towns79=0 (node FS_TOWNS79=0), on by default, as apron.js's lookSwitch(). Off, terrain.js adds nothing:
// the shader's text and uniforms are v0.7.8's (tests/v079-towns-hash.test.mjs).

import * as THREE from '../../vendor/three.module.js';
import { REGION } from './regions.js';
import { countryAt } from './region.js';
import { cityMixOf, CITY_MAX_AGL } from './cities.js';

function lookSwitch(q, env) {   // as apron.js's
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp(`[?&]${q}=([01])\\b`).exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env[env] === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const TOWNS79 = lookSwitch('towns79', 'FS_TOWNS79');

// cities.js's numbers this has to agree with (its BLOCK, HALF and fades; centres.js's LOW_R and its shrink).
export const FAR79_BLOCK = 400;
export const FAR79_RANGE = 8000;                       // cities.js: HALF * BLOCK
export const FAR79_LOW_R = 7500;                       // centres.js: LOW_R
// The near buildings still drawn (0..1) at horizontal distance d and max-norm distance n (m) from the camera, agl m
// up: cities.js's thinning (keep while sh2 * 0.6 + 0.2 >= 0.6 smoothstep(0.45 R, 0.95 R, d): a share clamp(t - 1/3, 0,
// 2/3) dropped), its ring (grow: 1 - smoothstep(0.8 R, 0.97 R, n)), its height cut (1 - smoothstep(0.7 MAX, MAX, agl)).
const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export function nearShare(d, n, agl) {
  const R = FAR79_RANGE, t = ss(0.45 * R, 0.95 * R, d);
  return (1 - Math.min(Math.max(t - 1 / 3, 0), 2 / 3)) * (1 - ss(0.8 * R, 0.97 * R, n)) * (1 - ss(0.7 * CITY_MAX_AGL, CITY_MAX_AGL, agl));
}
export function centreNearShare(d, agl) {
  return (1 - ss(0.78 * FAR79_LOW_R, 0.97 * FAR79_LOW_R, d)) * (1 - ss(0.7 * CITY_MAX_AGL, CITY_MAX_AGL, agl));
}

// The country's lot lattice (cities.js's slot lattice: spacing in m, and the offset that puts a slot's centre at a lot's
// middle) and its blocks' turn ((ba - 0.5) * k; Korea's apartment blocks 0.7, its others 1.6).
export const FAR79_LOTS = [
  { s: [125, 72], off: [0.5, 0.5], turn: 1.6 },   // 0 Korea (also North Korea, Russia)
  { s: [76, 62], off: [0.5, 0.0], turn: 1.2 },    // 1 Japan
  { s: [95, 76], off: [0.0, 0.5], turn: 0.5 },    // 2 China
  { s: [95, 76], off: [0.0, 0.5], turn: 1.0 },    // 3 to 7 Europe
];
// The roofs by country code (cities.js's vRoof and Europe's EU_ROOFS, their shares as there): [share's upper bound, colour].
export const FAR79_ROOFS = [
  [[0.55, [0.17, 0.17, 0.165]], [0.75, [0.10, 0.14, 0.11]], [0.88, [0.20, 0.10, 0.07]], [1, [0.26, 0.26, 0.25]]],
  [[0.34, [0.085, 0.09, 0.105]], [0.53, [0.12, 0.085, 0.065]], [0.62, [0.07, 0.10, 0.17]], [0.76, [0.24, 0.24, 0.245]], [1, [0.17, 0.17, 0.165]]],
  [[0.35, [0.19, 0.09, 0.07]], [0.80, [0.17, 0.17, 0.165]], [0.88, [0.07, 0.15, 0.32]], [1, [0.26, 0.26, 0.25]]],
  [[0.80, [0.10, 0.105, 0.12]], [1, [0.21, 0.11, 0.08]]],
  [[0.45, [0.24, 0.25, 0.26]], [0.60, [0.13, 0.14, 0.16]], [0.85, [0.12, 0.125, 0.14]], [1, [0.24, 0.12, 0.08]]],
  [[0.70, [0.245, 0.115, 0.08]], [1, [0.12, 0.11, 0.11]]],
  [[0.85, [0.30, 0.145, 0.085]], [1, [0.24, 0.23, 0.21]]],
  [[0.60, [0.10, 0.095, 0.095]], [1, [0.22, 0.11, 0.08]]],
];
export function roofMean(code) {
  const p = FAR79_ROOFS[code] || FAR79_ROOFS[0], a = [0, 0, 0];
  let lo = 0;
  for (const [hi, c] of p) { for (let k = 0; k < 3; k++) a[k] += (hi - lo) * c[k]; lo = hi; }
  return a;
}
// The lots' share under a roof along each axis: [sparse, dense, a real centre's].
export const FAR79_DUTY = { sparse: [0.46, 0.40], dense: [0.70, 0.62], centre: [0.84, 0.78], slabs: [0.62, 0.24] };
export const FAR79_STREET_M = 14;                      // the block's edge street (m)

// The centres' window.
export const FAR79_BLUR = 2;                           // v0.7.9 mend: box passes softening the window
export const FAR79_CELL = 250, FAR79_N = 512, FAR79_MOVE = 16000;   // 128 km square, re-centred after 16 km

const g1 = (v) => { const s = String(+v.toPrecision(9)); return /[.e]/.test(s) ? s : s + '.0'; };
const v3 = (c) => `vec3(${c.map(g1).join(', ')})`;
const v2 = (c) => `vec2(${c.map(g1).join(', ')})`;

export function far79Glsl(lattice = REGION.lattice) {
  const bx = lattice.x0 / FAR79_BLOCK, by = lattice.y0 / FAR79_BLOCK;
  if (!Number.isInteger(bx) || !Number.isInteger(by)) throw new Error('fartowns: the lattice origin is not on the 400 m blocks');
  if (FAR79_BLOCK / 6.25 !== 64) throw new Error('fartowns: a block is not 64 units of 6.25 m (a fine pixel 5)');
  const roof = (code) => FAR79_ROOFS[code].map(([hi, c], k, p) => (k < p.length - 1 ? `h < ${g1(hi)} ? ${v3(c)} : ` : v3(c))).join('');
  const lots = (code) => FAR79_LOTS[Math.min(code, 3)];
  return /* glsl */ `
// v0.7.9 towns (fartowns.js): the far town's blocks, lots and roofs; the real centres' window.
uniform sampler2D uFar79;
uniform vec4 uFar79Box;
uniform float uFar79Code;
// The share of [x - w/2, x + w/2] under pulses of duty d centred on the integers' halves (fract(x) = 0.5): exact box filter.
float f79Pulse(float x, float w, float d) {
  w = max(w, 1e-4);
  float a = x - 0.5 * w - 0.5 + 0.5 * d, b = a + w;
  return ((floor(b) - floor(a)) * d + min(fract(b), d) - min(fract(a), d)) / w;
}
vec3 f79Roof(int code, float h) {
  ${FAR79_ROOFS.map((_, c) => `if (code == ${c}) return ${roof(c)};`).join('\n  ')}
  return ${v3(FAR79_ROOFS[0][0][1])};
}
vec3 f79RoofMean(int code) {
  ${FAR79_ROOFS.map((_, c) => `if (code == ${c}) return ${v3(roofMean(c))};`).join('\n  ')}
  return ${v3(roofMean(0))};
}
// The real centres' mask (0..1) at map position m.
float f79Centre(vec2 m) {
  vec2 uv = (m - uFar79Box.xy) * uFar79Box.zw;
  if (uFar79Box.z <= 0.0 || uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  return textureLod(uFar79, uv, 0.0).r;
}
// The far town at fine position fp (map m): ground, the built-up ground's own colour (its yards and streets); dens: the
// built-up share here; trees: the tree share here; ctr: the real centres' mask; dpx, dpy: d(fp)/dx, d(fp)/dy (taken
// outside any branch). Returns the colour.
vec3 far79Town(vec2 fp, vec2 m, vec3 ground, float dens, float trees, float ctr, vec2 dpx, vec2 dpy, float tex2) {
  int code = int(uFar79Code + 0.5);
  // (v0.7.9 mend: the centres' mass by the blurred mask's soft threshold and the cover's own density, so its outline is
  // the town's irregular one, soft over about 500 m, never the centre box's straight side)
  ctr = smoothstep(0.10, 0.80, ctr) * smoothstep(0.35, 0.80, dens);
  // The block: cities.js's, map / 400, exactly (6.25 m units: a fine pixel is 5 of them, a block 64).
  vec2 fl = floor(fp), fr = fp - fl;
  ivec2 P = ivec2(fl) + uFineOrg;
  vec2 f5 = fr * 5.0, f5i = floor(f5);
  ivec2 u = P * 5 + ivec2(f5i);
  ivec2 bq = u >> 6;
  ivec2 bc = bq + ivec2(${bx}, ${by});
  vec2 loc = (vec2(u - bq * 64) + (f5 - f5i)) * 6.25 - 200.0;      // m from the block's centre
  float bh = ihash(bc, 21u), ba = ihash(bc, 22u), bt = ihash(bc, 23u);
  float bdense = uHasCover > 0.5 ? textureLod(uCover, natUv(vec2(bc) * 400.0 + 200.0), 0.0).b : dens;
  // The block's turn and its lots, as cities.js's buildings by country.
  vec2 s = ${v2(lots(0).s)}, off = ${v2(lots(0).off)};
  float turn = (bdense > 0.55 && bt < 0.62) ? 0.7 : ${g1(lots(0).turn)};
  bool slabs = turn < 1.0;
  if (code == 1) { s = ${v2(lots(1).s)}; off = ${v2(lots(1).off)}; turn = ${g1(lots(1).turn)}; slabs = false; }
  else if (code == 2) { s = ${v2(lots(2).s)}; off = ${v2(lots(2).off)}; turn = ${g1(lots(2).turn)}; slabs = false; }
  else if (code >= 3) { s = ${v2(lots(3).s)}; off = ${v2(lots(3).off)}; turn = ${g1(lots(3).turn)}; slabs = false; }
  float ang = (ba - 0.5) * turn, ca = cos(ang), sa = sin(ang);
  // Into the block's own frame (cities.js turns its slots by +ang: back by -ang here).
  vec2 q = vec2(ca * loc.x + sa * loc.y, -sa * loc.x + ca * loc.y);
  vec2 qx = vec2(ca * dpx.x + sa * dpx.y, -sa * dpx.x + ca * dpx.y) * 31.25, qy = vec2(ca * dpy.x + sa * dpy.y, -sa * dpy.x + ca * dpy.y) * 31.25;
  vec2 wm = abs(qx) + abs(qy);                                       // the pixel's footprint along the block's axes (m)
  vec2 wb = abs(dpx * 31.25) + abs(dpy * 31.25);                     // and along the map's
  // The lots: larger where it's denser; a real centre's fuller; Korea's apartment blocks in slabs.
  float dk = smoothstep(0.35, 0.85, max(dens, bdense * 0.8));
  vec2 duty = mix(${v2(FAR79_DUTY.sparse)}, ${v2(FAR79_DUTY.dense)}, dk);
  if (slabs) duty = ${v2(FAR79_DUTY.slabs)};
  if (bdense < 0.45 && !slabs) s *= 0.5;                             // houses (by the block's density, so a block keeps one lattice): half the lot
  duty = mix(duty, ${v2(FAR79_DUTY.centre)}, ctr);
  // (v0.7.9 mend, after the pictures-only review: no shade or share steps a whole 400 m block or 1.6 km district at once:
  // on the map-aligned lattice those lined up into straight seams kilometres long. The blocks' own variation fades sooner,
  // and the coverage and the districts' tone vary continuously, by value noise.)
  float bfade = smoothstep(80.0, 250.0, max(wm.x, wm.y));            // a block under a few pixels: its own variation goes
  float open = step(ihash(bc, 25u), 0.0625) * (1.0 - ctr) * (1.0 - bfade);
  duty *= 0.85 + 0.3 * vnoise(m * 0.0021 + 5.0);
  vec2 L = q / s + off;
  vec2 lw = wm / s;
  float roofs = f79Pulse(L.x, lw.x, duty.x) * f79Pulse(L.y, lw.y, duty.y);
  // The block's edge: a street round it (the map's axes, the lattice's lines).
  vec2 e = (loc + 200.0) / ${g1(FAR79_BLOCK)};
  float st = ${g1(FAR79_STREET_M / FAR79_BLOCK)};
  // (each 400 m side of the lattice a street or not by its own hash, so the town isn't ruled into squares far off; the
  // side's hash by the line's index and the block's, so both blocks either side agree)
  ivec2 lx = ivec2(bc.x + int(step(0.5, e.x)), bc.y), ly = ivec2(bc.x, bc.y + int(step(0.5, e.y)));
  // (each side by its own hash at every distance: faded to a share it drew every lattice line as one straight line far off)
  float gx = step(ihash(lx, 27u), 0.45), gy = step(ihash(ly, 28u), 0.45);
  float sfade = 1.0 - smoothstep(30.0, 120.0, max(wb.x, wb.y));     // (and none once a street is a thin line far off: no ruled lattice)
  float edge = sfade - sfade * (1.0 - gx * f79Pulse(e.x + 0.5, wb.x / ${g1(FAR79_BLOCK)}, st)) * (1.0 - gy * f79Pulse(e.y + 0.5, wb.y / ${g1(FAR79_BLOCK)}, st));
  // The city's own park blotches and the cover's trees: no roofs under them.
  float park = smoothstep(0.45, 0.75, vnoise(m * 0.02 + 9.0));
  // (v0.7.9, the view from 3,000 ft) The built-up ground's own 5 m grain (terrain.js's city: mix(.., .., tex2)) aliases
  // into grey speckle once a pixel covers more than a few metres: taken back to its mean there, so the town's own
  // structure below is what shows, not the speckle. (Its share under the city's park blotches is 1 - 0.35 park.)
  float gfade = smoothstep(3.0, 12.0, max(wm.x, wm.y));
  ground -= (mix(vec3(0.085, 0.085, 0.083), vec3(0.14, 0.135, 0.125), tex2) - vec3(0.1125, 0.11, 0.104)) * (1.0 - 0.35 * park) * gfade;
  roofs *= (1.0 - park) * (1.0 - smoothstep(0.30, 0.60, trees)) * (1.0 - open) * (1.0 - edge);
  // Neighbourhoods of about half a kilometre and a kilometre and a half (value noise: no lattice step), each its own
  // tone and tint; and by the cover, the dense parts darker and greyer, the thin parts lighter and greener. The tone's
  // finer octave goes to its mean once it is under a few pixels.
  float nf = 1.0 - smoothstep(350.0, 1100.0, max(wm.x, wm.y));
  float nb = mix(0.5, vnoise(m * 0.0019 + 3.0), nf), nb2 = vnoise(m * 0.0007 + 11.0);
  float dd = smoothstep(0.45, 0.95, dens);
  // The roofs' colour: the lot's own pick of the country's palette, to the palette's mean as a lot falls under a pixel.
  // (v0.7.9, last touch) The pick leans by the 1.4 km neighbourhood, so a palette's rarer roofs (Britain's brick, the
  // south's pale ones) gather in whole neighbourhoods instead of dotting every one evenly; and they lose half their
  // colour as a lot shrinks to a pixel or two (the far mean itself unchanged: lfade takes it to the palette's mean).
  ivec2 li = ivec2(floor(L));
  float lh = clamp(ihash(bc * 16 + li + 8, 31u) + 0.7 * (nb2 - 0.5), 0.0, 0.999);
  float lfade = smoothstep(0.4, 1.2, max(lw.x, lw.y));
  vec3 rp = f79Roof(code, lh) * (0.88 + 0.24 * ihash(bc * 16 + li + 8, 32u));
  rp = mix(rp, vec3(dot(rp, vec3(0.3333))), 0.5 * smoothstep(0.15, 0.6, max(lw.x, lw.y)));
  vec3 rc = mix(rp, f79RoofMean(code), lfade);
  rc *= mix(0.86 + 0.28 * bt, 1.0, bfade);                           // each block its own shade, near
  // A real centre: darker and denser (taller buildings shade the streets and the yards).
  rc *= mix(1.0, 0.80, ctr);
  vec3 yard = ground * mix(1.0, 0.68, ctr);
  vec3 street = ground * mix(0.78, 0.55, ctr);
  vec3 c = mix(yard, street, edge);
  c = mix(c, rc, roofs);
  // (v0.7.9, the view from 3,000 ft) Avenues through a block's middle, in the block's own turned frame; exact pulses by
  // the footprint along each of the block's axes, so a grazing view keeps those running away from the eye as lines and
  // averages the others. (Last touch) Each way in about half the blocks by its own hash, so some blocks have none and
  // the network is irregular; wide and dark in dense neighbourhoods, narrow and faint or none in thin ones.
  float avs = smoothstep(0.30, 0.75, 0.55 * dd + 0.45 * nb + 0.6 * ctr);
  float avw = mix(0.025, 0.055, avs);
  vec2 avg = vec2(step(ihash(bc, 43u), 0.5), step(ihash(bc, 44u), 0.5));
  vec2 avp = avg * vec2(f79Pulse(q.x / 400.0 + 0.5, wm.x / 400.0, avw), f79Pulse(q.y / 400.0 + 0.5, wm.y / 400.0, avw));
  float avenue = 1.0 - (1.0 - avp.x) * (1.0 - avp.y);
  c = mix(c, ground * mix(0.55, 0.42, ctr), avenue * 0.9 * avs);
  c *= (0.76 + 0.48 * (0.5 * nb + 0.5 * nb2)) * mix(1.08, 0.90, dd);
  c *= mix(vec3(1.0), vec3(1.05, 0.99, 0.93), smoothstep(0.55, 0.80, nb2) * (1.0 - dd));      // warmer roofs in some
  c = mix(c, vec3(0.080, 0.095, 0.050), (1.0 - dd) * 0.30 * smoothstep(0.55, 0.75, nb));         // gardens where it thins
  return c;
}
`;
}

// The terrain's fragment shader (terrain.js's text, with whatever earlier splices) -> with the far town. Each anchor must
// occur once, or it throws.
function splice(src, anchor, add, where) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`fartowns: anchor found ${n} times: ${anchor.slice(0, 60)}`);
  return src.replace(anchor, where === 'before' ? add + anchor : anchor + add);
}
export const FAR79_ANCHORS = ['void main() {', '        alb = mix(alb, city, urban);\n'];
export function far79Frag(src, lattice = REGION.lattice) {
  let s = splice(src, FAR79_ANCHORS[0], far79Glsl(lattice), 'before');
  s = splice(s, FAR79_ANCHORS[1], `        // v0.7.9 towns (fartowns.js): past the near buildings, the town's blocks, lots and roofs, painted in as cities.js's
        // and centres.js's buildings go (their thinning, their ring, their height cut), so the built share holds across.
        {
          vec2 f79dx = dFdx(gfp), f79dy = dFdy(gfp);
          float f79d = length(rel.xz), f79n = max(abs(rel.x), abs(rel.z));
          float f79t = smoothstep(${g1(0.45 * FAR79_RANGE)}, ${g1(0.95 * FAR79_RANGE)}, f79d);
          float f79a = 1.0 - smoothstep(${g1(0.7 * CITY_MAX_AGL)}, ${g1(CITY_MAX_AGL)}, uCamAgl);
          float f79p = (1.0 - clamp(f79t - 1.0 / 3.0, 0.0, 2.0 / 3.0)) * (1.0 - smoothstep(${g1(0.8 * FAR79_RANGE)}, ${g1(0.97 * FAR79_RANGE)}, f79n)) * f79a;
          float f79c = 0.0;
          if (urban > 0.0 && f79p < 1.0) {
            f79c = f79Centre(m);
            float f79l = (1.0 - smoothstep(${g1(0.78 * FAR79_LOW_R)}, ${g1(0.97 * FAR79_LOW_R)}, f79d)) * f79a;
            float f79w = 1.0 - mix(f79p, f79l, f79c);
            if (f79w > 0.0) city = mix(city, far79Town(gfp, m, city, cov.b, cov.r, f79c, f79dx, f79dy, tex2), f79w);
          }
        }
`, 'before');
  return s;
}

// The shaders' uniforms (shared by reference: update79() sets them in place).
const empty = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
empty.needsUpdate = true;
export const FAR79_UNIFORMS = {
  uFar79: { value: empty },
  uFar79Box: { value: new THREE.Vector4(0, 0, 0, 0) },
  uFar79Code: { value: 0 },
};

// The ready centres' masks rasterised into the window (FAR79_N x FAR79_N cells of FAR79_CELL m from x0, y0), each 500 m
// mask cell splatted bilinearly by its centre, the window's outer ring left 0. centres: [{ box: [x0, y0, x1, y1], cols,
// rows, cell, mask: Uint8Array(cols * rows) }]. -> Uint8Array(N * N), south row first.
export function centresWindow(centres, x0, y0, N = FAR79_N, cell = FAR79_CELL, blur = FAR79_BLUR) {
  const acc = new Float32Array(N * N);
  for (const c of centres) {
    const span = c.cell / cell;
    for (let j = 0; j < c.rows; j++) for (let i = 0; i < c.cols; i++) {
      if (!c.mask[j * c.cols + i]) continue;
      // the mask cell's square in window cells (continuous), covered with weights by overlap
      const ax = (c.box[0] + i * c.cell - x0) / cell, ay = (c.box[1] + j * c.cell - y0) / cell;
      const i0 = Math.max(1, Math.floor(ax)), i1 = Math.min(N - 2, Math.ceil(ax + span) - 1);
      const j0 = Math.max(1, Math.floor(ay)), j1 = Math.min(N - 2, Math.ceil(ay + span) - 1);
      for (let jj = j0; jj <= j1; jj++) {
        const oy = Math.min(jj + 1, ay + span) - Math.max(jj, ay);
        if (oy <= 0) continue;
        for (let ii = i0; ii <= i1; ii++) {
          const ox = Math.min(ii + 1, ax + span) - Math.max(ii, ax);
          if (ox > 0) acc[jj * N + ii] += ox * oy;
        }
      }
    }
  }
  for (let p = 0; p < N * N; p++) acc[p] = Math.min(acc[p], 1);
  // v0.7.9 mend: softened by `blur` passes of a 3 x 3 box (two: an edge about 500 m wide each side), the outer ring kept 0.
  const tmp = new Float32Array(N * N);
  for (let pass = 0; pass < blur; pass++) {
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) tmp[j * N + i] = (acc[j * N + i - 1] + acc[j * N + i] + acc[j * N + i + 1]) / 3;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) acc[j * N + i] = (tmp[(j - 1) * N + i] + tmp[j * N + i] + tmp[(j + 1) * N + i]) / 3;
  }
  const out = new Uint8Array(N * N);
  for (let p = 0; p < N * N; p++) out[p] = Math.round(Math.min(acc[p], 1) * 255);
  return out;
}

// The CPU side. setCentres79(centres): centres.js's object (its `centres` Map and maskVersion()). update79(camMap): each
// frame from terrain.update(): the window rebuilt when the camera has moved FAR79_MOVE m from its centre or the mask's
// version changed; the country's code when the camera has moved 2 km.
let src = null, winX = NaN, winY = NaN, winVer = -1, codeX = NaN, codeY = NaN, tex = null;
export function setCentres79(centres) { src = centres || null; winVer = -1; }
export function update79(camMap) {
  const U = FAR79_UNIFORMS, x = camMap.x, y = camMap.y;
  if (!(Math.abs(x - codeX) < 2000 && Math.abs(y - codeY) < 2000)) {
    codeX = x; codeY = y;
    try { U.uFar79Code.value = cityMixOf(countryAt(x, y)).code; } catch (e) { /* the rules not loaded yet */ }
  }
  if (!src || !src.centres) return;
  const ver = src.maskVersion ? src.maskVersion() : 0;
  if (ver === winVer && Math.abs(x - winX) < FAR79_MOVE && Math.abs(y - winY) < FAR79_MOVE) return;
  winVer = ver; winX = x; winY = y;
  const half = (FAR79_N * FAR79_CELL) / 2;
  const x0 = Math.floor((x - half) / FAR79_CELL) * FAR79_CELL, y0 = Math.floor((y - half) / FAR79_CELL) * FAR79_CELL;
  const list = [];
  for (const c of src.centres.values()) {
    if (c.state !== 'ready' || !c.meta || !c.meta.mask) continue;
    list.push({ box: c.info.box, cols: c.info.cols, rows: c.info.rows, cell: 500, mask: c.meta.mask });
  }
  const data = centresWindow(list, x0, y0);
  if (!tex) {
    tex = new THREE.DataTexture(data, FAR79_N, FAR79_N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.flipY = false; tex.unpackAlignment = 1;
  } else tex.image.data.set(data);
  tex.needsUpdate = true;
  U.uFar79.value = tex;
  U.uFar79Box.value.set(x0, y0, 1 / (FAR79_N * FAR79_CELL), 1 / (FAR79_N * FAR79_CELL));
}
