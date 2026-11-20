// v0.6.2: the top row and the panel size, in headless Chromium (SwiftShader). Shane: "The 'hide panels' and 'resume'
// buttons move onto another line and looks awkward. I would say that segment, the autopilot bar, and the view mode
// selector all into one bar", and "an option to the settings that scales up or down the size of the two side panels".
// For each type and window size: the panels switch and Pause, the FCU (MCP) and the view switch in one row, in that
// order, clear of each other and on the screen, in a seat (the F/O's label is the widest), paused (Resume) and with
// the performance readout; the panels under the row and on the screen. Then Settings → Panel size at 50 % and 120 %,
// live, kept after a reload. Pictures of each type at each size.
//   node v062-hud.cjs outDir [types]        FS_BASE as in stills.cjs; V062_SIZES='[{"width":1024,"height":700}]' for some
// (Clicks go through element.click(): Playwright's own click waits on a page SwiftShader keeps busy.)
const { chromium } = require('playwright');
const snap0 = require('./snap.cjs');
const snap = async (...a) => { for (let i = 0; i < 3; i++) { try { return await snap0(...a); } catch (e) { if (i === 2) console.log('no picture:', String(e).split('\n')[0]); } } };
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const SIZES = process.env.V062_SIZES ? JSON.parse(process.env.V062_SIZES)
  : [{ width: 1024, height: 700 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }];
