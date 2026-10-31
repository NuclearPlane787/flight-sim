// The landing score: worked out at the first touchdown, finished after the rollout.
// Vertical speed and peak g, the touchdown point against the aiming point, distance from
// the centreline, bank, pitch and bounces, and a grade.
//
// Every part has a ceiling, so one bad number costs a lot but can't zero the score by
// itself (in v0.1.0 they had none, and a firm, long keyboard landing came out at 0/100).
// A touchdown that isn't on a runway scores 0 (F), and says so.

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

const lerpCap = (x, x0, x1, p1) => Math.max(0, Math.min(p1, ((x - x0) / (x1 - x0)) * p1));

// The penalties, each with its ceiling (points).
export const PENALTY = {
  // ft/min: nothing from 60 to 250, 30 at 600 (the A321's design sink rate, 10 ft/s), 50 at 900.
  vs: (vs) => (vs < 60 ? 4 : vs <= 600 ? lerpCap(vs, 250, 600, 30) : Math.min(50, 30 + lerpCap(vs, 600, 900, 20))),
  // This sim's gear reads about 1.9 g at a firm 380–400 ft/min, so g mostly follows the
  // vertical speed; it adds a little for a hard bounce or a dropped nose. 15 at 2.6 g, where
  // Airbus calls for a hard-landing inspection.
  g: (g) => lerpCap(g, 1.9, 2.6, 15),
  // m from the aiming point: ±150 m is the touchdown zone's sweet spot. Long costs up to 20
  // (at 650 m), short up to 20, and short of the threshold 15 more.
  aim: (along, aim) => {
    const off = along - aim;
    if (Math.abs(off) <= 150) return 0;
    const p = off > 0 ? lerpCap(off, 150, 650, 20) : lerpCap(-off, 150, 450, 20);
    return Math.min(35, p + (along < 0 ? 15 : 0));
  },
  // m off the centreline: the main gear is 3.8 m either side of it.
  centreline: (cross) => lerpCap(Math.abs(cross), 3, 16.3, 20),
  bank: (deg) => lerpCap(deg, 3, 8, 15),
  pitch: (deg) => (deg < 0 ? 15 : deg > 9 ? Math.min(15, (deg - 9) * 6) : 0),
  bounces: (n) => Math.min(25, n * 10),
  grass: 25,     // the first main wheels landed on the grass (short of the runway or off its side)
};

export function createScorer() {
  let rf = null;
  let landing = null;  // { runway, end, other } of the touchdown, or null (off the runway)
  let td = null;       // the first touchdown
  let peakG = 0;
  let bounces = 0;
  let airborneSince = null;
  let result = null;

  return {
    // The runway end being landed on (null clears it). The touchdown sets it again
    // (setLanding), so this is only the plan until then.
    setRunway(end, other) {
      rf = end && other ? runwayFrame(end, other) : null;
      landing = end && other ? { runway: null, end, other } : null;
      td = null; result = null; bounces = 0; peakG = 0;
    },
    // At the touchdown: the runway it was on (landingRunway()), or null for none.
    setLanding(l) {
      landing = l || null;
      rf = l ? runwayFrame(l.end, l.other) : null;
    },
    get landing() { return landing; },
    get result() { return result; },
    get touchedDown() { return !!td; },
    reset() { td = null; result = null; bounces = 0; peakG = 0; airborneSince = null; },

    // Feed sim events and the state every frame. Returns the result once, when it's done.
    update(s, events) {
      for (const e of events) {
        if (e.type === 'touchdown' && !td) {
          const ac = rf ? alongCross(rf, e.x, e.y) : { along: NaN, cross: NaN };
          td = { vsFpm: -e.vsMs * 60 * FT, g: e.g, along: ac.along, cross: ac.cross,
            bank: Math.abs(e.bank) * DEG, pitch: e.pitch * DEG, ias: s.ias * 1.943844, t: s.t, onRunway: !!rf,
            surface: e.surface || 'runway' };
          peakG = e.g;
        } else if (e.type === 'touchdown' && td && !result) {
          peakG = Math.max(peakG, e.g);           // a bounce's second arrival
        } else if (e.type === 'bounce' && td) bounces++;
      }
      if (!td || result) return null;
      if (s.onGround) airborneSince = null;
      else if (airborneSince === null) airborneSince = s.t;
      // Off the ground again for 4 s after touching down: a go-around, nothing to score.
      if (airborneSince !== null && s.t - airborneSince > 4) { td = null; bounces = 0; return null; }
      const stopped = s.onGround && s.gs < 30 / 1.943844;
      if (!stopped && s.t - td.t < 60) return null;

      const aim = rf ? aimingPoint(rf.lda) : 400;
      const parts = [];
      const add = (name, value, unit, penalty) => parts.push({ name, value, unit, penalty: Math.round(penalty) });
      const vs = Math.abs(td.vsFpm);
      add('Vertical speed', Math.round(vs), 'ft/min', PENALTY.vs(vs));
      // The touchdown g as an accelerometer reads it (the sim's 0.1 s filter), the worst of
      // the first arrival and any bounce; the rollout's bumps and braking don't count.
      add('Peak g', +peakG.toFixed(2), 'g', PENALTY.g(peakG));
      if (td.onRunway) {
        add('Touchdown vs aiming point', Math.round(td.along - aim), 'm', PENALTY.aim(td.along, aim));
        add('From centreline', +Math.abs(td.cross).toFixed(1), 'm', PENALTY.centreline(td.cross));
        if (td.surface === 'ground') add('On the grass', 'yes', '', PENALTY.grass);
      }
      add('Bank', +td.bank.toFixed(1), '°', PENALTY.bank(td.bank));
      add('Pitch', +td.pitch.toFixed(1), '°', PENALTY.pitch(td.pitch));
      add('Bounces', bounces, '', PENALTY.bounces(bounces));
      let points = Math.max(0, 100 - parts.reduce((a, p) => a + p.penalty, 0));
      if (!td.onRunway) { add('On a runway', 'no', '', 100); points = 0; }
      result = { points: Math.round(points), grade: grade(points), parts, touchdown: td, offRunway: !td.onRunway,
        runway: td.onRunway && landing ? landing.end.ident : null, lda: rf ? rf.lda : null, aim };
      return result;
    },
  };
}
