// v0.6.0 Part 0: the "before" stills and numbers, from fixed views and a fixed clock, so later parts can be
// compared exactly (tests/v060-pixdiff.mjs). In Chrome on the Mac's GPU, through the CPU guard, from GameDump:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 20 -- node games/flight-sim/tests/browser-v060-stills.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/ --tag base [--headed] [names or groups: part1 part6 part7 ...]
// v0.6.1: --prefix <p> names the pictures <p>-<tag>-<name>.png (v060 by default); --pending adds ?pending=1 (an airport
// still in the manifest's airportsPending), --nocull ?cull=0 (draw what is out of view too), --q '<more query>' anything else.
// Headless Chrome (ANGLE on Metal) by default; the JSON records the mode and the WebGL renderer string, and marks
// the fps not valid on SwiftShader. Before and after pictures must be made the same way (both headless).
// --base is the URL of the game's folder (the page used is <base>tests/dev-world.html). Writes
// "Claude outputs/flight-sim/v060-<tag>-<name>.png" (read off the canvas in the same task as the draw) and the numbers
// to /tmp/flight-sim/v060/stills/<tag>.json: fps over 3 s, renderer.info.render calls and triangles, the JS heap.
//
// Determinism: dev-world.html's frames come from requestAnimationFrame, which this script replaces before the page
// runs. Until the capture, frames are stepped by hand with a fixed timeline (the first frame dt = 0.1 s, the clamp;
// then exactly 1/60 s), so uTime (water, twinkling lights, runway rabbits, stars) and the traffic are the same
// every run. The clock is fixed by world.sky.setTime() (dev-world never calls it), the exposure as main.js sets
// it; the weather is dev-world's default (clear). Only after the capture does the page run on real frames, for
// the fps.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { toMap } from '../src/world/frame.js';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const JSON_DIR = '/tmp/flight-sim/v060/stills';
const DEG = Math.PI / 180, FT = 0.3048;
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, 0);
const DAY = KST(2026, 11, 19, 13, 0), NIGHT = KST(2026, 11, 19, 22, 0);
const STEPS = 120;          // hand-stepped frames before the capture
// v0.7.0: --total N. The waits below (the centres, the fine cover, the tiles, the clip window) step a frame every
// 4 ms until what they wait for has loaded, so how many frames have passed at the capture depended on how fast the
// files came: the shaders' clock (the sea's sparkle, the lights' twinkle) differed between two runs of the same build
// wherever something had to load (found on 2026-11-21: five East Asian views didn't repeat in v0.6.4 itself). With
// --total the script steps on, after the waits, until exactly N frames have passed at the capture, whatever the
// waits took; a wait that took more than N says so. Without it the script is as it was.
const FPS_MS = 3000;

// A view looking at a ground point: the camera stands back along the heading so the point is in the middle of
// the frame at that pitch (aglFt above the point's ground, flat-ground geometry).
function look(lat, lon, aglFt, hdg, pitch) {
  const [tx, ty] = toMap(lat, lon), d = (aglFt * FT) / Math.tan(-pitch * DEG);
  const x = tx - d * Math.sin(hdg * DEG), y = ty - d * Math.cos(hdg * DEG);
  return `x=${x.toFixed(1)}&y=${y.toFixed(1)}&agl=${aglFt}&hdg=${hdg}&pitch=${pitch}&aglAt=${tx.toFixed(1)},${ty.toFixed(1)}`;
}
const PITCH = { 1000: -14, 3000: -20, 10000: -28 };

