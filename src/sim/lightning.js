// v0.4.0: when and where lightning strikes. Seeded and stateless, like the rest of the weather: the same
// settings, the same time window and the same observer's area give the same flashes, on any machine.
// No DOM and no three.js. The picture (src/world/clouds.js) and the sound (src/audio/synth.js) both read it.

const BIN_S = 0.5;            // s: the time lattice
const TILE_M = 40000;         // m: strikes are placed in tiles around the observer, so there are always some nearby
const MAX_PER_S = 0.45;       // flashes a second at lightning = 1

function hash(seed, a, b, salt) {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The flashes with t0 <= t < t1, oldest first: { t, x, y, ground, power }. (x, y) is on the map, ground is true for a
// bolt to the ground (false: inside the cloud), power 0..1. (cx, cy) is the observer on the map. Allocation is
// small: call it once a frame with a window of one frame.
export function strikesBetween(settings, t0, t1, cx, cy, out = []) {
  out.length = 0;
  if (!settings || !(settings.lightning > 0) || !(t1 > t0)) return out;
  const seed = settings.seed | 0, p = Math.min(1, settings.lightning * MAX_PER_S * BIN_S);
  const tx = Math.floor(cx / TILE_M), ty = Math.floor(cy / TILE_M);
  for (let bin = Math.floor(t0 / BIN_S), end = Math.floor(t1 / BIN_S); bin <= end; bin++) {
    if (hash(seed, bin, 0, 1) >= p) continue;
    const t = (bin + hash(seed, bin, 0, 2)) * BIN_S;
    if (t < t0 || t >= t1) continue;
    const ix = tx + Math.floor(hash(seed, bin, 0, 3) * 3) - 1, iy = ty + Math.floor(hash(seed, bin, 0, 4) * 3) - 1;
    out.push({
      t,
      x: (ix + hash(seed, bin, ix, 5)) * TILE_M,
      y: (iy + hash(seed, bin, iy, 6)) * TILE_M,
      ground: hash(seed, bin, 0, 7) < 0.35,
      power: 0.4 + 0.6 * hash(seed, bin, 0, 8),
    });
  }
  return out;
}
