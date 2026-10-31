// Low-poly models for airport life: two parked airliners and four ground vehicles.
// Pure arrays (no three.js), so node can count triangles and check the dimensions.
//
// Model frame: x forward (nose), y left, z up, in metres; the origin is the nose tip (or
// the vehicle's front) at ground level. Every vertex has a `part` code the shaders use
// to colour it (see PART below); colours come from the livery, not the geometry.

export const PART = {
  FUSE: 0,      // fuselage: livery body colour, belly, cheatline, windows (in the shader)
  TAIL: 1,      // fin: tail colour and the tail pattern
  ENGINE: 2,    // nacelles
  WING: 3,      // wings and tailplane: light grey
  DARK: 4,      // gear, tyres, intakes, exhausts
  INTAKE: 5,    // fan face / exhaust: near black
  // vehicles
  BODY: 6, CAB: 7, GLASS: 8, TANK: 9, CARGO: 10, STRIPE: 11,
  LIP: 12,      // engine intake lip: an accent (Nuclear: hazard stripes)
};

// The parked types. Dimensions after the A321neo (44.5 m, 35.8 m span) and a generic
// twin widebody (A330-300 sized: 63.7 m, 60.3 m span). engineZ is the nacelle centre's height
// above the ground: the engines hang clearly below the wing (v0.1.2). `shortScale` shrinks the
// narrowbody's length to an A320's 37.6 m.
export const AIRLINER_TYPES = [
  {
    name: 'narrowbody', length: 44.5, radius: 2.0, zc: 3.9, span: 35.8, stabSpan: 12.5,
    wingRootX: 15.6, rootChord: 6.6, tipChord: 1.6, sweepDeg: 27, dihedralDeg: 5.5, wingZ: -1.05,
    engineY: 5.75, engineX: 11.4, engineLen: 4.9, engineR: 1.12, engineZ: 1.57,
    stabRootX: 37.6, stabRootChord: 3.8, stabTipChord: 1.5, stabSweepDeg: 32, stabZ: 1.0,
    finRootX: 34.6, finRootChord: 6.6, finTipChord: 2.4, finTop: 11.76, finSweepDeg: 38,
    noseGearX: 5.1, mainGearX: 20.3, mainGearY: 3.8, shortScale: 37.6 / 44.5, segs: 16,
  },
  {
    name: 'widebody', length: 63.7, radius: 2.82, zc: 5.7, span: 60.3, stabSpan: 19.4,
    wingRootX: 22.5, rootChord: 10.5, tipChord: 2.4, sweepDeg: 30, dihedralDeg: 5.5, wingZ: -1.8,
    engineY: 9.4, engineX: 18.0, engineLen: 7.0, engineR: 1.55, engineZ: 2.3,
    stabRootX: 54.0, stabRootChord: 5.6, stabTipChord: 2.1, stabSweepDeg: 32, stabZ: 1.4,
    finRootX: 49.5, finRootChord: 9.6, finTipChord: 3.4, finTop: 16.8, finSweepDeg: 40,
    noseGearX: 7.0, mainGearX: 30.0, mainGearY: 5.3, shortScale: 1, segs: 18,
  },
];
for (const T of AIRLINER_TYPES) {
  // Wing and tailplane extents along the fuselage (positive = metres behind the nose).
  const tipDx = (T.span / 2 - T.radius) * Math.tan(T.sweepDeg * Math.PI / 180);
  T.wingX0 = T.wingRootX; T.wingX1 = T.wingRootX + tipDx + T.tipChord;
  const sDx = (T.stabSpan / 2) * Math.tan(T.stabSweepDeg * Math.PI / 180);
  T.stabX0 = T.stabRootX; T.stabX1 = Math.min(T.stabRootX + sDx + T.stabTipChord, T.length + 1);
}

// ------------------------------------------------------------------ builder

