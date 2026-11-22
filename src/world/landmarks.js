// The landmarks (briefs/V0-6-0.md Part 6 step 3): famous buildings as their own models, made here
// (landmark-models.js: massing from public facts, no logos, signage or names, nothing copied).
//
//   const lm = createLandmarks(scene, uniforms, chunks, { heightfield, renderer });
//   each frame: lm.update({ camMap, origin, camScene, agl });   lm.stats; lm.dispose();
//
// Each model is built the first time the camera comes within BUILD_M of
// it (a few thousand triangles, a few milliseconds), drawn within SHOW_M (a 600 m tower is still a
// few pixels tall at 80 km), hidden beyond (no draw call), and released beyond RELEASE_M. One
// shared material for the buildings, one mesh per landmark; at night one point draw per landmark
// for its aviation obstruction lights (hidden by day: no extra draw calls by day).
//
// Each landmark sits on the ground (the lowest heightAt() round its base, read once when it is
// built, after the terrain tiles there are in) and is drawn relative to the moving origin: the
// mesh's position is (landmark - origin) in JS doubles each frame, with the Earth's curve for its
// distance from the camera taken off its height (curveDrop at its centre: across a building the
// difference is well under a metre at any distance it is drawn).

import * as THREE from '../../vendor/three.module.js';
import { toMap, EARTH_RADIUS } from './frame.js';
import { MODELS, EUROPE_MODELS, LANDMARKS77 } from './landmark-models.js';
import { REGION_ID } from './regions.js';

export const BUILD_M = 85000;
export const SHOW_M = 80000;
export const RELEASE_M = 250000;

// The list. lat, lon: the base's centre (OpenStreetMap's footprint where the bake has it, else
// the article's coordinates); heightM: to the top of the model (the architectural height);
// footprintM: the radius of a circle round the base's centre that covers the plan (parts: the
// circles of a landmark's separate towers, map metres from its centre, for the real centres'
// extrusion to leave out); source: where the height was checked (2026-11-19). [EST] marks a figure
// estimated, not read. brg: the plan's grid bearing (from the OSM footprint's sides).
export const LANDMARKS = [
  // Seoul
  { id: 'lotte', city: 'seoul', country: 'KR', lat: 37.51254, lon: 127.10266, heightM: 554.5, footprintM: 44, brg: 68, floors: 123,
    source: 'Wikipedia "Lotte World Tower": 555 m architectural; OSM height=554.5; footprint 72 m (OSM)' },
  { id: 'b63', city: 'seoul', country: 'KR', lat: 37.51985, lon: 126.94025, heightM: 249.6, footprintM: 36, brg: 52, floors: 60,
    source: 'Wikipedia "63 Building": 249.6 m (antenna 274 m not modelled); OSM footprint 60 x 27 m' },
  { id: 'nseoul', city: 'seoul', country: 'KR', lat: 37.55120, lon: 126.98823, heightM: 236.7, footprintM: 34, brg: 0,
    source: 'Wikipedia "Namsan Seoul Tower": 236 m (lead; the infobox gives 279 m to the spire), 236.7 m [EST, the commonly quoted figure]; pod heights [EST] from OSM parts' },
  { id: 'parc1', city: 'seoul', country: 'KR', lat: 37.52668, lon: 126.92722, heightM: 333, footprintM: 110, brg: 142, floors: 69,
    parts: [[0, 0, 40], [56, 43, 40]],
    source: 'Wikipedia "Parc1": 333 m architectural, roof 318 m; Tower 2 256 m (OSM height); towers placed from OSM' },
  // Shanghai
  { id: 'shtower', city: 'shanghai', country: 'CN', lat: 31.23555, lon: 121.50127, heightM: 632, footprintM: 44, brg: 0, floors: 128,
    source: 'Wikipedia "Shanghai Tower": 632 m, roof 587.4 m; zones from OSM parts (85 m to 49 m across)' },
  { id: 'swfc', city: 'shanghai', country: 'CN', lat: 31.23657, lon: 121.50304, heightM: 492, footprintM: 42, brg: -1, floors: 101,
    source: 'Wikipedia "Shanghai World Financial Center": 492 m architectural, roof 487.4 m; the top 85 x 16 m along bearing 44 (OSM)' },
  { id: 'jinmao', city: 'shanghai', country: 'CN', lat: 31.23725, lon: 121.50140, heightM: 420.5, footprintM: 44, brg: 3, floors: 88,
    source: 'Wikipedia "Jin Mao Tower": 420.5 m, roof 385.5 m, sixteen tiers each 1/8 shorter; base 62 m (OSM)' },
  { id: 'pearl', city: 'shanghai', country: 'CN', lat: 31.24189, lon: 121.49526, heightM: 468, footprintM: 50, brg: 0,
    source: 'Wikipedia "Oriental Pearl Tower": 468 m; sphere sizes and heights [EST]' },
  // Tokyo
  { id: 'skytree', city: 'tokyo', country: 'JP', lat: 35.71005, lon: 139.81072, heightM: 634, footprintM: 41, brg: 0,
    source: 'Wikipedia "Tokyo Skytree": 634.0 m, decks 350 m and 450 m, triangle to circle by 320 m; base side 68 m [EST]' },
  { id: 'tokyotower', city: 'tokyo', country: 'JP', lat: 35.65859, lon: 139.74545, heightM: 332.9, footprintM: 50, brg: 27,
    source: 'Wikipedia "Tokyo Tower": 332.9 m to the spire (333 m), Main Deck 150 m, Top Deck 249.6 m; base width [EST]' },
  { id: 'azabudai', city: 'tokyo', country: 'JP', lat: 35.66085, lon: 139.74066, heightM: 325.2, footprintM: 52, brg: 18, floors: 64,
    source: 'Wikipedia "Azabudai Hills": Mori JP Tower 325.2 m; footprint 75 m (OSM)' },
  { id: 'tmg', city: 'tokyo', country: 'JP', lat: 35.68950, lon: 139.69171, heightM: 242.9, footprintM: 62, brg: 162, floors: 48,
    source: 'Wikipedia "Tokyo Metropolitan Government Building": 242.9 m, splits at the 33rd floor; the towers from OSM' },
  { id: 'ylmt', city: 'yokohama', country: 'JP', lat: 35.45460, lon: 139.63148, heightM: 296.3, footprintM: 52, brg: 50, floors: 70,
    source: 'Wikipedia "Yokohama Landmark Tower": 296.3 m; footprint 75 m with the flare (OSM)' },
  // With the new airports
  { id: 'lct', city: 'busan', country: 'KR', lat: 35.15993, lon: 129.16973, heightM: 411.6, footprintM: 260, brg: 117, floors: 101,
    parts: [[0, 0, 40], [-160, 151, 38], [-78, 95, 38]],
    source: 'Wikipedia "Haeundae LCT The Sharp": Landmark Tower 411.6 m, residential towers 339.1 m and 333 m; placed from OSM' },
  { id: 'neatt', city: 'songdo', country: 'KR', lat: 37.38924, lon: 126.64423, heightM: 305, footprintM: 42, brg: 40, floors: 68,
    source: 'Wikipedia "Posco Tower-Songdo" (Northeast Asia Trade Tower): 305 m, a square base tapering to a triangular roof' },
  { id: 'harukas', city: 'osaka', country: 'JP', lat: 34.64601, lon: 135.51350, heightM: 300, footprintM: 62, brg: 8, floors: 60,
    source: 'Wikipedia "Abeno Harukas": 300 m; footprint 88 m (OSM); the setbacks\' sides [EST]' },
  { id: 'umeda', city: 'osaka', country: 'JP', lat: 34.70530, lon: 135.49007, heightM: 173, footprintM: 64, brg: -2, floors: 40,
    source: 'Wikipedia "Umeda Sky Building": roof 170 m (spire 190 m), 173 m to the parapet [EST]; towers from OSM' },
  { id: 'fktower', city: 'fukuoka', country: 'JP', lat: 33.59331, lon: 130.35148, heightM: 234, footprintM: 15, brg: 140,
    source: 'Wikipedia "Fukuoka Tower": 234 m, decks 116-123 m, mast 111 m above the top deck; triangle 24 m (OSM)' },
  { id: 'fkdome', city: 'fukuoka', country: 'JP', lat: 33.5953, lon: 130.3622, heightM: 84, footprintM: 109, brg: 0,
    source: 'Wikipedia "Mizuho PayPay Dome Fukuoka" (coordinates; no size given): 216 m across and 84 m high [EST, the brief]' },
  // v0.6.3: Beijing, Vladivostok, Tianjin, Shenyang (checked 2026-11-20). The bridges (kind
  // 'bridge') are placed from OSM: lat, lon the pylons' midpoint, `pylons` their centres (from the
  // footings' outlines), `ends` the deck's ends; their parts (the pylons' circles) and the deck's
  // axis are worked out below. Their base is the sea (y 0), the deck coming down to the ground at
  // each end (read when the model is built).
  { id: 'citic', city: 'beijing', country: 'CN', lat: 39.91150, lon: 116.46024, heightM: 527.7, footprintM: 56, brg: 6.4, floors: 109,
    source: 'Wikipedia "China Zun": 527.7 m, top floor 522 m, 109 floors; OSM height=528, footprint 81 x 77 m; waist and top widths [EST]' },
  { id: 'cctv', city: 'beijing', country: 'CN', lat: 39.91381, lon: 116.45797, heightM: 234, footprintM: 116, brg: 6.4, floors: 51,
    source: 'Wikipedia "CCTV Headquarters": 234 m roof, 51 floors (OSM height=245); the site 159 x 168 m (OSM); the lean, podium and overhang [EST]' },
  { id: 'russky', city: 'vladivostok', country: 'RU', kind: 'bridge', lat: 43.0633255, lon: 131.9078555, heightM: 321, footprintM: 1100,
    pylons: [[43.060012, 131.902812], [43.066639, 131.912899]], ends: [[43.05692, 131.898282], [43.069665, 131.917507]],
    source: 'Wikipedia "Russky Bridge": main span 1,104 m, clearance 70 m, pylons 319.1 m (infobox) / 324 m (text); OSM pylon footings height=321; the ends from OSM\'s bridge outline (to 131.9173 E) and road' },
  { id: 'zolotoy', city: 'vladivostok', country: 'RU', kind: 'bridge', lat: 43.1088535, lon: 131.896239, heightM: 226, footprintM: 720,
    pylons: [[43.1055348, 131.8961703], [43.1121722, 131.8963077]], ends: [[43.102722, 131.896112], [43.114985, 131.896366]],
    source: 'Wikipedia "Zolotoy Bridge": main span 737 m, 1,387 m long, clearance 60 m, infobox height 222.42 m; pylons 226 m [EST, the brief]; pylon places +-368.5 m about the cable-stayed way\'s middle (OSM) [EST]' },
  { id: 'cctvtower', city: 'beijing', country: 'CN', lat: 39.918176, lon: 116.300299, heightM: 405, footprintM: 50,
    source: 'Wikipedia "Central Radio & TV Tower": 405 m, observation deck 238 m, top floor 248 m; OSM height=405, base 72 x 71 m; pod rings [EST]' },
  { id: 'tjtower', city: 'tianjin', country: 'CN', lat: 39.091917, lon: 117.175338, heightM: 415.2, footprintM: 24,
    source: 'Wikipedia "Tianjin Radio and Television Tower": 415.2 m, the pod about two-thirds up; OSM height=415, shaft 30 m; pod rings [EST]' },
  { id: 'lntower', city: 'shenyang', country: 'CN', lat: 41.780386, lon: 123.427954, heightM: 305.5, footprintM: 24,
    source: 'Wikipedia "Liaoning Broadcast and TV Tower": 305.5 m, the disk with decks and restaurant (no heights given) [EST the disk at 180-204 m]; OSM base 38 m (OSM height from levels, 160 m, wrong)' },
  // v0.6.4: Pyongyang, Sapporo, Sendai (checked 2026-11-21). Pyongyang's are 'KP': behind the
  // region's flag, as everything outside South Korea.
  { id: 'ryugyong', city: 'pyongyang', country: 'KP', lat: 39.036518, lon: 125.730868, heightM: 330, footprintM: 112, brg: 77, floors: 105,
    source: 'Wikipedia "Ryugyong Hotel": 330 m (roof 330.02 m), 105 floors; three wings each 100 m long and 18 m wide, sloping at 75 degrees, stepped once; a truncated cone 40 m wide on top. OSM: the pinnacle\'s centre (here), the wings at bearings 77/197/317, their slopes 235 m in 70 m (drawn so), the tips to about 105 m; the step\'s height, the rings and the podium [EST]' },
  { id: 'juche', city: 'pyongyang', country: 'KP', lat: 39.017636, lon: 125.763590, heightM: 170, footprintM: 42, brg: 13,
    source: 'Wikipedia "Juche Tower": 170 m, a four-sided tapering 150 m spire of white stone and a 20 m torch, on the east bank of the Taedong; OSM: the parts\' centre (here), the plan a square with recessed corners 18.5 m across, the terrace 59 m square at bearing 13; the flame\'s shape and the platform [EST]' },
  { id: 'sapporotv', city: 'sapporo', country: 'JP', lat: 43.061113, lon: 141.356448, heightM: 147.2, footprintM: 24, brg: -10,
    source: 'Wikipedia "Sapporo TV Tower": 147.2 m to the antenna, observation deck at 90.38 m, in Odori Park; OSM height=147.2, footprint 34 x 33 m at bearing -10 (its centroid here); the taper, the deck\'s size and the base building [EST]' },
  { id: 'daikannon', city: 'sendai', country: 'JP', lat: 38.300502, lon: 140.823634, heightM: 100, footprintM: 21, brg: 135,
    source: 'Wikipedia "Sendai Daikannon": the statue 92 m, 100 m with its pedestal, at 38 18 02 N, 140 49 25 E; OSM: the statue\'s point (here; height=100, colour=white), the pedestal hall an octagon about 39 m across; the figure\'s proportions and the way it faces (south-east) [EST]' },
];
// The cities' boxes (lat S, W, N, E) the tests check the list against.
export const CITY_BOXES = {
  seoul: [37.42, 126.80, 37.70, 127.20], shanghai: [31.10, 121.30, 31.35, 121.65], tokyo: [35.55, 139.60, 35.80, 139.90],
  yokohama: [35.40, 139.55, 35.52, 139.70], busan: [35.05, 128.90, 35.30, 129.25], songdo: [37.34, 126.58, 37.44, 126.70],
  osaka: [34.60, 135.40, 34.75, 135.60], fukuoka: [33.54, 130.30, 33.65, 130.45],
  beijing: [39.80, 116.20, 40.05, 116.60], tianjin: [39.00, 117.10, 39.20, 117.35], shenyang: [41.70, 123.30, 41.90, 123.55],
  vladivostok: [43.00, 131.80, 43.20, 132.00],
  pyongyang: [38.95, 125.65, 39.12, 125.85], sapporo: [42.98, 141.25, 43.15, 141.45], sendai: [38.20, 140.78, 38.34, 140.98],
};

