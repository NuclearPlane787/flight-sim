# A321neo (CFM LEAP-1A) performance reference for flight-model tuning

Compiled 2026-10-31. **Tags:** **PUB** = published/certified doc (Airbus, EASA, ICAO). **DB** = indicative database (EUROCONTROL). **FORUM** = forum, sim community or training notes. **EST** = my estimate or derivation, with the method shown. Nothing here is for real-world operations.

Sources used repeatedly:
- **[TCDS]** EASA TCDS A.064 (A318/A319/A320/A321), Issue 62, 26 Jun 2026. Local copy: `games/flight-sim/reference/docs/easa-tcds-a064.pdf`. Section 2 (A321), PDF pages 90–103.
- **[AC]** Airbus *A321 Aircraft Characteristics – Airport and Maintenance Planning*, rev. Jun 01/24. Local copy: `games/flight-sim/reference/docs/airbus-ac-a321.pdf`.
- **[E110]** EASA TCDS E.110 (LEAP-1A/-1C), Issue 14, 11 May 2026: https://www.easa.europa.eu/en/downloads/20086/en
- **[EDB]** ICAO Aircraft Engine Emissions Databank, 03/2026 xlsx, UID 08P28CM151 (LEAP-1A35A/33/33B2/32/30 family): https://www.easa.europa.eu/en/downloads/131424/en
- **[EC]** EUROCONTROL Aircraft Performance Database, A21N: https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/details.aspx?ICAO=A21N
- **[FBW]** FlyByWire A32NX docs, normal-law protections: https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-advanced-guides/protections/overview/

## 1. Limits and geometry

| Item | Value | Source | Tag |
|---|---|---|---|
| VMO / MMO | 350 kt IAS / M0.82 | TCDS p.99 | PUB |
| VFE CONF 1 (18/0) | 238 kt (243 kt on -NX/XLR-type) | TCDS p.99–100 | PUB |
| VFE CONF 1+F (18/10) | 225 kt | TCDS p.99 | PUB |
| VFE CONF 2 (22/14) | 215 kt | TCDS p.100 | PUB |
| VFE CONF 3 (22/21) | 195 kt | TCDS p.100 | PUB |
| VFE CONF FULL (27/34) | 186 kt | TCDS p.100 | PUB |
| VLO extension / retraction | 250 kt / 220 kt | TCDS p.100 | PUB |
| VLE | 280 kt / M0.67 | TCDS p.100 | PUB |
| Tyre limit (ground speed) | 195.5 kt | TCDS p.100 | PUB |
| Max operating altitude | 39,100 ft (39,800 ft with mod 30748) | TCDS p.101 | PUB |
| MTOW / MLW / MZFW, A321-251N/-253N | 93.5 t / 79.2 t / 75.6 t | TCDS p.102 | PUB |
| MTOW -NX (LR/XLR-type) / -NY (XLR) | 97.0 t / 101.0 t | TCDS p.102 | PUB |
| Minimum weight (CFM) | 46.6 t | TCDS p.102 | PUB |
| MAC | 4.1935 m | TCDS p.103 | PUB |
| Datum | 2.540 m forward of the nose | TCDS p.103 | PUB |
| Span / length | 35.80 m / 44.51 m | AC p.51–52 (fig. 2-2-0-991-010/012) | PUB |
| Wing area (reference) | 122.4 m² (122.6 m² is also widely quoted) | Wikipedia A321neo spec table | FORUM |
| Aspect ratio | about 10.5 (35.8² / 122.4) | EST | EST |
| Quarter-chord sweep | 25° | Wikipedia | FORUM |
| OEW | about 50.1 t (typical). The AC jacking figures use 48.7–49.2 t (AC p.~160–162) | Wikipedia; AC | FORUM / PUB |
| CG range | not in the TCDS ("see AFM"). The AC uses 17.5–38 % MAC as FWD/AFT examples (AC p.56) | AC p.56 | PUB (example only) |

**Fuel.** TCDS p.97–99, at 0.785–0.8 kg/L, PUB:

