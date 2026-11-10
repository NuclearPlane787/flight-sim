// The Weather tab's presets and its sums (v0.4.0, Part 6). No DOM: the tests and the setup read it too.
//   PRESETS: [{ id, name, short, note }]
//   presetWeather(id, ctx): the full settings of src/sim/weather.js for a preset. Clear is exactly calmWeather().
//   weatherContext(airports, plan): the ctx a flight gives them, from the airport data and the plan
//     { refX, refY, arrival: { icao, x, y, hdgMagDeg, hdgGridDeg }, airports: [{ x, y }] }   (every part optional)
//   weatherForm(settings, ctx) / weatherFromForm(form, base, ctx): what the tab's fields hold, and back.
//   weatherCheck(form): what stops Apply.   metarOf(settings, icao): the METAR-style line.
// The numbers are Korea's cold half of the year, and every preset's wind veers with height (clockwise, as a
// northern-hemisphere boundary layer does): the surface wind doesn't veer by itself, the wind aloft says how much.

import { calmWeather, normalizeWeather, isDefaultWeather } from './weather.js';
import { magToGrid } from '../world/frame.js';

const DEG = Math.PI / 180, NM_M = 1852;
const wrap = (d) => ((d % 360) + 360) % 360;

export const PRESETS = [
  { id: 'clear', name: 'Clear', short: 'Clear', note: 'Calm, standard air' },
  { id: 'few-clouds', name: 'Few clouds', short: 'Few clouds', note: 'A light north-westerly under fair-weather cumulus' },
  { id: 'overcast', name: 'Overcast', short: 'Overcast', note: 'A grey, still day under two layers' },
  { id: 'rain', name: 'Rain', short: 'Rain', note: 'Moderate rain, a low ceiling, a wet runway' },
  // v0.4.1: storms by severity (Shane: "storms can have severity settings instead of on/off"). 'thunderstorm' is the
  // moderate one, so a plan saved with v0.4.0's id still has a storm.
  { id: 'thunderstorm-light', name: 'Thunderstorm, light', short: 'Light storm', note: 'Showers and some lightning, a gusty breeze, light turbulence' },
  { id: 'thunderstorm', name: 'Thunderstorm, moderate', short: 'Storm', note: 'Rain, lightning, gusts and moderate turbulence' },
  { id: 'thunderstorm-severe', name: 'Thunderstorm, severe', short: 'Severe storm', note: 'Heavy rain, a strong gusty wind, severe turbulence, and a microburst near an airport now and then' },
  { id: 'snow', name: 'Snow', short: 'Snow', note: 'Below freezing, a low ceiling, a covered runway' },
  { id: 'fog', name: 'Fog', short: 'Fog', note: 'Dense radiation fog, clear above it' },
  { id: 'gusty-crosswind', name: 'Gusty crosswind', short: 'Crosswind', note: '25 kt gusting 35, straight across the arrival runway' },
];

// Cover by name, as a METAR gives it. A preset's okta inside a band stays as it is until the band is changed.
export const COVERS = [['none', 0], ['FEW', 2], ['SCT', 4], ['BKN', 6], ['OVC', 8]];
export const coverOf = (okta) => (okta <= 0 ? 'none' : okta <= 2 ? 'FEW' : okta <= 4 ? 'SCT' : okta < 8 ? 'BKN' : 'OVC');
export const oktaOf = (name) => (COVERS.find(([n]) => n === name) || COVERS[0])[1];

