// Airport ground and buildings (M2): taxiways, aprons, their paint (centrelines, edge
// lines, hold-shorts, stand lead-ins, stop bars and numbers, v0.4.1 taxiway names), terminals,
// hangars and other buildings, static jet bridges, and (v0.4.1) the taxiway and runway signs
// in the grass (taxisigns.js). All three airports, from data/airports/*.json.
//
//   const aprons = createAprons(scene, uniforms, chunks, airports, heightfield);
//   each frame, after world.update():  aprons.update(ctx) -> { drawCalls, triangles }
//
// Per airport there are four merged meshes (pavement, paint, buildings, signs), each with one
// material: four draw calls. Positions are stored relative to the airport's origin and
// placed camera-relative in the vertex shader (uRelA = airport origin - scene origin,
// computed in double on the CPU), with the Earth's curvature like the runways.
//
// Depth: the pavement and the paint are flat on the ground (heights from the heightfield,
// the same data the terrain uses), pulled towards the camera along the view ray by less
// than the runways are, so the terrain stays under them and the runways win wherever they
// overlap. The pavement doesn't write depth: it's drawn after the terrain and the runways
// (renderOrder 1), each piece over the ones before it, in this order: concrete taxilanes,
// asphalt taxiways, aprons and stand pads. Overlapping pieces lie in the same plane, so
// with depth writes they flickered against each other (v0.1.0, at Incheon's taxilanes).
//
// Night (v0.2.0): the floodlight masts (taxilights.js floodMasts) light warm pools on the
// pavement and the paint, from a small baked light texture per airport (uFlood, 6 m
// texels over the stands), scaled by uNight; the terminals' glass and the other
// buildings' windows glow warm; and the aircraft's landing and taxi lights
// (aircraftLights() in glsl.js) light the pavement and the paint.

import * as THREE from '../../vendor/three.module.js';
import {
  TAXI_W, DOOR_SILL, openRing, signedArea, densify, dedupePolys, segmentIndex,
  holdShortSites, taxiwayEdges, standMarks, jetBridge, strokeTriangles, subdivideSoup, hdgVec,
  drawnRunwayRects, clipSoupOutside, splitPolyline, refineSoup, refineLine,
} from './apron-geom.js';
import { floodMasts } from './taxilights.js';
import { taxiSignSites, SIGN, panelWidth, arrayWidth } from './taxisigns.js';

export const APRON_RANGE = 25000;          // m from the airport's bounds
export const APRON_MAX_ALT = 15000 * 0.3048;

const FLOOD_CELL = 6;         // m per texel of the floodlight texture
const FLOOD_MAX = 2.0;        // the texture's 1.0 (pools add up where masts are close)
const LINE_HW = 0.18;        // taxiway centreline / lead-in half width (m): 0.36 m, a little over ICAO's 0.15
const EDGE_HW = 0.38;        // taxiway edge double line half width
const HOLD_DEPTH = 2.1;      // four 0.3 m lines with 0.3 m gaps (twice ICAO's, to read from the cockpit)
const GLYPH_H = 3.2, GLYPH_W = 2.0, GLYPH_GAP = 0.35;

// Pull towards the camera (m = a + b * distance); the runways use 0.16 + 0.0016 d.
// The draw order (see "Depth") puts the aprons over the taxiways, so taxiways crossing an
// apron read as apron concrete.
// The distance terms cover the coarser terrain rings further out (they cut through flat
// pavement by a few cm per 100 m); the runways (airports.js) stay above all of these.
// `lead` is the taxiway centrelines' paint on a runway (lead-on and lead-off lines, v0.2.1):
// it lies on the runway's own surface, with no lift, and pulls a little more than the
// runway, so it's over the runway from any angle.
const PULL = { taxi: [0.06, 0.0006], apron: [0.10, 0.0010], paint: [0.13, 0.0013], lead: [0.19, 0.0019] };
// The pavement stops this far inside the runway's drawn edge, so no hairline of grass shows
// between them.
const RUNWAY_OVERLAP = 0.05;

// ------------------------------------------------------------------ shaders

const COMMON_VERT = /* glsl */ `
  uniform vec2 uRelA;                 // airport origin minus the scene origin (map metres)
  // Scene-local (x, h, -y relative to the airport origin) to camera-relative world.
  vec3 placeWorld(vec3 p) {
    vec3 wp = p + vec3(uRelA.x, 0.0, -uRelA.y);
    vec3 r = wp - uCamPos;
    wp.y -= curveDrop(r.xz);
    return wp;
  }
  vec4 projectPulled(vec3 wp, vec2 pull) {
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float d = length(mv.xyz);
    mv.xyz *= 1.0 - min((pull.x + d * pull.y) / max(d, 1e-3), 0.5);
    return projectionMatrix * mv;
  }`;

const LIGHT_GLSL = /* glsl */ `
  // v0.4.0: the pavement under the weather: it follows the runway's state (white when the runways are, cleared and dark otherwise).
  vec3 groundLight(vec3 col) {
    if (uRwySnow > 0.0) col = mix(col, vec3(0.42, 0.44, 0.48), 0.72 * uRwySnow);
    else if (uWet > 0.0) col *= 1.0 - 0.35 * uWet;
    return col * (uSunColor * max(uSunDir.y, 0.0) * 2.4 + uSkyAmb * 1.1);
  }
  // Night light on the pavement at loc (map m from the airport origin), scene position p:
  // the floodlights' pools and the aircraft's lamps (multiply by the albedo).
  uniform sampler2D uFlood;
  uniform vec4 uFloodBox;             // texture's corner (x, y from the airport origin), size (m)
  vec3 nightLight(vec2 loc, vec3 p) {
    vec3 c = aircraftLights(p, vec3(0.0, 1.0, 0.0));
    if (uNight > 0.001) {
      vec2 t = (loc - uFloodBox.xy) / uFloodBox.zw;
      float f = texture(uFlood, t).r * ${FLOOD_MAX.toFixed(1)};
      c += vec3(1.0, 0.74, 0.45) * f * 0.55 * uNight;
    }
    return c;
  }
  // Box-filtered coverage of the band lo..hi at x for a footprint fw.
  float band(float x, float lo, float hi, float fw) {
    fw = max(fw, 1e-4);
    return clamp((min(x + 0.5 * fw, hi) - max(x - 0.5 * fw, lo)) / fw, 0.0, 1.0);
  }`;

