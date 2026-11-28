// v0.8.0 (warn): the failure warnings in the real game, one short run: on the A321 and the 787-9, at 1440×900 and
// 1280×720, with "Hide panels" off and on: an engine fire's lights (dark before, lit after), the checklist panel
// clear of the PFD and the engine display and inside the window, a light's click putting it out, a step clicked
// doing its action, a click on the engine display's switch flipping it, the fold and the tab. Pictures
// v080-warn-<what>.png in GameDump/Claude outputs/flight-sim/.
//   node games/flight-sim/tests/browser-v080-warn.mjs        (the lead's server on 8014; prints "done N of M" last)
import { chromium } from './pw.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const GAME = ROOT + 'games/flight-sim/';
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  for (const [type, W, H] of [['a321neo', 1440, 900], ['b787-9', 1280, 720]]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${GAME}?test&origin=RKSS&dep=14R&dest=RJTT&arr=34L&start=final&type=${type}`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames !== undefined && document.getElementById('loading').hidden && window.__fsAlerts, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__fs.sim.state.t > 2, null, { timeout: 60000 });
    const tag = `${type}-${W}`;
    const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || e.style.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
    const lit = () => page.evaluate(() => ({ ...window.__fsAlerts.lit, panel: !!document.querySelector('.fsal-panel') }));
    let l = await lit();
    check(`${tag}: nothing failed: lights dark, no panel`, !l.warning && !l.caution && !l.panel);
    // An engine fire, now (seed 8: neither bottle puts it out, so it stays for the checks).
    await page.evaluate(async () => {
      const f = window.__fs, F = await import('./src/sim/failures.js');
      f.sim.setFailures(F.armed(f.sim.failures, { kind: 'eng-fire', target: 0, when: { type: 'now' } }, f.sim.state.t, 8));
    });
    await page.waitForFunction(() => window.__fsAlerts.lit.warning && document.querySelector('.fsal-panel'), null, { timeout: 10000 });
    await page.evaluate(() => window.__fs.setPaused(true));
    await page.waitForTimeout(300);
    l = await lit();
    check(`${tag}: fire: MASTER WARN lit, the panel open`, l.warning && l.panel);
    const title = await page.evaluate(() => document.querySelector('.fsal-title')?.textContent);
    check(`${tag}: the panel's title`, title === (type === 'a321neo' ? 'ENG 1 FIRE' : 'FIRE ENG L'), title);
    for (const hidden of [false, true]) {
      if (hidden) { await page.click('.fsui-panels-btn'); await page.waitForTimeout(300); }
      const P = await rect('.fsal-panel'), pfd = await rect('.fsui-pfd'), eng = await rect('.fsui-eng'), L = await rect('.fsal-lights');
      const inside = P && P.x >= 0 && P.y >= 0 && P.x + P.w <= W && P.y + P.h <= H;
      check(`${tag} panels ${hidden ? 'hidden' : 'shown'}: the checklist inside the window, clear of the PFD and the engine display`, inside && !overlap(P, pfd) && !overlap(P, eng) && !overlap(L, pfd) && !overlap(L, eng), JSON.stringify({ P, pfd, eng, L }));
      await page.screenshot({ path: path.join(OUT, `v080-warn-${tag}-fire${hidden ? '-hidden' : ''}.png`) });
      if (hidden) { await page.click('.fsui-panels-btn'); await page.waitForTimeout(300); }
    }
    // The light's click: out; the panel stays.
    await page.click('[data-alert="warn"]');
    l = await lit();
    check(`${tag}: a click on the light puts it out, the checklist stays`, !l.warning && l.panel);
    // The engine display's switch, clicked on the canvas: engine 1 off.
    const pt = await page.evaluate(() => window.__fsAlerts.switchPoint(0));
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(150);
    const sw = await page.evaluate(() => window.__fs.sim.state.engines[0].sw);
    check(`${tag}: the engine display's switch, clicked, cuts engine 1 off`, sw === false, JSON.stringify(pt));
    // The checklist's next step: the fire push, clicked.
    await page.click('.fsal-steps button[data-act="firePush"]');
    await page.waitForTimeout(150);
    check(`${tag}: FIRE PUSH clicked in the checklist`, await page.evaluate(() => window.__fs.sim.state.engines[0].pushed));
    await page.click('.fsal-steps button[data-act="fireAgent"]');
    await page.waitForTimeout(400);
    check(`${tag}: AGENT 1 clicked`, (await page.evaluate(() => window.__fs.sim.state.engines[0].agents)) === 1);
    await page.screenshot({ path: path.join(OUT, `v080-warn-${tag}-steps.png`) });
    const focus = await page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
    check(`${tag}: the keyboard stays on the flight`, focus);
    // Fold and open again.
    await page.click('[data-fold="fold"]');
    const folded = await page.evaluate(() => document.querySelector('.fsal-panel').hidden && !document.querySelector('.fsal-tab').hidden);
    await page.screenshot({ path: path.join(OUT, `v080-warn-${tag}-folded.png`) });
    await page.click('[data-fold="open"]');
    const opened = await page.evaluate(() => !document.querySelector('.fsal-panel').hidden);
    check(`${tag}: fold to a tab and open again`, folded && opened);
    check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
}
console.log(`done ${results.filter(Boolean).length} of ${results.length}`);
