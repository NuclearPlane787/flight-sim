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
14. **Weather:** "Clear skies for now, and we'll add weather in a future update." Day only; night is on the roadmap. **Superseded:** night came in v0.2.0, and the weather in v0.4.0 (2026-11-10; "The weather (v0.4.0)" below, `briefs/V0-4-0.md`). Clear skies are still the default.
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

`briefs/V0-3-0.md` was the brief. A type is one data module with every number and its source (`src/sim/<id>.js`), one geometry module (`src/geometry*.js`; same frame and names) and one entry in `src/sim/types.js`. The sim's modules are factories that take the data (`createFlightModel(A)`, `createEngines(A)`, `createGear(A)`, `createFbw(A)` or `createFbwBoeing(A)`, `createAutopilot(A)` or `createAutopilotBoeing(A)`), made once per type by `kitFor()`. `createSim({ type })`, `sim.setType(id)`; a snapshot carries its type, and one without it is the A321neo, so the prediction worker flies the right aircraft. `ready: false` keeps a type out of the picker. `tests/golden-a321.test.mjs` flies a flight recorded from v0.2.2's code and compares it to 1e-9: never re-record it to make a test pass. `main.js`'s `useType()` is the one place everything that reads the type is told. To add a type: copy a Boeing's two modules and its notes file, add its spec (`src/widebody-specs.js`), window design, registry entry and `src/type-assets.js` line, and run the same tests with its id (`BOEING_TYPE=<id>`).

**v0.4.3, the 777's pitch** (Shane: "The 787 seems to stabilise itself well when I pitch, but the 777's pitch stabilisation only improved by a little"): its elevator and stabiliser power are the 787-9's per unit of tail volume (from the drawn planforms: V_H 1.106 against 0.943; `CM` in `src/sim/b777-300er.js`), and Boeing auto-trim's path mode (gear down, landing flaps, hand flown, not in the flare or a go-around) caps the pitch rate at 2.2°/s (`PATH_Q_MAX` in `src/sim/fbw-boeing.js`). Both Boeings stop within about a degree of where the key comes up and settle in under a second (`tests/boeing-pitch-settle.test.mjs`); at v0.4.2 the 777 went on 2.8° and swung 2.7° back over 3.7 s.

## The weather (v0.4.0)

`briefs/V0-4-0.md` was the brief; Shane's decisions (2026-11-10) are in it. In short:

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

`briefs/V0-5-0.md` was the brief; Shane's decisions (2026-11-13) are in it: engines, weight and fuel; the Warehouse on the main menu; realistic limits. In short:

- **A design** is one plain object (`src/sim/designs.js`): `{ v, id, name, registration, base, engine, count, stations, thrustScale, oewDeltaKg, fuelCapacityKg, gearExtendM }`, clamped by `normalizeDesign()` (the stations within the wing and clear of the gear and of each other; the thrust scale 0.5 to 3; the empty weight −15 to +30 %; the fuel half to twice the base's, the change in the centre tank; the gear up to 1.5 m longer). `designDef()` makes it a type entry with the base's id, model, cockpit and screens, and its own data and geometry: one `ENGINES` and `NACELLES` entry per engine (engine 1 the left outboard, then inboard, the tail, and the right wing out), the mass, CG and inertias with each engine's installed weight (1.45 × dry [EST]) against the base's, the gear and `GROUND_Z` lowered, a crash point per nacelle, and the pylons' limits.
- **The engines** are parts (`src/sim/engine-types.js`): each engine type's own numbers, taken from its aircraft's data module, its nacelle and its dry weight; the lever law and the climb and MCT fractions stay the airframe's. The sim's core keeps them as five arrays (`eN1`, `eN1t`, `eRev`, `eThr`, `eFf`), stepped in one loop in the old order, so the three types fly their golden flights to 1e-9; a v0.4.4 save's named engines become the arrays (`migrateEngines()`).
- **Saves carry the design whole** (`sim.snapshot().design`); the prediction flies it; a scenario keeps its own copy; the logbook names it.
- **The limits:** each pylon holds 1.5 times its engine type's rated take-off thrust (CS-25's ultimate factor), and 0 to 10 % more as built, fixed by the design's parts. Past it the engine tears off: its thrust and fuel stop, its mass leaves, the model hides it, the screens show OFF (`engineOff`). Indestructible doesn't stop it. Each nacelle strikes the ground as the crash points do.
- **The model** (`src/engine-model.js`): one builder for all three engine types, so any engine hangs on any aircraft at its station, the tail engine through the fin's root, each fan on its own engine's N1, and on the Boeings each engine's own span as its bend (`bendY`). Longer gear grows below the wing.
- **The screens and the sound:** the engine panel and the EICAS draw every engine (`src/ui/engine-row.js`); the synth gives each engine its own voice, up to six, panned by its place. Two engines draw and sound exactly as before.
- **The warehouse** (`src/ui/warehouse.js`, `src/designs-store.js`): the designs under `gamedump:flight-sim:designs`; the editor's 3D view draws only while it's open.

**The hangar (v0.5.1).** The warehouse's view stands the design in a maintenance hangar (`src/ui/hangar.js`), one size for every type: 150 m by 140 m inside, 28 m to the trusses' bottom chords, the doorway 120 m wide and 24.8 m high, sized for the 777-300ER with room to walk round it. The aircraft's nose points at the offices along the back wall; behind its tail the doors' leaves are slid back to leave the middle 70 m open onto a sunlit apron, as it came in. The floor's lead-in line has a stop bar at each type's nose wheel (`GEAR.nose`). Everything static is merged by material (eight meshes), the people are five instanced meshes, and the camera stays inside the room (`cameraBox()`, `rayExit()`). The people walk only while the editor is shown, at 30 frames a second.

**Parts anywhere (v0.5.2).** Shane, 2026-11-14: "I want the flexibility of the warehouse to be somewhat like the sandbox in Kerbal Space Program", then "KSP-type attaching and physics". v0.5.2 (the Cowork session) is the attaching; v0.5.3 (a Claude Code run, `briefs/V0-5-3.md`) the airframe from parts with its handling from them.

