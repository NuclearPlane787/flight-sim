// v0.2.1's one-finger camera in headless Chromium, through the real game loop: a press and drag
// on the 3D view looks around (nose, seats) or orbits (3rd person), the same way round as the
// two-finger swipe; a click or a small wobble doesn't; a double-click recentres, but not when
// its second press was a drag; a drag carries on over the HUD; presses on the HUD and the map
// don't turn the camera; the cursor is a hand. Swipe and pinch still work.
//   node camera-drag.cjs            (about 2 minutes with SwiftShader; FS_BASE as in stills.cjs)
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const DEG = Math.PI / 180;
(async () => {
  const viewport = { width: 1280, height: 800 };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    let fake = 1000;
    window.requestAnimationFrame = (cb) => setTimeout(() => { fake += 100; cb(fake); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=runway`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 180000 });
  await page.evaluate(() => { window.__fs.renderer.render = () => {}; });
  await page.waitForTimeout(500);

  const X = 640, Y = 560;   // over the view, below the HUD's panels
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [X, Y]);
  ok(under === 'view', `the view is under the pointer at ${X}, ${Y} (${under})`);
  const cursor = () => page.evaluate(() => getComputedStyle(document.getElementById('view')).cursor);
  ok(await cursor() === 'grab', `the cursor over the view is a hand (${await cursor()})`);

  const look = (id) => page.evaluate((v) => { const l = window.__fs.rig.looks[v || window.__fs.rig.view.id]; return { ...l }; }, id);
  const setView = (id) => page.evaluate((v) => { window.__fs.rig.viewId = v; window.__fs.rig.recentre(); }, id);
  const deg = (r) => Math.round(r / DEG * 10) / 10;
  async function drag(dx, dy, { from = [X, Y], steps = 10, midCursor = false } = {}) {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(from[0] + dx / 2, from[1] + dy / 2, { steps });
    const c = midCursor ? await cursor() : null;
    await page.mouse.move(from[0] + dx, from[1] + dy, { steps });
    await page.mouse.up();
    await page.waitForTimeout(150);
    return c;
  }

  // Each view: drag right 200 px, then down 100 px.
  for (const [id, speed] of [['nose', 2.5 * 60 * DEG], ['captain', 2.5 * 62 * DEG], ['orbit', 3.2]]) {
    await setView(id);
    const a = await look();
    const mid = await drag(200, 0, { midCursor: true });
    const b = await look();
    await drag(0, 100);
    const c = await look();
    const want = 200 * speed / viewport.height;
    ok(Math.abs((b.yaw - a.yaw) - want) < 0.01 && Math.abs(b.pitch - a.pitch) < 1e-9,
      `${id}: drag right 200 px turns ${deg(b.yaw - a.yaw)}° (want ${deg(want)}°: the scene follows the finger), pitch kept`);
    ok(c.pitch - b.pitch > 0.05 && Math.abs(c.yaw - b.yaw) < 1e-9, `${id}: drag down 100 px: pitch +${deg(c.pitch - b.pitch)}°`);
    ok(mid === 'grabbing', `${id}: the cursor while dragging: ${mid}`);
  }
  ok(await cursor() === 'grab', 'the hand opens again after the drag');

  // Limits: in the nose you can't turn past 170°, or look past 80° up.
  await setView('nose');
  for (let i = 0; i < 4; i++) await drag(900, 0, { from: [150, Y] });
  for (let i = 0; i < 3; i++) await drag(0, 600, { from: [X, 120] });
  const lim = await look();
  ok(Math.abs(lim.yaw - 170 * DEG) < 1e-6 && Math.abs(lim.pitch - 80 * DEG) < 1e-6, `nose limits: yaw ${deg(lim.yaw)}°, pitch ${deg(lim.pitch)}°`);

  // A click, and a 2 px wobble, don't turn it.
  await setView('nose');
  const n0 = await look();
  await page.mouse.click(X, Y);
  await page.waitForTimeout(150);
  await drag(2, 1, { steps: 2 });
  const n1 = await look();
  ok(n1.yaw === n0.yaw && n1.pitch === n0.pitch, 'a click and a 2 px wobble leave the view alone');

  // Double-click recentres; a second press that drags doesn't.
  await drag(150, 60);
  const d0 = await look();
  await page.mouse.dblclick(X, Y);
  await page.waitForTimeout(200);
  const d1 = await look();
  ok(Math.abs(d0.yaw) > 0.1 && d1.yaw === 0 && Math.abs(d1.pitch - (-3 * DEG)) < 1e-9, `double-click recentres (yaw ${deg(d0.yaw)}° → ${deg(d1.yaw)}°)`);
  await page.evaluate(() => { window.__dbl = 0; document.getElementById('view').addEventListener('dblclick', () => window.__dbl++); });
  await page.mouse.click(X, Y);
  await page.mouse.move(X, Y);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.move(X + 120, Y, { steps: 8 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(200);
  const d2 = await look();
  const dbl = await page.evaluate(() => window.__dbl);
  ok(Math.abs(d2.yaw) > 0.1, `a click then a press-and-drag (a "double-click" that drags; dblclick events: ${dbl}) keeps the drag (yaw ${deg(d2.yaw)}°)`);

  // A drag that runs over the PFD carries on (the view keeps the pointer).
  await setView('nose');
  const pfd = await page.evaluate(() => { const r = document.querySelector('.fsui-pfd').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const o0 = await look();
  await page.mouse.move(X, Y);
  await page.mouse.down();
  await page.mouse.move(pfd[0], pfd[1], { steps: 12 });
  await page.mouse.move(pfd[0] - 40, pfd[1], { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const o1 = await look();
  const wantYaw = ((pfd[0] - 40) - X) * 2.5 * 60 * DEG / viewport.height;
  ok(Math.abs((o1.yaw - o0.yaw) - wantYaw) < 0.01, `a drag over the PFD carries on: ${deg(o1.yaw - o0.yaw)}° (want ${deg(wantYaw)}°)`);

  // Presses on the HUD don't turn it: a drag on the ND, the view switch still clicks.
  const nd = await page.evaluate(() => { const r = document.querySelector('.fsui-nd').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const h0 = await look();
  await drag(-120, 30, { from: nd });
  const h1 = await look();
  ok(h1.yaw === h0.yaw && h1.pitch === h0.pitch, 'a drag that starts on the ND leaves the camera alone');
  await page.click('.fsui-views [data-v="orbit"]');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => window.__fs.rig.view.id)) === 'orbit', 'the view switch still clicks (3rd person)');

  // The map: dragging it pans the map, not the camera.
  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const m0 = await look('orbit');
  const mc = await page.evaluate(() => { const c = document.querySelector('.fsui-map canvas'); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, getComputedStyle(c).display]; });
  await drag(-150, 40, { from: [mc[0], mc[1]] });
  const m1 = await look('orbit');
  ok(m1.yaw === m0.yaw && m1.pitch === m0.pitch, `a drag on the map leaves the camera alone (map canvas ${mc[2]})`);
  await page.keyboard.press('m');
  await page.waitForTimeout(400);

  // The swipe and the pinch still work.
  await setView('nose');
  const s0 = await look();
  await page.mouse.move(X, Y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(60, 0); await page.waitForTimeout(30); }
  const s1 = await look();
  ok(s1.yaw < s0.yaw - 0.1, `a two-finger swipe still looks around (${deg(s1.yaw - s0.yaw)}°)`);
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -40); await page.waitForTimeout(30); }
  await page.keyboard.up('Control');
  const s2 = await look();
  ok(s2.fov < s1.fov - 5, `a pinch still zooms (fov ${s1.fov} → ${Math.round(s2.fov)})`);

  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  ok(errors.length === 0, 'no page errors');
  console.log(fails ? `${fails} FAILED` : 'all pass');
  await browser.close();
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
