// v0.5.3: pictures of each type at the airframe sliders' limits in the warehouse (Chrome on the Mac's GPU, its own
// temporary profile, 1440×900): every slider at its top (span 1.3, chord 1.3, +8° sweep, 8° dihedral, tail and fin 1.6,
// plugs +6/+6) and at its bottom (0.8, 0.8, −8°, −3°, 0.6, 0.6, −4/−4), each from the front quarter and from above,
// with the numbers in the side panel; no page errors.
//   python3 tools/cpu-guard.py --minutes 8 -- node tests/browser-warehouse-limits.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const LIM = {
  max: { wing: { span: 1.3, chord: 1.3, sweep: 8, dihedral: 8 }, tail: 1.6, fin: 1.6, plugFwd: 6, plugAft: 6 },
  min: { wing: { span: 0.8, chord: 0.8, sweep: -8, dihedral: -3 }, tail: 0.6, fin: 0.6, plugFwd: -4, plugAft: -4 },
};
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-size=1440,960'] });
const errors = [];
let fails = 0;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const idle = () => page.waitForFunction(() => window.__fsw && window.__fsw.view && !window.__fsw.busy, null, { timeout: 120000 }).then(() => page.waitForTimeout(700));
await page.goto(BASE);
await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
await page.click('[data-k="warehouse"]');
await page.waitForSelector('.fsw:not([hidden])');
for (const base of ['a321neo', 'b787-9', 'b777-300er']) {
  for (const [lim, L] of Object.entries(LIM)) {
    // from the list, as a player opens one (the list closes the editor's view; openEditor() from inside the editor
    // keeps the last base's model)
    await page.evaluate(() => { if (window.__wh.page === 'editor') window.__wh.back(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { if (window.__fsw) window.__fsw.__old = true; });
    const af = await page.evaluate(async ([base, L]) => {
      const D = await import('./src/sim/designs.js');
      const a = D.defaultAirframe(base);
      const d = D.normalizeDesign({ ...D.newDesign(base, { name: `Limits ${base}`, id: `lim-${base}` }), airframe: { ...a, ...L, wingL: { ...L.wing }, wingR: { ...L.wing }, mirror: true } });
      window.__wh.openEditor(d);
      return window.__wh.design.airframe;
    }, [base, L]);
    // the editor makes a new view (asynchronously): wait for it, not the old one
    await page.waitForFunction(() => window.__fsw && !window.__fsw.__old && window.__fsw.view && !window.__fsw.busy, null, { timeout: 120000 });
    await idle();
    const ok = af.tail === L.tail && af.plugAft === L.plugAft && af.wingL.span === L.wing.span;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${base} ${lim}: the airframe in the editor`);
    if (!ok) fails++;
    for (const [view, yaw, pitch, k] of [['quarter', 2.45, 0.30, 1.1], ['above', 1.75, 1.0, 1.0]]) {
      await page.evaluate(([yaw, pitch, k]) => { const v = window.__fsw.view; v.yaw = yaw; v.pitch = pitch; v.dist *= k; window.__fsw.request(); }, [yaw, pitch, k]);
      await page.waitForTimeout(900);
      const got = await page.evaluate(() => window.__fsw.view.pitch);
      if (Math.abs(got - pitch) > 1e-6) { console.log(`FAIL ${base} ${lim} ${view}: the camera didn't take (${got})`); fails++; }
      await page.screenshot({ path: path.join(OUT, `v053-limits-${base}-${lim}-${view}.png`) });
      await page.evaluate((k) => { const v = window.__fsw.view; v.dist /= k; }, k);
    }
    // (v0.5.3 run, the reviewer's finding 4) at −3° dihedral the engines touch the ground standing: Save, not Fly it
    if (lim === 'min') {
      const b = await page.evaluate(() => ({ save: document.querySelector('.fsw [data-a="save"]').disabled, fly: document.querySelector('.fsw [data-a="fly"]').disabled, title: document.querySelector('.fsw [data-a="fly"]').title }));
      const ok2 = !b.save && b.fly && /ground/.test(b.title);
      console.log(`${ok2 ? 'ok  ' : 'FAIL'} ${base} min: Save on, Fly it off (${b.title})`);
      if (!ok2) fails++;
    }
  }
}
// ... and New scenario's Fly refuses it too, with the reason
await page.click('.fsw [data-a="save"]');
await page.waitForTimeout(300);
await page.evaluate(() => { window.__wh.back(); window.__wh.close(); });   // saved, so Back goes straight to the list
await page.waitForSelector('.fsm:not([hidden])', { timeout: 30000 });
await page.click('[data-k="new"]');
await page.waitForSelector('.fsui-setup:not([hidden])');
await page.waitForTimeout(400);
await page.click('.fsui-designs button.fsui-dc:has-text("Limits b777-300er")');
await page.waitForTimeout(400);
const pick = await page.evaluate(() => ({ fly: document.querySelector('.fsui-setup [data-a="fly"]').disabled, msg: document.querySelector('.fsui-foot .msg').textContent }));
const ok3 = pick.fly && /touch the ground/.test(pick.msg);
console.log(`${ok3 ? 'ok  ' : 'FAIL'} New scenario: Fly off for the −3° 777 (${pick.msg})`);
if (!ok3) fails++;
await page.screenshot({ path: path.join(OUT, 'v053-limits-setup-fly-refused.png') });
console.log(errors.length ? `FAIL page errors: ${errors.slice(0, 3).join(' | ')}` : 'ok   no page errors');
if (errors.length) fails++;
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
