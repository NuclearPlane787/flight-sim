// v0.8.0, the gear: landings at Gimpo's 14R with the gear up, a leg up or a leg collapsing, flown in node by the game's
// test pilot (tests/e2e-controller.js, as tests/designs-flight.test.mjs runs it) with the pilot's part of a belly
// landing on top: the gear lever left up, then on the first touch the thrust off, the wings held level, the nose
// lowered and the rudder kept on the centreline. Not a test file itself (tests/v080-gear.test.mjs uses it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSim } from '../src/sim/sim.js';
import { armed } from '../src/sim/failures.js';
import { createScorer } from '../src/score.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KT = 0.514444, FT = 0.3048, NM = 1852, DEG = Math.PI / 180, FPM = FT / 60, DT = 1 / 120;
const SRC = readFileSync(new URL('./e2e-controller.js', import.meta.url), 'utf8');
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Gimpo's 14R from East Asia's airport file (its threshold, its far end, its width), and a ground function: the
// runway's pavement (its height straight between the two ends) inside its rectangle, grass at the same height outside.
export function rkss14R() {
  const ap = JSON.parse(readFileSync(path.join(ROOT, 'data', 'airports', 'RKSS.json'), 'utf8'));
  const rw = ap.runways.find((r) => r.ends.some((e) => e.ident === '14R'));
  const end = rw.ends.find((e) => e.ident === '14R'), far = rw.ends.find((e) => e !== end);
  const lenM = Math.hypot(far.x - end.x, far.y - end.y);
  const ux = (far.x - end.x) / lenM, uy = (far.y - end.y) / lenM, half = rw.widthM / 2;
  const against = (x, y) => { const rx = x - end.x, ry = y - end.y; return { along: rx * ux + ry * uy, xte: rx * uy - ry * ux }; };
  const out = { h: 0, kind: 'runway' };
  const ground = (x, y) => {
    const a = against(x, y), f = clamp(a.along / lenM, 0, 1);
    out.h = end.elevM + (far.elevM - end.elevM) * f;
    out.kind = a.along >= 0 && a.along <= lenM && Math.abs(a.xte) <= half ? 'runway' : 'grass';
    return out;
  };
  return { runway: rw, end, far, lenM, half, ux, uy, hdg: Math.atan2(ux, uy), against, ground };
}

