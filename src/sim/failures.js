// v0.8.0, the failure model: what can fail, when, and what a failure plan is. No DOM, no three.js, nothing random:
// it runs in the page, in node and in the prediction worker.
//
// A PLAN is the world's, as the weather is: what is armed. It rides beside the weather in a snapshot (snap.failures)
// and a rewind or a jump keeps the plan set now (sim.restore(snap, { keepWeather: true })). It is replaced, never
// changed in place (as sim.weather is): { v: 1, next, items } or null (nothing armed: the sim is v0.7.9's to the bit).
//   item: { id, kind, target, seed, at }                 fires once the sim's time reaches `at` (Now, or after a time)
//         { id, kind, target, seed, moment }             fires at a moment of the flight (MOMENTS below)
//         { …, at, hidden: true, win: [t0, t1] }         a random failure: its kind, target and time were drawn from
//                                                        its seed when it was armed; the tab shows only the window
// The STATE is the aircraft's, in the sim's core (plain JSON, restored by a rewind and a jump): which items have
// fired (X.fDone, ids), what is failed now (X.fActive, [{ id, kind, target, t }], replaced, never changed in place),
// each engine's switch, flame, start, fire and bottles (ENGINE_FAIL_FIELDS) and each gear leg (GEAR_FAIL_FIELDS).
// So a failure set for a time fires again at that time after a rewind to before it, and the predicted path, a
// rewind and a jump agree. Repairing a failure takes it out of the state and out of the plan.
//
// The numbers marked [EST] are estimates: no type's own document was read for them in v0.8.0's run.

export const KINDS = {
  'eng-flameout': { system: 'engines', target: 'engine', label: 'Flameout', random: true },
  'eng-seize': { system: 'engines', target: 'engine', label: 'Seizure', random: true },
  'eng-fire': { system: 'engines', target: 'engine', label: 'Fire', random: true },
  'gear-noext': { system: 'gear', target: 'none', label: 'Normal extension fails', random: true },
  'gear-nograv': { system: 'gear', target: 'none', label: 'Gravity extension fails too', random: false },
  'gear-nolock': { system: 'gear', target: 'leg', label: 'A leg won’t lock down', random: true },
  'gear-collapse': { system: 'gear', target: 'leg', label: 'A leg collapses on landing', random: true },
  // v0.8.0 (part 7): the hydraulics (src/sim/hydraulics.js) and the flaps. target 'system': 0 to 2 (Green, Blue,
  // Yellow; Left, Centre, Right).
  'hyd-pump': { system: 'hydraulics', target: 'engine', label: 'Engine-driven hydraulic pump fails', random: true },
  'hyd-elec': { system: 'hydraulics', target: 'system', label: 'Electric hydraulic pumps fail', random: true },
  'hyd-sys': { system: 'hydraulics', target: 'system', label: 'Hydraulic system lost (fluid)', random: true },
  // A split is caught by the asymmetry brake and flies the same as a jam: "Flaps jammed (or split and locked)".
  'flaps-jam': { system: 'flaps', target: 'none', label: 'Flaps jammed (or split and locked)', random: true },
  'slats-jam': { system: 'flaps', target: 'none', label: 'Slats jammed', random: true },
};
export const SYSTEMS = { engines: 'Engines', gear: 'Gear', hydraulics: 'Hydraulics', flaps: 'Flaps and slats' };
export { HYD_NAMES } from './hydraulics.js';
import { HYD_NAMES as HN } from './hydraulics.js';
export const LEGS = ['Nose', 'Left main', 'Right main'];
// The moments (the brief's list). The game shows no V1, so the take-off roll above 100 kt stands for it.
export const MOMENTS = {
  roll100: 'On the take-off roll above 100 kt',
  rotate: 'At rotation',
  liftoff: 'After lift-off',
  climb10k: 'Climbing through 10,000 ft',
  cruise: 'In cruise',
  app3000: 'On approach below 3,000 ft',
  final500: 'On short final below 500 ft',
};

