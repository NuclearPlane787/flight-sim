// What only the page needs for each aircraft type (v0.3.0): the 3D model and the cockpit. The
// numbers are in src/sim/types.js, which the worker and node tests read too; this file brings
// in three.js. Built on the first flight of each type (main.js modelFor()), not at boot.

import { createAircraft as a321Aircraft } from './aircraft.js';
import { createCockpit as a321Cockpit } from './cockpit.js';
import { createWidebody } from './widebody.js';
import { createBoeingCockpit } from './cockpit-boeing.js';
import { B787_9, B777_300ER } from './widebody-specs.js';
import { FLAP_LEVER as B787_FLAP_LEVER } from './sim/b787-9.js';
import { FLAP_LEVER as B777_FLAP_LEVER } from './sim/b777-300er.js';

const BUILDERS = {
  a321neo: { createAircraft: a321Aircraft, createCockpit: a321Cockpit },
  'b787-9': { createAircraft: () => createWidebody(B787_9), createCockpit: () => createBoeingCockpit({ ...B787_9, flapLever: B787_FLAP_LEVER }) },
  'b777-300er': { createAircraft: () => createWidebody(B777_300ER), createCockpit: () => createBoeingCockpit({ ...B777_300ER, flapLever: B777_FLAP_LEVER }) },
};

export const buildersFor = (id) => BUILDERS[id] || BUILDERS.a321neo;
