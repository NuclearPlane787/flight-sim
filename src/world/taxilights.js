// Taxiway lights at night (v0.2.0): green centreline lights, blue edge lights and red stop
// bars at the runway holding points, plus the lamps on the apron's floodlight masts.
//
//   taxiLightLayout(airport, hf?) -> [{ x, y, z?, color: 'green'|'blue'|'red', kind: 'centre'|'edge'|'stopbar', dir? }]
//   floodMasts(airport)           -> [{ x, y, h }]   (also used by apron.js for the light pools)
//   const t = createTaxiLights(scene, uniforms, chunks, airports, hf);
//   each frame:  t.update({ camMap, origin, camScene }) -> { drawCalls, tris, lights }
//
// The layout is pure (node-testable). Centreline lights follow the airport JSON's taxiway
// lines (every 30 m on straights, 15 m in bends); edge lights follow the same edge lines
// the paint uses (apron-geom.js taxiwayEdges: only where the taxiway borders unpaved
// ground), every 60 m; stop bars sit just short of the painted runway hold-shorts
// (holdShortSites, pattern A), a row of red lights across the taxiway, facing the holding
// side. Nothing is placed on a runway's pavement.
//
// Drawing: one THREE.Points per airport (one draw call), camera-relative like the runway
// lights, hidden by day (uNight < 0.01) and beyond 30 km.

import * as THREE from '../../vendor/three.module.js';
import {
  TAXI_W, runwayLines, segmentIndex, taxiwayEdges, holdShortSites, dedupePolys, hdgVec, segDist,
} from './apron-geom.js';
import { RUNWAY_SHOULDER_M } from './runways.js';
import { buildTaxiGraph, holdingPointFor } from '../ground/taxi.js';

const CENTRE_STEP = 30, BEND_STEP = 15, EDGE_STEP = 60, BAR_STEP = 3;
const BEND_DEG = 8;              // heading change over ±15 m that counts as a bend
const RANGE = 30000;             // m from the airport's bounds

// Is (x, y) on (or right beside) a runway's pavement?
// shoulder: whether the paved shoulders count.
function onRunway(lines, x, y, margin = 3, shoulder = true) {
  for (const l of lines) {
    const u = (x - l.ax) * l.ux + (y - l.ay) * l.uy, v = -(x - l.ax) * l.uy + (y - l.ay) * l.ux;
    if (u > -margin && u < l.len + margin && Math.abs(v) < l.hw + (shoulder ? RUNWAY_SHOULDER_M : 0) + margin) return true;
  }
  return false;
}

// Is (x, y) on some taxiway's pavement (within `slack` m of its edge)?
function onTaxiway(index, x, y, slack = 0.3) {
  for (const s of index.near(x, y)) if (segDist(x, y, s.ax, s.ay, s.bx, s.by).d <= s.hw + slack) return true;
  return false;
}

// Points along a polyline: [{ x, y, s, dx, dy }] every `step` m (and the ends).
function walk(pts, step) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 1e-6) continue;
    const dx = (bx - ax) / l, dy = (by - ay) / l;
    let t = out.length ? (step - ((s) % step)) % step : 0;
    for (; t < l; t += step) out.push({ x: ax + dx * t, y: ay + dy * t, s: s + t, dx, dy });
    s += l;
  }
  const [ex, ey] = pts[pts.length - 1];
  if (out.length) { const p = out[out.length - 1]; out.push({ x: ex, y: ey, s, dx: p.dx, dy: p.dy }); }
  return out;
}

// A spatial hash that refuses points closer than `minD` to one already kept.
function thinner(minD) {
  const grid = new Map(), cell = minD;
  const key = (i, j) => i + ',' + j;
  return (x, y) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const p of grid.get(key(ci + di, cj + dj)) || []) if (Math.hypot(p[0] - x, p[1] - y) < minD) return false;
    }
    const k = key(ci, cj);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, y]);
    return true;
  };
}

