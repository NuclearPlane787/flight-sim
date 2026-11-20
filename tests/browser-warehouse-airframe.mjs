// v0.5.3: the warehouse's airframe in Chrome (its own temporary profile), at 1440×900, with ?airframe=1: a click on the
// wing, the tailplane, the fin and the fuselage selects each (its sliders in the side panel); a slider dragged by the
// mouse shows the ghost outline and is one undo step (Z, Shift+Z); Mirror off reshapes one side; the numbers change;
// Esc lets go; Save keeps the airframe. Pictures v053-wh-*.png in Claude outputs/flight-sim/.
//   python3 tests/cloud/serve.py <GameDump folder> 8014 &
//   python3 tools/cpu-guard.py --minutes 10 -- node tests/browser-warehouse-airframe.mjs
// PW: the playwright module (default /tmp/flight-sim/pw/node_modules/playwright/index.mjs).
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const HEADED = process.argv.includes('--headed') || process.env.FS_HEADLESS === '0';   // headless by default (no window on Shane's screen); --headed or FS_HEADLESS=0 for one
process.argv = process.argv.filter((a) => a !== '--headed');   // so positional arguments never see it

const { chromium } = await import(pathToFileURL(process.env.PW || '/tmp/flight-sim/pw/node_modules/playwright/index.mjs').href);
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.E2E_OUT || path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const TYPE = process.env.WH_TYPE || 'a321neo';
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED, args: ['--mute-audio', ...(HEADED ? [] : ['--use-angle=metal', '--ignore-gpu-blocklist']), '--window-size=1440,960'] });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `v053-wh-${name}.png`) }); console.log('shot', `v053-wh-${name}.png`); };
  const idle = async () => {
    await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && window.__fsw && window.__fsw.view && !window.__fsw.busy; }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  };
  const W = '/games/flight-sim/src/ui/warehouse.js';
  // a point on the design's outline, on the screen
  const outlinePoint = (what) => page.evaluate(async ([W, what]) => {
    const M = await import(W), d = window.__wh.design, O = M.afOutline(d.base, d.airframe);
    const mid = (P, k) => { const n = P.length / 2, a = P[k], b = P[k + 1], ta = P[2 * n - 1 - k], tb = P[2 * n - 2 - k];
      return [0.25 * (a[0] + b[0] + ta[0] + tb[0]), 0.25 * (a[1] + b[1] + ta[1] + tb[1]), 0.25 * (a[2] + b[2] + ta[2] + tb[2])]; };
    const p = what === 'wingL' ? mid(O.wingL, 1) : what === 'wingR' ? mid(O.wingR, 1) : what === 'tail' ? mid(O.tailR, 0) : what === 'fin' ? mid(O.fin, 0)
      : [O.bodyTop[0][0] - 6, 0, 0];
    if (what === 'body') { const s = window.__fsw.project(p[0], -1.2, 0.5); return s; }
    return window.__fsw.project(...p);
  }, [W, what]);
  const selected = () => page.evaluate(() => window.__wh.selectedAirframe);
  const af = () => page.evaluate(() => window.__wh.design.airframe);
  const nums = () => page.$$eval('.fsw [data-o="nums"] .fsw-num', (e) => Object.fromEntries(e.map((x) => [x.dataset.n, `${x.querySelector('b').textContent}|${x.className.split(' ')[1]}`])));
  // drag a range input's thumb by the mouse from its value to a fraction of its track; `during` runs mid-drag
  const dragSlider = async (k, frac, during) => {
    const box = await page.$eval(`.fsw [data-af="${k}"]`, (e) => { const r = e.getBoundingClientRect(); const v = (e.value - e.min) / (e.max - e.min); return { x: r.left, y: r.top + r.height / 2, w: r.width, v }; });
    const x0 = box.x + 8 + box.v * (box.w - 16), x1 = box.x + 8 + frac * (box.w - 16);
    await page.mouse.move(x0, box.y); await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, box.y, { steps: 6 });
    await page.mouse.move(x1, box.y, { steps: 6 });
    await page.waitForTimeout(250);
    if (during) await during();
    await page.mouse.up();
    await page.waitForTimeout(200);
    // (v0.5.3 run) a screenshot taken mid-drag in headed Chrome fires lostpointercapture, which ends a range input's
    // native drag where it was (a Playwright artefact: a player's drag isn't photographed). Finish it with a clean drag.
    if (during) {
      const want = await page.$eval(`.fsw [data-af="${k}"]`, (e, f) => +e.min + f * (e.max - e.min), frac);
      const got = await page.$eval(`.fsw [data-af="${k}"]`, (e) => +e.value);
      // only if the shot cut it short: take the short drag back (one undo step), then drag again, so it stays one step
      if (Math.abs(got - want) > 0.03 * Math.abs(want || 1)) { await page.keyboard.press('z'); await page.waitForTimeout(300); await dragSlider(k, frac); }
    }
  };

  await page.goto(BASE + '?warehouse=1&airframe=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  await page.click(`.fsw [data-new="${TYPE}"]`);
  await idle();
  check('the airframe is on (?airframe=1)', await page.evaluate(() => window.__wh.airframeOn));
  const n0 = await nums();
  // (v0.5.3 run: on the base's own airframe v0.5.2's CG row stays beside the margin; a changed airframe drops it, checked below)
  check('the airframe\'s rows (and v0.5.2\'s CG row on the base\'s airframe)', !!n0.margin && !!n0.cg && !!n0.cnb && !!n0.stall && !!n0.span, Object.keys(n0).join(','));
  await shot(`${TYPE}-01-new`);

  // ---- the wing ----
  let s = await outlinePoint('wingR');
  await page.mouse.move(s.x, s.y, { steps: 4 }); await page.waitForTimeout(250);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(300);
  check('a click on the wing selects it', (await selected())?.what === 'wing', JSON.stringify(await selected()));
  check('the wing\'s sliders in the panel', (await page.$$('.fsw [data-af]')).length === 5);   // v0.5.6 added Position to span, chord, sweep, dihedral
  await shot(`${TYPE}-02-wing`);
  let buildDuring = null;
  await dragSlider('span', 0.9, async () => {
    buildDuring = await page.evaluate(() => ({ key: window.__fsw.builtKey, polys: window.__fsw.info().overlay }));
    await shot(`${TYPE}-03-wing-ghost`);
  });
  await idle();
  const a1 = await af();
  check('the drag changed the span on both sides (Mirror)', a1.wingL.span > 1.15 && a1.wingR.span === a1.wingL.span, a1.wingL.span);
  const k1 = await page.evaluate(() => window.__fsw.builtKey);
  const buildMs = await page.evaluate(() => window.__fsw.buildMs);
  check('the model rebuilt on release', k1 !== buildDuring.key || buildMs <= 20, `build ${buildMs.toFixed(1)} ms`);
  const n1 = await nums();
  check('the numbers changed (span, stall)', n1.span !== n0.span && n1.stall !== n0.stall, `${n1.span} · ${n1.stall}`);
  check('a changed airframe: the margin, no CG against the base', !!n1.margin && !n1.cg, Object.keys(n1).join(','));
  await shot(`${TYPE}-04-wing-long`);
  await page.keyboard.press('z'); await page.waitForTimeout(200);
  check('Z undoes the whole drag', (await af()).wingL.span === 1);
  await page.keyboard.press('Shift+Z'); await page.waitForTimeout(200);
  check('Shift+Z redoes it', (await af()).wingL.span === a1.wingL.span);
  // Mirror off: the right wing alone
  await page.click('.fsw [data-afm="mirror"]'); await page.waitForTimeout(200);
  await dragSlider('sweep', 1);
  const a2 = await af();
  check('Mirror off: the clicked (right) side alone', a2.mirror === false && a2.wingR.sweep > 6 && a2.wingL.sweep === 0, `${a2.wingL.sweep} / ${a2.wingR.sweep}`);
  await idle();
  await shot(`${TYPE}-05-wing-one-side`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Esc lets go of the wing', (await selected()) === null && (await page.evaluate(() => window.__wh.page)) === 'editor');

  // ---- the tailplane ----
  s = await outlinePoint('tail');
  await page.mouse.click(s.x, s.y); await page.waitForTimeout(300);
  let sa = await selected();
  if (sa?.what !== 'tailplane') { console.log('  (the tailplane by its point missed:', JSON.stringify(sa), ')'); }
  check('a click on the tailplane selects it', sa?.what === 'tailplane', JSON.stringify(sa));
  if (sa?.what !== 'tailplane') await page.evaluate(() => window.__wh.selectAirframe('tailplane', -1));
  const m0 = (await nums()).margin;
  await dragSlider('tail', 0.0, () => shot(`${TYPE}-06-tail-ghost`));
  await idle();
  const m1 = (await nums()).margin;
  check('a smaller tailplane: less static margin', parseFloat(m1) < parseFloat(m0), `${m0} → ${m1}`);
  await shot(`${TYPE}-07-tail`);

  // ---- the fin: from the side ----
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const v = window.__fsw.view; v.yaw = Math.PI / 2 + 0.25; v.pitch = 0.12; window.__fsw.request(); });
  await page.waitForTimeout(400);
  s = await outlinePoint('fin');
  // (v0.5.3 run: the 777's long body puts its tail under the parts palette from this side: turn until the fin's clear of it)
  for (let k = 0; k < 6 && s.x < 230; k++) {
    await page.evaluate(() => { const v = window.__fsw.view; v.yaw += 0.12; window.__fsw.request(); });
    await page.waitForTimeout(300);
    s = await outlinePoint('fin');
  }
  await page.mouse.click(s.x, s.y); await page.waitForTimeout(300);
  sa = await selected();
  check('a click on the fin selects it', sa?.what === 'fin', JSON.stringify(sa));
  if (sa?.what !== 'fin') await page.evaluate(() => window.__wh.selectAirframe('fin'));
  await dragSlider('fin', 0.0);
  await idle();
  const n3 = await nums();
  check('a smaller fin: Cnβ down (amber)', n3.cnb.endsWith('warn') || n3.cnb.endsWith('bad'), n3.cnb);
  await shot(`${TYPE}-08-fin`);

  // ---- the fuselage ----
  await page.keyboard.press('Escape');
  s = await outlinePoint('body');
  await page.mouse.click(s.x, s.y); await page.waitForTimeout(300);
  sa = await selected();
  check('a click on the fuselage selects it', sa?.what === 'body', JSON.stringify(sa));
  if (sa?.what !== 'body') await page.evaluate(() => window.__wh.selectAirframe('body'));
  await dragSlider('plugAft', 1, () => shot(`${TYPE}-09-body-ghost`));
  await dragSlider('plugFwd', 0.8);
  await idle();
  const a4 = await af(), n4 = await nums();
  check('the plugs', a4.plugAft > 5 && a4.plugFwd > 3, `${a4.plugFwd} / ${a4.plugAft}`);
  check('the tail strike with the plugs', /base/.test(n4.tail), n4.tail);
  await page.evaluate(() => { const v = window.__fsw.view; v.yaw = 140 * Math.PI / 180; v.pitch = 0.3; window.__fsw.request(); });
  await page.waitForTimeout(400);
  await shot(`${TYPE}-10-body`);
  // undo all the way: the base
  for (let i = 0; i < 12; i++) await page.keyboard.press('z');
  await page.waitForTimeout(300);
  const a5 = await af();
  check('Z back to the base airframe', a5.tail === 1 && a5.fin === 1 && a5.plugAft === 0 && a5.wingR.sweep === 0, JSON.stringify(a5));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Z');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  // ---- Save ----
  await page.click('.fsw [data-a="save"]');
  await page.waitForTimeout(300);
  const savedAf = (await page.evaluate(() => { const L = JSON.parse(localStorage.getItem('gamedump:flight-sim:designs') || '[]'); const id = window.__wh.design.id; return (L.find((d) => d.id === id) || {}).airframe; }));
  check('Save keeps the airframe', !!savedAf && savedAf.plugAft > 5 && savedAf.tail < 1 && savedAf.mirror === false, JSON.stringify(savedAf));
  await idle();
  const info = await page.evaluate(() => ({ ...window.__fsw.info(), buildMs: window.__fsw.buildMs }));
  console.log('view', JSON.stringify(info));
  await shot(`${TYPE}-11-saved`);
  // ---- v0.5.3, end to end (the run): Fly it, New scenario with it picked, Fly; fly; exit to the menu (it saves);
  // reload the page; Load the scenario: the same airframe, flying on, its model the design's ----
  const savedName = await page.evaluate(() => window.__wh.design.name);
  await page.click('.fsw [data-a="fly"]');
  await page.waitForSelector('.fsui-setup:not([hidden])', { timeout: 20000 });
  const picked = await page.evaluate(() => { const c = document.querySelector('.fsui-setup [data-design][aria-pressed="true"]'); return c ? c.textContent.trim().slice(0, 60) : null; });
  check('Fly it opens New scenario with the design picked', !!picked && picked.includes(savedName), picked);
  await page.click('.fsui-setup [data-a="fly"]');
  await page.waitForFunction((n) => window.__fs && window.__fs.sim && window.__fs.sim.design && window.__fs.sim.design.name === n, savedName, { timeout: 120000 });
  const flown = await page.evaluate(() => { const f = window.__fs; return { af: JSON.stringify(f.sim.design.airframe), parts: !!f.sim.type.data.PARTS_AERO, shape: !!f.sim.type.geo.AIRFRAME }; });
  check('Fly flies the airframe made in the warehouse', flown.af === JSON.stringify(savedAf) && flown.parts && flown.shape, flown.af);
  await page.waitForTimeout(4000);
  await page.evaluate(() => { const f = window.__fs; f.rig.viewId = 'orbit'; Object.assign(f.rig.looks.orbit, { yaw: 2.4, pitch: 0.25, dist: f.sim.type.orbitDist * 1.1 }); });
  await page.waitForTimeout(1500);
  await shot(`${TYPE}-12-flown`);
  const before = await page.evaluate(() => { const f = window.__fs, s = f.sim.state; f.exitToMenu(); return { t: s.t, x: s.pos.x, y: s.pos.y }; });
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  const back = await page.evaluate((name) => {
    const f = window.__fs, list = f.scenarios.list().slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const sc = list[0]; f.loadScenario(sc.id); f.setPaused(true, true);
    const s = f.sim.state;
    return { name: f.sim.design?.name, af: JSON.stringify(f.sim.design?.airframe), t: s.t, x: s.pos.x, y: s.pos.y, shape: !!f.sim.type.geo.AIRFRAME };
  }, savedName);
  check('the reloaded scenario has the same airframe, where it was', back.name === savedName && back.af === flown.af && back.shape && Math.abs(back.t - before.t) < 1e-9 && Math.hypot(back.x - before.x, back.y - before.y) < 1e-6, JSON.stringify({ ...back, af: undefined }));
  await page.evaluate(() => { window.__fs.setPaused(false); });
  await page.waitForTimeout(1500);
  await shot(`${TYPE}-13-reloaded`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL', e.stack || e);
  fails++;
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
