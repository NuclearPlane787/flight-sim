# Updates

What each update added and changed, newest first. Dates are in KST. Each commit to the repository is titled with its version number alone, and this file says what's in it. The game shows its version in the pause menu and on the loading screen.

<!-- Agents: add new versions here, newest first, in the same style. -->

## v0.1.0 · 2026-10-31 (overnight) · The first build: an A321neo over South Korea

- **The A321neo, with realistic physics** from Airbus's and EASA's published numbers: weights, flap and gear speeds, stall speeds, and the LEAP-1A's thrust and spool-up.
  - Flaps and slats, with 1+F on the ground.
  - Gear, wheel brakes, reverse thrust, and ground spoilers that come up on touchdown.
  - Fuel burns off and lightens the aircraft.
- **Fly-by-wire:**
  - In Normal law, the aircraft holds its attitude and trims itself when you let go, and the flare law has you flare by hand.
  - A switch on the FCU gives Alternate law, which has no stall protection, so you can stall it.
- **Four views:**
  - 1st person from the nose;
  - 3rd person around the aircraft;
  - the Captain's and the First Officer's seats in a simple cockpit.

  A two-finger swipe looks around, a pinch zooms, and a double-click recentres.
- **Screens in every view:**
  - the PFD, with ILS-style deviation scales for the destination runway;
  - the ND, a moving map with the line to your destination;
  - an engine panel: N1, fuel flow, fuel, flaps, gear, spoilers and brakes;
  - the FCU along the top.
- **Autopilot and autothrust:** heading, altitude (click ALT for a level change), vertical speed and speed.
  - Time compression goes up to 16× while the autopilot flies, at least 2,000 ft above the ground. It drops back to 1× by itself on a disconnect, a warning, or near the ground.
- **The map (M):**
  - the line to your destination from wherever you are (it never says you're going the wrong way), and waypoints you can drag onto it;
  - with the autopilot on, the path the aircraft will fly, in a bright colour, ending with a red cross where it would meet the terrain;
  - click a point on the path to jump there;
  - "Skip to 15 nm final".
- **South Korea:**
  - the real coastline and elevation for the whole country, with the neighbours' coasts around it;
  - the Han River and the big lakes;
  - forests, fields and rice paddies, and cities of apartment slabs, placed from real land cover with procedural detail that fades as you climb.
- **Gimpo, Incheon and Jeju:**
  - runways with markings, lights and PAPIs;
  - taxiways, aprons, numbered stands, jet bridges and terminals;
  - parked aircraft in made-up liveries, and ground vehicles driving around.
- **Three ways to start:** lined up on the runway, on a 15 nm final, or at a gate.
  - At a gate, P pushes back, and a taxi route drawn on the ground leads to the runway.
  - After landing, a new route leads to a free stand.
- **Sound:**
  - engines, wind, gear, flaps, spoilers, reversers and brakes;
  - the warnings;
  - the radio-altitude callouts from twenty-five hundred down to ten, with RETARD.
- **Landing score and logbook:**
  - Every landing gets a grade, from vertical speed, g, the touchdown point against the aiming point, distance from the centreline, bank, pitch and bounces.
  - The logbook (pause menu) keeps your flights.
- **Rewind 30 s,** after a crash or from the pause menu (T).
- **Nuclear Airlines:** white and navy, uranium green and Cherenkov blue, hazard stripes, a glowing atom on the tail, registration HL8787.
- **Light on the machine:** a 60 fps cap, and nothing runs while paused or in a hidden tab.
- **Known issues:**
  - Gimpo stand 7 has no taxi route to 14L/32R.
  - Pushback is slow (about 100 s).
  - A late keyboard flare still lands firm.
  - If the first touchdown isn't on a runway, the score is measured against the runway picked in setup, and the distance from its centreline has no cap, so the landing can score 0/100.
