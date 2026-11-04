// A kinematic stand-in for a Boeing's sim.state and sim.ap, for the Boeing screens' dev page (no
// flight model, no WebGL). It follows STATUS.md's "v0.3.0 interfaces"; numbers that are the type's come
// from its data module. Every call to an ap method is logged in ap._calls, for the browser check.

import { makeState, placeOnFinal } from './dev-ui-mock.js';
import { machFromIas, iasFromTas, tasFromIas, isa } from '../src/sim/atmosphere.js';

const DEG = Math.PI / 180, KT = 0.514444, FT = 0.3048;

export function makeBoeingState(A) {
  const st = makeState();
  Object.assign(st, { vRef: 0, vmm: 0, vStick: 0, shaker: false, pliDeg: 12, protStall: false, protOver: false, protBank: false,
    config: 'UP', flapLever: 0, flapDeg: 0, slatDeg: 0, mass: 210000, fuelKg: 45000, leverN1: 0, athrActive: false });
  st.fuel = { left: 15000, right: 15000, center: 15000 };
  st.engines = [0, 1].map(() => ({ n1: A.N1_IDLE, n1Target: A.N1_IDLE, ffKgS: 0.2, thrustN: 0, rev: 0 }));
  return st;
}

export function makeBoeingAp(state) {
  const ap = {
    ap: false, athr: false, spdKt: 250, hdgDeg: 90, altFt: 10000, vsFpm: 0, lateral: 'HDG SEL', vertical: 'ALT', thrustMode: 'SPD',
    armedLateral: '', armedVertical: '', _calls: [],
  };
  const log = (name, ...a) => ap._calls.push([name, ...a]);
  Object.assign(ap, {
    engageAp() { log('engageAp'); ap.ap = true; },
    disconnectAp(r) { log('disconnectAp', r); ap.ap = false; state.warnings.apDisc = true; setTimeout(() => (state.warnings.apDisc = false), 3000); },
    toggleAthr() { log('toggleAthr'); ap.athr = !ap.athr; },
    setAlt(ft) { log('setAlt', ft); ap.altFt = ft; },
    setHdg(d) { log('setHdg', d); ap.hdgDeg = d; },
    setSpd(k) { log('setSpd', k); ap.spdKt = k; },
    setVs(f) { log('setVs', f); ap.vsFpm = f; ap.vertical = 'V/S'; ap.thrustMode = 'SPD'; },
    levelChange() { log('levelChange'); ap.vertical = 'FLCH SPD'; ap.thrustMode = ap.altFt > state.pos.z / FT ? 'THR' : 'IDLE'; },
    hdgSel() { log('hdgSel'); ap.lateral = 'HDG SEL'; },
    hdgHold() { log('hdgHold'); ap.lateral = 'HDG HOLD'; },
    altHold() { log('altHold'); ap.vertical = 'ALT'; ap.thrustMode = 'SPD'; },
    lnav() { log('lnav'); ap.lateral = 'LNAV'; ap.armedLateral = ''; },
    vnav() { log('vnav'); ap.vertical = 'VNAV PTH'; ap.armedVertical = ''; },
    loc() { log('loc'); ap.armedLateral = 'LOC'; },
    app() { log('app'); ap.armedLateral = 'LOC'; ap.armedVertical = 'G/S'; },
    toga() { log('toga'); ap.lateral = 'TO/GA'; ap.vertical = 'TO/GA'; ap.thrustMode = 'THR REF'; },
    setIls() { log('setIls'); }, setRoute() { log('setRoute'); },
  });
  return ap;
}

