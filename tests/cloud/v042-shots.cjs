// v0.4.2's pictures, in headless Chromium (SwiftShader), read off the canvas or through snap.cjs:
//   signs-day, signs-night   down Gimpo 14L from 5 m up: the runway exit signs and the distance remaining signs
//   exit-close               one exit sign from close by
//   snow-paint-041, -042     a taxiway's paint and painted name under snow, at v0.4.1 (served from flight-sim-041) and now
//   broken-far-041, -042     a broken layer (6 oktas at 4,000 ft) from 35,000 ft, looking out to the horizon
//   scattered-far-, scattered-low-041, -042   a scattered layer (3 oktas) from 35,000 and 12,000 ft (v0.4.2 left
//                            far cloud as v0.4.1 drew it: these showed its gaps already kept, ROADMAP.md)
//   wiper-1..3               the captain's seat in heavy rain, the wiper sweeping
//   spray                    the wheels' spray on a wet runway, from behind
//   crash-screen, pws-a321, pws-787   the crash screen's new button; WINDSHEAR AHEAD on each PFD
//   node v042-shots.cjs outDir [only,comma,list]
const { chromium } = require('playwright');
const snap = require('./snap.cjs');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v042';
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const want = (n) => !only || only.has(n);
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = { width: 1200, height: 750 };

const FREECAM = `
const fs = window.__fs;
fs.setPaused(true);
const orig = fs.rig.update;
window.__freeCam = { on: false, x: 0, y: 0, z: 50, yaw: 0, pitch: -0.5, fov: 60 };
fs.rig.update = (s, out = { x: 0, y: 0, z: 0 }) => {
  const c = window.__freeCam;
  if (!c.on) return orig(s, out);
  const cam = fs.rig.camera;
  out.x = c.x; out.y = c.y; out.z = c.z;
  cam.position.set(0, c.z, 0);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(c.pitch, -c.yaw, 0);
  cam.fov = c.fov; cam.near = 0.3; cam.updateProjectionMatrix();
  return out;
};
window.__hide = () => { for (const id of ['hud', 'pause', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } };
window.__cam = (x, y, z, yawDeg, pitchDeg, fov) => {
  const c = window.__freeCam; c.on = true; c.x = x; c.y = y; c.z = z; c.yaw = yawDeg * Math.PI / 180; c.pitch = pitchDeg * Math.PI / 180; c.fov = fov;
  fs.rig.viewId = 'orbit'; __hide(); for (let i = 0; i < 3; i++) fs.renderOnce(); return 'ok';
};
window.__kst = (h) => { const d = new Date(Date.UTC(2026, 10, 12, h - 9, 0, 0)); fs.clock.set(d.getTime()); };
`;

async function open(browser, base, query) {
  const page = await browser.newPage({ viewport: VIEW });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 180000 });
  page.errors = errors;
  return page;
}
async function canvas(page, name, expr) {
  const url = await page.evaluate(`(${expr}, window.__fs.renderer.domElement.toDataURL('image/png'))`);
  require('fs').writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}