export const SHOTS = {};
// Part 1: Korea in tiles against v0.5.8.
SHOTS['gimpo-day'] = { q: 'app=RKSS:14R&ft=1200&pitch=-4.5', ms: DAY };
SHOTS['jeju-day'] = { q: 'app=RKPC:07&ft=1500&pitch=-4', ms: DAY };
SHOTS['incheon-day'] = { q: 'app=RKSI:33L&ft=1500&pitch=-4', ms: DAY };
SHOTS['seoul-night'] = { q: 'lat=37.505&lon=126.93&alt=3000&hdg=75&pitch=-14', ms: NIGHT };
// Part 6: Seoul's dense centres.
const CENTRES = { jamsil: [37.5125, 127.1000, 60], yeouido: [37.5250, 126.9250, 75], centre: [37.5665, 126.9780, 0] };
for (const [k, [la, lo, h]] of Object.entries(CENTRES)) {
  for (const ft of [3000, 10000]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`seoul-${k}-${ft}-${tod}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms };
  }
}
// Part 7: the ground.
// (The brief's 37.55N 126.55E is open sea in the game's map and 33.40N 126.75E Hallasan's forested foothills, so
// the targets are moved onto the farmland nearby: Gimpo's plain north-west of the airport, Jeju's eastern fields.)
const GROUND = { 'west-gimpo': [37.68, 126.47, 0], 'nakdong': [35.13, 128.90, 200], 'jeju-farm': [33.45, 126.83, 90] };
for (const [k, [la, lo, h]] of Object.entries(GROUND)) {
  for (const ft of [1000, 3000, 10000]) SHOTS[`ground-${k}-${ft}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms: DAY };
}
// The region (the evening sitting): --region puts ?eastasia=1 on the page and waits for the tiles
// (the store's round the camera, then the clip window's blocks) before the fixed timeline starts.
const FL350 = 35000;
SHOTS['world-fl350-kanto'] = { q: 'lat=35.75&lon=137.6&alt=35000&hdg=95&pitch=-9', ms: DAY };            // the Alps, Fuji, the Kanto plain and Tokyo ahead
SHOTS['world-fl350-seoul-east'] = { q: 'lat=37.45&lon=126.6&alt=35000&hdg=95&pitch=-9', ms: DAY };       // over Incheon, Seoul and the east coast ahead
SHOTS['world-fl350-shanghai-west'] = { q: 'lat=31.2&lon=122.6&alt=35000&hdg=270&pitch=-8', ms: DAY };    // Shanghai and inland China: no edge
SHOTS['world-fl350-nk-north'] = { q: 'lat=38.6&lon=126.8&alt=35000&hdg=10&pitch=-8', ms: DAY };          // North Korea to the Yalu and beyond: no edge
SHOTS['world-fl350-kyushu'] = { q: 'lat=34.6&lon=128.9&alt=35000&hdg=140&pitch=-10', ms: DAY };          // the old square's band: Tsushima, Kyushu
SHOTS['world-fl350-dmz'] = { q: 'lat=37.35&lon=127.4&alt=35000&hdg=345&pitch=-12', ms: DAY };            // the DMZ from cruise
SHOTS['world-fl350-kansai'] = { q: 'lat=34.2&lon=133.6&alt=35000&hdg=80&pitch=-10', ms: DAY };           // the Seto Inland Sea to Osaka Bay
SHOTS['world-fuji-15000'] = { q: 'lat=35.25&lon=138.25&alt=15000&hdg=75&pitch=-4', ms: DAY };            // Fuji from the west
SHOTS['world-3000-tokyo'] = { q: look(35.675, 139.76, 3000, 20, -12), ms: DAY };
SHOTS['world-3000-tokyo-night'] = { q: look(35.675, 139.76, 3000, 20, -12), ms: NIGHT };
SHOTS['world-3000-pudong'] = { q: look(31.2, 121.6, 3000, 285, -12), ms: DAY };
SHOTS['world-3000-shanghai-night'] = { q: look(31.235, 121.5, 3000, 285, -12), ms: NIGHT };
SHOTS['world-10000-osaka'] = { q: look(34.69, 135.5, 10000, 30, -20), ms: DAY };
SHOTS['world-10000-fukuoka'] = { q: look(33.59, 130.4, 10000, 160, -20), ms: DAY };
SHOTS['world-10000-busan'] = { q: look(35.16, 129.06, 10000, 30, -20), ms: DAY };
const FINALS = { ZSPD: '35L', RJTT: '34L', RJAA: '34L', RKPK: '36L', ZSSS: '36R', RJBB: '06R', RJFF: '16L', ZSQD: '34', ZSYN: '04', ZBAA: '36R', ZBAD: '35L', UHWW: '25L', ZYTX: '24', ZYTL: '28', RJCC: '19R', RJSA: '24', ZKPY: '17', ZKWS: '15R', RJSS: '27', RJSN: '28' };   // (the last six: v0.6.4)   // (ZSYN: v0.6.1; ZBAA, ZBAD: v0.6.3)
for (const [icao, end] of Object.entries(FINALS)) {
  SHOTS[`${icao}-final`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: DAY };
  SHOTS[`${icao}-final-night`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: NIGHT };
}
// Part 6's "Done when": the six cities from 3,000 ft and FL350, by day and by night (--region --cities).
const CITY6 = { tokyo: [35.672, 139.755, 20], shanghai: [31.237, 121.497, 285], seoul: [37.525, 126.925, 75], busan: [35.161, 129.150, 40], osaka: [34.690, 135.500, 20], fukuoka: [33.590, 130.400, 160] };
for (const [k, [la, lo, h]] of Object.entries(CITY6)) {
  for (const [alt, pitch] of [[3000, -12], [35000, -38]]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`cities-${k}-${alt === 3000 ? '3000' : 'fl350'}-${tod}`] = { q: look(la, lo, alt, h, pitch), ms };
  }
}
// The definition of done's two views, and the ground close to the camera far from the map's origin
// (briefs/V0-6-0.md, "Precision far from the origin": Narita is 1,160 km east of it, Gimpo 60 km west).
SHOTS['fuji-haneda-arrival'] = { q: 'lat=35.30&lon=139.62&alt=9000&hdg=268&pitch=-3', ms: DAY };          // Fuji from the arrival over Sagami Bay
SHOTS['gimhae-approach'] = { q: 'lat=35.02&lon=128.925&alt=3500&hdg=2&pitch=-6', ms: DAY };               // Gimhae's runways under Sineosan and Geumjeongsan
SHOTS['close-rkss'] = { q: 'rwy=RKSS:14R&back=150&eye=9&pitch=-14&hdg=176', ms: DAY };
SHOTS['close-rjaa'] = { q: 'rwy=RJAA:34L&back=150&eye=9&pitch=-14&hdg=10', ms: DAY };
SHOTS['close-rjtt'] = { q: 'rwy=RJTT:34L&back=150&eye=9&pitch=-14&hdg=20', ms: DAY };
SHOTS['close-zspd'] = { q: 'rwy=ZSPD:34L&back=150&eye=9&pitch=-14&hdg=20', ms: DAY };
const GROUND2 = { kanto: [36.05, 140.05, 30], yangtze: [31.25, 120.85, 280], kyushu: [33.2, 130.45, 0] };
for (const [k, [la, lo, h]] of Object.entries(GROUND2)) {
  for (const ft of [1000, 3000, 10000]) SHOTS[`ground-${k}-${ft}`] = { q: look(la, lo, ft, h, PITCH[ft]), ms: DAY };
}
// Looking almost straight down on woods and a lake (Pyeongchang): the tree rings from above.
for (const ft of [800, 1500, 2500, 5000]) SHOTS[`down-pyeongchang-${ft}`] = { q: look(37.3817, 128.4023, ft, 0, -80), ms: DAY };
// Hillside farmland (Part 7 step 2's terraces): Namhae's south coast and the Boso hills.
SHOTS['terrace-namhae-1000'] = { q: look(34.745, 127.90, 1000, 200, -14), ms: DAY };
SHOTS['terrace-namhae-3000'] = { q: look(34.745, 127.90, 3000, 200, -20), ms: DAY };
SHOTS['terrace-boso-1000'] = { q: look(35.12, 140.03, 1000, 90, -14), ms: DAY };
SHOTS['terrace-hadong-1000'] = { q: look(35.17, 127.70, 1000, 0, -14), ms: DAY };
for (const k of ['west-gimpo', 'kanto', 'yangtze']) SHOTS[`ground-${k}-1000-night`] = { q: SHOTS[`ground-${k}-1000`].q, ms: NIGHT };
// v0.6.1: the greenhouses' tunnels, low over the Nakdong delta's and Gimpo's plain's glass, and from straight above.
// v0.6.1: Gimhae's 18R, its landing threshold displaced 600 m (Korea's eAIP), from 500 ft on the approach and from 150 ft over the pavement's end.
SHOTS['RKPK-18R-final'] = { q: 'app=RKPK:18R&ft=500&pitch=-5', ms: DAY };
SHOTS['RKPK-18R-final-night'] = { q: 'app=RKPK:18R&ft=500&pitch=-5', ms: NIGHT };
SHOTS['RKPK-36L-final-night'] = { q: 'app=RKPK:36L&ft=500&pitch=-5', ms: NIGHT };
// v0.6.1: the aprons from above (the ground between an apron's pieces and round the remote stands), and the bare
// ground of the Nakdong delta's new town from low.
SHOTS['apron-rkpk'] = { q: 'x=131300&y=-90750&agl=600&hdg=30&pitch=-35', ms: DAY };
SHOTS['apron-rkpk-south'] = { q: 'x=130850&y=-91950&agl=500&hdg=25&pitch=-32', ms: DAY };
SHOTS['apron-zsyn'] = { q: 'x=-677750&y=-259750&agl=500&hdg=45&pitch=-30', ms: DAY };
SHOTS['bare-nakdong-500'] = { q: look(35.13, 128.90, 500, 200, -18), ms: DAY };
SHOTS['gh-pyeongchang-250'] = { q: look(37.3817, 128.4023, 250, 0, -14), ms: DAY };
SHOTS['gh-pyeongchang-600'] = { q: look(37.3817, 128.4023, 600, 40, -25), ms: DAY };
SHOTS['gh-nakdong-300'] = { q: look(35.13, 128.90, 300, 200, -16), ms: DAY };
SHOTS['gh-nakdong-600'] = { q: look(35.13, 128.90, 600, 200, -22), ms: DAY };
SHOTS['gh-nakdong-down-1200'] = { q: look(35.13, 128.90, 1200, 0, -80), ms: DAY };
SHOTS['gh-gimpo-300'] = { q: look(37.68, 126.47, 300, 0, -16), ms: DAY };
SHOTS['gh-gimpo-down-1200'] = { q: look(37.68, 126.47, 1200, 0, -80), ms: DAY };
const GROUPS = {
  dod: ['fuji-haneda-arrival', 'gimhae-approach'],
  down: [800, 1500, 2500, 5000].map((ft) => `down-pyeongchang-${ft}`),
  terraces: ['terrace-namhae-1000', 'terrace-namhae-3000', 'terrace-boso-1000', 'terrace-hadong-1000'],
  close: ['close-rkss', 'close-rjaa', 'close-rjtt', 'close-zspd'],
  cities6: Object.keys(SHOTS).filter((n) => n.startsWith('cities-')),
  'cities6-3000': Object.keys(SHOTS).filter((n) => n.startsWith('cities-') && n.includes('-3000-')),
  ground2: Object.keys(GROUND2).flatMap((k) => [1000, 3000, 10000].map((ft) => `ground-${k}-${ft}`)),
  region: Object.keys(SHOTS).filter((n) => n.startsWith('world-')),
  finals: Object.keys(FINALS).map((i) => `${i}-final`),
  'finals-night': Object.keys(FINALS).map((i) => `${i}-final-night`),
  part1: ['gimpo-day', 'jeju-day', 'incheon-day', 'seoul-night'],
  part6: Object.keys(SHOTS).filter((n) => n.startsWith('seoul-') && n !== 'seoul-night'),
  part7: Object.keys(SHOTS).filter((n) => n.startsWith('ground-')),
  gh: Object.keys(SHOTS).filter((n) => n.startsWith('gh-')),
};