export const PYLON_R = 45;     // m: a bridge pylon's circle (Russky's footings are 80 m apart)
for (const L of LANDMARKS) {
  const [x, y] = toMap(L.lat, L.lon);
  L.x = x; L.y = y;
  if (L.kind === 'bridge') {
    // The deck's axis from pylon to pylon (map metres), the ends projected onto it.
    const P = L.pylons.map(([la, lo]) => toMap(la, lo));
    const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
    L.brg = Math.atan2(ux, uy) * 180 / Math.PI;
    L.parts = P.map(([px, py]) => [px - x, py - y, PYLON_R]);
    L.endsMap = L.ends.map(([la, lo]) => toMap(la, lo));
    const along = L.endsMap.map(([ex, ey]) => (ex - x) * ux + (ey - y) * uy);
    L.geo = { s: len / 2, n0: Math.min(...along), n1: Math.max(...along) };
  }
}

// v0.7.0: Europe's landmarks (briefs/V0-7-0.md Part 6), in the brief's order: their own list, each `region: 'europe'`,
// placed in Europe's frame (in East Asia's page their x, y are far off the map, and landmarkOn() keeps them off).
// Figures as published: "(read 2026-11-21)" where the article was read tonight (its height and coordinates), the
// rest as the articles give them, from memory, their positions to some tens of metres; [EST] marks what is estimated.
const EU = (o) => ({ region: 'europe', ...o });
export const EUROPE_LANDMARKS = [
  // London
  EU({ id: 'shard', city: 'london', country: 'GB', lat: 51.5045, lon: -0.0865, heightM: 309.6, footprintM: 40, brg: 0, floors: 72,
    source: 'Wikipedia "The Shard" (read 2026-11-21, with its coordinates): 309.6 m, 72 floors, a tapering glass pyramid; plan size and the bearing [EST]' }),
  EU({ id: 'westminster', city: 'london', country: 'GB', lat: 51.49952, lon: -0.12497, heightM: 98.5, footprintM: 145, brg: 10,
    source: 'Wikipedia "Elizabeth Tower" (read 2026-11-21: 96 m, 51.5007 N 0.1245 W, which the model\'s tower sits on; the clock stage about 55 m up) and "Palace of Westminster" (from memory: the Victoria Tower 98.5 m, the Central Tower 91 m, about 265 m along the river); the palace\'s plan and the axis [EST] from the towers\' coordinates' }),
  EU({ id: 'eye', city: 'london', country: 'GB', lat: 51.5033, lon: -0.1194, heightM: 135, footprintM: 64, brg: 25,
    source: 'Wikipedia "London Eye" (read 2026-11-21, with its coordinates): 135 m, the wheel 120 m across, 32 capsules; the wheel\'s plane along the bank [EST]' }),
  EU({ id: 'stpauls', city: 'london', country: 'GB', lat: 51.5138, lon: -0.0983, heightM: 111, footprintM: 85, brg: 0,
    source: 'Wikipedia "St Paul\'s Cathedral" (read 2026-11-21, with its coordinates): 111 m to the cross, 158 m long; the drum\'s, dome\'s and towers\' sizes [EST]' }),
  EU({ id: 'towerbridge', city: 'london', country: 'GB', lat: 51.5056, lon: -0.0753, heightM: 65, footprintM: 122, brg: 0,
    source: 'Wikipedia "Tower Bridge" (read 2026-11-21, with its coordinates): towers 65 m, 290 m with the abutments (the model 240 m), main span 61 m, walkways 44 m above high water; the bearing [EST]' }),
  // Paris
  EU({ id: 'eiffel', city: 'paris', country: 'FR', lat: 48.858222, lon: 2.2945, heightM: 330, footprintM: 90, brg: 46,
    source: 'Wikipedia "Eiffel Tower" (read 2026-11-21, with its coordinates): 330 m (antenna), base 125 m square, the top platform 276 m; the first and second floors at 57 and 115 m [EST: from memory]; the bearing from the Champ de Mars [EST]' }),
  EU({ id: 'arc', city: 'paris', country: 'FR', lat: 48.873778, lon: 2.295028, heightM: 49.54, footprintM: 27, brg: 116,
    source: 'Wikipedia "Arc de Triomphe" (read 2026-11-21, with its coordinates): 49.54 m high, 44.82 m wide, 22.21 m deep, the great arch 29.19 x 14.62 m, the transverse arches 18.68 x 8.44 m; the axis\'s bearing [EST]' }),
  EU({ id: 'sacrecoeur', city: 'paris', country: 'FR', lat: 48.88671, lon: 2.34306, heightM: 84, footprintM: 48, brg: 0,
    source: 'Wikipedia "Sacré-Cœur, Paris" (read 2026-11-21): the dome 83.33 m, the campanile 84 m, 85 m long, 35 m wide; the coordinates (from memory) and the small domes [EST]' }),
  EU({ id: 'notredame', city: 'paris', country: 'FR', lat: 48.85306, lon: 2.35000, heightM: 96, footprintM: 68, brg: 112,
    source: 'Wikipedia "Notre-Dame de Paris" (read 2026-11-21: 128 m long, 48 m wide, the coordinates): towers 69 m and the spire 96 m (rebuilt) [from memory]; the bearing [EST]' }),
  EU({ id: 'grandearche', city: 'paris', country: 'FR', lat: 48.89264, lon: 2.23602, heightM: 110, footprintM: 80, brg: 122,
    source: 'Wikipedia "La Grande Arche" (read 2026-11-21: a 110 m cube, turned 6.33 degrees): 110 m high, 108 m wide, 112 m deep, turned 6.33 degrees off the axis; the frame\'s thickness [EST]' }),
  // Frankfurt
  EU({ id: 'commerzbank', city: 'frankfurt', country: 'DE', lat: 50.11123, lon: 8.67436, heightM: 258.7, footprintM: 36, brg: 0, floors: 56,
    source: 'Wikipedia "Commerzbank Tower" (read 2026-11-21): roof 258.7 m (the antenna to 300.1 m not modelled), 56 floors, a rounded triangle about 60 m a side; coordinates from the article; the crown\'s shape [EST]' }),
  EU({ id: 'messeturm', city: 'frankfurt', country: 'DE', lat: 50.11222, lon: 8.65278, heightM: 256.5, footprintM: 30, brg: 0, floors: 63,
    source: 'Wikipedia "Messeturm" (read 2026-11-21): 256.5 m (257 m roof in the infobox), top floor 228 m, coordinates from the article; 41 m square, the cylinder\'s heights [EST]' }),
  EU({ id: 'europaturm', city: 'frankfurt', country: 'DE', lat: 50.13528, lon: 8.65472, heightM: 337.5, footprintM: 31, brg: 0,
    source: 'Wikipedia "Europaturm" (read 2026-11-21): 337.5 m with the antenna, "59 m" its widest part, coordinates from the article; the pod\'s heights [EST]' }),
  // Madrid: the four towers and Caleido (their order along the Castellana and spacing [EST])
  EU({ id: 'cepsa', city: 'madrid', country: 'ES', lat: 40.47556, lon: -3.68778, heightM: 248.3, footprintM: 34, brg: 0, floors: 45,
    source: 'Wikipedia "Torre Cepsa" (read 2026-11-21): 248.3 m (CTBUH), coordinates from the article; two cores joined by an arch at the top' }),
  EU({ id: 'pwc', city: 'madrid', country: 'ES', lat: 40.47667, lon: -3.68778, heightM: 236, footprintM: 26, brg: 0, floors: 52,
    source: 'Wikipedia "Torre PwC" (read 2026-11-21): 236 m, coordinates from the article; the crown about 30 m [EST]' }),
  EU({ id: 'cristal', city: 'madrid', country: 'ES', lat: 40.47806, lon: -3.68722, heightM: 249, footprintM: 31, brg: 0, floors: 52,
    source: 'Wikipedia "Torre de Cristal" (read 2026-11-21): 249 m architectural (tip 250 m), top floor 210 m, coordinates from the article; a garden under glass at the top' }),
  EU({ id: 'emperador', city: 'madrid', country: 'ES', lat: 40.47889, lon: -3.68667, heightM: 230, footprintM: 28, brg: 0, floors: 57,
    source: 'Wikipedia "Torre Espacio" (now Torre Emperador Castellana; read 2026-11-21): 230 m roof (the area\'s article also gives 224.5 m), coordinates from the article; square at the foot, two arcs at the top' }),
  EU({ id: 'caleido', city: 'madrid', country: 'ES', lat: 40.4745, lon: -3.6881, heightM: 181, footprintM: 32, brg: 0, floors: 36,
    source: 'Wikipedia "Cuatro Torres Business Area" (read 2026-11-21): Caleido 181 m; its position (south of Torre Cepsa) [EST: no coordinates read], the slab\'s plan and the frame on top [EST]' }),
  EU({ id: 'kio', city: 'madrid', country: 'ES', lat: 40.46639, lon: -3.68778, heightM: 114, footprintM: 76, brg: 0, floors: 26,
    parts: [[-55, 0, 25], [55, 0, 25]],
    source: 'Wikipedia "Gate of Europe" (read 2026-11-21): 114 m roof, 15 degrees, coordinates from the article; the bases\' spacing [EST]' }),
  // Zurich
  EU({ id: 'grossmunster', city: 'zurich', country: 'CH', lat: 47.37014, lon: 8.54399, heightM: 64, footprintM: 40, brg: 90,
    source: 'Wikipedia "Grossmünster" (read 2026-11-21): coordinates; the towers\' height not given there: 64 m [EST], the nave\'s size [EST]' }),
  EU({ id: 'primetower', city: 'zurich', country: 'CH', lat: 47.38600, lon: 8.51720, heightM: 126, footprintM: 30, brg: 15, floors: 36,
    source: 'Wikipedia "Prime Tower" (read 2026-11-21): 126 m roof, coordinates; an irregular octagon widening upwards, plan and bearing [EST]' }),
  // Munich
  EU({ id: 'olympiaturm', city: 'munich', country: 'DE', lat: 48.17444, lon: 11.55361, heightM: 291, footprintM: 18, brg: 0,
    source: 'Wikipedia "Olympiaturm" (read 2026-11-21): 291 m, the observation platform at 190 m, the restaurant at 182 m, coordinates; the pod\'s rings [EST]' }),
  EU({ id: 'frauenkirche', city: 'munich', country: 'DE', lat: 48.13861, lon: 11.57389, heightM: 98.5, footprintM: 61, brg: 90,
    source: 'Wikipedia "Frauenkirche, Munich" (read 2026-11-21, with its coordinates): towers 98.57 m and 98.45 m with onion domes, the church 109 m long and 40 m wide; the roof\'s ridge [EST]' }),
  // Barcelona
  EU({ id: 'sagrada', city: 'barcelona', country: 'ES', lat: 41.40369, lon: 2.17433, heightM: 172.5, footprintM: 60, brg: -45,
    source: 'Wikipedia "Sagrada Família": (read 2026-11-21): the Tower of Jesus Christ 172.5 m, structurally completed on 20 February 2026; coordinates; Mary 138 m and the Evangelists 135 m [EST: not given there]; the bell towers\' heights, the plan and the bearing [EST]' }),
  EU({ id: 'glories', city: 'barcelona', country: 'ES', lat: 41.40347, lon: 2.18966, heightM: 144.4, footprintM: 24, brg: 0, floors: 38,
    source: 'Wikipedia "Torre Glòries" (read 2026-11-21): 144.44 m, 38 floors, a rounded bullet on an elliptical plan; the plan\'s size [EST]' }),
  EU({ id: 'collserola', city: 'barcelona', country: 'ES', lat: 41.41722, lon: 2.11417, heightM: 288.4, footprintM: 47, brg: 0,
    source: 'Wikipedia "Torre de Collserola" (read 2026-11-21): 288.4 m, the pod of 13 floors topping out at 152 m, coordinates; the floors\' spacing and the guys\' anchors [EST]' }),
  // Rome
  EU({ id: 'stpeters', city: 'rome', country: 'IT', lat: 41.90222, lon: 12.45381, heightM: 136.6, footprintM: 128, brg: 90,
    source: 'Wikipedia "St. Peter\'s Basilica" (read 2026-11-21: the dome\'s top 136.6 m, 220 m long, 150 m wide, 41.90222 N 12.45333 E at the dome): 136.6 m, the facade 114.7 m wide and 45.5 m high; the model\'s centre 40 m east of the dome; the drum\'s sizes [EST]' }),
  EU({ id: 'colosseum', city: 'rome', country: 'IT', lat: 41.8903, lon: 12.4922, heightM: 48, footprintM: 97, brg: -18,
    source: 'Wikipedia "Colosseum" (read 2026-11-21, with its coordinates): 189 x 156 m, 48 m high, the arena 87 x 55 m; the long axis\'s bearing and the fallen south side\'s height [EST]' }),
];
export const EUROPE_CITY_BOXES = {
  london: [51.40, -0.25, 51.60, 0.05], paris: [48.80, 2.20, 48.92, 2.42], frankfurt: [50.05, 8.58, 50.16, 8.75],
  madrid: [40.38, -3.75, 40.50, -3.65], zurich: [47.33, 8.48, 47.42, 8.58], munich: [48.10, 11.50, 48.20, 11.62],
  barcelona: [41.35, 2.08, 41.45, 2.23], rome: [41.85, 12.42, 41.94, 12.52],
};
// v0.7.1 (briefs/V0-7-1.md part 5): the next cities' landmarks, appended in the brief's order. Figures read on
// 2026-11-21 from each Wikipedia article (its infobox, text and coordinates); [EST] marks what is estimated. The
// three long bridges are `kind: 'bridge'` as East Asia's: based at the sea (y 0), their `pylons` and `ends` here
// worked out from a centre, a true bearing and the article's lengths [EST: the bearing and the centre], their
// parts the pylons' circles only.
EUROPE_LANDMARKS.push(
  // Berlin
  EU({ id: 'fernsehturm', city: 'berlin', country: 'DE', lat: 52.52083, lon: 13.40944, heightM: 368, footprintM: 23, brg: 0,
    source: 'Wikipedia "Fernsehturm Berlin" (read 2026-11-21, with its coordinates): 368.03 m with the antenna, the visitor platform about 203 m, the restaurant 207 m; the sphere 32 m across and its centre at 212 m [EST], the shaft\'s taper and the foot [EST]' }),
  EU({ id: 'brandenburg', city: 'berlin', country: 'DE', lat: 52.5163, lon: 13.3777, heightM: 26, footprintM: 34, brg: 0,
    source: 'Wikipedia "Brandenburg Gate" (read 2026-11-21, with its coordinates): 26 m, twelve Doric columns six to each side, five passageways, the quadriga on top; 65.5 m wide and 11 m deep [from memory], the wings\' and attic\'s sizes [EST]' }),
  // Vienna
  EU({ id: 'stephansdom', city: 'vienna', country: 'AT', lat: 48.2085, lon: 16.373, heightM: 136.7, footprintM: 62, brg: 0,
    source: 'Wikipedia "St. Stephen\'s Cathedral, Vienna" (read 2026-11-21, with its coordinates): 136.7 m (the south tower), 107 m long, 70 m wide; the roof\'s ridge (62 m), the north tower (68 m) and the west towers (65 m) [EST], the axis [EST]' }),
  EU({ id: 'donauturm', city: 'vienna', country: 'AT', lat: 48.24, lon: 16.41083, heightM: 252, footprintM: 16, brg: 0,
    source: 'Wikipedia "Donauturm" (read 2026-11-21, with its coordinates): 252 m, the viewing platform at 150 m, the revolving restaurants at 161.2 m and 169.4 m; the pod\'s rings and the shaft [EST]' }),
  EU({ id: 'riesenrad', city: 'vienna', country: 'AT', lat: 48.21665, lon: 16.39595, heightM: 64.75, footprintM: 32, brg: 30,
    source: 'Wikipedia "Wiener Riesenrad" (read 2026-11-21, with its coordinates): 64.75 m, 15 gondolas since its rebuilding; the wheel about 61 m across [from memory], its plane\'s bearing and the trestles [EST]' }),
  // Milan
  EU({ id: 'duomo', city: 'milan', country: 'IT', lat: 45.46417, lon: 9.19139, heightM: 108.5, footprintM: 92, brg: 0,
    source: 'Wikipedia "Milan Cathedral" (read 2026-11-21, with its coordinates): 108 m (infobox), the Madonnina\'s spire at 108.5 m (text), 158.6 m long, 92 m wide; the aisles\', nave\'s and octagon\'s heights, the pinnacles\' count and the axis [EST]' }),
  // Lisbon
  EU({ id: 'ponte25', city: 'lisbon', country: 'PT', kind: 'bridge', lat: 38.68917, lon: -9.17694, heightM: 190, footprintM: 1000,
    pylons: [[38.693608, -9.178253], [38.684732, -9.175627]], ends: [[38.697933, -9.179532], [38.680407, -9.174348]],
    source: 'Wikipedia "25 de Abril Bridge" (read 2026-11-21, with its coordinates): main span 1,012.9 m (1,013 m in the text), width 24.5 m, the infobox\'s height 180 m (190 m the brief\'s and the towers\' commonly quoted figure, used) [EST]; the side spans 483 m and the deck 70 m clear [from memory]; the axis\'s true bearing 167 degrees [EST]; the model 2,000 m between its anchorages' }),
  EU({ id: 'cristorei', city: 'lisbon', country: 'PT', lat: 38.67861, lon: -9.17134, heightM: 110, footprintM: 27, brg: 0,
    source: 'Wikipedia "Christ the King (Almada)" (read 2026-11-21, with its coordinates): 110 m with its base, the pedestal 82 m of four arches facing the compass points, the figure 28 m, the terrace 79.3 m, on a clifftop 133 m above the river; the legs\' and the figure\'s proportions [EST]' }),
  EU({ id: 'vascodagama', city: 'lisbon', country: 'PT', kind: 'bridge', lat: 38.776, lon: -9.078, heightM: 150, footprintM: 10615,
    pylons: [[38.777029, -9.080032], [38.774971, -9.075968]], ends: [[38.783712, -9.093233], [38.724127, -8.975541]],
    source: 'Wikipedia "Vasco da Gama Bridge" (read 2026-11-21: 17.2 km with the access roads, coordinates 38.762 N 9.043 W): the north viaduct 488 m, the Expo viaduct 672 m, the main bridge 829 m (span 420 m, side spans 203 m, pillars 150 m, 45 m clear), the central viaduct 6,351 m at 14 to 30 m, the south viaduct 3,825 m; the main span\'s place (38.776 N 9.078 W) and the axis\'s true bearing 123 degrees, straight [EST]' }),
  // the Øresund and Malmö
  EU({ id: 'oresund', city: 'oresund', country: 'DK', kind: 'bridge', lat: 55.578757, lon: 12.825678, heightM: 204, footprintM: 4470,
    pylons: [[55.579512, 12.822046], [55.578002, 12.829309]], ends: [[55.589714, 12.772899], [55.565055, 12.891507]],
    source: 'Wikipedia "Øresund Bridge" (read 2026-11-21, with its coordinates): 7,845 m, main span 490 m (the cable-stayed part 1,092 m), pylons 204 m, 57 m clear, width 23.5 m, the approaches\' piers every 140 m; the ends where the game\'s 250 m terrain has Peberholm\'s eastern tip and the Swedish shore at Lernacken (8.0 km apart there; the article\'s coordinates, 55.5706 N 12.8494 E, about 1.1 km east of the line\'s middle), the main span 3,560 m from the west end [from memory: the west approach 3,014 m] [EST]' }),
  EU({ id: 'torso', city: 'malmo', country: 'SE', lat: 55.61333, lon: 12.97611, heightM: 190, footprintM: 18, brg: 0, floors: 54,
    source: 'Wikipedia "Turning Torso" (read 2026-11-21): 190 m roof, top floor 178.79 m, 54 floors, nine segments of five-storey pentagons, the top one turned 90 degrees; the coordinates [from memory, the article gives none in its infobox], the plan\'s size [EST]' }),
  // Dublin
  EU({ id: 'poolbeg', city: 'dublin', country: 'IE', lat: 53.339605, lon: -6.189821, heightM: 207.8, footprintM: 47, brg: 0,
    parts: [[-37.5, 0, 12], [37.5, 0, 12]],
    source: 'Wikipedia "Poolbeg Generating Station" (read 2026-11-21, with its coordinates, the station\'s): chimney 1 207.48 m, chimney 2 207.8 m; their places (75 m apart east to west), taper and bands\' count [EST]' }),
  // Brussels
  EU({ id: 'palaisjustice', city: 'brussels', country: 'BE', lat: 50.83667, lon: 4.35167, heightM: 116, footprintM: 110, brg: 0,
    source: 'Wikipedia "Palace of Justice, Brussels" (read 2026-11-21, with its coordinates): 116 m (the infobox; the brief\'s 104 m taken as the dome\'s own top), 160 x 150 m; the blocks\', drum\'s and dome\'s sizes and the axis [EST]' }),
  // Jodrell Bank, south of Manchester
  EU({ id: 'lovell', city: 'manchester', country: 'GB', lat: 53.2365, lon: -2.3084, heightM: 89, footprintM: 50, brg: 180,
    source: 'Wikipedia "Lovell Telescope" (read 2026-11-21, with its coordinates): the bowl 76.2 m, the elevation axis 50.5 m, 89.0 m at most above the ground, the wheel girders\' radius 38.5 m; the bowl\'s depth, the towers\' spacing and the pose (20 degrees up, facing south) [EST]' }),
  // Toulouse
  EU({ id: 'rocket', city: 'toulouse', country: 'FR', lat: 43.58696, lon: 1.49316, heightM: 53, footprintM: 11, brg: 0,
    source: 'Wikipedia "Cité de l\'espace" (read 2026-11-21, with its coordinates, the park\'s): a full-scale launcher mock-up, 55 m in the article (53 m the brief\'s and the launcher\'s own [EST], used); the boosters\' and the fairing\'s sizes [EST], its place in the park [EST]' }),
);
Object.assign(EUROPE_CITY_BOXES, {
  berlin: [52.40, 13.25, 52.60, 13.55], vienna: [48.15, 16.30, 48.28, 16.48], milan: [45.40, 9.10, 45.52, 9.28],
  lisbon: [38.60, -9.25, 38.82, -8.90], oresund: [55.50, 12.70, 55.65, 12.95], malmo: [55.55, 12.95, 55.65, 13.05],
  dublin: [53.28, -6.40, 53.42, -6.10], brussels: [50.78, 4.28, 50.90, 4.45], manchester: [53.20, -2.40, 53.50, -2.15],
  toulouse: [43.55, 1.35, 43.68, 1.52],
});
for (const L of EUROPE_LANDMARKS) { const [x, y] = toMap(L.lat, L.lon); L.x = x; L.y = y; }
// v0.7.1: Europe's bridges' axes, parts and decks, as East Asia's above.
for (const L of EUROPE_LANDMARKS) {
  if (L.kind !== 'bridge') continue;
  const P = L.pylons.map(([la, lo]) => toMap(la, lo));
  const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
  L.brg = Math.atan2(ux, uy) * 180 / Math.PI;
  L.parts = P.map(([px, py]) => [px - L.x, py - L.y, PYLON_R]);
  L.endsMap = L.ends.map(([la, lo]) => toMap(la, lo));
  const along = L.endsMap.map(([ex, ey]) => (ex - L.x) * ux + (ey - L.y) * uy);
  L.geo = { s: len / 2, n0: Math.min(...along), n1: Math.max(...along) };
}
// v0.7.2 (briefs/V0-7-2.md part 4): the next cities' landmarks, appended in the brief's order. Figures read on
// 2026-11-21 from each Wikipedia article (its infobox, text and coordinates); [EST] marks what is estimated. The three
// Forth bridges are `kind: 'bridge'` as v0.7.1's: based at the sea (y 0), their `pylons` (the outer two towers) and
// `ends` worked out from a centre, a true bearing and the article's lengths, the ends checked against the installed
// 250 m ground (both on land); the bearings and the centres [EST].
EUROPE_LANDMARKS.push(
  // Cologne and Düsseldorf
  EU({ id: 'koelnerdom', city: 'cologne', country: 'DE', lat: 50.94139, lon: 6.95833, heightM: 157.4, footprintM: 100, brg: -2,
    source: 'Wikipedia "Cologne Cathedral" (read 2026-11-21, with its coordinates): the spires 157.4 m, 144.5 m long, 86.25 m wide; the nave\'s, aisles\' and roof\'s heights, the towers\' stages and the axis [EST]' }),
  EU({ id: 'rheinturm', city: 'dusseldorf', country: 'DE', lat: 51.21778, lon: 6.76167, heightM: 240.5, footprintM: 15, brg: 0,
    source: 'Wikipedia "Rheinturm" (read 2026-11-21, with its coordinates): 240.5 m, the revolving restaurant at 172.5 m and the observation deck at 168 m; the shaft\'s and pod\'s sizes [EST]' }),
  // Prague
  EU({ id: 'zizkov', city: 'prague', country: 'CZ', lat: 50.08083, lon: 14.45139, heightM: 216, footprintM: 18, brg: -8,
    source: 'Wikipedia "Žižkov Television Tower" (read 2026-11-21, with its coordinates): 216 m, three tubes of steel filled with concrete on a triangle, nine pods and three decks, one tube higher than the others; the pods\' and decks\' heights, the tubes\' sizes [EST]' }),
  EU({ id: 'stvitus', city: 'prague', country: 'CZ', lat: 50.0908, lon: 14.4006, heightM: 102.8, footprintM: 148, brg: -8,
    source: 'Wikipedia "St. Vitus Cathedral" (read 2026-11-21, with its coordinates): 124 x 60 m, the main tower 102.8 m (about 97 m the brief\'s), the front towers 82 m, the vault 33.2 m; "Prague Castle" (read 2026-11-21: about 570 m long, no coordinates given): the castle\'s ranges, the terrace and the axis [EST]' }),
  // Geneva
  EU({ id: 'jetdeau', city: 'geneva', country: 'CH', lat: 46.20722, lon: 6.15611, heightM: 140, footprintM: 151, brg: -22,
    parts: [[0, 0, 12]],
    source: 'Wikipedia "Jet d\'Eau" (read 2026-11-21, with its coordinates): reached by a stone jetty from the left bank, 500 litres a second jetted to 150 m (140 m the brief\'s and the commonly quoted figure, used); the jetty\'s length and bearing (towards the shore, 150 m) and the lean [EST]' }),
  // the Forth, west of Edinburgh (east to west)
  EU({ id: 'forthbridge', city: 'edinburgh', country: 'GB', kind: 'bridge', lat: 56.0004, lon: -3.3886, heightM: 110, footprintM: 1370,
    pylons: [[55.995605, -3.386303], [56.005195, -3.390898]], ends: [[55.988586, -3.382941], [56.010016, -3.393209]],
    source: 'Wikipedia "Forth Bridge" (read 2026-11-21, with its coordinates): 8,094 ft (2,467 m), two main spans of 1,700 ft, the cantilever towers 361 ft (110 m) above high water, 120 ft wide at the piers and 32 ft at the centre; the arms 680 ft and the suspended girders 350 ft [from memory]; the deck\'s height, the approach spans, the true bearing (-15 degrees) and the split of the length [EST]' }),
  EU({ id: 'forthroad', city: 'edinburgh', country: 'GB', kind: 'bridge', lat: 56.00168, lon: -3.40406, heightM: 156, footprintM: 1265,
    pylons: [[55.997174, -3.403355], [56.006186, -3.404765]], ends: [[55.990428, -3.4023], [56.012932, -3.405821]],
    source: 'Wikipedia "Forth Road Bridge" (read 2026-11-21, with its coordinates): 2,512 m, main span 1,006 m, towers 156 m, 33 m wide; the side spans 408 m [from memory]; the deck\'s clearance, the true bearing (-5 degrees) and the ends [EST]' }),
  EU({ id: 'queensferry', city: 'edinburgh', country: 'GB', kind: 'bridge', lat: 56.002065, lon: -3.41405, heightM: 207, footprintM: 1360,
    pylons: [[55.996572, -3.417625], [56.007558, -3.410474]], ends: [[55.990656, -3.421474], [56.013473, -3.406622]],
    source: 'Wikipedia "Queensferry Crossing" (read 2026-11-21: 56.0046 N 3.4124 W): 2,700 m, three towers 207 m, the main spans 650 m; the cable-stayed part, the deck\'s width and clearance, the true bearing (20 degrees) and the centre (about 300 m south of the article\'s point, where the game\'s ground puts both ends on land) [EST]' }),
  EU({ id: 'edinburghcastle', city: 'edinburgh', country: 'GB', lat: 55.94861, lon: -3.20083, heightM: 90, footprintM: 136, brg: 5,
    source: 'Wikipedia "Edinburgh Castle" (read 2026-11-21, with its coordinates): on Castle Rock, its summit 130 m above sea level, cliffs to the south, west and north rising 80 m above the land round it; the model\'s own rock 70 m [EST], the buildings\' plans and heights [EST]' }),
  // Santiago de Compostela
  EU({ id: 'santiago', city: 'santiago', country: 'ES', lat: 42.88056, lon: -8.54444, heightM: 75, footprintM: 57, brg: 9,
    source: 'Wikipedia "Santiago de Compostela Cathedral" (read 2026-11-21, with its coordinates): 100 m long, 70 m wide, 75 m at most (the clock tower rises to 75 m); the west towers 74 m, the nave\'s heights and the axis [EST]' }),
);
Object.assign(EUROPE_CITY_BOXES, {
  cologne: [50.88, 6.85, 51.00, 7.05], dusseldorf: [51.15, 6.70, 51.30, 6.85], prague: [50.00, 14.30, 50.15, 14.55],
  geneva: [46.15, 6.05, 46.26, 6.20], edinburgh: [55.90, -3.45, 56.03, -3.10], santiago: [42.84, -8.60, 42.92, -8.50],
});
// v0.7.2's map positions and bridges' axes, parts and decks, as the loops above (for the entries after the forty-three).
for (const L of EUROPE_LANDMARKS.slice(43)) {
  const [x, y] = toMap(L.lat, L.lon); L.x = x; L.y = y;
  if (L.kind !== 'bridge') continue;
  const P = L.pylons.map(([la, lo]) => toMap(la, lo));
  const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
  L.brg = Math.atan2(ux, uy) * 180 / Math.PI;
  L.parts = P.map(([px, py]) => [px - L.x, py - L.y, PYLON_R]);
  L.endsMap = L.ends.map(([la, lo]) => toMap(la, lo));
  const along = L.endsMap.map(([ex, ey]) => (ex - L.x) * ux + (ey - L.y) * uy);
  L.geo = { s: len / 2, n0: Math.min(...along), n1: Math.max(...along) };
}
// v0.7.3: Europe's last landmarks, appended in the brief's order after the fifty-three. Figures read on 2026-11-22
// from each Wikipedia article (its infobox, text and coordinates); [EST] marks what is estimated. The Dom Luís I Bridge
// is `kind: 'bridge'` as the Forth's: based at 0 (the Douro at Porto is tidal: the pending 30 m patch reads the river
// there at 0 m; the 250 m tiles have no water in the gorge), its `pylons` the arch's two feet and its `ends` the upper
// deck's, worked out from the article's point, a true bearing (-10 degrees [EST]) and the article's lengths; both ends
// read on land in the installed 250 m ground.
EUROPE_LANDMARKS.push(
  // Hamburg
  EU({ id: 'elbphil', city: 'hamburg', country: 'DE', lat: 53.54139, lon: 9.98417, heightM: 108, footprintM: 62, brg: -20,
    source: 'Wikipedia "Elbphilharmonie" (read 2026-11-22, with its coordinates): 108 m at its highest point on the western side (about 110 m the brief\'s), 26 floors, the first eight within the brick facade of the 1963 warehouse; the plan\'s sizes (about 112 m long), the brick\'s height (37 m), the roof\'s waves and the axis [EST]' }),
  EU({ id: 'hht', city: 'hamburg', country: 'DE', lat: 53.563056, lon: 9.975833, heightM: 279.2, footprintM: 13, brg: 0,
    source: 'Wikipedia "Heinrich Hertz Tower" (read 2026-11-22, with its coordinates): 279.2 m overall, a 204 m shaft of reinforced concrete and the mast above it; the two pods\' heights (about 120 to 152 m) and sizes, the shaft\'s taper [EST]' }),
  // Venice
  EU({ id: 'campanile', city: 'venice', country: 'IT', lat: 45.4340, lon: 12.3390, heightM: 98.6, footprintM: 124, brg: 0,
    parts: [[0, 0, 10], [54, 48, 44]],
    source: 'Wikipedia "St Mark\'s Campanile" (read 2026-11-22, with its coordinates): 98.6 m, the square brick shaft 12 m a side and 50 m tall, the belfry, the attic and the pyramidal spire with the golden vane; the belfry\'s, attic\'s and spire\'s heights, the basilica\'s place (54 m east, 48 m north), plan (76 x 62 m) and domes (about 43 m) [EST]' }),
  // Marseille
  EU({ id: 'ndg', city: 'marseille', country: 'FR', lat: 43.2841, lon: 5.3710, heightM: 72.7, footprintM: 46, brg: 0,
    source: 'Wikipedia "Notre-Dame de la Garde" (read 2026-11-22, with its coordinates): on a limestone peak 162 m above the sea; the square bell tower 41 m, its cylindrical belfry 12.5 m, the statue 11.2 m (the model 72.7 m from its fort base); the fort base (8 m), the nave, the dome, the plan and the axis [EST]' }),
  // Lyon
  EU({ id: 'fourviere', city: 'lyon', country: 'FR', lat: 45.7625, lon: 4.8225, heightM: 48, footprintM: 50, brg: -135,
    source: 'Wikipedia "Basilica of Notre-Dame de Fourvière" (read 2026-11-22, with its coordinates): 86 m long, 35 m wide, white marble; the four octagonal corner towers about 48 m (the brief; no height in the article) [EST], the nave\'s and roof\'s heights, the apse and the axis (the front to the south-east) [EST]' }),
  EU({ id: 'fourvieretower', city: 'lyon', country: 'FR', lat: 45.763769, lon: 4.822267, heightM: 101, footprintM: 12, brg: 0,
    source: 'Wikipedia "Metallic tower of Fourvière" (read 2026-11-22, with its coordinates): a steel framework tower, 101 m with the antenna, 85.9 m before it; the base\'s and platforms\' sizes [EST]' }),
  // Porto
  EU({ id: 'domluis', city: 'porto', country: 'PT', kind: 'bridge', lat: 41.139863, lon: -8.609336, heightM: 45, footprintM: 200,
    pylons: [[41.139099, -8.609157], [41.140627, -8.609515]], ends: [[41.138113, -8.608926], [41.141613, -8.609746]],
    source: 'Wikipedia "Dom Luís I Bridge" (read 2026-11-22, with its coordinates): a two-deck iron arch, the arch 172.5 m across, the upper deck 395.25 m long, the lower deck 172 m; the upper deck about 45 m above the river (the brief; the article\'s 70 m is unsourced), the lower deck\'s height (10 m), the arch\'s depth, the piers and the true bearing (-10 degrees) [EST]' }),
  // Innsbruck
  EU({ id: 'bergisel', city: 'innsbruck', country: 'AT', lat: 47.24889, lon: 11.39917, heightM: 50, footprintM: 97, brg: 0,
    parts: [[0, 0, 16]],
    source: 'Wikipedia "Bergisel Ski Jump" (read 2026-11-22: its coordinates, the hill size HS128; no height given): the tower about 50 m (the brief) [EST], the pod\'s sizes, the in-run\'s line (north, about 95 m to the take-off) and its supports [EST]' }),
);
Object.assign(EUROPE_CITY_BOXES, {
  hamburg: [53.50, 9.90, 53.62, 10.10], venice: [45.40, 12.28, 45.47, 12.39], marseille: [43.24, 5.32, 43.34, 5.42],
  lyon: [45.72, 4.78, 45.80, 4.89], porto: [41.11, -8.66, 41.18, -8.56], innsbruck: [47.21, 11.34, 47.30, 11.45],
});
// v0.7.3's map positions and bridge's axis, parts and decks, as the loops above (for the entries after the fifty-three).
for (const L of EUROPE_LANDMARKS.slice(53)) {
  const [x, y] = toMap(L.lat, L.lon); L.x = x; L.y = y;
  if (L.kind !== 'bridge') continue;
  const P = L.pylons.map(([la, lo]) => toMap(la, lo));
  const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
  L.brg = Math.atan2(ux, uy) * 180 / Math.PI;
  L.parts = P.map(([px, py]) => [px - L.x, py - L.y, PYLON_R]);
  L.endsMap = L.ends.map(([la, lo]) => toMap(la, lo));
  const along = L.endsMap.map(([ex, ey]) => (ex - L.x) * ux + (ey - L.y) * uy);
  L.geo = { s: len / 2, n0: Math.min(...along), n1: Math.max(...along) };
}
// v0.7.4 part 9, item 6 (LANDMARKS77, landmark-models.js): Tower Bridge becomes `kind: 'bridge'` as the Forth's, based at
// the Thames (y 0; the installed 250 m ground reads about 2.4 m there), its `pylons` the two towers' centres (77 m apart)
// and its `ends` the abutment towers' outer faces (244 m apart), on a true bearing of 0 [EST] through the article's point.
// Its `parts` stay the one 122 m circle it had, so the real centres leave out what they did. Switch off: v0.7.3's entry.
if (LANDMARKS77) {
  const L = EUROPE_LANDMARKS.find((l) => l.id === 'towerbridge'), dLat = (m) => m / 111195;
  L.kind = 'bridge';
  L.pylons = [[L.lat - dLat(38.5), L.lon], [L.lat + dLat(38.5), L.lon]];
  L.ends = [[L.lat - dLat(122), L.lon], [L.lat + dLat(122), L.lon]];
  const P = L.pylons.map(([la, lo]) => toMap(la, lo));
  const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
  L.brg = Math.atan2(ux, uy) * 180 / Math.PI;
  L.parts = [[0, 0, L.footprintM]];
  L.endsMap = L.ends.map(([la, lo]) => toMap(la, lo));
  const along = L.endsMap.map(([ex, ey]) => (ex - L.x) * ux + (ey - L.y) * uy);
  L.geo = { s: len / 2, n0: Math.min(...along), n1: Math.max(...along) };
}
// The page's region's list: what the runtime builds and the real centres leave out (East Asia's: LANDMARKS itself).
export const REGION_LANDMARKS = REGION_ID === 'europe' ? EUROPE_LANDMARKS : LANDMARKS;