const PAVE_VERT = /* glsl */ `
  attribute vec2 pm;                  // material (0 asphalt, 1 concrete), layer (1 apron, 2 taxiway)
  varying vec3 vRel;
  varying vec2 vLoc;
  varying float vMat;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 wp = placeWorld(position);
    vRel = wp - uCamPos;
    vLoc = vec2(position.x, -position.z);
    vMat = pm.x;
    gl_Position = projectPulled(wp, pm.y > 1.5 ? vec2(${PULL.taxi[0]}, ${PULL.taxi[1]}) : vec2(${PULL.apron[0]}, ${PULL.apron[1]}));
    #include <logdepthbuf_vertex>
  }`;

const PAVE_FRAG = /* glsl */ `
  varying vec3 vRel;
  varying vec2 vLoc;
  varying float vMat;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float g = vnoise(vLoc * 0.7) * 0.4 + vnoise(vLoc * 3.3) * 0.25 + vnoise(vLoc * 0.045) * 0.5;
    vec3 asphalt = vec3(0.050, 0.049, 0.048) * (0.8 + 0.35 * g);
    // Concrete slabs, 7.5 m, with dark joints that fade out once they're sub-pixel.
    float gc = vnoise(vLoc * 0.7) * 0.5 + vnoise(vLoc * 3.3) * 0.3 + vnoise(vLoc * 0.045) * 0.2;
    vec3 conc = vec3(0.205, 0.200, 0.188) * (0.9 + 0.14 * gc);
    vec2 j = abs(fract(vLoc / 7.5) - 0.5) * 7.5;          // distance to the slab's centre lines
    vec2 fw = fwidth(vLoc);
    float joint = max(band(j.x, 3.7, 3.8, fw.x), band(j.y, 3.7, 3.8, fw.y));
    conc *= 1.0 - 0.35 * joint * (1.0 - smoothstep(0.15, 0.6, max(fw.x, fw.y)));
    // Oil and rubber stains.
    conc *= 1.0 - 0.10 * smoothstep(0.6, 0.9, vnoise(vLoc * 0.12 + 7.0));
    vec3 col = mix(asphalt, conc, vMat);
    vec3 c = groundLight(col) + col * nightLight(vLoc, vRel + uCamPos);
    gl_FragColor = vec4(applyHaze(c, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const PAINT_VERT = /* glsl */ `
  attribute vec3 side;                // scene-local unit across (x, z) and which side (-1, 1); 0 = fixed quad
  attribute vec2 lc;                  // local coordinates (m, or glyph cell 0..1)
  attribute vec4 kp;                  // kind, half width / pattern, glyph index, colour
  attribute float lay;                // 1: on a runway's surface (lead-on and lead-off lines)
  varying vec3 vRel;
  varying vec2 vLc, vLoc;
  varying vec4 vKp;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 wp = placeWorld(position);
    vLc = lc;
    if (side.z != 0.0) {
      // Lines widen to keep a pixel or so of quad either side, so they filter instead of breaking up.
      float dist = length(wp - uCamPos);
      float sinG = clamp(abs(uCamPos.y - wp.y) / max(dist, 1.0), 0.03, 1.0);
      float half_ = kp.y + 0.08 + min(1.5 * dist / uPxScale / sinG, 6.0);
      wp.xz += side.xy * side.z * half_;
      vLc.y = side.z * half_;
    }
    vRel = wp - uCamPos;
    vLoc = vec2(wp.x - uRelA.x, -wp.z - uRelA.y);
    vKp = kp;
    gl_Position = projectPulled(wp, lay > 0.5 ? vec2(${PULL.lead[0]}, ${PULL.lead[1]}) : vec2(${PULL.paint[0]}, ${PULL.paint[1]}));
    #include <logdepthbuf_vertex>
  }`;

const PAINT_FRAG = (nGlyphs) => /* glsl */ `
  uniform sampler2D uGlyphs;
  varying vec3 vRel;
  varying vec2 vLc, vLoc;
  varying vec4 vKp;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float kind = vKp.x;
    vec2 fw = fwidth(vLc);
    float cov = 0.0;
    if (kind < 0.5) {                       // single line
      cov = band(vLc.y, -vKp.y, vKp.y, fw.y);
    } else if (kind < 1.5) {                // hold-short: y 0 (holding side) .. 2.1 (runway side)
      float y = vLc.y, x = vLc.x;
      float dash = band(fract(x / 2.0) * 2.0, 0.0, 1.0, fw.x * 1.0);
      dash = mix(dash, 0.5, smoothstep(0.5, 1.5, fw.x));
      if (vKp.y < 0.5) {
        cov = band(y, 0.0, 0.3, fw.y) + band(y, 0.6, 0.9, fw.y) + (band(y, 1.2, 1.5, fw.y) + band(y, 1.8, 2.1, fw.y)) * dash;
      } else {
        cov = band(y, 0.0, 0.3, fw.y) * dash;   // intermediate holding position
      }
      cov = min(cov, 1.0);
    } else if (kind < 2.5) {                // a stand-number glyph
      vec2 q = clamp(vLc, 0.0, 1.0);
      cov = texture(uGlyphs, vec2((vKp.z + 0.04 + 0.92 * q.x) / ${nGlyphs.toFixed(1)}, 0.03 + 0.94 * q.y)).r;
    } else if (kind < 3.5) {                // the dark box behind a number
      cov = 0.9;
    } else {                                // double edge line
      float a = abs(vLc.y);
      cov = band(a, 0.4 * vKp.y, vKp.y, fw.y);
      // Far away the pair is sub-pixel: band() already averages it out.
    }
    float dist = length(vRel);
    cov *= 1.0 - smoothstep(7000.0, 12000.0, dist);
    // v0.4.2: under snow the paint (and the taxiways' painted names) is covered, as the runways' is (airports.js).
    cov *= 1.0 - 0.92 * uRwySnow;
    if (cov < 0.004) discard;
    vec3 alb = vKp.w < 0.5 ? vec3(0.62, 0.43, 0.05) : vKp.w < 1.5 ? vec3(0.52, 0.52, 0.50) : vec3(0.012, 0.012, 0.012);
    vec3 c = groundLight(alb) + alb * nightLight(vLoc, vRel + uCamPos);
    gl_FragColor = vec4(applyHaze(c, vRel), cov);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const BLDG_VERT = /* glsl */ `
  attribute vec4 bk;                  // kind (0 terminal, 1 hangar, 2 other, 3 jet bridge), band, along (m), height above base (m)
  varying vec3 vRel, vN;
  varying vec4 vBk;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 wp = placeWorld(position);
    vRel = wp - uCamPos;
    vN = normal;
    vBk = bk;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const BLDG_FRAG = /* glsl */ `
  varying vec3 vRel, vN;
  varying vec4 vBk;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    float kind = vBk.x, bandF = vBk.y, along = vBk.z, y = vBk.w;
    float roof = step(0.7, n.y);
    float dist = length(vRel);
    vec2 fw = vec2(fwidth(along), fwidth(y));
    float fine = 1.0 - smoothstep(0.3, 1.2, max(fw.x, fw.y));   // fade patterns that would shimmer
    vec3 alb;
    float glass = 0.0;
    float lit = 0.0;                         // night: how much of this spot is a lit window
    if (kind < 0.5) {                        // terminal: glass curtain wall with mullions
      float mull = max(band(fract(along / 3.0), 0.0, 0.05, fw.x / 3.0), band(fract(y / 4.5), 0.0, 0.06, fw.y / 4.5));
      mull = mix(mull, 0.12, 1.0 - fine);
      glass = (1.0 - mull) * step(0.6, y);
      alb = mix(vec3(0.30, 0.32, 0.34), vec3(0.10, 0.14, 0.18), glass);
      // Most of a terminal's panes are lit at night, some brighter (shops, gates).
      float h = ihash(ivec2(floor(along / 3.0), floor(y / 4.5)), 7u);
      lit = glass * (0.6 + 0.4 * h) * step(0.1, h);
      if (roof > 0.5) alb = vec3(0.30, 0.31, 0.32);
    } else if (kind < 1.5) {                 // hangar: corrugated metal
      float rib = 0.5 + 0.5 * cos(along * 6.2832 / 0.8);
      alb = vec3(0.47, 0.48, 0.49) * (0.92 + 0.08 * mix(0.5, rib, fine));
      if (roof > 0.5) alb = vec3(0.33, 0.34, 0.35);
    } else if (kind < 2.5) {                 // concrete, rows of windows
      float fl = fract(y / 3.6);
      float win = band(fl, 0.35, 0.75, fw.y / 3.6) * band(fract(along / 3.0), 0.15, 0.85, fw.x / 3.0) * step(1.0, y);
      float h = ihash(ivec2(floor(along / 3.0), floor(y / 3.6)), 11u);
      lit = mix(win * step(0.6, h) * (0.6 + 0.4 * h), 0.1, 1.0 - fine);
      win = mix(win, 0.25, 1.0 - fine);
      alb = mix(vec3(0.40, 0.38, 0.35), vec3(0.08, 0.10, 0.12), win);
      if (roof > 0.5) alb = vec3(0.27, 0.27, 0.26);
    } else {                                 // jet bridge: white-grey panels, a glass strip
      glass = step(1.5, bandF) * (1.0 - roof);
      lit = glass * 0.5;
      alb = mix(vec3(0.52, 0.53, 0.54), vec3(0.10, 0.13, 0.16), glass);
      if (roof > 0.5) alb = vec3(0.40, 0.40, 0.40);
      bandF = 0.0;
    }
    if (bandF > 0.5 && bandF < 1.5) alb *= 0.62;   // the roofline band
    float ndl = max(dot(n, uSunDir), 0.0);
    if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.55, 0.9, n.y));   // v0.4.0: snow on the roofs
    vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
    // Glass reflects the sky.
    vec3 vd = vRel / max(dist, 1e-3);
    float fres = 0.15 + 0.6 * pow(1.0 - max(dot(-vd, n), 0.0), 4.0);
    col += glass * fres * hazeColor(reflect(vd, n)) * 0.55 * (1.0 - 0.8 * uNight);
    // Lit windows at night (warm, not on roofs).
    col += vec3(1.0, 0.72, 0.42) * lit * (1.0 - roof) * 0.32 * uNight;
    gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// v0.4.1: the signs in the grass. Boxes on posts, lit by the sun and the sky; the faces' letters from the glyph atlas,
