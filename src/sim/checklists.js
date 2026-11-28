// v0.8.0, the warnings and their checklists: from the sim's state, the alerts now (most urgent first), each with its
// level, its aural, its message and the procedure in short form. Pure: no DOM, no clock, nothing random, no state of
// its own (which alerts the pilot has acknowledged is the page's: src/ui/alerts.js). Built on the failure model's
// interface (src/sim/failures.js; STATUS.md "v0.8.0: the failure model's interface").
//
//   alertsOf(sim)            -> [{ id, level, title, aural, engine?, leg?, steps }]   warnings first, then cautions
//   alertsOf(state, controls, family)                                                 the same from the parts
//   runStep(sim, step)       -> true if the step's action did something (a 'switch' step's act on the sim: engineSwitch,
//                               firePush, fireAgent, gravityGear, hydPump ('Y-ELEC', true): v0.8.0 part 7)
//   landingNumbers(st, family, typeId) -> { vapp, vls, vlsFull, factor, full }: a flaps or slats jam's landing numbers
//   nextStep(alert)          -> the index of the step to do next (-1: none left)
//   alertsKey(list)          -> a short string that changes when the list, a step's state or its info changes
//   engineName(i, n, family) -> '1'..'8', or 'L' / 'R' on a twin Boeing
//
// An alert: { id, level: 'warning' | 'caution', title, aural, engine?, leg?, steps: [step] }
//   aural: Airbus 'crc' (the continuous repetitive chime, a red warning) or 'sc' (the single chime, an amber caution);
//          Boeing 'bell' (the fire bell), 'siren' (other warnings), 'beeper' (the caution beeper).
//   step:  { text, kind: 'switch' | 'fly' | 'note', act?: { name, arg }, done, ready?, info? }
//          'switch' a button that does `act` (a sim action: sim[name](...arg)); done when the switch is where the
//                   step puts it; ready false while it can't be done yet (agent 2 before its 30 s): `info` says why
//          'fly'    ticked by the game when it is true (a lever at idle, the aircraft stopped)
//          'note'   words only (LAND ASAP); never done
//
// The alerts and when each clears (each from the state, every time it is asked):
//   fire-<i>      an engine burning (E_FIRE): a warning until the fire is out (the bottles, or a repair). Once out, the
//                 engine is shut down, and in flight that is eng-<i>'s caution (ENG n SHUT DOWN), as on the A320's ECAM.
//   eng-<i>       an engine not burning: with a flameout or a seizure in state.failures (anywhere), FAIL; with no
//                 failure, in flight with its switch off or its fire handle out, SHUT DOWN. Clears when it burns
//                 again (a relight), on the ground with nothing failed, or once its failure is repaired and the
//                 switch is on (the engine then starts by itself). An engine torn off (v0.5.0's) has no alert: the
//                 screens show it OFF as before.
//   gear          in flight, the gear lever down and a leg not down because of a gear failure (the normal extension
//                 failed, or a leg that won't lock): a caution until every leg is down, the lever goes up, or the
//                 aircraft is on the ground. The A321's L/G GEAR NOT DOWNLOCKED, the Boeings' GEAR DISAGREE.
//   collapse-<l>  a leg collapsed (L_GONE): a warning until repaired.
//
// The steps' words and order are the public FCOM/QRH-level procedures in short form, as known without a type's own
// document tonight: [EST] marks each list (the A320 family's ECAM and the 777/787's QRH are the models).

//   (v0.8.0 part 7, the hydraulics and the flaps: hydAlerts() below)
//   hyd-<s>       a system's pressure low (state.hyd.p[s] < WORK_P) in flight or with a failure in: a caution
//                 (HYD G SYS LO PR; HYD PRESS SYS L). Two or three at once on the Airbus: one warning, hyd2-<sss>
//                 (HYD G + B SYS LO PR, the CRC). Clears when the pressure is back (a repair, the yellow pump).
//   hydpump-<id>  a pump giving nothing (failed, or its engine not burning in flight) while its system still has
//                 pressure from another pump or the PTU: a caution (HYD G ENG 1 PUMP LO PR; HYD PRESS ENG L / DEM C).
//   law           the Boeings only: the hydraulics' secondary mode (FLIGHT CONTROL MODE) or direct (PRI FLIGHT
//                 COMPUTERS): a caution. The A321's PFD shows its law; its hydraulics' alert says it in a note.
//   flaps-jam, slats-jam  a caution while jammed (F/CTL FLAPS FAULT or LOCKED; FLAPS DRIVE / SLATS DRIVE), with
//                 the landing's numbers from the sim's own state (VLS, the distance's factor against landing flap).

import { E_FLAMEOUT, E_SEIZED, E_FIRE, E_PUSHED, G_NOEXT, G_NOGRAV, G_GRAV, L_NOLOCK, L_GONE, START_BLOCK_TEXT, DEAD_ENGINE, LEGS, G_HYD } from './failures.js';
import { WORK_P, HYD } from './hydraulics.js';
import * as A321 from './a321neo.js';
import * as B789 from './b787-9.js';
import * as B773 from './b777-300er.js';

