// The widebodies' engines, for the synth (v0.3.0): pure data, the same shape as LEAP_1A at the top
// of synth.js, which explains each field. The registry's entries take these as `sound`.
//
// Sources:
//   [TCDS-GENX] EASA TCDS IM.E.102 Issue 12, GEnx series (25 Feb 2026), section 2 "Speed Limits" and
//               6 "Ratings" (reference/docs/easa-tcds-im-e-102-genx.pdf). It validates FAA E00078NE.
//   [TCDS-GE90] EASA TCDS IM.E.002 Issue 05, GE90 series (5 Mar 2023), "Speed Limits", thrust table
//               and Note 5 (reference/docs/easa-tcds-im-e-002-ge90.pdf). It validates FAA E00049EN.
//   [PUB]  GE's public figures, as quoted in https://en.wikipedia.org/wiki/General_Electric_GEnx
//          (18 blades, 111 in) and https://en.wikipedia.org/wiki/General_Electric_GE90 (22 blades,
//          128 in), and https://www.aviationpros.com/home/article/10372016/the-genx-engine (18 vs 22).
//   [EST]  An estimate: the reasoning is given below or next to the number.
//
// How the estimates were reached, from the LEAP-1A's tuned values (fan 78 in = 1.98 m [PUB]; 100 %
// N1 = 3,856 rpm; take-off 143 kN), so that all three engines come from one rule:
//
// The buzz-saw (buzzFrom, buzzTo). It's a problem from a fan tip relative Mach of about 1 to 1.3, and
// strongest around 1.2 (https://patents.google.com/patent/US9957840, and its application,
// https://patents.justia.com/patent/20150337684). Tip speed U = π D N. With an inlet axial Mach of about 0.55 and a local speed of
// sound of about 330 m/s (the axial flow is 180 m/s), relative Mach 1 needs U ≈ 280–290 m/s. The
// LEAP-1A's 0.72–0.95 of 100 % N1 at U(100 %) = 400 m/s is 288–380 m/s, which agrees, so each engine
// here takes those same two tip speeds:
//   GEnx-1B: U(100 %) = π × 2.82 × 2560/60 = 378 m/s → 288/378 = 0.76, 380/378 = 1.00.
//     So it starts later and doesn't reach full strength at take-off.
//   GE90-115B: U(100 %) = π × 3.25 × 2355/60 = 401 m/s → 288/401 = 0.72, 380/401 = 0.95.
//     Its tips are as fast as the LEAP-1A's: a real buzz-saw, but on a far slower shaft (39 Hz per
//     100 %, the LEAP-1A's 64 Hz), so it's the deep rasp the type is known for.
//
// The jet's roar (jetHz). A jet's spectrum peaks at a fixed Strouhal number: f ∝ Vj / D. With
// T ≈ ρ A Vj², Vj ∝ √T / D, so f ∝ √T / D². Against the LEAP-1A's √143 / 1.98²:
//   GEnx-1B (345 kN, D 2.82 m): 0.77; GE90-115B (514 kN, D 3.25 m): 0.70. Hence jetHz.
// The combustion rumble (coreHz) goes down by the same ratios.
//
// Levels (gain). Lighthill's V⁸ law would make a jet's power ∝ A Vj⁸ ∝ T⁴ / D⁶: per engine +5 dB
// (GEnx-1B) and +9 dB (GE90-115B) over the LEAP-1A, before the GEnx's chevrons take off about 3 dB
// (NASA: https://www.nasa.gov/centers-and-facilities/glenn/nasas-chevron-technology-quiets-the-skies/).
// The game doesn't follow that: the three share one master volume, so the differences are compressed
// on purpose, to the order they come in, within a couple of dB of the A321's. Tuned by measurement,
// tests/audio-render.mjs --type.
//
// The beat (split). The two engines' fan tones beat at the difference of their frequencies. On a
// lower tone the LEAP-1A's split would beat far more slowly (0.24 Hz at the GEnx's idle: a level
// that sinks and swells over 4 s, by ear a fault, and the spool-up check saw it), so each split is
// scaled to beat as often as the LEAP-1A's does: 0.15 % × its blade rate per % / this one's. [EST]
//
// The core (n2Base, n2Slope, coreOrder). Neither TCDS gives N2 against N1, so [EST]: take-off N2 at the
// same fraction of its red line as the LEAP-1A's model (0.846), and ground idle at about 66 % (GE90's
// minimum N2 in flight in icing is 65 %, 6,066 rpm, Note 5). Same order on the shaft as the LEAP-1A's.

