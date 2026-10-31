// Water shading: the sea and inland water (the Han River, lakes, reservoirs).
//
// There's no separate sea mesh: the terrain clipmap already covers the map out past the
// horizon, curved like the Earth, and its heights are clamped at 0 m, so over the sea it
// *is* the flat sea surface. The terrain shader calls waterShade() wherever the distance
// fields say water (the sea from R and the 10 m coast patches, inland water from G).
// That avoids any depth fighting between a sea plane and the shore. Inland water is
// drawn flat at the data's own level (Copernicus measures the water surface).

// GLSL. Needs UNIFORMS_GLSL, NOISE_GLSL and ATMOS_GLSL.
export const WATER_GLSL = /* glsl */ `
// Small moving ripples as a normal (scene frame), fading with distance.
vec3 rippleNormal(vec2 m, float dist) {
  float fade = 1.0 - smoothstep(300.0, 6000.0, dist);
  vec2 g = vec2(0.0);
  if (fade > 0.0) {
    float t = uTime;
    vec2 p = m * 0.35;
    float e = 0.15;
    float n0 = vnoise(p + vec2(t * 0.30, t * 0.21)) + 0.5 * vnoise(p * 2.7 - vec2(t * 0.45, -t * 0.1));
    float nx = vnoise(p + vec2(e, 0.0) + vec2(t * 0.30, t * 0.21)) + 0.5 * vnoise((p + vec2(e, 0.0)) * 2.7 - vec2(t * 0.45, -t * 0.1));
    float ny = vnoise(p + vec2(0.0, e) + vec2(t * 0.30, t * 0.21)) + 0.5 * vnoise((p + vec2(0.0, e)) * 2.7 - vec2(t * 0.45, -t * 0.1));
    g = vec2(nx - n0, ny - n0) / e * 0.06 * fade;
  }
  // Larger swell, cheap, visible further out.
  float fade2 = 1.0 - smoothstep(1500.0, 12000.0, dist);
  if (fade2 > 0.0) {
    vec2 q = m * 0.02 + vec2(uTime * 0.03, uTime * 0.02);
    float s0 = vnoise(q), sx = vnoise(q + vec2(0.05, 0.0)), sy = vnoise(q + vec2(0.0, 0.05));
    g += vec2(sx - s0, sy - s0) / 0.05 * 0.02 * fade2;
  }
  // map (x east, y north) -> scene (x, z = -y)
  return normalize(vec3(-g.x, 1.0, g.y));
}

// Shade a water surface point.
//   m: map position, rel: offset from the camera (scene), depth: 0 at the shore .. 1 deep
//   inland: 1 for rivers and lakes (greener, calmer)
vec3 waterShade(vec2 m, vec3 rel, float depth, float inland) {
  float dist = length(rel);
  vec3 v = rel / max(dist, 1e-3);
  vec3 n = rippleNormal(m, dist);
  n = normalize(mix(n, vec3(0, 1, 0), 0.4 * inland));
  vec3 r = reflect(v, n);
  r.y = abs(r.y);
  float cosv = max(dot(-v, n), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  vec3 deep = mix(vec3(0.010, 0.040, 0.075), vec3(0.020, 0.050, 0.045), inland);
  vec3 shallow = mix(vec3(0.030, 0.100, 0.105), vec3(0.045, 0.075, 0.055), inland);
  vec3 body = mix(shallow, deep, depth) * (uSkyAmb * 1.4 + uSunColor * 0.6 * max(uSunDir.y, 0.0));
  vec3 refl = skyBase(r);
  vec3 col = mix(body, refl, fres);
  // Sun glint: sharp up close, broad and soft far away (the ripples blur together).
  float rough = mix(900.0, 90.0, smoothstep(500.0, 40000.0, dist));
  float s = pow(max(dot(r, uSunDir), 0.0), rough);
  col += uSunColor * s * mix(6.0, 1.2, smoothstep(500.0, 40000.0, dist)) * (1.0 - 0.5 * inland);
  return col;
}
`;
