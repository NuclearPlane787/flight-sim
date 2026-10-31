# A320-family fly-by-wire, autopilot and autothrust: an implementer's summary

Research notes for the flight-sim (Normal and Alternate law, holds-only AP/A-THR). Compiled 2026-10-31 from public secondary sources: FlyByWire A32NX docs, code7700 (quoting the Airbus FCTM), theflyingengineer, Airbus Safety First, BEA, FAA SAFO, PPRuNe threads quoting the FCOM, and study flashcards. The FCOM itself was not reachable (403/paywalled).

**Confidence tags:** **[S]** means two or more sources agree, or the figure comes from FCTM/FCOM text quoted directly. **[F]** means forum or flashcard only. **[K]** means general type knowledge with no source fetched in this session. Treat [F]/[K] as tunable defaults.

---

## 1. Normal law, pitch

### Flight mode: load-factor (C*-like) demand
- **Stick demand.** The sidestick commands load factor with neutral speed stability [S]. At low speed it behaves as a pitch-rate demand, and at high speed as a flight-path-rate / g demand (FCTM via code7700) [S].
  - Airbus does not publish the blend. A classic C* blend is fine: `C* = Δnz + (Vco/g)·q`, with a crossover speed Vco of roughly 120 m/s [K].
- **Stick to nz.** The stick maps to the demanded nz proportionally, and the mapping is independent of speed [S, flashcards].
  - Neutral stick gives 1 g, corrected for attitude [S]. Neutral stick holds the flight path (the "1 g flight path"), so with the stick released the path stays put through speed, thrust and configuration changes.
  - Implementation: neutral stick means `nz_cmd = cosθ/cosφ`, with bank compensation up to 33°.
  - Full aft = **+2.5 g** clean / **+2.0 g** with slats or flaps out [S].
  - Full fwd = **−1.0 g** clean / **0 g** with slats or flaps out [S].
  - A simple map: `nz_cmd = 1 + stick·(nzMax−1)` aft and `1 + stick·(1−nzMin)` forward, then clamp. These clamps are the **load-factor protection**, and Alternate law keeps them.
- **Auto-trim (THS).**
  - Auto-trim moves the THS so elevator returns toward neutral. The trim wheel moves with it [S]. No trimming is needed for speed, configuration or bank up to 33° [S].
  - Auto-trim freezes in these cases [S/K]:
    - α-prot active (it stops nose-up trim)
    - high-speed prot active (it stops nose-up trim)
    - bank > 33° (the pilot must then hold back pressure, which is the tactile cue)
    - nz < 0.5 g [K]
    - flare mode / below 50 ft RA
    - manual trim
  - THS travel is roughly +13.5° nose-up / −4° nose-down [K].
- **Pitch attitude limits** [S, FBW docs + FCTM]:
  - Nose-up: **+30°** in CONF 0–3, reduced to **+25°** at low speed. In CONF FULL: **+25°**, reduced to **+20°** at low speed.
  - Nose-down: **−15°**.
  - Implementation: the limit is soft. The demanded pitch rate fades over the last ~5° before the limit [S].
  - The FD bars disappear above +25° / −13° and come back at +22° / −10° [S].

### Protections
- **High AoA (α-prot / α-max)** [S]:
  - When α > α-prot, pitch control switches from nz demand to **α demand**. Stick neutral holds α-prot, and full aft holds **α-max**. α-max sits just short of the 1 g stall.
  - Auto-trim stops, so releasing the stick holds α-prot. The aircraft cannot be stalled in Normal law.
  - Exit: push the stick forward. The FCOM figure is reported as more than about 8° forward, or a small forward input when α < α-max [K].
  - Bank limit while active is **45°** [S].
  - Displays: α-prot is the top of the amber/black strip on the speed tape, α-max the top of the red strip [S].
- **α-floor (A/THR)** [S, FBW docs + BEA]:
  - TOGA thrust is commanded regardless of lever position when **α > α-floor**:
    | CONF | α-floor |
    |---|---|
    | 0 | 9.5° |
    | 1 and 2 | 15° |
    | 3 | 14° |
    | FULL | 13° |
  - It also triggers on high pitch / α-prot combined with **sidestick > 14° nose-up** [S, BEA report].
  - Active from lift-off until 100 ft RA on approach.
  - Inhibited above M 0.6 [S, FBW]. Also inhibited after a long A/THR-disconnect press, and in some engine-out/configuration cases [K].
  - FMA column 1 shows **A.FLOOR** (green, flashing amber box). Once α drops roughly 3° below the trigger, it becomes **TOGA LK** (green, flashing amber box): thrust stays locked at TOGA [S, BEA/Air France].
  - TOGA LK exit: disconnect A/THR (instinctive pb), then set the levers [S].