const KT = 0.514444, FT = 0.3048;
// Is the moment true now? `m` is the sim's own picture, filled before each step from the state the last step left:
// { ias (m/s), onGround, wowNose, wowMain, agl (m), alt (m), vs (m/s up), lever (0..1), airTime (s), everAirborne }.
export function momentNow(moment, m) {
  switch (moment) {
    case 'roll100': return m.wowMain && m.lever > 0.5 && m.ias >= 100 * KT;
    case 'rotate': return m.wowMain && !m.wowNose && m.lever > 0.5 && m.ias >= 80 * KT;
    case 'liftoff': return !m.onGround && m.everAirborne && m.airTime > 2 && m.agl > 50 * FT && m.agl < 1500 * FT && m.vs > 0 && m.lever > 0.5;
    case 'climb10k': return !m.onGround && m.vs > 1 && m.alt >= 10000 * FT && m.alt < 11000 * FT;
    // "In cruise" [EST]: level (within 300 ft/min) above 20,000 ft, two minutes or more after leaving the ground.
    case 'cruise': return !m.onGround && m.alt > 20000 * FT && Math.abs(m.vs) < 1.5 && m.airTime > 120;
    case 'app3000': return !m.onGround && m.vs < -1 && m.agl < 3000 * FT && m.agl > 500 * FT && m.airTime > 120;
    case 'final500': return !m.onGround && m.vs < -0.5 && m.agl < 500 * FT && m.agl > 50 * FT && m.airTime > 60;
    default: return false;
  }
}

// A number in [0, 1) from a seed and a stream k (mulberry32 on a mixed seed): the only source of variety here.
export function rand01(seed, k = 0) {
  let a = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(k | 0, 0xc2b2ae35)) | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// An engine fire's odds, seeded per failure (the brief: out with the first bottle most times, with the second
// some, with neither rarely) [EST]: the bottles the fire needs, 3 meaning neither puts it out.
export const FIRE_ODDS = [0.70, 0.92];
export function fireNeeds(seed) { const u = rand01(seed, 1); return u < FIRE_ODDS[0] ? 1 : u < FIRE_ODDS[1] ? 2 : 3; }
// A leg armed to collapse does so at the touchdown, or a few seconds into the roll [EST], by its seed.
export function collapseDelay(seed) { const u = rand01(seed, 2); return u < 0.5 ? 0 : 1.5 + 6 * rand01(seed, 3); }

// ---- the plan ----
export const emptyPlan = () => null;
const items = (plan) => (plan && Array.isArray(plan.items) ? plan.items : []);
export const planItems = items;

// A plan with one more item armed. spec: { kind, target, when }, when one of
//   { type: 'now' } | { type: 'after', seconds } | { type: 'moment', moment }; t = the sim's time now.
// seed: an integer the caller gives (the page draws it once, when the player arms; the sim never draws one).
export function armed(plan, spec, t, seed) {
  if (!KINDS[spec.kind]) throw new Error('failures: unknown kind ' + spec.kind);
  const id = plan && Number.isFinite(plan.next) ? plan.next : 1;
  const it = { id, kind: spec.kind, target: KINDS[spec.kind].target === 'none' ? 0 : (spec.target | 0), seed: seed | 0 };
  const w = spec.when || { type: 'now' };
  if (w.type === 'moment') { if (!MOMENTS[w.moment]) throw new Error('failures: unknown moment ' + w.moment); it.moment = w.moment; }
  else it.at = t + (w.type === 'after' ? Math.max(0, +w.seconds || 0) : 0);
  return { v: 1, next: id + 1, items: items(plan).concat([it]) };
}