class Mesh {
  constructor() { this.P = []; this.N = []; this.K = []; this.I = []; }
  get count() { return this.P.length / 3; }
  vert(p, n, part) {
    this.P.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.N.push(n[0] / l, n[1] / l, n[2] / l);
    this.K.push(part);
    return this.count - 1;
  }
  // A flat quad a b c d (counter-clockwise seen from outside).
  quad(a, b, c, d, part) {
    const n = cross(sub(b, a), sub(d, a));
    const n2 = cross(sub(c, b), sub(a, b));
    const nn = [n[0] + n2[0], n[1] + n2[1], n[2] + n2[2]];
    const i = this.vert(a, nn, part), j = this.vert(b, nn, part), k = this.vert(c, nn, part), l = this.vert(d, nn, part);
    this.I.push(i, j, k, i, k, l);
  }
  // A hexahedron from 8 corners: 0-3 one face, 4-7 the opposite one (same order).
  // Faces are wound outwards by checking against the centroid.
  hexa(C, part, { skip = [] } = {}) {
    const c = [0, 0, 0];
    for (const p of C) { c[0] += p[0] / 8; c[1] += p[1] / 8; c[2] += p[2] / 8; }
    const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    faces.forEach((f, fi) => {
      if (skip.includes(fi)) return;
      let [a, b, cc, d] = f.map((i) => C[i]);
      const n = cross(sub(b, a), sub(d, a));
      const m = [(a[0] + cc[0]) / 2 - c[0], (a[1] + cc[1]) / 2 - c[1], (a[2] + cc[2]) / 2 - c[2]];
      if (dot(n, m) < 0) [b, d] = [d, b];
      this.quad(a, b, cc, d, part);
    });
  }
  box(cx, cy, cz, lx, ly, lz, part) {
    const x0 = cx - lx / 2, x1 = cx + lx / 2, y0 = cy - ly / 2, y1 = cy + ly / 2, z0 = cz - lz / 2, z1 = cz + lz / 2;
    this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], part);
  }
  // A body of revolution along x: sections [{ x, z, ry, rz }] with `segs` around.
  // Smooth normals, tilted by the taper. part may be a function of the section index.
  lathe(sections, segs, part, { cy = 0 } = {}) {
    const base = this.count;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i], a = sections[Math.max(i - 1, 0)], b = sections[Math.min(i + 1, sections.length - 1)];
      const dx = b.x - a.x || 1e-3;
      const dr = ((b.ry + b.rz) - (a.ry + a.rz)) / 2 / dx;
      const k = typeof part === 'function' ? part(i) : part;
      for (let j = 0; j < segs; j++) {
        const t = (j / segs) * Math.PI * 2;
        const cs = Math.cos(t), sn = Math.sin(t);
        const p = [s.x, cy + s.ry * cs, s.z + s.rz * sn];
        const ry = s.ry || 1, rz = s.rz || 1;
        const rl = Math.hypot(cs * rz, sn * ry) || 1;
        const n = [-dr, (cs * rz) / rl, (sn * ry) / rl];
        if (s.ry < 1e-3 && s.rz < 1e-3) { n[0] = Math.sign(-dr || 1) ; n[1] = 0; n[2] = 0; }
        this.vert(p, n, k);
      }
    }
    for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = base + i * segs + j, b = base + i * segs + (j + 1) % segs;
      const c = a + segs, d = b + segs;
      // Outward winding for sections running towards -x... decided by the x order.
      if (sections[i + 1].x < sections[i].x) this.I.push(a, b, d, a, d, c);
      else this.I.push(a, d, b, a, c, d);
    }
  }
  // A flat cap disc at a section (fan), facing `dir` (+1 = +x).
  disc(x, z, ry, rz, segs, dir, part, cy = 0) {
    const c = this.vert([x, cy, z], [dir, 0, 0], part);
    const first = this.count;
    for (let j = 0; j < segs; j++) {
      const t = (j / segs) * Math.PI * 2;
      this.vert([x, cy + ry * Math.cos(t), z + rz * Math.sin(t)], [dir, 0, 0], part);
    }
    for (let j = 0; j < segs; j++) {
      const a = first + j, b = first + (j + 1) % segs;
      if (dir > 0) this.I.push(c, b, a); else this.I.push(c, a, b);
    }
  }
  result() {
    return {
      position: new Float32Array(this.P),
      normal: new Float32Array(this.N),
      part: new Float32Array(this.K),
      index: this.count > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I),
      triangles: this.I.length / 3,
    };
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const DEG = Math.PI / 180;

