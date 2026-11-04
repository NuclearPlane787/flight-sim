// The aircraft type registry (v0.3.0): each type is a data module with every number and its source
// (src/sim/a321neo.js is the pattern), its geometry (src/geometry.js is the pattern), and what the
// screens say about it. No DOM and no three.js: the sim, the prediction worker and node tests read it.
// The 3D model, the cockpit and the rest of what only the page needs are in src/type-assets.js.
//
//   typeById(id)  → the entry; an unknown or missing id is the A321neo (saves from before v0.3.0)
//   kitFor(id)    → the type's sim functions, made once: { fm, eng, gear, fbw, auto, boeing }
//   TYPE_LIST     → the types in the picker (a type joins once its part of v0.3.0 is done)

import * as a321Data from './a321neo.js';
import * as a321Geo from '../geometry.js';
import { createFlightModel } from './flightmodel.js';
import { createEngines } from './engines.js';
import { createGear } from './gear.js';
import { createFbw } from './fbw.js';
import { createAutopilot } from './autopilot.js';
import { createFbwBoeing } from './fbw-boeing.js';
import { createAutopilotBoeing } from './autopilot-boeing.js';
import * as b7879Data from './b787-9.js';
import * as b7879Geo from '../geometry-b787-9.js';
import * as b777Data from './b777-300er.js';
import * as b777Geo from '../geometry-b777-300er.js';
import { GENX_1B, GE90_115B } from '../audio/engine-sounds.js';

export const DEFAULT_TYPE = 'a321neo';

