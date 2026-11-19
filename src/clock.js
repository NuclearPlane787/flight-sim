// The time of day: a clock in KST (UTC+9, no daylight saving) with a date. Pure: no DOM.
// main.js steps it with the SIM time it stepped, so time compression speeds the clock too,
// and the clock's own speed (1x real time up to 600x) multiplies on top of that.
// v0.6.0: with the region on, the times are shown in the zone where you are (the end of the file).

import { rulesAt, eastAsiaOn } from './world/region.js';

export const KST_OFFSET_MS = 9 * 3600e3;
const DAY_MS = 86400e3;

// The speeds the Sky window's - and + step through.
export const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600];

// The allowed speed nearest x (on a log scale).
export function snapSpeed(x) {
  if (!(x > 0)) return 1;
  let best = SPEEDS[0];
  for (const s of SPEEDS) if (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x))) best = s;
  return best;
}

export function createClock({ ms = nowKstMs(), running = true, speed = 1 } = {}) {
  const clock = {
    ms: Number.isFinite(ms) ? ms : nowKstMs(),
    running: !!running,
    speed: snapSpeed(speed),
    // Advance by dtSimS seconds of sim time (scaled by the clock's speed) while running.
    step(dtSimS) {
      if (clock.running && dtSimS > 0) clock.ms += dtSimS * 1000 * clock.speed;
      return clock.ms;
    },
    set(t) { if (Number.isFinite(t)) clock.ms = t; return clock.ms; },
    setRunning(b) { clock.running = !!b; },
    setSpeed(x) { clock.speed = snapSpeed(x); return clock.speed; },
    faster() {
      const i = SPEEDS.indexOf(clock.speed);
      clock.speed = SPEEDS[Math.min(SPEEDS.length - 1, i + 1)];
      return clock.speed;
    },
    slower() {
      const i = SPEEDS.indexOf(clock.speed);
      clock.speed = SPEEDS[Math.max(0, i - 1)];
      return clock.speed;
    },
    serialize() { return { ms: Math.round(clock.ms), running: clock.running, speed: clock.speed }; },
    // Restore from serialize()'s object; anything missing or malformed keeps its current value.
    load(o) {
      if (!o || typeof o !== 'object') return clock;
      if (Number.isFinite(o.ms)) clock.ms = o.ms;
      if (typeof o.running === 'boolean') clock.running = o.running;
      if (o.speed !== undefined) clock.speed = snapSpeed(o.speed);
      return clock;
    },
  };
  return clock;
}

// The real time now. Epoch ms are the same everywhere; "KST" is only how they're shown.
export function nowKstMs() { return Date.now(); }

// KST calendar parts of an epoch ms: month 1-12, dow 0 = Sunday.
export function kstParts(ms) {
  const d = new Date(Math.floor(ms) + KST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay(),
  };
}

// Epoch ms of a KST wall-clock time (month 1-12).
export function kstMs(y, mo, d, h = 0, mi = 0, s = 0) {
  return Date.UTC(y, mo - 1, d, h, mi, s) - KST_OFFSET_MS;
}