// One landing. type: 'a321neo' | 'b787-9'; mode: 'down' (nothing failed), 'up' (the lever left up), 'nolock-<leg>'
// (0 nose, 1 left, 2 right: that leg won't lock), 'collapse-<leg>' (armed to collapse, seed `seed`); opts.tdFpm the
// pilot's flare aim at the wheels (ft/min, negative down; the controller's own -120 by default); opts.bankDeg a
// bank the pilot holds into the touch (a crash case); opts.sinkFpm a sink held to the ground with no flare at all.
export function land(type, mode, opts = {}) {
  const R = rkss14R();
  const sim = createSim({ type, ground: R.ground });
  const input = { lever: 0 };
  const window = { __fs: { sim, input } };
  new Function('window', SRC)(window);
  const ctl = window.__e2e, fly = window.__fsController, s = sim.state, c = sim.controls;
  const D = sim.type.data;
  const dist = 8 * NM, z = R.end.elevM + 15 + Math.tan(3 * DEG) * dist;
  const finalFlap = D.FINAL_FLAP_LEVER ?? 1;
  sim.reset({ x: R.end.x - R.ux * dist, y: R.end.y - R.uy * dist, z, hdg: R.hdg, onGround: false, iasMs: 170 * KT, flapLever: finalFlap,
    gearDown: false, fuelKg: 6000, payloadKg: (sim.type.defaults?.pax ?? 180) * 84 });
  c.flapLever = finalFlap;
  if (opts.setup) opts.setup(sim);   // (e.g. sim.setOption('indestructible', true))
  input.lever = c.thrust = Math.min(c.thrust, sim.leverClimb);
  const [kind, legS] = mode.split('-'), leg = legS === undefined ? -1 : +legS;
  if (kind === 'nolock') sim.setFailures(armed(null, { kind: 'gear-nolock', target: leg }, 0, opts.seed ?? 7));
  if (kind === 'collapse') sim.setFailures(armed(null, { kind: 'gear-collapse', target: leg }, 0, opts.seed ?? 7));
  // 'grav': the normal extension failed, the gravity extension selected at once (the legs fall in about 30 s);
  // 'nograv': that fails too, so the doors hang open and the legs stay up (a belly landing).
  if (kind === 'grav' || kind === 'nograv') {
    let p = armed(null, { kind: 'gear-noext' }, 0, 3);
    if (kind === 'nograv') p = armed(p, { kind: 'gear-nograv' }, 0, 4);
    sim.setFailures(p);
    sim.step(DT); sim.events.length = 0;
    sim.gravityGear();
  }
  // The landing card, as main.js feeds it (the runway planned, then the one landed on at the touchdown).
  const scorer = createScorer();
  scorer.setType(sim.type); scorer.setRunway(R.end, R.far);
  const ap = sim.ap;
  ap.setSpd(Math.round(s.ias / KT)); ap.engageAp(); if (!ap.athr) ap.toggleAthr();
  ctl.axis = { tx: R.end.x, ty: R.end.y, ux: R.ux, uy: R.uy, hdg: R.hdg, elev: R.end.elevM };
  ctl.phase = 'approach';
  const r = { type, mode, events: [], td: null, first: null, firstSink: null, firstPart: null, legsAtTd: null, crashed: null,
    stopped: false, stop: null, slideM: 0, maxXte: 0, maxBank: 0, maxPitch: -99, minPitch: 99, scraped: new Set(), bounceAir: 0, creep: 0, log: null };
  let mine = false, p0 = null, tStop = -1, wasDown = false;
  for (let k = 0; k < 400 / DT; k++) {
    if (!mine) fly(sim, DT);
    if (mode === 'up') c.gearDown = false;
    const touched = r.first !== null;
    // With the gear not all down the controller's flare (to the wheels) would sink on past it nose high, onto the
    // tail: a pilot flares to the belly instead, by the lowest part's height (not a wingtip), pitch no more than 6°,
    // and keeps the thrust on to 10 ft above the belly. From the flare's start this pilot flies it (the controller
    // does nothing in a phase it doesn't know).
    const allDown = s.gearLegs[0] > 0.98 && s.gearLegs[1] > 0.98 && s.gearLegs[2] > 0.98;
    if (!touched && opts.sinkFpm === undefined && (ctl.phase === 'belly' || (ctl.phase === 'flare' && !allDown))) {
      if (ctl.phase !== 'belly') { ctl.phase = 'belly'; ctl.bellyVs0 = s.vs; ctl.note('belly flare'); }
      const h = lowestPart(sim), k = clamp(h / 12, 0, 1) ** 1.5, aim = (opts.tdFpm ?? -110) * FPM;
      const vsCmd = aim + (ctl.bellyVs0 - aim) * k;
      let p = clamp((vsCmd - s.vs) * (sim.type.family === 'boeing' ? 0.3 : 0.25) - s.q * 0.8 + ctl.pitchI, -0.3, 0.7);
      if (s.pitch > 6 * DEG && p > 0) p = clamp((6 * DEG - s.pitch) / DEG * 0.3, -0.3, 0);
      c.pitch = p;
      const a = R.against(s.pos.x, s.pos.y), track = Math.atan2(s.vel.x, s.vel.y);
      const bankCmd = clamp(wrap(R.hdg + clamp(-a.xte * 0.004, -0.1, 0.1) - track) / DEG * 2.0, -3, 3);
      c.roll = clamp((bankCmd - s.roll / DEG) * 0.06, -1, 1);
      c.yaw = clamp(wrap(R.hdg - s.hdg) / DEG * 0.15, -0.5, 0.5);
      if (h < 3) { if (ap.athr) ap.toggleAthr(); input.lever = 0; }
    }
    // A sink held to the ground with no flare (the over-the-limit case): the stick for that sink rate.
    if (!touched && opts.sinkFpm !== undefined && s.agl < 120 * FT) {
      ctl.phase = 'hold';   // the controller does nothing in a phase it doesn't know
      const vsCmd = opts.sinkFpm * FPM;
      ctl.pitchI = clamp(ctl.pitchI + (vsCmd - s.vs) * 0.02 * DT, -0.3, 0.3);
      c.pitch = clamp((vsCmd - s.vs) * 0.12 - s.q * 0.8 + ctl.pitchI, -0.6, 0.6);
      c.roll = clamp(((opts.bankDeg ?? 0) - s.roll / DEG) * 0.06, -1, 1);
      if (s.agl < 30 * FT) { if (ap.athr) ap.toggleAthr(); input.lever = 0; }
    } else if (!touched && opts.bankDeg !== undefined && s.agl < 60 * FT) {
      c.roll = clamp((opts.bankDeg - s.roll / DEG) * 0.08, -1, 1);
    }
    if (touched) {
      // The pilot's part on the ground: thrust off (reverse is no use on a belly), the wings level, the nose down
      // gently, the rudder and the nose wheel (if it's there) on the centreline, the brakes (on the legs that are down).
      mine = true;
      if (ap.athr) ap.toggleAthr();
      if (ap.ap) ap.disconnectAp('test');
      input.lever = 0;
      const a = R.against(s.pos.x, s.pos.y);
      c.roll = clamp(-(s.roll / DEG) * 0.15, -1, 1);
      // The nose: down to its wheel when it has one; with the nose leg up held off on the elevator while it flies,
      // then let down as the speed goes; on a belly, left to settle.
      const iasKt = s.ias / KT;
      if (s.gearLegs[0] > 0.98) c.pitch = s.wow.nose ? 0 : -0.15;
      else if (s.gearLegs[1] > 0.98 || s.gearLegs[2] > 0.98) { const tgt = clamp((iasKt - 40) / 50, 0, 1) * 2 * DEG; c.pitch = clamp((tgt - s.pitch) / DEG * 0.25 - s.q * 2, -0.4, 0.8); }
      else c.pitch = 0;
      const corr = clamp(-a.xte * 0.01, -0.1, 0.1);
      c.yaw = clamp((wrap(R.hdg + corr - s.hdg) / DEG) * 0.5, -1, 1);
      c.brakeL = c.brakeR = s.t - r.first.t > 2 ? 0.6 : 0;
      c.thrust = 0;
    }
    if (mine) input.lever = 0;
    if (sim._core.athrDriving) input.lever = c.thrust; else c.thrust = input.lever;
    sim.step(DT);
    if (opts.trace) opts.trace(sim, r);
    for (const e of sim.events) {
      r.events.push({ t: +s.t.toFixed(2), ...e });
      if (e.type === 'touchdown' && !r.td) r.td = { ...e, legs: s.gearLegs.slice() };
    }
    for (const e of sim.events) if (e.type === 'touchdown') scorer.setLanding({ runway: R.runway, end: R.end, other: R.far });
    const res = scorer.update(s, sim.events);
    if (res && !r.card) r.card = res;
    sim.events.length = 0;
    const down = s.onGround || s.scraping;
    if (down && r.first === null) {
      r.first = { t: s.t, vs: s.vs, legs: s.gearLegs.slice(), scraping: s.scraping };
      r.firstSink = -s.vs / FPM;
      p0 = { x: s.pos.x, y: s.pos.y };
      r.legsAtTd = s.gearLegs.slice();
    }
    if (r.first !== null) {
      if (wasDown && !down) r.bounceAir += DT;
      wasDown = down || wasDown;
      if (s.scraping) r.scraped.add(true);
      const a = R.against(s.pos.x, s.pos.y);
      r.maxXte = Math.max(r.maxXte, Math.abs(a.xte));
      r.maxBank = Math.max(r.maxBank, Math.abs(s.roll / DEG));
      r.maxPitch = Math.max(r.maxPitch, s.pitch / DEG); r.minPitch = Math.min(r.minPitch, s.pitch / DEG);
    }
    if (s.crashed) { r.crashed = s.crashed; break; }
    if (r.first !== null && s.gs < 0.5) {
      // Stopped: the parking brake and the engines off (the evacuation's first items, every type's [EST])
      if (tStop < 0) { tStop = s.t; if (!opts.keepEngines) { c.parkingBrake = true; for (let i = 0; i < s.engines.length; i++) sim.engineSwitch(i, false); } }
      // (it may settle onto its tail or a nacelle as it stops: the creep is the CG's track over the last 6 s of 10)
      if (!r.stopAt && s.t - tStop > 4) r.stopAt = { x: s.pos.x, y: s.pos.y, t: s.t };
      if (r.stopAt) r.creep += s.gs * DT;   // the CG's ground track (a settling rotation moves pos, not this)
      if (s.t - tStop > 10) break;   // ten seconds at rest: no creep, no bounce
    }
  }
  r.log = window.__e2eLog.slice();
  if (r.first !== null) {
    const a = R.against(s.pos.x, s.pos.y), a0 = R.against(p0.x, p0.y);
    r.stop = { along: a.along, xte: a.xte, gs: s.gs, kind: R.ground(s.pos.x, s.pos.y).kind };
    r.firstAlong = a0.along;
    r.slideM = a.along - a0.along;
    r.stopped = !s.crashed && tStop >= 0 && s.gs < 0.5;
    r.onPavement = r.stop.kind === 'runway' && a.along > 0 && a.along < R.lenM && Math.abs(a.xte) < R.half;
  }
  r.state = s; r.sim = sim;
  return r;
}