// A tapered, swept slab (wing, tailplane, fin) from a root and a tip chord line.
// root/tip: { le: [x, y, z], chord, t (thickness) }; `up` = which axis is thickness.
function slab(m, root, tip, part, thickAxis = 2) {
  const corners = [];
  for (const s of [root, tip]) {
    const le = s.le, te = [le[0] - s.chord, le[1], le[2]];
    // Leading edge, a thick point at 30%, trailing edge: kept as a box for low poly.
    const off = [0, 0, 0]; off[thickAxis] = s.t / 2;
    corners.push([le[0] - off[0], le[1] - off[1], le[2] - off[2]], [te[0] - off[0], te[1] - off[1], te[2] - off[2]]);
    corners.push([le[0] + off[0], le[1] + off[1], le[2] + off[2]], [te[0] + off[0], te[1] + off[1], te[2] + off[2]]);
  }
  // corners: root lo LE, root lo TE, root hi LE, root hi TE, tip lo LE, tip lo TE, tip hi LE, tip hi TE
  const [rl, rt, rL, rT, tl, tt, tL, tT] = corners;
  m.hexa([rl, rt, tt, tl, rL, rT, tT, tL], part);
}

// ------------------------------------------------------------------ airliners

// x in the builder runs forward, so "metres behind the nose" d maps to x = -d.
export function buildAirliner(T) {
  const m = new Mesh();
  const L = T.length, R = T.radius, zc = T.zc, segs = T.segs;
  // Fuselage profile: [d behind nose, radius share, centre z offset (share of R)].
  const prof = [
    [0, 0.0, -0.30], [0.35, 0.30, -0.28], [1.0, 0.52, -0.24], [2.0, 0.70, -0.18], [3.4, 0.85, -0.10],
    [5.2, 0.95, -0.04], [7.6, 1.0, 0], [L * 0.5, 1.0, 0], [L * 0.72, 1.0, 0.02],
    [L * 0.82, 0.86, 0.14], [L * 0.90, 0.62, 0.34], [L * 0.96, 0.38, 0.52], [L, 0.14, 0.62],
  ];
  const secs = prof.map(([d, r, oz]) => ({ x: -d, z: zc + oz * R, ry: R * r, rz: R * r * 1.04 }));
  m.lathe(secs, segs, PART.FUSE);
  m.disc(-L, secs[secs.length - 1].z, secs[secs.length - 1].ry, secs[secs.length - 1].rz, 6, -1, PART.DARK);

  // Wings (each side), with a sharklet.
  const tanS = Math.tan(T.sweepDeg * DEG), dih = Math.tan(T.dihedralDeg * DEG);
  for (const side of [1, -1]) {
    const y0 = side * R * 0.85, y1 = side * T.span / 2;
    const half = T.span / 2 - R * 0.85;
    const zRoot = zc + T.wingZ;
    const rootT = T.rootChord * 0.13, tipT = T.tipChord * 0.11;
    // Inner wing (to the kink at 35%) and outer wing: two slabs, so the trailing edge kinks.
    const kink = 0.36;
    const leK = [-(T.wingRootX + half * kink * tanS), side * (R * 0.85 + half * kink), zRoot + half * kink * dih];
    const chordK = T.rootChord - (T.rootChord - T.tipChord) * 0.62;
    const leT = [-(T.wingRootX + half * tanS), y1, zRoot + half * dih];
    slab(m, { le: [-T.wingRootX, y0, zRoot], chord: T.rootChord, t: rootT }, { le: leK, chord: chordK, t: rootT * 0.7 }, PART.WING);
    slab(m, { le: leK, chord: chordK, t: rootT * 0.7 }, { le: leT, chord: T.tipChord, t: tipT }, PART.WING);
    // Sharklet: a small upturned fin at the tip.
    const shH = T.span * 0.065;
    slab(m, { le: [leT[0], y1, leT[2]], chord: T.tipChord, t: 0.12 },
      { le: [leT[0] - shH * 0.6, y1 + side * 0.25, leT[2] + shH], chord: T.tipChord * 0.4, t: 0.08 }, PART.TAIL, 1);
    // Engine: nacelle lathe, a dark intake face and exhaust, and a pylon up to the wing.
    const ey = side * T.engineY, ez = T.engineZ, r = T.engineR, x0 = -T.engineX, len = T.engineLen;
    const nac = [
      { x: x0, z: ez, ry: r * 0.92, rz: r * 0.92 }, { x: x0 - 0.25, z: ez, ry: r, rz: r }, { x: x0 - 0.6, z: ez, ry: r, rz: r },
      { x: x0 - len * 0.55, z: ez, ry: r * 0.98, rz: r * 0.98 }, { x: x0 - len * 0.88, z: ez, ry: r * 0.72, rz: r * 0.72 },
      { x: x0 - len, z: ez + r * 0.05, ry: r * 0.42, rz: r * 0.42 },
    ];
    m.lathe(nac.slice(0, 3), 14, PART.LIP, { cy: ey });     // the intake lip band
    m.lathe(nac.slice(2), 14, PART.ENGINE, { cy: ey });
    m.disc(x0 - 0.15, ez, r * 0.86, r * 0.86, 14, 1, PART.INTAKE, ey);
    m.disc(x0 - len, ez + r * 0.05, r * 0.42, r * 0.42, 8, -1, PART.INTAKE, ey);
    const wz = zRoot + (Math.abs(ey) - R * 0.85) * dih;
    const pw = 0.35;
    m.hexa([
      [x0 - len * 0.15, ey - pw, ez + r * 0.7], [x0 - len * 0.95, ey - pw, ez + r * 0.5], [x0 - len * 0.95, ey + pw, ez + r * 0.5], [x0 - len * 0.15, ey + pw, ez + r * 0.7],
      [x0 - len * 0.45, ey - pw, wz], [x0 - len * 1.25, ey - pw, wz], [x0 - len * 1.25, ey + pw, wz], [x0 - len * 0.45, ey + pw, wz],
    ], PART.WING);

    // Tailplane.
    const sHalf = T.stabSpan / 2, sTan = Math.tan(T.stabSweepDeg * DEG);
    const sz = zc + T.stabZ;
    slab(m, { le: [-T.stabRootX, side * 0.6, sz], chord: T.stabRootChord, t: 0.45 },
      { le: [-(T.stabRootX + sHalf * sTan), side * sHalf, sz + sHalf * 0.1], chord: T.stabTipChord, t: 0.15 }, PART.WING);

    // Main gear: a strut and a pair of wheels.
    const gy = side * T.mainGearY, gx = -T.mainGearX, wr = T.zc > 5 ? 0.62 : 0.57;
    m.box(gx, gy, (zRoot - 0.5 + wr) / 2 + 0.2, 0.35, 0.35, zRoot - 0.5 - wr, PART.DARK);
    for (const dx of T.zc > 5 ? [-0.75, 0.75] : [0]) {
      m.box(gx + dx, gy + 0.45, wr, wr * 2, 0.4, wr * 2, PART.DARK);
      m.box(gx + dx, gy - 0.45, wr, wr * 2, 0.4, wr * 2, PART.DARK);
    }
  }
  // Fin: root on the tail cone's top, tip at the published height.
  const finRootZ = zc + R * 0.55;
  const fTan = Math.tan(T.finSweepDeg * DEG), fH = T.finTop - finRootZ;
  slab(m, { le: [-T.finRootX, 0, finRootZ - 0.4], chord: T.finRootChord, t: 0.55 },
    { le: [-(T.finRootX + fH * fTan), 0, T.finTop], chord: T.finTipChord, t: 0.2 }, PART.TAIL, 1);
  // Belly fairing under the wing box.
  m.lathe([
    { x: -(T.wingRootX - 3), z: zc - R * 0.55, ry: 0.01, rz: 0.01 },
    { x: -(T.wingRootX - 1), z: zc - R * 0.55, ry: R * 0.75, rz: R * 0.62 },
    { x: -(T.wingRootX + T.rootChord), z: zc - R * 0.55, ry: R * 0.78, rz: R * 0.6 },
    { x: -(T.wingRootX + T.rootChord + 3), z: zc - R * 0.45, ry: 0.01, rz: 0.01 },
  ], 8, PART.FUSE);
  // Nose gear.
  const nx = -T.noseGearX, nwr = T.zc > 5 ? 0.5 : 0.38;
  m.box(nx, 0, (zc - R * 0.8 + nwr) / 2, 0.25, 0.25, zc - R * 0.8 - nwr, PART.DARK);
  m.box(nx, 0.3, nwr, nwr * 2, 0.3, nwr * 2, PART.DARK);
  m.box(nx, -0.3, nwr, nwr * 2, 0.3, nwr * 2, PART.DARK);
  return m.result();
}

