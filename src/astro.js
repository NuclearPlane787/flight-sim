// The sun, the Moon and the stars from a date and a place. Pure: no DOM, no three.
// Standard low-precision formulas from Jean Meeus, "Astronomical Algorithms" (2nd ed.):
// sidereal time (ch. 12), the sun (ch. 25, as NOAA's calculator uses it), the Moon (ch. 47,
// its main periodic terms: about 0.01 degree), precession (ch. 21) and the Moon's
// illuminated fraction (ch. 48). UT is used for TT (the 69 s between them moves the Moon
// by 0.01 degree). Angles are degrees, times are epoch ms; azimuth is from north, clockwise.

import { startOfKstDay } from './clock.js';

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD), cos = (d) => Math.cos(d * RAD), tan = (d) => Math.tan(d * RAD);
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
const atan2 = (y, x) => Math.atan2(y, x) / RAD;
const norm360 = (d) => ((d % 360) + 360) % 360;
const norm180 = (d) => norm360(d + 180) - 180;

const DAY_MS = 86400e3;
const AU_KM = 149597870.7;
const EARTH_R_KM = 6378.14;

// The sun's upper limb on the horizon: 34' of refraction and a 16' semi-diameter.
export const SUN_HORIZON_DEG = -50 / 60;
export const TWILIGHT_DEG = { civil: -6, nautical: -12, astronomical: -18 };

export function julianDay(ms) { return ms / DAY_MS + 2440587.5; }
const centuries = (ms) => (julianDay(ms) - 2451545.0) / 36525;

// Greenwich mean sidereal time (Meeus 12.4).
export function gmstDeg(ms) {
  const d = julianDay(ms) - 2451545.0, T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000);
}

// Local mean sidereal time; east longitudes are positive.
export function lstDeg(ms, lonDeg) { return norm360(gmstDeg(ms) + lonDeg); }

// The obliquity of the ecliptic, with the main nutation term, and the nutation in longitude.
function obliquity(T) {
  const omega = 125.04 - 1934.136 * T;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - 0.001813 * T))) / 60) / 60;
  return { eps: eps0 + 0.00256 * cos(omega), dPsi: -0.00478 * sin(omega) };
}

function eclipticToEquatorial(lamDeg, betaDeg, epsDeg) {
  const raDeg = norm360(atan2(sin(lamDeg) * cos(epsDeg) - tan(betaDeg) * sin(epsDeg), cos(lamDeg)));
  const decDeg = asin(sin(betaDeg) * cos(epsDeg) + cos(betaDeg) * sin(epsDeg) * sin(lamDeg));
  return { raDeg, decDeg };
}

// ---- the sun ----

// The sun's apparent ecliptic longitude (degrees) and distance (AU), Meeus ch. 25.
function sunEcliptic(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const nu = M + C;
  const distAu = 1.000001018 * (1 - e * e) / (1 + e * cos(nu));
  const omega = 125.04 - 1934.136 * T;
  return { lamDeg: norm360(L0 + C - 0.00569 - 0.00478 * sin(omega)), distAu };
}

export function sunEquatorial(ms) {
  const T = centuries(ms);
  const { lamDeg, distAu } = sunEcliptic(T);
  const { raDeg, decDeg } = eclipticToEquatorial(lamDeg, 0, obliquity(T).eps);
  return { raDeg, decDeg, distAu, lamDeg };
}

// Refraction in degrees for a true (geometric) altitude (Saemundsson), at 10 C and 1010 hPa.
export function refractionDeg(altDeg) {
  if (altDeg < -1.5) return 0;
  const h = Math.max(altDeg, -1.5);
  return 1.02 / tan(h + 10.3 / (h + 5.11)) / 60;
}

// Equatorial (of date) to horizontal for an observer.
export function equatorialToHorizontal(raDeg, decDeg, ms, latDeg, lonDeg) {
  const H = lstDeg(ms, lonDeg) - raDeg;
  const altDeg = asin(sin(latDeg) * sin(decDeg) + cos(latDeg) * cos(decDeg) * cos(H));
  const azDeg = norm360(atan2(-cos(decDeg) * sin(H), sin(decDeg) * cos(latDeg) - cos(decDeg) * cos(H) * sin(latDeg)));
  return { azDeg, altDeg };
}

export function sunHorizontal(ms, latDeg, lonDeg) {
  const s = sunEquatorial(ms);
  const h = equatorialToHorizontal(s.raDeg, s.decDeg, ms, latDeg, lonDeg);
  return { ...h, altRefractedDeg: h.altDeg + refractionDeg(h.altDeg) };
}

