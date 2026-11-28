// v0.8.0 (part 7), the hydraulics: each family's three systems, their pumps, the PTU and the RAT, and what the
// pressures leave working. Pure: no DOM, no three.js, nothing random, no state of its own (the sim's core holds the
// state: sim.js's X.h* fields). It runs in the page, in node and in the prediction worker.
//
// Every number and assignment here is from what is publicly known of the FCOM-level descriptions; no type's own
// document was read in v0.8.0's run, so all of it is [EST] unless said otherwise.
//
// A LAYOUT (hydLayout(typeDef)): { family, model ('a321' | 'b787' | 'b777'), names: [3], pumps: [{ id, sys, kind,
//   engine (its engine's index, kind 'engine' only), sw (true: off unless the crew switches it on) }], ptu (true: a
//   PTU between systems 0 and 2), ratSys (the system the RAT feeds), revSys: [the system of each engine's reverser] }.
// The PRESSURES (hydPressures(layout, inputs, out)): out.p[s] 0 to 1 (the target the sim's pressures follow), out.pc[s]
//   the same without the RAT (the Boeings' RAT feeds the flight controls only), out.ptu (true: the PTU is turning).
// The EFFECTS (hydEffects(layout, P, out, gearDown)): the one object the sim, the laws and the screens read.

export const HYD_NAMES = { airbus: ['Green', 'Blue', 'Yellow'], boeing: ['Left', 'Centre', 'Right'] };
// A system counts as working above this pressure, and as lost (state.hyd.lost) under LOST_P.
export const WORK_P = 0.5, LOST_P = 0.2;
// [EST] The numbers: a windmilling engine's pump above 15 % N1 gives a share under the working pressure (it can't
// carry a system alone); a Boeing's electric demand pump holds its system (flow-limited, but above WORK_P); the PTU
// carries 0.9 of the other system's pressure across; the RAT takes 8 s to come up to speed and feeds fully above
// 130 kt, fading to nothing at 80 kt; the pressures follow the pumps with a 2 s lag (sim.js).
export const HYD = {
  windmillN1: 15, windmillShare: 0.3, demandShare: 0.8, ptuShare: 0.9,
  ratS: 8, ratFullKt: 130, ratZeroKt: 80, lagS: 2,
  // The most the brake pedals get [EST]: normal 1, the alternate system 0.7 (taken as without anti-skid), the
  // accumulator alone 0.5 (kept simple: a constant, not a charge that runs down).
  brakeAlt: 0.7, brakeAcc: 0.5,
};

const baseId = (typeDef) => (typeDef.base && typeDef.base.id) || typeDef.id;