// The derived fields, as sim.js fills them (speeds from the type's limits).
export function deriveBoeing(st, A, elev = 18) {
  st.cas = st.ias;
  st.tas = tasFromIas(st.ias, st.pos.z);
  st.mach = machFromIas(st.ias, st.pos.z);
  st.vel.x = Math.sin(st.hdg) * st.tas; st.vel.y = Math.cos(st.hdg) * st.tas; st.vel.z = st.vs;
  st.gs = st.tas;
  st.groundH = elev; st.agl = st.onGround ? 0 : Math.max(0, st.pos.z - 5 - elev);
  const c = A.CONFIGS[st.config] || A.CONFIGS.UP;
  st.slatDeg = c.slat; st.flapDeg = c.flap;
  const mmoIas = iasFromTas(A.MMO * isa(st.pos.z).a, st.pos.z);
  let vmax = Math.min(A.VMO_KT * KT, mmoIas, (A.VFE_KT[st.config] ?? A.VMO_KT) * KT);
  if (st.gearPos > 0.01) vmax = Math.min(vmax, A.VLE_KT * KT);
  st.vmax = vmax;
  const nx = A.NEXT_CONFIG[st.config];
  st.vfeNext = nx ? A.VFE_KT[nx] * KT : 0;
  return st;
}

const eng = (st, n1, tgt, ff) => { for (const e of st.engines) { e.n1 = n1; e.n1Target = tgt; e.ffKgS = ff; } };

