# 777-300ER (GE GE90-115B) performance reference for flight-model tuning

Compiled 2026-11-04. **Tags:** **PUB** = published/certified document. **FORUM** = pilot study notes, forums. **EST** = my estimate or derivation, with the method shown. Nothing here is for real-world operations.

Sources used repeatedly (PDFs in `games/flight-sim/reference/docs/`, git-ignored; download commands in `PLAN.md` → Data):
- **[TCDS]** EASA TCDS IM.A.003 (Boeing 777), Issue 20, 13 May 2026, Section 4 (-300ER), PDF pp.25–28. Validates FAA T00001SE. https://www.easa.europa.eu/en/downloads/7521/en
- **[ACAP]** Boeing *777-200LR/-300ER/-Freighter Airplane Characteristics for Airport Planning*, D6-58329-2 Rev G, Dec 2024. Page numbers are its own. The brief named D6-58329, but that one covers the -200/-200ER/-300; its -2 volume is the -300ER's (p.1-4). https://www.boeing.com/content/dam/boeing/v2/airports/acaps/777-200LR-300ER-F_Rev_G.pdf
- **[ARC]** Boeing *Aerodrome Reference Code and Approach Speeds*, Rev A, Aug 2026, p.6. https://www.boeing.com/content/dam/boeing/v2/airports/faq/arcandapproachspeeds.pdf
- **[GE90]** EASA TCDS IM.E.002 (GE90), Issue 05, 5 Mar 2023. https://www.easa.europa.eu/en/downloads/7799/en
- **[EDB]** ICAO Aircraft Engine Emissions Databank, 03/2026, UID 07P27GE240 and its predecessors 21GE184, 01P21GE217 (GE90-115B).
- **[CARDS]** Study decks, not official: limitations https://brainscape.com/flashcards/limitations-14855158/packs/21807953, fuel https://brainscape.com/flashcards/fuel-system-6114765/packs/9355071, general and tail strike https://brainscape.com/flashcards/aircraft-general-and-limitations-6113008/packs/9355071
- **[FORUM]** VMO: https://www.avsim.com/forums/topic/458203-something-maybe-wrong-with-pmdg-777/page/3/
- **[SPEC]** Spec site, no primary source: https://aerospaceweb.org/aircraft/jetliner/b777/ (OEW 166,440 kg, sweep 31.64°, range 7,705 nm).

## 1. Limits and weights

| Item | Value | Source | Tag |
|---|---|---|---|
| VMO / MMO | 330 kt at sea level (rising to 350 kt near FL280) / M0.89. The sim has one VMO: 330 | FORUM; the TCDS leaves them to the AFM (p.26 §10) | FORUM |
| Max operating altitude | 43,100 ft | TCDS p.26 | PUB |
| VFE 1, 5, 15, 25, 30 | 265, 245, 230, 200, 180 kt | CARDS | FORUM |
| VFE 20 | 225 kt | My recollection; the deck has no flaps 20 | EST |
| VLO, VLE | 270 kt / M0.82 | CARDS | FORUM |
| Tyre limit | 235 mph = 204 kt, ground speed | TCDS p.27, ACAP 3-13 | PUB |
| MTW / MTOW / MLW | 352,441 / 351,534 / 251,290 kg | TCDS p.26 (optional increased weights; baseline 341,101 / 340,194), ACAP 2-2 | PUB |
| MZFW | **237,682 kg** ACAP 2-2 and 3-3; **TCDS p.26 says 239,950 kg.** The documents differ; taken from the one the range chart is drawn to | | PUB |
| OEW | 166,440 kg (ACAP says ask the airline; others run to about 171 t) | SPEC | EST |
| Seats | 339 two-class; exit limit 550 | ACAP 2-2, TCDS p.26 | PUB |
| Usable fuel | 181,283 L, 145,570 kg (3-3 prints 145,540) | ACAP 2-2 | PUB |
| Fuel split | Mains 31,300 kg each; centre the rest (the deck says 82,900) | CARDS | FORUM |
| MAC, wing area, span | 7.08 m, 427.8 m², 64.80 m | TCDS pp.25–26, ACAP 2-4 | PUB |
| CG envelope | 27.5–38.4% MAC at MTW, about 19–44.5% near 310 t, 8–44.5% below 180 t. Scale: 0% MAC = 86.16% on the mains, 40% = 95.27% | ACAP 7-8 (chart read) | PUB (chart read) |
| Sweep | 31.64° at quarter chord | SPEC | EST |

## 2. Geometry

All from ACAP 2-4, 2-7, 4-4, 4-6 and 7-5 unless marked; the file is `src/geometry-b777-300er.js`, with the derivations next to the numbers.

