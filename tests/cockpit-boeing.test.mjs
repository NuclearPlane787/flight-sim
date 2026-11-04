// The Boeing cockpits' geometry, with no browser: each interior stays inside its nose, and the view out
// is the type's document's, from both seats, measured on the real shell. The numbers: D6-58333 Rev Q
// §4.4.1 (p. 4-6) for the 787-9, D6-58329-2 Rev G §4.4 (p. 4-6) for the 777-300ER.
//   node --test tests/cockpit-boeing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createBoeingCockpit } from '../src/cockpit-boeing.js';
import { boeingWindowOutlines } from '../src/cockpit-windows-boeing.js';
import { fuselageShape } from '../src/widebody-shape.js';
import { B787_9, B777_300ER } from '../src/widebody-specs.js';
import * as d787 from '../src/sim/b787-9.js';
import * as d777 from '../src/sim/b777-300er.js';

const DEG = Math.PI / 180;
const SHELL_OFF = 0.03;   // cockpit-boeing.js's

// What each document gives, from the eye. noseToEye and the rest are the documents' own figures.
//   up, down     through No. 1 in the vertical plane through the eye; abeamUp, abeamDown: through the
//                side window with the head turned; backTo: how far round the side window goes
//   windows      a side; displays: the type's; hud: whether it has head-up displays
//   sidePost     [earliest start, latest end, narrowest, widest] of the post behind No. 1, at eye level
const TYPES = [
  {
    spec: B787_9, data: d787, noseToEye: 2.64, up: 25.4, down: 21.0, abeamUp: 31, abeamDown: 27, backTo: 121.5,
    windows: 2, displays: 5, hud: true, detents: 10, sidePost: [44, 58, 2, 12],
  },
  {
    // 3.63 m ahead of the nose gear (p. 4-6), which is 5.89 m from the nose (p. 2-4).
    spec: B777_300ER, data: d777, noseToEye: 5.89 - 3.63, up: 32, down: 21, abeamUp: 31, abeamDown: 27, backTo: 125,
    windows: 3, displays: 6, hud: false, detents: 7, sidePost: [36, 72, 8, 32], sillZ: 0.47,
  },
];

for (const T of TYPES) suite(T);

function suite(T) {
const id = T.spec.id;
const spec = { ...T.spec, flapLever: T.data.FLAP_LEVER };
const shape = fuselageShape(spec);
const G = spec.geo, EYE = G.EYES.captain;
const cockpit = createBoeingCockpit(spec);
const outlines = boeingWindowOutlines(spec, shape);
const allWindows = [...outlines, ...outlines.map((w) => w.map(([x, th]) => [x, 180 - th]))];

// Model frame to body frame.
const body = (v) => ({ x: -v.z, y: -v.x, z: v.y });
// > 1 outside the section, here the shell's: the outer skin less SHELL_OFF.
function radial(p, off = SHELL_OFF) {
  const s = shape.fuseSection(p.x);
  const hh = (p.z >= s.zc ? s.up : s.down) - off;
  return Math.hypot(p.y / (s.hw - off), (p.z - s.zc) / hh);
}
function interiorMeshes() {
  const out = [];
  cockpit.object.updateMatrixWorld(true);
  cockpit.object.traverse((o) => { if (o.isMesh && o.name !== 'cockpit-shell') out.push(o); });
  return out;
}
function worst() {
  let max = 0, at = null;
  const v = new THREE.Vector3();
  for (const m of interiorMeshes()) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const p = body(v), r = radial(p);
      if (r > max) { max = r; at = p; }
    }
  }
  return { max, at };
}
// Rays out of the eye, through the interior (three's Raycaster, on the real meshes).
const dirOf = (az, el) => ({ x: Math.cos(el * DEG) * Math.cos(az * DEG), y: Math.cos(el * DEG) * Math.sin(az * DEG), z: Math.sin(el * DEG) });
const toM = (v) => new THREE.Vector3(-v.y, v.z, -v.x);
const rc = new THREE.Raycaster();
const blocked = (eye, az, el) => {
  cockpit.object.updateMatrixWorld(true);
  rc.set(toM(eye), toM(dirOf(az, el)).normalize());
  rc.near = 0; rc.far = 6;
  return rc.intersectObjects(interiorMeshes(), false).length > 0;
};
// Which window the ray goes through (−1: none), read off the real shell: its uv where the ray meets
// it, in the outlines' terms. So this measures what the seat sees, not what the outlines say.
const shell = cockpit.object.getObjectByName('cockpit-shell');
function inPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
}
function glassAt(eye, az, el) {
  shell.updateMatrixWorld(true);
  rc.set(toM(eye), toM(dirOf(az, el)).normalize());
  rc.near = 0; rc.far = 9;
  const hit = rc.intersectObject(shell, false)[0];
  if (!hit) return -1;
  const [x0, x1] = shell.userData.cutX, x = x0 + hit.uv.x * (x1 - x0), th = hit.uv.y * 180;
  return allWindows.findIndex((W) => inPoly(W, x, th));
}
const seen = (eye, az, el) => glassAt(eye, az, el) >= 0 && !blocked(eye, az, el);
// The clear span of elevations at an azimuth: [lowest, highest] through glass past the interior.
function span(eye, az) {
  let lo = null, hi = null;
  for (let el = -50; el <= 60; el += 0.1) if (seen(eye, az, el)) { if (lo === null) lo = el; hi = el; }
  return [lo, hi];
}

