# RKSS / RKPC / RKSI runway facts

Collected 2026-10-31. The primary source is the **Korean eAIP, AIRAC package effective 15 OCT 2026 (AIP AMDT 11/26)**, AD 2 pages:

- [A1] https://aim.koca.go.kr/eaipPub/Package/2026-10-15/html/eAIP/KR-AD-2.RKSS-en-GB.html
- [A2] https://aim.koca.go.kr/eaipPub/Package/2026-10-15/html/eAIP/KR-AD-2.RKPC-en-GB.html
- [A3] https://aim.koca.go.kr/eaipPub/Package/2026-10-15/html/eAIP/KR-AD-2.RKSI-en-GB.html

Other sources: [OA] OurAirports `reference/raw/ourairports/runways.csv`; [SV] skyvector.com/airport/<ICAO> (its headings are magnetic); [WP] en.wikipedia.org Gimpo / Jeju International Airport.

Conventions used in the tables:
- **True bearing** is the AIP AD 2.12 value.
- **Magnetic bearing** is computed here as true + W variation. The AIP gives no magnetic runway bearing. The results match SV's headings.
- **MEHT** is the PAPI minimum eye height over the threshold (AIP AD 2.14). It is not the ILS RDH.
- **Elevations** are metres, with feet in brackets.
- **TORA/LDA** are full-length values from AD 2.13. Intersection take-off rows are omitted.

---

## Gimpo RKSS [A1]

- **Aerodrome elevation:** 18 m (59 ft).
- **Magnetic variation:** 9° W (2025), increasing 0.039° per year. The navaids are declared at 9° W.
- **Coordinates:** the THR and end coordinates are in AD 2.12.

| RWY | True / Mag | Length × width (m) | TORA / LDA | Displaced THR | THR elev | TDZ elev | ILS | Approach lights | PAPI (MEHT) | TDZ lights | Centreline lights |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 14L | 135.01° / 144° | 3600 × 45 | 3600 / 3600 | none | 11.6 (38.0 ft) | 15.1 (49.5 ft) | CAT I (ISEL 109.90) | ALSF-II, 900 m | left, 3° (71.9 ft) | 900 m | **NIL** |
| 32R | 315.03° / 324° | 3600 × 45 | 3600 / 3600 | none | 12.8 (41.9 ft) | 13.8 (45.2 ft) | CAT I (ISKP 110.70) | ALSF-II, 900 m | left, 3° (67.6 ft) | 900 m | **NIL** |
| 14R | 135.00° / 144° | 3200 × 60 | 3200 / 3200 | none | 10.4 (34.1 ft) | 12.6 (41.3 ft) | **CAT II/III** (IOFR 108.70) | ALSF-II, 900 m | left, 3° (64.3 ft) | 900 m | 3200 m, 15 m spacing, white/red |
| 32L | 315.02° / 324° | 3200 × 60 | 3200 / 3200 | none | 12.6 (41.3 ft) | 12.9 (42.3 ft) | CAT I (IKMO 108.30) | **ALSF-I, 750 m** | left, 3° (64.3 ft) | **NIL** | 3200 m, 15 m, white/red |

All four ends have the following lighting:
- Green threshold lights, no wing bars.
- Edge lights: LIH, 60 m spacing, white with the last part yellow.
- Red end lights.
- No stopway lights.

Notes on the table:
- **GP angle and RDH:** these aren't printed in AD 2.19 for RKSS. Assume 3° to match the PAPI; for the RDH, check the IAC charts.
- **Surface:** 14L/32R is asphalt, except 156 m from THR 14L and 151 m from THR 32R, which are concrete and not grooved. The rest of the runway is grooved.
- **Runway levels:** the runways sit at different levels, so an aircraft may not be visible from the opposite end.
- **Displaced thresholds:** the current AIP shows none, since TORA = LDA on every end. The "Gimpo displaced thresholds" idea doesn't hold for AMDT 11/26. Historical or temporary displacements came by NOTAM. The concrete end pads on 14L/32R are the only end feature you can see.

### Runway use (AD 2.20 §2.5)

- **RWY 14 flow:** take-off on 14L, landing on 14R.
- **RWY 32 flow:** departure and arrival runways swap every 3 h. In 2100-2359 UTC, departures use 32R and arrivals 32L. In 0000-0259 UTC it's 32L for departures and 32R for arrivals, and so on.
- Intersection take-off isn't normally available.
- [WP] adds no runway use detail beyond this.

