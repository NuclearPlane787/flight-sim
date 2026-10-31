// Airport life screenshots and numbers (traffic.js), in Chrome on the real GPU.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 6 -- node games/flight-sim/tests/browser-traffic.mjs [name ...]
// Writes Claude outputs/flight-sim/traffic-<name>.png; prints fps, draw calls, triangles
// and the traffic update cost.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { placeParked, createVehicles, chainRoads } from '../src/world/traffic-layout.js';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const BASE = 'http://localhost:8001/games/flight-sim/tests/dev-traffic.html';

// Each shot: the airport and a pose function run in the page. It gets the site (from
// traffic.sites) and returns { x, y, z (m MSL), lookX, lookY, lookZ, fov }.
const SHOTS = {
  // Behind the tails at Gimpo's domestic gates, looking at the terminal.
  'gimpo-apron': { icao: 'RKSS', pose: `(s) => {
    const g = s.parked.filter(p => s.a.stands.find(t => t.ref === p.stand)?.gate);
    const p = g[Math.floor(g.length / 2)];
    const h = p.hdg, fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    const tx = p.x - fx * 25, ty = p.y - fy * 25;
    return { x: tx - fx * 110 + rx * 70, y: ty - fy * 110 + ry * 70, z: s.elev + 55, lookX: tx, lookY: ty, lookZ: s.elev + 2, fov: 55 };
  }` },
  // Incheon from 1,500 ft, a few km out, over the apron.
  'incheon-1500': { icao: 'RKSI', pose: `(s) => {
    const P = s.parked;
    const c = P.reduce((a, p) => [a[0] + p.x / P.length, a[1] + p.y / P.length], [0, 0]);
    return { x: c[0] + 1800, y: c[1] - 1600, z: s.elev + 1500 * 0.3048, lookX: c[0] + 200, lookY: c[1], lookZ: s.elev, fov: 50 };
  }` },
  // Incheon closer: widebodies and narrowbodies side by side.
  'incheon-gates': { icao: 'RKSI', pose: `(s) => {
    const w = s.parked.filter(p => p.type === 1);
    const p = w[Math.floor(w.length / 3)];
    const h = p.hdg;
    const bx = p.x - Math.sin(h) * 70, by = p.y - Math.cos(h) * 70;
    return { x: bx - Math.sin(h) * 220 + Math.cos(h) * 140, y: by - Math.cos(h) * 220 - Math.sin(h) * 140, z: s.elev + 70, lookX: bx, lookY: by, lookZ: s.elev + 3, fov: 55 };
  }` },
  // A widebody close up, from ahead and to one side, with its neighbours.
  'incheon-widebody': { icao: 'RKSI', pose: `(s) => {
    const w = s.parked.filter(p => p.type === 1);
    const ok = (p) => {
      const h = p.hdg, cx = p.x - Math.sin(h) * 30 + Math.cos(h) * 70 + Math.sin(h) * 60, cy = p.y - Math.cos(h) * 30 - Math.sin(h) * 70 + Math.cos(h) * 60;
      return s.parked.every(q => q === p || Math.hypot(q.x - cx, q.y - cy) > 75);
    };
    const p = w.find(ok) || w[0];
    const h = p.hdg, fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
    const tx = p.x - fx * 30, ty = p.y - fy * 30;
    return { x: tx + rx * 70 + fx * 60, y: ty + ry * 70 + fy * 60, z: s.elev + 16, lookX: tx, lookY: ty, lookZ: s.elev + 6, fov: 55 };
  }` },
  'jeju-apron': { icao: 'RKPC', pose: `(s) => {
    const g = s.parked.filter(p => s.a.stands.find(t => t.ref === p.stand)?.gate);
    const c = g.reduce((a, p) => [a[0] + p.x / g.length, a[1] + p.y / g.length], [0, 0]);
    const h = g[0].hdg;
    return { x: c[0] - Math.sin(h) * 300 - Math.cos(h) * 150, y: c[1] - Math.cos(h) * 300 + Math.sin(h) * 150, z: s.elev + 60, lookX: c[0], lookY: c[1], lookZ: s.elev + 4, fov: 55 };
  }` },
  // A Nuclear Airlines narrowbody next to a made-up livery, from the side.
  'liveries': { icao: 'RKSS', pose: `(s) => {
    const P = s.parked.filter(p => p.type === 0);
    let best = null;
    for (const a of P) if (a.livery === 0) for (const b of P) if (b.livery !== 0) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!(d > 30 && d < 60 && Math.abs(Math.cos(a.hdg - b.hdg)) > 0.97)) continue;
      // The camera spot (ahead of them, to one side) must be clear of other aircraft.
      const fx = Math.sin(a.hdg), fy = Math.cos(a.hdg), sx = (b.x - a.x) / d, sy = (b.y - a.y) / d;
      const mx = (a.x + b.x) / 2 - fx * 20, my = (a.y + b.y) / 2 - fy * 20;
      const cx = mx + fx * 80 - sx * 55, cy = my + fy * 80 - sy * 55;
      const clear = s.parked.every(p => p === a || p === b || Math.hypot(p.x - fx * 20 - cx, p.y - fy * 20 - cy) > 90);
      if (clear && (!best || d < best.d)) best = { a, b, d };
    }
    const { a, b } = best;
    const h = a.hdg, fx = Math.sin(h), fy = Math.cos(h);
    // Between the two, 20 m behind the noses; looked at from ahead and to one side.
    const mx = (a.x + b.x) / 2 - fx * 20, my = (a.y + b.y) / 2 - fy * 20;
    const sx = (b.x - a.x) / best.d, sy = (b.y - a.y) / best.d;
    return { x: mx + fx * 80 - sx * 55, y: my + fy * 80 - sy * 55, z: s.elev + 22, lookX: mx, lookY: my, lookZ: s.elev + 4, fov: 50, pair: [a.livery, b.livery] };
  }` },
  // Vehicles close up on a service road.
  'vehicles': { icao: 'RKSS', pose: `(s) => {
    const v = s.fleet.vehicles.find(v => v.kind === 'cart') || s.fleet.vehicles[0];
    return { follow: v, off: [22, -18, 9], fov: 50 };
  }` },
  'vehicles-bus': { icao: 'RKSI', pose: `(s) => {
    const v = s.fleet.vehicles.find(v => v.kind === 'bus') || s.fleet.vehicles[0];
    return { follow: v, off: [-25, 20, 10], fov: 50 };
  }` },
  'vehicles-fuel': { icao: 'RKPC', pose: `(s) => {
    const v = s.fleet.vehicles.find(v => v.kind === 'fuel') || s.fleet.vehicles[0];
    return { follow: v, off: [18, 16, 7], fov: 50 };
  }` },
};

