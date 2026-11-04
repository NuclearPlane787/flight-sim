// A widebody's fuselage as curves, from a spec (src/widebody-specs.js). Pure: no three.js and no
// DOM, so the model (widebody.js), its livery (livery-widebody.js), the cockpit and node tests all
// read one shape. The same conventions as aircraft.js: the body frame (+x forward, +y left, +z up,
// metres) and sections of two half-ellipses that meet at the centre line fuseMid(x).
//
//   fuselageShape(spec) → { fuseTop, fuseBot, fuseHW, fuseMid, fuseSection, fusePoint, noseX, tailX, tailEndX, curve }
//     fuseTop(x), fuseBot(x)  the top and bottom lines, body z
//     fuseHW(x)               the half-width
//     fuseMid(x)              the centre line, where the section is widest
//     fuseSection(x)          { zc, up, down, hw }: what src/cockpit-windows.js calls a section
//     fusePoint(x, θ°, off = 0, out = {x,y,z})  the surface at body x and angle θ (0 left, 90 the
//                             crown, 180 right), `off` metres proud; `out` may be a THREE.Vector3
//   cockpitWindowOutlines({ geo, cockpitWindows }, shape?) → [[[x, θ], ...], ...]  left-side outlines,
//     one per window (the right side mirrors θ → 180° − θ), worked out from a design and the Captain's
//     eye the way src/cockpit-windows.js does it for the A321 (that file reads the A321's eye). The
//     designs, per type, are in src/cockpit-windows-boeing.js.
//
// The spec's tables are measured off the planning document's drawings, as [metres aft of the nose
// tip, value in metres] at spec.ref's dimensions, and scale with the geometry module's fuselage,
// so a new number there moves the shape instead of leaving it behind.

const DEG = Math.PI / 180;

// Monotone cubic interpolation through [x, y] points, x ascending (the same as aircraft.js's).
export function curve(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : 2 / (1 / d[k - 1] + 1 / d[k]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k]
      + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  };
}

export function fuselageShape(spec) {
  const G = spec.geo, R = spec.ref;
  const kz = G.FUSELAGE_HEIGHT / R.fuselageHeight, ky = G.FUSELAGE_WIDTH / R.fuselageWidth;
  const noseX = G.NOSE_X, tailEndX = G.FUSELAGE_TAIL_X;
  const kd = (noseX - tailEndX) / R.fuselageLength;
  // Tables are [d aft of the nose tip, value]: d is scaled only aft of the nose's own length, so
  // the nose keeps its true metres when the type is stretched.
  const line = (table, k) => {
    const pts = table.map(([d, v]) => [noseX - (d > spec.fuselage.noseD ? spec.fuselage.noseD + (d - spec.fuselage.noseD) * kd : d), v * k]).reverse();
    return curve(pts);
  };
  const fuseTop = line(spec.fuselage.top, kz);
  const fuseBot = line(spec.fuselage.bottom, kz);
  const fuseHW = line(spec.fuselage.halfWidth, ky);
  const fuseMid = (x) => (fuseTop(x) + fuseBot(x)) / 2;
  const fuseSection = (x) => {
    const zc = fuseMid(x);
    return { zc, up: fuseTop(x) - zc, down: zc - fuseBot(x), hw: fuseHW(x) };
  };
  const fusePoint = (x, thDeg, off = 0, out = { x: 0, y: 0, z: 0 }) => {
    const zc = fuseMid(x), th = thDeg * DEG, sn = Math.sin(th);
    const hh = sn >= 0 ? fuseTop(x) - zc : zc - fuseBot(x);
    out.x = x;
    out.y = Math.max(0, fuseHW(x) + off) * Math.cos(th);
    out.z = zc + Math.max(0, hh + off) * sn;
    return out;
  };
  return { fuseTop, fuseBot, fuseHW, fuseMid, fuseSection, fusePoint, noseX, tailX: G.TAIL_X, tailEndX, curve };
}

// The cockpit's windows, from directions out of the Captain's eye (see src/cockpit-windows.js for
// the idea: each edge is where the plane through the eye and its two corners cuts the skin, so a
// frame looks straight from the seat). A corner is [azimuth, elevation] in degrees, or { y, el }:
// on the crown at body y, seen at that elevation (the centre post).
export function cockpitWindowOutlines(spec, shape = fuselageShape(spec)) {
  const E = spec.geo.EYES.captain, sect = shape.fuseSection, SAMPLES = 24;
  const hh = (s, z) => (z >= s.zc ? s.up : s.down);
  const rad = (x, y, z) => { const s = sect(x); return s.hw > 0 ? Math.hypot(y / s.hw, (z - s.zc) / hh(s, z)) : 9; };
  const theta = (x, y, z) => { const s = sect(x); return Math.atan2((z - s.zc) / hh(s, z), y / s.hw) / DEG; };
  const hit = (d) => {
    const l = Math.hypot(d[0], d[1], d[2]);
    const at = (t) => [E.x + d[0] / l * t, E.y + d[1] / l * t, E.z + d[2] / l * t];
    let t0 = 0, t1 = 0.05;
    while (rad(...at(t1)) < 1 && t1 < 8) { t0 = t1; t1 += 0.05; }
    for (let k = 0; k < 40; k++) { const m = (t0 + t1) / 2; if (rad(...at(m)) < 1) t0 = m; else t1 = m; }
    return at((t0 + t1) / 2);
  };
  const dirOf = ([az, el]) => [Math.cos(el * DEG) * Math.cos(az * DEG), Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG)];
  const crownAt = (y) => (x) => { const s = sect(x); return [x, y, s.zc + s.up * Math.sqrt(Math.max(0, 1 - (y / s.hw) ** 2))]; };
  const onPost = ({ y, el }) => {
    const p = crownAt(y);
    const elev = (x) => { const [px, py, pz] = p(x); return Math.atan2(pz - E.z, Math.hypot(px - E.x, py - E.y)) / DEG; };
    let x0 = E.x - 0.02, x1 = shape.noseX - 0.05;   // elevation falls as x grows
    for (let k = 0; k < 50; k++) { const m = (x0 + x1) / 2; if (elev(m) > el) x0 = m; else x1 = m; }
    return p((x0 + x1) / 2);
  };
  const corner = (c) => (Array.isArray(c) ? hit(dirOf(c)) : onPost(c));
  return spec.cockpitWindows.map((corners) => {
    const P = corners.map(corner), out = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length], A = P[i], B = P[(i + 1) % corners.length];
      for (let k = 0; k < SAMPLES; k++) {
        const s = k / SAMPLES;
        let q;
        if (!Array.isArray(a) && !Array.isArray(b)) q = crownAt(a.y)(A[0] + (B[0] - A[0]) * s);
        else {
          const da = [A[0] - E.x, A[1] - E.y, A[2] - E.z], db = [B[0] - E.x, B[1] - E.y, B[2] - E.z];
          const la = Math.hypot(...da), lb = Math.hypot(...db);
          q = hit([0, 1, 2].map((j) => da[j] / la * (1 - s) + db[j] / lb * s));
        }
        out.push([q[0], theta(...q)]);
      }
    }
    return out;
  });
}