// GE GEnx-1B: a slow 2.82 m fan of swept composite blades, with chevrons. The fan's tone is low
// (18 blades × 0.427 Hz per %: 161 Hz at idle, 745 Hz at take-off; the A321's 1.1 kHz), its buzz-saw
// and jet the quietest of the three.
export const GENX_1B = {
  n1Hz: 2560 / 100 / 60,        // [TCDS-GENX] 100 % N1 = 2,560 rpm (the -2B's is 2,835)
  n2Hz: 11377 / 100 / 60,       // [TCDS-GENX] 100 % N2 = 11,377 rpm
  fanBlades: 18,                // [PUB]
  // [EST] idle 66 %, take-off 100 % (red line 118 % [TCDS-GENX] × 0.846).
  n2Base: 56.6, n2Slope: 0.445, coreOrder: 12,
  buzzFrom: 0.76, buzzTo: 1.00, // [EST] the tip speeds above
  jetHz: [123, 539],            // [EST] 0.77 × the LEAP-1A's
  coreHz: [85, 154],            // [EST] 0.77 × the LEAP-1A's
  split: 1.00226,               // [EST] the same beat as the LEAP-1A's
  // [EST] Swept blades tame the shocks, chevrons the jet; the fan's larger and slower.
  gain: { clunk: 1.8, fan: 1.0, buzz: 0.6, whine: 0.85, fanNoise: 1.0, jet: 1.12, core: 0.95 },
};

// GE GE90-115B: the largest fan here (3.25 m), 22 wide-chord composite blades, no chevrons, and the
// most thrust. The shaft's the slowest, the blades many, so the fan's tone is above the GEnx's
// (22 × 0.393 Hz per %: 181 Hz at idle, 837 Hz at take-off) while the buzz-saw and the rumble lie below it.
export const GE90_115B = {
  n1Hz: 2355 / 100 / 60,        // [TCDS-GE90] 100 % N1 = 2,355.0 rpm (-110B1, -113B, -115B)
  n2Hz: 9332 / 100 / 60,        // [TCDS-GE90] 100 % N2 = 9,332.0 rpm
  fanBlades: 22,                // [PUB]
  // [EST] idle 66 %, take-off 102 % (red line 121 % [TCDS-GE90] × 0.846).
  n2Base: 56, n2Slope: 0.475, coreOrder: 12,
  buzzFrom: 0.72, buzzTo: 0.95, // [EST] the tip speeds above
  jetHz: [112, 490],            // [EST] 0.70 × the LEAP-1A's
  coreHz: [77, 140],            // [EST] 0.70 × the LEAP-1A's
  split: 1.00201,               // [EST] the same beat as the LEAP-1A's
  // [EST] The buzz and the rumble are what it's known for; no chevrons, so the most jet.
  gain: { clunk: 1.8, fan: 1.0, buzz: 1.1, whine: 0.8, fanNoise: 1.1, jet: 1.2, core: 1.2 },
};

// `clunk: 1.8` (+5 dB, the reverser doors and the gear locking) [EST]: a widebody's cowls and gear are
// far heavier, and at the LEAP-1A's level the knock only rose about 4 dB over the rollout's noise
// (from 1.5 to 6.6 dB over 16 renders), so it was barely there.
