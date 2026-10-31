// The path prediction itself, shared by the worker and the node tests: the real flight
// model and AP run ahead from a snapshot at a coarser fixed step, sampled every few seconds.
// Each sample carries a full snapshot, so a jump is just sim.restore(sample.snap).
// The ground is the real terrain when a heightfield is given (the worker loads the national
// grid lazily), else flat sea level (h = 0, water). Flying into the ground ends the run with
// reason 'terrain'; the samples just before the impact are dropped, so no jump target is in
// or skimming the terrain, and the last sample left carries terrain: true and the impact.

import { createSim } from './sim.js';
import { MAP_EXTENT } from '../world/frame.js';

const SEA = { h: 0, kind: 'water' };
const seaGround = () => SEA;

export const PREDICT_DEFAULTS = { dt: 1 / 30, sampleEvery: 5, maxMinutes: 90 };
export const TERRAIN_CLEAR_M = 150;   // samples closer than this above the ground near the impact go
export const TERRAIN_CLEAR_S = 15;    // and so do those in the last 15 s before it

// The sim's ground() over a heightfield: h from the data, 'water' at sea level (the sea and
// anything at 0 m), else 'ground'. One reused object, as in main.js.
export function terrainGround(hf) {
  const g = { h: 0, kind: 'water' };
  return (x, y) => { const h = hf.heightAt(x, y); g.h = h; g.kind = h > 0 ? 'ground' : 'water'; return g; };
}

// Sets up a run. Call run.advance(n) until it returns true; run.samples holds the result
// and run.reason why it stopped ('time' | 'fuel' | 'map' | 'crash' | 'terrain').
// hf: an optional heightfield (heightfield.js); without it the ground is flat sea.
export function createPredictionRun(snap, opts = {}, hf = null) {
  const o = { ...PREDICT_DEFAULTS, ...opts };
  const ground = hf ? terrainGround(hf) : seaGround;
  const sim = createSim({ ground });
  sim.restore(snap);
  // Hands off the stick: the path is what the AP flies.
  sim.controls.pitch = 0; sim.controls.roll = 0; sim.controls.yaw = 0;
  const S = sim.state;
  const t0 = S.t;
  const tEnd = t0 + o.maxMinutes * 60;
  const stepsPerSample = Math.max(1, Math.round(o.sampleEvery / o.dt));
  const samples = [{ t: S.t, x: S.pos.x, y: S.pos.y, z: S.pos.z, snap: sim.snapshot() }];
  let k = 0;
  const run = {
    samples, reason: '', done: false,
    advance(maxSteps) {
      if (run.done) return true;
      for (let i = 0; i < maxSteps; i++) {
        sim.step(o.dt);
        sim.events.length = 0;
        if (++k % stepsPerSample === 0) {
          samples.push({ t: S.t, x: S.pos.x, y: S.pos.y, z: S.pos.z, snap: sim.snapshot() });
        }
        let why = '';
        // Contact with land (a crash, or wheels down off a runway) ends the path at the terrain.
        if (hf && (S.crashed || S.onGround) && ground(S.pos.x, S.pos.y).kind === 'ground') why = 'terrain';
        else if (S.crashed) why = 'crash';
        else if (S.fuelKg <= 0) why = 'fuel';
        else if (S.pos.x < MAP_EXTENT.x0 || S.pos.x > MAP_EXTENT.x1 || S.pos.y < MAP_EXTENT.y0 || S.pos.y > MAP_EXTENT.y1) why = 'map';
        else if (S.t >= tEnd - 1e-9) why = 'time';
        if (why) {
          if (k % stepsPerSample !== 0) samples.push({ t: S.t, x: S.pos.x, y: S.pos.y, z: S.pos.z, snap: sim.snapshot() });
          run.reason = why; run.done = true;
          if (why === 'terrain') trimAtImpact(samples, ground);
          return true;
        }
      }
      return false;
    },
  };
  return run;
}

// After a terrain impact: drop the samples near it (within TERRAIN_CLEAR_M of the ground or
// TERRAIN_CLEAR_S of the impact), keep the first one (where the aircraft is now), and mark
// the new last sample terrain: true with the impact point.
function trimAtImpact(samples, ground) {
  const hit = samples[samples.length - 1];
  const impact = { t: hit.t, x: hit.x, y: hit.y, z: ground(hit.x, hit.y).h };
  while (samples.length > 1) {
    const s = samples[samples.length - 1];
    if (s.t > impact.t - TERRAIN_CLEAR_S || s.z - ground(s.x, s.y).h < TERRAIN_CLEAR_M) samples.pop();
    else break;
  }
  const last = samples[samples.length - 1];
  last.terrain = true;
  last.impact = impact;
}

// Runs a whole prediction synchronously (node tests). Returns { samples, reason }.
export function predictSync(snap, opts, hf = null) {
  const run = createPredictionRun(snap, opts, hf);
  while (!run.advance(100000));
  return { samples: run.samples, reason: run.reason };
}
