// v0.7.8 part 3 (briefs/V0-7-8.md; the `marks` subagent): the air bases' hardened aircraft shelters as low concrete
// vaults, not v0.7.5's and v0.7.6's 9 m boxes ("Found while building v0.7.6": "the shelters flat boxes, not vaults").
// Pure (no three.js): apron.js's buildings loop asks isShelter() of each building and, for a shelter, takes vaultTris()'s
// triangles instead of its walls and roof. On by default; ?bases78=0 on the page or FS_BASES78=0 in node: the boxes,
// exactly as the pushed v0.7.7 drew them. Read once, at import.
//
// Which buildings: the airport JSONs mark no shelter (the bake writes OSM's outlines, at SHELTERS's 9.0 m, as ordinary
// buildings), so a shelter is a building at one of the seven bases with SHELTERS (tools/bake_region_airports.py: Komatsu,
// Kunsan, Cheongju; Zaragoza, Lossiemouth, Lakenheath, Ramstein) at exactly that 9.0 m and of a shelter's size: its
// least rectangle no longer than SHELTER_MAX_L and no wider than SHELTER_MAX_W (Kunsan's two 9 m blocks of about 210 by
// 170 m stay boxes).
//
// The vault [EST, from public photographs of NATO's and Korea's shelters]: a segmental concrete arch over the least
// rectangle's width, along its length, 6 to 8 m high (0.3 of its width), its door at the end nearer the airport's
// taxiways (a darker, flat face), the back end closed.

export const BASES78 = (() => {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = /[?&]bases78=([01])\b/.exec(q);
    if (m) return m[1] === '1';
  } catch (e) { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.FS_BASES78 === '0') return false; } catch (e) { /* no process */ }
  return true;
})();

export const SHELTER_BASES = new Set(['RJNK', 'RKJK', 'RKTU', 'LEZG', 'EGQS', 'EGUL', 'ETAR']);
export const SHELTER_H = 9.0;          // the bake's height for them (SHELTERS)
export const SHELTER_MAX_L = 80, SHELTER_MAX_W = 60;

// The least-area rectangle round a ring of map [x, y] (over its convex hull's edge directions):
// { cx, cy, ux, uy (the long axis, unit), L (length), W (width) }.
export function leastRect(ring) {
  const pts = ring.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 1e-6) continue;
    const ux = (bx - ax) / l, uy = (by - ay) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of hull) { const u = x * ux + y * uy, v = -x * uy + y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  if (!best) return null;
  let { ux, uy, u0, u1, v0, v1 } = best;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cx = uc * ux - vc * uy, cy = uc * uy + vc * ux;
  let L = u1 - u0, W = v1 - v0;
  if (W > L) { [L, W] = [W, L]; [ux, uy] = [-uy, ux]; }
  return { cx, cy, ux, uy, L, W };
}

export function isShelter(a, b) {
  if (!a || !SHELTER_BASES.has(a.icao) || !b || b.heightM !== SHELTER_H) return false;
  const r = leastRect(b.points || []);
  return !!r && r.L <= SHELTER_MAX_L && r.W <= SHELTER_MAX_W;
}

// The airport's taxiway and apron points, densified to about 20 m (what a shelter's door faces), kept per airport.
const TAXI = new WeakMap();
export function shelterTaxiPts(a) {
  let out = TAXI.get(a);
  if (out) return out;
  out = [];
  const lines = [...(a.taxiways || []).map((t) => t.points || []), ...(a.aprons || []).map((p) => p.points || [])];
  for (const pts of lines) for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], q = pts[i + 1];
    out.push([x0, y0]);
    if (!q) continue;
    const k = Math.floor(Math.hypot(q[0] - x0, q[1] - y0) / 20);
    for (let j = 1; j <= k; j++) out.push([x0 + (q[0] - x0) * j / (k + 1), y0 + (q[1] - y0) * j / (k + 1)]);
  }
  TAXI.set(a, out);
  return out;
}

// The vault's height for a width (m).
export const vaultHeight = (W) => Math.min(8, Math.max(6, 0.3 * W));