// A small seeded generator of its own: microbursts are placed once, when the preset is built.
function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A severe storm's microbursts: rare, as real ones are (v0.4.1; v0.4.0 put 2 or 3 round every airport, 30 to 60 kt, and
// an approach nearly always met one). About one airport in three has one, 6 to 16 km out, 25 to 45 kt across 0.8 to 1.4 km.
function stormCells(seed, ctx) {
  const list = ctx?.airports?.length ? ctx.airports : (Number.isFinite(ctx?.refX) ? [{ x: ctx.refX, y: ctx.refY }] : []);
  const rnd = seeded(seed ^ 0x53c0), out = [];
  for (const a of list) {
    const has = rnd() < 1 / 3, th = rnd() * 2 * Math.PI, d = 6000 + rnd() * 10000, R = 800 + rnd() * 600, dv = 25 + rnd() * 20;
    if (has) out.push({ x: a.x + d * Math.sin(th), y: a.y + d * Math.cos(th), radiusM: Math.round(R), dvKt: Math.round(dv) });
  }
  return out;
}

export function presetWeather(id, ctx) {
  if (!PRESETS.some((p) => p.id === id) || id === 'clear') return calmWeather();
  const base = (o) => ({ ...calmWeather(), preset: id, refX: ctx?.refX ?? 0, refY: ctx?.refY ?? 0, ...o, seed: ctx?.seed ?? o.seed });
  const layer = (okta, baseFt, topFt) => ({ okta, baseFt, topFt });
  let s;
  switch (id) {
    case 'few-clouds':
      s = base({ seed: 11, wind: { fromDeg: 320, kt: 8, gustKt: 0 }, aloft: { fromDeg: 345, kt: 28 },
        visM: 40000, clouds: [layer(2, 4000, 5500)], tempC: 14, qnh: 1022 });
      break;
    case 'overcast':
      s = base({ seed: 12, wind: { fromDeg: 50, kt: 10, gustKt: 0 }, aloft: { fromDeg: 85, kt: 30 }, turbulence: 'light',
        visM: 15000, clouds: [layer(6, 2200, 4000), layer(8, 5000, 11000)], tempC: 9, qnh: 1011 });
      break;
    case 'rain':
      s = base({ seed: 13, wind: { fromDeg: 200, kt: 14, gustKt: 22 }, aloft: { fromDeg: 235, kt: 38 }, turbulence: 'light',
        visM: 4000, clouds: [layer(6, 1200, 3000), layer(8, 3500, 14000)], precip: { kind: 'rain', rate: 0.5 }, tempC: 12, qnh: 1006 });
      break;
    // Storms by severity (v0.4.1). The wind at the surface is gusty but holds its direction: the turbulence near the
    // ground follows the wind (weather.js), so it swings the crosswind by about a fifth of the wind, not a third.
    case 'thunderstorm-light':
      s = base({ seed: 18, wind: { fromDeg: 220, kt: 10, gustKt: 18 }, aloft: { fromDeg: 255, kt: 32 }, turbulence: 'light',
        visM: 9000, clouds: [layer(4, 3000, 6000), layer(6, 5000, 26000)], precip: { kind: 'rain', rate: 0.25 }, lightning: 0.35, tempC: 21, qnh: 1004 });
      break;
    case 'thunderstorm':
      s = base({ seed: 14, wind: { fromDeg: 230, kt: 14, gustKt: 26 }, aloft: { fromDeg: 265, kt: 40 }, turbulence: 'moderate',
        visM: 6000, clouds: [layer(4, 2500, 6000), layer(7, 4000, 32000)], precip: { kind: 'rain', rate: 0.55 }, lightning: 0.65, tempC: 19, qnh: 1001 });
      break;
    case 'thunderstorm-severe':
      s = base({ seed: 19, wind: { fromDeg: 240, kt: 20, gustKt: 38 }, aloft: { fromDeg: 270, kt: 50 }, turbulence: 'severe',
        visM: 2500, clouds: [layer(5, 1800, 5000), layer(8, 3000, 40000)], precip: { kind: 'rain', rate: 0.9 }, lightning: 0.9, tempC: 22, qnh: 997 });
      s.microbursts = stormCells(s.seed, ctx);
      break;
    case 'snow':
      s = base({ seed: 15, wind: { fromDeg: 320, kt: 12, gustKt: 20 }, aloft: { fromDeg: 345, kt: 42 }, turbulence: 'light',
        visM: 1800, clouds: [layer(6, 900, 3000), layer(8, 3500, 9000)], precip: { kind: 'snow', rate: 0.55 }, tempC: -4, qnh: 1024 });
      break;
    case 'fog':
      s = base({ seed: 16, wind: { fromDeg: 60, kt: 3, gustKt: 0 }, aloft: { fromDeg: 120, kt: 10 },
        visM: 250, fogTopFt: 350, tempC: 5, qnh: 1028 });
      break;
    case 'gusty-crosswind': {
      const hdg = ctx?.arrival?.hdgMagDeg;
      const from = Number.isFinite(hdg) ? Math.round(wrap(hdg + 90)) % 360 : 90;
      s = base({ seed: 17, wind: { fromDeg: from, kt: 25, gustKt: 35 }, aloft: { fromDeg: wrap(from + 20), kt: 42 }, turbulence: 'light',
        visM: 25000, clouds: [layer(3, 3500, 5000)], tempC: 9, qnh: 1016 });
      break;
    }
  }
  return normalizeWeather(s);
}

