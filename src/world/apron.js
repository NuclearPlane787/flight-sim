// Airport ground and buildings (M2): taxiways, aprons, their paint (centrelines, edge
// lines, hold-shorts, stand lead-ins, stop bars and numbers), terminals, hangars and other
// buildings, and static jet bridges. All three airports, from data/airports/*.json.
//
//   const aprons = createAprons(scene, uniforms, chunks, airports, heightfield);
//   each frame, after world.update():  aprons.update(ctx) -> { drawCalls, triangles }
//
// Per airport there are three merged meshes (pavement, paint, buildings), each with one
// material: three draw calls. Positions are stored relative to the airport's origin and
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

import * as THREE from '../../vendor/three.module.js';
import {
  TAXI_W, DOOR_SILL, openRing, signedArea, densify, dedupePolys, segmentIndex,
  holdShortSites, taxiwayEdges, standMarks, jetBridge, strokeTriangles, subdivideSoup, hdgVec,
} from './apron-geom.js';

export const APRON_RANGE = 25000;          // m from the airport's bounds
export const APRON_MAX_ALT = 15000 * 0.3048;

const LINE_HW = 0.18;        // taxiway centreline / lead-in half width (m): 0.36 m, a little over ICAO's 0.15
const EDGE_HW = 0.38;        // taxiway edge double line half width
const HOLD_DEPTH = 2.1;      // four 0.3 m lines with 0.3 m gaps (twice ICAO's, to read from the cockpit)
const GLYPH_H = 3.2, GLYPH_W = 2.0, GLYPH_GAP = 0.35;

