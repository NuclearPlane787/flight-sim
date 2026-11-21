#!/bin/bash
# One pending airport through the check every airport passed (briefs/V0-7-0.md, "The rules every part keeps"):
# a gate start, pushback, taxi, take-off and a landing by the test pilot, by day and by night; taxi-in from two
# ends; the frame rate at a stand; the final's stills by day and by night. Each step goes through the guard and
# the hang watch (tools/check-step.sh). From anywhere:
#   tools/check-airport.sh <region> <ICAO> <end1> <end2> [day|night|taxi-in|fps|stills|rest ...]   (default: day night rest)
#   tools/check-airport.sh europe EGLL 27R 09L day night rest
# "rest" is taxi-in, fps and stills; "fps" and "stills" must run on mains power, alone on the GPU.
# Needs a no-cache server over GameDump (python3 games/flight-sim/tests/cloud/serve.py <GameDump> 8014) and
# Playwright in /tmp/flight-sim/pw. Env: FS_CHECK_DIR (results; default /tmp/flight-sim/checks), FS_CHECK_PREFIX
# (the pictures' prefix; default v070), E2E_URL (the game's folder; default http://127.0.0.1:8014/games/flight-sim/),
# FS_EXCL (see check-step.sh). Then, if every step passed: tools/promote-airport.py.
HERE="$(cd "$(dirname "$0")" && pwd)"
REGION=$1; I=$2; A=$3; B=$4; shift 4
L=$(echo "$I" | tr 'A-Z' 'a-z')
D="${FS_CHECK_DIR:-/tmp/flight-sim/checks}"; mkdir -p "$D"
P="${FS_CHECK_PREFIX:-v070}"
URL="${E2E_URL:-http://127.0.0.1:8014/games/flight-sim/}"
T=games/flight-sim/tests
export FS_REGION=$REGION FS_PENDING=1 E2E_PREFIX=$P E2E_URL=$URL E2E_EXTRA="&pending=1&region=$REGION"
R="PASS no console errors|FAIL no console errors|FAIL exception"
S="$HERE/check-step.sh"
taxi_in() { "$S" 6 "$D/$L-taxi-in.txt" "$R" node $T/browser-v060-taxi-in.mjs $I:$A $I:$B; }
fps() { "$S" 8 "$D/$L-stand-fps.txt" "^(PASS|FAIL)" node $T/browser-v060-stand-fps.mjs $I; }
stills() { "$S" 4 "$D/$L-stills.txt" "^wrote |final-night: " node $T/browser-v060-stills.mjs --base "$URL" --prefix "$P" --tag y1 --pending --q "&region=$REGION" $I-final $I-final-night; }
for step in ${@:-day night rest}; do
  case $step in
    day) "$S" 16 "$D/$L-day.txt" "$R" node $T/browser-v060-airports.mjs $I day ;;
    night) "$S" 16 "$D/$L-night.txt" "$R" node $T/browser-v060-airports.mjs $I night ;;
    taxi-in) taxi_in ;;
    fps) fps ;;
    stills) stills ;;
    rest) taxi_in; fps; stills ;;
  esac
done
echo "$I $* done $(date +%H:%M)" >> "$D/done.txt"
