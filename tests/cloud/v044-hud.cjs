// v0.4.4: the view switch in the cockpit (top right, never the bottom centre) and the panels switch
// (top left: hides the PFD, ND and engine panel, not the FCU or MCP). For each type and window size:
// where the switch and the FCU are, then pictures in the cockpit with the panels shown and hidden.
//   node v044-hud.cjs outDir [types]        FS_BASE as in stills.cjs; V044_SIZES='[{"width":1024,"height":700}]' for some sizes only
const { chromium } = require('playwright');
const snap0 = require('./snap.cjs');
const snap = async (...a) => { for (let i = 0; i < 3; i++) { try { return await snap0(...a); } catch (e) { if (i === 2) console.log('no picture:', String(e).split('\n')[0]); } } };
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
(async () => {
  const out = process.argv[2] || 'hud';
  const types = (process.argv[3] || 'a321neo,b777-300er').split(',');
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0;
  for (const type of types) for (const viewport of (process.env.V044_SIZES ? JSON.parse(process.env.V044_SIZES) : [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 700 }])) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      try { if (!sessionStorage.getItem('v044')) { localStorage.removeItem('gamedump:flight-sim:settings'); sessionStorage.setItem('v044', '1'); } } catch {}
    });
    await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&type=${type}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    const tag = `${type}-${viewport.width}`;
    const where = () => page.evaluate(() => {
      const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), shown: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }; };
      const v = document.querySelector('.fsui-views');
      return { views: r('.fsui-views'), cls: v.className, fcu: [...document.querySelectorAll('.fsui-fcu, .fsui-mcp')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), shown: true }; })[0] || null, pfd: r('.fsui-pfd'), nd: r('.fsui-nd'), eng: r('.fsui-eng'), toggle: r('.fsui-panels-btn'), W: innerWidth, H: innerHeight };
    });
    for (const key of ['1', '1']) {           // the captain's seat, then the first officer's
      await page.keyboard.press(key);
      await page.waitForTimeout(1500);
      const w = await where();
      const fcuR = w.fcu ? w.fcu.r : 0;
      const topRight = w.views.t < 80 && w.views.r > w.W - 40;
      const clearOfFcu = w.views.l >= fcuR + 6 || w.views.t >= (w.fcu ? w.fcu.b : 0);
      const ndClear = !w.nd || w.views.b <= w.nd.t || w.views.r <= w.nd.l;
      const ok = topRight && clearOfFcu && ndClear && !/\blow\b/.test(w.cls);
      if (!ok) bad++;
      console.log(ok ? 'ok ' : 'BAD', tag, 'seat', JSON.stringify({ cls: w.cls, views: w.views, fcu: w.fcu, nd: w.nd && { t: w.nd.t, l: w.nd.l } }));
    }
    await snap(page, browser, `${out}/${tag}-cockpit.png`, BASE, viewport);
    // The panels switch.
    const t = await where();
    if (!t.toggle) { console.log('BAD', tag, 'no panels switch'); bad++; }
    else {
      const overlaps = t.fcu && t.toggle.r > t.fcu.l && t.toggle.t < t.fcu.b;
      console.log(overlaps ? 'BAD' : 'ok ', tag, 'panels switch', JSON.stringify(t.toggle));
      if (overlaps) bad++;
      const cx = (t.toggle.l + t.toggle.r) / 2, cy = (t.toggle.t + t.toggle.b) / 2;
      console.log('    at its centre:', await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + e.className : 'nothing'; }, [cx, cy]));
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(1200);
      const h = await where();
      const hidden = !h.pfd.shown && !h.nd.shown && !h.eng.shown && h.fcu.shown && h.views.shown;
      console.log(hidden ? 'ok ' : 'BAD', tag, 'hidden', JSON.stringify({ pfd: h.pfd.shown, nd: h.nd.shown, eng: h.eng.shown, fcu: h.fcu.shown, views: h.views.shown }));
      if (!hidden) bad++;
      await snap(page, browser, `${out}/${tag}-wide.png`, BASE, viewport);
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
      await page.waitForTimeout(2500);
      const k = await where();
      const kept = !k.pfd.shown && !k.nd.shown;
      console.log(kept ? 'ok ' : 'BAD', tag, 'still hidden after a reload');
      if (!kept) bad++;
      const k2 = await where();
      await page.mouse.click((k2.toggle.l + k2.toggle.r) / 2, (k2.toggle.t + k2.toggle.b) / 2);
      await page.waitForTimeout(1200);
      const s = await where();
      const back = s.pfd.shown && s.nd.shown && s.eng.shown;
      console.log(back ? 'ok ' : 'BAD', tag, 'shown again');
      if (!back) bad++;
    }
    if (errors.length) { console.log('BAD', tag, 'errors', errors.slice(0, 3)); bad++; }
    await page.close();
  }
  await browser.close();
  console.log(bad ? `${bad} BAD` : 'all ok');
  process.exit(bad ? 1 : 0);
})();
