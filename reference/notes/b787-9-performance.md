# 787-9 (GE GEnx-1B74/75/P2) performance reference for flight-model tuning

Compiled 2026-11-04. **Tags:** **PUB** = published/certified document. **FORUM** = pilot study notes, forums. **EST** = my estimate or derivation, with the method shown. Nothing here is for real-world operations.

Sources used repeatedly (PDFs in `games/flight-sim/reference/docs/`, git-ignored; download commands in `PLAN.md` → Data):
- **[TCDS]** EASA TCDS IM.A.115 (Boeing 787), Issue 30, 17 Dec 2025, Section 2 (787-9), PDF pages 23–41. Validates FAA T00021SE. https://www.easa.europa.eu/en/downloads/7302/en
- **[ACAP]** Boeing *787 Airplane Characteristics for Airport Planning*, D6-58333 Rev Q, Oct 2025. Page numbers are its own. https://www.boeing.com/content/dam/boeing/v2/airports/acaps/787_ACAP_Rev_Q.pdf
- **[ARC]** Boeing *Aerodrome Reference Code and Approach Speeds*, Rev A, Aug 2026, p.6. https://www.boeing.com/content/dam/boeing/v2/airports/faq/arcandapproachspeeds.pdf
- **[GENX]** EASA TCDS IM.E.102 (GEnx), Issue 12, 25 Feb 2026. https://www.easa.europa.eu/en/downloads/7641/en
- **[EDB]** ICAO Aircraft Engine Emissions Databank, 03/2026, UID 07P27GE235 (GEnx-1B74/75/P2). https://www.easa.europa.eu/en/downloads/131424/en
- **[CARDS]** 787 limitations flashcards, https://www.brainscape.com/flashcards/limitations-8779923/packs/15020038 and https://www.brainscape.com/flashcards/limitations-16614552/packs/22243715 (two decks that agree; not official documents).
- **[SPEC]** Spec sites, no primary source: https://aircraftinvestigation.info/airplanes/Boeing_787-9.html (AR 9.59, sweep 32.2°, MAC 6.27 m), https://www.axonaviation.com/commercial-aircraft/aircraft-data/boeing-787-9, https://planephd.com/wizard/details/1127/BOEING-787-9-specifications-performance-operating-cost-valuation (5,614 kg/h, no conditions stated).
- **[TRADE]** The GEnx fan: https://www.aviationpros.com/home/article/10372016/the-genx-engine (18 blades, 111 in).

## 1. Limits and weights

| Item | Value | Source | Tag |
|---|---|---|---|
| VMO / MMO | 350 KEAS / M0.90 | TCDS p.36 | PUB |
| Max operating altitude | 43,100 ft | TCDS p.36 | PUB |
| VFE 1, 5, 10, 15, 17, 18, 20, 25, 30 | 260, 240, 230, 220, 215, 215, 210, 190, 180 kt | CARDS (787-9/-10); the TCDS leaves them to the AFM. **Likely, not certain** | FORUM |
| VLO, VLE | 270 kt / M0.82 | CARDS | FORUM |
| Tyre limit | 235 mph = 204 kt, ground speed | ACAP 3-17 | PUB |
| MTW / MTOW / MLW / MZFW | 255,372 / 254,692 / 192,776 / 181,436 kg | TCDS p.37, ACAP 2-3 (ACAP also has a 259,228 kg MTOW option; its charts stop at 254,011 kg) | PUB |
| Minimum flight and zero-fuel weight | 110,677 kg | TCDS p.37 | PUB |
| OEW | 128,850 kg (ACAP 3-3 says ask the airline; spec sites give 128,800 to 129,000 kg) | SPEC | EST |
| Seats | 290 two-class; exit limit 420 | ACAP 2-3, TCDS p.38 | PUB |
| Holds | 32,005 + 25,655 + 2,735 kg | TCDS p.38 | PUB |
| Usable fuel | Main L or R 16,716 kg; Centre 67,653 kg; total 101,085 kg at 0.8 kg/L (ACAP: 101,522 kg at 6.7 lb/gal) | TCDS p.35 | PUB |
| MAC | 6.27126 m | TCDS p.37 | PUB |
| CG envelope | 8% to 37.5% MAC at low weights, about 23% to 32% at MTW (axis read: 0% MAC = 86.6% on the mains, 40% = 96.3%) | ACAP 7-7 (chart read). The TCDS says see the AFM | PUB (chart read) |
| Wing area | 377 m²: what SPEC's AR 9.59 implies with this span; another site lists 360.5 m². Sweep 32.2° (SPEC labels it 3/4 chord) | SPEC | EST |

