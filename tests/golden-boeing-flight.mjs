// The Boeings' golden flights (V050.md, Part 1): the A321's golden flight (tests/golden-a321-flight.mjs) for the
// 787-9 and the 777-300ER: a scripted run of the sim from RKSS 14R over the real terrain: the take-off, the climb on
// the autopilot, and 10 minutes on, with the state every second. Recorded from v0.4.4's pushed code (d484689),
// BEFORE the parts model, by
//   node tests/golden-boeing-flight.mjs record b787-9
//   node tests/golden-boeing-flight.mjs record b777-300er
// and compared in tests/golden-boeing.test.mjs. They record the Boeings as they are, the late lift-off included
// (ROADMAP, "Found while building v0.4.4"). Never re-record one to make a test pass: they ARE the definition of
// "the 787-9 and the 777-300ER don't change".
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createSim } from '../src/sim/sim.js';
import { createHeightfield } from '../src/world/heightfield.js';

const DATA = new URL('../data/', import.meta.url);
const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180;
export const fixtureOf = (type) => new URL(`./fixtures/golden-${type}.json.gz`, import.meta.url);

// Each type's script: its take-off flaps (lever index), VR, the lift-off and climb attitudes, and its load.
export const SCRIPT = {
  'b787-9': { flapTo: 4, flapUp: 0, vrKt: 150, thetaGround: 8, thetaAir: 13, fuelKg: 30000, payloadKg: 25000 },
  'b777-300er': { flapTo: 4, flapUp: 0, vrKt: 158, thetaGround: 8, thetaAir: 12, fuelKg: 40000, payloadKg: 30000 },
};

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
    s.ias, s.mach, s.nz, s.agl, s.mass, s.fuelKg, s.cgX, e[0].n1, e[1].n1, e[0].thrustN, e[1].thrustN, e[0].ffKgS, s.thrustLever, s.leverN1,
    s.slatDeg, s.flapDeg, s.gearPos, f.elevator, f.stab, f.aileronR, f.rudder, s.vls, s.vmax, s.vsw];
};
export const FIELDS = 't x y z vx vy vz hdg pitch roll p q r alpha beta ias mach nz agl mass fuelKg cgX n1L n1R thrL thrR ffL lever leverN1 slat flap gearPos elev stab ail rud vls vmax vsw'.split(' ');

// make(opts) → a sim of the type (the test passes a design's sim here once designs exist).
export function fly(type, make = (o) => createSim({ ...o, type })) {
  const P = SCRIPT[type];
  const { hf, airports } = loadTerrain();
  const rkss = airports.find((a) => a.icao === 'RKSS');
  const r = rkss.runways.find((q) => q.ends.some((e) => e.ident === '14R'));
  const i = r.ends.findIndex((e) => e.ident === '14R');
  const end = r.ends[i], other = r.ends[1 - i];
  const dx = other.x - end.x, dy = other.y - end.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const g = { h: 0, kind: 'runway' };
  const ground = (x, y) => { g.h = hf.heightAt(x, y); g.kind = 'runway'; return g; };
  const sim = make({ ground });
  sim.reset({ x: end.x + ux * 60, y: end.y + uy * 60, hdg: Math.atan2(ux, uy), onGround: true, flapLever: P.flapTo, gearDown: true, fuelKg: P.fuelKg, payloadKg: P.payloadKg });
  const s = sim.state, c = sim.controls, ap = sim.ap;
  c.spoilersArmed = true;
  const rows = [];
  const DT = 1 / 120;
  const steps = 120 * (75 + 90 + 600);   // the take-off roll and the climb, then 10 minutes
  let rot = false, gearUp = false, apOn = false, flaps0 = false, climb = false, turned = false;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  for (let k = 0; k < steps; k++) {
    if (k % 120 === 0) rows.push(row(sim));
    if (!apOn) {
      if (k > 120) c.thrust = 1;
      if (s.ias > P.vrKt * KT) rot = true;
      if (rot) c.pitch = clamp(0.35 * ((s.onGround ? P.thetaGround : P.thetaAir) - s.pitch / DEG) - 0.5 * s.q / DEG, -1, 1);
    }
    if (rot && !s.onGround && s.agl > 50 * FT && !gearUp) { gearUp = true; c.gearDown = false; }
    if (gearUp && !apOn && s.agl > 400 * FT && sim._core.airTime > 6) {
      apOn = true; c.pitch = 0;
      ap.setHdg(170); ap.hdgSel(); ap.setAlt(12000); ap.setSpd(220);
      if (!ap.athr) ap.toggleAthr();
      ap.engageAp();
      ap.levelChange();
    }
    if (apOn && !flaps0 && s.pos.z > 3000 * FT) { flaps0 = true; c.flapLever = P.flapUp; ap.setSpd(250); }
    if (apOn && !turned && s.t > 300) { turned = true; ap.setAlt(9000); ap.setSpd(280); ap.levelChange(); ap.setHdg(200); }
    if (apOn && !climb && s.t > 500) { climb = true; ap.setVs(1200); ap.setAlt(14000); }
    sim.step(DT);
    sim.events.length = 0;
    if (s.crashed) throw new Error(`golden ${type} flight crashed: ${s.crashed}`);
  }
  rows.push(row(sim));
  return { rows, end: { modes: [ap.ap, ap.athr, ap.lateral, ap.vertical, ap.thrustMode], fuelKg: s.fuelKg, altFt: s.pos.z / FT, ias: s.ias / KT } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, type] = process.argv.slice(2);
  if (!SCRIPT[type]) throw new Error('type: ' + Object.keys(SCRIPT).join(' or '));
  const r = fly(type);
  if (cmd === 'record') writeFileSync(fixtureOf(type), gzipSync(JSON.stringify({ recordedFrom: 'v0.4.4 (d484689), before the parts model', type, fields: FIELDS, ...r })));
  console.log(type, r.rows.length, 'rows', JSON.stringify(r.end));
  for (const i of [0, 30, 45, 60, 90, 150, 300, 500, 600, r.rows.length - 1]) {
    const w = r.rows[i];
    console.log(i, 't=' + w[0].toFixed(1), 'z(ft)', (w[3] / FT).toFixed(0), 'agl', (w[18] / FT).toFixed(0), 'ias', (w[15] / KT).toFixed(0), 'pitch', (w[8] / DEG).toFixed(1), 'hdg', (w[7] / DEG).toFixed(0), 'lever', w[27].toFixed(3), 'flap', w[30].toFixed(1));
  }
}

// v0.5.0 (the Cowork review): the worst difference between two flights, absolute below 1 and relative above it.
// The fixtures were recorded with macOS's node; Linux's (the Mac's VM, the cloud container) flies the same
// flights to within roundoff: from 1e-18 at 8 s to about 5e-13 of the value at most, but the thrust, about
// 1e5 N, then differs by about 2e-9 N, past an absolute 1e-9. A real change shows as 1e-6 and more.
export function goldenWorst(gold, now, fields) {
  let worst = 0, where = '';
  gold.rows.forEach((row, i) => row.forEach((v, j) => {
    const d = Math.abs(v - now.rows[i][j]) / Math.max(1, Math.abs(v));
    if (d > worst) { worst = d; where = `${fields ? fields[j] : j} at row ${i}`; }
  }));
  return { worst, where };
}