### Taxiways (AD 2.8)

- **Main parallel:** P.
- **Connectors:** A, B1/B2, C1-C3, D1-D3, E1/E2, F1/F2, G1/G2, W1/W2, plus R.
- **Widths:** mostly 30-35 m. G2 is 40 m and F1 is 23 m.
- **Taxiway lights:** edge lights on all taxiways. Centreline lights on all except W1, W2 and part of R.

---

## Jeju RKPC [A2]

- **Aerodrome elevation:** 36 m (118 ft).
- **Magnetic variation:** 8° W (2025), increasing 0.042° per year.

| RWY | True / Mag | Length × width (m) | TORA / LDA | Displaced THR | THR elev | TDZ elev | ILS | GP / RDH | Approach lights | PAPI (MEHT) | TDZ lights | Centreline lights |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 07 | 058.46° / 066.5° | 3180 × 45 | 3180 / 3180 | none | 26.6 | 26.6 | **CAT II** (ICJU 109.9) | 3°, RDH 17.98 m (59 ft) | ALSF-II, 900 m | left, 3° (61 ft) | 900 m | 3180 m, 15 m, white/red |
| 25 | 238.47° / 246.5° | 3180 × 45 | 3180 / 3180 | none | 23.3 | 23.6 | CAT I (ICHE 111.3) | 3°, RDH 15.54 m (51 ft) | SSALF, 420 m | left, 3° (59 ft) | NIL | 3180 m, 15 m, white/red |
| 13 | 125.62° / 133.6° | 1900 × 45 | 1900 / 1900 | none | 20 | - | none | - | NIL | NIL | NIL | NIL |
| 31 | 305.63° / 313.6° | 1900 × 45 | 1900 / **1489** | **411 m** | 36 at the runway end, **32 at the displaced THR** | - | none | - | SSALF, 450 m | **both sides, 3.5°** (52.3 ft) | NIL | NIL |

Lighting:
- **07/25:** green threshold lights with green wing bars.
- **13/31:** green threshold lights and no wing bars.
- **All runways:** edge lights LIH, 60 m spacing, white/yellow, with red end lights.
- **RWY 31** has circling guidance lights (CGL).

Notes on the table:
- **07 and 25 ILS:** the LOC is 3485 m from the threshold. The GP antenna is 353 m from THR 07 and 309 m from THR 25.
- **RWY 13/31 status:** open, but secondary. It has no shoulders and is asphalt. The 13 row in AD 2.13 is remarked "Only Helicopter usable", so fixed-wing aircraft land only on 31, from the displaced threshold. The taxi-route tables list "RWY 31" as a runway in use, with a back-track via E.
- **Grooving:** all runways are grooved except the first 225 m from THR 07, 200 m from THR 25, 300 m past the RWY 31 displaced threshold, and 596 m from THR 13.
- **Usual use:** 07/25 is primary. The taxi-route tables are given for RWY 07, 25 and 31.

### Taxiways (AD 2.8)

- **Main parallel:** P, with exits P1-P13. The preferred rapid exits from 07 are P6 (1520 m) and P5 (1750 m).
- **Others:** G1-G4, A, B, E/E1-E3, V/V1/V2, W and R.
- **Widths:** 30 m standard. E is 45 m, G2 is 63 m and G1 is 51 m.

---

## Incheon RKSI [A3]

- **Aerodrome elevation:** 7 m (23 ft).
- **Magnetic variation:** 9° W (2025), increasing 0.04° per year. The ILS is declared at "9° W or 351°".