// The real centres' extrusion leaves these out: one circle per tower, in map metres.
export function landmarkFootprints() {
  const out = [];
  for (const L of REGION_LANDMARKS) {
    if (L.parts) for (const [dx, dy, r] of L.parts) out.push({ id: L.id, x: L.x + dx, y: L.y + dy, r });
    else out.push({ id: L.id, x: L.x, y: L.y, r: L.footprintM });
  }
  return out;
}

// endH: a bridge's ground at its two ends (m; heightAt there when built), else 30 m.
export function buildModel(L, endH = null) {
  if (L.region === 'europe') return L.kind === 'bridge' ? EUROPE_MODELS[L.id](L.brg, { ...L.geo, ...(endH ? { h0: endH[0], h1: endH[1] } : {}) }) : EUROPE_MODELS[L.id](L.brg);
  const f = MODELS[L.id];
  if (L.id === 'parc1') return f(L.brg, L.parts[1].slice(0, 2));
  if (L.id === 'lct') return f(undefined, L.brg);
  if (L.kind === 'bridge') return f(L.brg, { ...L.geo, ...(endH ? { h0: endH[0], h1: endH[1] } : {}) });
  return f(L.brg);   // (the round ones take no bearing and ignore it)
}

// A bridge's ground at its ends, in the order of L.geo's n0, n1: the higher of the ground there and
// a few metres (the deck never dives into the water at an end that reads as sea).
export function bridgeEnds(L, heightAt) {
  const e = L.endsMap.map(([x, y]) => Math.max(heightAt(x, y), 3));
  const ux = Math.sin(L.brg * Math.PI / 180), uy = Math.cos(L.brg * Math.PI / 180);
  const a0 = (L.endsMap[0][0] - L.x) * ux + (L.endsMap[0][1] - L.y) * uy;
  return a0 <= 0 ? e : [e[1], e[0]];
}

