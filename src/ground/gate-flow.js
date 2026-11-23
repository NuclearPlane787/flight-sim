// Gate starts, pushback and the taxi routes (PLAN.md → Airports → Gate starts).
//
//   const gate = createGateFlow({ sim, airports, findRunwayEnd, scene, uniforms, heightAt });
//   gate.setType(typeDef)       // optional: the aircraft type; else sim.type, else the A321neo
//   gate.start(plan)            // plan.start === 'gate': at plan.stand (or a free gate), brakes set
//   gate.onKey('pushback')      // P: start / hold / continue the pushback
//   gate.pushPath()             // where the planned pushback takes the nose, for the parked traffic
//   gate.update(dt, controls)   // every frame, after the physics steps
//   gate.afterLanding(state)    // every frame after touchdown: below 30 kt, a route to a stand
//   gate.clear()                // runway and final starts: no route
//   gate.route, gate.status, gate.phase, gate.points; gate.onstatus = (text) => toast(text)
//   gate.serialize()            // a scenario save: plain JSON-safe data
//   gate.deserialize(o, plan)   // a scenario load, BEFORE sim.restore() (it may sim.reset())
//   gate.afterLoad()            // after sim.restore()
//
// The phases: 'none' → 'parked' → 'pushback' → 'taxi' → 'departed' (lined up or airborne);
// after landing 'taxi-in' → 'arrived'.

import { buildTaxiGraph, routeFromStand, routeToStand, freeStand, snapToGraph, standsFor, standGeo, lineBehind, pushMinBack, planPushback, regionRules } from './taxi.js';
import { createPushback, pushbackPoses } from './pushback.js';
import { createTaxiRoute } from '../world/taxiroute.js';
import * as A321_GEO from '../geometry.js';

const DEG = Math.PI / 180;
const KT = 0.514444;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// Stands for the setup screen: gates first, then by ref (numbers in number order). With a
// typeDef, only the stands that type can use (taxi.js standsFor).
export function standList(airport, typeDef = null) {
  const num = (r) => { const m = String(r).match(/\d+/); return m ? Number(m[0]) : 1e9; };
  // v0.6.0: at the region's airports the stands the bake numbered itself (R1, R2…, where OSM has no number) come after
  // the real numbers, gates first in each, so "R12" doesn't sit between "12" and "13". Korea's lists stay as they were.
  const ours = regionRules(airport) ? (s) => (/^R\d+$/.test(s.ref) ? 1 : 0) : () => 0;
  return standsFor(airport, typeDef).filter((s) => s.ref).slice().sort((a, b) =>
    (ours(a) - ours(b)) || (b.gate - a.gate) || (num(a.ref) - num(b.ref)) || String(a.ref).localeCompare(String(b.ref)));
}

// The metres of a route that run along a runway: legs on a runway's pavement within 20 degrees of
// its direction (crossing one squarely counts nothing).
// (v0.7.3: `skip`, the ids of runways that serve as taxiways and so don't count: RUNWAY_AS_TAXIWAY)
// v0.7.3 (the review): a standby runway that is the main runway's parallel taxiway. A taxi-in along it is no back-track,
// so it isn't counted against an exit: Venice's 04L/22R (ONE_WAY.LIPZ; landings on 04R past 60 % were turned back
// 500 m along 04R to an exit behind, because the exits ahead lead off along 04L/22R).
const RUNWAY_AS_TAXIWAY = { LIPZ: ['04L/22R'] };

export function alongRunwayM(graph, points, skip = null) {
  let m = 0;
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1], [bx, by] = points[k], L = Math.hypot(bx - ax, by - ay);
    if (L < 1) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (const r of graph.rects) {
      if (skip && skip.includes(r.id)) continue;
      const sa = (mx - r.ax) * r.ux + (my - r.ay) * r.uy, c = -(mx - r.ax) * r.uy + (my - r.ay) * r.ux;
      if (sa < 0 || sa > r.len || Math.abs(c) > r.half) continue;
      if (Math.abs(((bx - ax) * r.ux + (by - ay) * r.uy) / L) > 0.9397) m += L;
    }
  }
  return m;
}