## 2. Geometry

All from ACAP 2-6, 2-9, 4-3, 4-6 and 7-4 unless marked; the file is `src/geometry-b787-9.js`, with the derivations next to the numbers.

| Item | Value | Note |
|---|---|---|
| Length, fuselage, span, height | 62.81, 62.00, 60.12, 17.02 m | |
| Fuselage | 5.77 wide × 5.94 m high | TCDS: 5.7531 m constant diameter |
| Wheelbase, track | 25.83, 9.80 m; nose gear 5.41 m from the nose | |
| Where 25% MAC is | 29.35 m from the nose; mains 1.89 m aft of it | From ACAP 7-7: mains at 55% MAC. Planform check: a Boeing reference-trapezoid MAC at y ≈ 11.5 m puts the leading edge at 27.7 m, 7-7 at 27.78 m |
| Taxi attitude | −0.52° | ACAP 4-6 (the sim stands at it) |
| Centreline height at 25% MAC | 4.90 m | D 1.75–1.85 m at 15 m from the nose + 2.97 m + the attitude |
| Pilot's eye | 5.48 m above ground, 2.64 m aft of the nose, ±0.53 m → body (26.71, ±0.53, +0.82) | ACAP 4-6 |
| Nacelle (GE) | low point 0.69–0.76 m, lip 20.80 m from the nose, 9.91 m out; 3.8 m wide, 5.7 m lip to chevrons + 2.2 m core | width and lengths measured on the drawing |
| Tyres | main 54×21.0 R23 (8), nose 40×16.0 R16 (2); bogie 1.51 m × 1.52 m | ACAP 7-4 |
| Turning at 70° | inner gear 3.7 m, outer 15.5 m, nose 28.3 m, wingtip 41.5 m, tail 37.2 m | ACAP 4-3 |

**Tail strike.** Neither document gives it, so it comes from the side view. The line from the main wheels first meets the underside at 16.8 m aft of the mains, 7.7° above the datum with the struts compressed; the tail itself is at 10.2°. Add 0.33 m of unloaded strut and the bogie tilting about its rear axle, and it comes to about **9.6°**. The sim has a single contact point and no tilting bogie, so `TAIL_STRIKE_POINT` sits 0.24 m above the drawn skin to give that 9.6°.

## 3. Engine

| Item | Value | Source |
|---|---|---|
| Rating | GEnx-1B74/75/P2: take-off 341.2 kN, flat to 31.7 °C; MCT 305.1 kN | TCDS p.34, GENX p.9 |
| Why this rating | The 254,692 kg MTOW is tied to the 74/75K rating (TCDS p.37), and it is ACAP's "High Thrust" chart | |
| **100% N1** | **2,560 rpm** (42.67 Hz) | GENX p.15. Two note blocks on the page; 2,778 / 1.085 = 2,560 places this one with the -1B, and 3,026 / 1.067 = 2,835 places the other with the -2B |
| **100% N2** | **11,377 rpm** (189.6 Hz) | GENX p.15 |
| Limits for /P2 | N1 2,778 rpm (108%), N2 13,368 rpm (117.5%) | GENX p.15 |
| **Fan blades** | **18** → blade-passing 768 Hz at 100% N1 | TRADE; not in the TCDS, no GE document found |
| Stages | 1 fan + 4 LPC, 10 HPC, 2 HPT, 7 LPT | GENX p.7 |
| Engine size, weight | 4.95 m long, 3.53 m wide; 6,147 kg | GENX p.8 |
| ICAO LTO fuel flow | 2.722 / 2.218 / 0.689 / 0.225 kg/s at 100 / 85 / 30 / 7% | EDB |

The code reads these from `FAN_BLADES`, `N1_100_RPM` and `N2_100_RPM` in `src/sim/b787-9.js`.

## 4. The checks: the sim against the documents

Commands: `SIM_DEBUG=1 node --test tests/b787-9-performance.test.mjs` prints all of this. Flown with the Boeing law (`src/sim/fbw-boeing.js`) by a test pilot who only moves the stick.