export const TYPES = {
  a321neo: {
    id: 'a321neo', name: 'A321neo', maker: 'Airbus', engineName: 'CFM LEAP-1A', registration: 'HL8787', family: 'airbus',
    data: a321Data, geo: a321Geo,
    // The setup screen's limits. OEW and fuel as the setup has always shown them.
    limits: { OEW: 50100, MTOW: 97000, MLW: 79200, MZFW: 75600, FUEL_MAX: Math.round(23580 * 0.8), PAX_MAX: 244, PAX_KG: 84, CARGO_MAX: 9000 },
    // A rough block-fuel rule (setup.js fuelEstimate): climb and descent + per nm, 30 min holding, taxi.
    fuel: { climbKg: 1100, perNm: 6.2, holdKg: 1000, taxiKg: 200 },
    defaults: { pax: 190, cargoKg: 1500 },
    picker: { lengthM: 44.51, spanM: 35.8, mtowT: 97, rangeNm: 3500, seats: 'up to 244', picture: 'assets/types/a321neo.jpg', note: 'Airbus’s fly-by-wire: the aircraft holds its flight path, and protects itself.' },
    icaoCode: 'C',
    orbitDist: 75,                       // 3rd person, m
    score: { best: 5.5, low: 2.5, high: 8 }, // the touchdown pitch: the bowl's centre, and where it steepens
  },
  'b787-9': {
    wingFlexM: 3.0,                      // [EST] the tip's rise at MTOW's lift, 1 g: the composite wing's visible bend
    id: 'b787-9', name: '787-9', maker: 'Boeing', engineName: 'GE GEnx-1B', registration: 'HL7879', family: 'boeing',
    data: b7879Data, geo: b7879Geo, sound: GENX_1B,
    // OEW, MTOW, MLW, MZFW and fuel read from the data module. 420 passengers: the exit limit ([TCDS] p.38). 84 kg each, as the
    // A321neo. Cargo: the holds' structural limits add to 60,395 kg ([TCDS] p.38); the setup also stops at MZFW.
    limits: { OEW: b7879Data.OEW, MTOW: b7879Data.MTOW, MLW: b7879Data.MLW, MZFW: b7879Data.MZFW, FUEL_MAX: b7879Data.FUEL_MAX, PAX_MAX: 420, PAX_KG: 84, CARGO_MAX: 60395 },
    // Block fuel: 11.5 kg/nm is 5.6 t/h at 487 kt, +10% for the heavier early cruise; 30 min holding at 5.6 t/h; 20 min of taxi at idle.
    fuel: { climbKg: 3000, perNm: 12.5, holdKg: 2800, taxiKg: 550 },
    defaults: { pax: 290, cargoKg: 8000 },   // [ACAP] 2-3: 290 in two classes
    // Range [PUB] spec sites' 7,565 nm (ACAP 3-3 charts it, but only by loading); the seats [TCDS] p.38.
    picker: { lengthM: b7879Geo.LENGTH, spanM: b7879Geo.SPAN, mtowT: Math.round(b7879Data.MTOW / 1000), rangeNm: 7565, seats: 'up to 420', picture: 'assets/types/b787-9.jpg', note: 'Boeing’s fly-by-wire: speed-stable, trimmed by hand, and you can overpower its protections.' },
    icaoCode: 'E',
    orbitDist: 105,
    // The touchdown pitch: [EST] about 4.5° at VREF30 with a firm flare (tests/b787-9-performance.test.mjs), high stops 2° short of the 9.6° tail strike.
    score: { best: 4.5, low: 2, high: 7.5 },
  },
  'b777-300er': {
    wingFlexM: 1.8,                      // [EST] a stiffer metal wing
    id: 'b777-300er', name: '777-300ER', maker: 'Boeing', engineName: 'GE GE90-115B', registration: 'HL7773', family: 'boeing',
    data: b777Data, geo: b777Geo, sound: GE90_115B,
    // OEW, MTOW, MLW, MZFW and fuel read from the data module. 550 passengers: the exit limit ([TCDS] p.26). 84 kg each, as the
    // others. Cargo: the documents don't give the holds' limits, so the structural payload ([ACAP] 2-2 MZFW less the OEW); the setup stops at MZFW anyway.
    limits: { OEW: b777Data.OEW, MTOW: b777Data.MTOW, MLW: b777Data.MLW, MZFW: b777Data.MZFW, FUEL_MAX: b777Data.FUEL_MAX, PAX_MAX: 550, PAX_KG: 84, CARGO_MAX: b777Data.MAX_PAYLOAD },
    // Block fuel: about 7.8 t/h at 483 kt is 16 kg/nm, +10% for the heavier early cruise; 30 min holding; 20 min of taxi at idle.
    fuel: { climbKg: 5000, perNm: 17.5, holdKg: 3900, taxiKg: 820 },
    defaults: { pax: 339, cargoKg: 12000 },  // [ACAP] 2-2: 339 in two classes
    // Range [PUB] aerospaceweb's 7,705 nm ([ACAP] 3-3 reads about 7,700 nm with 41 t of payload at MTOW); seats [TCDS] p.26.
    picker: { lengthM: b777Geo.LENGTH, spanM: b777Geo.SPAN, mtowT: Math.round(b777Data.MTOW / 1000), rangeNm: 7705, seats: 'up to 550', picture: 'assets/types/b777-300er.jpg', note: 'Boeing’s fly-by-wire on the longest, heaviest twin here: speed-stable, trimmed by hand, with a small tail margin.' },
    icaoCode: 'E',
    orbitDist: 120,
    // The touchdown pitch: [EST] the hand landings came to 2.7 to 3.9° (tests/b777-300er-performance.test.mjs's firm flare 3.9°); high stops 2° short of the 10° tail strike.
    score: { best: 3.5, low: 1.5, high: b777Data.PITCH_TAILSTRIKE_DEG - 2 },
  },
};

export const TYPE_LIST = () => Object.values(TYPES).filter((t) => t.ready !== false);

export const typeById = (id) => TYPES[id] || TYPES[DEFAULT_TYPE];

const kits = new Map();
export function kitFor(id) {
  const def = typeById(id);
  let k = kits.get(def.id);
  if (!k) {
    const A = def.data;
    k = { fm: createFlightModel(A), eng: createEngines(A), gear: createGear(A), fbw: createFbw(A), auto: createAutopilot(A), boeing: null };
    // The Boeings' law and modes; kit.boeing is what sim.js's Boeing-only hooks call.
    if (def.family === 'boeing') {
      const law = createFbwBoeing(A);
      k.fbw = { fbwStep: law.fbwStep };
      k.auto = createAutopilotBoeing(A);
      k.boeing = law.hooks;
    }
    kits.set(def.id, k);
  }
  return k;
}