// ---- A flight's context, from the airport data and the plan ----
export function weatherContext(airports, plan) {
  const list = Array.isArray(airports) ? airports : Object.values(airports?.airports || airports || {}).filter((a) => a && a.icao);
  const ctx = { airports: list.filter((a) => a.origin).map((a) => ({ x: a.origin[0], y: a.origin[1] })) };
  const ap = list.find((a) => a.icao === plan?.dest);
  if (!ap) return ctx;
  if (ap.origin) { ctx.refX = ap.origin[0]; ctx.refY = ap.origin[1]; }
  for (const r of ap.runways || []) {
    const e = (r.ends || []).find((n) => n.ident === plan.arrRunway);
    if (e) ctx.arrival = { icao: ap.icao, x: e.x, y: e.y, hdgMagDeg: e.hdgMagDeg, hdgGridDeg: e.hdgGridDeg };
  }
  if (!ctx.arrival) ctx.arrival = { icao: ap.icao };
  return ctx;
}

// ---- The microburst on final ----
// A point on the extended centreline, `nm` before the threshold, as map metres.
function onFinal(ctx, nm) {
  const a = ctx?.arrival;
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  const h = Number.isFinite(a.hdgGridDeg) ? a.hdgGridDeg * DEG : magToGrid((a.hdgMagDeg ?? 0) * DEG, a.x, a.y);
  return { x: a.x - Math.sin(h) * nm * NM_M, y: a.y - Math.cos(h) * nm * NM_M, h };
}
export const canPlaceOnFinal = (ctx) => !!onFinal(ctx, 1);

// The burst the tab placed: the first one within 40 m of the extended centreline, 0.2 to 30 nm before the
// threshold. Worked out from the position, so a save needs nothing extra. → { index, nm, dvKt } or null.
export function finalMicroburst(s, ctx) {
  const p = onFinal(ctx, 0);
  if (!p) return null;
  const list = s?.microbursts || [], sin = Math.sin(p.h), cos = Math.cos(p.h);
  for (let i = 0; i < list.length; i++) {
    const m = list[i], dx = m.x - p.x, dy = m.y - p.y;
    const along = -(dx * sin + dy * cos), cross = dx * cos - dy * sin;
    if (Math.abs(cross) < 40 && along >= 0.2 * NM_M && along <= 30 * NM_M) return { index: i, nm: along / NM_M, dvKt: m.dvKt };
  }
  return null;
}

// ---- The form: what the tab's fields hold ----
const SPARE_LAYERS = [[3000, 4000], [6000, 8000], [12000, 15000]];
export const FINAL_BURST_RADIUS_M = 1200;