// and at night the faces glow (they're lit from inside).
const SIGN_VERT = /* glsl */ `
  attribute vec3 scol;                // albedo
  attribute vec3 sbor;                // the face's border colour
  attribute vec4 sk;                  // kind (0 plain, 1 face, 2 letter), glyph index, glow at night (0..1), border (m)
  attribute vec4 suv;                 // u, v (a letter: its cell 0..1; a face: m from its corner), the face's w, h
  varying vec3 vRel, vN, vCol, vBor;
  varying vec4 vK, vUv;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 wp = placeWorld(position);
    vRel = wp - uCamPos;
    vN = normal; vCol = scol; vBor = sbor; vK = sk; vUv = suv;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const SIGN_FRAG = (nGlyphs) => /* glsl */ `
  uniform sampler2D uGlyphs;
  varying vec3 vRel, vN, vCol, vBor;
  varying vec4 vK, vUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 alb = vCol;
    if (vK.x > 1.5) {
      vec2 q = clamp(vUv.xy, 0.0, 1.0);
      float cov = texture(uGlyphs, vec2((vK.y + 0.04 + 0.92 * q.x) / ${nGlyphs.toFixed(1)}, 0.03 + 0.94 * q.y)).r;
      if (cov < 0.5) discard;
    } else if (vK.x > 0.5 && vK.w > 0.0) {
      vec2 p = vUv.xy, sz = vUv.zw;
      if (min(min(p.x, p.y), min(sz.x - p.x, sz.y - p.y)) < vK.w) alb = vBor;
    }
    vec3 n = normalize(vN);
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
    col += alb * vK.z * uNight * 1.0;
    gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ glyph atlas

// v0.4.1: the arrows of the direction signs, as eight characters of the atlas: ARROWS[k] points k eighths of a turn
// clockwise from up.
export const ARROWS = Array.from({ length: 8 }, (_, k) => String.fromCharCode(0xe000 + k));