// v0.6.3 Part 5 (--region --cities): the five new centres from 3,000 ft and FL350, and each new landmark
// close (a ground point and the heading to look along), by day and by night. Their own groups, after
// GROUPS's filters, so cities6 stays the six.
const CITY063 = { beijing: [39.912, 116.42, 75], tianjin: [39.115, 117.20, 30], shenyang: [41.795, 123.43, 0], dalian: [38.915, 121.63, 300], vladivostok: [43.112, 131.90, 340] };
for (const [k, [la, lo, h]] of Object.entries(CITY063)) {
  for (const [alt, pitch] of [[3000, -12], [35000, -38]]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`cities-${k}-${alt === 3000 ? '3000' : 'fl350'}-${tod}`] = { q: look(la, lo, alt, h, pitch), ms };
  }
}
const LANDMARK063 = {
  citic: [39.91150, 116.46024, 2500, 30, -7], cctv: [39.91381, 116.45797, 1500, 225, -8], russky: [43.06333, 131.90786, 1500, 316, -5],
  zolotoy: [43.10885, 131.89624, 1200, 268, -6], cctvtower: [39.91818, 116.30030, 2000, 270, -6], tjtower: [39.09192, 117.17534, 2000, 200, -6],
  lntower: [41.78039, 123.42795, 1500, 0, -6],
};
for (const [k, [la, lo, ft, h, pitch]] of Object.entries(LANDMARK063)) {
  for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`landmark-${k}-${tod}`] = { q: look(la, lo, ft, h, pitch), ms };
}
GROUPS['cities-v063'] = Object.keys(CITY063).flatMap((k) => ['3000', 'fl350'].flatMap((a) => ['day', 'night'].map((t) => `cities-${k}-${a}-${t}`)));
GROUPS['landmarks-v063'] = Object.keys(LANDMARK063).flatMap((k) => ['day', 'night'].map((t) => `landmark-${k}-${t}`));

