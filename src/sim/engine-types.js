// v0.5.0: the engine types as parts. Each is the engine its own aircraft type flies with: the sim's numbers come from
// that type's data module (so a LEAP-1A on a 777 has the A321's LEAP-1A, number for number), its nacelle's size from
// that type's geometry, its voice from audio/engine-sounds.js (the LEAP-1A's is synth.js's default: no `sound`).
// No DOM and no three.js: the sim, the prediction worker and node tests read it.
//
//   ENGINE_TYPES[id]  → { id, name, short, from, data: { the engine's numbers }, nacelle: { D, L }, fanM, dryKg, installedKg }
//   ENGINE_LIST       → the three, in the warehouse's order
//   engineOfType(typeId) → the engine type a base aircraft type flies with

import * as a321Data from './a321neo.js';
import * as b7879Data from './b787-9.js';
import * as b777Data from './b777-300er.js';
import * as a321Geo from '../geometry.js';
import * as b7879Geo from '../geometry-b787-9.js';
import * as b777Geo from '../geometry-b777-300er.js';

// The names in a data module that are the engine's own (engines.js reads them). The rest (the lever law, RATING's
// climb and MCT fractions: the airframe's FADEC schedule) stay the airframe's.
export const ENGINE_KEYS = ['T0_ENGINE', 'T_IDLE', 'LAPSE_SIGMA_EXP', 'LAPSE_M1', 'LAPSE_M2', 'REV_FRACTION', 'REV_DEPLOY_S',
  'N1_IDLE', 'N1_TOGA', 'N1_IDLE_ALT', 'N1_IDLE_MACH', 'N1_REV', 'SPOOL_TAU_HIGH', 'SPOOL_TAU_LOW', 'TSFC_C0', 'TSFC_C1', 'FF_IDLE'];
// The ones a thrust scale multiplies: thrust, and the idle fuel flow with it (a bigger engine idles on more fuel).
// The fuel flow above idle is TSFC × thrust, so it follows by itself.
export const SCALED_KEYS = ['T0_ENGINE', 'T_IDLE', 'FF_IDLE'];

const pick = (D) => { const o = {}; for (const k of ENGINE_KEYS) o[k] = D[k]; return Object.freeze(o); };

// Dry weights: see each entry. The installed weight (what the airframe carries per engine: the engine, its nacelle and
// thrust reverser, its pylon, its systems) is [EST] 1.45 × dry: the A321neo's LEAP-1A power plant is about 4.3 t
// installed against about 3 t dry in published weight breakdowns, and the widebodies' nacelles are proportionally
// lighter, so one factor for all three is within about 10 %. A design's mass changes by the installed weights.
const INSTALLED = 1.45;
const ENG = (o) => Object.freeze({ ...o, installedKg: Math.round(o.dryKg * INSTALLED) });

export const ENGINE_TYPES = Object.freeze({
  'leap-1a': ENG({
    id: 'leap-1a', name: 'CFM LEAP-1A', short: 'LEAP-1A', from: 'a321neo', data: pick(a321Data),
    nacelle: { D: a321Geo.NACELLE_DIAMETER, L: a321Geo.NACELLE_LENGTH }, fanM: 1.98,
    // [TCDS] FAA E00089EN Rev 1: the engine's nominal weight 6,952 lb (3,153 kg) (aggregators' 2,990 kg leaves out the
    // EBU). EASA.E.110's weight section not read in the run.
    dryKg: 3153,
  }),
  'genx-1b': ENG({
    id: 'genx-1b', name: 'GE GEnx-1B', short: 'GEnx-1B', from: 'b787-9', data: pick(b7879Data),
    nacelle: { D: b7879Geo.NACELLE_DIAMETER, L: b7879Geo.NACELLE_LENGTH }, fanM: 2.82,
    // [EST] 6,147 kg: the GEnx-1B's dry weight as secondary sources give it (Wikipedia's GEnx table; PlaneFYI 6,128 kg);
    // EASA IM.E.102's dry-weight section (p. 8) not read in the run.
    dryKg: 6147,
  }),
  'ge90-115b': ENG({
    id: 'ge90-115b', name: 'GE GE90-115B', short: 'GE90-115B', from: 'b777-300er', data: pick(b777Data),
    nacelle: { D: b777Geo.NACELLE_DIAMETER, L: b777Geo.NACELLE_LENGTH }, fanM: 3.25,
    // [EST] 8,283 kg: the GE90-115B's dry weight as MTU (a programme partner) publishes it, 18,260 lb; FAA TCDS E00049EN's
    // weight entry not read in the run (EASA's earlier issue gives 17,400 lb for the lower-thrust GE90 models).
    dryKg: 8283,
  }),
});
export const ENGINE_LIST = ['leap-1a', 'genx-1b', 'ge90-115b'].map((id) => ENGINE_TYPES[id]);
const BY_TYPE = { a321neo: 'leap-1a', 'b787-9': 'genx-1b', 'b777-300er': 'ge90-115b' };
export const engineOfType = (typeId) => ENGINE_TYPES[BY_TYPE[typeId] || 'leap-1a'];
// The pylon's limit (V050.md): 1.5 times the engine type's rated take-off thrust (CS-25's ultimate factor), N.
export const PYLON_FACTOR = 1.5;
export const pylonLimitN = (eng) => PYLON_FACTOR * eng.data.T0_ENGINE;