// The systems of a family and a design. A design flies its base type's systems; its engines' pumps go by side:
// on the left (y > 0) the first system, on the right the third, on the centreline none (the centre system's
// electric pumps feed it).
export function hydLayout(typeDef) {
  const id = baseId(typeDef);
  const family = typeDef.family === 'boeing' ? 'boeing' : 'airbus';
  const model = family === 'airbus' ? 'a321' : id === 'b777-300er' ? 'b777' : 'b787';
  const E = (typeDef.geo && typeDef.geo.ENGINES) || [];
  const pumps = [], revSys = [];
  const sideSys = (e) => (e.y > 0.5 ? 0 : e.y < -0.5 ? 2 : 1);
  // (The code review's B3: on an Airbus only green and yellow have engine pumps, so an engine on the centreline feeds
  // whichever of the two has fewer, green first: a design with its engines in the tail keeps its hydraulics. On a
  // Boeing the centre has its electric pumps and a centreline engine has none.)
  const sys = E.map(sideSys);
  if (family === 'airbus') {
    let n0 = sys.filter((s) => s === 0).length, n2 = sys.filter((s) => s === 2).length;
    for (let i = 0; i < sys.length; i++) if (sys[i] === 1) { if (n0 <= n2) { sys[i] = 0; n0++; } else { sys[i] = 2; n2++; } }
  }
  E.forEach((e, i) => {
    const s = sys[i];
    revSys.push(s);
    if (s !== 1) pumps.push({ id: 'EDP' + (i + 1), sys: s, kind: 'engine', engine: i, sw: false });
  });
  if (family === 'airbus') {
    pumps.push({ id: 'B-ELEC', sys: 1, kind: 'electric', sw: false });
    pumps.push({ id: 'Y-ELEC', sys: 2, kind: 'electric', sw: true });   // off in flight unless the crew switches it on
    pumps.push({ id: 'RAT', sys: 1, kind: 'rat', sw: false });
    pumps.push({ id: 'PTU', sys: 0, kind: 'ptu', sw: false });          // between green (0) and yellow (2)
  } else {
    pumps.push({ id: 'L-ACMP', sys: 0, kind: 'electric', sw: false });   // the demand pumps run by themselves
    pumps.push({ id: 'C1-ACMP', sys: 1, kind: 'electric', sw: false });
    pumps.push({ id: 'C2-ACMP', sys: 1, kind: 'electric', sw: false });
    if (model === 'b777') {
      pumps.push({ id: 'C1-ADP', sys: 1, kind: 'electric', air: true, sw: false });   // air-driven: bleed air, kind 'electric' for the screens' sake
      pumps.push({ id: 'C2-ADP', sys: 1, kind: 'electric', air: true, sw: false });
    }
    pumps.push({ id: 'R-ACMP', sys: 2, kind: 'electric', sw: false });
    pumps.push({ id: 'RAT', sys: 1, kind: 'rat', sw: false });
  }
  return { family, model, names: HYD_NAMES[family], pumps, ptu: family === 'airbus', ratSys: 1, revSys };
}

// The pressures from the pumps. inputs: {
//   eng: [per engine: 1 burning, else its N1 (a windmill's) as a negative number -N1, or 0 stopped or gone],
//   failed: bit mask of the layout's pumps that give nothing, drained: bit mask of systems with no fluid,
//   power (true: electric power for the electric pumps: an engine burning), ySw (Airbus: the yellow electric pump on),
//   rat (0 to 1: the RAT out and up to speed), iasKt }.
export function hydPressures(L, inp, out) {
  const p = out.p || (out.p = [0, 0, 0]), pc = out.pc || (out.pc = [0, 0, 0]);
  p[0] = p[1] = p[2] = 0; pc[0] = pc[1] = pc[2] = 0;
  let ratOut = 0;
  for (let k = 0; k < L.pumps.length; k++) {
    const pu = L.pumps[k];
    if (inp.failed & (1 << k)) continue;
    let g = 0;
    if (pu.kind === 'engine') {
      const e = inp.eng[pu.engine] || 0;
      g = e >= 1 ? 1 : -e >= HYD.windmillN1 ? HYD.windmillShare : 0;
    } else if (pu.kind === 'electric') {
      if (!inp.power || (pu.sw && !inp.ySw)) continue;
      g = L.family === 'airbus' ? 1 : HYD.demandShare;
    } else if (pu.kind === 'rat') {
      const v = (inp.iasKt - HYD.ratZeroKt) / (HYD.ratFullKt - HYD.ratZeroKt);
      g = (inp.rat || 0) * (v < 0 ? 0 : v > 1 ? 1 : v);
      ratOut = g;
      if (g > p[pu.sys]) p[pu.sys] = g;
      continue;
    } else continue;   // the PTU: below
    if (g > p[pu.sys]) p[pu.sys] = g;
    if (g > pc[pu.sys]) pc[pu.sys] = g;
  }
  // Airbus: the RAT feeds blue whole (pc counts it too).
  if (L.family === 'airbus' && ratOut > pc[L.ratSys]) pc[L.ratSys] = ratOut;
  out.ptu = false;
  if (L.ptu) {
    const ptuK = L.pumps.findIndex((x) => x.kind === 'ptu');
    const ok = !(inp.failed & (1 << ptuK)) && !(inp.drained & 1) && !(inp.drained & 4);
    if (ok) {
      // It runs by itself when one of green and yellow has lost its pumps but kept its fluid.
      if (p[0] < WORK_P && p[2] >= WORK_P) { p[0] = pc[0] = Math.max(p[0], HYD.ptuShare * p[2]); out.ptu = true; }
      else if (p[2] < WORK_P && p[0] >= WORK_P) { p[2] = pc[2] = Math.max(p[2], HYD.ptuShare * p[0]); out.ptu = true; }
    }
  }
  for (let s = 0; s < 3; s++) if (inp.drained & (1 << s)) { p[s] = 0; pc[s] = 0; }
  return out;
}