(async () => {
  const out = process.argv[2] || 'hud';
  const types = (process.argv[3] || 'a321neo,b777-300er').split(',');
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0, n = 0;
  const ok = (cond, what) => { n++; if (!cond) bad++; console.log(cond ? 'ok  ' : 'BAD ', what); };
  const open = async (type, viewport, keep = false) => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript((keepIt) => {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      try { if (!keepIt && !sessionStorage.getItem('v062')) { localStorage.removeItem('gamedump:flight-sim:settings'); sessionStorage.setItem('v062', '1'); } } catch {}
    }, keep);
    await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&type=${type}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.hud, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    return { page, errors };
  };
  const row = (page) => page.evaluate(() => {
    const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height,
      shown: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; };
    const fcu = [...document.querySelectorAll('.fsui-fcu')].find((e) => getComputedStyle(e).display !== 'none');
    const bar = document.querySelector('.fsui-topbar');
    return { W: innerWidth, H: innerHeight, bar: R(bar), barCls: bar.className, box: R(document.querySelector('.fsui-panels-box')), fcu: R(fcu),
      views: R(document.querySelector('.fsui-views')), viewsCls: document.querySelector('.fsui-views').className,
      pfd: R(document.querySelector('.fsui-pfd')), nd: R(document.querySelector('.fsui-nd')), eng: R(document.querySelector('.fsui-eng')),
      font: parseFloat(fcu.style.fontSize), pause: document.querySelector('.fsui-pause-btn').textContent, scale: window.__fs.hud.panelScale };
  });
  const oneRow = (w, tag) => {
    const parts = [w.box, w.fcu, w.views];
    const level = parts.every((p) => Math.abs(p.t - parts[0].t) <= 1.5);
    const inOrder = w.box.r <= w.fcu.l - 4 && w.fcu.r <= w.views.l - 4;
    const onScreen = w.box.l >= 0 && w.views.r <= w.W + 0.5 && parts.every((p) => p.t >= 0 && p.b < 140);
    const top = Math.max(...parts.map((p) => p.b));
    const panels = [w.pfd, w.nd, w.eng].every((p) => p.t >= top + 2 && p.b <= w.H + 0.5 && p.l >= 0 && p.r <= w.W + 0.5);
    const apart = w.pfd.r <= w.nd.l - 4;
    ok(level && inOrder && onScreen && panels && apart, `${tag}: one row ${JSON.stringify({ bar: w.barCls, views: w.viewsCls.replace('fsui-views fsui-panel', '').trim(),
      font: +w.font.toFixed(1), box: [Math.round(w.box.l), Math.round(w.box.r)], fcu: [Math.round(w.fcu.l), Math.round(w.fcu.r)],
      views: [Math.round(w.views.l), Math.round(w.views.r)], top: Math.round(parts[0].t), pfd: [Math.round(w.pfd.t), Math.round(w.pfd.w)], nd: Math.round(w.nd.w) })}`
      + (level ? '' : ' NOT LEVEL') + (inOrder ? '' : ' OVERLAP') + (onScreen ? '' : ' OFF SCREEN') + (panels ? '' : ' PANELS') + (apart ? '' : ' PANELS TOUCH'));
    return w;
  };
  for (const type of types) for (const viewport of SIZES) {
    const tag = `${type} ${viewport.width}×${viewport.height}`;
    const { page, errors } = await open(type, viewport);
    oneRow(await row(page), `${tag} 3rd person`);
    await page.keyboard.press('1'); await page.waitForTimeout(1200);
    await page.keyboard.press('1'); await page.waitForTimeout(1500);   // the F/O's seat: the widest view switch
    oneRow(await row(page), `${tag} F/O's seat`);
    await page.evaluate(() => document.querySelector('.fsui-pause-btn').click()); await page.waitForTimeout(1500);
    const p = oneRow(await row(page), `${tag} paused`);
    ok(p.pause === 'Resume', `${tag}: Pause reads ${p.pause}`);
    await snap(page, browser, `${out}/v062-hud-${type}-${viewport.width}.png`, BASE, viewport);
    await page.evaluate(() => document.querySelector('.fsui-pause-btn').click()); await page.waitForTimeout(800);
    if (viewport.width === 1440) {
      await page.keyboard.press('F3'); await page.waitForTimeout(2500);
      const f = oneRow(await row(page), `${tag} with the performance readout`);
      ok(f.bar.t > 20, `${tag}: the readout pushes the row down (top ${Math.round(f.bar.t)})`);
      await page.keyboard.press('F3'); await page.waitForTimeout(1500);
    }
    ok(errors.length === 0, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
  // Settings → Panel size, live, at 1440 × 900 with the A321neo: 100 %, 50 %, 120 %, then kept after a reload.
  {
    const viewport = { width: 1440, height: 900 };
    const { page, errors } = await open('a321neo', viewport);
    const w100 = await row(page);
    await page.evaluate(() => window.__fs.settingsPage.open());
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => { const i = document.querySelector('input[data-s="panelScale"]'); return i ? { v: i.value, min: i.min, max: i.max, out: document.querySelector('output[data-s="panelOut"]').textContent } : null; });
    ok(shown && shown.v === '100' && shown.min === '50' && shown.max === '120' && shown.out === '100%', `Settings has Panel size: ${JSON.stringify(shown)}`);
    const setTo = (v) => page.evaluate((val) => { const i = document.querySelector('input[data-s="panelScale"]'); i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await setTo(50); await page.waitForTimeout(1500);
    const w50 = await row(page);
    ok(Math.abs(w50.pfd.w / w100.pfd.w - 0.5) < 0.03 && w50.scale === 0.5, `50 %: the PFD ${Math.round(w100.pfd.w)} → ${Math.round(w50.pfd.w)} px, scale ${w50.scale}`);
    await setTo(120); await page.waitForTimeout(1500);
    const w120 = await row(page);
    ok(w120.scale === 1.2 && w120.pfd.w > w100.pfd.w * 1.1 && w120.pfd.b <= 900 && w120.eng.b <= 900 && w120.pfd.r < w120.nd.l,
      `120 %: the PFD ${Math.round(w120.pfd.w)} px, the ND ${Math.round(w120.nd.w)} px, on the screen and apart`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gamedump:flight-sim:settings') || '{}').panelScale);
    ok(saved === 1.2, `saved: panelScale ${saved}`);
    await page.evaluate(() => window.__fs.settingsPage.close?.());
    await page.waitForTimeout(800);
    await snap(page, browser, `${out}/v062-panels-120.png`, BASE, viewport);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.hud, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    const again = await row(page);
    ok(again.scale === 1.2 && Math.abs(again.pfd.w - w120.pfd.w) < 1, `after a reload: scale ${again.scale}, the PFD ${Math.round(again.pfd.w)} px`);
    await page.evaluate(() => window.__fs.hud.setPanelScale(0.5));
    await page.waitForTimeout(1200);
    await snap(page, browser, `${out}/v062-panels-50.png`, BASE, viewport);
    ok(errors.length === 0, `panel size: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
  await browser.close();
  console.log(bad ? `${bad} of ${n} FAILED` : `ALL PASS (${n})`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
