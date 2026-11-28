// v0.8.0 (part 7) in Chrome: the hydraulics' and the flaps' alerts on the screens. The A321 in flight with green
// lost, then green and yellow (the warning, also at 1280×720); the A321 with the flaps jammed at 1 and the lever at
// FULL; the 787-9 with the left and centre systems lost. In each: the master lights, the checklist's steps, the alert
// list and a picture of the cockpit (the engine display's hydraulics boxes in it).
//   node tests/browser-v080-p7.mjs [--base URL] [--out DIR]
// Pictures "v080-p7-<what>.png" in --out (default: GameDump's "Claude outputs/flight-sim"). Last line: "done N of M".
import { chromium } from './pw.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/');
const OUT = opt('--out', path.resolve(here, '../../../Claude outputs/flight-sim'));
let pass = 0, total = 0;
const check = (ok, what) => { total++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + what); };

const profile = mkdtempSync(path.join(tmpdir(), 'fs-v080-p7-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = (what) => page.screenshot({ path: path.join(OUT, `v080-p7-${what}.png`) }).then(() => console.log(`  picture v080-p7-${what}.png`));
  const st = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state;
    return { alerts: (f.alerts.list || []).map((a) => `${a.level}:${a.title}`), lit: JSON.stringify(f.alerts.lit), law: s.law,
      p: s.hyd.p.map((x) => +x.toFixed(2)), on: s.hyd.on, rat: s.hyd.rat, flap: s.flapDeg, slat: s.slatDeg, crashed: s.crashed,
      steps: [...document.querySelectorAll('[data-step]')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)) };
  });
  const arm = (kind, target) => page.evaluate(async ([k, t]) => {
    const F = await import(new URL('src/sim/failures.js', location.href).href), sim = window.__fs.sim;
    sim.setFailures(F.armed(sim.failures, { kind: k, target: t, when: { type: 'now' } }, sim.state.t, 12345));
  }, [kind, target]);
  const fly = (altFt, kt, lever) => page.evaluate(([a, v, l]) => {
    const f = window.__fs, s = f.sim.state;
    f.sim.reset({ x: s.pos.x, y: s.pos.y, hdg: s.hdg, onGround: false, z: a * 0.3048, iasMs: v * 0.514444, flapLever: l, gearDown: false, fuelKg: 9000, payloadKg: 12000,
      ap: { ap: true, athr: true, hdgDeg: s.hdg * 180 / Math.PI, altFt: a } });
    f.ap.setSpd?.(v); f.input.lever = f.sim.controls.thrust;
  }, [altFt, kt, lever]);
  const load = async (type) => {
    await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&type=${type}&view=captain`);
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.alerts && window.__fs.frames > 60, null, { timeout: 90000 });
    await page.evaluate((ms) => window.__fs.clock.set(ms), zoneMs(2026, 11, 19, 14, 0, 0, zoneOfIcao('RKSS')));
  };
  const short = (s) => `alerts ${s.alerts.join(', ')}; lights ${s.lit}; p ${s.p}; law ${s.law}; steps: ${s.steps.slice(0, 6).join(' / ')}`;

  // ---- the A321: green, then green and yellow ----
  await load('a321neo');
  await fly(12000, 250, 0); await page.waitForTimeout(2500);
  let s = await st();
  check(s.alerts.length === 0 && !s.on, 'A321 in flight, nothing failed: no alerts, the hydraulics normal: ' + short(s));
  await arm('hyd-sys', 0); await page.waitForTimeout(5000);
  s = await st();
  check(s.alerts.includes('caution:HYD G SYS LO PR') && /caution":true/.test(s.lit), 'A321 green lost: the caution and its light: ' + short(s));
  console.log('  the checklist shown: ' + s.steps.join(' / '));
  await shot('a321-green-lost');
  await arm('hyd-sys', 2); await page.waitForTimeout(6000);
  s = await st();
  check(s.alerts[0] === 'warning:HYD G + Y SYS LO PR' && /warning":true/.test(s.lit), 'A321 green and yellow: the warning first, MASTER WARN lit: ' + short(s));
  check(s.law === 'alternate' || s.law === 'direct', 'the law: ' + s.law);
  await shot('a321-green-yellow');
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(1200);
  await shot('a321-green-yellow-1280'); await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(600);
  await page.evaluate(() => window.__fs.sim.repair('all')); await page.waitForTimeout(6000);
  s = await st();
  check(!s.alerts.some((a) => /HYD/.test(a)), 'repaired: the hydraulics alerts gone: ' + short(s));

  // ---- the A321: flaps jammed at 1, the lever at FULL ----
  await fly(3000, 180, 1); await page.waitForTimeout(1500);
  await arm('flaps-jam', 0);
  await page.evaluate(() => { window.__fs.sim.controls.flapLever = 4; }); await page.waitForTimeout(8000);
  s = await st();
  check(s.alerts.includes('caution:F/CTL FLAPS LOCKED'), `A321 flaps jammed (flaps ${s.flap.toFixed(0)}°, slats ${s.slat.toFixed(0)}°), lever FULL: ` + short(s));
  console.log('  the checklist shown: ' + s.steps.join(' / '));
  await shot('a321-flaps-jam');

  // ---- the 787-9: left and centre ----
  await load('b787-9');
  await fly(12000, 250, 0); await page.waitForTimeout(2500);
  await arm('hyd-sys', 0); await arm('hyd-sys', 1); await page.waitForTimeout(6000);
  s = await st();
  check(s.alerts.includes('caution:HYD PRESS SYS L') && s.alerts.includes('caution:HYD PRESS SYS C') && s.alerts.includes('caution:FLIGHT CONTROL MODE'),
    '787-9 left and centre: a caution each and FLIGHT CONTROL MODE: ' + short(s));
  check(s.law === 'secondary', '787-9 law: ' + s.law);
  await shot('b787-left-centre');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
} catch (e) {
  check(false, 'the script ran to its end: ' + String(e).slice(0, 600));
} finally {
  await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* in use */ }
}
console.log(`done ${pass} of ${total}`);
process.exit(0);