export function taxiLightLayout(airport, hf = null) {
  const lines = runwayLines(airport);
  const taxiways = (airport.taxiways || []).filter((t) => t.points && t.points.length >= 2);
  const index = segmentIndex(taxiways);
  const out = [];
  const z = (x, y) => (hf ? hf.heightAt(x, y) + 0.25 : undefined);
  const put = (x, y, color, kind, dir) => {
    const l = { x, y, color, kind };
    const h = z(x, y);
    if (h !== undefined) l.z = h;
    if (dir) l.dir = dir;
    out.push(l);
  };

  // Centreline: sample every 15 m, keep every other one unless the line bends there.
  const keepC = thinner(7);
  for (const tw of taxiways) {
    const p = walk(tw.points, BEND_STEP);
    let last = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, p.length - 1)];
      const turn = Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dy * b.dy))) * 180 / Math.PI;
      const bend = turn > BEND_DEG;
      if (!bend && p[i].s - last < CENTRE_STEP - 0.5) continue;
      if (onRunway(lines, p[i].x, p[i].y)) continue;
      if (!keepC(p[i].x, p[i].y)) continue;
      last = p[i].s;
      put(p[i].x, p[i].y, 'green', 'centre');
    }
  }

  // Edges: the paint's edge lines (inset 0.6 m), pushed out to the pavement's edge.
  const keepE = thinner(20);
  const aprons = dedupePolys(airport.aprons || []);
  for (const e of taxiwayEdges({ ...airport, taxiways }, index, aprons)) {
    for (const q of walk(e, EDGE_STEP)) {
      if (onRunway(lines, q.x, q.y, 8)) continue;
      if (!keepE(q.x, q.y)) continue;
      put(q.x, q.y, 'blue', 'edge');
    }
  }

  // Stop bars: across the taxiway 0.6 m short of each runway hold-short, facing the holding
  // side. Then, where the taxi graph's departure hold for a runway end (where the aircraft
  // stops, taxi.js) has no bar within 40 m, one there too.
  const sites = holdShortSites({ ...airport, taxiways }, index).filter((h) => h.pattern === 'A');
  for (const h of departureHolds(airport, lines)) {
    if (!sites.some((q) => Math.hypot(q.x - h.x, q.y - h.y) < 40)) sites.push({ ...h, graph: true });
  }
  for (const h of sites) {
    const w = (h.w || TAXI_W) - 2, n = Math.max(2, Math.round(w / BAR_STEP));
    const rx = h.dy, ry = -h.dx;
    const cx = h.x - h.dx * 0.6, cy = h.y - h.dy * 0.6;
    for (let i = 0; i <= n; i++) {
      const o = -w / 2 + (w * i) / n;
      const x = cx + rx * o, y = cy + ry * o;
      // (The taxi graph can hold right at a runway's edge, on its shoulder: Incheon 34R.)
      if (onRunway(lines, x, y, 0.3, !h.graph)) continue;
      if (!onTaxiway(index, x, y)) continue;
      put(x, y, 'red', 'stopbar', [-h.dx, -h.dy]);
    }
  }
  return out;
}

// The taxi graph's departure holds, as hold-short sites { x, y, dx, dy (towards the runway), w }.
function departureHolds(airport, lines) {
  if (!(airport.runways || []).length) return [];
  let g;
  try { g = buildTaxiGraph(airport); } catch { return []; }
  const out = [];
  for (const r of airport.runways) for (const e of r.ends) {
    const h = holdingPointFor(g, e);
    if (!h || onRunway(lines, h.x, h.y, 0, false)) continue;   // its fallback: the runway end itself
    const node = g.nodes[h.node];
    const edge = node && node.edges.find((q) => !q.runway && !q.axis && !q.dead) || node?.edges[0];
    if (!edge) continue;
    const o = g.nodes[edge.a === node.id ? edge.b : edge.a];
    const l = Math.hypot(o.x - node.x, o.y - node.y) || 1;
    let dx = (o.x - node.x) / l, dy = (o.y - node.y) / l;
    // Point it at the runway: the way the distance to the centreline shrinks.
    const dist = (x, y) => Math.min(...lines.map((q) => Math.abs(-(x - q.ax) * q.uy + (y - q.ay) * q.ux)));
    if (dist(node.x + dx * 5, node.y + dy * 5) > dist(node.x - dx * 5, node.y - dy * 5)) { dx = -dx; dy = -dy; }
    out.push({ x: node.x, y: node.y, dx, dy, w: edge.widthM || TAXI_W, pattern: 'A', synthetic: true });
  }
  return out;
}