// A random failure, armed: one of `kinds`, on one of the aircraft's nEngines engines or three legs, at a time within
// windowS seconds from t, all drawn from the seed here and now. It is hidden: the tab shows the window alone.
export function armedRandom(plan, { kinds, windowS, nEngines }, t, seed) {
  const pool = (kinds || []).filter((k) => KINDS[k]);
  if (!pool.length) return plan;
  const kind = pool[Math.min(pool.length - 1, Math.floor(rand01(seed, 11) * pool.length))];
  const n = KINDS[kind].target === 'engine' ? Math.max(1, nEngines | 0) : KINDS[kind].target === 'leg' || KINDS[kind].target === 'system' ? 3 : 1;
  const target = Math.min(n - 1, Math.floor(rand01(seed, 12) * n));
  const win = Math.max(1, +windowS || 600);
  const id = plan && Number.isFinite(plan.next) ? plan.next : 1;
  const it = { id, kind, target, seed: seed | 0, at: t + rand01(seed, 13) * win, hidden: true, win: [t, t + win] };
  return { v: 1, next: id + 1, items: items(plan).concat([it]) };
}

// The plan without one item (disarmed, or repaired); null when nothing is left.
export function without(plan, id) {
  const rest = items(plan).filter((it) => it.id !== id);
  return rest.length ? { v: 1, next: plan.next, items: rest } : null;
}

// What the predicted path may know: the plan without the hidden failures that haven't fired (done: the ids fired).
// The same object back when there is nothing to hide.
export function visiblePlan(plan, done = []) {
  const all = items(plan);
  const rest = all.filter((it) => !it.hidden || done.includes(it.id));
  if (rest.length === all.length) return plan || null;
  return rest.length ? { v: 1, next: plan.next, items: rest } : null;
}
// A snapshot for the predictor: the same snapshot with the hidden failures left out of its plan.
export function snapshotForPrediction(snap) {
  const vis = visiblePlan(snap.failures, snap.core && snap.core.fDone || []);
  if (vis === (snap.failures || null)) return snap;
  const out = { ...snap };
  if (vis) out.failures = vis; else delete out.failures;
  return out;
}
// A jump whose target lies past a hidden failure's moment ends at the last sample before it: the index to jump to
// instead of `index` (samples: [{ t }], ascending), the same index when nothing hidden lies before it.
export function jumpIndex(plan, done, samples, index) {
  let tHide = Infinity;
  for (const it of items(plan)) if (it.hidden && !done.includes(it.id) && Number.isFinite(it.at) && it.at < tHide) tHide = it.at;
  let i = Math.min(index, samples.length - 1);
  while (i > 0 && samples[i].t > tHide) i--;
  return i;
}

// The same plan on a clock that starts again dt later (a skip to final: the sim's time goes back to 0): every time
// moved back by dt. An item whose time has passed keeps a negative one, and stays fired by its id.
export function shiftedPlan(plan, dt) {
  if (!plan) return null;
  return { v: 1, next: plan.next, items: items(plan).map((it) => {
    const o = { ...it };
    if (Number.isFinite(o.at)) o.at -= dt;
    if (Array.isArray(o.win)) o.win = [o.win[0] - dt, o.win[1] - dt];
    return o;
  }) };
}

// Plain JSON in, a plan (or null) out: what a save or the tab hands the sim. Unknown kinds and broken items go.
export function normalizePlan(p) {
  if (!p || !Array.isArray(p.items)) return null;
  const out = [];
  let next = Number.isFinite(p.next) ? p.next : 1;
  for (const it of p.items) {
    if (!it || !KINDS[it.kind] || !Number.isFinite(it.id)) continue;
    if (!(Number.isFinite(it.at) || MOMENTS[it.moment])) continue;
    const o = { id: it.id, kind: it.kind, target: it.target | 0, seed: it.seed | 0 };
    if (MOMENTS[it.moment]) o.moment = it.moment; else o.at = it.at;
    if (it.hidden) { o.hidden = true; if (Array.isArray(it.win) && it.win.length === 2 && it.win.every(Number.isFinite)) o.win = [it.win[0], it.win[1]]; }
    out.push(o);
    if (it.id >= next) next = it.id + 1;
  }
  return out.length ? { v: 1, next, items: out } : null;
}