function glyphAtlas(chars) {
  if (typeof document === 'undefined') return null;
  const cw = 64, ch = 112;
  const c = document.createElement('canvas');
  c.width = cw * chars.length; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    g.save();
    g.translate(i * cw + cw / 2, ch / 2);
    const k = chars.charCodeAt(i) - 0xe000;
    if (k >= 0 && k < 8) {
      // An arrow, drawn so that on a sign's square cell (SIGN.arrowW by SIGN.glyphH) it isn't squashed.
      g.scale(0.55, 1);
      g.rotate((k * Math.PI) / 4);
      g.beginPath();
      g.moveTo(0, -48); g.lineTo(40, -6); g.lineTo(14, -6); g.lineTo(14, 46); g.lineTo(-14, 46); g.lineTo(-14, -6); g.lineTo(-40, -6);
      g.closePath(); g.fill();
    } else {
      g.scale(1, 1.5);
      g.font = 'bold 70px "Helvetica Neue", Helvetica, Arial, sans-serif';
      g.fillText(chars[i], 0, 3);
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;   // flipY (the default): v = 0 is the glyph's foot
}

// ------------------------------------------------------------------ builders

// Growable typed buffers.
function buf() { return { a: [], push(...v) { for (const x of v) this.a.push(x); } }; }

// Exported for tests/apron.test.mjs (v0.2.1), like buildPaint.
export function buildPavement(a, ox, oy, groundAt, aprons) {
  const P = buf(), M = buf();
  // Nothing under the runways (see apron-geom.js → drawnRunwayRects).
  const rects = drawnRunwayRects(a, RUNWAY_OVERLAP);
  const add = (whole, mat, layer) => {
    // Then split wherever the flat triangles would stray from the ground (apron-geom.js → refineSoup).
    const soup = refineSoup(clipSoupOutside(whole, rects), groundAt);
    for (let i = 0; i < soup.length; i += 2) {
      const x = soup[i], y = soup[i + 1];
      P.push(x - ox, groundAt(x, y) + 0.08, -(y - oy));
      M.push(mat, layer);
    }
  };
  // The triangles are drawn in the order they're added, each over the last (see "Depth"
  // above): taxilanes first, so a taxilane's rounded end stays under the taxiway it joins,
  // then the taxiways, then the aprons and stand pads on top.
  for (const lanes of [true, false]) {
    for (const tw of a.taxiways || []) {
      if (!tw.points || tw.points.length < 2 || (tw.kind === 'taxilane') !== lanes) continue;
      const soup = strokeTriangles(densify(tw.points, 50), (tw.widthM || TAXI_W) / 2, [], 4);
      add(soup, lanes ? 1 : 0, 2);
    }
  }
  for (const ap of aprons) {
    let ring = openRing(ap.points);
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();
    const v2 = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const faces = THREE.ShapeUtils.triangulateShape(v2, []);
    const soup = [];
    for (const f of faces) for (const k of f) soup.push(ring[k][0], ring[k][1]);
    add(subdivideSoup(soup, 30), 1, 1);   // 30 m: follow the 30 m height patches
  }
  const terminals = (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => openRing(b.points));
  // A concrete pad under every stand (OSM's aprons don't always reach the stands or the
  // terminal): 52 m along the heading by 40 m.
  for (const s of a.stands || []) {
    const [dx, dy] = hdgVec(s.hdgGridDeg), rx = dy, ry = -dx;
    const c = (f, r) => [s.x + dx * f + rx * r, s.y + dy * f + ry * r];
    const p = [c(-28, -20), c(-28, 20), c(24, 20), c(24, -20)];
    add(subdivideSoup([...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]], 30), 1, 1);
    // At a gate, pave on to the terminal wall under the jet bridge.
    const jb = s.gate ? jetBridge(s, terminals) : null;
    if (jb) {
      const ux = (jb.root.x - jb.cab.x) / jb.length, uy = (jb.root.y - jb.cab.y) / jb.length;
      const nx = -uy * 25, ny = ux * 25, ex = jb.root.x + ux * 4, ey = jb.root.y + uy * 4;
      const q = [[jb.cab.x + nx, jb.cab.y + ny], [jb.cab.x - nx, jb.cab.y - ny], [ex - nx, ey - ny], [ex + nx, ey + ny]];
      add(subdivideSoup([...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]], 30), 1, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.a, 3));
  g.setAttribute('pm', new THREE.Float32BufferAttribute(M.a, 2));
  return g;
}