// Floodlight masts: one behind every other stand's tail, between stands, 25 m tall
// (none within 70 m of another, none near a runway).
export function floodMasts(airport) {
  const lines = runwayLines(airport);
  const keep = thinner(70);
  const out = [];
  for (const s of airport.stands || []) {
    const [dx, dy] = hdgVec(s.hdgGridDeg || 0), rx = dy, ry = -dx;
    for (const side of [-1, 1]) {
      const x = s.x - dx * 34 + rx * side * 24, y = s.y - dy * 34 + ry * side * 24;
      if (onRunway(lines, x, y, 60)) continue;
      if (!keep(x, y)) continue;
      out.push({ x, y, h: 25 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ drawing

const COLORS = { green: [0.12, 1.0, 0.32], blue: [0.18, 0.32, 1.0], red: [1.0, 0.07, 0.04], amber: [1.0, 0.78, 0.48] };
const KINDS = { centre: 0, edge: 1, stopbar: 2, mast: 3 };
const SIZE = { centre: 0.35, edge: 0.4, stopbar: 0.45, mast: 1.4 };

const TAXI_VERT = /* glsl */ `
  uniform vec2 uRelA;            // airport origin minus the scene origin (map metres)
  attribute vec4 tcol;           // rgb, kind
  attribute vec3 tdir;           // facing (map x, y; 0 = all round), size (m)
  varying vec3 vCol;
  varying float vCore, vHalo;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec2 rel = uRelA + position.xy;
    vec3 wp = vec3(rel.x, position.z, -rel.y);
    vec3 r = wp - uCamPos;
    wp.y -= curveDrop(r.xz);
    r = wp - uCamPos;
    float dist = length(r);
    float kind = tcol.a, n = uNight;
    float I = n;
    if (kind > 1.5 && kind < 2.5) {
      // Stop bars shine towards the holding side only.
      vec2 toCam = -vec2(r.x, -r.z) / max(length(r.xz), 1e-3);
      I *= smoothstep(-0.1, 0.3, dot(toCam, tdir.xy));
    }
    // In-pavement lights are dimmer than the runway's and fade sooner with distance.
    float od = uHazeSigma0 * dist * exp(-max(min(uCamAlt, wp.y + 0.5 * r.y), 0.0) / uHazeH);
    od += fogDepth(r, dist);   // v0.4.0: the weather's fog and cloud
    I *= exp(-od) * 1.2;
    float px = tdir.z * uPxScale / max(dist, 1.0);
    float minPx = 2.2;
    float sz = px > minPx ? minPx + (px - minPx) * 0.4 : minPx;
    I *= clamp(sqrt(px / minPx), 0.1, 1.0);
    float S = min(sz * 2.2, 16.0);
    gl_PointSize = S * step(0.002, I);
    vCore = sz / S;
    vHalo = 0.25;
    vCol = tcol.rgb * I;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float d = length(mv.xyz);
    mv.xyz *= 1.0 - min((0.25 + d * 0.0014) / max(d, 1e-3), 0.5);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;

const TAXI_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vCore, vHalo;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float rc2 = r2 / (vCore * vCore);
    float a = exp(-rc2 * 5.0) * 1.5 + vHalo * exp(-r2 * 5.0) * (1.0 - r2);
    gl_FragColor = vec4(vCol * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createTaxiLights(scene, uniforms, chunks, airports, hf = null) {
  const group = new THREE.Group();
  group.name = 'taxi-lights';
  const sets = [];
  for (const a of airports || []) {
    if (!a || !a.taxiways) continue;
    const L = taxiLightLayout(a, hf);
    for (const m of floodMasts(a)) {
      // Two lamps on each mast's head.
      const g = hf ? hf.heightAt(m.x, m.y) : a.elevM || 0;
      for (const o of [-1.2, 1.2]) L.push({ x: m.x + o, y: m.y, z: g + m.h, color: 'amber', kind: 'mast' });
    }
    if (!L.length) continue;
    const ox = a.origin ? a.origin[0] : L[0].x, oy = a.origin ? a.origin[1] : L[0].y;
    const pos = new Float32Array(L.length * 3), col = new Float32Array(L.length * 4), dir = new Float32Array(L.length * 3);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    L.forEach((l, i) => {
      const h = l.z ?? (a.elevM || 0) + 0.25;
      pos.set([l.x - ox, l.y - oy, h], i * 3);
      col.set([...COLORS[l.color], KINDS[l.kind]], i * 4);
      dir.set([l.dir ? l.dir[0] : 0, l.dir ? l.dir[1] : 0, SIZE[l.kind]], i * 3);
      x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x); y1 = Math.max(y1, l.y);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('tcol', new THREE.BufferAttribute(col, 4));
    g.setAttribute('tdir', new THREE.BufferAttribute(dir, 3));
    const u = Object.assign({}, uniforms, { uRelA: { value: new THREE.Vector2() } });
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `${chunks.UNIFORMS_GLSL}\n${chunks.HEIGHT_GLSL}\n${TAXI_VERT}`,
      fragmentShader: TAXI_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.name = `taxi-lights-${a.icao}`;
    pts.visible = false;
    group.add(pts);
    sets.push({ icao: a.icao, pts, u, ox, oy, box: [x0, y0, x1, y1], count: L.length });
  }
  scene.add(group);

  return {
    group,
    sets,
    update({ camMap, origin } = {}) {
      const night = uniforms.uNight.value > 0.01;
      origin = origin || uniforms.uOrigin.value;
      let drawCalls = 0, lights = 0;
      for (const s of sets) {
        let on = night;
        if (on && camMap) {
          const [x0, y0, x1, y1] = s.box;
          const dx = Math.max(x0 - camMap.x, 0, camMap.x - x1), dy = Math.max(y0 - camMap.y, 0, camMap.y - y1);
          on = Math.hypot(dx, dy) < RANGE;
        }
        s.pts.visible = on;
        if (!on) continue;
        s.u.uRelA.value.set(s.ox - origin.x, s.oy - origin.y);
        drawCalls++;
        lights += s.count;
      }
      return { drawCalls, tris: 0, lights };
    },
  };
}
