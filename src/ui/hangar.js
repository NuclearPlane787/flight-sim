// v0.5.1: the warehouse's hangar, the room the design stands in (it was a flat grey world). A maintenance hangar big
// enough for the 777-300ER with room to walk round it: steel portal frames and roof trusses, a corrugated roof with
// skylights and high-bay lamps, offices along the back, racks, benches and a spare engine along the sides, and the
// way in at the front: sliding door leaves on floor tracks, part open onto a sunlit apron. The floor is painted
// epoxy with the stand's lead-in line and a stop bar for each type's nose wheel, the parking area, walkways and
// keep-clear hatching. People walk the walkways.
//
// Three.js coordinates as the aircraft's model (src/aircraft.js toModel): x to the aircraft's right, y up, z aft.
// The floor is y = 0 in the hangar's group (the warehouse puts the group at the design's wheels). The aircraft's
// nose points at the back wall (−z); the doors are behind its tail (+z), where it came in.
//   HANGAR                    the room's size, m
//   cameraBox(floorY)         the box the warehouse's camera stays in
//   rayExit(p, u, box)        how far from p along u (unit) before leaving the box
//   walkPath(s)               a point on the walkways' loop, s metres along it: { x, z, h } (h: heading, rad)
//   createHangar(THREE, opts) → { group, update(tSec), dispose(), calls }
// Everything static is merged by material: about a dozen draw calls in all, people included.

import { TYPES } from '../sim/types.js';

export const HANGAR = Object.freeze({
  halfX: 75, back: -70, door: 70,       // the side walls at x = ±75, the back wall, the door line
  eave: 28, ridge: 34, chordTop: 30,     // the trusses' bottom chord, the roof's top chord at the middle and at the walls
  doorHalf: 60, doorH: 24.8, open: 35,   // the doorway (x within ±60), the leaves' height, the gap left open (±35)
  walkX: 70, walkBack: -57, walkFront: 62,
});

export function cameraBox(floorY, m = 2) {
  const H = HANGAR;
  return { min: [-H.halfX + m, floorY + 0.8, H.back + m], max: [H.halfX - m, floorY + H.eave - 2, H.door - 3] };
}

export function rayExit(p, u, box) {
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    if (u[i] > 1e-9) t = Math.min(t, (box.max[i] - p[i]) / u[i]);
    else if (u[i] < -1e-9) t = Math.min(t, (box.min[i] - p[i]) / u[i]);
  }
  return Math.max(0, t);
}

// The walkways' loop: along the back, up the right side, across in front of the doors, down the left side.
const LOOP = (() => {
  const H = HANGAR, pts = [[-H.walkX, H.walkBack], [H.walkX, H.walkBack], [H.walkX, H.walkFront], [-H.walkX, H.walkFront]];
  const segs = [];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, L, s0: s, h: Math.atan2(b[0] - a[0], b[1] - a[1]) });
    s += L;
  }
  return { segs, length: s };
})();
export const WALK_LENGTH = LOOP.length;
export function walkPath(s, out = {}) {
  let r = ((s % LOOP.length) + LOOP.length) % LOOP.length;
  for (const g of LOOP.segs) {
    if (r <= g.L) { const f = r / g.L; out.x = g.a[0] + (g.b[0] - g.a[0]) * f; out.z = g.a[1] + (g.b[1] - g.a[1]) * f; out.h = g.h; return out; }
    r -= g.L;
  }
  const g = LOOP.segs[0]; out.x = g.a[0]; out.z = g.a[1]; out.h = g.h;
  return out;
}

// A small seeded random (mulberry32), so the hangar is the same every time.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CLAD_TILE = 3.2, FLOOR_TILE = 15, HATCH_TILE = 1.6;

