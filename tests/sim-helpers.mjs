// Shared setups for the sim's node tests (not a test file itself).
import { createSim } from '../src/sim/sim.js';
import { OEW } from '../src/sim/a321neo.js';
import { iasFromMach } from '../src/sim/atmosphere.js';

export const KT = 0.514444, FT = 0.3048, FPM = FT / 60, DEG = Math.PI / 180;
export const DT = 1 / 120;

// Payload and fuel for a gross weight (fuel first up to `fuel`, the rest payload).
export function load(massKg, fuelKg) {
  return { fuelKg, payloadKg: massKg - OEW - fuelKg };
}

export function airborne({ massKg = 75000, fuelKg = 8000, altFt = 10000, iasKt, mach, flapLever = 0, gearDown = false, ap, law, hdg = 0, ground } = {}) {
  const sim = createSim(ground ? { ground } : {});
  const z = altFt * FT;
  const iasMs = mach ? iasFromMach(mach, z) : iasKt * KT;
  sim.reset({ x: 0, y: 0, hdg, onGround: false, z, iasMs, flapLever, gearDown, ...load(massKg, fuelKg), ap, law });
  return sim;
}

export function onRunway({ massKg = 80000, fuelKg = 8000, flapLever = 1, hdg = 0, ground } = {}) {
  const sim = createSim(ground ? { ground } : {});
  sim.reset({ x: 0, y: 0, hdg, onGround: true, flapLever, gearDown: true, ...load(massKg, fuelKg) });
  return sim;
}

// Runs n seconds, calling fn(sim) before each step. Stops early if fn returns true.
export function run(sim, seconds, fn, dt = DT) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (fn && fn(sim) === true) return i * dt;
    sim.step(dt);
    if (sim.state.crashed) return i * dt;
  }
  return seconds;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// A scripted approach pilot (test only): descends at `vs` ft/min, flares from `flareFt`
// to about `tdFpm` at the wheels. In the flare law the stick asks for pitch, so the gain
// changes there.
export function approachPilot(sim, { vs = -720, flareFt = 35, tdFpm = -180 } = {}) {
  const s = sim.state, c = sim.controls;
  const agl = s.agl / FT;
  const target = agl < flareFt ? vs + (flareFt - agl) * (tdFpm - vs) / flareFt : vs;
  const err = target - s.vs / FPM;
  c.pitch = s.flare ? clamp(0.0025 * err, -0.5, 1) : clamp(0.0006 * err, -0.6, 0.6);
}
