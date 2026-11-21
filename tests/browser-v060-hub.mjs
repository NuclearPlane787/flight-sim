// v0.6.0: the game as a player opens it: from the hub's player (play.html?game=flight-sim) and
// directly with no parameters. The menu comes up, New flight opens the setup with the region's
// airports, Fly starts the default flight, and nothing is logged as an error. Headless, muted.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-v060-hub.mjs
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (name, ok, note = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); if (!ok) bad++; };
try {
  for (const [what, url] of [['direct', `${ROOT}games/flight-sim/`], ['from the hub', `${ROOT}play.html?game=flight-sim`]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    // The game's own document: the page itself, or the hub player's frame.
    let frame = page.mainFrame();
    if (what !== 'direct') {
      await page.click('#start-overlay', { timeout: 8000 }).catch(() => {});   // the hub player's "Start the game" cover
      await page.waitForFunction(() => document.querySelector('iframe'), null, { timeout: 20000 });
      for (let i = 0; i < 100 && !page.frames().some((f) => /games\/flight-sim/.test(f.url())); i++) await page.waitForTimeout(200);
      frame = page.frames().find((f) => /games\/flight-sim/.test(f.url())) || frame;
    }
    await frame.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const menu = await frame.evaluate(() => ({ text: document.body.innerText.slice(0, 400).replace(/\s+/g, ' '), region: null }));
    check(`${what}: the menu is up`, /New|Continue|Load/i.test(menu.text), menu.text.slice(0, 120));
    // (v0.7.0: the check that v0.6.0's three flags are on by default went with the flags.)
    await frame.waitForFunction(() => window.__fs && window.__fs.inMenu, null, { timeout: 60000 });
    await frame.evaluate(() => { window.__fs.newScenario(); });   // the menu's New row (its click is the same call; the row slides in with the home page's animation)
    await frame.waitForSelector('[data-f="origin"]', { timeout: 10000 });
    const n = await frame.evaluate(() => document.querySelectorAll('[data-f="origin"] option').length);
    check(`${what}: the setup lists the region's airports`, n === 23, `${n} airports`);   // (twelve until v0.6.3, seventeen until v0.6.4)
    await frame.click('[data-a="fly"]');
    await frame.waitForFunction(() => window.__fs && window.__fs.frames > 60 && window.__fs.sim && window.__fs.sim.state, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const st = await frame.evaluate(() => { const f = window.__fs, s = f.sim.state, T = f.world.heightfield.tiles; return { onGround: s.onGround, crashed: !!f.crashed, misses: T ? T.misses : 0, draws: f.renderer.info.render.calls, tris: f.renderer.info.render.triangles }; });
    check(`${what}: the default flight starts on the ground, nothing missing`, st.onGround && !st.crashed && st.misses === 0, JSON.stringify(st));
    check(`${what}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
} finally { await browser.close(); }
console.log(bad ? 'FAIL' : 'ALL PASS');
process.exit(bad ? 1 : 0);