| Variant | Wing | Centre | ACTs | Total usable |
|---|---|---|---|---|
| -251N/-253N (3-tank) | 15,380 L | 8,200 L | none | **23,580 L (~18.5 t)** |
| -251N + 1 or 2 ACT (low pressure) | | | 2,992 L or 5,984 L | 26,572 L or 29,564 L |
| -NX (LR-type) | | | up to 3 × 3,121 L | 26,701 / 29,822 / 32,943 L |
| -NY (XLR) | 15,380 L | 8,150 L | RCT 12,961 L (+ optional FWD ACT 3,121 L) | 36,491 L / 39,612 L |

## 2. Engine: LEAP-1A32 / -1A33 / -1A35A

| Item | Value | Source | Tag |
|---|---|---|---|
| Take-off thrust, SL static | **143.05 kN** (14,305 daN, 32,160 lbf). The three ratings are identical at SL static and differ only in hot or high flat-rating via the ID plug | E110 p.9; EDB rated thrust 143.05 kN | PUB |
| Max continuous thrust | about 140.96 kN (14,096 daN). Mapping the table columns from the PDF text extraction was ambiguous, so verify | E110 p.9 | PUB (verify) |
| 1A30 rating (for comparison) | 130.29 kN | E110 p.9 | PUB |
| Bypass ratio / OPR | 10.38 / 38.4 | EDB | PUB |
| Fuel flow at 100 % (T/O), SL static | 1.067 kg/s (3,842 kg/h) per engine | EDB | PUB |
| Fuel flow at 85 % (climb-out) | 0.873 kg/s (3,144 kg/h) | EDB | PUB |
| Fuel flow at 30 % (approach) | 0.286 kg/s (1,029 kg/h) | EDB | PUB |
| Fuel flow at 7 % (ICAO idle) | 0.094 kg/s (339 kg/h) | EDB | PUB |
| "Idle thrust" | ICAO LTO idle = 7 % × 143 kN = **10.0 kN**. Real ground or flight idle is lower and varies with speed | EDB definition | PUB (definition) / EST |
| TSFC, take-off (SL static) | 7.46 g/(kN·s) = 26.9 kg/(kN·h) ≈ 0.263 lb/(lbf·h) | derived from EDB | EST (from PUB) |
| TSFC, cruise (M0.78, ~FL350) | about 14.4 g/(kN·s) ≈ 51.8 kg/(kN·h) ≈ 0.51 lb/(lbf·h) | aircraftinvestigation.info (LEAP-1A page) | FORUM |
| Cruise thrust per engine | about 20–23 kN at 70–78 t, FL350, M0.78 (= W / (2·L/D) with L/D 16–17) | EST | EST |
| N1 reference | 100 % N1 = 3,856 rpm. Max 101 % (3,894 rpm). N2 100 % = 16,645 rpm, max 116.5 % | E110 p.11 | PUB |
| Typical N1 | TOGA about 92–96 %, FLEX about 85–90 %, CLB about 88–92 %, cruise about 80–86 % | sim community / EST | FORUM / EST |
| Spool, idle to TOGA | certification needs go-around thrust **within 8 s** of moving the levers from flight idle (CS 25.119 / 14 CFR 25.119). Typical high-bypass engines take about 5–7 s from flight idle; ground idle is slower | CS-25.119 | PUB (rule) / EST |
| EGT limits | T/O 1,060 °C; MCT 1,025 °C | E110 p.11 | PUB |
| Dry engine mass | 2,990–3,008 kg with fluids | E110 p.8 | PUB |

## 3. Speeds: stall, VLS and characteristic speeds

**Anchor (PUB):** Airbus final approach speed is **136 kt IAS at MLW 79.2 t, CONF FULL**, ISA (AC p.197, §3-5-0). With Vapp = VLS + 5 kt, VLS FULL ≈ 131 kt, so VS1g FULL ≈ 131 / 1.23 ≈ **106.5 kt at 79.2 t**. That implies CLmax FULL ≈ 3.4 on S = 122.4 m².

