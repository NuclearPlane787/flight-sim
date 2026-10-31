// The page itself in headless Chromium: the performance bar (F3) with the HUD moved down, the
// pause menu, the master volume slider (clicked at 40%), the menu's readout toggle, and both
// settings surviving a reload. Prints what it checked; pictures via snap.cjs.
//   node ui-shots.cjs [outDir]        FS_BASE as in stills.cjs
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
(async () => {
  const out = process.argv[2] || 'ui';
  require('fs').mkdirSync(out, { recursive: true });
  const viewport = { width: 1440, height: 900 };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Frames at 2.5 a second, so SwiftShader keeps up and the pictures get a turn.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  const shot = (name) => snap(page, browser, `${out}/${name}.png`, BASE, viewport).then(() => console.log('shot', name));
  await page.goto(BASE + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
  await page.evaluate(() => { try { localStorage.removeItem('gamedump:flight-sim:settings'); } catch {} });
  await page.waitForTimeout(3000);
  await page.keyboard.press('F3');
  await page.waitForTimeout(4000);
  console.log('bar', JSON.stringify(await page.evaluate(() => ({ text: document.getElementById('perf').textContent,
    fcuTop: document.querySelector('.fsui-fcu').style.top, pfdTop: document.querySelector('.fsui-pfd').style.top }))));
  await shot('perf-bar');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await shot('pause-menu');
  const box = await page.locator('#volume').boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  console.log('volume', JSON.stringify(await page.evaluate(() => ({ shown: document.getElementById('volume-out').textContent,
    synth: window.__fs.synth?.volume, callouts: window.__fs.callouts.volume, saved: localStorage.getItem('gamedump:flight-sim:settings') }))));
  await shot('pause-menu-volume');
  await page.click('#pause [data-act="perf"]');
  console.log('readout off', JSON.stringify(await page.evaluate(() => ({ hidden: document.getElementById('perf').hidden,
    fcuTop: document.querySelector('.fsui-fcu').style.top, button: document.querySelector('#pause [data-act="perf"]').textContent }))));
  await page.click('#pause [data-act="perf"]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  console.log('after a reload', JSON.stringify(await page.evaluate(() => ({ readout: !document.getElementById('perf').hidden,
    volume: document.getElementById('volume-out').textContent, synth: window.__fs.synth?.volume }))));
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
