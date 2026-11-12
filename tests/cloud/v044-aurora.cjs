// v0.4.4: the aurora over time, north from Gimpo 14L at 23:00 KST on a moonless night. The shader's
// clock (uTime) is pinned for each frame, so the frames show how the curtains move: then (v0.4.3,
// from flight-sim-043/ beside this folder: a sideways drift of the same shape) and now (undulating).
//   node v044-aurora.cjs outDir        FS_ROOT as in v043-shots.cjs
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v044-aurora';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = { width: 1000, height: 500 };
const TIMES = [600, 615, 630, 650, 680];   // s on the shader's clock

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

const PIN = `
const wu = __fs.world.update.bind(__fs.world);
__fs.world.update = (o) => { const r = wu(o); if (window.__t != null) __fs.world.uniforms.uTime.value = window.__t; return r; };
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
  const e0 = rkss.runways[0].ends[0];
  const browser = await chromium.launch({ args: ARGS });
  for (const [tag, dir] of [['043', 'flight-sim-043/'], ['044', 'flight-sim/']]) {
    const page = await open(browser, ROOT + dir, '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway');
    await page.evaluate(FREECAM);
    await page.evaluate(PIN);
    await page.evaluate('__at(2026, 11, 12, 23, 0)');
    for (const t of TIMES) await canvas(page, `aurora-${tag}-t${t}`, `(window.__t = ${t}, __cam(${e0.x}, ${e0.y}, ${e0.elevM + 6}, 0, 9, 75))`);
    if (page.errors.length) console.log('errors', tag, page.errors.slice(0, 3));
    await page.close();
  }
  await browser.close();
})();