// The lowest crash point's height above the ground under the aircraft (the wingtips left out), from the state.
export function lowestPart(sim) {
  const s = sim.state, th = s.pitch, ph = s.roll;
  const r6 = -Math.sin(th), r7 = Math.sin(ph) * Math.cos(th), r8 = Math.cos(ph) * Math.cos(th);
  let lo = Infinity;
  for (const c of sim.type.geo.CRASH_POINTS) {
    if (c.why === 'wingtip strike') continue;
    const rx = c.x - s.cgX, ry = -c.y, rz = -c.z;
    lo = Math.min(lo, s.pos.z - (r6 * rx + r7 * ry + r8 * rz) - s.groundH);
  }
  return lo;
}

// A line for a log or a report.
export function line(r) {
  const f = (v, d = 0) => (v === undefined || v === null ? '-' : (+v).toFixed(d));
  return `${r.type} ${r.mode}: first touch ${f(r.firstSink)} ft/min at ${f(r.firstAlong)} m; ${r.crashed ? 'CRASHED (' + r.crashed + ')' : r.stopped ? 'stopped' : 'not stopped'}`
    + ` after ${f(r.slideM)} m at ${f(r.stop?.along)} m, ${f(r.stop?.xte, 1)} m off (max ${f(r.maxXte, 1)}), bank max ${f(r.maxBank, 1)}°, pitch ${f(r.minPitch, 1)}..${f(r.maxPitch, 1)}°,`
    + ` creep ${f(r.creep, 2)} m, air after touch ${f(r.bounceAir, 2)} s; legs ${r.legsAtTd?.map((v) => v.toFixed(2)).join('/')};`
    + ` events ${r.events.filter((e) => e.type !== 'failure').map((e) => e.type + (e.reason ? '(' + e.reason + ')' : '') + (e.leg !== undefined ? e.leg : '')).join(',')}`;
}
