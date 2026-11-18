// v0.5.0: the Warehouse, a page of the main menu (menu.js opens it). The list of designs (New from one of
// the three types, Duplicate, Rename, Delete; a click opens one), and the editor: the aircraft in 3D on its own
// canvas, the parts beside it and the numbers that follow from them, live (src/sim/designs.js designNumbers()),
// with warnings in amber and red.
// v0.5.2 makes the editor KSP's: a palette of parts over the view (three engines, a wing tank, a hold tank,
// ballast). Pick one and it follows the pointer over the airframe as a ghost, green where it fits and red where it
// doesn't; a click attaches it (under or over the wing, on the rear fuselage's side, in the tail, in the hold), with a
// mirror twin on the other side while Mirror is on. Click a part to select it (its settings replace the aircraft's
// in the side panel), drag it to move it, Delete removes it. Undo and Redo (Z, Shift+Z) step back and forth through
// every change. The centre of mass (yellow and black) and the centre of thrust (magenta, its arrow along the
// resultant thrust) show over the model. The checks: no engines (Save waits for one), lopsided thrust, the CG's
// move, parts in each other's way, ground clearance, the pylons' limits.
// Styles in warehouse.css (fsw-*, linked on the first open); rows and buttons reuse menu.css and ui.css.
//
//   const wh = createWarehouse(root, { store? });   store: a DesignStore (src/designs-store.js), the page's by default
//   wh.open(); wh.close(); wh.isOpen; wh.onclose = () => {}
//
// The 3D view (three.js and the models, src/type-assets.js) loads on the first editor, renders only on demand
// while the editor is open (a drag, a zoom, a rebuild, the hangar's people at 30 frames a second), and is disposed
// (its renderer, its WebGL context, its listeners and timers) when the editor closes: nothing runs once you go back.
// Keys stay on the page; Esc goes back a step (drops the part in hand, then the selection, then the editor).
//
// The pure parts (readout(), editDesign(), editPart(), placement(), hitAirframe(), partBoxes(), pickPart(),
// thrustLine(), createHistory(), viewKey(), orbit maths) have no DOM and are tested in node (tests/warehouse.test.mjs).

import {
  designDef, designNumbers, normalizeDesign, newDesign, addPart, updatePart, removePart, setMirror, engineParts,
  mountRange, placeEngine, placeTank, placeBallast, airframe, RANGES, MAX_ENGINES, MAX_PARTS,
  AIRFRAME_RANGES, defaultAirframe, isBaseAirframe,
} from '../sim/designs.js';
// v0.5.3's newer names (designAirframe()), read through the namespace so a missing one is undefined, not an error.
import * as DS from '../sim/designs.js';
import { shapeOf } from '../sim/parts-aero.js';
import { airframeMap } from '../sim/airframe-map.js';
import { ENGINE_LIST, ENGINE_TYPES } from '../sim/engine-types.js';
import { TYPES, TYPE_LIST } from '../sim/types.js';
import { cleanName, nameOk, NAME_MIN, NAME_MAX } from '../scenarios.js';
import { designStore } from '../designs-store.js';
import { partBindings, resolveKeys, engineKeys, keyLabel, scopeOf, bindingOf, chordFor, isModifier, bindKey, clearKeys, resetKeys,
  bindEngineKey, engineAsOthers, setEngineTwin, movedText, keysFrom } from '../keys.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const kg = (v) => `${Math.round(v).toLocaleString('en-US')} kg`;
