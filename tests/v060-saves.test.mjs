// v0.6.0 (V060.md, "Saves stay exact"): a flight saved at Haneda, at Pudong or at Gimhae, over the
// region's terrain with the local rules installed, comes back from JSON into a fresh sim and
// flies on identically for 120 s (within 1e-6 m), in the air on the approach and on the take-off
// roll, with each country's altimeter unit and weather carried along. And a v0.5.8 save (no
// `baroIn`) loads and flies as it did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createTiledHeightfield } from '../src/world/heightfield.js';
import { setEastAsia, terrainSpec, rulesAt } from '../src/world/region.js';
import { gridToMag } from '../src/world/frame.js';
import { presetWeather, weatherContext, PRESETS } from '../src/sim/weather-presets.js';
import { run, KT, FT, DEG } from './sim-helpers.mjs';
import { manifest, readGz, readJson, DATA } from './tile-terrain.mjs';
import { loadNodeRules } from './v060-rules-helpers.mjs';

const m = manifest();
const HAVE = !!m.tilesRegion;
setEastAsia(true);
loadNodeRules();
const airports = HAVE ? terrainSpec(m, true).airports.map((f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'))) : [];
const hf = HAVE ? await createTiledHeightfield(m, DATA.href, { region: true, airports, readGz, readJson, layers: ['h'], airportTiles: true, maxTiles: 200 }) : null;
const g = { h: 0, kind: 'ground' };
// (The surface is a runway wherever it is land, as the golden flights' ground: these rolls stay on the runway.)
const ground = (x, y) => { g.h = hf.heightAt(x, y); g.kind = g.h > 0 ? 'runway' : 'water'; return g; };
const viaJson = (o) => JSON.parse(JSON.stringify(o));

function endOf(icao, ident) {
  const a = airports.find((q) => q.icao === icao);
  const r = a.runways.find((q) => q.ends.some((e) => e.ident === ident));
  const i = r.ends.findIndex((e) => e.ident === ident), end = r.ends[i], other = r.ends[1 - i];
  const L = Math.hypot(other.x - end.x, other.y - end.y), ux = (other.x - end.x) / L, uy = (other.y - end.y) / L;
  return { a, end, other, ux, uy, hdg: Math.atan2(ux, uy) };
}
function same(a, b, tol, label) {
  const sa = a.state, sb = b.state;
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(sa.pos[k] - sb.pos[k]) <= tol, `${label}: pos.${k} ${sa.pos[k]} vs ${sb.pos[k]}`);
  for (const k of ['hdg', 'pitch', 'roll', 'gs', 'vs', 'fuelKg', 't', 'mass', 'altInd']) assert.ok(Math.abs(sa[k] - sb[k]) <= tol, `${label}: ${k} ${sa[k]} vs ${sb[k]}`);
  assert.deepEqual(viaJson(a.snapshot()), viaJson(b.snapshot()), `${label}: snapshots identical`);
}

// A gusty crosswind preset (its id from the game's list).
const WX = (PRESETS.find((p) => /gust/i.test(p.id)) || PRESETS[PRESETS.length - 1]).id;
const CASES = [['RJTT', '34L', 'JP', 'inHg'], ['ZSPD', '34L', 'CN', 'hPa'], ['RKPK', '36L', 'KR', 'hPa']];

for (const [icao, ident, country, unit] of CASES) {
  test(`saves: an approach to ${icao} ${ident} in weather, saved and restored, flies on identically`, { skip: !HAVE }, async () => {
    const R = endOf(icao, ident);
    const dist = 9 * 1852;
    const x = R.end.x - R.ux * dist, y = R.end.y - R.uy * dist, z = R.end.elevM + 15 + Math.tan(3 * DEG) * dist;
    await hf.tiles.whenReady(x, y, 30000, 'test');
    assert.equal(rulesAt(x, y).country, country);
    const a = createSim({ ground });
    // A gusty crosswind with turbulence, set for this arrival: the wind's turn by place is in play.
    // (Placed first: setWeather() reads the ground where the sim is, for the wind it shows.)
    const ic = { x, y, z, hdg: R.hdg, onGround: false, iasMs: 170 * KT, flapLever: 2, gearDown: true, fuelKg: 6000, payloadKg: 15000 };
    a.reset(ic);
    a.setWeather(presetWeather(WX, weatherContext(airports, { dest: icao, arrRunway: ident })));
    assert.ok(a.weather && a.weather.wind.kt > 10 && a.weather.turbulence !== 'none', 'the weather is on');
    a.reset(ic);
    a.setLocalQnh();
    assert.equal(!!a.baro.inHg, unit === 'inHg', `the local unit at ${icao}`);
    a.ap.setHdg(Math.round(gridToMag(R.hdg, x, y) / DEG) % 360 || 360);
    a.ap.setAlt(Math.round(a.state.altInd / FT / 100) * 100 - 1500); a.ap.setSpd(160);
    a.ap.engageAp(); if (!a.ap.athr) a.ap.toggleAthr();
    a.ap.levelChange?.();
    run(a, 45);
    assert.ok(!a.state.crashed && !a.state.onGround, 'still flying');
    const snap = viaJson(a.snapshot());
    const b = createSim({ ground });
    b.restore(snap);
    assert.equal(!!b.baro.inHg, unit === 'inHg', 'the unit comes back');
    run(a, 120); run(b, 120);
    same(a, b, 1e-6, `${icao} after 120 s`);
    assert.equal(hf.tiles.misses, 0);
  });

  test(`saves: a take-off roll at ${icao} ${ident}, saved and restored, lifts off identically`, { skip: !HAVE }, () => {
    const R = endOf(icao, ident);
    const pilot = (sim) => {
      const s = sim.state, c = sim.controls;
      c.thrust = 1;
      c.pitch = s.ias > 148 * KT ? (s.pitch < 12 * DEG ? 0.6 : 0) : 0;
      if (s.agl > 50 * FT) c.gearDown = false;
    };
    const a = createSim({ ground });
    a.reset({ x: R.end.x + R.ux * 60, y: R.end.y + R.uy * 60, hdg: R.hdg, onGround: true, flapLever: 1, gearDown: true, fuelKg: 8000, payloadKg: 17000 });
    assert.ok(Math.abs(a.state.pos.z - a.state.agl - R.end.elevM) < 3 || a.state.onGround, 'standing on the runway');
    run(a, 18, pilot);
    assert.ok(a.state.onGround && a.state.gs > 20, 'rolling');
    const b = createSim({ ground });
    b.restore(viaJson(a.snapshot()));
    run(a, 70, pilot); run(b, 70, pilot);
    assert.ok(!a.state.onGround && a.state.agl > 100, `airborne (${a.state.agl.toFixed(0)} m)`);
    same(a, b, 1e-6, `${icao} after lift-off`);
  });
}

test('saves: a v0.5.8 snapshot (no altimeter unit in it) restores in hPa and flies as the original', { skip: !HAVE }, () => {
  const R = endOf('RKSS', '14R');
  const a = createSim({ ground });
  a.reset({ x: R.end.x - R.ux * 15000, y: R.end.y - R.uy * 15000, z: 1200, hdg: R.hdg, onGround: false, iasMs: 180 * KT, flapLever: 1, gearDown: false, fuelKg: 7000, payloadKg: 15000 });
  a.ap.engageAp(); if (!a.ap.athr) a.ap.toggleAthr();
  run(a, 20);
  const snap = viaJson(a.snapshot());
  const old = viaJson(snap);
  delete old.core.baroIn;                      // as v0.5.8 wrote it
  const b = createSim({ ground });
  b.restore(old);
  assert.ok(!b.baro.inHg);
  run(a, 120); run(b, 120);
  same(a, b, 1e-6, 'a v0.5.8 save after 120 s');
});