// Is this landmark on in the scene now? Every one since v0.7.0 (v0.6.0's flags held all but Korea's back).
// v0.7.0: and only in its own region (a landmark with no `region` is East Asia's: the thirty of v0.6.x; in
// another region's frame its latitude and longitude would land far off the map).
export const landmarkOn = (L) => (L.region || 'east-asia') === REGION_ID;

// ------------------------------------------------------------------ the shaders

function buildingMaterial(uniforms, chunks) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      attribute vec3 aCol, aGlow;
      attribute vec4 aFac, aExt;
      varying vec3 vRel, vN, vLocal, vCol, vGlow;
      varying vec4 vFac, vExt;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vRel = wp.xyz - uCamPos;
        vN = mat3(modelMatrix) * normal;
        vLocal = position;
        vCol = aCol; vGlow = aGlow; vFac = aFac; vExt = aExt;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${chunks.ATMOS_GLSL}
      ${chunks.NOISE_GLSL}
      varying vec3 vRel, vN, vLocal, vCol, vGlow;
      varying vec4 vFac, vExt;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float dist = length(vRel);
        // A lattice's far stand-in: not drawn within about 3 km (a dithered hand-over).
        if (vExt.z > 0.5 && hash12(floor(gl_FragCoord.xy)) > smoothstep(1800.0, 3600.0, dist)) discard;
        vec3 n = normalize(vN);
        vec3 V = -vRel / max(dist, 1e-3);
        if (dot(n, V) < 0.0 && vExt.z < 0.5) n = -n;     // thin members seen from behind
        vec3 alb = vCol;
        vec3 glow = vec3(0.0);
        float refl = 0.0;
        float y = vLocal.y;
        if (vFac.x > 0.0 && abs(n.y) < 0.8) {
          // The curtain wall: floors, the spandrel between them, mullions every bay.
          float fh = vFac.x, bw = vFac.y, u = vExt.x;
          float fl = fract(y / fh), bu = fract(u / bw);
          float fw = max(fwidth(y) / fh, fwidth(u) / bw);
          float win = smoothstep(0.10, 0.18, fl) * (1.0 - smoothstep(0.86, 0.94, fl));
          win *= smoothstep(0.02, 0.08, bu) * (1.0 - smoothstep(0.92, 0.98, bu));
          win = mix(win, 0.72, smoothstep(0.35, 1.2, fw));       // averaged out once a floor is a pixel or two
          vec3 frame = mix(alb, vec3(0.36, 0.37, 0.38), 0.45);
          alb = mix(frame, alb * 0.75, win);
          refl = vFac.z * win;
          if (uNight > 0.01 && vFac.w > 0.0) {
            // Lit windows, as the cities' are: one cell per two bays and floor, a share of them lit.
            vec2 cid = vec2(floor(u / (2.0 * bw)), floor(y / fh));
            float hs = hash12(cid + vec2(vExt.y * 913.0, vExt.y * 371.0));
            float lit = step(hs, vFac.w);
            float hk = hash12(cid * 1.37 + vExt.y * 77.0 + 3.1);
            vec3 wc = hk < 0.55 ? vec3(1.0, 0.78, 0.50) : (hk < 0.9 ? vec3(0.85, 0.88, 0.95) : vec3(1.0, 0.58, 0.28));
            float dim = 0.5 + 0.5 * hash12(cid + 11.7 + vExt.y * 19.0);
            float avg = smoothstep(0.5, 1.6, max(fwidth(y) / fh, fwidth(u) / (2.0 * bw)));
            glow += mix(wc * lit * dim, vec3(1.0, 0.8, 0.55) * vFac.w * 0.45, avg) * win * uNight * 0.8;
          }
        } else if (vFac.z > 0.0) {
          refl = vFac.z;
        }
        if (uSnow > 0.0) alb = mix(alb, vec3(0.55, 0.57, 0.60), uSnow * 0.75 * smoothstep(0.55, 0.9, n.y));
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * ndl * 2.2 + uSkyAmb * (0.55 + 0.45 * n.y) * 1.1);
        // Glass and metal: the sky (and the ground below the horizon) by Fresnel, and the sun's glint.
        vec3 R = reflect(-V, n);
        float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        float rw = refl * mix(0.35, 1.0, fres);
        float hd = horizonDip();
        vec3 sky = hazeColor(vec3(R.x, max(R.y, hd), R.z));
        vec3 env = mix(mix(sky, vec3(0.10, 0.105, 0.10) * (0.25 + uSunColor * 0.6), 0.6), sky, smoothstep(hd - 0.25, hd + 0.03, R.y));
        // gold or tinted glass reflects in its own colour (vExt.w > 0.7: a metallic coating)
        env *= vExt.w > 0.7 ? mix(vec3(1.0), normalize(vCol + 1e-3) * 1.7, 0.75) : vec3(1.0);
        col = mix(col, env * 0.9, rw * 0.85);
        float sp = pow(max(dot(R, uSunDir), 0.0), 180.0) * (refl * 3.0 + vExt.w * 0.6);
        col += uSunColor * sp * uSunVis;
        // At night the facade's own light (the famous floodlights), and the windows.
        col += (vGlow * uNight) * (0.55 + 0.45 * max(dot(n, V), 0.0)) + glow;
        gl_FragColor = vec4(applyHaze(col, vRel), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// The aviation lights: points that hold their size on screen (as airports.js's), dimmer rather
// than smaller far away; the top ones flash slowly (about 30 a minute), the rest steady.
function lightMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uCamPos;
      uniform float uCamAlt, uTime, uPxScale, uNight, uHazeSigma0, uHazeH, uLightCarry;
      attribute float aKind;
      varying vec3 vCol;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 r = wp.xyz - uCamPos;
        float dist = length(r);
        float I = 1.0;
        if (aKind > 0.5) {
          // a slow flash, each tower its own phase (from its position: the same every run)
          float ph = fract(uTime * 0.5 + fract(position.x * 0.013 + position.z * 0.007));
          I = 0.08 + 1.4 * exp(-pow((ph - 0.25) / 0.12, 2.0));
        }
        float od = uHazeSigma0 * dist * exp(-max(min(uCamAlt, wp.y + 0.5 * r.y), 0.0) / uHazeH);
        I *= exp(-od * uLightCarry);
        float px = 3.0 * uPxScale / max(dist, 1.0);
        float minPx = 2.5;
        I *= clamp(pow(px / minPx, 0.35), 0.3, 1.0);
        float S = clamp(px, minPx, 10.0) * (aKind > 0.5 ? 2.6 : 2.0);
        gl_PointSize = S * step(0.002, I);
        vCol = vec3(1.0, 0.07, 0.03) * I * uNight * 1.6;
        vec4 mv = viewMatrix * wp;
        float d = length(mv.xyz);
        mv.xyz *= 1.0 - min((1.5 + d * 0.002) / max(d, 1e-3), 0.5);    // pulled in a little: off the facade
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vCol * (exp(-r2 * 9.0) * 1.4 + exp(-r2 * 2.5) * 0.25), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ the runtime

// The ground under a landmark: the lowest of heightAt at its centre and round its plan (so no
// side floats), less half a metre.
export function baseHeight(L, heightAt) {
  if (L.kind === 'bridge') return 0;     // a bridge stands in the sea: its model's y 0 is the water
  let h = heightAt(L.x, L.y);
  const circles = L.parts ? L.parts.map(([dx, dy, r]) => [L.x + dx, L.y + dy, r]) : [[L.x, L.y, L.footprintM]];
  for (const [x, y, r] of circles) {
    h = Math.min(h, heightAt(x, y));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; h = Math.min(h, heightAt(x + 0.8 * r * Math.cos(a), y + 0.8 * r * Math.sin(a))); }
  }
  return h - 0.5;
}

