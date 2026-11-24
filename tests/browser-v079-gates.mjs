// v0.7.9, part 5: the gates' leftovers, headless: each type at a bridged gate with its nose wheel on the stop bar and
// the cab at its own door; the gates the new rules bridge (a long link, an elbow); the empty gates' bridges drawn back.
//   [FS_REGION=europe] node tests/browser-v079-gates.mjs --tag b [--base <url>] [--q "&gates79=0"] [--types a321neo,b787-9,b777-300er] EGLL EGLL:531 ...
// "ICAO" takes the third gate offered to the A321 and the 777 that has a bridge for both doors (as v0.7.8's check did);
// "ICAO:REF" starts at that stand (the first type only). Pictures
// "Claude outputs/flight-sim/v079-gate-<tag>-<icao>-<stand>-<type>-<side|above|apron>.png", the clock at 13:00 local.
// The last line printed: "done N of M".
import { chromium } from './pw.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { standList } from '../src/ground/gate-flow.js';
import { standHeading } from '../src/world/traffic-layout.js';
import { typeById } from '../src/sim/types.js';
import { REGION } from '../src/world/regions.js';
import { jetBridge, openRing, NOSE_AT, NOSE_WHEEL } from '../src/world/apron-geom.js';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), TAG = opt('--tag', 'b'), Q = opt('--q', '');
const TYPES = opt('--types', 'a321neo,b787-9,b777-300er').split(',');
const EU = process.env.FS_REGION === 'europe', OFF = /gates79=0/.test(Q);
const plan = [];
for (const arg of argv) {
  const [icao, ref] = arg.toUpperCase().split(':');
  const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${icao}.json`), 'utf8'));
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360;
  const end = ap.runways[0].ends[0].ident;
  if (ref) { plan.push({ icao, stand: ref, type: TYPES[0], end, named: true }); continue; }
  const T = (ap.buildings || []).filter((b) => b.kind === 'terminal').map((b) => openRing(b.points));
  const lists = ['a321neo', 'b777-300er'].map((t) => standList(ap, typeById(t)));
  const both = lists[1].filter((s) => s.gate && lists[0].some((n) => n.ref === s.ref)
    && ['a321neo', 'b777-300er'].every((t) => jetBridge(s, T, 80, true, typeById(t).geo.GATE_DOOR, { stands: ap.stands })));
  const st = both[Math.min(2, both.length - 1)];
  if (!st) { console.log(`${icao}: no bridged gate offered to both types`); continue; }
  for (const type of TYPES) plan.push({ icao, stand: st.ref, type, end });
}
console.log(plan.map((p) => `${p.icao} ${p.stand} ${p.type}`).join('; '));
const profile = mkdtempSync(path.join(tmpdir(), 'fs-v079-gates-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let done = 0, checks = 0, passed = 0;
const check = (name, ok, note) => { checks++; if (ok) passed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${note}`); };
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const p of plan) {
    const url = `${BASE}?test&eastasia=1${EU ? '&region=europe' : ''}&origin=${p.icao}&dep=${p.end}&dest=${p.icao}&arr=${p.end}&start=gate&stand=${encodeURIComponent(p.stand)}&view=orbit&type=${p.type}${Q}`;
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 60, null, { timeout: 90000 });
      const ms = zoneMs(2026, 11, 19, 13, 0, 0, zoneOfIcao(p.icao));
      const look = (y, pi, d) => page.evaluate(([yy, pp, dd, t]) => { const L = window.__fs.rig.looks.orbit; L.yaw = yy; L.pitch = pp; L.dist = dd; window.__fs.clock.set(t); }, [y, pi, d, ms]);
      const m = await page.evaluate(([bar]) => {
        const f = window.__fs, s = f.sim.state, st = f.gate.stand, h = st.hdgGridDeg * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h);
        const g = f.sim.type.geo, wx = s.pos.x + Math.sin(s.hdg) * g.GEAR.nose.x, wy = s.pos.y + Math.cos(s.hdg) * g.GEAR.nose.x;
        const sites = (f.world?.aprons?.sites || []).map((x) => `${x.icao} bridges ${x.info.bridges} doors ${x.doorsSet || 0}`).join(', ');
        return { stand: st.ref, wheelToBar: (wx - (st.x - fx * bar)) * fx + (wy - (st.y - fy * bar)) * fy, sites };
      }, [NOSE_AT - NOSE_WHEEL]);
      if (!p.named) check(`${p.icao} ${m.stand} ${p.type}: the nose wheel on the stop bar`, OFF ? true : Math.abs(m.wheelToBar) < 0.1, `${m.wheelToBar.toFixed(3)} m past it${OFF ? ' (switched off: as v0.7.8)' : ''}`);
      // the panels out of the pictures' way
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Hide panels'); if (b) b.click(); });
      const wide = p.type !== 'a321neo';
      const views = p.named ? [['above', 0.9, 1.05, 130], ['apron', 0.9, 1.2, 330]] : [['side', 2.3, 0.22, wide ? 62 : 48], ['above', 0.9, 0.95, wide ? 95 : 75]];
      for (const [what, y, pi, d] of views) {
        await look(y, pi, d);
        await page.waitForTimeout(what === 'side' || what === 'above' ? 4000 : 1500);
        const f = `v079-gate-${TAG}-${p.icao.toLowerCase()}-${String(m.stand).toLowerCase()}-${p.type}-${what}.png`;
        await page.screenshot({ path: path.join(OUT, f) });
        console.log(`  picture ${f}`);
      }
      console.log(`${p.icao} ${m.stand} ${p.type}: ${m.sites}${errors.length ? ' ERRORS ' + errors.join(' | ').slice(0, 300) : ''}`);
      check(`${p.icao} ${m.stand} ${p.type}: no page errors`, !errors.length, errors.splice(0).join(' | ').slice(0, 200));
      done++;
    } catch (e) { console.log(`${p.icao} ${p.stand} ${p.type}: FAILED ${String(e).slice(0, 200)}`); }
  }
} finally {
  await ctx.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the temp folder stays */ }
}
console.log(`checks ${passed} of ${checks}`);
console.log(`done ${done} of ${plan.length}`);
