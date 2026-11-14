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
} from '../sim/designs.js';
import { ENGINE_LIST, ENGINE_TYPES } from '../sim/engine-types.js';
import { TYPES, TYPE_LIST } from '../sim/types.js';
import { cleanName, nameOk, NAME_MIN, NAME_MAX } from '../scenarios.js';
import { designStore } from '../designs-store.js';

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
export function partWhere(p, base) {
  const R = mountRange(base, p);
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
export function readout(design) {
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
  add('tail', 'Tail-strike angle', `${n.tailStrikeDeg.toFixed(1)}°`);
  add('drag', 'Drag the parts add', `${sgn(n.dragAddedM2, 2, ' m²')} (${pct(n.dragAddedM2 / (A.CD0 * A.S), 1)} of the airframe’s)`);
  const cg = n.cgShiftMac, cgA = Math.abs(cg), fwd = cg > 0;
  const cgBad = fwd ? cg > WARN.cgFwdBad : -cg > WARN.cgAftBad, cgWarn = fwd ? cg > WARN.cgFwd : -cg > WARN.cgAft;
  add('cg', 'CG against the base’s (default load)', cgA < 0.0005 ? 'the same' : `${(cgA * 100).toFixed(1)} % MAC ${fwd ? 'forward' : 'aft'}`,
    lvl(cgBad, cgWarn),
    cgBad ? (fwd ? `The CG is ${(cgA * 100).toFixed(0)} % MAC forward of the base’s: too nose-heavy to rotate and flare. Move weight aft (ballast, a hold tank) or the engines back.`
      : `The CG is ${(cgA * 100).toFixed(0)} % MAC aft of the base’s: past its static margin, it pitches up on its own. Move weight forward.`)
      : cgWarn ? `The CG has moved ${(cgA * 100).toFixed(0)} % MAC ${fwd ? 'forward: it needs more elevator to rotate and to flare' : 'aft: lighter and twitchier in pitch'}.` : '');
  const yawFrac = Math.abs(line.yawNm) / B.yawLimitNm, toward = line.yawNm > 0 ? 'left' : 'right';
  add('yaw', 'Thrust’s yaw at full power', none || yawFrac < 0.005 ? 'balanced' : `nose ${toward} · ${Math.round(yawFrac * 100)} % of an engine out`,
    lvl(!none && yawFrac > 1, !none && yawFrac > WARN.yawFrac),
    yawFrac > 1 ? `Lopsided thrust: at full power it yaws harder than the ${TYPES[d.base].name} with an engine out, and the rudder can’t hold it on the runway. Balance the engines (Mirror).`
      : yawFrac > WARN.yawFrac ? `Lopsided thrust: at full power it pulls the nose ${toward}. Hold rudder on the take-off roll.` : '');
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
  return { design: d, def, numbers: n, rows, engines, pods, issues, worst, canSave: !none, line, base: B };
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
    const R = mountRange(d.base, { ...p, mount: value, side: centre ? 0 : p.side || 1 });
    if (R.key === 'x') patch.x = (R.lo + R.hi) / 2;
    if (R.key === 's') patch.s = clamp(p.s || (R.lo + R.hi) / 2, R.lo, R.hi);
    if (!centre && p.side === 0) patch.side = 1;
    return updatePart(d, id, patch);
  }
  if (key === 'xn') return updatePart(d, id, { x: TYPES[d.base].geo.NOSE_X - Number(value) });
  return updatePart(d, id, { [key]: Number(value) });
}

// Where a part dropped on the airframe goes. `hit`: the surface under the pointer (hitAirframe()); `what`: the part in
// hand ({ kind, engine, over (an engine on the wing goes over it), mount (a tank's: wing or hold), kg }). The station is
// snapped (0.25 m) and kept to the mount's range. → a part for addPart() (or its place, for updatePart()), or null where
// it can't go (a wing tank off the wing, a hold tank or ballast on it).
export function placement(base, what, hit, snap = 0.25) {
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
  const R = mountRange(base, p);
  if (R.key === 's') p.s = +clamp(sn(Math.abs(hit.y)), R.lo, R.hi).toFixed(2);
  else if (R.key === 'x') p.x = +clamp(sn(hit.x), R.lo, R.hi).toFixed(2);
  return p;
}

