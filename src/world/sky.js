// The sky: a clear afternoon with a fixed sun, the haze (aerial perspective) every world
// shader applies, the sun and hemisphere lights, and scene.fog for three's own materials.

import * as THREE from '../../vendor/three.module.js';

// The fixed afternoon sun: azimuth 230° true (south-west), 35° up.
export const SUN_AZIMUTH_DEG = 230;
export const SUN_ELEVATION_DEG = 35;

// Haze: extinction at sea level (1/m) and its scale height (m). About 60 km of visibility
// at sea level, clearer higher up: ground well visible ~100+ km from cruise.
export const HAZE_SIGMA0 = 2.6e-5;
export const HAZE_HEIGHT = 1500;

// Scene frame: X east, Y up, Z south (−map y).
export function sunDirection(out = new THREE.Vector3()) {
  const az = SUN_AZIMUTH_DEG * Math.PI / 180, el = SUN_ELEVATION_DEG * Math.PI / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// GLSL: sky colour by direction, the haze colour, and applyHaze(). Needs UNIFORMS_GLSL.
export const ATMOS_GLSL = /* glsl */ `
const float HAZE_SIGMA0 = ${HAZE_SIGMA0.toExponential()};
const float HAZE_H = ${HAZE_HEIGHT.toFixed(1)};

// Below this elevation (rad) the view ray meets the Earth: the horizon dips as you climb.
float horizonDip() { return -sqrt(2.0 * max(uCamAlt, 1.0) / 6371000.0); }

vec3 skyBase(vec3 dir) {
  float alt = clamp(uCamAlt / 12000.0, 0.0, 1.0);
  vec3 zenith = mix(vec3(0.075, 0.20, 0.52), vec3(0.035, 0.11, 0.38), alt);
  vec3 horizon = mix(vec3(0.58, 0.68, 0.82), vec3(0.52, 0.64, 0.82), alt);
  float e = dir.y - horizonDip();
  float t = pow(1.0 - clamp(e, 0.0, 1.0), mix(5.0, 9.0, alt));
  vec3 c = mix(zenith, horizon, t);
  // Sun-ward brightening (Mie forward scattering) and a gentle aureole.
  float mu = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (0.10 * pow(mu, 6.0) + 0.22 * pow(mu, 48.0)) * (0.5 + 0.5 * t);
  return c;
}

// Colour the haze tends to along a view direction (no sun disc).
vec3 hazeColor(vec3 dir) {
  vec3 d = dir;
  d.y = max(d.y, horizonDip());
  return skyBase(d);
}

vec3 skyColor(vec3 dir) {
  vec3 c = skyBase(dir);
  float mu = dot(dir, uSunDir);
  c += uSunColor * 30.0 * smoothstep(0.99994, 0.99997, mu);   // the disc, ~0.5°
  if (dir.y < horizonDip()) c = hazeColor(dir);
  return c;
}

// Exponential height fog along the ray from the camera to a point at offset rel (scene).
vec3 applyHaze(vec3 col, vec3 rel) {
  float dist = length(rel);
  float h0 = uCamAlt, dh = rel.y;
  float od;
  float e0 = exp(-max(h0, 0.0) / HAZE_H);
  if (abs(dh) < 1.0) od = HAZE_SIGMA0 * e0 * dist;
  else od = HAZE_SIGMA0 * HAZE_H * dist / dh * (e0 - exp(-max(h0 + dh, 0.0) / HAZE_H));
  vec3 ext = exp(-od * vec3(0.85, 1.0, 1.2));
  // A clear autumn day: the haze is blue-grey, a little deeper than the white-ish horizon sky.
  vec3 hc = mix(hazeColor(rel / max(dist, 1e-3)), vec3(0.36, 0.46, 0.62), 0.35);
  return col * ext + hc * (1.0 - ext);
}
`;

// The sky dome: a sphere around the camera, drawn first, without depth.
export function createSky(scene, uniforms, chunks) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 wp = vec4(position * 50000.0 + cameraPosition, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${chunks.UNIFORMS_GLSL}
      ${ATMOS_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  scene.add(mesh);

  const sun = sunDirection();
  const sunLight = new THREE.DirectionalLight(0xfff1e0, 3.0);
  sunLight.position.copy(sun).multiplyScalar(1000);
  sunLight.target.position.set(0, 0, 0);
  sunLight.name = 'sun';
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0xa9c4e8, 0x5a5444, 1.1);
  hemi.name = 'skylight';
  scene.add(hemi);

  // scene.fog for three's own materials (the aircraft): exp2 matched to the haze near
  // the camera, in the horizontal haze colour.
  const fog = new THREE.FogExp2(0xa8b8cc, 1e-5);
  scene.fog = fog;

  uniforms.uSunDir.value.copy(sun);
  uniforms.uSunColor.value.setRGB(1.0, 0.94, 0.86);
  uniforms.uSkyAmb.value.setRGB(0.38, 0.46, 0.58);

  return {
    mesh, sunLight, hemi, fog, sun,
    update(camera, camAlt) {
      // Keep the sun light's shadowless direction fixed relative to the camera.
      sunLight.position.copy(camera.position).addScaledVector(sun, 1000);
      sunLight.target.position.copy(camera.position);
      // FogExp2: 1 - exp(-(density d)^2). Match the haze's optical depth at 3 km.
      const sigma = HAZE_SIGMA0 * Math.exp(-Math.max(camAlt, 0) / HAZE_HEIGHT);
      fog.density = Math.sqrt(sigma * 3000) / 3000;
      // Horizon haze colour in linear RGB (as skyBase gives near the horizon).
      const a = Math.min(Math.max(camAlt / 12000, 0), 1);
      fog.color.setRGB(0.58 - 0.06 * a, 0.68 - 0.04 * a, 0.82);
    },
  };
}