- **High-speed protection** [S]:
  - Starts at **VMO+6 kt / MMO+0.01**. One FBW passage says MMO+0.015, and later software standards vary.
  - From there a positive nz (nose-up) demand is added, up to about **+1.75 g** of authority (FCTM).
  - Nose-down authority fades to zero, so full forward stick stabilises near **VMO+16 / MMO+0.04**. With the stick released the aircraft returns to about VMO.
  - Also while active:
    - auto-trim freezes
    - **spiral stability to 0°**: wings return to level on release
    - bank limit 40° on A320 per FBW (45° per the A330 FCTM)
    - AP disconnects (at VMO+15 / MMO+0.04 per FBW) [S]
- **Load factor:** the clamps given above. The ECAM G LOAD reading turns amber outside 0.7–1.4 g for more than 2 s [S, FBW].

### Ground, take-off transition, flare, landing
- **Ground mode** [S]:
  - Direct stick-to-elevator with full authority and no auto-trim. The THS stays where it was set for take-off.
  - Sidestick travel is about ±16° in pitch and ±20° in roll [S].
- **Lift-off to flight mode** [F]:
  - Flight mode **blends in over about 5 s**. PPRuNe quoting the FCOM: once pitch exceeds about 8° in ground mode, a 5 s blend from ground mode to flight mode starts in pitch and roll.
  - Airbus GNC 2024 paper: pitch and RA thresholds are used as well, because weight-off-wheels arrives late [S].
  - Implementation: `w = clamp((t - tLiftoff)/5, 0, 1)` and `elev = (1-w)·direct + w·law`.
- **Flare mode** [S for 50 ft, F for the 30 ft / −2° / 8 s detail]. This is the A320 ceo description; the A321neo reportedly differs.
  - At **50 ft RA** the pitch attitude is memorised and becomes the reference, and pitch trim freezes. The law becomes essentially direct, attitude-referenced stick to elevator.
  - At **30 ft RA** the system starts adding a nose-down order that drives the reference down to **−2° pitch over 8 s**. The pilot must therefore pull progressively to flare.
  - The −2° appears to be an absolute attitude target, not a 2° change from the memorised value [F].
  - The A330 FCTM puts flare entry at 100 ft. With AP engaged, entry is also higher [S, code7700].
- **Touchdown:** the law reverts progressively to ground mode. The pitch reference resets once the nose gear is down [S].
- **Go-around:** above 50 ft RA the law returns to flight mode [K].

---

## 2. Normal law, roll and yaw
- **Roll rate.** The stick commands roll rate, proportional to deflection, with a **maximum of 15°/s at the stop**. This holds at any speed or configuration [S, FCOM DSC-27-20-10-30 quoted on PPRuNe].
- **Bank hold.** With the stick neutral, bank is held at any value up to **33°** (zero roll-rate demand) [S].
- **Spiral stability above 33°.** On release, the aircraft rolls back to 33° [S]. Pitch compensation (the 1/cosφ term) and auto-trim stop above 33° [S].
  - Implementation: `p_cmd += -k·(φ - 33°·sign φ)` when |φ| > 33° and the stick is neutral. k is about 0.3–0.5 /s [K].
- **Bank limits.** **67°** with full lateral stick. Roll rate tapers as the limit nears and stops at it [S].
  - **45°** with high-AoA protection active [S].
  - **40°** (A320, FBW) or 45° (A330, FCTM) with high-speed protection active, plus spiral stability to 0° [S].
  - The AP disconnects above 45° and the FD bars return below 40° [S].
- **Yaw.** The FACs give **turn coordination and yaw damping**. No pedal input is needed in Normal law [S]. Turn coordination applies in the 0–33° bank region [F].
  - Yaw-damper authority is quoted as about ±4° of rudder in CONF 0 and ±15° in other configurations [F].
  - Rudder travel limiting with speed exists [K].
  - In the simplest model, yaw damping drives sideslip to 0.

