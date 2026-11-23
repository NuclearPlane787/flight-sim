// v0.7.8, part 1: the player's aircraft at a bridged gate, an A321 and a 777 at each airport named, headless: the jet
// bridge's cab at the type's own front door, the stop bar under the nose wheel, the lead-in line ending at it.
// Each gate is the first the setup offers both types that has a bridge for both doors (apron-geom.js jetBridge()).
// Pictures "Claude outputs/flight-sim/v078-gate-<tag>-<icao>-<type>-<side|above>.png", the clock at 13:00 local.
//   FS_REGION=europe node tests/browser-v078-gates.mjs --tag b [--base <url>] [--q "&gates78=0"] [--types b777-300er] EGLL LFPG EDDF LEBL
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
import { jetBridge, openRing } from '../src/world/apron-geom.js';
import { zoneMs, zoneOfIcao } from '../src/clock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const BASE = opt('--base', 'http://127.0.0.1:8014/games/flight-sim/'), TAG = opt('--tag', 'b'), Q = opt('--q', '');
const TYPES = opt('--types', 'a321neo,b777-300er').split(',');
const EU = process.env.FS_REGION === 'europe';
const plan = [];
for (const icao of argv.map((s) => s.toUpperCase())) {
  const ap = JSON.parse(readFileSync(path.join(here, '..', REGION.data, `airports/${icao}.json`), 'utf8'));
  for (const st of ap.stands) if (!(st.leadIn && st.leadIn.length > 1)) st.hdgGridDeg = ((standHeading(ap, st) * 180) / Math.PI + 360) % 360;
  const T = (ap.buildings || []).filter((b) => b.kind === 'terminal').map((b) => openRing(b.points));
  const lists = ['a321neo', 'b777-300er'].map((t) => standList(ap, typeById(t)));
  const both = lists[1].filter((s) => s.gate && lists[0].some((n) => n.ref === s.ref)
    && ['a321neo', 'b777-300er'].every((t) => jetBridge(s, T, 80, true, typeById(t).geo.GATE_DOOR)));
  const st = both[Math.min(2, both.length - 1)];   // the third such gate: one with neighbours on both sides
  if (!st) { console.log(`${icao}: no bridged gate offered to both types`); continue; }
  const end = ap.runways[0].ends[0].ident;
  for (const type of TYPES) plan.push({ icao, stand: st.ref, type, end });
}
console.log(plan.map((p) => `${p.icao} ${p.stand} ${p.type}`).join('; '));
const profile = mkdtempSync(path.join(tmpdir(), 'fs-v078-gates-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let done = 0;
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
      const info = await page.evaluate(() => { const s = window.__fs.world?.aprons?.sites || []; return s.map((x) => `${x.icao} bridges ${x.info.bridges} doors ${x.doorsSet || 0}`).join(', '); });
      const wide = p.type !== 'a321neo';
      for (const [what, y, pi, d] of [['side', 2.3, 0.22, wide ? 62 : 48], ['above', 0.9, 0.95, wide ? 95 : 75]]) {
        await look(y, pi, d);
        await page.waitForTimeout(what === 'side' ? 5000 : 1500);
        const f = `v078-gate-${TAG}-${p.icao.toLowerCase()}-${p.type}-${what}.png`;
        await page.screenshot({ path: path.join(OUT, f) });
        console.log(`  picture ${f}`);
      }
      console.log(`${p.icao} ${p.stand} ${p.type}: ${info}${errors.length ? ' ERRORS ' + errors.splice(0).join(' | ').slice(0, 300) : ''}`);
      done++;
    } catch (e) { console.log(`${p.icao} ${p.stand} ${p.type}: FAILED ${String(e).slice(0, 200)}`); }
  }
} finally {
  await ctx.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the temp folder stays */ }
}
console.log(`done ${done} of ${plan.length}`);
