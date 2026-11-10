// A keyboard-only landing in Chrome: skip to a 15 nm final for Jeju 07, then fly the
// approach, flare, reverse and brakes with real key events only (W/S/A/D/R/F/G/7–0/Shift+C/
// Space/Z/X), timed by state reads, like a person watching the PFD. Prints the score.
//
// Run from the game folder, through the guard:
//   python3 tools/cpu-guard.py --minutes 15 -- node tests/browser-keyboard-landing.mjs
// Env: E2E_URL (default http://localhost:8001/games/flight-sim/), E2E_OUT (screenshot dir), E2E_XWIND (crosswind in kt, default none).
//
// The AP has no approach or key-selectable V/S mode (it would hold the start altitude), so the
// pilot disconnects AP and A/THR at once and hand-flies the whole final with keys.

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const URL0 = (process.env.E2E_URL || 'http://localhost:8001/games/flight-sim/') +
  '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final';
const FT = 3.28084, KT = 1.943844, DEG = 180 / Math.PI, NM = 1852;
const XWIND = Number(process.env.E2E_XWIND || 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapDeg = (a) => ((a + 540) % 360) - 180;

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL0);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(720, 450); // focus the page (keys go to the window)
  // v0.4.0: a crosswind from the right of the runway. The sim's API sets the weather (no panel yet); the flying is all keys.
  if (XWIND) await page.evaluate(async (kt) => {
    const f = window.__fs, d = f.dest, ax = f.runwayAxis(d.end, d.other);
    const frame = await import(new URL('src/world/frame.js', location.href).href);
    const from = frame.gridToMag(ax.hdg + Math.PI / 2, ax.tx, ax.ty) * 180 / Math.PI;
    f.sim.setWeather({ preset: 'custom', seed: 3, refX: ax.tx, refY: ax.ty, wind: { fromDeg: from, kt, gustKt: 0 }, aloft: { fromDeg: from + 15, kt: kt * 1.5 } });
  }, XWIND);

  // State reads (the numbers a pilot sees on the PFD/ND, in the runway's frame).
  const read = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, d = f.dest, ax = f.runwayAxis(d.end, d.other);
    const rx = s.pos.x - ax.tx, ry = s.pos.y - ax.ty;
    return {
      t: s.t, along: rx * ax.ux + ry * ax.uy, cross: rx * ax.uy - ry * ax.ux, rwyHdg: ax.hdg,
      z: s.pos.z, elev: d.end.elevM ?? d.airport.elevM, agl: s.agl, vs: s.vs, tas: s.tas, ias: s.ias, gs: s.gs,
      vls: s.vls, pitch: s.pitch, roll: s.roll, track: Math.atan2(s.vel.x, s.vel.y), hdg: s.hdg, drift: s.drift || 0, onGround: s.onGround,
      nose: s.wow.nose, lever: s.thrustLever, config: s.config, gearPos: s.gearPos, ap: f.ap.ap, athr: f.ap.athr,
      crashed: s.crashed, flare: s.flare,
    };
  });

  // Non-blocking key presses: down now, up when its time has passed (checked every loop).
  const held = new Map(); // code -> release time (ms), Infinity = until released
  const now = () => Date.now();
  const down = async (code, ms = Infinity) => {
    if (!held.has(code)) await page.keyboard.down(code);
    held.set(code, ms === Infinity ? Infinity : now() + ms);
  };
  const up = async (code) => { if (held.has(code)) { held.delete(code); await page.keyboard.up(code); } };
  const releaseDue = async () => { for (const [c, at] of held) if (now() >= at) await up(c); };
  const tap = (code) => page.keyboard.press(code);

  let r = await read();
  console.log('start', JSON.stringify({ toGoNm: (-r.along / NM).toFixed(1), altFt: Math.round(r.z * FT), ias: Math.round(r.ias * KT), ap: r.ap, athr: r.athr }));
  if (r.ap) await tap('KeyZ');
  if (r.athr) await tap('KeyX');
  await page.keyboard.down('ShiftLeft'); await tap('KeyC'); await page.keyboard.up('ShiftLeft'); // arm ground spoilers

  const next = { path: 0, roll: 0, thr: 0, log: 0, flareTap: 0, gear: 0, decrab: 0 };
  let phase = 'approach', flareStart = 0, tdT = 0, iasPrev = r.ias, tPrev = r.t, iasDot = 0;
  const log = (tag) => console.log(tag, JSON.stringify({ t: +r.t.toFixed(1), toGoNm: +(-r.along / NM).toFixed(2), cross: Math.round(r.cross),
    hErrFt: Math.round((r.z - (r.elev + 15 + Math.tan(3 / DEG) * (-r.along))) * FT), agl: Math.round(r.agl * FT), vs: Math.round(r.vs * 196.85),
    ias: Math.round(r.ias * KT), pitch: +(r.pitch * DEG).toFixed(1), roll: +(r.roll * DEG).toFixed(1), lever: +r.lever.toFixed(2), cfg: r.config, gear: r.gearPos }));

  for (let loops = 0; loops < 20000; loops++) {
    await releaseDue();
    r = await read();
    if (r.crashed) { console.log('CRASH', r.crashed); break; }
    const ms = now();
    if (r.t > tPrev + 0.5) { iasDot = 0.7 * iasDot + 0.3 * (r.ias - iasPrev) / (r.t - tPrev); iasPrev = r.ias; tPrev = r.t; }
    const toGo = -r.along, aglFt = r.agl * FT, vsFpm = r.vs * 196.85, ias = r.ias * KT;
    if (ms >= next.log) { next.log = ms + (aglFt < 100 ? 500 : 5000); log(phase); }

    if (phase === 'approach' || phase === 'flare') {
      // Configuration by distance, and the speed to fly.
      if (toGo < 11 * NM && r.config === '1') await tap('Digit8');
      if (toGo < 9 * NM && r.config === '2' && ias < 184) await tap('Digit9');
      if (toGo < 9 * NM && !next.gear) { next.gear = 1; await tap('KeyG'); } // once: G toggles
      if (toGo < 7 * NM && r.config === '3' && ias < 175) await tap('Digit0');
      const vapp = r.config === 'FULL' && r.vls > 0 ? r.vls * KT + 5 : r.config === '3' ? 150 : r.config === '2' ? 165 : 180;

      // Lateral: bank towards the centreline (tap A/D; the bank holds hands off).
      if (ms >= next.roll && !r.onGround) {
        const trackCmd = r.rwyHdg + clamp(-r.cross * 0.004, -0.25, 0.25);
        const maxBank = aglFt < 200 ? 5 : 15;
        const bankCmd = clamp(wrapDeg((trackCmd - r.track) * DEG) * 2, -maxBank, maxBank);
        const be = bankCmd - r.roll * DEG;
        if (Math.abs(be) > 1.5) { await down(be > 0 ? 'KeyD' : 'KeyA', clamp(60 + Math.abs(be) * 20, 60, 400)); next.roll = ms + 600; }
        else next.roll = ms + 200;
      }

      if (phase === 'approach') {
        // Vertical: the 3° path to the aiming point (≈ 15 m over the threshold), by taps of W/S.
        if (ms >= next.path) {
          const hErr = r.z - (r.elev + 15 + Math.tan(3 / DEG) * toGo);
          const gamma = Math.asin(clamp(r.vs / Math.max(r.tas, 30), -1, 1)) * DEG;
          const gCmd = clamp(-3 - hErr * 0.06, -4.5, -1.5);
          const ge = gCmd - gamma;
          if (Math.abs(ge) > 0.2) { await down(ge > 0 ? 'KeyS' : 'KeyW', clamp(80 + Math.abs(ge) * 200, 80, 450)); next.path = ms + 900; }
          else next.path = ms + 300;
        }
        // Speed: taps of R/F on the thrust levers, with the speed trend.
        if (ms >= next.thr) {
          const se = vapp - (ias + 4 * iasDot * KT);
          if (Math.abs(se) > 2) { await down(se > 0 ? 'KeyR' : 'KeyF', clamp(Math.abs(se) * 25, 50, 500)); next.thr = ms + 1500; }
          else next.thr = ms + 400;
        }
        // v0.4.0: in a crosswind, take the crab off with the rudder from 60 ft (Q/E) and hold the wing down (A/D).
        if (XWIND && aglFt < 60 && ms >= next.decrab) {
          const crab = wrapDeg((r.hdg - r.rwyHdg) * DEG);
          if (Math.abs(crab) > 1) await down(crab > 0 ? 'KeyQ' : 'KeyE', clamp(Math.abs(crab) * 50, 60, 300));
          next.decrab = ms + 300;
        }
        if (aglFt < 30) { phase = 'flare'; flareStart = ms; log('flare'); await up('KeyW'); await down('KeyS', 1200); await down('KeyF'); }
      } else {
        // Flare: one hold of S (above), then taps of S while sinking faster than 300 ft/min.
        // F stays held: the levers come to idle and, on the ground, into reverse.
        if (!r.onGround && ms > flareStart + 1300 && ms >= next.flareTap) {
          if (vsFpm < -300) { await down('KeyS', 250); next.flareTap = ms + 450; }
          else if (vsFpm > 50) { await down('KeyW', 120); next.flareTap = ms + 450; }
        }
        if (XWIND && ms >= next.decrab) {
          const crab = wrapDeg((r.hdg - r.rwyHdg) * DEG);
          if (Math.abs(crab) > 1) await down(crab > 0 ? 'KeyQ' : 'KeyE', clamp(Math.abs(crab) * 50, 60, 300));
          next.decrab = ms + 300;
        }
        if (r.onGround) { phase = 'rollout'; tdT = ms; log('touchdown'); await up('KeyS'); await up('KeyW'); await up('KeyA'); await up('KeyD'); }
      }
    } else if (phase === 'rollout') {
      // Keep straight with the rudder (Q/E), brakes once the nose is down, out of reverse at 70 kt.
      const he = wrapDeg((r.rwyHdg + clamp(-r.cross * 0.01, -0.1, 0.1) - r.track) * DEG);
      if (Math.abs(he) > 0.5 && ms >= next.roll) { await down(he > 0 ? 'KeyE' : 'KeyQ', clamp(Math.abs(he) * 60, 40, 300)); next.roll = ms + 400; }
      if (r.nose && !held.has('Space') && ms > tdT + 1000) await down('Space');
      if (ias < 70 && held.has('KeyF')) { await up('KeyF'); await down('KeyR', 1500); }
      if (r.gs < 0.5) { phase = 'stopped'; log('stopped'); break; }
    }
    await page.waitForTimeout(30);
  }
  for (const c of [...held.keys()]) await up(c);
  await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 60000 }).catch(() => {});
  const score = await page.evaluate(() => window.__fsLastScore || null);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, XWIND ? `v040-keyboard-xwind-${XWIND}kt-card.png` : 'flare-keyboard-landing-score.png') });
  console.log('score', score ? `${score.grade} ${score.points}: ` + score.parts.map((p) => `${p.name} ${p.value}${p.unit}`).join(', ') : 'none');
  console.log('crashed', r.crashed || 'no');
  if (errors.length) console.log('page errors', errors.slice(0, 5));
  if (!score || r.crashed) exitCode = 1;
} catch (e) {
  console.log('SCRIPT ERROR', e);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
