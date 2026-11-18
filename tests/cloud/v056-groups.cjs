// v0.5.6: engine groups against the autothrust, in the game. A group's key while the A/T or A/THR drives the levers
// parts them and disconnects it (the A321's A/THR in the sim, the Boeing's A/T in main.js), and the all-engines lever
// reads the highest of them (MAN TOGA, the A/THR's modes).
//   node v056-groups.cjs            (a few minutes with SwiftShader; FS_BASE as in stills.cjs)
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };

async function run(browser, type) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    let fake = 0; window.requestAnimationFrame = (cb) => setTimeout(() => { fake += 100; cb(fake); }, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });
  await page.goto(`${BASE}?test&origin=RKSS&dep=14R&dest=RKPC&arr=07&start=final&type=${type}`);
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.dest, null, { timeout: 180000 });
  await page.evaluate(() => { window.__fs.renderer.render = () => {}; });
  // Engine 1 alone on U and J (v0.5.6's store: the global keys, and each aircraft's part keys and engine groups).
  await page.evaluate((t) => window.__fs.setKeys({ v: 2, global: { bind: {} }, scopes: { [`type:${t}`]: { bind: {}, groups: [{ engines: [0], up: 'KeyU', down: 'KeyJ' }] } } }), type);
  const km = await page.evaluate(() => { const m = window.__fs.input.keymap; return { u: m.get('KeyU'), r: m.get('KeyR'), map: m.get('KeyM') }; });
  ok(km.u?.kind === 'group' && km.r?.id === 'thrustUp' && km.map?.id === 'map', `${type}: the flight has the group's keys with the rest: ${JSON.stringify(km)}`);
  // The autothrust driving the levers (engaged if it isn't).
  await page.evaluate(() => { const fs = window.__fs; if (!fs.sim.state.athrActive) fs.ap.toggleAthr(); });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ athr: !!window.__fs.ap.athr, driving: !!window.__fs.sim.state.athrActive, lever: window.__fs.sim.controls.thrust }));
  ok(before.athr && before.driving, `${type}: the autothrust drives the levers first: ${JSON.stringify(before)}`);
  await page.keyboard.down('KeyU'); await page.waitForTimeout(1200); await page.keyboard.up('KeyU');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => { const fs = window.__fs, c = fs.sim.controls; return { athr: !!fs.ap.athr, eng: c.thrustEng ? c.thrustEng.map((x) => +x.toFixed(3)) : null, lever: +c.thrust.toFixed(3), ring: fs.sim.state.engines.map((e) => +e.leverN1.toFixed(1)) }; });
  ok(!after.athr, `${type}: the group's key disconnected it: ${JSON.stringify(after)}`);
  ok(Array.isArray(after.eng) && after.eng[0] > after.eng[1] + 0.05, `${type}: engine 1's lever ahead of engine 2's, and they stay apart after 2.5 s`);
  ok(after.eng && Math.abs(after.lever - Math.max(...after.eng)) < 1e-9, `${type}: the all-engines lever is the highest (${after.lever})`);
  ok(after.ring[0] > after.ring[1], `${type}: engine 1's ring ahead of engine 2's (${after.ring.join(' / ')})`);
  ok(errors.length === 0, `${type}: no page errors ${errors.slice(0, 2).join(' | ')}`);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const t of ['b777-300er', 'a321neo']) await run(browser, t);
  } finally { await browser.close(); }
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