const NONE = Object.freeze([]);   // nothing to say (the common case: no allocation)
export const LEVELS = ['warning', 'caution'];
export const AURALS = { airbus: { warning: 'crc', caution: 'sc' }, boeing: { fire: 'bell', warning: 'siren', caution: 'beeper' } };

const IDLE_MAX = 0.02;   // a thrust lever at or below this is at idle (0 is the idle stop; below it, reverse)
const LEG_AIRBUS = ['NOSE', 'LEFT', 'RIGHT'], LEG_BOEING = ['NOSE', 'LEFT', 'RIGHT'];

export function engineName(i, n, family) { return family === 'boeing' && n === 2 ? (i === 0 ? 'L' : 'R') : String(i + 1); }

// This engine's thrust lever (controls.thrustEng while the levers are apart, else the one lever).
function leverOf(controls, i, n) {
  const TE = controls?.thrustEng;
  if (Array.isArray(TE) && TE.length === n && Number.isFinite(TE[i])) return TE[i];
  return controls?.thrust ?? 0;
}
const atIdle = (controls, i, n) => leverOf(controls, i, n) <= IDLE_MAX;

const failedKinds = (failures, i) => {
  let flameout = false, seize = false;
  for (const f of failures || []) if (f.target === i) { if (f.kind === 'eng-flameout') flameout = true; else if (f.kind === 'eng-seize') seize = true; }
  return { flameout, seize };
};

const sw = (text, name, arg, done, extra) => ({ text, kind: 'switch', act: { name, arg }, done: !!done, ...extra });
const fly = (text, done) => ({ text, kind: 'fly', done: !!done });
const note = (text) => ({ text, kind: 'note', done: false });

// The start's words on a relight step: its progress while it runs, why it can't when it can't.
// On the ground for the alerts: a wheel on it, or sliding or lying on the belly (the sim's onGround reads the wheels
// alone; after a gear-up landing an engine shut down for the evacuation is not "shut down in flight").
const onGroundOf = (st) => !!(st.onGround || st.scraping);

function startInfo(e) {
  if (e.lit) return 'RUNNING';
  if (e.start > 0 && e.startS > 0) return 'STARTING ' + Math.min(99, Math.floor(100 * e.start / e.startS)) + ' %';
  if (e.block) return START_BLOCK_TEXT[e.block] || e.block.toUpperCase();
  return '';
}

// ---- the engine fire ----
// Airbus (A320 family ECAM, ENG n FIRE in flight) [EST]: THR LEVER IDLE, ENG MASTER OFF, ENG FIRE P/B PUSH, AGENT 1
// DISCH, ATC NOTIFY, IF FIRE AFTER 30 S: AGENT 2 DISCH, LAND ASAP. (The real one waits 10 s before AGENT 1 in flight;
// the game leaves that to the pilot.) On the ground the real list stops the aircraft and evacuates [EST].
// Boeing (777/787 QRH, FIRE ENG) [EST]: thrust lever CLOSE, FUEL CONTROL switch CUTOFF, engine fire switch PULL; if the
// message stays: ROTATE to the stop and hold 1 s; if after 30 s it stays: ROTATE to the other stop; plan to land at
// the nearest suitable airport.
function fireAlert(i, n, e, st, controls, family) {
  const N = engineName(i, n, family), boeing = family === 'boeing';
  // Ticked at idle, or once the engine is cut off by its switch or its fire handle (one lever alone often can't move:
  // a type has no per-engine keys by default, and the A/THR brings the levers together). No step waits for another.
  const idle = atIdle(controls, i, n) || !e.sw || e.pushed;
  const since = e.agents >= 1 && e.agentT >= 0 ? st.t - e.agentT : -1;
  const wait = e.agents === 1 ? Math.max(0, DEAD_ENGINE.agent2S - since) : 0;
  const ready2 = e.agents === 1 && since >= DEAD_ENGINE.agent2S && e.fire;
  const a2 = { ready: ready2 || e.agents >= 2 };
  if (e.agents === 1 && !ready2) a2.info = 'IN ' + Math.ceil(wait) + ' S';
  let steps;
  if (!boeing) {
    steps = [
      fly(`THR LEVER ${N} ..... IDLE`, idle),
      sw(`ENG MASTER ${N} ..... OFF`, 'engineSwitch', [i, false], !e.sw),
      sw(`ENG ${N} FIRE P/B ..... PUSH`, 'firePush', [i], e.pushed),
      sw('AGENT 1 ..... DISCH', 'fireAgent', [i], e.agents >= 1, { ready: e.pushed }),
      note('ATC ..... NOTIFY'),
      sw('IF FIRE AFTER 30 S: AGENT 2 ..... DISCH', 'fireAgent', [i], e.agents >= 2, a2),
      note(onGroundOf(st) ? 'STOP THE AIRCRAFT: EVACUATION AS RQRD' : 'LAND ASAP'),
    ];
  } else {
    steps = [
      fly(`THRUST LEVER ${N} ..... CLOSE`, idle),
      sw(`FUEL CONTROL ${N} ..... CUTOFF`, 'engineSwitch', [i, false], !e.sw),
      sw(`ENG FIRE SWITCH ${N} ..... PULL`, 'firePush', [i], e.pushed),
      sw('IF MESSAGE STAYS: ROTATE TO THE STOP', 'fireAgent', [i], e.agents >= 1, { ready: e.pushed }),
      sw('IF AFTER 30 S IT STAYS: ROTATE TO THE OTHER STOP', 'fireAgent', [i], e.agents >= 2, a2),
      note(onGroundOf(st) ? 'STOP THE AIRPLANE: EVACUATION IF NEEDED' : 'PLAN TO LAND AT THE NEAREST SUITABLE AIRPORT'),
    ];
  }
  return {
    id: 'fire-' + i, level: 'warning', engine: i,
    title: boeing ? `FIRE ENG ${N}` : `ENG ${N} FIRE`,
    aural: boeing ? AURALS.boeing.fire : AURALS.airbus.warning, steps,
  };
}