// v0.6.4 (--region --cities): the four new centres from 3,000 ft and FL350, and each new landmark from close
// enough to judge (v0.6.3's were too far): the camera k x its height back along the heading, at 0.55 of its
// height above the landmark's ground, looking level at its middle; with the 55° lens it fills about 40 % of
// the frame's height at k = 2.4 (at least a fifth up to k of about 5).
function near(lat, lon, H, hdg, k = 2.4) {
  const [tx, ty] = toMap(lat, lon), D = k * H, A = 0.55 * H;
  const x = tx - D * Math.sin(hdg * DEG), y = ty - D * Math.cos(hdg * DEG);
  const pitch = Math.atan2(0.5 * H - A, D) / DEG;
  return `x=${x.toFixed(1)}&y=${y.toFixed(1)}&agl=${(A / FT).toFixed(0)}&hdg=${hdg}&pitch=${pitch.toFixed(2)}&aglAt=${tx.toFixed(1)},${ty.toFixed(1)}`;
}
const CITY064 = { pyongyang: [39.022, 125.750, 60], sapporo: [43.062, 141.350, 340], sendai: [38.262, 140.875, 300], niigata: [37.917, 139.052, 30] };
for (const [k, [la, lo, h]] of Object.entries(CITY064)) {
  for (const [alt, pitch] of [[3000, -12], [35000, -38]]) {
    for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`cities-${k}-${alt === 3000 ? '3000' : 'fl350'}-${tod}`] = { q: look(la, lo, alt, h, pitch), ms };
  }
}
// [lat, lon, height m, heading to look along]: the hotel from the south-south-west (two wings' slopes and the
// third's edge), the Juche Tower from over the Taedong to its west, the TV tower from down Odori Park to its
// west, the Daikannon from the south-east (the way it faces [EST]).
const LANDMARK064 = {
  ryugyong: [39.036518, 125.730868, 330, 20], juche: [39.017636, 125.763590, 170, 90],
  sapporotv: [43.061113, 141.356448, 147.2, 90], daikannon: [38.300502, 140.823634, 100, 315],
};
// (The lead's, 2026-11-21: the Sapporo TV Tower's level view down Odori Park came out behind the centre's blocks, so
// one more from above: three heights back and 1.3 heights up, looking down at its middle.)
{
  const [la, lo, H, h] = [43.061113, 141.356448, 147.2, 250];
  const [tx, ty] = toMap(la, lo), D = 3 * H, A = 1.3 * H;
  const x = tx - D * Math.sin(h * DEG), y = ty - D * Math.cos(h * DEG), pitch = Math.atan2(0.5 * H - A, D) / DEG;
  for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`landmark-sapporotv-high-${tod}`] = { q: `x=${x.toFixed(1)}&y=${y.toFixed(1)}&agl=${(A / FT).toFixed(0)}&hdg=${h}&pitch=${pitch.toFixed(2)}&aglAt=${tx.toFixed(1)},${ty.toFixed(1)}`, ms };
}
for (const [k, [la, lo, H, h]] of Object.entries(LANDMARK064)) {
  for (const [tod, ms] of [['day', DAY], ['night', NIGHT]]) SHOTS[`landmark-${k}-${tod}`] = { q: near(la, lo, H, h), ms };
}
GROUPS['cities-v064'] = Object.keys(CITY064).flatMap((k) => ['3000', 'fl350'].flatMap((a) => ['day', 'night'].map((t) => `cities-${k}-${a}-${t}`)));
GROUPS['landmarks-v064'] = Object.keys(LANDMARK064).flatMap((k) => ['day', 'night'].map((t) => `landmark-${k}-${t}`));

// v0.7.0: Europe (run with FS_REGION=europe in the environment, so toMap() here is Europe's, and --q '&region=europe'
// so the page is; East Asia's shots above mean nothing in that frame). Part 3's "a flight over it": FL350 from London
// towards Madrid, 3,000 ft over London and over the Alps near Zurich; then the polders (land below the sea), Paris, the
// Pyrenees and Rome's coast.
const EU_DAY = Date.UTC(2026, 10, 19, 12, 0), EU_NIGHT = Date.UTC(2026, 10, 19, 21, 0);   // 12:00 and 21:00 UTC: early afternoon and night across Europe
// Each of Europe's airports from 1,000 ft on its final (with ?pending=1 until it is listed).
const EU_FINALS = { EGLL: '27R', LFPG: '26L', EDDF: '25C', LEMD: '32L', LSZH: '14', EGKK: '26L', LFPO: '25', EHAM: '18R', EDDM: '26R', LEBL: '24R', LIRF: '16R',
  LFBO: '14R', EDDB: '24L', LIMC: '35R', LOWW: '29', EBBR: '25L', EIDW: '28L', LPPT: '02', EKCH: '22L', EGCC: '23R' };   // v0.7.1: Toulouse to Manchester