// The far version (~200 triangles), drawn beyond ~2 km where an airliner is a few dozen
// pixels long: the same outline and parts (so the livery shader works unchanged), with a
// coarser fuselage and nacelles, one slab per wing, and no gear, sharklets or pylons.
export function buildAirlinerFar(T) {
  const m = new Mesh();
  const L = T.length, R = T.radius, zc = T.zc;
  const prof = [[0, 0.0, -0.30], [1.0, 0.52, -0.24], [3.4, 0.85, -0.10], [7.6, 1.0, 0], [L * 0.72, 1.0, 0.02], [L * 0.90, 0.62, 0.34], [L, 0.14, 0.62]];
  const secs = prof.map(([d, r, oz]) => ({ x: -d, z: zc + oz * R, ry: R * r, rz: R * r * 1.04 }));
  m.lathe(secs, 8, PART.FUSE);
  const tanS = Math.tan(T.sweepDeg * DEG), dih = Math.tan(T.dihedralDeg * DEG);
  for (const side of [1, -1]) {
    const y0 = side * R * 0.85, y1 = side * T.span / 2, half = T.span / 2 - R * 0.85;
    const zRoot = zc + T.wingZ;
    slab(m, { le: [-T.wingRootX, y0, zRoot], chord: T.rootChord, t: T.rootChord * 0.13 },
      { le: [-(T.wingRootX + half * tanS), y1, zRoot + half * dih], chord: T.tipChord, t: T.tipChord * 0.11 }, PART.WING);
    const ey = side * T.engineY, ez = T.engineZ, r = T.engineR, x0 = -T.engineX, len = T.engineLen;
    m.lathe([
      { x: x0, z: ez, ry: r, rz: r }, { x: x0 - len * 0.55, z: ez, ry: r * 0.98, rz: r * 0.98 },
      { x: x0 - len, z: ez + r * 0.05, ry: r * 0.42, rz: r * 0.42 },
    ], 6, (i) => (i === 0 ? PART.LIP : PART.ENGINE), { cy: ey });
    m.disc(x0 - 0.05, ez, r * 0.9, r * 0.9, 6, 1, PART.INTAKE, ey);
    const sHalf = T.stabSpan / 2, sTan = Math.tan(T.stabSweepDeg * DEG), sz = zc + T.stabZ;
    slab(m, { le: [-T.stabRootX, side * 0.6, sz], chord: T.stabRootChord, t: 0.45 },
      { le: [-(T.stabRootX + sHalf * sTan), side * sHalf, sz + sHalf * 0.1], chord: T.stabTipChord, t: 0.15 }, PART.WING);
  }
  const finRootZ = zc + R * 0.55, fTan = Math.tan(T.finSweepDeg * DEG), fH = T.finTop - finRootZ;
  slab(m, { le: [-T.finRootX, 0, finRootZ - 0.4], chord: T.finRootChord, t: 0.55 },
    { le: [-(T.finRootX + fH * fTan), 0, T.finTop], chord: T.finTipChord, t: 0.2 }, PART.TAIL, 1);
  return m.result();
}

