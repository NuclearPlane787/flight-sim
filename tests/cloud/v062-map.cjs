// v0.6.2 in headless Chromium: the map's heading tip over the magenta line, and Gimhae's circling-only 18L and 18R.
//   - Hovering over the magenta line shows "Set HDG ddd° to follow this line", the leg's magnetic heading where the
//     pointer is (on the ground: no wind correction); off the line the tip goes.
//   - A final start to RKPK 18L starts on the runway instead; Skip to final there says why and leaves the aircraft
//     where it was; the map draws no 15 nm final for it ("CIRCLING ONLY"); Change route there says so too.
//   - The setup marks 18L and 18R "circling only" and won't fly a 15 nm final to them.
//   node v062-map.cjs [outDir]        FS_BASE as in stills.cjs
// (Clicks go through element.click(): Playwright's own click waits on a page SwiftShader keeps busy.)
const { chromium } = require('playwright');
const snap0 = require('./snap.cjs');
const snap = async (...a) => { for (let i = 0; i < 3; i++) { try { return await snap0(...a); } catch (e) { if (i === 2) console.log('no picture:', String(e).split('\n')[0]); } } };
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
(async () => {
  const out = process.argv[2] || 'map';
  require('fs').mkdirSync(out, { recursive: true });
  const viewport = { width: 1440, height: 900 };
  const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let bad = 0, n = 0;
  const ok = (cond, what) => { n++; if (!cond) bad++; console.log(cond ? 'PASS' : 'FAIL', what); };
  const open = async (q) => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => {
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 400);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      window.__toasts = [];
    });
    await page.goto(BASE + '?test&' + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    return { page, errors };
  };
  const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map((e) => e.textContent).join(' | '));

  // 1. The heading tip, on the ground at Gimpo for Jeju (no autopilot: no bright path over the line).
  {
    const { page, errors } = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway');
    await page.evaluate(() => window.__fs.map.open());
    await page.waitForTimeout(1500);
    const leg = await page.evaluate(() => {
      const s = window.__fs.sim.state, d = window.__fs.dest.end;
      const x = (s.pos.x + d.x) / 2, y = (s.pos.y + d.y) / 2;
      const want = Math.round(window.__fs.gridToMagDeg(Math.atan2(d.x - s.pos.x, d.y - s.pos.y), x, y)) % 360 || 360;
      return { at: window.__fs.map._devScreen(x, y), want, off: window.__fs.map._devScreen(x + 30000, y - 30000) };
    });
    await page.mouse.move(leg.at[0], leg.at[1]);
    await page.waitForTimeout(800);
    const tip = await page.evaluate(() => { const t = document.querySelector('.fsui-map .fsui-tip, .fsui-tip'); return { text: t.textContent, hidden: t.hidden }; });
    const m = /^Set HDG (\d{3})° to follow this line$/.exec(tip.text);
    ok(!tip.hidden && m && Math.abs(Number(m[1]) - leg.want) <= 1, `over the line: "${tip.text}" (the leg's magnetic heading there: ${String(leg.want).padStart(3, '0')}°)`);
    await snap(page, browser, `${out}/v062-map-tip.png`, BASE, viewport);
    await page.mouse.move(leg.off[0], leg.off[1]);
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => document.querySelector('.fsui-tip').hidden), 'off the line: no tip');
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await page.close();
  }
  // 2. Gimhae 18L: a final start asked for in the address starts on the runway; Skip to final says why.
  {
    const { page, errors } = await open('origin=RKSS&dep=14R&dest=RKPK&arr=18L&start=final');
    const s0 = await page.evaluate(() => ({ onGround: window.__fs.sim.state.onGround, circ: window.__fs.dest.end.circling, ident: window.__fs.dest.end.ident }));
    ok(s0.onGround && s0.circ === true && s0.ident === '18L', `a final start to RKPK 18L starts on the runway: ${JSON.stringify(s0)}`);
    const p0 = await page.evaluate(() => [window.__fs.sim.state.pos.x, window.__fs.sim.state.pos.y]);
    await page.evaluate(() => window.__fs.skipToFinal());
    await page.waitForTimeout(1500);
    const p1 = await page.evaluate(() => [window.__fs.sim.state.pos.x, window.__fs.sim.state.pos.y]);
    const said = await toastText(page);
    ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 5 && /no straight-in approach/.test(said) && /36R/.test(said), `Skip to final stays and says why: "${said.slice(0, 160)}"`);
    await page.evaluate(() => window.__fs.map.open());
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__fs.map.openRoute('RKPK'));
    await page.waitForTimeout(800);
    const note = await page.evaluate(() => document.querySelector('.fsui-route-note').textContent);
    ok(/Circling only/.test(note), `Change route at Gimhae (18L, the destination): "${note.slice(0, 140)}"`);
    await snap(page, browser, `${out}/v062-map-circling.png`, BASE, viewport);
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await page.close();
  }
  // 3. The setup: 18L and 18R say "circling only", and a 15 nm final to one is refused.
  {
    const { page, errors } = await open('origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway');
    // (show() returns a promise of the plan, settled by Fly or Cancel: not awaited here)
    await page.evaluate(() => { window.__fs.setup.show({ origin: 'RKSS', depRunway: '14R', dest: 'RKPK', arrRunway: '18L', start: 'final' }); });
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => {
      const sel = document.querySelector('[data-f="arrRunway"]');
      return { opts: [...sel.options].map((o) => o.textContent), value: sel.value, msg: document.querySelector('[data-o="msg"]')?.textContent || '',
        fly: document.querySelector('[data-a="fly"]').disabled };
    });
    ok(st.opts.some((t) => /18L .*circling only/.test(t)) && st.opts.some((t) => /18R .*circling only/.test(t)) && !st.opts.some((t) => /36L .*circling/.test(t)),
      `the runways: ${st.opts.join(' / ')}`);
    ok(st.value === '18L' && /no straight-in approach/.test(st.msg) && st.fly, `a 15 nm final to 18L: "${st.msg}", Fly ${st.fly ? 'off' : 'on'}`);
    await page.evaluate(() => { const s = document.querySelector('[data-f="arrRunway"]'); s.value = '36L'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(800);
    const st2 = await page.evaluate(() => ({ msg: document.querySelector('[data-o="msg"]')?.textContent || '', fly: document.querySelector('[data-a="fly"]').disabled }));
    ok(!/straight-in/.test(st2.msg) && !st2.fly, `36L instead: "${st2.msg}", Fly ${st2.fly ? 'off' : 'on'}`);
    await snap(page, browser, `${out}/v062-setup-circling.png`, BASE, viewport);
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await page.close();
  }
  await browser.close();
  console.log(bad ? `${bad} of ${n} FAILED` : `ALL PASS (${n})`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
