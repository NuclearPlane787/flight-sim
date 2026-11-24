// The regions (v0.7.0): East Asia and Europe. One region a page: frame.js takes its constants once, at
// import, from the region the page was opened in, so nothing else needs to know which it is unless it
// loads a file or keeps a list. No DOM and no imports here: frame.js imports this, and it runs in
// workers and node too.
//
// Which region a page is in, in this order:
//   1. `?region=<id>` on the page's URL, or on a worker's own script URL (regionQuery() in region.js
//      adds it, so a worker always gets the page's region and never guesses);
//   2. FS_REGION in node's environment (the tests run both ways);
//   3. on a page only: the last region used (localStorage `gamedump:flight-sim:region`), Europe only
//      once EUROPE_ON is on;
//   4. East Asia.
// Switching region reloads the page into it (switchRegion()), carrying what to start in sessionStorage.
//
// A region's data lives in its own folder with the same layout inside (manifest.json, terrain/,
// airports/, centres/, coast-region.json, urban-region.json, country.*, magvar.*). East Asia's stays
// in data/ itself, where it has been since v0.1.0, so nothing moves in git.

export const DEFAULT_REGION = 'east-asia';
const STORE_KEY = 'gamedump:flight-sim:region';
const CARRY_KEY = 'gamedump:flight-sim:region-carry';