**Rule factors (PUB, CS-25):** VLS (landing) = 1.23 VS1g (CS 25.125 VREF ≥ 1.23 VSR). V2 ≥ 1.13 VS1g (CS 25.107). Airbus take-off VLS = 1.13 VS1g.

**VS1g (kt IAS ≈ CAS, SL).** **EST**: CLmax values assumed, then calibrated to the Airbus 136 kt anchor and a typical V2 ≈ 1.18–1.2 VS1g. VS1g scales with √W. Treat as ±6 kt.

| Config | CLmax (assumed) | 60 t | 70 t | 80 t | 90 t |
|---|---|---|---|---|---|
| 0 (clean) | 1.50 | 140 | 152 | 162 | 172 |
| 1 | 2.00 | 122 | 131 | 141 | 149 |
| 1+F | 2.50 | 109 | 118 | 126 | 133 |
| 2 | 2.65 | 106 | 114 | 122 | 130 |
| 3 | 2.80 | 103 | 111 | 119 | 126 |
| FULL | 3.45 | 93 | 100 | 107 | 114 |
| → VLS FULL (×1.23) | | 114 | 123 | 132 | 140 |
| → Vapp FULL (+5) | | 119 | 128 | 137 | 145 |

Other characteristic speeds:

| Speed | Value | Source | Tag |
|---|---|---|---|
| Green Dot (clean, best L/D, engine-out) | ≈ 1.5 × W[t] + 110 kt below FL200, +1 kt per 1,000 ft above. Gives 215 kt at 70 t and 230 kt at 80 t | PPRuNe thread quoting the A321neo FCOM: https://www.pprune.org/tech-log/629825-green-dot-vls-speed-airbus.html | FORUM |
| F speed / S speed | F ≈ 1.18–1.22 VS1g (CONF 2/3, minimum speed to retract to 1); S ≈ 1.22–1.25 VS1g of clean (minimum speed to retract to 0) | aviationhunt.com, A320 operating speeds | FORUM |
| Sim community VLS/Vapp FULL | 136/141 at 70 t; 145/150 at 79.2 t. These run about 9 kt above the Airbus AC anchor, so prefer the AC | Infinite Flight guide: https://community.infiniteflight.com/t/airbus-a321neo-flying-guide/1323497 | FORUM |

## 4. Take-off and landing

| Item | Value | Source | Tag |
|---|---|---|---|
| TOFL, ISA SL, 97 t | ≈ 8.2k ft ≈ **2,500 m** | AC fig. 3-3-1-991-010 (LEAP), PDF p.184, read off the chart | PUB (chart read ±5 %) |
| TOFL, 93.5 t | ≈ 7.4k ft ≈ 2,250 m | same | PUB (chart read) |
| TOFL, 85 t | ≈ 6.1k ft ≈ 1,860 m | same | PUB (chart read) |
| TOFL, 80 t | ≈ 5.35k ft ≈ 1,630 m | same | PUB (chart read) |
| TOFL, 75 t | ≈ 4.7k ft ≈ 1,430 m | same | PUB (chart read) |
| TO distance, MTOW 97 t / V2 | 2,150 m / 145 kt | EC | DB |
| V1/VR/V2, 1+F, 80 t | 144 / 146 / 151 kt | Infinite Flight guide | FORUM |
| V1/VR/V2, 1+F, 85 t | 148 / 150 / 155 kt | same | FORUM |
| V1/VR/V2, CONF 2, 80 t / 85 t | 140/142/147 kt; 144/146/151 kt | same | FORUM |
| V1/VR/V2, 1+F, 93.5–95 t | ≈ 156 / 158 / 163 kt | same | FORUM |
| V2 check (EST) | V2 ≈ 1.18 × VS1g(1+F): 80 t → 149 kt, 90 t → 157 kt. Consistent with the forum table | EST | EST |
| Landing field length (factored, dry), ISA SL, 79.2 t | ≈ 5.2k ft ≈ **1,580 m** | AC fig. 3-4-1-991-009 (Leap), PDF p.195, chart read | PUB (chart read) |
| LFL, 70 t / 60 t | ≈ 1,460 m / ≈ 1,340 m | same | PUB (chart read) |
| Actual landing distance (unfactored ≈ LFL × 0.6) | ≈ 950 m at 79.2 t; ≈ 800 m at 60 t (max manual braking) | EST from the CS/FAR 1/0.6 factor | EST |
| Landing distance / Vat | 1,850 m / 140 kt | EC | DB |
| Vapp at MLW | 136 kt (Approach Category C) | AC p.197 | PUB |