test(`${id}: the interior stays inside the shell, with every control at its limits`, () => {
  // The worst corner, at rest and with the levers, columns and wheels at each end of their travel.
  const cases = [
    [{}, null],
    [{ thrustLever: 1, speedbrake: 1 }, { flapLever: spec.flapLever.length - 1, speedbrake: 1, pitch: 1, roll: 1, gearDown: false }],
    [{ thrustLever: -1, speedbrake: 0 }, { flapLever: 0, speedbrake: 0, pitch: -1, roll: -1, gearDown: true }],
  ];
  for (const [s, c] of cases) {
    cockpit.update(s, c);
    const { max, at } = worst();
    assert.ok(max < 1, `worst corner at ${max.toFixed(3)} of the shell: ${JSON.stringify(at)}`);
  }
  cockpit.update();
});

test(`${id}: both seats are at the geometry's eye points, and those are the document's`, () => {
  assert.equal(G.EYES.fo.x, G.EYES.captain.x);
  assert.equal(G.EYES.fo.y, -G.EYES.captain.y);
  assert.ok(Math.abs(G.EYES.captain.y - 0.53) < 0.005);
  assert.ok(Math.abs(shape.noseX - G.EYES.captain.x - T.noseToEye) < 0.005);
  assert.ok(radial(G.EYES.captain) < 0.9, 'the eye is well inside the nose');
});

for (const [name, eye, mirror] of [['Captain', G.EYES.captain, 1], ['First Officer', G.EYES.fo, -1]]) {
  test(`${id} ${name}: straight ahead, ${T.down}° down and ${T.up}° up through No. 1, within half a degree`, () => {
    const [lo, hi] = span(eye, 0);
    console.log(`  ${id} ${name}: ${lo.toFixed(1)}° to ${hi.toFixed(1)}° straight ahead`);
    assert.ok(Math.abs(lo + T.down) < 0.5, `down ${lo}`);
    assert.ok(Math.abs(hi - T.up) < 0.5, `up ${hi}`);
  });
  test(`${id} ${name}: nothing inside rises over the sill anywhere across No. 1`, () => {
    // The whole of his own front window down to its sill, as far as the side post.
    for (let az = -24; az <= 44; az += 4) {
      const a = az * mirror;
      let el = -40;
      while (glassAt(eye, a, el) < 0 && el < 0) el += 0.1;   // the sill at this azimuth
      assert.ok(!blocked(eye, a, el + 0.3), `az ${az}: the sill at ${el.toFixed(1)}° is hidden`);
    }
  });
  test(`${id} ${name}: abeam, ${T.abeamUp}° up and ${T.abeamDown}° down, and back to ${T.backTo}°, with the head turned`, () => {
    // The document's note 4: the head turned about a point 0.08 m aft of the eye. The cut-outs are
    // solved from the eye itself, so a degree of parallax against the shell is allowed here.
    const turned = (az) => ({ x: eye.x - 0.08 + 0.08 * Math.cos(az * DEG), y: eye.y + mirror * 0.08 * Math.sin(az * DEG), z: eye.z });
    const [lo, hi] = span(turned(90), 90 * mirror);
    console.log(`  ${id} ${name}: ${lo.toFixed(1)}° to ${hi.toFixed(1)}° abeam`);
    assert.ok(Math.abs(lo + T.abeamDown) < 1, `down ${lo}`);
    assert.ok(Math.abs(hi - T.abeamUp) < 1, `up ${hi}`);
    let back = 0;
    for (let az = 100; az < 140; az += 0.1) if (seen(turned(az), az * mirror, 2)) back = az;
    console.log(`  ${id} ${name}: back to ${back.toFixed(1)}°`);
    assert.ok(Math.abs(back - T.backTo) < 1.5, `back to ${back}`);
  });
  test(`${id} ${name}: the view ahead has its posts where the real ones are`, () => {
    // The side post, a clear gap of a few degrees between Nos. 1 and 2, at eye level.
    let from = null, to = null;
    for (let az = 30; az < 70; az += 0.1) if (glassAt(eye, az * mirror, 2) < 0) { if (from === null) from = az; to = az; }
    const [p0, p1, w0, w1] = T.sidePost;
    assert.ok(from > p0 && to < p1 && to - from > w0 && to - from < w1, `post from ${from} to ${to}`);
    // The centre post: narrower seen from the nearer seat than the side post, on the far side of the nose.
    let a = null, b = null;
    for (let az = -60; az < -10; az += 0.1) if (glassAt(eye, az * mirror, 2) < 0) { if (a === null) a = az; b = az; }
    assert.ok(b - a < 12 && a < -20, `centre post from ${a} to ${b}`);
  });
}