for (const [icao, end] of Object.entries(EU_FINALS)) {
  SHOTS[`${icao}-final`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: EU_DAY };
  SHOTS[`${icao}-final-night`] = { q: `app=${icao}:${end}&ft=1000&pitch=-4`, ms: EU_NIGHT };
}
SHOTS['eu-fl350-london-south'] = { q: 'lat=51.6&lon=-0.2&alt=35000&hdg=195&pitch=-9', ms: EU_DAY };      // London below, the Channel and France ahead
SHOTS['eu-fl350-biscay-madrid'] = { q: 'lat=44.2&lon=-2.6&alt=35000&hdg=190&pitch=-9', ms: EU_DAY };     // the Bay of Biscay's coast, the Cantabrian range, the meseta
SHOTS['eu-fl350-alps'] = { q: 'lat=47.9&lon=8.5&alt=35000&hdg=170&pitch=-10', ms: EU_DAY };              // Zurich, the lakes, the Alps and the Po plain beyond
SHOTS['eu-fl350-paris'] = { q: look(48.86, 2.35, 35000, 0, -38), ms: EU_DAY };
SHOTS['eu-3000-london'] = { q: look(51.507, -0.10, 3000, 80, -12), ms: EU_DAY };
SHOTS['eu-3000-london-night'] = { q: look(51.507, -0.10, 3000, 80, -12), ms: EU_NIGHT };
SHOTS['eu-3000-alps-zurich'] = { q: look(47.02, 8.65, 3000, 170, -6), ms: EU_DAY };                      // south of Zurich's lake, the Alps ahead
SHOTS['eu-3000-paris'] = { q: look(48.86, 2.33, 3000, 60, -12), ms: EU_DAY };
SHOTS['eu-3000-polders'] = { q: look(52.31, 4.76, 3000, 20, -14), ms: EU_DAY };                          // Haarlemmermeer: land below the sea
SHOTS['eu-1000-polders'] = { q: look(52.33, 4.70, 1000, 300, -10), ms: EU_DAY };                         // towards the dunes and the North Sea
SHOTS['eu-10000-thames'] = { q: look(51.48, 0.3, 10000, 270, -20), ms: EU_DAY };                         // up the estuary to London
SHOTS['eu-10000-barcelona'] = { q: look(41.38, 2.17, 10000, 320, -20), ms: EU_DAY };
SHOTS['eu-10000-rome'] = { q: look(41.85, 12.35, 10000, 60, -20), ms: EU_DAY };
SHOTS['eu-fl350-edge-vienna'] = { q: 'lat=48.0&lon=14.0&alt=35000&hdg=90&pitch=-9', ms: EU_DAY };        // beyond batch A, the 1 km level to the east edge
// v0.7.1: Europe's fields by country (ground.js's euGroundGlsl()): each kind from 1,500 ft, and two from 400 ft.
SHOTS['eu-fields-weald'] = { q: look(51.05, -0.50, 1500, 270, -14), ms: EU_DAY };                         // hedged fields, England
SHOTS['eu-fields-weald-low'] = { q: look(51.05, -0.50, 400, 270, -10), ms: EU_DAY };
SHOTS['eu-fields-meath'] = { q: look(53.50, -6.55, 1500, 300, -14), ms: EU_DAY };                         // hedged fields, Ireland
SHOTS['eu-fields-normandy'] = { q: look(49.00, -0.30, 1500, 250, -14), ms: EU_DAY };                      // the bocage (beyond the 31 m cover)
SHOTS['eu-fields-beauce'] = { q: look(48.35, 1.75, 1500, 200, -14), ms: EU_DAY };                         // big open fields, south-west of Paris
SHOTS['eu-fields-beauce-low'] = { q: look(48.35, 1.75, 400, 200, -10), ms: EU_DAY };
SHOTS['eu-fields-brandenburg'] = { q: look(52.25, 13.25, 1500, 250, -14), ms: EU_DAY };                   // open fields and pines, by Berlin
SHOTS['eu-fields-mancha'] = { q: look(40.15, -3.45, 1500, 180, -14), ms: EU_DAY };                        // dry fields and olives, south of Madrid
SHOTS['eu-fields-alentejo'] = { q: look(38.75, -8.75, 1500, 90, -14), ms: EU_DAY };                       // dry fields and olives, east of Lisbon
SHOTS['eu-fields-alentejo-low'] = { q: look(38.75, -8.75, 400, 90, -10), ms: EU_DAY };
SHOTS['eu-fields-polder-low'] = { q: look(52.33, 4.70, 400, 300, -10), ms: EU_DAY };                      // the polders' strips and ditches
SHOTS['eu-fields-leon'] = { q: 'lat=42.55&lon=-5.55&alt=6000&hdg=180&pitch=-14', ms: EU_DAY };   // (6,000 ft above the sea, about 3,200 ft above the plateau: look()'s height above the ground reads 0 beyond the 250 m data)                         // the northern Meseta: dry (the review's finding: it was hedged)
SHOTS['eu-fields-fl350-spain'] = { q: 'lat=41.6&lon=-3.4&alt=35000&hdg=200&pitch=-12', ms: EU_DAY };      // the meseta's far colour
SHOTS['eu-fields-fl350-ireland'] = { q: 'lat=53.4&lon=-5.6&alt=35000&hdg=270&pitch=-12', ms: EU_DAY };    // Ireland's far colour
// v0.7.1: Airbus's halls at Toulouse (the airport's own buildings), and where Brussels's 01/19 meets 07L/25R's east end.
SHOTS['eu-toulouse-airbus-north'] = { q: look(43.645, 1.385, 1200, 300, -14), ms: EU_DAY };                // the Lagardère plant
SHOTS['eu-toulouse-airbus-west'] = { q: look(43.625, 1.378, 1200, 250, -14), ms: EU_DAY };                 // Saint-Martin-du-Touch and the Clément Ader halls
SHOTS['eu-ebbr-19-low'] = { q: 'app=EBBR:19&ft=300&pitch=-8', ms: EU_DAY };
SHOTS['eu-ebbr-25R-low'] = { q: 'app=EBBR:25R&ft=300&pitch=-8', ms: EU_DAY };
GROUPS['eu-fields'] = Object.keys(SHOTS).filter((k) => k.startsWith('eu-fields-')).concat(['eu-1000-polders', 'eu-3000-polders', 'eu-3000-nofine-dijon']);
// A hole in the 31 m cover inside the 250 m data (it is baked only within 100 km of an airport): Dijon has none, and
// Reims lies on its edge, 108 km from Charles de Gaulle. The ground there draws from the 250 m cover.
SHOTS['eu-3000-nofine-dijon'] = { q: look(47.32, 5.04, 3000, 20, -14), ms: EU_DAY };
SHOTS['eu-1000-nofine-dijon'] = { q: look(47.36, 5.10, 1000, 60, -10), ms: EU_DAY };
SHOTS['eu-3000-fine-edge-reims'] = { q: look(49.20, 3.85, 3000, 250, -12), ms: EU_DAY };
SHOTS['eu-10000-fine-edge-reims'] = { q: look(49.20, 3.85, 10000, 250, -20), ms: EU_DAY };
GROUPS['europe-nofine'] = ['eu-3000-nofine-dijon', 'eu-1000-nofine-dijon', 'eu-3000-fine-edge-reims', 'eu-10000-fine-edge-reims'];
// Part 6: Europe's nine real centres from 3,000 ft (and London, Paris and Barcelona by night and from FL350).
const EU_CENTRES = { london: [51.507, -0.10, 80], paris: [48.868, 2.31, 70], frankfurt: [50.111, 8.672, 20], madrid: [40.45, -3.69, 10], zurich: [47.372, 8.54, 330],
  amsterdam: [52.372, 4.893, 20], munich: [48.14, 11.572, 340], barcelona: [41.39, 2.165, 315], rome: [41.90, 12.48, 300] };
for (const [k, [la, lo, h]] of Object.entries(EU_CENTRES)) {
  SHOTS[`eu-centre-${k}-3000-day`] = { q: look(la, lo, 3000, h, -12), ms: EU_DAY };
  SHOTS[`eu-centre-${k}-3000-night`] = { q: look(la, lo, 3000, h, -12), ms: EU_NIGHT };
  SHOTS[`eu-centre-${k}-fl350-day`] = { q: look(la, lo, 35000, h, -38), ms: EU_DAY };
  SHOTS[`eu-centre-${k}-fl350-night`] = { q: look(la, lo, 35000, h, -38), ms: EU_NIGHT };
}
// v0.7.1: nine more centres, each from 3,000 ft by day, and Berlin, Vienna and Lisbon by night.
const EU_CENTRES_071 = { toulouse: [43.598, 1.455, 320], berlin: [52.505, 13.39, 30], milan: [45.455, 9.195, 330], vienna: [48.198, 16.385, 320], brussels: [50.838, 4.365, 330],
  dublin: [53.338, -6.24, 300], lisbon: [38.70, -9.125, 330], copenhagen: [55.668, 12.60, 320], manchester: [53.470, -2.225, 300] };