export function buildPaint(a, ox, oy, groundAt, aprons, chars, signs = null) {
  const P = buf(), S = buf(), L = buf(), K = buf(), Y = buf();
  const idx = [];
  let nv = 0;
  let lead = 0;                              // 1 while adding paint that lies on a runway
  const vert = (x, y, sx, sy, s, u, v, kind, hw, gi, col) => {
    P.push(x - ox, groundAt(x, y) + (lead ? 0 : 0.1), -(y - oy));
    S.push(sx, -sy, s);                      // map (x, y) -> scene (x, -z)
    L.push(u, v);
    K.push(kind, hw, gi, col);
    Y.push(lead);
    return nv++;
  };
  // A line along a polyline: each segment a quad that the shader widens.
  const line = (pts, hw, kind = 0, col = 0) => {
    let along = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 0.05) continue;
      const nx = -(by - ay) / l, ny = (bx - ax) / l;
      // Overlap the joints a little so bends don't crack.
      const ex = ((bx - ax) / l) * hw, ey = ((by - ay) / l) * hw;
      const v0 = vert(ax - ex, ay - ey, nx, ny, 1, along, 0, kind, hw, 0, col);
      const v1 = vert(ax - ex, ay - ey, nx, ny, -1, along, 0, kind, hw, 0, col);
      const v2 = vert(bx + ex, by + ey, nx, ny, 1, along + l, 0, kind, hw, 0, col);
      const v3 = vert(bx + ex, by + ey, nx, ny, -1, along + l, 0, kind, hw, 0, col);
      idx.push(v0, v1, v3, v0, v3, v2);
      along += l;
    }
  };
  // A fixed quad: centre (cx, cy), unit "up" (ux, uy) in the map, size w x h, local coords
  // spanning u0..u1, v0..v1, with its foot at the centre minus h/2 along up.
  const quad = (cx, cy, ux, uy, w, h, u0, u1, v0, v1, kind, hw, gi, col) => {
    const rx = uy, ry = -ux;                // right of up
    const c = (s, t) => [cx + rx * s * w / 2 + ux * t * h / 2, cy + ry * s * w / 2 + uy * t * h / 2];
    const p = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const ids = p.map((q, i) => vert(q[0], q[1], 0, 0, 0, uv[i][0], uv[i][1], kind, hw, gi, col));
    idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  };

  // Taxiway centrelines (also through aprons, as taxilanes). On a runway they're its lead-on
  // and lead-off lines: on the runway's own surface (the heightfield there is that surface,
  // so the points every 4 m follow its bends), over the runway (PULL.lead).
  const rects = drawnRunwayRects(a);
  for (const tw of a.taxiways || []) {
    if (!tw.points || tw.points.length < 2) continue;
    for (const run of splitPolyline(tw.points, rects)) {
      lead = run.inside ? 1 : 0;
      line(run.inside ? densify(run.pts, 4) : refineLine(run.pts, groundAt), LINE_HW);
    }
    lead = 0;
  }
  // Edge lines where the taxiway borders unpaved ground; none on the runways.
  const index = segmentIndex(a.taxiways || []);
  for (const e of taxiwayEdges(a, index, aprons)) {
    for (const run of splitPolyline(simplify(e, 0.05), rects)) if (!run.inside) line(refineLine(run.pts, groundAt), EDGE_HW, 4);
  }
  // Hold-short markings.
  const holds = holdShortSites(a, index);
  for (const h of holds) {
    // The bar's foot (y = 0) is on the holding side; it extends HOLD_DEPTH towards the runway.
    const w = h.w - 1.2;     // between the edge lines
    quad(h.x + h.dx * HOLD_DEPTH / 2, h.y + h.dy * HOLD_DEPTH / 2, h.dx, h.dy, w, HOLD_DEPTH,
      -w / 2, w / 2, 0, HOLD_DEPTH, 1, h.pattern === 'A' ? 0 : 1, 0, 0);
  }
  // Stands: lead-in, stop bar and number.
  let stands = 0;
  const labels = [];
  for (const s of a.stands || []) {
    const m = standMarks(s);
    line(refineLine(m.lead, groundAt), LINE_HW);
    const { stop } = m;
    const rx = stop.dy, ry = -stop.dx;
    line([[stop.x - rx * 3, stop.y - ry * 3], [stop.x + rx * 3, stop.y + ry * 3]], 0.25);
    labels.push([s, m]);
    stands++;
  }
  // v0.4.1: the taxiway's name before each sign array (taxisigns.js), yellow on black, reading the way the traffic goes.
  for (const pt of signs?.painted || []) {
    const ref = String(pt.text).toUpperCase().slice(0, 4), n = ref.length, tw = n * GLYPH_W + (n - 1) * GLYPH_GAP;
    quad(pt.x, pt.y, pt.tx, pt.ty, tw + 1.2, GLYPH_H + 1.2, 0, 1, 0, 1, 3, 0, 0, 2);
    for (let i = 0; i < n; i++) {
      const gi = chars.indexOf(ref[i]);
      if (gi < 0) continue;
      const off = -tw / 2 + GLYPH_W / 2 + i * (GLYPH_W + GLYPH_GAP);
      quad(pt.x + pt.ty * off, pt.y - pt.tx * off, pt.tx, pt.ty, GLYPH_W, GLYPH_H, 0, 1, 0, 1, 2, 0, gi, 0);
    }
  }
  // Numbers last, so no other stand's line is painted over them.
  for (const [s, m] of labels) {
    const ref = String(s.ref || '').toUpperCase().slice(0, 4);
    if (ref) {
      const n = ref.length, tw = n * GLYPH_W + (n - 1) * GLYPH_GAP;
      const { x, y, dx, dy } = m.label;
      quad(x, y, dx, dy, tw + 1.0, GLYPH_H + 1.0, 0, 1, 0, 1, 3, 0, 0, 2);
      for (let i = 0; i < n; i++) {
        const gi = chars.indexOf(ref[i]);
        if (gi < 0) continue;
        const off = -tw / 2 + GLYPH_W / 2 + i * (GLYPH_W + GLYPH_GAP);
        quad(x + dy * off, y - dx * off, dx, dy, GLYPH_W, GLYPH_H, 0, 1, 0, 1, 2, 0, gi, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.a, 3));
  g.setAttribute('side', new THREE.Float32BufferAttribute(S.a, 3));
  g.setAttribute('lc', new THREE.Float32BufferAttribute(L.a, 2));
  g.setAttribute('kp', new THREE.Float32BufferAttribute(K.a, 4));
  g.setAttribute('lay', new THREE.Float32BufferAttribute(Y.a, 1));
  g.setIndex(idx);
  return { geo: g, holds: holds.length, synthetic: holds.filter((h) => h.synthetic).length, stands };
}

// Drop points that lie on the line between their neighbours (within tol metres).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i + 1], p = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l;
    if (d > tol || l > 60) out.push(p);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// v0.4.1: the taxiway and runway signs (taxisigns.js) as boxes on two posts each array, their faces and letters in
// front. Exported for tests/taxisigns.test.mjs. → { geo, arrays, mandatory, exits, distance, triangles }
const SIGN_COL = {
  black: [0.02, 0.02, 0.02], yellow: [0.80, 0.58, 0.04], red: [0.62, 0.035, 0.03], white: [0.86, 0.86, 0.84], body: [0.22, 0.23, 0.24],
};
const FACE = {   // background, letters, border (null: none)
  loc: [SIGN_COL.black, SIGN_COL.yellow, SIGN_COL.yellow],
  dir: [SIGN_COL.yellow, SIGN_COL.black, null],
  mand: [SIGN_COL.red, SIGN_COL.white, SIGN_COL.black],
  dist: [SIGN_COL.black, SIGN_COL.white, null],   // v0.4.2: distance remaining
};
export function buildSigns(sites, ox, oy, groundAt, chars) {
  const P = buf(), N = buf(), C = buf(), B = buf(), K = buf(), U = buf();
  const idx = [];
  let nv = 0;
  const NONE = [0, 0, 0];
  // Map (x, y) and a height to the scene, a map direction to a scene normal.
  const sp = (q) => [q[0] - ox, q[2], -(q[1] - oy)];
  const quad = (pts, n, col, bor, k, uvs) => {
    const ids = pts.map((q, i) => { P.push(...sp(q)); N.push(...n); C.push(...col); B.push(...bor); K.push(...k); U.push(...uvs[i]); return nv++; });
    // Counter-clockwise seen from the normal's side, whatever order the corners came in.
    const [a, b, c] = pts.map(sp), e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
  };
  const ZERO_UV = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  // A box round (cx, cy): half sizes hr along r (rx, ry) and ht along t (tx, ty), from h0 up to h1.
  const box = (cx, cy, rx, ry, tx, ty, hr, ht, h0, h1, col) => {
    const at = (a, b, h) => [cx + rx * a * hr + tx * b * ht, cy + ry * a * hr + ty * b * ht, h];
    const k = [0, 0, 0, 0];
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [rx * a + tx * b, 0, -(ry * a + ty * b)];
      const u = a !== 0 ? [[a, -1], [a, 1]] : [[-1, b], [1, b]];
      quad([at(...u[0], h0), at(...u[1], h0), at(...u[1], h1), at(...u[0], h1)], n, col, NONE, k, ZERO_UV);
    }
    quad([at(-1, -1, h1), at(1, -1, h1), at(1, 1, h1), at(-1, 1, h1)], [0, 1, 0], col, NONE, k, ZERO_UV);
  };
  let arrays = 0, mandatory = 0, exits = 0, distance = 0;
  const all = [...(sites?.arrays || []), ...(sites?.mandatory || []), ...(sites?.exits || []), ...(sites?.distance || [])];
  for (const site of all) {
    if (site.panels[0].kind === 'mand') mandatory++;
    else if (site.panels[0].kind === 'dist') distance++;
    else if (sites?.exits?.includes(site)) exits++;
    else arrays++;
    const { tx, ty } = site, rx = ty, ry = -tx;         // the traffic's way, and its right
    const fn = [-tx, 0, ty];                             // the faces look back at it (scene)
    const W = arrayWidth(site), g0 = groundAt(site.x, site.y);
    const h0 = g0 + SIGN.base, h1 = h0 + SIGN.faceH, hd = SIGN.depth / 2;
    for (const side of [-1, 1]) {
      const o = side * (W / 2 - 0.3);
      box(site.x + rx * o, site.y + ry * o, rx, ry, tx, ty, 0.06, 0.06, g0 - 0.3, h0, SIGN_COL.body);
    }
    let s0 = -W / 2;
    for (const p of site.panels) {
      const w = panelWidth(p), c = s0 + w / 2, cx = site.x + rx * c, cy = site.y + ry * c;
      s0 += w + SIGN.gap;
      box(cx, cy, rx, ry, tx, ty, w / 2, hd, h0, h1, SIGN_COL.body);
      const [bg, fg, bor] = FACE[p.kind];
      // The face, a hair in front of the box, and the letters a hair in front of it.
      const fx = cx - tx * (hd + 0.004), fy = cy - ty * (hd + 0.004);
      const at = (x0, y0, a, h) => [x0 + rx * a, y0 + ry * a, h];
      quad([at(fx, fy, -w / 2, h0), at(fx, fy, w / 2, h0), at(fx, fy, w / 2, h1), at(fx, fy, -w / 2, h1)], fn, bg, bor || NONE,
        [1, 0, 1, bor ? SIGN.border : 0], [[0, 0, w, SIGN.faceH], [w, 0, w, SIGN.faceH], [w, SIGN.faceH, w, SIGN.faceH], [0, SIGN.faceH, w, SIGN.faceH]]);
      const items = [...p.text].map((ch) => ({ ch, w: SIGN.glyphW }));
      if (p.arrow !== undefined) {
        const ar = { ch: ARROWS[p.arrow], w: SIGN.arrowW, arrow: true };
        if (p.arrow >= 5) items.unshift(ar); else items.push(ar);
      }
      const total = items.reduce((t, it) => t + it.w, 0) + SIGN.glyphGap * (items.length - 1 + (p.arrow !== undefined ? 1 : 0));
      const gx = cx - tx * (hd + 0.008), gy = cy - ty * (hd + 0.008), hm = (h0 + h1) / 2;
      let u = -total / 2;
      items.forEach((it, i) => {
        if (it.arrow && i > 0) u += SIGN.glyphGap;
        const gi = chars.indexOf(it.ch);
        if (gi >= 0) {
          const a0 = u, a1 = u + it.w, b0 = hm - SIGN.glyphH / 2, b1 = hm + SIGN.glyphH / 2;
          quad([at(gx, gy, a0, b0), at(gx, gy, a1, b0), at(gx, gy, a1, b1), at(gx, gy, a0, b1)], fn, fg, NONE, [2, gi, 1, 0],
            [[0, 0, 0, 0], [1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0]]);
        }
        u += it.w + SIGN.glyphGap;
        if (it.arrow && i === 0) u += SIGN.glyphGap;
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.a, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N.a, 3));
  g.setAttribute('scol', new THREE.Float32BufferAttribute(C.a, 3));
  g.setAttribute('sbor', new THREE.Float32BufferAttribute(B.a, 3));
  g.setAttribute('sk', new THREE.Float32BufferAttribute(K.a, 4));
  g.setAttribute('suv', new THREE.Float32BufferAttribute(U.a, 4));
  g.setIndex(idx);
  return { geo: g, arrays, mandatory, exits, distance, triangles: idx.length / 3 };
}

const KIND = { terminal: 0, hangar: 1 };

function buildBuildings(a, ox, oy, groundAt) {
  const P = buf(), N = buf(), B = buf();
  const v = (x, y, h, n, kind, band, along, hy) => {
    P.push(x - ox, h, -(y - oy));
    N.push(n[0], n[1], n[2]);
    B.push(kind, band, along, hy);
  };
  // A wall quad from (ax, ay) to (bx, by), heights z0..z1 (absolute), outward map normal.
  const wall = (ax, ay, bx, by, za0, zb0, za1, zb1, kind, band, along0, base) => {
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 0.01) return;
    const nx = (by - ay) / l, ny = -(bx - ax) / l;
    const n = [nx, 0, -ny];
    const A0 = [ax, ay, za0, along0], B0 = [bx, by, zb0, along0 + l], A1 = [ax, ay, za1, along0], B1 = [bx, by, zb1, along0 + l];
    for (const q of [A0, B0, B1, A0, B1, A1]) v(q[0], q[1], q[2], n, kind, band, q[3], q[2] - base);
  };
  const flat = (ring, z, kind, up, base) => {
    const v2 = ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const faces = THREE.ShapeUtils.triangulateShape(v2, []);
    const n = up ? [0, 1, 0] : [0, -1, 0];
    for (const f of faces) {
      // Wind counter-clockwise seen from the face's side (three culls back faces).
      const [i0, i1, i2] = f;
      const ccw = (ring[i1][0] - ring[i0][0]) * (ring[i2][1] - ring[i0][1]) - (ring[i1][1] - ring[i0][1]) * (ring[i2][0] - ring[i0][0]) > 0;
      const ks = ccw === up ? f : [f[0], f[2], f[1]];
      for (const k of ks) v(ring[k][0], ring[k][1], z, n, kind, 0, 0, z - base);
    }
  };

  for (const b of a.buildings || []) {
    let ring = openRing(b.points || []);
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();     // counter-clockwise: outward = right
    const kind = KIND[b.kind] ?? 2;
    let gmin = Infinity, gsum = 0;
    for (const [x, y] of ring) { const g = groundAt(x, y); gmin = Math.min(gmin, g); gsum += g; }
    const base = gmin - 1.0, top = gsum / ring.length + (b.heightM || 10);
    const bandH = Math.min(1.2, (top - base) * 0.12);
    let along = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      wall(ax, ay, bx, by, base, base, top - bandH, top - bandH, kind, 0, along, base);
      wall(ax, ay, bx, by, top - bandH, top - bandH, top, top, kind, 1, along, base);
      along += Math.hypot(bx - ax, by - ay);
    }
    flat(ring, top, kind, true, base);
  }

  // Jet bridges: rotunda at the terminal, a sloping tunnel, a leg, and the cab at the door.
  const terminals = (a.buildings || []).filter((b) => b.kind === 'terminal').map((b) => openRing(b.points));
  let bridges = 0;
  // A box between two ground points: half width hw, bottom heights z0 -> z1, height h.
  // band 2 marks the glass strip (a separate piece in the middle third of the sides).
  const beam = (ax, ay, bx, by, hw, z0, z1, h, glassStrip) => {
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 0.05) return;
    const ux = (bx - ax) / l, uy = (by - ay) / l, nx = -uy, ny = ux;
    const L = [ax + nx * hw, ay + ny * hw, bx + nx * hw, by + ny * hw];
    const R = [ax - nx * hw, ay - ny * hw, bx - nx * hw, by - ny * hw];
    const side = (s, flip) => {
      const [x0, y0, x1, y1] = s;
      const args = flip ? [x1, y1, x0, y0, z1, z0] : [x0, y0, x1, y1, z0, z1];
      const [p0x, p0y, p1x, p1y, q0, q1] = args;
      if (glassStrip) {
        wall(p0x, p0y, p1x, p1y, q0, q1, q0 + h * 0.4, q1 + h * 0.4, 3, 0, 0, q0);
        wall(p0x, p0y, p1x, p1y, q0 + h * 0.4, q1 + h * 0.4, q0 + h * 0.8, q1 + h * 0.8, 3, 2, 0, q0);
        wall(p0x, p0y, p1x, p1y, q0 + h * 0.8, q1 + h * 0.8, q0 + h, q1 + h, 3, 0, 0, q0);
      } else wall(p0x, p0y, p1x, p1y, q0, q1, q0 + h, q1 + h, 3, 0, 0, q0);
    };
    side(R, false);              // right side runs a -> b with outward to the right
    side(L, true);
    wall(L[0], L[1], R[0], R[1], z0, z0, z0 + h, z0 + h, 3, 0, 0, z0);   // end at a
    wall(R[2], R[3], L[2], L[3], z1, z1, z1 + h, z1 + h, 3, 0, 0, z1);   // end at b
    // Roof and floor as two triangles each.
    const roofN = [0, 1, 0], floorN = [0, -1, 0];
    const rp = [[L[0], L[1], z0 + h], [R[0], R[1], z0 + h], [R[2], R[3], z1 + h], [L[2], L[3], z1 + h]];
    for (const k of [0, 1, 2, 0, 2, 3]) v(rp[k][0], rp[k][1], rp[k][2], roofN, 3, 0, 0, h);
    const fp = [[L[0], L[1], z0], [R[0], R[1], z0], [R[2], R[3], z1], [L[2], L[3], z1]];
    for (const k of [0, 2, 1, 0, 3, 2]) v(fp[k][0], fp[k][1], fp[k][2], floorN, 3, 0, 0, 0);
  };
  for (const s of a.stands || []) {
    if (!s.gate) continue;
    const jb = jetBridge(s, terminals);
    if (!jb) continue;
    const g0 = groundAt(jb.root.x, jb.root.y), g1 = groundAt(jb.cab.x, jb.cab.y);
    const floorRoot = g0 + 4.6, floorCab = g1 + DOOR_SILL;
    const [fx, fy] = jb.fwd, [lx, ly] = jb.left;
    // Rotunda: a 4 m square column at the terminal wall.
    beam(jb.root.x - lx * 2, jb.root.y - ly * 2, jb.root.x + lx * 2, jb.root.y + ly * 2, 2, g0 - 0.5, g0 - 0.5, 4.6 + 3.2, false);
    // Tunnel from the rotunda to the back of the cab.
    const ux = (jb.cab.x - jb.root.x) / jb.length, uy = (jb.cab.y - jb.root.y) / jb.length;
    const tStart = Math.min(2, jb.length * 0.3);
    const tEnd = Math.max(tStart + 0.5, jb.length - 1.2);
    beam(jb.root.x + ux * tStart, jb.root.y + uy * tStart, jb.root.x + ux * tEnd, jb.root.y + uy * tEnd, 1.4,
      floorRoot + (floorCab - floorRoot) * (tStart / jb.length), floorRoot + (floorCab - floorRoot) * (tEnd / jb.length), 2.8, true);
    // The cab: square to the fuselage, its face on the door (centre 1.6 m out from it).
    beam(jb.cab.x - fx * 1.8, jb.cab.y - fy * 1.8, jb.cab.x + fx * 1.8, jb.cab.y + fy * 1.8, 1.6, floorCab - 0.3, floorCab - 0.3, 3.2, true);
    // The drive leg near the cab: two columns and a bogie.
    const kx = jb.root.x + ux * jb.length * 0.78, ky = jb.root.y + uy * jb.length * 0.78;
    const kf = floorRoot + (floorCab - floorRoot) * 0.78;
    const gk = groundAt(kx, ky);
    for (const sgn of [-1, 1]) {
      const cx = kx + -uy * sgn * 1.1, cy = ky + ux * sgn * 1.1;
      beam(cx - ux * 0.25, cy - uy * 0.25, cx + ux * 0.25, cy + uy * 0.25, 0.25, gk, gk, kf - gk, false);
    }
    beam(kx - ux * 0.9, ky - uy * 0.9, kx + ux * 0.9, ky + uy * 0.9, 1.6, gk, gk, 0.9, false);
    bridges++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.a, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N.a, 3));
  g.setAttribute('bk', new THREE.Float32BufferAttribute(B.a, 4));
  return { geo: g, bridges, buildings: (a.buildings || []).length };
}

