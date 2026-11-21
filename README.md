# Flight Sim

Airliners (the A321neo, the Boeing 787-9 and the 777-300ER) in two regions, over real coastline, elevation and land cover with procedural fine detail:

- **East Asia:** twenty-three airports in Korea, Japan, China, North Korea and Russia (Incheon, Gimpo, Jeju and Gimhae; Tokyo Haneda and Narita, Osaka Kansai, Fukuoka, Niigata, Sendai, Aomori and Sapporo New Chitose; Beijing Capital and Daxing, Shanghai Pudong and Hongqiao, Yancheng, Qingdao, Dalian and Shenyang; Pyongyang and Wonsan; Vladivostok);
- **Europe** (v0.7.0): eleven airports in the United Kingdom, France, Germany, Spain, Switzerland, the Netherlands and Italy (London Heathrow and Gatwick, Paris Charles de Gaulle and Orly, Frankfurt, Madrid, Zurich, Amsterdam Schiphol, Munich, Barcelona, Rome Fiumicino).

Flights stay inside a region. It has:

- realistic physics with each maker's fly-by-wire: Airbus's protections on the A321neo, Boeing's speed-stable law and manual trim on the 787 and 777 (or, with Boeing auto-trim on in Settings, a path that holds itself as the A321's does);
- a holds-only autopilot with up to 16× time compression;
- a path map that lets you jump ahead along the predicted path, change the route in flight, and skip to a 15 nm final; hover over the magenta route for the heading that follows it (v0.6.2); the cities show on it as pale areas with their names in English, more of them as you zoom in (v0.6.3);
- gate starts with pushback and a taxi route drawn on the ground, and taxiway and runway signs (v0.4.1; runway exit and distance remaining signs, v0.4.2);
- parked aircraft and ground vehicles at the airports;
- synthesised engine sound built from each engine's real tones (LEAP-1A, GEnx-1B, GE90-115B: the fan's blade-passing tone, the buzz-saw, the core's whine, the jet's roar), muffled but clearly there in the cockpit, warning sounds, the radio-altitude callouts (RETARD included), a landing score and a logbook.

`Updates.md` lists what each version added; the game shows its version in the Esc menu.

## The regions (v0.7.0)

