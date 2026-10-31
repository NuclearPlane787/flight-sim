// The map frame: one Lambert conformal conic projection (WGS84) for all of Korea.
// Map coordinates are metres: x east, y north, origin at 36°N 127.5°E.
// Altitudes are metres above mean sea level. No DOM here: it runs in workers and node too.

const DEG = Math.PI / 180;
const A = 6378137;
const F = 1 / 298.257223563;
const E = Math.sqrt(2 * F - F * F);

export const LAT0 = 36, LON0 = 127.5, LAT1 = 33, LAT2 = 38;
export const EARTH_RADIUS = 6371008.8; // mean radius, for curvature and great circles

const m = (phi) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
const t = (phi) => {
  const es = E * Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - es) / (1 + es), E / 2);
};

const m1 = m(LAT1 * DEG), m2 = m(LAT2 * DEG);
const t0 = t(LAT0 * DEG), t1 = t(LAT1 * DEG), t2 = t(LAT2 * DEG);
const N = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
const FF = m1 / (N * Math.pow(t1, N));
const RHO0 = A * FF * Math.pow(t0, N);

// Geographic (degrees) to map metres. Returns [x, y].
export function toMap(latDeg, lonDeg) {
  const rho = A * FF * Math.pow(t(latDeg * DEG), N);
  const theta = N * (lonDeg - LON0) * DEG;
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

// Map metres to geographic degrees. Returns [lat, lon].
export function toGeo(x, y) {
  const dy = RHO0 - y;
  const rho = Math.sqrt(x * x + dy * dy);
  const theta = Math.atan2(x, dy);
  const tt = Math.pow(rho / (A * FF), 1 / N);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) {
    const es = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - es) / (1 + es), E / 2));
  }
  return [phi / DEG, theta / N / DEG + LON0];
}

// Scale factor at a latitude (map metres per ground metre). Within 0.1% over Korea.
export function scaleFactor(latDeg) {
  const phi = latDeg * DEG;
  return (A * FF * N * Math.pow(t(phi), N)) / (A * m(phi));
}

// Grid convergence (rad): the angle from grid north to true north, positive when true
// north lies west (counter-clockwise) of grid north, i.e. east of the central meridian.
// grid azimuth = true azimuth - convergence.
export function convergence(lonDeg) {
  return N * (lonDeg - LON0) * DEG;
}

// Magnetic declination (degrees, east positive) for 2026, a plane fitted to WMM2025
// at Seoul (-9.1), Busan (-8.0), Jeju (-7.6) and Gangneung (-8.9). Good to ~0.3°.
export function magVar(latDeg, lonDeg) {
  return -8.46 - 0.378 * (latDeg - 36) + 0.082 * (lonDeg - 127.5);
}

const wrap2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// Heading conversions, radians, clockwise from north, at map point (x, y).
export function gridToTrue(hdg, x, y) { return wrap2pi(hdg + convergence(toGeo(x, y)[1])); }
export function trueToGrid(hdg, x, y) { return wrap2pi(hdg - convergence(toGeo(x, y)[1])); }
export function trueToMag(hdg, x, y) { const [la, lo] = toGeo(x, y); return wrap2pi(hdg - magVar(la, lo) * DEG); }
export function magToTrue(hdg, x, y) { const [la, lo] = toGeo(x, y); return wrap2pi(hdg + magVar(la, lo) * DEG); }
export function gridToMag(hdg, x, y) { return trueToMag(gridToTrue(hdg, x, y), x, y); }
export function magToGrid(hdg, x, y) { return trueToGrid(magToTrue(hdg, x, y), x, y); }

// Great-circle distance (m) between two geographic points, on the mean sphere.
export function greatCircle(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

// How far the Earth's surface drops below the tangent plane at distance d (m).
export const curvatureDrop = (d) => (d * d) / (2 * EARTH_RADIUS);

// The rendering frame (three.js, Y up): X = map x (east), Y = altitude, Z = -map y.
// Everything is drawn relative to a moving origin (map x, y) so floats stay small.
export function toScene(x, y, z, origin, out = [0, 0, 0]) {
  out[0] = x - origin.x; out[1] = z; out[2] = -(y - origin.y);
  return out;
}

// The extent of the baked national data (matches data/manifest.json).
export const MAP_EXTENT = { x0: -400000, y0: -400000, x1: 400000, y1: 400000 };
