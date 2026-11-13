// What only the page needs for each aircraft type (v0.3.0): the 3D model and the cockpit. The
// numbers are in src/sim/types.js, which the worker and node tests read too; this file brings
// in three.js. Built on the first flight of each type (main.js modelFor()), not at boot.
//
//   buildersFor(x) → { createAircraft(), createCockpit() }
//     x: a type id ('a321neo', 'b787-9', 'b777-300er'), or (v0.5.0) a type entry from designDef() (src/sim/designs.js,
//     `def.design` set): the base type's airframe and cockpit with the design's engines (one per def.geo.NACELLES,
//     each drawn as its own engine type), its longer gear and its registration. A design that is its base exactly
//     builds the base's model, triangle for triangle.

import { createAircraft as a321Aircraft } from './aircraft.js';
import { createCockpit as a321Cockpit } from './cockpit.js';
import { createWidebody } from './widebody.js';
import { createBoeingCockpit } from './cockpit-boeing.js';
import { B787_9, B777_300ER } from './widebody-specs.js';
import { FLAP_LEVER as B787_FLAP_LEVER } from './sim/b787-9.js';
import { FLAP_LEVER as B777_FLAP_LEVER } from './sim/b777-300er.js';

const SPECS = { 'b787-9': B787_9, 'b777-300er': B777_300ER };
const FLAP_LEVERS = { 'b787-9': B787_FLAP_LEVER, 'b777-300er': B777_FLAP_LEVER };

const BUILDERS = {
  a321neo: { createAircraft: a321Aircraft, createCockpit: a321Cockpit },
  'b787-9': { createAircraft: () => createWidebody(B787_9), createCockpit: () => createBoeingCockpit({ ...B787_9, flapLever: B787_FLAP_LEVER }) },
  'b777-300er': { createAircraft: () => createWidebody(B777_300ER), createCockpit: () => createBoeingCockpit({ ...B777_300ER, flapLever: B777_FLAP_LEVER }) },
};

// A design's builders: the base's, with the design's def handed to the airframe.
function designBuilders(def) {
  const base = BUILDERS[def.id] ? def.id : 'a321neo';
  if (base === 'a321neo') return { createAircraft: () => a321Aircraft({ def }), createCockpit: a321Cockpit };
  const spec = SPECS[base];
  return {
    createAircraft: () => createWidebody(spec, { def }),
    createCockpit: () => createBoeingCockpit({ ...spec, flapLever: FLAP_LEVERS[base] }),
  };
}

export const buildersFor = (x) => {
  if (x && typeof x === 'object') return x.design ? designBuilders(x) : BUILDERS[x.id] || BUILDERS.a321neo;
  return BUILDERS[x] || BUILDERS.a321neo;
};
