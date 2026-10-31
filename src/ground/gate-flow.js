// Gate starts, pushback and the taxi routes (PLAN.md → Airports → Gate starts).
//
//   const gate = createGateFlow({ sim, airports, findRunwayEnd, scene, uniforms, heightAt });
//   gate.start(plan)            // plan.start === 'gate': at plan.stand (or a free gate), brakes set
//   gate.onKey('pushback')      // P: start / hold / continue the pushback
//   gate.update(dt, controls)   // every frame, after the physics steps
//   gate.afterLanding(state)    // every frame after touchdown: below 30 kt, a route to a stand
//   gate.clear()                // runway and final starts: no route
//   gate.route, gate.status, gate.phase, gate.points; gate.onstatus = (text) => toast(text)
//
// The phases: 'none' → 'parked' → 'pushback' → 'taxi' → 'departed' (lined up or airborne);
// after landing 'taxi-in' → 'arrived'.

import { buildTaxiGraph, routeFromStand, routeToStand, freeStand, snapToGraph } from './taxi.js';
import { createPushback } from './pushback.js';
import { createTaxiRoute } from '../world/taxiroute.js';
import { NOSE_X } from '../geometry.js';

const DEG = Math.PI / 180;
const KT = 0.514444;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Stands for the setup screen: gates first, then by ref (numbers in number order).
export function standList(airport) {
  const num = (r) => { const m = String(r).match(/\d+/); return m ? Number(m[0]) : 1e9; };
  return (airport?.stands || []).filter((s) => s.ref).slice().sort((a, b) =>
    (b.gate - a.gate) || (num(a.ref) - num(b.ref)) || String(a.ref).localeCompare(String(b.ref)));
}