| Item | Value | Note |
|---|---|---|
| Length, fuselage, span, height | 73.86, 73.08, 64.80, 18.55 m | K 18.24–18.85; the middle. TCDS 18.5, ARC's maximum 18.85 |
| Fuselage | 6.20 × 6.20 m | |
| Wheelbase, track | 31.22, 10.97 m; nose gear 5.89 m from the nose | |
| Where 25% MAC is | 34.56 m from the nose; bogie centres 2.55 m aft of it | From 7-8. Check: the scale's 0–40% is 2.84 m, 0.40 × 7.11 m against the TCDS's 7.08 m |
| Taxi attitude | −0.49° | **Not stated for this model.** From door sills: B and J in 2-7, 0.46 m over 54 m |
| Centreline height at 25% MAC | 5.73 m | From A (crown) 8.62 − 3.10 at x ≈ 24.6 and the attitude. Cross-check at door 1: 5.48 from the sill, 5.49 from this |
| Pilot's eye, x and y | 2.26 m aft of the nose (3.63 m ahead of the nose gear), ±0.53 m | 4-6 |
| **Pilot's eye, height** | **6.25 m [EST], not the document's stated 5.51 m ±1 ft.** See below | |
| Nacelle | lip 25.76 m from the nose, 9.61 m out; 3.96 m wide; low point 0.73–0.99 m. Cowl 5.4 m and core 2.5 m measured on the drawing | |
| Tyres | main 52×21.0 R22 (12), nose 43×17.5 R17 (2); bogie 3 axles, 1.45 + 1.48 m, 1.40 m tread | 7-5 |
| Turning at 70° | inner gear 4.7 m, outer 17.6, nose gear 33.7, wingtip 45.2, nose 38.0, tail 42.8 m, with aft axle steering | 4-4 |

**The eye's height: the document conflicts with itself.** 4-6 states 18 ft 1 in (5.51 m) ±1 ft. But:
- its own 21° down to a 15.4 m intercept implies 5.91 m (5.51 m would be 19.7°), and the page is NOT TO SCALE, with a drawing showing about 6.2 m;
- 2-4's side view has the side windows +0.37 to +0.99 m from the centreline (middle +0.69), and 2-7 agrees. 5.51 m is +0.06, 0.31 m below every sill. The top of ±1 ft, 5.81 m, only reaches the sill;
- static height and attitude don't explain the gap: the sill cross-check above agrees within 1 cm, and the whole stance range is ±0.16 m.

The value used, 6.25 m (z ≈ +0.80), is the cockpit job's fit: it casts 4-6's four angles (21° and 32° ahead, 27° and 31° abeam) onto the model's nose and compares them with 2-4's window edges. RMS 0.107 m, against about 0.73 m at 5.51 m and 0.22 m at 6.10 m; the minimum is shallow, ±0.05 m at best. My own reading of 2-4 alone gave about 6.1 m (+0.65), and 6.25 m is inside the same window band, so I took it. It depends on the model's nose table, and no single height satisfies all of 4-6: 6.25 m at 21° is a 16.3 m intercept.

**Tail strike and the semi-levered gear.** The sim has one contact per leg, at the bogie's centre, with no lever and no tilt. [DRAW] on 2-7: the underside first meets the line from the wheels about 20 m aft of the bogie's centre (57 m from the nose), 7.6° with the struts compressed, about 9.2° unloaded and pivoting on the aft axle. A study deck gives 8.9° for the -300 (same fuselage, no lever) and 10.0° for the -300ER: the lever's gain. The sim uses **10.0° [FORUM]**, placing `TAIL_STRIKE_POINT` 0.225 m above the drawn skin, as the 787-9's sits 0.24 m above for its tilting bogie. So the lever is only in that angle; its effect on rotation and field length isn't modelled, and it's fitted in the lift instead.

## 3. Engine

| Item | Value | Source |
|---|---|---|
| Rating | GE90-115B: take-off 513.95 kN flat to 30 °C; MCT 489.30 kN flat to 25 °C. ACAP calls it GE90-115BL, 115,300 lb | GE90 §6, ACAP 1-3 |
| **100% N1, N2** | **2,355 rpm, 9,332 rpm** | GE90 Speed Limits |
| Limits | N1 2,602 rpm (110.5%), N2 11,292 rpm (121%) | GE90 |
| **Fan blades** | **22** | PUB (as `src/audio/engine-sounds.js`); not in the TCDS |
| ICAO LTO fuel flow | 4.60 / 3.566 / 1.073 / 0.341 kg/s at 100 / 85 / 30 / 7% | EDB |

The code reads these from `FAN_BLADES`, `N1_100_RPM` and `N2_100_RPM` in `src/sim/b777-300er.js`. The thrust lapse and CL rating (0.90) are EST.

## 4. The checks: the sim against the documents

`SIM_DEBUG=1 node --test tests/b777-300er-performance.test.mjs` prints all of this. Flown with the Boeing law by a test pilot who only moves the stick.