// ---- the aircraft's state (the sim's core) ----
// Per engine, parallel arrays as the engines' own (ENGINE_FIELDS):
//   eSw    the switch (ENG MASTER / FUEL CONTROL): 1 on (run), 0 off (cutoff)
//   eLit   1 burning, 0 out (windmilling, seized or starting)
//   eSt    the start's clock, s (0: not starting)
//   eFl    flags: E_FLAMEOUT (flamed out: the switch must go off and on again), E_SEIZED, E_FIRE (burning),
//          E_PUSHED (its fire handle pushed or pulled: the engine is shut off for good), E_FIRE_OUT (it burned)
//   eAg    bottles discharged into it (0 to 2);  eAgT  when the last one went (the sim's time; -1 none)
//   eNeed  the bottles its fire needs (fireNeeds(); 0 no fire yet)
export const E_FLAMEOUT = 1, E_SEIZED = 2, E_FIRE = 4, E_PUSHED = 8, E_FIRE_OUT = 16;
export const ENGINE_FAIL_FIELDS = ['eSw', 'eLit', 'eSt', 'eFl', 'eAg', 'eAgT', 'eNeed'];
const ENGINE_FAIL_DEFAULT = { eSw: 1, eLit: 1, eSt: 0, eFl: 0, eAg: 0, eAgT: -1, eNeed: 0 };
// The gear: gOn (1: the legs each have their own position, X.gLeg, and X.gearPos is their mean; 0: X.gearPos is all
// three, v0.7.9's arithmetic), gSys (G_NOEXT the normal extension failed, G_NOGRAV the gravity extension failed too,
// G_GRAV the gravity extension selected), per leg (nose, left, right): gLeg its position (0 up, 1 down), gFl its
// flags (L_NOLOCK won't lock down, L_COLLAPSE armed to collapse, L_GONE collapsed, L_FLOWN seen off the ground
// since it was armed), gColT the collapse's countdown, s (-1: not running).
export const G_NOEXT = 1, G_NOGRAV = 2, G_GRAV = 4;
export const L_NOLOCK = 1, L_COLLAPSE = 2, L_GONE = 4, L_FLOWN = 8;
export const GEAR_FAIL_FIELDS = ['gLeg', 'gFl', 'gColT'];
const GEAR_FAIL_DEFAULT = { gLeg: 1, gFl: 0, gColT: -1 };

const fill = (n, v) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = v; return a; };
// A fresh core's failure fields, for n engines: nothing failed, every switch on, every engine burning.
export function newFailCore(n) {
  const c = { fDone: [], fActive: [], gOn: 0, gSys: 0, ...newHydCore() };
  for (const k of ENGINE_FAIL_FIELDS) c[k] = fill(n, ENGINE_FAIL_DEFAULT[k]);
  for (const k of GEAR_FAIL_FIELDS) c[k] = fill(3, GEAR_FAIL_DEFAULT[k]);
  return c;
}
// The failure fields of a snapshot's core `c` copied into the live core X (never shared with the snapshot); a save
// from before v0.8.0 has none of them and reads as nothing failed. n: the type's engines.
export function adoptFailCore(X, c, n) {
  const num = (a, len) => Array.isArray(a) && a.length === len && a.every(Number.isFinite);
  for (const k of ENGINE_FAIL_FIELDS) X[k] = num(c[k], n) ? c[k].slice() : fill(n, ENGINE_FAIL_DEFAULT[k]);
  for (const k of GEAR_FAIL_FIELDS) X[k] = num(c[k], 3) ? c[k].slice() : fill(3, GEAR_FAIL_DEFAULT[k]);   // (gLeg is read only once gOn is 1: legsOwn() fills it)
  X.gOn = c.gOn ? 1 : 0; X.gSys = c.gSys | 0;
  adoptHydCore(X, c);   // v0.8.0 (part 7)
  X.fDone = Array.isArray(c.fDone) ? c.fDone.filter(Number.isFinite) : [];
  X.fActive = Array.isArray(c.fActive) ? c.fActive.filter((a) => a && KINDS[a.kind]).map((a) => ({ id: a.id, kind: a.kind, target: a.target | 0, t: +a.t || 0 })) : [];
}
// The core's failure fields copied for a snapshot (into `out`, a shallow copy of the core).
export function copyFailCore(out, X) {
  for (const k of ENGINE_FAIL_FIELDS) out[k] = X[k].slice();
  for (const k of GEAR_FAIL_FIELDS) out[k] = X[k].slice();
  out.hP = X.hP.slice();   // v0.8.0 (part 7): the one array among the hydraulics' fields
  out.fDone = X.fDone.slice();
  out.fActive = X.fActive.map((a) => ({ ...a }));
  return out;
}