---

## 3. Alternate law (ALTN 1 / ALTN 2)
Entered after certain double failures (for example double hydraulic, or ADR faults). Sources: code7700 and FCTM [S]. The BA919 A320 incident of July 2026 (ADR failure leading to Alternate law and two stall warnings, AAIB investigating) illustrates the case.

| Feature | Normal | Alternate |
|---|---|---|
| Pitch law | nz demand + auto-trim | **same** nz demand + auto-trim (feel nearly identical) |
| Load-factor limit | yes | **kept** (+2.5/−1 clean, +2/0 flaps) |
| High AoA protection | α-prot / α-max | **lost**. Replaced by **low-speed stability** and **stall warning** |
| α-floor | yes | lost [K] |
| Pitch attitude prot | yes | **lost** |
| High-speed prot | yes | **lost**. Replaced by **high-speed stability**: a nose-up demand the pilot can override, plus the overspeed warning [S] |
| Roll | rate demand + bank prot | ALTN 1: like Normal [S/K]. ALTN 2: **roll direct** (very sensitive, no bank stability) [S]. One forum says roll rate up to 30°/s in Alternate [F] |
| Landing | flare mode | Gear down gives **direct law** in pitch (FCTM: reverts to direct at 100 ft RA). "USE MAN PITCH TRIM" [S] |

- **Low-speed stability** [S]: a gradual nose-down demand starts about **5–10 kt above VSW**, depending on weight and configuration. The pilot can override it.
- **Stall warning** [S]:
  - Speed: **VSW ≈ 1.03 VS1g**. It is g-sensitive, so scale it by √nz in turns.
  - Speed-tape display: the amber/black α-prot strip and the red α-max strip are replaced by one **red/black VSW strip**.
  - Aural: **"STALL, STALL"** plus a cricket. In practice it triggers on per-configuration AoA thresholds [K].
  - In Normal law the protections make it moot.
- **PFD cues:** the green "=" protection marks on the attitude scale become **amber ×** marks [K].
- **Direct law** (for completeness):
  - Surfaces move in proportion to the stick. There is no auto-trim or AP, and the protections are gone.
  - The overspeed and stall warnings remain [S].

---

## 4. Holds-only AP / FD / A/THR

### FMA layout [S]
Five columns:

| Column | Shows |
|---|---|
| 1 | A/THR mode |
| 2 | AP/FD vertical |
| 3 | AP/FD lateral |
| 4 | approach capability / minimums |
| 5 | AP / FD / A/THR engagement status |

Rows and colours:
- **Row 1: active modes in green.**
- **Row 2: armed modes in blue (cyan).** Armed modes driven by a constraint show in **magenta**.
- Row 3 holds messages such as "LVR CLB" (flashing white), "MAN PITCH TRIM ONLY" (red) and "USE MAN PITCH TRIM" (amber).
- A newly engaged mode gets a **white box for 10 s** [K].
- In column 1, **MAN TOGA / MAN FLX xx / MAN MCT / MAN THR** show white and boxed when the A/THR is armed but not active [S].
- Column 5 shows `AP1` / `AP2` / `AP1+2`, `1FD2`, and `A/THR`. A/THR is **white when active and blue when armed** [S].

### Vertical modes (holds-only subset)
| Mode | Elevator holds | A/THR mode | Notes |
|---|---|---|---|
| **ALT** | FCU altitude | SPEED/MACH | green |
| **ALT\*** | capture path toward FCU altitude | SPEED/MACH | Engaged when the capture criterion is met (start the capture at a distance proportional to V/S, e.g. Δh ≈ \|V/S\|/k). Switches to ALT inside about ±20 ft [K] |
| **V/S** (or FPA) | selected V/S | SPEED/MACH | Pitch overrides the V/S target if speed reaches VLS or VMAX [S] |
| **OP CLB** | **speed/Mach target via pitch** | **THR CLB** | Pull the ALT knob with the FCU altitude above the aircraft [S] |
| **OP DES** | **speed/Mach target via pitch** | **THR IDLE** | Pull with the FCU altitude below. Ignores altitude constraints [S] |

- Reversions [K]:
  - If you pass the FCU altitude while in OP CLB/OP DES (the FCU altitude is reset past it), the mode reverts to V/S at the current rate.
  - With no AP/FD pitch mode active, the A/THR reverts to SPEED/MACH [S].