## 5. Climb, cruise and aero

| Item | Value | Source | Tag |
|---|---|---|---|
| Initial climb to 5,000 ft | 175 kt, **2,000 fpm** | EC | DB |
| Climb to FL150 | 290 kt, **1,500 fpm** | EC | DB |
| Climb FL150–FL240 | 290 kt, **1,200 fpm** | EC | DB |
| Mach climb (M0.78) above FL240 | **1,000 fpm**, tapering to about 300–500 fpm near the optimum FL | EC; taper is EST | DB / EST |
| 250 kt below FL100 at 75–85 t, CLB thrust | ≈ 2,000–2,800 fpm | EST (light weights > 3,000 fpm) | EST |
| Cruise | M0.78, TAS 450 kt, FL390 ceiling, 4,000 nm | EC | DB |
| Optimum / max FL at M0.78 | 80 t: FL350 / FL370. 90 t: FL330 / FL350. 70 t: FL370 / FL390 | Infinite Flight guide | FORUM |
| Total cruise fuel flow | 2,200 kg/h at FL330, 67 t, M0.76 (LRC); about 2,440 kg/h at M0.80 | Wikipedia A321neo (operational data) | FORUM |
| Fuel flow per engine, FL350, M0.78, 72–80 t | **≈ 1,075–1,250 kg/h/engine** (W/(L/D) × TSFC: 72 t, L/D 17 → 1,075. 80 t, L/D 16.5 → 1,230) | EST | EST |
| Cruise L/D | **≈ 16–17.5** (back-solving Wikipedia FF with TSFC 0.51 gives ~15.5. A320-family literature quotes ~17–18) | EST | EST |
| CD0 (clean, cruise Mach, incl. wave) | ≈ 0.020–0.024 | EST (CL ≈ 0.57 at 72 t FL350 M0.78, q ≈ 10.15 kPa) | EST |
| Oswald e | ≈ 0.75–0.82; k = 1/(π·AR·e) ≈ 0.038 | EST | EST |
| CL cruise | 0.55–0.62 (70–80 t, FL350, M0.78) | EST | EST |

## 6. Mass properties (EST)

Roskam radii-of-gyration method for twin-jet transports, with R̄x 0.25, R̄y 0.38, R̄z 0.46. Formulas: Ixx = m(R̄x·b/2)², Iyy = m(R̄y·L/2)², Izz = m(R̄z·(b+L)/4)².

| Mass | Ixx (roll) | Iyy (pitch) | Izz (yaw) | Unit |
|---|---|---|---|---|
| 60 t | 1.2 × 10⁶ | 4.3 × 10⁶ | 5.1 × 10⁶ | kg·m² |
| 80 t | 1.6 × 10⁶ | 5.7 × 10⁶ | 6.8 × 10⁶ | kg·m² |
| 93.5 t | 1.9 × 10⁶ | 6.7 × 10⁶ | 8.0 × 10⁶ | kg·m² |

Treat these as ±25 %. Wing fuel raises Ixx more than it raises Iyy. Ixz is small (assume about 0–3 % of Izz). Sanity check: Izz ≈ Ixx + Iyy holds to within about 10 %.

## 7. Ground deceleration

