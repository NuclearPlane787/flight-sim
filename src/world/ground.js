// The new ground (v0.6.0 Part 7): the farmland as a mosaic of irregular
// fields instead of a grid of rectangles, laid out in irregular districts with tracks, ditches
// and tree lines between them. GLSL for the terrain's fragment shader; needs NOISE_GLSL and
// finecover.js's FINE_GLSL (for the exact position).
//
// Everything is built from the fine-pixel coordinate (finePos(), 31.25 m units relative to an
// integer origin set per frame from doubles), never from float32 map metres: at Haneda the map's
// x is 1,100 km, where a float steps by 0.125 m and patterns made from it go blocky (briefs/V0-6-0.md,
// "Precision far from the origin"). A lattice's cell index is integer arithmetic on the pixel
// index; the position inside the cell comes from small numbers.

import { seaFloor, LATTICE_BACK_GLSL } from './glsl.js';   // v0.7.0: the ground's floor and the lattice's origin, by region

export const GROUND_GLSL = /* glsl */ `
// A lattice of k fine pixels (k x 31.25 m): the cell of fine position fp, and the position
// inside it in metres (0 .. k * 31.25).
void latCell(vec2 fp, int k, out ivec2 cell, out vec2 local) {
  vec2 fl = floor(fp);
  ivec2 P = ivec2(fl) + uFineOrg;
  cell = ivec2(floor((vec2(P) + 0.5) / float(k)));
  local = (vec2(P - cell * k) + (fp - fl)) * 31.25;
}
vec2 ihash2(ivec2 c, uint s) { return vec2(ihash(c, s), ihash(c, s + 101u)); }
// The 250 m height of a cell (m, the sea as 0), by its index on the tiles' lattice (v0.6.1: one fetch,
// for the shape of the ground round a point; the clip window's texel as glsl.js's bilinWin() takes it).
float cellH(ivec2 p) {
  p -= ivec2(floor((uNat.xy ${LATTICE_BACK_GLSL}) / uNat.z + 0.5));    // from the lattice's origin to the window's (exact: whole cells)
  p = clamp(p, ivec2(uNatExt.xy), ivec2(uNatExt.zw));
  return ${seaFloor('float(texelFetch(uHeight, p & ivec2(uNatMask), 0).r) * H_SCALE')};
}

// The woods' canopy from above: a crown in each cell of a 10.4 m lattice (a third of a fine
// pixel), jittered and of its own size, lit on the sun's side and dark in the gaps between, so
// a forest reads as trees and not as paint. sun: the sun's direction on the map (x east, y
// north). Returns a factor for the canopy's colour; 1 once a crown is under a pixel or so.
float canopyCrowns(vec2 fp, float lod, vec2 sun) {
  float fade = 1.0 - smoothstep(2.5, 8.0, lod);
  if (fade <= 0.0) return 1.0;
  vec2 g = fp * 3.0, gf = floor(g), f = g - gf;
  ivec2 gc = ivec2(gf) + uFineOrg * 3;
  float best = 1e9, bh = 0.0;
  vec2 bo = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = gc + ivec2(i, j);
    float rad = 0.50 + 0.34 * ihash(c, 63u);
    vec2 r = (f - (vec2(float(i), float(j)) + 0.5 + (ihash2(c, 61u) - 0.5) * 0.8)) / rad;
    float d = dot(r, r);
    if (d < best) { best = d; bo = r; bh = ihash(c, 64u); }
  }
  float dome = 1.0 - smoothstep(0.45, 1.1, best);          // 1 on a crown, 0 in the gaps
  float v = mix(0.58, 0.95 + 0.26 * clamp(dot(bo, sun), -1.0, 1.0) + 0.18 * (bh - 0.5), dome);
  return mix(1.0, v, fade);
}

// Ground under glass: the plains' greenhouses, which the land cover maps as built-up. Rows of
// pale plastic tunnels in blocks, each block its own direction, with tracks between.
vec3 greenhouseGround(vec2 fp, float lod) {
  ivec2 bc; vec2 bl;
  latCell(fp, 4, bc, bl);                                  // blocks of 125 m
  float ang = floor(ihash(bc >> 1, 81u) * 4.0) * 0.7854;   // a direction per 250 m, in eighths of a turn
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * bl.x - sa * bl.y, sa * bl.x + ca * bl.y);
  float tun = abs(fract(q.x / 7.0) - 0.5) * 2.0;
  float tw = lod / 7.0;
  vec3 glass = mix(vec3(0.31, 0.32, 0.32), vec3(0.18, 0.19, 0.195), mix(smoothstep(0.55, 0.95, tun), 0.38, smoothstep(0.25, 0.8, tw)));
  glass *= 0.9 + 0.2 * ihash(bc, 82u);
  vec2 e = min(bl, 125.0 - bl);
  float lane = 1.0 - smoothstep(3.0, 3.5 + lod, min(e.x, e.y));
  float open = step(0.86, ihash(bc, 83u));                 // a block left as field or yard
  return mix(mix(glass, vec3(0.16, 0.15, 0.10), open), vec3(0.17, 0.16, 0.13), lane * 0.8);
}

// Bare ground (v0.6.1; it was one pale sheet): a new town's graded land, quarries, river bars and
// tidal flats. Broad patches of damp and of dry earth, and weeds coming up in places, everywhere;
// where made says people work the ground (flat, away from the water), the graders' parallel
// passes in lots of 250 m, each lot its own direction, and the wheel tracks round the lots.
vec3 bareGround(vec2 fp, float lod, vec2 m, float tex2, float made) {
  float broad = 0.6 * vnoise(m * 0.0035 + 31.0) + 0.4 * vnoise(m * 0.017 + 7.0);
  vec3 c = mix(vec3(0.125, 0.115, 0.095), vec3(0.19, 0.175, 0.14), smoothstep(0.30, 0.70, broad)) * (0.92 + 0.16 * tex2);
  float fade = made * (1.0 - smoothstep(6.0, 20.0, lod));
  if (fade > 0.001) {
    ivec2 bc; vec2 bl;
    latCell(fp, 8, bc, bl);
    float ang = ihash(bc, 85u) * 3.14159;
    float qx = cos(ang) * bl.x - sin(ang) * bl.y;
    float pass = abs(fract(qx / 9.0) - 0.5) * 2.0;
    c *= 1.0 - 0.08 * fade * smoothstep(0.70, 0.95, pass) * step(ihash(bc, 86u), 0.7);
    vec2 e = min(bl, 250.0 - bl);
    float track = 1.0 - smoothstep(2.5, 3.5 + lod, min(e.x, e.y));
    c = mix(c, vec3(0.105, 0.097, 0.082), track * 0.6 * fade);
  }
  float weeds = smoothstep(0.58, 0.72, vnoise(m * 0.021 + 13.0)) * smoothstep(0.35, 0.60, vnoise(m * 0.09 + 3.0));
  return mix(c, vec3(0.095, 0.105, 0.05), weeds * 0.55);
}

// Ground in a village or at a town's edge (built-up pixels outside the dense blocks): not one
// sheet of concrete. Lots of about 25 x 31 m in blocks of 125 m, each block's lots along its own
// direction: a yard of packed earth or concrete, a vegetable plot or a garden in about half of
// them, a lane along every row and a wider one round the block. The houses themselves are
// rural.js's and the cities'. Averaged out once a lot is under a pixel or two.
vec3 villageGround(vec2 fp, float lod) {
  ivec2 bc; vec2 bl;
  latCell(fp, 4, bc, bl);
  float ang = floor(ihash(bc >> 1, 91u) * 4.0) * 0.7854 + (ihash(bc >> 1, 92u) - 0.5) * 0.3;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * (bl.x - 62.5) - sa * (bl.y - 62.5), sa * (bl.x - 62.5) + ca * (bl.y - 62.5)) + 100.0;
  vec2 lq = q / vec2(25.0, 31.25), li = floor(lq), lf = lq - li;
  ivec2 lot = bc * 16 + ivec2(li);
  float h0 = ihash(lot, 93u), h1 = ihash(lot, 94u);
  vec3 yard = mix(vec3(0.150, 0.145, 0.130), vec3(0.115, 0.105, 0.085), h1);
  vec3 plot = mix(vec3(0.060, 0.085, 0.036), vec3(0.120, 0.100, 0.052), h1);
  // The plot takes one end of its lot (which end and how much by the lot).
  float share = 0.35 + 0.45 * ihash(lot, 95u);
  float inPlot = step(h0, 0.55) * (h0 < 0.27 ? step(lf.y, share) : step(1.0 - share, lf.y)) * step(0.08, lf.x) * step(lf.x, 0.92);
  vec3 c = mix(yard, plot, inPlot);
  // Rows in the plot.
  c *= 1.0 - 0.18 * inPlot * step(0.5, fract(q.x / 1.6)) * (1.0 - smoothstep(0.6, 1.6, lod));
  float lane = 1.0 - smoothstep(1.4, 1.9 + lod, (0.5 - abs(lf.y - 0.5)) * 31.25);     // along every row of lots (3 m wide)
  vec2 e = min(bl, 125.0 - bl);
  lane = max(lane, 1.0 - smoothstep(2.6, 3.2 + lod, min(e.x, e.y)));                  // round the block
  c = mix(c, vec3(0.058, 0.058, 0.062), lane * 0.85);
  vec3 avg = vec3(0.118, 0.114, 0.092);
  return mix(c, avg, smoothstep(5.0, 16.0, lod));
}

// The farmland's colour at fine position fp. paddy: 0..1 (a flat valley floor); m: the map
// position, for the slow noises only; lod: how many metres a pixel covers there.
// Districts: jittered cells of about 1 km, each with its own grain direction, crop mix and field
// size; fields: rows of plots of uneven width inside a district, long along its grain. Returns the colour and,
// in edge, how much of the pixel is a tree line (the caller darkens it and can raise trees).
// slope: about the sine of the ground's slope; hgt: the ground's height (m). From about 4 degrees
// the plots are terraces: bands of equal height (so they follow the contour exactly, and narrow as
// the slope steepens), cut into plots by the district's rows, each with its bank in shade on the
// downhill side. (Built from the height, not from the slope's direction: that direction comes
// through a filtered texture in small steps, which a district's width turned into saw teeth.)
vec3 fieldMosaic(vec2 fp, float paddy, vec2 m, float lod, float slope, float hgt, out float treeLine) {
  treeLine = 0.0;
  // Late October into November: cut paddies (straw, stubble, wet mud), winter crops coming up
  // green, tilled soil, fallow. Whole districts greener or browner, as before.
  float mv = 0.6 * vnoise(m * 0.0007 + 5.0) + 0.4 * vnoise(m * 0.0031 + 2.0);
  vec3 tintM = mix(vec3(0.80, 0.94, 0.80), vec3(1.0), smoothstep(0.30, 0.55, mv));
  tintM = mix(tintM, vec3(1.02, 0.86, 0.80), smoothstep(0.60, 0.80, mv));
  vec3 avg = mix(vec3(0.115, 0.104, 0.054), vec3(0.150, 0.122, 0.060), paddy) * tintM;
  float fade = 1.0 - smoothstep(9.0, 26.0, lod);          // the fields average out once one is a few pixels
  if (fade <= 0.001) return avg;

  // The district: the nearest of the jittered sites of a 1 km lattice (32 fine pixels).
  ivec2 dc; vec2 dl;
  latCell(fp, 32, dc, dl);
  float d1 = 1e9, d2 = 1e9;
  ivec2 did = dc;
  vec2 dq = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = dc + ivec2(i, j);
    vec2 site = (vec2(float(i), float(j)) + 0.5 + (ihash2(c, 41u) - 0.5) * 0.72) * 1000.0;
    vec2 q = dl - site;
    float d = dot(q, q);
    if (d < d1) { d2 = d1; d1 = d; did = c; dq = q; } else if (d < d2) d2 = d;
  }
  float dEdge = (sqrt(d2) - sqrt(d1)) * 0.5;                // roughly the distance to the district's edge (m)
  float dh = ihash(did, 43u), dk = ihash(did, 44u), dg = ihash(did, 45u);

  // The fields, in the district's own frame, long along its grain. Paddies are narrow and long;
  // dry fields squarer; a district's size varies by a third either way.
  float ang = dh * 3.14159;
  // v0.6.1: on a valley's floor the paddies run along the valley. Its axis from the 250 m heights
  // round the district's site (the site's own cell, from integers, so every pixel of the district
  // gets the same answer): across the direction the ground curves up most, the valley's sides
  // (on a ridge that would be across the ridge; paddies are on low flat floors, not ridges). On a
  // plain, where nothing curves much, the district keeps its own grain.
  if (paddy > 0.5) {
    ivec2 sc = (did * 32 + ivec2(floor((0.5 + (ihash2(did, 41u) - 0.5) * 0.72) * 32.0))) >> 3;
    float h0 = cellH(sc);
    float hxx = cellH(sc + ivec2(2, 0)) + cellH(sc - ivec2(2, 0)) - 2.0 * h0, hyy = cellH(sc + ivec2(0, 2)) + cellH(sc - ivec2(0, 2)) - 2.0 * h0;
    float hxy = 0.25 * (cellH(sc + ivec2(2, 2)) + cellH(sc - ivec2(2, 2)) - cellH(sc + ivec2(2, -2)) - cellH(sc + ivec2(-2, 2)));
    if (length(vec2(hxx - hyy, 2.0 * hxy)) > 25.0) ang = -0.5 * atan(2.0 * hxy, hxx - hyy);   // (25 m over 500 m: a valley's sides, not a plain's terrace edge)
  }
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * dq.x - sa * dq.y, sa * dq.x + ca * dq.y);
  vec2 size = (paddy > 0.5 ? vec2(26.0, 72.0) : vec2(44.0, 80.0)) * (0.75 + 0.6 * dk);
  float terr = step(0.07, slope);
  float stepH = 1.3 * (0.75 + 0.6 * dk);                    // a terrace's height (m)
  float xw = terr > 0.5 ? stepH / max(slope, 0.07) : size.x;   // metres to one unit across the plots
  // Rows of plots across the grain, each row shifted along and its plots of uneven width: straight
  // sides, as the fields' are, but no grid. The row's own edges wander a little along its length.
  float rowF = q.y / size.y + 0.18 * (vnoise(m * 0.006 + dh * 17.0) - 0.5);
  float row = floor(rowF), ry = rowF - row;
  ivec2 rid = ivec2(int(row), 0) + did * 97;
  float xs = (terr > 0.5 ? hgt / stepH : q.x / size.x) + ihash(rid, 51u) * 7.0;   // the row's shift
  float cx = floor(xs);
  // The plot's sides: each boundary of the row moved by up to 0.3 of a width.
  float left = cx + (ihash(rid + ivec2(int(cx) * 131, 1), 52u) - 0.5) * 0.6;
  float right = cx + 1.0 + (ihash(rid + ivec2(int(cx + 1.0) * 131, 1), 52u) - 0.5) * 0.6;
  if (xs < left) { cx -= 1.0; right = left; left = cx + (ihash(rid + ivec2(int(cx) * 131, 1), 52u) - 0.5) * 0.6; }
  else if (xs > right) { cx += 1.0; left = right; right = cx + 1.0 + (ihash(rid + ivec2(int(cx + 1.0) * 131, 1), 52u) - 0.5) * 0.6; }
  ivec2 fid = ivec2(int(cx), int(row));
  float fEdge = min(min(xs - left, right - xs) * xw, min(ry, 1.0 - ry) * size.y);   // the distance to the plot's edge (m)
  float h = ihash(fid + did * 131, 11u), hv = ihash(fid + did * 131, 12u);

  vec3 col;
  float green = 0.0;
  if (paddy > 0.5) {
    col = h < 0.52 ? vec3(0.27, 0.21, 0.09)        // straw stubble
        : h < 0.76 ? vec3(0.17, 0.12, 0.065)       // wet mud
        : h < 0.90 ? vec3(0.30, 0.24, 0.10)        // not yet cut, golden
        : vec3(0.10, 0.13, 0.055);                 // green (a winter crop)
    green = step(0.90, h);
  } else {
    // The district's own mix: some mostly green (winter vegetables, barley), some mostly tilled.
    float t = h + (dg - 0.5) * 0.35;
    col = t < 0.30 ? vec3(0.15, 0.17, 0.06)        // green crop
        : t < 0.55 ? vec3(0.19, 0.13, 0.07)        // tilled soil
        : t < 0.80 ? vec3(0.24, 0.20, 0.10)        // stubble
        : t < 0.93 ? vec3(0.13, 0.15, 0.07)        // fallow grass
        : vec3(0.12, 0.13, 0.06);
    green = step(t, 0.30);
  }
  col *= 0.86 + 0.28 * hv;                                   // each field its own shade
  // Rows: the plough's or the planter's lines along the field, where a row is still a pixel or more.
  float rows = paddy > 0.5 ? 1.6 : 2.4;
  float rw = fwidth(q.x) / rows;
  col *= 1.0 + 0.10 * (1.0 - terr) * (1.0 - smoothstep(0.25, 0.7, rw)) * (step(0.5, fract(q.x / rows)) - 0.5) * (0.4 + 0.6 * green + 0.3 * step(h, 0.76));
  // Greenhouses: in a few districts, some fields are rows of pale plastic tunnels.
  if (dg > 0.78 && hv > 0.62 && paddy <= 0.5) {
    float tun = abs(fract(q.x / 7.5) - 0.5) * 2.0;           // across the tunnels
    float tw = fwidth(q.x) / 7.5;
    vec3 gh = mix(vec3(0.30, 0.31, 0.31), vec3(0.19, 0.20, 0.205), mix(smoothstep(0.55, 0.95, tun), 0.35, smoothstep(0.3, 0.9, tw)));
    col = mix(col, gh, smoothstep(1.5, 4.0, fEdge));          // set in from the field's edge
  }
  // Dikes and field edges: a thin lighter line (paddy dikes pale and dry), antialiased.
  float aa = lod * 0.7 + 0.05;
  float dike = 1.0 - smoothstep(0.7, 0.7 + aa, fEdge);
  col = mix(col, paddy > 0.5 ? vec3(0.19, 0.18, 0.09) : vec3(0.15, 0.15, 0.075), dike * 0.75 * (1.0 - smoothstep(4.0, 12.0, lod)));
  // A terrace's bank: grass and shade along the plot's downhill side.
  if (terr > 0.5) col = mix(col, vec3(0.065, 0.085, 0.04), (1.0 - smoothstep(0.4, min(3.0, xw * 0.3) + aa, (xs - left) * xw)) * 0.75 * (1.0 - smoothstep(4.0, 12.0, lod)));
  // Between districts: a farm track (pale earth), a ditch beside it in paddy country, and along
  // some of them a line of trees.
  float track = 1.0 - smoothstep(1.6, 1.6 + aa, dEdge);
  col = mix(col, vec3(0.21, 0.19, 0.14), track * 0.85);
  if (paddy > 0.5) col = mix(col, vec3(0.045, 0.06, 0.07), (1.0 - smoothstep(1.2, 1.2 + aa, abs(dEdge - 4.0))) * 0.8);
  float lineId = ihash(did + ivec2(7, 3), 46u);
  if (lineId > 0.45) {
    float gaps = smoothstep(0.25, 0.45, vnoise(m * 0.021 + dh * 30.0));   // broken, not a wall
    treeLine = (1.0 - smoothstep(4.0, 6.5 + aa, abs(dEdge - 6.0))) * gaps * smoothstep(0.45, 0.6, lineId);
  }
  return mix(avg, col * mix(vec3(1.0), tintM, 0.6) * 0.85, fade);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// v0.7.1: Europe's fields by country (briefs/V0-7-1.md, part 6). East Asia's text above is not touched: on a page in
// Europe terrain.js passes GROUND_GLSL through euGroundGlsl(), which splices Europe's own lines into fieldMosaic()
// at exact anchors (each must occur once, else it throws). Four kinds of farm country, a whole district one kind:
//   0  open fields   (northern France, Germany, the centre: the default): big plots of 5 to 12 ha with no hedges,
//                    winter crops coming up green, ploughed soil, pale stubble;
//   1  hedged fields (Britain and Ireland; Normandy, Brittany and the west of France down to the Loire; Spain's
//                    coast north of the Cantabrian crest, Galicia and the north of Portugal): small pastures of 1 to 2 ha, each inside a dark hedge
//                    with trees in it;
//   2  dry fields    (Spain, Portugal, Italy and the Mediterranean's side of France): pale fallow and stubble, ochre
//                    and red-brown soil, and districts of olive groves (rows of dark crowns on pale soil); terraces
//                    on the slopes, as East Asia's;
//   3  polders       (anywhere north of the dry country where the district's ground is under 0.8 m: the Dutch
//                    polders, the Fens, the German and Danish marsh coasts, the Po's delta): wet pasture in strips
//                    about 45 m wide and 600 m long between straight ditches, parallel over a whole polder.
// Where a district is: its site's latitude and longitude, from the map's own conic (the distance to the cone's apex
// gives the latitude, the angle round it the longitude), each wobbled by a slow noise so no zone ends on a ruled line;
// across a zone's edge the districts are mixed by their hash. Far off, where the fields average out, the ground takes
// each zone's own average colour (Andalusia pale, Ireland green). No paddies in Europe: paddy is 0 there.
import { toMap, LON0 } from './frame.js';

const g1 = (v) => { const s = String(+v.toPrecision(9)); return /[.e]/.test(s) ? s : s + '.0'; };
const v3 = (c) => `vec3(${c.map((v) => g1(v)).join(', ')})`;
// The palettes: [share's upper bound, colour]. The far average is 0.66 of each palette's mean, as East Asia's is.
const EU_PALETTE = {
  open: [[0.34, [0.13, 0.17, 0.06]], [0.66, [0.20, 0.14, 0.08]], [0.86, [0.26, 0.22, 0.11]], [1, [0.12, 0.15, 0.06]]],
  hedge: [[0.62, [0.098, 0.142, 0.052]], [0.80, [0.085, 0.122, 0.047]], [0.92, [0.18, 0.125, 0.07]], [1, [0.23, 0.20, 0.10]]],
  dry: [[0.36, [0.30, 0.26, 0.15]], [0.60, [0.27, 0.20, 0.12]], [0.78, [0.22, 0.14, 0.085]], [0.90, [0.20, 0.19, 0.10]], [1, [0.13, 0.16, 0.07]]],
  polder: [[0.80, [0.09, 0.15, 0.05]], [0.93, [0.12, 0.17, 0.06]], [1, [0.17, 0.13, 0.07]]],
};
export function euFieldAverage(kind) {
  const p = EU_PALETTE[kind], a = [0, 0, 0];
  let lo = 0;
  for (const [hi, c] of p) { for (let k = 0; k < 3; k++) a[k] += (hi - lo) * c[k]; lo = hi; }
  return a.map((v) => v * 0.66);
}
const pick = (p, t) => p.map(([hi, c], k) => (k < p.length - 1 ? `${t} < ${g1(hi)} ? ${v3(c)} : ` : v3(c))).join('');

// The conic's constants for the shader, from the frame itself: the apex's y, and a straight fit of latitude against
// the distance to the apex between 41 and 51 N (good to a few hundredths of a degree over 36 to 59 N).
export function euConic() {
  const [, y1] = toMap(46, LON0), [x2, y2] = toMap(46, LON0 + 10);
  const rho0 = (x2 * x2 + y2 * y2 - y1 * y1) / (2 * (y2 - y1));
  const n = Math.atan2(x2, rho0 - y2) / (10 * Math.PI / 180);
  const rho = (lat) => rho0 - toMap(lat, LON0)[1];
  return { rho0, lonK: 180 / Math.PI / n, rhoA: rho(46), degPerM: 10 / (rho(41) - rho(51)) };
}

export function euGroundGlsl(src, fields77 = FIELDS77) {
  const K = euConic();
  const splice = (text, anchor, add, where) => {
    const n = text.split(anchor).length - 1;
    if (n !== 1) throw new Error(`euGroundGlsl: the anchor occurs ${n} times: ${anchor.slice(0, 60)}`);
    return text.replace(anchor, where === 'before' ? add + anchor : where === 'instead' ? add : anchor + add);
  };
  const HELPERS = `