// ---- an engine failed or shut down ----
// Airbus ENG n FAIL (A320 family ECAM) [EST]: THR LEVER IDLE; then (the game's relight, the real one's "IF NO RELIGHT
// AFTER 30 S" turned round) ENG MASTER OFF, ENG MASTER ON; IF NO RELIGHT: ENG MASTER OFF; LAND ASAP. With damage (a
// seized engine): THR LEVER IDLE, ENG MASTER OFF, ENG FIRE P/B PUSH, NO RELIGHT, LAND ASAP. ENG n SHUT DOWN (no
// failure): the relight's ENG MASTER ON, LAND ASAP.
// Boeing ENG FAIL / ENG SHUTDOWN (777/787 QRH) [EST]: thrust lever CLOSE, FUEL CONTROL switch CUTOFF, then the in-flight
// start's FUEL CONTROL switch RUN; a seized engine is the QRH's severe damage list: CLOSE, CUTOFF, the fire switch PULL,
// plan to land at the nearest suitable airport.
function engAlert(i, n, e, st, controls, family, fk) {
  const N = engineName(i, n, family), boeing = family === 'boeing';
  const flamed = (e.flags & E_FLAMEOUT) !== 0, seized = fk.seize || (e.flags & E_SEIZED) !== 0;
  const failed = fk.flameout || seized;
  const idle = atIdle(controls, i, n) || !e.sw || e.pushed;
  const master = boeing ? `FUEL CONTROL ${N}` : `ENG MASTER ${N}`;
  const OFF = boeing ? 'CUTOFF' : 'OFF', ON = boeing ? 'RUN' : 'ON';
  const land = note(boeing ? 'PLAN TO LAND AT THE NEAREST SUITABLE AIRPORT' : 'LAND ASAP');
  let steps;
  if (seized) {
    steps = [
      fly(boeing ? `THRUST LEVER ${N} ..... CLOSE` : `THR LEVER ${N} ..... IDLE`, idle),
      sw(`${master} ..... ${OFF}`, 'engineSwitch', [i, false], !e.sw),
      sw(boeing ? `ENG FIRE SWITCH ${N} ..... PULL` : `ENG ${N} FIRE P/B ..... PUSH`, 'firePush', [i], e.pushed),
      note(START_BLOCK_TEXT.seized),
      land,
    ];
  } else {
    const relight = sw(`${failed ? 'RELIGHT: ' : ''}${master} ..... ${ON}`, 'engineSwitch', [i, true], e.sw && !flamed && !e.pushed,
      { ready: !e.pushed, info: e.pushed ? START_BLOCK_TEXT.fire : e.sw && !flamed ? startInfo(e) : '' });
    steps = [];
    if (failed || flamed) {
      steps.push(fly(boeing ? `THRUST LEVER ${N} ..... CLOSE` : `THR LEVER ${N} ..... IDLE`, idle));
      // Off: done once the switch is off, or the relight's off-and-on is past (the flameout's flag gone).
      steps.push(sw(`${master} ..... ${OFF}`, 'engineSwitch', [i, false], !e.sw || !flamed));
    }
    steps.push(relight);
    if (failed) steps.push(note(`IF NO RELIGHT: ${master} ..... ${OFF}`));
    steps.push(land);
  }
  const title = failed ? (boeing ? `ENG FAIL ${N}` : `ENG ${N} FAIL`) : (boeing ? `ENG SHUTDOWN ${N}` : `ENG ${N} SHUT DOWN`);
  return { id: 'eng-' + i, level: 'caution', engine: i, title, aural: boeing ? AURALS.boeing.caution : AURALS.airbus.caution, steps };
}

