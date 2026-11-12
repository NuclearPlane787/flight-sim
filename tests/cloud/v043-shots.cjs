// v0.4.3's pictures, in headless Chromium (SwiftShader), read off the canvas:
//   aurora-ground-042, -043   north from Gimpo 14L at 23:00 KST on a clear, moonless night, then and now
//   aurora-cruise             north from FL350 over Seoul
//   aurora-south              south from the same place (none there)
//   aurora-day-042, -043      the same view by day (unchanged)
//   aurora-cloud              under a broken layer at night
//   node v043-shots.cjs outDir [only,comma,list]        FS_ROOT as in v042-shots.cjs (flight-sim-042/ beside it for "then")
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v043';
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
// A night with the Moon down: 2026-11-12 23:00 KST (the Moon is a day from new).
window.__at = (y, mo, d, h, mi) => { fs.clock.set(Date.UTC(y, mo - 1, d, h - 9, mi || 0, 0)); };
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
  const rkss = JSON.parse(require('fs').readFileSync(__dirname + '/../../data/airports/RKSS.json', 'utf8'));
  const r0 = rkss.runways[0], e0 = r0.ends[0];
  const browser = await chromium.launch({ args: ARGS });
  const BASE = ROOT + 'flight-sim/', BASE042 = ROOT + 'flight-sim-042/';
  const report = [];
  for (const [tag, base] of [['042', BASE042], ['043', BASE]]) {
    if (!want('aurora') && !want('aurora-' + tag)) continue;
    const page = await open(browser, base, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    await page.evaluate('__at(2026, 11, 12, 23, 0)');
    await canvas(page, `aurora-ground-${tag}`, `__cam(${e0.x}, ${e0.y}, ${e0.elevM + 6}, 0, 9, 70)`);
    if (tag === '043') {
      await canvas(page, 'aurora-cruise', `__cam(${e0.x}, ${e0.y + 20000}, ${35000 * 0.3048}, 0, 2, 70)`);
      await canvas(page, 'aurora-south', `__cam(${e0.x}, ${e0.y}, ${e0.elevM + 6}, 180, 9, 70)`);
      await page.evaluate(() => { window.__fs.sim.setWeather({ preset: 'x', seed: 5, clouds: [{ okta: 5, baseFt: 6000, topFt: 7000 }], visM: 30000 }); });
      await canvas(page, 'aurora-cloud', `__cam(${e0.x}, ${e0.y}, ${e0.elevM + 6}, 0, 9, 70)`);
      await page.evaluate(() => { window.__fs.sim.setWeather(null); });
    }
    await page.evaluate('__at(2026, 11, 12, 14, 0)');
    await canvas(page, `aurora-day-${tag}`, `__cam(${e0.x}, ${e0.y}, ${e0.elevM + 6}, 0, 9, 70)`);
    const st = await page.evaluate(() => window.__fsStats || null);
    report.push(`${tag}: ${JSON.stringify(st)}`);
    if (page.errors.length) report.push(`errors (${tag}): ` + page.errors.slice(0, 3).join(' | '));
    await page.close();
  }
  console.log(report.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
