// Liveries for the parked airliners: Nuclear Airlines (colours from livery.js) and three
// made-up Korean carriers. No real airline's names, colours schemes or logos.
//
// Each livery is a handful of colours plus a tail pattern the shader draws on the fin:
//   0 atom (Nuclear: a lime core, blue orbits, a hazard band at the fin's base)
//   1 sun disc rising out of a lower band
//   2 diagonal sweep
//   3 horizontal bands

import { COLORS } from '../livery.js';

export const LIVERIES = [
  { name: 'Nuclear Airlines', fuse: COLORS.white, belly: COLORS.navy, tail: COLORS.navy, acc1: COLORS.lime, acc2: COLORS.blue, engine: COLORS.navy, pattern: 0 },
  { name: 'Hanbit Air', fuse: '#f4f2ee', belly: '#f4f2ee', tail: '#e2661c', acc1: '#ffd34a', acc2: '#b8321c', engine: '#e9e6e0', pattern: 1 },
  { name: 'Jeju Breeze', fuse: '#f2f6f6', belly: '#cfe3e4', tail: '#0f8f8c', acc1: '#7fe6d4', acc2: '#f59a2a', engine: '#0f8f8c', pattern: 2 },
  { name: 'Gyeongin Express', fuse: '#e6e9ee', belly: '#9aa3b2', tail: '#5b2a86', acc1: '#e4336b', acc2: '#c9b6e6', engine: '#d4d8de', pattern: 3 },
];

// '#rrggbb' → linear-light [r, g, b] (the shaders light in linear space).
export function linearRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
}