test(`${id}: the nose never rises into the ${T.down}° line ahead of the sill`, () => {
  // Forward of where that line leaves the skin.
  let start = EYE.x + 0.5;
  const skinZ = (x) => { const s = shape.fuseSection(x); return s.zc + s.up * Math.sqrt(1 - (EYE.y / s.hw) ** 2); };
  while (Math.atan2(skinZ(start) - EYE.z, start - EYE.x) / DEG > -T.down) start += 0.005;
  for (let x = start + 0.01; x < shape.noseX - 0.02; x += 0.01) {
    const s = shape.fuseSection(x);
    if (s.hw <= EYE.y) break;
    const z = s.zc + s.up * Math.sqrt(1 - (EYE.y / s.hw) ** 2);
    assert.ok(Math.atan2(z - EYE.z, x - EYE.x) / DEG < -T.down + 0.1, `at x ${x}`);
  }
});

// The 777's eye height is a fit, [EST] in its geometry module: the document's angles against p. 2-4's
// drawn windows on this nose. If the nose moves, this says the fit has moved with it.
if (T.sillZ !== undefined) test(`${id}: No. 1's sill is level where the document draws it, at z ${T.sillZ}, within 0.1 m`, () => {
  const W = outlines[0], n = W.length / 4;    // four corners, the same number of samples on each edge
  for (const [x, th] of [W[0], W[3 * n]]) {
    const z = shape.fusePoint(x, th).z;
    assert.ok(Math.abs(z - T.sillZ) < 0.1, `sill corner at z ${z.toFixed(2)}`);
  }
});

test(`${id}: the moving parts move`, () => {
  const pose = (m) => m.quaternion.toArray().join();
  const parts = [];
  cockpit.object.traverse((o) => { if (o.isMesh && !o.name) parts.push(o); });
  const rest = (cockpit.update({ thrustLever: 0, speedbrake: 0 }, { flapLever: 0, speedbrake: 0, pitch: 0, roll: 0, gearDown: true }), parts.map(pose));
  cockpit.update({ thrustLever: 1, speedbrake: 1 }, { flapLever: spec.flapLever.length - 1, speedbrake: 1, pitch: 1, roll: 1, gearDown: false });
  const moved = parts.map(pose);
  const count = rest.filter((r, i) => r !== moved[i]).length;
  // Thrust, flap, speedbrake, gear, two columns and two wheels; the reverse levers only below idle.
  assert.equal(count, 8);
  cockpit.update({ thrustLever: -1 }, { flapLever: 0, pitch: 0, roll: 0, gearDown: true });
  assert.notEqual(parts.map(pose).join(), rest.join());
  cockpit.update();
});

test(`${id}: the type's flap detents, displays and windows, and the build stays cheap`, () => {
  assert.equal(spec.flapLever.length, T.detents);
  assert.equal(outlines.length, T.windows);
  assert.equal(cockpit.object.getObjectByName('cockpit-screens').userData.displays, T.displays);
  // Every detent gives the lever its own angle, from UP forward to the last aft.
  const flapPose = (i) => { cockpit.update({}, { flapLever: i, pitch: 0, roll: 0, speedbrake: 0, gearDown: true }); return cockpit.object.children.filter((o) => o.isMesh && !o.name).map((m) => m.quaternion.toArray().join()).join('|'); };
  assert.equal(new Set(spec.flapLever.map((_, i) => flapPose(i))).size, T.detents);
  cockpit.update();
  let tris = 0;
  cockpit.object.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  // cockpit.js's is 6,436.
  assert.ok(tris < 9000, `${tris} triangles`);
});
}