// v0.8.0 (part 7), the hydraulics' state: hOn (0: everything normal, and a step takes v0.7.9's path; 1: a hydraulic or
// flap failure, or an engine not burning), hPf (the layout's pumps failed, a bit each, hydraulics.js's order), hDr (the
// systems drained, a bit each), hP (the three pressures, 0 to 1), hRat (the RAT: 0 stowed, 1 out and up to speed; -1
// never deployed), hYe (the yellow electric pump's switch, Airbus), hJam (H_FLAPS, H_SLATS jammed). G_HYD: X.gSys's
// bit while the gear's normal system has no pressure (the legs then stay where they are, as for G_NOEXT, both ways).
export const H_FLAPS = 1, H_SLATS = 2, G_HYD = 8;
export function newHydCore() { return { hOn: 0, hPf: 0, hDr: 0, hP: [1, 1, 1], hRat: 0, hYe: 0, hJam: 0 }; }
export function adoptHydCore(X, c) {
  X.hOn = c.hOn ? 1 : 0; X.hPf = c.hPf | 0; X.hDr = c.hDr | 0; X.hJam = c.hJam | 0; X.hYe = c.hYe ? 1 : 0;
  X.hRat = Number.isFinite(c.hRat) ? c.hRat : 0;
  X.hP = Array.isArray(c.hP) && c.hP.length === 3 && c.hP.every(Number.isFinite) ? c.hP.slice() : [1, 1, 1];
}

