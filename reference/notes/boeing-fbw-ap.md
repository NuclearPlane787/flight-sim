# Boeing 777/787 fly-by-wire, autothrottle and AP: an implementer's summary

Research notes for `src/sim/fbw-boeing.js` and `src/sim/autopilot-boeing.js`. Compiled 2026-11-04. The FCOMs themselves weren't reachable, so this rests on secondary sources.

**Tags:** **[R]** a page or document read directly. **[S]** only a search-engine extract of the page: the full page refused the fetch (PPRuNe and AVSIM answer 403 to a plain user agent; stopped there, and no browser was faked). **[K]** general type knowledge, no source fetched. **[B]** set by the v0.3.0 brief. **[EST]** tuned here. Treat [S], [K] and [EST] as tunable defaults. To check them against an FCOM, look in its Flight Controls and Automatic Flight chapters.

## 1. C*U pitch law
- C*U is a modified C* law that also senses whether the aircraft is trimmed for speed: it lowers or raises the nose as the speed moves off the trim speed. Boeing wanted positive speed stability in pitch. [S: Leeham, Bjorn's Corner Part 3; PPRuNe "B777 pitch control", as C*U = C* + K·(Vref − V)]
- In flight the trim switches don't move the stabiliser: they change the trim reference speed, "the speed at which the airplane would eventually stabilize" with no column input. On the ground they position the stabiliser. [R: Brainscape B777 flight controls, cards 15; S: PPRuNe "B777 Speed Trim", AVSIM]
- The primary trim switches are inhibited with the AP engaged. [R: Brainscape, cards 14, 18]

**In the sim:** the method is `fbw.js`'s inversion. Hands off, an energy loop: `aWant = −K(ias − vRef)`, `sin γcmd = (fAlong/m − aWant)/g`, low-passed 5 s, `nz` from `γcmd − γ`. Stick adds `nz` on top. KSPD 0.055/s, KGAM 0.5/s, GAM_TAU 5 s [EST, tests/boeing-law.test.mjs].

## 2. Trim rate
About **10 kt/s** of reference speed, constant across the range, with a blip function when nearly trimmed; rule of thumb "one second per 10 kt". [S: AVSIM "fbw trim reference speed", PPRuNe "777 Speed Trim"; pilots' posts, one warns that simulators differ.] The brief guessed 3–4 kt/s and asked for a figure; the sim uses 10 (`TRIM_RATE`, one constant, a key tap is about 1 kt). No blip logic.

## 3. The protections
- **Stall:** "limits the speed to which the airplane can be trimmed": nose-up trim is inhibited at about the minimum manoeuvring speed (top of the amber band; at altitude it can differ by 10 to 20 kt). Below it the pilot must hold continuous aft pressure, at higher than normal force. [R: SmartCockpit 787 flight-controls quiz; Brainscape card 19]
- **Overspeed:** limits the trim to VMO/MMO. Above it the pilot must hold continuous forward pressure, about twice the normal force. [R: same; Brainscape card 20]
- **Bank:** past the boundary the wheel force rolls the aircraft back within 30°; the pilot can override, and full wheel always commands full roll authority. The AP disengage bar disables it. The boundary: the 787 quiz offers 35°, 37.5° and 40° with the answer unmarked; a 777 quiz extract says 35°. [R: SmartCockpit; S: 777 quiz] Brief: 35° and 30°. [B]
- **Not in the sources, chosen here [EST]:** vmm = 1.3 VS1g (`A.VMM_FACTOR`, top of the amber band [B]); the nose-down demand below vmm (0.05 g per m/s, at most 0.35 g); the push above VMO/MMO (0.09 g per m/s, at most 0.5 g), forward stick worth 0.6; the wheel worth 0.4 past 35°, roll back 0.25/s against it. The shaker is at `alphaMax − ALPHA_SW_MARGIN`, so it's g-sensitive. A held pull mushes at most 4° past α max (the Airbus's post-stall Cm would otherwise be cancelled by the inversion, giving a deep stall).
- No alpha floor. No flare law [B]. A/T retard: see §4.

## 4. Autothrottle automatic activation ("wake-up")
- "Usually, the autothrottle, if armed, will provide stall protection even when it is not engaged": near stick shaker it re-engages in the appropriate mode (SPD or THR REF) and advances thrust to hold the minimum manoeuvring speed or the MCP speed, whichever is greater; EICAS AIRSPEED LOW. **But** with the pitch mode FLCH SPD and the A/T in HOLD it does not re-engage, and it's perfectly possible to stall. The way out: reach the MCP altitude, or choose another mode (V/S). [R: "FLCH for Dummies in the 777 and 787"]
- Conditions as a PPRuNe post lists them: armed; no AP or F/D active, or AP/F/D in VNAV xxx, ALT, V/S or G/S; speed below an FMC value for one second. In a VNAV SPD descent the A/T may be in HOLD and won't support stall protection. [S: PPRuNe post 7926716]
- Asiana 214 (777, SFO 2013): the A/T went to HOLD when the pilot disconnected the AP and moved the levers to idle in FLCH; HOLD "does not control airspeed". [R: NTSB DCA13MA120]
- **Conflict:** one column says Boeing later changed the 777's logic so it wakes in HOLD too. [S: BCA Q3 2023] No second source and no date, so the sim keeps the documented behaviour.
- From memory, no wake-up below 400 ft RA after take-off or 100 ft on approach. [K]

**In the sim:** armed (`ap.athrArmed`; `setAthrArm(false)` is the arm switch) and asleep (off, armed with no mode, or HOLD); blocked by FLCH SPD, VNAV SPD descending or in HOLD; not on the ground or below those heights; IAS under the shaker speed + 3 kt [EST] for 1 s. Then SPD (THR REF in VNAV SPD or TO/GA) at max(MCP, vmm + 3 kt), up to MCT until recovered [EST]. TO/GA isn't on the FCOM-style list, but the sim doesn't block on it above 400 ft: there's no F/D switch here, and a hand-flown take-off would be left unprotected for the whole flight. Event: `{ type: 'athrWake' }`.

## 5. Overriding with the levers
- Any mode but HOLD: the levers can be moved by hand against the servo, and go back when released; only the disconnect or arm switch turns it off. [S: AVSIM topic 486711; PPRuNe 8208375] HOLD: the A/T can't move the levers, and they stay where the pilot leaves them. [S: PPRuNe printthread 482214 (767)]
- FLCH: if the pilot moves the levers, the FMA goes from THR to HOLD and the A/T is dormant. [R: "FLCH for Dummies"] One AVSIM post generalises this to any override. Not taken up.

**In the sim:** SPD or THR REF: hand on, no disconnect, the lever's the hand's; 1 s after it stops moving, the A/T has it back [EST]. THR and IDLE: HOLD. On the ground any hand: HOLD, so a rejected take-off isn't pushed back (decision; on the aircraft a pilot would use the disconnect switch). Servo rate 0.22 lever/s [EST].

## 6. Modes
- **FLCH:** speed on the elevator; thrust THR "to achieve the altitude change in two minutes", up to the reference thrust; in a descent past flight idle it goes THR to HOLD; at the altitude, SPD and ALT. The MCP window opens at the current speed when leaving VNAV. [R: "FLCH for Dummies"; 777 quiz: THR at CLB thrust limit] The rate is fixed when asked for (at least 500 fpm [EST]), or the capture would never come.
- **VNAV:** climb VNAV SPD / THR REF; descent VNAV SPD / IDLE or HOLD. [R: same] Schedule 250 below 10,000 ft (240 descending), then 310/M0.85. [B] Level shows VNAV ALT. VNAV PTH is in the interface, and nothing engages it yet.
- **Take-off:** TO/GA advances to THR REF, HOLD at 80 kt until 400 ft, then THR REF. [B, K] The take-off rating until 1,500 ft [EST, the usual thrust reduction height], then CLB.
- **Retard:** in the flare the A/T retards to idle and the FMA goes SPD to IDLE. [R: SmartCockpit 777 auto flight quiz] 25 ft [B], with the AP or by hand, on SPD.
- **LNAV:** at the last waypoint, HDG HOLD. [R: quiz option, unmarked; B]
- **AP off:** the modes keep running, as a flight director's would (there's no F/D switch). That's what makes the Asiana trap reachable.