// ------------------------------------------------------------------ vehicles

// Each vehicle: x forward from its front (so the body runs to -length), on the ground.
const wheels = (m, xs, w, r) => { for (const x of xs) for (const s of [1, -1]) m.box(x, s * (w / 2 - 0.12), r, r * 2, 0.3, r * 2, PART.DARK); };

export function buildVehicle(kind) {
  const m = new Mesh();
  if (kind === 'tug') {
    // Baggage tractor: a low body, a cab with a roof at the back.
    m.box(-1.4, 0, 0.7, 2.8, 1.6, 0.6, PART.BODY);
    m.box(-2.1, 0, 1.45, 1.1, 1.4, 0.9, PART.GLASS);
    m.box(-2.1, 0, 1.95, 1.3, 1.6, 0.1, PART.CAB);
    wheels(m, [-0.5, -2.3], 1.7, 0.35);
    return Object.assign(m.result(), { length: 2.8 });
  }
  if (kind === 'cart') {
    // Baggage cart: a flat bed with a covered container and a tow bar.
    m.box(-1.6, 0, 0.55, 3.0, 1.5, 0.2, PART.BODY);
    m.box(-1.6, 0, 1.25, 2.8, 1.45, 1.2, PART.CARGO);
    m.box(-0.05, 0, 0.45, 0.5, 0.12, 0.08, PART.DARK);
    wheels(m, [-0.6, -2.6], 1.5, 0.22);
    return Object.assign(m.result(), { length: 3.2 });
  }
  if (kind === 'bus') {
    // Apron bus: long, low floor, a window band all round, doors on the right.
    m.box(-6.9, 0, 0.75, 13.8, 2.9, 0.9, PART.BODY);
    m.box(-6.9, 0, 1.85, 13.7, 2.85, 1.3, PART.GLASS);
    m.box(-6.9, 0, 2.85, 13.8, 2.9, 0.7, PART.BODY);
    m.box(-6.9, 0, 3.25, 11.0, 1.8, 0.1, PART.STRIPE);
    wheels(m, [-2.4, -11.4], 2.85, 0.45);
    return Object.assign(m.result(), { length: 13.8 });
  }
  // Fuel truck: a cab, a chassis and a round tank.
  m.box(-1.25, 0, 1.6, 2.2, 2.4, 1.9, PART.CAB);
  m.box(-0.08, 0, 2.05, 0.2, 2.2, 0.8, PART.GLASS);    // windscreen, proud of the cab front
  m.box(-1.2, 0, 2.05, 1.2, 2.44, 0.6, PART.GLASS);    // side windows
  m.box(-5.0, 0, 0.9, 7.6, 2.3, 0.5, PART.DARK);
  m.lathe([
    { x: -2.6, z: 2.15, ry: 0.1, rz: 0.1 }, { x: -2.7, z: 2.15, ry: 1.15, rz: 1.0 },
    { x: -8.2, z: 2.15, ry: 1.15, rz: 1.0 }, { x: -8.3, z: 2.15, ry: 0.1, rz: 0.1 },
  ], 10, PART.TANK);
  m.box(-5.4, 0, 2.15, 5.2, 2.36, 0.25, PART.STRIPE);
  wheels(m, [-1.4, -6.2, -7.5], 2.3, 0.5);
  return Object.assign(m.result(), { length: 8.4 });
}