export function weatherForm(settings, ctx) {
  const s = normalizeWeather(settings), fin = finalMicroburst(s, ctx);
  return {
    wind: { ...s.wind }, aloft: { ...s.aloft },
    turbulence: s.turbulence,
    shear: s.shear ? { ...s.shear } : { ftAgl: 800, fromDeg: s.wind.fromDeg, kt: 0 },
    mbNm: fin ? fin.nm : 3, mbKt: fin ? fin.dvKt : 0,
    visM: s.visM, fogTopFt: s.fogTopFt,
    clouds: [0, 1, 2].map((i) => (s.clouds[i] ? { ...s.clouds[i] } : { okta: 0, baseFt: SPARE_LAYERS[i][0], topFt: SPARE_LAYERS[i][1] })),
    precipKind: s.precip.kind, precipRate: s.precip.rate, lightning: s.lightning, runway: s.runway,
    tempC: s.tempC, qnh: s.qnh,
  };
}

// The settings a form stands for, over `base` (the weather it was filled from). Nothing changed: base itself,
// preset and all. Anything changed: 'custom', unless that made it the calm world, which is simply Clear.
export function weatherFromForm(form, base, ctx) {
  const b = normalizeWeather(base), fin = finalMicroburst(b, ctx);
  const others = b.microbursts.filter((_, i) => !fin || i !== fin.index);
  let bursts = others;
  if (fin && form.mbNm === fin.nm && form.mbKt === fin.dvKt) bursts = b.microbursts;
  else if (form.mbKt > 0) {
    const p = onFinal(ctx, form.mbNm);
    if (p) bursts = [{ x: p.x, y: p.y, radiusM: FINAL_BURST_RADIUS_M, dvKt: form.mbKt }, ...others];
  }
  const s = normalizeWeather({ ...b,
    wind: { ...form.wind }, aloft: { ...form.aloft }, turbulence: form.turbulence,
    shear: form.shear.kt > 0 ? { ...form.shear } : null,
    microbursts: bursts, visM: form.visM, fogTopFt: form.fogTopFt,
    clouds: form.clouds.filter((c) => c.okta > 0).map((c) => ({ ...c })),
    precip: { kind: form.precipKind, rate: form.precipKind === 'none' ? 0 : form.precipRate },
    lightning: form.lightning, runway: form.runway, tempC: form.tempC, qnh: form.qnh,
  });
  if (JSON.stringify(s) === JSON.stringify(b)) return b;
  if (isDefaultWeather({ ...s, preset: 'clear', seed: 1, refX: 0, refY: 0 })) return calmWeather();
  return normalizeWeather({ ...s, preset: 'custom', refX: ctx?.refX ?? s.refX, refY: ctx?.refY ?? s.refY });
}

const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

// What stops Apply: blank or out-of-range fields, in the fields' order, with the setup's way of saying it.
export function weatherCheck(form, ctx) {
  const p = [];
  const need = (v, lo, hi, what) => { if (!inRange(v, lo, hi)) p.push(`${what}: ${lo} to ${hi}.`); };
  need(form.wind.fromDeg, 0, 360, 'Wind direction');
  need(form.wind.kt, 0, 100, 'Wind speed, kt');
  need(form.wind.gustKt, 0, 150, 'Gusts, kt (0 for none)');
  if (inRange(form.wind.gustKt, 0, 150) && inRange(form.wind.kt, 0, 100) && form.wind.gustKt > 0 && form.wind.gustKt < form.wind.kt) p.push('Gusts are the peak: at or above the wind speed, or 0 for none.');
  need(form.aloft.fromDeg, 0, 360, 'Wind aloft direction');
  need(form.aloft.kt, 0, 250, 'Wind aloft speed, kt');
  need(form.shear.kt, 0, 100, 'Shear speed, kt (0 for none)');
  if (form.shear.kt > 0) {
    need(form.shear.ftAgl, 50, 3000, 'Shear height, ft above the ground');
    need(form.shear.fromDeg, 0, 360, 'Shear direction');
  }
  need(form.mbKt, 0, 120, 'Microburst strength, kt (0 for none)');
  if (form.mbKt > 0) {
    if (!canPlaceOnFinal(ctx)) p.push('No arrival runway to put a microburst on.');
    else need(form.mbNm, 0.5, 15, 'Microburst distance, nm');
  }
  need(form.visM, 30, 150000, 'Visibility, m');
  need(form.fogTopFt, 0, 5000, 'Fog top, ft (0 for none)');
  form.clouds.forEach((c, i) => {
    if (c.okta <= 0) return;
    need(c.baseFt, 0, 60000, `Layer ${i + 1} base, ft`);
    need(c.topFt, 0, 60000, `Layer ${i + 1} top, ft`);
    if (inRange(c.baseFt, 0, 60000) && inRange(c.topFt, 0, 60000) && c.topFt <= c.baseFt) p.push(`Layer ${i + 1}: the top must be above the base.`);
  });
  need(form.tempC, -60, 60, 'Temperature, °C');
  need(form.qnh, 900, 1100, 'QNH, hPa');
  return p;
}

