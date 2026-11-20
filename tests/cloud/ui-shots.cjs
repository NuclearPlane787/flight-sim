// The page itself in headless Chromium: the performance readout (F3) with the top row moved down under it, the
// pause menu, Settings (the master volume at 40 %, the readout off from there), and both kept after a reload.
// v0.6.2: rewritten with checks (the old script had looked for v0.1.3's #volume slider and a readout button in the
// pause menu, both gone since v0.2.0's menu; it printed instead of checking). Pictures via snap.cjs.
//   node ui-shots.cjs [outDir]        FS_BASE as in stills.cjs
// (Clicks go through element.click(): Playwright's own click waits on a page SwiftShader keeps busy.)
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
(async () => {
  const out = process.argv[2] || 'ui';
  require('fs').mkdirSync(out, { recursive: true });
  const viewport = { width: 1440, height: 900 };
  const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let bad = 0, n = 0;
  const ok = (cond, what) => { n++; if (!cond) bad++; console.log(cond ? 'PASS' : 'FAIL', what); };
  // Frames at 2.5 a second, so SwiftShader keeps up and the pictures get a turn.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    try { if (!sessionStorage.getItem('ui')) { localStorage.removeItem('gamedump:flight-sim:settings'); sessionStorage.setItem('ui', '1'); } } catch {}
  });
  const shot = (name) => snap(page, browser, `${out}/${name}.png`, BASE, viewport).then(() => console.log('shot', name)).catch((e) => console.log('no picture', name, String(e).split('\n')[0]));
  const where = () => page.evaluate(() => {
    const b = (q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect() : null; };
    return { perf: !document.getElementById('perf').hidden, perfText: document.getElementById('perf').textContent, bar: b('.fsui-topbar').top,
      barBottom: b('.fsui-topbar').bottom, pfd: b('.fsui-pfd').top, perfBottom: document.getElementById('perf').hidden ? 0 : b('#perf').bottom };
  });
  const click = (q) => page.evaluate((sel) => document.querySelector(sel).click(), q);
  await page.goto(BASE + '?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const w0 = await where();
  ok(!w0.perf && Math.round(w0.bar) === 8 && w0.pfd >= w0.barBottom, `no readout: the top row at ${Math.round(w0.bar)} px, the PFD under it (${Math.round(w0.pfd)})`);
  await page.keyboard.press('F3');
  await page.waitForTimeout(4000);
  const w1 = await where();
  ok(w1.perf && /fps/.test(w1.perfText), `F3: the readout shows (${w1.perfText.slice(0, 60)}…)`);
  ok(w1.bar >= w1.perfBottom - 1 && w1.bar > w0.bar && w1.pfd >= w1.barBottom, `the top row moves down under it (${Math.round(w0.bar)} → ${Math.round(w1.bar)} px), the PFD under the row`);
  await shot('perf-bar');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => !document.getElementById('pause').hidden && window.__fs.menuOpen && !window.__fs.paused), 'Esc: the pause menu, which doesn\'t pause');
  await shot('pause-menu');
  await click('#pause [data-act="settings"]');
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => !!document.querySelector('.fsm-settings') && !!document.querySelector('input[data-s="volume"]')), 'Settings opens from the menu');
  await page.evaluate(() => { const i = document.querySelector('input[data-s="volume"]'); i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(800);
  const vol = await page.evaluate(() => ({ shown: document.querySelector('output[data-s="volOut"]').textContent, callouts: window.__fs.callouts.volume,
    saved: JSON.parse(localStorage.getItem('gamedump:flight-sim:settings') || '{}').volume }));
  ok(vol.shown === '40%' && Math.abs(vol.callouts - 0.4) < 1e-9 && Math.abs(vol.saved - 0.4) < 1e-9, `the master volume at 40 %: ${JSON.stringify(vol)}`);
  await click('[data-seg="perf"] button[data-v="off"]');
  await page.waitForTimeout(1500);
  const w2 = await where();
  ok(!w2.perf && Math.round(w2.bar) === 8, `the readout off from Settings: the row back at ${Math.round(w2.bar)} px`);
  await shot('settings');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__fs.settingsPage.open());
  await page.waitForTimeout(800);
  const kept = await page.evaluate(() => ({ readout: !document.getElementById('perf').hidden, volume: document.querySelector('output[data-s="volOut"]').textContent, callouts: window.__fs.callouts.volume }));
  ok(!kept.readout && kept.volume === '40%' && Math.abs(kept.callouts - 0.4) < 1e-9, `after a reload: ${JSON.stringify(kept)}`);
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
  console.log(bad ? `${bad} of ${n} FAILED` : `ALL PASS (${n})`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
