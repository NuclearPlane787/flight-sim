// v0.5.3: the A321's model follows a design's airframe (src/aircraft.js through geo.AIRFRAME, src/sim/airframe-map.js).
// Builds the skinned model in node (the livery paints into a no-op canvas).
//   node --test games/flight-sim/tests/aircraft-airframe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A canvas that draws nothing, so createLiveryTextures() runs without a DOM.
const ctx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 })
    : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

const THREE = await import('../vendor/three.module.js');
const { createAircraft, fuseSection, wingSec, foilPoint } = await import('../src/aircraft.js');
const { NOSE_X, TAIL_X, LENGTH } = await import('../src/geometry.js');
const { newDesign, defaultAirframe, designDef } = await import('../src/sim/designs.js');

const W = (o = {}) => ({ span: 1, chord: 1, sweep: 0, dihedral: 5.1, ...o });
const design = (af) => {
  const wl = W(af.wingL), wr = af.wingR ? W(af.wingR) : wl;
  return { ...newDesign('a321neo'), airframe: { ...defaultAirframe('a321neo'), ...af, wingL: wl, wingR: wr, mirror: !af.wingR } };
};
// The brief's test design, and the sliders' other limits.
const BIG = { tail: 1.6, fin: 0.6, plugFwd: 6, plugAft: -4, wingL: { span: 1.3, chord: 0.8, sweep: 8, dihedral: 8 } };
const SMALL = { tail: 0.6, fin: 1.6, plugFwd: -4, plugAft: 6, wingL: { span: 0.8, chord: 1.3, sweep: -8, dihedral: -3 } };
const ASYM = { wingL: { span: 1.3 }, wingR: { span: 0.8, chord: 1.2, sweep: -6, dihedral: 0 } };

// Body-frame vertices (model X = −y, Y = z, Z = −x), with their bone names, colours and uvs.
function verts(ac) {
  const g = ac.mesh.geometry, p = g.attributes.position, si = g.attributes.skinIndex, c = g.attributes.color, uv = g.attributes.uv;
  const names = ac.mesh.skeleton.bones.map((b) => b.name), out = [];
  for (let i = 0; i < p.count; i++) {
    out.push({ x: -p.getZ(i), y: -p.getX(i), z: p.getY(i), bone: names[si.getX(i)], r: c.getX(i), g: c.getY(i), b: c.getZ(i), u: uv.getX(i), v: uv.getY(i) });
  }
  return out;
}
function digest(ac) {
  const g = ac.mesh.geometry;
  let h = 0x811c9dc5 >>> 0;
  for (const k of ['position', 'normal', 'uv', 'color', 'skinIndex']) {
    const a = g.attributes[k].array, u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
  }
  for (const i of g.index.array) h = Math.imul(h ^ i, 16777619) >>> 0;
  for (const b of Object.values(ac.bones)) for (const v of [...b.position.toArray(), ...b.userData.axis.toArray()]) h = Math.imul(h ^ Math.round(v * 1e6), 16777619) >>> 0;
  return h;
}

test('the type, and a design on the base\'s airframe, build exactly the model they did', () => {
  const plain = createAircraft();
  const base = createAircraft({ def: designDef(newDesign('a321neo')) });
  assert.equal(designDef(newDesign('a321neo')).geo.AIRFRAME, undefined);
  assert.equal(digest(base), digest(plain));
  assert.equal(base.triangles, plain.triangles);
  assert.notEqual(digest(createAircraft({ def: designDef(design(BIG)) })), digest(plain));
});

for (const [name, af] of [['big', BIG], ['small', SMALL], ['asymmetric', ASYM]]) {
  test(`${name}: the model's extent is the design's (span, nose, tail), every vertex finite`, () => {
    const def = designDef(design(af)), M = def.geo.AIRFRAME, ac = createAircraft({ def }), vs = verts(ac);
    let yL = 0, yR = 0, xN = -1e9, xT = 1e9;
    for (const v of vs) {
      assert.ok(Number.isFinite(v.x + v.y + v.z), 'a vertex is not finite');
      if (v.bone.startsWith('eng') || v.bone.startsWith('fan') || v.bone.startsWith('rev')) continue;
      yL = Math.max(yL, v.y); yR = Math.max(yR, -v.y); xN = Math.max(xN, v.x); xT = Math.min(xT, v.x);
    }
    // the sharklets' tips at the map's tipY
    assert.ok(Math.abs(yL - M.tipY[0]) < 0.05, `left tip ${yL.toFixed(2)} vs ${M.tipY[0].toFixed(2)}`);
    assert.ok(Math.abs(yR - M.tipY[1]) < 0.05, `right tip ${yR.toFixed(2)} vs ${M.tipY[1].toFixed(2)}`);
    assert.ok(Math.abs(xN - (NOSE_X + M.plugFwd)) < 0.01, `nose at ${xN}`);
    // the tail cone's tip (the APU exhaust stands 3 cm behind it) and the tailplane, moved back by the aft plug
    assert.ok(xT <= TAIL_X - M.plugAft + 0.05, `tail at ${xT}`);
    assert.ok(ac.mesh.boundingSphere.radius >= Math.max(NOSE_X + M.plugFwd, ...M.tipY), 'bounding sphere');
  });
}