export function startOfKstDay(ms) {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

// 15:00 KST on ms's KST day (a migrated Scenario 1 starts there).
export function afternoonOf(ms) { return startOfKstDay(ms) + 15 * 3600e3; }

const pad = (n) => String(n).padStart(2, '0');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "14:05"
export function fmtKst(ms) {
  const p = kstParts(ms);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

// "Sun 1 Nov 2026"
export function fmtKstDate(ms) {
  const p = kstParts(ms);
  return `${DOW[p.dow]} ${p.d} ${MON[p.mo - 1]} ${p.y}`;
}

// ---- v0.6.0: local time (V060.md Part 5 step 8) ----
// The clock by the time zone where you are: `rulesAt()`'s IANA zone, read through the browser's (or node's) Intl,
// which has every zone offline, so a later region with summer time needs nothing here. No fixed offsets below:
// with the region off everything stays the KST functions above, exactly as v0.5.8 drew them. The epoch ms never
// change, nor do the sun and the stars: only what is shown. A zone is { timeZone, zoneName } (region.js's rules) or
// an IANA name (region.js is imported at the top).

export const KST_ZONE = Object.freeze({ timeZone: 'Asia/Seoul', zoneName: 'KST' });
// Whether the times are local (the region on). Off: KST everywhere, as v0.5.8.
export const localTimeOn = () => eastAsiaOn();
// The zone at a map point: the country's (region.js's rulesAt()), KST with the region off.
export function zoneAt(x, y) {
  if (!eastAsiaOn() || !Number.isFinite(x) || !Number.isFinite(y)) return KST_ZONE;
  const r = rulesAt(x, y);
  return r && r.timeZone ? { timeZone: r.timeZone, zoneName: r.zoneName || r.timeZone } : KST_ZONE;
}
// By an airport's ICAO code, where no position is at hand (a saved plan): the ICAO region's first letters.
const ICAO_ZONES = [['ZK', 'Asia/Pyongyang', 'KST'], ['RK', 'Asia/Seoul', 'KST'], ['RJ', 'Asia/Tokyo', 'JST'], ['RO', 'Asia/Tokyo', 'JST'], ['Z', 'Asia/Shanghai', 'CST']];
export function zoneOfIcao(icao) {
  const c = String(icao || '').toUpperCase();
  if (!eastAsiaOn()) return KST_ZONE;
  const z = ICAO_ZONES.find(([p]) => c.startsWith(p));
  return z ? { timeZone: z[1], zoneName: z[2] } : KST_ZONE;
}
const tzOf = (zone) => (typeof zone === 'string' ? zone : zone?.timeZone) || 'Asia/Seoul';
export const zoneLabel = (zone) => (typeof zone === 'string' ? zone : zone?.zoneName || zone?.timeZone) || 'KST';

const DTF = new Map();
function dtf(tz) {
  let f = DTF.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
    } catch { f = null; }
    DTF.set(tz, f);
  }
  return f;
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Calendar parts of an epoch ms in a zone (as kstParts()): month 1-12, dow 0 = Sunday. KST's own if Intl can't.
export function zoneParts(ms, zone) {
  const f = dtf(tzOf(zone));
  if (!f) return kstParts(ms);
  const p = {};
  for (const x of f.formatToParts(new Date(Math.floor(ms)))) p[x.type] = x.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), dow: WD[p.weekday] ?? 0 };
}
// The zone's offset from UTC at ms (ms; +9 h in Seoul and Tokyo, +8 h in Shanghai).
export function zoneOffsetMs(ms, zone) {
  const p = zoneParts(ms, zone), t = Math.floor(ms / 1000) * 1000;
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - t;
}
// Epoch ms of a wall-clock time in a zone (month 1-12). In a summer-time gap or overlap, the later reading.
export function zoneMs(y, mo, d, h = 0, mi = 0, s = 0, zone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wall - zoneOffsetMs(wall, zone);
  t = wall - zoneOffsetMs(t, zone);
  return t;
}
export function startOfZoneDay(ms, zone) { const p = zoneParts(ms, zone); return zoneMs(p.y, p.mo, p.d, 0, 0, 0, zone); }
// 15:00 on ms's day in the zone.
export function afternoonIn(ms, zone) { const p = zoneParts(ms, zone); return zoneMs(p.y, p.mo, p.d, 15, 0, 0, zone); }
// "14:05" and "Sun 1 Nov 2026" in a zone.
export function fmtZone(ms, zone) { const p = zoneParts(ms, zone); return `${pad(p.h)}:${pad(p.mi)}`; }
export function fmtZoneDate(ms, zone) { const p = zoneParts(ms, zone); return `${DOW[p.dow]} ${p.d} ${MON[p.mo - 1]} ${p.y}`; }
// The <input type=date>/<input type=time> values in a zone, and back (null if malformed, or a day that isn't).
export function zoneFieldValues(ms, zone) {
  const p = zoneParts(ms, zone);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
export function zoneFromFields(date, time, zone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!d || !t) return null;
  const [y, mo, dd, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59) return null;
  const ms = zoneMs(y, mo, dd, h, mi, 0, zone);
  const back = zoneParts(ms, zone);
  return back.mo === mo && back.d === dd ? ms : null;
}
