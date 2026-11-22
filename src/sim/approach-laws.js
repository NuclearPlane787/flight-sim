// v0.7.4 (Shane's item 9): the localizer's and the glideslope's capture and tracking laws, moved out of
// autopilot-boeing.js (where v0.3.0 wrote them) so that both families fly them: the Boeings' LOC and APP, and the
// A321's LOC and APPR. The expressions are the Boeings' own, term for term, so the Boeings fly exactly as before
// (their golden flights and autoland tests). Allocation free: beamInto() fills an object the caller keeps.
//
//   ils: { x, y, hdgGrid, elev, gsDeg }   the threshold (map m), the course (grid rad), its elevation (m), the path (°)
//   E:   the fly-by-wire's environment (psi, tas, gs, onGround, ...); S: the sim's state (pos)

const G = 9.80665;
const DEG = Math.PI / 180, FT = 0.3048;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const LOC_L = 1100;             // m: the localiser's heading law, Δψ = atan(xte / L)
export const GS_K = 0.22;              // 1/s: the glideslope's path gain
export const TCH = 50 * FT;            // the beam crosses the threshold at 50 ft (ref point ≈ the antenna)

// Where the aircraft is on the beam: along < 0 before the threshold, xte > 0 right of the course, beamD the distance
// before the threshold, dev the height above the glide path (m).
export function beamInto(ils, S, out) {
  const sh = Math.sin(ils.hdgGrid), ch = Math.cos(ils.hdgGrid);
  const rx = S.pos.x - ils.x, ry = S.pos.y - ils.y;
  out.along = rx * sh + ry * ch;
  out.xte = rx * ch - ry * sh;
  out.beamD = Math.max(0, -out.along);
  out.dev = S.pos.z - (ils.elev + TCH + out.beamD * Math.tan((ils.gsDeg ?? 3) * DEG));
  return out;
}

// The localiser's capture (armed, in the air, before the threshold): early enough to roll out on the beam at the
// turn's radius, from the side the aircraft is heading in from, within 100° of the course.
export function locCaptures(ils, E, xte) {
  const dh = wrapPi(ils.hdgGrid - E.psi);
  const turnR = E.tas * E.tas / (G * Math.tan(25 * DEG));
  const inbound = -xte * Math.sin(dh) >= 0 || Math.abs(xte) < 300;
  const lead = Math.max(300, turnR * (1 - Math.cos(Math.min(Math.abs(dh), Math.PI / 2))));
  return Math.abs(xte) < lead && inbound && Math.abs(dh) < 100 * DEG;
}

// The glideslope's capture (armed, in the air, before the threshold, within 1,500 m of the course): from below or
// nearly so, the beam coming down on the aircraft.
export function gsCaptures(ils, E, dev) {
  const lead = 12 * FT + 0.15 * E.gs * Math.tan((ils.gsDeg ?? 3) * DEG) / 0.22;
  return dev > -lead && dev < 150 * FT;
}

// The localiser's course to fly (grid rad): the beam's heading law, and 30° to it from more than 2 km off.
export function locCourse(ils, xte) {
  let psiCmd = ils.hdgGrid - Math.atan(xte / LOC_L);
  if (Math.abs(xte) > 2000) psiCmd = ils.hdgGrid - Math.sign(xte) * 30 * DEG;
  return psiCmd;
}

// The glideslope's vertical speed (m/s): the path's own rate at the ground speed, and the deviation taken out.
export function gsVs(ils, E, dev) {
  const slope = Math.tan((ils ? ils.gsDeg ?? 3 : 3) * DEG);
  return -E.gs * slope + clamp(-GS_K * dev, -8, 8);
}

// The ILS as the autopilots keep it (plain, JSON-safe: saves carry it).
export const ilsCopy = (ils) => (ils ? { x: ils.x, y: ils.y, hdgGrid: ils.hdgGrid, elev: ils.elev, gsDeg: ils.gsDeg ?? 3 } : null);