// ------------------------------------------------------------------ floodlights

// The floodlights' pools as a light texture (R8, FLOOD_CELL m texels) over the masts, with
// a blank border so the clamped edge reads as dark. Each pool: 1 / (1 + (r / 28 m)^2),
// fading out by 120 m; the sum is clamped to FLOOD_MAX.
function floodTexture(a, ox, oy) {
  const masts = floodMasts(a);
  if (!masts.length) {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    return { tex: t, box: new THREE.Vector4(0, 0, 1, 1), masts };
  }
  const R = 120, pad = R + 2 * FLOOD_CELL;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of masts) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y); }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const nx = Math.ceil((x1 - x0) / FLOOD_CELL), ny = Math.ceil((y1 - y0) / FLOOD_CELL);
  const acc = new Float32Array(nx * ny);
  const rc = Math.ceil(R / FLOOD_CELL);
  for (const m of masts) {
    const ci = Math.floor((m.x - x0) / FLOOD_CELL), cj = Math.floor((m.y - y0) / FLOOD_CELL);
    for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) {
      for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
        const r = Math.hypot(x0 + (i + 0.5) * FLOOD_CELL - m.x, y0 + (j + 0.5) * FLOOD_CELL - m.y);
        if (r >= R) continue;
        const fade = r < 80 ? 1 : 1 - (r - 80) / (R - 80);
        acc[j * nx + i] += fade / (1 + (r / 28) ** 2);
      }
    }
  }
  const data = new Uint8Array(nx * ny);
  for (let k = 0; k < acc.length; k++) data[k] = Math.round(Math.min(acc[k] / FLOOD_MAX, 1) * 255);
  const t = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1;
  t.needsUpdate = true;
  // Texel centres: map x0 + (i + 0.5) * cell, and uv = (loc - corner) / size.
  return { tex: t, box: new THREE.Vector4(x0 - ox, y0 - oy, nx * FLOOD_CELL, ny * FLOOD_CELL), masts };
}

