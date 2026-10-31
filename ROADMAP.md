# Roadmap

These are the future additions after the first build. They were saved on 2026-10-31 at Shane's request: "Record all the potential future additions in a separate md file like how Satisfactory has it."

The plan itself, with Shane's answers word for word, is in `PLAN.md` here, and in the Games project doc `claude/flight-sim-prototype.md`. Keep this file current: when something ships, mark it **Done** in its table with the version and date, and log the details in the project doc.

## The first build (agreed 2026-10-31: "Yes, functional")

| Milestone | What | Done |
|---|---|---|
| M1 | The first playable build, enough for a full Gimpo to Jeju flight, runway to runway: the A321neo with realistic physics (stall, flap and gear drag, spool-up, brakes, reverse thrust, fuel weight) and fly-by-wire; the 1st-person (nose) and 3rd-person (orbit) views and both seats, with a simple cockpit; the PFD, ND, engine panel and FCU; the holds-only autopilot and autothrust; 16× time compression, the path map with jumps, and skip to final; terrain for the whole map with the real coastline and elevation, procedural trees, farm plots and city blocks; Gimpo and Jeju with their runways; runway starts; the callouts, RETARD included; rewind after a crash. | **Done** in v0.1.0, 2026-10-31 04:43 KST (overnight run; evidence in `STATUS.md`) |
| M2 | The three airports in full: Incheon added; taxiways, aprons, numbered gates and terminals; gate starts with pushback and taxi routes; parked aircraft and moving vehicles. | **Done** in v0.1.0, 2026-10-31 06:19 KST (overnight run; evidence in `STATUS.md`) |
| M3 | Engine and environment sound, the landing score and logbook, polish. | **Done** in v0.1.0, 2026-10-31 06:19 KST: sound synthesised and measured offline (not yet listened to), landing score card, logbook, world polish |

Found in M1–M3 and left for later:

- **Gimpo stand 7** has no taxi route to 14L/32R.
- **Pushback speed:** about 100 s at 1.5 m/s. A faster tug, or a 2× pushback option, would help.
- **The synth's sound hasn't been listened to.** Its levels are measured (`tests/audio-render.mjs`), but the engine timbre needs a real listen.
- **The landing score:** **fixed in v0.1.1** (2026-10-31). It used to measure a touchdown that wasn't on a runway against the runway picked in setup, and none of its penalties had a ceiling. Shane's first flight (Gimpo to Incheon) scored 0/100; which of the two caused it wasn't confirmed, and both are fixed.

Found after v0.1.0:

- **Incheon's taxiways flickered** where concrete taxilanes overlapped asphalt taxiways: **fixed in v0.1.1** (2026-10-31), with the faint gaps on the outside of taxiway bends.
- **The cockpit windows looked strange**, and from the seats the side post crossed the view ahead: **fixed in v0.1.1** (2026-10-31), redrawn after the A320 family's.
- **From outside, the windshield was taller than the side windows** (Shane: "it should be thinner than the side windows"): **fixed in v0.1.2** (2026-10-31), with the nose's crown cut down over the windshield.
- **The engines sat up against the wing, like a 737 MAX's**: **fixed in v0.1.2** (2026-10-31), hung at the A321neo's 0.45 m ground clearance under a wing raised 0.3 m.
- **Touching the grass just short of the runway crashed the aircraft**: **fixed in v0.1.2** (2026-10-31). A gentle touchdown on grass is fine; a hard one, or a fast run of more than 450 m across it, still ends the flight.
- **The landing score was too lenient** (Shane: 100/100 "for a landing that was ok but had obvious flaws"): **reworked in v0.1.3** (2026-10-31). No free bands, the approach counts, and his landing now scores 80; 100 and 0 are both nearly out of reach.
- **Jeju 31's glideslope and localizer** on the PFD were measured from 411 m past its displaced threshold (the displacement was applied twice): **fixed in v0.1.3** (2026-10-31).
- **Jeju's crossing runways** (07/25 and 13/31) are each drawn at their own end elevations. Where they cross, those differ by about 1 m, so each cuts through the other along a diagonal seam. Open: the fix is to take one height for both there, from the heightfield.


## Future additions Shane named (2026-10-31)

| Addition | In Shane's words | Notes |
|---|---|---|
| Autopilot: route following, planned climb and descent, ILS capture | "b will be hard to detail, so just a for now. Add b and c later." | Once it follows a route, the map's bright predicted path bends with the route instead of running straight along the selected heading. |
| Autopilot: autoland (flare and rollout) | (same answer) | RETARD moves from 20 ft to 10 ft in an autoland. |
| Weather: wind direction and speed, gusts, crosswinds, rain, clouds | "Clear skies for now, and we'll add weather in a future update." | |
| Challenges and landing replays | "c once weather (wind currents and direction, crosswind, rain) is added." | For example a gusty crosswind at Jeju, an engine failure on take-off, or a night approach (if night exists by then). |
| Air traffic control | "c and d are for future updates." | Text clearances, taxi routes, "cleared to land". |
| Other aircraft in the air and on the taxiways | (same answer) | Today it's "just me for now in the air", with parked aircraft and moving vehicles on the ground. |
| More aircraft types | "We can add more later." | The first is the A321neo. |
| More airports | "For now, just have the three" | The other 12 Korean airports with airline service in OurAirports: Gimhae (Busan), Cheongju, Daegu, Gwangju, Muan, Yangyang, Ulsan, Yeosu, Sacheon, Pohang, Gunsan and Wonju. |
| A main menu like Satisfactory's, and scenarios | "I do also want to add a menu screen like Satisfactory, and since I probably don't want to have everything in just one scenario, so let the current scenario be 'Scenario 1', and you can create more and choose where to begin and where to land." (2026-10-31) | Planned for **v0.2.0**, not before (Shane: "Don't make these two changes until its time for v0.2.0 though."). Decided 2026-10-31: a scenario is a save slot holding the whole state ("the saved state including the plane's location, speed, roll, everything, so that when you reload a scenario after doing a another, it is exactly where it was before"), and the menu's backdrop is a still ("I'd say stick with a still picture"). |

## Not on Shane's list (candidates; ask him)

- Time of day and night: runway, approach and city lights. Offered in planning and not chosen yet; today it's day only.
- Working screens in the 3D cockpit. Today they're dark, and the working screens are drawn on the sides of the screen.
- Aircraft systems: hydraulics, electrics, failures, autobrake.
- Finer terrain everywhere, for low sightseeing over Seoul and Jeju.
- Expressways and other major roads from OpenStreetMap, which are easy to see from the air.
- International routes from Incheon to Japan and China. They need a bigger map frame and more terrain.
- Real departure, arrival and approach procedures and airways from Korea's AIP.
- Real building footprints around the airports, and landmark towers.
- Gamepad or joystick support, and key rebinding.
- More Nuclear Airlines liveries, and more made-up airlines for the parked aircraft.

## Not planned (Shane said no)

- A cold-and-dark start (battery, APU, engine start): "c is for actual trained pilots."

## Open decisions for Shane

- Hazard stripe colours on the livery: black and yellow by default. Shane may want green and black. Asked 2026-10-31.
- The order of the future additions: ask when M3 is done.
