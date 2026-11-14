# Flight Sim: the plan

Flight Sim (`flight-sim`, title "Flight Sim") is the ninth Game Dump game. It's a 3D airliner sim of South Korea: an A321neo flown out of and into Incheon, Gimpo and Jeju, over real terrain, with time compression on the autopilot to cover the distances. Shane settled every decision below between 2026-10-30 and 2026-10-31. Treat them as final; anything else is yours to decide (log it in `STATUS.md`).

## Shane's decisions

Numbered as in the planning questions, in his words where it matters.

1. **Aircraft:** the A321neo. "We can add more later."
2. **Flight controls:** "a/d for rolling, s for pitching up, w for pitching down, and q/e for yaw." The touchpad controls the camera.
3. **Physics:** realistic. "Stall speeds, drag from flaps and landing gear, engine spool up, effect of brakes, reverse thrust, weight of fuel, everything." No aircraft systems (hydraulics, electrics, failures).
4. **Cockpit:** "very simple with non-working screens since everything will still be visible on the sides of my screen, same as the front-plane view."
5. **Autopilot:** holds only for now (heading, altitude, vertical speed and speed). Route following, planned climb and descent, ILS capture and autoland come later.
6. **Time compression:** up to 16×, autopilot only, dropping back to 1× by itself. A "skip to 15 nm final" button. And Shane's idea: "on a map that I can open, when autopilot is engaged, it shows me the path the plane will follow in a bright color, and I can select a point on that line and transition there, that way I can choose exactly where to be on the route."
7. **World:** South Korea, with the land around it as rough terrain and no airports there.
8. **The ground:** real coastline and real elevation, procedural fine detail. "Elevation isn't procedural but the rest are. I think as a rule of thumb, have macro-scale details be determined, and finer details are procedural."
   - "In non-urban areas, just have an algorithm that adds simple trees or farmland-like plots of land, with finer details disappearing as my altitude increases to save performance."
   - "For the city, have very simple buildings."
   - "Only fine terrain around airports is fine."
9. **Airports:** Incheon, Gimpo and Jeju only for now. "They're the busiest anyways."
10. **Data:** download what's needed; on Shane's Mac, Claude Code can do it itself.
11. **Start and finish:** lined up on the runway, or at a gate with pushback and taxi. No cold-and-dark start: "c is for actual trained pilots."
12. **Route:** pick origin, destination and runways on a map, and drag waypoints. "In the air it is pretty a sandbox, so the map only shows you the path to your destination from where you are, never saying that I am going the wrong way."
13. **Traffic:** "Just me for now in the air. At the airports, parked aircraft and some moving vehicles should be enough."
14. **Weather:** "Clear skies for now, and we'll add weather in a future update." Day only; night is on the roadmap. **Superseded:** night came in v0.2.0, and the weather in v0.4.0 (2026-11-10; "The weather (v0.4.0)" below, `V040.md`). Clear skies are still the default.
15. **Goals:** free flight, a landing score and a logbook. Challenges come once weather exists. After a crash: rewind 30 s, or restart the flight.
16. **Sound:** "hell yeah. Don't forget that hilarious 'retard' callout."
17. **First build:** M1 below ("Yes, functional").
18. **Name:** Flight Sim, `flight-sim`.

**Views** (2026-10-31):

- **1st person:** "the camera looking out from the nose of the plane, camera panning controlled by the touchpad."
- **3rd person:** "centered around the center of the plane, with touchpad for camera angle and zooming in and out."
- **The two seats:** the Captain's (left) and the First Officer's (right), in the simple cockpit.

**Livery** (2026-10-31): "Nuclear Airlines", from Shane's handle NuclearPlane787. "Green is a nod to the 'green goo' look of uranium waste in Satisfactory, which inspired me to make my username. So a mix of green and blue with hazard stripes I would say is better."

**Flap keys** (2026-10-31): 6, 7, 8, 9 and 0, "since my left hand would be already occupied with q/w/e/a/s/d."

**CPU rules** (2026-10-31): "have a count cap and a time cap for 100% CPU core scripts". Shane made the rules for his Courses folder after "4 rogue Python scripts took up half my entire cpu for 6 hours and almost cooked my device".

- For dev commands, `tools/cpu-guard.py` enforces them: 2 heavy commands at once, 20 minutes each (see `AGENTS.md` → CPU rules).
- The game follows them at runtime (see "CPU at runtime" below).

**Claude's defaults (Shane didn't object):**

- Vanilla ES modules, with three.js r186 copied into `vendor/`, served from the hub's local server.
- Aviation units on screen (kt, ft, nm, ft/min, hPa) and SI inside.
- A standard atmosphere and magnetic variation.
- Fixed-step physics in double precision.
- Camera-relative rendering, Earth's curvature in the terrain shader, and haze at the edge.
- A 60 fps cap and 1× resolution, with a triangle and draw-call counter.
- An Alternate law switch, so the stall can be felt.
- The callouts in M1.
- The Han River and the big lakes.
- No real airline's branding.

## The aircraft types (v0.3.0)

`V030.md` was the brief. A type is one data module with every number and its source (`src/sim/<id>.js`), one geometry module (`src/geometry*.js`; same frame and names) and one entry in `src/sim/types.js`. The sim's modules are factories that take the data (`createFlightModel(A)`, `createEngines(A)`, `createGear(A)`, `createFbw(A)` or `createFbwBoeing(A)`, `createAutopilot(A)` or `createAutopilotBoeing(A)`), made once per type by `kitFor()`. `createSim({ type })`, `sim.setType(id)`; a snapshot carries its type, and one without it is the A321neo, so the prediction worker flies the right aircraft. `ready: false` keeps a type out of the picker. `tests/golden-a321.test.mjs` flies a flight recorded from v0.2.2's code and compares it to 1e-9: never re-record it to make a test pass. `main.js`'s `useType()` is the one place everything that reads the type is told. To add a type: copy a Boeing's two modules and its notes file, add its spec (`src/widebody-specs.js`), window design, registry entry and `src/type-assets.js` line, and run the same tests with its id (`BOEING_TYPE=<id>`).

