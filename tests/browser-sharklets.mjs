// v0.5.3 (the run's extra time): the A321's sharklets off in the warehouse, in Chrome on the Mac's GPU (1440×900):
// the wing's panel has the switch, clicking it takes them off the model (the span reads 34 m), Z puts them back, Save,
// then the design flies from the runway on the autopilot (pictures: the wingtip in the editor, on and off; in flight).
//   python3 tools/cpu-guard.py --minutes 10 -- node tests/browser-sharklets.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HEADED = process.argv.includes('--headed') || process.env.FS_HEADLESS === '0';   // headless by default (no window on Shane's screen); --headed or FS_HEADLESS=0 for one
process.argv = process.argv.filter((a) => a !== '--headed');   // so positional arguments never see it

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FS_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', ...(HEADED ? [] : ['--use-angle=metal', '--ignore-gpu-blocklist']), '--window-size=1440,960'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
await page.click('[data-k="warehouse"]');
await page.waitForSelector('.fsw:not([hidden])');
await page.evaluate(async () => {
  const D = await import('./src/sim/designs.js');
  window.__wh.openEditor(D.normalizeDesign(D.newDesign('a321neo', { name: 'No sharklets', id: 'chk-sharklets' })));
});
const idle = () => page.waitForFunction(() => window.__fsw && window.__fsw.view && !window.__fsw.busy, null, { timeout: 120000 }).then(() => page.waitForTimeout(800));
await idle();
await page.evaluate(() => window.__wh.selectAirframe('wing', 1));
await page.waitForTimeout(300);
const tipView = async (name) => {
  await page.evaluate(() => { const v = window.__fsw.view; v.yaw = 2.45; v.pitch = 0.12; v.dist *= 1.0; window.__fsw.request(); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `v053-sharklets-${name}.png`) });
  await page.evaluate(() => { const v = window.__fsw.view; v.dist /= 1.0; });
};
const box = await page.$('.fsw [data-afm="sharklets"]');
check('the wing panel has the Sharklets switch, on', !!box && await box.isChecked());
await tipView('on');
const spanOn = await page.evaluate(() => document.querySelector('.fsw [data-o="span"]')?.textContent || '');
await page.click('.fsw [data-afm="sharklets"]');
await idle();
const st = await page.evaluate(() => ({ sh: window.__wh.design.airframe.sharklets, span: document.querySelector('.fsw [data-o="span"]')?.textContent || '',
  row: [...document.querySelectorAll('.fsw *')].map((e) => e.textContent).find((t) => /Wingspan/.test(t) && t.length < 120) || '' }));
check('clicked off: the design has none', st.sh === false, JSON.stringify(st));
await page.evaluate(() => window.__wh.selectAirframe('wing', 1));
await page.waitForTimeout(300);
await tipView('off');
await page.keyboard.press('KeyZ'); await page.waitForTimeout(400);
check('Z puts them back', await page.evaluate(() => window.__wh.design.airframe.sharklets === true));
await page.keyboard.press('Shift+KeyZ'); await page.waitForTimeout(400);
check('Shift+Z takes them off again', await page.evaluate(() => window.__wh.design.airframe.sharklets === false));
await idle();
await page.click('.fsw [data-a="save"]'); await page.waitForTimeout(400);
const saved = await page.evaluate(() => { const L = JSON.parse(localStorage.getItem('gamedump:flight-sim:designs') || '[]'); return (L.find((d) => d.id === window.__wh.design.id) || {}).airframe?.sharklets; });
check('saved without sharklets', saved === false, String(saved));
// fly it, in a test page of its own (the saved design): from Gimpo 14R
const page2 = await ctx.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway&fuel=12000`);
await page2.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 90000 });
await page2.waitForTimeout(800);
const r = await page2.evaluate(async () => {
  const f = window.__fs;
  f.clock.set(Date.UTC(2026, 9, 31, 6, 0)); f.clock.setRunning(false);
  const L = JSON.parse(localStorage.getItem('gamedump:flight-sim:designs') || '[]'), d = L.find((x) => x.id === 'chk-sharklets');
  const D = await import('./src/sim/designs.js'), def = D.designDef(d);
  f.startFlight({ origin: 'RKSS', depRunway: '14R', dest: 'RKPC', arrRunway: '07', start: 'runway', pax: def.defaults.pax, cargoKg: def.defaults.cargoKg, fuelKg: 12000, waypoints: [], type: 'a321neo', design: d }, { keepClock: true });
  return { span: def.geo.DESIGN_SHAPE?.spanM, design: f.sim.design?.airframe?.sharklets };
});
check('flying the design', r.design === false && Math.abs(r.span - 34.0) < 0.15, JSON.stringify(r));
// a scripted take-off in the page's sim (browser-airframe.mjs's): TOGA, rotate at VR, gear up, 70 s
const flown = await page2.evaluate(() => {
  const f = window.__fs, sim = f.sim, c = sim.controls, KT = 0.514444, D2R = Math.PI / 180;
  c.parkingBrake = false; c.thrust = 1;
  const T = sim.type.data, vr = 1.12 * (sim.state.vls || 140 * KT), target = Math.min(12, T.PITCH_TAILSTRIKE_DEG - 3) * D2R;
  let rotated = false;
  for (let i = 0; i < 120 * 70; i++) {
    const s = sim.state;
    if (!rotated && s.ias > vr) rotated = true;
    const want = s.onGround ? target : 12 * D2R;
    c.pitch = rotated ? Math.max(-0.4, Math.min(0.4, (want - s.pitch) * 3)) : 0;
    if (!s.onGround && s.agl > 15) c.gearDown = false;
    sim.step(1 / 120);
    if (s.crashed) break;
  }
  const s = sim.state;
  return { agl: Math.round(s.agl), ias: Math.round(s.ias / KT), crashed: !!s.crashed, onGround: s.onGround };
});
check('takes off and climbs, nothing crashed', !flown.crashed && !flown.onGround && flown.agl > 300, JSON.stringify(flown));
await page2.evaluate(() => { const f = window.__fs; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: 2.4, pitch: 0.12, dist: f.sim.type.orbitDist * 0.8 }); });
await page2.waitForTimeout(1500);
await page2.screenshot({ path: path.join(OUT, 'v053-sharklets-flying.png') });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
