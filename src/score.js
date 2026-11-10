// The landing score: worked out at the first touchdown, finished after the rollout.
//
// Since v0.1.3 it's 100 × e^(−C), where C adds up a cost for each part of the landing:
// vertical speed and peak g, the touchdown point against the aiming point, distance from
// the centreline, bank, pitch, bounces, and the approach (how far off the glide path and
// localizer it was from 1,000 ft down, and how much the sink rate swung). Every cost is 0
// only at its ideal and grows smoothly away from it, with no free band, so 100 takes a
// landing that's perfect in every part, and 0 takes several things going badly wrong at once.
//
// Shane's yardstick (2026-10-31): his landing at 190 ft/min, 2 m left of the centreline and
// 150 m past the aiming point, after a final flown low (about 150 ft 1 km out) with a bob to
// get back up, scored 100 under v0.1.2 and should score 80 (tests/score.test.mjs rebuilds it).
//
// A touchdown that isn't on a runway costs 2.3 (×0.1) more, and says so.

import { GROUND_Z } from './geometry.js';
import { gridToMag } from './world/frame.js';

const FT = 3.28084;
const DEG = 180 / Math.PI;

// Where a touchdown is measured: the runway end being landed on, in map metres.
// An end's x/y is its landing threshold (displacement already applied); the landing
// distance runs to the far end's pavement.
export function runwayFrame(end, other) {
  const dx = other.x - end.x, dy = other.y - end.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const [fx, fy] = other.pavementEnd || [other.x, other.y];
  return { x: end.x, y: end.y, ux, uy, lda: (fx - end.x) * ux + (fy - end.y) * uy };
}

// Along-track and cross-track position (m) from the landing threshold.
export function alongCross(rf, x, y) {
  const rx = x - rf.x, ry = y - rf.y;
  return { along: rx * rf.ux + ry * rf.uy, cross: rx * rf.uy - ry * rf.ux };
}

// v0.4.0: the wind at touchdown, as the tower gives it (the surface wind at 10 m: magnetic, "from", knots, and the
// gusts' peak, gustKt, 0 for none), with its parts along and across the runway landed on (rf: its frame, or null).
// head is + for a headwind; side is the side the wind comes from. (The review of 2026-11-10 moved it from the mean
// wind at the aircraft's height, which read about 13 kt in a 15 kt wind, to the tower's figure, which the panel and
// its METAR line give.) The score's costs don't use it: a crosswind is harder, not scored differently.
export function windAtTouchdown(s, rf) {
  const w = s.wind;
  if (!w) return null;
  const mx = w.sfcX ?? w.meanX, my = w.sfcY ?? w.meanY, ms = Math.hypot(mx, my);
  if (ms < 0.25) return { fromDeg: 0, kt: 0, gustKt: 0, head: 0, cross: 0, side: '' };
  const fromDeg = gridToMag(Math.atan2(-mx, -my), s.pos.x, s.pos.y) * 180 / Math.PI;
  const out = { fromDeg, kt: ms * 1.943844, gustKt: w.gustKt || 0, head: 0, cross: 0, side: '' };
  if (rf) {
    const along = mx * rf.ux + my * rf.uy, across = mx * rf.uy - my * rf.ux;
    out.head = -along * 1.943844;
    out.cross = Math.abs(across) * 1.943844;
    out.side = out.cross < 0.5 ? '' : across > 0 ? 'L' : 'R';
  }
  return out;
}

// The aiming point per ICAO Annex 14 by available landing distance.
export function aimingPoint(lda) {
  return lda >= 2400 ? 400 : lda >= 1500 ? 300 : lda >= 1200 ? 250 : 150;
}