| RWY | True / Mag | Length × width (m) | TORA / LDA | THR = TDZ elev | ILS | Approach lights | PAPI (MEHT) | TDZ lights | Centreline lights | Stopway |
|---|---|---|---|---|---|---|---|---|---|---|
| 15L | 144.66° / 153.7° | 3750 × 60 | 3750 / 3750 | 6.9 (22.6 ft) | CAT III (ISLL 111.90) | ALSF-II, 900 m | left, 3° (64.64 ft) | 900 m | 3750 m, 15 m, white/red | 120 × 60 m, red stopway lights |
| 33R | 324.67° / 333.7° | 3750 × 60 | 3750 / 3750 | 6.9 (22.6 ft) | CAT III (INRR 108.90) | ALSF-II, 900 m | left, 3° (64.64 ft) | 900 m | same | same |
| 15R | 144.66° / 153.7° | 3750 × 60 | 3750 / 3750 | 6.9 (22.6 ft) | CAT III (ISRR 109.10) | ALSF-II, 900 m | left, 3° (64.64 ft) | 900 m | same | same |
| 33L | 324.67° / 333.7° | 3750 × 60 | 3750 / 3750 | 6.9 (22.6 ft) | CAT III (INLL 109.30) | ALSF-II, 900 m | left, 3° (64.64 ft) | 900 m | same | same |
| 16L | 144.66° / 153.7° | **4000** × 60 | 4000 / 4000 | 7.0 (22.9 ft) | CAT III (IRKS 110.35) | ALSF-II, 900 m | left, 3° (67.14 ft) | 900 m | 4000 m, 15 m | same |
| 34R | 324.67° / 333.7° | 4000 × 60 | 4000 / 4000 | 7.0 (22.9 ft) | CAT III (IRKN 108.10) | ALSF-II, 900 m | left, 3° (67.14 ft) | 900 m | same | same |
| 16R | 144.66° / 153.7° | 3750 × 60 | 3750 / 3750 | 7.0 (22.9 ft) | CAT III (IRFS 108.55) | ALSF-II, 900 m | left, 3° (67.14 ft) | 900 m | 3750 m, 15 m | same |
| 34L | 324.67° / 333.7° | 3750 × 60 | 3750 / 3750 | 7.0 (22.9 ft) | CAT III (IRFN 109.95) | ALSF-II, 900 m | left, 3° (67.14 ft) | 900 m | same | same |

General runway notes:
- **Thresholds:** none are displaced.
- **GP:** 3° on every ILS. The RDH isn't printed in AD 2.19; it's on the IAC charts.
- **Declared distances:** TODA is 4050 m (16L/34R 4300 m) and ASDA is 3870 m (4120 m).
- **Lights:** green threshold lights with green wing bars. Edge lights 60 m apart, white/yellow, with red end lights.
- **Surface:** all runways are grooved.
- **Runway ends:** the pavement is asphalt with concrete ends. The concrete extends 300 m on 15/33, 700 m on 16L/34R and 842 m on 16R/34L, which you can see as a colour change.

### Runway use (AD 2.22 §1.5 and §1.7)

- **Preferential runways:** 33L/R and 34L/R are used up to an 8 kt tailwind.
- **Runway roles (0000-2359 UTC):** departures use **15R/33L and 16L/34R**, and arrivals use **15L/33R and 16R/34L**.
- **Nightly maintenance closure (1500-1900 UTC):** 15/33 closes on odd-numbered days and 16/34 on even-numbered days.

### Taxiways (AD 2.8)

- **Parallels:** A, B, C, D, M, N and P, all 30 m wide (M varies 23-30 m).
- **Rapid exits:** B2-B5 and N2-N5.
- **Crossings and connectors:** G, J, K, L and S, plus A4-A19, N7 and M5-M17.
- **Snow-clearance priorities:** first B, D and N with RWY 15R/33L and 16L/34R; second A, C, M and P.

---

## Where other sources disagree with the AIP

- **[OA] Jeju 13/31:** OA gives 6268 ft (1910 m), and [WP] says 1910 m. The AIP says **1900 m**.
- **[OA] Jeju displaced threshold:** OA's `he_displaced_threshold_ft` of 1350 ft = 411.5 m on 31 matches. OA's 31 elevation of 105 ft is the displaced-threshold elevation (32 m). The runway end is 36 m (118 ft).
- **[OA] Jeju 13/31 status:** OA marks 13/31 `closed=0`, which is right, but nothing in OA shows that RWY 13 landing is "helicopter only".
- **[OA] Incheon 16L/34R:** the threshold elevations are blank. The AIP gives 7.0 m (22.9 ft).
- **[OA] headings:** OA headings are true and rounded (135/315 at Gimpo, 145/325 at Incheon). They match the AIP within 0.3°. [SV] headings are magnetic (144/324, 153/333, 066/246, 133/313).
- **[SV] Incheon:** SV marks the surface of 15/33 and 16R/34L as "unknown". The AIP says asphalt with concrete ends.
- **Gimpo:** there are no displaced thresholds in OA, SV or the current AIP.