// ------------------------------------------------------------------ public

export function createAprons(scene, uniforms, chunks, airports, heightfield = null) {
  const group = new THREE.Group();
  group.name = 'aprons';
  // Every character used in a stand number, for the glyph atlas; v0.4.1: and in the signs (taxiway names, runway
  // idents), with their arrows.
  const set = new Set('0123456789-');
  for (const a of airports || []) {
    for (const s of a.stands || []) for (const ch of String(s.ref || '').toUpperCase()) set.add(ch);
    for (const t of a.taxiways || []) for (const ch of String(t.ref || '').toUpperCase()) set.add(ch);
    for (const r of a.runways || []) for (const e of r.ends || []) for (const ch of String(e.ident || '').toUpperCase()) set.add(ch);
  }
  for (const ch of ARROWS) set.add(ch);
  const chars = [...set].sort().join('');
  const glyphs = glyphAtlas(chars);

  const vhead = `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${COMMON_VERT}\n`;
  const fhead = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.ATMOS_GLSL}\n${chunks.AIRCRAFT_LIGHTS_GLSL}\n${LIGHT_GLSL}\n`;
  const sites = [];
  let tris = 0;

  for (const a of airports || []) {
    if (!a || !(a.taxiways || a.aprons || a.buildings)) continue;
    const ox = a.origin ? a.origin[0] : 0, oy = a.origin ? a.origin[1] : 0;
    const groundAt = (x, y) => (heightfield ? heightfield.heightAt(x, y) : a.elevM || 0);
    const aprons = dedupePolys(a.aprons || []);
    const flood = floodTexture(a, ox, oy);
    const u = Object.assign({}, uniforms, { uRelA: { value: new THREE.Vector2() }, uGlyphs: { value: glyphs },
      uFlood: { value: flood.tex }, uFloodBox: { value: flood.box } });

    const meshes = [];
    const pave = buildPavement(a, ox, oy, groundAt, aprons);
    const paveMesh = new THREE.Mesh(pave, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vhead + PAVE_VERT, fragmentShader: fhead + PAVE_FRAG, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    paveMesh.renderOrder = 1;     // after the terrain and the runways (see "Depth")
    meshes.push(paveMesh);
    // v0.4.1: the signs, and their names painted on the taxiways.
    let signSites = null;
    try { signSites = taxiSignSites(a); } catch { signSites = null; }
    const paint = buildPaint(a, ox, oy, groundAt, aprons, chars, signSites);
    const paintMesh = new THREE.Mesh(paint.geo, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vhead + PAINT_VERT, fragmentShader: fhead + PAINT_FRAG(chars.length),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    paintMesh.renderOrder = 2;
    meshes.push(paintMesh);
    const bl = buildBuildings(a, ox, oy, groundAt);
    meshes.push(new THREE.Mesh(bl.geo, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vhead + BLDG_VERT, fragmentShader: fhead + BLDG_FRAG,
    })));
    const signs = buildSigns(signSites, ox, oy, groundAt, chars);
    const signMesh = signs.triangles ? new THREE.Mesh(signs.geo, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vhead + SIGN_VERT, fragmentShader: fhead + SIGN_FRAG(chars.length),
    })) : null;
    if (signMesh) meshes.push(signMesh);

    const sub = new THREE.Group();
    sub.name = `aprons-${a.icao}`;
    let t = 0;
    for (const m of meshes) {
      m.frustumCulled = false;
      m.name = `${sub.name}-${m === paintMesh ? 'paint' : m === signMesh ? 'signs' : m.geometry === pave ? 'pavement' : 'buildings'}`;
      sub.add(m);
      const g = m.geometry;
      t += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
    }
    group.add(sub);
    tris += t;

    // Bounds of everything, for the range check.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (pts) => { for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
    for (const tw of a.taxiways || []) grow(tw.points);
    for (const ap of aprons) grow(ap.points);
    for (const b of a.buildings || []) grow(b.points);
    if (!isFinite(x0)) { x0 = x1 = ox; y0 = y1 = oy; }
    sites.push({
      icao: a.icao, group: sub, u, ox, oy, box: [x0, y0, x1, y1], tris: t, drawCalls: meshes.length,
      info: { holds: paint.holds, syntheticHolds: paint.synthetic, stands: paint.stands, bridges: bl.bridges, buildings: bl.buildings, aprons: aprons.length,
        signArrays: signs.arrays, signsMandatory: signs.mandatory, signsExit: signs.exits, signsDistance: signs.distance },
    });
  }
  scene.add(group);

  const camMap = { x: 0, y: 0 };
  return {
    group,
    sites,
    // ctx: { camMap?, origin? } (what world.js has). Without them the camera and origin
    // come from the shared uniforms, which world.update() has just set.
    update(ctx = {}) {
      const origin = (ctx && ctx.origin) || uniforms.uOrigin.value;
      if (ctx && ctx.camMap) { camMap.x = ctx.camMap.x; camMap.y = ctx.camMap.y; }
      else { const c = uniforms.uCamPos.value; camMap.x = origin.x + c.x; camMap.y = origin.y - c.z; }
      const high = uniforms.uCamAlt.value > APRON_MAX_ALT;
      let drawCalls = 0, triangles = 0;
      for (const s of sites) {
        const [x0, y0, x1, y1] = s.box;
        const dx = Math.max(x0 - camMap.x, 0, camMap.x - x1), dy = Math.max(y0 - camMap.y, 0, camMap.y - y1);
        const on = !high && Math.hypot(dx, dy) < APRON_RANGE;
        s.group.visible = on;
        if (!on) continue;
        s.u.uRelA.value.set(s.ox - origin.x, s.oy - origin.y);
        drawCalls += s.drawCalls;
        triangles += s.tris;
      }
      return { drawCalls, triangles };
    },
  };
}

export { hdgVec };