// The runway a touchdown at map (x, y), heading hdg (rad, grid), was on: one whose paved
// rectangle (pavement end to pavement end, plus `margin` metres all round, or `short` metres
// before either end) holds the point and whose line is within 45° of the heading; where two
// qualify (a crossing), the better lined-up one. Returns { runway, end, other } with `end`
// the threshold landed on, or null.
export function pickRunway(runways, x, y, hdg, margin = 0, short = margin) {
  const fx = Math.sin(hdg), fy = Math.cos(hdg);
  let best = null, bestCos = Math.cos(45 / DEG);
  for (const r of runways || []) {
    const [a, b] = r.ends;
    const [ax, ay] = a.pavementEnd || [a.x, a.y], [bx, by] = b.pavementEnd || [b.x, b.y];
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 1)) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const u = (x - ax) * ux + (y - ay) * uy, v = (x - ax) * uy - (y - ay) * ux;
    if (Math.abs(v) > (r.widthM || 45) / 2 + margin) continue;
    const c = ux * fx + uy * fy;
    if (Math.abs(c) < bestCos) continue;
    // short of the end being landed on: before a (u < 0) heading for b, before b heading for a
    if (c >= 0 ? (u < -short || u > len + margin) : (u > len + short || u < -margin)) continue;
    bestCos = Math.abs(c);
    best = c >= 0 ? { runway: r, end: a, other: b } : { runway: r, end: b, other: a };
  }
  return best;
}

// The landing runway for a touchdown: on the pavement (2 m of grace past the edges); failing
// that within 60 m of it (a wheel off the edge, or a little short); failing that up to 400 m
// short of the threshold and in line with the runway (an undershoot, on the grass). All are
// scored on that runway. null: not a runway at all (a taxiway, an apron, a field).
export function landingRunway(runways, x, y, hdg) {
  return pickRunway(runways, x, y, hdg, 2) || pickRunway(runways, x, y, hdg, 60)
    || pickRunway(runways, x, y, hdg, 15, 400);
}

function grade(points) {
  return points >= 90 ? 'A' : points >= 78 ? 'B' : points >= 64 ? 'C' : points >= 50 ? 'D' : 'F';
}

const sq = (x) => x * x;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// About (x/s)²/2 near 0 and |x|/s far out: small misses cost little, big ones don't explode.
const soft = (x, s) => Math.sqrt(1 + sq(x / s)) - 1;

// What each part costs, 0 at its ideal. The score is 100 × e^(−total cost), so a cost of
// 0.01 takes about 1% off, 0.05 about 5%, 0.22 a fifth, 0.69 half.
const PITCH_A321 = { best: 5.5, low: 2.5, high: 8 };
export const COST = {
  // ft/min, ideal 130: 190 → 0.009, 250 → 0.03, 360 → 0.13, 450 → 0.24, 600 → 0.52, 750 → 0.91.
  // Below it the aircraft floats: 60 → 0.03.
  vs: (vs) => (vs >= 130 ? sq((vs - 130) / 650) : sq((130 - vs) / 400)),
  // The touchdown g (1 = none): 1.3 → 0.007, 1.5 → 0.02, 2.0 → 0.08, 2.6 → 0.21. This sim's g
  // mostly follows the sink rate, so it weighs little on its own.
  g: (g) => sq(Math.max(0, g - 1) / 3.5),
  // m from the aiming point, + long: 50 → 0.006, 150 → 0.05, 300 → 0.17, 500 → 0.40, 800 → 0.78.
  // Short costs more (−150 → 0.07, −400 → 0.35), and short of the threshold 0.3 on top.
  aim: (along, aim) => {
    const off = along - aim;
    return (off >= 0 ? 0.42 * soft(off, 300) : 0.28 * soft(off, 200)) + (along < 0 ? 0.3 : 0);
  },
  // m off the centreline: 1 → 0.008, 2 → 0.03, 4 → 0.10, 8 → 0.31, 15 → 0.72.
  centreline: (cross) => 0.25 * soft(cross, 4),
  // °: 1 → 0.007, 2 → 0.03, 4 → 0.11, 6 → 0.25.
  bank: (deg) => sq(deg / 12),
  // °: a shallow bowl around 5.5° (4 → 0.006, 7.2 → 0.007), steep below 2.5° (the nosewheel
  // first) and above 8° (the tail strikes at 9.7° with the struts compressed): 1 → 0.33, 9 → 0.25.
  // v0.3.0: the aircraft type moves the bowl and the steep sides (def.score; the A321neo's are these).
  pitch: (deg, p = PITCH_A321) => 0.01 * sq((deg - p.best) / 2) + 0.5 * sq(Math.max(0, p.low - deg) / 2) + 0.5 * sq(Math.max(0, deg - p.high) / 1.5),
  bounces: (n) => 0.2 * n,
  grass: 0.35,      // the first main wheels landed on the grass (short of the runway or off its side)
  offRunway: 2.3,   // not on a runway at all: a perfect touchdown on a taxiway scores 10
  crash: 2.3,       // v0.4.1: Indestructible kept together what would have crashed (a damage event): as off a runway
  // The approach (approachStats below). RMS dots off the PFD's glideslope and localizer from
  // 1,000 ft to 100 ft: 0.25 → 0.007, 0.5 → 0.03, 1 → 0.12, 2 → 0.48 (full scale all the way).
  path: (dots) => sq(dots / 2.9),
  // ft/min, the sink rate's swing (its standard deviation) about a steady 3° descent from
  // 1,000 ft to 50 ft: 50 → 0.003, 100 → 0.012, 200 → 0.05, 400 → 0.20, 700 → 0.60.
  swing: (fpm) => sq(fpm / 900),
};