export const REGIONS = {
  'east-asia': {
    id: 'east-asia', name: 'East Asia', data: 'data/', blurb: 'Korea, Japan, China, North Korea and Russia’s far east',
    // Korea's Lambert conformal conic, grown in v0.6.0: origin 36 N 127.5 E, parallels 33 and 38.
    frame: { lat0: 36, lon0: 127.5, lat1: 33, lat2: 38 },
    // The tiles' lattice origin (m): Korea's old south-west corner. Every level's tiles and the 31 m cover count from it.
    lattice: { x0: -400000, y0: -400000 },
    // The ground is never below sea level here: the bake lifts land to 0.5 m and puts the sea under 0, and the
    // game draws and flies max(h, 0).
    lowLand: false,
    // The 1 km level's rectangle (map metres); its outline is that rectangle.
    extent: { x0: -1600000, y0: -1338000, x1: 2110000, y1: 1284000 },
    outlineGeo: null,
    // Before the WMM grid is in (and inside South Korea always): the plane fitted to WMM2025 at
    // Seoul, Busan, Jeju and Gangneung. The same expression as v0.1.0's, to the bit.
    magPlane: (latDeg, lonDeg) => -8.46 - 0.378 * (latDeg - 36) + 0.082 * (lonDeg - 127.5),
    defaultCountry: 'KR',
    // A first flight, and what a plan falls back to when its airports aren't this region's.
    defaultPlan: { origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07' },
    krMask: true,              // data/krmask.*: South Korea keeps its plane exactly (geo-rules.js)
    // v0.7.6 (Shane, 2026-11-22: "Band it", as Europe's): the aurora by latitude: full at 44 N and north of it
    // (Hokkaido's north, Vladivostok's coast nearly), nothing at 40 N and south of it (Sendai, Tokyo, Seoul), smooth
    // between (Aomori faint). Until v0.7.5 it showed on every clear night, as far south as Osaka.
    aurora: { fadeLat: 40, fullLat: 44 },
  },
  europe: {
    id: 'europe', name: 'Europe', data: 'data/europe/', blurb: 'London to Rome, Madrid to Munich',
    // Europe's own cone (briefs/V0-7-0.md): origin 47 N 4 E, parallels 39 and 54 (n about 0.7275).
    // Scale +0.74 % at Gibraltar, -0.85 % at 47 N, +0.54 % at Edinburgh, +1.7 % at 59 N.
    frame: { lat0: 47, lon0: 4, lat1: 39, lat2: 54 },
    lattice: { x0: 0, y0: 0 },   // the frame's origin: tile 0_0's south-west corner is at 47 N 4 E
    // Land below sea level (the Dutch polders, Schiphol at about -3 m): Europe's heights store the sea as exactly
    // 0 m and land never as 0, so the ground is the stored height with no clamp, and exactly 0 is the sea
    // (its manifest says "lowLand": true; tests/v070-eu-terrain.test.mjs checks the two agree).
    lowLand: true,
    // v0.7.4 (Shane, 2026-11-21: "North only"): the aurora by latitude: full at 56 N and north of it (Scotland,
    // Denmark), nothing at 50 N and south of it, smooth between (sky.js). East Asia's own band is v0.7.6's, above.
    aurora: { fadeLat: 50, fullLat: 56 },
    extent: null,              // the outline's bounding rectangle (region.js works it out)
    // The outline, [lat, lon], its edges straight in latitude and longitude (region.js densifies them
    // every 0.25 degrees and projects them): the 1 km land's edge, the map's, and where a predicted path ends.
    outlineGeo: [[35.0, -11.0], [59.0, -11.0], [59.0, 19.5], [42.5, 19.5], [39.6, 18.6],
      [36.3, 16.0], [36.3, 12.0], [37.6, 11.0], [37.6, 1.0], [35.0, -2.5]],
    // Only until the WMM grid is in (the sim waits for it): about +0.8 at London, +3.4 at Frankfurt, -1.5 at Lisbon.
    magPlane: (latDeg, lonDeg) => 2.0 + 0.26 * (lonDeg - 4),
    defaultCountry: 'FR',
    defaultPlan: { origin: 'EGLL', depRunway: '27R', dest: 'LFPG', arrRunway: '26L' },
    placePopScale: 0.4,        // the path map's names: a city counts as one 2.5 times its size does in East Asia
    glass: false,              // no greenhouse country: a built-up speck among fields is a village (finecover.js's glassPatch())
    krMask: false,
  },
};
export const REGION_ORDER = ['east-asia', 'europe'];

function urlParam(name) {
  try {
    const q = (typeof location !== 'undefined' && location && location.search) || '';
    const m = new RegExp('[?&]' + name + '=([A-Za-z0-9-]+)').exec(q);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function envVar(name) {
  try { const v = typeof process !== 'undefined' && process.env ? process.env[name] : undefined; return v === undefined || v === '' ? null : v; } catch (e) { return null; }
}
function stored() {
  try { return typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(STORE_KEY) : null; } catch (e) { return null; }
}
const flag = (v) => (v === '1' ? true : v === '0' ? false : null);

// Europe waited behind this until its terrain was in and Heathrow and Charles de Gaulle had both passed
// their checks (briefs/V0-7-0.md). Off (`?europe=0`, FS_EUROPE=0 in node): the picker doesn't offer Europe and a
// remembered Europe is ignored; `?region=europe` still opens it. On: New scenario asks for the region first.
export const EUROPE_DEFAULT = true;    // on since 05:45 KST on 2026-11-21: batch A is in, and Heathrow and Charles de Gaulle are through the whole check and listed (STATUS.md)
export const EUROPE_ON = flag(urlParam('europe')) ?? flag(envVar('FS_EUROPE')) ?? EUROPE_DEFAULT;
export const regionOffered = (id) => !!REGIONS[id] && (id !== 'europe' || EUROPE_ON);
export const regionsOffered = () => REGION_ORDER.filter(regionOffered);

function pick() {
  const asked = urlParam('region') ?? envVar('FS_REGION');
  if (asked && REGIONS[asked]) return asked;
  const last = stored();
  if (last && regionOffered(last)) return last;
  return DEFAULT_REGION;
}
export const REGION_ID = pick();
export const REGION = REGIONS[REGION_ID];
export const regionId = () => REGION_ID;
export const regionById = (id) => REGIONS[id] || null;
export const regionName = (id) => (REGIONS[id] ? REGIONS[id].name : '');
// A save without a region is East Asia's (every save before v0.7.0). One tagged with a region this build doesn't
// know keeps its tag: it is listed under it and can't be loaded into another region's frame.
export const regionOfSave = (s) => (s && typeof s.region === 'string' && s.region ? s.region : DEFAULT_REGION);

// The region's data folder as a URL, from a module's own URL and the path from it to the game's folder:
//   dataUrl(import.meta.url, '../')  in src/main.js;  '../../' in src/world/ and src/sim/.
export function dataUrl(metaUrl, up = '../') {
  return new URL(up + REGION.data, metaUrl).href;
}

// Remember the region this page is in (main.js, once the game is up), so the next visit opens in it.
export function rememberRegion(id = REGION_ID) {
  try { if (typeof localStorage !== 'undefined' && REGIONS[id]) localStorage.setItem(STORE_KEY, id); } catch (e) { /* private mode: no memory */ }
}
// Reload the page into another region. `carry` (JSON-able: what to start there, such as
// { load: '<scenario id>' } or { newScenario: true }) waits in sessionStorage for takeCarry().
export function switchRegion(id, carry = null) {
  if (!REGIONS[id] || typeof location === 'undefined') return false;
  // (Not remembered here: main.js remembers a region once its page is up, so a region that fails to start can't be
  // the one every later visit opens in. The region rides on the URL instead. The review's finding.)
  try { if (carry) sessionStorage.setItem(CARRY_KEY, JSON.stringify({ region: id, carry })); else sessionStorage.removeItem(CARRY_KEY); } catch (e) { /* the page opens at its menu */ }
  const u = new URL(location.href);
  u.searchParams.set('region', id);
  if (u.href === location.href) location.reload(); else location.replace(u.href);
  return true;
}
// What switchRegion() carried here, once (null if nothing, or if it was meant for another region).
export function takeCarry() {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CARRY_KEY);
    const j = JSON.parse(raw);
    return j && j.region === REGION_ID ? j.carry : null;
  } catch (e) { return null; }
}

// Every region's airports by ICAO: [short name, region]. The home page's ticket, the Load list and the
// logbook name another region's airports from this without loading that region's files. An airport
// joins when it is listed in its region (tests/v070-regions.test.mjs checks it against the manifests).
export const AIRPORT_INDEX = {
  RKSS: ['Gimpo', 'east-asia'], RKSI: ['Incheon', 'east-asia'], RKPC: ['Jeju', 'east-asia'], RKPK: ['Gimhae', 'east-asia'],
  RJTT: ['Haneda', 'east-asia'], RJAA: ['Narita', 'east-asia'], RJBB: ['Kansai', 'east-asia'], RJFF: ['Fukuoka', 'east-asia'],
  RJSN: ['Niigata', 'east-asia'], RJSS: ['Sendai', 'east-asia'], RJSA: ['Aomori', 'east-asia'], RJCC: ['New Chitose', 'east-asia'],
  ZSPD: ['Pudong', 'east-asia'], ZSSS: ['Hongqiao', 'east-asia'], ZSQD: ['Qingdao', 'east-asia'], ZSYN: ['Yancheng', 'east-asia'],
  ZBAA: ['Beijing Capital', 'east-asia'], ZBAD: ['Daxing', 'east-asia'], ZYTX: ['Shenyang', 'east-asia'], ZYTL: ['Dalian', 'east-asia'],
  ZKPY: ['Pyongyang', 'east-asia'], ZKWS: ['Wonsan', 'east-asia'], UHWW: ['Vladivostok', 'east-asia'],
  RKTU: ['Cheongju', 'east-asia'], RKJK: ['Kunsan', 'east-asia'], RJOO: ['Itami', 'east-asia'], RJGG: ['Centrair', 'east-asia'],   // v0.7.5
  RJOA: ['Hiroshima', 'east-asia'], RJNK: ['Komatsu', 'east-asia'],
  EGLL: ['Heathrow', 'europe'], LFPG: ['Charles de Gaulle', 'europe'], EDDF: ['Frankfurt', 'europe'], LEMD: ['Madrid', 'europe'],
  LSZH: ['Zurich', 'europe'], EGKK: ['Gatwick', 'europe'], LFPO: ['Orly', 'europe'], EHAM: ['Schiphol', 'europe'],
  EDDM: ['Munich', 'europe'], LEBL: ['Barcelona', 'europe'], LIRF: ['Fiumicino', 'europe'],
  LFBO: ['Toulouse', 'europe'], EDDB: ['Berlin', 'europe'], LIMC: ['Malpensa', 'europe'], LOWW: ['Vienna', 'europe'],
  EBBR: ['Brussels', 'europe'], EIDW: ['Dublin', 'europe'], LPPT: ['Lisbon', 'europe'], EKCH: ['Copenhagen', 'europe'],
  EGCC: ['Manchester', 'europe'],
  EDDL: ['Düsseldorf', 'europe'], EDDK: ['Cologne Bonn', 'europe'], LKPR: ['Prague', 'europe'], LSGG: ['Geneva', 'europe'],
  LFMN: ['Nice', 'europe'], EGPH: ['Edinburgh', 'europe'], EGPF: ['Glasgow', 'europe'], LFRS: ['Nantes', 'europe'],
  LEST: ['Santiago', 'europe'],
  // v0.7.3: the last eight of Update 7's thirty-seven
  LOWI: ['Innsbruck', 'europe'], LXGB: ['Gibraltar', 'europe'], EDDH: ['Hamburg', 'europe'], LIPZ: ['Venice', 'europe'],
  LFML: ['Marseille', 'europe'], LFLL: ['Lyon', 'europe'], LPPR: ['Porto', 'europe'], LIRN: ['Naples', 'europe'],
  // v0.7.6: Europe's six military bases (Zaragoza a joint civil airport)
  ETAR: ['Ramstein', 'europe'], EGQS: ['Lossiemouth', 'europe'], EGUL: ['Lakenheath', 'europe'], EGVA: ['Fairford', 'europe'],
  LEZG: ['Zaragoza', 'europe'], LERT: ['Rota', 'europe'],
};
// v0.7.9 (Shane: "maybe military bases should be a different color to denote them as such"): each airport's kind, a
// field of the table above kept beside it (so every `[name, region]` entry, and tools/promote-airport.py's insert, stay
// as they were): 'base' for the five air bases with no civil traffic (traffic-layout.js's NO_PARKED: no airliner
// parked there), 'joint' for the four civil airports that share their runways with an air base. Every other airport
// is 'civil'.
export const AIRPORT_KIND = {
  ETAR: 'base', EGUL: 'base', EGVA: 'base', EGQS: 'base', LERT: 'base',
  LEZG: 'joint', RJNK: 'joint', RKJK: 'joint', RKTU: 'joint',
};
export const airportKind = (icao) => AIRPORT_KIND[icao] || 'civil';
export const airportShortName = (icao) => (AIRPORT_INDEX[icao] ? AIRPORT_INDEX[icao][0] : icao || '');
export const airportRegion = (icao) => (AIRPORT_INDEX[icao] ? AIRPORT_INDEX[icao][1] : null);

// A plan's airports in this page's region? (A remembered last flight may be another region's: its map
// coordinates and its airports mean nothing here.) An airport the index doesn't know counts as this region's.
export const planInRegion = (plan) => !!plan && [plan.origin, plan.dest].every((i) => !AIRPORT_INDEX[i] || AIRPORT_INDEX[i][1] === REGION_ID);
// The region's first flight as a plan's start: { origin, depRunway, dest, arrRunway, start: 'runway' }.
export const defaultPlan = () => ({ ...REGION.defaultPlan, start: 'runway' });
