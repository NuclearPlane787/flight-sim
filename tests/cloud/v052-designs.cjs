// v0.5.2's review: designs made of parts, in the game, from the cloud: an A321 with a LEAP pair over the wing and
// two wing tanks; a 777 with its GE90s, a LEAP-1A pair on the rear fuselage and one in the tail (mixed engines), and
// ballast forward; a 787 with eight GEnx under the wing. Started by ?design=, on Gimpo 14R by day: a still from the
// side and from ahead, the engines the sim reports (each its own thrust at 70 % of the lever after 20 s on the brakes),
// none crashed.
//   node v052-designs.cjs outDir        FS_ROOT as in v043-shots.cjs
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

const P = (o) => ({ dx: 0, dz: 0, yaw: 0, pitch: 0, thrust: 1, x: 0, s: 0, ...o });
const DESIGNS = {
  'a321-overwing': { v: 2, id: 'dA', base: 'a321neo', name: 'Over-wing A321', registration: 'HL8521', gearExtendM: 0, parts: [
    P({ id: 'p1', kind: 'engine', engine: 'leap-1a', mount: 'wing', side: 1, s: 5.75, pair: 'p2' }), P({ id: 'p2', kind: 'engine', engine: 'leap-1a', mount: 'wing', side: -1, s: 5.75, pair: 'p1' }),
    P({ id: 'p3', kind: 'engine', engine: 'leap-1a', mount: 'overwing', side: 1, s: 9.5, pair: 'p4' }), P({ id: 'p4', kind: 'engine', engine: 'leap-1a', mount: 'overwing', side: -1, s: 9.5, pair: 'p3' }),
    { id: 'p5', kind: 'tank', mount: 'wing', side: 1, s: 12, dx: 0, kg: 3000, pair: 'p6' }, { id: 'p6', kind: 'tank', mount: 'wing', side: -1, s: 12, dx: 0, kg: 3000, pair: 'p5' }] },
  // Its CG kept within the warehouse's limits by ballast forward (with a GE90 in the tail and GEnx on the body it's
  // 30 % MAC aft, red, and full power on the brakes sits it on its tail: the physics, as the warehouse says).
  '777-trijet': { v: 2, id: 'dB', base: 'b777-300er', name: 'Mixed 777', registration: 'HL7005', gearExtendM: 0, parts: [
    P({ id: 'p1', kind: 'engine', engine: 'ge90-115b', mount: 'wing', side: 1, s: 9.61, pair: 'p2' }), P({ id: 'p2', kind: 'engine', engine: 'ge90-115b', mount: 'wing', side: -1, s: 9.61, pair: 'p1' }),
    P({ id: 'p3', kind: 'engine', engine: 'leap-1a', mount: 'body', side: 1, x: -9, pair: 'p4' }), P({ id: 'p4', kind: 'engine', engine: 'leap-1a', mount: 'body', side: -1, x: -9, pair: 'p3' }),
    P({ id: 'p5', kind: 'engine', engine: 'leap-1a', mount: 'tail', side: 0 }), { id: 'p6', kind: 'ballast', x: 25, kg: 6000, side: 0 }] },
  '787-eight': { v: 2, id: 'dC', base: 'b787-9', name: 'Eight-engine 787', registration: 'HL8008', gearExtendM: 0.5, parts: [7.1, 11.1, 15.1, 19.1].flatMap((s, k) => [
    P({ id: `a${k}`, kind: 'engine', engine: 'genx-1b', mount: 'wing', side: 1, s, thrust: 0.6, pair: `b${k}` }), P({ id: `b${k}`, kind: 'engine', engine: 'genx-1b', mount: 'wing', side: -1, s, thrust: 0.6, pair: `a${k}` })]) },
};
const COUNT = { 'a321-overwing': 4, '777-trijet': 5, '787-eight': 8 };
(async () => {
  const rkss = JSON.parse(require('fs').readFileSync(__dirname + '/../../data/airports/RKSS.json', 'utf8'));
  const e0 = rkss.runways[0].ends[0];
  const browser = await chromium.launch({ args: ARGS });
  let bad = 0;
  for (const [tag, d] of Object.entries(DESIGNS)) {
    const page = await open(browser, ROOT + 'flight-sim/', '?test&origin=RKSS&dep=14R&dest=RKPC&start=runway&design=' + encodeURIComponent(JSON.stringify(d)));
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => { const s = window.__fs.sim; return { engines: s.state.engines.length, design: s.design && s.design.name, mass: Math.round(s.state.mass), base: s.design && s.design.base }; });
    const ok = info.engines === COUNT[tag] && info.design === d.name;
    if (!ok) bad++;
    console.log(ok ? 'PASS' : 'FAIL', tag, JSON.stringify(info));
    await page.screenshot({ path: `${out}/${tag}-hud.png` }).catch((e) => console.log('no hud picture', String(e).split('\n')[0]));
    // 70 % of the lever for 20 s on the brakes (full power lifts a light five-engine 777's nose into a tail strike, as the
    // warehouse warns): each engine makes its own type's thrust.
    const T = await page.evaluate(async () => {
      const fs = window.__fs, s = fs.sim;
      s.controls.parkingBrake = true; s.controls.thrust = 0.7;
      for (let i = 0; i < 2400; i++) s.step(1 / 120);
      const out = s.state.engines.map((e) => Math.round(e.thrustN / 1000));
      s.controls.thrust = 0; for (let i = 0; i < 2400; i++) s.step(1 / 120);
      return out;
    });
    console.log('thrust kN', tag, T.join(' '));
    if (tag === '777-trijet' && !(Math.max(...T) > 2 * Math.min(...T))) { bad++; console.log('FAIL mixed engines should differ'); }
    const crashed = await page.evaluate(() => window.__fs.sim.state.crashed);
    if (crashed) { bad++; console.log('FAIL crashed', crashed); }
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
