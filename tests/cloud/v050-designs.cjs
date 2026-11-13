// v0.5.0's review: designs in the game, from the cloud: a four-GE90 777 and a GE90 A321 with 1.5 m more gear,
// started by ?design=, on Gimpo 14R by day: a still from the side and from ahead, the engines the sim
// reports, and the HUD's engine panel with all of them.
//   node v050-designs.cjs outDir        FS_ROOT as in v043-shots.cjs
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v050-designs';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = { width: 1440, height: 900 };

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

const DESIGNS = {
  '777x4': { v: 1, base: 'b777-300er', engine: 'ge90-115b', count: 4, stations: [9.6, 17.7], name: 'Quad 777', registration: 'HL7004' },
  'a321-ge90': { v: 1, base: 'a321neo', engine: 'ge90-115b', count: 2, stations: [6.07], gearExtendM: 1.5, name: 'GE90 A321', registration: 'HL8787' },
};
(async () => {
  const rkss = JSON.parse(require('fs').readFileSync(__dirname + '/../../data/airports/RKSS.json', 'utf8'));
  const e0 = rkss.runways[0].ends[0];
  const browser = await chromium.launch({ args: ARGS });
  let bad = 0;
  for (const [tag, d] of Object.entries(DESIGNS)) {
    const page = await open(browser, ROOT + 'flight-sim/', '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway&design=' + encodeURIComponent(JSON.stringify(d)));
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => { const s = window.__fs.sim; return { engines: s.state.engines.length, design: s.design && s.design.name, mass: Math.round(s.state.mass), base: s.design && s.design.base }; });
    const ok = info.engines === d.count && info.design === d.name;
    if (!ok) bad++;
    console.log(ok ? 'PASS' : 'FAIL', tag, JSON.stringify(info));
    await page.screenshot({ path: `${out}/${tag}-hud.png` }).catch((e) => console.log('no hud picture', String(e).split('\n')[0]));
    await page.evaluate(FREECAM);
    await page.evaluate('__at(2026, 11, 13, 14, 0)');
    const p = await page.evaluate(() => { const s = window.__fs.sim.state; return { x: s.pos.x, y: s.pos.y, z: s.pos.z, hdg: s.hdg }; });
    const deg = p.hdg * 180 / Math.PI;
    // From the left side (90° left of the nose) and from ahead, 60 m out, about 4 m up.
    for (const [name, off] of [['side', -90], ['ahead', 0]]) {
      const a = (deg + off) * Math.PI / 180, dist = 60;
      const cx = p.x + Math.sin(a) * dist, cy = p.y + Math.cos(a) * dist;
      const yaw = (deg + off + 180) % 360;
      await canvas(page, `${tag}-${name}`, `__cam(${cx}, ${cy}, ${p.z + 4}, ${yaw}, -2, 45)`);
    }
    if (page.errors.length) { bad++; console.log('errors', tag, page.errors.slice(0, 3)); }
    await page.close();
  }
  await browser.close();
  console.log(bad ? bad + ' FAIL' : 'ALL PASS');
})();
