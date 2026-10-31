// The six flight-deck windows (A320 family), designed from the Captain's eye, for the
// exterior glass (aircraft.js), the livery (livery.js) and the cockpit shell's cut-outs
// (cockpit.js), so the three always agree.
//
// Each window's corners are directions from the Captain's eye point (EYES.captain):
// [azimuth, elevation] in degrees, azimuth to the left of the nose and elevation above the
// body's horizontal. Each edge is where the plane through the eye and its two corners cuts
// the nose, so from the left seat every frame is a straight line, as the real flat panes'
// frames are. The two corners written { y, el } sit on the centre post instead: the point
// on the crown at body y (m) seen at that elevation, joined along the crown. The First
// Officer's windows mirror these (θ → 180° − θ), so they're straight from the right seat.
//
//   cockpitWindows(shape) → [[[x, θ], ...], ...]   left-side outlines, one per window
//   shape = { fuseSection } (aircraft.js: x → { zc, up, down, hw }, a section of two
//   half-ellipses); (x, θ) as in fusePoint(): body x in metres, θ in degrees around the
//   fuselage (0 left, 90 the crown, 180 right).

import { EYES } from './geometry.js';

const DEG = Math.PI / 180;

export const WINDOW_DESIGN = [
  // No. 1, the windshield: from the centre post to the slanted side post. On the steep part
  // of the nose, so from outside it's a lower band than the side windows (0.62 m of height
  // against their 0.83 m), while the pilot still sees 17° to 22° down over the nose.
  [{ y: 0.05, el: -17 }, { y: 0.05, el: 16 }, [44, 14], [40, -22]],
  // No. 2, the sliding window.
  [[48, -26], [51, 18], [90, 16], [90, -24]],
  // No. 3, the fixed rear window: smaller than the sliding window, and narrower at the top.
  [[95, -24], [95, 16], [111, 13], [117, -20]],
];

const SAMPLES = 24;   // points per edge

export function cockpitWindows(shape, design = WINDOW_DESIGN) {
  const sect = shape.fuseSection;
  const E = EYES.captain;
  const hh = (s, z) => (z >= s.zc ? s.up : s.down);
  // > 1 outside the skin, < 1 inside.
  const rad = (x, y, z) => { const s = sect(x); return Math.hypot(y / s.hw, (z - s.zc) / hh(s, z)); };
  const theta = (x, y, z) => { const s = sect(x); return Math.atan2((z - s.zc) / hh(s, z), y / s.hw) / DEG; };
  // Where the ray from the eye along d leaves the skin.
  const hit = (d) => {
    const l = Math.hypot(d[0], d[1], d[2]);
    const at = (t) => [E.x + d[0] / l * t, E.y + d[1] / l * t, E.z + d[2] / l * t];
    let t0 = 0, t1 = 0.05;
    while (rad(...at(t1)) < 1 && t1 < 6) { t0 = t1; t1 += 0.05; }
    for (let k = 0; k < 40; k++) { const m = (t0 + t1) / 2; if (rad(...at(m)) < 1) t0 = m; else t1 = m; }
    return at((t0 + t1) / 2);
  };
  const dirOf = ([az, el]) => [Math.cos(el * DEG) * Math.cos(az * DEG), Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG)];
  // The crown point at body y whose elevation from the eye is el.
  const crownAt = (y) => (x) => { const s = sect(x); return [x, y, s.zc + s.up * Math.sqrt(Math.max(0, 1 - (y / s.hw) ** 2))]; };
  const onPost = ({ y, el }) => {
    const p = crownAt(y);
    const elev = (x) => { const [px, py, pz] = p(x); return Math.atan2(pz - E.z, Math.hypot(px - E.x, py - E.y)) / DEG; };
    let x0 = E.x + 0.2, x1 = 20.95;     // elevation falls as x grows
    for (let k = 0; k < 50; k++) { const m = (x0 + x1) / 2; if (elev(m) > el) x0 = m; else x1 = m; }
    return p((x0 + x1) / 2);
  };
  const corner = (c) => (Array.isArray(c) ? hit(dirOf(c)) : onPost(c));

  return design.map((corners) => {
    const P = corners.map(corner);
    const out = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length], A = P[i], B = P[(i + 1) % corners.length];
      for (let k = 0; k < SAMPLES; k++) {
        const s = k / SAMPLES;
        let q;
        if (!Array.isArray(a) && !Array.isArray(b)) {
          q = crownAt(a.y)(A[0] + (B[0] - A[0]) * s);                    // along the centre post
        } else {
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