// The surface a ray meets first (geometry frame: x forward, y left, z up; o the origin, u a unit direction), on the
// base's airframe as designs.js shapes it: the wing (each side's mid-surface over its planform), the fuselage (an
// elliptic cylinder from the tail to the nose; its crown at the fin is the tail's mount) and the fin. → { t, on: 'wing' |
// 'body' | 'tail', x, y, z } or null.
export function hitAirframe(base, o, u) {
  const a = airframe(base), G = a.G, hz = G.FUSELAGE_HEIGHT / 2, ys = a.ys;
  let best = null;
  const at = (t) => [o[0] + t * u[0], o[1] + t * u[1], o[2] + t * u[2]];
  const take = (t, on, p) => { if (t > 1e-6 && (!best || t < best.t)) best = { t, on, x: p[0], y: p[1], z: p[2] }; };
  const zMid = (y) => (a.lower(y) + a.upper(y)) / 2;
  const c1 = (zMid(a.tipY) - zMid(ys)) / (a.tipY - ys), c0 = zMid(ys) - c1 * ys;
  for (const s of [1, -1]) {
    const den = u[2] - s * c1 * u[1];
    if (Math.abs(den) < 1e-9) continue;
    const t = (c0 - o[2] + s * c1 * o[1]) / den, p = at(t), y = s * p[1];
    if (y < ys || y > a.tipY) continue;
    const le = a.leX(y);
    if (p[0] > le + 0.2 || p[0] < le - a.chord(y) - 0.2) continue;
    take(t, 'wing', p);
  }
  const xTail = G.TAIL_STRIKE_POINT.x - 1, xNose = G.NOSE_X - 1;
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

// A part's box (geometry frame: its centre and half-sizes) and shape, where it is: a nacelle, a teardrop tank, a box in
// the hold. Hold tanks are sized by their fuel.
export function partBox(base, p) {
  if (p.kind === 'engine') { const { nacelle: n } = placeEngine(base, p); return { shape: 'cyl', x: n.x, y: n.y, z: n.z, hx: n.L / 2, hy: n.D / 2, hz: n.D / 2 }; }
  if (p.kind === 'tank') {
    const t = placeTank(base, p);
    if (!t.hold) return { shape: 'pod', x: t.x, y: t.y, z: t.z, hx: t.L / 2, hy: t.D / 2, hz: t.D / 2 };
    const hy = 0.9, hz = 0.55, hx = clamp(p.kg / 800 / (4 * hy * hz) / 2, 0.4, 3);
    return { shape: 'box', x: t.x, y: 0, z: t.z, hx, hy, hz };
  }
  const b = placeBallast(base, p);
  return { shape: 'box', x: b.x, y: 0, z: b.z, hx: 0.5, hy: 0.5, hz: 0.35 };
}
export const partBoxes = (d) => d.parts.map((p) => ({ id: p.id, kind: p.kind, mount: p.mount, ...partBox(d.base, p) }));
// Where a ray meets an axis-aligned box first (the distance along it), or null.
export function rayBox(o, u, b) {
  let t0 = 0, t1 = Infinity;
  const c = [b.x, b.y, b.z], h = [b.hx, b.hy, b.hz];
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
  const hit = hitAirframe(d.base, o, u);
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
export const viewKey = (d) => JSON.stringify([d.base, d.parts.filter((p) => p.kind === 'engine' || (p.kind === 'tank' && p.mount === 'wing'))
  .map(({ id, pair, thrust, ...p }) => p), d.gearExtendM, d.registration]);

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
  const put = (o, b) => { o.position.set(-b.y, b.z, -b.x); o.scale.set(2 * b.hy, 2 * b.hz, 2 * b.hx); o.renderOrder = 10; fx.add(o); return o; };
  let overlay = null;
  function drawOverlay() {
    for (const c of fx.children.slice()) fx.remove(c);
    const o = overlay;
    if (!o) return;
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
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
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
    disposeModel();
    for (const c of fx.children.slice()) fx.remove(c);
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
    // A point of the geometry frame on the screen (client pixels), as last drawn.
    project(x, y, z) {
      const v = new THREE.Vector3(-y, z, -x).project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, front: v.z < 1 };
    },
    get view() { return view; },
    get builtKey() { return builtKey; },
    get busy() { return !!(timer || pending); },
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, overlay: fx.children.length }),
  };
}