// ---- the gear ----
// Airbus L/G GEAR NOT DOWNLOCKED [EST]: L/G LEVER RECYCLE; L/G GRAVITY EXTN HANDCRANK PULL AND TURN; if a leg is still
// not down, LDG WITH ABNORMAL L/G: GND SPLR DO NOT ARM, CABIN AND ATC NOTIFY, AT TOUCHDOWN ENG MASTERS OFF, EVACUATION.
// Boeing GEAR DISAGREE [EST]: landing gear lever DN; ALTN GEAR switch DOWN; if a leg is still not down, the PARTIAL OR
// GEAR UP LANDING list: speedbrake lever DOWN (do not arm), at touchdown FUEL CONTROL switches CUTOFF, evacuation.
function gearAlert(st, controls, family) {
  const boeing = family === 'boeing', sys = st.gearSys | 0, legs = st.gearLegs || [1, 1, 1], lf = st.gearLegFlags || [0, 0, 0];
  const grav = (sys & G_GRAV) !== 0;
  const down = legs.map((p) => p >= 0.999);
  const stuck = grav && ((sys & G_NOGRAV) !== 0 || [0, 1, 2].some((k) => !down[k] && lf[k] & L_NOLOCK));
  const falling = grav && !stuck && down.some((d) => !d);
  const steps = [
    fly(boeing ? 'LANDING GEAR LEVER ..... DN (UP, THEN DN)' : 'L/G LEVER ..... RECYCLE', grav || down.every(Boolean)),
    sw(boeing ? 'ALTN GEAR SWITCH ..... DOWN' : 'L/G GRAVITY EXTN HANDCRANK ..... PULL AND TURN', 'gravityGear', [], grav,
      falling ? { info: 'GEAR FALLING ' + Math.floor(100 * Math.min(...legs)) + ' %' } : undefined),
  ];
  if (stuck) {
    const up = [0, 1, 2].filter((k) => !down[k]).map((k) => (boeing ? LEG_BOEING : LEG_AIRBUS)[k]).join(', ');
    if (boeing) steps.push(note('PARTIAL OR GEAR UP LANDING: ' + up + ' NOT DOWN'), note('SPEEDBRAKE LEVER ..... DOWN (DO NOT ARM)'),
      note('AT TOUCHDOWN: FUEL CONTROL SWITCHES ..... CUTOFF'), note('AFTER STOP: EVACUATION IF NEEDED'));
    else steps.push(note('LDG WITH ABNORMAL L/G: ' + up + ' NOT DOWN'), note('GND SPLR ..... DO NOT ARM'), note('CABIN AND ATC ..... NOTIFY'),
      note('AT TOUCHDOWN: ENG MASTERS ..... OFF'), note('AFTER STOP: EVACUATION AS RQRD'));
  }
  return { id: 'gear', level: 'caution', title: boeing ? 'GEAR DISAGREE' : 'L/G GEAR NOT DOWNLOCKED', aural: boeing ? AURALS.boeing.caution : AURALS.airbus.caution, steps };
}

// A leg collapsed (on the touchdown or the roll) [EST: no type shows such a message; the words are the game's]: a
// warning, the aircraft stopped and the engines shut down, as the abnormal landing lists end.
function collapseAlert(leg, st, controls, family, n) {
  const boeing = family === 'boeing';
  const allIdle = Array.from({ length: n }, (_, i) => atIdle(controls, i, n)).every(Boolean);
  const allOff = (st.engines || []).every((e) => !e.sw || e.off);
  const stopped = onGroundOf(st) && (st.gs || 0) < 1;
  return {
    id: 'collapse-' + leg, level: 'warning', leg,
    title: (boeing ? 'GEAR COLLAPSE ' : 'L/G COLLAPSE ') + LEG_AIRBUS[leg],
    aural: boeing ? AURALS.boeing.warning : AURALS.airbus.warning,
    steps: [
      fly(boeing ? 'THRUST LEVERS ..... CLOSE' : 'THR LEVERS ..... IDLE', allIdle || allOff),
      fly('BRAKES ..... STOP THE AIRCRAFT', stopped),
      fly(boeing ? 'PARKING BRAKE ..... SET' : 'PARKING BRK ..... ON', !!controls?.parkingBrake),
      sw(boeing ? 'FUEL CONTROL SWITCHES (ALL) ..... CUTOFF' : 'ENG MASTERS (ALL) ..... OFF', 'engineSwitch', [-1, false], allOff),
      note(boeing ? 'EVACUATION IF NEEDED' : 'EVACUATION ..... AS RQRD'),
    ],
  };
}