// The vault over building b's least rectangle: triangles as [x, y, z, nx, ny, nz, face] per vertex (map x, y; z absolute;
// the normal in the scene's frame: x east, y up, z south; face 0 the concrete, 1 the door). groundAt(x, y): the ground;
// taxiPts: map [x, y] points of the airport's taxiways and aprons (the door faces the nearer).
export function vaultTris(b, groundAt, taxiPts = []) {
  const r = leastRect(b.points);
  const ring = b.points;
  let gmin = Infinity, gsum = 0;
  for (const [x, y] of ring) { const g = groundAt(x, y); gmin = Math.min(gmin, g); gsum += g; }
  const g0 = gsum / ring.length, base = gmin - 1.0, H = vaultHeight(r.W);
  let { ux, uy } = r;
  // the door at the end nearer the taxiways
  const end = (s) => [r.cx + s * ux * r.L / 2, r.cy + s * uy * r.L / 2];
  const near = (p) => { let d = Infinity; for (const [x, y] of taxiPts) d = Math.min(d, Math.hypot(x - p[0], y - p[1])); return d; };
  if (taxiPts.length && near(end(-1)) < near(end(1))) { ux = -ux; uy = -uy; }
  const vx = -uy, vy = ux;                         // across (to the left of the long axis)
  const K = 12;
  // the profile across: [v (m, from the axis), z above g0, dz/dv's normal (nv, nz)]
  const prof = [];
  for (let k = 0; k <= K; k++) {
    const t = -1 + 2 * k / K, s = Math.max(1 - t * t, 0);
    const z = H * Math.pow(s, 0.62);
    // d z / d v = H * 0.62 * s^-0.38 * (-2t) / (W/2)
    const dz = s > 1e-4 ? H * 0.62 * Math.pow(s, -0.38) * (-2 * t) / (r.W / 2) : (t < 0 ? 1e3 : -1e3);
    const nl = Math.hypot(dz, 1);
    prof.push([t * r.W / 2, z, -dz / nl, 1 / nl]);
  }
  const out = [];
  const P = (u, v, z) => [r.cx + ux * u + vx * v, r.cy + uy * u + vy * v, z];
  const push = (p, nMap, face) => out.push([p[0], p[1], p[2], nMap[0], nMap[2], -nMap[1], face]);   // map normal (x, y, z up) -> scene (x, up, -y)
  const hl = r.L / 2;
  // the shell: strips along the length
  for (let k = 0; k < K; k++) {
    const [va, za, nva, nza] = prof[k], [vb, zb, nvb, nzb] = prof[k + 1];
    const na = [vx * nva, vy * nva, nza], nb = [vx * nvb, vy * nvb, nzb];
    const A0 = P(-hl, va, g0 + za), A1 = P(hl, va, g0 + za), B0 = P(-hl, vb, g0 + zb), B1 = P(hl, vb, g0 + zb);
    // counter-clockwise seen from outside (above): A0, B0, B1 / A0, B1, A1 with v increasing to the left
    for (const [p, n] of [[A0, na], [A1, na], [B1, nb], [A0, na], [B1, nb], [B0, nb]]) push(p, n, 0);
  }
  // the skirts under the springings (ground to the base), each side
  for (const s of [-1, 1]) {
    const v = s * r.W / 2, n = [vx * s, vy * s, 0];
    const a = P(-hl, v, base), b2 = P(hl, v, base), c = P(hl, v, g0), d = P(-hl, v, g0);
    const quad = s > 0 ? [a, c, b2, a, d, c] : [a, b2, c, a, c, d];
    for (const p of quad) push(p, n, 0);
  }
  // the ends: the back closed in concrete, the front the door (a fan from the floor's middle)
  for (const s of [-1, 1]) {
    const u = s * hl, n = [ux * s, uy * s, 0], face = s > 0 ? 1 : 0;
    const c = P(u, 0, base);
    const rim = [P(u, -r.W / 2, base), ...prof.map(([v, z]) => P(u, v, g0 + z)), P(u, r.W / 2, base)];
    for (let i = 0; i + 1 < rim.length; i++) {
      const tri = s > 0 ? [c, rim[i + 1], rim[i]] : [c, rim[i], rim[i + 1]];
      for (const p of tri) push(p, n, face);
    }
  }
  return { tris: out, base, top: g0 + H, H, rect: r, door: [r.cx + ux * hl, r.cy + uy * hl] };
}