**v0.4.3, the 777's pitch** (Shane: "The 787 seems to stabilise itself well when I pitch, but the 777's pitch stabilisation only improved by a little"): its elevator and stabiliser power are the 787-9's per unit of tail volume (from the drawn planforms: V_H 1.106 against 0.943; `CM` in `src/sim/b777-300er.js`), and Boeing auto-trim's path mode (gear down, landing flaps, hand flown, not in the flare or a go-around) caps the pitch rate at 2.2°/s (`PATH_Q_MAX` in `src/sim/fbw-boeing.js`). Both Boeings stop within about a degree of where the key comes up and settle in under a second (`tests/boeing-pitch-settle.test.mjs`); at v0.4.2 the 777 went on 2.8° and swung 2.7° back over 3.7 s.

## The weather (v0.4.0)

`V040.md` was the brief; Shane's decisions (2026-11-10) are in it. In short:

- **One weather everywhere,** set on the L window's Weather tab (or a preset in the setup; clear by default) and kept as set: no fronts or moving storms yet. Only the microbursts and storm cells sit at a place.
- **The settings** (`src/sim/weather.js`, JSON-safe) live in `sim.snapshot()`, so saves, Duplicate and the prediction carry them. A rewind or a jump keeps the weather set now. A save without weather is calm, and the default weather writes nothing, so calm is v0.3.2's arithmetic exactly (`tests/golden-a321.test.mjs`).
- **The wind** is a function of position and time, seeded, with no state: the mean wind by height (a power law from the 10 m surface wind to the wind aloft at 900 m, and an optional shear layer), gusts (patches carried with the wind), Dryden turbulence (MIL-F-8785C, as a frozen field of 20 waves an axis), and Oseguera and Bowles's microbursts. The live sim (1/120 s) and the prediction (1/30 s) read the same air.
- **The air:** ISA + ΔT with the QNH at sea level (`columnInto()` in `atmosphere.js`). The engines are flat-rated to ISA + 15. The altimeter reads the static pressure against its setting (`indicatedAltitude()`), and the autopilots fly that; the radio altimeter, the score and the map stay geometric. A flight starts with the day's QNH set; K sets it again; the BARO box on the FCU or MCP sets it or STD. Korea's transition altitude and level are 14,000 ft and FL140 (eAIP ENR 1.7).
- **The aircraft feel it** through the air-relative velocity in `sim.step()`: the gear rolls on the ground's. The Boeings' LNAV, LOC and rollout fly the track, and the autoland lines up from 500 ft with a forward slip. A reactive windshear warning comes from the F-factor over 1 km (0.105, as NASA's certification database uses).
- **The runways:** dry, wet, snow-covered or icy, as factors on the tyres' grip, braking and rolling drag (`RUNWAY_TYRES`), automatic from the precipitation and temperature or set.
- **The look:** the haze's constants became uniforms (visibility by Koschmieder's law, fog with a top), flat cloud layers (`src/world/clouds.js`), the overcast light, rain, snow and windshield drops (`src/world/precip.js`), lightning, wet and snowy ground, and runway lights reflected on a wet runway at night. Clear weather draws exactly as v0.3.2 did. Volumetric clouds are a later step.
- **The sound:** rain on the skin, thunder late by the strike's distance, gusts in the wind's noise, and the Boeing's windshear siren.
- **v0.4.1** (Shane, 2026-11-10: "I presume crosswinds don't change in direction as quickly as the current sim does, and microbursts are quite rare to my knowledge? Keep as is but let it be more reflective of how real storms 'behave'. Maybe storms can have severity settings instead of on/off."): storms are three presets, light, moderate and severe (`thunderstorm` stays the moderate one's id, for saved plans), and only a severe storm has microbursts, at about one airport in three. Below 1,000 ft the turbulence's σw is 0.1 × W20, the standard's form, with W20 the wind at 20 ft scaled by the level (0.7, 1, 1.4) and half the level's own W20 as a floor; above 2,000 ft it's the exceedance curves, as before.
- **v0.4.2** (Shane, 2026-11-12: "do your list for v0.4.2"): the v0.4.0 brief's Nices. A predictive windshear warning: the weather radar's, a microburst's F-factor of 0.13 or more over a kilometre of the path from 0.5 to 1.5 nm ahead, below 1,200 ft and above 50 ft, or on the take-off roll under 100 kt (`pwsScan()` in `sim.js`; the PFDs' W/S AHEAD, the voices). Hydroplaning: heavy rain on a wet runway leaves standing water (`hydro`, from the rain's rate), and above 9 √p kt the tyres lose most of their grip (`gear.js`; `TYRE_PSI` per type, estimates). The wipers in the seat views (`precip.js`), the wheels' spray (`src/world/spray.js`) and snow over the taxiway paint. Broken cloud far off was checked against v0.4.1 and left as it was.
- **v0.4.3, the aurora** (Shane, 2026-11-12: "let's add auroras to the night sky. Not like right up against the plane but very visible at a distance"; every clear night, green curtains with red tops): part of the dome's shader (`aurora()` in `src/world/sky.js`), so no draw call of its own: three arcs low in the northern sky (full to ±43° of north, gone by ±77°, the lower edges about 4 to 9° up and folding), green fading up into red, a violet fringe at the edge, fine vertical rays that drift and flicker. It shows as the stars do (`uAurora` is their visibility: none by day, all of it on a dark night, little under overcast), and cloud layers in front hide it.

## The parts model and the warehouse (v0.5.0)

`V050.md` was the brief; Shane's decisions (2026-11-13) are in it: engines, weight and fuel; the Warehouse on the main menu; realistic limits. In short:

- **A design** is one plain object (`src/sim/designs.js`): `{ v, id, name, registration, base, engine, count, stations, thrustScale, oewDeltaKg, fuelCapacityKg, gearExtendM }`, clamped by `normalizeDesign()` (the stations within the wing and clear of the gear and of each other; the thrust scale 0.5 to 3; the empty weight −15 to +30 %; the fuel half to twice the base's, the change in the centre tank; the gear up to 1.5 m longer). `designDef()` makes it a type entry with the base's id, model, cockpit and screens, and its own data and geometry: one `ENGINES` and `NACELLES` entry per engine (engine 1 the left outboard, then inboard, the tail, and the right wing out), the mass, CG and inertias with each engine's installed weight (1.45 × dry [EST]) against the base's, the gear and `GROUND_Z` lowered, a crash point per nacelle, and the pylons' limits.
- **The engines** are parts (`src/sim/engine-types.js`): each engine type's own numbers, taken from its aircraft's data module, its nacelle and its dry weight; the lever law and the climb and MCT fractions stay the airframe's. The sim's core keeps them as five arrays (`eN1`, `eN1t`, `eRev`, `eThr`, `eFf`), stepped in one loop in the old order, so the three types fly their golden flights to 1e-9; a v0.4.4 save's named engines become the arrays (`migrateEngines()`).
- **Saves carry the design whole** (`sim.snapshot().design`); the prediction flies it; a scenario keeps its own copy; the logbook names it.
- **The limits:** each pylon holds 1.5 times its engine type's rated take-off thrust (CS-25's ultimate factor), and 0 to 10 % more as built, fixed by the design's parts. Past it the engine tears off: its thrust and fuel stop, its mass leaves, the model hides it, the screens show OFF (`engineOff`). Indestructible doesn't stop it. Each nacelle strikes the ground as the crash points do.
- **The model** (`src/engine-model.js`): one builder for all three engine types, so any engine hangs on any aircraft at its station, the tail engine through the fin's root, each fan on its own engine's N1, and on the Boeings each engine's own span as its bend (`bendY`). Longer gear grows below the wing.
- **The screens and the sound:** the engine panel and the EICAS draw every engine (`src/ui/engine-row.js`); the synth gives each engine its own voice, up to six, panned by its place. Two engines draw and sound exactly as before.
- **The warehouse** (`src/ui/warehouse.js`, `src/designs-store.js`): the designs under `gamedump:flight-sim:designs`; the editor's 3D view draws only while it's open.

**The hangar (v0.5.1).** The warehouse's view stands the design in a maintenance hangar (`src/ui/hangar.js`), one size for every type: 150 m by 140 m inside, 28 m to the trusses' bottom chords, the doorway 120 m wide and 24.8 m high, sized for the 777-300ER with room to walk round it. The aircraft's nose points at the offices along the back wall; behind its tail the doors' leaves are slid back to leave the middle 70 m open onto a sunlit apron, as it came in. The floor's lead-in line has a stop bar at each type's nose wheel (`GEAR.nose`). Everything static is merged by material (eight meshes), the people are five instanced meshes, and the camera stays inside the room (`cameraBox()`, `rayExit()`). The people walk only while the editor is shown, at 30 frames a second.

**Parts anywhere (v0.5.2).** Shane, 2026-11-14: "I want the flexibility of the warehouse to be somewhat like the sandbox in Kerbal Space Program", then "KSP-type attaching and physics". v0.5.2 (the Cowork session) is the attaching; v0.5.3 (a Claude Code run, `V053.md`) the airframe from parts with its handling from them.

- **A design is parts** (`v: 2`): the base's airframe is the root, and `parts` lists what's attached: engines (`mount`: under the wing, over it, on the rear fuselage's side or in the tail; each its own type and thrust scale, nudged `dx`, `dz` and turned `yaw`, `pitch`), wing tanks and hold tanks (`kg` of fuel), ballast. A part on one side has a mirror twin by default (`pair`, both ends naming each other); editing either edits both (`updatePart()`), removing one removes both. Up to 8 engines and 24 parts. A v0.5.0 design (`engine`, `count`, `stations`, `thrustScale`) becomes parts on the way in (`normalizeDesign()`), with the same nacelles, thrust, masses and pylon scatter, so it flies as it did.
- **The mounts** (`airframe(base)` in `designs.js`): the wing as a straight-tapered planform from the fuselage's side, with its leading edge, chord and heights tied to the base's own nacelle; over the wing, a nacelle at 55 % chord, 0.65 m over the upper surface; on the body, 0.55 m off the fuselage's side, 12 % of its height above the middle, between the tail cone and the wing's root; a wing tank's teardrop (its volume its fuel; 4 diameters long) 0.45 m under the wing. `mountRange()` keeps each station inside its mount.
- **What each part brings** (`designDef()`): its mass at its place against the base's two engines (the CG and the inertias); its drag area at its place (`DRAG_PARTS`: every nacelle at CD 0.05 on its frontal area, less the base's two, which are in its CD0; a wing tank at 0.08), applied in `sim.js` against the airflow with its moments; each engine's thrust along its own line (`THRUST_DIRS`), with its moments; each engine's own numbers when the types or thrusts are mixed (`ENGINE_DATA`, one engine kit each); the tanks' fuel in the centre tank (burned first) with its CG; each engine's voice (`sounds`) when the types are mixed; a crash point under each tank. A design whose engines are the base's own, untouched, keeps the base's geometry exactly, so a design that is its base flies its golden flight.
- **The editor** (`ui/warehouse.js`): the palette over the view; the pointer as a ray in the geometry frame, met against the airframe's shapes (`hitAirframe()`: each wing's mid-surface over its planform, the fuselage as an elliptic cylinder whose crown at the fin is the tail's mount, the fin) and the parts' boxes (`pickPart()`: not through the wing); `placement()` turns a hit into a part, snapped to 0.25 m; a ghost (the part placed, green or red) in an overlay drawn over everything with the selection's boxes, the hold's parts and the CoM and CoT markers. Undo and redo keep whole designs (`createHistory()`). The checks: `readout()` with `thrustLine()` (the thrust's centre, resultant and moments about the CG at full thrust: the yaw against the base's with an engine out, the pitch against the base's).
- **Still the base's:** the wing, the fuselage and the tail, and with them the lift, the stability and the controls' power. That's v0.5.3: each part's own lift and drag, one rigid body (no flex, no breaking).

## The aircraft: A321neo

### Published numbers (Airbus's A321neo page)

| Item | Value |
|---|---|
| Length | 44.51 m |
| Wingspan | 35.80 m |
| Height | 11.76 m |
| Fuselage width | 3.95 m |
| Max take-off weight | 97.0 t |
| Max landing weight | 79.2 t |
| Max zero-fuel weight | 75.6 t |
| Max fuel capacity | 32,940 L (Airbus's "max", probably with the optional extra centre tanks; check the standard tanks in the AC document) |
| Mmo | 0.82 |
| Engines | CFM LEAP-1A or Pratt & Whitney PW1100G-JM. Use the LEAP-1A. |

**Pin down first, from the primary sources** (EASA TCDS EASA.A.064 section 2, and Airbus's *A321 Aircraft Characteristics: Airport and Maintenance Planning*, June 2024):

- VMO, and VFE for each flap setting;
- the gear speeds (VLO, VLE);
- the maximum operating altitude;
- the wing area;
- the engine's take-off thrust;
- the take-off and landing field lengths against weight.

Put the numbers and their page references in `src/sim/a321neo.js`.

### Flight model

Realistic physics without aircraft systems, in double precision, in fixed steps of 1/120 s. Deterministic (seeded where random), so a prediction and a jump agree.

- **Rigid body with six degrees of freedom:**
  - mass and inertia from the empty weight, the payload and the fuel in each tank;
  - the centre of gravity moves as fuel burns.
- **Aerodynamics:**
  - lift against angle of attack for each flap setting, with a real stall break (the maximum lift per setting is chosen so the 1 g stall speeds match the published ones);
  - ground effect;
  - a drag polar: parasite, induced, flap, slat, gear and spoiler drag, and the drag rise near Mmo;
  - pitch, roll and yaw moments, with damping;
  - the controls: elevator, stabiliser trim, ailerons, roll spoilers, rudder, speed brakes and ground spoilers.
- **Flaps and slats:** lever positions 0, 1, 2, 3 and FULL. Position 1 gives 1+F on the ground and at low speed, as on the real aircraft. Realistic travel rates.
- **Engines:**
  - N1 spools up and down with a lag (seconds from idle to take-off thrust);
  - thrust varies with N1, Mach and altitude, and fuel flow drains the tanks;
  - thrust lever detents IDLE, CL, FLX/MCT and TOGA;
  - reverse thrust on the ground only, with a deploy delay.
- **Ground spoilers**, with the real logic:
  - armed, they extend at touchdown;
  - not armed, they extend when reverse is selected.
- **Landing gear:**
  - the nose and two main legs as springs with dampers;
  - tyre rolling and side friction;
  - wheel brakes with anti-skid, and a parking brake;
  - nosewheel steering on Q/E: tiller authority at taxi speeds, blending into rudder-pedal authority as speed rises;
  - gear travel times, gear doors, and tail strike detection.
- **Atmosphere:** the ISA (density, temperature and speed of sound with height). Indicated, calibrated and true airspeed and Mach are kept apart.
- **Fly-by-wire, Normal law:**
  - Pitch: the stick asks for load factor. Let go and the aircraft holds its flight path and trims itself.
  - Roll: the stick asks for a roll rate. Bank holds up to 33° and returns to 33° from beyond when you let go.
  - Protections: high angle of attack (alpha floor adds TOGA thrust), high speed, and bank and load factor limits.
  - The flare law: near the ground the nose slowly lowers, so you have to flare yourself.
  - Keyboard inputs ramp in over a fraction of a second, so taps work.
- **Alternate law switch:** as after a failure in the real aircraft, the high angle of attack protection is gone, so the aircraft can stall, with the stall warning. Check the exact behaviour against Airbus's descriptions.

### Autopilot and autothrust (M1: holds only)

- **AP1 and A/THR**, set on an FCU strip at the top of the screen:
  - SPD, HDG, ALT and V/S windows (click, or scroll over them);
  - the AP and A/THR buttons.
- **Modes:**
  - heading, with bank limited to about 25°;
  - altitude hold, with capture;
  - vertical speed;
  - speed, through autothrust.

  The flight mode annunciator on the PFD shows what's active.
- **Autothrust** works up to the thrust lever position, normally the CL detent, as on the real aircraft.
  - **Changed in v0.2.2** (Shane: "When autothrottle is on, the blue dot on the engine power view doesn't move. So when I press R or F slightly, the engines change power significantly. Have autothrottle move this blue dot as well."): while it's active, the A/THR moves the thrust lever itself, as a Boeing's autothrottle does, up to climb thrust; the panel's ring follows. Moving the lever (R or F) takes the thrust from there and disconnects it. Armed (on the ground, or with the lever above CL in flight) it leaves the lever alone; brought back to CL or below in flight, the lever is the A/THR's again.
- **Disconnect:** on Z, on a firm stick input, or when a protection takes over, with the disconnect warning.

### Time compression, the path map and jumps

- **Rates:** 1, 2, 4, 8 and 16× (= and −).
  - Only with the autopilot engaged and at least 2,000 ft above the ground.
  - Back to 1× by itself when the autopilot disconnects, on any warning, or below 2,000 ft above the ground.
  - At 16×, 1,920 physics steps a second (32 per frame at 60 fps).
- **The map (M):**
  - the coastline, and the three airports and their runways;
  - the aircraft;
  - the line to the destination from where the aircraft is now, through any waypoints dragged onto it;
  - with the autopilot on, **the predicted path in a bright colour**.
- **Predicted path:**
  - The real flight model and autopilot run ahead in a Web Worker at a coarser step (about 1/30 s), so the frame never stalls.
  - The run covers up to about 90 minutes, or until the fuel runs out or the path leaves the map, sampled every few seconds.
  - It reruns whenever an autopilot target changes.
- **Jump:** click a point on the path and confirm. The sim runs ahead to it with the same integration, behind a short fade, so the aircraft lands exactly on the line. Fuel and weight carry over.
- **With holds only:** the path is a turn onto the selected heading, then a straight line, climbing or descending to the selected altitude. So you point the heading at the destination and jump. Once route following exists (roadmap), the path follows the route.
- **Skip to final:**
  - Places the aircraft 15 nm out on the destination runway's extended centreline, on the 3° path (about 4,800 ft above the threshold).
  - 180 kt, CONF 1, gear up, with the autopilot holding.
  - Fuel and weight carry over.
- **Sandbox:** nothing ever says you're off course. The line always runs from where you are.

### Views, camera and screens

- **Views:** V cycles through them.
  - 1st person (nose camera);
  - 3rd person (orbit);
  - Captain's seat;
  - First Officer's seat.
- **Camera:**
  - Press and drag on the view with one finger (v0.2.1) pans the view: it looks around from the nose and the seats, and sets the angle in 3rd person. The view follows the finger. A two-finger swipe does the same.
  - Pinch zooms: distance in 3rd person, field of view elsewhere.
  - Double-click recentres.
  - The pointer stays free for clicking the FCU and the map.
  - `overscroll-behavior: none` and non-passive wheel handlers keep Chrome's swipe-back gesture out of the way.
- **Simple 3D cockpit:**
  - built to scale around the real window frames;
  - glare shield, seats, sidesticks;
  - thrust, flap and gear levers that move;
  - six dark, non-working screens.
- **Screens drawn over the view, in every view:**
  - **Left, the PFD:**
    - attitude;
    - a speed tape with the low-speed and flap limit marks;
    - an altitude tape, vertical speed and heading;
    - the flight mode annunciator;
    - ILS-style deviation scales for the destination runway, worked out from its geometry (raw deviation only, no autopilot coupling yet).
  - **Right, the ND and an engine panel:**
    - the ND: a moving map with the line to the destination;
    - the engine panel: N1, fuel flow, fuel, flaps and slats, gear, spoilers and brakes.
  - **Top, the FCU.**

### The aircraft model and livery

- **Model:**
  - built in code, with no model files, at about 20–40k triangles;
  - the gear, flaps, slats, spoilers, ailerons, elevator, rudder and reversers all move.
  - **The high-lift surfaces stay connected (v0.3.1;** Shane: "The landing gear on all three planes look strange when flaps are fully down. They seem to attach to thin air. I don't [think] there should be air gaps in the wing when the surfaces on the front of the wing and the flaps are extended."):
    - each inboard flap's leading edge runs behind the main gear's leg (`FLAP_IN_LE_X` in `aircraft.js`, `inboardFlapLE()` in `widebody.js`), so fixed structure carries the gear, as on the real aircraft;
    - the A321neo's wing sits where Airbus's AC top view draws it (`WING.rootX`, 1.03 m further aft than v0.1.0 to v0.3.0 had it): its root's trailing edge 1.33 m behind the main gear;
    - the spoilers overhang the flaps by the flaps' travel less a slot, with fixed shrouds where there's no spoiler, so a flap that's out leaves a slot, not an open gap;
    - the fixed leading edge behind the slats is rounded, and each slat runs on two tracks; the flaps have rounded noses. **v0.4.1** (Shane: "The flaps on the front of the wing still produce an air gap. I would say close it up."): the slats droop about their hinge line, the centre of the fixed leading edge's round nose, so they stay sealed against it at any angle; no tracks, no slot. The narrow gaps between slats, and between the trailing-edge surfaces, are filled, and the 777's wing box reaches its ailerons' ends (it stopped short, a hole in the wing);
    - the flap track fairings' aft parts hinge down from their fixed fronts, instead of riding away with the flaps.
    - **v0.4.3** (Shane: "The 787 has gaps between the wing and the outer slats, while the flaps and inner aileron have small gaps as well"; "The outer flaps look detached when extended"): the Boeings' wing bend (`setWingFlex()`, the lift's) goes on after the skinning, straight up by each vertex's span in the bind pose, so a drooped slat or a lowered flap rises with the wing beside it. Before, it went on first and each surface's rotation turned it into a gap. Rigid parts hung off the wing (the engines and pylons) ride it at their own span as one piece (`bendY`, the Builder's fifth argument).
  - **The engines (v0.4.3;** Shane: "For all the engines, you can see through the edges … the fan blade on the front aren't centered correctly"): a fan case (the duct's wall from the reverser cowl's inner lip to the intake's inner end), the fan's face out to it, and a disc behind it facing aft, on all three types; the Boeings' fans stay on the axis with the wing bent (above).
  - **Gear doors** are panels with an inside (`slab()` in `aircraft.js`), so they show from both sides when they open (v0.3.1).
- **Nuclear Airlines:**
  - **Base:** a white fuselage, and a deep navy tail, belly and engines.
  - **Accents:** a mix of Satisfactory's uranium-waste green (glowing lime) and Cherenkov blue (the blue glow of a reactor pool).
  - **Hazard stripes.** Default: black and yellow, on the engine intake lips and as a band at the base of the tail. Shane may still ask for green and black.
  - **On the tail:** a stylised atom, three orbits round a glowing core, with the core green and the orbits blue.
  - **Lettering:** "NUCLEAR" titles forward. Registration HL8787.
- **Parked aircraft** carry the livery too, next to a couple of other made-up airlines. No real airline's branding anywhere.

## The world

### Map frame

- **One flat map frame for all of Korea:** a Lambert conformal conic projection centred on the peninsula, in metres. The physics and the rendering both use it; distances are off by well under 1%.
- **Earth's curvature** goes back in the terrain's vertex shader, relative to the camera, so the horizon drops correctly from cruise. Haze hides the edge of the data.
- **Camera-relative rendering,** so nothing shakes 300 km from the map's centre.
- **Magnetic variation** for Korea, so headings match the runway numbers.

### The ground

- **The rule (Shane):** "have macro-scale details be determined, and finer details are procedural."
  - Real data decides the big shapes: the coastline, elevation, rivers and lakes, and where the forests, farmland and cities are.
  - Procedural detail fills them in: micro-relief, individual trees, field plots and buildings.
- **Coastline:** OpenStreetMap's coastline for South Korea, accurate to metres. It becomes land and water distance fields, at about 200 m nationally and about 10 m around the airports. The neighbours (North Korea, Japan's nearby coast, China's coast) come from Natural Earth's 1:10M land.
- **Inland water:** big rivers and lakes from OpenStreetMap. The Han River runs past Gimpo.
- **Elevation (real):**
  - Copernicus GLO-90, resampled to about 250 m for the whole map;
  - GLO-30 patches at 30 m around Incheon and Gimpo (tile N37 E126) and around Jeju (tile N33 E126);
  - procedural micro-relief added near the camera.
  - Copernicus is a surface model: it includes rooftops and forest canopy. So built-up areas get a local-minimum filter, and each airfield is flattened to its published elevation.
  - Hallasan (1,947 m) is about 17 km south of Jeju's runway.
- **Land cover (macro, real):** OpenStreetMap's land-use and natural polygons, rasterised at about 100–200 m:
  - forest and wood;
  - farmland, meadow and orchard;
  - residential, commercial, industrial and retail.
- **Drawing it:** a GPU clipmap.
  - Nested square rings of grid follow the camera and read their heights from textures in the vertex shader, so a frame costs the same at any speed.
  - The colour comes from land cover and slope, with haze.
- **Surface detail (fine, procedural, seeded so it never changes between runs):**
  - in forest cover, simple instanced trees;
  - in farmland, rectangular field plots, with rice paddies on valley floors.
  - Drawn near the ground only, fading out as you climb.
- **Cities:**
  - built-up areas from OpenStreetMap (macro);
  - simple procedural buildings (fine): rows of tall apartment slabs, the Korean apartment-complex look, with lower blocks between;
  - thinned with distance and altitude.
- **Sea:** a flat surface with a simple shader (reflection by angle, sun glint).
- **Sky:** clear, with a fixed afternoon sun.

### Airports: Incheon (RKSI), Gimpo (RKSS), Jeju (RKPC)

- **Source:** OpenStreetMap's airport mapping:
  - runways, and taxiways with their letters;
  - aprons, and stands and gates with numbers;
  - holding positions;
  - terminals, hangars and other buildings;
  - service roads.
- **Checks:**
  - If gate numbers are missing anywhere, use stand numbers from the layout and log it. Shane can supply that airport's chart.
  - Cross-check runways against OurAirports. Its coordinates for most Incheon and Gimpo runway ends are rounded to 0.001° (up to about 45 m off), so it isn't the source.
- **Baked per airport** into JSON, in local metres:
  - runways with ICAO markings (threshold, designators, centreline, touchdown zone, aiming point, edges);
  - edge, centreline, threshold, end and touchdown zone lights, approach lights and PAPIs;
  - taxiways with yellow centrelines and hold-short markings;
  - **v0.4.1:** taxiway and runway signs (Shane: "the taxiways don't have any markings on them, or signals for that matter in the grass"): where named taxiways meet, an array on the left of each named way in (a location sign between direction signs, ICAO's layout), the name painted before the junction, and a mandatory sign at each runway holding position (`src/world/taxisigns.js`);
  - **v0.4.2:** the runways' own signs: an exit sign 60 m before each named exit, on its side, for each way along the runway (Annex 14's runway exit sign), and distance remaining signs every 1,000 ft along both sides (FAA AC 150/5340-18's: white numbers on black, back to back, the two faces adding up to the length); no no-entry signs, as the data doesn't mark one-way taxiways;
  - aprons, numbered stands with lead-in lines, and static jet bridges;
  - terminals and hangars, extruded from their footprints.
- **Life:**
  - parked airliners at most stands (instanced, in made-up liveries);
  - ground vehicles (tugs, buses, baggage trains, fuel trucks) driving loops on the service roads.
- **Gate starts:**
  - The taxi route from the stand to the departure runway's holding point is the shortest path on the taxiway graph, drawn on the ground.
  - P starts and stops the pushback: straight back, then the turn the stand needs. Q/E steer it.
  - After landing, a route runs from the runway exit to a free stand.
- **By milestone:** M1 has Gimpo's and Jeju's runways (markings, lights and PAPIs) on flat ground. M2 adds everything else at all three.

## Sound

- **Synthesised in WebAudio, no audio files:**
  - engines: fan whine and combustion rumble following N1, mixed differently inside and outside. **Rebuilt in v0.2.2** (Shane: "The current engine sounds don't sound accurate to a real A321.") from the LEAP-1A's real frequencies (FAA TCDS E00089EN; 18 fan blades): the fan's blade-passing tone and harmonics, the buzz-saw above ~75 % N1, the core's whine, the fan's broadband, the jet's roar and the combustion rumble; the tones waver and the two engines beat; outside, the direction (ahead: fan and buzz-saw; behind: jet) and 3rd person's distance change the mix (`src/audio/synth.js`'s header);
  - **in the cockpit** (v0.3.1; Shane: "I can't hear the engines much at all from the cockpit. They should be muffled and quieter than the outside, but not almost absent."): the engines are muffled (a 1.3 kHz low-pass, the low roar and rumble passing best) and 4–6 dB quieter than 3rd person's at take-off, but clearly there: level with the air conditioning at idle and over the wind on an approach (before, 5–12 dB under both); in cruise the air outside still leads, by 2–3 dB (`MIX` and `INSIDE_LP` in `src/audio/synth.js`);
  - wind with airspeed;
  - gear and flap motors, and spoilers;
  - touchdown and tyres, reversers and brakes.
- **Warnings:**
  - the autopilot disconnect warning;
  - the overspeed chime;
  - the stall warning (Alternate law);
  - the ground-proximity calls "sink rate", "pull up" and "too low gear".
- **Callouts**, in the browser's speech voice:
  - twenty-five hundred, one thousand, five hundred, one hundred, fifty, forty, thirty, twenty, ten;
  - **RETARD** at 20 ft in a manual landing (10 ft in an autoland, once one exists), repeating until the thrust levers reach idle.
- **By milestone:** the callouts are in M1; the rest of the sound is in M3.

## Score, logbook and crashes

- **Landing score**, worked out at touchdown and shown after the rollout:
  - vertical speed (ft/min) and peak g;
  - where you touched down against the aiming point;
  - distance from the centreline;
  - bank, pitch and bounces;
  - a grade.
- **Logbook** in localStorage: date, route, gate and runways, time in the air (sim time), fuel used, and the landing score.
- **Crashes** (ground or water contact away from a runway, a landing hard enough to break the gear, a tail strike): rewind 30 s from a ring buffer of states, or restart the flight.
- **Indestructible** (v0.4.1, a setting; Shane: "maybe we could add an option somewhere that makes the plane indestructible"): no crash ends the flight. Each would-be crash is a `damage` event (a message, and the card's "Would have crashed", costing as much as missing the runway), and the crash points are skids: a stiff, damped spring each under the ground, with metal-on-ground friction. The setting is the player's, not the flight's: a snapshot carries it only for the prediction, and `main.js` applies its own after every restore. v0.4.2: three more skids along the belly (Indestructible's only), a hard stop past 0.6 m (an impulse along the ground's normal at the deepest skid), a touchdown at the first skid's touch in a gear-up landing (so there's a card), and a button on the crash screen that rewinds with it on.

## Controls

| Key | Action |
|---|---|
| W / S | pitch down / up |
| A / D | roll left / right |
| Q / E | yaw left / right (steering on the ground) |
| R / F | thrust levers forward / back; on the ground at idle, keep holding F for reverse |
| Space (hold) | wheel brakes |
| B | parking brake |
| G | gear lever |
| 6 / 7 / 8 / 9 / 0 | flap lever 0, 1, 2, 3, FULL (Boeings: UP, 5, 15, 20, 30) |
| [ / ] | flap lever one detent up / down |
| H / Y (hold) | Boeings: pitch trim nose up / nose down (with Boeing auto-trim on, in Settings, they nudge the path held, 0.5°/s, v0.4.2; at v0.4.1 they did nothing) |
| O | Boeings: TO/GA |
| C | speed brakes in / out |
| Shift+C | arm ground spoilers |
| Z | autopilot on / off |
| X | autothrust on / off |
| = / − | time compression faster / slower |
| M | map (predicted path, jumps, skip to final) |
| 1 / 2 / 3 | cockpit (the captain's seat), nose, 3rd person (v0.2.1, with the view switch at the top right; since v0.2.2 pressing 1 in the cockpit does nothing) |
| V | next view (nose, 3rd person, Captain, First Officer) |
| P | pushback start / stop |
| Esc | pause menu |
| F3 or \` | performance overlay (fps, CPU ms, triangles, draw calls) |
| drag on the view (v0.2.1) or two-finger swipe / pinch / double-click | look or orbit / zoom / recentre |

No Ctrl keys, because Ctrl+W closes the tab on Windows. The one exception (v0.2.0, decided 2026-11-01): Cmd+L or Ctrl+L opens the Sky window, as in Satisfactory, with the browser's default prevented; it can't lose anything (if a browser keeps the shortcut, its address bar just takes the focus), and L alone works too. Handle keydown and keyup state, ignore auto-repeat, and drop all held keys when the window loses focus.

## CPU at runtime

The game keeps the fans quiet too.

- **Frame rate:** capped at 60 fps.
- **Paused:** the sim and the 3D rendering stop while paused, in the pause and setup menus, and when the tab is hidden.
- **Time compression:** its extra physics steps have a time budget per frame. If the CPU can't keep up, the rate drops by itself and the screen shows the rate actually reached. Frames never run long.
- **The predicted path:** one worker, running one job at a time. A new request cancels the old one, and each prediction stays within about 2 s of CPU.
- **No busy-waiting anywhere.** Workers sleep when idle.

## Code and files

- **The folder:**
  - `index.html` and `style.css`;
  - `src/` (ES modules) and `vendor/` (three.js r186 and its licence);
  - `data/` (the baked terrain, masks and airports) and `tools/` (the bake scripts, and `cpu-guard.py`);
  - `tests/`:
    - unit tests as `*.test.mjs`, for `node --test`;
    - browser scripts as `browser-*.mjs`, using Playwright installed in `/tmp/flight-sim/`;
  - `reference/raw/` (downloads, git-ignored) and `reference/docs/` (the A321neo PDFs);
  - `README.md`, `ROADMAP.md`, `AGENTS.md`, `PLAN.md`, `STATUS.md`, `thumb.svg` and `.gitignore`.
- **`src/` by area:**
  - `sim/`:
    - `atmosphere.js`, `a321neo.js` (the data, with sources), `flightmodel.js`, `engines.js`, `gear.js`, `fbw.js`, `autopilot.js`;
    - `predict.js` and its worker.
  - `world/`: `frame.js` (map frame), `terrain.js`, `detail.js`, `cities.js`, `water.js`, `sky.js`, `airports.js`.
  - `ui/`: `pfd.js`, `nd.js`, `engines-panel.js`, `fcu.js`, `map.js`, `setup.js`, `logbook.js`.
  - `audio/`: `synth.js` and `callouts.js`.
  - The rest: `main.js`, `input.js`, `camera.js`, `aircraft.js` (model and livery), `cockpit.js`, `score.js` and `store.js`.
- **Storage:** `gamedump:flight-sim:settings`, `gamedump:flight-sim:logbook` and `gamedump:flight-sim:lastflight`.
- **Flight setup screen:**
  - origin, runway or gate;
  - destination and runway;
  - passengers, cargo and fuel (with an "enough for the trip plus reserve" button);
  - start on the runway, at the gate, or on a 15 nm final.

## Milestones

| Milestone | What |
|---|---|
| M1 | The first playable build: enough for a full Gimpo to Jeju flight, runway to runway. **What's in it:** the A321neo with the flight model, fly-by-wire, engines, gear, brakes and reversers; the four views, with the simple cockpit; the PFD, ND, engine panel and FCU; the holds-only autopilot and autothrust; time compression, the path map with jumps, and skip to final; terrain for the whole map (real coastline and elevation, land cover, surface detail, cities, water); Gimpo and Jeju with their runways; runway starts and flight setup; the callouts; rewind. **When it's done:** the registry entry goes in. The definition of done is in `AGENTS.md`. |
| M2 | The three airports in full: Incheon added; taxiways, aprons, numbered gates and terminals; gate starts with pushback and the taxi route; parked aircraft and moving vehicles. |
| M3 | Sound, the landing score and logbook, polish. |

**Order of work inside M1**, so something flyable exists early:

1. the map frame and the atmosphere;
2. the flight model, with tests, on a flat world;
3. one runway at Gimpo;
4. the screens;
5. the autopilot;
6. time compression and the path map;
7. the coastline and terrain;
8. Jeju;
9. the cockpit, model and livery;
10. the callouts.

Steps that don't depend on each other can run as parallel jobs (see `AGENTS.md`).

## Tests

- **`node --test games/flight-sim/tests/*.test.mjs`:**
  - the atmosphere against the ISA table;
  - the map frame against great-circle distances (Gimpo to Jeju is 451 km);
  - the flight model against the real numbers:
    - take-off roll and rotation speed at given weights, against Airbus's field lengths;
    - the 1 g stall speeds for each flap setting;
    - climb rate and cruise fuel flow;
    - landing roll with and without reverse;
  - fly-by-wire holding the attitude with no input;
  - the autopilot capturing altitudes without large overshoots;
  - the jump landing exactly on the predicted path;
  - runway headings against their numbers.
- **End-to-end flight (browser script, in Chrome on the real GPU):**
  1. Take off from Gimpo with scripted inputs, climb, and engage the autopilot towards Jeju.
  2. Use time compression, then a path-map jump.
  3. Skip to final at Jeju, and land with a test-only landing controller.
  4. Check that the landing score comes out and nothing crashed.
- **Screenshots and performance numbers:** taken in Chrome on the M5, saved in `Claude outputs/flight-sim/`.

## Data

| What | From | For |
|---|---|---|
| South Korea extract, `south-korea-latest.osm.pbf` (a few hundred MB) | Geofabrik, from OpenStreetMap (ODbL; credited in the README) | coastline, airports, land cover, rivers |
| Copernicus GLO-90 tiles N33–N38 × E124–E131 (sea tiles don't exist), and GLO-30 tiles N37 E126 and N33 E126 | AWS open data, buckets `copernicus-dem-90m` and `copernicus-dem-30m` (free, with the Copernicus credit in the README) | elevation |
| 1:10M land and coastline | Natural Earth on GitHub (public domain) | the neighbours |
| `airports.csv`, `runways.csv` | OurAirports on GitHub (public domain) | cross-check |
| EASA TCDS EASA.A.064, and Airbus's A321 Aircraft Characteristics | EASA and Airbus | the A321neo's numbers |

Download commands (from `games/flight-sim/`):

```sh
mkdir -p reference/raw/dem90 reference/raw/dem30 reference/raw/ne reference/raw/ourairports reference/docs
cd reference/raw
curl -fLO https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
for lat in 33 34 35 36 37 38; do for lon in 124 125 126 127 128 129 130 131; do
  t=Copernicus_DSM_COG_30_N${lat}_00_E${lon}_00_DEM
  curl -fsS -o dem90/$t.tif https://copernicus-dem-90m.s3.eu-central-1.amazonaws.com/$t/$t.tif 2>/dev/null && echo "got $t" || { rm -f dem90/$t.tif; echo "sea $t"; }
done; done
for t in Copernicus_DSM_COG_10_N37_00_E126_00_DEM Copernicus_DSM_COG_10_N33_00_E126_00_DEM; do
  curl -fsS -o dem30/$t.tif https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/$t/$t.tif && echo "got $t"
done
for f in ne_10m_land ne_10m_coastline; do
  curl -fsSo ne/$f.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson
done
for f in airports runways; do
  curl -fsSo ourairports/$f.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/$f.csv
done
cd ../docs
curl -fLo easa-tcds-a064.pdf https://www.easa.europa.eu/en/downloads/16507/en
curl -fLo airbus-ac-a321.pdf https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2024-06/AC_A321_0624.pdf
curl -fLo easa-tcds-im-a-115-787.pdf https://www.easa.europa.eu/en/downloads/7302/en
curl -fLo boeing-acap-787.pdf https://www.boeing.com/content/dam/boeing/v2/airports/acaps/787_ACAP_Rev_Q.pdf
curl -fLo easa-tcds-im-e-102-genx.pdf https://www.easa.europa.eu/en/downloads/7641/en
curl -fLo boeing-arc-approach-speeds.pdf https://www.boeing.com/content/dam/boeing/v2/airports/faq/arcandapproachspeeds.pdf
curl -fLo easa-tcds-im-a-003-777.pdf https://www.easa.europa.eu/en/downloads/7521/en
curl -fLo boeing-acap-777-300er.pdf https://www.boeing.com/content/dam/boeing/v2/airports/acaps/777-200LR-300ER-F_Rev_G.pdf
curl -fLo easa-tcds-im-e-002-ge90.pdf https://www.easa.europa.eu/en/downloads/7799/en
```

Expect roughly 30 "got" lines for the 90 m tiles. The tile URL pattern was confirmed from the GLO-90 STAC catalogue.

## Distances (great-circle, from OurAirports' coordinates)

- Gimpo–Jeju: 243 nm (451 km)
- Incheon–Jeju: 238 nm (440 km)
- Gimpo–Incheon: 17 nm (32 km)

A real Gimpo–Jeju flight is about 45–55 minutes in the air, and only about 10 of those minutes are cruise.

## Sources

- [Airbus: A321neo](https://www.aircraft.airbus.com/en/aircraft/a320-family/a321neo)
- [Airbus: A321 Aircraft Characteristics, June 2024](https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2024-06/AC_A321_0624.pdf)
- [EASA TCDS EASA.A.064](https://www.easa.europa.eu/en/downloads/16507/en)
- [OurAirports data](https://github.com/davidmegginson/ourairports-data)
- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/), and its [naming readme](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)
- [Geofabrik: South Korea](https://download.geofabrik.de/asia/south-korea.html)
- [Natural Earth vector data](https://github.com/nvkelso/natural-earth-vector)
- [The 50-40-30-20-10-RETARD callouts](https://flyawaysimulation.com/ask/answers/50-40-30-20-10-retard-landing-callouts/)
