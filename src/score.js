// The landing score: worked out at the first touchdown, finished after the rollout.
// Vertical speed and peak g, the touchdown point against the aiming point, distance from
// the centreline, bank, pitch and bounces, and a grade.

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

function grade(points) {
  return points >= 90 ? 'A' : points >= 78 ? 'B' : points >= 64 ? 'C' : points >= 50 ? 'D' : 'F';
}

export function createScorer() {
  let rf = null;
  let td = null;     // the first touchdown
  let peakG = 0;
  let bounces = 0;
  let airborneSince = null;
  let result = null;

  return {
    // Set the runway end the flight is landing on (null clears it).
    setRunway(end, other) { rf = end && other ? runwayFrame(end, other) : null; td = null; result = null; bounces = 0; peakG = 0; },
    get result() { return result; },
    get touchedDown() { return !!td; },
    reset() { td = null; result = null; bounces = 0; peakG = 0; airborneSince = null; },

    // Feed sim events and the state every frame. Returns the result once, when it's done.
    update(s, events) {
      for (const e of events) {
        if (e.type === 'touchdown' && !td) {
          const ac = rf ? alongCross(rf, e.x, e.y) : { along: NaN, cross: NaN };
          td = { vsFpm: -e.vsMs * 60 * FT, g: e.g, along: ac.along, cross: ac.cross,
            bank: Math.abs(e.bank) * DEG, pitch: e.pitch * DEG, ias: s.ias * 1.943844, t: s.t };
          peakG = e.g;
        } else if (e.type === 'bounce' && td) bounces++;
      }
      if (!td || result) return null;
      if (s.onGround) {
        peakG = Math.max(peakG, s.nz);
        airborneSince = null;
      } else if (airborneSince === null) airborneSince = s.t;
      // Off the ground again for 4 s after touching down: a go-around, nothing to score.
      if (airborneSince !== null && s.t - airborneSince > 4) { td = null; bounces = 0; return null; }
      const stopped = s.onGround && s.gs < 30 / 1.943844;
      if (!stopped && s.t - td.t < 60) return null;

      const aim = rf ? aimingPoint(rf.lda) : 400;
      const parts = [];
      const add = (name, value, unit, penalty) => parts.push({ name, value, unit, penalty: Math.round(penalty) });
      const vs = Math.abs(td.vsFpm);
      add('Vertical speed', Math.round(vs), 'ft/min', vs < 60 ? 4 : vs <= 240 ? 0 : Math.min(45, (vs - 240) / 8));
      // A firm (~380 ft/min) arrival reads about 1.6–1.9 g on the sim's filtered accelerometer;
      // Airbus's hard-landing inspection threshold is 2.6 g.
      add('Peak g', +peakG.toFixed(2), 'g', Math.max(0, (peakG - 1.6) * 40));
      if (rf) {
        const off = td.along - aim;
        add('Touchdown vs aiming point', Math.round(off), 'm', Math.abs(off) <= 150 ? 0 : Math.min(30, (Math.abs(off) - 150) / 15) + (td.along < 0 ? 25 : 0));
        add('From centreline', +Math.abs(td.cross).toFixed(1), 'm', Math.max(0, (Math.abs(td.cross) - 2) * 2.5));
      }
      add('Bank', +td.bank.toFixed(1), '°', Math.max(0, (td.bank - 2) * 4));
      add('Pitch', +td.pitch.toFixed(1), '°', td.pitch < 0 ? 15 : td.pitch > 9 ? (td.pitch - 9) * 6 : 0);
      add('Bounces', bounces, '', bounces * 12);
      const points = Math.max(0, 100 - parts.reduce((a, p) => a + p.penalty, 0));
      result = { points: Math.round(points), grade: grade(points), parts, touchdown: td };
      return result;
    },
  };
}
