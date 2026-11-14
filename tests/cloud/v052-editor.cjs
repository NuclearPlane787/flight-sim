// v0.5.2: the Warehouse editor's flows, from the cloud (headless Chromium, SwiftShader, 1440×900): parts from the
// palette attached under and over the wing, on the rear fuselage, tanks and ballast; select, drag, undo and redo
// (Z, Shift+Z), a slider's drag as one step, Delete, no engines (Save off), lopsided thrust, Mirror, Save.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v052-editor.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v052-editor';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(ROOT + 'flight-sim/?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  const idle = async () => {
    await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && window.__fsw && window.__fsw.view && !window.__fsw.busy; }, null, { timeout: 120000 });
    await page.waitForTimeout(400);
  };
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
  const design = () => page.evaluate(() => document.querySelector('.fsw') && window.__wh?.design);
  // geometry point → screen
  const at = (x, y, z) => page.evaluate(([x, y, z]) => window.__fsw.project(x, y, z), [x, y, z]);
  const A = async (expr) => page.evaluate(`(async () => { const D = await import('/games/flight-sim/src/sim/designs.js'); const a = D.airframe('a321neo'); return (${expr}); })()`);
  await page.click('.fsw [data-new="a321neo"]');
  await idle();
  await shot('01-new');
  const nParts = () => page.evaluate(() => document.querySelectorAll('.fsw [data-sel]').length);
  const engines = () => page.evaluate(() => `${window.__wh.design.parts.filter((p) => p.kind === 'engine').length} of 8 engines`);
  // Place GE90s under the right wing at about 9 m out.
  await page.click('.fsw [data-place="engine:ge90-115b"]');
  let p = await A(`[a.leX(9) - 0.5 * a.chord(9), -9, (a.lower(9) + a.upper(9)) / 2]`);
  let s = await at(...p);
  await page.mouse.move(s.x, s.y, { steps: 5 });
  await page.waitForTimeout(400);
  await shot('02-ghost-ge90');
  await page.mouse.click(s.x, s.y);
  await idle();
  check('GE90 pair attached', (await engines()).startsWith('4 of 8'), await engines());
  await shot('03-ge90-attached');
  // Over the wing: LEAP at 11 m
  await page.click('.fsw [data-place="engine:leap-1a"]');
  await page.click('.fsw [data-hang="over"]');
  p = await A(`[a.leX(12) - 0.5 * a.chord(12), -12, (a.lower(12) + a.upper(12)) / 2]`);
  s = await at(...p);
  await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300);
  await page.mouse.click(s.x, s.y);
  await idle();
  check('LEAP over-wing pair attached', (await engines()).startsWith('6 of 8'), await engines());
  // Body: LEAP on the rear fuselage
  await page.click('.fsw [data-place="engine:leap-1a"]');
  p = await A(`[a.tailCone + 1, -a.ys, 0.4]`);
  s = await at(...p);
  await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300);
  await shot('04-ghost-body');
  await page.mouse.click(s.x, s.y);
  await idle();
  check('body pair attached', (await engines()).startsWith('8 of 8'), await engines());
  const palDisabled = await page.evaluate(() => document.querySelector('.fsw [data-place="engine:leap-1a"]').disabled);
  check('engines full: the palette engines are off', palDisabled);
  // A wing tank, a hold tank and ballast
  await page.click('.fsw [data-place="tank:wing"]');
  p = await A(`[a.leX(12.5) - 0.4 * a.chord(12.5), -12.5, (a.lower(12.5) + a.upper(12.5)) / 2]`);
  s = await at(...p); await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300); await page.mouse.click(s.x, s.y); await idle();
  await page.click('.fsw [data-place="tank:hold"]');
  p = await A(`[2, -a.ys * 0.7, -0.5]`);
  s = await at(...p); await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300); await page.mouse.click(s.x, s.y); await idle();
  await page.click('.fsw [data-place="ballast"]');
  p = await A(`[10, -a.ys * 0.7, -0.5]`);
  s = await at(...p); await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300); await page.mouse.click(s.x, s.y); await idle();
  const parts = await page.evaluate(() => window.__wh.design.parts.map((p) => `${p.kind}:${p.mount || ''}:${p.side}:${p.s || p.x}`));
  check('tanks and ballast attached', parts.length === 12, parts.join(' '));
  await page.click('.fsw [data-a="done"]').catch(() => {});
  await page.mouse.move(5, 5);
  await shot('05-all-parts');
  // Select the right GE90 by clicking it, then drag it outboard.
  const ge = await page.evaluate(() => window.__wh.design.parts.find((p) => p.mount === 'overwing' && p.side < 0));
  const gb = await page.evaluate(async (ge) => { const W = await import('/games/flight-sim/src/ui/warehouse.js'); return W.partBox('a321neo', ge); }, ge);
  s = await at(gb.x + gb.hx * 0.6, gb.y, gb.z);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(400);
  check('clicking a nacelle selects it', (await page.evaluate(() => window.__wh.selected)) === ge.id, await page.evaluate(() => window.__wh.selected));
  await shot('06-selected');
  const s0 = ge.s;
  p = await A(`[a.leX(9.5) - 0.5 * a.chord(9.5), -9.5, (a.lower(9.5) + a.upper(9.5)) / 2]`);
  const s2 = await at(...p);
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(s2.x, s2.y, { steps: 12 }); await page.waitForTimeout(300);
  await shot('07-dragging');
  await page.mouse.up(); await idle();
  const s1 = await page.evaluate((id) => window.__wh.design.parts.find((p) => p.id === id).s, ge.id);
  check('dragging moves it (and its twin)', Math.abs(s1 - s0) > 0.5, `${s0} → ${s1}`);
  // Undo / redo with keys
  await page.keyboard.press('z'); await page.waitForTimeout(300);
  const su = await page.evaluate((id) => window.__wh.design.parts.find((p) => p.id === id).s, ge.id);
  check('Z undoes', su === s0, su);
  await page.keyboard.press('Shift+Z'); await page.waitForTimeout(300);
  const sr = await page.evaluate((id) => window.__wh.design.parts.find((p) => p.id === id).s, ge.id);
  check('Shift+Z redoes', sr === s1, sr);
  // A slider moves it and one undo puts it back
  await page.evaluate((id) => {
    const el = document.querySelector('.fsw [data-q="thrust"]');
    for (const v of [1.2, 1.4, 1.6]) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, ge.id);
  const th = await page.evaluate((id) => window.__wh.design.parts.filter((p) => p.mount === 'overwing').map((p) => p.thrust), ge.id);
  check('the thrust slider sets both twins', th.every((v) => v === 1.6), th.join(','));
  await page.keyboard.press('z'); await page.waitForTimeout(200);
  const th2 = await page.evaluate(() => window.__wh.design.parts.filter((p) => p.mount === 'overwing').map((p) => p.thrust));
  check('one undo takes a whole slider drag back', th2.every((v) => v === 1), th2.join(','));
  // Delete removes the pair
  const held = await page.evaluate(() => window.__wh.selected);
  await page.keyboard.press('Escape');
  const sel = await page.evaluate(() => window.__wh.selected);
  const asked = await page.evaluate(() => !document.querySelector('.fsw [data-o="ask"]').hidden);
  check('Esc lets go of the selection (and doesn\'t leave)', held && sel === null && !asked, `${held} → ${sel}`);
  // select via the list, then Delete
  await page.evaluate((id) => document.querySelector(`.fsw [data-sel="${id}"]`)?.click(), ge.pair && ge.id);
  const listSel = await page.evaluate(() => window.__wh.selected);
  await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  check('Delete removes the pair', (await engines()).startsWith('6 of 8') && !(await page.evaluate((id) => window.__wh.design.parts.some((p) => p.id === id), listSel)), await engines());
  await shot('08-after-delete');
  // The checks: issues listed; lopsided thrust with Mirror off
  const issues = await page.evaluate(() => [...document.querySelectorAll('.fsw-issue')].map((p) => p.className.split(' ')[1] + ': ' + p.textContent));
  console.log('issues:', issues.join(' || '));
  // Remove every engine: Save is off
  for (let k = 0; k < 6; k++) {
    const id = await page.evaluate(() => window.__wh.design.parts.find((p) => p.kind === 'engine')?.id);
    if (!id) break;
    await page.evaluate((id) => document.querySelector(`.fsw [data-sel="${id}"]`)?.click(), id);
    await page.keyboard.press('Delete'); await page.waitForTimeout(150);
  }
  const noEng = await page.evaluate(() => ({ save: document.querySelector('.fsw [data-a="save"]').disabled, first: document.querySelector('.fsw-issue')?.textContent }));
  check('no engines: Save is off and says why', noEng.save && /No engines/.test(noEng.first), JSON.stringify(noEng));
  await shot('09-no-engines');
  // Single engine, Mirror off, on the left wing: lopsided
  await page.uncheck('.fsw [data-o="mirror"]');
  await page.click('.fsw [data-place="engine:ge90-115b"]');
  await page.click('.fsw [data-hang="under"]');
  p = await A(`[a.leX(8) - 0.5 * a.chord(8), -8, (a.lower(8) + a.upper(8)) / 2]`);
  s = await at(...p); await page.mouse.move(s.x, s.y, { steps: 5 }); await page.waitForTimeout(300); await page.mouse.click(s.x, s.y); await idle();
  const lop = await page.evaluate(() => ({ n: window.__wh.design.parts.filter((p) => p.kind === 'engine').length, yaw: document.querySelector('.fsw [data-n="yaw"]')?.className + ' ' + document.querySelector('.fsw [data-n="yaw"] b')?.textContent }));
  check('one engine with Mirror off: lopsided thrust flagged', lop.n === 1 && /bad|warn/.test(lop.yaw), JSON.stringify(lop));
  await shot('10-lopsided');
  // Mirror it from the part panel, then Save
  await page.check('.fsw [data-q="mirror"]');
  await page.waitForTimeout(200);
  const two = await page.evaluate(() => window.__wh.design.parts.filter((p) => p.kind === 'engine').length);
  check('the panel’s Mirror adds the twin', two === 2, two);
  await page.click('.fsw [data-a="save"]'); await page.waitForTimeout(300);
  const msg = await page.evaluate(() => document.querySelector('.fsw [data-o="msg"]').textContent);
  check('Save works', /Saved/.test(msg), msg);
  const info = await page.evaluate(() => window.__fsw.info());
  check('draw calls stay low', info.calls < 140, JSON.stringify(info));
  await page.click('.fsw [data-a="back"]'); await page.waitForTimeout(300);
  const listed = await page.evaluate(() => document.querySelectorAll('.fsw .fsm-row').length);
  check('the design is listed', listed >= 1, listed);
  await shot('11-list');
  // Fly it: open the saved design, Fly it, New scenario with it picked, Fly: the game starts in it.
  await page.click('.fsw .fsm-row [data-r="open"]');
  await idle();
  const savedName = await page.evaluate(() => window.__wh.design.name);
  await page.click('.fsw [data-a="fly"]');
  await page.waitForSelector('.fsui-setup:not([hidden])', { timeout: 20000 });
  const picked = await page.evaluate(() => { const c = document.querySelector('.fsui-setup [data-design][aria-pressed="true"]'); return c ? c.textContent.trim().slice(0, 60) : null; });
  check('Fly it opens New scenario with the design picked', !!picked && picked.includes(savedName), picked);
  check('the warehouse closed (no 3D view left)', await page.evaluate(() => !window.__fsw && document.querySelector('.fsw').hidden));
  await page.click('.fsui-setup [data-a="fly"]');
  await page.waitForFunction((n) => window.__fs && window.__fs.sim && window.__fs.sim.design && window.__fs.sim.design.name === n, savedName, { timeout: 120000 });
  const flying = await page.evaluate(() => ({ name: window.__fs.sim.design.name, engines: window.__fs.sim.state.engines.length }));
  check('Fly flies it', flying.name === savedName && flying.engines === 2, JSON.stringify(flying));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  await browser.close();
})();