// v0.6.1: who takes the region's taxi-in rule after landing (afterLanding below): the region's airports
// always, and Korea's three while the region is on (Gimpo 32L found no route from most of the runway,
// Jeju 31 ran 790 m along the other runway). Only the taxi-in: Korea's graphs stay unmarked (graph.region),
// so their departure holds, stand lists and routes out are as they were. Decided at each landing, never
// cached with the graph.
const KOREA_TAXI_IN = new Set(['RKSS', 'RKSI', 'RKPC']);
export const taxiInRule = (airport, graph) => !!graph?.region || KOREA_TAXI_IN.has(airport?.icao);

// v0.6.1, the taxi-in rule: the route from where it has really left the landing runway. A rapid exit's
// first legs are still on the runway's pavement, turning off at a shallow angle; those (on the pavement and
// moving away from the centreline) belong to the exit and aren't "along the runway" or a crossing of it.
function pastTurnOff(rect, points) {
  const c = (p) => Math.abs(-(p[0] - rect.ax) * rect.uy + (p[1] - rect.ay) * rect.ux);
  let k = 0;
  while (k + 1 < points.length && c(points[k]) < rect.half &&
    c(points[k + 1]) - c(points[k]) > 0.1 * dist(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1])) k++;
  return points.slice(k);
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
  let forcedType = null;

  // The aircraft: what setType gave, else the sim's own, else (a mock sim in a test) the A321neo.
  const typeNow = () => forcedType || sim?.type || null;
  const geoNow = () => standGeo(typeNow()?.geo || A321_GEO);   // v0.5.3: a design's own nose and length
  const usable = (ap) => standsFor(ap, typeNow());
  // The stand that goes by this ref. Some of Incheon's refs name two positions: take one that fits.
  const standByRef = (ap, ref) => usable(ap).find((s) => s.ref === ref) || (ap.stands || []).find((s) => s.ref === ref);

  // v0.5.7: the keys as bound for the aircraft flown (main.js: setKeyNames); before that, the defaults. '' if unbound.
  const DEFAULT_NAMES = { pushback: 'Shift+G', yawLeft: 'Q', yawRight: 'E', faster: ']', parkingBrake: 'B' };
  let keyNameFn = null;
  const keyName = (id) => (keyNameFn ? keyNameFn(id) || '' : DEFAULT_NAMES[id] || '');
  const flow = {
    onstatus: null,
    setType(typeDef) { forcedType = typeDef || null; },
    // v0.5.6 (review): fn(id) → the key's name as bound for the aircraft flown ('' when unbound); main.js sets it.
    setKeyNames(fn) { keyNameFn = typeof fn === 'function' ? fn : null; },
    pushPath,
    start, onKey, update, afterLanding, afterRestore, clear, serialize, deserialize, afterLoad,
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
    stand = pickStand(airport, plan.stand);
    if (!stand) throw new Error(`No stands at ${plan.origin}`);
    const { NOSE_X } = geoNow();
    const h0 = stand.hdgGridDeg * DEG;
    const fx = Math.sin(h0), fy = Math.cos(h0);
    // The nose on the stop point: the reference point is NOSE_X behind it.
    const rx = stand.x - fx * NOSE_X, ry = stand.y - fy * NOSE_X;
    const toFlap = sim.type?.data.TAKEOFF_FLAP_LEVER ?? 1;
    sim.reset({ x: rx, y: ry, hdg: h0, onGround: true, flapLever: toFlap, gearDown: true, parkingBrake: true,
      fuelKg: plan.fuelKg, payloadKg: plan.payloadKg ?? ((plan.pax || 0) * 84 + (plan.cargoKg || 0)), pax: plan.pax, cargoKg: plan.cargoKg });
    sim.controls.flapLever = toFlap;
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
    pb = planPushback(g, { x: rx, y: ry, hdgGridDeg: stand.hdgGridDeg }, push, prefer, geoNow().WHEELBASE);
    if (r) { r.kind = 'out'; r.stand = stand.ref; r.runway = depEnd.ident; r.textTo = `holding point${r.hold.ref ? ' ' + r.hold.ref : ''} for ${depEnd.ident}`; r.text = taxiText(r, r.textTo, airport); }
    show(r);
    phase = 'parked';
    const pk = keyName('pushback');
    say(`Stand ${stand.ref}. Pushback: ${pk ? `${pk} to start` : 'give it a key on the Controls page'}` + (r ? '' : ' (no taxi route found)'));
    return r;
  }

  // The stand for a gate start: plan's if this type can use it, else the usable one nearest to
  // it, else (no stand asked for) the first free gate. If nothing at all fits, every stand.
  function pickStand(ap, ref) {
    const all = ap.stands || [], fits = usable(ap);
    const pool = fits.length ? fits : all;
    const hit = pool.find((s) => s.ref === ref);
    if (hit) return hit;
    const wanted = all.find((s) => s.ref === ref);
    if (!wanted) return freeStand({ stands: pool }, []);
    let best = null, bd = Infinity;
    for (const s of pool) { const q = dist(s.x, s.y, wanted.x, wanted.y); if (q < bd) { bd = q; best = s; } }
    return best;
  }

  // The taxi line behind the aircraft: the first taxiway the backward ray meets far enough
  // back for this aircraft and within 250 m (taxi.js lineBehind), else the nearest.
  function pushLine(g, x, y, hdg) {
    const minS = pushMinBack(geoNow());
    const best = lineBehind(g, x, y, hdg, minS, 250);
    if (best) return best;
    const back = 60 * (minS / 30);
    const at = snapToGraph(g, x - Math.sin(hdg) * back, y - Math.cos(hdg) * back);
    if (!at) return null;
    const A = g.nodes[at.edge.a], B = g.nodes[at.edge.b];
    return { s: back, x: at.x, y: at.y, hdg: Math.atan2(B.x - A.x, B.y - A.y) };
  }

  // The nose's way along the planned pushback, [x, y, hdg] every few metres, for
  // traffic.setPlayerStand's opts.path. Empty once it has gone.
  function pushPath() {
    if (!pb || !stand || phase !== 'parked') return [];
    const noseX = geoNow().NOSE_X, h0 = stand.hdgGridDeg * DEG;
    const st = { x: stand.x - Math.sin(h0) * noseX, y: stand.y - Math.cos(h0) * noseX, hdgGridDeg: stand.hdgGridDeg };
    return pushbackPoses(st, pb.state).map(([x, y, h]) => [x + Math.sin(h) * noseX, y + Math.cos(h) * noseX, h]);
  }

  // v0.5.6 (review): the keys as they're bound for the aircraft flown (main.js: setKeyNames), else the defaults.
  // v0.5.7: a key left unbound drops out of the line.
  function pushingText() {
    const p = keyName('pushback'), l = keyName('yawLeft'), r = keyName('yawRight'), f = keyName('faster');
    const parts = [p && `${p} holds`, l && r ? `${l}/${r} steer the turn` : '', f && `${f} speeds it up`].filter(Boolean);
    return `Pushing back.${parts.length ? ' ' + parts.join(', ') : ''}`;
  }
  function onKey(action) {
    if (action !== 'pushback') return null;
    if (phase === 'parked' && pb) {
      phase = 'pushback';
      pb.toggle();
      sim.controls.parkingBrake = false;
      say(pushingText());
    } else if (phase === 'pushback' && pb) {
      pb.toggle();
      say(pb.state.running ? pushingText() : `Pushback held${keyName('pushback') ? `: ${keyName('pushback')} to continue` : ''}`);
    } else if (phase === 'taxi') say(taxiLine('Pushback complete. ', route, airport));
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
        say(taxiLine(`Pushback complete. Release the parking brake${keyName('parkingBrake') ? ` (${keyName('parkingBrake')})` : ''}. `, route, airport, 'No taxi route found'));
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
      const noseX = geoNow().NOSE_X;
      const nx = s.pos.x + fx * noseX, ny = s.pos.y + fy * noseX;     // the nose (pos is the reference point)
      if (dist(nx, ny, route.standXY[0], route.standXY[1]) < 8 && s.gs < 1) {
        phase = 'arrived';
        line?.clear();
        say(`At stand ${route.stand}. Set the parking brake${keyName('parkingBrake') ? ` (${keyName('parkingBrake')})` : ''}`);
      }
    }
  }

  // After the pushback: the route again from where the aircraft stopped (a little
  // ahead of the reference point, so it never starts behind the nose).
  function reroute() {
    if (!airport || !depEnd) return;
    const s = sim.state, g = graphFor(airport);
    const ahead = 8 * geoNow().NOSE_X / A321_GEO.NOSE_X;
    const r = routeFromStand(g, { x: s.pos.x + Math.sin(s.hdg) * ahead, y: s.pos.y + Math.cos(s.hdg) * ahead }, depEnd);
    if (!r) return;
    Object.assign(r, { kind: 'out', stand: stand.ref, runway: depEnd.ident });
    r.textTo = `holding point${r.hold.ref ? ' ' + r.hold.ref : ''} for ${depEnd.ident}`; r.text = taxiText(r, r.textTo, airport);
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
      say(taxiLine('Rewound. ', route, airport, 'No taxi route found'));
    } else if ((phase === 'taxi-in' || phase === 'arrived') && airport && stand) {
      const r = routeToStand(graphFor(airport), [s.pos.x, s.pos.y], stand);
      if (!r) return;
      const pts = [[s.pos.x, s.pos.y], ...r.points, ...leadIn(stand)];
      const points = pts.filter((p, i) => i === 0 || dist(p[0], p[1], pts[i - 1][0], pts[i - 1][1]) > 0.5);
      const out = { kind: 'in', points, refs: r.refs, refLens: r.refLens, crossings: r.crossings, lengthM: r.lengthM, stand: stand.ref, standXY: [stand.x, stand.y] };
      out.text = taxiText(out, `stand ${stand.ref}`, airport);
      phase = 'taxi-in';
      show(out);
      say(out.text);
    }
  }

  // ---- scenario saves (v0.2.0) ----
  // Everything the flow keeps, by reference (airport icao, stand ref, runway ident). The
  // pushback's own numbers are kept exact (it must end where it would have); the route's are
  // rounded to 0.01 m.
  function serialize() {
    return {
      v: 1, phase,
      icao: airport?.icao ?? null, stand: stand?.ref ?? null, depIdent: depEnd?.ident ?? null,
      wasAirborne,
      pb: pb ? { ...pb.state } : null,
      route: route ? roundDeep(route) : null,
      status,
      lastTry: lastTry ? roundDeep(lastTry) : null,
    };
  }

  // Back from serialize(). Called before sim.restore(): a gate start still at the stand is
  // planned again with start(plan) (which resets the sim, so the snapshot comes after), so
  // its pushback is the one it had. Nothing is said: the status comes back silently.
  function deserialize(o, plan = null) {
    const quiet = flow.onstatus;
    flow.onstatus = null;
    try {
      clear();
      if (!o || !o.phase || o.phase === 'none') { wasAirborne = !!o?.wasAirborne; return; }
      const ap = o.icao ? byIcao.get(o.icao) : null;
      const out = o.phase === 'parked' || o.phase === 'pushback' || o.phase === 'taxi' || o.phase === 'departed';
      if (out && plan && ap && plan.origin === o.icao && (o.phase === 'parked' || o.phase === 'pushback' || o.pb)) {
        // The departure: plan the stand and pushback again, as the flight began.
        start({ ...plan, stand: o.stand ?? plan.stand, depRunway: o.depIdent ?? plan.depRunway });
        if (pb && o.pb) pb.setState(o.pb);
        if (o.phase !== 'parked' && o.phase !== 'pushback' && !o.pb) pb = null;
      } else if (ap) {
        airport = ap;
        stand = o.stand != null ? standByRef(ap, o.stand) || null : null;
        depEnd = o.depIdent ? endOf(ap, o.depIdent) : null;
        depRect = depEnd ? graphFor(ap).rects.find((r) => r.idents.includes(depEnd.ident)) : null;
        if (o.pb && stand) {
          pb = createPushback({ x: o.pb.x, y: o.pb.y, hdgGridDeg: stand.hdgGridDeg });
          pb.setState(o.pb);
        }
      }
      phase = o.phase;
      wasAirborne = !!o.wasAirborne;
      lastTry = o.lastTry || null;
      status = o.status || '';
      // Lined up / airborne and at the stand the line is gone but the route is kept (the ND).
      if (o.phase === 'departed' || o.phase === 'arrived') { route = o.route || null; line?.clear(); }
      else show(o.route || null);
    } finally {
      flow.onstatus = quiet;
    }
  }

  // After sim.restore(): the pose is the saved one, so nothing has to move. The route line
  // is drawn again (it's drawn from the route alone, so this only makes sure).
  function afterLoad() {
    if (line) { if (route && phase !== 'departed' && phase !== 'arrived') show(route); else line.clear(); }
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
    const rule = taxiInRule(ap, g);   // v0.6.1: the region's taxi-in rule (else v0.5.8's, untouched)
    const dir = Math.sin(state.hdg) * rect.ux + Math.cos(state.hdg) * rect.uy >= 0 ? 1 : -1;
    const s0 = (x - rect.ax) * rect.ux + (y - rect.ay) * rect.uy;
    // Exits: edges leaving this runway's centreline chain, ahead of the aircraft, not
    // pointing back against the landing direction.
    const exits = [];
    for (const e of g.edges) {
      if (e.dead || e.axis || e.runway !== rect.id) continue;
      const A = g.nodes[e.a], B = g.nodes[e.b];
      let I = A.runway === rect.id ? A : B.runway === rect.id ? B : null;
      let O = I === A ? B : A;
      if (!I && rule && !A.runway && !B.runway) {
        // v0.6.0, the region's airports: most of their taxiways aren't joined to the runway's
        // centreline in the map data (they stop at its edge or cross it), so a landing on Qingdao 34
        // or Kansai 24R found no exit at all. Such an edge is an exit too: off the runway at the
        // end farther from the centreline, leaving the centreline abeam its nearer end.
        // v0.6.1: off the pavement is enough (it was 5 m past its edge): the runway's tag stops with the
        // pavement, so a taxiway whose last tagged edge ends 2 m outside it (Narita's B4, for 34R) was missed.
        const off = (n) => -(n.x - rect.ax) * rect.uy + (n.y - rect.ay) * rect.ux;
        const near = Math.abs(off(A)) <= Math.abs(off(B)) ? A : B;
        O = near === A ? B : A;
        if (Math.abs(off(O)) <= rect.half || Math.abs(off(near)) > rect.half + 40) continue;   // it must really leave, from beside the runway
        const sa = (near.x - rect.ax) * rect.ux + (near.y - rect.ay) * rect.uy;
        if (sa < 0 || sa > rect.len) continue;
        I = { x: rect.ax + rect.ux * sa, y: rect.ay + rect.uy * sa, runway: rect.id };
      }
      if (!I || O.runway) continue;
      const ahead = dir * ((I.x - rect.ax) * rect.ux + (I.y - rect.ay) * rect.uy - s0);
      const back = dir * ((O.x - I.x) * rect.ux + (O.y - I.y) * rect.uy) / (I === A || I === B ? e.lengthM || 1 : Math.hypot(O.x - I.x, O.y - I.y) || 1);   // (a joined exit: v0.5.8's arithmetic)
      if (ahead < -10 || ahead > 3500 || back < -0.3) continue;
      exits.push({ I, O, ahead });
    }
    exits.sort((p, q) => p.ahead - q.ahead);
    // v0.6.1, the taxi-in rule: the route is planned once, at 30 kt or less, and the aircraft rolls on
    // while it slows. An exit it can't slow for (to 10 kt, at 1.5 m/s²) comes after those it can: else it
    // rolls past and the route turns it back along the runway. If none of those leads anywhere without
    // running along a runway (Jeju 31 from the middle: only the far end, then back), the rest compete too.
    const minAhead = rule ? Math.max(-10, (state.gs * state.gs - 25) / 3) : -10;
    const tiers = rule ? [exits.filter((ex) => ex.ahead >= minAhead), exits.filter((ex) => ex.ahead < minAhead)] : [exits];
    let best = null;
    for (const tier of tiers) {
      if (best && best.along < 150) break;
      for (const ex of tier.slice(0, 6)) {
        // Skip stands with a parked aircraft (occupied(icao) gives their refs). A widebody has few
        // stands to choose from: if all are taken, one of them gets freed (traffic.setPlayerStand).
        const fits = usable(ap), pool = fits.length ? { stands: fits } : ap;
        const at = [ex.O.x, ex.O.y];
        let st = freeStand(pool, occupied ? occupied(ap.icao) : [], at) || (fits === ap.stands ? null : freeStand(pool, [], at));
        let r = st && routeToStand(g, [ex.O.x, ex.O.y], st);
        if (!r && st && rule) {
          // v0.6.0, the region's airports: the nearest free stand can sit on a piece of the map's
          // taxiways that nothing joins (Hongqiao's stand 64 from runway 18R). Then the next
          // nearest, a few times, before this exit is given up.
          const skip = new Set(occupied ? occupied(ap.icao) : []);
          for (let k = 0; k < 8 && !r && st; k++) {
            skip.add(st.ref);
            st = freeStand(pool, skip, at);
            r = st && routeToStand(g, [ex.O.x, ex.O.y], st);
          }
        }
        if (!r) continue;
        // v0.6.0, the region's airports: an exit whose route then runs back along a runway (the
        // map's graph allows it, at a cost) loses to one a little further on that doesn't.
        // v0.6.1: a rapid exit's own turn-off isn't counted (pastTurnOff), so it no longer loses to a
        // square exit for the shallow angle it leaves at.
        const along = rule ? alongRunwayM(g, pastTurnOff(rect, r.points), RUNWAY_AS_TAXIWAY[ap.icao]) : 0;
        const total = ex.ahead + r.lengthM + (rule ? 5 * along : 0);
        if (!best || total < best.total) best = { total, along, ex, r, st };
      }
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
    // v0.6.0, the region's airports: the exit's own edge carries the tag of the runway being left,
    // which read as "crossing 16/34" after a landing on 34. The landing runway is only a crossing
    // if the route comes back onto its pavement.
    // v0.6.1: nor are a rapid exit's first legs, still on the pavement as it turns off (Narita 16R's A7
    // read "crossing 16R/34L"): only coming back onto it after the turn-off is.
    let crossings = r.crossings;
    if (rule && crossings && crossings.includes(rect.id)) {
      const onIt = ([px, py]) => { const sa = (px - rect.ax) * rect.ux + (py - rect.ay) * rect.uy, c = -(px - rect.ax) * rect.uy + (py - rect.ay) * rect.ux; return sa > 0 && sa < rect.len && Math.abs(c) < rect.half; };
      const rest = pastTurnOff(rect, r.points);
      if (!rest.slice(1).some(onIt)) crossings = crossings.filter((c) => c !== rect.id);
    }
    const out = { kind: 'in', points, refs: r.refs, refLens: r.refLens, crossings, lengthM, stand: st.ref, standXY: [st.x, st.y], exit: [ex.O.x, ex.O.y] };
    out.text = taxiText(out, `stand ${st.ref}`, ap);
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

// A JSON-safe copy with every number rounded to 0.01 (routes and points).
function roundDeep(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = roundDeep(v[k]); return o; }
  return v;
}

function endOf(airport, ident) {
  for (const r of airport.runways || []) for (const e of r.ends) if (String(e.ident).toUpperCase() === String(ident).toUpperCase()) return e;
  return null;
}

// "Taxi to holding point A1 for 14R via P, A, crossing 14L/32R".
// v0.7.8 (briefs/V0-7-8.md part 6, item 2; the trees subagent's): Madrid's taxi-in ran to thirty names over two lines
// and named OSM's "GATE-5" and "GATE-13" as taxiways. Now (taxiRefs()) a stand's or a gate's ref is no taxiway, a
// taxiway's numbered piece ("KA-7") reads as its taxiway ("KA"), a name
// is never given twice in a row, and a name that comes back after one short link (under TAXI_SHORT_M, not a runway)
// takes the link in; and the whole line is cut to TAXI_LINE_MAX characters with "…" (fitLine()), so it stays one line on
// the panel (main.js's toast: 14 px, at most half the window wide). ap: the airport, for its stands' refs.
// (The code review, 04:53: a stand's ref is dropped only on a link under TAXI_STAND_LINK_M, the stand's own lead-in:
// at twenty airports a real taxiway shares a stand's name, Frankfurt's N over 6 km, Incheon's R4 and R1, Berlin's B
// and C. And the runway crossings are never cut off the line: the names in the middle of the list go first, fitTaxi().)
export const TAXI_SHORT_M = 200, TAXI_LINE_MAX = 84, TAXI_STAND_LINK_M = 100;
export function taxiRefs(refs, lens = null, ap = null) {
  const standRefs = new Set(((ap && ap.stands) || []).map((s) => String(s.ref)));
  const isRwy = (x) => x.startsWith('RWY ');
  const out = [];
  (refs || []).forEach((ref, i) => {
    if (!ref) return;
    const known = !!(lens && Number.isFinite(lens[i])), len = known ? lens[i] : Infinity;
    // a gate's ref never; a stand's ref on a short link (its lead-in), or where the link's length isn't known
    if (!isRwy(ref) && (/^GATE/i.test(ref) || (standRefs.has(ref) && (!known || len < TAXI_STAND_LINK_M)))) return;
    if (!isRwy(ref)) ref = ref.replace(/^([A-Z]{1,3})-\d{1,3}$/, '$1');   // a taxiway's numbered piece (Madrid's "KA-7", "M-27"): the taxiway
    const last = out[out.length - 1];
    if (last && last.ref === ref) { last.len += len; return; }
    if (out.length >= 2 && out[out.length - 2].ref === ref && last.len < TAXI_SHORT_M && !isRwy(last.ref)) { out.pop(); out[out.length - 1].len += last.len + len; return; }
    out.push({ ref, len });
  });
  return out.map((o) => o.ref);
}
export function fitLine(s, max = TAXI_LINE_MAX) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), k = cut.lastIndexOf(', ');
  return (k > max * 0.6 ? cut.slice(0, k) : cut.replace(/[\s,]+$/, '')) + '…';
}
// The instruction within `max` characters with every runway kept, crossed or taxied along: the whole list if it fits;
// else taxiway names are left out one at a time, from the one before the last back toward the first, each run of them
// shown as "…" ("via P1, A, …, runway 04/22, …, G, crossing 18L/36R"). The last name and every "runway X" stay.
export function fitTaxi(head, refs, tail, max = TAXI_LINE_MAX) {
  const out = refs.map(() => false);
  const text = () => {
    const list = [];
    refs.forEach((r, i) => { if (!out[i]) list.push(r); else if (list[list.length - 1] !== '…') list.push('…'); });
    return head + (list.length ? ` via ${list.join(', ')}` : '') + tail;
  };
  let s = text();
  for (let k = refs.length - 2; k >= 0 && s.length > max; k--) {
    if (refs[k].startsWith('runway ')) continue;
    out[k] = true; s = text();
  }
  // Still too long (Pudong: four runways crossed on one route): the last name goes too, then the "…" itself, before
  // any runway does.
  const n = refs.length - 1;
  if (s.length > max && n >= 0 && !refs[n].startsWith('runway ')) { out[n] = true; s = text(); }
  if (s.length > max) {   // (Brussels's 25L by 01/19 and 07R/25L: the runways alone, without the "…" between them)
    const rw = refs.filter((r) => r.startsWith('runway '));
    s = head + (rw.length ? ` via ${rw.join(', ')}` : '') + tail;
  }
  return s.length <= max ? s : fitLine(s, max);
}
// `max`: the line's budget (TAXI_LINE_MAX less a prefix such as "Pushback complete. ": taxiLine() below).
export function taxiText(r, to, ap = null, max = TAXI_LINE_MAX) {
  const refs = taxiRefs(r.refs, r.refLens, ap).map((x) => (x.startsWith('RWY ') ? 'runway ' + x.slice(4) : x));
  const cross = (r.crossings || []).filter((c) => !refs.includes('runway ' + c));
  return fitTaxi(`Taxi to ${to}`, refs, cross.length ? `, crossing ${cross.join(', ')}` : '', max);
}
// A route's instruction after a prefix. A short prefix ("Pushback complete. ", "Rewound. ") and the route share the
// one line: the route is fitted again in what the prefix leaves. After a long prefix (the parking brake's hint, 50
// characters and more) the route keeps its own full line, as v0.7.7 said the whole route there, and the message may
// take a second line. And whatever the budget, a runway is never lost to it: a fit that cut one, or cut at all, gives
// way to the route's own full line. (The code review's second look: the first version squeezed the route into the 34
// characters the brake's hint left, which lost every route after a pushback.) `none`: the text where there is no route.
export const TAXI_PREFIX_MAX = 24;
export function taxiLine(prefix, r, ap = null, none = '') {
  if (!r) return prefix + none;
  // a route restored from a save made before v0.7.8 has no textTo: read it back from its text
  const to = r.textTo || (r.refs && r.text ? (/^Taxi to (.*?)(?= via |, crossing |$)/.exec(r.text) || [])[1] : null);
  if (!to) return prefix + (r.text || none);
  const full = taxiText(r, to, ap);
  if (prefix.length > TAXI_PREFIX_MAX) return prefix + full;
  const t = taxiText(r, to, ap, TAXI_LINE_MAX - prefix.length);
  const lost = t.endsWith('…') || (r.crossings || []).some((c) => !t.includes(c));
  return prefix + (lost ? full : t);
}