test('the hinge bones sit on the design\'s surfaces, and every surface still moves', () => {
  const def = designDef(design(BIG)), M = def.geo.AIRFRAME, ac = createAircraft({ def }), B = ac.bones;
  const body = (bn) => { const p = new THREE.Vector3(); bn.getWorldPosition(p); return { x: -p.z, y: -p.x, z: p.y }; };
  // the aileron's hinge from 12.42 m of the base's span: at the design's station, its x from the wing map
  const a = body(B.aileronL), ya = M.wingStation(1, 12.42);
  assert.ok(Math.abs(a.y - ya) < 0.05, `aileron hinge at y ${a.y.toFixed(2)} vs ${ya.toFixed(2)}`);
  const want = M.wing(1, ...foilPoint(wingSec(12.42, 1), 0.75, 0).toArray());
  assert.ok(Math.hypot(a.x - want[0], a.y - want[1], a.z - want[2]) < 0.02, 'aileron hinge on the mapped wing');
  // the elevator's and rudder's hinges through the tail maps
  const e = body(B.elevL), r = body(B.rudder);
  assert.ok(e.x < TAIL_X + 6 - M.plugAft && r.x < -14 - M.plugAft, 'the tail moved with the aft plug');
  // a sweep of every animated surface: each bone turns, or slides, away from rest
  const rest = Object.fromEntries(Object.entries(B).map(([k, b]) => [k, b.quaternion.clone()]));
  ac.update({ flapDeg: 35, slatDeg: 27, gearPos: 0.4, surfaces: { stab: 0.05, elevator: 0.2, rudder: 0.3, aileronL: 0.3, aileronR: -0.3, spoilersL: [1, 1, 1, 1, 1], spoilersR: [1, 1, 1, 1, 1] } }, 0.1);
  for (const k of ['stab', 'elevL', 'elevR', 'rudder', 'aileronL', 'aileronR', 'flapInL', 'flapOutR', 'slatsL', 'slatsR', 'spoiler1L', 'spoiler5R', 'mainLegL', 'noseLeg', 'canoe0L']) {
    assert.ok(B[k].quaternion.angleTo(rest[k]) > 0.01, `${k} did not move`);
  }
  // the hinge axes stay unit and along the span (flaps, ailerons) or the fin (rudder)
  for (const k of ['aileronL', 'flapOutL', 'elevL']) assert.ok(Math.abs(B[k].userData.axis.length() - 1) < 1e-9 && Math.abs(B[k].userData.axis.x) > 0.8, k);
  assert.ok(Math.abs(B.rudder.userData.axis.y) > 0.7, 'rudder axis');
});

test('the fuselage: windows repeated in the plugs, at the base\'s pitch within 6 % (never stretched)', () => {
  for (const af of [BIG, SMALL, { plugFwd: 0.3, plugAft: 0.3 }, { plugFwd: 6, plugAft: 6 }, { plugFwd: -4, plugAft: -4 }, { plugFwd: 1.1, plugAft: -3.9 }]) {
    const ac = createAircraft({ def: designDef(design(af)) }), g = ac.mesh.geometry, vs = verts(ac), ix = g.index.array;
    let seen = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, c] = [vs[ix[t]], vs[ix[t + 1]], vs[ix[t + 2]]];
      if (![a, b, c].every((v) => v.v > 0.5 && (v.bone === 'root' || v.bone === 'nose') && v.r > 0.99 && v.g > 0.99)) continue;
      const [p, q] = a.x !== b.x ? [a, b] : [a, c];
      if (Math.abs(p.x - q.x) < 0.05) continue;
      const k = ((q.u - p.u) / (q.x - p.x)) * LENGTH;   // 1: the base's texture scale; 0: a plain gap
      assert.ok(Math.abs(k) < 1e-6 || Math.abs(k - 1) < 0.061, `texture scale ${k.toFixed(3)} at x ${p.x.toFixed(2)}`);
      seen++;
    }
    assert.ok(seen > 500, `${seen} fuselage triangles`);
  }
});

test('the forward plug: the eye is inside the skin, and the cockpit moves forward with it', () => {
  for (const af of [BIG, SMALL]) {
    const def = designDef(design(af)), M = def.geo.AIRFRAME, E = def.geo.EYES.captain;
    const s = fuseSection(M.bodyXBase(E.x)), dz = E.z - s.zc;
    const r = (E.y / s.hw) ** 2 + (dz / (dz > 0 ? s.up : s.down)) ** 2;
    assert.ok(r < 0.8, `eye at ${r.toFixed(2)} of the section`);
    const ac = createAircraft({ def }), cockpit = new THREE.Group();
    cockpit.name = 'cockpit';
    ac.object.add(cockpit);
    assert.equal(cockpit.position.z, -M.plugFwd);   // model Z = −body x
  }
});

test('the engines\' pylons reach the design\'s wing; the nav lights sit at its tips', () => {
  for (const af of [BIG, SMALL]) {
    const def = designDef(design(af)), M = def.geo.AIRFRAME, ac = createAircraft({ def }), vs = verts(ac);
    for (const n of def.geo.NACELLES) {
      const side = n.y > 0 ? 1 : -1, yb = M.wingBase(side, Math.abs(n.y));
      const lower = M.wing(side, ...foilPoint(wingSec(yb, side), 0.2, -1).toArray())[2];
      const top = Math.max(...vs.filter((v) => v.bone === 'eng' + n.i).map((v) => v.z));
      assert.ok(top > lower, `pylon ${n.i} top ${top.toFixed(2)} below the wing's ${lower.toFixed(2)}`);
    }
    // the red (left) light's centre within 0.4 m of the tip's root, at the map's tip
    const red = vs.filter((v) => v.r > 0.9 && v.g < 0.1 && v.y > 5);
    const cy = red.reduce((s, v) => s + v.y, 0) / red.length;
    assert.ok(Math.abs(cy - M.wingStation(1, 17.3)) < 0.4, `nav light at ${cy.toFixed(2)} vs ${M.wingStation(1, 17.3).toFixed(2)}`);
  }
});
