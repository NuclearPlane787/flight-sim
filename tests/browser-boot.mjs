// The normal player path, no test hooks used to start: load the page, the setup screen
// appears, Fly starts a flight on the runway, keys work, Esc pauses. Also loads the game
// inside the hub's player (play.html?game=flight-sim) once the registry entry exists.
//
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-boot.mjs

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://localhost:8001/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ROOT + 'games/flight-sim/');
  await page.waitForSelector('[data-a="fly"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'boot-1-setup.png') });
  check('setup screen shown on load', true);
  await page.click('[data-a="fly"]');
  await page.waitForTimeout(1500);
  const s0 = await page.evaluate(() => ({ t: window.__fs.sim.state.t, onGround: window.__fs.sim.state.onGround, paused: window.__fs.paused }));
  check('Fly starts a flight on the ground, running', s0.onGround && !s0.paused, JSON.stringify(s0));
  const order = ['nose', 'orbit', 'captain', 'fo'];
  const v0 = await page.evaluate(() => window.__fs.rig.view.id);
  await page.keyboard.press('Digit8');
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(400);
  const k = await page.evaluate(() => ({ flap: window.__fs.sim.controls.flapLever, view: window.__fs.rig.view.id }));
  const want = order[(order.indexOf(v0) + 1) % 4];
  check('keys reach the game after setup (8 = flaps 2, V = next view)', k.flap === 2 && k.view === want, JSON.stringify({ ...k, from: v0, want }));
  // Real mouse after Fly (the playtester found a hidden full-window layer eating it all):
  // what's under the pointer, the FCU's HDG window by wheel, the camera by swipe, the map.
  const hit = await page.evaluate(() => { const at = (x, y) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName); }; return { centre: at(720, 600), fcu: at(720, 40) }; });
  check('the 3D view gets the pointer after Fly', hit.centre === 'view', JSON.stringify(hit));
  const hdgBox = await page.locator('text=HDG').first().boundingBox();
  const hdg0 = await page.evaluate(() => window.__fs.ap.hdgDeg);
  await page.mouse.move(hdgBox.x + hdgBox.width / 2, hdgBox.y + hdgBox.height + 8);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(30); }
  const hdg1 = await page.evaluate(() => window.__fs.ap.hdgDeg);
  check('mouse wheel over the FCU HDG window changes the heading', hdg1 !== hdg0, `${hdg0} → ${hdg1}`);
  const look0 = await page.evaluate(() => JSON.stringify(window.__fs.rig.looks));
  await page.mouse.move(720, 600);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(60, 0); await page.waitForTimeout(30); }
  const look1 = await page.evaluate(() => JSON.stringify(window.__fs.rig.looks));
  check('two-finger swipe over the 3D view moves the camera', look0 !== look1);
  // v0.2.1: a press and drag with one finger does too (tests/cloud/camera-drag.cjs has the rest).
  await page.mouse.move(720, 600); await page.mouse.down();
  await page.mouse.move(820, 630, { steps: 6 }); await page.mouse.up();
  const look2 = await page.evaluate(() => JSON.stringify(window.__fs.rig.looks));
  check('one-finger drag over the 3D view moves the camera', look2 !== look1);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(500);
  const mapHit = await page.evaluate(() => { const b = [...document.querySelectorAll('#map-root button')].find((x) => /Skip to 15/.test(x.textContent)); if (!b) return 'no button'; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === b ? 'ok' : (e && (e.id || e.className)); });
  check('the map\'s buttons get the pointer', mapHit === 'ok', mapHit);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc opens the pause menu', await page.evaluate(() => window.__fs.paused && !document.getElementById('pause').hidden));
  await page.screenshot({ path: path.join(OUT, 'boot-2-pause.png') });
  await page.keyboard.press('Escape');
  check('no console errors (game)', errors.length === 0, errors.slice(0, 4).join(' || '));

  // Inside the hub's player.
  const hub = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const herr = [];
  hub.on('pageerror', (e) => herr.push(String(e)));
  await hub.goto(ROOT + 'play.html?game=flight-sim');
  await hub.waitForTimeout(6000);
  const frame = hub.frames().find((f) => f.url().includes('games/flight-sim'));
  const inHub = frame ? await frame.evaluate(() => !!document.querySelector('[data-a="fly"]') || !!window.__fs).catch(() => false) : false;
  await hub.screenshot({ path: path.join(OUT, 'boot-3-hub-player.png') });
  check('loads in the hub player', inHub, frame ? frame.url() : 'no flight-sim frame (no registry entry yet?)');
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