export const pointsFor = (cost) => Math.round(100 * Math.exp(-cost));
// v0.4.1: the sim's crash reasons, short enough for the card's value column.
export const DAMAGE_SHORT = { 'hard landing: gear collapsed': 'gear collapsed', 'nose gear collapsed': 'nose gear', 'ran off the runway': 'off the runway' };

// The approach, measured on the track the scorer keeps: the same 3° glideslope from 300 m
// past the threshold and the same localizer from the far end as the PFD shows (1 dot = 0.4°
// and 0.8°, Airbus's scales). Only samples lined up within 10° of the runway count, so a
// base leg doesn't.
export const APPROACH = {
  gsOriginM: 300, gsDeg: 3, gsDotDeg: 0.4, locDotDeg: 0.8,
  topFt: 1000, pathBottomFt: 100, swingBottomFt: 50, maxLocDeg: 10,
  minSeconds: 20,       // less of the window than this flown: no approach parts
  sampleS: 0.25, keepS: 300,
};

// track: [{ t, x, y, z, vs, gs }] (map m, the fuselage centre's MSL height in m, m/s), oldest
// first; rf: runwayFrame(); elev: the threshold's elevation (m). Heights for the window are
// the wheels' above the threshold. Returns null if too little of the window was flown.
export function approachStats(track, rf, elev = 0, groundZ = GROUND_Z) {
  const A = APPROACH, tanGs = Math.tan(A.gsDeg / DEG);
  let n = 0, sum2 = 0, gsSum = 0, locSum = 0;
  const errs = [];
  for (const p of track || []) {
    const { along, cross } = alongCross(rf, p.x, p.y);
    if (along >= 0) continue;                                    // over the runway already
    const hFt = (p.z - groundZ - elev) * FT;
    if (hFt > A.topFt || hFt < A.swingBottomFt) continue;
    const locDeg = Math.atan2(cross, rf.lda - along) * DEG;       // + right of the course
    if (Math.abs(locDeg) > A.maxLocDeg) continue;
    errs.push((-p.vs - p.gs * tanGs) * 60 * FT);                  // sinking faster than 3° (ft/min)
    if (hFt < A.pathBottomFt) continue;
    const gsDots = (Math.atan2(p.z - elev, A.gsOriginM - along) * DEG - A.gsDeg) / A.gsDotDeg; // + above
    const g = clamp(gsDots, -5, 5), l = clamp(locDeg / A.locDotDeg, -5, 5);
    n++; sum2 += g * g + l * l; gsSum += g; locSum += l;
  }
  if (n * A.sampleS < A.minSeconds) return null;
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const swingFpm = Math.sqrt(errs.reduce((a, b) => a + sq(b - mean), 0) / errs.length);
  const gsMean = gsSum / n, locMean = locSum / n;
  const note = Math.max(Math.abs(gsMean), Math.abs(locMean)) < 0.25 ? ''
    : Math.abs(gsMean) >= Math.abs(locMean) ? (gsMean < 0 ? 'low' : 'high') : (locMean < 0 ? 'left' : 'right');
  return { pathDots: Math.sqrt(sum2 / n), gsMeanDots: gsMean, locMeanDots: locMean, swingFpm, seconds: n * A.sampleS, note };
}

