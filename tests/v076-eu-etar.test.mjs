// v0.7.6 (airports subagent apa): Ramstein Air Base (ETAR), pending: the checks in tests/v063-ne-airport.mjs, run in a page
// opened in Europe (tests/region-run.mjs: the default run re-runs this file in a child process with FS_REGION=europe;
// directly: FS_REGION=europe FS_PENDING=1 node --test tests/v076-eu-etar.test.mjs). The MIL AIP Germany's site did not
// answer when this was baked: every published value [EST]. 08/26 3,200 x 45 m at OurAirports' ends (OSM's length tag
// too), 09/27 cut to OurAirports' 2,828 m at its 09 end
// (OSM's way 2,974 m), no displacements, the elevations OurAirports' (08 761,
// 26 776, 09 769, 27 782 ft). An ILS (CAT I) to every end, approach lights as OSM maps them (about 900 m at 26, 09 and
// 27, about 500 m at 08), PAPI 3 deg (08's on the right as OSM's node), no TDZ or centreline lights. The whole base is
// military in OSM: four ramp spots for the player alone on Ramp 1, placed by the bake [EST]; no other stand. Inland.
//   python3 tools/cpu-guard.py -- node --test tests/v076-eu-etar.test.mjs
import { inRegion } from './region-run.mjs';

if (inRegion('europe', import.meta.url, { env: { FS_PENDING: '1' } })) {
  const { airportSuite } = await import('./v063-ne-airport.mjs');
  const E = { thrTolM: 15, papiDeg: 3, tdz: false, centreline: false, ils: 'I', approachLights: 'ALSF-I', approachLightsM: 900, displacedM: 0 };
  airportSuite({
    icao: 'ETAR', patch: 'ramstein', coast: false,
    shortName: 'Ramstein', name: 'Ramstein Air Base',
    latLon: [49.436901, 7.60028], elevM: 236.5,
    runways: [
      { id: '09/27', lengthM: 2828, widthM: 45, source: "OSM's way cut to OurAirports' length at 09 [EST]" },
      { id: '08/26', lengthM: 3200, widthM: 45, source: "OurAirports' ends and length, OSM's length tag [EST]" },
    ],
    ends: {
      '08': { ...E, thrSource: 'OurAirports', approachLights: 'SSALF', approachLightsM: 510, papi: 'right', elevFt: 761, thr: [49.432598, 7.578830] },
      '26': { ...E, thrSource: 'OurAirports', elevFt: 776, thr: [49.436401, 7.622540] },
      '09': { ...E, thrSource: "OSM axis, 2,828 m from 27", elevFt: 769, thr: [49.4359721, 7.5779504] },
      '27': { ...E, thrSource: 'OSM', elevFt: 782, thr: [49.4376001, 7.6168661] },
    },
    // both runways lie about 083 deg magnetic today; 09/27 keeps its old name, 7 deg off its ident
    identTolDeg: 8,
    fieldSurface: 'runways', fieldPavement: true,
    // OSM maps no taxiway to 08's end but K from 09's end: every route to 08's hold back-tracks ~420 m along 08/26 from
    // G Middle (or along 09/27 to K), and a landing on 27 or 26 past 90 % turns back along the runway to the exits
    alongRunway: { byEnd: { '08': 450 }, reason: "OSM maps no taxiway to 08's end but K from 09's end: the route back-tracks along the runway" },
    knownTaxiIn: {
      '27@0.9': "no exit ahead of 90 % along 27 in OSM's taxiways: the route turns back along the runway",
      '26@0.9': "no exit ahead of 90 % along 26 in OSM's taxiways (G Middle is behind): the route turns back along the runway",
    },
    // the player's four ramp spots, placed by the bake on Ramp 1 [EST]: each takes the 777-300ER (AIP_STANDS.ETAR)
    stands: { min: 4, max: 4, refs: ['1', '2', '3', '4'], gates: 0, e787: { min: 4, max: 4 }, e777: { min: 4, max: 4 } },
    countries: ['DE'],
    routes: [['ETAR', 'EDDF', 51.3], ['ETAR', 'EDDK', 87.6]],
  });
}