| Check | Document | Sim | Band |
|---|---|---|---|
| TOFL 351.5 t, flaps 20, SL ISA | 10,080 ft = 3,072 m (ACAP 3-13, read) | 1.15 × 2,510 m = 2,887 m, 94% | 80–105% |
| TOFL 317.5 t | 8,130 ft = 2,478 m | 2,420 m, 98% | same |
| TOFL 272 t | 6,000 ft = 1,829 m | 1,876 m, 103% | same |
| Approach speed at MLW | 150 kt (ARC) | 1.23 VS1g, flaps 30 = 150.0 kt | ±3 kt |
| LFL 251.3 t, flaps 30, dry | 5,810 ft = 1,770 m; × 0.6 = 1,062 m (ACAP 3-30, read) | 1,046 m from 50 ft, 98% | 85–115% |
| LFL 208.7 t | 5,060 ft = 1,543 m; × 0.6 = 926 m | 874 m, 94% | same |
| 3° approach, MLW, VREF + 5 | no document: EST | pitch +1.1°, N1 62% | +0.5–4°, 45–75% |
| **Range, MTOW to MZFW, M0.84, steps** | **about 5,660 nm (ACAP 3-3, read). The one independent check of L/D ÷ TSFC** | 5,580 nm, with EST 13 t reserves and 10 t climb fuel | ±10% |
| Cruise M0.84 | no document for L/D | 330 t FL310 L/D 19.3, 9,463 kg/h; 290 t FL330 19.2, 8,303; 260 t FL350 19.1, 7,402; 230 t FL390 19.4, 6,428 | L/D 18–20.5 |
| MMO | M0.89 reachable | FL350 270 t: L/D 17.1, 77.6 kN, MCT 93.2 kN, +13% on M0.84 | L/D > 14; < +35%; level at MCT |
| Climb, CLB, 310 t, 250 kt, FL40–90 | no document (EST) | 3,061 fpm | 1,800–3,500 |
| 310 t, 310 kt, FL150–200 | | 1,901 fpm | 1,300–2,800 |
| 290 t, M0.84, FL310–350 | | 805 fpm | 300–1,500 |
| Levels | 345 t reaches FL310 (87 kN of 102 kN CLB); FL410 not reachable at 345 t | | EST |
| Lift-off, MTOW | no tail strike at 2.5°/s | 186 kt (VR 171), pitch 6.5°, tail strike 10° | < 9.5° |
| Stands, 190–351.5 t | ACAP 2-7 | crown 8.59–8.68 m (8.46–8.78), nacelle 0.82–0.92 m (0.73–0.99), fin 18.48–18.59 m (18.24–18.85), wingtip 7.54–7.65 m (7.29–7.90), pitch −0.40 to −0.47° | table +5 cm |
| Nose gear share | 3.7–12% (ACAP 7-8) | 5.4–7.3% | 3.7–12.7% |
| CG | ACAP 7-8 | MTOW 28.7%, 310 t 32.6%, MLW 32.5–37.0%, light 34.4% MAC | inside the envelope; MTOW only 1.2% from the forward limit |
| Static stability, M0.84 | neutral point aft of 44.5% | dCm/dα −2.31 / −1.60 / −0.25 at 15 / 25 / 44% MAC | < −0.1 |
| Gear, MLW | | firm flare 435 ft/min 1.91 g, 0.33 m main, 0.52 m nose (stroke 0.60); no flare 753 ft/min 3.37 g, 0.53 m, unbroken | stroke, < 2.2 g |
| Brakes, RTO 150 kt, MTOW | 10 ft/s² class (ACAP 7-6's loads) | 708 m, 4.23 m/s² | 3.05–5.5 |
| Hand landing (e2e controller) | | 251 t B 86 (305 fpm, 1.46 g); 230 t B 86; 200 t B 89; 180 t A 92; overweight 300 t D 63 (no crash) | B or better at landing weights |

## 5. What's estimated, and what would change it

- **Lift, drag and moments** are fitted, not measured. VREF sets flaps 30's CLmax; the take-off chart sets flaps 15 and 20's; flaps 25 comes from its field length; UP is a judgement.
- **Take-off lifts off late:** 15–20 kt after VR, up to 21 kt, like the 787-9, and real rotations are about 5 kt. Lift-off VR is my estimate, not a document's.
- **Landing depends on the flare.** The figures use a firm 30 ft flare, touching down near 435 ft/min, the same flare as the 787-9's; a gentle one would run longer.
- **1.9 g at 435 ft/min** is an instantaneous peak; the same as the 787-9 at that sink, since damping was scaled to it. No document checks it.
- **Chart readings are by eye,** ±100 ft is my estimate. The range check's reserves and climb fuel are mine ("typical mission rules").
- **Inertias** use Roskam's radii (±25%). Roll, yaw and engine-out handling have no document check.
- **CG positions** of the empty aircraft and the fuel are chosen to fit the envelope, not given.
- **Slat and flap angles** are named after the detents; the documents don't give them.

## 6. Limits the widebody hits in the shared code

Reported to the lead; none blocks. `sim.js` `thsTakeoff` is the A321 formula (−0.5° + 20° × (cgMac − 0.28)), and it trims more nose-up at aft CGs, the wrong way round; at an aft 40% CG in an earlier loading the 272 t rotation overshot. With the CGs now, it passes. The sim's one VMO can't follow the 330-to-350 kt schedule. The gear is one contact per leg (§2). No literal in the Boeing law needed changing for 350 t.
