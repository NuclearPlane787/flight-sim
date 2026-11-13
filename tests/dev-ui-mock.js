// Mocks for the screens' dev page: airports in the interface's JSON shape, a coastline,
// and a kinematic stand-in for sim.state / sim.ap (not a flight model).

import { toMap, toGeo, gridToTrue, magToGrid, gridToMag, magVar, MAP_EXTENT } from '../src/world/frame.js';

const DEG = Math.PI / 180, KT = 0.514444, FT = 0.3048;

// Runway ends from OurAirports (lat, lon, elevation ft), for the mocks only.
const RAW = {
  RKSS: { name: 'Gimpo International', lat: 37.5583, lon: 126.7906, elevM: 18, runways: [
    ['14L/32R', 45, ['14L', 37.5703011, 126.7779999, 38], ['32R', 37.5474014, 126.8069992, 42]],
    ['14R/32L', 60, ['14R', 37.5680008, 126.7760010, 34], ['32L', 37.5475998, 126.8010025, 41]]] },
  RKPC: { name: 'Jeju International', lat: 33.5113, lon: 126.4930, elevM: 36, runways: [
    ['07/25', 45, ['07', 33.5004005, 126.4690018, 86], ['25', 33.5144997, 126.4970016, 76]],
    ['13/31', 45, ['13', 33.5154991, 126.4869995, 67], ['31', 33.5055008, 126.5039978, 105]]] },
  RKSI: { name: 'Incheon International', lat: 37.4691, lon: 126.4510, elevM: 7, runways: [
    ['15L/33R', 60, ['15L', 37.4838982, 126.4400000, 23], ['33R', 37.4564018, 126.4649963, 23]],
    ['15R/33L', 60, ['15R', 37.4818001, 126.4359970, 23], ['33L', 37.4542000, 126.4609985, 23]],
    ['16R/34L', 60, ['16R', 37.468746, 126.413446, 23], ['34L', 37.441272, 126.437882, 23]]] },
};

export function mockAirports() {
  return Object.entries(RAW).map(([icao, a]) => {
    const origin = toMap(a.lat, a.lon);
    const runways = a.runways.map(([id, widthM, e1, e2]) => {
      const p1 = toMap(e1[1], e1[2]), p2 = toMap(e2[1], e2[2]);
      const lengthM = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const end = (e, p, q, papi) => {
        const g = Math.atan2(q[0] - p[0], q[1] - p[1]);
        return { ident: e[0], lat: e[1], lon: e[2], x: p[0], y: p[1], elevM: a.elevM, displacedM: 0,
          hdgTrueDeg: ((gridToTrue(g, p[0], p[1]) / DEG) + 360) % 360, hdgGridDeg: ((g / DEG) + 360) % 360, papi, approachLights: 'SALS' };
      };
      return { id, widthM, lengthM, surface: 'asphalt', ends: [end(e1, p1, p2, 'left'), end(e2, p2, p1, 'left')] };
    });
    return { icao, name: a.name, lat: a.lat, lon: a.lon, elevM: a.elevM, origin, magVarDeg: magVar(a.lat, a.lon), runways,
      taxiways: [], aprons: [], stands: [], holdingPositions: [], buildings: [], serviceRoads: [] };
  });
}

// Real data when the bake job has written it, mocks otherwise.
export async function loadAirportsOrMock(base = '../data/') {
  try {
    const m = await (await fetch(base + 'manifest.json')).json();
    const list = await Promise.all(m.airports.map(async (p) => (await fetch(base + p)).json()));
    if (list.length) return { airports: list, source: 'data/' };
  } catch {}
  try {
    const list = await Promise.all(['RKSS', 'RKPC', 'RKSI'].map(async (i) => { const r = await fetch(`${base}airports/${i}.json`); if (!r.ok) throw 0; return r.json(); }));
    return { airports: list, source: 'data/airports' };
  } catch {}
  return { airports: mockAirports(), source: 'mock' };
}

// data/coast.json, or (dev only) Natural Earth's land projected on the fly, or nothing.
export async function loadCoastOrMock() {
  try { const r = await fetch('../data/coast.json'); if (r.ok) return { coast: await r.json(), source: 'data/coast.json' }; } catch {}
  try {
    const r = await fetch('../reference/raw/ne/ne_10m_land.geojson');
    if (!r.ok) throw 0;
    const gj = await r.json();
    const land = [];
    const E = MAP_EXTENT, pad = 300000;
    for (const f of gj.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          let inside = false;
          for (const [lon, lat] of ring) if (lat > 30 && lat < 42 && lon > 121 && lon < 134) { inside = true; break; }
          if (!inside) continue;
          const pts = ring.filter(([lon, lat]) => lat > 25 && lat < 46 && lon > 116 && lon < 140).map(([lon, lat]) => toMap(lat, lon))
            .map(([x, y]) => [Math.max(E.x0 - pad, Math.min(E.x1 + pad, x)), Math.max(E.y0 - pad, Math.min(E.y1 + pad, y))]);
          if (pts.length > 3) land.push(pts);
        }
      }
    }
    return { coast: { land, water: [] }, source: 'Natural Earth (dev fallback)' };
  } catch {}
  return { coast: { land: [], water: [] }, source: 'none' };
}

// ---- the mock aircraft ----

