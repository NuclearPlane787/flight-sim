// The golden A321 flight (V030.md, Part 1): a scripted run of the sim from RKSS 14R over the real
// terrain: the take-off, the climb on the autopilot, and 10 minutes on, with the state every
// second. Recorded from v0.2.2's code BEFORE the type registry existed, by
//   node tests/golden-a321-flight.mjs record
// and compared in tests/golden-a321.test.mjs. Never re-record it to make a test pass: it IS
// the definition of "the A321neo doesn't change".
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createSim } from '../src/sim/sim.js';
import { createHeightfield } from '../src/world/heightfield.js';

const DATA = new URL('../data/', import.meta.url);
const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;
export const FIXTURE = new URL('./fixtures/golden-a321.json.gz', import.meta.url);

function loadTerrain() {
  const m = JSON.parse(readFileSync(new URL('manifest.json', DATA), 'utf8'));
  const i16 = (f) => { const b = gunzipSync(readFileSync(new URL(f, DATA))); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
  const n = m.national;
  const patches = (m.patches || []).map((p) => ({ id: p.id, x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, height: i16(p.height) }));
  const airports = (m.airports || []).map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8')));
  return { hf: createHeightfield({ heightScale: m.heightScale, national: { ...n, height: i16(n.height), water: null, cover: null }, patches, coastPatches: [] }, { airports }), airports };
}

const row = (sim) => {
  const s = sim.state, e = s.engines, f = s.surfaces;
  return [s.t, s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.hdg, s.pitch, s.roll, s.p, s.q, s.r, s.alpha, s.beta,
    s.ias, s.mach, s.nz, s.agl, s.mass, s.fuelKg, s.cgX, e[0].n1, e[1].n1, e[0].thrustN, e[0].ffKgS, s.thrustLever, s.leverN1,
    s.slatDeg, s.flapDeg, s.gearPos, f.elevator, f.stab, f.aileronR, f.rudder, s.vls, s.vmax, s.vsw];
};
export const FIELDS = 't x y z vx vy vz hdg pitch roll p q r alpha beta ias mach nz agl mass fuelKg cgX n1L n1R thrL ffL lever leverN1 slat flap gearPos elev stab ail rud vls vmax vsw'.split(' ');

export function fly(createFn = createSim) {
  const { hf, airports } = loadTerrain();
  const rkss = airports.find((a) => a.icao === 'RKSS');
  const r = rkss.runways.find((q) => q.ends.some((e) => e.ident === '14R'));
  const i = r.ends.findIndex((e) => e.ident === '14R');
  const end = r.ends[i], other = r.ends[1 - i];
  const dx = other.x - end.x, dy = other.y - end.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const g = { h: 0, kind: 'runway' };
  const ground = (x, y) => { g.h = hf.heightAt(x, y); g.kind = 'runway'; return g; };
  const sim = createFn({ ground });
  sim.reset({ x: end.x + ux * 45, y: end.y + uy * 45, hdg: Math.atan2(ux, uy), onGround: true, flapLever: 1, gearDown: true, fuelKg: 7500, payloadKg: 180 * 84 + 2000 });
  const s = sim.state, c = sim.controls, ap = sim.ap;
  c.spoilersArmed = true;
  const rows = [];
  const DT = 1 / 120;
  const steps = 120 * (60 + 90 + 600);   // the take-off roll and the climb, then 10 minutes
  let rot = false, gearUp = false, apOn = false, flaps0 = false, climb = false, turned = false;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  for (let k = 0; k < steps; k++) {
    if (k % 120 === 0) rows.push(row(sim));
    if (!apOn) {
      if (k > 120) c.thrust = 1;
      if (s.ias > 146 * KT) rot = true;
      if (rot) c.pitch = clamp(0.3 * ((s.onGround ? 8.5 : 15) - s.pitch / DEG) - 0.1 * s.q / DEG, -1, 1);
    }
    if (rot && !s.onGround && s.agl > 50 * FT && !gearUp) { gearUp = true; c.gearDown = false; }
    if (gearUp && !apOn && s.agl > 400 * FT && sim._core.airTime > 6) {
      apOn = true; c.pitch = 0;
      ap.setHdg(170); ap.setAlt(12000); ap.setSpd(220);
      ap.engageAp(); if (!ap.athr) ap.toggleAthr();
      ap.levelChange(); c.thrust = 25 / 45;
    }
    if (apOn && !flaps0 && s.pos.z > 3000 * FT) { flaps0 = true; c.flapLever = 0; ap.setSpd(250); }
    if (apOn && !turned && s.t > 300) { turned = true; ap.setAlt(9000); ap.setSpd(280); ap.levelChange(); ap.setHdg(200); }
    if (apOn && !climb && s.t > 500) { climb = true; ap.setVs(1200); ap.setAlt(14000); }
    sim.step(DT);
    sim.events.length = 0;
    if (s.crashed) throw new Error('golden flight crashed: ' + s.crashed);
  }
  rows.push(row(sim));
  return { rows, end: { modes: [ap.ap, ap.athr, ap.lateral, ap.vertical, ap.thrustMode], fuelKg: s.fuelKg, altFt: s.pos.z / FT, ias: s.ias / KT } };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'record') {
  const r = fly();
  writeFileSync(FIXTURE, gzipSync(JSON.stringify({ recordedFrom: 'v0.2.2 (7d9a20d), before the type registry', fields: FIELDS, ...r })));
  console.log(r.rows.length, 'rows', JSON.stringify(r.end));
  for (const i of [0, 30, 60, 90, 150, 300, 500, 600, 749]) console.log(i, FIELDS.slice(0, 1) + '=' + r.rows[i][0].toFixed(1), 'z(ft)', (r.rows[i][3] / FT).toFixed(0), 'ias', (r.rows[i][15] / KT).toFixed(0), 'pitch', (r.rows[i][8] / DEG).toFixed(1), 'lever', r.rows[i][26].toFixed(3));
}