### Lateral modes
- **HDG** or **TRK** (the HDG-V/S ↔ TRK-FPA pushbutton toggles them).
  - Pull the knob to engage. Turn toward the target by the shortest way, at a commanded bank limit of about 25–30° [K].
- The AP engages from 100 ft RA after take-off, about 5 s after lift-off [K].

### A/THR (FADEC + FMGC) [S]
- **Active range:** thrust levers between **IDLE and CL**. With one engine out, the range runs up to MCT.
  - The **lever position caps** the A/THR thrust, except under α-floor.
- **Below CL with A/THR active:** an "A/THR LIMITED" caution repeats every 5 s and **LVR CLB** flashes. **LVR ASYM** shows when only one lever is in the detent [S].
- **Levers above CL (MCT/FLX/TOGA):** manual thrust at the detent rating, with the A/THR **armed** (blue).
  - On the ground, setting FLX or TOGA arms the A/THR. Bringing the levers back to CL after take-off activates it ("LVR CLB" flashes until then) [S].
  - A lever between two detents gets the rating of the higher detent [S].
- **Modes:** SPEED, MACH, THR CLB, THR IDLE, THR MCT, THR LVR (one-engine) [S/K].
- **Disconnect:**
  - **Instinctive pb** on the levers: master caution ≤3 s, ECAM "A/THR OFF" ≤9 s, single chime [S]. Holding it more than 15 s disconnects the A/THR (α-floor included) for the rest of the flight [S].
  - The FCU A/THR pb.
  - **Both levers to IDLE** [S].
  - A failure.
- **THR LK:** the A/THR is lost (FCU pb or failure) with the levers in the CL (or MCT) detent [S].
  - Thrust **freezes at its current value**.
  - **"THR LK" flashes amber** on the FMA.
  - ECAM shows "ENG THRUST LOCKED" and "THR LEVERS … MOVE", with a chime and master caution every 5 s.
  - Moving the levers out of the detent restores manual thrust.

### AP disconnect and warnings [S]
- **Instinctive disconnect** (red takeover pb on the sidestick):
  - red master warning ≤3 s
  - "AP OFF" ≤9 s
  - **cavalry charge** of 0.5–1.5 s (pressing again silences it)
- **Involuntary disconnect** (failure, or exceeding limits such as bank > 45°, high-speed prot or α-prot):
  - red master warning flashing
  - "AUTO FLT AP OFF"
  - **continuous cavalry charge**, at least 1.5 s, until acknowledged by the takeover pb [S]
- **Stick or pedal force** above a threshold also disconnects the AP. The threshold is a few daN; a sim can use something like |stick| > 0.3 sustained [K]. It counts as an instinctive-style takeover, which the FCOM permits but does not recommend.

---

## 5. Thrust levers [S, PPRuNe/FAA SAFO/sim-hardware]
| Detent | TLA |
|---|---|
| MAX REV | ≈ −20° (no hard detent) |
| REV IDLE | just below 0° (≈ −4° to −6°) [K] |
| **IDLE** | **0°** |
| **CL** | **25°** |
| **FLX/MCT** | **35°** |
| **TOGA** | **45°** |

- **Manual thrust between detents:** N1 is roughly proportional to TLA between the detent ratings [K].
- **RETARD callout** [S, FCOM via forum + FCTM]:
  - **Manual landing:** "RETARD" sounds at **20 ft RA**. It repeats until the levers reach idle [F]. It is a reminder, not an order.
  - **Autoland:** the call comes at **10 ft RA** (A/THR active, AP in LAND). The A/THR itself commands idle in the flare.
  - Hazard to model: if the levers stay at CL with the A/THR active, the A/THR holds Vapp and adds thrust in the flare. The ground spoilers then may not deploy.

---

## 6. Ground spoilers [S/F, study cards citing FCOM DSC-27-10-20]
- **Armed:** the speedbrake lever is pulled up into ARM.
- **Full extension, armed, on landing:** both main gear on ground (or wheel speed > 72 kt), with both levers at or near IDLE. Some standards accept "≤ CL"; check the FCOM.
- **Full extension on a rejected take-off:** armed, above 72 kt, with both levers at IDLE. If not armed, selecting reverse gives the extension (the backstop below).
- **Not armed:** the spoilers extend fully **when reverse is selected on at least one engine** (the other at idle) with both main gear on ground. This is the backstop [S].
- **Partial extension (phased lift dumping, ≈10°):** one main gear compressed, and either:
  - armed with both levers at IDLE, or
  - not armed with reverse on one engine and the other lever at or below idle.

  The partial deflection loads the second strut, which then gives full extension [F].
