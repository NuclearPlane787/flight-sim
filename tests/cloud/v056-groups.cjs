// v0.5.6: engine groups against the autothrust, in the game. v0.5.7 (the file keeps its name): each engine its own keys
// (the warehouse's block). An engine's own key while the A/T or A/THR drives the levers parts them and disconnects it
// (the A321's A/THR in the sim, the Boeing's A/T in main.js), the all-engines lever reads the highest of them (MAN TOGA,
// the A/THR's modes), and R (all engines) moves every lever, the keyed engine's too.
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
  // Engine 1's own keys, U and J (v0.5.7's store: the Controls page's keys, and each aircraft's block keys).
  await page.evaluate((t) => window.__fs.setKeys({ v: 3, global: { bind: {} }, aircraft: { [`type:${t}`]: { engines: { 0: { up: 'KeyU', down: 'KeyJ' } } } } }), type);
  const km = await page.evaluate(() => { const m = window.__fs.input.keymap; return { u: m.get('KeyU'), j: m.get('KeyJ'), r: m.get('KeyR'), map: m.get('KeyN'), m: m.get('KeyM') }; });
  ok(km.u?.kind === 'engine' && km.u.i === 0 && km.u.dir === 1 && km.j?.dir === -1 && km.r?.id === 'thrustUp' && km.map?.id === 'map' && !km.m,
    `${type}: the flight has engine 1's own keys with the rest: ${JSON.stringify(km)}`);
  // The autothrust driving the levers (engaged if it isn't).
  await page.evaluate(() => { const fs = window.__fs; if (!fs.sim.state.athrActive) fs.ap.toggleAthr(); });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ athr: !!window.__fs.ap.athr, driving: !!window.__fs.sim.state.athrActive, lever: window.__fs.sim.controls.thrust }));
  ok(before.athr && before.driving, `${type}: the autothrust drives the levers first: ${JSON.stringify(before)}`);
  await page.keyboard.down('KeyU'); await page.waitForTimeout(1200); await page.keyboard.up('KeyU');
  await page.waitForTimeout(2500);
  const look = () => page.evaluate(() => { const fs = window.__fs, c = fs.sim.controls; return { athr: !!fs.ap.athr, eng: c.thrustEng ? c.thrustEng.map((x) => +x.toFixed(3)) : null, lever: +c.thrust.toFixed(3), ring: fs.sim.state.engines.map((e) => +e.leverN1.toFixed(1)) }; });
  const after = await look();
  ok(!after.athr, `${type}: engine 1's own key disconnected it: ${JSON.stringify(after)}`);
  ok(Array.isArray(after.eng) && after.eng[0] > after.eng[1] + 0.05, `${type}: engine 1's lever ahead of engine 2's, and they stay apart after 2.5 s`);
  ok(after.eng && Math.abs(after.lever - Math.max(...after.eng)) < 1e-9, `${type}: the all-engines lever is the highest (${after.lever})`);
  ok(after.ring[0] > after.ring[1], `${type}: engine 1's ring ahead of engine 2's (${after.ring.join(' / ')})`);
  // R: every lever, engine 1's too, by the same amount (unless one meets full or a detent first).
  await page.keyboard.down('KeyR'); await page.waitForTimeout(500); await page.keyboard.up('KeyR');
  await page.waitForTimeout(300);
  const r = await look();
  const d0 = r.eng ? r.eng[0] - after.eng[0] : 0, d1 = r.eng ? r.eng[1] - after.eng[1] : 0;
  ok(Array.isArray(r.eng) && d1 > 0.02 && (d0 > 0.02 || r.eng[0] === 1), `${type}: R moves both levers, the keyed engine's too (${d0.toFixed(3)}, ${d1.toFixed(3)})`);
  // Engine 1's own down key: its lever alone.
  await page.keyboard.down('KeyJ'); await page.waitForTimeout(500); await page.keyboard.up('KeyJ');
  await page.waitForTimeout(300);
  const j = await look();
  ok(Array.isArray(j.eng) && j.eng[0] < r.eng[0] - 0.02 && Math.abs(j.eng[1] - r.eng[1]) < 1e-9, `${type}: J moves engine 1's lever alone (${JSON.stringify(r.eng)} → ${JSON.stringify(j.eng)})`);
  // R again, with engine 1's lever below the other: it moves too (an engine with keys of its own still follows R).
  await page.keyboard.down('KeyR'); await page.waitForTimeout(250); await page.keyboard.up('KeyR');
  await page.waitForTimeout(300);
  const r2 = await look();
  ok(Array.isArray(r2.eng) && r2.eng[0] > j.eng[0] + 0.02, `${type}: R moves engine 1's lever up too (${JSON.stringify(j.eng)} → ${JSON.stringify(r2.eng)})`);
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