| Item | Value | Source | Tag |
|---|---|---|---|
| Autobrake LO | 1.7 m/s² (some sources say 2.0) | planefyi; FBW autobrake page https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-briefing/flight-deck/front/autobrake-gear/ | FORUM |
| Autobrake MED | 3.0 m/s² (≈ 0.3 g) | FBW; Airbus Safety First "Is it a loss of braking?" https://safetyfirst.airbus.com/is-it-a-loss-of-braking/ | PUB / FORUM |
| Autobrake MAX (RTO) / max manual, dry | ≈ 0.4–0.5 g (4–5 m/s²), anti-skid limited, μ ≈ 0.4–0.5 dry | EST | EST |
| DECEL light | at 80 % of the selected rate | FBW | FORUM |
| Reverse thrust (LEAP-1A cascade reverser) | max reverse ≈ 20–30 % of rated forward thrust at high speed, i.e. ≈ 0.05–0.08 g at 75 t. Idle reverse is about 0. Not credited on dry certified distances | EST | EST |
| Ground spoilers | lift dump: wheel load rises to about 90 %+ of weight within ~1–2 s | EST | EST |

## 8. Normal-law protections

| Item | Value | Source | Tag |
|---|---|---|---|
| Load factor | +2.5 / −1.0 g clean; +2.0 / 0 g slats or flaps out | FBW (matches FCOM DSC-27) | FORUM (FCOM-derived) |
| Pitch attitude | +30° nose-up in CONF 0–3 (25° at low speed); +25° in FULL (20° at low speed); −15° nose-down | FBW | FORUM |
| Bank | 33° neutral-stick return; 67° max with full stick; 45° in high-AoA protection; 40° in high-speed protection (returns to 0 on release) | FBW | FORUM |
| α-floor (A.FLOOR → TOGA) | CONF 0: 9.5°; CONF 1/2: 15°; CONF 3: 14°; FULL: 13°. Inhibited above M0.6 | FBW (A320 values) | FORUM |
| α-prot / α-max | vary with config and Mach. Typical modelling values: α-prot ≈ α-floor − 1 to 2°, α-max ≈ α-floor + 1 to 2° (e.g. CONF FULL ≈ 12° / 15°; clean ≈ 8.5° / 11° at low Mach) | EST | EST |
| High-speed protection | starts at VMO + 6 kt / MMO + 0.01; with full nose-down stick, speed is held to ≈ VMO + 16 kt / MMO + 0.04 | FBW | FORUM |
| Normal law control | C* / load-factor demand, auto pitch trim, roll-rate demand ≈ 15°/s at full stick | FBW / FCOM-derived | FORUM |

## How to use this for tests

1. **Hard asserts (PUB):** check against the published numbers. These are 143 kN static thrust per engine, the ICAO fuel flows (1.067/0.873/0.286/0.094 kg/s at 100/85/30/7 %), VMO/MMO, VFE and VLE, the weights, fuel capacity and MAC. They belong in the config, so test them exactly.
2. **Stall and approach:** set 79.2 t, CONF FULL, 1 g level and slow down. VS1g should be 106 ± 4 kt, and a stabilised approach at 136 kt should hold about −3° with a sensible thrust (≈ 35–45 % N1 equivalent). Repeat at 60/70/80/90 t using the √W table in §3, with ±6 kt tolerance.
3. **Take-off:** at 80 t, 1+F, TOGA, ISA SL, check that rotation at about 146 kt and liftoff happen within ~1,300–1,500 m of ground roll. The AC TOFL (1,630 m at 80 t, 2,500 m at 97 t) is an upper bound that includes the 15 % or engine-out margin.
4. **Climb and cruise:** at 75 t CLB thrust, ROC should be about 2,000 fpm at 250 kt and FL50, about 1,500 fpm at 290 kt and FL150, and about 1,000 fpm at M0.78 and FL300. Level at FL350, M0.78 and 72 t, the fuel flow should settle at 1,050–1,250 kg/h per engine and the implied L/D at 16–17.5. Assert ranges, not points.
5. **Protections and ground:** a full aft stick at idle must hold α ≤ α-max and fire α-floor TOGA at the §8 angles. Full stick roll should stop at 67° and return to 33° on release. Pitch should clamp at +30/−15° and load factor at +2.5/−1 g clean (+2/0 with flaps). Rollout with autobrake MED should average 3.0 ± 0.3 m/s².
