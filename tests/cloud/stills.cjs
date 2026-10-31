// Stills of the 3D view with a free camera, in headless Chromium (SwiftShader WebGL), read
// straight off the canvas (page.screenshot hangs on this page). The aircraft is parked on the
// grass by RKSI 33L, heading 325°.
//   node stills.cjs '[["nose-front", "__look(180, 14, 13, 45)"], ["captain", "__seat(\"captain\", 0, -6, 62)"]]' [outDir]
// __look(azRel°, el°, distance m, fov°, bx, bz, by): a camera looking at the body point (bx fwd,
//   by left, bz up; default 19.4, 0.6, 0 = the nose) from azRel° round from behind (180 = in
//   front, 90 = the left side) and el° above it. __seat(id, yaw°, pitch°, fov°): a seat view
//   ('captain', 'fo'), yaw + to the left.
// FS_BASE (default http://127.0.0.1:8765/games/flight-sim/) is where serve.py serves the game.
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const SETUP = `
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
  cam.fov = c.fov; cam.near = 0.05; cam.updateProjectionMatrix();
  return out;
};
window.__hide = () => { for (const id of ['hud', 'pause', 'perf']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } };
window.__place = () => { const s = fs.sim.state; s.pos.x = -92600; s.pos.y = 161900; s.pos.z = 10.806; s.hdg = 325.29 * Math.PI / 180; s.pitch = 0; s.roll = 0; };
window.__look = (azRelDeg, elDeg, d, fov, bx = 19.4, bz = 0.6, by = 0) => {
  __place(); fs.rig.viewId = 'orbit';   // not a seat view, or the nose is hidden
  const s = fs.sim.state, h = s.hdg;
  const tx = s.pos.x + bx * Math.sin(h) - by * Math.cos(h), ty = s.pos.y + bx * Math.cos(h) + by * Math.sin(h), tz = s.pos.z + bz;
  const azr = (h * 180 / Math.PI + azRelDeg) * Math.PI / 180, elr = elDeg * Math.PI / 180;
  const c = window.__freeCam; c.on = true;
  c.x = tx - d * Math.cos(elr) * Math.sin(azr); c.y = ty - d * Math.cos(elr) * Math.cos(azr); c.z = tz + d * Math.sin(elr);
  c.yaw = azr; c.pitch = -elr; c.fov = fov;
  __hide(); for (let i = 0; i < 3; i++) fs.renderOnce();
  return 'ok';
};
window.__seat = (id = 'captain', yawDeg = 0, pitchDeg = -6, fov = 62) => {
  __place(); window.__freeCam.on = false; fs.rig.viewId = id;
  const look = fs.rig.looks[id]; look.yaw = yawDeg * Math.PI / 180; look.pitch = pitchDeg * Math.PI / 180; look.fov = fov;
  __hide(); for (let i = 0; i < 3; i++) fs.renderOnce();
  return 'ok';
};`;
(async () => {
  const list = JSON.parse(process.argv[2]);
  const out = process.argv[3] || 'shots';
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '?test&origin=RKSI&dep=33L&dest=RKPC&start=runway', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__fs && window.__fs.sim, null, { timeout: 120000 });
  await page.evaluate(SETUP);
  for (const [name, expr] of list) {
    const t = Date.now();
    const url = await page.evaluate(`(${expr}, window.__fs.renderer.domElement.toDataURL('image/png'))`);
    require('fs').writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log(name, Date.now() - t, 'ms');
  }
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