- **Retraction:** disarm, or advance a lever above about 20° TLA (touch-and-go) [K].

---

## 7. Flaps/slats, 1+F [S/F]
| Lever | Config (A320ceo) | VFE [K] |
|---|---|---|
| 0 | clean | VMO 350 / MMO 0.82 |
| 1 | **1** (slats only) in flight. **1+F** on take-off / at low speed | 230 (1) / **215 (1+F)** |
| 2 | 2 | 200 |
| 3 | 3 | 185 |
| FULL | FULL | 177 |

- **1+F logic:**
  - Lever at 1 on the ground or **below 100 kt** gives **1+F** [S].
  - Lever moved 2 → 1 in flight below about 210 kt gives 1+F. Lever moved 0 → 1 in flight gives slats only.
  - Once the flaps have retracted, 1+F is not available again until IAS ≤ 100 kt, unless CONF 2/3/FULL was selected [S, FBW].
- **Auto-retraction (ARS):** in 1+F, the **flaps (not the slats) retract automatically at 210 kt** [S]. They re-extend if speed drops back below 210 kt with the lever still at 1 [K].
- **α / speed lock:** slat retraction 1 → 0 is inhibited when α > 8.5° or IAS < 148 kt [F].
- **VLE:** 280 kt / M 0.67 [K].

---

## 8. PFD speed tape [S unless tagged]
- **VLS:** top of the **amber strip**. It is the lowest speed the AP/A/THR will accept.
  - VLS ≈ **1.23 VS1g** with slats or flaps out, **1.28 VS1g** clean (A320 family: k between 1.23 and 1.28).
- **α-prot:** top of the **black/amber barber strip** (Normal law).
- **α-max:** top of the **red strip** (Normal law).
- **VSW:** red/black strip in Alternate/Direct law.
- **VMAX:** bottom of the **red/black barber pole** at the top of the tape. It is the lowest of VMO/MMO, VLE and VFE.
- **VFE next:** amber **"="** mark, shown below 15,000 ft [K]. It is the VFE of the next configuration.
- **Green dot:** clean configuration (lever 0) only. It is the best lift-to-drag / engine-out operating speed. Rough formula: 2·weight(t) + 85 kt below FL200 [K].
- **S:** green "S", shown with the lever at 1. It is the minimum speed for retracting the slats (≈ 1.23 VS1g of the clean configuration) [K].
- **F:** green "F", shown with the lever at 2 or 3. It is the minimum speed for retracting the flaps (≈ 1.22 VS1g of CONF 1+F) [K].
- Also on the tape:
  - **target speed triangle:** magenta = managed, blue = selected
  - **speed trend arrow:** 10 s prediction [K]
  - V1 / VR in take-off

---

## 9. Implementation sketch (pitch loop)
```
if onGround && !blending:        elev = stick*maxElev                    // ground mode
else if flare (RA<50):           theta_ref = theta50 then (RA<30) ramp to -2° over 8 s;
                                 elev = Kp*(theta_ref + stick*Δθ - θ) + ... ; trim frozen
else:  // flight mode
  if law==NORMAL && alpha>alphaProt: alpha_cmd = lerp(alphaProt, alphaMax, max(stick,0)); track α
  else: nz_cmd = cosθ/cosφ(|φ|<=33) + map(stick, nzMin..nzMax); add highSpeedNoseUp(V)
        clamp nz_cmd to load-factor limits; NORMAL: clamp θ to +30/25 / -15 with fade
        ALTN: add lowSpeedStability nose-down near VSW; stall warning at α_sw
  C*-style PI on (nz_cmd - nz) + q damping; integrator offload -> THS (auto-trim) unless frozen
```
Roll: `p_cmd = 15°/s * stick` (Normal), plus spiral stability above 33° (or toward 0° in high-speed prot), then clamp at 67/45/40°. ALTN 2: `aileron ∝ stick`.

---

