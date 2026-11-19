// V060.md Part 3 by night, short (the guard's slots are shared): for each airport given, with EAST_ASIA_ON on, the clock
// at 22:00 local (Japan and Korea UTC+9, China UTC+8): a gate start, the aircraft lined up on the longest ILS runway,
// and a 3 nm final to it (placed directly, paused for the picture). Checks the world's runway and taxiway light count
// (world.stats.lights) at each, and no console errors. The real-time taxi, take-off and landing are the day check's
// (browser-v060-airports.mjs).
// Pictures "Claude outputs/flight-sim/v060-<icao>-{gate,runway,final}-night.png".
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 8 -- node games/flight-sim/tests/browser-v060-night.mjs ZSPD RJTT RJAA
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { standList } from '../src/ground/gate-flow.js';
import { standHeading } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const ICAOS = process.argv.slice(2).map((s) => s.toUpperCase());
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const profile = mkdtempSync(path.join(tmpdir(), 'fs-v060-night-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const icao of ICAOS) {
    const errors = [];
    const onC = (m) => { if (m.type() === 'error') errors.push(m.text()); }, onE = (e) => errors.push(String(e));
    page.on('console', onC); page.on('pageerror', onE);
    const ap = JSON.parse(readFileSync(path.join(here, `../data/airports/${icao}.json`), 'utf8'));
    const rw = ap.runways.filter((r) => r.ends.some((e) => e.ils)).sort((p, q) => q.lengthM - p.lengthM)[0];
    const arr = rw.ends.find((e) => e.ils).ident;
    // main.js starts at a gate only with a stand: the first gate the setup offers the A321neo
    for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) { st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360; st.hdgFixed = true; }
    const want = standList(ap, typeById('a321neo')).find((x) => x.gate).ref;
    const ms = Date.UTC(2026, 10, 19, 22 - (icao.startsWith('Z') ? 8 : 9), 0, 0);
    const t0 = Date.now();
    await page.goto(`${BASE}?test&eastasia=1&origin=${icao}&dep=${arr}&dest=${icao}&arr=${arr}&start=gate&stand=${encodeURIComponent(want)}&view=orbit`);
    await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 30, null, { timeout: 60000 })
      .catch(async (e) => { console.log('  state:', await page.evaluate(() => JSON.stringify({ fs: !!window.__fs, phase: window.__fs?.gate?.phase, frames: window.__fs?.frames, err: document.querySelector('#error, .error')?.textContent }))); console.log('  errors:', errors.slice(0, 4).join(' || ')); throw e; });
    await page.getByText('Hide panels').click({ timeout: 3000 }).catch(() => {});
    const look = (yaw, pitch, dist) => page.evaluate(([y, p, d]) => { const L = window.__fs.rig.looks.orbit; L.yaw = y; L.pitch = p; L.dist = d; }, [yaw, pitch, dist]);
    const shot = async (what) => {
      await page.evaluate((m) => window.__fs.clock.set(m), ms);
      await page.waitForTimeout(2500);
      await page.evaluate(() => { if (window.__fs.paused) window.__fs.renderOnce?.(); });
      const lights = await page.evaluate(() => window.__fs.world.stats.lights);
      await page.screenshot({ path: path.join(OUT, `v060-${icao.toLowerCase()}-${what}-night.png`) });
      return lights;
    };
    const plan = (start) => ({ origin: icao, depRunway: arr, dest: icao, arrRunway: arr, start, pax: 180, cargoKg: 2000, fuelKg: 7500, waypoints: [] });

    await look(0.7, 0.5, 110);
    const stand = await page.evaluate(() => window.__fs.gate.stand?.ref);
    const lg = await shot('gate');
    check(`${icao} night: gate start at stand ${stand}, lights on`, lg > 0, `${lg} runway and taxiway lights`);

    await page.evaluate((p) => window.__fs.startFlight(p), plan('runway'));
    await page.waitForTimeout(1500);
    await look(0, 0.18, 70);
    const lr = await shot('runway');
    const onRw = await page.evaluate(() => window.__fs.sim.state.onGround);
    check(`${icao} night: lined up on ${arr}, lights on`, onRw && lr > 0, `${lr} lights`);

    await page.evaluate((p) => window.__fs.startFlight(p), plan('final'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => {   // 3 nm out on the 3 deg path, landing flaps and gear, 140 kt; paused for the picture
      const fs = window.__fs, d = fs.dest, ax = fs.runwayAxis(d.end, d.other), D = 3 * 1852;
      const s = fs.sim.state;
      fs.sim.reset({ x: ax.tx - ax.ux * D, y: ax.ty - ax.uy * D, z: (d.end.elevM ?? d.airport.elevM) + 15 + Math.tan(3 * Math.PI / 180) * D,
        hdg: ax.hdg, onGround: false, iasMs: 140 / 1.943844, flapLever: 4, gearDown: true, fuelKg: s.fuelKg, payloadKg: s.payloadKg });
      fs.sim.controls.flapLever = 4; fs.sim.controls.gearDown = true;
      fs.sim.setLocalQnh();   // (the reset above drops the altimeter's setting and unit: the picture shows the local ones)
      fs.setPaused(true);
    });
    await look(0.25, 0.12, 90);
    await page.evaluate(() => window.__fs.renderOnce?.());
    const lf = await shot('final');
    check(`${icao} night: 3 nm final to ${arr}, lights on`, lf > 0, `${lf} lights`);
    await page.evaluate(() => window.__fs.setPaused(false));
    check(`${icao} night: no console errors`, errors.length === 0, errors.slice(0, 3).join(' || '));
    page.off('console', onC); page.off('pageerror', onE);
    console.log(`  ${icao}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} catch (e) {
  console.log('FAIL exception', e.message);
  results.push(false);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\nnight ${ICAOS.join(' ')}: ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