// Times in [t0, t1] where f(t) changes sign, each found to within 1 s: sampled every
// 10 minutes, then bisected. Returns [{ t, rising }].
function crossings(f, t0, t1, stepMs = 600e3) {
  const out = [];
  let ta = t0, fa = f(ta);
  while (ta < t1) {
    const tb = Math.min(t1, ta + stepMs), fb = f(tb);
    if ((fa < 0) !== (fb < 0)) {
      let lo = ta, hi = tb, flo = fa;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
      }
      out.push({ t: Math.round((lo + hi) / 2), rising: fa < 0 });
    }
    ta = tb; fa = fb;
  }
  return out;
}

// When the sun's geometric centre crosses altDeg during the KST day containing dayMs:
// { rise, set } in ms, either null if it doesn't happen that day (polar day or night).
export function sunCrossing(dayMs, latDeg, lonDeg, altDeg) {
  const t0 = startOfKstDay(dayMs);
  const xs = crossings((t) => sunHorizontal(t, latDeg, lonDeg).altDeg - altDeg, t0, t0 + DAY_MS);
  const r = xs.find((x) => x.rising), s = xs.find((x) => !x.rising);
  return { rise: r ? r.t : null, set: s ? s.t : null };
}

// Sunrise, sunset (upper limb at -50'), noon (the sun due south, its hour angle 0) and the
// twilights for the KST day containing dayMs. Twilight: { dawn, dusk } for -6, -12 and -18.
export function sunEvents(dayMs, latDeg, lonDeg) {
  const t0 = startOfKstDay(dayMs);
  const { rise, set } = sunCrossing(t0, latDeg, lonDeg, SUN_HORIZON_DEG);
  const hourAngle = (t) => norm180(lstDeg(t, lonDeg) - sunEquatorial(t).raDeg);
  const transit = crossings(hourAngle, t0, t0 + DAY_MS).find((x) => x.rising);
  const noon = transit ? transit.t : null;
  const noonAltDeg = noon === null ? null : sunHorizontal(noon, latDeg, lonDeg).altDeg;
  const twilight = {};
  for (const [name, alt] of Object.entries(TWILIGHT_DEG)) {
    const c = sunCrossing(t0, latDeg, lonDeg, alt);
    twilight[name] = { dawn: c.rise, dusk: c.set };
  }
  return { rise, set, noon, noonAltDeg, twilight };
}

// ---- the Moon ----

// Meeus table 47.A, the largest terms: D, M, M', F multipliers, then the longitude
// (1e-6 degree) and distance (1e-3 km) coefficients.
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];
// Meeus table 47.B, the largest terms: D, M, M', F, then the latitude (1e-6 degree).
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
];

// The Moon's apparent geocentric ecliptic longitude and latitude (degrees) and distance (km).
function moonEcliptic(T) {
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  const eFac = (m) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F, k = eFac(m);
    sl += l * k * sin(arg);
    sr += r * k * cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) sb += b * eFac(m) * sin(d * D + m * M + mp * Mp + f * F);
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
    + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  const { dPsi } = obliquity(T);
  return { lamDeg: norm360(Lp + sl / 1e6 + dPsi), betaDeg: sb / 1e6, distKm: 385000.56 + sr / 1000 };
}

// Geocentric: { raDeg, decDeg, distKm, lamDeg, betaDeg }, of date.
export function moonEquatorial(ms) {
  const T = centuries(ms);
  const ecl = moonEcliptic(T);
  const eq = eclipticToEquatorial(ecl.lamDeg, ecl.betaDeg, obliquity(T).eps);
  return { ...eq, ...ecl };
}

// Topocentric horizontal position (parallax for a spherical Earth, observer at sea level):
// up to 1 degree lower than the geocentric one near the horizon.
export function moonHorizontal(ms, latDeg, lonDeg) {
  const m = moonEquatorial(ms);
  const lst = lstDeg(ms, lonDeg);
  // the Moon and the observer as vectors in the equatorial frame of date (km)
  const mx = m.distKm * cos(m.decDeg) * cos(m.raDeg), my = m.distKm * cos(m.decDeg) * sin(m.raDeg), mz = m.distKm * sin(m.decDeg);
  const ox = EARTH_R_KM * cos(latDeg) * cos(lst), oy = EARTH_R_KM * cos(latDeg) * sin(lst), oz = EARTH_R_KM * sin(latDeg);
  const x = mx - ox, y = my - oy, z = mz - oz, dist = Math.hypot(x, y, z);
  const raDeg = norm360(atan2(y, x)), decDeg = asin(z / dist);
  const h = equatorialToHorizontal(raDeg, decDeg, ms, latDeg, lonDeg);
  return { ...h, altRefractedDeg: h.altDeg + refractionDeg(h.altDeg), distKm: dist, raDeg, decDeg,
    semiDiameterDeg: asin(1737.4 / dist) };
}

const SYNODIC_DAYS = 29.530589;