// v0.7.1, Europe: how hedged and how dry the farm country is at map position mp (0..1 each).
void euZone(vec2 mp, out float hedge, out float dry) {
  vec2 a = vec2(mp.x, ${g1(K.rho0)} - mp.y);
  float lat = 46.0 + (${g1(K.rhoA)} - length(a)) * ${g1(K.degPerM)} + (vnoise(mp * 0.00002 + 3.0) - 0.5) * 0.5;
  float lon = ${g1(LON0)} + atan(a.x, a.y) * ${g1(K.lonK)} + (vnoise(mp * 0.00002 + 11.0) - 0.5) * 0.5;
  float gb = smoothstep(49.85, 50.15, lat) * (1.0 - smoothstep(1.35, 1.65, lon));
  float nw = smoothstep(46.5, 47.0, lat) * (1.0 - smoothstep(49.9, 50.2, lat)) * (1.0 - smoothstep(0.6, 1.1, lon));
  float at1 = smoothstep(42.8, 43.1, lat) * (1.0 - smoothstep(43.7, 44.0, lat)) * (1.0 - smoothstep(-1.9, -1.4, lon));   // north of the Cantabrian crest (the review: from 42.1 N it took in Leon, Burgos and La Rioja, which are dry)
  float at2 = smoothstep(40.2, 40.7, lat) * (1.0 - smoothstep(43.7, 44.0, lat)) * (1.0 - smoothstep(-7.6, -7.0, lon));
  float atl = max(at1, at2);
  hedge = max(gb, max(nw, atl));
  float s1 = 1.0 - smoothstep(43.0, 43.6, lat);
  float s2 = (1.0 - smoothstep(44.0, 44.6, lat)) * smoothstep(2.5, 3.1, lon);
  dry = max(s1, s2) * (1.0 - atl);
}
// A plot's ground by its kind (0 open, 1 hedged, 2 dry, 3 polder) and its place t in the kind's mix.
vec3 euField(int kind, float t, out float green) {
  vec3 c = vec3(0.0);
  green = 0.0;
  if (kind == 1) { c = ${pick(EU_PALETTE.hedge, 't')}; green = step(t, 0.80); }
  else if (kind == 2) { c = ${pick(EU_PALETTE.dry, 't')}; green = step(0.90, t); }
  else if (kind == 3) { c = ${pick(EU_PALETTE.polder, 't')}; green = step(t, 0.93); }
  else { c = ${pick(EU_PALETTE.open, 't')}; green = step(t, 0.34); }
  return c;
}
`;
  let s = src;
  s = splice(s, 'vec3 fieldMosaic(vec2 fp, float paddy, vec2 m, float lod, float slope, float hgt, out float treeLine) {\n  treeLine = 0.0;\n',
    HELPERS + 'vec3 fieldMosaic(vec2 fp, float paddy, vec2 m, float lod, float slope, float hgt, out float treeLine) {\n  treeLine = 0.0;\n'
    + '  paddy = 0.0;                                              // Europe: no paddies\n'
    + '  float euH = 0.0, euD = 0.0;\n  euZone(m, euH, euD);\n'
    + '  float euP = (1.0 - euD) * (1.0 - smoothstep(0.4, 1.2, hgt));\n', 'instead');
  s = splice(s, '  vec3 avg = mix(vec3(0.115, 0.104, 0.054), vec3(0.150, 0.122, 0.060), paddy) * tintM;\n',
    `  avg = mix(mix(mix(${v3(euFieldAverage('open'))}, ${v3(euFieldAverage('hedge'))}, euH), ${v3(euFieldAverage('dry'))}, euD), ${v3(euFieldAverage('polder'))}, euP) * tintM;\n`);
  s = splice(s, '  float dh = ihash(did, 43u), dk = ihash(did, 44u), dg = ihash(did, 45u);\n',
    '  // Europe: the district\'s kind, from its site\'s place and its ground\'s height, so a whole district is one kind.\n'
    + '  float euSH = 0.0, euSD = 0.0;\n  euZone(m - dq, euSH, euSD);\n'
    + '  float euGH = cellH((did * 32 + ivec2(floor((0.5 + (ihash2(did, 41u) - 0.5) * 0.72) * 32.0))) >> 3);\n'
    + '  int eu = 0;\n'
    + '  if (ihash(did, 48u) < euSD) eu = 2;\n'
    + '  else if (euGH < 0.8 && euGH != 0.0) eu = 3;\n'
    + '  else if (ihash(did, 49u) < euSH) eu = 1;\n'
    + '  float euHg = 0.0, euOl = 0.0;\n');
  s = splice(s, '  float ca = cos(ang), sa = sin(ang);\n  vec2 q = vec2(ca * dq.x - sa * dq.y, sa * dq.x + ca * dq.y);\n',
    '  if (eu == 3) ang = floor(ihash(did >> 3, 47u) * 4.0) * 0.7854 + 0.2;   // a polder\'s strips all one way, over about 8 km\n', 'before');
  s = splice(s, '  vec2 size = (paddy > 0.5 ? vec2(26.0, 72.0) : vec2(44.0, 80.0)) * (0.75 + 0.6 * dk);\n',
    '  size = (eu == 1 ? vec2(100.0, 150.0) : eu == 2 ? vec2(90.0, 170.0) : eu == 3 ? vec2(45.0, 600.0) : vec2(190.0, 380.0)) * (0.75 + 0.6 * dk);\n');
  s = splice(s, '  float terr = step(0.07, slope);\n', '  if (eu != 2) terr = 0.0;                                  // terraces only in the dry country\n');
  s = splice(s, '  col *= 0.86 + 0.28 * hv;                                   // each field its own shade\n',
    '  col = euField(eu, h + (dg - 0.5) * 0.35, green);\n'
    + '  if (eu == 2 && dg > 0.55 && h < 0.70) { col = vec3(0.27, 0.22, 0.13); green = 0.0; euOl = 1.0; }   // an olive grove\'s soil\n', 'before');
  s = splice(s, '  if (dg > 0.78 && hv > 0.62 && paddy <= 0.5) {\n', '  if (dg > 0.78 && hv > 0.62 && paddy <= 0.5 && eu == 2 && dk > 0.7 && euOl < 0.5) {\n', 'instead');
  s = splice(s, '  // A terrace\'s bank: grass and shade along the plot\'s downhill side.\n',
    '  // Europe: a hedge round a hedged field; a ditch along each side of a polder\'s strip; an olive grove\'s crowns.\n'
    + '  if (eu == 1) {\n'
    + '    euHg = (1.0 - smoothstep(2.0, 2.0 + aa, fEdge)) * (1.0 - smoothstep(8.0, 22.0, lod));\n'
    + '    col = mix(col, vec3(0.040, 0.062, 0.030), euHg * 0.9);\n'
    + '  } else if (eu == 3) {\n'
    + '    float euDx = min(xs - left, right - xs) * xw;\n'
    + '    col = mix(col, vec3(0.040, 0.058, 0.066), (1.0 - smoothstep(0.9, 0.9 + aa, euDx)) * (1.0 - smoothstep(6.0, 18.0, lod)) * 0.85);\n'
    + '  }\n'
    + '  if (euOl > 0.5) {\n'
    + '    float euOd = length((fract(q / 9.0) - 0.5) * 9.0);\n'
    + '    float euOt = mix(1.0 - smoothstep(2.4, 2.4 + aa, euOd), 0.22, smoothstep(2.0, 7.0, lod));\n'
    + '    col = mix(col, vec3(0.055, 0.080, 0.042), euOt * 0.9 * smoothstep(1.0, 4.0, fEdge));\n'
    + '  }\n', 'before');
  s = splice(s, '  return mix(avg, col * mix(vec3(1.0), tintM, 0.6) * 0.85, fade);\n',
    '  if (eu == 1) treeLine = max(treeLine, euHg * 0.7 * step(0.55, hv));   // trees in about half the hedges\n', 'before');
  return fields77 ? fields77Glsl(s, splice) : s;
}

// ---------------------------------------------------------------------------------------------------------------
// v0.7.7 (country; briefs/V0-7-7.md part 2): the countryside by the country raster. Behind ?fields77=0 (node
// FS_FIELDS77=0), on by default; off, euGroundGlsl() returns v0.7.6's text character for character (pinned by hash in
// tests/v077-country-fields.test.mjs). On, on top of v0.7.1's splices:
//   - euZone() takes each country's zone from a texture of the country raster (euZoneData(): a weight a channel for
//     four groups, blurred over about 6 km and sampled bilinearly with a 1 km jitter, so a border is a soft edge and
//     never a 2 km staircase): R the British Isles (hedged), G France (Normandy and Brittany hedged, the south dry, by
//     v0.7.1's lines), B Iberia (dry but for v0.7.1's Atlantic north), A the Netherlands (where polders may be);
//     every other country keeps v0.7.1's rule by latitude and longitude;
//   - a polder's strips turn with a slow continuous field (no 8 km seam), and the polder's district says so to the
//     terrain shader (euPol), which draws the land cover's grassland there as the polder's strips.
function lookSwitch(q, env) {   // as apron.js's
  try {
    const s = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp(`[?&]${q}=([01])\\b`).exec(s);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env[env] === '0') return false; } catch (e) { /* no process */ }
  return true;
}
export const FIELDS77 = lookSwitch('fields77', 'FS_FIELDS77');

// The country raster's codes in each of the four groups (the raster's header names the codes).
export const EU_ZONE_GROUPS = [['GB', 'IE'], ['FR', 'MC'], ['ES', 'PT', 'AD', 'GI'], ['NL']];
export const EU_HEDGE_FAR = 1.15;
// The mean of the polders' edge fade over the district lattice (1 km jittered sites; Monte Carlo of the shader's
// smoothstep(0, 150, dEdge - 30 + 100 (n - 0.5)), 400,000 points: 0.584). Beyond the fields' fade, euPol is the zone's
// polder weight times this, so the grassland drawn as strips is the same share near and far (the code review, 23:10).
export const EU_POLDER_EDGE_MEAN = 0.584;
// v0.7.7: the polders' palette, near the grass's own tone (v0.7.1's EU_PALETTE.polder was far greener than any ground
// round it once the grassland drew as strips), the brown parcels 4 % of them.
export const EU_POLDER77 = [[0.88, [0.095, 0.112, 0.048]], [0.96, [0.118, 0.124, 0.056]], [1, [0.16, 0.125, 0.07]]];
export function paletteAverage(p, f) {
  const a = [0, 0, 0];
  let lo = 0;
  for (const [hi, c] of p) { for (let k = 0; k < 3; k++) a[k] += (hi - lo) * c[k]; lo = hi; }
  return a.map((v) => v * f);
}   // the hedged kind's far colour against v0.7.1's (fields77Glsl())
export const EU_ZONE_BLUR = 1;     // cells (2 km) of each of the two box passes: a triangle five cells wide
// header: country.json; values: its byte-a-cell raster (south row first; byte & codeMask = the code, the sea taking
// its nearest land's). Returns { data: RGBA bytes, nx, ny, box: [x0, y0, 1 / width m, 1 / height m] }.
export function euZoneData(header, values) {
  const { nx, ny } = header, n = nx * ny, mask = header.codeMask || 127;
  const names = Array.isArray(header.codes) ? header.codes : [];
  const group = new Int8Array(256).fill(-1);
  EU_ZONE_GROUPS.forEach((g, k) => g.forEach((c) => { const i = names.indexOf(c); if (i >= 0) group[i] = k; }));
  const data = new Uint8Array(n * 4);
  const a = new Float32Array(n), b = new Float32Array(n);
  const box = (src, dst, r) => {                          // along x, then along y (clamped at the edges)
    for (let j = 0; j < ny; j++) {
      const o = j * nx;
      for (let i = 0; i < nx; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += src[o + Math.min(nx - 1, Math.max(0, i + d))];
        dst[o + i] = s / (2 * r + 1);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += dst[Math.min(ny - 1, Math.max(0, j + d)) * nx + i];
        src[j * nx + i] = s / (2 * r + 1);
      }
    }
  };
  for (let k = 0; k < 4; k++) {
    for (let p = 0; p < n; p++) a[p] = group[values[p] & mask] === k ? 1 : 0;
    box(a, b, EU_ZONE_BLUR);
    box(a, b, EU_ZONE_BLUR);
    for (let p = 0; p < n; p++) data[p * 4 + k] = Math.round(a[p] * 255);
  }
  return { data, nx, ny, box: [header.x0, header.y0, 1 / (nx * header.cell), 1 / (ny * header.cell)] };
}
// Without the raster (it failed to load): one texel, no named country and polders allowed: v0.7.1's rule everywhere.
export const EU_ZONE_FALLBACK = { data: new Uint8Array([0, 0, 0, 255]), nx: 1, ny: 1, box: [0, 0, 0, 0] };

function fields77Glsl(src, splice) {
  let s = src;
  s = splice(s, '// v0.7.1, Europe: how hedged and how dry the farm country is at map position mp (0..1 each).\n',
    '// v0.7.7: the four groups\' weights from the country raster (ground.js\'s euZoneData()), and the last euZone()\'s\n'
    + '// polder weight (the Netherlands) and polder flag of the pixel\'s district (for the terrain shader).\n'
    + 'uniform sampler2D uEuZone;\nuniform vec4 uEuZoneBox;\nfloat euZoneP = 1.0;\nfloat euPol = 0.0;\n', 'before');
  s = splice(s, '  hedge = max(gb, max(nw, atl));\n  float s1 = 1.0 - smoothstep(43.0, 43.6, lat);\n'
    + '  float s2 = (1.0 - smoothstep(44.0, 44.6, lat)) * smoothstep(2.5, 3.1, lon);\n  dry = max(s1, s2) * (1.0 - atl);\n}\n',
    '  float s1 = 1.0 - smoothstep(43.0, 43.6, lat);\n'
    + '  float s2 = (1.0 - smoothstep(44.0, 44.6, lat)) * smoothstep(2.5, 3.1, lon);\n'
    + '  // v0.7.7: by country, the border softened (a blurred raster, read bilinearly a jittered kilometre off).\n'
    + '  vec2 jit = (vec2(vnoise(mp * 0.0005 + 21.0), vnoise(mp * 0.0005 + 27.0)) - 0.5) * 2000.0;\n'
    + '  vec4 w = textureLod(uEuZone, (mp + jit - uEuZoneBox.xy) * uEuZoneBox.zw, 0.0);\n'
    + '  float wO = max(1.0 - w.r - w.g - w.b, 0.0);           // a country not named: v0.7.1\'s rule\n'
    + '  float dO = max(s1, s2) * (1.0 - atl);\n'
    + '  hedge = w.r + w.g * max(nw, atl) + w.b * atl + wO * max(gb, max(nw, atl));   // France: v0.7.1\'s without the British line\n'
    + '  dry = (w.g + wO) * dO + w.b * (1.0 - atl);\n'
    + '  euZoneP = w.a;\n}\n', 'instead');
  // The hedged kind's far colour (v0.7.1: 0.66 of its palette's mean, as every kind's) came out about 12 % darker than
  // its fields just before they average out (eu-fields-normandy: rows of 102, 117, 90 against 87, 104, 87): a faint step.
  // Its near look is 0.85 of the mean, less its hedges' and trees' share; EU_HEDGE_FAR raises the far one to meet it.
  const hedgeAvg = v3(euFieldAverage('hedge')), hedgeFar = v3(euFieldAverage('hedge').map((v) => v * EU_HEDGE_FAR));
  s = splice(s, `, ${hedgeAvg}, euH)`, `, ${hedgeFar}, euH)`, 'instead');
  s = splice(s, '  float euP = (1.0 - euD) * (1.0 - smoothstep(0.4, 1.2, hgt));\n',
    `  euP *= euZoneP;                                           // v0.7.7: polders in the Netherlands\n  euPol = euP * ${g1(EU_POLDER_EDGE_MEAN)};                   // (far: the near path's expected share, its edge fade included)\n`);
  s = splice(s, '  euZone(m - dq, euSH, euSD);\n', '  float euSP = euZoneP;\n');
  s = splice(s, '  else if (euGH < 0.8 && euGH != 0.0) eu = 3;\n', '  else if (euGH < 0.8 && euGH != 0.0 && ihash(did, 50u) < euSP) eu = 3;\n', 'instead');
  // (the grassland's strips fade out over about 150 m inside the district's edge, along a wandering line, so a polder's
  // pasture meets its neighbour's grass without a straight seam)
  s = splice(s, '  float euHg = 0.0, euOl = 0.0;\n', '  euPol = mix(euPol, eu == 3 ? smoothstep(0.0, 150.0, dEdge - 30.0 + 100.0 * (vnoise(m * 0.006 + 41.0) - 0.5)) : 0.0, fade);\n');
  // The polders' palette muted to the grass round them (the lead's review of Schiphol's final at 22:26: with the
  // grassland drawn as strips, v0.7.1's bright green took the whole frame), and fewer brown parcels.
  s = splice(s, `  else if (kind == 3) { c = ${pick(EU_PALETTE.polder, 't')}; green = step(t, 0.93); }\n`,
    `  else if (kind == 3) { c = ${pick(EU_POLDER77, 't')}; green = step(t, 0.96); }\n`, 'instead');
  s = splice(s, `, ${v3(euFieldAverage('polder'))}, euP)`, `, ${v3(paletteAverage(EU_POLDER77, 0.66 * EU_HEDGE_FAR))}, euP)`, 'instead');
  // A cross-ditch where a row of strips ends (each row is shifted along, so without one its strips met the next row's
  // at a bare straight seam: the pictures-only review, 23:29), and each ditch drawn at its own share of the pixel
  // instead of widened by the antialiasing into a dark smear in the middle distance.
  s = splice(s, '    col = mix(col, vec3(0.040, 0.058, 0.066), (1.0 - smoothstep(0.9, 0.9 + aa, euDx)) * (1.0 - smoothstep(6.0, 18.0, lod)) * 0.85);\n',
    '    float euDy = min(ry, 1.0 - ry) * size.y;                // v0.7.7: the distance to the row\'s head\n'
    + '    float euDw = min(1.0, 1.6 / (0.9 + aa));                  // v0.7.7: a ditch\'s own share of the pixel\n'
    + '    col = mix(col, vec3(0.040, 0.058, 0.066), max(1.0 - smoothstep(0.9, 0.9 + aa, euDx), 1.0 - smoothstep(1.2, 1.2 + aa, euDy)) * euDw * (1.0 - smoothstep(6.0, 18.0, lod)) * 0.85);\n', 'instead');
  s = splice(s, '  if (eu == 3) ang = floor(ihash(did >> 3, 47u) * 4.0) * 0.7854 + 0.2;   // a polder\'s strips all one way, over about 8 km\n',
    '  if (eu == 3) ang = vnoise((m - dq) * 0.00003 + 17.0) * 3.14159;   // v0.7.7: a polder\'s strips turn slowly with the land, no seam\n', 'instead');
  return s;
}