// Pull towards the camera (m = a + b * distance); the runways use 0.16 + 0.0016 d.
// The draw order (see "Depth") puts the aprons over the taxiways, so taxiways crossing an
// apron read as apron concrete.
// The distance terms cover the coarser terrain rings further out (they cut through flat
// pavement by a few cm per 100 m); the runways (airports.js) stay above all of these.
const PULL = { taxi: [0.06, 0.0006], apron: [0.10, 0.0010], paint: [0.13, 0.0013] };

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
  vec3 groundLight(vec3 col) { return col * (uSunColor * max(uSunDir.y, 0.0) * 2.4 + uSkyAmb * 1.1); }
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
    vec3 c = groundLight(col);
    gl_FragColor = vec4(applyHaze(c, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const PAINT_VERT = /* glsl */ `
  attribute vec3 side;                // scene-local unit across (x, z) and which side (-1, 1); 0 = fixed quad
  attribute vec2 lc;                  // local coordinates (m, or glyph cell 0..1)
  attribute vec4 kp;                  // kind, half width / pattern, glyph index, colour
  varying vec3 vRel;
  varying vec2 vLc;
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
    vKp = kp;
    gl_Position = projectPulled(wp, vec2(${PULL.paint[0]}, ${PULL.paint[1]}));
    #include <logdepthbuf_vertex>
  }`;

const PAINT_FRAG = (nGlyphs) => /* glsl */ `
  uniform sampler2D uGlyphs;
  varying vec3 vRel;
  varying vec2 vLc;
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
    if (cov < 0.004) discard;
    vec3 alb = vKp.w < 0.5 ? vec3(0.62, 0.43, 0.05) : vKp.w < 1.5 ? vec3(0.52, 0.52, 0.50) : vec3(0.012, 0.012, 0.012);
    vec3 c = groundLight(alb);
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
    if (kind < 0.5) {                        // terminal: glass curtain wall with mullions
      float mull = max(band(fract(along / 3.0), 0.0, 0.05, fw.x / 3.0), band(fract(y / 4.5), 0.0, 0.06, fw.y / 4.5));
      mull = mix(mull, 0.12, 1.0 - fine);
      glass = (1.0 - mull) * step(0.6, y);
      alb = mix(vec3(0.30, 0.32, 0.34), vec3(0.10, 0.14, 0.18), glass);
      if (roof > 0.5) alb = vec3(0.30, 0.31, 0.32);
    } else if (kind < 1.5) {                 // hangar: corrugated metal
      float rib = 0.5 + 0.5 * cos(along * 6.2832 / 0.8);
      alb = vec3(0.47, 0.48, 0.49) * (0.92 + 0.08 * mix(0.5, rib, fine));
      if (roof > 0.5) alb = vec3(0.33, 0.34, 0.35);
    } else if (kind < 2.5) {                 // concrete, rows of windows
      float fl = fract(y / 3.6);
      float win = band(fl, 0.35, 0.75, fw.y / 3.6) * band(fract(along / 3.0), 0.15, 0.85, fw.x / 3.0) * step(1.0, y);
      win = mix(win, 0.25, 1.0 - fine);
      alb = mix(vec3(0.40, 0.38, 0.35), vec3(0.08, 0.10, 0.12), win);
      if (roof > 0.5) alb = vec3(0.27, 0.27, 0.26);
    } else {                                 // jet bridge: white-grey panels, a glass strip
      glass = step(1.5, bandF) * (1.0 - roof);
      alb = mix(vec3(0.52, 0.53, 0.54), vec3(0.10, 0.13, 0.16), glass);
      if (roof > 0.5) alb = vec3(0.40, 0.40, 0.40);
      bandF = 0.0;
    }
    if (bandF > 0.5 && bandF < 1.5) alb *= 0.62;   // the roofline band
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
    // Glass reflects the sky.
    vec3 vd = vRel / max(dist, 1e-3);
    float fres = 0.15 + 0.6 * pow(1.0 - max(dot(-vd, n), 0.0), 4.0);
    col += glass * fres * hazeColor(reflect(vd, n)) * 0.55;
    gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ glyph atlas

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
    g.scale(1, 1.5);
    g.font = 'bold 70px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.fillText(chars[i], 0, 3);
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

function buildPavement(a, ox, oy, groundAt, aprons) {
  const P = buf(), M = buf();
  const add = (soup, mat, layer) => {
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

function buildPaint(a, ox, oy, groundAt, aprons, chars) {
  const P = buf(), S = buf(), L = buf(), K = buf();
  const idx = [];
  let nv = 0;
  const vert = (x, y, sx, sy, s, u, v, kind, hw, gi, col) => {
    P.push(x - ox, groundAt(x, y) + 0.1, -(y - oy));
    S.push(sx, -sy, s);                      // map (x, y) -> scene (x, -z)
    L.push(u, v);
    K.push(kind, hw, gi, col);
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

  // Taxiway centrelines (also through aprons, as taxilanes).
  for (const tw of a.taxiways || []) if (tw.points && tw.points.length >= 2) line(tw.points, LINE_HW);
  // Edge lines where the taxiway borders unpaved ground.
  const index = segmentIndex(a.taxiways || []);
  for (const e of taxiwayEdges(a, index, aprons)) line(simplify(e, 0.05), EDGE_HW, 4);
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
    line(m.lead, LINE_HW);
    const { stop } = m;
    const rx = stop.dy, ry = -stop.dx;
    line([[stop.x - rx * 3, stop.y - ry * 3], [stop.x + rx * 3, stop.y + ry * 3]], 0.25);
    labels.push([s, m]);
    stands++;
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

// ------------------------------------------------------------------ public

export function createAprons(scene, uniforms, chunks, airports, heightfield = null) {
  const group = new THREE.Group();
  group.name = 'aprons';
  // Every character used in a stand number, for the glyph atlas.
  const set = new Set('0123456789');
  for (const a of airports || []) for (const s of a.stands || []) for (const ch of String(s.ref || '').toUpperCase()) set.add(ch);
  const chars = [...set].sort().join('');
  const glyphs = glyphAtlas(chars);

  const vhead = `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${COMMON_VERT}\n`;
  const fhead = `${chunks.UNIFORMS_GLSL}\n${chunks.NOISE_GLSL}\n${chunks.ATMOS_GLSL}\n${LIGHT_GLSL}\n`;
  const sites = [];
  let tris = 0;

  for (const a of airports || []) {
    if (!a || !(a.taxiways || a.aprons || a.buildings)) continue;
    const ox = a.origin ? a.origin[0] : 0, oy = a.origin ? a.origin[1] : 0;
    const groundAt = (x, y) => (heightfield ? heightfield.heightAt(x, y) : a.elevM || 0);
    const aprons = dedupePolys(a.aprons || []);
    const u = Object.assign({}, uniforms, { uRelA: { value: new THREE.Vector2() }, uGlyphs: { value: glyphs } });

    const meshes = [];
    const pave = buildPavement(a, ox, oy, groundAt, aprons);
    const paveMesh = new THREE.Mesh(pave, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vhead + PAVE_VERT, fragmentShader: fhead + PAVE_FRAG, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    paveMesh.renderOrder = 1;     // after the terrain and the runways (see "Depth")
    meshes.push(paveMesh);
    const paint = buildPaint(a, ox, oy, groundAt, aprons, chars);
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

    const sub = new THREE.Group();
    sub.name = `aprons-${a.icao}`;
    let t = 0;
    for (const m of meshes) {
      m.frustumCulled = false;
      m.name = `${sub.name}-${m === paintMesh ? 'paint' : m.geometry === pave ? 'pavement' : 'buildings'}`;
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
      info: { holds: paint.holds, syntheticHolds: paint.synthetic, stands: paint.stands, bridges: bl.bridges, buildings: bl.buildings, aprons: aprons.length },
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