export function createLandmarks(scene, uniforms, chunks, { heightfield = null, renderer = null } = {}) {
  void renderer;
  const hf = heightfield;
  const heightAt = (x, y) => (hf ? hf.heightAt(x, y) : 0);
  const group = new THREE.Group();
  group.name = 'landmarks';
  let mat = null, lmat = null, added = false;
  const items = REGION_LANDMARKS.map((L) => ({ L, state: 'none', mesh: null, pts: null, ground: 0, tris: 0, ms: 0 }));
  const stats = { drawCalls: 0, triangles: 0, shown: 0, built: 0, lights: 0, buildMs: 0 };

  function build(it) {
    const t0 = performance.now();
    if (!mat) { mat = buildingMaterial(uniforms, chunks); lmat = lightMaterial(uniforms); }
    const { geometry, lights } = buildModel(it.L, it.L.kind === 'bridge' ? bridgeEnds(it.L, heightAt) : null);
    it.ground = baseHeight(it.L, heightAt);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `landmark-${it.L.id}`;
    mesh.matrixAutoUpdate = true;
    mesh.visible = false;
    it.mesh = mesh;
    it.tris = geometry.getAttribute('position').count / 3;
    if (lights.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap((l) => [l[0], l[1], l[2]]), 3));
      g.setAttribute('aKind', new THREE.Float32BufferAttribute(lights.map((l) => l[3]), 1));
      g.computeBoundingSphere();
      g.boundingSphere.radius += 10;
      const pts = new THREE.Points(g, lmat);
      pts.name = `landmark-lights-${it.L.id}`;
      pts.renderOrder = 9;
      pts.visible = false;
      it.pts = pts;
      group.add(pts);
    }
    group.add(mesh);
    it.state = 'built';
    it.ms = performance.now() - t0;
    stats.buildMs = Math.max(stats.buildMs, it.ms);
    if (hf && hf.tiles && hf.tiles.release) hf.tiles.release(`landmark:${it.L.id}`);
  }
  function release(it) {
    if (it.mesh) { group.remove(it.mesh); it.mesh.geometry.dispose(); }
    if (it.pts) { group.remove(it.pts); it.pts.geometry.dispose(); }
    // A landmark released while its tiles were still loading gives its pin back too.
    if (it.state === 'pending' && hf && hf.tiles && hf.tiles.release) hf.tiles.release(`landmark:${it.L.id}`);
    it.mesh = null; it.pts = null; it.state = 'none';
  }
  function request(it) {
    const T = hf && hf.tiles;
    if (T && T.whenReady && !T.isReady?.(it.L.x, it.L.y, 600)) {
      it.state = 'pending';
      T.whenReady(it.L.x, it.L.y, 600, `landmark:${it.L.id}`).then(() => { if (it.state === 'pending') build(it); }, () => { it.state = 'none'; });
    } else build(it);
  }

  const api = {
    group, stats, items,
    // camMap: the camera's map x, y; origin: the scene origin's; camScene: the camera's scene position.
    // Off: everything hidden (a dev page's on/off comparison); nothing is released.
    enabled: true,
    update({ camMap, origin, camScene = null }) {
      let calls = 0, tris = 0, shown = 0, built = 0, lightsN = 0;
      if (!api.enabled) {
        for (const it of items) { if (it.mesh) it.mesh.visible = false; if (it.pts) it.pts.visible = false; }
        stats.drawCalls = 0; stats.triangles = 0; stats.shown = 0; stats.lights = 0;
        return stats;
      }
      const night = uniforms.uNight.value >= 0.01;
      const cx = camScene ? camScene.x : 0, cz = camScene ? camScene.z : 0;
      for (const it of items) {
        const L = it.L;
        const on = landmarkOn(L);
        if (!on) { if (it.state !== 'none') release(it); continue; }
        const d = Math.hypot(L.x - camMap.x, L.y - camMap.y);
        if (it.state === 'none' && d < BUILD_M) request(it);
        else if (it.state === 'built' && d > RELEASE_M) release(it);
        if (it.state !== 'built') continue;
        built++;
        const vis = d < SHOW_M;
        const px = L.x - origin.x, pz = -(L.y - origin.y);
        const dx = px - cx, dz = pz - cz;
        const py = it.ground - (dx * dx + dz * dz) / (2 * EARTH_RADIUS);
        it.mesh.visible = vis;
        if (vis) { it.mesh.position.set(px, py, pz); calls++; tris += it.tris; shown++; }
        if (it.pts) {
          it.pts.visible = vis && night;
          if (it.pts.visible) { it.pts.position.set(px, py, pz); calls++; lightsN += it.pts.geometry.getAttribute('position').count; }
        }
      }
      if (built > 0 && !added) { scene.add(group); added = true; }
      else if (built === 0 && added) { scene.remove(group); added = false; }
      stats.drawCalls = calls; stats.triangles = tris; stats.shown = shown; stats.built = built; stats.lights = lightsN;
      return stats;
    },
    dispose() {
      for (const it of items) release(it);
      if (added) scene.remove(group);
      added = false;
      mat?.dispose(); lmat?.dispose(); mat = lmat = null;
    },
  };
  return api;
}