// The scenes: name -> fn(st, ap, A, { dep, arr }). `dep`/`arr` are findEnd() results.
export const SCENES = {
  // Cruise at FL350, M0.85, LNAV and VNAV.
  fl350(st, ap, A, { dep, arr }) {
    st.onGround = false; st.pos.x = dep.end.x - 20000; st.pos.y = dep.end.y - 150000; st.pos.z = 35000 * FT;
    st.hdg = 3.3; st.vs = 0; st.pitch = 2.4 * DEG; st.roll = 0; st.t = 1500;
    st.ias = iasFromTas(0.85 * isa(st.pos.z).a, st.pos.z);
    st.config = 'UP'; st.flapLever = 0; st.gearPos = 0; st.mass = 205000; st.fuelKg = 38400;
    eng(st, 86.4, 86.4, 1.32); st.thrustLever = 0.88; st.leverN1 = 86.4; st.athrActive = true;
    st.vRef = st.ias; st.vmm = st.ias - 42 * KT; st.vStick = st.ias - 62 * KT; st.pliDeg = 6.5;
    st.surfaces.stab = 2.1 * DEG;
    Object.assign(ap, { ap: true, athr: true, spdKt: st.ias / KT, hdgDeg: 214, altFt: 35000, lateral: 'LNAV', vertical: 'VNAV PTH', thrustMode: 'SPD' });
    deriveBoeing(st, A, 0); st.agl = st.pos.z;
  },
  // On final to Jeju: 4 nm, gear down, flaps 30, both beams captured, under 1,500 ft: LAND 3.
  final(st, ap, A, { arr }) {
    placeOnFinal(st, arr.end, 4, 0.1, -60); st.onGround = false; st.t = 2900;
    st.ias = 146 * KT; st.vs = -760 / 196.85; st.pitch = 2.3 * DEG; st.roll = 1.5 * DEG;
    st.config = '30'; st.flapLever = A.FLAP_LEVER.length - 1; st.gearPos = 1; st.mass = 178000; st.fuelKg = 12300;
    eng(st, 54, 56, 0.55); st.thrustLever = 0.5; st.leverN1 = 55.5; st.athrActive = true;
    st.vRef = 146 * KT; st.vmm = 134 * KT; st.vStick = 118 * KT; st.pliDeg = 11; st.surfaces.stab = 5.8 * DEG; st.parkingBrake = false;
    Object.assign(ap, { ap: true, athr: true, spdKt: 146, hdgDeg: 70, altFt: 3000, lateral: 'LOC', vertical: 'G/S', thrustMode: 'SPD', armedLateral: '', armedVertical: '' });
    deriveBoeing(st, A, arr.end.elevM);
  },
  // The take-off roll: 112 kt, THR REF, flaps 5, TO/GA in both windows.
  takeoff(st, ap, A, { dep }) {
    const h = dep.end.hdgGridDeg * DEG;
    st.pos.x = dep.end.x + Math.sin(h) * 900; st.pos.y = dep.end.y + Math.cos(h) * 900; st.pos.z = dep.end.elevM + 5; st.hdg = h;
    st.onGround = true; st.ias = 112 * KT; st.vs = 0; st.pitch = 0.2 * DEG; st.roll = 0; st.t = 40;
    st.config = '5'; st.flapLever = A.FLAP_LEVER.indexOf('5'); st.gearPos = 1; st.mass = 235000; st.fuelKg = 62000;
    eng(st, 94.8, 97, 2.9); st.thrustLever = 1; st.leverN1 = A.N1_TOGA; st.athrActive = true; st.detent = 'FULL';
    st.vRef = 172 * KT; st.vmm = 0; st.vStick = 0; st.pliDeg = 14; st.surfaces.stab = 5 * DEG; st.parkingBrake = false;
    Object.assign(ap, { ap: false, athr: true, spdKt: 170, hdgDeg: 323, altFt: 6000, lateral: 'TO/GA', vertical: 'TO/GA', thrustMode: 'THR REF', armedLateral: 'LNAV', armedVertical: 'VNAV' });
    deriveBoeing(st, A, dep.end.elevM);
  },
  // Slow, in a turn, near the shaker, A/P off: the amber band, the barber pole, an amber PLI.
  'stall-near'(st, ap, A, { dep }) {
    st.onGround = false; st.pos.x = dep.end.x - 30000; st.pos.y = dep.end.y - 42000; st.pos.z = 8200 * FT;
    st.hdg = 1.2; st.vs = -640 / 196.85; st.pitch = 14 * DEG; st.roll = 12 * DEG; st.beta = 0.8 * DEG; st.t = 800;
    st.ias = 158 * KT; st.config = 'UP'; st.flapLever = 0; st.gearPos = 0; st.mass = 228000; st.fuelKg = 56000;
    eng(st, 42, 97, 0.6); st.thrustLever = 1; st.leverN1 = A.N1_TOGA; st.parkingBrake = false;
    st.vRef = 214 * KT; st.vmm = 188 * KT; st.vStick = 160 * KT; st.pliDeg = 0.4; st.shaker = true; st.warnings.stall = true; st.protStall = true;
    Object.assign(ap, { ap: false, athr: false, spdKt: 220, hdgDeg: 120, altFt: 9000, lateral: 'HDG SEL', vertical: 'FLCH SPD', thrustMode: 'THR', armedLateral: '', armedVertical: '' });
    deriveBoeing(st, A, 18);
  },
  // Climbing through 6,000 ft: flaps 1 retracting, LNAV armed under HDG SEL.
  climb(st, ap, A, { dep }) {
    st.onGround = false; st.pos.x = dep.end.x - 9000; st.pos.y = dep.end.y - 9000; st.pos.z = 6200 * FT;
    st.hdg = 3.6; st.vs = 2600 / 196.85; st.pitch = 9 * DEG; st.roll = -24 * DEG; st.t = 300;
    st.ias = 238 * KT; st.config = '1'; st.flapLever = 0; st.gearPos = 0; st.mass = 232000; st.fuelKg = 60000;
    eng(st, 91, 91, 2.2); st.thrustLever = 0.92; st.leverN1 = 90; st.athrActive = true;
    st.vRef = 250 * KT; st.vmm = 205 * KT; st.vStick = 172 * KT; st.pliDeg = 9; st.surfaces.stab = 3 * DEG;
    Object.assign(ap, { ap: true, athr: true, spdKt: 250, hdgDeg: 180, altFt: 12000, lateral: 'HDG SEL', vertical: 'FLCH SPD', thrustMode: 'THR', armedLateral: 'LNAV', armedVertical: 'VNAV' });
    deriveBoeing(st, A, 18);
    st.slatDeg = 12;
  },
  // At the stand: parked, idle, flaps up.
  stand(st, ap, A, { dep }) {
    st.pos.x = dep.end.x; st.pos.y = dep.end.y; st.pos.z = dep.end.elevM + 5; st.hdg = 1; st.onGround = true; st.ias = 0; st.t = 2;
    st.config = 'UP'; st.flapLever = 0; st.gearPos = 1; st.parkingBrake = true; eng(st, A.N1_IDLE, A.N1_IDLE, 0.2);
    Object.assign(ap, { ap: false, athr: false, spdKt: 170, hdgDeg: 323, altFt: 6000, lateral: 'HDG SEL', vertical: 'ALT', thrustMode: '' });
    deriveBoeing(st, A, dep.end.elevM);
  },
};