// ---- v0.8.0 (part 7): the hydraulics and the flaps ----
// [EST] every list here: the A320 family's ECAM (HYD G SYS LO PR, HYD G ENG 1 PUMP LO PR, HYD G + B SYS LO PR,
// F/CTL FLAPS FAULT / LOCKED) and the 777/787's EICAS and QRH (HYD PRESS SYS L, HYD PRESS ENG L, HYD PRESS DEM C,
// FLIGHT CONTROL MODE, PRI FLIGHT COMPUTERS, FLAPS DRIVE, SLATS DRIVE), as known without a type's own document
// tonight, in short form. What is lost is read from state.hyd.eff (the sim's live object: read now, never kept), so
// the notes are true for a design too.
const SYS_A = ['G', 'B', 'Y'], SYS_B = ['L', 'C', 'R'], KT_MS = 0.514444;
const fluidLost = (failures, s) => failures.some((f) => f.kind === 'hyd-sys' && f.target === s);

// What the pressures leave lost, in the family's words. → true if the landing distance grows.
function effNotes(eff, n, family, steps) {
  if (!eff) return false;
  const boeing = family === 'boeing';
  let dist = false;
  if (!eff.gear) steps.push(note(boeing ? 'GEAR: ALTN GEAR EXTENSION (SEE GEAR DISAGREE)' : 'L/G: GRAVITY EXTENSION (SEE L/G)'));   // the gear's own caution has the step
  if (eff.brake < 1) {
    dist = true;
    if (eff.brake > HYD.brakeAcc) steps.push(note(boeing ? 'NORMAL BRAKES: INOP (ALTERNATE)' : 'NORM BRK LOST: ALTN BRK'));
    else steps.push(note(boeing ? 'BRAKES: ACCUMULATOR ONLY' : 'BRK: ACCU PRESS ONLY'));
  }
  if (eff.antiskid === false) { dist = true; steps.push(note(boeing ? 'ANTISKID: INOP' : 'ANTI SKID: LOST')); }
  if (eff.steer < 1) steps.push(note(boeing ? 'NOSE WHEEL STEERING: INOP' : 'N/W STEERING LOST'));
  const rev = [];
  for (let i = 0; i < (eff.reverser || []).length && i < n; i++) if (!eff.reverser[i]) rev.push(engineName(i, n, family));
  if (rev.length) { dist = true; steps.push(note(boeing ? `THRUST REVERSER ${rev.join(' + ')}: INOP` : `REVERSER ${rev.join(' + ')} LOST`)); }
  for (const [k, A, B] of [['slats', 'SLATS', 'SLATS'], ['flaps', 'FLAPS', 'FLAPS']]) {
    const v = eff[k];
    if (v >= 1) continue;
    dist = true;
    steps.push(note(v <= 0 ? (boeing ? `${B}: INOP` : `${A}: LOCKED`) : (boeing ? `${B}: SLOW` : `${A} SLOW`)));
  }
  if (eff.speedbrake < 1) steps.push(note(boeing ? `SPEEDBRAKES: ${eff.speedbrake <= 0 ? 'INOP' : 'PART'}` : `SPEED BRAKES: ${eff.speedbrake <= 0 ? 'LOST' : 'PART'}`));
  if (eff.groundSpoilers < 1) { dist = true; if (!boeing) steps.push(note(`GND SPLRS: ${eff.groundSpoilers <= 0 ? 'LOST' : 'PART'}`)); }
  if (eff.stab <= 0) steps.push(note(boeing ? 'STABILIZER: INOP' : 'PITCH TRIM: LOST'));
  return dist;
}

// The law the hydraulics leave (0 normal, 1 alternate / secondary, 2 direct): state.law when the laws give it, else
// state.hyd.law.
function hydLawOf(st) {
  const h = st.hyd?.law | 0;
  if (!h) return 0;
  return st.law === 'direct' ? 2 : st.law === 'alternate' || st.law === 'secondary' ? 1 : h;
}
function lawNotes(lv, steps) {
  if (lv === 1) steps.push(note('ALTN LAW: PROT LOST'), note('DIRECT LAW WHEN L/G DN: USE MAN PITCH TRIM'));
  else if (lv === 2) steps.push(note('DIRECT LAW: USE MAN PITCH TRIM'));
}

// The A321's yellow electric pump, as a switch step (while yellow keeps its fluid).
function yElecStep(H, failures) {
  const pu = (H.pumps || []).find((p) => p.id === 'Y-ELEC');
  if (!pu) return null;
  const x = pu.failed ? { ready: false, info: 'PUMP FAILED' } : undefined;
  return sw('YELLOW ELEC PUMP ..... ON', 'hydPump', ['Y-ELEC', true], pu.on && !pu.failed, x);
}