const CONF = {
  '0':   { vls: 205, ap: 172, am: 160, vsw: 155, vfe: 235, slat: 0, flap: 0 },
  '1':   { vls: 175, ap: 150, am: 140, vsw: 136, vfe: 225, slat: 18, flap: 0 },
  '1+F': { vls: 160, ap: 140, am: 130, vsw: 126, vfe: 215, slat: 18, flap: 10 },
  '2':   { vls: 150, ap: 130, am: 122, vsw: 118, vfe: 195, slat: 22, flap: 14 },
  '3':   { vls: 140, ap: 122, am: 115, vsw: 111, vfe: 190, slat: 22, flap: 21 },
  FULL:  { vls: 133, ap: 115, am: 108, vsw: 104, vfe: 0,   slat: 27, flap: 25 },
};
const VFE = { '0': 350, '1': 235, '1+F': 225, '2': 215, '3': 195, FULL: 190 };

// n: the engine count (v0.5.0's designs have 2, 3, 4 or 6).
export function makeState(n = 2) {
  return {
    t: 0, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, hdg: 0, pitch: 0, roll: 0, quat: { x: 0, y: 0, z: 0, w: 1 },
    p: 0, q: 0, r: 0, alpha: 0, beta: 0, ias: 0, cas: 0, tas: 0, gs: 0, mach: 0, vs: 0, nz: 1, agl: 0, groundH: 0,
    onGround: true, wow: { nose: true, left: true, right: true }, mass: 78000, fuelKg: 9800, fuel: { left: 4100, right: 4100, center: 1600 }, cgMac: 0.28,
    engines: Array.from({ length: n }, () => ({ n1: 20, n1Target: 20, ffKgS: 0.08, thrustN: 0, rev: 0 })), thrustLever: 0, detent: 'IDLE',
    flapLever: 1, config: '1+F', slatDeg: 18, flapDeg: 10, gearPos: 1, gearDoors: 0, gearCompression: { nose: 0, left: 0, right: 0 },
    steerAngle: 0, wheelRate: { nose: 0, main: 0 },
    surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
    speedbrake: 0, groundSpoilers: 0, brakes: { left: 0, right: 0 }, parkingBrake: false, law: 'normal',
    vls: 0, vmax: 0, vfeNext: 0, vsw: 0, valphaProt: 0, valphaMax: 0,
    warnings: { stall: false, overspeed: false, apDisc: false, sinkRate: false, pullUp: false, tooLowGear: false, master: false }, crashed: null,
  };
}

export function makeAp(state) {
  const ap = {
    ap: false, athr: false, spdKt: 160, hdgDeg: 323, altFt: 5000, vsFpm: 0, lateral: 'HDG', vertical: 'ALT', thrustMode: 'SPEED',
    engageAp() { ap.ap = true; if (!ap.vertical) ap.vertical = 'ALT'; },
    disconnectAp() { ap.ap = false; state.warnings.apDisc = true; setTimeout(() => (state.warnings.apDisc = false), 3000); },
    toggleAthr() { ap.athr = !ap.athr; },
    setAlt(ft) { ap.altFt = ft; }, setHdg(d) { ap.hdgDeg = d; }, setSpd(k) { ap.spdKt = k; },
    setVs(f) { ap.vsFpm = f; ap.vertical = 'V/S'; ap.thrustMode = 'SPEED'; },
    levelChange() { const alt = state.pos.z / FT; ap.vertical = ap.altFt > alt ? 'OP CLB' : 'OP DES'; ap.thrustMode = ap.altFt > alt ? 'THR CLB' : 'THR IDLE'; },
  };
  return ap;
}

// Fill the derived fields (speeds, limits, config surfaces) from the core ones.
export function derive(st, elev = 18) {
  const c = CONF[st.config] || CONF['0'];
  st.vls = c.vls * KT; st.valphaProt = c.ap * KT; st.valphaMax = c.am * KT; st.vsw = c.vsw * KT;
  st.vfeNext = c.vfe * KT; st.vmax = Math.min(VFE[st.config], st.gearPos > 0.01 ? 280 : 350) * KT;
  st.slatDeg = st.slatDeg ?? c.slat; st.flapDeg = st.flapDeg ?? c.flap;
  const rho = Math.exp(-st.pos.z / 9000);
  st.tas = st.ias / Math.sqrt(rho); st.cas = st.ias; st.mach = st.tas / (340 - 0.004 * st.pos.z);
  st.vel.x = Math.sin(st.hdg) * st.tas; st.vel.y = Math.cos(st.hdg) * st.tas; st.vel.z = st.vs;
  st.gs = st.tas;
  st.groundH = elev; st.agl = st.onGround ? 0 : Math.max(0, st.pos.z - 3.9 - elev);
  st.mass = 50100 + 16000 + st.fuelKg;
  return st;
}

// Put the aircraft at a runway end (on the ground) or on its extended centreline (airborne).
export function placeOnFinal(st, end, nm, aboveDeg = 0, offsetM = 0) {
  const h = end.hdgGridDeg * DEG, d = nm * 1852;
  st.pos.x = end.x - Math.sin(h) * d + Math.cos(h) * offsetM;
  st.pos.y = end.y - Math.cos(h) * d - Math.sin(h) * offsetM;
  st.pos.z = end.elevM + Math.tan((3 + aboveDeg) * DEG) * (d + 300);
  st.hdg = h;
}

export { toMap, toGeo, gridToMag, magToGrid };