// Points lost per part: the total loss shared out in proportion to the parts' costs, as whole
// points that add up to it (largest remainders first).
export function sharePoints(parts, points) {
  const total = parts.reduce((a, p) => a + p.cost, 0);
  const loss = 100 - points;
  if (!(total > 0) || loss <= 0) { for (const p of parts) p.penalty = 0; return parts; }
  const raw = parts.map((p) => (loss * p.cost) / total);
  const pen = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - pen[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0, left = loss - pen.reduce((a, b) => a + b, 0); k < left; k++) pen[order[k][1]]++;
  parts.forEach((p, i) => { p.penalty = pen[i]; });
  return parts;
}

// Rounding and a JSON-safe deep copy for serialize().
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const jsonSafe = (o) => JSON.parse(JSON.stringify(o));

// Runway ends by reference, for scorer.serialize() and scorer.load(): identify(end) →
// { icao, ident } (by identity, else the nearest end with that ident), and resolve(icao,
// ident, near) → { runway, end, other } with the airports' own objects, or null. Without
// an icao, resolve takes the end with that ident nearest `near`.
export function runwayEndRefs(airports) {
  const list = Array.isArray(airports) ? airports : Object.values(airports || {});
  const all = [];
  for (const a of list) for (const r of a.runways || []) r.ends.forEach((e, i) => all.push({ icao: a.icao, runway: r, end: e, other: r.ends[1 - i] }));
  const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
  const nearest = (cands, near) => {
    if (!near || !Number.isFinite(near.x)) return cands[0] || null;
    let best = null, bd = Infinity;
    for (const c of cands) { const d = Math.hypot(c.end.x - near.x, c.end.y - near.y); if (d < bd) { bd = d; best = c; } }
    return best;
  };
  return {
    identify(end) {
      const hit = all.find((c) => c.end === end) || nearest(all.filter((c) => same(c.end.ident, end.ident)), end);
      return hit ? { icao: hit.icao, ident: hit.end.ident } : { icao: null, ident: end.ident };
    },
    resolve(icao, ident, near) {
      const cands = all.filter((c) => same(c.end.ident, ident) && (!icao || c.icao === icao));
      const hit = icao ? cands[0] : nearest(cands, near);
      return hit ? { runway: hit.runway, end: hit.end, other: hit.other } : null;
    },
  };
}

