// The new ground (v0.6.0 Part 7, behind GROUND_ON): the farmland as a mosaic of irregular
// fields instead of a grid of rectangles, laid out in irregular districts with tracks, ditches
// and tree lines between them. GLSL for the terrain's fragment shader; needs NOISE_GLSL and
// finecover.js's FINE_GLSL (for the exact position).
//
// Everything is built from the fine-pixel coordinate (finePos(), 31.25 m units relative to an
// integer origin set per frame from doubles), never from float32 map metres: at Haneda the map's
// x is 1,100 km, where a float steps by 0.125 m and patterns made from it go blocky (V060.md,
// "Precision far from the origin"). A lattice's cell index is integer arithmetic on the pixel
// index; the position inside the cell comes from small numbers.

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