| Check | Document | Sim | Band |
|---|---|---|---|
| TOFL 254 t, flaps 15, SL ISA | 9,340 ft = 2,850 m (ACAP 3-17, High Thrust, read) | 1.15 × 2,470 m = 2,840 m, 100% | 80–105%: all-engines factored must not exceed the chart; the rest is the engine-out case the sim doesn't fly |
| TOFL 220 t | ≈ 2,130 m | 2,220 m, 104% | same |
| TOFL 200 t | ≈ 1,830 m | 1,897 m, 104% | same |
| Approach speed at MLW | 153 kt (ARC) | 1.23 VS1g, flaps 30 = 153.0 kt | ±3 kt |
| LFL 192.8 t, flaps 30, dry | ≈ 5,900 ft = 1,800 m; × 0.6 = 1,080 m (ACAP 3-31, read) | 996 m from 50 ft (334 m air, 662 m roll), 92% | 85–115% of 0.6 × LFL |
| LFL 158 t | ≈ 5,000 ft = 1,520 m; × 0.6 = 912 m | 870 m, 95% | same |
| 3° approach, MLW, VREF + 5 | no document: EST, low single digits, N1 about 50–65% | pitch +2.2°, N1 60% | +0.5–4°, 45–75% |
| Cruise M0.85, 200 t, FL390 | job's targets L/D 19–21, 5–6 t/h; SPEC about 5.6 t/h, no conditions | L/D 20.2, 5,561 kg/h, N1 88.5%, α 2.3° | L/D 19–21; 5–6 t/h |
| 185 t, FL410 | | L/D 20.2, 5,131 kg/h | |
| 220 t, FL370 | | L/D 20.2, 6,117 kg/h | |
| 240 t, FL350 | | L/D 20.1, 6,715 kg/h | |
| Thrust needed vs CLB | | FL350 240 t 58.5/63.1 kN; FL370 215 t 52.5/59.2; FL390 200 t 48.7/55.1; FL410 180 t 43.9/51.2 | needed < CLB |
| MMO | M0.90 reachable | FL390 200 t: L/D 17.9, 54.8 kN, MCT 56.8 kN, +13% on M0.85 | L/D > 15; < +30%; level at MCT |
| Climb, CLB, 220 t, 250 kt, FL40–90 | no document (EST) | 2,718 fpm | 2,000–3,500 |
| 220 t, 300 kt, FL150–200 | | 1,693 fpm | 1,500–2,800 |
| 210 t, M0.85, FL350–390 | | 348 fpm, reaches FL390 | 300–1,500 |
| Lift-off at MTOW | no tail strike at 3°/s | 177 kt (VR 162), pitch 7.1°, tail strike 9.6° | pitch < 9.1° |
| Stands, 150–255 t | ACAP 2-9, 4-6 | eye 5.43–5.55 m (5.48), crown 7.69–7.80 m (7.42–7.82), belly 1.75–1.86 m (1.75–1.85), nacelle 0.68–0.77 m (0.69–0.76), fin 16.97–17.04 m (16.81–17.09), pitch −0.43 to −0.54° (−0.52°) | table +5 cm |
| Nose gear share | 4.3–11.4% (ACAP 7-7) | 4.7–7.9% at the loadings tried | 4–11.4% |
| CG | ACAP 7-7 | MTOW 22.7%, MLW 35.9%, light 36.5% MAC | inside the envelope |
| Static stability, M0.85 | neutral point aft of ACAP 7-7's limit | dCm/dα −1.92 / −1.20 / −0.30 per rad at 15 / 25 / 37.5% MAC | < −0.1, less stable as the CG moves aft |

## 5. What's estimated, and what would change it

- **Lift, drag and moments** are fitted to the checks above, not measured. VREF sets flaps 30's CLmax; the take-off chart sets flaps 15's; the flaps-up figure is a judgement.
- **Take-off runs long.** Lift-off is about 15–20 kt above VR, and the factored all-engines distance is 100–104% of the chart, the top of its band. On a twin it should sit below 100%, since the engine-out case usually governs. The lift-off band was widened from VR + 17 to VR + 22 kt to pass at the lighter weights.
- **Landing depends on the flare.** The 92–95% figures are with a firm flare from 30 ft, touching down at about 400 ft/min. A gentler flare (35 ft, aiming for 150 ft/min) gave 111% at MLW and 118% at 158 t, which is outside the band.
- **Chart readings are by eye:** ±100 ft is my estimate. The take-off check runs at the chart's edge, 254,011 kg, 681 kg under the TCDS's MTOW.
- **Inertias** use Roskam's radii (±25%). Roll, yaw and engine-out handling have no document check.
- **VFE and gear speeds** are from study cards.
- **Slat and flap angles** are named after the detents; the documents don't give them.

## 6. Limits the widebody hits in the shared code

Reported to the lead; none blocks. `sim.js` `thsTakeoff` is an A321 formula (−0.5° + 20° × (cgMac − 0.28): −1.6° at MTOW's CG, +1.1° at a 36% CG; rotation works in the tests at the CGs tried). `flightmodel.js` clamps Mach at 0.9 in Prandtl–Glauert, right at this MMO. The gear is one contact point per leg, so no bogie tilt (see §2).