export function createScorer() {
  // The aircraft type (v0.3.0: scorer.setType(def)): the height of its reference point on the
  // wheels, and the touchdown pitch it's scored against, from its tail-strike geometry.
  let groundZ = GROUND_Z, pitchBand = PITCH_A321;
  let rf = null;
  let landing = null;  // { runway, end, other } of the touchdown, or null (off the runway)
  let td = null;       // the first touchdown
  let peakG = 0;
  let bounces = 0;
  let airborneSince = null;
  let result = null;
  // v0.4.1: what would have crashed (the sim's damage events, with Indestructible on): [{ t, reason }], the
  // last few since the lift-off. Those from 10 s before the touchdown to the end of the rollout count.
  let damage = [];
  // The track for the approach: a sample every 0.25 s in the air, the last 5 minutes.
  let track = [], lastSampleT = -Infinity;
  const clearTrack = () => { track = []; lastSampleT = -Infinity; };

  return {
    setType(def) { groundZ = def.geo.GROUND_Z; pitchBand = def.score || PITCH_A321; },
    // The runway end being landed on (null clears it). The touchdown sets it again
    // (setLanding), so this is only the plan until then.
    setRunway(end, other) {
      rf = end && other ? runwayFrame(end, other) : null;
      landing = end && other ? { runway: null, end, other } : null;
      td = null; result = null; bounces = 0; peakG = 0; damage = [];
    },
    // At the touchdown: the runway it was on (landingRunway()), or null for none.
    setLanding(l) {
      landing = l || null;
      rf = l ? runwayFrame(l.end, l.other) : null;
    },
    get landing() { return landing; },
    get result() { return result; },
    get touchedDown() { return !!td; },
    get track() { return track; },
    // keepTrack: after a rewind, the approach flown before the rewound-to moment still counts.
    reset(keepTrack = false) {
      td = null; result = null; bounces = 0; peakG = 0; airborneSince = null;
      if (!keepTrack) { clearTrack(); damage = []; }
    },

    // ---- scenario saves (v0.2.0) ----
    // A plain, JSON-safe copy of everything above. The runway end is saved by reference:
    // identify(end) → { icao, ident } (runwayEndRefs(airports).identify does that); without
    // it only the ident is kept, with the threshold's x/y so a resolver can find it nearest.
    // `from` says whether it's still the planned runway ('plan') or the touchdown's
    // ('touchdown', after setLanding). The track is rounded (0.01 m, 0.001 m/s): 5 minutes of
    // it (1,200 samples) is about 70 KB.
    serialize(identify = null) {
      const ref = (e) => {
        const id = identify ? identify(e) : null;
        return { icao: id?.icao ?? e.icao ?? null, ident: id?.ident ?? e.ident, x: r2(e.x), y: r2(e.y) };
      };
      return {
        v: 1,
        landing: landing ? { ...ref(landing.end), from: landing.runway || td ? 'touchdown' : 'plan' } : null,
        td: td ? jsonSafe(td) : null,
        peakG, bounces, airborneSince,
        ...(damage.length ? { damage: damage.map((d) => ({ t: d.t, reason: d.reason })) } : {}),
        result: result ? jsonSafe({ ...result, touchdown: null }) : null,
        // [t, x, y, z, vs, gs] per sample (t exact: the 0.25 s spacing and the 5-minute window use it)
        track: track.map((p) => [p.t, r2(p.x), r2(p.y), r2(p.z), r3(p.vs), r3(p.gs)]),
        lastSampleT: Number.isFinite(lastSampleT) ? lastSampleT : null,
      };
    },
    // Back from serialize(): resolveEnd(icao, ident, { x, y }) → { end, other, runway? } (the
    // airports' own end objects), or null, which leaves no runway (and so no approach parts).
    load(o, resolveEnd) {
      rf = null; landing = null; td = null; result = null; peakG = 0; bounces = 0; airborneSince = null;
      clearTrack(); damage = [];
      if (!o) return;
      damage = Array.isArray(o.damage) ? o.damage.map((d) => ({ t: d.t, reason: String(d.reason) })) : [];
      if (o.landing && resolveEnd) {
        const r = resolveEnd(o.landing.icao, o.landing.ident, { x: o.landing.x, y: o.landing.y });
        if (r && r.end && r.other) {
          landing = { runway: o.landing.from === 'touchdown' ? r.runway || null : null, end: r.end, other: r.other };
          rf = runwayFrame(r.end, r.other);
        }
      }
      td = o.td ? { ...o.td, along: o.td.along ?? NaN, cross: o.td.cross ?? NaN } : null;
      peakG = o.peakG ?? 0; bounces = o.bounces ?? 0; airborneSince = o.airborneSince ?? null;
      result = o.result ? { ...o.result, touchdown: td } : null;
      track = (o.track || []).map((p) => (Array.isArray(p) ? { t: p[0], x: p[1], y: p[2], z: p[3], vs: p[4], gs: p[5] }
        : { t: p.t, x: p.x, y: p.y, z: p.z, vs: p.vs, gs: p.gs }));
      lastSampleT = o.lastSampleT ?? -Infinity;
    },

    // Feed sim events and the state every frame. Returns the result once, when it's done.
    update(s, events) {
      // The sim went back in time (a rewind): so does the track.
      if (track.length && s.t < track[track.length - 1].t) {
        while (track.length && track[track.length - 1].t > s.t) track.pop();
        lastSampleT = track.length ? track[track.length - 1].t : -Infinity;
      }
      // A lift-off (the take-off, or a touch-and-go) starts a new approach. A rewind takes back the damage
      // after the moment it went back to.
      if (damage.length && s.t < damage[damage.length - 1].t) damage = damage.filter((d) => d.t <= s.t);
      for (const e of events) {
        if (e.type === 'liftoff') { clearTrack(); if (!td) damage = []; }
        if (e.type === 'damage' && !result) { damage.push({ t: s.t, reason: e.reason }); if (damage.length > 10) damage.shift(); }
      }
      if (!td && !s.onGround && s.t - lastSampleT >= APPROACH.sampleS) {
        lastSampleT = s.t;
        track.push({ t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, vs: s.vs, gs: s.gs });
        while (s.t - track[0].t > APPROACH.keepS) track.shift();
      }
      for (const e of events) {
        if (e.type === 'touchdown' && !td) {
          const ac = rf ? alongCross(rf, e.x, e.y) : { along: NaN, cross: NaN };
          td = { vsFpm: -e.vsMs * 60 * FT, g: e.g, along: ac.along, cross: ac.cross,
            bank: Math.abs(e.bank) * DEG, pitch: e.pitch * DEG, ias: s.ias * 1.943844, t: s.t, onRunway: !!rf,
            surface: e.surface || 'runway',
            wind: windAtTouchdown(s, rf),
            ...(s.indestructible ? { indestructible: true } : {}),
            approach: rf && landing ? approachStats(track, rf, landing.end.elevM ?? 0, groundZ) : null };
          peakG = e.g;
        } else if (e.type === 'touchdown' && td && !result) {
          peakG = Math.max(peakG, e.g);           // a bounce's second arrival
        } else if (e.type === 'bounce' && td) bounces++;
      }
      if (!td || result) return null;
      if (s.onGround) airborneSince = null;
      else if (airborneSince === null) airborneSince = s.t;
      // Off the ground again for 4 s after touching down: a go-around, nothing to score, and
      // the next approach starts afresh.
      if (airborneSince !== null && s.t - airborneSince > 4) { td = null; bounces = 0; clearTrack(); return null; }
      const stopped = s.onGround && s.gs < 30 / 1.943844;
      if (!stopped && s.t - td.t < 60) return null;

      const aim = rf ? aimingPoint(rf.lda) : 400;
      const parts = [];
      const add = (name, value, unit, cost, extra) => parts.push({ name, value, unit, cost: +cost.toFixed(4), penalty: 0, ...extra });
      const vs = Math.abs(td.vsFpm);
      add('Vertical speed', Math.round(vs), 'ft/min', COST.vs(vs));
      // The touchdown g as an accelerometer reads it (the sim's 0.1 s filter), the worst of
      // the first arrival and any bounce; the rollout's bumps and braking don't count.
      add('Peak g', +peakG.toFixed(2), 'g', COST.g(peakG));
      if (td.onRunway) {
        add('Touchdown vs aiming point', Math.round(td.along - aim), 'm', COST.aim(td.along, aim));
        add('From centreline', +Math.abs(td.cross).toFixed(1), 'm', COST.centreline(td.cross));
        if (td.surface === 'ground') add('On the grass', 'yes', '', COST.grass);
      }
      add('Bank', +td.bank.toFixed(1), '°', COST.bank(td.bank));
      add('Pitch', +td.pitch.toFixed(1), '°', COST.pitch(td.pitch, pitchBand));
      add('Bounces', bounces, '', COST.bounces(bounces));
      const ap = td.approach;
      if (ap) {
        add('Approach path', +ap.pathDots.toFixed(1), 'dots', COST.path(ap.pathDots), ap.note ? { note: ap.note } : {});
        add('Sink rate swings', Math.round(ap.swingFpm), 'ft/min', COST.swing(ap.swingFpm));
      }
      if (!td.onRunway) add('On a runway', 'no', '', COST.offRunway);
      // v0.4.1: Indestructible held it together, from 10 s before the touchdown on.
      const dmg = damage.filter((d) => d.t >= td.t - 10).map((d) => d.reason);
      if (dmg.length) add('Would have crashed', DAMAGE_SHORT[dmg[0]] || dmg[0], '', COST.crash);
      const cost = parts.reduce((a, p) => a + p.cost, 0);
      const points = pointsFor(cost);
      sharePoints(parts, points);
      result = { points, grade: grade(points), parts, cost: +cost.toFixed(4), touchdown: td, offRunway: !td.onRunway,
        runway: td.onRunway && landing ? landing.end.ident : null, lda: rf ? rf.lda : null, aim, approach: ap,
        ...(td.indestructible ? { indestructible: true } : {}), ...(dmg.length ? { damage: [...new Set(dmg)] } : {}) };
      return result;
    },
  };
}