function hydSysAlerts(st, family, failures, low, warn, caut) {
  const H = st.hyd, eff = H.eff, n = (st.engines || []).length, boeing = family === 'boeing';
  const lv = hydLawOf(st);
  if (!boeing) {
    const L = low.map((s) => SYS_A[s]);
    const steps = [];
    const yFluid = low.includes(2) && !fluidLost(failures, 2);
    if (low.includes(0) || low.includes(2)) steps.push(note(fluidLost(failures, 0) || fluidLost(failures, 2) ? 'PTU: INOP' : 'PTU ..... AUTO'));
    if (yFluid) { const y = yElecStep(H, failures); if (y) steps.push(y); }
    if (low.length > 1) {
      lawNotes(lv, steps);
      if (H.rat > 0) steps.push(note('RAT: OUT'));
    }
    const dist = effNotes(eff, n, family, steps);
    if (low.length === 1) lawNotes(lv, steps);
    if (dist || low.length > 1) steps.push(note('LDG DIST: INCREASED'));
    if (low.length > 1) steps.push(note('LAND ASAP'));
    const two = low.length > 1;
    (two ? warn : caut).push({ id: (two ? 'hyd2-' : 'hyd-') + low.join(''), level: two ? 'warning' : 'caution',
      title: `HYD ${L.join(' + ')} SYS LO PR`, aural: two ? AURALS.airbus.warning : AURALS.airbus.caution, steps });
    return;
  }
  // Boeing: a caution per system, each with what is lost; the flight control mode's caution apart (lawAlert).
  for (const s of low) {
    const steps = [];
    const dist = effNotes(eff, n, family, steps);
    if (dist) steps.push(note('LANDING DISTANCE: INCREASED'));
    caut.push({ id: 'hyd-' + s, level: 'caution', title: `HYD PRESS SYS ${SYS_B[s]}`, aural: AURALS.boeing.caution, steps });
  }
}

// A pump giving nothing while its system keeps pressure (from another pump or the PTU).
function hydPumpAlerts(st, family, low, caut) {
  const H = st.hyd, pumps = H.pumps || [], n = (st.engines || []).length, boeing = family === 'boeing';
  const ptu = pumps.find((p) => p.kind === 'ptu'), yOn = pumps.some((p) => p.id === 'Y-ELEC' && p.on && !p.failed);
  const demLost = [false, false, false];
  for (const pu of pumps) {
    if (low.includes(pu.sys)) continue;
    if (pu.kind === 'engine') {
      // Only a pump failed on an engine that burns: with its engine out the engine's own alert stands for it (the
      // ECAM's and EICAS's inhibition of a shut-down engine's pump message [EST]); the display shows the pump's loss.
      if (!pu.failed || !pu.on) continue;
      const i = (+pu.id.slice(3) || 1) - 1, N = engineName(i, n, family);
      if (!boeing) {
        const L = SYS_A[pu.sys];
        caut.push({ id: 'hydpump-' + pu.id, level: 'caution', title: `HYD ${L} ENG ${N} PUMP LO PR`, aural: AURALS.airbus.caution,
          steps: [note(ptu && ptu.on && pu.sys !== 1 ? `${L} SYS PRESS: BY PTU` : pu.sys === 2 && yOn ? `${L} SYS PRESS: BY ELEC PUMP` : `${L} SYS PRESS: NORMAL`)] });
      } else {
        caut.push({ id: 'hydpump-' + pu.id, level: 'caution', title: `HYD PRESS ENG ${N}`, aural: AURALS.boeing.caution,
          steps: [note(`SYS ${SYS_B[pu.sys]} PRESSURE: DEMAND PUMP`)] });
      }
    } else if (pu.kind === 'electric' && pu.failed) {
      if (boeing) { demLost[pu.sys] = true; continue; }
      if (pu.id === 'Y-ELEC' && !pu.on) continue;   // (off, as it is in flight unless switched on)
      const L = SYS_A[pu.sys];
      caut.push({ id: 'hydpump-' + pu.id, level: 'caution', title: `HYD ${L} ELEC PUMP LO PR`, aural: AURALS.airbus.caution,
        steps: [note(`${L} SYS PRESS: NORMAL`)] });
    }
  }
  for (let s = 0; s < 3; s++) if (demLost[s]) caut.push({ id: 'hydpump-dem' + s, level: 'caution', title: `HYD PRESS DEM ${SYS_B[s]}`,
    aural: AURALS.boeing.caution, steps: [note(`SYS ${SYS_B[s]} PRESSURE: ENGINE PUMP`)] });
}

// The Boeings' flight control mode, when the hydraulics leave secondary or direct [EST].
function lawAlert(st, caut) {
  const lv = hydLawOf(st);
  if (!lv) return;
  const steps = [note('AUTOPILOT NOT AVAILABLE'), note('NO ENVELOPE PROTECTION')];
  if (lv === 2) steps.push(note('PITCH TRIM: STABILIZER TRIM SWITCHES'));
  if (st.hyd.rat > 0) steps.push(note('RAT: DEPLOYED'));
  steps.push(note('PLAN TO LAND AT THE NEAREST SUITABLE AIRPORT'));
  caut.push({ id: 'law', level: 'caution', title: lv === 2 ? 'PRI FLIGHT COMPUTERS' : 'FLIGHT CONTROL MODE', aural: AURALS.boeing.caution, steps });
}

