// v0.5.3: fits the parts' model's calibration (src/sim/parts-aero-cal.js) so that parts(base) matches each type's
// lumped model at the validation table's points (tests/parts-aero-table.mjs), and writes the file.
//   node tools/fit-parts-aero.mjs          fit, print the table, write src/sim/parts-aero-cal.js
//   node tools/fit-parts-aero.mjs --print  print the table only
// Each factor is fitted to the one row it mostly sets (Gauss–Seidel, a few dozen rounds):
//   kA (the sections' lift slope)      → CLα, the mean of cruise and approach (as ratios)
//   dcl0 (the sections' zero lift)     → CL at cruise's trimmed α
//   kClmax, kClmaxHL                   → CLmax at cruise (clean) and approach (the slats' and flaps' share)
//   kFlapCL, kFlapCD                   → CL and CD at approach's trimmed α (the slats' and flaps' share)
//   etaT (the tailplane's efficiency)  → Cmq at approach
//   kEps (the downwash's strength)     → Cmα̇ at approach
//   kF (the fuselage's Munk pitch)     → Cmα at approach
//   iT (the tailplane's incidence)     → Cm = 0 at cruise's trim
//   kCmFlap (the flaps' moment)        → Cm = 0 at approach's trim
//   tauE, tauA, tauR (the surfaces')   → the elevator's (approach), the ailerons' and the rudder's (approach) powers
//   kSpR, kSB                          → the roll spoilers' roll and the speed brakes' lift (means)
//   aF (the fin's lift slope)          → Cnβ at approach; kY (the body's side force) → CYβ at approach
//   kWB (the wing–body's sideslip roll) → Clβ, the mean of the two points
//   kP (the roll rate's antisymmetric loading) → Clp, the mean of the two points
//   cd0x (the drag the parts don't carry: nacelles, gaps, the rest) → CD at cruise's trim
// Run it through tools/cpu-guard.py (it takes a few seconds).

import { writeFileSync } from 'node:fs';
import { CAL } from '../src/sim/parts-aero-cal.js';
import { rows } from '../tests/parts-aero-table.mjs';
import { partsModel } from '../src/sim/parts-aero.js';

const IDS = ['a321neo', 'b787-9', 'b777-300er'];
const printOnly = process.argv.includes('--print');

function table(id) {
  const R = rows(id, partsModel(id));
  return { cr: R.cruise.r, ap: R.approach.r, cl: R.clean.r };
}
const ratio = (x) => x.lumped / x.parts;
const meanP = (a, b) => (a.parts + b.parts) / 2;

function fit(id) {
  const C = CAL[id];
  // one secant step on factor `key` so that get(table) reaches target(table)
  const step = (key, get, target = (t) => 0, damp = 0.8) => {
    const x0 = C[key], h = 1e-3 * Math.max(Math.abs(x0), 0.01);
    const t0 = table(id), y0 = get(t0), goal = target(t0);
    C[key] = x0 + h;
    const y1 = get(table(id));
    const d = (y1 - y0) / h;
    C[key] = Math.abs(d) > 1e-12 ? x0 + damp * (goal - y0) / d : x0;
  };
  const L = (row, pt) => (t) => t[pt][row].lumped, Pp = (row, pt) => (t) => t[pt][row].parts;
  const mean = (row, pt0 = 'cr', pt1 = 'ap') => (t) => (t[pt0][row].parts + t[pt1][row].parts) / 2;
  const lg = (f) => (t) => Math.log(Math.abs(f(t)));
  for (let it = 0; it < 25; it++) {
    step('kA', (t) => Math.log(t.cr.CLa.parts) + Math.log(t.ap.CLa.parts) + Math.log(t.cl.CLa.parts), (t) => Math.log(t.cr.CLa.lumped) + Math.log(t.ap.CLa.lumped) + Math.log(t.cl.CLa.lumped));
    step('dcl0', Pp('CL', 'cr'), L('CL', 'cr'));
    step('kClmax', Pp('CLmax', 'cl'), L('CLmax', 'cl'));
    step('kClmaxHL', Pp('CLmax', 'ap'), L('CLmax', 'ap'));
    step('kFlapCL', Pp('CL', 'ap'), L('CL', 'ap'));
    step('kFlapCD', Pp('CD', 'ap'), L('CD', 'ap'));
    step('etaT', Pp('Cmq', 'cl'), L('Cmq', 'cl'));
    step('kEps', Pp('Cmadot', 'cl'), L('Cmadot', 'cl'));
    step('kF', Pp('Cma', 'cl'), L('Cma', 'cl'));
    step('iT', Pp('Cm', 'cr'), L('Cm', 'cr'));
    step('kCmFlap', Pp('Cm', 'ap'), L('Cm', 'ap'));
    step('tauE', Pp('Cmde', 'cl'), L('Cmde', 'cl'));
    step('tauA', Pp('Clda', 'cl'), L('Clda', 'cl'));
    step('tauR', Pp('Cndr', 'cl'), L('Cndr', 'cl'));
    step('kSpR', mean('ClspAnalytic'), L('Clsp', 'cr'));
    step('kSB', mean('dCLsb'), L('dCLsb', 'cr'));
    step('aF', Pp('Cnb', 'cl'), L('Cnb', 'cl'));
    step('kY', Pp('CYb', 'cl'), L('CYb', 'cl'));
    step('kWB', Pp('Clb', 'cl'), L('Clb', 'cl'));
    step('kP', Pp('Clp', 'cl'), L('Clp', 'cl'));
    step('cd0x', Pp('CD', 'cr'), L('CD', 'cr'));
  }
}

function print(id) {
  const t = table(id);
  console.log(`\n${id}                cruise: lumped   parts  ratio | clean 250 kt: lumped parts ratio | approach: lumped   parts  ratio`);
  for (const k of Object.keys(t.cr)) {
    const f = (x) => x.toFixed(4).padStart(9);
    const rr = (x) => (Math.abs(x.lumped) > 1e-6 ? (x.parts / x.lumped).toFixed(3) : '  —  ').padStart(6);
    console.log(`  ${k.padEnd(14)} ` + [t.cr[k], t.cl[k], t.ap[k]].map((a) => `${f(a.lumped)} ${f(a.parts)} ${rr(a)}`).join(' | '));
  }
}

if (!printOnly) for (const id of IDS) fit(id);
for (const id of IDS) print(id);
if (!printOnly) {
  const fmt = (o) => '{ ' + Object.entries(o).map(([k, v]) => `${k}: ${+v.toPrecision(6)}`).join(', ') + ' }';
  const body = `// v0.5.3: the parts' model's calibration per type (src/sim/parts-aero.js), written by tools/fit-parts-aero.mjs
// (don't edit by hand: change the model or the fit, and run it again). Each number is a physical factor of the parts'
// model, fitted so that parts(base) matches the type's lumped model (src/sim/flightmodel.js) at the validation table's
// cruise and approach points (tests/parts-aero-table.mjs): the fit script says which row sets which, and STATUS.md
// (v0.5.3) has the table.
export const CAL = {
${IDS.map((id) => `  '${id}': ${fmt(CAL[id])},`).join('\n')}
};
`;
  writeFileSync(new URL('../src/sim/parts-aero-cal.js', import.meta.url), body);
  console.log('\nwrote src/sim/parts-aero-cal.js');
}