## Sources
- [Flight Level Change for Dummies in the Boeing 777 and 787](https://cdn.shopify.com/s/files/1/1808/9017/files/Flight-Level-Change-for-Dummies-in-the-Boeing-777-and-787.pdf) (a training précis; not kept in the repository)
- [NTSB DCA13MA120: Asiana 214](https://www.ntsb.gov/investigations/Pages/DCA13MA120.aspx)
- [SmartCockpit: 787 flight controls quiz](https://smartcockpit.com/?p=4437), [777 auto flight quiz](https://www.smartcockpit.com/wp_quiz/boeing-b777-auto-flight/)
- [Brainscape: B777 flight controls](https://brainscape.com/flashcards/b777-flight-controls-10749642/packs/19133037)
- [Leeham: Bjorn's Corner, Flight control part 3](https://leehamnews.com/2016/03/25/bjorns-corner-flight-control-part-3/)
- [BCA Q3 2023 column](https://informamarkets.turtl.co/story/bca-q3-2023/page/15)
- PPRuNe (extracts only): [777 autothrottle wake up](https://www.pprune.org/7926716-post320.html), [777 THR mode logic](https://www.pprune.org/11731897-post51.html), [Boeing "thrust hold"](https://www.pprune.org/7928208-post3.html), [B777 pitch control](https://www.pprune.org/tech-log/470643-b777-pitch-control.html), [B777 speed trim](https://www.pprune.org/tech-log/553531-b777-speed-trim.html), [767 throttle hold](https://www.pprune.org/tech-log/printthread-482214-throtlle-hold-thrust-hold-b-767-300-a-2.html), [override post](https://www.pprune.org/8208375-post57.html)
- AVSIM (extracts only): [FBW trim reference speed](https://www.avsim.com/forums/topic/459982-fbw-trim-reference-speed/), [manually closing thrust levers and HOLD](https://www.avsim.com/forums/topic/486711-manually-closing-thrust-levers-and-hold-mode/)