- **A design is parts** (`v: 2`): the base's airframe is the root, and `parts` lists what's attached: engines (`mount`: under the wing, over it, on the rear fuselage's side or in the tail; each its own type and thrust scale, nudged `dx`, `dz` and turned `yaw`, `pitch`), wing tanks and hold tanks (`kg` of fuel), ballast. A part on one side has a mirror twin by default (`pair`, both ends naming each other); editing either edits both (`updatePart()`), removing one removes both. Up to 8 engines and 24 parts. A v0.5.0 design (`engine`, `count`, `stations`, `thrustScale`) becomes parts on the way in (`normalizeDesign()`), with the same nacelles, thrust, masses and pylon scatter, so it flies as it did.
- **The mounts** (`airframe(base)` in `designs.js`): the wing as a straight-tapered planform from the fuselage's side, with its leading edge, chord and heights tied to the base's own nacelle; over the wing, a nacelle at 55 % chord, 0.65 m over the upper surface; on the body, 0.55 m off the fuselage's side, 12 % of its height above the middle, between the tail cone and the wing's root; a wing tank's teardrop (its volume its fuel; 4 diameters long) 0.45 m under the wing. `mountRange()` keeps each station inside its mount.
- **What each part brings** (`designDef()`): its mass at its place against the base's two engines (the CG and the inertias); its drag area at its place (`DRAG_PARTS`: every nacelle at CD 0.05 on its frontal area, less the base's two, which are in its CD0; a wing tank at 0.08), applied in `sim.js` against the airflow with its moments; each engine's thrust along its own line (`THRUST_DIRS`), with its moments; each engine's own numbers when the types or thrusts are mixed (`ENGINE_DATA`, one engine kit each); the tanks' fuel in the centre tank (burned first) with its CG; each engine's voice (`sounds`) when the types are mixed; a crash point under each tank. A design whose engines are the base's own, untouched, keeps the base's geometry exactly, so a design that is its base flies its golden flight.
- **The editor** (`ui/warehouse.js`): the palette over the view; the pointer as a ray in the geometry frame, met against the airframe's shapes (`hitAirframe()`: each wing's mid-surface over its planform, the fuselage as an elliptic cylinder whose crown at the fin is the tail's mount, the fin) and the parts' boxes (`pickPart()`: not through the wing); `placement()` turns a hit into a part, snapped to 0.25 m; a ghost (the part placed, green or red) in an overlay drawn over everything with the selection's boxes, the hold's parts and the CoM and CoT markers. Undo and redo keep whole designs (`createHistory()`). The checks: `readout()` with `thrustLine()` (the thrust's centre, resultant and moments about the CG at full thrust: the yaw against the base's with an engine out, the pitch against the base's).
- **Still the base's:** the wing, the fuselage and the tail, and with them the lift, the stability and the controls' power. That's v0.5.3: each part's own lift and drag, one rigid body (no flex, no breaking).

**The airframe from parts (v0.5.3).** Shane, 2026-11-14: "Handling from parts" (one rigid body, no flex and no breaking). A Claude Code run built it from `briefs/V0-5-3.md` (2026-11-15, 03:56 to 05:38 KST, then 11:35 to 12:42); the Cowork session reviewed it.

- **The field** (`airframe` on every normalised v2 design; `defaultAirframe()`, `fixAirframe()`, `isBaseAirframe()` in `designs.js`): `{ wingL, wingR: { span, chord, sweep, dihedral }, mirror, tail, fin, plugFwd, plugAft }`, and `sharklets` on the A321. Span and chord 0.8 to 1.3 (× the base's exposed span and its chord everywhere), sweep −8° to +8° (added at the quarter chord, swung about the root's quarter chord), dihedral −3° to +8° (absolute), tail and fin 0.6 to 1.6 (× area, aspect ratio and sweep kept), plugs −4 to +6 m (each 1 m clear of the wing's root; the wing, the main gear and the reference point stay where they are). A design without the field, or with the base's values, is its base's airframe and flies the base's lumped model alone, to the bit.
- **The aerodynamics** (`src/sim/parts-aero.js`): each wing side as a carry-through strip and six more, each half of the tailplane as three or four, the fin as two or three; each strip in its own airflow (the body's velocity plus ω × r, the wing's downwash at the tail lagged by its arm, the sidewash at the fin), worked in its normal plane (simple sweep theory), its section the lumped model's own lift curve with the slats' and flaps' increments on the strips that carry them, a stall per strip (the root first), profile, induced and wave drag (the critical Mach on each side's sweep), a quarter-chord moment; the fuselage's Munk moments, side force and drag. Calibrated with one physical factor per row (`parts-aero-cal.js`, written by `tools/fit-parts-aero.mjs`) against each type's lumped model, the moments at the clean 250 kt point; the validation table is in `STATUS.md` (2026-11-15, 04:18 KST) and `tests/parts-aero.test.mjs` holds it.
- **A design's coefficients** are `lumped(base) + parts(design) − parts(base)`, on the base's references S, b and c (`partsDeltaInto()`, after `coefficients()` in `sim.js` and in `trimAirborne()`). The elevator, the ailerons and the roll spoilers stay out of the difference (the laws invert them); their powers' differences go to `CmElev` and the roll law's scale. The speeds on the tape and the protections use the design's maximum lift (`clmaxDelta()`), so a bigger wing's stall speed is lower. The maximum lift falls with Mach as the base's does and MMO stays the base's, so sweep changes the wave drag, not the speed bands.
- **What follows from it** (`designDef()`; the maps of `airframe-map.js`'s `airframeMap()`): the geometry (the eyes, the nose gear, the tail-strike point, the crash points, the nacelles and tanks on the wing); the structure's mass (`airframeMasses()`: [EST] fractions of the OEW, the wing's with span^1.15 · chord^0.15 / cos Λ, the tails' with area^0.75, the plugs by the metre) with the CG and the inertias; the wing's fuel with span × chord²; the tail-strike angle; `GAIN_SCALE` for the laws; the take-off stabiliser for the design's own tail (`AIRFRAME_CG_SHIFT`); the landing score's pitch band (`scoreBand()`); the stands by the design's own span and length (`standGeo()` in `ground/taxi.js`).
- **The checks** (`designNumbers(def).airframe`, `readout()`): the static margin from the parts' neutral point (red below 0, amber below 5 % MAC), Cnβ, the 1 g stall and the approach speed at MLW, the tail strike, the nose wheel's load standing and at full thrust, the span's ICAO code letter against the stand's. Engines or tanks touching the ground standing: saved, not flown (`touchesGround`).
- **The model** (`mapGeometry()` in `aircraft.js`; `AirframeBuilder` and `plugPlan()` in `widebody.js`): the changed parts' vertices through the maps, their hinges and bones too; the fuselage lofted over its new length, its windows repeated or removed a whole pitch at a time.
- **The editor** (`AIRFRAME_ON` in `ui/warehouse.js`): click the wing, the tailplane, the fin or the fuselage (`pickAirframe()`); its sliders in the side panel, Mirror for the two wing panels, a green outline while a slider moves, the model rebuilt on release, one undo step a drag.
- **The controls** (`gainFor()` in `fbw.js`): what works in surface deflection (the yaw damper, the turn coordination, the ground mode's direct pitch, the Boeing autoland's alignment) scales by the inverse of the design's control power per inertia against the base's, within ×0.5 to ×2; the pitch and roll loops already invert the design's own powers.

**Shane's list after v0.5.3 (v0.5.4).** Shane, 2026-11-16; built by the Cowork session with five subagents.

- **The landing score out of 10** (`score.js`): Shane, "Instead of a strict subtraction system, we have something like 9/10 or 3/10 for a category. Otherwise it is too easy to get a 0." Each part keeps v0.1.3's cost (0 at its ideal, smooth away from it) and scores round(10 × e^(−cost/k)) with its own k (`RATE`), so good values give 9–10 and bad ones 0–3; the total is the weighted average × 10. A weighted average lets the other parts make up for one bad one, so the worst part caps the total at 50 + 10 × its score (`WORST_CAP`), and a taxiway or a would-be crash caps it at 10, the grass at 49 (`CAP`). Shane's v0.1.3 reference landing stays the anchor at 80.
- **Sweep and Mach:** the strips' maximum lift falls with the Mach number normal to their side's quarter chord (M × cos Λ_side / cos Λ_base, exactly M on the base's wing), and a design's MMO is the base's × cos Λ_base / cos Λ_mean (Korn's 1/cos Λ for the drag rise), within 0.70–0.95. Both are 1 to the bit on an unswept change, so the three types and v0.5.3's designs without sweep fly as before.
- **Drop tanks:** the core's `tanksDropped` (saved, rewound, predicted) takes the pods' empty mass, their drag and strike points, and the fuel above the airframe's own centre tank up to what they held; the airframe stays put and the CG moves inside it.
- **The pause:** one pause, two ways in: the pause menu (Esc) and a quiet pause (the HUD's button, or the menu's Weight and fuel and Time of day), in which the L window works and nothing steps.

**Keys and the warehouse's leftovers (v0.5.6).** Shane, 2026-11-18: "A keybindings selection per plane instead of general rule. That is, you can give each engine or two their own keybinding for powering up and down, or change the default key settings like ailerons, elevators, rudder, flaps", and the flaps on − and =; then "You can work on v0.5.6, all of mine plus yours, overnight."

- **Bindings** (replaced by v0.5.7's block, below) (`src/keys.js`, `src/input.js`): the defaults are code; the store (`gamedump:flight-sim:keys`, `{ v: 2, global, scopes }`) keeps only changes: `global` for the keys that aren't parts (the Controls page: views, time, the autopilot, map, pushback, rewind, QNH, the readout), `scopes` (`type:<id>` / `design:<id>`) for the parts' (set in the warehouse, Besiege-style: each part's tab of keycaps; Shane, 2026-11-18: "Move the keybinding settings thing to the warehouse, where you can attach keybindings by selecting plane parts like the engines"), a design falling back to its base type's. Each part control belongs to a part (`part:` in `BINDINGS`: engine, wing, tailplane, fin, fuselage, wing tank); the two sides refuse each other's keys. `e.code`, plain keys (Shift for taps only); Esc, L and the browser's own keys reserved.
- **Engine groups** (v0.5.7: each engine on its own instead, below) part the levers: `controls.thrustEng` (null, or one lever per engine; engine i's lever is `thrustEng?.[i] ?? thrust`), each engine's command ring from its own lever (`state.engines[i].leverN1`). Null computes exactly what one lever did (the golden flights). The A/THR, driving, brings the levers together, and a group's key disconnects it (the Boeings' A/T too, from `main.js`: its hand-on-lever override would take the levers back while the key is held); apart, `controls.thrust` is the highest lever (the A/THR's modes, MAN TOGA, the callouts), and idle, the speedbrake inhibit and the ground spoilers go by it, reverse by any.
- **The swept wing's area:** a strip's area is its chord times its width across the span (it was its length along the sweep, so sweep grew the wing); the calibration refitted (`kA` towards 1). A design on its base's airframe is still exact, by construction.
- **The main gear follows the wing** (`applyAirframeGeo()` in `designs.js`): each leg at the stock leg's place relative to its side of the wing, so the wheelbase, track, tail-strike angle, nose-wheel share and stands follow; a smaller chord brings the legs forward of where the CG needs them, so the wing can move (`airframe.wingX`, −3 to +3 m: the wing's map, strips, structure, fuel and gear shift together; 0 keeps a design on its base's airframe exact). The take-off trim discounts what the airframe itself moves (engines and tanks carried by a swept or moved wing).
- **Take-off trim** balances the moments about the main wheels at the base's lift-off speed (`takeoffThs()`), so a bigger tail's aft CG no longer lifts the nose early.
- **VMC** (`designNumbers()`: `vmcKt`, `vmcAllKt`, `vrKt`): full rudder from the fin's own power, the worst engine out and the rest at full thrust, 5° of bank, at the lightest runway weight; against VR (1.08 × the stall in take-off flaps), as certification wants VR ≥ 1.05 VMC.

**The key block and the new home page (v0.5.7).** Shane, 2026-11-18: "we should leave a chunk of the keyboard completely free of keybindings … when you assign keys in the warehouse, you can only assign from those 12 or 16 keys, and in a scenario, their controls like flaps, the 3 axes, and all those uses keys not part of the key block"; "Allow me to edit the settings for each engine one by one, not altogether or in pairs"; the moved keys' new homes; a keyboard drawing on the Controls page; and a new home page from his mockup.

- **The block** (`BLOCK` in `src/keys.js`): Digit7–Digit0, KeyU–KeyP, KeyJ–Semicolon, KeyM–Slash, and Shift with them. 16 rather than 12 because a design can have 8 engines, each wanting an up and a down key; under the right hand so the left keeps every flying key (Shane's own 16-key block would have taken F, G, C, V and B). Only the warehouse sets block keys, and it sets only those; the Controls page refuses them, and the warehouse refuses everything else ("Only the block's keys here").
- **The store v3** (`gamedump:flight-sim:keys`, `{ v: 3, global: { bind }, aircraft: { 'type:<id>' | 'design:<id>': { engines: { <part id | index>: { up, down } }, drop } } }`), only changes from the defaults. A design's engine keys go by part id (each mirror twin is its own part) and reach the sim's engine order through `engineSlots(def)` (`geo.NACELLES[i].part`); the three types' by engine index. v2 stores migrate: valid global changes stay, per-aircraft part keys and engine groups go.
- **The levers:** with no engine key used, input takes exactly the single-lever path (the golden flights). An engine's own key parts the levers (`controls.thrustEng`); from then R and F move every lever and an engine's own keys its own, each pausing at its own detents; an engine's down key at idle on the ground holds its reverse. The all-engines lever reads the highest; a Boeing's A/T disconnects when an engine's own key takes a lever (`input.engineTook`).
- **The defaults' rule** (Shane): a key pressed more than once a flight in the air needs no Shift; rare ones may. So TO/GA is Shift+T, the local QNH Shift+B and pushback Shift+G; the map is N; the Sky window is \\ (fixed, with Cmd/Ctrl+L); the readout F3. \` Tab Caps Lock Return delete and the Shifts can't be keys (grey on the drawing: they do nothing on their own).
- **The Controls page's keyboard** (`src/ui/keyboard-map.js`): the Mac's layout as data (5 rows and the space bar, no F-row or arrows), each key's tint from the bindings (the block, the Controls page's, faint when free, or grey), a tooltip with what it does, a row's keys lit while hovered or focused.
- **The home page** (`src/ui/home-scene.js`, `home-card.js`, `home.css`, with `line-art.js`): the scene's geometry and timing are pure functions (tested); the path is a curve between two dots in the space between the title and the skyline, recomputed on resize; the plane flies a leg in 14 s, growing over its first 16 % and shrinking over its last 16 % into the dot, unseen 1.6 s, then back; the dashes flow at 26 px/s its way. The skyline (`SKYLINE`: 22 landmarks and filler blocks, 3935 × 220, seamless) tiles across the scene and slides left to right at 16 px/s. The saved flight's card reads the summary's flight fields (`flightFields()`: phase, origin, dest, at, stand, alt, distNm, landed), older saves from their `where` text; place names from the airport data (`shortName`, else the name shortened). Three backgrounds (`bg-dusk`, the default, `bg-night`, `bg-blueprint`).

**The last touches before v0.6.0 (v0.5.8).** Shane, 2026-11-19: the home page's ground band, the suitcase and travel photos, stars and an aurora; "the roll and yaw deviation when I remove thrust from one side is too low"; and "when I change the name in the warehouse, all appearances of that name in the game should automatically update. Maybe the name could be a stored variable instead of a one-time change thing?"

- **A thrust asymmetry's yaw is the pilot's** (`asymmetryInto()` in `fbw.js` and `fbw-boeing.js`, `E.nThrust` from `sim.js`): the engines' own yaw moment, exactly 0 for symmetric thrust (under 1e-9 of the total counts as 0, for roundoff), gives the sideslip that balances it with the rudder centred and the yaw rate that sideslip's side force makes; the yaw damper and the turn coordination act only on what's left over, so they still damp turns, gusts and the Dutch roll but don't centre a steady asymmetric sideslip (real yaw dampers are washed out; only TAC, not modelled, puts the rudder in). On the Boeings the hands-off roll and the wheel's commanded rate drift at the dihedral effect's rate with the surfaces neutral (about 2.5°/s at 250 kt, 5°/s on an approach), fading out by 34° short of the bank protection; the A321's normal law keeps its bank. Symmetric thrust is the same to the bit (the golden flights).
- **Names are references:** whatever shows a design's name looks it up by the design's id when it's shown (`designName(id, stored)` in `designs-store.js`, memoised on the stored list's text); the name stored beside the id (the summaries, the log entries, the saved states' copies) shows only once the design is deleted. Log entries without an id take their scenario's.
- **The home page:** the band's top at the ground line (`groundLineUp(fit)`, `SKYLINE`'s baseline 8/220 above its bottom); the suitcase on the path's upper-left side; three prints with captions on their bottom edges (`PHOTOS[i].caption`, at most 24 characters; the upper print on top so each shows) (`PRINT_SLOTS`, `printSpots()`, `PRINT_SIZES`: kept inside the free area, clear of the path by half the plane's width plus 12 px, overlapping each other by at most 25 %, shrunk or dropped when space runs out); stars with three twinkling groups; the aurora as three curtains of static gradients and stripe masks (no filters), drifting over 58–83 s and shimmering over 9.5–15 s, its strength by background.

## East Asia (v0.6.0)

Shane's decisions are in `briefs/V0-6-0.md` (2026-11-19, final); `STATUS.md`'s v0.6.0 entries (2026-11-19, 15:15 to 01:30 KST) say how each part was built and checked; `README.md`'s "The region (v0.6.0)" is the player's view.

- **The region:** Korea's map frame grown, not a new one: 250 m data over 29–40° N, 119–142° E, and 1 km land out to about 24–46° N, 112–148° E (`MAP_EXTENT`). Korea's lattice (250 m cells from (−400 km, −400 km)) is extended both ways, so South Korea's heights stay to the bit and the golden flights fly the same over the region's tiles.
- **Tiles:** 128 km tiles at 250 m and 1 km, each with a border of its neighbours' cells, listed in the manifest (the region's in `tilesRegion`, `data/terrain/r0/`, `r1/`; Korea's own `l0/`, `l1/` for the flags-off game). `src/world/tilestore.js` loads round the aircraft, the camera and the flight's ends, retries a failed file, pins and evicts; `heightfield.js` keeps its API over it. The sim never reads a missing tile: the game's loop, a jump, a new flight and a loaded scenario wait for theirs (`region.js`'s loader), and the prediction worker loads what each chunk will reach.
- **The GPU:** a clip window per layer that follows the camera, refilled a 512² block at a time, with the 1 km level beyond it; the nearest four 30 m patches and twelve runways in the uniforms; `PEAK` raised for Fuji.
- **The flags** (`src/world/region.js`): `EAST_ASIA_ON`, `CITIES_ON` and `GROUND_ON`, on by default; `?eastasia=0&cities=0` is v0.5.8's Korea pixel for pixel, `?ground=0` the old ground; `FS_EAST_ASIA`, `FS_CITIES` and `FS_GROUND` set them in node.
- **The local rules** (`src/world/geo-rules.js`, `data/country.*`, `data/magvar.*`): the country by position (the sea takes its nearest land's); WMM2025 outside `south-korea.poly`, Korea's plane inside it, blended over 50 km; the sun, Moon, stars and wind turned by the grid convergence; inHg in Japan; China's metric altitude on the PFD and Pudong's 3,000 m / 3,600 m transition; local time through `Intl`; each country's METAR.
- **The airports** (`tools/bake_region_airports.py`, `data/airports/`): eight new ones, built in clusters near the camera in 4 ms slices (`airport-set.js`, `airport-worker.js`); the region's own taxi rules (`regionRules()` in `ground/taxi.js`, the taxi-in exits in `ground/gate-flow.js`); Korea's three unchanged.
- **Cities** (`CITIES_ON`): each country's block mix in `cities.js`; nine centres of real OpenStreetMap buildings (`centres.js`, `centres-worker.js`, `data/centres/`), which mask the procedural blocks; nineteen landmarks (`landmarks.js`, `landmark-models.js`), our own models from public figures.
- **The ground** (`GROUND_ON`): WorldCover's land cover at about 31 m near the camera (`finecover.js`), with Korea's 250 m cover re-aggregated from it; the field mosaic, tracks, tree lines and terraces, the canopy and trees to 3,000 m above the ground, houses and sheds by country (`rural.js`), greenhouse ground, ponds.
- **Size and cost:** `data/` is 153 MB (13 MB before), no file over 6 MB; the worst frame in a 16× cruise from Seoul to Tokyo is 16.8 ms; 1.3 to 1.9 M triangles near the big cities at 60 fps.

### v0.6.1 (2026-11-20)

- **Yancheng Nanyang (ZSYN),** the twelfth airport, baked as the eight were (`tools/bake_region_airports.py`, its 30 m patch by `bake_region_patches.py`); its stands and holds are made from OSM's geometry where OSM names none (`[EST]`), and its widebody starts are on the runway or a final only (a code C aerodrome). It waited behind `PENDING_ON` (`src/world/region.js`; `?pending=1`, `FS_PENDING=1`; the manifest's `airportsPending` and `patchesPending`) until it passed the check the eight passed.
- **The culling:** houses, trees and the greenhouses' tunnels are listed on the CPU only for the cells where one stands (from the same data and hashes the shaders use), and the cities' blocks, the centres' low buildings and the parked traffic are drawn only in view. Near the big cities the scene is about a million triangles (1.3 to 1.9 M in v0.6.0). `?cull=0` turns it off for comparison.
- **Greenhouses** (`src/world/greenhouses.js`): low instanced tunnels on the glass ground near the camera, the glass patches on an exact lattice (`glassPatch()`) so the CPU can list them; `?greenhouses=0` leaves them out.
- **The small waters** (`fineWater()` in `finecover.js`): a nine-pixel quadratic B-spline where the four-pixel footprint holds water.
- **The taxi graph** (`ground/taxi.js`, `ground/gate-flow.js`): a runway's rectangle runs between its pavement ends, not its thresholds (Gimhae 18R's 600 m displacement, Haneda's three); taxi-in exits ahead at Narita and at Korea's airports with the region on (with it off, Korea's 624 cases are v0.5.8's exactly).
- **Testing:** 1232 unit tests, which run in a clean clone of the public repository (`region-airports.test.mjs` skips OurAirports' cross-check without `reference/raw/`); every browser script headless by default, `--headed` to watch.

### v0.6.2 (2026-11-20)

- **The landing score** (`src/score.js`): the parts are the touchdown's (vertical speed, peak g, the touchdown point, the centreline, bank, pitch, bounces); the approach is measured (`approachStats()`, `result.approach`) but not scored; the worst-part cap (50 + 10 × its score) is vertical speed's alone (`CAPPED_BY`). The grass (49 at most), a taxiway and a would-be crash (half) still come off. Old logbook entries keep their rows (the card still knows how to show the approach parts).
- **The top bar** (`ui/hud.js`, `ui/ui.css` `.fsui-topbar`): one row, the panels switch and Pause, the FCU or MCP, the view switch. A grid with the FCU centred while the wider side leaves room; else `.packed` (flex, from the edges); then the view switch without its key caps; then every part's font down together, to half at most. Laid out again on any part's resize (a ResizeObserver, next frame), a font arriving, and, as a safety net, whenever it overflows (checked twice a second in `update()`). The side panels start 6 px under it.
- **Panel size:** the panels' size from the window (`max(200, min(H × 0.43, W × 0.27, 560))`) times the setting, 0.5 to 1.2, kept on the screen and clear of each other; `hud.setPanelScale()`, saved in the settings as `panelScale`.
- **The heading tip** (`ui/map.js`, `ui/common.js` `headingForTrack()`): the leg's grid track, crabbed into the aircraft's mean wind at its true airspeed (none under 40 m/s), turned magnetic where the pointer is.
- **Circling-only ends** (`world/runways.js` `CIRCLING_ONLY`, `end.circling`): no final start (the setup refuses it; a URL's starts on the runway), no Skip to final (a toast says why), no 15 nm final line on the map, and Change route says so.

### v0.6.3 (2026-11-21)

- **The 250 m data is a set of tiles, not a box** (Shane, 2026-11-20). The bake's tile list is explicit (`tools/bake_region_tiles.py`: v0.6.0's 180 tiles, which `box_tiles()` still enumerates from the box 29–40° N, 119–142° E, and 26 more round Beijing, down the Beijing–Shanghai route and north to Vladivostok). A new tile is composed alone and then sealed: its 2-cell border is copied from the neighbour that owns those cells, an old tile is never composed again, and its core is checked unchanged. The 1 km tiles are re-averaged only in the cells over a new tile. `FINE_EXTENT` is the tiles' bounding rectangle; `fineOutline()` (`src/world/region.js`) gives the map their real outline from the manifest's `covered` list.
- **Five airports** (ZBAA, ZBAD, ZYTX, ZYTL, UHWW), baked as Yancheng was and held behind `PENDING_ON` until each passed. New in the bake: `TRIM_BOTH` (Daxing's runways drawn over their blast pads, cut equally to the published length times the frame's scale), `PP_CHAINS` (Shenyang's and Dalian's stands are the dead ends of OSM's parking-position lines), `STAND_POINTS` (Vladivostok's stands by position, numbered as the AIP's chart), `FIELD_PLANE` (an airfield flattened to the plane through its runway ends where one elevation would stand the aprons on a step), `coastPatchesPending`. A baked length is compared with a published one after dividing by `scaleFactor()` there.
- **Russia** (`RU`, code 6 in `data/country.*`; `COUNTRY_RULES.RU`): hPa and feet, 8,000 ft and FL090, Asia/Vladivostok, the METAR's wind in metres per second (`metarFormOf()`: `ru`), from AIP Russia for Vladivostok and taken for the whole of Russia's part of the map.
- **The map's cities** (`tools/bake_region_urban.py` → `data/urban-region.json`; `buildUrban()`, `pickPlaces()` in `src/ui/common.js`; `src/ui/map.js`): the built-up cover on a 500 m grid, a Gaussian of 1.6 cells cut at 0.30, shapes under 6 km² dropped, rounded and simplified into rings drawn as a tint on the land at four levels of detail; names from Natural Earth's populated places, the smallest named city falling with the zoom (`placePopMin()`: about five million with the region on the screen, every place from about 0.003 px a metre), each centred on its city or moved off an airport's label. `?mapcities=0` leaves both out; with the region off the file isn't loaded.
- **Centres and landmarks:** five more centres (`data/centres/`), seven more landmarks, two of them bridges: a bridge is based at the sea, its deck's ends take the ground at both shores (`bridgeEnds()`), and the centres leave out only its pylons' circles.

### v0.6.4 (2026-11-21)

- **Ten more tiles over Hokkaido** (`tools/bake_region_tiles.py`'s `BATCHES`: each version's tiles and staging; `FLIGHT_SIM_TILES_VERSION` picks one, so an earlier batch still re-bakes as it was). `wc_missing()` tests a tile's real outline, not its lat/lon box.
- **Six airports** (RJCC, RJSA, RJSS, RJSN, ZKPY, ZKWS). New in the bake: `THR_AT` and `THR_LEN` (an OSM runway drawn over its blast pads: each end put at the published threshold along OSM's axis, both trimmed to the published length times the frame's scale), `SPOT_REFS` (OSM's stands numbered from the AIP's published spot positions), `STAND_EXCLUDE` (light-aircraft aprons), `RUNWAY_SKIP` (Pyongyang's closed 01/19, Wonsan's strip), `FIELD_RUNWAYS` (a field that follows each runway's own slope where one plane can't: Sendai, Niigata).
- **Circling-only ends** (`CIRCLING_ONLY` in `world/runways.js`): Wonsan's 33L and 33R join Gimhae's 18L and 18R.
- **North Korea** (`COUNTRY_RULES.KP`): hPa and feet, 12,000 ft and FL130, Asia/Pyongyang, the `kp` METAR form (metres per second): open secondary sources, `[EST]`.
- **Centres and landmarks:** four more centres, four more landmarks (thirty).
- **The terrain cache** (`src/world/heightfield.js`, `tilestore.js`): the airports' pinned tiles plus `FREE_TILES` (27) for the flight and the view, where it was a flat 48 (twenty-three airports pin 48 themselves). A new airport no longer eats the view's room.

## The regions, and Europe (v0.7.0)

Shane's decisions are in `briefs/V0-7-0.md` (2026-11-21, final); `STATUS.md`'s v0.7.0 entries (from 2026-11-21, 04:28 KST, through the overnight and morning sittings) say how each part was built and checked; `README.md`'s "The regions (v0.7.0)" is the player's view.

- **v0.6.0's flags retired first:** `EAST_ASIA_ON`, `CITIES_ON`, `GROUND_ON` and every flags-off path; Korea's own tiles and national files (17.8 MB: `data/terrain/l0`, `l1`, the national grids, `coast.json`) out of `data/`, the manifest's `national` and `tiles` sections with them; South Korea's `c2` cover renamed over its tiles' `c` (the same bytes). `krmask.*` stays (South Korea's magnetic plane). `PENDING_ON` stays.
- **One region a page.** `src/world/regions.js` is the registry: each region's id, name, frame (origin and standard parallels), tiles' lattice origin, data folder, outline, magnetic plane and lists. A page is in the region of `?region=` (on its own URL, or a worker's), then `FS_REGION` in node, then the last used (`gamedump:flight-sim:region`), then East Asia. `frame.js` takes its constants once, at import, from that region, so its importers didn't change, and East Asia's are the same doubles as before. Switching region reloads the page into it, carrying the scenario to start in sessionStorage (`switchRegion()`, `takeCarry()`); the region is remembered only once the game is up. Workers get the region on their URL (`regionQuery()`), since they have no storage.
- **The outline** (`src/world/outline.js`) replaces the rectangle where the code assumed one: the map's extent (`mapExtent()`) and panning, the path map's edge, and where a predicted path ends (`predict-core.js`'s `why = 'map'`: past the rectangle, then past the polygon where a region has one). East Asia's is its rectangle; Europe's is ten points in latitude and longitude, edges along the parallels and meridians, densified every 0.25° to 420 and projected.
- **The data folder:** East Asia's stays in `data/` (nothing moved in git), Europe's is `data/europe/` with the same layout and the same manifest keys, so no loader needed a second form. Everything that loads a region file takes the folder (`dataUrl()`): the manifest, tiles, 31 m cover, airports and patches, coast, urban areas, country raster, WMM grid and centres, in the page and in the prediction, airports' and centres' workers.
- **Saves and the picker:** a scenario carries its region in its index entry and its state (East Asia's are written exactly as before, with no field, so a save without one is East Asia's; a v0.6.4 save loads to the bit); a save of a region this build doesn't know keeps its tag and says so. The Load list groups by region; loading the other region's save reloads into it. New scenario asks for the region first while more than one is offered (`EUROPE_ON`); the warehouse's Fly it uses the last. `AIRPORT_INDEX` (every region's airports: ICAO, short name, region) lets the home page's ticket, the Load list and the logbook name another region's airports without loading it.
- **Europe's frame and lattice:** a Lambert conformal conic on WGS84 at 47° N 4° E, standard parallels 39° and 54° (scale +0.74 % at Gibraltar, −0.85 % at 47° N, −0.13 % at Dublin, +0.54 % at Edinburgh, +1.70 % at 59° N; convergence −9.56° at Lisbon, +9.14° at Vienna). Its lattice's origin is the frame's (tile `0_0`'s south-west corner at 47° N 4° E); the levels are East Asia's (250 m in 128 km tiles of 512 cells with 2-cell borders, 1 km in 512 km tiles, 31 m cover in 32 km sub-files). Six places that had East Asia's −400 km written in take the region's lattice. The outline: 35° N 11° W, 59° N 11° W, 59° N 19.5° E, 42.5° N 19.5° E, 39.6° N 18.6° E, 36.3° N 16.0° E, 36.3° N 12.0° E, 37.6° N 11.0° E, 37.6° N 1.0° E, 35.0° N 2.5° W.
- **The bake in batches.** The frame and the outline are fixed for all of Update 7; the 250 m data comes a batch per version, every 128 km tile with land within 200 km of an airport's reference point. v0.7.0's batch A is 93 tiles (64 MB) for airports 1 to 11; the 1 km level covers the region's whole bounding rectangle from the start (30 files of 36 tiles); the 31 m cover every sub-file with land within 100 km of an airport (354 files, 30.8 MB), and where the 250 m data has no 31 m cover the ground draws from the 250 m cover (a hole inside the 250 m data reads as "no data"). The coast file, the urban areas, the country raster (a byte a cell at 2 km, its codes in its manifest: 32 of them, more than East Asia's three bits hold) and the WMM2025 grid (10 km) cover the whole region. Each step through the guard into staging, tile by tile; installed by `tools/install-region.py` (each file against its SHA-256, only the terrain's keys merged into the manifest). Seams: 0 values differ at 250 m and 1 km. A later batch is added as v0.6.3's and v0.6.4's were: compose, seal, re-average the 1 km cells, prove the old cores by hash.
- **Land below sea level:** Europe's heights store the sea as exactly 0 m and a land cell never as 0 (`"lowLand": true` in its manifest and the registry). The ground's floor goes through one helper, `glsl.js`'s `seaFloor()` (`max(h, 0.0)` in East Asia, the stored height in Europe), at every shader site, `heightfield.js`'s `heightAt()` and `predict-core.js`'s ground, where exactly 0 is water. So Schiphol's polder is land at −1 to −8 m for the sim and the prediction, and East Asia's shaders are the same text as before. 261,853 cells of batch A are below 0 m.
- **Europe's rules** (`src/world/rules-europe.js`; `region.js`'s `rulesAt()`): hectopascals and feet; each country's zone through `Intl`, so summer time comes with it (`clock.js`'s `zoneLabel(zone, ms)` and `isSummerTime()`: GMT/BST, GMT/IST, WET/WEST, CET/CEST; no fixed offsets, no date rules of our own; Gibraltar on Central European time, Morocco `Africa/Casablanca`); a country's transition altitude, and **per-airport transition altitudes** where an airport sets its own (the United Kingdom's, Spain's and Italy's in their AD 2.17; Charles de Gaulle's and Orly's the Paris TMA's), applying within 60 km of the airport (the nearer where two reach) while the country and the zone stay the place's own; WMM2025 everywhere; the `eu` METAR form (`Q1013`, `9999`, `CAVOK`, `NOSIG`) for `E`, `L` and `G` codes; the setup's groups by country. `[EST]` marks what wasn't read from an AIP.
- **One-way runways** (`ONE_WAY` in `src/world/runways.js`, beside `CIRCLING_ONLY`; `runwayUse()`, `canTakeOff()`, `canLand()`, `runwayUseNote()`): an end is `takeoff`, `landing`, `closed` or `standby`, from each AIP (Frankfurt's 18, 36 and 07L/25R; Madrid's eight ends; Barcelona's 20; Gatwick's 08L/26R and Orly's 02/20 as standbys; Schiphol's `[EST]`). `createAirports()` marks each end and clears the ILS of one nothing lands on; the setup, Change route, Skip to final and the check scripts respect it, and a standby's ends are never the default.
- **The airports:** as v0.6.3's and v0.6.4's, with the bake's Europe block (`W` tile names, the sea as 0, `FIELD_PAVEMENT`: a field flattened along its pavements' profiles) and `THR_AT`/`THR_LEN` where OSM's ways stop at displaced thresholds (Charles de Gaulle, Madrid). Each waited behind `PENDING_ON` until it passed the check every airport passed, then was promoted. Munich failed once (its pushback from stand 102 crossed 150 m with no pavement: OSM maps its aprons in strips) and passed after the bake's `APRON_PUSH` paved the ground under each stand's pushback. Eight from their AIPs, three estimates.
- **The check chain and the promotion as scripts** (the chain runs 37 times over Update 7): `tools/check-airport.sh` (one airport's day, night, taxi-in, frame rates and finals), `tools/check-step.sh` (one step through the guard and a watch that stops a script hung at its close; `FS_EXCL` for a run's own lock), `tools/promote-airport.py` (pending to listed, by a read-modify-write of the manifest). No user paths.
- **The stills' fixed frame count:** `tests/browser-v060-stills.mjs` stepped a frame every 4 ms while it waited for files, so its frame count at the capture, and the shaders' clock with it, followed how fast the files came. `--total N` steps on to exactly N frames. With `--total 2400` all sixteen of East Asia's views match between v0.6.4 and v0.7.0 at max diff 0.
- **The cities by country:** five town mixes in `cities.js` (codes 3 to 7: Britain and Ireland; France; the centre; the south; the Low Countries and Denmark) and villages to match in `rural.js` (farmhouses, barns, a church with a tower in most villages), each spliced into the shaders' text only on a page in Europe (`euVert()`, `euRuralVert()`), so East Asia compiles the text it did; nine centres of real buildings (`VERT_EU` in `centres.js`); twenty-eight landmarks (`EUROPE_LANDMARKS`, `EUROPE_MODELS`; a landmark shows only in its own region). No greenhouse country in Europe (`glass: false`).
- **Testing:** `tests/region-run.mjs`'s `inRegion()` runs a file of one region inside the one suite as a child process, so `node --test tests/*.test.mjs` covers both and `FS_REGION=europe node --test tests/v070-*.test.mjs` runs Europe's directly. 1,392 unit tests; Europe's files 161.
- **Size and cost:** `data/` 322 MB, Europe 123 MB of it, the biggest file 3.8 MB; at every airport 60 fps at a stand and on the final by day and by night, worst frame 16.8 ms; the 16× cruise from London to Madrid worst 16.8 ms; Frankfurt's stand and Paris's and Madrid's centres over the million triangles.

