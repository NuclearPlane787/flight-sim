// v0.5.1: the warehouse's hangar, from the cloud (headless Chromium, SwiftShader), at 1440×900: a new design of
// each type in the editor, from the start view, from behind the tail towards the back wall, from low down looking
// up at the roof and zoomed out against a wall; the draw calls and triangles; the people moving; nothing left
// running after Back.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v051-hangar.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v051-hangar';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await page.goto(ROOT + 'flight-sim/?warehouse=1');
  await page.waitForSelector('.fsm:not([hidden])', { timeout: 120000 });
  await page.waitForTimeout(500);
  const rafOver = (ms) => page.evaluate((ms) => new Promise((res) => { const n0 = window.__raf; setTimeout(() => res(window.__raf - n0), ms); }), ms);
  const rafMenu = await rafOver(1500);
  await page.click('[data-k="warehouse"]');
  await page.waitForSelector('.fsw:not([hidden])');
  const ready = async () => {
    await page.waitForFunction(() => { const m = document.querySelector('.fsw [data-o="viewMsg"]'); return m && m.hidden && window.__fsw && window.__fsw.view; }, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
  };
  const canvas = async () => page.$('.fsw canvas');
  const drag = async (dx, dy) => {
    const b = await (await canvas()).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  const shot = async (name) => { await (await canvas()).screenshot({ path: `${out}/${name}.png` }); };
  for (const [id, tag] of [['b777-300er', '777'], ['a321neo', 'a321'], ['b787-9', '787']]) {
    await page.click(`.fsw [data-new="${id}"]`);
    await ready();
    const t0 = Date.now();
    await shot(`${tag}-home`);
    const info = await page.evaluate(() => window.__fsw.info());
    check(`${tag}: draw calls and triangles`, info.calls > 0 && info.calls < 120, `${info.calls} calls, ${info.triangles} triangles`);
    if (tag === '777') {
      // People move: two frames a second apart differ.
      const a = await (await canvas()).screenshot();
      await page.waitForTimeout(1000);
      const b = await (await canvas()).screenshot();
      check('the picture changes by itself (people walking)', !a.equals(b));
      await page.evaluate(() => window.__fsw.setAnimate(false));
      await page.waitForTimeout(400);
      const c = await (await canvas()).screenshot();
      await page.waitForTimeout(600);
      const d = await (await canvas()).screenshot();
      check('with the people stopped it holds still', c.equals(d));
      await page.evaluate(() => window.__fsw.setAnimate(true));
      await drag(-520, 0); await shot('777-from-left');
      await drag(-520, 0); await shot('777-behind');
      await drag(0, 120); await shot('777-high');
      await page.evaluate(() => { const v = window.__fsw.view; v.pitch = -0.08; v.yaw = 2.2; v.dist = 40; window.__fsw.request(); });
      await page.waitForTimeout(500); await shot('777-low-roof');
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
      await page.waitForTimeout(500); await shot('777-zoomed-out');
      await page.evaluate(() => { const v = window.__fsw.view; v.pitch = 0.05; v.yaw = 3.14; v.dist = 60; window.__fsw.request(); });
      await page.waitForTimeout(500); await shot('777-to-doors');
      await page.evaluate(() => { const v = window.__fsw.view; v.pitch = 0.1; v.yaw = 0.0; v.dist = 70; window.__fsw.request(); });
      await page.waitForTimeout(500); await shot('777-to-back');
    }
    console.log(`${tag}: ${Date.now() - t0} ms of checks`);
    await page.click('.fsw [data-a="back"]');
    await page.waitForTimeout(400);
    const ask = await page.$('.fsw [data-a="discard"]:visible');
    if (ask) { await ask.click(); await page.waitForTimeout(300); }
  }
  await page.click('.fsw [data-a="top"]');
  await page.waitForTimeout(800);
  const rafAfter = await rafOver(1500);
  check('nothing left running after Back', rafAfter <= rafMenu + 1, `menu ${rafMenu}, after ${rafAfter}`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