// ---- The METAR-style line: RKPC 25015G25KT 4000 -RA BKN012 OVC030 12/10 Q1008 ----
const pad = (n, w) => String(n).padStart(w, '0');
const tempText = (t) => { const r = Math.round(t); return (r < 0 ? 'M' : '') + pad(Math.abs(r), 2); };

function windGroup(w) {
  const kt = Math.round(w.kt), gust = Math.round(w.gustKt);
  if (kt < 1 && gust < 1) return '00000KT';
  const dir = Math.round(wrap(w.fromDeg) / 10) * 10 || 360;
  return `${pad(dir, 3)}${pad(kt, 2)}${gust > kt ? `G${pad(gust, 2)}` : ''}KT`;
}
function visGroup(m) {
  if (m >= 10000) return '9999';
  const step = m < 800 ? 50 : m < 5000 ? 100 : 1000;
  return pad(Math.round(m / step) * step, 4);
}
function weatherGroup(s) {
  const { kind, rate } = s.precip;
  const fall = kind === 'rain' ? 'RA' : kind === 'snow' ? 'SN' : '';
  const sign = !fall || rate <= 0 ? '' : rate < 0.3 ? '-' : rate >= 0.7 ? '+' : '';
  if (s.lightning > 0) return `${sign}TS${fall}`;
  if (fall && rate > 0) return sign + fall;
  if (s.fogTopFt > 0 && s.visM < 1000) return 'FG';
  if (s.visM < 5000) return 'BR';
  return '';
}
// The settings have no dewpoint: the spread a line like this would show for such a day.
function dewpoint(s) {
  const wet = s.precip.kind !== 'none' && s.precip.rate > 0;
  const low = s.clouds.some((c) => c.okta >= 5 && c.baseFt < 3000);
  const spread = s.fogTopFt > 0 && s.visM < 1000 ? 0 : wet ? 2 : low ? 4 : 8;
  return s.tempC - spread;
}

export function metarOf(settings, icao, ctx) {
  const s = normalizeWeather(settings);
  const parts = [icao || 'ZZZZ', windGroup(s.wind)];
  const wx = weatherGroup(s), layers = s.clouds.filter((c) => c.okta > 0).sort((a, b) => a.baseFt - b.baseFt);
  if (s.visM >= 10000 && !wx && layers.every((c) => c.baseFt >= 5000)) parts.push('CAVOK');
  else {
    parts.push(visGroup(s.visM));
    if (wx) parts.push(wx);
    if (layers.length) for (const c of layers) parts.push(`${coverOf(c.okta)}${pad(Math.round(c.baseFt / 100), 3)}`);
    else parts.push('NSC');
  }
  parts.push(`${tempText(s.tempC)}/${tempText(dewpoint(s))}`, `Q${pad(Math.floor(s.qnh), 4)}`);   // Q0998: always four digits
  if (s.shear || finalMicroburst(s, ctx)) parts.push('WS ALL RWY');
  return parts.join(' ');
}
