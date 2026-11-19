// v0.5.8: the home page's three photos, rendered from the game in headless Chromium (SwiftShader) with a free
// camera, read straight off the canvas (page.screenshot hangs on the 3D page), the HUD hidden:
//   b777-landing-day      the 777-300ER over RKSI 33L's touchdown zone at 14:30, gear and flaps 30 down, from ahead
//                         and to the left, above (the runway and its markings under it)
//   b787-cruise-night     the 787-9 at 4,500 m west of Seoul at 22:00 on 18 Nov, from ahead and to the left, above:
//                         the city's lights below, the stars and the aurora above
//   a321-pushback-sunset  the A321neo 14 s into its pushback from Gimpo stand 3 (a gate start; gate.onKey('pushback')
//                         is Shift+G's) at 17:05, the low sun behind it. The game draws no tug on the player's
//                         pushback (gate-flow.js moves the aircraft itself), so there's none in the picture.
//   node v058-photos.cjs outDir [names,comma,separated]      (FS_BASE as in stills.cjs; 2-4 minutes a shot)
// Each shot is a 1200x800 PNG (outDir/<name>.png, the chosen view; other views as <name>-<tag>.png). The home
// page's JPEGs are made from them with PIL (the last lines below print the command).
const { chromium } = require('playwright');
const BASE = process.env.FS_BASE || 'http://127.0.0.1:8765/games/flight-sim/';
const out = process.argv[2] || 'v058-photos';
const only = process.argv[3] ? process.argv[3].split(',') : null;
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEW = { width: 1200, height: 800 };
const KST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, 0);

// The free camera (as stills.cjs), aimed at a body point of the aircraft where it is now.
const FREECAM = `
const fs = window.__fs;
fs.setPaused(true, true);
const orig = fs.rig.update;
window.__freeCam = { on: false, x: 0, y: 0, z: 50, yaw: 0, pitch: -0.5, fov: 60 };
fs.rig.update = (s, out = { x: 0, y: 0, z: 0 }) => {
  const c = window.__freeCam;
  if (!c.on) return orig(s, out);
  const cam = fs.rig.camera;
  out.x = c.x; out.y = c.y; out.z = c.z;
  cam.position.set(0, c.z, 0);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(c.pitch, -c.yaw, c.roll || 0);
  cam.fov = c.fov; cam.near = 0.5; cam.updateProjectionMatrix();
  return out;
};
window.__hide = () => { for (const id of ['hud', 'pause', 'perf', 'toast', 'score']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } };
// azRel° round from behind (180 = in front, 90 = the left side), el° above, d m out, fov° (vertical); the body
// point bx fwd, by left, bz up from the reference point; dz lifts the aim (+ puts the aircraft lower in the frame).
window.__look = (azRelDeg, elDeg, d, fov, bx = 0, bz = 0, by = 0, aimUp = 0) => {
  fs.rig.viewId = 'orbit';
  const s = fs.sim.state, h = s.hdg;
  const tx = s.pos.x + bx * Math.sin(h) - by * Math.cos(h), ty = s.pos.y + bx * Math.cos(h) + by * Math.sin(h), tz = s.pos.z + bz;
  const azr = (h * 180 / Math.PI + azRelDeg) * Math.PI / 180, elr = elDeg * Math.PI / 180;
  const c = window.__freeCam; c.on = true;
  c.x = tx - d * Math.cos(elr) * Math.sin(azr); c.y = ty - d * Math.cos(elr) * Math.cos(azr); c.z = tz + d * Math.sin(elr);
  c.yaw = azr; c.pitch = -elr + aimUp * Math.PI / 180; c.fov = fov;
  __hide(); fs.renderOnce();
  return 'ok';
};
window.__settle = async (n = 8) => { for (let i = 0; i < n; i++) { fs.renderOnce(); await new Promise((r) => setTimeout(r, 120)); } };
`;

