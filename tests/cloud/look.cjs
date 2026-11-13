// A free look at one type's model on its dev page, in headless Chromium (SwiftShader), read off the canvas.
// For finding gaps and seams close up (v0.4.3), with the wing bent or not:
//   node look.cjs outDir prefix type 'state' 'views'
//     type:  a321neo | b787-9 | b777-300er, or (v0.5.0) a design as JSON: a whole design, or {"base":…, newDesign's
//            extras}, e.g. '{"base":"b777-300er","count":4}' or '{"base":"a321neo","engine":"ge90-115b","gearExtendM":1.5}'
//     state: JSON merged into the dev page's state, e.g. {"slatDeg":30,"flapDeg":30,"gearPos":1}; a "flex"
//            key (m at the tip) bends the wing (Boeings), "noGround":true hides the ground
//     views: JSON list of [name, yaw°, pitch°, dist m, [x, z, y] body target, fov°?]
//            yaw from the nose, + towards the left wing; pitch up; the target in the body frame
//   FS_BASE: where serve.py serves the game (default http://127.0.0.1:8765/games/flight-sim/)
//   FS_CHROME=1: the installed Chrome on the machine's GPU (headed, a fresh temporary profile) instead of SwiftShader
//   With NODE_PATH pointing at a Playwright install if it isn't beside this file.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const [out = '/tmp/fs-look', prefix = 'look', type = 'b787-9', stateJson = '{}', viewsJson = '[]'] = process.argv.slice(2);
const PAGES = { a321neo: 'tests/dev-aircraft.html', 'b787-9': 'tests/dev-widebody.html?type=b787-9', 'b777-300er': 'tests/dev-widebody.html?type=b777-300er' };
// A design: its base's page, with the design in the URL.
const design = type.trim().startsWith('{') ? JSON.parse(type) : null;
const baseType = design ? design.base || 'a321neo' : type;
const pageUrl = PAGES[baseType] + (design ? (baseType === 'a321neo' ? '?' : '&') + 'design=' + encodeURIComponent(JSON.stringify(design)) : '');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = process.env.FS_CHROME === '1'
    ? await chromium.launch({ channel: 'chrome', headless: false })
    : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + pageUrl);
  await page.waitForFunction(() => window.dev && window.dev.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.dev.shot(true));
  const st = JSON.parse(stateJson);
  const { flex = 0, noGround = false, ...patch } = st;
  await page.evaluate(({ patch, a321 }) => window.dev.set(a321 ? { state: patch } : patch), { patch, a321: baseType === 'a321neo' });
  await page.evaluate(({ flex, noGround }) => { if (window.dev.flex) window.dev.flex(flex); window.dev.hideGround(noGround); }, { flex, noGround });
  for (const [name, yaw, pitch, dist, target, fov = 40] of JSON.parse(viewsJson)) {
    await page.evaluate(({ yaw, pitch, dist, target, fov }) => window.dev.look(yaw, pitch, dist, target, fov), { yaw, pitch, dist, target, fov });
    await page.waitForTimeout(120);
    const url = await page.evaluate(() => window.dev.png());
    const file = path.join(out, `${prefix}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('shot', path.basename(file));
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
