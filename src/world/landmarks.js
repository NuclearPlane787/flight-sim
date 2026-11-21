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
import { MODELS, EUROPE_MODELS } from './landmark-models.js';
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
for (const L of EUROPE_LANDMARKS) { const [x, y] = toMap(L.lat, L.lon); L.x = x; L.y = y; }
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
  if (L.region === 'europe') return EUROPE_MODELS[L.id](L.brg);
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