// ---- the engines' numbers [EST] ----
// The in-flight start envelope: above `maxFt` no start; a windmill start at `windmillKt` or more; under that speed
// the starter helps, up to `assistFt`. The time to idle from the switch: `windmillS`, `assistS`, on the ground
// `groundS`. Airbus's FCOM gives the A320 family about FL270 and 260 kt for a windmill start, starter assist below
// FL200; the Boeings' envelopes are drawn on the EICAS and were not read: the same shape with their ceilings [EST].
export const RELIGHT = {
  airbus: { maxFt: 27000, windmillKt: 260, assistFt: 20000, windmillS: 30, assistS: 45, groundS: 60 },
  boeing: { maxFt: 30000, windmillKt: 250, assistFt: 20000, windmillS: 35, assistS: 50, groundS: 60 },
};
// Why an engine whose switch is on won't start now: '' (it can), or 'gone' (torn off), 'seized', 'fire' (its fire
// handle is out), 'cycle' (flamed out: switch off, then on), 'fuel', 'altitude' (above the envelope), 'speed' (too
// slow to windmill, too high for the starter). e: { flags, off, fuelKg, altFt, iasKt, onGround }, R: a RELIGHT row.
export function startBlock(e, R) {
  if (e.off) return 'gone';
  if (e.flags & E_SEIZED) return 'seized';
  if (e.flags & E_PUSHED) return 'fire';
  if (e.flags & E_FLAMEOUT) return 'cycle';
  if (!(e.fuelKg > 0)) return 'fuel';
  if (e.onGround) return '';
  if (e.altFt > R.maxFt) return 'altitude';
  if (e.iasKt < R.windmillKt && e.altFt > R.assistFt) return 'speed';
  return '';
}
export function startSeconds(e, R) { return e.onGround ? R.groundS : e.iasKt >= R.windmillKt ? R.windmillS : R.assistS; }
// The words for a start that can't happen (the checklist says why).
export const START_BLOCK_TEXT = {
  gone: 'ENGINE SEPARATED', seized: 'ENGINE SEIZED: NO RESTART', fire: 'FIRE HANDLE OUT: NO RESTART', cycle: 'SWITCH OFF, THEN ON',
  fuel: 'NO FUEL', altitude: 'ABOVE THE START ENVELOPE: DESCEND', speed: 'TOO SLOW TO WINDMILL: SPEED UP OR DESCEND',
};
// A dead engine's drag [EST]: its fan's disc (about its rated thrust / 50 kN per m²: 2.9 m² for the A321's,
// 6.4 for the 787-9's, 10 for the 777's) times a drag coefficient, more for a seized fan than a windmilling one.
export const DEAD_ENGINE = { areaPerN: 1 / 50000, cdWindmill: 0.12, cdSeized: 0.30, seizeS: 4, fireOutS: 10, agent2S: 30 };
// The gravity extension's time, and a belly landing's limits [EST]: the sink rate at the first touch (the gear's
// 10 ft/s), any later part's speed into the ground, the bank and the pitch.
export const GRAVITY_GEAR_S = 30;
export const BELLY = { vs: 3.05, part: 4.6, bank: 15 * Math.PI / 180, pitchLo: -4 * Math.PI / 180, pitchHi: 13 * Math.PI / 180 };
// v0.8.0 (gear): how BELLY is applied (sim.js). The sink, the bank and the pitch are the first touch's (nothing yet on
// the ground: no wheel, no part); a later part's touch is held to `part` and the bank alone, since a nose with no nose
// leg comes to rest about 6° nose down. A wingtip touching is always a crash: on every type a nacelle is down before
// it with a main leg missing (the A321's at about 8° of bank, the 787-9's at 7°, the 777's lower still).
// A belly's skids [EST]: Indestructible's spring (sim.js's SKID.k, per kg), more damping (metal grinding into the
// pavement gives back little: about 0.8 of critical on one part, where Indestructible's 4 is 0.3) and the same
// friction, 0.4 (slides of 700 to 1,100 m from 125 to 135 kt, as real belly landings' 600 to 1,200 m), its fade
// with speed at `slipMs`, so it holds at a crawl as static friction does (Indestructible's 0.5 m/s let a leaning
// aircraft, pushed sideways by its struts, creep and turn about a braked wheel), the friction's rate per part capped
// at `kfMax` × the mass / the step (about a part's share of the mass: no step overshoots).
export const BELLY_SKID = { c: 10, mu: 0.4, slipMs: 0.002, kfMax: 0.15 };

// ---- words (the tab, the toasts) ----
export function describe(it, nEngines = 2, family) {
  const K = KINDS[it.kind];
  if (!K) return '';
  if (K.target === 'system') {
    const nm = family && HN[family] ? HN[family][it.target] : 'Hydraulic system ' + (it.target + 1);
    const sys = family && HN[family] ? nm + ' hydraulic system' : nm;
    return it.kind === 'hyd-sys' ? sys + ' lost' : sys + ': electric pumps fail';
  }
  if (it.kind === 'hyd-pump') return 'Engine ' + (it.target + 1) + ': hydraulic pump fails';
  if (it.kind === 'flaps-jam') return 'Flaps jammed (or split and locked)';
  if (it.kind === 'slats-jam') return 'Slats jammed';
  if (K.target === 'engine') return 'Engine ' + (it.target + 1) + ': ' + K.label.toLowerCase();
  if (K.target === 'leg') return LEGS[it.target] + ' gear: ' + (it.kind === 'gear-nolock' ? 'won’t lock down' : 'collapses on landing');
  return 'Gear: ' + K.label.toLowerCase();
}