// ---- The page ----

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
  place: 'Click on the aircraft to attach it · Shift+click keeps it in hand · right-click or Esc puts it back',
  sel: 'Drag the part to move it · Delete removes it · Esc lets go',
};

export function createWarehouse(root, { store = designStore() } = {}) {
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
        <p class="fsm-note" data-o="listMsg" aria-live="polite"></p>
        <div class="fsm-list" data-o="list"></div>
        <p class="fsm-help">A design is one of the three types with parts attached: engines anywhere they fit, tanks and ballast, its weight, fuel and gear changed. Click one to open it. Saved designs fly from New scenario’s aircraft picker. Esc goes back.</p>
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
          <h3 class="fsw-h">The numbers</h3>
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
  const hist = createHistory();

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
    const T = TYPES[cur.base], R = mountRange(cur.base, p), o = partOuts(p);
    const tailTaken = cur.parts.some((q) => q.kind === 'engine' && q.mount === 'tail' && q.id !== p.id);
    let h = `<div class="fsw-sel" data-o="sel">
      <h3>${esc(partLabel(p))}${p.pair ? ' <small>and its mirror twin</small>' : ''}</h3>
      <p class="fsw-base">${esc(partWhere(p, cur.base))}</p>`;
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
    h += `<div class="fsw-btns"><button type="button" class="fsui-b danger" data-a="remove">Remove${p.pair ? ' both' : ''}</button><button type="button" class="fsui-b" data-a="done">Done</button></div></div>`;
    return h;
  }
  // The aircraft: its name and registration, its parts (a click selects one), its weight, fuel and gear.
  function aircraftHtml() {
    const d = cur, T = TYPES[d.base], A = T.data;
    const shown = d.parts.filter((p, i) => !p.pair || d.parts.findIndex((q) => q.id === p.pair) > i);
    const name = (p) => (!p.pair ? partLabel(p) : p.kind === 'engine' ? `${ENGINE_TYPES[p.engine]?.short ?? p.engine} · ${WHERE[p.mount]}` : 'Wing tanks');
    const list = shown.length ? shown.map((p) => `<button type="button" class="fsw-prow" data-sel="${esc(p.id)}"><span>${esc(name(p))}${p.pair ? ' <b>× 2</b>' : ''}</span><small>${esc(partWhere(p, d.base))}</small></button>`).join('')
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
      ${slider('data-p', 'gearExtendM', 'Gear extension', RANGES.gearExtendM[0], RANGES.gearExtendM[1], 0.05, d.gearExtendM, `+${d.gearExtendM.toFixed(2)} m`)}`;
  }
  const oewOut = (d, A) => `${pct(d.oewDeltaKg / A.OEW, 1)} (${d.oewDeltaKg >= 0 ? '+' : '−'}${Math.abs(d.oewDeltaKg).toLocaleString('en-US')} kg)`;
  const fuelOut = (d, A) => `${Math.round((d.fuelCapacityKg / A.FUEL_MAX) * 100)} % · ${kg(d.fuelCapacityKg)}`;
  const partsHtml = () => { const p = selPart(); return p ? partHtml(p) : aircraftHtml(); };

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
    $('issues').innerHTML = issuesHtml(r);
    $('nums').innerHTML = numsHtml(r);
    $('crumb').textContent = `${cur.name}${dirty() ? ' · not saved' : ''}`;
    el.dataset.worst = r.worst;
    act('save').disabled = act('fly').disabled = !r.canSave;
    act('save').title = r.canSave ? '' : 'It needs an engine first';
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
    if (full) $('parts').innerHTML = partsHtml(); else syncParts(active);
    renderNumbers();
    setMsg('', '');
    view?.setDesign(cur);
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
  function undo() { step(hist.undo(cur)); }
  function redo() { step(hist.redo(cur)); }
  // The name and registration aren't steps: they stay as typed.
  function step(d) {
    if (!d) return;
    cur = normalizeDesign({ ...d, name: cur.name, registration: cur.registration });
    ghost = null; dragPart = null;
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
    if (!sliding) { hist.push(cur); sliding = true; }
    if (p) cur = editDesign(cur, p, t.value);
    else if (q && sel) cur = editPart(cur, sel, q, t.value);
    else return;
    changed(false, t);
  });
  $('parts').addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'range') { sliding = false; syncParts(null); tools(); return; }
    if (t.dataset.q === 'mirror' && sel) {
      const want = t.checked;
      if (!commit(editPart(cur, sel, 'mirror', want))) { t.checked = !want; if (want) setMsg(`No room for a twin: ${MAX_ENGINES} engines and ${MAX_PARTS} parts at most.`, 'bad'); }
    }
  });
  $('parts').addEventListener('click', (e) => {
    const row = e.target.closest('[data-sel]');
    if (row) { select(row.dataset.sel); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'remove') { removeSel(); return; }
    if (a === 'done') { select(null); return; }
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
  function help() { $('viewHelp').textContent = tool ? HELP.place : sel ? HELP.sel : HELP.idle; }
  function pickTool(key) {
    if (!key || key === toolKey) { tool = null; toolKey = null; }
    else { const e = PALETTE.find((p) => p.key === key); tool = e ? e.what : null; toolKey = e ? key : null; }
    ghost = null; tip(null);
    view?.setCursor(tool ? 'place' : null);
    tools();
    drawOverlay();
  }
  $('palette').addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]');
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
    const ghosts = ghost ? ghost.parts.map((p) => ({ ...partBox(cur.base, p), ok: ghost.ok })) : [];
    let markers = null;
    if (markersOn && last) {
      const span = last.def.geo.SPAN || 40, r = 0.022 * span, ln = last.line;
      markers = { r, len: 0.22 * span, cg: { x: last.numbers.cgX, y: 0, z: 0 }, ct: ln.T > 0 ? { x: ln.x, y: ln.y, z: ln.z, dir: ln.dir } : null };
    }
    view.setOverlay({ inside: boxes.filter((b) => b.kind === 'ballast' || b.mount === 'hold'), lines, ghosts, markers });
  }

  // Where the part in hand (or the one being dragged) would go for this ray: the design it makes, and whether it fits
  // (not past the limits, not in another part's way, one engine in the tail).
  function ghostFor(r, part) {
    const hit = hitAirframe(cur.base, r.o, r.u);
    const over = part ? (part.mount === 'overwing' ? true : part.mount === 'wing' ? false : hangOver) : hangOver;
    const what = part ? { ...part, over } : { ...tool, over };
    const c = placement(cur.base, what, hit);
    if (!c) return null;
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
    const k = g ? g.key + g.ok : null;
    if (k === (ghost ? ghost.key + ghost.ok : null)) return;
    ghost = g;
    drawOverlay();
  }
  // Beside the pointer: the part in hand's name and where it would go, or why it can't.
  function tip(g, e) {
    const t = $('tip');
    if (!g || !e) { t.hidden = true; return; }
    const p = g.parts[0], r = $('view').getBoundingClientRect();
    t.textContent = g.ok ? `${partLabel(p)} · ${partWhere(p, cur.base)}${g.parts.length > 1 ? ' · and its twin' : ''}` : `Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`;
    t.classList.toggle('bad', !g.ok);
    t.style.left = `${Math.min(r.width - 260, e.clientX - r.left + 16)}px`;
    t.style.top = `${Math.max(4, e.clientY - r.top - 34)}px`;
    t.hidden = false;
  }

  const hooks = {
    hover(r, e) {
      if (!cur) return;
      if (tool) { showGhost(ghostFor(r, null), e); return; }
      const id = pickPart(cur, r.o, r.u);
      view?.setCursor(id ? 'over' : null);
      if (id !== hover) { hover = id; drawOverlay(); }
    },
    down(r) {
      if (!cur || tool) return false;
      const id = pickPart(cur, r.o, r.u);
      if (!id) return false;
      if (id !== sel) select(id);
      dragPart = cur.parts.find((p) => p.id === id) || null;
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
      if (!tool) { if (sel) select(null); return; }
      const g = ghostFor(r, null);
      if (!g) return;
      if (!g.ok || !g.next) { setMsg(`Can’t go there: ${WHY[g.why] || 'it doesn’t fit.'}`, 'bad'); return; }
      const had = new Set(cur.parts.map((q) => q.id));
      if (!commit(g.next)) return;
      const added = cur.parts.find((q) => !had.has(q.id));
      if (!e.shiftKey) { tool = null; toolKey = null; view?.setCursor(null); tip(null); }
      ghost = null;
      if (added) select(added.id);
      tools();
      if (added) setMsg(`${partLabel(added)}${added.pair ? ' and its twin' : ''} attached.`, 'ok');
    },
    cancel() { if (tool) pickTool(null); else if (sel) select(null); },
    leave() { tip(null); if (ghost && !dragPart) { ghost = null; drawOverlay(); } if (hover) { hover = null; drawOverlay(); } },
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

  function openEditor(d, fresh) {
    cur = normalizeDesign(d); savedJson = JSON.stringify(cur); isNew = !!fresh;
    page = 'editor';
    editing = confirming = null;
    tool = toolKey = sel = hover = ghost = dragPart = null;
    sliding = false;
    hist.clear();
    $('listPage').hidden = true; $('editor').hidden = false; $('ask').hidden = true;
    act('top').textContent = 'Back to the list';
    $('parts').innerHTML = partsHtml();
    renderNumbers();
    tools();
    setMsg(fresh ? `A new design: the ${TYPES[cur.base].name} as it is. Attach parts from the palette, then Save.` : '', '');
    startView();
    $('parts').querySelector('[data-p="name"]')?.focus({ preventScroll: true });
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
    stopView();
    const id = cur?.id;
    cur = null; savedJson = null; isNew = false;
    tool = toolKey = sel = hover = ghost = dragPart = null;
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
  act('fly').onclick = () => { if ((dirty() && !save()) || !api.onfly) return; const d = store.get(cur.id); if (d) api.onfly(d); };
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
    if (page === 'editor' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); return; }
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    back();
  });
  function back() {
    if (page === 'editor') {
      if (!$('ask').hidden) $('ask').hidden = true;
      else if (tool) pickTool(null);
      else if (sel) select(null);
      else leaveEditor(false);
    } else if (confirming) { const id = confirming; confirming = null; renderList(id); }
    else api.close();
  }
  el.addEventListener('keyup', (e) => e.stopPropagation());
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
      stopView();
      cur = null; page = 'list';
      tool = toolKey = sel = hover = ghost = dragPart = null;
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
    get tool() { return toolKey; },
    openEditor: (d) => openEditor(d, false),
  };
  window.__wh = api;   // for the browser checks
  return api;
}