export function createGateFlow({ sim, airports, findRunwayEnd = null, scene = null, uniforms = null, heightAt = null, occupied = null } = {}) {
  const list = Array.isArray(airports) ? airports : airports?.airports || Object.values(airports || {});
  const byIcao = new Map(list.map((a) => [a.icao, a]));
  const graphs = new Map();
  const graphFor = (ap) => { if (!graphs.has(ap.icao)) graphs.set(ap.icao, buildTaxiGraph(ap)); return graphs.get(ap.icao); };
  const line = scene ? createTaxiRoute(scene, { uniforms, heightAt }) : null;

  let phase = 'none', status = '', route = null, pb = null;
  let lastTry = null; // where the last failed stand search was made: no retry until 50 m on
  let airport = null, stand = null, depEnd = null, depRect = null;
  let wasAirborne = false;

  const flow = {
    onstatus: null,
    start, onKey, update, afterLanding, afterRestore, clear,
    get phase() { return phase; },
    get status() { return status; },
    get route() { return route; },
    get points() { return route ? route.points : []; },
    get stand() { return stand; },
    get pushback() { return pb; },
    get line() { return line; },
    graphFor: (icao) => (byIcao.get(icao) ? graphFor(byIcao.get(icao)) : null),
  };

  function say(text) {
    if (text === status) return;
    status = text;
    flow.onstatus?.(text);
  }
  function show(r) {
    route = r;
    if (!line) return;
    if (r && r.points.length >= 2) line.set(r.points, { h: heightAt ? undefined : (airport?.elevM ?? 0) });
    else line.clear();
  }
  function clear() {
    phase = 'none'; route = null; pb = null; stand = null; depEnd = null; depRect = null; wasAirborne = false; lastTry = null;
    line?.clear();
    status = '';
  }

  // ---- gate start ----
  function start(plan) {
    clear();
    airport = byIcao.get(plan.origin);
    if (!airport) throw new Error(`No airport ${plan.origin}`);
    const g = graphFor(airport);
    stand = (airport.stands || []).find((s) => s.ref === plan.stand) || freeStand(airport, []);
    if (!stand) throw new Error(`No stands at ${plan.origin}`);
    const h0 = stand.hdgGridDeg * DEG;
    const fx = Math.sin(h0), fy = Math.cos(h0);
    // The nose on the stop point: the reference point is NOSE_X behind it.
    const rx = stand.x - fx * NOSE_X, ry = stand.y - fy * NOSE_X;
    sim.reset({ x: rx, y: ry, hdg: h0, onGround: true, flapLever: 1, gearDown: true, parkingBrake: true,
      fuelKg: plan.fuelKg, payloadKg: plan.payloadKg ?? ((plan.pax || 0) * 84 + (plan.cargoKg || 0)) });
    sim.controls.flapLever = 1;
    sim.controls.gearDown = true;
    sim.controls.parkingBrake = true;
    sim.controls.thrust = 0;

    // Where the pushback ends: the taxi line behind the stand.
    const push = pushLine(g, rx, ry, h0);
    depEnd = endOf(airport, plan.depRunway);
    depRect = depEnd ? g.rects.find((r) => r.idents.includes(depEnd.ident)) : null;
    const r = depEnd && push ? routeFromStand(g, { x: push.x, y: push.y }, depEnd) : null;
    // Turn the nose towards the way the route goes.
    let prefer;
    if (r) {
      const p = r.points, q = p.find((pt) => dist(pt[0], pt[1], p[0][0], p[0][1]) > 3) || p[p.length - 1];
      prefer = Math.atan2(q[0] - p[0][0], q[1] - p[0][1]);
    }
    pb = planPushback(g, { x: rx, y: ry, hdgGridDeg: stand.hdgGridDeg }, push, prefer);
    if (r) { r.kind = 'out'; r.stand = stand.ref; r.runway = depEnd.ident; r.text = taxiText(r, `holding point${r.hold.ref ? ' ' + r.hold.ref : ''} for ${depEnd.ident}`); }
    show(r);
    phase = 'parked';
    say(`Stand ${stand.ref}. Pushback: P to start` + (r ? '' : ' (no taxi route found)'));
    return r;
  }

  // The taxi line behind the aircraft: the first taxiway the backward ray meets 30–250 m
  // back (not one running along the ray, such as the lead-in itself), else the nearest.
  function pushLine(g, x, y, hdg) {
    const bx = -Math.sin(hdg), by = -Math.cos(hdg), L = 250;
    let best = null;
    for (const e of g.edges) {
      if (e.dead || e.axis || e.runway) continue;
      const A = g.nodes[e.a], B = g.nodes[e.b];
      const ex = B.x - A.x, ey = B.y - A.y, el = Math.hypot(ex, ey);
      if (el < 1 || Math.abs((ex * bx + ey * by) / el) > 0.8) continue;
      const den = bx * ey - by * ex;
      const s = ((A.x - x) * ey - (A.y - y) * ex) / den;      // along the ray
      const t = ((A.x - x) * by - (A.y - y) * bx) / den;      // along the edge
      if (t < 0 || t > 1 || s < 30 || s > L) continue;
      if (!best || s < best.s) best = { s, x: x + bx * s, y: y + by * s, hdg: Math.atan2(ex, ey) };
    }
    if (best) return best;
    const at = snapToGraph(g, x + bx * 60, y + by * 60);
    if (!at) return null;
    const A = g.nodes[at.edge.a], B = g.nodes[at.edge.b];
    return { s: 60, x: at.x, y: at.y, hdg: Math.atan2(B.x - A.x, B.y - A.y) };
  }

  // The pushback, planned against the real (often curved) taxi line: run it ahead of
  // time, see where it ends, and plan again against the line at that spot.
  function planPushback(g, st, push, prefer) {
    if (!push) return createPushback(st, {});
    let L = { x: push.x, y: push.y, hdgGrid: push.hdg }, pbk = null;
    for (let it = 0; it < 4; it++) {
      pbk = createPushback(st, { line: L, preferHdgGrid: prefer });
      const trial = createPushback(st, { line: L, preferHdgGrid: prefer });
      trial.toggle();
      let o = null;
      for (let i = 0; i < 6000 && !(o && o.done); i++) o = trial.update(0.1, {});
      const at = snapToGraph(g, o.x, o.y);
      if (!at || at.d < 1 || at.edge.axis || at.edge.runway) break;
      const A = g.nodes[at.edge.a], B = g.nodes[at.edge.b];
      L = { x: at.x, y: at.y, hdgGrid: Math.atan2(B.x - A.x, B.y - A.y) };
      prefer = o.hdgGrid;   // keep the way the nose ended up pointing
    }
    return pbk;
  }

  function onKey(action) {
    if (action !== 'pushback') return null;
    if (phase === 'parked' && pb) {
      phase = 'pushback';
      pb.toggle();
      sim.controls.parkingBrake = false;
      say('Pushing back. P holds, Q/E steer the turn, = speeds it up');
    } else if (phase === 'pushback' && pb) {
      pb.toggle();
      say(pb.state.running ? 'Pushing back. P holds, Q/E steer the turn, = speeds it up' : 'Pushback held: P to continue');
    } else if (phase === 'taxi') say('Pushback complete. ' + (route ? route.text : ''));
    else say('No pushback here: only at a gate start');
    return status;
  }

  // ---- every frame ----
  function update(dt, controls = sim.controls) {
    const s = sim.state;
    if (phase === 'pushback' && pb) {
      const o = pb.update(dt, { steer: controls?.yaw ?? 0 });
      sim.setGroundPose(o.x, o.y, o.hdgGrid, -o.speed);   // the tug holds it, also while stopped
      if (o.done) {
        phase = 'taxi';
        sim.controls.parkingBrake = true;
        reroute();
        say('Pushback complete. Release the parking brake (B). ' + (route ? route.text : 'No taxi route found'));
      }
      return;
    }
    if (!s.onGround) wasAirborne = true;
    if (phase === 'taxi') {
      if (!s.onGround || linedUp(s)) {
        phase = 'departed';
        line?.clear();
        say(s.onGround ? `Lined up on runway ${depEnd.ident}` : '');
      }
    } else if (phase === 'taxi-in' && route?.standXY) {
      const fx = Math.sin(s.hdg), fy = Math.cos(s.hdg);
      const nx = s.pos.x + fx * NOSE_X, ny = s.pos.y + fy * NOSE_X;   // the nose (pos is the reference point)
      if (dist(nx, ny, route.standXY[0], route.standXY[1]) < 8 && s.gs < 1) {
        phase = 'arrived';
        line?.clear();
        say(`At stand ${route.stand}. Set the parking brake (B)`);
      }
    }
  }

  // After the pushback: the route again from where the aircraft stopped (a little
  // ahead of the reference point, so it never starts behind the nose).
  function reroute() {
    if (!airport || !depEnd) return;
    const s = sim.state, g = graphFor(airport);
    const r = routeFromStand(g, { x: s.pos.x + Math.sin(s.hdg) * 8, y: s.pos.y + Math.cos(s.hdg) * 8 }, depEnd);
    if (!r) return;
    Object.assign(r, { kind: 'out', stand: stand.ref, runway: depEnd.ident });
    r.text = taxiText(r, `holding point${r.hold.ref ? ' ' + r.hold.ref : ''} for ${depEnd.ident}`);
    show(r);
  }

  function linedUp(s) {
    if (!depRect || !depEnd) return false;
    const r = depRect, fromA = r.idents[0] === depEnd.ident;
    const ux = fromA ? r.ux : -r.ux, uy = fromA ? r.uy : -r.uy;
    const across = -(s.pos.x - r.ax) * r.uy + (s.pos.y - r.ay) * r.ux;
    const along = (s.pos.x - r.ax) * r.ux + (s.pos.y - r.ay) * r.uy;
    return Math.abs(across) < r.half && along > -60 && along < r.len + 60 &&
      Math.abs(wrap(s.hdg - Math.atan2(ux, uy))) < 15 * DEG;
  }

  // After a rewind (the gate state isn't in the sim's snapshots): carry on from wherever the
  // aircraft now is. Out: a taxi route to the holding point again; in: a route to the stand.
  function afterRestore() {
    const s = sim.state;
    if (!s.onGround) { if (phase === 'parked' || phase === 'pushback' || phase === 'taxi') { phase = 'departed'; route = null; line?.clear(); } return; }
    if (phase === 'parked' || phase === 'pushback' || phase === 'taxi') {
      phase = 'taxi'; pb = null;
      reroute();
      say('Rewound. ' + (route ? route.text : 'No taxi route found'));
    } else if ((phase === 'taxi-in' || phase === 'arrived') && airport && stand) {
      const r = routeToStand(graphFor(airport), [s.pos.x, s.pos.y], stand);
      if (!r) return;
      const pts = [[s.pos.x, s.pos.y], ...r.points, ...leadIn(stand)];
      const points = pts.filter((p, i) => i === 0 || dist(p[0], p[1], pts[i - 1][0], pts[i - 1][1]) > 0.5);
      const out = { kind: 'in', points, refs: r.refs, crossings: r.crossings, lengthM: r.lengthM, stand: stand.ref, standXY: [stand.x, stand.y] };
      out.text = taxiText(out, `stand ${stand.ref}`);
      phase = 'taxi-in';
      show(out);
      say(out.text);
    }
  }

  // ---- after landing ----
  function afterLanding(state = sim.state) {
    if (phase === 'taxi-in' || phase === 'arrived') return route;
    if (!state.onGround || state.gs > 30 * KT) return null;
    const x = state.pos.x, y = state.pos.y;
    if (lastTry && dist(lastTry[0], lastTry[1], x, y) < 50) return null;
    // The airport and runway under the aircraft.
    let ap = null, g = null, rect = null;
    for (const a of list) {
      if (!a.origin || dist(a.origin[0], a.origin[1], x, y) > 8000) continue;
      const gg = graphFor(a);
      const r = gg.rects.find((q) => { const sa = (x - q.ax) * q.ux + (y - q.ay) * q.uy, c = -(x - q.ax) * q.uy + (y - q.ay) * q.ux;
        return sa > -60 && sa < q.len + 60 && Math.abs(c) < q.half + 10; });
      if (r) { ap = a; g = gg; rect = r; break; }
    }
    if (!rect) return null;
    airport = ap;
    const dir = Math.sin(state.hdg) * rect.ux + Math.cos(state.hdg) * rect.uy >= 0 ? 1 : -1;
    const s0 = (x - rect.ax) * rect.ux + (y - rect.ay) * rect.uy;
    // Exits: edges leaving this runway's centreline chain, ahead of the aircraft, not
    // pointing back against the landing direction.
    const exits = [];
    for (const e of g.edges) {
      if (e.dead || e.axis || e.runway !== rect.id) continue;
      const A = g.nodes[e.a], B = g.nodes[e.b];
      const I = A.runway === rect.id ? A : B.runway === rect.id ? B : null;
      const O = I === A ? B : A;
      if (!I || O.runway) continue;
      const ahead = dir * ((I.x - rect.ax) * rect.ux + (I.y - rect.ay) * rect.uy - s0);
      const back = dir * ((O.x - I.x) * rect.ux + (O.y - I.y) * rect.uy) / (e.lengthM || 1);
      if (ahead < -10 || ahead > 3500 || back < -0.3) continue;
      exits.push({ I, O, ahead });
    }
    exits.sort((p, q) => p.ahead - q.ahead);
    let best = null;
    for (const ex of exits.slice(0, 6)) {
      // Skip stands with a parked aircraft (occupied(icao) gives their refs).
      const st = freeStand(ap, occupied ? occupied(ap.icao) : [], [ex.O.x, ex.O.y]);
      const r = st && routeToStand(g, [ex.O.x, ex.O.y], st);
      if (!r) continue;
      const total = ex.ahead + r.lengthM;
      if (!best || total < best.total) best = { total, ex, r, st };
    }
    if (!best) { lastTry = [x, y]; say('No taxi route to a stand found'); return null; }
    lastTry = null;
    const { ex, r, st } = best;
    // On the runway to the exit, the exit, the route, then the stand's lead-in.
    const pts = [[x, y], [ex.I.x, ex.I.y], [ex.O.x, ex.O.y], ...r.points];
    const lead = leadIn(st);
    for (const p of lead) pts.push(p);
    const points = pts.filter((p, i) => i === 0 || dist(p[0], p[1], pts[i - 1][0], pts[i - 1][1]) > 0.5);
    let lengthM = 0;
    for (let i = 1; i < points.length; i++) lengthM += dist(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    const out = { kind: 'in', points, refs: r.refs, crossings: r.crossings, lengthM, stand: st.ref, standXY: [st.x, st.y], exit: [ex.O.x, ex.O.y] };
    out.text = taxiText(out, `stand ${st.ref}`);
    stand = st;
    phase = 'taxi-in';
    show(out);
    say(out.text);
    return out;
  }

  // The stand's lead-in towards the stop point (or just the stop point).
  function leadIn(st) {
    const L = st.leadIn;
    if (!L || L.length < 2) return [[st.x, st.y]];
    const first = dist(L[0][0], L[0][1], st.x, st.y) < dist(L[L.length - 1][0], L[L.length - 1][1], st.x, st.y);
    const seq = first ? L.slice().reverse() : L.slice();
    return [...seq, [st.x, st.y]];
  }

  return flow;
}

function endOf(airport, ident) {
  for (const r of airport.runways || []) for (const e of r.ends) if (String(e.ident).toUpperCase() === String(ident).toUpperCase()) return e;
  return null;
}

// "Taxi to holding point A1 for 14R via P, A, crossing 14L/32R".
function taxiText(r, to) {
  const refs = r.refs.map((x) => (x.startsWith('RWY ') ? 'runway ' + x.slice(4) : x)).filter(Boolean);
  const cross = (r.crossings || []).filter((c) => !refs.includes('runway ' + c));
  return `Taxi to ${to}` + (refs.length ? ` via ${refs.join(', ')}` : '') + (cross.length ? `, crossing ${cross.join(', ')}` : '');
}