const m2 = (v) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)} m`;
const pct = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)} %`;
const sgn = (v, d, unit) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}${unit}`;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- The pure parts ----

// Where the warnings start (amber); red is a failure (a pylon over its limit, more yaw than an engine failure, the CG
// far out) or a touch (clearance ≤ 0, parts in each other's way).
// The CG's move: aft eats the static margin (gone at about 12 % MAC), forward costs elevator to rotate and flare (two
// GE90s on an A321 move it 14 % forward, and it still flies).
export const WARN = { clearM: 0.3, pylonFrac: 0.9, thrustToWeight: 0.22, payloadFrac: 0.5, cgAft: 0.05, cgAftBad: 0.12, cgFwd: 0.10, cgFwdBad: 0.25, yawFrac: 0.1, pitchX: 2.5, twLight: 0.8 };

const WHERE = { wing: 'wing', overwing: 'over-wing', body: 'body', tail: 'tail' };
// A part's name: what it is and where ("LEAP-1A · left wing", "GE90-115B · tail", "Wing tank · right").
export function partLabel(p) {
  const side = p.side > 0 ? 'left' : p.side < 0 ? 'right' : '';
  if (p.kind === 'engine') return `${ENGINE_TYPES[p.engine]?.short ?? p.engine} · ${p.mount === 'tail' ? 'tail' : `${side} ${WHERE[p.mount]}`}`;
  if (p.kind === 'tank') return p.mount === 'hold' ? 'Hold tank' : `Wing tank · ${side}`;
  return 'Ballast';
}
// Where it sits along its mount: out from the centreline, or back from the nose.
export function partWhere(p, base, af = null) {
  const R = mountRange(base, p, af);
  if (R.key === 's') return `${p.s.toFixed(2)} m out`;
  if (R.key === 'x') return `${(TYPES[base].geo.NOSE_X - p.x).toFixed(1)} m from the nose`;
  return 'on the fin';
}

// The thrust: its centre (thrust-weighted), its resultant's direction (geometry frame), and its moments about the CG
// (x cgX, on the centreline) at full thrust, standing: yaw (nose left +) and pitch (nose up +), N·m.
export function thrustLine(def, cgX) {
  const G = def.geo, A = def.data, ED = A.ENGINE_DATA, n = G.ENGINES.length, DIRS = G.THRUST_DIRS;
  let T = 0, x = 0, y = 0, z = 0, fx = 0, fy = 0, fz = 0, yawNm = 0, pitchNm = 0;
  for (let i = 0; i < n; i++) {
    const t = ED ? ED[i].T0_ENGINE : A.T0_ENGINE, e = G.ENGINES[i], d = DIRS ? DIRS[i] : [1, 0, 0];
    T += t; x += t * e.x; y += t * e.y; z += t * e.z;
    fx += t * d[0]; fy += t * d[1]; fz += t * d[2];
    const rx = e.x - cgX;
    yawNm += rx * t * d[1] - e.y * t * d[0];
    pitchNm -= e.z * t * d[0] - rx * t * d[2];
  }
  if (!(T > 0)) return { T: 0, x: cgX, y: 0, z: 0, dir: [1, 0, 0], yawNm: 0, pitchNm: 0 };
  const f = Math.hypot(fx, fy, fz) || 1;
  return { T, x: x / T, y: y / T, z: z / T, dir: [fx / f, fy / f, fz / f], yawNm, pitchNm };
}

// The base type's own numbers, to measure a design against: its thrust's pitch, and its yaw with one engine out at
// full thrust (what its rudder is sized for).
const BASES = new Map();
function baseOf(base) {
  let b = BASES.get(base);
  if (!b) {
    const T = TYPES[base], def = designDef(newDesign(base, { id: 'base-' + base })), n = designNumbers(def);
    b = { def, n, line: thrustLine(def, n.cgX), yawLimitNm: T.data.T0_ENGINE * Math.abs(T.geo.ENGINES[0].y) };
    BASES.set(base, b);
  }
  return b;
}

const lvl = (bad, warn) => (bad ? 'bad' : warn ? 'warn' : 'ok');

// The editor's numbers for a design: rows (label, value, level, note), each engine and external tank with its
// clearances (and each engine its pylon), the problems, the worst level, whether it can be saved (it needs an engine),
// the thrust's line and the base's numbers.
// v0.5.3: with the airframe on (`airframe`, by default airframeEnabled()), the airframe's checks (airframeRows()) take
// the tail-strike row's place and the CG row's.
export function readout(design, { airframe: afOn = airframeEnabled() } = {}) {
  const d = normalizeDesign(design), def = designDef(d), n = designNumbers(def), B = baseOf(d.base), A = def.data;
  const line = thrustLine(def, n.cgX);
  const partOf = (id) => d.parts.find((p) => p.id === id);
  const issues = [];
  const rows = [];
  const add = (k, label, value, level = 'ok', note = '') => { rows.push({ k, label, value, level, note }); if (level !== 'ok' && note) issues.push({ level, text: note }); };
  const none = n.engineCount === 0;
  add('oew', 'Empty weight (OEW)', kg(n.oewKg));
  add('mtow', 'MTOW (the base’s)', kg(n.mtowKg));
  const payBad = n.payloadMaxKg <= 0, payWarn = n.payloadMaxKg < WARN.payloadFrac * B.n.payloadMaxKg;
  add('payload', 'Payload room (MZFW − OEW)', kg(n.payloadMaxKg), lvl(payBad, payWarn),
    payBad ? 'No payload left: the empty weight is at the base’s MZFW.' : payWarn ? 'Under half the base’s payload room: the parts’ weight eats into it.' : '');
  const fuelRoom = n.mtowKg - n.oewKg - n.payloadKg;
  // Not a warning (the 777-300ER's own full tanks and default load are over MTOW): what MTOW leaves, beside it.
  add('fuel', 'Fuel capacity', kg(n.fuelCapacityKg) + (n.fuelCapacityKg > fuelRoom ? ` (MTOW allows ${kg(Math.max(0, fuelRoom))})` : ''));
  const twWarn = !none && n.thrustToWeight < WARN.thrustToWeight;
  add('tw', 'Thrust to weight at MTOW', none ? '—' : n.thrustToWeight.toFixed(2), lvl(none, twWarn), twWarn ? 'Little thrust for the weight: a long take-off roll and a slow climb.' : '');
  add('range', 'Range (default load, full fuel up to MTOW)', none ? '—' : `${Math.round(n.rangeNm).toLocaleString('en-US')} nm`);
  if (!afOn) add('tail', 'Tail-strike angle', `${n.tailStrikeDeg.toFixed(1)}°`);
  add('drag', 'Drag the parts add', `${sgn(n.dragAddedM2, 2, ' m²')} (${pct(n.dragAddedM2 / (A.CD0 * A.S), 1)} of the airframe’s)`);
  if (afOn) airframeRows(n, add);
  // v0.5.4: a swept wing's MMO (designs.js: Korn, within 0.70–0.95), shown only when the sweep moves it.
  if (afOn && Number.isFinite(n.mmo) && Number.isFinite(B.n?.mmo) && Math.abs(n.mmo - B.n.mmo) > 5e-4) {
    add('mmo', 'Maximum Mach (MMO)', `M${n.mmo.toFixed(2)} (the base’s M${B.n.mmo.toFixed(2)})`);
  }
  const cg = n.cgShiftMac, cgA = Math.abs(cg), fwd = cg > 0;
  // v0.5.3 (the run): on the base's own airframe the CG against the base's still means what it did, so v0.5.2's row
  // stays (beside the static margin); on a changed airframe the static margin replaces it.
  const baseAf = isBaseAirframe(d.airframe, d.base);
  if (!afOn || baseAf) {
    const cgBad = fwd ? cg > WARN.cgFwdBad : -cg > WARN.cgAftBad, cgWarn = fwd ? cg > WARN.cgFwd : -cg > WARN.cgAft;
    add('cg', 'CG against the base’s (default load)', cgA < 0.0005 ? 'the same' : `${(cgA * 100).toFixed(1)} % MAC ${fwd ? 'forward' : 'aft'}`,
      lvl(cgBad, cgWarn),
      cgBad ? (fwd ? `The CG is ${(cgA * 100).toFixed(0)} % MAC forward of the base’s: too nose-heavy to rotate and flare. Move weight aft (ballast, a hold tank) or the engines back.`
        : `The CG is ${(cgA * 100).toFixed(0)} % MAC aft of the base’s: past its static margin, it pitches up on its own. Move weight forward.`)
        : cgWarn ? `The CG has moved ${(cgA * 100).toFixed(0)} % MAC ${fwd ? 'forward: it needs more elevator to rotate and to flare' : 'aft: lighter and twitchier in pitch'}.` : '');
  }
  if (afOn && baseAf) {
    // one note for one cause: when the CG's row already warns, the margin's row keeps its colour but not its note
    const cr = rows.find((x) => x.k === 'cg'), mr = rows.find((x) => x.k === 'margin');
    if (cr && mr && cr.level !== 'ok' && mr.note) { const i = issues.findIndex((x) => x.text === mr.note); if (i >= 0) issues.splice(i, 1); }
  }
  const yawFrac = Math.abs(line.yawNm) / B.yawLimitNm, toward = line.yawNm > 0 ? 'left' : 'right';
  add('yaw', 'Thrust’s yaw at full power', none || yawFrac < 0.005 ? 'balanced' : `nose ${toward} · ${Math.round(yawFrac * 100)} % of an engine out`,
    lvl(!none && yawFrac > 1, !none && yawFrac > WARN.yawFrac),
    yawFrac > 1 ? `Lopsided thrust: at full power it yaws harder than the ${TYPES[d.base].name} with an engine out, and the rudder can’t hold it on the runway. Balance the engines (Mirror).`
      : yawFrac > WARN.yawFrac ? `Lopsided thrust: at full power it pulls the nose ${toward}. Hold rudder on the take-off roll.` : '');
  // v0.5.6: the minimum control speeds (vmcRows(); shown once designs.js gives them, with the airframe on: the rudder's
  // power comes from the fin's size).
  if (afOn && !none) for (const r of vmcRows(n, B.n, rows.find((x) => x.k === 'yaw')?.level)) add(r.k, r.label, r.value, r.level, r.note);
  const p0 = B.line.pitchNm, pitchHard = !none && Math.abs(line.pitchNm) > WARN.pitchX * Math.max(Math.abs(p0), 1);
  add('pitch', 'Thrust’s pitch at full power', none ? '—' : `nose ${line.pitchNm >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(line.pitchNm) / 1000).toLocaleString('en-US')} kN·m (base ${p0 >= 0 ? 'up' : 'down'} ${Math.round(Math.abs(p0) / 1000).toLocaleString('en-US')})`,
    lvl(false, pitchHard), pitchHard ? `Full thrust pitches the nose ${line.pitchNm >= 0 ? 'up' : 'down'} hard (the thrust line is far from the CG): every power change needs a retrim.` : '');
  const engines = n.engines.map((e) => {
    const p = partOf(e.part);
    const restLvl = e.tail ? 'ok' : lvl(e.clearRestM <= 0, e.clearRestM < WARN.clearM);
    const tsLvl = e.tail ? 'ok' : lvl(e.clearTailStrikeM <= 0, e.clearTailStrikeM < WARN.clearM);
    const pyLvl = lvl(e.pylonFrac > 1, e.pylonFrac > WARN.pylonFrac);
    return { ...e, label: p ? partLabel(p) : `Engine ${e.i + 1}`, restLvl, tsLvl, pyLvl };
  });
  const pods = n.pods.map((t) => {
    const p = partOf(t.part);
    return { ...t, label: p ? partLabel(p) : 'Wing tank', restLvl: lvl(t.clearRestM <= 0, t.clearRestM < WARN.clearM), tsLvl: lvl(t.clearTailStrikeM <= 0, t.clearTailStrikeM < WARN.clearM) };
  });
  const low = [...engines, ...pods];
  const touchRest = low.filter((e) => e.restLvl === 'bad'), touchTs = low.filter((e) => e.tsLvl === 'bad' && e.restLvl !== 'bad');
  const pyBad = engines.filter((e) => e.pyLvl === 'bad');
  if (touchRest.length) issues.unshift({ level: 'bad', text: `${touchRest.map((e) => e.label).join(', ')}: on the ground standing, it would scrape. Lengthen the gear or move ${touchRest.length > 1 ? 'them' : 'it'} up.` });
  if (touchTs.length) issues.unshift({ level: 'bad', text: `${touchTs.map((e) => e.label).join(', ')}: strikes the ground before the tail does on rotation. Lengthen the gear.` });
  if (n.overlap) issues.unshift({ level: 'bad', text: 'Parts in each other’s way: two nacelles or tanks overlap. Move one apart.' });
  if (pyBad.length) issues.unshift({ level: 'bad', text: `Full thrust is past the pylons’ limit (${Math.round(Math.max(...pyBad.map((e) => e.pylonFrac)) * 100)} %): the engines tear off at take-off. Lower the thrust.` });
  if (none) issues.unshift({ level: 'bad', text: 'No engines: it can’t fly. Pick one from the parts and click where it goes.' });
  const lowRest = low.filter((e) => e.restLvl === 'warn' || e.tsLvl === 'warn');
  if (lowRest.length) issues.push({ level: 'warn', text: `Under ${WARN.clearM} m of ground clearance (${lowRest.map((e) => e.label).join(', ')}): a firm landing or a crosswind could scrape.` });
  const pyWarn = engines.filter((e) => e.pyLvl === 'warn');
  // Light (OEW, the default load and a fifth of the fuel), full thrust on the runway: past about 0.8 the push lifts the
  // nose about the main wheels into a tail strike (the bases are under 0.5).
  const light = (n.oewKg + n.payloadKg + 0.2 * n.fuelCapacityKg) * 9.80665, twLight = (n.thrustToWeight * n.mtowKg * 9.80665) / light;
  if (twLight > WARN.twLight) issues.push({ level: 'warn', text: `Thrust to weight ${twLight.toFixed(2)} when light: full thrust on the runway can lift the nose into a tail strike. Take off with the levers part way.` });
  if (pyWarn.length) issues.push({ level: 'warn', text: `The pylons carry over ${Math.round(WARN.pylonFrac * 100)} % of their limit at full thrust.` });
  const worst = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
  return { design: d, def, numbers: n, rows, engines, pods, issues, worst, canSave: !none, canFly: !none && !n.touchesGround, line, base: B, airframe: afOn };
}

// The aircraft's own fields changed, the design normalized. `key`: name, registration, oewFrac (a fraction of the base's
// OEW), fuelFrac (of the base's capacity), gearExtendM; engine and thrustScale set every engine's type and thrust.
export function editDesign(design, key, value) {
  const d = normalizeDesign(design), A = TYPES[d.base].data;
  const v = typeof value === 'string' && key !== 'name' && key !== 'registration' && key !== 'engine' ? Number(value) : value;
  const engines = (f) => normalizeDesign({ ...d, parts: d.parts.map((p) => (p.kind === 'engine' ? { ...p, ...f } : p)) });
  switch (key) {
    case 'name': return normalizeDesign({ ...d, name: String(v) });
    case 'registration': return normalizeDesign({ ...d, registration: String(v) });
    case 'oewFrac': return normalizeDesign({ ...d, oewDeltaKg: Math.round(v * A.OEW) });
    case 'fuelFrac': return normalizeDesign({ ...d, fuelCapacityKg: Math.round((v * A.FUEL_MAX) / 10) * 10 });
    case 'gearExtendM': return normalizeDesign({ ...d, gearExtendM: v });
    case 'engine': return ENGINE_TYPES[v] ? engines({ engine: v }) : d;
    case 'thrustScale': return engines({ thrust: v });
    default: return d;
  }
}

// One part changed (its mirror twin follows). `key`: s (out from the centreline), xn (back from the nose), dx, dz, yaw,
// pitch, thrust, kg; mount and engine (ids); mirror (on/off); remove. The tail takes one engine.
export function editPart(design, id, key, value) {
  const d = normalizeDesign(design), p = d.parts.find((q) => q.id === id);
  if (!p) return d;
  if (key === 'mirror') return setMirror(d, id, !!value);
  if (key === 'remove') return removePart(d, id);
  if (key === 'engine') return ENGINE_TYPES[value] ? updatePart(d, id, { engine: value }) : d;
  if (key === 'mount') {
    if (value === p.mount) return d;
    if (p.kind === 'engine' && value === 'tail' && d.parts.some((q) => q.kind === 'engine' && q.mount === 'tail')) return d;
    const centre = value === 'tail' || value === 'hold';
    const patch = { mount: value };
    const R = mountRange(d.base, { ...p, mount: value, side: centre ? 0 : p.side || 1 }, d.airframe);
    if (R.key === 'x') patch.x = (R.lo + R.hi) / 2;
    if (R.key === 's') patch.s = clamp(p.s || (R.lo + R.hi) / 2, R.lo, R.hi);
    if (!centre && p.side === 0) patch.side = 1;
    return updatePart(d, id, patch);
  }
  if (key === 'xn') return updatePart(d, id, { x: TYPES[d.base].geo.NOSE_X - Number(value) });
  return updatePart(d, id, { [key]: Number(value) });
}

// v0.5.4: the selected part's keys, KSP-style. ↑ ↓ forward and aft (an engine's or wing tank's dx by 0.1 m; a body
// engine's, hold tank's or ballast's station x by 0.25 m); ← → out and in along the span (a wing or over-wing part's s
// by 0.25 m); Shift+↑ ↓ an engine up and down (dz by 0.05 m); Q E turn an engine (yaw −1° / +1°, toe-in positive).
// → { key: the field, by: the step } for this part, or null where the key does nothing to it.
export function nudgeOf(p, key, shift = false) {
  if (!p) return null;
  const eng = p.kind === 'engine', span = (eng && (p.mount === 'wing' || p.mount === 'overwing')) || (p.kind === 'tank' && p.mount === 'wing');
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === 'q' || k === 'e') return eng ? { key: 'yaw', by: k === 'e' ? 1 : -1 } : null;
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    const sg = k === 'ArrowUp' ? 1 : -1;
    if (shift) return eng ? { key: 'dz', by: 0.05 * sg } : null;
    const station = (eng && p.mount === 'body') || (p.kind === 'tank' && p.mount === 'hold') || p.kind === 'ballast';
    if (station) return { key: 'x', by: 0.25 * sg };
    return eng || p.kind === 'tank' ? { key: 'dx', by: 0.1 * sg } : null;
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight') return span && !shift ? { key: 's', by: k === 'ArrowLeft' ? 0.25 : -0.25 } : null;
  return null;
}
export const NUDGE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'q', 'Q', 'e', 'E']);
// v0.5.4: one key press on a part, through editPart() (its mirror twin follows, the limits hold). → the design (the
// same values where the key does nothing to the part or it is at its limit).
export function nudgePart(design, id, key, shift = false) {
  const d = normalizeDesign(design), p = d.parts.find((q) => q.id === id), n = nudgeOf(p, key, shift);
  if (!n) return d;
  return editPart(d, id, n.key, Math.round(((p[n.key] || 0) + n.by) * 100) / 100);
}
// v0.5.4: the keys a part takes, for the help line under the view.
export function nudgeHelp(p) {
  const has = (k, s) => !!nudgeOf(p, k, s), out = [];
  if (has('ArrowUp')) out.push('↑ ↓ forward and aft');
  if (has('ArrowLeft')) out.push('← → out and in');
  if (has('ArrowUp', true)) out.push('Shift+↑ ↓ up and down');
  if (has('e')) out.push('Q E turn');
  return out.join(' · ');
}

// v0.5.6: the part in hand's keys (KSP's; ROADMAP's v0.5.2 found item): the same keys as a selected part's (nudgeOf()),
// kept as the hand's offsets, applied to wherever the pointer puts the part (applyHand()): dx, dz and yaw as the part's
// own values (its defaults are 0), s and x added to the station snapped under the pointer. `cand`: the part placement()
// gives for the pointer, before the offsets (or { kind, mount } with the pointer off the aircraft). → the new offsets (the
// same object where the key does nothing to this part or it's at a limit: RANGES for dx, dz and yaw, the mount's range
// for the station).
export const HAND0 = Object.freeze({ dx: 0, dz: 0, yaw: 0, s: 0, x: 0 });
const r2h = (v) => Math.round(v * 100) / 100;
export function nudgeHand(hand, cand, key, shift = false, base = null, af = null) {
  const n = nudgeOf(cand, key, shift);
  if (!n) return hand;
  const h = { ...HAND0, ...hand };
  let lo, hi;
  if (n.key === 's' || n.key === 'x') {
    const R = base ? mountRange(base, { side: 1, ...cand }, af) : { lo: -20, hi: 20 };
    const v0 = cand[n.key];
    // relative to the snapped station under the pointer: the station stays in the mount's range
    if (Number.isFinite(v0)) { lo = Math.min(0, R.lo - v0); hi = Math.max(0, R.hi - v0); }
    else { lo = -(R.hi - R.lo); hi = R.hi - R.lo; }
  } else [lo, hi] = RANGES[n.key];
  const v = r2h(clamp(h[n.key] + n.by, lo, hi));
  if (Math.abs(v - h[n.key]) < 1e-9) return hand;
  h[n.key] = v;
  return h;
}
// The hand's offsets on a part placement() gave (the station's offset only where it has that station). → the part.
export function applyHand(c, hand) {
  if (!c || !hand) return c;
  const out = { ...c }, v = (k) => Number(hand[k]) || 0;
  if (out.kind === 'engine') { out.dx = v('dx'); out.dz = v('dz'); out.yaw = v('yaw'); }
  else if (out.kind === 'tank' && out.mount === 'wing') out.dx = v('dx');
  if (out.s !== undefined && v('s')) out.s = r2h(out.s + v('s'));
  if (out.x !== undefined && v('x')) out.x = r2h(out.x + v('x'));
  return out;
}
// The hand's own values for the tip beside the pointer ('' when there are none): the station shows in partWhere().
export function handText(hand) {
  if (!hand) return '';
  const out = [], f = (v) => String(+Math.abs(v).toFixed(2));
  if (hand.dx) out.push(`${f(hand.dx)} m ${hand.dx > 0 ? 'forward' : 'aft'}`);
  if (hand.dz) out.push(`${f(hand.dz)} m ${hand.dz > 0 ? 'up' : 'down'}`);
  if (hand.yaw) out.push(`toed ${hand.yaw > 0 ? 'in' : 'out'} ${Math.abs(hand.yaw)}°`);
  return out.join(' · ');
}
// v0.5.6: a part dragged from the palette (ROADMAP's v0.5.2 found item: "no drag from the palette"). A press on a palette
// part becomes a drag past PAL_DRAG_PX; its release decides: 'none' (it never moved: a click, which picks the part up as
// before), 'attach' (over the aircraft where the ghost fits) or 'cancel' (off the aircraft, or where it doesn't fit: the
// part goes back).
export const PAL_DRAG_PX = 6;
export function paletteDrop({ moved, over, ghost } = {}) {
  if (!moved) return 'none';
  if (!over || !ghost) return 'cancel';
  return ghost.ok && ghost.next ? 'attach' : 'cancel';
}

// v0.5.6: the minimum control speeds (designs.js designNumbers(): vmcKt, the critical engine out and the rest at full
// thrust; vmcAllKt, every engine at full thrust on a lopsided design; vrKt) against VR: certification wants VR at least
// 1.05 × VMC. A design no worse than its base passes (the base is certified, whatever this model makes of its margin).
export const VMC_MARGIN = 1.05;
export function vmcLevel(vmc, vr, baseVmc = NaN) {
  if (!Number.isFinite(vmc) || !Number.isFinite(vr) || vr <= 0) return 'ok';
  if (Number.isFinite(baseVmc) && vmc <= baseVmc + 0.5) return 'ok';
  return vmc > vr ? 'bad' : vmc * VMC_MARGIN > vr ? 'warn' : 'ok';
}
// The readout's rows for them ({ k, label, value, level, note }): the engine-out VMC against VR and the base's, and for a
// lopsided design (vmcAllKt > 0) the speed from which the rudder holds it with every engine at full power: amber below VR
// where the yaw row already calls it lopsided (a trace of asymmetry the nose wheel holds stays green), red above VR. One
// note for one cause: the lopsided row speaks only when it's worse than the yaw row (`yawLevel`).
export function vmcRows(n, baseN = null, yawLevel = 'ok') {
  const out = [], vmc = n?.vmcKt, vr = n?.vrKt, bv = baseN?.vmcKt, kt = (v) => `${Math.round(v)} kt`;
  if (Number.isFinite(vmc)) {
    const lv = vmcLevel(vmc, vr, bv);
    out.push({ k: 'vmc', label: 'Minimum control speed (engine out)', level: lv,
      value: `${kt(vmc)}${Number.isFinite(vr) ? ` · VR ${kt(vr)}` : ''}${Number.isFinite(bv) ? ` (the base’s ${kt(bv)})` : ''}`,
      note: lv === 'bad' ? 'VMC is above VR: an engine failing at rotation yaws it off the runway, full rudder or not. Move the outer engines in, lower their thrust or make the fin bigger.'
        : lv === 'warn' ? 'VMC is within 5 % of VR (certification wants VR at least 1.05 × VMC): an engine failing at rotation takes all the rudder. Move the outer engines in, lower their thrust or make the fin bigger.' : '' });
  }
  const va = n?.vmcAllKt;
  if (Number.isFinite(va) && va > 0) {
    const yl = yawLevel || 'ok', lv = Number.isFinite(vr) && va > vr ? 'bad' : yl !== 'ok' ? 'warn' : 'ok';
    out.push({ k: 'vmcAll', label: 'Lopsided thrust (all engines)', value: `the rudder holds it from ${kt(va)}`, level: lv,
      note: lv === 'bad' && yl !== 'bad' ? `Lopsided thrust: with every engine at full power the rudder holds it straight only from ${kt(va)}, above VR. Balance the engines (Mirror).` : '' });
  }
  return out;
}

// Where a part dropped on the airframe goes. `hit`: the surface under the pointer (hitAirframe()); `what`: the part in
// hand ({ kind, engine, over (an engine on the wing goes over it), mount (a tank's: wing or hold), kg }). The station is
// snapped (0.25 m) and kept to the mount's range. → a part for addPart() (or its place, for updatePart()), or null where
// it can't go (a wing tank off the wing, a hold tank or ballast on it).
// v0.5.3: `af`, the design's airframe (its wing's ranges).
export function placement(base, what, hit, snap = 0.25, af = null) {
  if (!hit || !what) return null;
  const sn = (v) => (snap ? Math.round(v / snap) * snap : v);
  const side = hit.y >= 0 ? 1 : -1;
  let p;
  if (what.kind === 'engine') {
    p = { kind: 'engine', engine: what.engine };
    if (hit.on === 'wing') Object.assign(p, { mount: what.over ? 'overwing' : 'wing', side });
    else if (hit.on === 'body') Object.assign(p, { mount: 'body', side });
    else Object.assign(p, { mount: 'tail', side: 0 });
  } else if (what.kind === 'tank') {
    const mount = what.mount || (hit.on === 'wing' ? 'wing' : 'hold');
    if ((mount === 'wing') !== (hit.on === 'wing')) return null;
    p = { kind: 'tank', mount, side: mount === 'wing' ? side : 0, kg: what.kg ?? (mount === 'wing' ? 3000 : 2000) };
  } else {
    if (hit.on === 'wing') return null;
    p = { kind: 'ballast', side: 0, kg: what.kg ?? 1000 };
  }
  const R = mountRange(base, p, af);
  if (R.key === 's') p.s = +clamp(sn(Math.abs(hit.y)), R.lo, R.hi).toFixed(2);
  else if (R.key === 'x') p.x = +clamp(sn(hit.x), R.lo, R.hi).toFixed(2);
  return p;
}

// The surface a ray meets first (geometry frame: x forward, y left, z up; o the origin, u a unit direction), on the
// base's airframe as designs.js shapes it: the wing (each side's mid-surface over its planform), the fuselage (an
// elliptic cylinder from the tail to the nose; its crown at the fin is the tail's mount) and the fin. → { t, on: 'wing' |
// 'body' | 'tail', x, y, z } or null.
// v0.5.3: `base` may be a design: on a changed airframe, its wing (designAirframe(def), src/sim/designs.js, when there),
// its fuselage's ends with the plugs and its fin moved back with the aft plug.
export function hitAirframe(base, o, u) {
  const sh = hitShape(base), a = sh.a, G = sh.G, hz = G.FUSELAGE_HEIGHT / 2, ys = a.ys;
  let best = null;
  const at = (t) => [o[0] + t * u[0], o[1] + t * u[1], o[2] + t * u[2]];
  const take = (t, on, p) => { if (t > 1e-6 && (!best || t < best.t)) best = { t, on, x: p[0], y: p[1], z: p[2] }; };
  // each side's own planform (a design's two panels may differ: the sketch's functions take the side, the base's ignore it)
  for (const s of [1, -1]) {
    const tipY = a.tipYs ? a.tipYs[s < 0 ? 1 : 0] : a.tipY;
    const zMid = (y) => (a.lower(y, s) + a.upper(y, s)) / 2;
    const c1 = (zMid(tipY) - zMid(ys)) / (tipY - ys), c0 = zMid(ys) - c1 * ys;
    const den = u[2] - s * c1 * u[1];
    if (Math.abs(den) < 1e-9) continue;
    const t = (c0 - o[2] + s * c1 * o[1]) / den, p = at(t), y = s * p[1];
    if (y < ys || y > tipY) continue;
    const le = a.leX(y, s);
    if (p[0] > le + 0.2 || p[0] < le - a.chord(y, s) - 0.2) continue;
    take(t, 'wing', p);
  }
  const xTail = sh.tailX - 1, xNose = sh.noseX - 1;
  const A2 = (u[1] / ys) ** 2 + (u[2] / hz) ** 2, B2 = 2 * ((o[1] * u[1]) / ys ** 2 + (o[2] * u[2]) / hz ** 2), C2 = (o[1] / ys) ** 2 + (o[2] / hz) ** 2 - 1;
  const disc = B2 * B2 - 4 * A2 * C2;
  if (A2 > 1e-12 && disc >= 0) {
    const sq = Math.sqrt(disc);
    for (const t of [(-B2 - sq) / (2 * A2), (-B2 + sq) / (2 * A2)]) {
      const p = at(t);
      if (t > 1e-6 && p[0] >= xTail && p[0] <= xNose) { take(t, p[2] > 0.3 * hz && p[0] < a.finLe + 3 ? 'tail' : 'body', p); break; }
    }
  }
  if (Math.abs(u[1]) > 1e-9) {
    const t = -o[1] / u[1], p = at(t);
    if (p[2] > 0.6 * hz && p[2] < hz + 0.16 * G.SPAN && p[0] < a.finLe + 2 && p[0] > a.finLe - 0.18 * G.LENGTH) take(t, 'tail', p);
  }
  return best;
}
// The shapes hitAirframe() meets: the base's (a type id, or a design on its base's airframe: v0.5.2's exactly), or a
// changed airframe's.
function hitShape(x) {
  const base = typeof x === 'string' ? x : x?.base;
  const a0 = airframe(base), G0 = a0.G;
  const plain = { a: a0, G: G0, tailX: G0.TAIL_STRIKE_POINT.x, noseX: G0.NOSE_X };
  if (typeof x === 'string' || !x?.airframe || isBaseAirframe(x.airframe, base)) return plain;
  const def = designDef(x), af = x.airframe, ds = def.geo.DESIGN_SHAPE;
  const a = DS.designAirframe?.(def) || { ...a0, finLe: a0.finLe - af.plugAft, tailCone: a0.tailCone - af.plugAft };
  return { a, G: G0, tailX: G0.TAIL_STRIKE_POINT.x - af.plugAft, noseX: ds?.noseX ?? G0.NOSE_X + af.plugFwd };
}

// A part's box (geometry frame: its centre and half-sizes) and shape, where it is: a nacelle, a teardrop tank, a box in
// the hold. Hold tanks are sized by their fuel.
export function partBox(base, p, af = null) {
  if (p.kind === 'engine') {
    const { nacelle: n, dir } = placeEngine(base, p, af), b = { shape: 'cyl', x: n.x, y: n.y, z: n.z, hx: n.L / 2, hy: n.D / 2, hz: n.D / 2 };
    // v0.5.4: a turned engine's box turns with it (its axes: along the thrust line, across it, up)
    if (dir) b.axes = engineAxes(p);
    return b;
  }
  if (p.kind === 'tank') {
    const t = placeTank(base, p, af);
    if (!t.hold) return { shape: 'pod', x: t.x, y: t.y, z: t.z, hx: t.L / 2, hy: t.D / 2, hz: t.D / 2 };
    const hy = 0.9, hz = 0.55, hx = clamp(p.kg / 800 / (4 * hy * hz) / 2, 0.4, 3);
    return { shape: 'box', x: t.x, y: 0, z: t.z, hx, hy, hz };
  }
  const b = placeBallast(base, p);
  return { shape: 'box', x: b.x, y: 0, z: b.z, hx: 0.5, hy: 0.5, hz: 0.35 };
}
export const partBoxes = (d) => d.parts.map((p) => ({ id: p.id, kind: p.kind, mount: p.mount, ...partBox(d.base, p, d.airframe) }));
// v0.5.4: an engine's own axes in the geometry frame, turned as placeEngine()'s dir is (yaw toe-in for its side, then
// pitch): [the thrust line, across it (left), up]; they are orthonormal and right-handed.
export function engineAxes(p) {
  const yw = (p.yaw || 0) * DEG * (p.side || 1), pt = (p.pitch || 0) * DEG;
  const cy = Math.cos(yw), sy = Math.sin(yw), cp = Math.cos(pt), sp = Math.sin(pt);
  return [[cp * cy, -cp * sy, sp], [sy, cy, 0], [-cy * sp, sy * sp, cp]];
}
// Where a ray meets a box first (the distance along it), or null. v0.5.4: a box with axes (a turned engine's) is met in
// its own frame: the ray turned into it, about the box's centre.
export function rayBox(o, u, b) {
  let t0 = 0, t1 = Infinity;
  let c = [b.x, b.y, b.z];
  const h = [b.hx, b.hy, b.hz];
  if (b.axes) {
    const r = [o[0] - c[0], o[1] - c[1], o[2] - c[2]], dot = (a, v) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2], u0 = u;
    o = b.axes.map((a) => dot(a, r)); u = b.axes.map((a) => dot(a, u0)); c = [0, 0, 0];
  }
  for (let k = 0; k < 3; k++) {
    if (Math.abs(u[k]) < 1e-12) { if (Math.abs(o[k] - c[k]) > h[k]) return null; continue; }
    let ta = (c[k] - h[k] - o[k]) / u[k], tb = (c[k] + h[k] - o[k]) / u[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return t0;
}
// The part a ray points at: the nearest box it meets, unless the airframe is in front of it (a nacelle under the wing
// seen from above); the hold's parts, drawn through the skin, can always be picked.
export function pickPart(d, o, u, boxes = partBoxes(d)) {
  const hit = hitAirframe(d, o, u);
  let best = null;
  for (const b of boxes) {
    const t = rayBox(o, u, b);
    if (t === null) continue;
    const inside = b.kind === 'ballast' || b.mount === 'hold';
    if (!inside && hit && hit.t < t - 0.3) continue;
    if (!best || t < best.t) best = { t, id: b.id };
  }
  return best ? best.id : null;
}

// Undo and redo: a stack of earlier designs and one of undone ones; a new change clears the redo stack.
export function createHistory(limit = 200) {
  let past = [], future = [];
  return {
    push(state) { past.push(state); if (past.length > limit) past.shift(); future = []; },
    undo(cur) { if (!past.length) return null; future.push(cur); return past.pop(); },
    redo(cur) { if (!future.length) return null; past.push(cur); return future.pop(); },
    clear() { past = []; future = []; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}

// What the 3D model depends on: a change here rebuilds it. The parts it draws (engines and wing tanks, not the hold's)
// and where; not their thrust, nor their ids.
// v0.5.3: and the airframe (its wing, tails and plugs).
export const viewKey = (d) => JSON.stringify([d.base, d.parts.filter((p) => p.kind === 'engine' || (p.kind === 'tank' && p.mount === 'wing'))
  .map(({ id, pair, thrust, ...p }) => p), d.gearExtendM, d.registration, afKey(d.airframe)]);
const afKey = (af) => (af ? [af.wingL, af.wingR, af.tail, af.fin, af.plugFwd, af.plugAft, af.sharklets !== false, af.wingX || 0] : null);

// ---- v0.5.3: the airframe in the editor (behind AIRFRAME_ON, or the page's ?airframe=1) ----
// Click the wing, the tailplane, the fin or the fuselage to select it; its sliders replace the aircraft's in the side
// panel (the wing's span, chord, sweep and dihedral with Mirror; the tails' areas; the fuselage's plugs). While a
// slider moves, the new outline is drawn over the model (the overlay's lines), and the model rebuilds on release.
export const AIRFRAME_ON = true;
export function airframeEnabled(search) {
  if (AIRFRAME_ON) return true;
  try { return new URLSearchParams(search ?? globalThis.location?.search ?? '').get('airframe') === '1'; } catch { return false; }
}
export const AF_WING_KEYS = ['span', 'chord', 'sweep', 'dihedral'];
export const AF_STEP = { span: 0.01, chord: 0.01, sweep: 0.1, dihedral: 0.1, tail: 0.01, fin: 0.01, plugFwd: 0.05, plugAft: 0.05, wingX: 0.1 };
// What each selection's sliders change. v0.5.6: the wing's position along the fuselage (wingX: both sides together,
// whatever Mirror says) after its own sides' sliders.
export const AF_KEYS = { wing: [...AF_WING_KEYS, 'wingX'], tailplane: ['tail'], fin: ['fin'], body: ['plugFwd', 'plugAft'] };
export const afNames = { wing: 'Wing', tailplane: 'Tailplane', fin: 'Fin', body: 'Fuselage' };
const wingOf = (side) => (side < 0 ? 'wingR' : 'wingL');

// The airframe changed: `key` one of AF_KEYS's (a wing key on the clicked `side`: both sides while Mirror is on, that
// side alone when it's off), 'mirror' (on: both sides take the clicked side's shape) or 'reset' (`value`: the selection,
// back to the base's: the wing (its side alone with Mirror off), the tailplane, the fin, the plugs).
export function editAirframe(design, key, value, side = 1) {
  const d = normalizeDesign(design), af = d.airframe, own = wingOf(side);
  let next = af;
  if (AF_WING_KEYS.includes(key)) {
    const w = { ...af[own], [key]: Number(value) };
    next = af.mirror ? { ...af, wingL: w, wingR: { ...w } } : { ...af, [own]: w };
  } else if (key === 'mirror') {
    next = value ? { ...af, mirror: true, wingL: { ...af[own] }, wingR: { ...af[own] } } : { ...af, mirror: false };
  } else if (key === 'sharklets') {
    if ('sharklets' in af) next = { ...af, sharklets: !!value };   // the A321's (v0.5.3, extra time)
  } else if (key === 'reset') {
    const z = defaultAirframe(d.base);
    // v0.5.6: and back to the base's place on the fuselage (wingX: both sides, so even with Mirror off)
    if (value === 'wing') next = { ...(af.mirror ? { ...af, wingL: z.wingL, wingR: z.wingR } : { ...af, [own]: z[own] }), ...('sharklets' in z ? { sharklets: true } : {}), wingX: 0 };
    else if (value === 'tailplane') next = { ...af, tail: 1 };
    else if (value === 'fin') next = { ...af, fin: 1 };
    else if (value === 'body') next = { ...af, plugFwd: 0, plugAft: 0 };
  } else if (key in AF_STEP) next = { ...af, [key]: Number(value) };
  return next === af ? d : normalizeDesign({ ...d, airframe: next });
}

// The airframe's outline (geometry frame), from the parts' planforms (src/sim/parts-aero.js shapeOf(), the same
// stations the model and the sim use): each wing side, each tailplane side and the fin as closed polygons (leading
// edge out, trailing edge back), the fuselage as its top view and side view. → { wingL, wingR, tailL, tailR, fin,
// bodyTop, bodySide }, each an array of [x, y, z].
export function afOutline(base, af) {
  const S = shapeOf(base, af ? { wingL: af.wingL, wingR: af.wingR, tail: af.tail, fin: af.fin, plugFwd: af.plugFwd, plugAft: af.plugAft, ...(af.wingX ? { wingX: af.wingX } : {}) } : null);
  const panel = (st, s) => [...st.map((p) => [p.xle, s * p.y, p.z]), ...st.slice().reverse().map((p) => [p.xle - p.c, s * p.y, p.z])];
  const B = S.body, w = B.width / 2, h = B.height / 2, L = B.noseX - B.tailX;
  const nose = B.noseX, tail = B.tailX, n1 = nose - 0.08 * L, t1 = tail + 0.22 * L;
  return {
    wingL: panel(S.wingL.stations, 1), wingR: panel(S.wingR.stations, -1),
    tailL: panel(S.tail.stations, 1), tailR: panel(S.tail.stations, -1),
    fin: [...S.fin.stations.map((p) => [p.xle, 0, p.z]), ...S.fin.stations.slice().reverse().map((p) => [p.xle - p.c, 0, p.z])],
    bodyTop: [[nose, 0, 0], [n1, w, 0], [t1, w, 0], [tail, 0.12 * w, 0], [tail, -0.12 * w, 0], [t1, -w, 0], [n1, -w, 0]],
    bodySide: [[nose, 0, -0.2 * h], [n1, 0, h], [t1, 0, h], [tail, 0, 0.75 * h], [tail, 0, 0.45 * h], [t1, 0, -h], [n1, 0, -h]],
  };
}
// Which outlines a selection lights up.
export const afPolys = (O, what) => (what === 'wing' ? [O.wingL, O.wingR] : what === 'tailplane' ? [O.tailL, O.tailR]
  : what === 'fin' ? [O.fin] : what === 'body' ? [O.bodyTop, O.bodySide] : [O.wingL, O.wingR, O.tailL, O.tailR, O.fin, O.bodyTop, O.bodySide]);

// A ray against a triangle (Möller–Trumbore): the distance, or null.
function rayTri(o, u, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [u[1] * e2[2] - u[2] * e2[1], u[2] * e2[0] - u[0] * e2[2], u[0] * e2[1] - u[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], f = 1 / det;
  const bu = f * (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]);
  if (bu < 0 || bu > 1) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const bv = f * (u[0] * q[0] + u[1] * q[1] + u[2] * q[2]);
  if (bv < 0 || bu + bv > 1) return null;
  const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
  return t > 1e-6 ? t : null;
}
// A panel's outline (n leading-edge points, then n trailing-edge points back) as quads between its stations.
function rayPanel(o, u, poly, grow = 0) {
  const n = poly.length / 2;
  let best = null;
  for (let i = 0; i < n - 1; i++) {
    const le0 = poly[i], le1 = poly[i + 1], te1 = poly[2 * n - 2 - i], te0 = poly[2 * n - 1 - i];
    const g = (p, dx) => [p[0] + dx, p[1], p[2]];
    const A = g(le0, grow), B = g(le1, grow), C = g(te1, -grow), D = g(te0, -grow);
    for (const t of [rayTri(o, u, A, B, C), rayTri(o, u, A, C, D)]) if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}
// What part of the airframe a ray points at first: { on: 'wing' | 'tailplane' | 'fin' | 'body', side (the wing's or
// tailplane's: 1 left, −1 right), t } or null. On the design's own airframe (its outline, afOutline()); the fuselage
// as an elliptic cylinder from its tail to its nose.
export function pickAirframe(design, o, u) {
  const d = normalizeDesign(design), O = afOutline(d.base, d.airframe), S = shapeOf(d.base, d.airframe), B = S.body;
  let best = null;
  const take = (t, on, side = 0) => { if (t !== null && t > 1e-6 && (!best || t < best.t)) best = { t, on, side }; };
  take(rayPanel(o, u, O.wingL, 0.15), 'wing', 1);
  take(rayPanel(o, u, O.wingR, 0.15), 'wing', -1);
  take(rayPanel(o, u, O.tailL, 0.15), 'tailplane', 1);
  take(rayPanel(o, u, O.tailR, 0.15), 'tailplane', -1);
  take(rayPanel(o, u, O.fin, 0.15), 'fin', 0);
  const ry = B.width / 2, rz = B.height / 2;
  const A2 = (u[1] / ry) ** 2 + (u[2] / rz) ** 2, B2 = 2 * ((o[1] * u[1]) / ry ** 2 + (o[2] * u[2]) / rz ** 2), C2 = (o[1] / ry) ** 2 + (o[2] / rz) ** 2 - 1;
  const disc = B2 * B2 - 4 * A2 * C2;
  if (A2 > 1e-12 && disc >= 0) {
    const sq = Math.sqrt(disc);
    for (const t of [(-B2 - sq) / (2 * A2), (-B2 + sq) / (2 * A2)]) {
      const x = o[0] + t * u[0];
      if (t > 1e-6 && x >= B.tailX && x <= B.noseX) { take(t, 'body'); break; }
    }
  }
  return best;
}

// The airframe's numbers (designNumbers(def).airframe, src/sim/designs.js), as the readout's rows: the static margin
// (red below 0, amber below 5 % MAC: it replaces v0.5.2's CG row), Cnβ (red at 0 or below, amber under half the base's),
// the stall at MLW in landing flaps and the approach speed against the base's (amber 10 % over), the tail-strike angle
// (amber 1.5° under the base's), the nose wheel's load (red under 2.5 %, amber under 5 %), the span's code letter against
// the gate's (amber past it).
export const AF_WARN = { margin: 0.05, cnbFrac: 0.5, stallFrac: 1.1, tailDeg: 1.5, nose: 0.05, noseBad: 0.025, noseThrust: 0.01, noseThrustBad: 0 };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'F+'];
function airframeRows(n, add) {
  const a = n.airframe || null, f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const sm = a?.staticMarginMac, sm0 = a?.staticMarginBaseMac;
  const smOk = Number.isFinite(sm);
  // Forward, v0.5.2's limits on the CG's move (WARN.cgFwd, cgFwdBad) hold on the margin's growth over the base's: a
  // nose-heavy design needs more elevator to rotate and to flare.
  const more = smOk && Number.isFinite(sm0) ? sm - sm0 : 0;
  add('margin', 'Static margin (default load)', smOk ? `${f(sm * 100, 1)} % MAC (base ${f(sm0 * 100, 1)})` : '—',
    lvl(smOk && (sm < 0 || more > WARN.cgFwdBad), smOk && (sm < AF_WARN.margin || more > WARN.cgFwd)),
    !smOk ? '' : sm < 0 ? `The CG is ${f(-sm * 100, 0)} % MAC behind the neutral point: it pitches up on its own. Move weight forward, or make the tailplane bigger.`
      : sm < AF_WARN.margin ? `Only ${f(sm * 100, 1)} % MAC of static margin: light and twitchy in pitch. A bigger tailplane or the CG forward adds to it.`
      : more > WARN.cgFwdBad ? `${f(more * 100, 0)} % MAC more static margin than the base: too nose-heavy to rotate and flare. Move weight aft, or a smaller tailplane.`
      : more > WARN.cgFwd ? `${f(more * 100, 0)} % MAC more static margin than the base: it needs more elevator to rotate and to flare.` : '');
  const cn = a?.cnBeta, cn0 = a?.cnBetaBase, cnOk = Number.isFinite(cn);
  const cnWarn = cnOk && Number.isFinite(cn0) && cn0 > 0 && cn < AF_WARN.cnbFrac * cn0;
  add('cnb', 'Directional stability (Cnβ)', cnOk ? `${f(cn, 3)} /rad (base ${f(cn0, 3)})` : '—', lvl(cnOk && cn <= 0, cnWarn),
    !cnOk ? '' : cn <= 0 ? 'No directional stability: in a sideslip the nose swings further off. A bigger fin, or the fin further back (the aft plug).'
      : cnWarn ? `Under half the base’s directional stability: a slow, loose Dutch roll. A bigger fin helps.` : '');
  const vs = a?.stallKt, vs0 = a?.stallKtBase, va = a?.approachKt, va0 = a?.approachKtBase, vsOk = Number.isFinite(vs);
  const vsWarn = vsOk && Number.isFinite(vs0) && vs > AF_WARN.stallFrac * vs0;
  add('stall', 'Stall at MLW, landing flaps', vsOk ? `${f(vs, 0)} kt (base ${f(vs0, 0)}) · approach ${f(va, 0)} kt (base ${f(va0, 0)})` : '—', lvl(false, vsWarn),
    vsWarn ? `It stalls ${f(vs - vs0, 0)} kt faster than the base: a fast approach and a long landing roll. More wing (span, chord) brings it down.` : '');
  const ts = a?.tailStrikeDeg ?? n.tailStrikeDeg, ts0 = a?.tailStrikeBaseDeg, tsWarn = Number.isFinite(ts0) && ts < ts0 - AF_WARN.tailDeg;
  add('tail', 'Tail-strike angle', `${f(ts, 1)}°${Number.isFinite(ts0) && Math.abs(ts - ts0) >= 0.05 ? ` (base ${f(ts0, 1)}°)` : ''}`, lvl(ts <= 0, tsWarn),
    tsWarn ? `The tail strikes at ${f(ts, 1)}°, ${f(ts0 - ts, 1)}° sooner than the base’s: rotate gently, or lengthen the gear.` : '');
  // The nose wheel's share of the weight standing (the lower of the default load's and the empty weight's), and with
  // full take-off thrust when light (the engines below the CG and the acceleration lift the nose: designs.js). Red when
  // the nose is too light standing (under 2.5 %: it sits on its tail with any thrust); amber when it's light standing
  // (under 5 %) or when full thrust would lift it (under 1 % with thrust: the bases keep 1.3 to 2.2 %), which a take-off
  // with the levers part way avoids (as v0.5.2's thrust-to-weight warning says for two GE90s on an A321).
  const nl = Math.min(a?.noseLoad ?? Infinity, a?.noseLoadEmpty ?? Infinity), nl0 = a?.noseLoadBase, nlOk = Number.isFinite(nl);
  const nt = a?.noseLoadThrust ?? Infinity, lifts = nt < AF_WARN.noseThrustBad;
  const noseBad = nlOk && nl < AF_WARN.noseBad, noseWarn = nlOk && (nl < AF_WARN.nose || nt < AF_WARN.noseThrust);
  add('nose', 'Nose wheel load (empty or loaded)', nlOk ? `${f(nl * 100, 1)} % of the weight${Number.isFinite(nl0) ? ` (base ${f(nl0 * 100, 1)})` : ''}` : '—',
    lvl(noseBad, noseWarn),
    // v0.5.6: the main gear is on the wing, so moving the wing aft (its Position) puts the wheels further behind the CG
    !nlOk ? '' : noseBad ? `Only ${f(nl * 100, 1)} % of the weight on the nose wheel: it sits back on its tail as soon as the engines push. Move the wing aft (its Position: the main gear goes with it), or move weight forward (ballast, the engines, a longer forward plug), or shorten the aft plug.`
      : lifts ? `Full thrust lifts the nose wheel when light (${f(nt * 100, 1)} % of the weight left on it): move the wing aft (its Position: the main gear goes with it), take off with the levers part way, or move weight forward.`
      : noseWarn ? `A light nose wheel (${f(nl * 100, 1)} % of the weight, ${f(nt * 100, 1)} % with full thrust when light): poor steering, and it may sit back on its tail at full thrust. Moving the wing aft (its Position) puts the main gear further behind the CG.` : '');
  const L = a?.codeLetter, G = a?.gateLetter, spOk = Number.isFinite(a?.spanM);
  const wide = !!L && !!G && LETTERS.indexOf(L) > LETTERS.indexOf(G);
  add('span', 'Wingspan · code letter', spOk ? `${f(a.spanM, 1)} m · code ${L ?? '—'} (gate ${G ?? '—'})` : '—', lvl(false, wide),
    wide ? `The span is code ${L}, past the code ${G} stands its base parks at: only the stands that fit it are offered, and some airports may have none.` : '');
}


// The view's orbit, as camera.js's 3rd person: a drag of one screen height turns DRAG_ORBIT radians, the
// pitch between −5° and 85°; a pinch (ctrl + wheel) or a scroll zooms by exp(deltaY × 0.01), a sideways swipe turns.
export const DRAG_ORBIT = 3.2;
const DEG = Math.PI / 180;
// Where the view starts (and a double-click goes back to): ahead of the right wing, a little above the wheels, so
// the engines and the ground under them show.
const HOME = { yaw: 140 * DEG, pitch: 7 * DEG };
export function orbitTurn(view, dx, dy, h) {
  const k = DRAG_ORBIT / Math.max(1, h);
  return { ...view, yaw: view.yaw - dx * k, pitch: Math.max(-5 * DEG, Math.min(85 * DEG, view.pitch + dy * k)) };
}
export function orbitWheel(view, e, limits = [12, 400]) {
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    // A mouse wheel's notch (±100) is a step of about 1.6×, not 2.7×: one event moves at most 50.
    const dy = Math.max(-50, Math.min(50, e.deltaY || 0));
    const dist = Math.min(limits[1], Math.max(limits[0], view.dist * Math.exp(dy * 0.01)));
    return { ...view, dist };
  }
  return { ...view, yaw: view.yaw + (e.deltaX || 0) * 0.0035 };
}

// ---- The 3D view ----
// Its own renderer and scene: the hangar (src/ui/hangar.js, v0.5.1) with its floor at the design's wheels, lit by
// a hemisphere light, the high-bay lamps' light from above with shadows, and daylight through the doors. The
// camera goes round the design and stays inside the hangar: zoomed out against a wall, it stops at the wall.
// The model is rebuilt (the old one's geometry and materials disposed) when viewKey changes, at most every 150 ms.
// The people walk at 30 frames a second while the view is shown, and nothing runs once the page is hidden or the
// view is disposed.
// v0.5.2: an overlay drawn over everything (no depth test): the ghosts of parts in hand, the boxes of the selected
// part and the one under the pointer, the hold's parts (inside the fuselage), the CoM and CoT markers. The page's
// hooks get the pointer as a ray in the geometry frame: down (true claims the drag from the orbit), move, up, hover,
// click (a press and release without a drag) and cancel (the right button).
const ANIM_MS = 33;
async function createView(host, onStatus) {
  const [THREE, assets, hangarMod] = await Promise.all([import('../../vendor/three.module.js'), import('../type-assets.js'), import('./hangar.js')]);
  const canvas = document.createElement('canvas');
  canvas.className = 'fsw-canvas';
  host.prepend(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c6d5e2');   // the sky through the doors
  scene.add(new THREE.HemisphereLight('#eef3f8', '#8f8c84', 1.5));
  const sun = new THREE.DirectionalLight('#fbfcff', 1.9);   // the lamps overhead: the design's shadow on the floor
  sun.position.set(-18, 80, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
  const daylight = new THREE.DirectionalLight('#fff0da', 0.6);   // through the open doors, behind the tail
  daylight.position.set(0, 18, 140);
  scene.add(sun, sun.target, daylight);
  const hangar = hangarMod.createHangar(THREE, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  scene.add(hangar.group);
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1.0, 3000);

  // The overlay: shared shapes and materials, meshes made afresh on each change (a handful).
  const fx = new THREE.Group();
  scene.add(fx);
  const flat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
  const line = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
  const MAT = {
    ok: flat('#3ddc84', 0.5), bad: flat('#ff5a5a', 0.55), hold: flat('#ffb23f', 0.3), ballast: flat('#c8d0d8', 0.35),
    sel: line('#2fe3ff', 1), twin: line('#2fe3ff', 0.5), hover: line('#ffffff', 0.75),
    cot: flat('#e040fb', 0.95),
    // v0.5.3: the airframe's outlines (the selection's, the one under the pointer, the new shape while a slider moves)
    afSel: line('#2fe3ff', 0.95), afHover: line('#ffffff', 0.6), afGhost: line('#3ddc84', 1),
  };
  const GEO = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1).rotateX(Math.PI / 2),
    pod: new THREE.SphereGeometry(0.5, 24, 14), ball: new THREE.SphereGeometry(1, 24, 16),
    shaft: new THREE.CylinderGeometry(0.22, 0.22, 1, 12).translate(0, 0.5, 0), head: new THREE.ConeGeometry(0.6, 1, 16).translate(0, 0.5, 0),
  };
  GEO.edges = new THREE.EdgesGeometry(GEO.box);
  // The CoM's ball: yellow and black quarters.
  const comTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111111' : '#ffd400'; g.fillRect(i * 32, j * 32, 32, 32); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  MAT.com = new THREE.MeshBasicMaterial({ map: comTex, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false });
  // geometry frame (x forward, y left, z up) → the model's (−y, z, −x)
  // v0.5.4: a turned engine's box turns with it: its axes [along, across, up] as the model's columns (−across, up, −along).
  const toM = (v) => new THREE.Vector3(-v[1], v[2], -v[0]), neg = (v) => v.map((q) => -q);
  const put = (o, b) => {
    o.position.set(-b.y, b.z, -b.x); o.scale.set(2 * b.hy, 2 * b.hz, 2 * b.hx);
    if (b.axes) o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toM(neg(b.axes[1])), toM(b.axes[2]), toM(neg(b.axes[0]))));
    o.renderOrder = 10; fx.add(o); return o;
  };
  let overlay = null, polyGeo = [];
  function drawOverlay() {
    for (const c of fx.children.slice()) fx.remove(c);
    for (const g of polyGeo) g.dispose();
    polyGeo = [];
    const o = overlay;
    if (!o) return;
    // v0.5.3: closed polylines (geometry frame), one LineSegments per style.
    const byStyle = new Map();
    for (const pl of o.polys || []) {
      const a = byStyle.get(pl.style) || [];
      const P = pl.pts;
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        if (i === P.length - 1 && pl.open) break;
        a.push(-p[1], p[2], -p[0], -q[1], q[2], -q[0]);
      }
      byStyle.set(pl.style, a);
    }
    for (const [style, a] of byStyle) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      polyGeo.push(g);
      const m = new THREE.LineSegments(g, MAT[style] || MAT.afSel);
      m.renderOrder = 13; m.frustumCulled = false;
      fx.add(m);
    }
    for (const b of o.inside || []) put(new THREE.Mesh(GEO.box, b.kind === 'ballast' ? MAT.ballast : MAT.hold), b);
    for (const g of o.ghosts || []) put(new THREE.Mesh(GEO[g.shape] || GEO.box, g.ok ? MAT.ok : MAT.bad), g);
    for (const b of o.lines || []) {
      const m = put(new THREE.LineSegments(GEO.edges, MAT[b.style] || MAT.sel), { ...b, hx: b.hx + 0.15, hy: b.hy + 0.15, hz: b.hz + 0.15 });
      m.renderOrder = 11;
    }
    const k = o.markers;
    if (k) {
      const r = k.r;
      const com = new THREE.Mesh(GEO.ball, MAT.com);
      com.position.set(-k.cg.y, k.cg.z, -k.cg.x); com.scale.setScalar(r); com.renderOrder = 12; fx.add(com);
      if (k.ct) {
        const g = new THREE.Group();
        g.position.set(-k.ct.y, k.ct.z, -k.ct.x);
        const ball = new THREE.Mesh(GEO.ball, MAT.cot); ball.scale.setScalar(0.7 * r);
        const L = k.len, shaft = new THREE.Mesh(GEO.shaft, MAT.cot), head = new THREE.Mesh(GEO.head, MAT.cot);
        shaft.scale.set(r, 0.75 * L, r); head.scale.set(r, 0.25 * L, r); head.position.y = 0.75 * L;
        g.add(ball, shaft, head);
        const d = new THREE.Vector3(-k.ct.dir[1], k.ct.dir[2], -k.ct.dir[0]).normalize();
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        g.traverse((m) => { m.renderOrder = 12; });
        fx.add(g);
      }
    }
  }

  let view = null, model = null, builtKey = null, pending = null, timer = 0, lastBuild = 0, raf = 0, anim = 0, animate = true, disposed = false;
  let buildMs = Infinity;   // v0.5.3: the last rebuild's time (the airframe's sliders rebuild live only when it's short)
  let groundY = -3.9, distLim = [12, 150], baseDist = 50, camBox = hangarMod.cameraBox(groundY);
  const target = new THREE.Vector3(), t0 = performance.now(), U = [0, 0, 0], P = [0, 0, 0];

  function frame() {
    raf = 0;
    if (disposed || !view) return;
    const cp = Math.cos(view.pitch);
    U[0] = cp * Math.sin(view.yaw); U[1] = Math.sin(view.pitch); U[2] = cp * Math.cos(view.yaw);
    P[0] = target.x; P[1] = target.y; P[2] = target.z;
    // Out to the view's distance, or to the hangar's wall, roof or floor if that comes first.
    const d = Math.min(view.dist, hangarMod.rayExit(P, U, camBox));
    camera.position.set(target.x + d * U[0], target.y + d * U[1], target.z + d * U[2]);
    camera.lookAt(target);
    if (animate) hangar.update((performance.now() - t0) / 1000);
    renderer.render(scene, camera);
    if (animate && !anim && !document.hidden) anim = setTimeout(() => { anim = 0; request(); }, ANIM_MS);
  }
  const request = () => { if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(frame); };

  function disposeModel() {
    if (!model) return;
    scene.remove(model.object);
    model.object.traverse((o) => {
      o.geometry?.dispose?.();
      for (const mt of [].concat(o.material || [])) mt.dispose?.();
    });
    model = null;
  }
  // The builders for a design's type entry (the engine builder's), else the base's model.
  function buildersOf(def) {
    const b = assets.buildersFor(def);
    return b === assets.buildersFor('a321neo') && def.id !== 'a321neo' ? assets.buildersFor(def.id) : b;
  }
  function build() {
    timer = 0;
    if (disposed || !pending) return;
    const d = pending, key = viewKey(d);
    pending = null;
    if (key === builtKey) return;
    lastBuild = performance.now();
    const def = designDef(d);
    let next;
    const tb = performance.now();
    try { next = buildersOf(def).createAircraft(); } catch (err) { onStatus?.(`The model could not be built: ${err.message}`); return; }
    disposeModel();
    model = next;
    model.setCockpitView?.(false);
    model.setLights?.({});   // parked with its lights off: no glows in the hangar's daylight
    model.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.update?.({ t: 0, surfaces: { elevator: 0, stab: 0, aileronL: 0, aileronR: 0, rudder: 0, spoilersL: [0, 0, 0, 0, 0], spoilersR: [0, 0, 0, 0, 0] },
      slatDeg: 0, flapDeg: 0, flapLever: 0, gearPos: 1, gearDoors: 0, steerAngle: 0, wheelRate: { nose: 0, main: 0 },
      engines: def.geo.ENGINES.map(() => ({ n1: 0, rev: 0 })), thrustLever: 0, speedbrake: 0, pitch: 0, roll: 0, hdg: 0 }, 0);
    scene.add(model.object);
    groundY = -def.geo.GROUND_Z;
    hangar.group.position.y = groundY;
    camBox = hangarMod.cameraBox(groundY);
    target.set(0, groundY * 0.45, 0);
    sun.target.position.set(0, groundY, 0);
    const span = def.geo.SPAN || 40;
    Object.assign(sun.shadow.camera, { left: -span * 0.8, right: span * 0.8, top: span * 1.2, bottom: -span * 1.2 });
    sun.shadow.camera.updateProjectionMatrix();
    // The game's 3rd-person distance, for this view's wider lens (50° against 35°), a little further out for the palette.
    const d0 = (def.orbitDist ?? 75) * 0.72;
    if (!view) view = { yaw: HOME.yaw, pitch: HOME.pitch, dist: d0 };
    else if (Math.abs(baseDist - d0) > 1e-6 && Math.abs(view.dist - baseDist) < 1e-6) view.dist = d0;
    baseDist = d0;
    distLim = [Math.max(8, span * 0.3), 150];
    builtKey = key;
    buildMs = performance.now() - tb;
    onStatus?.('');
    request();
  }
  function setDesign(d, now = false) {
    pending = d;
    if (viewKey(d) === builtKey) { pending = null; return; }
    if (timer) return;
    const wait = now ? 0 : Math.max(0, 150 - (performance.now() - lastBuild));
    timer = setTimeout(build, wait);
  }

  // The picture's centre moves a little right of the view's (the palette covers its left edge).
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (w > 700) camera.setViewOffset(w, h, -40, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    request();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  // The pointer as a ray in the geometry frame.
  const ndc = new THREE.Vector2(), caster = new THREE.Raycaster();
  function rayAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    camera.updateMatrixWorld();
    caster.setFromCamera(ndc, camera);
    const o = caster.ray.origin, u = caster.ray.direction;
    return { o: [-o.z, -o.x, o.y], u: [-u.z, -u.x, u.y] };
  }

  // Drag to go round (unless the page claims the press), pinch or scroll to zoom, a sideways swipe turns, double-click
  // recentres, the right button cancels.
  let drag = null, hooks = null;
  const onDown = (e) => {
    if (!e.isPrimary) return;
    // v0.5.3: a press whose release was never seen (the capture lost, released outside the window) ends here first
    if (drag) { const d = drag; drag = null; window.removeEventListener('pointerup', onLate, true); if (d.claimed) hooks?.up?.(null, e, false); }
    if (e.button === 2) { hooks?.cancel?.(); return; }
    if (e.button !== 0) return;
    const claimed = !!hooks?.down?.(rayAt(e), e);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, claimed, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (!claimed) canvas.classList.add('drag');
  };
  const onMove = (e) => {
    if (!drag) { if (e.pointerType !== 'touch') hooks?.hover?.(rayAt(e), e); return; }
    if (e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
    if (drag.claimed) { if (drag.moved) hooks?.move?.(rayAt(e), e); return; }
    if (!view) return;
    view = orbitTurn(view, e.clientX - drag.x, e.clientY - drag.y, canvas.clientHeight);
    drag.x = e.clientX; drag.y = e.clientY;
    request();
  };
  // v0.5.3: losing the pointer's capture mid-press (the browser or another window took it: in Chrome a screenshot
  // taken mid-drag does) no longer cancels the drag: its release, wherever it comes, ends it as usual.
  const onLate = (e) => { window.removeEventListener('pointerup', onLate, true); onUp(e); };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === 'lostpointercapture') { window.addEventListener('pointerup', onLate, true); return; }
    window.removeEventListener('pointerup', onLate, true);
    const d = drag;
    drag = null;
    canvas.classList.remove('drag');
    if (e.type === 'pointerup') {
      if (d.claimed) hooks?.up?.(rayAt(e), e, d.moved);
      else if (!d.moved) hooks?.click?.(rayAt(e), e);
    } else if (d.claimed) hooks?.up?.(null, e, false);
  };
  const onWheel = (e) => { e.preventDefault(); if (!view) return; view = orbitWheel(view, e, distLim); request(); };
  const onDbl = () => { if (view) { view = { yaw: HOME.yaw, pitch: HOME.pitch, dist: baseDist }; request(); } };
  const onVis = () => { if (!document.hidden) request(); };
  const onCtx = (e) => e.preventDefault();
  const onLeave = () => { if (!drag) hooks?.leave?.(); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', onCtx);
  canvas.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', onVis);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    if (anim) clearTimeout(anim);
    raf = timer = anim = 0;
    hooks = null;
    ro?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pointerup', onLate, true);
    disposeModel();
    for (const c of fx.children.slice()) fx.remove(c);
    for (const g of polyGeo) g.dispose();
    for (const g of Object.values(GEO)) g.dispose();
    for (const m of Object.values(MAT)) m.dispose();
    comTex.dispose();
    hangar.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  }
  return {
    setDesign, dispose, request, resize,
    // The people stop (and stay where they are) with false; true starts them again.
    setAnimate(on) { animate = !!on; if (!animate && anim) { clearTimeout(anim); anim = 0; } request(); },
    setHooks(h) { hooks = h; },
    setOverlay(o) { overlay = o; drawOverlay(); request(); },
    setCursor(c) { canvas.classList.toggle('place', c === 'place'); canvas.classList.toggle('over', c === 'over'); },
    // v0.5.6 (a part dragged from the palette): the pointer's ray (geometry frame), and whether a point (client pixels)
    // is on the view itself (not the palette or a panel over it)
    ray: (e) => rayAt(e),
    overCanvas: (x, y) => document.elementFromPoint(x, y) === canvas,
    // A point of the geometry frame on the screen (client pixels), as last drawn.
    project(x, y, z) {
      const v = new THREE.Vector3(-y, z, -x).project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, front: v.z < 1 };
    },
    get view() { return view; },
    get builtKey() { return builtKey; },
    get busy() { return !!(timer || pending); },
    // v0.5.3: the last rebuild's time, ms (the model and its materials; the frame after it is extra)
    get buildMs() { return buildMs; },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, overlay: fx.children.length }),
  };
}

// ---- The page ----

// ---- v0.5.6: the parts' keys (Shane: "you can attach keybindings by selecting plane parts like the engines, where
// they open a little tab and you can change the key by pressing on top of a little key icon ... similar to Besiege") ----
// The keys tab of the selected part or piece of airframe: each control a row of keycaps (src/keys.js). An engine's tab
// has its own keys (with its mirror twin's) and the all-engines keys; a wing tank's, the drop; the wing's, the ailerons,
// flaps and spoilers; the tailplane's, the elevator (and a Boeing's trim); the fin's, the rudder; the fuselage's, the
// gear and brakes. The pure parts below are tested in node (tests/warehouse-keytab.test.mjs).
export const KEY_PART = { wing: 'wing', tailplane: 'tailplane', fin: 'fin', body: 'fuselage' };
// The keys' scope of what's open: a type (the stock aircraft's keys-only editor) or a design (its base type's keys
// until one is changed for it).
export const keyScopeOf = (design, stock = false) => (stock ? { scope: `type:${design.base}`, base: null } : scopeOf({ id: design.base, design: { id: design.id, base: design.base } }));
// An engine part's index in the sim (designDef()'s order), and its mirror twin's (or null).
export function engineIndex(def, partId) {
  const N = def?.geo?.NACELLES || [];
  const i = N.findIndex((n) => n.part === partId);
  return i;
}
export function twinIndex(design, def, partId) {
  const p = design.parts.find((q) => q.id === partId);
  if (!p?.pair) return null;
  const t = engineIndex(def, p.pair);
  return t >= 0 ? t : null;
}
// A flap detent's row names the type's detent (0, 1, 2, 3, FULL; UP, 5, 15, 20, 30).
export function keyLabelOf(b, def) {
  if (b.flap === undefined) return b.label;
  const L = def?.data?.FLAP_LEVER, K = def?.data?.FLAP_KEYS;
  return L && K && K[b.flap] !== undefined ? `Flaps to ${L[K[b.flap]]}` : b.label;
}
const caps = (chords, id, more = true) => {
  const out = (chords || []).map((c, i) => ({ cap: `${id}:${i}`, text: keyLabel(c), chord: c }));
  if (!out.length) out.push({ cap: `${id}:0`, text: '', empty: true });
  else if (more) out.push({ cap: `${id}:${out.length}`, text: '+', add: true });
  return out;
};
// The tab: { title, rows: [{ id | eng, label, caps: [{ cap, text, chord?, empty?, add?, follow? }], ... }] }. what:
// { part: partId } or { af: 'wing' | 'tailplane' | 'fin' | 'body' }. twinOn: an engine's twin takes its keys (a
// design's: its mirror; a type's: the keys-only editor's Mirror).
export function keyTab(design, def, store, sc, what, { twinOn = true } = {}) {
  const fam = def?.family || TYPES[design.base]?.family || null;
  const res = resolveKeys(store, { ...sc, nEngines: def?.geo?.ENGINES?.length ?? null });
  const rowsOf = (part) => partBindings(part, fam).map((b) => ({ id: b.id, label: keyLabelOf(b, def), caps: caps(res.bind[b.id], b.id) }));
  if (what.af) return { title: 'Keys', part: KEY_PART[what.af], rows: rowsOf(KEY_PART[what.af]) };
  const p = design.parts.find((q) => q.id === what.part);
  if (!p) return { title: 'Keys', rows: [] };
  if (p.kind === 'tank' && p.mount === 'wing') return { title: 'Keys', part: 'tank', rows: rowsOf('tank') };
  if (p.kind !== 'engine') return { title: 'Keys', part: null, rows: [], note: 'No keys: it has nothing to move.' };
  const i = engineIndex(def, p.id), t = twinIndex(design, def, p.id);
  const engines = t !== null && twinOn ? [i, t] : [i];
  const ek = engineKeys(store, sc, i);
  const name = `Engine ${i + 1}${engines.length > 1 ? ` and ${t + 1} (its twin)` : ''}`;
  const one = (dir) => {
    const l = dir > 0 ? ek.up : ek.down;
    return l.length ? { cap: `eng:${dir > 0 ? 'up' : 'down'}`, text: keyLabel(l[0]), chord: l[0], follow: !ek.own } : { cap: `eng:${dir > 0 ? 'up' : 'down'}`, text: '', empty: true };
  };
  return {
    title: 'Keys', part: 'engine', engine: { i, twin: t, engines, own: ek.own, with: ek.engines },
    rows: [
      { eng: true, label: ek.own ? `${name}: its own` : `${name}: as the others`, caps: [one(1), one(-1)], own: ek.own },
      { all: true, label: 'All engines (on the ground at idle, down holds reverse)', up: caps(res.bind.thrustUp, 'thrustUp', false), down: caps(res.bind.thrustDown, 'thrustDown', false) },
    ],
  };
}

function linkCss() {
  if (document.querySelector('link[data-fsw-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./warehouse.css', import.meta.url).href; l.dataset.fswCss = '';
  document.head.appendChild(l);
}

const typesShown = () => TYPE_LIST();
// The palette: the three engines, then the tanks and ballast.
const PALETTE = [
  ...ENGINE_LIST.map((e) => ({ key: `engine:${e.id}`, what: { kind: 'engine', engine: e.id }, name: e.short, note: `${Math.round(e.data.T0_ENGINE / 1000)} kN · ${(e.installedKg / 1000).toFixed(1)} t` })),
  { key: 'tank:wing', what: { kind: 'tank', mount: 'wing' }, name: 'Wing tank', note: 'under the wing · 3,000 kg' },
  { key: 'tank:hold', what: { kind: 'tank', mount: 'hold' }, name: 'Hold tank', note: 'in the cargo hold · 2,000 kg' },
  { key: 'ballast', what: { kind: 'ballast' }, name: 'Ballast', note: 'in the hold · 1,000 kg' },
];
const HELP = {
  idle: 'Drag to go round · scroll to zoom · click a part to select it, drag it to move it · Z undo · Shift+Z redo',
  place: 'Click on the aircraft to attach it (or drag it there from the palette) · Shift+click keeps it in hand · right-click or Esc puts it back',
  sel: 'Drag the part to move it · Delete removes it · Esc lets go',
  // v0.5.3, with the airframe on
  idleAf: 'Drag to go round · scroll to zoom · click a part, or the wing, tail, fin or fuselage, to change it · drag a part from the palette onto it · Z undo · Shift+Z redo',
  af: 'Drag a slider: the new outline shows in green, the model follows on release · Z undo · Esc lets go',
  // v0.5.6: a stock aircraft's keys
  keys: 'Drag to go round · scroll to zoom · click an engine, the wing, the tailplane, the fin or the fuselage: its keys · Esc goes back',
  keySel: 'Click a keycap, then press the key · Esc lets go',
};
// A rebuild this quick (ms) keeps 30 frames a second while a slider moves: the model follows live, not on release.
const LIVE_BUILD_MS = 20;

export function createWarehouse(root, { store = designStore(), keys = null } = {}) {
  linkCss();
  const el = document.createElement('div');
  el.className = 'fsw';
  el.hidden = true;
  el.tabIndex = -1;
  el.innerHTML = `
    <header class="fsw-bar">
      <h2>Warehouse</h2><span class="fsw-crumb" data-o="crumb"></span>
      <button class="fsui-b" data-a="top">Back to the menu</button>
    </header>
    <section class="fsw-listpage" data-o="listPage" aria-label="Designs">
      <div class="fsw-listcard">
        <div class="fsw-new"><span>New design from the</span>${typesShown().map((t) => `<button class="fsui-b primary" data-new="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
        <div class="fsw-new fsw-stock" data-o="stock"${keys ? '' : ' hidden'}><span>Stock aircraft</span>${typesShown().map((t) => `<button class="fsui-b" data-stock="${esc(t.id)}" title="The ${esc(t.name)}’s keys: click a part to set them">${esc(t.name)} · Keys</button>`).join('')}</div>
        <p class="fsm-note" data-o="listMsg" aria-live="polite"></p>
        <div class="fsm-list" data-o="list"></div>
        <p class="fsm-help">A design is one of the three types with parts attached: engines anywhere they fit, tanks and ballast, its weight, fuel and gear changed. Click one to open it. Saved designs fly from New scenario’s aircraft picker. A part’s keys (an engine’s thrust, the wing’s ailerons and flaps, the tail’s elevator and rudder, the gear and brakes) are set by clicking it: a stock aircraft’s with its Keys. Esc goes back.</p>
      </div>
    </section>
    <section class="fsw-editor" data-o="editor" hidden aria-label="Design">
      <div class="fsw-view" data-o="view">
        <p class="fsw-viewmsg" data-o="viewMsg">Loading the model…</p>
        <div class="fsw-palette" data-o="palette" aria-label="Parts">
          <h4>Parts</h4>
          <span class="fsw-pal-g">Engines</span>
          ${PALETTE.filter((p) => p.what.kind === 'engine').map((p) => `<button type="button" class="fsw-pal-b" data-place="${p.key}"><b>${esc(p.name)}</b><small>${esc(p.note)}</small></button>`).join('')}
          <span class="fsw-pal-g fsw-pal-sub">On the wing, hung</span>
          <div class="fsui-seg fsw-hang" data-o="hang" title="Where an engine dropped on the wing hangs"><button type="button" data-hang="under" class="on">Under</button><button type="button" data-hang="over">Over</button></div>
          <span class="fsw-pal-g">Fuel and weight</span>
          ${PALETTE.filter((p) => p.what.kind !== 'engine').map((p) => `<button type="button" class="fsw-pal-b" data-place="${p.key}"><b>${esc(p.name)}</b><small>${esc(p.note)}</small></button>`).join('')}
          <label class="fsw-check"><input type="checkbox" data-o="mirror" checked> Mirror on the other side</label>
          <span class="fsw-pal-note" data-o="room"></span>
        </div>
        <div class="fsw-tools">
          <button type="button" class="fsui-b" data-a="undo" title="Undo (Z)" disabled>Undo</button>
          <button type="button" class="fsui-b" data-a="redo" title="Redo (Shift+Z)" disabled>Redo</button>
          <button type="button" class="fsui-b" data-a="markers" aria-pressed="true" title="The centre of mass and the centre of thrust">CoM · CoT</button>
        </div>
        <p class="fsw-tip" data-o="tip" hidden></p>
        <p class="fsw-legend" data-o="legend"><i class="com"></i>Centre of mass (default load) <i class="cot"></i>Centre of thrust</p>
        <p class="fsw-viewhelp" data-o="viewHelp">${esc(HELP.idle)}</p>
      </div>
      <aside class="fsw-side">
        <div class="fsw-scroll">
          <div class="fsw-issues" data-o="issues" aria-live="polite"></div>
          <div class="fsw-parts" data-o="parts"></div>
          <h3 class="fsw-h" data-o="numsH">The numbers</h3>
          <div class="fsw-nums" data-o="nums"></div>
        </div>
        <div class="fsw-foot">
          <div class="fsw-ask" data-o="ask" hidden><span>Leave without saving the changes?</span><button class="fsui-b" data-a="keep">Keep editing</button><button class="fsui-b danger" data-a="discard">Discard</button></div>
          <span class="fsw-msg" data-o="msg" aria-live="polite"></span>
          <button class="fsui-b" data-a="back">Back to the list</button>
          <button class="fsui-b" data-a="fly" title="Save it and set up a flight in it">Fly it</button>
          <button class="fsui-b primary" data-a="save">Save</button>
        </div>
      </aside>
    </section>`;
  root.appendChild(el);
  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const act = (k) => el.querySelector(`[data-a="${k}"]`);

  let page = 'list';
  let editing = null, confirming = null, renameMsg = '', listMsg = '', listMsgBad = false;
  let cur = null, savedJson = null, isNew = false;
  let view = null, viewLoading = null, viewGen = 0;
  // The editor's tools: the part in hand (a palette entry's `what`), where wing engines hang, Mirror, the markers;
  // the selected part, the one under the pointer, the ghost (where the part in hand or being dragged would go).
  let tool = null, toolKey = null, hangOver = false, mirrorOn = true, markersOn = true;
  let sel = null, hover = null, ghost = null, dragPart = null, sliding = false, last = null;
  // v0.5.6: the part in hand's offsets (its keys: nudgeHand()), the last candidate placement() gave under the pointer
  // before them, the pointer's last ray and event over the view (to show a key's change at once), and a drag from the
  // palette under way ({ key, id, x0, y0, moved }) and when the last one ended (its click doesn't pick the part again).
  let hand = { ...HAND0 }, handCand = null, handAt = null, palDrag = null, palDragEnd = 0;
  // v0.5.3: the airframe (behind AIRFRAME_ON or ?airframe=1): the selected piece ({ what: wing | tailplane | fin | body,
  // side }), the one under the pointer, and whether one of its sliders is moving (the ghost outline shows).
  const afOn = airframeEnabled();
  let selAf = null, hoverAf = null, afDrag = false;
  const hist = createHistory();
  // v0.5.6: the keys (`keys`: { load(), save(store), nameOf(scope) }: main.js's). keysOnly: a stock aircraft's keys
  // editor (no palette, no sliders: a click on a part opens its keys tab). capKey: the keycap waiting for a key
  // ({ cap, id, i } or { cap, eng: +1 | -1 }); keyMsg: the tab's line; stockTwin: a type's Mirror for its engines' keys.
  let keysOnly = false, capKey = null, keyMsg = '', keyMsgBad = false, stockTwin = true;

  // ---- The list ----
  function rowHtml(d) {
    const def = designDef(d), id = esc(d.id);
    let main;
    if (editing === d.id) {
      main = `<div class="fsm-rename">
          <input type="text" class="fsm-input" data-r="name" maxlength="${NAME_MAX + 10}" value="${esc(d.name)}" aria-label="Design name" spellcheck="false" autocomplete="off">
          <button class="fsui-b primary" data-r="save">Save</button><button class="fsui-b" data-r="cancel">Cancel</button>
          <span class="fsm-err" data-o="renameMsg">${esc(renameMsg)}</span></div>`;
    } else {
      const r = readout(d);
      main = `<div class="fsm-row-main"><b>${esc(d.name)}</b>
          <small>${esc(TYPES[d.base].name)} · ${esc(def.engineName)} · ${esc(d.registration)}${r.worst !== 'ok' ? ` · <span class="fsw-${r.worst}">${r.worst === 'bad' ? 'fails a check' : 'a warning'}</span>` : ''}</small></div>
        <span class="fsm-when">${r.canSave ? `${Math.round(r.numbers.rangeNm).toLocaleString('en-US')} nm · T/W ${r.numbers.thrustToWeight.toFixed(2)}` : 'no engines'}</span>`;
    }
    const acts = confirming === d.id
      ? `<div class="fsm-confirm"><span>Delete “${esc(d.name)}”? Scenarios flying it keep their copy.</span>
          <button class="fsui-b" data-r="no">Cancel</button><button class="fsui-b danger" data-r="yes">Delete</button></div>`
      : editing === d.id ? ''
      : `<div class="fsm-row-act"><button class="fsui-b primary" data-r="open">Open</button><button class="fsui-b" data-r="rename">Rename</button><button class="fsui-b" data-r="duplicate">Duplicate</button><button class="fsui-b" data-r="delete">Delete</button></div>`;
    return `<div class="fsm-row${confirming === d.id ? ' asking' : ''}" data-id="${id}" tabindex="0">${main}${acts}</div>`;
  }
  function renderList(focusId) {
    const m = $('listMsg'); m.textContent = listMsg; m.classList.toggle('bad', listMsgBad);
    const list = store.list();
    $('list').innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="fsm-empty">No designs yet. Start one from a type above.</div>';
    if (editing) { const inp = $('list').querySelector('[data-r="name"]'); if (inp) { inp.focus(); if (!renameMsg) inp.select(); } }
    else if (confirming) $('list').querySelector(`.fsm-row[data-id="${CSS.escape(confirming)}"] [data-r="no"]`)?.focus();
    else if (focusId !== undefined) {
      const row = focusId && $('list').querySelector(`.fsm-row[data-id="${CSS.escape(focusId)}"]`);
      (row || el).focus({ preventScroll: !row });
    }
  }
  function commitRename(id) {
    const inp = $('list').querySelector('[data-r="name"]');
    const r = store.rename(id, inp ? inp.value : '');
    if (!r.ok) {
      renameMsg = r.error === 'quota' ? 'Browser storage is full: the name was not saved.' : r.error === 'name' ? `A name needs ${NAME_MIN}–${NAME_MAX} characters.` : 'That design is gone.';
      const mm = $('list').querySelector('[data-o="renameMsg"]'); if (mm) mm.textContent = renameMsg;
      return;
    }
    editing = null; renameMsg = '';
    renderList(id);
  }
  $('list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.fsm-row[data-id]');
    if (!row) return;
    const id = row.dataset.id, r = ev.target.closest('[data-r]')?.dataset.r;
    if (r === 'name') return;
    listMsg = ''; listMsgBad = false;
    if (r === 'duplicate') {
      const res = store.duplicate(id);
      editing = confirming = null;
      listMsgBad = !res.ok;
      listMsg = res.ok ? `Copied as “${res.design.name}”: at the top.` : res.error === 'quota' ? 'Browser storage is full: no copy was made.' : 'That design is gone.';
      // v0.5.6: the copy takes the design's keys
      if (res.ok && keys) { const st = keysFrom(keys.load()), own = st.scopes[`design:${id}`]; if (own) { st.scopes[`design:${res.design.id}`] = JSON.parse(JSON.stringify(own)); keys.save(st); } }
      renderList(res.ok ? res.design.id : id);
      if (res.ok) $('list').scrollTop = 0;
      return;
    }
    if (r === 'rename') { editing = id; confirming = null; renameMsg = ''; renderList(); return; }
    if (r === 'save') { commitRename(id); return; }
    if (r === 'cancel') { editing = null; renameMsg = ''; renderList(id); return; }
    if (r === 'delete') { confirming = id; editing = null; renderList(); return; }
    if (r === 'no') { confirming = null; renderList(id); return; }
    if (r === 'yes') {
      const list = store.list(), i = list.findIndex((d) => d.id === id);
      if (!store.remove(id)) { listMsg = 'Browser storage refused the change: the design is still there.'; listMsgBad = true; }
      else dropKeys(id);   // v0.5.6: its keys go with it
      confirming = null;
      const next = store.list();
      renderList(next[Math.min(i, next.length - 1)]?.id || null);
      return;
    }
    if (editing === id || confirming === id) return;
    const d = store.get(id);
    if (d) openEditor(d, false);
  });
  $('list').addEventListener('keydown', (e) => {
    if (e.target.dataset?.r === 'name') {
      const row = e.target.closest('.fsm-row[data-id]');
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitRename(row.dataset.id); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const id = editing; editing = null; renameMsg = ''; renderList(id); }
      return;
    }
    const row = e.target.closest?.('.fsm-row[data-id]');
    if (row && e.target === row && e.key === 'Enter' && !confirming) { e.preventDefault(); const d = store.get(row.dataset.id); if (d) openEditor(d, false); }
  });
  for (const b of el.querySelectorAll('[data-new]')) b.onclick = () => openEditor(store.draft(b.dataset.new), true);
  // v0.5.6: a stock aircraft's keys: its own editor, keys only
  for (const b of el.querySelectorAll('[data-stock]')) b.onclick = () => openStock(b.dataset.stock);
  function openStock(typeId) {
    if (!keys || !TYPES[typeId]) return;
    openEditor(newDesign(typeId, { id: `stock-${typeId}`, name: TYPES[typeId].name }), false, true);
  }
  function dropKeys(designId) {
    if (!keys) return;
    const st = keys.load();
    if (st?.scopes?.[`design:${designId}`]) keys.save(resetKeys(st, { scope: `design:${designId}` }).store);
  }

  // ---- The editor: the side panel ----
  const dirty = () => isNew || JSON.stringify(cur) !== savedJson;
  const selPart = () => (sel && cur ? cur.parts.find((p) => p.id === sel) || null : null);
  const slider = (attr, k, label, min, max, step, value, out) =>
    `<label class="fsw-part"><span class="lab">${esc(label)}</span><input type="range" ${attr}="${k}" min="${min}" max="${max}" step="${step}" value="${value}"><output data-out="${k}">${esc(out)}</output></label>`;
  const segBtns = (attr, items, on) => `<div class="fsui-seg fsw-seg" ${attr}>${items.map(([v, t, off]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(on) ? 'on' : ''}"${off ? ' disabled' : ''}>${esc(t)}</button>`).join('')}</div>`;

  // The part's settings: its outputs, by key.
  function partOuts(p) {
    const T = TYPES[cur.base], E = ENGINE_TYPES[p.engine];
    const o = {};
    if (p.kind === 'engine' || p.kind === 'tank') {
      o.s = `${(p.s ?? 0).toFixed(2)} m`;
      o.dx = p.dx ? `${Math.abs(p.dx).toFixed(2)} m ${p.dx > 0 ? 'forward' : 'aft'}` : 'as mounted';
    }
    o.xn = `${(T.geo.NOSE_X - (p.x ?? 0)).toFixed(1)} m`;
    if (p.kind === 'engine') {
      o.dz = p.dz ? `${Math.abs(p.dz).toFixed(2)} m ${p.dz > 0 ? 'up' : 'down'}` : 'as mounted';
      o.yaw = p.yaw ? (p.side === 0 ? `${Math.abs(p.yaw).toFixed(1)}° ${p.yaw > 0 ? 'right' : 'left'}` : `${Math.abs(p.yaw).toFixed(1)}° ${p.yaw > 0 ? 'in' : 'out'}`) : 'straight';
      o.pitch = p.pitch ? `${Math.abs(p.pitch).toFixed(1)}° ${p.pitch > 0 ? 'up' : 'down'}` : 'level';
      o.thrust = `×${p.thrust.toFixed(2)} · ${Math.round((E.data.T0_ENGINE * p.thrust) / 1000)} kN`;
    }
    if (p.kind !== 'engine') o.kg = kg(p.kg);
    return o;
  }
  function partHtml(p) {
    if (keysOnly) {
      return `<div class="fsw-sel" data-o="sel"><h3>${esc(partLabel(p))}${p.pair ? ' <small>and its mirror twin</small>' : ''}</h3>
        <p class="fsw-base">${esc(partWhere(p, cur.base, cur.airframe))}</p>${keysHtml({ part: p.id })}
        <div class="fsw-btns"><button type="button" class="fsui-b" data-a="done">Done</button></div></div>`;
    }
    const T = TYPES[cur.base], R = mountRange(cur.base, p, cur.airframe), o = partOuts(p);
    const tailTaken = cur.parts.some((q) => q.kind === 'engine' && q.mount === 'tail' && q.id !== p.id);
    let h = `<div class="fsw-sel" data-o="sel">
      <h3>${esc(partLabel(p))}${p.pair ? ' <small>and its mirror twin</small>' : ''}</h3>
      <p class="fsw-base">${esc(partWhere(p, cur.base, cur.airframe))}</p>`;
    if (p.kind === 'engine') {
      h += `<div class="fsw-row"><span class="lab">Mount</span>${segBtns('data-seg="mount"', [['wing', 'Under the wing'], ['overwing', 'Over the wing'], ['body', 'Rear fuselage'], ['tail', 'Tail', tailTaken]], p.mount)}</div>
        <div class="fsw-row"><span class="lab">Engine</span>${segBtns('data-seg="engine"', ENGINE_LIST.map((e) => [e.id, e.short]), p.engine)}</div>`;
    } else if (p.kind === 'tank') {
      h += `<div class="fsw-row"><span class="lab">Where</span>${segBtns('data-seg="mount"', [['wing', 'Under the wing'], ['hold', 'In the hold']], p.mount)}</div>`;
    }
    if (p.side !== 0 || p.pair) h += `<label class="fsw-check"><input type="checkbox" data-q="mirror"${p.pair ? ' checked' : ''}> Mirrored on the other side</label>`;
    if (R.key === 's') h += slider('data-q', 's', 'Out from the centreline', R.lo.toFixed(2), R.hi.toFixed(2), 0.05, p.s, o.s);
    if (R.key === 'x') h += slider('data-q', 'xn', 'Back from the nose', (T.geo.NOSE_X - R.hi).toFixed(2), (T.geo.NOSE_X - R.lo).toFixed(2), 0.05, (T.geo.NOSE_X - p.x).toFixed(2), o.xn);
    if (p.kind === 'engine' || (p.kind === 'tank' && p.mount === 'wing')) h += slider('data-q', 'dx', 'Forward or aft', RANGES.dx[0], RANGES.dx[1], 0.05, p.dx, o.dx);
    if (p.kind === 'engine') {
      h += slider('data-q', 'dz', 'Up or down', RANGES.dz[0], RANGES.dz[1], 0.05, p.dz, o.dz)
        + slider('data-q', 'yaw', p.side === 0 ? 'Turned' : 'Toe in or out', RANGES.yaw[0], RANGES.yaw[1], 0.5, p.yaw, o.yaw)
        + slider('data-q', 'pitch', 'Pitched', RANGES.pitch[0], RANGES.pitch[1], 0.5, p.pitch, o.pitch)
        + slider('data-q', 'thrust', 'Thrust', RANGES.thrustScale[0], RANGES.thrustScale[1], 0.05, p.thrust, o.thrust);
    } else {
      const K = p.kind === 'ballast' ? RANGES.ballastKg : p.mount === 'hold' ? RANGES.holdKg : RANGES.tankKg;
      h += slider('data-q', 'kg', p.kind === 'ballast' ? 'Mass' : 'Fuel', K[0], K[1], p.kind === 'ballast' ? 50 : 100, p.kg, o.kg);
    }
    h += keysHtml({ part: p.id });
    h += `<div class="fsw-btns"><button type="button" class="fsui-b danger" data-a="remove">Remove${p.pair ? ' both' : ''}</button><button type="button" class="fsui-b" data-a="done">Done</button></div></div>`;
    return h;
  }
  // The aircraft: its name and registration, its parts (a click selects one), its weight, fuel and gear.
  function aircraftHtml() {
    const d = cur, T = TYPES[d.base], A = T.data;
    if (keysOnly) {
      return `<div class="fsw-sel" data-o="sel"><h3>The ${esc(T.name)}’s keys</h3>
        <p class="fsw-base">Click a part to set its keys: an engine (its thrust), the wing (the ailerons, flaps and spoilers), the tailplane (the elevator${T.family === 'boeing' ? ' and trim' : ''}), the fin (the rudder) or the fuselage (the gear and brakes). A design on the ${esc(T.name)} flies these until one is changed for it. The views, time and autopilot keys are on the Controls page.</p>
        ${keysOwnHtml()}</div>`;
    }
    const shown = d.parts.filter((p, i) => !p.pair || d.parts.findIndex((q) => q.id === p.pair) > i);
    const name = (p) => (!p.pair ? partLabel(p) : p.kind === 'engine' ? `${ENGINE_TYPES[p.engine]?.short ?? p.engine} · ${WHERE[p.mount]}` : 'Wing tanks');
    const list = shown.length ? shown.map((p) => `<button type="button" class="fsw-prow" data-sel="${esc(p.id)}"><span>${esc(name(p))}${p.pair ? ' <b>× 2</b>' : ''}</span><small>${esc(partWhere(p, d.base, d.airframe))}</small></button>`).join('')
      : '<p class="fsw-base">No parts: pick one from the palette over the view, then click on the aircraft where it goes.</p>';
    return `
      <div class="fsw-two">
        <label class="fsw-field"><span>Name</span><input type="text" class="fsw-text" data-p="name" maxlength="${NAME_MAX + 10}" value="${esc(d.name)}" spellcheck="false" autocomplete="off"></label>
        <label class="fsw-field fsw-reg"><span>Registration</span><input type="text" class="fsw-text" data-p="registration" maxlength="8" value="${esc(d.registration)}" spellcheck="false" autocomplete="off"></label>
      </div>
      <p class="fsw-base">On the ${esc(T.maker)} ${esc(T.name)}: its wing, fuselage, tail and limits. Each pylon holds 1.5 × its engine’s rated thrust.</p>
      <h3 class="fsw-h">Parts <small>${engineParts(d).length} of ${MAX_ENGINES} engines · ${d.parts.length} of ${MAX_PARTS} parts</small></h3>
      <div class="fsw-plist">${list}</div>
      <h3 class="fsw-h">Weight, fuel and gear</h3>
      ${slider('data-p', 'oewFrac', 'Structure’s weight', RANGES.oewFrac[0], RANGES.oewFrac[1], 0.005, (d.oewDeltaKg / A.OEW).toFixed(3), oewOut(d, A))}
      ${slider('data-p', 'fuelFrac', 'Wing and centre tanks', RANGES.fuelFrac[0], RANGES.fuelFrac[1], 0.01, (d.fuelCapacityKg / A.FUEL_MAX).toFixed(3), fuelOut(d, A))}
      ${slider('data-p', 'gearExtendM', 'Gear extension', RANGES.gearExtendM[0], RANGES.gearExtendM[1], 0.05, d.gearExtendM, `+${d.gearExtendM.toFixed(2)} m`)}
      ${keys ? `<h3 class="fsw-h">Keys</h3><p class="fsw-base">Click a part to set its keys: an engine, a wing tank, the wing, the tailplane, the fin or the fuselage.</p>${keysOwnHtml()}` : ''}`;
  }
  // v0.5.6: whose keys these are, and the way back to the defaults (a type's) or the base type's (a design's).
  function keysOwnHtml() {
    if (!keys) return '';
    const T = TYPES[cur.base], sc = keyScope(), own = !!keys.load()?.scopes?.[sc.scope];
    const text = keysOnly ? (own ? 'Changed from the defaults.' : 'The default keys.')
      : own ? 'This design has keys of its own.' : `It flies the ${T.name}’s keys until one is changed here.`;
    return `<p class="fsw-base fsw-kown">${esc(text)}${own ? ` <button type="button" class="fsui-b fsw-kb" data-a="keysReset">${keysOnly ? 'Back to the defaults' : `Back to the ${esc(T.name)}’s`}</button>` : ''}</p>
      <p class="fsw-kmsg${keyMsgBad ? ' bad' : ''}" data-o="kmsg" aria-live="polite">${esc(keyMsg)}</p>`;
  }
  const oewOut = (d, A) => `${pct(d.oewDeltaKg / A.OEW, 1)} (${d.oewDeltaKg >= 0 ? '+' : '−'}${Math.abs(d.oewDeltaKg).toLocaleString('en-US')} kg)`;
  const fuelOut = (d, A) => `${Math.round((d.fuelCapacityKg / A.FUEL_MAX) * 100)} % · ${kg(d.fuelCapacityKg)}`;
  const partsHtml = () => { const p = selPart(); return p ? partHtml(p) : selAf ? afHtml() : aircraftHtml(); };

  // v0.5.3: the selected piece of the airframe: its sliders, Mirror for the wing, back to the base's, Done.
  const AF_LABEL = { span: 'Span', chord: 'Chord', sweep: 'Sweep', dihedral: 'Dihedral', tail: 'Area', fin: 'Area', plugFwd: 'Plug ahead of the wing', plugAft: 'Plug behind the wing', wingX: 'Position' };
  const afSide = () => (selAf?.side < 0 ? 'wingR' : 'wingL');
  function afValue(k) { const af = cur.airframe; return AF_WING_KEYS.includes(k) ? af[afSide()][k] : k === 'wingX' ? af.wingX || 0 : af[k]; }
  function afOuts() {
    const af = cur.airframe, w = af[afSide()], S = shapeOf(cur.base, null), d0 = defaultAirframe(cur.base).wingL;
    const semi = (st) => st[st.length - 1].y;
    const b0 = semi(S.wingL.stations), ys = S.wingL.stations[0].y;
    const o = {};
    // the tip to tip span with this side's shape on both, the sharklets included when they're on (airframe-map.js)
    const spanBoth = airframeMap(cur.base, { ...af, wingL: w, wingR: w }).span;
    o.span = `×${w.span.toFixed(2)} · ${spanBoth.toFixed(1)} m${af.mirror ? '' : ' if both'}`;
    o.chord = `×${w.chord.toFixed(2)} · root ${(S.wingL.stations[0].c * w.chord).toFixed(1)} m`;
    o.sweep = w.sweep ? `${Math.abs(w.sweep).toFixed(1)}° ${w.sweep > 0 ? 'more' : 'less'}` : 'the base’s';
    o.dihedral = `${w.dihedral.toFixed(1)}°${w.dihedral === d0.dihedral ? ' (the base’s)' : ''}`;
    const area = (st) => st.slice(1).reduce((a, p, i) => a + ((p.c + st[i].c) / 2) * Math.abs(p.y - st[i].y), 0);
    const finArea = (st) => st.slice(1).reduce((a, p, i) => a + ((p.c + st[i].c) / 2) * Math.abs(p.z - st[i].z), 0);
    o.tail = `×${af.tail.toFixed(2)} · ${(2 * area(S.tail.stations) * af.tail).toFixed(1)} m²`;
    o.fin = `×${af.fin.toFixed(2)} · ${(finArea(S.fin.stations) * af.fin).toFixed(1)} m²`;
    const plug = (v) => (v ? `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} m` : 'none');
    o.plugFwd = plug(af.plugFwd); o.plugAft = plug(af.plugAft);
    // v0.5.6: the wing's place on the fuselage (its engines, tanks and main gear with it)
    o.wingX = af.wingX ? `${Math.abs(af.wingX).toFixed(1)} m ${af.wingX > 0 ? 'aft' : 'forward'}` : 'the base’s';
    return o;
  }
  function afHtml() {
    const af = cur.airframe, what = selAf.what, o = afOuts(), R = AIRFRAME_RANGES;
    const sideName = selAf.side > 0 ? 'left' : 'right';
    const title = what === 'wing' ? (af.mirror ? 'Wing · both sides' : `Wing · ${sideName} side`) : afNames[what];
    const note = { wing: 'The span from the fuselage’s side, the chord at every station, the sweep added to the quarter chord’s, the dihedral; and where the whole wing sits along the fuselage, with its engines, tanks and main gear (both sides).',
      tailplane: 'Its area, with its aspect ratio and sweep kept.', fin: 'Its area, with its aspect ratio and sweep kept.',
      body: 'Fuselage added ahead of and behind the wing (negative takes it out): the nose moves forward, the tail back.' }[what];
    if (keysOnly) {
      return `<div class="fsw-sel" data-o="sel" data-af-sel="${esc(what)}"><h3>${esc(what === 'wing' ? 'Wing' : afNames[what])}</h3>${keysHtml({ af: what })}
        <div class="fsw-btns"><button type="button" class="fsui-b" data-a="done">Done</button></div></div>`;
    }
    let h = `<div class="fsw-sel" data-o="sel" data-af-sel="${esc(what)}">
      <h3>${esc(title)}</h3><p class="fsw-base">${esc(note)}</p>`;
    if (what === 'wing') h += `<label class="fsw-check"><input type="checkbox" data-afm="mirror"${af.mirror ? ' checked' : ''}> Mirror: both sides the same</label>`;
    if (what === 'wing' && 'sharklets' in af) h += `<label class="fsw-check" title="Off: 1.8 m less span, about 8 % more induced drag, 400 kg lighter"><input type="checkbox" data-afm="sharklets"${af.sharklets ? ' checked' : ''}> Sharklets</label>`;
    for (const k of AF_KEYS[what]) {
      const r = k === 'dihedral' ? R.dihedral : R[k];
      h += slider('data-af', k, AF_LABEL[k], r[0], r[1], AF_STEP[k], afValue(k), o[k]);
    }
    h += keysHtml({ af: what });
    h += `<div class="fsw-btns"><button type="button" class="fsui-b" data-a="afreset">As the base</button><button type="button" class="fsui-b" data-a="done">Done</button></div></div>`;
    return h;
  }

  // ---- v0.5.6: the keys tab ----
  const keyScope = () => keyScopeOf(cur, keysOnly);
  function keysHtml(what) {
    if (!keys || !cur) return '';
    const tab = keyTab(cur, designDef(cur), keys.load(), keyScope(), what, { twinOn: keysOnly ? stockTwin : true });
    if (!tab.rows.length) return tab.note ? `<div class="fsw-keys" data-o="keys"><h4>Keys</h4><p class="fsw-base">${esc(tab.note)}</p></div>` : '';
    const cap = (c) => {
      const on = capKey?.cap === c.cap;
      const title = on ? 'Press a key: Esc cancels, Backspace or Delete clears it' : c.add ? 'Add another key' : c.empty ? 'No key: click, then press one' : c.follow ? 'The all-engines key: click, then press one of its own' : 'Click, then press the new key';
      return `<button type="button" class="fsw-cap${c.empty ? ' empty' : ''}${c.add ? ' add' : ''}${c.follow ? ' follow' : ''}${on ? ' on' : ''}" data-cap="${esc(c.cap)}" title="${esc(title)}">${on ? 'Press a key' : esc(c.text || '·')}</button>`;
    };
    let h = '<div class="fsw-keys" data-o="keys"><h4>Keys</h4>';
    for (const r of tab.rows) {
      const kr = r.eng ? 'eng' : r.all ? 'all' : r.id;
      h += `<div class="fsw-krow${r.eng ? ' eng' : ''}" data-krow="${esc(kr)}"><span class="lab">${esc(r.label)}</span><span class="fsw-caps">`;
      if (r.eng) h += `<small>up</small>${cap(r.caps[0])}<small>down</small>${cap(r.caps[1])}`;
      else if (r.all) h += `<small>up</small>${r.up.map(cap).join('')}<small>down</small>${r.down.map(cap).join('')}`;
      else h += r.caps.map(cap).join('');
      h += '</span>';
      if (r.eng && r.own) h += '<button type="button" class="fsui-b fsw-kb" data-a="asOthers" title="Back on the all-engines keys">As the others</button>';
      h += '</div>';
    }
    if (tab.engine && keysOnly && tab.engine.twin !== null) h += `<label class="fsw-check"><input type="checkbox" data-k="twin"${stockTwin ? ' checked' : ''}> Mirror: engine ${tab.engine.twin + 1} takes the same keys</label>`;
    h += `<p class="fsw-kmsg${keyMsgBad ? ' bad' : ''}" data-o="kmsg" aria-live="polite">${esc(keyMsg)}</p></div>`;
    return h;
  }
  // The engines a key on the selected engine changes (it, and its twin with Mirror on).
  function keyEngines() {
    const p = selPart();
    if (!p || p.kind !== 'engine') return [];
    const def = designDef(cur), i = engineIndex(def, p.id), t = twinIndex(cur, def, p.id);
    return t !== null && (!keysOnly || stockTwin) ? [i, t] : [i];
  }
  function setKeyMsg(text, bad = false) {
    keyMsg = text || ''; keyMsgBad = !!bad;
    const m = $('parts').querySelector('[data-o="kmsg"]');
    if (m) { m.textContent = keyMsg; m.classList.toggle('bad', keyMsgBad); }
  }
  function redrawPanel() {
    $('parts').innerHTML = partsHtml();
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }
  function saveKeysNow(next, text) {
    const ok = keys.save(next) !== false;
    keyMsg = ok ? text || '' : 'Couldn’t save the keys: the browser’s storage is off or full'; keyMsgBad = !ok;
    redrawPanel();
  }
  function startCap(capId) {
    const [k, v] = capId.split(':');
    capKey = k === 'eng' ? { cap: capId, eng: v === 'up' ? 1 : -1 } : { cap: capId, id: k, i: Number(v) || 0 };
    const what = capKey.eng ? `thrust ${capKey.eng > 0 ? 'up' : 'down'} on ${keyEngines().map((i) => `engine ${i + 1}`).join(' and ')}` : `“${keyLabelOf(bindingOf(capKey.id), designDef(cur))}”`;
    keyMsg = `Press the key for ${what}: Esc cancels, Backspace or Delete clears it.`; keyMsgBad = false;
    document.addEventListener('keydown', onKeyCap, true);
    document.addEventListener('keyup', swallowKeyUp, true);
    redrawPanel();
  }
  function stopCap() {
    capKey = null;
    document.removeEventListener('keydown', onKeyCap, true);
    document.removeEventListener('keyup', swallowKeyUp, true);
  }
  const swallowKeyUp = (e) => { if (capKey) { e.stopPropagation(); e.stopImmediatePropagation(); } };
  // A keycap waiting: the next key sets it (Shift with a tap), Esc cancels, Backspace or Delete clears it; a key a part
  // of this aircraft has moves here (that one says so), a global one is refused.
  function onKeyCap(e) {
    if (!capKey || el.hidden || !cur) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.repeat || isModifier(e.code)) return;
    const c = capKey, st = keys.load(), sc = keyScope();
    if (e.code === 'Escape') { stopCap(); keyMsg = ''; redrawPanel(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') {
      stopCap();
      if (c.eng) {
        const E = keyEngines();
        if (!engineKeys(st, sc, E[0]).own) { keyMsg = 'It moves with the all-engines keys: press a key on it to give it its own.'; keyMsgBad = false; redrawPanel(); return; }
        saveKeysNow(bindEngineKey(st, sc, E, c.eng, null).store, 'Cleared: it has no key there now.');
      } else saveKeysNow(clearKeys(st, sc, c.id, { index: c.i }).store, 'Cleared.');
      return;
    }
    const kind = c.eng ? 'held' : bindingOf(c.id)?.kind || 'action';
    const r = chordFor(e, kind);
    if (r.refused) { setKeyMsg(`${r.refused}. Press another key, or Esc.`, true); return; }
    const out = c.eng ? bindEngineKey(st, sc, keyEngines(), c.eng, r.chord) : bindKey(st, sc, c.id, r.chord, { index: c.i, nameOf: keys.nameOf });
    if (out.error) { setKeyMsg(`${out.error}. Press another key, or Esc.`, true); return; }
    stopCap();
    saveKeysNow(out.store, movedText(out.moved, r.chord) || `${keyLabel(r.chord)} set.`);
  }
  // A type's engine selected: its Mirror shows whether its twin has the same keys.
  function syncStockTwin() {
    const p = selPart();
    if (!keysOnly || !keys || p?.kind !== 'engine') return;
    const def = designDef(cur), i = engineIndex(def, p.id), t = twinIndex(cur, def, p.id);
    if (t === null) return;
    const st = keys.load(), sc = keyScope(), a = engineKeys(st, sc, i), b = engineKeys(st, sc, t);
    stockTwin = a.own ? a.engines.includes(t) : !b.own;
  }

  function numsHtml(r) {
    const rows = r.rows.map((x) => `<div class="fsw-num ${x.level}" data-n="${x.k}"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('');
    const eng = r.engines.map((e) => `<tr data-e="${e.i}" data-id="${esc(e.part || '')}"><td>${e.i + 1} · ${esc(e.label)}</td>
        <td class="${e.restLvl}">${e.tail ? '—' : m2(e.clearRestM)}</td><td class="${e.tsLvl}">${e.tail ? '—' : m2(e.clearTailStrikeM)}</td>
        <td class="${e.pyLvl}">${Math.round(e.loadN / 1000)} / ${Math.round(e.limitN / 1000)} kN · ${Math.round(e.pylonFrac * 100)} %</td></tr>`).join('');
    const pods = r.pods.map((t) => `<tr data-id="${esc(t.part || '')}"><td>${esc(t.label)}</td><td class="${t.restLvl}">${m2(t.clearRestM)}</td><td class="${t.tsLvl}">${m2(t.clearTailStrikeM)}</td><td>—</td></tr>`).join('');
    return `${rows}
      <table class="fsw-eng"><thead><tr><th>Engine</th><th>Clearance standing</th><th>At tail strike</th><th>Pylon at full thrust</th></tr></thead><tbody>${eng}${pods}</tbody></table>`;
  }
  function issuesHtml(r) {
    if (!r.issues.length) return '<p class="fsw-issue ok">Every check passes.</p>';
    return r.issues.map((i) => `<p class="fsw-issue ${i.level}">${esc(i.text)}</p>`).join('');
  }

  function renderNumbers() {
    const r = readout(cur);
    last = r;
    // v0.5.3: the warnings above the panel stay as they were while a slider moves (one appearing mid-drag pushed the
    // slider out from under the pointer: a 777's span crossing into code F at ×1.02); they catch up on release
    if (!sliding) $('issues').innerHTML = issuesHtml(r);
    $('nums').innerHTML = numsHtml(r);
    $('crumb').textContent = keysOnly ? `Keys · the ${TYPES[cur.base].name}` : `${cur.name}${dirty() ? ' · not saved' : ''}`;
    el.dataset.worst = r.worst;
    act('save').disabled = !r.canSave;
    act('fly').disabled = !r.canFly;
    act('save').title = r.canSave ? '' : 'It needs an engine first';
    // v0.5.3: a part on the ground standing would end the flight as it starts: saved, but not flown
    act('fly').title = !r.canSave ? 'It needs an engine first' : !r.canFly ? 'An engine or tank touches the ground standing: lengthen the gear or move it up' : 'Save it and set up a flight in it';
    return r;
  }
  // The outputs beside the sliders, and the sliders the normalization moved (not the one being dragged).
  function syncParts(active) {
    const set = (k, attr, v, out) => {
      const inp = el.querySelector(`[data-o="parts"] [${attr}="${k}"]`);
      if (inp && inp !== active && v !== undefined) inp.value = v;
      const o = el.querySelector(`[data-o="parts"] [data-out="${k}"]`);
      if (o && out !== undefined) o.textContent = out;
    };
    if (selAf) {
      const o = afOuts();
      for (const k of AF_KEYS[selAf.what]) set(k, 'data-af', afValue(k), o[k]);
      return;
    }
    const p = selPart();
    if (p) {
      const o = partOuts(p), T = TYPES[cur.base];
      for (const k of ['s', 'dx', 'dz', 'yaw', 'pitch', 'thrust', 'kg']) set(k, 'data-q', p[k], o[k]);
      set('xn', 'data-q', (T.geo.NOSE_X - p.x).toFixed(2), o.xn);
      return;
    }
    const d = cur, A = TYPES[d.base].data;
    set('oewFrac', 'data-p', (d.oewDeltaKg / A.OEW).toFixed(3), oewOut(d, A));
    set('fuelFrac', 'data-p', (d.fuelCapacityKg / A.FUEL_MAX).toFixed(3), fuelOut(d, A));
    set('gearExtendM', 'data-p', d.gearExtendM, `+${d.gearExtendM.toFixed(2)} m`);
  }
  // After any change: the panel (whole, or its outputs while a slider moves), the numbers, the model, the overlay.
  function changed(full, active) {
    if (sel && !selPart()) sel = null;
    // v0.5.3: a control in the panel that had the keys (a slider just undone, the Mirror box) goes with the re-render:
    // the keys stay in the warehouse (Z, Shift+Z, Esc), not the page under it.
    const hadKeys = full && $('parts').contains(document.activeElement);
    if (full) $('parts').innerHTML = partsHtml(); else syncParts(active);
    if (hadKeys && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    renderNumbers();
    setMsg('', '');
    help();   // v0.5.4: the keys line follows the part (a new mount takes other keys)
    // v0.5.3: while an airframe slider moves, the ghost outline shows the shape; the model follows on release, or live
    // when its rebuild is quick enough to keep 30 frames a second.
    if (!afDrag || (view && view.buildMs <= LIVE_BUILD_MS)) view?.setDesign(cur);
    tools();
    drawOverlay();
  }
  // A change worth undoing: the design before it goes on the stack.
  function commit(next, full = true) {
    if (!next || JSON.stringify(next) === JSON.stringify(cur)) return false;
    hist.push(cur);
    cur = next;
    changed(full);
    return true;
  }
  // v0.5.4: a key press on the selected part is one undo step; a held key's repeats (the same key, the same part) share it.
  let nudging = null;
  function nudgeSel(key, shift, repeat) {
    const next = nudgePart(cur, sel, key, shift), run = `${sel}|${key.toLowerCase()}|${shift}`;
    if (repeat && nudging === run) {
      if (JSON.stringify(next) !== JSON.stringify(cur)) { cur = next; changed(true); }
      return;
    }
    nudging = commit(next) ? run : null;
  }
  function undo() { step(hist.undo(cur)); }
  function redo() { step(hist.redo(cur)); }
  // The name and registration aren't steps: they stay as typed.
  function step(d) {
    if (!d) return;
    cur = normalizeDesign({ ...d, name: cur.name, registration: cur.registration });
    ghost = null; dragPart = null; afDrag = false;
    changed(true);
  }

  $('parts').addEventListener('input', (e) => {
    const t = e.target, p = t.dataset.p, q = t.dataset.q;
    if (p === 'name' || p === 'registration') {
      // Typed as it goes; the normalized value (registration upper-cased, A–Z 0–9 -) is what's saved.
      // An emptied field keeps the last value until something is typed (Save checks the name's length).
      const v = p === 'name' ? cleanName(t.value) : t.value;
      if (v) cur = normalizeDesign({ ...cur, [p]: v });
      renderNumbers();
      view?.setDesign(cur);
      return;
    }
    if (t.type !== 'range') return;
    const k = t.dataset.af;
    if (!sliding) { hist.push(cur); sliding = true; }
    if (p) cur = editDesign(cur, p, t.value);
    else if (q && sel) cur = editPart(cur, sel, q, t.value);
    else if (k && selAf) { cur = editAirframe(cur, k, t.value, selAf.side); afDrag = true; }
    else return;
    changed(false, t);
  });
  $('parts').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.k === 'twin' && keys && keysOnly) {
      stockTwin = t.checked;
      const p = selPart(), def = designDef(cur), i = p ? engineIndex(def, p.id) : -1, tw = p ? twinIndex(cur, def, p.id) : null;
      if (i >= 0 && tw !== null && engineKeys(keys.load(), keyScope(), i).own) saveKeysNow(setEngineTwin(keys.load(), keyScope(), i, tw, stockTwin).store, stockTwin ? `Engine ${tw + 1} takes the same keys.` : `Engine ${tw + 1} is back on the all-engines keys.`);
      else redrawPanel();
      return;
    }
    if (t.type === 'range') {
      sliding = false; syncParts(null); renderNumbers(); tools();
      if (afDrag) { afDrag = false; view?.setDesign(cur, true); drawOverlay(); }
      return;
    }
    if (t.dataset.afm === 'mirror' && selAf) { commit(editAirframe(cur, 'mirror', t.checked, selAf.side)); return; }
    if (t.dataset.afm === 'sharklets' && selAf) { commit(editAirframe(cur, 'sharklets', t.checked)); return; }
    if (t.dataset.q === 'mirror' && sel) {
      const want = t.checked;
      if (!commit(editPart(cur, sel, 'mirror', want))) { t.checked = !want; if (want) setMsg(`No room for a twin: ${MAX_ENGINES} engines and ${MAX_PARTS} parts at most.`, 'bad'); }
    }
  });
  $('parts').addEventListener('click', (e) => {
    const row = e.target.closest('[data-sel]');
    if (row) { select(row.dataset.sel); return; }
    // v0.5.6: a keycap (again: cancels), As the others, back to the defaults
    const capB = e.target.closest('[data-cap]');
    if (capB && keys) { if (capKey?.cap === capB.dataset.cap) { stopCap(); keyMsg = ''; redrawPanel(); } else { stopCap(); startCap(capB.dataset.cap); } return; }
    const ka = e.target.closest('[data-a]')?.dataset.a;
    if (keys && ka === 'asOthers') { stopCap(); saveKeysNow(engineAsOthers(keys.load(), keyScope(), keyEngines()).store, 'Back on the all-engines keys.'); return; }
    if (keys && ka === 'keysReset') { stopCap(); saveKeysNow(resetKeys(keys.load(), { scope: keyScope().scope }).store, keysOnly ? 'Back to the default keys.' : `Back to the ${TYPES[cur.base].name}’s keys.`); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'remove') { removeSel(); return; }
    if (a === 'done') { select(null); return; }
    if (a === 'afreset' && selAf) { commit(editAirframe(cur, 'reset', selAf.what, selAf.side)); return; }
    const b = e.target.closest('[data-seg] button');
    if (!b || !sel) return;
    const k = b.closest('[data-seg]').dataset.seg;
    let next = editPart(cur, sel, k, b.dataset.v);
    // An engine leaving the tail for the wing or body gets its twin while Mirror is on.
    if (k === 'mount' && mirrorOn && selPart()?.side === 0 && next.parts.find((q) => q.id === sel)?.side !== 0) next = setMirror(next, sel, true);
    commit(next);
  });

  function select(id) {
    sel = id && cur.parts.some((p) => p.id === id) ? id : null;
    if (sel || !id) { selAf = null; afDrag = false; }
    stopCap(); keyMsg = ''; keyMsgBad = false; syncStockTwin();   // v0.5.6
    $('parts').innerHTML = partsHtml();
    help();
    drawOverlay();
  }
  // v0.5.3: a piece of the airframe selected (what: wing, tailplane, fin, body; side: the wing's clicked side).
  function selectAf(what, side = 1) {
    if (!afOn || !AF_KEYS[what]) { select(null); return; }
    sel = null; selAf = { what, side: side < 0 ? -1 : 1 }; afDrag = false;
    stopCap(); keyMsg = ''; keyMsgBad = false;   // v0.5.6
    $('parts').innerHTML = partsHtml();
    help();
    drawOverlay();
  }
  function removeSel() {
    if (!sel) return;
    const p = selPart();
    if (commit(editPart(cur, sel, 'remove'))) setMsg(`${p ? partLabel(p) : 'The part'}${p?.pair ? ' and its twin' : ''} removed. Z puts it back.`, '');
  }

  // ---- The editor: the palette and the tools ----
  function tools() {
    act('undo').disabled = !hist.canUndo;
    act('redo').disabled = !hist.canRedo;
    act('markers').setAttribute('aria-pressed', String(markersOn));
    $('legend').hidden = !markersOn;
    for (const b of el.querySelectorAll('[data-place]')) b.classList.toggle('on', b.dataset.place === toolKey);
    for (const b of $('hang').querySelectorAll('button')) b.classList.toggle('on', (b.dataset.hang === 'over') === hangOver);
    $('mirror').checked = mirrorOn;
    if (cur) {
      const ne = engineParts(cur).length, np = cur.parts.length;
      for (const b of el.querySelectorAll('[data-place]')) b.disabled = np >= MAX_PARTS || (b.dataset.place.startsWith('engine:') && ne >= MAX_ENGINES);
      $('room').textContent = np >= MAX_PARTS ? `${MAX_PARTS} parts at most.` : ne >= MAX_ENGINES ? `${MAX_ENGINES} engines at most.` : '';
    }
    help();
  }
  // v0.5.4: a selected part's line ends with the keys it takes (nudgeHelp()). v0.5.6: so does the part in hand's.
  function help() {
    const keys = tool ? nudgeHelp(handPart()) : sel ? nudgeHelp(selPart()) : '';
    const t = keysOnly ? (sel || selAf ? HELP.keySel : HELP.keys)
      : tool ? (keys ? `${HELP.place} · ${keys}` : HELP.place) : sel ? (keys ? `${HELP.sel} · ${keys}` : HELP.sel) : selAf ? HELP.af : afOn ? HELP.idleAf : HELP.idle;
    if ($('viewHelp').textContent !== t) $('viewHelp').textContent = t;
  }
  // v0.5.6: the part in hand as it would go (the ghost's), or as the palette gives it with the pointer off the aircraft:
  // what decides which keys it takes.
  function handPart() {
    if (!tool) return null;
    if (handCand) return handCand;
    return { kind: tool.kind, engine: tool.engine, side: 1, mount: tool.kind === 'engine' ? (hangOver ? 'overwing' : 'wing') : tool.mount };
  }
  function pickTool(key) {
    if (!key || key === toolKey) { tool = null; toolKey = null; }
    else { const e = PALETTE.find((p) => p.key === key); tool = e ? e.what : null; toolKey = e ? key : null; }
    ghost = null; tip(null);
    hand = { ...HAND0 }; handCand = null;   // v0.5.6: a new part in hand starts where the pointer puts it
    view?.setCursor(tool ? 'place' : null);
    tools();
    drawOverlay();
  }
  // v0.5.6: a key on the part in hand: its offsets change, and the ghost (and the tip) show it at once.
  function nudgeInHand(key, shift) {
    const next = nudgeHand(hand, handPart(), key, shift, cur.base, cur.airframe);
    if (next === hand) return;
    hand = next;
    if (handAt && view) showGhost(ghostFor(handAt.r, null), handAt.e);
    help();
  }
  // v0.5.6: the ghost attached (a click, or a drag from the palette let go over the aircraft). `keep`: Shift, the part
  // stays in hand with its offsets. → whether it went on.
  function attachGhost(g, keep) {
    if (!g) return false;
    if (!g.ok || !g.next) { setMsg(`Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`, 'bad'); return false; }
    const had = new Set(cur.parts.map((q) => q.id));
    if (!commit(g.next)) return false;
    const added = cur.parts.find((q) => !had.has(q.id));
    if (!keep) { tool = null; toolKey = null; hand = { ...HAND0 }; handCand = null; view?.setCursor(null); tip(null); }
    ghost = null;
    if (added) select(added.id);
    tools();
    if (added) setMsg(`${partLabel(added)}${added.pair ? ' and its twin' : ''} attached.`, 'ok');
    return true;
  }
  // v0.5.6: drag a part from the palette onto the aircraft (paletteDrop()): past PAL_DRAG_PX the press picks the part up
  // and its ghost follows the pointer over the view; the release attaches it there (one undo step), or puts it back off
  // the aircraft or where it doesn't fit. A press that doesn't move stays a click (the palette's click picks it up).
  $('palette').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-place]');
    if (!b || b.disabled || e.button !== 0 || !e.isPrimary || !cur || page !== 'editor') return;
    palDrag = { key: b.dataset.place, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    window.addEventListener('pointermove', onPalMove, true);
    window.addEventListener('pointerup', onPalUp, true);
    window.addEventListener('pointercancel', onPalUp, true);
  });
  function endPalDrag() {
    palDrag = null;
    window.removeEventListener('pointermove', onPalMove, true);
    window.removeEventListener('pointerup', onPalUp, true);
    window.removeEventListener('pointercancel', onPalUp, true);
  }
  function onPalMove(e) {
    if (!palDrag || e.pointerId !== palDrag.id || !cur) return;
    if (!palDrag.moved) {
      if (Math.hypot(e.clientX - palDrag.x0, e.clientY - palDrag.y0) < PAL_DRAG_PX) return;
      palDrag.moved = true;
      if (toolKey !== palDrag.key) pickTool(palDrag.key);
    }
    if (view?.overCanvas(e.clientX, e.clientY)) { const r = view.ray(e); handAt = { r, e }; showGhost(ghostFor(r, null), e); }
    else { handAt = null; tip(null); if (ghost) { ghost = null; drawOverlay(); } }
  }
  function onPalUp(e) {
    if (!palDrag || e.pointerId !== palDrag.id) return;
    const d = palDrag;
    endPalDrag();
    if (!d.moved || !cur) return;   // a click: the palette's own handler
    palDragEnd = performance.now();
    const over = e.type === 'pointerup' && !!view?.overCanvas(e.clientX, e.clientY);
    const g = over ? ghostFor(view.ray(e), null) : null;
    const what = paletteDrop({ moved: true, over, ghost: g });
    if (what === 'attach') { attachGhost(g, e.shiftKey); return; }
    if (g && !g.ok) setMsg(`Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`, 'bad');
    pickTool(null);
  }
  $('palette').addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]');
    if (b && performance.now() - palDragEnd < 400) return;   // v0.5.6: the end of a drag, not a click
    if (b) { pickTool(b.dataset.place); return; }
    const h = e.target.closest('[data-hang]');
    if (h) { hangOver = h.dataset.hang === 'over'; ghost = null; tools(); drawOverlay(); }
  });
  $('mirror').addEventListener('change', (e) => { mirrorOn = e.target.checked; ghost = null; drawOverlay(); });
  act('undo').onclick = () => undo();
  act('redo').onclick = () => redo();
  act('markers').onclick = () => { markersOn = !markersOn; tools(); drawOverlay(); };

  // The overlay: the hold's parts, the selected part's box (and its twin's), the one under the pointer, the ghost,
  // the markers.
  function drawOverlay() {
    if (!view || !cur) return;
    const boxes = partBoxes(cur), byId = new Map(boxes.map((b) => [b.id, b]));
    const sp = selPart(), lines = [];
    if (sp) {
      if (byId.get(sp.id)) lines.push({ ...byId.get(sp.id), style: 'sel' });
      if (sp.pair && byId.get(sp.pair)) lines.push({ ...byId.get(sp.pair), style: 'twin' });
    }
    if (hover && hover !== sel && byId.get(hover) && !tool) lines.push({ ...byId.get(hover), style: 'hover' });
    const ghosts = ghost ? ghost.parts.map((p) => ({ ...partBox(cur.base, p, cur.airframe), ok: ghost.ok })) : [];
    let markers = null;
    if (markersOn && last && !keysOnly) {
      const span = last.def.geo.SPAN || 40, r = 0.022 * span, ln = last.line;
      markers = { r, len: 0.22 * span, cg: { x: last.numbers.cgX, y: 0, z: 0 }, ct: ln.T > 0 ? { x: ln.x, y: ln.y, z: ln.z, dir: ln.dir } : null };
    }
    // v0.5.3: the airframe's outlines: the selection's, the one under the pointer, the whole new shape while a slider moves.
    const polys = [];
    if (afOn && (selAf || hoverAf)) {
      const O = afOutline(cur.base, cur.airframe);
      const pick = (s) => (s.what === 'wing' && !cur.airframe.mirror ? [s.side > 0 ? O.wingL : O.wingR] : afPolys(O, s.what));
      if (afDrag) for (const pts of afPolys(O, null)) polys.push({ pts, style: 'afGhost' });
      else if (selAf) for (const pts of pick(selAf)) polys.push({ pts, style: 'afSel' });
      if (hoverAf && !afDrag && !(selAf && hoverAf.what === selAf.what && (hoverAf.what !== 'wing' || cur.airframe.mirror || hoverAf.side === selAf.side))) {
        for (const pts of pick(hoverAf)) polys.push({ pts, style: 'afHover' });
      }
    }
    view.setOverlay({ inside: boxes.filter((b) => b.kind === 'ballast' || b.mount === 'hold'), lines, ghosts, markers, polys });
  }

  // Where the part in hand (or the one being dragged) would go for this ray: the design it makes, and whether it fits
  // (not past the limits, not in another part's way, one engine in the tail).
  function ghostFor(r, part) {
    const hit = hitAirframe(cur, r.o, r.u);
    const over = part ? (part.mount === 'overwing' ? true : part.mount === 'wing' ? false : hangOver) : hangOver;
    const what = part ? { ...part, over } : { ...tool, over };
    const c0 = placement(cur.base, what, hit, 0.25, cur.airframe);
    if (!c0) return null;
    // v0.5.6: the part in hand takes its keys' offsets (applyHand()); the candidate before them decides the keys' ranges
    if (!part) handCand = c0;
    const c = part ? c0 : applyHand(c0, hand);
    let next, ids;
    if (part) {
      next = updatePart(cur, part.id, { mount: c.mount, side: c.side, ...(c.s !== undefined ? { s: c.s } : {}), ...(c.x !== undefined ? { x: c.x } : {}) });
      const moved = next.parts.find((q) => q.id === part.id);
      ids = new Set([part.id, moved?.pair].filter(Boolean));
    } else {
      next = addPart(cur, c, { mirror: mirrorOn });
      const had = new Set(cur.parts.map((q) => q.id));
      ids = new Set(next.parts.filter((q) => !had.has(q.id)).map((q) => q.id));
    }
    const parts = next.parts.filter((q) => ids.has(q.id));
    if (!parts.length) {
      const p = { dx: 0, dz: 0, yaw: 0, pitch: 0, thrust: 1, s: 0, x: 0, ...c, id: 'ghost' };
      return { parts: [p], ok: false, next: null, why: 'room', key: JSON.stringify(p) };
    }
    const tails = engineParts(next).filter((q) => q.mount === 'tail').length;
    const was = designNumbers(designDef(cur)).overlap, now = designNumbers(designDef(next)).overlap;
    const ok = tails <= 1 && (!now || was);
    return { parts, ok, next, why: ok ? '' : tails > 1 ? 'tail' : 'overlap', key: JSON.stringify(parts) };
  }
  const WHY = { room: `no room (${MAX_ENGINES} engines and ${MAX_PARTS} parts at most).`, tail: 'the tail takes one engine.', overlap: 'it’s in another part’s way.' };
  function showGhost(g, e) {
    tip(g, e);
    if (tool && !dragPart) help();   // v0.5.6: the keys follow where the part in hand would go (wing, body, tail)
    const k = g ? g.key + g.ok : null;
    if (k === (ghost ? ghost.key + ghost.ok : null)) return;
    ghost = g;
    drawOverlay();
  }
  // Beside the pointer: the part in hand's name and where it would go, or why it can't. v0.5.6: and its keys' values.
  function tip(g, e) {
    const t = $('tip');
    if (!g || !e) { t.hidden = true; return; }
    const p = g.parts[0], r = $('view').getBoundingClientRect();
    const hv = tool && !dragPart ? handText(hand) : '';
    t.textContent = g.ok ? `${partLabel(p)} · ${partWhere(p, cur.base, cur.airframe)}${hv ? ` · ${hv}` : ''}${g.parts.length > 1 ? ' · and its twin' : ''}` : `Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`;
    t.classList.toggle('bad', !g.ok);
    t.style.left = `${Math.min(r.width - 260, e.clientX - r.left + 16)}px`;
    t.style.top = `${Math.max(4, e.clientY - r.top - 34)}px`;
    t.hidden = false;
  }

  const hooks = {
    hover(r, e) {
      if (!cur || palDrag) return;   // v0.5.6: a drag from the palette shows its own ghost (onPalMove())
      if (tool) { handAt = { r, e }; showGhost(ghostFor(r, null), e); return; }
      const id = pickPart(cur, r.o, r.u);
      // v0.5.3: the airframe under the pointer (no part in the way)
      const h = afOn && !id ? pickAirframe(cur, r.o, r.u) : null, ha = h ? { what: h.on, side: h.side } : null;
      view?.setCursor(id || ha ? 'over' : null);
      const afChanged = (ha?.what ?? null) !== (hoverAf?.what ?? null) || (ha?.side ?? 0) !== (hoverAf?.side ?? 0);
      if (afChanged) hoverAf = ha;
      if (id !== hover || afChanged) { hover = id; drawOverlay(); }
    },
    down(r) {
      if (!cur || tool) return false;
      const id = pickPart(cur, r.o, r.u);
      if (!id) return false;
      if (id !== sel) select(id);
      dragPart = keysOnly ? null : cur.parts.find((p) => p.id === id) || null;   // v0.5.6: a stock aircraft's parts stay put
      return true;
    },
    move(r, e) { if (dragPart) showGhost(ghostFor(r, dragPart), e); },
    up(r, e, moved) {
      const g = ghost, p = dragPart;
      dragPart = null; ghost = null; tip(null);
      if (moved && p && g && g.ok && g.next) { commit(g.next); return; }
      if (moved && g && !g.ok) setMsg(`Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`, 'bad');
      drawOverlay();
    },
    click(r, e) {
      if (!cur) return;
      if (!tool) {
        const h = afOn ? pickAirframe(cur, r.o, r.u) : null;
        if (h) selectAf(h.on, h.side);
        else if (sel || selAf) select(null);
        return;
      }
      const g = ghostFor(r, null);
      if (!g) return;
      attachGhost(g, e.shiftKey);   // v0.5.6: as a drag from the palette lets go (Shift keeps it in hand, its offsets too)
    },
    cancel() { if (tool) pickTool(null); else if (sel || selAf) select(null); },
    leave() { if (palDrag) return; handAt = null; tip(null); if (ghost && !dragPart) { ghost = null; drawOverlay(); } if (hover || hoverAf) { hover = null; hoverAf = null; drawOverlay(); } },
  };

  function save() {
    if (!last?.canSave) { setMsg('No engines: add one before saving.', 'bad'); return false; }
    const name = $('parts').querySelector('[data-p="name"]')?.value ?? cur.name;
    if (!nameOk(name)) { setMsg(`A name needs ${NAME_MIN}–${NAME_MAX} characters.`, 'bad'); if (sel) select(null); $('parts').querySelector('[data-p="name"]')?.focus(); return false; }
    cur = normalizeDesign({ ...cur, name: cleanName(name) });
    const res = store.save(cur);
    if (!res.ok) { setMsg('Browser storage is full: the design was not saved.', 'bad'); return false; }
    cur = res.design; savedJson = JSON.stringify(cur); isNew = false;
    renderNumbers();
    setMsg(`Saved. It’s in New scenario’s aircraft picker.`, 'ok');
    return true;
  }
  function setMsg(t, cls) { $('msg').textContent = t; $('msg').className = `fsw-msg ${cls || ''}`; }

  function openEditor(d, fresh, stock = false) {
    keysOnly = !!stock && !!keys; stopCap(); keyMsg = ''; keyMsgBad = false; stockTwin = true;
    el.dataset.mode = keysOnly ? 'keys' : 'design';
    cur = normalizeDesign(d); savedJson = JSON.stringify(cur); isNew = !!fresh && !keysOnly;
    page = 'editor';
    editing = confirming = null;
    tool = toolKey = sel = hover = ghost = dragPart = null; hand = { ...HAND0 }; handCand = handAt = null;
    selAf = hoverAf = null; afDrag = false;
    sliding = false;
    hist.clear();
    $('listPage').hidden = true; $('editor').hidden = false; $('ask').hidden = true;
    act('top').textContent = 'Back to the list';
    $('parts').innerHTML = partsHtml();
    renderNumbers();
    tools();
    setMsg(keysOnly ? '' : fresh ? `A new design: the ${TYPES[cur.base].name} as it is. Attach parts from the palette, then Save.` : '', '');
    startView();
    const nameIn = $('parts').querySelector('[data-p="name"]');
    if (nameIn) nameIn.focus({ preventScroll: true }); else el.focus({ preventScroll: true });
  }
  function startView() {
    const gen = ++viewGen;
    $('viewMsg').textContent = 'Loading the model…'; $('viewMsg').hidden = false;
    viewLoading = createView($('view'), (t) => { $('viewMsg').textContent = t; $('viewMsg').hidden = !t; })
      .then((v) => {
        if (gen !== viewGen || page !== 'editor' || el.hidden) { v.dispose(); return; }
        view = v; viewLoading = null;
        window.__fsw = v;   // for the browser checks
        view.setHooks(hooks);
        view.setDesign(cur, true);
        drawOverlay();
      })
      .catch((err) => { viewLoading = null; if (gen === viewGen) { $('viewMsg').textContent = `No 3D view: ${err.message}`; $('viewMsg').hidden = false; } });
  }
  function stopView() { viewGen++; view?.dispose(); view = null; if (window.__fsw) window.__fsw = null; }
  function leaveEditor(force) {
    if (!force && dirty()) { $('ask').hidden = false; act('keep').focus(); return false; }
    stopView(); stopCap();
    const id = cur?.id;
    if (isNew && !keysOnly && id && !store.get(id)) dropKeys(id);   // v0.5.6: a new design never saved takes its keys with it
    cur = null; savedJson = null; isNew = false; keysOnly = false;
    tool = toolKey = sel = hover = ghost = dragPart = null; hand = { ...HAND0 }; handCand = handAt = null;
    selAf = hoverAf = null; afDrag = false;
    hist.clear();
    showList(store.get(id) ? id : null);
    return true;
  }
  function showList(focusId) {
    page = 'list';
    $('editor').hidden = true; $('listPage').hidden = false;
    act('top').textContent = 'Back to the menu';
    $('crumb').textContent = '';
    delete el.dataset.worst;
    renderList(focusId ?? null);
  }

  act('save').onclick = () => save();
  // v0.5.2: Fly it: saved, then New scenario with it picked (the menu's onfly; the warehouse closes).
  act('fly').onclick = () => { if (!last?.canFly || (dirty() && !save()) || !api.onfly) return; const d = store.get(cur.id); if (d) api.onfly(d); };
  act('back').onclick = () => leaveEditor(false);
  act('keep').onclick = () => { $('ask').hidden = true; };
  act('discard').onclick = () => leaveEditor(true);
  act('top').onclick = () => { if (page === 'editor') leaveEditor(false); else api.close(); };

  // Keys stay here (typing the name never flies the aircraft). In the editor, away from the text fields: Z undoes,
  // Shift+Z redoes, Delete (or Backspace) removes the selected part. Esc goes back a step.
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.defaultPrevented) return;
    const typing = !!e.target.matches?.('input[type="text"], textarea');
    if (page === 'editor' && !typing && !keysOnly && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); return; }
      // v0.5.4: the selected part's keys (nudgePart()); a focused slider keeps its own arrows.
      const arrows = e.key.startsWith('Arrow') && !!e.target.matches?.('input[type="range"]');
      // v0.5.6: with a part in hand, the keys are its (nudgeInHand()), even with a part selected (after Shift+click)
      if (tool && NUDGE_KEYS.has(e.key) && !arrows) { e.preventDefault(); nudgeInHand(e.key, e.shiftKey); return; }
      if (sel && NUDGE_KEYS.has(e.key) && !arrows) { e.preventDefault(); nudgeSel(e.key, e.shiftKey, e.repeat); return; }
    }
    nudging = null;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    back();
  });
  function back() {
    if (page === 'editor') {
      if (!$('ask').hidden) $('ask').hidden = true;
      else if (tool) pickTool(null);
      else if (sel || selAf) select(null);
      else leaveEditor(false);
    } else if (confirming) { const id = confirming; confirming = null; renderList(id); }
    else api.close();
  }
  el.addEventListener('keyup', (e) => { e.stopPropagation(); nudging = null; });
  for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) el.addEventListener(t, (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  // A click on nothing keeps the keys here (else they'd go to the page under it).
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('input, button, select, textarea, [tabindex]')) el.focus({ preventScroll: true }); });

  const api = {
    el,
    onclose: null,
    onfly: null,
    open() {
      if (!el.hidden) return;
      el.hidden = false;
      listMsg = ''; listMsgBad = false;
      showList(null);
      el.focus({ preventScroll: true });
    },
    close() {
      if (el.hidden) return;
      stopView(); stopCap();
      if (isNew && cur && !store.get(cur.id)) dropKeys(cur.id);
      keysOnly = false;
      cur = null; page = 'list';
      tool = toolKey = sel = hover = ghost = dragPart = null; hand = { ...HAND0 }; handCand = handAt = null;
      selAf = hoverAf = null; afDrag = false;
      if (el.contains(document.activeElement)) document.activeElement.blur();
      el.hidden = true;
      api.onclose?.();
    },
    back,
    get isOpen() { return !el.hidden; },
    get page() { return page; },
    get design() { return cur; },
    get view() { return view; },
    get selected() { return sel; },
    // v0.5.3: the airframe's selection ({ what, side } or null), whether it's on, and a selection by hand (the checks)
    get selectedAirframe() { return selAf ? { ...selAf } : null; },
    get airframeOn() { return afOn; },
    selectAirframe: (what, side) => (what ? selectAf(what, side) : select(null)),
    get tool() { return toolKey; },
    openEditor: (d) => openEditor(d, false),
    // v0.5.6: a stock aircraft's keys editor, and whether it's the one open
    openStock,
    get keysOnly() { return keysOnly; },
    get capturing() { return capKey ? { ...capKey } : null; },
  };
  window.__wh = api;   // for the browser checks
  return api;
}