for (const [k, [la, lo, h]] of Object.entries(EU_CENTRES_071)) {
  SHOTS[`eu-centre-${k}-3000-day`] = { q: look(la, lo, 3000, h, -12), ms: EU_DAY };
  SHOTS[`eu-centre-${k}-3000-night`] = { q: look(la, lo, 3000, h, -12), ms: EU_NIGHT };
}
GROUPS['europe-centres-071'] = Object.keys(EU_CENTRES_071).map((k) => `eu-centre-${k}-3000-day`).concat(['berlin', 'vienna', 'lisbon'].map((k) => `eu-centre-${k}-3000-night`));
GROUPS['europe-centres'] = Object.keys(EU_CENTRES).map((k) => `eu-centre-${k}-3000-day`).concat(['london', 'paris', 'barcelona'].map((k) => `eu-centre-${k}-3000-night`));
GROUPS['europe-centres-all'] = Object.keys(SHOTS).filter((n) => n.startsWith('eu-centre-'));
// Part 6: Europe's landmarks close (a ground point, the model's height and the heading to look along, as its
// subagent's notes give them), by day and by night.
const EU_LANDMARKS = { shard: [51.49958, -0.09440, 309.6, 45], westminster: [51.49874, -0.11786, 98.5, 280], eye: [51.50520, -0.12594, 135, 115], stpauls: [51.50958, -0.10077, 111, 20],
  towerbridge: [51.50560, -0.08252, 65, 90], eiffel: [48.86355, 2.28668, 330, 136], arc: [48.86974, 2.29203, 49.54, 26], sacrecoeur: [48.88222, 2.34306, 84, 0], notredame: [48.84884, 2.34767, 96, 20],
  grandearche: [48.89067, 2.24216, 110, 296], commerzbank: [50.10577, 8.67126, 258.7, 20], messeturm: [50.10646, 8.65278, 256.5, 0], europaturm: [50.12770, 8.65472, 337.5, 0],
  cepsa: [40.47556, -3.69511, 248.3, 90], cristal: [40.47806, -3.69457, 249, 90], caleido: [40.47450, -3.69400, 181, 90], kio: [40.46190, -3.68778, 114, 0],
  grossmunster: [47.37014, 8.53736, 64, 90], primetower: [47.38151, 8.51720, 126, 0], olympiaturm: [48.16790, 11.55361, 291, 0], frauenkirche: [48.13861, 11.56716, 98.5, 90],
  sagrada: [41.40051, 2.17010, 172.5, 45], glories: [41.40029, 2.18543, 144.4, 45], collserola: [41.41264, 2.12028, 288.4, 315], stpeters: [41.90222, 12.45984, 136.6, 270], colosseum: [41.88608, 12.49014, 48, 20] };
for (const [k, [la, lo, H, h]] of Object.entries(EU_LANDMARKS)) {
  for (const [tod, ms] of [['day', EU_DAY], ['night', EU_NIGHT]]) SHOTS[`eu-landmark-${k}-${tod}`] = { q: near(la, lo, H, h), ms };
}
// v0.7.1: fifteen more (the landmarks' subagent's camera points), by day and by night, and each from above by day.
const EU_LANDMARKS_071 = { fernsehturm: [52.51150, 13.40386, 368, 20], brandenburg: [52.51630, 13.38657, 26, 270], stephansdom: [48.20343, 16.37023, 136.7, 20], donauturm: [48.23320, 16.41083, 252, 0],
  riesenrad: [48.21935, 16.38894, 64.75, 120], duomo: [45.46070, 9.18550, 108.5, 50], ponte25: [38.68613, -9.19378, 190, 77], cristorei: [38.67321, -9.17134, 110, 0], vascodagama: [38.78731, -9.06857, 150, 213],
  oresund: [55.56610, 12.81744, 204, 20], torso: [55.60826, 12.97284, 190, 20], poolbeg: [53.33400, -6.18982, 207.8, 0], palaisjustice: [50.83160, 4.34875, 116, 20], lovell: [53.23110, -2.30840, 89, 0],
  rocket: [43.58314, 1.49843, 53, 315] };
for (const [k, [la, lo, H, h]] of Object.entries(EU_LANDMARKS_071)) {
  for (const [tod, ms] of [['day', EU_DAY], ['night', EU_NIGHT]]) SHOTS[`eu-landmark-${k}-${tod}`] = { q: near(la, lo, H, h), ms };
  SHOTS[`eu-landmark-${k}-above-day`] = { q: look(la, lo, 1300, h, -28), ms: EU_DAY };
}
SHOTS['eu-landmark-brandenburg-close-day'] = { q: look(52.5163, 13.3822, 450, 270, -14), ms: EU_DAY };   // from over Unter den Linden, 300 m east of the gate (the level view sits on a roof)
GROUPS['europe-landmarks-071'] = Object.keys(EU_LANDMARKS_071).flatMap((k) => [`eu-landmark-${k}-day`, `eu-landmark-${k}-above-day`]).concat(['fernsehturm', 'ponte25', 'oresund', 'riesenrad', 'poolbeg'].map((k) => `eu-landmark-${k}-night`));
// The low landmarks from above (in a level view the centre's blocks hide them, as the Sapporo TV Tower was hidden): the
// camera 1,300 ft over the landmark's ground, looking down at it along its heading.
for (const k of ['arc', 'colosseum', 'westminster', 'towerbridge', 'notredame', 'stpauls', 'grossmunster', 'primetower', 'sacrecoeur', 'frauenkirche']) {
  const [la, lo, , h] = EU_LANDMARKS[k];
  SHOTS[`eu-landmark-${k}-above-day`] = { q: look(la, lo, 1300, h, -28), ms: EU_DAY };
  SHOTS[`eu-landmark-${k}-above-night`] = { q: look(la, lo, 1300, h, -28), ms: EU_NIGHT };
}
SHOTS['eu-fl350-alps-night'] = { q: SHOTS['eu-fl350-alps'].q, ms: EU_NIGHT };
SHOTS['eu-3000-alps-zurich-night'] = { q: SHOTS['eu-3000-alps-zurich'].q, ms: EU_NIGHT };
// Schiphol's patch at its deepest (GLO-30's -19.5 m over about 0.6 km2 at 52.3126 N 4.9448 E, 11 km east of the field,
// where a stadium stands: radar noise at a big building, not ground). Looked at before Schiphol was listed.
SHOTS['eu-eham-deep'] = { q: look(52.3126, 4.9448, 1500, 0, -28), ms: EU_DAY };
SHOTS['eu-eham-deep-low'] = { q: look(52.3126, 4.9448, 500, 90, -12), ms: EU_DAY };
// A town by night, for the church without lit floors (cities.js's fourth splice).
SHOTS['eu-3000-nofine-dijon-night'] = { q: SHOTS['eu-3000-nofine-dijon'].q, ms: EU_NIGHT };
SHOTS['eu-1000-nofine-dijon-night'] = { q: SHOTS['eu-1000-nofine-dijon'].q, ms: EU_NIGHT };
// The definition of done's pictures still to take in the morning: the low landmarks from above; London and Paris from
// FL350 by day and night; the Alps by night from FL350 and from 3,000 ft.
GROUPS['europe-morning'] = ['arc', 'colosseum', 'westminster', 'towerbridge', 'notredame', 'stpauls', 'grossmunster', 'primetower', 'sacrecoeur', 'frauenkirche'].map((k) => `eu-landmark-${k}-above-day`)
  .concat(['westminster', 'colosseum', 'towerbridge'].map((k) => `eu-landmark-${k}-above-night`),
    ['eu-centre-london-fl350-day', 'eu-centre-london-fl350-night', 'eu-centre-paris-fl350-day', 'eu-centre-paris-fl350-night', 'eu-fl350-alps-night', 'eu-3000-alps-zurich-night']);