// ------------------------------------------------------------------ ground shadows

// The airliner's planform as flat, non-overlapping quads (fuselage, wings, tailplane),
// for a blob shadow: each vertex keeps the height it casts from in z, and the shader
// slides it along the sun to the ground. ~14 triangles.
export function buildShadow(T) {
  const m = new Mesh();
  const up = [0, 0, 1];
  const R = T.radius, zc = T.zc;
  const q = (a, b, c, d) => {
    const i = m.vert(a, up, 0), j = m.vert(b, up, 0), k = m.vert(c, up, 0), l = m.vert(d, up, 0);
    m.I.push(i, j, k, i, k, l);
  };
  // Fuselage: a tapered nose, the barrel, a tapered tail.
  q([-0.5, 0.3 * R, zc], [-0.5, -0.3 * R, zc], [-6, -R, zc], [-6, R, zc]);
  q([-6, R, zc], [-6, -R, zc], [-T.length * 0.8, -R, zc], [-T.length * 0.8, R, zc]);
  q([-T.length * 0.8, R, zc], [-T.length * 0.8, -R, zc], [-T.length, -0.2 * R, zc + R * 0.6], [-T.length, 0.2 * R, zc + R * 0.6]);
  const tanS = Math.tan(T.sweepDeg * DEG), dih = Math.tan(T.dihedralDeg * DEG);
  const sTan = Math.tan(T.stabSweepDeg * DEG), sHalf = T.stabSpan / 2;
  for (const s of [1, -1]) {
    const half = T.span / 2 - R, zr = zc + T.wingZ, zt = zr + half * dih;
    const rLE = [-T.wingRootX, s * R, zr], rTE = [-(T.wingRootX + T.rootChord), s * R, zr];
    const tLE = [-(T.wingRootX + half * tanS), s * T.span / 2, zt], tTE = [tLE[0] - T.tipChord, s * T.span / 2, zt];
    q(rLE, tLE, tTE, rTE);
    const sz = zc + T.stabZ;
    q([-T.stabRootX, s * R * 0.5, sz], [-(T.stabRootX + sHalf * sTan), s * sHalf, sz], [-(T.stabRootX + sHalf * sTan + T.stabTipChord), s * sHalf, sz], [-(T.stabRootX + T.stabRootChord), s * R * 0.5, sz]);
  }
  return m.result();
}