// A fresh effects object: everything working (what hOn 0 means).
export function hydNormal(nEngines) {
  const rev = []; for (let i = 0; i < nEngines; i++) rev.push(1);
  return { gear: true, brake: 1, antiskid: true, steer: 1, slats: 1, flaps: 1, speedbrake: 1, groundSpoilers: 1, rollSpoilers: 1,
    aileron: 1, elevator: 1, rudder: 1, stab: 1, reverser: rev, law: 0 };
}

// What the pressures leave working. P: hydPressures()'s out (or { p, pc }); gearDown (Airbus: the law goes direct
// with the gear down once two systems that take it to alternate are lost).
export function hydEffects(L, P, out, gearDown = false) {
  const p = P.p, pc = P.pc || P.p;
  const w = (s) => p[s] > WORK_P, wc = (s) => pc[s] > WORK_P;
  const n = (arr, f) => { let c = 0; for (const s of arr) if (f(s)) c++; return c / arr.length; };
  out.reverser = out.reverser || [];
  out.reverser.length = L.revSys.length;
  for (let i = 0; i < L.revSys.length; i++) out.reverser[i] = (L.family === 'airbus' ? w(L.revSys[i]) : wc(L.revSys[i])) ? 1 : 0;
  if (L.family === 'airbus') {
    const G = w(0), B = w(1), Y = w(2);
    out.gear = G;
    out.brake = G ? 1 : Y ? HYD.brakeAlt : HYD.brakeAcc; out.antiskid = G;
    out.steer = G ? 1 : 0;                                   // [EST] the brief's: on green (some A320s steer on yellow)
    out.slats = n([0, 1], w); out.flaps = n([0, 2], w);
    // Spoilers 1 to 5 a side on G, Y, B, Y, G: the speed brakes are 2 to 4, the roll spoilers 2 to 5, the ground all five.
    out.speedbrake = n([2, 1, 2], w); out.groundSpoilers = n([0, 2, 1, 2, 0], w); out.rollSpoilers = n([2, 1, 2, 0], w);
    out.aileron = n([0, 1], w); out.elevator = n([0, 1, 2], w); out.rudder = n([0, 1, 2], w);
    out.stab = G || Y ? 1 : 0;
    // [EST] The law: green and blue, or green and yellow, lost: alternate, direct with the gear down; blue and yellow:
    // normal; all three: direct (and nothing moves).
    out.law = (!G && !B) || (!G && !Y) ? (gearDown || (!B && !Y) ? 2 : 1) : 0;
  } else {
    // The flight controls (and the spoilers, shared) on all three, the RAT's share of the centre counted; the rest
    // on the centre without the RAT.
    const all = [0, 1, 2];
    const fc = n(all, w), C = wc(1);
    out.gear = C; out.steer = C ? 1 : 0;
    out.slats = C ? 1 : 0; out.flaps = C ? 1 : 0;
    if (L.model === 'b777') { out.brake = wc(2) ? 1 : C ? HYD.brakeAlt : HYD.brakeAcc; out.antiskid = wc(2); }
    else { out.brake = 1; out.antiskid = true; }             // the 787's brakes are electric
    out.speedbrake = fc; out.groundSpoilers = fc; out.rollSpoilers = fc;
    out.aileron = fc; out.elevator = fc; out.rudder = fc;
    out.stab = fc > 0 ? 1 : 0;
    // [EST] One system lost: normal mode; two: secondary; all three (the RAT's centre or nothing left): direct.
    const lost = 3 - Math.round(n(all, wc) * 3);
    out.law = lost >= 3 ? 2 : lost === 2 ? 1 : 0;
  }
  return out;
}