- **Choosing one:** New scenario asks for the region first (East Asia or Europe), then the airports. The game loads one region at a time: picking the other one reloads the page into it and opens its setup. The last region used is remembered; East Asia is the default. Load scenario lists the saves grouped by region, and loading one from the other region reloads into it and starts it there. Saves made before v0.7.0 are East Asia's. The home page's ticket and the logbook name either region's airports. The warehouse's Fly it uses the last region.
- **Each region is its own world,** in its own map frame: East Asia in Korea's (a Lambert conformal conic at 36° N 127.5° E), Europe in one at 47° N 4° E with its standard parallels at 39° and 54° N.
- **Europe's shape:** its edge is a polygon, not a rectangle: 35° to 59° N and 11° W to 19.5° E, cut diagonally in the south-east so that Algeria and Tunisia are out and Sicily is in, and in the south-west so that Morocco's coast along the Strait is in. The north takes in all of mainland Scotland, Denmark and Gothenburg; the east gives Vienna room and puts Budapest at the edge. The path map draws the edge, and the predicted path ends at it.
- **Europe's ground:** 250 m terrain over the 93 tiles of 128 km with land within 200 km of one of the airports (`data/europe/terrain/`), 30 m land cover within 100 km of each, 30 m terrain at every airport, and 1 km land over the rest of the region, so no edge shows from cruise. The Netherlands' polders lie below sea level as they do (Schiphol's field at about −3 to −4 m), with the IJsselmeer and Markermeer as inland water.

### Europe's airports

| ICAO | Airport | Runways (published lengths) | Stands | Its values from |
|---|---|---|---|---|
| EGLL | London Heathrow | 09L/27R 3,901 m, 09R/27L 3,658 m | 288 | its AIP (the UK's NATS eAIP) |
| LFPG | Paris Charles de Gaulle | 08L/26R 4,142 m, 09R/27L 4,200 m, 08R/26L and 09L/27R 2,700 m | 446 | its AIP (France's SIA eAIP) |
| EDDF | Frankfurt | 07C/25C and 07R/25L 4,000 m, 07L/25R 2,800 m (landings only), 18 4,000 m (take-offs only, southward) | 366 | its AIP (Germany's DFS AIP) |
| LEMD | Madrid Barajas | 18R/36L 4,179 m, 14R/32L 3,988 m, 18L/36R and 14L/32R 3,500 m (landings on the 32s and 18s, take-offs from the 14s and 36s) | 381 | its AIP (Spain's ENAIRE AIP) |
| LSZH | Zurich | 16/34 3,700 m, 14/32 3,300 m, 10/28 2,500 m | 218 | **estimates** (OpenStreetMap, OurAirports) |
| EGKK | London Gatwick | 08R/26L 3,317 m; 08L/26R 2,561 m, a standby | 189 | its AIP (NATS) |
| LFPO | Paris Orly | 06/24 3,650 m, 07/25 3,320 m; 02/20 2,400 m, a standby | 155 | its AIP (SIA) |
| EHAM | Amsterdam Schiphol | 18R/36L 3,800 m, 09/27 3,453 m, 06/24 3,442 m, 18L/36R 3,400 m, 18C/36C 3,300 m, 04/22 2,004 m | 293 | **estimates** (OpenStreetMap, OurAirports) |
| EDDM | Munich | 08L/26R and 08R/26L 4,000 m | 209 | its AIP (DFS) |
| LEBL | Barcelona | 06L/24R 3,352 m, 06R/24L 2,660 m, 02/20 2,528 m (no landings on 20) | 209 | its AIP (ENAIRE) |
| LIRF | Rome Fiumicino | 16L/34R 3,902 m, 16R/34L 3,901 m, 07/25 3,300 m | 144 | **estimates** (OpenStreetMap, OurAirports) |

- **Munich's aprons** are OpenStreetMap's, which maps them in strips along the terminals, plus the ground under each stand's pushback, paved by the bake (`APRON_PUSH` in `tools/bake_region_airports.py`).
- Each has its runways, lights, PAPIs and ILS, named taxiways and signs, aprons, numbered stands (code E for the widebodies), terminals and parked traffic, gate starts, pushbacks, taxi routes out and in.
- **One-way and standby runways** (from each AIP): the setup offers an end only for what it is used for and says so; a standby runway's ends come last and are never the default; the map's Change route doesn't offer a take-off-only end as an arrival (it says TAKE-OFF ONLY instead of drawing a final), and Skip to final refuses one with a line saying why. Schiphol's (18R and 36R landings only, 18L and 36L take-offs only) are estimates.
- **The three estimates:** Switzerland's, the Netherlands' and Italy's eAIPs couldn't be read by a script (a login, or a challenge for automated readers), so Zurich's, Schiphol's and Fiumicino's lights, ILS categories, threshold elevations and transition altitudes are estimates. Their runways are OpenStreetMap's, checked against OurAirports.
- A baked length is the published one times the map's scale there (−0.85 % at 47° N, −0.30 % at Madrid, −0.50 % at Heathrow).

### Europe's rules

- **Hectopascals and feet everywhere.** Shift+B sets the local QNH.
- **The transition altitude is the airport's own near it** (within 60 km) and the country's elsewhere: Heathrow and Gatwick 6,000 ft (the UK's 3,000 ft elsewhere), Charles de Gaulle and Orly 5,000 ft (the Paris TMA's), Frankfurt and Munich 5,000 ft, Madrid 13,000 ft, Barcelona 6,000 ft, Zurich 7,000 ft, Schiphol 3,000 ft and Fiumicino 6,000 ft (the last three estimates). Near Zurich it holds across the German border, where the clock is still Germany's.
- **Local time with summer time,** from the browser's own time-zone data: GMT and BST in the United Kingdom, GMT and IST in Ireland, WET and WEST in Portugal, CET and CEST in the rest (Gibraltar too). The clocks change on the last Sundays of March and October, and the labels follow the date. Morocco is on its own zone.
- **The magnetic variation** is the World Magnetic Model's (2025) everywhere in Europe.
- **The METAR line** in ICAO's standard form: `EGLL 00000KT CAVOK 15/07 Q1013 NOSIG`.
- **The setup** groups the airports by country (United Kingdom, France, Germany, Spain, Switzerland, the Netherlands, Italy). The first flight it offers is Heathrow 27R to Charles de Gaulle 26L.

### Europe's cities

- **The towns** in five styles of their own, by country: Britain and Ireland (terraces of two-storey houses in parallel streets, semis, red and stock brick under slate, no towers); France (limestone under zinc grey, terracotta in the south); the centre (Germany, Austria, Switzerland: render under red-brown tile); the south (Spain, Portugal, Italy: cream and ochre under terracotta); the Low Countries and Denmark (brick under dark or red tile). Dense blocks are perimeter blocks of five to seven storeys round courtyards, with a tower only now and then; a church with a spire in some blocks.
- **The villages** in the same five groups: farmhouses and barns, houses of one to three storeys, and a church with a tower in most villages.
- **Nine centres of real buildings** from OpenStreetMap: London (Westminster, the South Bank, the City to Canary Wharf), Paris (La Défense to the Marais), Frankfurt, Madrid (Sol to the four towers), Zurich, Amsterdam's canal ring, Munich (the Altstadt to the Olympiapark), Barcelona (the Eixample and the old town) and Rome (inside the walls, and St Peter's). Pale stone under slate and zinc in London, Paris and Frankfurt; plaster under terracotta in Madrid, Barcelona, Rome, Munich and Zurich; brick under dark tile in Amsterdam; glass on towers of 75 m and up.
- **Twenty-eight landmarks** as our own models, with no names or logos: in London the Shard, the Palace of Westminster with the Elizabeth Tower, the London Eye, St Paul's and Tower Bridge; in Paris the Eiffel Tower, the Arc de Triomphe, Sacré-Cœur, Notre-Dame and the Grande Arche; in Frankfurt the Commerzbank Tower, the Messeturm and the Europaturm; in Madrid the four towers and Caleido, and the Puerta de Europa's two leaning towers; in Zurich the Grossmünster and the Prime Tower; in Munich the Olympiaturm and the Frauenkirche; in Barcelona the Sagrada Família, Torre Glòries and the Collserola tower; in Rome St Peter's and the Colosseum.
- **No greenhouses** in Europe's countryside: a built-up speck among fields is a village there.
- **The path map** names Europe's cities in English (London, Paris, Madrid, Barcelona, Berlin, Rome, Milan and more as you zoom in).

v0.7.0 also retired v0.6.0's three switches (`EAST_ASIA_ON`, `CITIES_ON`, `GROUND_ON`) with Korea's own tiles and national files: East Asia is always the region now, and draws pixel for pixel what v0.6.4 drew.

## The region (v0.6.0): East Asia

Korea's map grew into one region, in Korea's own map frame.

- **The ground:** 250 m terrain over 29–40° N, 119–142° E (all of Korea, Kyushu, Shikoku and Honshu to about Sendai, and China's coast from Ningbo to the Shandong peninsula), and 1 km land round it out to about 24–46° N, 112–148° E, so no edge shows from cruise. 30 m terrain at every airport and on Mount Fuji. It is in 128 km tiles (`data/terrain/r0`, `r1`), loaded as you fly: the sim and the predicted path wait for a tile rather than fly over a missing one ("Loading terrain…" if that ever takes half a second).
- **The airports:** each with its runways, lights, PAPIs and ILS, named taxiways and signs, aprons, numbered stands (code E for the widebodies), terminals and parked traffic; gate starts, pushbacks and taxi routes at all of them. An airport's models are built as you come within 200 km and released beyond 400 km. The setup lists them by country; the path map (N) covers the region, and Change route goes to any of them.
- **Yancheng Nanyang (ZSYN, v0.6.1):** the twelfth airport, halfway along China's coast between Shanghai and Qingdao, where there was nowhere to land: one runway, 04/22, 2,800 by 50 m, 3 m above the sea, an ILS on both ends, 20 stands for the A321neo (a 4C aerodrome: the 787 and the 777 can start on its runway or on a final, not at a stand). New routes: Incheon–Yancheng (390 nm), Yancheng–Pudong (159 nm), Yancheng–Qingdao (176 nm). OpenStreetMap maps its runway, taxiways and terminals but no aprons, stands or names, so its stands (01 to 20, along the lines the map draws to each), taxiway names (A, A1 to A3, B), holds and lights are estimates. Its air force side has taxiways and no stands, as at Gimhae.
- **Beijing, the north-east and Vladivostok (v0.6.3):** five more airports, and 26 more tiles of 250 m terrain and 30 m countryside fitted to them and the routes between them, not a rectangle (round Beijing and Tianjin, down the Beijing–Shanghai route, across Liaoning and North Korea's north, over Mount Paektu to Vladivostok): the map's faint dashed line is that data's real outline.
  - **Beijing Capital (ZBAA):** 18L/36R and 01/19, 3,800 m, and 18R/36L, 3,200 m; 393 stands. **Beijing Daxing (ZBAD):** 17L/35R, 17R/35L and 11L/29R, 3,800 m, and 01L/19R, 3,400 m; 392 stands; 11L has no approach aids (a departure end). **Shenyang Taoxian (ZYTX):** 06/24, 3,200 m; 87 stands. **Dalian Zhoushuizi (ZYTL):** 10/28, 3,300 m, both thresholds displaced (200 m and 300 m); 46 stands. **Vladivostok (UHWW):** 07R/25L, 3,500 m, ILS category II to 25L; 23 stands, the widebodies at the six its chart gives them (1A, 4, 5A, 6A, 10, 11).
  - Vladivostok's runway, lights, ILS and stand numbers are the published ones (AIP Russia, read 2026-11-20). China's AIP needs an account, so the four Chinese airports' ILS categories and lights come from open navigation data and scenery listings, and their approach lights' 900 m and PAPIs' 3.0° are the standard figures. Stand numbers OpenStreetMap doesn't carry are made up (R1 and on: 275 of Daxing's 392), and so are the holding points at all five. The baked runways are OpenStreetMap's, a fraction of a percent off the published lengths once the map's scale there is taken out (it is +0.2 % at Beijing, +0.5 % at Shenyang, +0.9 % at Vladivostok).
  - Routes: Incheon–Beijing Capital 487 nm, Pudong–Beijing Capital 593 nm, Gimpo–Vladivostok 427 nm, Incheon–Shenyang 286 nm, Incheon–Dalian 249 nm, Shenyang–Dalian 184 nm, Shenyang–Vladivostok 398 nm.
  - More real centres (Beijing, Tianjin, Shenyang, Dalian, Vladivostok) and seven more landmarks: Beijing's CITIC Tower, CCTV Headquarters and Central Radio and TV Tower, Vladivostok's Russky and Zolotoy bridges, Tianjin's and Liaoning's TV towers. Vladivostok's blocks take Korea's mix of apartment slabs.
- **North Korea and northern Japan (v0.6.4):** six more airports, and ten more tiles over Hokkaido (the 250 m data now runs from the Tsugaru Strait to north of Sapporo).
  - **Sapporo New Chitose (RJCC):** 01L/19R and 01R/19L, 3,000 m, category III to 19R; 68 stands. **Sendai (RJSS):** 09/27, 3,000 m, and 12/30, 1,200 m; 28 stands. **Niigata (RJSN):** 10/28, 2,500 m, crossed by 04/22, 1,314 m; 39 stands. **Aomori (RJSA):** 06/24, 3,000 m, 200 m up; six stands, none for the widebodies. Their runways, thresholds, lights and ILS are the published ones (AIP Japan, read 2026-11-21); their spot numbers are the AIP's where OpenStreetMap's stands could be matched to them.
  - **Pyongyang Sunan (ZKPY):** 17/35, 3,440 m; 24 stands; the closed 01/19 isn't drawn. **Wonsan Kalma (ZKWS):** 15R/33L, 3,125 m, and 15L/33R, 3,500 m (unlit); six stands; **33L and 33R are circling-only** (a ridge under their straight-in paths), as Gimhae's 18L and 18R are. North Korea publishes no AIP: Pyongyang's lights and ILS are open navigation data's, and nearly everything at Wonsan is an estimate.
  - Routes: Gimpo–New Chitose 751 nm, Haneda–New Chitose 443 nm, Haneda–Sendai 165 nm, Gimpo–Niigata 585 nm, Incheon–Pyongyang 112 nm, Gimpo–Wonsan 102 nm, Wonsan–Vladivostok 330 nm.
  - More real centres (Pyongyang, Sapporo, Sendai, Niigata) and four more landmarks: the Ryugyong Hotel and the Juche Tower, the Sapporo TV Tower, the Sendai Daikannon.
  - Known: Aomori's runway lies about 60 m along its axis from the published thresholds (OpenStreetMap's); Niigata's stand 10 routes along runway 04/22; a landing rolled far down Sendai's 12, Niigata's 22 or Wonsan's 15L/33R may get no taxi-in route or one back up the runway.
- **Local rules:**
  - Japan sets the altimeter in inches of mercury. Shift+B sets the local QNH in the local unit; the IN/HPA button beside the BARO window switches the unit by hand. 29.92 is the standard setting in inches.
  - China's transition altitude is 3,000 m and its transition level 3,600 m (Korea's and Japan's: 14,000 ft and FL140), and in China the PFD also shows the altitude in metres (METRIC ALT on the FCU, MTRS on the Boeings' panel; a click turns it on or off anywhere). The ALT window stays in feet.
  - North Korea (v0.6.4, from open sources, none official): hectopascals and feet, a transition altitude of 12,000 ft and level FL130, the weather line's wind in metres per second.
  - Russia (v0.6.3, at Vladivostok, from its AIP): hectopascals and feet, a transition altitude of 8,000 ft and level FL090, the weather line's wind in metres per second.
  - The clock shows local time where you are: KST, JST, China's CST or Vladivostok's VLAT (UTC+10). The setup's time is the departure's; the logbook gives each end its own.
  - The magnetic variation is the World Magnetic Model's (2025) outside South Korea, so runway numbers and headings agree in Tokyo and Shanghai too. The METAR line takes each country's form (`Q1014 … RMK A2997` in Japan, the wind in metres per second in China).
- **The weather** is still one weather for the whole flight, set for the arrival; its wind keeps its true direction everywhere.
- **The cities:** each country's own mix of buildings (Japan's low rows of houses with towers in the centres, China's compounds of point towers, Korea's apartment blocks), real buildings from OpenStreetMap in the centres of Tokyo, Yokohama, Osaka, Fukuoka, Shanghai, Qingdao, Seoul, Songdo and Busan, and nineteen landmarks as their own models, from Lotte World Tower and the 63 Building to Shanghai Tower, Tokyo Tower and Skytree. No names or logos on any of them.
- **The fuel estimate** in the setup follows what the aircraft burn in the sim over these longer routes (about 5.1 t for an A321neo from Gimpo to Haneda, with the reserve).
- **The countryside** near the aircraft follows 30 m land cover (ESA WorldCover 2021): fields as districts of uneven plots with tracks and tree lines between them (terraces along the contour on slopes), woods and woodlots where they really are with trees out to the middle distance, ponds and canals, greenhouses on the plains (v0.6.1: as rows of low plastic tunnels near the aircraft), bare ground as graded earth with damp and dry patches (v0.6.1), paddies that run along their valleys (v0.6.1), and houses and sheds in the countryside, each country's own (Korea's coloured steel roofs, Japan's dark tiles, the Yangtze delta's tall village houses). Towns' ground is lots, gardens and lanes; inside an airport's fence the ground is the airfield's grass, not fields (v0.6.1). South Korea's 250 m cover was re-aggregated from the same source so near and far agree.

Three switches in `src/world/region.js` hold each part: `EAST_ASIA_ON` (the region; `?eastasia=0` on the URL gives v0.5.8's Korea), `CITIES_ON` (the cities, `?cities=0`) and `GROUND_ON` (the countryside's new ground; `?ground=0`). `?eastasia=0&cities=0` is v0.5.8's Korea, pixel for pixel. (Until v0.6.4: v0.7.0 retired the three switches and Korea's own files, so these parameters do nothing now.)

## Running it

Serve GameDump's root and open the game:

```sh
cd GameDump
python3 -m http.server 8001
# http://localhost:8001/games/flight-sim/
```

It also runs from the hub's player (`play.html?game=flight-sim`). There's no build step: these are plain ES modules, three.js r186 is in `vendor/`, and the baked world is in `data/`. Chrome on a Mac is the target.

The game opens on the main menu, over a still rendered from the game: Continue (the newest scenario), New scenario, Load scenario, Logbook, Settings, Controls, and Exit to Game Dump.

**Scenarios** are save slots holding the whole state: the aircraft's position, speed and attitude, the autopilot and FCU, fuel, the gate flow (a pushback under way and the taxi route), the landing score's approach track, the camera and the clock. A loaded scenario is exactly where it was and flies on. They autosave every 60 s in flight, on pause, when the tab hides or closes, and on Exit to menu, and the Esc menu has Save. A crash never overwrites the last good save. Load scenario lists them newest first, with rename, duplicate and delete: a copy is the same moment, aircraft and load, so you can fly on from one point again and again (the Esc menu's Save a copy makes one of the present moment, and you fly on in the original). v0.1.x's last flight becomes "Scenario 1", with its logbook.

New scenario opens the flight setup with a name: the origin, destination, runways, load and fuel, the start (lined up on the runway, on a 15 nm final, or at a gate), and the time (Now, the real time at the departure, or a date and time picked in its local time: KST, JST or China's CST in East Asia; GMT or BST, CET or CEST and so on in Europe). New flight in the Esc menu replaces the scenario's flight, starting from the stand when parked after arriving. During a flight, the L window's Weight tab (or Weight and fuel in the Esc menu) changes the passengers, cargo and fuel, in the air or on the ground, with the setup's checks; Restart the flight goes back to the setup's load.

**Night:** the time of day runs with the sim, shown in local time where you are (time compression speeds it up), and the sun, the Moon (with its phase), the 8,400 brightest real stars (with fainter ones past them, washed out by a bright Moon) and the Milky Way are where they really are. On every clear night (v0.4.3) an aurora hangs low in the northern sky: green curtains with red tops and drifting rays, far off, behind any cloud; since v0.4.4 its folds open and close in slow waves and its shapes change as they go. The light runs through golden hour and twilight to a moonlit or starlit night, with the cities lit (streetlights, commercial cores, apartment windows), the runways, approach lights, PAPIs, taxiways and aprons lit, and the A321's own lights set by phase as pilots use them. The Sky window (L) sets the time and date, the clock's speed and jumps to sunrise, noon, sunset, midnight or now.

**Weather** (v0.4.0): the L window has a third tab, Weather (Sky · Weight · Weather). Pick a preset (clear, few clouds, overcast, rain, a light, moderate or severe storm, snow, fog, gusty crosswind), or change any setting under it: the wind by height, gusts, turbulence, a low-level shear, a microburst on final, the visibility and fog, up to three cloud layers, rain or snow, lightning, the runway's state, the temperature and the QNH. It applies at once in flight. The setup picks a preset for the flight, clear by default. The wind is felt as a crosswind, a headwind or a tailwind, and the altimeter is real: each flight starts with the day's QNH set, K sets it again, and the BARO box on the FCU or the MCP sets it too (scroll it, type into it, or STD). Above the transition altitude (14,000 ft) with a QNH set, or below FL140 on STD in a descent, the setting flashes until you change it. The landing card and the logbook give the wind at touchdown as the tower does. v0.4.2: a predictive windshear warning (WINDSHEAR AHEAD) for a microburst on the path ahead below 1,200 ft; hydroplaning above about 130 kt on standing water in heavy rain; wipers in the cockpit, spray off the wheels, and snow over the taxiway paint.

From a gate:

1. Press P to push back. Q/E steer the turn, and P again holds the push.
2. Release the parking brake (B).
3. Follow the green-yellow line to the holding point.

After landing, a new line leads from the runway to a free stand. Every landing is scored on the touchdown itself (v0.6.2: the approach isn't scored, and only a hard touchdown holds the total down) and logged with its scenario: the Esc menu's Logbook shows this scenario's flights, the main menu's all of them with a filter. Each part (vertical speed, peak g, the touchdown point, the centreline, bank, pitch, bounces, the approach path, the sink rate's swings) scores out of its share of the 100 (v0.5.5: vertical speed, the touchdown point and the centreline the largest shares, bank and pitch the smallest), so the rows add up to the total; what comes off after that is a row of its own: the worst part holds the total to 50 + 10 × its score out of 10, the grass to 49, and a taxiway or a would-be crash halves it. 100 still takes a perfect landing in every part, but several middling flaws make a C or a D, not 0. Bounces are counted from the main wheels leaving the ground (v0.5.5).

Sound starts with the first click or key, because browsers don't play audio before then. Settings has the master volume, the size of the side panels (v0.6.2: 50 % to 120 %), the callouts and the performance readout, and (v0.4.1) two for practice: **Indestructible**, so no crash ends a flight (the landing card says what would have crashed; v0.4.2: the crash screen can turn it on as it rewinds), and **Boeing auto-trim**, so the 787 and 777 hold their flight path hands off and flare as the A321 does (v0.4.2); on final the nose stops within about a degree of where you let go, and pitches at 2.2°/s at most outside the flare and a go-around (v0.4.3).

## Controls

The keys below are the defaults (v0.5.7). **Two kinds of keys** (v0.5.7): a block of 16 keys under your right hand, **7 8 9 0, U I O P, J K L ; and M , . /** (Shift with them too), belongs to the warehouse: each aircraft sets its own keys there and nothing else uses them. Every other key is on the **Controls page** (main menu, Settings, the Esc menu), the same for every aircraft, under a drawing of the keyboard: the block's keys cyan, the Controls page's sand (faint when free), the keys that do nothing on their own grey; hover a key to see what it does, or a row to light its keys. Click a keycap and press the new key; Esc cancels, Backspace or Delete clears it, + adds another. **An engine's own keys:** click an engine in the warehouse and give it an up and a down key from the block, one engine at a time (the three types have a keys-only editor in the warehouse's list); engines start with none, and keys save as you set them (Discard doesn't undo them). R and F still move every lever; an engine's own keys move only its lever, so the levers can stand apart, and its down key held at idle on the ground holds its reverse. A wing tank's Drop key comes from the block too. An engine's own key while a Boeing's A/T drives disconnects it, and apart, the all-engines lever reads the most advanced one (MAN TOGA, the A/THR's modes). A key one side uses is refused on the other, naming the rule. Esc and \ can't be rebound; \` Tab Caps Lock Return delete and the Shifts can't be keys; keys with Ctrl, Cmd or Alt aren't allowed. Shane's rule for the defaults: a key you press more than once a flight in the air needs no Shift; rare ones (TO/GA, the QNH, pushback) may. Only your changes are stored, under `gamedump:flight-sim:keys`.

| Key | Action |
|---|---|
| W / S | pitch down / up |
| A / D | roll left / right |
| Q / E | yaw left / right (steering on the ground) |
| R / F | thrust levers forward / back; on the ground at idle, keep holding F for reverse |
| Space (hold) | wheel brakes |
| B | parking brake |
| Shift+B | set the altimeter to the local QNH (v0.5.7, was K) |
| G | gear lever |
| − / = | flap lever one step up / down (every type; v0.5.6, was 6 to 0 for the detents and [ ] for steps) |
| (unbound) | the flap detents (A321neo 0, 1, 2, 3, FULL; Boeings UP, 5, 15, 20, 30): bind them in Controls if you want them |
| H / Y (hold) | Boeings: pitch trim nose up / nose down (it moves the speed the aircraft holds; with auto-trim on, the flight path held) |
| Shift+T | Boeings: TO/GA (take-off thrust on the ground, a go-around in the air; v0.5.7, was O) |
| C | speed brakes in / out |
| Shift+C | arm ground spoilers |
| Z | autopilot on / off |
| X | autothrust on / off |
| ] / [ | time compression faster / slower (v0.5.6, was = and −; Num + and Num − too): with the AP on and 2,000 ft up, or in a pushback (up to 4×) |
| N | map (predicted path, jumps, waypoints, Change route, skip to final; v0.5.7, was M) |
| 1 / 2 / 3 | cockpit (the captain's seat; 1 again swaps to the first officer's and back), nose, 3rd person view, as the switch at the top right does |
| Hide panels (top left, v0.4.4) | hides the PFD, the ND and the engine panel for a wide view (the FCU or MCP and the view switch stay); Show panels brings them back, and the choice is kept. Since v0.6.2 it, Pause, the FCU or MCP and the view switch share one row along the top, which shrinks to fit rather than wrap |
| Pause (beside it, v0.5.4) | the only pause (v0.5.5): Pause stops the flight and Resume goes on. While paused the views and the camera move, and the thrust levers (R and F; the engine panel's command ring follows), flaps, gear, speedbrake, the autopilot and the FCU or MCP take their settings, which act on Resume. A hidden page pauses too |
| V | next view (Nose, 3rd person, Captain, First Officer) |
| Shift+G | pushback start / stop (v0.5.7, was P) |
| Esc | the menu (v0.5.5: it doesn't pause; the flight goes on under it and its keys wait): Close, Save, Save a copy, Logbook, Rewind 30 s, Restart, New flight, Settings, Controls, Time of day, Weight and fuel, Exit to menu |
| \\, or Cmd/Ctrl+L | the Sky window (v0.5.7: \\, was L): the time of day, the date, the clock's speed (the one Ctrl binding, as in Satisfactory); its Weight tab: the passengers, cargo and fuel, and (v0.5.4) Drop wing tanks for a design with wing tanks, in the air, once: they go with the fuel still in them. \\ opens the tab last shown; the menu's Weight and fuel and Time of day open it, the pause as it was |
| F3 | performance readout (v0.5.7: \` no longer opens it): a line across the top with fps, ms per frame, physics steps, draw calls, triangles, GPU memory, the world's counts and the heap (also in the Esc menu) |
| T | rewind 30 s (paused, with the menu open, or after a crash) |
| 7–0, U–P, J–;, M–/ | the warehouse's block (v0.5.7): each aircraft's own keys for its engines' thrust and its wing tanks' Drop, none until you set them |
| drag on the view (one finger) / pinch / double-click | look around, or orbit in 3rd person / zoom / recentre; a two-finger swipe also looks or orbits |

The FCU strip at the top sets SPD, HDG, ALT and V/S. Scroll over a window to turn it (a quick flick turns it in big steps), or click it, type a value and press Enter, which also pushes the knob: ALT starts a level change, V/S engages V/S. An ALT under 1,000 is a flight level (350 = FL350); a V/S of 60 or less is in hundreds (−15 = −1,500 ft/min). Esc, a click elsewhere or a flying key closes it unchanged. The strip also has the AP1 and A/THR buttons and the Normal/Alternate law switch.

On the Boeings an MCP takes its place, with the same typing and scrolling: A/T, IAS/MACH (it shows Mach above FL260, and it's blank in VNAV), LNAV, VNAV, FLCH, HDG (HDG SEL, HDG HOLD), V/S, ALT (ALT HOLD), LOC, APP, A/P and TO/GA. Pressing Enter on a window pushes it: HDG to HDG SEL, ALT to FLCH, V/S to V/S.

## Flying tips

- **Take-off:**
  1. Hold R through the detents to TOGA (it pauses at CL and FLX/MCT).
  2. At about 145 kt, hold S. The aircraft rotates at about 4–5°/s and lifts off near 8°.
  3. G for gear up; − a step at a time to flaps 0 by about 210 kt.
  4. Pull the levers back to CL (F) for the autothrust.
- **One engine down** (or your own engine keys, v0.5.7): the aircraft yaws towards the low-thrust side, and a 787 or 777 rolls into it too. Hold it with the rudder (Q or E) and, on a Boeing, the wheel: about 4° of rudder at 250 kt, 13–16° on an approach (v0.5.8; the real Boeings' TAC, which does it for you, isn't modelled). The A/THR brings split levers back together, so try it with the A/THR off.
- **Autopilot:** set HDG and ALT on the FCU (scroll, or click and type; Enter on ALT starts the level change, OP CLB/OP DES), then Z (AP) and X (A/THR). The FCU heading starts at your heading. Time compression (=) needs the AP on and 2,000 ft above the ground.
- **Autothrust:** while A/THR is on it moves the thrust levers, and the blue ring on the N1 dials with them ("A/THR" between the dials). R or F takes the levers from where it left them and turns A/THR off; X turns it back on.
- **The map (M):** with the AP on, the bright line is where the aircraft will go. Click a point on it to jump there. The magenta line is the route to your destination and doesn't jump: point the HDG along it first. A red cross means the path meets the terrain. "Skip to 15 nm final" puts you on the 3° path to the destination runway.
  - **Waypoints:** drag the magenta line to add one; double-click a waypoint to remove it. Hover over the magenta line for the heading to set to follow it, worked out for the wind where you are (v0.6.2).
  - **Change route** (or a click on an airport) picks a new destination and runway in flight, with the distance, bearing and fuel needed direct from where you are. The line then goes direct from where you are.
- **Landing:**
  1. Gear down; flaps 2, 3, FULL; Shift+C to arm the ground spoilers.
  2. Disconnect the AP with Z.
  3. With flaps 3 or FULL, W/S nudge the flight path, and it holds where you leave it.
  4. From about 30 ft, hold S for a second or two to flare. The nose sinks by itself if you don't.
  5. Pull the levers to idle when you hear RETARD.
  6. On the ground, hold F for reverse and Space for the brakes.
- **Levers at TOGA** start a go-around at any point.
- **On a Boeing:** trim to the speed you want before you let go (H nose up, Y nose down), or turn on Boeing auto-trim in Settings and fly the path as on the A321. Pull the flare yourself from about 30 ft, and there's no RETARD call. With APP armed and the autopilot on it lands itself, and hands back below 30 kt: you brake (there's no autobrake).

## Known issues

- No agent has listened to the sound: the levels and the engines' frequencies are measured (`tests/audio-render.mjs`), not judged by ear. `tests/audio-clips.mjs` renders flight phases to listen to. v0.3.1 raised the engines in the cockpit by about 7 dB, by measurement.
- On the A321neo the predicted path is a straight line on the selected heading, because its autopilot has holds only (route following is on the roadmap). A Boeing's follows LNAV and its ILS.
- Triangles: v0.6.0 drew 1.3 to 1.9 M near cities; v0.6.1 draws the houses, trees and greenhouse tunnels only where one stands and the cities, the centres' low buildings and parked aircraft only in view, so the same views are 0.5 to 1.0 M (Tokyo at 3,000 ft 1.03 M; low over Narita's woods up to 1.3 M) at 60 fps with two thirds of the frame to spare on the M5 (`tests/browser-v060-headroom.mjs`). `?cull=0` draws everything in or out of view, for comparison.
- Gimhae's runways 18L and 18R have no straight-in approach: the 3° final passes through the hills north of the field, and the real approach circles to land from the approach to 36. Since v0.6.2 the game offers no final start, Skip to final or 15 nm final line to them (the setup and the map say why); land on 36L or 36R, or fly the circle by hand.
- Some airport details are estimates. v0.6.1 read Korea's AIP for Gimhae (its ILS categories, approach lights, PAPIs and 18R's threshold, displaced 600 m, are the published ones now) and open nav data for Pudong's and Qingdao's ILS categories; China's AIP wasn't readable, so the Chinese airports' PAPI sides, Pudong's and Hongqiao's approach lights at their CAT I ends, Hongqiao's thresholds and nearly everything at Yancheng (above) stay estimates, as do the holds made where OpenStreetMap maps none. After landing on Jeju's 31 (from halfway along) or 13 (from three quarters), the taxi-in route runs back along the runway: the map has no other way off.
- **Europe (v0.7.0):**
  - Zurich, Schiphol and Fiumicino are estimates (above). Gatwick's and Munich's 30 m terrain stops short (at Greenwich and at 12° E), so about 11 km of their eastern finals is on the 250 m terrain.
  - The countryside's fields are still East Asia's mosaic: no hedges in Britain and Normandy, no olives in the south, and the Dutch polders' fields don't look Dutch.
  - The aurora hangs over Europe on every clear night, as it does over East Asia (v0.4.3).
  - Some buildings stand in narrow rivers (the Main at Frankfurt, the Thames by Tower Bridge), and the real centres' courtyards are roofed over.
  - The home page's ticket cuts long names short ("Heathrow to Charles d…").
  - Paris, Madrid and Frankfurt draw over a million triangles with their centres in view, and Frankfurt at a stand (60 fps on the M5 all the same).
  - Lakes such as the IJsselmeer lie a few metres too low (inland water sits 2 m under its banks), and open-pit mines show at their real depth.
  - On the way from Heathrow to Charles de Gaulle at 16×, one frame of 33 ms comes at the same place each time, about 35 km south-east of Gatwick (not found yet).
  - The low landmarks (the Arc de Triomphe, the Colosseum, Tower Bridge, Notre-Dame, St Paul's) are hidden by their centres' blocks from a level view; Tower Bridge is a plain model with a flat deck.

## Types

| | A321neo | 787-9 | 777-300ER |
|---|---|---|---|
| Engines | CFM LEAP-1A | GE GEnx-1B | GE GE90-115B |
| Control law | Airbus: load-factor demand, auto-trim, hard protections | Boeing: speed-stable about the trim, soft protections (Settings' auto-trim: the path holds itself) | the same as the 787 |
| Flap detents | 0, 1, 1+F, 2, 3, FULL | UP, 1, 5, 10, 15, 17, 18, 20, 25, 30 | UP, 1, 5, 15, 20, 25, 30 |
| Numbers | `src/sim/a321neo.js`, `reference/notes/a321neo-performance.md` | `src/sim/b787-9.js`, `reference/notes/b787-9-performance.md` | `src/sim/b777-300er.js`, `reference/notes/b777-300er-performance.md` |
| Sources | EASA TCDS A.064, Airbus AC | EASA TCDS IM.A.115, Boeing D6-58333, EASA TCDS IM.E.102 | EASA TCDS IM.A.003, Boeing D6-58329-2, EASA TCDS IM.E.002 |

**Flying a Boeing:** trim for the speed you want (H, Y), and it holds that speed hands off. Thrust moves the nose, and flaps and gear slow you only if you trim down too. Flare with back pressure; nothing does it for you. With Boeing auto-trim on (Settings), it's the A321's way instead: let go and the flight path holds, the thrust (or the autothrottle) sets the speed, and with the flaps for landing W and S nudge the path.

## The warehouse (v0.5.0, parts anywhere since v0.5.2)

**Warehouse** on the main menu, after Load scenario: your own aircraft, each built on one of the three types (its base: its wing, fuselage, tail and limits). Mouse and touchpad, and a few keys of its own.

- **The list:** New from the A321neo, the 787-9 or the 777-300ER; Open (or click the row), Rename, Duplicate, Delete.
- **The editor** (v0.5.2, KSP's way): the aircraft in 3D in the middle (drag to go round it, pinch or scroll to zoom, double-click to recentre), the **parts palette** over its left edge, and the side panel on the right.
  - **Attach:** pick a part in the palette (the LEAP-1A, the GEnx-1B or the GE90-115B; a wing tank, a hold tank, ballast) and move the pointer over the aircraft: its ghost follows, snapped to where it would go (0.25 m steps), green where it fits and red where it doesn't (another part in the way, the limits, a second engine in the tail), with its name and place beside the pointer. Click to attach it; Shift+click keeps it in hand for another; right-click or Esc puts it back. Or drag it from the palette onto the aircraft and let go (v0.5.6); let go off the aircraft, or where it doesn't fit, and it goes back. The selected part's keys work on the part in hand too (v0.5.6): ↑ ↓ fore and aft, ← → out and in from where the pointer puts it, Shift+↑ ↓ an engine up and down, Q E turn it a degree, with the values beside the pointer; Shift+click keeps them for the next one.
  - **Where engines go:** dropped on the wing, under it or over it (the palette's Under / Over); on the rear fuselage's sides; on the fin, one in the tail. Up to 8 engines and 24 parts.
  - **Mirror** (on by default) attaches a twin on the other side and keeps the pair together whichever you edit; turn it off for one side alone. A part's own Mirror box pairs or unpairs it later.
  - **Select, move, remove:** click a part to select it (its box lights up, its twin's dimmer), drag it to move it (the ghost shows where), Delete or Backspace removes it (and its twin), Esc lets go. **Z** undoes and **Shift+Z** redoes every change (the buttons at the top right too); a slider's drag is one step. The name and registration aren't steps. **Keys** (v0.5.4) for the selected part: ↑ ↓ forward and aft, ← → out and in along the span, Shift+↑ ↓ an engine up and down, Q E turn an engine a degree; each press is one step, a held key's repeats one between them. A renamed design is renamed in the scenarios that fly it.
  - **A part's settings** (the side panel, while it's selected): its mount, its engine, where it sits (out from the centreline, or back from the nose), nudged forward or aft (±3 m) and up or down (±1 m), toed in or out and pitched (±10°), its thrust (0.5 to 3 times its type's), or a tank's fuel (1,000 to 8,000 kg under the wing, to 3,000 kg in the hold) and the ballast's mass (100 to 6,000 kg).
  - **The airframe** (v0.5.3): click the **wing**, the **tailplane**, the **fin** or the **fuselage** (hovering outlines it) and its sliders take the side panel: the wing's **span** and **chord** (0.8 to 1.3 times the base's), **sweep** (−8° to +8° added) and **dihedral** (−3° to +8°), with **Mirror** (on: both sides together; off: the side you clicked alone) and the wing's **position** (v0.5.6: −3 to +3 m, aft positive: the whole wing with its engines, tanks and main gear, to put the gear back behind the CG) and, on the A321, **Sharklets** (off: 34.0 m of span instead of 35.8, about 8 % less effective aspect ratio, so more induced drag in the climb and cruise, and 400 kg lighter); the tailplane's and the fin's **areas** (0.6 to 1.6 times, their shape kept); the fuselage's **plugs** ahead of and behind the wing (−4 to +6 m each: the nose moves forward, the tail back). While a slider moves, the new outline is drawn in green over the model, which follows when you let go. A slider's drag is one undo step; **As the base** puts that part back; Esc or right-click lets go. Engines and wing tanks ride the wing (and move in on a shorter one), and so does the main gear (v0.5.6: each leg where the stock leg is relative to the wing, so a smaller chord or less sweep brings it forward; the nose-wheel check says when to move the wing aft); the windows and doors are repeated in the plugs, not stretched.
  - **With nothing selected:** the name and registration (painted on it), the parts as a list (a click selects one), the **structure's weight** (−15 % to +30 % of the base's), the **wing and centre tanks** (half to twice the base's) and the **gear** (up to 1.5 m longer).
  - **The balance:** the centre of mass at the default load (a yellow and black ball) and the centre of thrust (magenta, its arrow along the resultant thrust) drawn over the model; the CoM · CoT button hides them.
- **The hangar** (v0.5.1): the design stands in a maintenance hangar, its nose to the offices at the back and its tail to the doors it came in by (part open onto the apron); the stand's lead-in line has a stop bar for each type's nose wheel, and people walk the green walkways. The camera stays inside: zoomed out, it stops at the wall, the roof or the floor.
- **The numbers**, live: the empty weight (with every part's weight), the base's MTOW (the structural limits stay the base's, so parts and fuel eat into the payload), the fuel, thrust to weight at MTOW, a range, the tail-strike angle, the drag the parts add, the CG against the base's, the thrust's yaw and pitch at full power, and per engine and wing tank its ground clearance standing and at the tail-strike attitude (and each pylon's load at full thrust against its limit).
- **The airframe's numbers** (v0.5.3), each against the base's: the **static margin** at the default load (from the parts' neutral point), **Cnβ** (directional stability), the **stall** at MLW in landing flaps and the approach speed, the **tail-strike angle**, the **nose wheel's load** standing, and the **wingspan's code letter** against the stand's; v0.5.6: the **minimum control speed** (VMC: full rudder, the worst engine out and the rest at full thrust) against the take-off rotation speed (amber within 5 %, red above it), and for lopsided thrust the speed below which the rudder can't hold it with every engine running.
- **The checks:** amber warns, red will fail or touch:
  - **red (v0.5.3, the airframe):** the CG behind the neutral point (negative static margin), Cnβ at zero or below, under 2.5 % of the weight on the nose wheel (full thrust tips it onto its tail), the static margin 25 % MAC over the base's (too nose-heavy to rotate);
  - **amber (v0.5.3):** under 5 % MAC of static margin or 10 % over the base's, Cnβ under half the base's, a stall over 1.1 times the base's, the tail striking 1.5° sooner, under 5 % on the nose wheel, a span past the stand's code letter (such a design, or a stretched one, is offered only the stands that fit its own span and length, parks with its own nose on the stop mark, and the parked traffic makes room for its own wings). On the base's own airframe the CG against the base's (below) still shows; on a changed one the static margin takes its place;
  - **red:** no engines (Save and Fly it wait for one); a nacelle or tank touching the ground, standing or at the tail-strike attitude; parts overlapping; a pylon past its limit; thrust lopsided past an engine failure on the base (the rudder can't hold it on the runway); the CG more than 12 % MAC aft of the base's (past its static margin) or 25 % forward;
  - **amber:** under 0.3 m of clearance; a pylon past 90 %; lopsided thrust past a tenth of an engine failure; the CG 5 % aft or 10 % forward; the thrust's pitch 2.5 times the base's; thrust to weight over 0.8 when light (full power on the runway can lift the nose into a tail strike); little thrust (under 0.22 at MTOW); under half the base's payload room.
- **Fly it:** saved designs are cards in New scenario's aircraft picker, under the three types; the editor's **Fly it** saves the design and opens New scenario with it picked. A scenario keeps its own copy of the design, so editing or deleting it later doesn't change a saved flight. v0.5.0's designs open as they were.

**What it does in flight:**

- **Each part's weight** where it is: the CG and the inertias follow (ballast aft moves the CG aft; a long wing's engines roll it slower).
- **Each part's drag** where it is, against the airflow (a nacelle about CD 0.05 on its frontal area, a wing tank 0.08): a lone wing tank or engine far out yaws the nose towards its side.
- **Each engine's thrust along its own line:** toe-in on a pair cancels, a lone toed engine yaws, pitched engines push up or down with their moments. Mixed engines each run on their own numbers (thrust, spool, fuel flow) and sound like themselves.
- **Fuel in the tanks** joins the centre tank's (burned first), its CG the mean of where it is.
- **Off-centre thrust yaws:** an engine at idle, reversing alone or gone pulls the nose towards the dead side (on the runway, below about 110 kt, nothing holds it straight: reject the take-off).
- **The pylons:** each holds 1.5 times its engine type's rated take-off thrust (CS-25's ultimate factor), and each a little more as built (0 to 10 %). Past it the engine **tears off**: it stops, its weight goes, the model loses it and its pylon, and the screens show it OFF. Indestructible doesn't stop it (it's a failure, not a crash).
- **A big engine on a small aircraft scrapes:** two GE90s on an A321 sit a metre into the runway unless the gear is lengthened (1.5 m clears them by 0.4 m). They also give it a thrust-to-weight over 1 and a thrust line far below its centre of gravity, so full thrust on the runway pitches it into a tail strike: take off with about a third of the lever.
- **More engines burn more fuel** by the weight and drag they add: the fuel flow is the thrust's.
- **The screens and the sound:** the A321's engine panel and the Boeings' EICAS draw every engine (up to 8); the synth gives each its own voice.
- **The airframe from parts** (v0.5.3): the wing (each side), the tailplane, the fin and the fuselage are parts too, and the handling follows from them. Each wing, tailplane and fin panel is a few strips, each with its own airflow (the aircraft's motion and rotation at that strip, the wing's downwash at the tail, the sidewash at the fin), its own lift curve and stall, drag and moment; the fuselage adds its drag, side force and destabilising moments. A design flies its base's model plus what its parts change, so a bigger tailplane gives more static margin and a quicker short period, a smaller fin less directional stability and a Dutch roll that dies out more slowly, a longer span a steeper lift curve, less induced drag, more roll damping and a lower stall, one wing panel longer than the other a roll towards the short one. The structure weighs what its parts weigh where they are (a longer wing rolls slower, plugs add pitch and yaw inertia), the wing's tanks hold what its volume does, the engines and wing tanks ride the wing, a stretched body lowers the tail-strike angle, and the laws (the A321's normal law, the Boeings', the autopilots, the yaw dampers) tune themselves to the design's control power, so it flies with its base's feel. The three types themselves fly exactly as before.

## Code map

| Path | What |
|---|---|
| `src/sim/types.js` | the type registry: each type's data, geometry and what the screens say (`typeById`, `kitFor`, `TYPE_LIST`) |
| `src/sim/designs.js`, `src/sim/engine-types.js` | v0.5.0: a design (one plain object) and its type entry (`designDef()`: the engines' places, mass, CG and inertias, tanks, gear, pylons; `designNumbers()`); the three engine types as parts. v0.5.2: a design is parts (`parts`, `addPart()`, `updatePart()`, `removePart()`, `setMirror()`), each mount's place and range (`placeEngine()`, `placeTank()`, `placeBallast()`, `mountRange()`, `airframe()`), each engine's own numbers when they're mixed, the thrust lines, the parts' drag. v0.5.3: the `airframe` field (`fixAirframe()`, `defaultAirframe()`, `isBaseAirframe()`), the mounts on the design's wing (`airframe(base, af)`, `designAirframe()`), the structure's mass and the wing's fuel (`airframeMasses()`), the moved points, `GAIN_SCALE` (`gainScale()`), and the checks (`designNumbers().airframe`) |
| `src/ui/hangar.js` | v0.5.1: the warehouse's hangar (`createHangar()`: merged by material, the people instanced), the camera's box (`cameraBox()`, `rayExit()`) and the walkways' loop (`walkPath()`) |
| `src/sim/parts-aero.js`, `src/sim/parts-aero-cal.js`, `tools/fit-parts-aero.mjs` | v0.5.3: the airframe's aerodynamics from its parts: each type's wing, tailplane, fin and fuselage as planforms (`baseShape()`, `shapeOf()`), strips with their own airflow, lift curve, stall and drag (`partsModel()`, `partsInto()`); a design flies `lumped(base) + parts(design) − parts(base)` (`partsDeltaInto()`, `clmaxDelta()`, hooked in `sim.js`); the calibration, fitted by the script to each type's lumped model (`tests/parts-aero-table.mjs` is the validation table) |
| `src/sim/airframe-map.js` | v0.5.3: a design's airframe as maps from its base's geometry (`airframeMap()`: the wing per side, the tails, the fuselage's plugs), shared by the parts' model, the models (`aircraft.js`, `widebody.js`), the mounts and the warehouse |
| `src/designs-store.js`, `src/ui/warehouse.js`, `src/ui/warehouse.css` | v0.5.0: the designs saved (`gamedump:flight-sim:designs`); the Warehouse page and its 3D view. v0.5.2: the KSP editor (the palette, the ghost and the pointer's hooks, `hitAirframe()`, `placement()`, `pickPart()`, the overlay with the CoM and CoT, `readout()` and `thrustLine()`, undo and redo with `createHistory()`, Fly it); v0.5.8: names as live references (`designName(id, stored)`, `store.names()`, `store.nameOf()`), used by the home card, Load scenario, the logbook (`designLabel()`, `designIdOf()` in `ui/logbook.js`), the setup and the flight's saves |
| `src/engine-model.js` | v0.5.0: one engine builder for all three aircraft (each engine type's nacelle and pylon at its station, the tail engine, each fan on its own engine's N1). v0.5.2: the over-wing and body pylons, a turned engine, a wing tank (`addPod()`) |
| `src/ui/engine-row.js` | v0.5.0: the engine panel's and the EICAS's row of dials for 3, 4 or 6 engines |
| `src/type-assets.js` | each type's model and cockpit builders (the page only) |
| `src/sim/b787-9.js`, `src/sim/b777-300er.js`, `src/geometry-b787-9.js`, `src/geometry-b777-300er.js` | the Boeings' numbers and geometry |
| `src/sim/fbw-boeing.js`, `src/sim/autopilot-boeing.js` | Boeing's C*U law, the trim and soft protections; the autothrottle and the MCP's modes, LOC, G/S, autoland (`reference/notes/boeing-fbw-ap.md`); v0.5.8: the yaw damper and turn coordination leave a thrust asymmetry's part alone (`asymmetryInto()` in `fbw.js`, from `E.nThrust`, the engines' own yaw moment, in `sim.js`), and the Boeings' hands-off roll drifts with the sideslip's dihedral effect up to 34° |
| `src/widebody.js`, `src/widebody-shape.js`, `src/widebody-specs.js`, `src/livery-widebody.js` | the widebodies' exterior and livery, from one spec per type |
| `src/cockpit-boeing.js`, `src/cockpit-windows-boeing.js` | the widebodies' cockpit and windows |
| `src/ui/boeing/`, `src/ui/knobs.js` | Boeing's PFD, ND, EICAS and MCP; the knobs the MCP and FCU share |
| `src/audio/engine-sounds.js` | the GEnx-1B's and GE90-115B's numbers for the synth |
| `index.html`, `style.css` | the page, the pause, crash and score panels |
| `src/main.js` | boot, the frame loop (fixed 1/120 s physics, 60 fps cap, physics budget), time compression, rewind, jumps, skip to final, test hooks |
| `src/version.js` | the version the game shows, bumped with every update (see `Updates.md`; commits are titled with the version, `sh tools/push.sh v0.1.1`) |
| `src/input.js`, `src/keys.js`, `src/ui/keyboard-map.js` | keyboard: ramped stick axes, the thrust levers with detents and reverse, actions; the bindings (`keys.js`, v0.5.7: the defaults, the warehouse's block `BLOCK`, the store v3 with the global keys and each aircraft's engine and Drop keys, refusals both ways, reserved keys, the v2 migration); each engine's own lever (`controls.thrustEng`, `engineSlots()` mapping a design's engine parts to the sim's engines); `keyboard-map.js`: the Controls page's keyboard drawing |
| `src/camera.js` | the four views and the touchpad camera |
| `src/geometry.js` | A321neo body-frame geometry shared by the sim, the model and the cameras |
| `src/sim/` | atmosphere, A321neo data (with sources), flight model, engines, gear, fly-by-wire, autopilot, prediction worker |
| `src/sim/weather.js`, `src/sim/weather-presets.js`, `src/sim/lightning.js` | the weather's settings and the wind field (mean wind, gusts, Dryden turbulence, microbursts, all stateless and seeded), the runway's state, the presets, the seeded strikes |
| `src/ui/weather-window.js` | the Weather tab |
| `src/world/clouds.js`, `src/world/precip.js`, `src/world/spray.js` | the cloud layers and lightning; rain, snow, windshield drops and the wiper (v0.4.2); the wheels' spray (v0.4.2) (the haze, fog and overcast light are in `sky.js` and `glsl.js`) |
| `src/world/frame.js` | the map frame: Lambert conformal conic, magnetic variation, headings |
| `src/world/` | terrain clipmap, sea, sky, surface detail, cities, runways; `heightfield.js` and `runways.js` are the pure data helpers |
| `src/aircraft.js`, `src/livery.js`, `src/cockpit.js`, `src/cockpit-windows.js` | the procedural A321neo in Nuclear Airlines colours, the simple cockpit, and the six cockpit windows (shared by the outside, the livery and the cockpit) |
| `src/ui/` | PFD, ND, engine panel, FCU, map, flight setup, logbook, landing score card |
| `src/audio/` | `synth.js` (WebAudio engine, wind and warnings), `callouts.js` (radio-altitude callouts and RETARD) |
| `src/scenarios.js` | the scenario store (save slots over localStorage), names, the migration from v0.1.x, the menu's texts; v0.5.7: the summary's flight fields for the home page's card (`flightFields()`) |
| `src/ui/menu.js`, `src/ui/menu.css`, `src/ui/home-scene.js`, `src/ui/home-card.js`, `src/ui/home.css`, `src/ui/line-art.js` | the main menu, Load scenario, Settings and Controls pages; v0.5.7: the home page's scene (the moving path and plane, the floating boarding pass and suitcase, the landmarks' skyline tape, three backgrounds), the saved flight's card text, and the white line art (`SKYLINE`, `ICONS`). `assets/menu/`'s old stills (rendered by `tests/render-stills.mjs`) are no longer shown. v0.5.8: the travel prints (`PRINT_SLOTS`, `printSpots()`: `assets/menu/b777-landing-day.jpg`, `b787-cruise-night.jpg`, `a321-pushback-sunset.jpg`, rendered by `tests/cloud/v058-photos.cjs`), the stars and the aurora (static gradients and stripe masks, animated by transform and opacity), the ground band on the ground line (`groundLineUp()`) |
| `tools/bake_region_urban.py`, `data/urban-region.json`, `src/ui/common.js` (`buildUrban()`, `pickPlaces()`), `src/ui/map.js` | v0.6.3: the path map's city areas (the land cover's built-up share, smoothed into shapes) and names (Natural Earth's places, by population and zoom); `?mapcities=0` leaves them out |
| `tools/bake_region_tiles.py` | v0.6.3: the 250 m data's tile list (v0.6.0's 180 and the 26 added), shared by the bake's steps |
| `src/world/regions.js` | v0.7.0: the region registry (each region's frame, tiles' lattice, data folder, outline, its first flight and lists), which region a page is in (`?region=`, `FS_REGION` in node, the last used), `EUROPE_ON`, the reload into another region (`switchRegion()`, `takeCarry()`), and every region's airports by ICAO (`AIRPORT_INDEX`) |
| `src/world/outline.js` | v0.7.0: the region's outline in map metres (East Asia's rectangle, Europe's polygon), its bounding rectangle, `insideRegion()` |
| `src/world/rules-europe.js` | v0.7.0: Europe's countries' zones, units and transition altitudes, the airports that set their own, the ICAO prefixes and the setup's groups |
| `data/europe/` | v0.7.0: Europe's baked world, with the same layout as East Asia's in `data/` (manifest, terrain, airports and patches, centres, coast, urban areas, country raster, WMM grid) |
| `src/world/region.js` | v0.7.0: the worker's query with the region, the map's extent from the outline, the rules by region with the airports' own transition altitudes. v0.6.0: the three switches (retired in v0.7.0); v0.6.3: `fineOutline()` (the 250 m data's real outline) and Russia's rules; (`EAST_ASIA_ON`, `CITIES_ON`, `GROUND_ON`), which terrain and airports the manifest gives, the map's extent, the local rules by place (`countryAt()`, `rulesAt()`), and the terrain loader that keeps the tiles round the flight resident and holds the sim's steps for a tile that isn't in |
| `src/world/tilestore.js`, `clipwindow.js` | v0.6.0: the terrain in 128 km tiles (the 250 m level and the 1 km level beyond it), sampled as the one national grid was; the GPU's window of 4096² cells that follows the camera, filled a tile's block at a time |
| `src/world/geo-rules.js` | v0.6.0: WMM2025's magnetic variation, the country raster and South Korea's mask (`data/magvar.*`, `country.*`, `krmask.*`) |
| `src/world/airport-set.js`, `airport-worker.js` | v0.6.0: airports built within 200 km of the camera and released beyond 400 km, in slices of a few milliseconds, part of it in a worker |
| `src/world/landmarks.js`, `landmark-models.js`, `centres.js`, `centres-worker.js` | v0.6.0: the landmarks' own models (nineteen; twenty-six since v0.6.3, two of them bridges; thirty since v0.6.4); the city centres' real buildings (`data/centres/`), built in a worker, with the mask that keeps the procedural blocks out from under them. v0.7.0: Europe's twenty-eight (`EUROPE_LANDMARKS`, `EUROPE_MODELS`; `REGION_LANDMARKS` is the page's region's list) and Europe's centres' looks (`VERT_EU`, `data/europe/centres/`) |
| `src/world/cities.js` | the cities' blocks by country; v0.7.0: Europe's five mixes (`euVert()`, spliced into the shader only in Europe) |
| `src/world/finecover.js`, `ground.js`, `rural.js`, `greenhouses.js` | v0.6.0, behind `GROUND_ON`: the 31 m land cover's window round the camera, the field mosaic and the canopy, the countryside's houses and sheds; v0.6.1: the greenhouses' tunnels, and the CPU's lists of the cells that can hold a house, a tree or a tunnel (`candidateCells()`, `treeCells()` in `detail.js`, `greenhouseSlots()`), so only those are drawn. v0.7.0: Europe's villages (`euRuralVert()` in `rural.js`), no greenhouse country there (`glassPatch()`), and the tiles' lattice from the region |
| `src/world/runways.js` | the runways' data helpers; v0.6.2: `CIRCLING_ONLY`; v0.7.0: one-way and standby runways (`ONE_WAY`, `runwayUse()`, `canTakeOff()`, `canLand()`) |
| `src/clock.js`, `src/astro.js` | the clock (local time by place since v0.6.0); the sun, the Moon and its phase, sidereal time and the stars (Meeus's low-precision formulas) |
| `src/ui/sky-window.js` | the Sky window |
| `src/ui/load-window.js` | the Weight window, the Sky window's second tab (v0.3.2) |
| `src/world/sky.js` | the sky by day, twilight and night (stars, Milky Way, Moon, the aurora), and the light, haze and fog following the sun |
| `src/world/citylights.js`, `src/world/taxilights.js`, `src/aircraft-lights.js` | the city lights, the taxiway lights and stop bars, the A321's lights by phase |
| `src/score.js`, `src/store.js` | the landing score (v0.5.4: each part round(10 × e^(−cost/k)) out of 10; v0.5.5: its points out of its share of the 100 (`shareOut()`, `rowPoints()`), the total their sum, then the penalty rows: the worst part's cap, the grass, a taxiway or a would-be crash halving it; bounces from the wheels, `bounceTracker()`; v0.6.2: the approach measured, not scored, and the cap vertical speed's alone); localStorage under `gamedump:flight-sim:` |
| `src/ground/` | the taxi graph and routing, pushback, the gate flow (gate starts, routes out and in) |
| `src/world/apron*.js`, `src/world/traffic*.js`, `src/world/liveries-other.js` | taxiways, aprons, stands, jet bridges and terminals; parked aircraft (made-up airlines) and ground vehicles |
| `src/world/taxisigns.js` | where the taxiway and runway signs stand and what they say, from the taxi graph and the runways (v0.4.1; exit and distance remaining signs, v0.4.2; `apron.js` draws them) |
| `src/world/taxiroute.js`, `src/world/airport-mask.js` | the taxi route line; no trees or city blocks inside the airports |
| `data/` | baked terrain, water and land-cover grids, coastline, airports |
| `tools/bake_*.py` | the bake scripts (read `reference/raw/`, write `data/`) |
| `tools/cpu-guard.py` | the CPU guard every heavy dev command runs through |
| `tools/install-region.py` | v0.7.0: installs a region's staged bake into its data folder, each file checked against its SHA-256 before and after, only the terrain's keys merged into the manifest |
| `tools/check-airport.sh`, `tools/check-step.sh`, `tools/promote-airport.py` | v0.7.0: one pending airport through its check (gate, pushback, taxi, take-off and landing by day and by night, taxi-in, the frame rate at a stand, the finals' stills), each step through the guard and a watch for a script that hangs at the close; then its promotion from the manifest's pending lists |
| `tests/region-run.mjs`, `tests/v070-*.test.mjs`, `tests/browser-v070-regions.mjs` | v0.7.0: a test file of one region inside the one suite (`inRegion()` runs it again in a child process opened in that region); Europe's frame, terrain, rules, runways, airports, centres, landmarks and mixes; the regions in Chrome (a v0.6.4 save, saves across regions, the picker, the Load list, Europe's map) |
| `tests/*.test.mjs` | unit tests: `node --test games/flight-sim/tests/*.test.mjs` |
| `tests/browser-*.mjs` | Chrome checks with Playwright. `browser-e2e.mjs` is the Gimpo-to-Jeju flight: take-off, AP, time compression, a jump, skip to final, a landing, the score and the taxi-in route. `browser-gate.mjs` is a gate start, pushback and taxi to the holding point. Also: `browser-cpu.mjs` (nothing runs while paused or hidden), `browser-boot.mjs` (setup, keys, the hub player), `browser-rewind.mjs`, `browser-shots.mjs` (screenshots with fps, triangles and draw calls) and `audio-render.mjs` (the synth rendered offline and measured) |
| `tests/e2e-controller.js` | the test-only take-off and landing controller the end-to-end flight uses |
| `tests/cloud/` | headless checks for a cloud container without a GPU (SwiftShader): stills of the 3D view, landings with the score's parts, the HUD and the Esc menu (`HANDOFF.md` says how) |

Every heavy dev command runs through the guard, for example:

```sh
python3 games/flight-sim/tools/cpu-guard.py --minutes 15 -- node games/flight-sim/tests/browser-e2e.mjs
python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- bash -c 'node --test games/flight-sim/tests/*.test.mjs'
```

The browser scripts expect Playwright in `/tmp/flight-sim/pw` (`npm i playwright` there) and the GameDump server on port 8001 (v0.2.0's on a no-cache server on 8014: `python3 games/flight-sim/tests/cloud/serve.py <GameDump> 8014`). v0.2.0 added `browser-scenarios.mjs` (the menu and scenarios, end to end), `browser-night.mjs` (the night screenshots and the frame rate at night), `render-stills.mjs` (the menu's stills), `browser-menu.mjs`, `browser-sky-window.mjs` and `browser-logbook-filter.mjs`. `browser-boot.mjs` predates the main menu and expects the setup on load.

v0.6.0's browser checks (`tests/browser-v060-*.mjs`, all headless with `--mute-audio`, on port 8014): `flight` (a route end to end: take-off, the 16× cruise with its frame times, the map and a jump, skip to final, the landing; `--whole` flies the descent too, `--final` starts on the final, `--no-land` for a round trip's leak check, `--ground` or not), `airports <ICAO> [day|night]` (gate, pushback, taxi to the hold, take-off, landing), `night`, `stand-fps`, `setup`, `map`, `rules-baro`, `rules-metar`, `hub` (the page with no parameters and from the hub's player), `hitch` (the free camera at a 16× cruise's speed, each long frame named), `slowframes` (the same in the game at a gate), `revisit` (two places three times each: the leak check), `headroom` (the uncapped frame rate: run it alone), `stills` (fixed views with the flags given: the picture sets, compared with `v060-pixdiff.mjs`). Frame times only count when the check ran alone on the GPU. `tools/quicklook_fine_cover.py` and `tools/make_ground_sheets.py` make the land-cover maps and the before/after sheets.

v0.6.1: every browser script in `tests/` is headless by default now, muted, on the GPU (`--use-angle=metal`); `--headed` on the command line (or `FS_HEADLESS=0`) opens a window. The v0.6.0 scripts take `E2E_EXTRA` (more for the page's query: `&pending=1` shows an airport still in the manifest's `airportsPending`, `&cull=0` draws what is out of view too, `&greenhouses=0` leaves the tunnels out) and `E2E_PREFIX` (the pictures' prefix); `browser-v060-stills.mjs` takes `--prefix`, `--pending`, `--nocull` and `--q`.

v0.7.0: the unit suite covers both regions in one run (1,392 tests); `FS_REGION=europe node --test tests/v070-*.test.mjs` runs Europe's files directly (add `FS_PENDING=1` for airports still pending). The browser scripts take `FS_REGION=europe` with `E2E_EXTRA='&region=europe'` (`tools/check-airport.sh` sets both). `browser-v060-stills.mjs --total N` steps on to exactly N frames at the capture, so its pictures repeat run to run; use it for every before-and-after comparison (without it, the frames counted while it waits for files follow how fast they came, and the sea's sparkle and the lights' twinkle move).

## Storage

All in localStorage, under `gamedump:flight-sim:`:

- `scenarios`: the scenario index (id, name, created, savedAt, a summary); `scenario:<id>`: each scenario's whole state (a few KB, up to about 70 KB with a long approach track);
- `logbook`: every flight, tagged with its scenario's id and name (v0.1.x's untagged flights count as Scenario 1's);
- `settings` (volume, callouts, the readout, the setup's last plan) and `lastflight` (the last flight's plan);
- `designs` (v0.5.0): the warehouse's designs, one list (v0.5.2: each a list of parts; v0.5.0's open as they were);
- `region` (v0.7.0): the last region used. Each scenario carries its region in its entry and its state (East Asia's are written as before, with no field). Switching region carries the scenario to start in sessionStorage, under `gamedump:flight-sim:region-carry`.

## Data credits

- © OpenStreetMap contributors, under the ODbL: the coastline, inland water, land cover and airports.
- Copernicus DEM GLO-90 and GLO-30, © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA: the elevation.
- Natural Earth (public domain): the neighbouring coastlines.
- OurAirports (public domain): the runway cross-check.
- v0.6.0's region (see `briefs/V0-6-0.md`):
  - ESA WorldCover 10 m 2021 v200, under CC BY 4.0: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium": the land cover and inland water outside South Korea, and the fine land cover (`data/terrain/fine/`).
  - OpenStreetMap's land polygons (osmdata.openstreetmap.de) and its airports and buildings, © OpenStreetMap contributors, under the ODbL: the coastline (`data/coast-region.json`), the new airports and the city centres' buildings (`data/centres/`).
  - The World Magnetic Model WMM2025 (NOAA NCEI and the British Geological Survey, public domain): the magnetic variation outside South Korea (`data/magvar.*`).
  - Natural Earth's countries and urban areas (public domain): the country by position (`data/country.*`) and the far margin's towns.
- v0.6.3: Natural Earth's populated places (public domain): the names on the path map (`data/urban-region.json`, whose city areas are the game's own land cover, from ESA WorldCover as above). AIP Russia (the Federal Air Transport Agency's, public): Vladivostok's published values. v0.6.4: AIP Japan for New Chitose, Sendai, Niigata and Aomori; Geofabrik's extracts for North Korea, Hokkaido, Tohoku and Chubu. Geofabrik's extracts of OpenStreetMap for China and Russia's far east: the new airports and centres, © OpenStreetMap contributors, ODbL.
- v0.7.0, Europe (`data/europe/`; see `briefs/V0-7-0.md`), from the same kinds of sources as East Asia's:
  - Copernicus DEM GLO-90 and GLO-30 (as above): the elevation, and the 30 m terrain at the airports.
  - ESA WorldCover 10 m 2021 v200, under CC BY 4.0 ("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium"): the land cover, inland water and the 30 m land cover.
  - OpenStreetMap, © OpenStreetMap contributors, under the ODbL, from Geofabrik's extracts (Greater London, Surrey, West Sussex, Île-de-France, Hessen, Oberbayern, Switzerland, Noord-Holland, Madrid, Catalonia and Italy's Centro) and OpenStreetMap's land polygons (osmdata.openstreetmap.de): the eleven airports, the nine centres' buildings and the coastline (`data/europe/coast-region.json`).
  - Natural Earth (public domain): the land, the countries (`data/europe/country.*`), the urban areas beyond the 250 m data and the populated places' names on the path map.
  - The World Magnetic Model WMM2025 (NOAA NCEI and the British Geological Survey, public domain): the magnetic variation (`data/europe/magvar.*`).
  - OurAirports (public domain): the runways' cross-check, and Zurich's, Schiphol's and Fiumicino's runways.
  - Each country's AIP, as read on 2026-11-21 (public; the pages themselves aren't in the repository): the UK's NATS eAIP for Heathrow and Gatwick, France's SIA eAIP for Charles de Gaulle and Orly, Germany's DFS AIP for Frankfurt and Munich, Spain's ENAIRE AIP for Madrid and Barcelona.
  - The landmarks' heights and positions from public figures (Wikipedia's articles for most of them; each entry's `source` in `src/world/landmarks.js` says which).
- `data/` is 322 MB with Europe (Europe's 123 MB of it), each file under GitHub's 100 MB (the biggest, East Asia's coast file, is 3.8 MB; Europe's biggest, its coast file, 3.2 MB).

The baked files in `data/` keep those licences: the OpenStreetMap-derived ones (coast, water, land cover, airports) are under the ODbL, and the elevation is under the Copernicus DEM licence.
- The A321neo's numbers come from Airbus (the A321 Aircraft Characteristics document and the A321neo page) and EASA (TCDS EASA.A.064). Sources and pages are in `src/sim/a321neo.js`.
- The 787-9's come from EASA (TCDS IM.A.115, IM.E.102) and Boeing (D6-58333), the 777-300ER's from EASA (TCDS IM.A.003, IM.E.002) and Boeing (D6-58329-2), with sources and pages in `src/sim/b787-9.js` and `src/sim/b777-300er.js`. What those don't give is marked as an estimate or a weaker source there. Those PDFs aren't in the repository.
- The stars: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), from NASA's HEASARC, public domain (`data/STARS-CREDIT.md`). The sun and Moon follow Jean Meeus, *Astronomical Algorithms*.
- three.js r186 (MIT), in `vendor/`.
- B612 and B612 Mono (© The B612 Project Authors) and Barlow (© The Barlow Project Authors), under the SIL Open Font Licence 1.1, in `vendor/fonts/` with their licence texts.

Nuclear Airlines is made up. No real airline's branding is used.