export function createHangar(THREE, { maxAnisotropy = 4 } = {}) {
  const H = HANGAR, rand = rng(5101);
  const col = (hex) => new THREE.Color(hex);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const ZAX = new THREE.Vector3(0, 0, 1);

  // ---- merged geometry, one per material ----
  class Acc {
    constructor(uvFn = null) { this.p = []; this.n = []; this.c = []; this.uv = []; this.uvFn = uvFn; }
    add(geo, m, color) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      g.applyMatrix4(m);
      const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv?.array;
      for (let i = 0, k = 0; i < p.length; i += 3, k += 2) {
        this.p.push(p[i], p[i + 1], p[i + 2]); this.n.push(n[i], n[i + 1], n[i + 2]); this.c.push(color.r, color.g, color.b);
        if (this.uvFn) { const w = this.uvFn(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2]); this.uv.push(w[0], w[1]); }
        else if (uv) this.uv.push(uv[k], uv[k + 1]);
      }
      g.dispose();
    }
    // A flat quad from its centre, two unit directions (right, up) and its size; uv a rect [u0, v0, u1, v1].
    quad(c, r, u, w, h, color, uv = [0, 0, 1, 1]) {
      const n = new THREE.Vector3().crossVectors(r, u).normalize();
      const at = (sx, sy) => [c.x + r.x * sx * w / 2 + u.x * sy * h / 2, c.y + r.y * sx * w / 2 + u.y * sy * h / 2, c.z + r.z * sx * w / 2 + u.z * sy * h / 2];
      const P = [at(-1, -1), at(1, -1), at(1, 1), at(-1, -1), at(1, 1), at(-1, 1)];
      const T = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
      for (let i = 0; i < 6; i++) {
        this.p.push(...P[i]); this.n.push(n.x, n.y, n.z); this.c.push(color.r, color.g, color.b);
        this.uv.push(...(this.uvFn ? this.uvFn(P[i][0], P[i][1], P[i][2], n.x, n.y, n.z) : T[i]));
      }
    }
    mesh(material) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.matrixAutoUpdate = false;
      return m;
    }
  }
  const wallUv = (x, y, z, nx, ny, nz) => (Math.abs(nx) > 0.5 ? [z / CLAD_TILE, y / CLAD_TILE] : Math.abs(nz) > 0.5 ? [x / CLAD_TILE, y / CLAD_TILE] : [z / CLAD_TILE, x / CLAD_TILE]);
  const floorUv = (x, y, z) => [x / FLOOR_TILE, -z / FLOOR_TILE];
  const hatchUv = (x, y, z, nx, ny, nz) => (Math.abs(ny) > 0.5 ? [(x + z) / HATCH_TILE, (x - z) / HATCH_TILE] : [(x + y) / HATCH_TILE, (y - x) / HATCH_TILE]);
  const A = {
    struct: new Acc(), clad: new Acc(wallUv), floor: new Acc(floorUv), mark: new Acc(), hatch: new Acc(hatchUv),
    decal: new Acc(), glow: new Acc(), out: new Acc(),
  };
  function box(acc, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    E.set(rx, ry, rz); Q.setFromEuler(E); M.compose(V.set(x, y, z), Q, ONE);
    acc.add(new THREE.BoxGeometry(sx, sy, sz), M, color);
  }
  // A box from a to b (its length along the line), w × h across.
  function beam(acc, ax, ay, az, bx, by, bz, w, h, color) {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az), L = d.length();
    Q.setFromUnitVectors(ZAX, d.normalize()); M.compose(V.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), Q, ONE);
    acc.add(new THREE.BoxGeometry(w, h, L), M, color);
  }
  function cyl(acc, x, y, z, r, h, color, { segs = 12, rx = 0, rz = 0, r2 = r } = {}) {
    E.set(rx, 0, rz); Q.setFromEuler(E); M.compose(V.set(x, y, z), Q, ONE);
    acc.add(new THREE.CylinderGeometry(r2, r, h, segs), M, color);
  }
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const RX = v3(1, 0, 0), RNX = v3(-1, 0, 0), RZ = v3(0, 0, 1), RNZ = v3(0, 0, -1), UP = v3(0, 1, 0);

  // ---- the textures ----
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const texOf = (c, repeat) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAnisotropy;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  };
  // Corrugated sheeting: a trapezoid rib every 0.2 m, a lap and its fixings at the tile's edge.
  const cladC = canvas(256, 256); {
    const g = cladC.getContext('2d');
    for (let x = 0; x < 256; x++) {
      const f = (x % 16) / 16;
      const s = f < 0.3 ? 0.80 : f < 0.45 ? 0.80 + (f - 0.3) / 0.15 * 0.2 : f < 0.8 ? 1.0 : 1.0 - (f - 0.8) / 0.2 * 0.2;
      const v = Math.round(s * 236); g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(x, 0, 1, 256);
    }
    g.fillStyle = 'rgba(40,44,50,0.35)'; g.fillRect(0, 0, 256, 3);
    g.fillStyle = 'rgba(60,64,70,0.5)';
    for (let x = 6; x < 256; x += 32) { g.fillRect(x, 10, 3, 3); g.fillRect(x, 136, 3, 3); }
  }
  // Epoxy floor: light grey, mottled, saw-cut joints every 7.5 m.
  const floorC = canvas(1024, 1024); {
    const g = floorC.getContext('2d');
    g.fillStyle = '#a2a6a5'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * 1024, y = rand() * 1024, r = 4 + rand() * 40, l = rand() < 0.5;
      g.fillStyle = l ? 'rgba(255,255,255,0.02)' : 'rgba(40,40,40,0.02)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 140; i++) {   // scuffs and tyre streaks
      const x = rand() * 1024, y = rand() * 1024, len = 40 + rand() * 220;
      g.strokeStyle = 'rgba(30,30,30,0.05)'; g.lineWidth = 2 + rand() * 6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 30, y + len); g.stroke();
    }
    g.fillStyle = '#7f8483';
    for (const p of [0, 511]) { g.fillRect(p, 0, 2, 1024); g.fillRect(0, p, 1024, 2); }
  }
  // Keep-clear hatching: yellow and black at 45°.
  const hatchC = canvas(128, 128); {
    const g = hatchC.getContext('2d');
    g.fillStyle = '#e8b81f'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1d1d1b';
    for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64 + 32, 0); g.lineTo(k * 64 + 32 + 128, 128); g.lineTo(k * 64 + 128, 128); g.closePath(); g.fill(); }
  }
  // The decals: signs, the floor's lettering, the clock. Regions in pixels of a 2048 × 1024 atlas.
  const AW = 2048, AH = 1024, atlasC = canvas(AW, AH);
  const R = {};
  {
    const g = atlasC.getContext('2d');
    const LAT = '"Helvetica Neue", Arial, "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif';
    const region = (k, x, y, w, h) => { R[k] = [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH]; return [x, y, w, h]; };
    const text = (t, x, y, size, color, align = 'center', weight = 'bold') => { g.font = `${weight} ${size}px ${LAT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); };
    const rr = (x, y, w, h, r, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill(); };
    // The company's sign: the atom and the name.
    let [x, y, w, h] = region('sign', 0, 0, 2048, 400);
    rr(x + 8, y + 8, w - 16, h - 16, 24, '#f4f6f7');
    g.lineWidth = 16; g.strokeStyle = '#1e8fe0';
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) { g.save(); g.translate(210, 200); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 150, 52, 0, 0, Math.PI * 2); g.stroke(); g.restore(); }
    g.fillStyle = '#6fd93a'; g.beginPath(); g.arc(210, 200, 34, 0, Math.PI * 2); g.fill();
    text('NUCLEAR AIRLINES', 1180, 150, 168, '#13243d');
    text('ENGINEERING  ·  HANGAR 1  ·  격납고 1', 1180, 300, 92, '#1e8fe0', 'center', '600');
    // The stop bars' type names, in floor yellow.
    const stops = [['A321', 'a321neo'], ['787', 'b787-9'], ['777', 'b777-300er']];
    stops.forEach(([t, id], i) => { [x, y, w, h] = region('stop-' + id, i * 256, 400, 256, 128); text(t, x + w / 2, y + h / 2 + 4, 104, '#efc024'); });
    [x, y, w, h] = region('keepclear', 768, 400, 1280, 128);
    text('HANGAR DOOR  ·  KEEP CLEAR', x + w / 2, y + h / 2 + 4, 92, '#efc024');
    // Safety signs.
    [x, y, w, h] = region('exit', 0, 560, 512, 144);
    rr(x + 4, y + 4, w - 8, h - 8, 10, '#0f8a3c'); text('비상구  EXIT', x + w / 2, y + h / 2 + 2, 70, '#ffffff');
    [x, y, w, h] = region('fire', 512, 560, 512, 144);
    rr(x + 4, y + 4, w - 8, h - 8, 10, '#c62a22'); text('소화기  FIRE', x + w / 2, y + h / 2 + 2, 70, '#ffffff');
    [x, y, w, h] = region('ears', 1024, 560, 512, 144);
    rr(x + 4, y + 4, w - 8, h - 8, 10, '#1d5fae'); text('HEARING PROTECTION', x + w / 2, y + h / 2 - 22, 44, '#ffffff'); text('귀마개 착용', x + w / 2, y + h / 2 + 30, 44, '#ffffff');
    [x, y, w, h] = region('smoke', 1536, 560, 512, 144);
    rr(x + 4, y + 4, w - 8, h - 8, 10, '#ffffff'); g.lineWidth = 10; g.strokeStyle = '#c62a22';
    g.beginPath(); g.arc(x + 80, y + h / 2, 52, 0, Math.PI * 2); g.moveTo(x + 43, y + h / 2 - 37); g.lineTo(x + 117, y + h / 2 + 37); g.stroke();
    text('금연  NO SMOKING', x + 300, y + h / 2 + 2, 54, '#c62a22');
    // The clock, at the time the hangar was built (Korea's).
    [x, y, w, h] = region('clock', 0, 720, 256, 256);
    g.fillStyle = '#f7f7f5'; g.beginPath(); g.arc(128, 848, 120, 0, Math.PI * 2); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#26282b'; g.stroke();
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.lineWidth = k % 3 ? 5 : 9; g.beginPath(); g.moveTo(128 + Math.sin(a) * 96, 848 - Math.cos(a) * 96); g.lineTo(128 + Math.sin(a) * 110, 848 - Math.cos(a) * 110); g.stroke(); }
    const now = new Date(Date.now() + 9 * 3600e3), hr = now.getUTCHours() % 12 + now.getUTCMinutes() / 60, mn = now.getUTCMinutes();
    const hand = (a, len, wid) => { g.lineWidth = wid; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 848); g.lineTo(128 + Math.sin(a) * len, 848 - Math.cos(a) * len); g.stroke(); };
    hand(hr * Math.PI / 6, 60, 12); hand(mn * Math.PI / 30, 92, 7);
    [x, y, w, h] = region('walk', 256, 720, 768, 128);
    text('WALKWAY  ·  보행로', x + w / 2, y + h / 2 + 4, 76, '#f4f6f4');
    [x, y, w, h] = region('speed', 1024, 720, 512, 256);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + 256, y + 128, 120, 0, Math.PI * 2); g.fill();
    g.lineWidth = 22; g.strokeStyle = '#c62a22'; g.stroke();
    text('5', x + 256, y + 116, 120, '#141414'); text('km/h', x + 256, y + 192, 40, '#141414');
  }

  // ---- the floor ----
  const floorCol = col('#ffffff');
  box(A.floor, 0, -0.1, (H.back + H.door + 4) / 2, 2 * H.halfX, 0.2, H.door + 4 - H.back, floorCol);
  // ---- the markings (a centimetre over the floor) ----
  const Y = 0.012, yellow = col('#e9b928'), white = col('#eef0ee'), green = col('#2e7b4c'), dark = col('#33373a');
  const flat = (acc, x0, x1, z0, z1, c, y = Y) => acc.quad(v3((x0 + x1) / 2, y, (z0 + z1) / 2), RX, RNZ, x1 - x0, z1 - z0, c);
  // The stand's lead-in line from the doors to the stop bars, and the stop bar of each type's nose wheel.
  const stopZ = ['a321neo', 'b787-9', 'b777-300er'].map((id) => [id, -(TYPES[id]?.geo.GEAR.nose?.x ?? 20)]);
  const zLead = Math.min(...stopZ.map((s) => s[1])) - 4;
  flat(A.mark, -0.15, 0.15, zLead, H.door + 3.8, yellow);
  for (const [id, z] of stopZ) {
    flat(A.mark, -2.5, 2.5, z - 0.15, z + 0.15, yellow);
    A.decal.quad(v3(5.2, Y + 0.004, z), RX, RNZ, 3.2, 1.6, col('#ffffff'), R['stop-' + id]);
  }
  // The parking area: a dashed yellow box round the aircraft.
  const dash = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / 3.5);
    for (let i = 0; i <= n; i++) {
      const f0 = (i * 3.5) / L, f1 = Math.min(1, (i * 3.5 + 2) / L);
      const ax = x0 + (x1 - x0) * f0, az = z0 + (z1 - z0) * f0, bx = x0 + (x1 - x0) * f1, bz = z0 + (z1 - z0) * f1;
      if (ax === bx) flat(A.mark, ax - 0.1, ax + 0.1, Math.min(az, bz), Math.max(az, bz), yellow); else flat(A.mark, Math.min(ax, bx), Math.max(ax, bx), az - 0.1, az + 0.1, yellow);
    }
  };
  const PX = 40, PZ0 = -50, PZ1 = 54;
  dash(-PX, PZ0, PX, PZ0); dash(-PX, PZ1, PX, PZ1); dash(-PX, PZ0, -PX, PZ1); dash(PX, PZ0, PX, PZ1);
  // Tie-down and earthing points on a 10 m grid inside it.
  for (let x = -30; x <= 30; x += 10) for (let z = -40; z <= 50; z += 10) if (x !== 0) flat(A.mark, x - 0.18, x + 0.18, z - 0.18, z + 0.18, dark, Y - 0.004);
  // Walkways: green with white edges, along the sides, the back and across in front of the doors.
  const lane = (x0, x1, z0, z1) => {
    const alongX = x1 - x0 > z1 - z0;
    flat(A.mark, x0, x1, z0, z1, green);
    if (alongX) { flat(A.mark, x0, x1, z0 - 0.12, z0, white); flat(A.mark, x0, x1, z1, z1 + 0.12, white); }
    else { flat(A.mark, x0 - 0.12, x0, z0, z1, white); flat(A.mark, x1, x1 + 0.12, z0, z1, white); }
  };
  const lw = 1.2, wx = H.walkX;
  lane(-wx - lw, wx + lw, H.walkBack - lw, H.walkBack + lw);
  lane(-wx - lw, wx + lw, H.walkFront - lw, H.walkFront + lw);
  lane(-wx - lw, -wx + lw, H.walkBack + lw + 0.12, H.walkFront - lw - 0.12);
  lane(wx - lw, wx + lw, H.walkBack + lw + 0.12, H.walkFront - lw - 0.12);
  for (const z of [-35, 0, 35]) for (const sx of [-1, 1]) A.decal.quad(v3(sx * wx, Y + 0.004, z), sx > 0 ? RZ : RNZ, sx > 0 ? RX : RNX, 7.2, 1.2, white, R.walk);
  A.decal.quad(v3(-36, Y + 0.004, H.walkBack), RX, RNZ, 7.2, 1.2, white, R.walk);
  // The doors' sweep: keep-clear hatching inside the tracks, and its lettering.
  A.hatch.quad(v3(0, Y, H.door - 1.6), RX, RNZ, 2 * H.doorHalf, 3.2, col('#ffffff'));
  A.decal.quad(v3(0, Y + 0.004, H.walkFront - 3.2), RX, RNZ, 20, 2, white, R.keepclear);
  // In front of the offices' doors.
  for (const x of [-30, 0, 30]) A.hatch.quad(v3(x, Y, -60.6), RX, RNZ, 3.2, 2.4, col('#ffffff'));
  // The door tracks: steel rails across the doorway, one per leaf.
  const tracks = [0, 1, 2, 3].map((k) => H.door + 0.3 + 0.8 * k);
  for (const z of tracks) flat(A.mark, -H.halfX, H.halfX, z - 0.06, z + 0.06, col('#5d6266'), Y + 0.002);

  // ---- the walls ----
  const plinth = col('#8f9396'), cladC0 = col('#dfe3e6'), steel = col('#4d5a68'), stripe = col('#e3b51f');
  for (const sx of [-1, 1]) {
    box(A.struct, sx * H.halfX, 1.25, 0, 0.4, 2.5, H.door - H.back, plinth);
    box(A.struct, sx * (H.halfX - 0.21), 2.5, 0, 0.04, 0.16, H.door - H.back, stripe);
    box(A.clad, sx * H.halfX, (2.5 + H.chordTop) / 2, 0, 0.3, H.chordTop - 2.5, H.door - H.back, cladC0);
  }
  box(A.struct, 0, 1.25, H.back, 2 * H.halfX, 2.5, 0.4, plinth);
  box(A.clad, 0, (2.5 + H.chordTop) / 2, H.back, 2 * H.halfX, H.chordTop - 2.5, 0.3, cladC0);
  // The gables above the walls' tops, up to the roof's ridge.
  for (const z of [H.back, H.door]) {
    const n = z < 0 ? RZ : RNZ;   // the door side's gable is over the header, in the wall's plane at door + 3.4
    for (const sx of [-1, 1]) {
      // a triangle as a quad squeezed to a point at the ridge: two triangles per half
      const x0 = 0, x1 = sx * H.halfX, y0 = H.chordTop, y1 = H.ridge;
      const P = [[x0, y0], [x1, y0], [x0, y1]];
      const nrm = n.clone().multiplyScalar(1);
      for (const [px, py] of P) { A.clad.p.push(px, py, z < 0 ? z + 0.15 : z + 3.25); A.clad.n.push(nrm.x, nrm.y, nrm.z); A.clad.c.push(cladC0.r, cladC0.g, cladC0.b); A.clad.uv.push(px / CLAD_TILE, py / CLAD_TILE); }
    }
  }
  // The door wall: the pockets at either side, the header over the doorway and the wall above it.
  for (const sx of [-1, 1]) {
    box(A.struct, sx * (H.halfX + H.doorHalf) / 2, 1.25, H.door + 3.4, H.halfX - H.doorHalf, 2.5, 0.4, plinth);
    box(A.clad, sx * (H.halfX + H.doorHalf) / 2, (2.5 + H.chordTop) / 2, H.door + 3.4, H.halfX - H.doorHalf, H.chordTop - 2.5, 0.3, cladC0);
    box(A.clad, sx * H.halfX, (2.5 + H.chordTop) / 2, H.door + 1.7, 0.3, H.chordTop - 2.5, 3.4, cladC0);
    box(A.struct, sx * H.halfX, 1.25, H.door + 1.7, 0.4, 2.5, 3.4, plinth);
  }
  const header = col('#5f6871');
  box(A.struct, 0, (H.doorH + 0.3 + H.eave) / 2, H.door + 1.7, 2 * H.doorHalf, H.eave - H.doorH - 0.3, 3.6, header);
  box(A.struct, 0, H.doorH + 0.2, H.door + 1.7, 2 * H.doorHalf, 0.25, 3.7, col('#e3b51f'));
  for (let x = -H.doorHalf + 2.5; x < H.doorHalf; x += 5) box(A.struct, x, (H.doorH + 0.3 + H.eave) / 2, H.door - 0.12, 0.25, H.eave - H.doorH - 0.4, 0.14, col('#7d868f'));
  box(A.struct, 0, H.eave - 0.25, H.door - 0.12, 2 * H.doorHalf, 0.3, 0.16, col('#7d868f'));
  box(A.clad, 0, (H.eave + H.chordTop) / 2, H.door + 3.4, 2 * H.halfX, H.chordTop - H.eave, 0.3, cladC0);
  for (const x of [-45, -15, 15, 45]) { box(A.glow, x, H.doorH - 0.15, H.door - 0.15, 0.5, 0.35, 0.3, col('#ffb21c')); box(A.struct, x, H.doorH + 0.05, H.door - 0.1, 0.7, 0.12, 0.4, header); }

  // The door leaves: four a side on their own tracks, slid back to leave the middle open.
  const leafW = 15, leafC = col('#c7cdd2'), ribC = col('#9aa3ab'), edgeC = col('#6b7680');
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const cx = sx * (H.open + leafW / 2 + k * (H.halfX - H.open - leafW) / 3), z = tracks[k];
      box(A.struct, cx, 0.2 + H.doorH / 2, z, leafW, H.doorH, 0.5, leafC);
      for (let y = 1.6; y < H.doorH; y += 1.55) box(A.struct, cx, 0.2 + y, z - 0.29, leafW - 0.5, 0.1, 0.1, ribC);
      for (const ex of [-1, 1]) box(A.struct, cx + ex * (leafW / 2 - 0.15), 0.2 + H.doorH / 2, z - 0.28, 0.3, H.doorH, 0.12, edgeC);
      box(A.glow, cx, 12.75, z - 0.27, leafW - 0.8, 1.4, 0.05, col('#e9f2f8'));   // the daylight through its vision panels
      box(A.struct, cx, 0.12, z, leafW, 0.24, 0.6, col('#2b2f33'));                   // the bottom rollers' housing
      if (k === 0) A.hatch.quad(v3(cx - sx * (leafW / 2 - 0.4), 0.2 + H.doorH / 2, z - 0.36), RNX, UP, 0.8, H.doorH - 0.2, col('#ffffff'));
      if (k === 1) box(A.struct, cx + sx * 3, 1.35, z - 0.3, 1.2, 2.3, 0.08, col('#39424b'));   // a wicket door
    }
  }

  // ---- the frames: columns along the walls, knee braces, the roof trusses ----
  const top = (x) => H.chordTop + (H.ridge - H.chordTop) * (1 - Math.abs(x) / H.halfX);
  const trussC = col('#c3c9cf'), colC = steel;
  const iBeam = (x, z, along) => {   // an I-section column, its web across `along`
    const fl = 0.55, dp = 0.8;
    if (along === 'x') { box(A.struct, x, H.eave / 2, z - dp / 2 + 0.04, fl, H.eave, 0.08, colC); box(A.struct, x, H.eave / 2, z + dp / 2 - 0.04, fl, H.eave, 0.08, colC); box(A.struct, x, H.eave / 2, z, 0.05, H.eave, dp, colC); }
    else { box(A.struct, x - dp / 2 + 0.04, H.eave / 2, z, 0.08, H.eave, fl, colC); box(A.struct, x + dp / 2 - 0.04, H.eave / 2, z, 0.08, H.eave, fl, colC); box(A.struct, x, H.eave / 2, z, dp, H.eave, 0.05, colC); }
  };
  for (let z = H.back; z <= H.door + 0.01; z += 10) {
    for (const sx of [-1, 1]) {
      iBeam(sx * (H.halfX - 0.6), z, 'z');
      beam(A.struct, sx * (H.halfX - 0.6), H.eave - 4.5, z, sx * (H.halfX - 5), H.eave, z, 0.25, 0.25, colC);
    }
    // The truss: bottom chord, a pitched top chord, verticals every 7.5 m and diagonals between them.
    beam(A.struct, -H.halfX, H.eave, z, H.halfX, H.eave, z, 0.35, 0.45, trussC);
    beam(A.struct, -H.halfX, top(-H.halfX), z, 0, H.ridge, z, 0.35, 0.45, trussC);
    beam(A.struct, 0, H.ridge, z, H.halfX, top(H.halfX), z, 0.35, 0.45, trussC);
    for (let x = -H.halfX + 7.5, i = 0; x < H.halfX - 1; x += 7.5, i++) {
      beam(A.struct, x, H.eave, z, x, top(x), z, 0.18, 0.18, trussC);
      const x1 = x + 7.5;
      if (x1 <= H.halfX) {
        const up = (x < 0) === (i % 2 === 0);
        if (up) beam(A.struct, x, H.eave, z, x1, top(x1), z, 0.16, 0.16, trussC); else beam(A.struct, x, top(x), z, x1, H.eave, z, 0.16, 0.16, trussC);
      }
    }
  }
  for (let x = -60; x <= 60; x += 15) iBeam(x, H.back + 0.6, 'x');
  // Purlins on the top chords, the roof deck above them, skylights in it.
  for (let x = -H.halfX; x <= H.halfX + 0.01; x += 7.5) beam(A.struct, x, top(x) + 0.4, H.back, x, top(x) + 0.4, H.door + 3.4, 0.15, 0.35, trussC);
  const slope = Math.atan2(H.ridge - H.chordTop, H.halfX), deckHalf = Math.hypot(H.halfX, H.ridge - H.chordTop);
  for (const sx of [-1, 1]) {
    E.set(0, 0, -sx * slope); Q.setFromEuler(E);
    M.compose(V.set(sx * H.halfX / 2, (H.ridge + H.chordTop) / 2 + 0.75, (H.back + H.door + 3.4) / 2), Q, ONE);
    A.clad.add(new THREE.BoxGeometry(deckHalf, 0.2, H.door + 3.4 - H.back), M, col('#cfd6dc'));
    for (const xs of [22.5, 52.5]) {
      const x = sx * xs;
      M.compose(V.set(x, top(x) + 0.62, 0), Q, ONE);
      A.glow.add(new THREE.BoxGeometry(3.2, 0.05, 128), M, col('#eef5fb'));
    }
  }
  // High-bay lamps under the trusses, sprinkler mains, ventilation ducts down the sides.
  for (let z = H.back + 10; z < H.door; z += 10) for (let x = -60; x <= 60; x += 15) {
    beam(A.struct, x, H.eave, z, x, H.eave - 1.2, z, 0.04, 0.04, col('#30343a'));
    cyl(A.struct, x, H.eave - 1.35, z, 0.42, 0.3, col('#3a3f45'), { r2: 0.18 });
    cyl(A.glow, x, H.eave - 1.51, z, 0.38, 0.02, col('#fff9ec'));
  }
  for (const x of [-37.5, -7.5, 22.5]) cyl(A.struct, x, H.eave - 0.6, 0, 0.08, H.door - H.back, col('#b8322a'), { rx: Math.PI / 2, segs: 8 });
  for (const sx of [-1, 1]) {
    cyl(A.struct, sx * (H.halfX - 3), 19, -4, 0.7, H.door - H.back - 12, col('#b4bbc2'), { rx: Math.PI / 2, segs: 16 });
    for (let z = H.back + 6; z < H.door - 6; z += 12) beam(A.struct, sx * (H.halfX - 3), 19.7, z, sx * (H.halfX - 3), H.eave, z, 0.05, 0.05, col('#30343a'));
  }
  // Clerestory glazing high on the side walls.
  for (const sx of [-1, 1]) {
    box(A.glow, sx * (H.halfX - 0.17), 23.25, 0, 0.04, 4.5, H.door - H.back - 2, col('#dbe8f3'));
    for (let z = H.back + 2.5; z < H.door; z += 2.5) box(A.struct, sx * (H.halfX - 0.22), 23.25, z, 0.06, 4.6, 0.12, col('#59636d'));
  }

  // ---- the back: two storeys of offices and workshops, a mezzanine, stairs, the company's sign and a clock ----
  const ox = 48, oz0 = H.back, oz1 = H.back + 8, office = col('#87939e'), frame = col('#3b434b'), warm = col('#fff0cc');
  box(A.struct, 0, 4, (oz0 + oz1) / 2, 2 * ox, 8, oz1 - oz0, office);
  box(A.struct, 0, 4.0, oz1 + 0.02, 2 * ox, 0.3, 0.1, frame);
  for (const [y0, y1] of [[1.0, 2.7], [5.0, 6.7]]) {
    for (let x = -ox + 2; x < ox - 2; x += 3.2) {
      if (y0 < 2 && [-30, 0, 30].some((d) => Math.abs(x + 1.3 - d) < 2)) continue;
      box(A.glow, x + 1.3, (y0 + y1) / 2, oz1 + 0.03, 2.8, y1 - y0, 0.04, warm);
      box(A.struct, x + 2.85, (y0 + y1) / 2, oz1 + 0.06, 0.1, y1 - y0 + 0.2, 0.08, frame);
    }
  }
  for (const x of [-30, 0, 30]) box(A.struct, x, 1.2, oz1 + 0.04, 1.8, 2.4, 0.06, col('#2f363d'));
  box(A.struct, 0, 8.05, (oz0 + oz1) / 2, 2 * ox + 0.4, 0.2, oz1 - oz0 + 0.4, frame);
  for (let x = -ox; x <= ox; x += 2) beam(A.struct, x, 8.1, oz1 + 0.1, x, 9.2, oz1 + 0.1, 0.06, 0.06, stripe);
  beam(A.struct, -ox, 9.2, oz1 + 0.1, ox, 9.2, oz1 + 0.1, 0.07, 0.07, stripe);
  beam(A.struct, -ox, 8.65, oz1 + 0.1, ox, 8.65, oz1 + 0.1, 0.05, 0.05, stripe);
  for (let i = 0; i < 20; i++) box(A.struct, ox + 0.9 + i * 0.4, 8 - (i + 0.5) * 0.4, oz1 - 1.2, 0.4, 0.06, 1.4, col('#5b636b'));
  beam(A.struct, ox + 0.7, 8, oz1 - 0.45, ox + 8.7, 0, oz1 - 0.45, 0.08, 0.3, frame);
  beam(A.struct, ox + 0.7, 9.1, oz1 - 0.45, ox + 8.7, 1.1, oz1 - 0.45, 0.06, 0.06, stripe);
  A.decal.quad(v3(0, 16.5, H.back + 1.1), RX, UP, 46, 9, col('#ffffff'), R.sign);   // on the columns
  A.decal.quad(v3(32, 15.5, H.back + 0.2), RX, UP, 3.2, 3.2, col('#ffffff'), R.clock);
  for (const x of [-30, 30]) A.decal.quad(v3(x, 3.2, oz1 + 0.07), RX, UP, 2.4, 0.68, col('#ffffff'), R.ears);
  A.decal.quad(v3(0, 3.1, oz1 + 0.07), RX, UP, 2.4, 0.68, col('#ffffff'), R.smoke);

  // ---- along the walls: racking, benches, a spare engine, tyres, fire points, exits ----
  const upright = col('#2a5b9f'), rbeam = col('#e0701d');
  const goods = ['#b5895a', '#c49a66', '#3f72b8', '#7c8287', '#e6e5df', '#4a8f58'].map(col);
  function racks(sx, z0, z1) {
    const xi = sx * (H.halfX - 1.0), xo = sx * (H.halfX - 2.1);
    for (let z = z0; z <= z1 + 0.01; z += 3) for (const x of [xi, xo]) box(A.struct, x, 3.9, z, 0.1, 7.8, 0.1, upright);
    for (let z = z0; z < z1 - 0.01; z += 3) {
      for (const y of [0.15, 2.0, 3.85, 5.7, 7.55]) for (const x of [xi, xo]) box(A.struct, x, y, z + 1.5, 0.08, 0.14, 3, rbeam);
      for (const y of [0.22, 2.07, 3.92, 5.77]) {
        let zz = z + 0.15;
        while (zz < z + 2.85) {
          const w = 0.6 + rand() * 0.9, hh = 0.5 + rand() * 1.1;
          if (zz + w > z + 2.85) break;
          if (rand() < 0.85) box(A.struct, (xi + xo) / 2, y + 0.07 + hh / 2, zz + w / 2, 0.9 + rand() * 0.15, hh, w, goods[Math.floor(rand() * goods.length)]);
          zz += w + 0.08;
        }
      }
    }
  }
  racks(-1, -51, -15); racks(1, -12, 39);
  // Benches and tool chests on the left, with a pegboard over them.
  for (let z = -9; z <= 6; z += 3) {
    const x = -H.halfX + 1.0;
    box(A.struct, x, 0.92, z, 0.9, 0.06, 2.6, col('#9c7449'));
    for (const dz of [-1.2, 1.2]) box(A.struct, x, 0.45, z + dz, 0.8, 0.9, 0.06, col('#54595e'));
    box(A.struct, x - 0.2, 1.05, z - 0.6, 0.3, 0.18, 0.4, goods[Math.floor(rand() * 4)]);
    box(A.struct, -H.halfX + 0.25, 2.1, z, 0.05, 1.6, 2.7, col('#d9d6cc'));
    for (let t = 0; t < 5; t++) box(A.struct, -H.halfX + 0.3, 1.6 + rand() * 1.0, z - 1.1 + rand() * 2.2, 0.05, 0.2 + rand() * 0.3, 0.06, col('#3d4248'));
  }
  for (const z of [-11.5, 8.5]) { box(A.struct, -H.halfX + 1.0, 0.75, z, 0.7, 1.5, 1.2, col('#c0312a')); for (let d = 0; d < 5; d++) box(A.struct, -H.halfX + 1.36, 0.25 + d * 0.27, z, 0.02, 0.03, 1.0, col('#d9d9d9')); }
  // A spare engine on its transport stand, and a work platform beside it.
  {
    const ex = -66, ez = 24, cy = 2.35, yel = col('#e6b422');
    for (const dz of [-2.2, 2.2]) { box(A.struct, ex, 0.35, ez + dz, 3.4, 0.2, 0.3, yel); beam(A.struct, ex - 1.2, 0.45, ez + dz, ex, cy - 0.6, ez + dz, 0.18, 0.18, yel); beam(A.struct, ex + 1.2, 0.45, ez + dz, ex, cy - 0.6, ez + dz, 0.18, 0.18, yel); }
    for (const dx of [-1.5, 1.5]) beam(A.struct, ex + dx, 0.35, ez - 2.6, ex + dx, 0.35, ez + 2.6, 0.2, 0.2, yel);
    for (const dx of [-1.4, 1.4]) for (const dz of [-2.4, 2.4]) cyl(A.struct, ex + dx, 0.18, ez + dz, 0.18, 0.14, col('#1d1f21'), { rz: Math.PI / 2, segs: 10 });
    cyl(A.struct, ex, cy, ez, 1.75, 4.4, col('#d5d9dc'), { rx: Math.PI / 2, segs: 28, r2: 1.6 });
    cyl(A.struct, ex, cy, ez - 2.21, 1.5, 0.04, col('#22262a'), { rx: Math.PI / 2, segs: 28 });
    cyl(A.struct, ex, cy, ez - 2.25, 0.35, 0.3, col('#c9cdd1'), { rx: Math.PI / 2, segs: 12, r2: 0.05 });
    cyl(A.struct, ex, cy, ez + 2.9, 1.1, 1.4, col('#8a8f94'), { rx: Math.PI / 2, segs: 20, r2: 0.7 });
    const px = ex + 3.6;
    for (const dx of [-0.8, 0.8]) for (const dz of [-1.4, 1.4]) beam(A.struct, px + dx, 0, ez + dz, px + dx, 2.0, ez + dz, 0.08, 0.08, yel);
    box(A.struct, px, 2.0, ez, 1.8, 0.08, 3.0, col('#6b7178'));
    for (const dz of [-1.4, 1.4]) beam(A.struct, px - 0.8, 3.05, ez + dz, px + 0.8, 3.05, ez + dz, 0.06, 0.06, yel);
    beam(A.struct, px + 0.8, 3.05, ez - 1.4, px + 0.8, 3.05, ez + 1.4, 0.06, 0.06, yel);
    for (const dx of [-0.8, 0.8]) for (const dz of [-1.4, 1.4]) beam(A.struct, px + dx, 2.0, ez + dz, px + dx, 3.05, ez + dz, 0.05, 0.05, yel);
  }
  // Tyres stacked on the right, a nitrogen cart, a forklift by the racks, a tug by the doors.
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) cyl(A.struct, H.halfX - 1.7, 0.21 + k * 0.42, -34 + i * 1.45, 0.62, 0.4, col('#1f2224'), { segs: 18 });
  {
    const nx = H.halfX - 8.5, nz = -24;
    box(A.struct, nx, 0.5, nz, 1.2, 0.2, 2.2, col('#3b6e3f'));
    for (let b = 0; b < 3; b++) cyl(A.struct, nx, 1.3, nz - 0.7 + b * 0.7, 0.24, 1.5, col('#2f6b3a'), { segs: 12 });
    for (const dz of [-0.9, 0.9]) cyl(A.struct, nx, 0.25, nz + dz, 0.25, 1.3, col('#1d1f21'), { rz: Math.PI / 2, segs: 12 });
  }
  function forklift(x, z, h) {
    const o = col('#e07a1f'), blk = col('#1d1f21');
    const c = Math.cos(h), s = Math.sin(h), at = (dx, dz) => [x + dx * c + dz * s, z - dx * s + dz * c];
    let p = at(0, 0); box(A.struct, p[0], 0.85, p[1], 1.2, 1.0, 2.2, o, h);
    p = at(0, 0.5); box(A.struct, p[0], 2.0, p[1], 1.1, 0.08, 1.2, blk, h);
    for (const dx of [-0.5, 0.5]) { p = at(dx, 0.2); beam(A.struct, p[0], 1.35, p[1], p[0], 2.0, p[1], 0.06, 0.06, blk); p = at(dx, -0.9); beam(A.struct, p[0], 1.35, p[1], p[0], 2.0, p[1], 0.06, 0.06, blk); }
    p = at(0, -1.25); box(A.struct, p[0], 1.6, p[1], 0.9, 3.1, 0.12, blk, h);
    for (const dx of [-0.25, 0.25]) { p = at(dx, -1.9); box(A.struct, p[0], 0.12, p[1], 0.12, 0.05, 1.2, col('#8b9096'), h); }
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.7, 0.7]) { p = at(dx, dz); cyl(A.struct, p[0], 0.3, p[1], 0.3, 0.25, blk, { rz: Math.PI / 2, segs: 12 }); }
  }
  forklift(-H.halfX + 10, -40, Math.PI / 2);
  {
    const tx = 24, tz = 50, w = col('#f0f1ee'), blk = col('#1d1f21');
    box(A.struct, tx, 0.75, tz, 2.6, 0.9, 5.4, w);
    box(A.struct, tx, 1.25, tz, 2.62, 0.12, 5.42, col('#e3b51f'));
    box(A.struct, tx - 0.4, 1.75, tz + 1.4, 1.6, 1.1, 1.6, col('#4b6b88'));
    for (const dx of [-1.25, 1.25]) for (const dz of [-1.8, 1.8]) cyl(A.struct, tx + dx, 0.5, tz + dz, 0.5, 0.35, blk, { rz: Math.PI / 2, segs: 16 });
    beam(A.struct, tx, 0.5, tz - 2.7, tx, 0.5, tz - 5.6, 0.12, 0.12, col('#e3b51f'));
  }
  // Tool carts and chocks near the stand.
  for (const [x, z] of [[44, -6], [-44, 14], [38, 30]]) {
    box(A.struct, x, 0.85, z, 0.6, 0.9, 1.0, col('#c0312a'));
    for (let d = 0; d < 4; d++) box(A.struct, x + 0.31, 0.5 + d * 0.2, z, 0.02, 0.03, 0.8, col('#dcdcdc'));
  }
  // Fire points and exits on the columns and walls.
  for (let z = H.back + 10; z < H.door; z += 20) for (const sx of [-1, 1]) {
    const x = sx * (H.halfX - 0.35);
    cyl(A.struct, x, 0.62, z + 0.8, 0.1, 0.55, col('#c62a22'), { segs: 10 });
    A.decal.quad(v3(sx * (H.halfX - 0.22), 1.75, z + 0.8), sx > 0 ? RZ : RNZ, UP, 1.1, 0.31, col('#ffffff'), R.fire);
  }
  for (const z of [-40, 40]) for (const sx of [-1, 1]) {
    box(A.struct, sx * (H.halfX - 0.2), 1.15, z, 0.06, 2.3, 1.2, col('#353c43'));
    const n = sx > 0 ? RZ : RNZ;
    A.decal.quad(v3(sx * (H.halfX - 0.25), 2.75, z), n, UP, 1.2, 0.34, col('#ffffff'), R.exit);
  }
  for (const z of [-20, 20]) for (const sx of [-1, 1]) A.decal.quad(v3(sx * (H.halfX - 0.25), 4.2, z), sx > 0 ? RZ : RNZ, UP, 1.6, 0.45, col('#ffffff'), R.ears);
  for (const sx of [-1, 1]) A.decal.quad(v3(sx * (H.doorHalf + 7.5), 4.2, H.door + 3.18), RNX, UP, 1.8, 0.9, col('#ffffff'), R.speed);

  // ---- outside: the apron in the sun, the airport beyond ----
  const sunlit = col('#d6d3c9');
  A.out.quad(v3(0, -0.03, 440), RX, RNZ, 1800, 740, sunlit);
  A.out.quad(v3(0, 0.0, 74 + 60), RX, RNZ, 0.3, 120, col('#f0c43a'));
  for (let i = 0; i < 26; i++) {
    const x = -700 + i * 56 + rand() * 30, w = 30 + rand() * 60, h = 6 + rand() * 26, z = 380 + rand() * 120;
    box(A.out, x, h / 2, z, w, h, 20 + rand() * 30, col(rand() < 0.5 ? '#a9b7c4' : '#b6c2cc'));
  }
  box(A.out, 180, 22, 420, 5, 44, 5, col('#a2b0bd')); box(A.out, 180, 46, 420, 10, 5, 10, col('#8797a6'));

  // ---- the materials and meshes ----
  const cladTex = texOf(cladC, true), floorTex = texOf(floorC, true), hatchTex = texOf(hatchC, true), atlasTex = texOf(atlasC, false);
  const mats = {
    struct: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 }),
    clad: new THREE.MeshStandardMaterial({ vertexColors: true, map: cladTex, roughness: 0.62, metalness: 0.25, side: THREE.DoubleSide }),
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.0 }),
    mark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    hatch: new THREE.MeshStandardMaterial({ map: hatchTex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    decal: new THREE.MeshStandardMaterial({ map: atlasTex, transparent: true, alphaTest: 0.04, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    out: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
  const group = new THREE.Group();
  group.name = 'hangar';
  for (const k of Object.keys(A)) {
    const mesh = A[k].mesh(mats[k]);
    mesh.name = 'hangar-' + k;
    if (k === 'floor' || k === 'mark' || k === 'hatch' || k === 'decal') mesh.receiveShadow = true;
    if (k === 'decal') mesh.renderOrder = 2;
    group.add(mesh);
  }

  // ---- people ----
  const people = createPeople(THREE, rand);
  group.add(people.group);

  function update(t) { people.update(t); }
  function dispose() {
    group.traverse((o) => { o.geometry?.dispose?.(); });
    for (const m of Object.values(mats)) m.dispose();
    people.dispose();
    for (const t of [cladTex, floorTex, hatchTex, atlasTex]) t.dispose();
  }
  return { group, update, dispose, calls: Object.keys(A).length + people.calls };
}

// The people: instanced boxes and spheres, one instanced mesh per body part (six draw calls for all of them).
// Walkers go round the walkways' loop at their own pace; the rest stand at a bench, by the spare engine and by the tug.
function createPeople(THREE, rand) {
  const H = HANGAR;
  const walkers = [
    { s: 0, v: 1.35 }, { s: 70, v: 1.25 }, { s: 150, v: -1.4 }, { s: 205, v: 1.3 }, { s: 260, v: -1.2 },
    { s: 330, v: 1.45 }, { s: 395, v: -1.3 }, { s: 450, v: 1.2 }, { s: 488, v: 1.5 },
  ];
  const standers = [
    { x: -H.halfX + 2.0, z: -3.2, h: -Math.PI / 2 }, { x: -H.halfX + 2.1, z: 2.8, h: -Math.PI / 2 - 0.4 },
    { x: -62.2, z: 21.5, h: -Math.PI / 2 - 0.6 }, { x: 21.6, z: 46.5, h: 0.9 }, { x: 30.5, z: -60.0, h: Math.PI },
  ];
  const N = walkers.length + standers.length;
  const vests = ['#f26d1d', '#e9e23a', '#f26d1d', '#d9e43a', '#f08a24'], skin = ['#e0b48f', '#c99674', '#f0c9a6', '#b07a58'];
  const hats = ['#f2f2ee', '#f2cf2a', '#f2f2ee', '#2f6fd1'];
  const geo = {
    leg: new THREE.BoxGeometry(0.17, 0.86, 0.2).translate(0, -0.43, 0),
    torso: new THREE.BoxGeometry(0.46, 0.64, 0.27),
    arm: new THREE.BoxGeometry(0.12, 0.64, 0.13).translate(0, -0.32, 0),
    head: new THREE.SphereGeometry(0.115, 12, 8),
    hat: new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  const mk = (g, n) => { const m = new THREE.InstancedMesh(g, mat, n); m.frustumCulled = false; m.castShadow = false; return m; };
  const legs = mk(geo.leg, 2 * N), torsos = mk(geo.torso, N), arms = mk(geo.arm, 2 * N), heads = mk(geo.head, N), hatsM = mk(geo.hat, N);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const vest = vests[i % vests.length], trousers = i % 3 === 0 ? '#2b3440' : '#1f2a3a';
    torsos.setColorAt(i, c.set(vest)); heads.setColorAt(i, c.set(skin[Math.floor(rand() * skin.length)])); hatsM.setColorAt(i, c.set(hats[i % hats.length]));
    for (const k of [0, 1]) { legs.setColorAt(2 * i + k, c.set(trousers)); arms.setColorAt(2 * i + k, c.set(i % 2 ? '#3a4656' : vest)); }
  }
  for (const m of [legs, torsos, arms, heads, hatsM]) m.instanceColor.needsUpdate = true;
  const group = new THREE.Group();
  group.add(legs, torsos, arms, heads, hatsM);
  const base = new THREE.Matrix4(), part = new THREE.Matrix4(), rot = new THREE.Matrix4(), out = new THREE.Matrix4();
  const p = {};
  function place(i, x, z, h, phase, amp, t) {
    const bob = amp * 0.035 * Math.cos(2 * phase);
    base.makeRotationY(h).setPosition(x, bob, z);
    const swing = amp * 0.48 * Math.sin(phase), arm = amp * 0.38 * Math.sin(phase);
    const idle = (1 - amp) * 0.06 * Math.sin(t * 1.3 + i);
    for (const k of [0, 1]) {
      const sgn = k ? -1 : 1;
      part.makeTranslation(sgn * 0.11, 0.9, 0); rot.makeRotationX(sgn * swing); out.multiplyMatrices(base, part).multiply(rot); legs.setMatrixAt(2 * i + k, out);
      part.makeTranslation(sgn * 0.3, 1.47, 0); rot.makeRotationX(-sgn * arm + (1 - amp) * 0.25 * (k ? 1 : 0.4)); out.multiplyMatrices(base, part).multiply(rot); arms.setMatrixAt(2 * i + k, out);
    }
    part.makeTranslation(0, 1.21, 0); rot.makeRotationZ(idle * 0.3); out.multiplyMatrices(base, part).multiply(rot); torsos.setMatrixAt(i, out);
    part.makeTranslation(0, 1.66, 0.02); rot.makeRotationY(idle * 3); out.multiplyMatrices(base, part).multiply(rot); heads.setMatrixAt(i, out);
    part.makeTranslation(0, 1.7, 0.02); out.multiplyMatrices(base, part).multiply(rot); hatsM.setMatrixAt(i, out);
  }
  function update(t) {
    walkers.forEach((w, i) => {
      const s = w.s + w.v * t;
      walkPath(s, p);
      const h = p.h + (w.v < 0 ? Math.PI : 0);
      place(i, p.x, p.z, h, (s / 1.45) * Math.PI * 2 * Math.sign(w.v), 1, t);
    });
    standers.forEach((st, j) => place(walkers.length + j, st.x, st.z, st.h, 0, 0, t));
    for (const m of [legs, torsos, arms, heads, hatsM]) m.instanceMatrix.needsUpdate = true;
  }
  update(0);
  function dispose() { for (const g of Object.values(geo)) g.dispose(); mat.dispose(); for (const m of [legs, torsos, arms, heads, hatsM]) m.dispose?.(); }
  return { group, update, dispose, calls: 5, count: N };
}
