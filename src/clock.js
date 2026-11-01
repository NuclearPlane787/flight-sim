// The time of day: a clock in KST (UTC+9, no daylight saving) with a date. Pure: no DOM.
// main.js steps it with the SIM time it stepped, so time compression speeds the clock too,
// and the clock's own speed (1x real time up to 600x) multiplies on top of that.

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