## Europe's airports 12 to 20 (v0.7.1)

Shane's decisions and the Cowork session's choices are in `briefs/V0-7-1.md` (2026-11-21); `STATUS.md`'s v0.7.1 entries (from 2026-11-21, 12:34 KST) say how each part was built and checked; `README.md`'s "Europe's airports" is the player's view.

- **Batch B by the rule:** every 128 km tile with land within 200 km of one of the twenty airports' reference points (169 tiles on Natural Earth's 1:10 m land, 170 on OSM's; the union, 170), less batch A's 93: 77 tiles, the planning's 75 with `6_1` near Munich and `-3_-7` off Valencia (OSM's land alone). They are `EU_BATCH_B` in `tools/bake_region_tiles.py`'s `EU_BATCHES`; `FS_EUROPE_BATCH` picks the batch, and a later batch's staging holds only its new and changed tiles. Composed, sealed and re-averaged as v0.6.3's and v0.6.4's batches were. Seams: 0 values differ over 543 neighbour pairs at 250 m and 110 at 1 km (the first pass found 9 values at 7 cells that two new tiles share with a tile outside the region, mended in the new tiles' borders). Old cores: 93 of 93 identical by SHA-256; 31 old tiles change only in their borders. 347 new 31 m sub-files (701 in all); no land cell at 0 m. Installed by `tools/install-region.py` (578 files new, 171 replaced, only the terrain's keys merged).
- **The nine airports** (Toulouse, Berlin, Malpensa, Vienna, Brussels, Dublin, Lisbon, Copenhagen, Manchester), baked as v0.7.0's were by three subagents of three each, so the first three reached Chrome while the others were baked, and each held behind `PENDING_ON` until it passed the whole check on mains. Six from their AIPs. **Three `[EST]`:** Malpensa (Italy's eAIP asks for a login), Brussels (Belgium's answered HTTP 403) and Lisbon (Portugal's answered HTTP 503, under maintenance); none was worked round. New in the bake: `AREA_EXTRA` (boxes of buildings, aprons and taxiways beyond an aerodrome's polygon: Toulouse's Airbus plant north of the field; the west site is inside it). New in the shared suite: `farHolds[...].stands` (`tests/v063-ne-airport.mjs`), a far hold's allowance for the stands named only (Toulouse's 25 on the factory's flight line, which reach 32R through an intersection 703 m from its end), and `alongRunway.byStand` for Berlin's nine on the north apron.
- **No one-way entries:** every AIP read speaks of a preference by wind, hour or apron (Vienna's preferential system, Dublin's parallels before 16/34, Copenhagen's 04/22 pairs, Manchester's segregated peaks, Berlin's runway by apron, Toulouse's night rule for landings, which the game can't model), never an end that is only landed on or only taken off from. So `ONE_WAY` gains nothing from the AIPs. **It gains one entry of the game's own, `EBBR: { 19: 'landing' }`:** Brussels's 01/19 crosses 07R/25L and, at its north end, 07L/25R's east end; `runwayCrossings()` bends a runway to one longer runway only, so at the second crossing the two surfaces stood 1.3 m apart (OurAirports' elevations) and a take-off from 19, which begins there, ended in an engine strike on the spot. 19's `[EST]` elevation is now 108.4 ft, which brings 01/19's straight profile through 07L/25R's height at the crossing (a lip of 0.2 to 0.3 m is left at its edges), and 19 is landed on only until the game shapes a second crossing (the heightfield's and the shaders' knots, shared with every airport).
- **The rules** (`src/world/rules-europe.js`): Austria 10,000 ft and Ireland 5,000 ft from their ENR 1.7; Denmark 3,000 ft, with Copenhagen's own 5,000 ft (`EUROPE_AIRPORT_TRANSITIONS.EKCH`); Manchester's own 5,000 ft (`EGCC`, the UK's 3,000 ft elsewhere); Toulouse 5,000 ft (read) and Malpensa 6,000 ft (`[EST]`); Belgium 4,500 ft and Portugal 4,000 ft stay `[EST]`. Each new country already maps to a town mix (`cities.js`'s `EU_CODE`).
- **The fields by country** (`src/world/ground.js`'s `euGroundGlsl()`, one line in `terrain.js`): East Asia's `GROUND_GLSL` is untouched (its SHA-256 pinned in `tests/v071-eu-fields.test.mjs`); on a page in Europe it is passed through `euGroundGlsl()`, which splices Europe's lines into `fieldMosaic()` at nine exact anchors, each of which must occur once. **Four kinds, a whole district one kind:** open fields (the default), hedged fields (Britain and Ireland, Normandy and Brittany to the Loire, Spain's and Portugal's green north-west), dry fields (south of about 43.3° N, and the Mediterranean's side of France and Italy to 44.3° N), and polders (a district whose ground is under 0.8 m outside the dry country). **No new texture or uniform:** a district's kind comes from its site's latitude and longitude, worked out in the shader from the map's own conic (`euConic()`: the distance to the cone's apex and the angle round it; within 0.05° at ten cities, tested), wobbled by a slow noise, and from the 250 m height at its site. Far off, each zone's own average colour (`euFieldAverage()`).
- **The centres:** nine more (Toulouse, Berlin, Milan, Vienna, Brussels, Dublin, Lisbon, Copenhagen, Manchester), eighteen in Europe, each a tight core held to its own vertex budget (`EU_CORE_VERTS` in `tools/bake_region_buildings.py`: 55,000 vertices; the nine came out at 12,686 to 38,630 vertices and 34,090 to 105,789 triangles, about 700,000 triangles and 0.83 MB together), since Paris, Madrid and Frankfurt were already over the million triangles. **The landmarks:** fifteen more, forty-three in Europe (Berlin's Fernsehturm and the Brandenburg Gate; Vienna's Stephansdom, Donauturm and Riesenrad; Milan's Duomo; Lisbon's 25 de Abril Bridge, Cristo Rei and the Vasco da Gama Bridge; the Øresund Bridge and Malmö's Turning Torso; Dublin's two Poolbeg chimneys; Brussels's Palais de Justice; the Lovell Telescope at Jodrell Bank; and the rocket at Toulouse's Cité de l'Espace): `EUROPE_LANDMARKS.push(...)` and `Object.assign` on the city boxes and the models, so nothing of v0.7.0's or East Asia's is edited; the three bridges are `kind: 'bridge'` as East Asia's two (based at the sea, the deck's ends at the ground read there, only the pylons cut out of a centre), which took one changed line in `buildModel()`; 11,565 triangles in all, none over 2,348; every figure from the landmark's Wikipedia article, read on the day, with the bearings `[EST]`.
- **v0.7.0's leftovers, closed:** East Asia's sixteen views at max diff 0 between the pushed v0.6.4 and v0.7.0; Munich's frame rates on mains (60.1 fps by day and by night); **the two short patches** (Gatwick's box east to 0.04° E and Munich's to 12.02° E, with GLO-30's N51 E000 and N48 E012: Gatwick's old patch had a strip up to 660 m wide near 0 m 14 km east of the field, where the grid's corner crossed the Greenwich meridian and the missing cell read as sea); **the slow frames' cause** (v0.7.0's 33 ms and 50 ms frames at 16× were the flight script's own cruise picture, taken at the cruise level less 500 ft with the frame probe running: the script now takes it with the probe off).
- **Size and cost:** `data/` 404 MB after batch B (Europe 205 MB), 411 MB (Europe 212 MB) with the nine airports; Toulouse, Berlin and Malpensa 60 fps at a stand and on the final by day and by night, worst frame 16.8 ms; the other six the same: 60.0 to 60.2 fps at a stand (700k to 855k triangles) and 60.0 fps on the final (414k to 755k), worst frame 16.8 ms (first read on battery, after the Mac came off its charger at 14:27; read again on mains at 17:52, the same to a tenth). 1,406 unit tests.

## Europe's airports 21 to 29 (v0.7.2)

Shane's decisions and the Cowork session's choices are in `briefs/V0-7-2.md` (2026-11-21); `STATUS.md`'s v0.7.2 entries (from 2026-11-21, 18:00 KST) say how each part was built and checked; `README.md`'s "Europe's airports" is the player's view.

- **Batch C by the rule:** every 128 km tile with land within 200 km of one of the twenty-nine airports' reference points (200 tiles on Natural Earth's 1:10 m land, 201 on OSM's; the union, 201), less the 170 installed: 31 tiles, the planning's 30 with `-6_9` (the north-west of Scotland and the Hebrides, which Natural Earth's 1:50 m land lacks). They are `EU_BATCH_C` in `tools/bake_region_tiles.py`; none lies outside the outline, and the 250 m data's rectangle is unchanged (batch C lies inside it). Baked in two locked commands of six and seven minutes, every step under the guard's caps (the coast the longest, 409 s, and the water the largest, 4.25 GB). Seams: 0 values differ over 673 neighbour pairs at 250 m and 110 at 1 km (two cells at `-7_-4`/`-7_-3` against `-6_-4`, on a corner a tile outside the region owns, mended in the new tiles' borders as batch B's were). Old cores: 170 of 170 identical by SHA-256; 142 old tiles byte-identical, 28 change only in their borders. 276 new 31 m sub-files (977 in all); no land cell at 0 m and no sea off it (35,179 cells below 0 m, the lowest −42.75 m under the Loire estuary's inland water). Installed by `tools/install-region.py` (369 files new, 141 replaced, 70.2 MB; only the terrain's keys merged).
- **The nine airports** (Düsseldorf, Cologne Bonn, Prague, Geneva, Nice, Edinburgh, Glasgow, Nantes, Santiago), baked by two subagents of five and four, the second starting when batch C's bake reported, each held behind `PENDING_ON` until it passed the whole check on mains. Eight from their AIPs (DFS, ANS CR, SIA, NATS, ENAIRE). **One `[EST]`:** Geneva (skyguide's AIP asks for a login); not worked round. Cologne's runways are 13/31 in its AIP and OSM, not 14/32. Nice, Edinburgh and Glasgow have coast patches. New in the bake: `STAND_DROP_NUMBERED` (Prague's only), and a `STAND_DROP` entry for Nantes's 17 old named duplicates of numbered stands; RJCC, EGLL, LOWW and EDDL bake byte-identical with the edits.
- **No one-way entries:** Düsseldorf's AIP limits its northern runway to 56 hours a week and prefers landings on it and take-offs from the southern; Cologne's and Prague's limits are by hour and weight (Prague's order of use 24, 06, 30, 12, with 12 and 30 limited by day and shut by night); Nantes prefers 03 up to 5 kt of tailwind; Santiago uses 17 for CAT II and III; Edinburgh limits visual approaches at night. None is an end only landed on or taken off from, so `ONE_WAY` gains nothing. **No runway crosses more than one longer runway** (the check v0.7.1's Brussels asked for): at Cologne 06/24 crosses both parallels, but only 13L/31R is longer than it; at Prague 06/24 crosses 12/30 55 m from 12's end. Glasgow's 23 has no taxiway to its full-length start: its AIP back-tracks the runway into a 92 m extension.
- **The rules** (`src/world/rules-europe.js`): Czechia 5,000 ft, read (ENR 1.7 2.2.1; its note says where); `EUROPE_AIRPORT_TRANSITIONS` gains Nice 5,000 ft, Nantes 5,000 ft, Edinburgh and Glasgow 6,000 ft, Santiago 6,000 ft (each from its AD 2.17 or 2.20) and Geneva 7,000 ft (`[EST]`); Düsseldorf, Cologne and Prague take their countries' 5,000 ft, which their AD 2.17 repeat.
- **The centres:** nine more (Düsseldorf, Cologne, Prague, Geneva, Nice, Edinburgh, Glasgow, Nantes, Santiago), twenty-seven in Europe, each at the 9 m keep height under `EU_CORE_VERTS`'s 55,000 vertices (7,364 to 23,004 vertices, 19,921 to 61,816 triangles; about 416,000 triangles and 0.49 MB together); the tallest buildings in Düsseldorf, Cologne and Prague (the Rheinturm, the cathedral, St Vitus) are cut out by their landmarks. Their looks in `centres.js`'s `COUNTRY`: Prague, Nice and Santiago the south's; Düsseldorf, Cologne, Geneva, Edinburgh and Nantes stone and plaster under grey slate; Glasgow brick. Zurich re-baked into scratch is byte-identical. **The landmarks:** ten, appended to `EUROPE_LANDMARKS` after v0.7.1's forty-three (fifty-three in Europe), their models in `landmark-models.js`'s v0.7.2 section, 8,396 triangles together: Cologne Cathedral (`koelnerdom`, 157 m), Düsseldorf's Rheinturm (`rheinturm`, 240 m), Prague's Žižkov tower (`zizkov`, 216 m) and the castle with St Vitus (`stvitus`, 103 m), Geneva's Jet d'Eau on its jetty (`jetdeau`, 140 m), the three Forth bridges (`forthbridge` the red cantilever, `forthroad` the suspension bridge, `queensferry` the cable-stayed crossing), Edinburgh Castle on its rock (`edinburghcastle`) and Santiago's cathedral (`santiago`). The three bridges are `kind: 'bridge'`, based at the sea with their ends on the installed ground (the road bridge's bearing and the Crossing's place fitted to it). Figures from each one's Wikipedia article, read on 2026-11-21.
- **v0.7.1's one debt, closed:** Heathrow 27R to Berlin 24L flown again end to end on mains (12 of 12; 11,904 frames at 16×, median 16.7 ms, worst 16.8 ms, none over 25 ms), after the six airports' frame rates were read again on mains at 17:52. **The lock** (`/tmp/flight-sim/v071/excl.py`, outside the repository) now lets a bake, a suite or an alone-check go before a waiting browser check.
- **Size and cost:** `data/` 458 MB after batch C (Europe 259 MB), 459 MB (Europe 260 MB) with the nine airports; the nine's frame rates 60.0 to 60.1 fps at a stand and on the final, by day and by night, worst frame 16.8 ms, on mains and alone (686k to 1,007k triangles at a stand, 446k to 852k on a final). 1,419 unit tests.

## Europe's airports 30 to 37 (v0.7.3)

Shane's decisions and the Cowork session's choices are in `briefs/V0-7-3.md` (2026-11-21); `STATUS.md`'s v0.7.3 entries (from 2026-11-21, 23:10 KST) say how each part was built and checked; `README.md`'s "Europe's airports" is the player's view. With it, all thirty-seven of Update 7's airports are in.

- **Batch D by the rule:** every 128 km tile with land within 200 km of one of the thirty-seven airports, less the 201 installed: 18 tiles, the planning's 17 and `1_6` (land within 200 km of Hamburg in Natural Earth's 1:10 m and OSM, not in the 1:50 m). Northern Portugal added none beyond the 17; `-8_-11` (Morocco's Atlantic side) lies wholly outside the region's outline, logged and not baked. They are `EU_BATCH_D` in `tools/bake_region_tiles.py`: Andalusia and Morocco's north, the Strait, northern Portugal, Venice's plain and Campania. Baked in 15 minutes, every step under the lock and the guard (the coast the longest, 360 s, and the water the largest, 3.53 GB); two tiles' heights had waited for GLO-90 cells fetched late, so they and all 18 covers were baked again before the compose. Seams: 0 values differ over 740 neighbour pairs at 250 m and 110 at 1 km (the first pass found 7 at new `6_-2`, where the cell's owner lies outside the region: four border cells rewritten, the old tile's value winning). Old cores: 201 of 201 identical by SHA-256; 189 old tiles byte-identical, 12 change only in their borders. 238 new 31 m sub-files (1,215 in all); no land cell at 0 m and no sea off it (24,117 cells below 0 m, the Po delta and Venice's shore, to −6 m). The 250 m data's rectangle reaches three rows further south. Installed by `tools/install-region.py` at 23:36 (292 files new, 66 replaced, 44.2 MB).
- **The eight airports** (Innsbruck, Gibraltar, Hamburg, Venice, Marseille, Lyon, Porto, Naples), baked by two subagents of four by what they needed: Lyon, Marseille, Hamburg and Innsbruck first, on tiles already installed; Gibraltar, Venice, Porto and Naples after batch D's install. Each held behind `PENDING_ON` until it passed the whole check on mains. Four from their AIPs (Austro Control, DFS, SIA twice). **Four `[EST]`:** Gibraltar (the UK's Military AIP site gave no connection), Venice and Naples (Italy's eAIP asks for a login), Porto (Portugal's answered 503 again); not worked round. Innsbruck's 30 m patch runs 44.5 by 23.8 km along the valley, about 20 km beyond each end; Naples's takes in Vesuvius; Gibraltar's the whole Rock, the bay and Algeciras. Gibraltar, Venice, Porto and Naples have coast patches; the Étang de Berre is inland water and Marseille has none. Innsbruck's eight stands are placed by the bake (`STAND_POINTS`, `[EST]`: OSM maps none on its main apron).
- **The runways' tables** (`src/world/runways.js`): **`CIRCLING_ONLY.LOWI = ['08']`**: Innsbruck's AD 2.22 gives a straight-in instrument final to 26 alone, and a 3° line to 08 from 15 nm meets the mountains 4.8 nm out (1,044 m under the ground at 8.3 nm), while 26's is clear for the whole 15 nm (lowest 119 m over the ground). The suite's new option `circlingFinals` passes only with it. **`ONE_WAY.EDDH = { 15: 'landing', 33: 'takeoff' }`** from Hamburg's AD 2.20 (take-offs from 15 and landings on 33 only for air traffic safety), and **`ONE_WAY.LIPZ`**, Venice's 04L/22R a standby (`[EST]`: it serves as the main runway's taxiway). Lyon's and Marseille's AIPs give preferences only: no entry. Hamburg's 05/23 crosses 15/33 only (`tests/v072-eu-crossings.test.mjs`, 2 of 2).
- **Porto's routes to 17** (`src/ground/taxi.js`): `holdForRoute()` took holds within 700 m of a runway's pavement end, and Porto's last taxiways join 760 and 835 m from 17's, past a 297 m displacement, so no stand had a route to 17. `HOLD_REACH_M = { LPPR: { 17: 900 } }` gives that end its own reach (the graph carries its airport's ICAO); no other airport has an entry. 44 of 44 stands route to 17 and to 35.
- **The rules** (`src/world/rules-europe.js`): Lyon's and Marseille's own 5,000 ft (each AD 2.20) in `EUROPE_AIRPORT_TRANSITIONS`; Hamburg takes Germany's 5,000 ft and Innsbruck Austria's 10,000 ft, as their AD 2.17 say; Venice and Naples Italy's 6,000 ft, Porto Portugal's 4,000 ft and Gibraltar 6,000 ft, each `[EST]`. Gibraltar's own rule (`GI`, `Europe/Gibraltar`) and Morocco's (`MA`, `Africa/Casablanca`) were there since v0.7.0; the country raster reads Spain at Gibraltar's airport (2 km cells), which changes nothing a player sees, and the setup's group and the clock go by the ICAO prefix. The eight in `EUROPE_AIRPORT_ORDER` and `AIRPORT_INDEX`, each after its country's earlier ones, Gibraltar last.
- **The centres:** six more (Hamburg, Venice, Marseille, Lyon, Porto, Naples), thirty-three in Europe, each at the 9 m keep height under `EU_CORE_VERTS`'s 55,000 vertices (16,044 to 38,181 vertices, 42,358 to 105,493 triangles; 515 KB together). Venice is the whole old city: all six sestieri with Giudecca and San Giorgio. Their looks in `centres.js`'s `COUNTRY`: Hamburg brick; Lyon stone under grey; Venice, Marseille, Porto and Naples plaster under terracotta. Zurich re-baked into scratch is byte-identical. **The landmarks:** eight, sixty-one in Europe, 4,668 triangles together (none over 944): Hamburg's Elbphilharmonie (`elbphil`, 108 m) and Heinrich-Hertz-Turm (`hht`, 279 m), St Mark's Campanile with the basilica's domes beside it (`campanile`, 99 m), Marseille's Notre-Dame de la Garde (`ndg`), Lyon's Fourvière basilica (`fourviere`) and the metal tower beside it (`fourvieretower`, 101 m), Porto's Dom Luís I Bridge (`domluis`, a `kind: 'bridge'`: the arch 172.5 m, the upper deck 395 m) and Innsbruck's Bergisel ski jump (`bergisel`). Each from its Wikipedia article's figures, read on 2026-11-22; bearings and inner sizes `[EST]`. The Dom Luís I Bridge is based at the sea's level as the Forth bridges are, its ends on the installed ground. Vesuvius and the Rock are the terrain itself.
- **The checks' tools:** the airports' check picks its landing end from the longest runway with an ILS, and failing that the longest end landed on straight in (Innsbruck has no ILS); the stills gain `europe-showpieces-073` (Innsbruck's valley from both finals, the Rock from both finals, Africa across the Strait, Vesuvius from Naples's finals, Venice from 3,000 and 1,500 ft) and `europe-centres-073`. Europe's earlier views against the tree with batch D in: 25 of 26 at max diff 0, Madrid's final max 1 at one pixel.
- **Size and cost:** `data/` 492 MB after batch D (Europe 293 MB), 495 MB (Europe 296 MB) with the eight airports; the frame rates 60.0 to 60.1 fps at a stand and on the final, by day and by night, worst frame 16.8 ms, on mains and alone, for those read so far (Lyon 646k triangles at a stand, Marseille 745k, Hamburg 908k; Innsbruck's final 564k) Innsbruck (from stand R4, 26 both ways), Gibraltar (stand 1, 27 both ways), Venice, Porto and Naples the same: 13 of 13 by day and by night, 3 of 3 taxi-in, 60.0 to 60.1 fps at a stand and on the final by day and by night, worst frame 16.8 ms (Innsbruck 862k triangles at a stand, Gibraltar 599k, Porto 865k). 1,430 unit tests.

## The cockpit, the whole map, weather by place, and the fixes (v0.7.4)

Shane's decisions and the Cowork session's choices are in `briefs/V0-7-4.md` (2026-11-21, revised 2026-11-22 at about 03:00 for an overnight run of about eight hours); `STATUS.md`'s v0.7.4 entries (from 2026-11-22, 03:25 KST) say how each part was built and checked, with the decisions made in the run; `Updates.md` is the player's view. Four Opus subagents at once at most, by Shane's word at 03:20 (the brief's two).

- **Item 8, the centreline score** (`src/score.js`): 10 within 1.5 m (`CENTRE_FULL_M`), then a straight line to 0 at `centrelineEdge(widthM, geo)`: half the runway's own width less the outer main wheel's outer edge (`gearOuterM(geo)`: the farther main leg, half the bogie's tread, half a tyre, from the geometry flown; `MAIN_WHEELS` in `src/geometry.js` for the A321). 18.02 m for the A321 on a 45 m runway, 16.05 m for the 777, 25.52 m and 23.55 m on 60 m. Shane's 5.7 m scores 7 of 10 (3 before). The part's weight, the shares and the would-be crash rule are unchanged; five old expectations in `tests/score.test.mjs` changed, each with its comment.
- **Item 7, the autothrust's full range** (`src/sim/autopilot-boeing.js`): the Boeings' A/T wake-up commands `A.RATING.TOGA` (it was capped at MCT and took the lever from where it was), never sets less thrust than the levers had at the wake (`X.boWakePhi`), and hands back to the SPD loop and its reference once the speed is within 2 kt of its target. The A321 needed no change: alpha floor gives TOGA LK, and A/THR SPEED with the levers in CL keeps the CL limit. "Full" reads as full: the A321's panel shows "TOGA 96.5 %" above the dials (`thrustLimit()`, `limitLine()` in `ui/engines-panel.js`), the Boeings' EICAS its reference ("TO 97.0", "TO 100.0", "G/A" while the A/T is awake; `thrustRefMode()`, `refN1()`), and the lever's ring sits on the limit at full. One old assertion changed with its comment (`tests/boeing-ap.test.mjs` reads the levers' highest point since the wake).
- **Item 9, decimal headings; LOC, APPR and TRK-FPA on the A321:**
  - **decimals** (`hdg1000()` in `autopilot.js`; `fcu.js`, `ui/boeing/mcp.js`, `knobs.js`'s `stepDecimal()`): a typed heading keeps 0.001° on both families; the window shows the whole degree; the knob steps from a decimal to the next whole degree; saves keep them; the bugs sit at the exact value;
  - **runway courses to 0.1° magnetic** (`runwayCourseMag()`, `courseText()` in `ui/common.js`) on the PFDs, the map, Change the route, the magenta line's tip and the setup. **A departure from the brief** ("take the AIP's bearings where the bake has them"): the course is the drawn runway's, from its coordinates with WMM2025, since of 143 ends only 98 are within 0.5° of the drawn runway (Madrid, Copenhagen and Orly over 1°, Shenyang 24 2.3°) and Shane's item is "perfectly aligning with runways"; it is taken 5 nm out on the final, where a held heading stays within 0.2 to 0.8 m of a 10 nm final (15 to 20 m off at its end if taken at the threshold);
  - **LOC and APPR on the A321** (`src/sim/approach-laws.js`: `beamInto`, `locCaptures`, `gsCaptures`, `locCourse`, `gsVs`, the Boeings' expressions term for term, which `autopilot-boeing.js` now calls): LOC after the HDG window, APPR after V/S; the glideslope captures only after the localizer and from on or below the path; LOC* to LOC within 60 m and 2.5°, G/S* to G/S within 6 m `[EST]`. Within 0.5 m of the localizer and 0.04 m of the glideslope below 1,500 ft on two finals in each region;
  - **the A321 autolands** in APPR with the AP on (the flare came good): LAND at 400 ft, FLARE at 40 ft (the Boeings' exponential flare), the A/THR to idle from 10 ft, RETARD at 10 ft (20 ft by hand), a decrab from 150 ft, ROLL OUT by the pedals until 30 kt. On the brief's four finals in still air (Gimpo 14R, Haneda 34R, Heathrow 27R, Frankfurt 25L): about 140 ft/min, under 0.02 m off the centreline, about 393 m past the threshold, the rollout under 0.1 m off; in a 10 and a 20 kt crosswind under 2.5° of crab, 2.5 m off, the rollout under 4 m. In LAND, FLARE and ROLL OUT the knobs and buttons do nothing, as the real FCU (`landing()`), and a changed beam disconnects; the pilot sets the gear and flaps and brakes. The 80 ft disconnect stays behind `AUTOLAND_ON = false`. The code review's three certain faults (the autoland state missing from `newCore()` and `restore()`, the knobs in LAND, the ILS lost after a load, a rewind or a jump) were mended, `tests/v074-loc-review.test.mjs`;
  - **TRK-FPA** (`setFpa()`, `toggleTrkFpa()`, `drawBird()` in `pfd.js`): the button between HDG and ALT; TRK within 0.2° in a 20 kt crosswind; FPA from −9.9° to +9.9°; the FMA's TRACK and FPA, the PFD's bird;
  - **a localizer to every end landed on straight in,** for both families (`main.js`; the lead's rule, since a localizer only where a file has `ils` data would have taken LOC and APP from the Boeings at 55 of 264 ends); none to a circling-only end, the one change for the Boeings: five ends (Gimhae 18L and 18R, Wonsan 33L and 33R, Innsbruck 08).
- **Item 6, the gear,** looks only, every size `[EST]`: the A321's main strut r 0.165 to 0.175 m with a gland collar, piston 0.14 m, axle 0.11 m with a housing, plate torque links, brake stacks and hub caps (`aircraft.js`: `plateBetween()`, `wheelCentre()`); the widebodies' main strut r 0.27 m, piston 0.2 m (0.13), side stay 0.13 m and drag brace 0.14 m (0.075, 0.08), the bogie beam a forged box 0.4 m deep by 0.3 m wide (a 0.11 m rod), axles 0.13 m with end bosses, plate links with a knee pin (`widebody.js`); the nose gears to match; and, after the pictures-only review's 5 of 10, both faces of every wheel rimmed in light metal at the real size (the A321's R20 mains and R15 nose, the 787-9's R23 and R16, the 777-300ER's R22 and R17), with a raised flange, a dished face, the brake stack inside on the mains, a boss and hub cap, and a black sidewall ring (`wheelFaces()`, `addWheelFaces()`, `WHEEL_COLOURS`). `geo.GEAR`'s contact points, every gear bone's pose and each wheel's extremes are unchanged against the pushed v0.7.3 (`tests/v074-gear-model.test.mjs`, `tests/v074-gear-base.json`). Triangles, each whole model without the cockpit: A321 29,190 → 31,178 (+1,988), 787-9 36,342 → 39,426 (+3,084), 777-300ER 39,584 → 43,756 (+4,172). The parked traffic's models are separate and unchanged.
- **Item 12, the warnings' button and the volumes** (`src/audio/silence.js`, `synth.js`, `callouts.js`): SILENCE in the PFD panel's bottom-right corner on all three types, amber while something is silenced, and the ' key (`keys.js`, 37 bindings); a press silences what is audibly sounding, and a silenced warning sounds again when its condition ends and comes back. The engines (`engineBus`) and the airframe and ground (`frameBus`) are split under `worldBus`; Settings' Warnings, Callouts volume, Engines, and Airframe and ground, each 0 to 100 % of the master, saved as `volWarnings`, `volCallouts`, `volEngines`, `volFrame`. The ground-proximity and windshear calls follow Callouts (they are the voice); rain, thunder and buffet follow Airframe and ground. At 100 % the mix is v0.7.3's: 40 of 40 segments matched, the noise seeded alike. What is silenced is cleared on a new flight, a load, a jump or a rewind (`callouts.reset()`, `synth.resetSilence()`).
- **The map's five** (`src/ui/map.js`, `map-outline.js`, `map-countries.js`, `map-relief.js`):
  - **the four lines** in an order of weight: the coast solid green 1 px (unchanged); the country borders warm grey dash-dot, 0.74, 1.3 px; the region's edge white dashes at 0.6 over a casing (0.18); the inner border white dots at 0.68, 2.3 px every 6 px, on a dark casing (0.09). A first pass at 0.32 and 0.27 was still faint over the relief, by the pictures-only review;
  - **item 3:** a run of three or more sides alternating between two directions, each 1 or 2 tiles long, becomes one line through the sides' midpoints; an even run drops its last side, so the enclosed area is exactly kept. The second pass adds a single one-tile jog between two longer sides running the same way, cut as a 1:1 line from half a tile before to half a tile after. Corners in cut runs: East Asia 14 of 32, Europe 26 of 64 (8 and 18 by the first rule); 4 and 5 irregular stepped stretches left square, where a cut would change the area. Drawing only: what loads and where a predicted path ends are unchanged;
  - **item 10:** no land boundary lines file in `reference/raw/ne/`, so the borders are the pairwise shared boundaries of `ne_10m_admin_0_countries`; the names upper case and letter-spaced, fading in from 650 m a pixel (rank-6 countries between 260 and 720); China's and Russia's placed at the pole of inaccessibility of their largest piece inside East Asia's frame. A name is tried at its label point, a ring of offsets, then up to 80 candidate points in its country (at least 15 km inside its land, about every 40 km), then a size smaller, large countries first; a small country's at most 0.6 alpha and 11 px. At whole-region zoom Europe names thirteen and East Asia five; the Netherlands, Belgium, Switzerland, Gibraltar and Russia stay unnamed there. The runway ends' labels stand beyond each end along its axis, and "15 NM FINAL" takes the first of 18 places clear of every airport's label;
  - **item 1:** every `kind: 'terminal'` building drawn at all sixty airports; the passenger terminals' labels from a small JSON by ICAO (`terminal-labels.json`, a decision of the run: the sixty airport files are not baked again), 11 airports in East Asia and 22 in Europe; no label at a one-terminal airport or where the file leaves the terminals unclear;
  - **item 11:** a baked overview of 2 km cells, one byte each, not the 1 km `r1` tiles (they would be 41 and 30 files, about 22 and 16 MB, for one picture); bands at 0, 500, 1,500, 3,000, 5,000, 8,000 and 12,000 ft, a hillshade from the north-west, the polders' own tone, the legend at the bottom left. East Asia's file has a second plane of weights that fades the tint and the shade over 2.5° inside its 1 km data's box (a ruler-straight seam over China before); Europe's 1 km level covers its whole rectangle, and its 525,625 cells outside the region's outline are left empty;
  - **the data:** `map-relief.u8.gz` 639,854 and 579,530 bytes (with their `.json` headers), `country-lines.json` 26,412 and 112,000, `terminal-labels.json` 1,308 and 2,881: about 1.36 MB, from `tools/bake_country_lines.py`, `bake_terminal_labels.py` and `bake_map_relief.py`.
- **Weather by place** (v0.6.5's, `src/sim/weather.js`, `weather-presets.js`, `sim.js`, `main.js`, `ui/setup.js`, `ui/weather-window.js`): the destination's weather at the top level of the settings, as every old consumer and save has it, plus `dep` and `ends`; two ends equal apart from their places collapse to one weather, byte for byte v0.7.3's, so that case takes v0.7.3's code path. The weight is the point projected onto the route: exactly 0 over the first third, exactly 1 over the last, a smoothstep between, the nearer end beyond either. The wind blends as vectors, the gusts by their excess, turbulence by level, visibility by its logarithm, cloud layers by base order, precipitation by weighted rate, and lightning, temperature and QNH; in an end's third `windAtTwo()` is that end's `windAt()` exactly. Each end's microbursts stay where its weather reaches. The sim reads the air at the aircraft (`wxL()`); the look and the sound step with the weight (`LOOK_STEP` 1/24). The same air at a point in the live sim, the prediction and a jump's restore to 1e-9; a flight with the same weather at both ends identical to v0.7.3's. After the code review: a two-ended weather's clouds take one seed and one drift from the destination for the whole route (`weatherAt()`'s look-only `cloud`), so the blend changes the cover, bases, tops, rain and haze, never the pattern, and a flash in progress is kept; ends within `SAME_PLACE_M = 1000` are one weather, the destination's (a circuit). The Weather tab's switch has three positions: Both ends, the departure, the destination.
- **The eight fixes:**
  1. **Brussels's second crossing** (`runways.js`, `airports.js`, `glsl.js`): `runwayCrossings()` takes every longer runway. The terrain shader's text stays v0.7.3's: a runway with more than two bends is given to it as several rects end to end (`runwayRects()`; 01/19 three), and only such a runway takes a variant of the runway's own shaders with eight bends (`knotChainGlsl()`) and a second cut, since the same arithmetic rewritten had moved single pixels in East Asia's views. A runway that crosses two or more longer runways (Brussels's 01/19 alone) gets four bends a crossing, at the longer runway's height along each of its edges; one that crosses one keeps its two. 19's pavement end 110.2 ft `[EST]` (its threshold's published 113 ft read on the bent profile as 112.8 ft); `ONE_WAY.EBBR` gone. Every other runway in both regions identical (East Asia 50 of 50, Europe 81 of 82).
  2. **Berlin's de-icing pads:** `STAND_EXCLUDE` by OSM refs and `STAND_DROP_NUMBERED`, seventeen positions out, `PAVE_DROPPED` keeping their pavement; 173 stands to 156, nothing else in the file changed.
  3. **Transition altitudes by country** (`region.js`, `rules-europe.js`): an airport's 60 km disc holds where `countryAt()` is its own country or one listed under `also` (Nice: Monaco); `EUROPE_COUNTRY_OVERRIDES` gives Gibraltar its own ground.
  4. **The aurora by latitude** (`sky.js`, `regions.js`): full at 56° N and north, none at 50° N and south, a smoothstep between; East Asia's line unchanged.
  5. **The outline's grid** (`outline.js`): 16 km cells; the polygon asked in 868 of 28,215; a million random points the same.
  6. **The GLSL sea fallback** (`glsl.js`'s `SEA_FALLBACK`): the CPU's low-land branch in Europe.
  7. **Retired files:** `bake_common.refuse_retired()` in thirteen tools, whole or by mode or region; twelve of the guards fired once, with `data/` the same before and after.
  8. **A hang watch for every browser script:** `tests/pw.mjs`, every close on an 8 s timeout, in 75 scripts.
- **Part 9:**
  1. **The 250 m data's edge** (`src/world/tilestore.js`: `EDGE_BLEND_M = 4000`, `seamRects()`, `blendEdge()`): when a covered tile loads beside ground read from the 1 km level, its height cells within 4 km are blended in place towards the 1 km height by a smoothstep, so the sim, the prediction's worker and the GPU's window read the same cells and no shader text changes (the brief said the terrain shader; the two levels step by up to 229 m inside one cell there, a real wall). The worst step at a seam from over 100 m (Cantabria 229 m, the Taihang 128 m) to under 30 m; steps over 10 m: Europe 552 to 74, East Asia 119 to 6. Each cell keeps its land or sea (13,258 of Europe's sea cells had turned to land at first). Every height beyond 4 km of a seam and every airport point identical on and off; `?edgeblend=0` (`FS_EDGEBLEND=0`) is v0.7.3's path.
  2. **Bare ground in towns: closed on evidence, not built.** Lyon's near-white strips have the sky's horizon colour and no texture, aren't there when the still is taken again with `--total 2400`, and the fine cover's bare share is 0 in that view; most likely ground not yet filled when the still was taken. No ground shader change.
  3. **Prague's field to the bent profile** (`tools/bake_region_patches.py`: `FIELD_BENT = {'LKPR'}`, `runway_knots()`, which asks node for the game's own `runwayCrossings()`): 9,736 cells lowered by up to 7.0 m round the crossing; the worst stand 0.46 m off the drawn surface (2.91 m before); all 103 stands held to the suite's usual 0.6 m.
  4. **Venice's floor by the water mask** (`LAND_FLOOR` raises land only; the box kept for land, eased over `LAND_FLOOR_FEATHER_M = 300`): the step in the lagoon was 2 to 3.4 m and is 0.00 m; the old city 1.00 m above it.
  5. **The stills' camera points** (`tests/browser-v060-stills.mjs`): the Brandenburg Gate's, the Riesenrad's and the rocket's views re-aimed, Santiago's on the cathedral, and `look()` waits for its target's tiles.
  6. **v0.7.7's list, in part** (from 06:45, with time in hand; the buildings and landmarks group, and two of "the rest"), each on by default behind a switch that keeps v0.7.3's shader text or model character for character and vertex for vertex, from a snapshot of the tree at 06:44 (`/prelook/`):
     - **the terminals at night** (`src/world/apron.js`: `termNightVariant()`, `termLit()`; `?termnight=0`): the night text made from `BLDG_FRAG`, untouched, by one added function; storeys of 3.8 m with a dark slab band at each foot, mullions every 1.5 m, each storey cut into 24 m stretches (offset 9.7 m a storey) of four levels by a hash (dark 12 %, dim 28 %, lit 50 %, bright 10 %), a service floor a whole storey over 96 m (15 %), fading to the mean as a storey shrinks from about 12 to about 4 pixels; reaching the colour only through `uNight`. A first version with two-dimensional noises read as blotches and a sheen to the pictures-only reader and was replaced (08:26). Moving the camera 3 m, the mean change over the terminal fell from 15.3 to 11.9 levels at Incheon and from 27.9 to 18.5 at Heathrow;
     - **grass through the aprons** (`apronSkirt(ring, 1.5)`; `?aprongrass=0`): neighbouring OSM apron polygons don't share their edges exactly, leaving wedges of grass up to about 2 m wide and 47 to 219 m long; a 1.5 m concrete skirt outside every apron ring, on the apron's layer, takes thin holes from 224 to 50 m² at Gatwick, 221 to 75 at Madrid, 255 to 79 at Heathrow, 972 to 618 at Frankfurt, 603 to 438 at Incheon and 119 to 102 at Haneda; every apron's outer edge stands 1.5 m further out;
     - under `?landmarks77=0`: **Tower Bridge** as a bridge (`towerbridge77()`; `kind: 'bridge'` at the Thames's level; the towers 65 m to their pinnacles and 77 m apart, the 61 m span with the closed bascules, the walkways at 42 to 46.5 m, the chained side spans, 244 m end to end, bearing 0° `[EST]`; 752 to 2,668 triangles, its `parts` the old 122 m circle); **the village church** (`euRuralVert77()`, `EU_SPIRE77`, `euRuralFrag77()`: a slate spire in the north and centre, a low terracotta cap in Spain, Portugal and Italy, a belfry opening, no window bands; nothing added to the vertex layout; East Asia's text the same); **Torre Cepsa** (`cepsa77()`: its two plain side cores, all one sees from east and west, given the neighbours' glazed lit facade, their glow removed and the top frame cut so its wall reads dark at night; 52 to 76 triangles);
     - **the seven low landmarks from above** in the stills (`eu-landmark-<name>-p9above-day`).

     **The gate:** a reader who saw only the before and after pictures marked the terminals better in 11 of 15 views, the aprons 5 of 7, Tower Bridge 6 of 6, the churches 3 of 3, Cepsa 2 of 2, none worse; with the three switches off, East Asia's nineteen views at max diff 0 against the pushed v0.7.3 and the snapshot, Europe's twenty-seven at max diff 0 against the snapshot. With them on, seven of East Asia's sixteen at max diff 0 and nine changed by the skirts and the terminals' night light alone (0.0002 to 0.11 % of pixels). **Left for v0.7.7:** the towns (the centres baked again with inner rings and a finer water field), the countryside's zones by country (the country raster in the ground shader), the Alps' snow, Barcelona's harbour, the triangles over a million, and the ground's data (Europe's tiles baked again).
- **The reviews:** a fresh reader of the diff (nine findings; the A321's autoland state, its knobs in LAND and its ILS after a load mended, the clouds across the blend, a circuit's weather, the silencer's reset and TRK-FPA's reset mended) and a reader of the pictures only (the gear 5 of 10, the map 4 of 10; the gear's rims, the map's lines, names, seam and labels mended in second passes). `STATUS.md`'s checkpoint 6 has both tables.
- **Size and cost:** `data/` 497 MB, Europe 296 MB of it; at 60.0 to 60.1 fps, worst frame 16.8 ms, alone on mains at Incheon's and Heathrow's stands with the new gear in view (865k and 912k triangles), on Heathrow 27R's final and on Frankfurt 07R's final in the destination's thunderstorm (694k to 707k); Incheon 33R's final 59.7 fps with one or two long frames in its first seconds, as the pushed v0.7.3 has. The path map 1.9 to 11.7 ms a draw (the relief's mountain views the dearest), the first open 1.9 and 2.0 ms. Those were read before the look pass; with it in: 60.0 to 60.1 fps at a stand at Incheon and Heathrow by day and by night (888k and 939k triangles: the skirts add about 25k), 60.0 fps on Heathrow's final and in Frankfurt's storm, worst frame 16.8 ms in each; Incheon's final 59.9 fps with its one long frame (33.5 ms), as on the pushed v0.7.3. 1,584 unit tests.

## East Asia's six new airports, and every runway end (v0.7.5)

Shane's decisions and the Cowork session's choices are in `briefs/V0-7-5.md` (2026-11-21, revised 2026-11-22 at about 03:00 with his answers); `STATUS.md`'s v0.7.5 entries (from 2026-11-22, 11:45 KST) say how each part was built and checked, with the decisions made in the run; `Updates.md` is the player's view and `README.md`'s "Central Korea and central Japan" the airports' figures. Four Opus subagents at once, by Shane's word at 03:20: three for the airports, two each, and one for the centres and landmarks.

- **The terrain check, from the installed files:** for each of the six, every 250 m tile within 200 km and every 31 m sub-tile within 100 km already installed (15 or 16 tiles and 44 to 46 sub-tiles each, none missing), none inside an existing 30 m patch: no new terrain, as the Cowork session's two checks had found.
- **The six airports** (Cheongju RKTU, Kunsan RKJK, Centrair RJGG, Itami RJOO, Komatsu RJNK, Hiroshima RJOA), each built as v0.6.3's and v0.6.4's: its OSM box, OurAirports' cross-check, its AIP (Korea's eAIP of 2026-11-12 for the two Korean, AIP Japan through v0.6.1's mirror for the four), its 30 m patch, a 10 m coast where its 16 km square touches the sea (Centrair, Itami, Komatsu, Kunsan), pending until `tools/check-airport.sh east-asia <ICAO> <end1> <end2>` passed whole on mains, then promoted. The ends at the AIP's threshold coordinates at all six (`THR_AT`, `THR_LEN`: OSM's ways ran over Hiroshima's overruns, 4 to 6 m short at Cheongju, 214 m past Itami's 14L threshold). The stands from the AIP's INS points where it lists them all (`STAND_POINTS_ONLY`: Centrair 80, Itami 51, Komatsu 7, Hiroshima 9), since OSM's lead-ins made 76 false stands at Centrair and its stands lay 15 to 30 m off at Itami; Cheongju's from OSM (stands 71 to 78 left out as a light aircraft's); Kunsan's two placed nose-in to its civil terminal `[EST]` (OSM maps none). The widebody stands by the AIP where it names them (Cheongju 7 and 13, Centrair's A380 stands 15, 20, 117 to 119) and by pavement strength elsewhere `[EST]` (`AIP_STANDS`); Kunsan none (its AD 2.20's 118 ft wingspan limit). Holds made 90 m from the centreline where OSM maps none (all but Hiroshima's six). Each through its whole check: day 13 of 13, night 13 of 13, taxi-in from two ends, grades A 90 to A 92. Cheongju's 06R/24L, the air force's runway, a standby (`ONE_WAY.RKTU`, from RKTU AD 2.20 1.3); `AREA_EXTRA` brings in Cheongju's terminal, which OSM's aerodrome leaves out; Kunsan in `STAND_POINTS_ONLY` too (the code review's finding 6). Cheongju and Kunsan take `frame.js`'s plane for the variation, as Gimhae (the bake's `PLANE`; the shared suite's `koreaPlane`): baked first with the WMM grid's, found at the promotion by `tests/v060-rules-frame.test.mjs` (Cheongju −8.79° against −8.73°) and re-baked.
- **Itami's 14R and 14L circling-only** (`CIRCLING_ONLY.RJOO`): the shared suite's straight-in finals test put the 3° line 33 m over the ground 4.7 nm out of 14R and 47 m at 4.3 nm of 14L, against 60 m, and AIP Japan's RJOO AD 2.21 and 2.22 give them circling minima ("JET circling to West only"). 32L (the one ILS) and 32R are straight in over the city, 119 m and 117 m clear at 1 nm.
- **The military sides empty** (Shane's "Empty"), each by how OSM maps its base: Cheongju's two `landuse=military` areas in `MILITARY` (no stand inside; OSM's 25 stands were all on the civil apron); Kunsan, military all over in OSM, kept out of `MILITARY` and given only its two civil stands; Komatsu, with no military area, apron or stand mapped south of the runway, given only the AIP's civil spots 2 to 8. Their shelters are OSM's buildings drawn as low vaults 9 m high `[EST]` (`SHELTERS`: Cheongju's `building=bunker` inside the aerodrome, Kunsan's ten 35 × 36 m buildings, Komatsu's twenty 25 × 23 m hangars). The military taxiways stay in the graph.
- **Every runway end can be picked** (Shane, 2026-11-22 03:25, from Barcelona's 20): `ONE_WAY` stays as the AIP's use, a default and a note, never a filter. `aipTakesOff()` and `aipLands()` (v0.7.0's `canTakeOff()` and `canLand()`, renamed since nothing filters by them), `useRank(icao, ident, 'dep' | 'arr')` (0 the AIP's own, 1 a standby's, 2 the others), `runwayUseNote()`; `runwayEndList()` in `src/ui/setup.js` for New scenario; the map's Change the route lists every end in that order, dims those the AIP doesn't land on and writes the note by the threshold, drawing their 15 nm final as any other's; the final start, Skip to final, `changeRoute()` and `syncNav()`'s beam take every end but a circling-only one; `createAirports()` no longer clears an end's ILS (none of the ten has one in its file). Twenty ends come back, all in Europe: ten landing ends and ten take-off ends at Frankfurt, Madrid, Barcelona, Schiphol and Hamburg. In an arrival list a circling-only end comes after the straight-in ones (decision 10), so the default arrival has a final: Itami 32L, and at older airports Gimhae 36R (18L before) and Innsbruck 26 (08). The taxi-in from the ten landing ends: seven find a route, Schiphol's 36L and 18L and Madrid's 36R none (no exit ahead in OSM). The other seven pairs: Frankfurt 07L to 18, 25R to 36 and 36 to 18, Madrid 18R to 36R (a 6.4 km taxi) and Schiphol 36R to 18L, 13 of 13 each by a stand's route; Schiphol's 18R and Madrid's 18L, which no stand has a taxi route to in OSM's data (both known since v0.7.0's tests), taken off from by a start on the runway, as flights to Hamburg and to Barcelona (12 of 12 each, landed A 91 and A 90); and Schiphol's and Madrid's 36L landed on from a 15 nm final (A 92 and A 90). All ten take-offs and all ten landings are checked.
- **The parked aircraft** (`src/world/traffic-layout.js`, at run time; the stands stay in the files): `PLAYER_CLEAR = 4.5` m, ICAO's code C wingtip clearance (3 m before); no tail within `TAIL_TAXIWAY_M = 15` m `[EST]` (a baked taxiway's 11.5 m half width and 3.5 m) of a named taxiway through line crossing the stand's axis at over 45° behind it (`tailOverLine()`), the short aircraft tried before the stand is left empty, an emptied stand still counted in the airport's share so no other stand changes. On v0.7.4's sixty airports, 6,804 parked to 6,536 (312 taken away, 58 shortened, 44 stands an overlap had emptied filled); Naples's 45 empty. Four wider rules were measured and dropped (980, 414, 650 and 708 taken away, none catching Naples's 45). The service-road half (`TAIL_ROADS`) is written and off: 486 and 140 with it. `?tailfit=0` (node `FS_TAILFIT=0`) is v0.7.4's layout.
- **The centres and landmarks:** Nagoya (136.875 to 136.915° E, 35.160 to 35.192° N; 2,659 buildings, 48,739 triangles, 64.5 KB, the tallest 247 m by `HEIGHT_FIX`) and Hiroshima (132.445 to 132.482° E, 34.385 to 34.408° N; 2,635 buildings, 43,393 triangles, 58.9 KB) from OSM in `tools/bake_region_buildings.py`; Osaka's box widened from 34.710 to 34.765° N and 135.465 to 135.540° E, since the old north edge met Itami's 32L final only 5.2 nm out (36,360 buildings, 588,912 triangles, 776 KB; 26,121, 398,463 and 525 KB before). Scenes under about a million triangles: 533k and 540k from 3,000 ft over Nagoya and Hiroshima, 816k on Itami's final, 842k at Osaka Castle. Five landmarks, our own models from public figures `[EST]`: Nagoya Castle's main and small keeps on their stone bases (55.6 m, 496 triangles; `castleKeep()`), Nagoya's TV tower (180 m, 2,240), Miyajima's torii in the sea (16.6 m, 516; `atSea`, at height 0), the Atomic Bomb Dome as it stands (25 m, 1,632), Osaka Castle's main tower (55 m, 416). The 91 older models build identical position arrays.
- **Size and cost:** `data/` 502 MB (5.7 MB of new files; the brief said about 8), Europe 296 MB of it; alone on mains at a stand 60.0 to 60.1 fps at all six, worst frame 16.8 ms (591k to 1,020k triangles, Hiroshima's the most); 1,676 unit tests. The code review (a fresh reader of the diff): no correctness fault in parts 5 or 7, eight findings mended or logged. On each final, alone, 60.0 fps by day and by night, worst frame 16.8 ms (Cheongju 689k triangles, Kunsan 375k, Centrair 411k, Itami 772k, Komatsu 629k, Hiroshima 802k).

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
  - distance from the centreline (v0.7.4: full marks within 1.5 m, then a straight line to 0 where the outer main wheel reaches the runway's edge);
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
- **The home page** (v0.5.7): the floating items and the skyline tape are CSS animations of transforms; the plane is drawn at most 30 times a second; all of it stops while the menu is hidden (a flight, a page over it) or the window is hidden, and with reduced motion it's a still picture.

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