## Sources
- [FlyByWire A32NX: Normal Law Protections overview](https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-advanced-guides/protections/overview/): α-floor per configuration, high-speed protection numbers, g limits, pitch and bank limits
- [FlyByWire A32NX: A.FLOOR / TOGA LK](https://docs.flybywiresim.com/pilots-corner/a32nx/a32nx-advanced-guides/protections/afloor/)
- [FlyByWire A32NX: flaps (1+F re-selection)](https://docs.flybywiresim.com/pilots-corner/a32nx-briefing/flight-deck/pedestal/flaps/)
- [code7700: Airbus control laws (quotes the A330/340 FCTM)](https://code7700.com/airbus_control_laws.htm): Normal/Alternate/Direct, high-speed nose-up of 1.75 g, VSW = 1.03 VS1g
- [The Flying Engineer: Airbus autoflight](https://theflyingengineer.com/projects/airbus-tech/autoflight/): A/THR range, THR LK, disconnect warnings, FMA columns
- [BEA: A318/A321 Air France incidents, 2017 (α-floor at sidestick > 14°, TOGA LK)](https://bea.aero/en/investigation-reports/notified-events/detail/incident-to-the-airbus-a318-registered-f-gugb-on-28-03-2017-at-paris-charles-de-gaulle-and-the-airbus-a321-registered-f-gtat-occured-on-30-03-2017-at-toulouse-blagnac-31-and-operated-by-air-france/)
- [FAA SAFO 07007 (A320 thrust lever detents)](https://www.faa.gov/sites/faa.gov/files/other_visit/aviation_industry/airline_operators/airline_safety/SAFO07007.pdf)
- [PPRuNe: TAM A320 Congonhas post (TLA angles 0/25/35/45, reverse to −20°)](https://www.pprune.org/3439864-post559.html)
- [PPRuNe: A320 flare mode vs ground mode (FCOM flare text: 50 ft, 30 ft, −2°, 8 s)](https://www.pprune.org/tech-log/525282-a320-flare-mode-vs-ground-mode.html), [landing mode thread](https://www.pprune.org/archive/index.php/t-548625.html), [A321neo variant](https://www.pprune.org/10536532-post28.html)
- [PPRuNe: A32X flight control laws switching (8° pitch / 5 s blend)](https://www.pprune.org/archive/index.php/t-583935.html)
- [PPRuNe: A320 roll function (FCOM DSC-27-20-10-30, 15°/s)](https://www.pprune.org/archive/index.php/t-654842.html)
- [CEAS EuroGNC 2024-068 (Airbus ground-to-flight transition thresholds)](https://eurognc.ceas.org/archive/EuroGNC2024/pdf/CEAS-GNC-2024-068.pdf)
- [Airbus Safety First: A focus on the landing flare (RETARD reminder, levers left in CL)](https://safetyfirst.airbus.com/a-focus-on-the-landing-flare/)
- [PPRuNe: A320 family autoland (RETARD at 10 ft in autoland)](https://www.pprune.org/tech-log/print-402922-a320-family-autoland.html)
- [PPRuNe: A320 low speed stability](https://www.pprune.org/tech-log/367596-a320-low-speed-stability-2.html)
- [Migflug: BA A320 Alternate-law stall warnings, AAIB 2026](https://migflug.com/jetflights/british-airways-a320-alternate-law-stall-heathrow-aaib-2026)
- [Aviationhunt: A320 operating speeds (VLS, green dot, F/S)](https://www.aviationhunt.com/?p=4998), [SKYbrary bookshelf 4071](https://skybrary.aero/sites/default/files/bookshelf/4071.pdf)
- Ground spoilers and α-lock: Brainscape study decks ([speedbrakes/spoilers](https://brainscape.com/flashcards/speed-brakes-spoilers-1-even-odd-12184119/packs/21075935), [flight controls](https://brainscape.com/flashcards/systems-flight-controls-16368698/packs/22178234)), [PPRuNe: speedbrakes armed during T/O](https://www.pprune.org/tech-log/581995-point-speedbrakes-armed-during-t-o-a320.html)
- Open-source reference implementation worth reading (not reviewed in this session): [FlightGear A320-family a320-fbw.xml](https://git.nayala.duckdns.org/fly/A320-family/raw/commit/08ddfc86646ef4300ea73ec9edeb3eae3b47d798/Systems/a320-fbw.xml)