// The type's lift tables for the landing's numbers: the sim form's type (a design's base), else the state's type id,
// else the family's first. A design read from the state alone gets its base family's tables [EST].
function dataOf(tid, family) {
  if (tid === 'b777-300er') return B773;
  if (tid === 'b787-9') return B789;
  if (tid === 'a321neo') return A321;
  return family === 'boeing' ? (String(tid || '').includes('777') ? B773 : B789) : A321;
}
function interp(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
}
const clmaxOf = (D, slat, flap) => D.CLMAX_CLEAN + interp(D.SLAT_CLMAX, slat) + interp(D.FLAP_CLMAX, flap);

// The landing's numbers with the surfaces where they are: state.vls is the sim's own for them; the VLS with landing
// flap is state.vls × √(CLmax now / CLmax at landing flap) from the type's lift tables (the same VLS formula, the
// same weight); the distance's factor is the square of the approach speeds' ratio (VLS + 5 each) [EST: the energy's
// share, the braking taken as equal]. → { vapp, factor, full } (kt, ×, the landing flap's name).
export function landingNumbers(st, family, tid) {
  const D = dataOf(tid ?? st.typeBase ?? st.type, family);
  const full = D.CONFIGS[D.CONFIG_FULL];
  const vls = (st.vls || 0) / KT_MS;
  const cNow = clmaxOf(D, st.slatDeg || 0, st.flapDeg || 0), cFull = clmaxOf(D, full.slat, full.flap);
  const vlsFull = vls * Math.sqrt(cNow / cFull);
  const vapp = vls + 5, vappFull = vlsFull + 5;
  return { vapp, vls, vlsFull, factor: vappFull > 0 ? (vapp / vappFull) ** 2 : 1, full: D.CONFIG_FULL };
}

// Flaps or slats jammed: the lever back where the surfaces are, then the landing's numbers.
function jamAlert(which, st, controls, family, tid) {
  const boeing = family === 'boeing', D = dataOf(tid ?? st.typeBase ?? st.type, family);
  const key = which === 'flaps' ? 'flap' : 'slat', deg = (which === 'flaps' ? st.flapDeg : st.slatDeg) || 0;
  const cfg = D.CONFIGS[st.config] || D.CONFIGS[D.FLAP_LEVER[0]];
  const tgt = cfg[key];
  // The lever's highest position whose surface sits where they are (else the last one short of them); ticked there,
  // or wherever the surfaces aren't asked to move (the A321's lever 1 may ask for 1+F's flaps: the title says LOCKED).
  let lv = 0;
  for (let k = 0; k < D.FLAP_LEVER.length; k++) { const c = D.CONFIGS[D.FLAP_LEVER[k]]; if (c && c[key] <= deg + 1.5) lv = k; }
  const back = Math.abs(tgt - deg) <= 1.5 || (controls?.flapLever | 0) === lv;
  const nm = D.FLAP_LEVER[lv];
  const LN = landingNumbers(st, family, tid), W = which.toUpperCase();
  const steps = [];
  if (!boeing) {
    steps.push(fly(`FLAPS LEVER ..... RECYCLE (TO ${nm})`, back));
    steps.push(note(`SLATS ${Math.round(st.slatDeg || 0)}° FLAPS ${Math.round(st.flapDeg || 0)}°`));
    steps.push(note(`VAPP: VLS + 5 = ${Math.round(LN.vapp)} KT`));
    steps.push(note(`LDG DIST: × ${LN.factor.toFixed(2)} (VS CONF ${LN.full})`));
    steps.push(note('GPWS FLAP MODE ..... OFF'));
  } else {
    steps.push(fly(`FLAP LEVER ..... ${nm === 'UP' ? 'UP' : 'FLAPS ' + nm}`, back));
    steps.push(note(`SLATS ${Math.round(st.slatDeg || 0)}° FLAPS ${Math.round(st.flapDeg || 0)}°`));
    steps.push(note(`APPROACH SPEED: VREF + 5 = ${Math.round(LN.vapp)} KT`));
    steps.push(note(`LANDING DISTANCE: × ${LN.factor.toFixed(2)} (VS FLAPS ${LN.full})`));
    steps.push(note('GND PROX FLAP OVRD SWITCH ..... OVRD'));
  }
  const title = boeing ? `${W} DRIVE` : `F/CTL ${W} ${tgt > deg + 1.5 ? 'LOCKED' : 'FAULT'}`;
  return { id: which + '-jam', level: 'caution', title, aural: boeing ? AURALS.boeing.caution : AURALS.airbus.caution, steps };
}