// The Moon's phase. illum: the lit fraction 0..1 (from the phase angle, which follows the
// elongation); elongDeg: the Moon's angle from the sun; waxing: lit on the evening side;
// ageDays: days since new, from the longitude difference; brightLimbAngleDeg: the position
// angle of the lit limb's midpoint, from north towards east (Meeus 48.5).
export function moonPhase(ms) {
  const m = moonEquatorial(ms), s = sunEquatorial(ms);
  const cosE = sin(s.decDeg) * sin(m.decDeg) + cos(s.decDeg) * cos(m.decDeg) * cos(s.raDeg - m.raDeg);
  const elongDeg = Math.acos(Math.max(-1, Math.min(1, cosE))) / RAD;
  const R = s.distAu * AU_KM;
  const phaseAngle = atan2(R * sin(elongDeg), m.distKm - R * cos(elongDeg));
  const illum = (1 + cos(phaseAngle)) / 2;
  const dLam = norm360(m.lamDeg - s.lamDeg);
  const brightLimbAngleDeg = norm360(atan2(cos(s.decDeg) * sin(s.raDeg - m.raDeg),
    sin(s.decDeg) * cos(m.decDeg) - cos(s.decDeg) * sin(m.decDeg) * cos(s.raDeg - m.raDeg)));
  return { illum, elongDeg, phaseAngleDeg: phaseAngle, waxing: dLam < 180, ageDays: dLam / 360 * SYNODIC_DAYS, brightLimbAngleDeg };
}

// Moonrise and moonset (upper limb on the horizon, topocentric) in the KST day containing
// dayMs: { rise, set }, either null on the days the Moon skips one.
export function moonEvents(dayMs, latDeg, lonDeg) {
  const t0 = startOfKstDay(dayMs);
  const f = (t) => { const h = moonHorizontal(t, latDeg, lonDeg); return h.altDeg + 34 / 60 + h.semiDiameterDeg; };
  const xs = crossings(f, t0, t0 + DAY_MS);
  const r = xs.find((x) => x.rising), s = xs.find((x) => !x.rising);
  return { rise: r ? r.t : null, set: s ? s.t : null };
}

// ---- the stars and the Milky Way ----

// Precession from J2000 to the date (Meeus 21.2-21.4), as a row-major 3x3 matrix acting on
// equatorial unit vectors (x to RA 0, y to RA 90, z to the north pole).
export function precessionMatrix(ms) {
  const T = centuries(ms), s = 1 / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * s;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * s;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * s;
  const cz = cos(zeta), sz = sin(zeta), cZ = cos(z), sZ = sin(z), ct = cos(th), st = sin(th);
  return [
    cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st,
    sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st,
    st * cz, -st * sz, ct,
  ];
}

const raDecToVec = (ra, dec) => [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
const mulVec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

// A J2000 position (a catalogue star) precessed to the date.
export function precessFromJ2000(raDeg, decDeg, ms) {
  const [x, y, zz] = mulVec(precessionMatrix(ms), raDecToVec(raDeg, decDeg));
  return { raDeg: norm360(atan2(y, x)), decDeg: asin(zz) };
}

// For the sky shader: a row-major 3x3 matrix taking J2000 equatorial unit vectors to the
// observer's local east, north, up. It includes precession and sidereal time, so the
// whole star field and the Milky Way turn with one matrix (refraction not included).
export function j2000ToEnuMatrix(ms, latDeg, lonDeg) {
  const lst = lstDeg(ms, lonDeg), P = precessionMatrix(ms);
  const e = [-sin(lst), cos(lst), 0];
  const n = [-sin(latDeg) * cos(lst), -sin(latDeg) * sin(lst), cos(latDeg)];
  const u = [cos(latDeg) * cos(lst), cos(latDeg) * sin(lst), sin(latDeg)];
  const out = [];
  for (const row of [e, n, u]) {
    for (let c = 0; c < 3; c++) out.push(row[0] * P[c] + row[1] * P[3 + c] + row[2] * P[6 + c]);
  }
  return out;
}

// Galactic (l, b) to J2000 equatorial, for the Milky Way's band: the north galactic pole is
// at RA 192.85948, Dec 27.12825, and the north celestial pole at l = 122.93192.
export function galacticToEquatorial(lDeg, bDeg) {
  const raP = 192.85948, decP = 27.12825, lNcp = 122.93192;
  const decDeg = asin(sin(decP) * sin(bDeg) + cos(decP) * cos(bDeg) * cos(lNcp - lDeg));
  const raDeg = norm360(raP + atan2(cos(bDeg) * sin(lNcp - lDeg),
    cos(decP) * sin(bDeg) - sin(decP) * cos(bDeg) * cos(lNcp - lDeg)));
  return { raDeg, decDeg };
}