GROUPS['europe-landmarks'] = Object.keys(EU_LANDMARKS).map((k) => `eu-landmark-${k}-day`).concat(['shard', 'westminster', 'eye', 'eiffel', 'europaturm', 'cristal', 'sagrada', 'stpeters'].map((k) => `eu-landmark-${k}-night`));
GROUPS['europe-flight'] = ['eu-fl350-london-south', 'eu-fl350-biscay-madrid', 'eu-3000-london', 'eu-3000-alps-zurich'];
GROUPS.europe = Object.keys(SHOTS).filter((n) => n.startsWith('eu-') && !n.includes('fine') && !n.includes('centre') && !n.includes('landmark'));

// The page's frame clock, replaced before the page runs.
const INIT = () => {
  const native = window.requestAnimationFrame.bind(window);
  let queued = null, fakeNow = null, offset = 0, real = false;
  const st = window.__raf = { frames: 0, stamps: [], count: 0 };   // count: frames stepped by hand (v0.7.0, for --total)
  window.requestAnimationFrame = (cb) => {
    if (real) return native((ts) => { st.frames++; st.stamps.push(ts); cb(ts + offset); });
    queued = cb; return 1;
  };
  st.has = () => !!queued;
  st.step = (n) => {
    for (let i = 0; i < n; i++) {
      const cb = queued; if (!cb) throw new Error('no frame queued');
      queued = null;
      fakeNow = fakeNow === null ? performance.now() + 1e6 : fakeNow + 1000 / 60;
      st.count++;
      cb(fakeNow);
    }
  };
  st.goReal = () => {
    real = true; offset = fakeNow - performance.now();
    const cb = queued; queued = null;
    if (cb) native((ts) => { st.frames++; st.stamps.push(ts); cb(ts + offset); });
  };
};

function args() {
  const a = process.argv.slice(2), o = { base: null, tag: null, names: [] };
  for (let i = 0; i < a.length; i++) {
    if (['--headed', '--region', '--cities', '--ground', '--pending', '--nocull'].includes(a[i])) continue;
    else if (a[i] === '--base') o.base = a[++i];
    else if (a[i] === '--tag') o.tag = a[++i];
    else if (a[i] === '--q') o.q = a[++i];             // v0.6.1: more for the page's query ("&trees=1")
    else if (a[i] === '--prefix') o.prefix = a[++i];
    else if (a[i] === '--total') o.total = Number(a[++i]);   // v0.7.0: see TOTAL below   // v0.6.1: the pictures' prefix (v060 by default; v061 for v0.6.1's)
    else o.names.push(a[i]);
  }
  if (!o.base || !o.tag) { console.error('usage: node browser-v060-stills.mjs --base <game folder url> --tag <tag> [names|part1|part6|part7]'); process.exit(2); }
  if (!o.base.endsWith('/')) o.base += '/';
  if (!o.names.length) o.names = Object.keys(SHOTS);
  o.names = o.names.flatMap((n) => GROUPS[n] || [n]);
  for (const n of o.names) if (!SHOTS[n]) { console.error('unknown shot', n); process.exit(2); }
  return o;
}