// Plan views (an SVG drawn here from the same layout code, screenshotted): buildings grey,
// runways black, taxiways yellow, service roads white, aircraft footprints (fuselage, wing
// and tailplane boxes, without the clearance margin) coloured by livery, vehicles red.
const DATA = new URL('../data/airports/', import.meta.url);
const LIV = ['#1a2f6b', '#e2661c', '#0f8f8c', '#7a3fb0'];
function planSvg(icao, win) {
  const a = JSON.parse(readFileSync(new URL(`${icao}.json`, DATA)));
  const parked = placeParked(a);
  const fleet = createVehicles(a);
  fleet.step(30);
  let [x0, y0, x1, y1] = win || [Infinity, Infinity, -Infinity, -Infinity];
  if (!win) for (const s of a.stands) { x0 = Math.min(x0, s.x - 150); y0 = Math.min(y0, s.y - 150); x1 = Math.max(x1, s.x + 150); y1 = Math.max(y1, s.y + 150); }
  const W = 1440, H = 900, k = Math.min(W / (x1 - x0), H / (y1 - y0));
  const X = (x) => ((x - x0) * k).toFixed(1), Y = (y) => (H - (y - y0) * k).toFixed(1);
  const poly = (P, attrs) => `<polygon points="${P.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" ${attrs}/>`;
  const line = (P, attrs) => `<polyline points="${P.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="none" ${attrs}/>`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#cfd3c8">`];
  for (const ap of a.aprons || []) out.push(poly(ap.points, 'fill="#b9bbb5"'));
  for (const r of a.runways) {
    const [e0, e1] = r.ends, L = Math.hypot(e1.x - e0.x, e1.y - e0.y), ux = (e1.x - e0.x) / L, uy = (e1.y - e0.y) / L, hw = r.widthM / 2;
    out.push(poly([[e0.x - uy * hw, e0.y + ux * hw], [e1.x - uy * hw, e1.y + ux * hw], [e1.x + uy * hw, e1.y - ux * hw], [e0.x + uy * hw, e0.y - ux * hw]], 'fill="#222"'));
  }
  for (const t of a.taxiways || []) out.push(line(t.points, `stroke="#d9b400" stroke-width="${Math.max(1, 1.2 * k)}"`));
  for (const r of a.serviceRoads || []) out.push(line(r.points, `stroke="#fff" stroke-width="${Math.max(1, 5 * k)}"`));
  for (const b of a.buildings || []) out.push(poly(b.points, 'fill="#777" stroke="#444"'));
  for (const p of parked) for (const r of p.fp) {
    const hl = r.hl - 2, hw = r.hw - 2;   // without the 2 m clearance margin
    const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [r.cx + r.ux * hl * s - r.uy * hw * t, r.cy + r.uy * hl * s + r.ux * hw * t]);
    out.push(poly(c, `fill="${LIV[p.livery]}" fill-opacity="${p.type ? 0.85 : 0.6}"`));
  }
  for (const s of a.stands) out.push(`<circle cx="${X(s.x)}" cy="${Y(s.y)}" r="1.5" fill="#000"/>`);
  for (const v of fleet.vehicles) out.push(`<circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${Math.max(2, 3 * k)}" fill="#e01010"/>`);
  out.push(`<text x="10" y="24" font-family="Helvetica" font-size="18">${icao}: ${parked.length} parked (${parked.filter((p) => p.type).length} widebody) of ${a.stands.length} stands, ${fleet.vehicles.length} vehicles; ${(1 / k).toFixed(2)} m/px</text>`);
  out.push('</svg>');
  return out.join('\n');
}
const PLANS = {
  'plan-gimpo': ['RKSS'],
  'plan-jeju': ['RKPC'],
  'plan-incheon': ['RKSI'],
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : [...Object.keys(SHOTS), ...Object.keys(PLANS)];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,960'] });
const results = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const name of names) {
    if (name.startsWith('plan-')) {
      // plan-<airport> or plan-<airport>@x0,y0,x1,y1 (a zoomed window, map metres)
      const [base, win] = name.split('@');
      const icao = PLANS[base][0];
      const page = await ctx.newPage();
      await page.setContent(planSvg(icao, win ? win.split(',').map(Number) : null));
      await page.screenshot({ path: `${OUT}/traffic-${name.replace(/[@,.]/g, '_')}.png` });
      console.log(`${name}: plan written`);
      await page.close();
      continue;
    }
    const shot = SHOTS[name];
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${BASE}?x=0&y=0&alt=3000`);
    try {
      await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 60000 });
    } catch (e) {
      console.log(name, 'did not start', errors.join('\n'));
      results.push({ name, error: 'timeout', errors });
      await page.close();
      continue;
    }
    const pose = await page.evaluate(({ icao, pose }) => {
      const d = window.__dev;
      const s = d.traffic.sites.find((t) => t.a.icao === icao);
      const p = (0, eval)(pose)(s);
      const c = d.cam;
      if (p.follow) {
        // Keep the camera at an offset from a moving vehicle, every frame.
        const v = p.follow, o = p.off;
        const tick = () => {
          c.x = v.x + o[0]; c.y = v.y + o[1]; c.z = v.z + o[2];
          c.hdg = Math.atan2(-o[0], -o[1]);
          c.pitch = Math.atan2(-o[2] + 1, Math.hypot(o[0], o[1]));
          requestAnimationFrame(tick);
        };
        tick();
        d.camera.fov = p.fov || 55; d.camera.updateProjectionMatrix();
        return { follow: v.kind };
      }
      c.x = p.x; c.y = p.y; c.z = p.z;
      c.hdg = Math.atan2(p.lookX - p.x, p.lookY - p.y);
      c.pitch = Math.atan2(p.lookZ - p.z, Math.hypot(p.lookX - p.x, p.lookY - p.y));
      d.camera.fov = p.fov || 55; d.camera.updateProjectionMatrix();
      return p;
    }, shot);
    await page.waitForTimeout(2500);
    const perf = await page.evaluate(async () => {
      const d = window.__dev;
      const n0 = d.frameTimes.length, u0 = d.updTimes.length;
      await new Promise((r) => setTimeout(r, 2000));
      const ft = d.frameTimes.slice(n0);
      const ut = d.updTimes.slice(Math.max(0, d.updTimes.length - (d.frameTimes.length - n0)));
      const avg = ft.reduce((a, b) => a + b, 0) / Math.max(ft.length, 1);
      return { fps: 1000 / avg, worstMs: Math.max(...ft), calls: d.info.calls, triangles: d.info.triangles, traffic: d.info.traffic,
        updAvg: ut.reduce((a, b) => a + b, 0) / Math.max(ut.length, 1), updMax: Math.max(...ut), cpuMs: d.info.cpuMs };
    });
    // setPlayerStand: the parked aircraft at one stand goes, and comes back on null.
    const ps = await page.evaluate((icao) => {
      const t = window.__dev.traffic;
      const n0 = t.occupiedStands(icao).length;
      const ref = t.occupiedStands(icao)[3];
      t.setPlayerStand(icao, ref);
      const n1 = t.occupiedStands(icao).length, gone = !t.occupiedStands(icao).includes(ref);
      t.setPlayerStand(icao, null);
      return { n0, n1, gone, n2: t.occupiedStands(icao).length };
    }, shot.icao);
    if (!(ps.gone && ps.n1 < ps.n0 && ps.n2 === ps.n0)) errors.push(`setPlayerStand check failed: ${JSON.stringify(ps)}`);
    await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${OUT}/traffic-${name}.png` });
    const r = { name, pose, ...perf, errors };
    results.push(r);
    const t = perf.traffic;
    console.log(`${name}: ${perf.fps.toFixed(1)} fps (worst ${perf.worstMs.toFixed(1)} ms), total ${perf.calls} calls ${(perf.triangles / 1000).toFixed(0)}k tris; ` +
      `traffic ${t.drawCalls} calls ${(t.triangles / 1000).toFixed(0)}k tris, parked ${t.parked}, vehicles ${t.vehicles}, update avg ${perf.updAvg.toFixed(4)} ms max ${perf.updMax.toFixed(3)} ms` +
      (pose.pair ? ` liveries ${pose.pair}` : '') + (errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''));
    await page.close();
  }
} finally {
  await browser.close();
}
mkdirSync('/tmp/flight-sim/traffic', { recursive: true });
writeFileSync('/tmp/flight-sim/traffic/last-run.json', JSON.stringify(results, null, 2));