(async () => {
  const { taxiSignSites } = await import('../../src/world/taxisigns.js');
  const rkss = JSON.parse(require('fs').readFileSync(__dirname + '/../../data/airports/RKSS.json', 'utf8'));
  const sites = taxiSignSites(rkss);
  const browser = await chromium.launch({ args: ARGS });
  const BASE = ROOT + 'flight-sim/', BASE041 = ROOT + 'flight-sim-041/';
  const report = [];

  // Down 14L (runway 0) from 5 m up, 600 m from its threshold: exits and distance signs along it.
  const r0 = rkss.runways[0], [e0, e1] = r0.ends;
  const L = Math.hypot(e1.x - e0.x, e1.y - e0.y), ux = (e1.x - e0.x) / L, uy = (e1.y - e0.y) / L;
  const yaw = Math.atan2(ux, uy) * 180 / Math.PI;
  const at = (s) => ({ x: e0.x + ux * s, y: e0.y + uy * s, z: e0.elevM + (e1.elevM - e0.elevM) * s / L });
  if (want('signs-day') || want('signs-night') || want('exit-close') || want('spray') || want('crash-screen') || want('pws-a321')) {
    const page = await open(browser, BASE, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    const p = at(600);
    if (want('signs-day')) { await page.evaluate('__kst(14)'); await canvas(page, 'v042-signs-day', `__cam(${p.x}, ${p.y}, ${p.z + 5}, ${yaw}, -3, 55)`); }
    if (want('signs-night')) { await page.evaluate('__kst(21)'); await canvas(page, 'v042-signs-night', `__cam(${p.x}, ${p.y}, ${p.z + 5}, ${yaw}, -3, 55)`); await page.evaluate('__kst(14)'); }
    if (want('exit-close')) {
      const ex = sites.exits.find((q) => q.ri === 0 && q.dir === 1) || sites.exits[0];
      const cx = ex.x - ex.tx * 22 + ex.ty * 4, cy = ex.y - ex.ty * 22 - ex.tx * 4;
      const z = at(Math.max(0, Math.min(L, (ex.x - e0.x) * ux + (ex.y - e0.y) * uy))).z;
      await canvas(page, 'v042-exit-close', `__cam(${cx}, ${cy}, ${z + 1.6}, ${Math.atan2(ex.tx, ex.ty) * 180 / Math.PI + 8}, -2, 40)`);
      report.push(`exit sign: ${JSON.stringify(ex.panels)}`);
    }
    if (want('spray')) {
      // The aircraft as it is (14R's threshold), rolling at 110 kt in heavy rain, seen from behind and to the left.
      await page.evaluate('__kst(14)');
      await page.evaluate(() => { window.__fs.sim.setWeather({ preset: 'x', seed: 4, precip: { kind: 'rain', rate: 0.9 }, visM: 5000, clouds: [{ okta: 8, baseFt: 1200, topFt: 6000 }] }); });
      await page.evaluate(() => window.__fs.renderOnce());
      const pose = await page.evaluate(() => { const s = window.__fs.sim.state; s.gs = 110 * 0.514444; s.onGround = true; return { x: s.pos.x, y: s.pos.y, z: s.pos.z, h: s.hdg }; });
      const back = 70, side = 30;
      const cx = pose.x - back * Math.sin(pose.h) - side * Math.cos(pose.h), cy = pose.y - back * Math.cos(pose.h) + side * Math.sin(pose.h);
      const look = Math.atan2(pose.x - cx, pose.y - cy) * 180 / Math.PI;
      await canvas(page, 'v042-spray', `(window.__fs.sim.state.gs = 110 * 0.514444, window.__fs.sim.state.onGround = true, __cam(${cx}, ${cy}, ${pose.z + 6}, ${look}, -6, 50))`);
      await page.evaluate(() => { window.__fs.sim.setWeather(null); });
    }
    if (want('crash-screen')) {
      await page.evaluate(() => { window.__freeCam.on = false; document.getElementById('crash').hidden = false; document.getElementById('crash-reason').textContent = 'nose impact'; for (const id of ['hud']) { const e = document.getElementById(id); if (e) e.style.visibility = ''; } });
      await snap(page, browser, `${out}/v042-crash-screen.png`, BASE, VIEW);
      console.log('shot v042-crash-screen');
      await page.evaluate(() => { document.getElementById('crash').hidden = true; });
    }
    if (want('pws-a321')) {
      await page.evaluate(() => { window.__freeCam.on = false; window.__fs.rig.viewId = 'orbit'; const s = window.__fs.sim.state; s.warnings.windshearAhead = true; s.onGround = false; const h = document.getElementById('hud'); if (h) h.style.visibility = ''; });
      await snap(page, browser, `${out}/v042-pws-a321.png`, BASE, VIEW);
      console.log('shot v042-pws-a321');
    }
    if (page.errors.length) report.push('errors (Gimpo): ' + page.errors.slice(0, 3).join(' | '));
    await page.close();
  }

  if (want('pws-787')) {
    const page = await open(browser, BASE, '?test&origin=RKSS&dep=14R&dest=RKPC&start=final&type=b787-9');
    await page.evaluate(() => { const fs = window.__fs; fs.setPaused(true); const s = fs.sim.state; s.warnings.windshearAhead = true; document.getElementById('pause').style.visibility = 'hidden'; fs.renderOnce(); });
    await snap(page, browser, `${out}/v042-pws-787.png`, BASE, VIEW);
    console.log('shot v042-pws-787');
    if (page.errors.length) report.push('errors (787): ' + page.errors.slice(0, 3).join(' | '));
    await page.close();
  }

  // Snow on the taxiway paint, then and now: over the first painted name, 30 m up, looking down.
  const pn = sites.painted[0];
  for (const [tag, base] of [['041', BASE041], ['042', BASE]]) {
    if (!want('snow-paint')) break;
    const page = await open(browser, base, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    await page.evaluate(() => { window.__fs.sim.setWeather({ preset: 'x', seed: 4, precip: { kind: 'snow', rate: 0.5 }, tempC: -4, visM: 8000 }); });
    const cx = pn.x - pn.tx * 45, cy = pn.y - pn.ty * 45;
    await canvas(page, `v042-snow-paint-${tag}`, `__cam(${cx}, ${cy}, ${rkss.elevM + 28}, ${Math.atan2(pn.tx, pn.ty) * 180 / Math.PI}, -30, 50)`);
    await page.close();
  }

  // A broken layer from far off, then and now.
  for (const [tag, base] of [['041', BASE041], ['042', BASE]]) {
    if (!want('broken-far')) break;
    const page = await open(browser, base, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    await page.evaluate(() => { window.__kst(13); window.__fs.sim.setWeather({ preset: 'x', seed: 9, clouds: [{ okta: 6, baseFt: 4000, topFt: 5500 }], visM: 60000 }); });
    await canvas(page, `v042-broken-far-${tag}`, `__cam(-62600, 160000, ${35000 * 0.3048}, 200, -10, 60)`);
    await page.close();
  }

  // A scattered layer from far off, then and now, from 12,000 and 35,000 ft.
  for (const [tag, base] of [['041', BASE041], ['042', BASE]]) {
    if (!want('scattered-far')) break;
    const page = await open(browser, base, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    await page.evaluate(() => { window.__kst(13); window.__fs.sim.setWeather({ preset: 'x', seed: 9, clouds: [{ okta: 3, baseFt: 4000, topFt: 5500 }], visM: 60000 }); });
    await canvas(page, `v042-scattered-far-${tag}`, `__cam(-62600, 160000, ${35000 * 0.3048}, 200, -10, 60)`);
    await canvas(page, `v042-scattered-low-${tag}`, `__cam(-62600, 160000, ${12000 * 0.3048}, 200, -6, 60)`);
    await page.close();
  }

  // The wiper: the captain's seat on 14R in heavy rain, running (the sim holds it on the brakes).
  if (want('wiper')) {
    const page = await open(browser, BASE, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(() => {
      const fs = window.__fs;
      fs.clock.set(Date.UTC(2026, 10, 12, 5, 0, 0));   // 14:00 KST
      fs.sim.setWeather({ preset: 'x', seed: 4, precip: { kind: 'rain', rate: 0.9 }, visM: 4000, clouds: [{ okta: 8, baseFt: 1500, topFt: 6000 }] });
      fs.selectView('captain');
      fs.setPaused(false);
      for (const id of ['hud', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    });
    await page.waitForTimeout(6000);
    for (let i = 1; i <= 3; i++) {
      await canvas(page, `v042-wiper-${i}`, 'window.__fs.renderOnce()');   // drawn in the same task, or the canvas reads back blank
      await page.waitForTimeout(700);
    }
    if (page.errors.length) report.push('errors (wiper): ' + page.errors.slice(0, 3).join(' | '));
    await page.close();
  }

  console.log(report.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