const opt = args();
mkdirSync(OUT, { recursive: true });
mkdirSync(JSON_DIR, { recursive: true });
// Headless by default (Shane's rule: no visible windows while he uses the Mac); --headed for a visible window.
const HEADED = process.argv.includes('--headed');
const REGION = process.argv.includes('--region');
// Part 6's and Part 7's own flags (?cities=1, ?ground=1), with or without the region.
// Always explicit, whatever the shipped defaults: without --region, --cities or --ground the page is v0.5.8's Korea.
// (v0.7.0: v0.6.0's flags are gone, so ?eastasia=, ?cities= and ?ground= are ignored: every still is the region's
// game, with or without --region, --cities and --ground, which are kept as harmless no-ops.)
const EXTRA = `&cities=${process.argv.includes('--cities') ? 1 : 0}&ground=${process.argv.includes('--ground') ? 1 : 0}${process.argv.includes('--pending') ? '&pending=1' : ''}${process.argv.includes('--nocull') ? '&cull=0' : ''}`;   // (--pending, v0.6.1: an airport still in the manifest's airportsPending)
const browser = await chromium.launch(HEADED
  ? { channel: 'chrome', headless: false, args: ['--mute-audio', '--window-size=1440,960', '--enable-precise-memory-info', '--js-flags=--expose-gc'] }
  : { channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const MODE = HEADED ? 'headed' : 'headless';
const results = [];
let failed = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT);
  for (const name of opt.names) {
    const shot = SHOTS[name];
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // aglAt (ours, ignored by the page): the height is taken over the target, not under the camera.
    const q = shot.q.replace(/&aglAt=[^&]*/, '');
    const t0 = Date.now();
    const log = (m) => { if (process.env.V060_DEBUG) console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)} s] ${name}: ${m}`); };
    await page.goto(`${opt.base}tests/dev-world.html?hud=0&${q}&eastasia=${REGION ? 1 : 0}${EXTRA}${opt.q || ''}`);
    log('loaded');
    try {
      await page.waitForFunction(() => window.__dev && window.__raf && window.__raf.has(), null, { timeout: 90000, polling: 250 });
    } catch {
      console.log(name, 'did not start', errors.join('\n'));
      results.push({ name, error: 'timeout', errors }); failed++;
      await page.close(); continue;
    }
    log('world ready');
    const aglAt = /aglAt=([-\d.]+),([-\d.]+)/.exec(shot.q);
    const r = await page.evaluate(async ({ ms, aglAt, steps, region, total }) => {
      const d = window.__dev, w = d.world, cam = d.cam;
      let tilesMs = 0;
      // Part 6's real centres, when they are on: every centre in range built (none loading, building or staging).
      if (w.centres) {
        await w.centres.ready;
        for (let i = 0; i < 4000; i++) {
          window.__raf.step(1);
          if (i > 20 && ![...w.centres.centres.values()].some((c) => ['building', 'staging'].includes(c.state))) break;
          await new Promise((res) => setTimeout(res, 4));
        }
      }
      // Part 7's fine cover round the camera, when it is on.
      if (w.terrain.fine) {
        for (let i = 0; i < 1500; i++) { window.__raf.step(1); if (i > 5 && !w.terrain.fine.pending) break; await new Promise((res) => setTimeout(res, 4)); }
      }
      if (region && w.heightfield.tiles) {
        // The region: the tiles round the camera and the target, then every block of the clip window.
        const T = w.heightfield.tiles, t0 = performance.now();
        await T.whenReady(cam.x, cam.y, 40000, 'camera');
        if (aglAt) await T.whenReady(aglAt[0], aglAt[1], 5000, 'target');
        const clip = w.uniforms.__clip;
        for (let i = 0; i < 3000; i++) {
          window.__raf.step(1);
          if (i > 5 && (!clip || !clip.window.pending()) && !(w.uniforms.__near && w.uniforms.__near.pending)) break;   // the window's blocks and the patches' slots
          await new Promise((res) => setTimeout(res, 4));
        }
        tilesMs = performance.now() - t0;
      }
      const { toGeo } = await import(new URL('../src/world/frame.js', location.href).href);
      const q = new URLSearchParams(location.search);
      if (aglAt && q.has('agl')) cam.z = w.heightAt(aglAt[0], aglAt[1]) + parseFloat(q.get('agl')) * 0.3048;
      const [lat, lon] = toGeo(cam.x, cam.y);
      w.sky.setTime(ms, lat, lon);
      if (Number.isFinite(w.sky.state.exposure)) d.renderer.toneMappingExposure = w.sky.state.exposure;
      const pre = window.__raf.count, pad = total ? total - 1 - steps - pre : 0;
      for (let i = 0; i < pad; i += 10) { window.__raf.step(Math.min(10, pad - i)); await new Promise((res) => setTimeout(res, 0)); }
      for (let i = 0; i < steps; i += 10) { window.__raf.step(Math.min(10, steps - i)); await new Promise((res) => setTimeout(res, 0)); }
      // The capture: one more frame, then the canvas read in the same task.
      window.__raf.step(1);
      const stepped = window.__raf.count;
      const url = d.renderer.domElement.toDataURL('image/png');
      const ri = d.renderer.info.render;
      const gl = d.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return { url, glRenderer, lat, lon, pre, stepped, cam: { ...cam }, calls: ri.calls, triangles: ri.triangles, stats: { ...w.stats }, sun: w.sky.state.sunAltDeg, night: w.uniforms.uNight.value, exposure: d.renderer.toneMappingExposure, loadMs: d.loadMs, tilesMs, storeTiles: w.heightfield.tiles ? w.heightfield.tiles.resident().length : 0, misses: w.heightfield.tiles ? w.heightfield.tiles.misses : 0 };
    }, { ms: shot.ms, aglAt: aglAt ? [parseFloat(aglAt[1]), parseFloat(aglAt[2])] : null, steps: STEPS, region: REGION, total: opt.total || 0 });
    const file = `${OUT}/${opt.prefix || 'v060'}-${opt.tag}-${name}.png`;
    writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    log('captured');
    // The frame rate on real frames, then the heap after a GC.
    const perf = await page.evaluate(async (fpsMs) => {
      const st = window.__raf; st.goReal();
      await new Promise((res) => setTimeout(res, 500));
      const n0 = st.stamps.length;
      await new Promise((res) => setTimeout(res, fpsMs));
      const s = st.stamps.slice(n0), dts = s.slice(1).map((t, i) => t - s[i]);
      const span = s[s.length - 1] - s[0];
      const ri = window.__dev.renderer.info.render;
      if (window.gc) window.gc();
      await new Promise((res) => setTimeout(res, 100));
      return { fps: (s.length - 1) * 1000 / span, worstMs: Math.max(...dts), frames: s.length, callsLive: ri.calls, trianglesLive: ri.triangles, heapMB: performance.memory.usedJSHeapSize / 1048576 };
    }, FPS_MS);
    const { url, ...rest } = r;
    const swiftshader = /swiftshader/i.test(r.glRenderer);
    const out = { name, file, mode: MODE, swiftshader, fpsValid: !swiftshader, ms: shot.ms, q: shot.q, ...rest, ...perf, secs: (Date.now() - t0) / 1000, errors };
    results.push(out);
    if (opt.total) console.log(`  ${name}: ${r.pre} frames stepped in the waits, ${r.stepped} at the capture${r.stepped !== opt.total ? ` (NOT the ${opt.total} asked for: the waits took more)` : ''}`);
    console.log(`${name}: ${perf.fps.toFixed(1)} fps (worst ${perf.worstMs.toFixed(1)} ms), ${r.calls} calls, ${(r.triangles / 1000).toFixed(0)}k tris, heap ${perf.heapMB.toFixed(0)} MB, sun ${r.sun.toFixed(1)}°, night ${r.night.toFixed(2)}, ${out.secs.toFixed(0)} s, ${MODE}, ${r.glRenderer}${swiftshader ? ' (SwiftShader: fps not valid)' : ''}` +
      (errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${JSON_DIR}/${opt.tag}.json`, JSON.stringify(results, null, 2));
console.log(`wrote ${JSON_DIR}/${opt.tag}.json (${results.length} shots${failed ? `, ${failed} failed` : ''})`);
process.exit(failed ? 1 : 0);