// Each shot: a start (the URL's query), the clock (KST), a setup run in the page, and its views
// [tag, azRel°, el°, d m, fov°, bx, bz, by, aimUp°]; the first view is the photo.
const SHOTS = {
  'b777-landing-day': {
    q: 'origin=RKSS&dep=14R&dest=RKSI&arr=33L&start=final&type=b777-300er&fuel=12000',
    ms: KST(2026, 11, 18, 14, 30),
    setup: `(() => {
      const fs = window.__fs, ax = fs.runwayAxis(fs.dest.end, fs.dest.other);
      // Over the touchdown zone, 250 m past the threshold, about to flare: gear down, flaps 30, 150 kt.
      const d = -250, elev = fs.dest.end.elevM ?? fs.dest.airport.elevM;
      fs.sim.reset({ x: ax.tx - ax.ux * d, y: ax.ty - ax.uy * d, z: elev + 17,
        hdg: ax.hdg, onGround: false, iasMs: 150 / 1.943844, flapLever: 6, gearDown: true, fuelKg: 12000, payloadKg: 30000 });
      fs.sim.controls.gearDown = true; fs.sim.controls.flapLever = 6; fs.sim.controls.speedbrake = 0;
      for (let i = 0; i < 24; i++) fs.sim.step(1 / 120);
      const s = fs.sim.state; return { z: s.pos.z - elev, pitch: s.pitch * 180 / Math.PI, gear: s.gearPos, flap: s.flapPos };
    })()`,
    views: [['a', 130, 12, 125, 40, 0, 0, 0, 2], ['b', 150, 8, 125, 40, 0, 0, 0, 1], ['c', 18, 10, 120, 40, 30, 0, 0, 3]],
  },
  'b787-cruise-night': {
    q: 'origin=RKSS&dep=14R&dest=RKPC&start=runway&type=b787-9&fuel=20000',
    ms: KST(2026, 11, 18, 22, 0),
    setup: `(() => {
      const fs = window.__fs;
      // West of Seoul at 4,500 m, heading west-northwest out to sea, clean: Seoul's lights behind it.
      fs.sim.reset({ x: -66000, y: 163000, z: 4500, hdg: 290 * Math.PI / 180, onGround: false, iasMs: 280 / 1.943844, flapLever: 0, gearDown: false, fuelKg: 20000, payloadKg: 25000 });
      fs.sim.controls.gearDown = false; fs.sim.controls.flapLever = 0;
      for (let i = 0; i < 60; i++) fs.sim.step(1 / 120);
      const s = fs.sim.state; return { z: s.pos.z, pitch: s.pitch * 180 / Math.PI };
    })()`,
    views: [['a', 145, 13, 82, 45, 0, 0, 0, 1], ['b', 130, 18, 85, 45, 0, 0, 0, 2]],
  },
  'a321-pushback-sunset': {
    q: 'origin=RKSS&dep=14R&dest=RKPC&start=gate&stand=3&type=a321neo&fuel=6000',
    ms: KST(2026, 11, 18, 17, 5),
    setup: `(() => {
      const fs = window.__fs;
      fs.gate.onKey('pushback');      // Shift+G's pushback, from the gate start
      for (let i = 0; i < 30 * 14; i++) { fs.sim.step(1 / 30); fs.gate.update(1 / 30, fs.sim.controls); }
      fs.gate.line?.clear();          // the taxi route's guide line on the ground: not in a photo
      const s = fs.sim.state; return { phase: fs.gate.phase, running: fs.gate.pushback?.state.running, stand: fs.gate.stand?.ref, hdg: s.hdg * 180 / Math.PI };
    })()`,
    views: [['a', 210, 8, 60, 42, 0, 0, 0, 3], ['b', 200, 10, 64, 42, 0, 0, 0, 3]],
  },
};
const VIEWS = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : {};   // { name: [views…] } overrides, for trying angles

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  for (const name of only || Object.keys(SHOTS)) {
    const shot = SHOTS[name];
    const t0 = Date.now();
    const page = await browser.newPage({ viewport: VIEW });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}?test&${shot.q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.plan, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    await page.evaluate(FREECAM);
    const info = await page.evaluate(shot.setup);
    await page.evaluate((ms) => { const c = window.__fs.clock; c.set(ms); c.setRunning(false); }, shot.ms);
    console.log(name, 'set up', JSON.stringify(info), Math.round((Date.now() - t0) / 1000), 's');
    const views = VIEWS[name] || shot.views;
    for (let k = 0; k < views.length; k++) {
      const [tag, ...v] = views[k];
      await page.evaluate(`__look(${v.join(',')})`);
      await page.evaluate(`__settle(${k === 0 ? 6 : 2})`);
      const url = await page.evaluate(`(__look(${v.join(',')}), window.__fs.renderer.domElement.toDataURL('image/png'))`);
      const file = `${out}/${name}${k === 0 && !VIEWS[name] ? '' : '-' + tag}.png`;
      require('fs').writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log('  view', tag, file, Math.round((Date.now() - t0) / 1000), 's');
    }
    if (errors.length) console.log('  errors:', errors.slice(0, 4));
    await page.close();
  }
  await browser.close();
  console.log(`JPEGs: python3 -c "from PIL import Image; import sys; [Image.open('${out}/'+n+'.png').convert('RGB').resize((1200, 800), Image.LANCZOS).save('assets/menu/'+n+'.jpg', quality=85, optimize=True, progressive=True) for n in sys.argv[1:]]" ${Object.keys(SHOTS).join(' ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