function hydAlerts(st, controls, family, failures, warn, caut, tid) {
  const H = st.hyd;
  if (onGroundOf(st) && !failures.length) return;   // (all engines shut down at the gate: no hydraulics' alerts)
  if (H && H.on && H.p) {
    const low = [];
    for (let s = 0; s < 3; s++) if (H.p[s] < WORK_P) low.push(s);
    if (low.length) hydSysAlerts(st, family, failures, low, warn, caut);
    hydPumpAlerts(st, family, low, caut);
    if (family === 'boeing') lawAlert(st, caut);
  }
  if (st.flapsJam) caut.push(jamAlert('flaps', st, controls, family, tid));
  if (st.slatsJam) caut.push(jamAlert('slats', st, controls, family, tid));
}

// The alerts now. alertsOf(sim) or alertsOf(state, controls, family).
export function alertsOf(a, controls, family) {
  let st = a, tid;
  if (a && a.state && a.controls) { st = a.state; controls = a.controls; family = a.type?.family; tid = a.type?.base?.id || a.type?.id; }
  family = family === 'boeing' ? 'boeing' : 'airbus';
  if (!st) return [];
  const out = [];
  const eng = st.engines || [], n = eng.length, failures = st.failures || [];
  // Nothing failed and every engine burning (the common case): no alerts, without making anything.
  let quiet = failures.length === 0 && !(st.gearSys) && !(st.gearLegFlags && (st.gearLegFlags[0] | st.gearLegFlags[1] | st.gearLegFlags[2]))
    && !(st.hyd && st.hyd.on) && !st.flapsJam && !st.slatsJam;   // v0.8.0 (part 7)
  if (quiet) for (let i = 0; i < n; i++) { const e = eng[i]; if (!e.off && (e.lit === false || e.fire)) { quiet = false; break; } }
  if (quiet) return NONE;
  const warn = [], caut = [];
  for (let i = 0; i < n; i++) {
    const e = eng[i];
    if (!e || e.off) continue;
    if (e.fire) { warn.push(fireAlert(i, n, e, st, controls, family)); continue; }
    if (e.lit !== false) continue;
    const fk = failedKinds(failures, i);
    const failed = fk.flameout || fk.seize || (e.flags & (E_FLAMEOUT | E_SEIZED)) !== 0;
    // In flight an engine that isn't burning has its caution whatever its switch says: with the switch back on it is
    // starting, or can't start, and the checklist's relight line is where the start's progress or the reason shows
    // (the lead, after the 787's check at FL380: the checklist had gone the moment the switch went to RUN).
    if (failed || !onGroundOf(st)) caut.push(engAlert(i, n, e, st, controls, family, fk));
  }
  const lf = st.gearLegFlags || [0, 0, 0];
  for (let k = 0; k < 3; k++) if (lf[k] & L_GONE) warn.push(collapseAlert(k, st, controls, family, n));
  if (!onGroundOf(st) && controls?.gearDown) {
    const sys = st.gearSys | 0, legs = st.gearLegs || [1, 1, 1];
    const cause = (sys & G_NOEXT) !== 0 || (sys & G_HYD) !== 0 ||   // v0.8.0 (part 7): the gear's hydraulic system lost
      [0, 1, 2].some((k) => lf[k] & L_NOLOCK && legs[k] < 0.999) || ((sys & G_GRAV) !== 0 && legs.some((p) => p < 0.999));
    if (cause && legs.some((p, k) => p < 0.999 && !(lf[k] & L_GONE))) caut.push(gearAlert(st, controls, family));
  }
  hydAlerts(st, controls, family, failures, warn, caut, tid);   // v0.8.0 (part 7)
  return warn.concat(caut);
}

// Do a step's action on the sim: true if it did something. engineSwitch with -1 is every engine.
export function runStep(sim, step) {
  if (!sim || !step || step.kind !== 'switch' || !step.act || step.ready === false) return false;
  const { name, arg = [] } = step.act;
  if (name === 'engineSwitch' && arg[0] === -1) {
    let any = false;
    for (let i = 0; i < (sim.state.engines || []).length; i++) any = sim.engineSwitch(i, arg[1]) || any;
    return any;
  }
  if (typeof sim[name] !== 'function') return false;
  return !!sim[name](...arg);
}

// The step to do next: the first switch or fly step not done (notes are read, not done). -1 when none is left.
export function nextStep(alert) {
  const s = alert?.steps || [];
  for (let k = 0; k < s.length; k++) if (s[k].kind !== 'note' && !s[k].done) return k;
  return -1;
}

// A key that changes when the list, a step's state or a step's words change (the panel redraws only then).
export function alertsKey(list) {
  let k = '';
  for (const a of list) {
    k += a.id + ':' + a.title + '[';
    for (const s of a.steps) k += (s.done ? 1 : 0) + (s.ready === false ? 'w' : '') + (s.info ? s.info : '') + (s.kind === 'note' ? (/\d/.test(s.text) ? s.text : s.text.length) : '') + ',';   // (v0.8.0 part 7: a note with figures, whole: the jams' numbers change)
    k += ']';
  }
  return k;
}

export { E_FIRE, E_PUSHED };
