#!/bin/bash
# One browser check through the CPU guard, with a watch for a script that has printed its last line and then
# hangs at the browser's close (seen most nights since 2026-11-20; the cause isn't found): once the output matches
# the regex and the command is still alive 12 s later, its node process is stopped by its PID.
#   tools/check-step.sh <minutes> <out file> <last-line regex> <command...>
# FS_EXCL, if set, is a command put in front of the guard (a run's own lock, so that no bake runs beside a
# browser and there is one Chrome at a time: v0.7.0's was "python3 /tmp/flight-sim/v070/excl.py ex --").
GAME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$GAME/../.."                       # GameDump: the scripts are named from here (games/flight-sim/tests/…)
M=$1; O=$2; RX=$3; shift 3
CMD="$*"
mkdir -p "$(dirname "$O")"
$FS_EXCL python3 games/flight-sim/tools/cpu-guard.py --minutes "$M" -- "$@" > "$O" 2>&1 &
G=$!
while kill -0 $G 2>/dev/null; do
  sleep 3
  if grep -qE "$RX" "$O" 2>/dev/null; then
    for i in 1 2 3 4; do kill -0 $G 2>/dev/null || break; sleep 3; done
    if kill -0 $G 2>/dev/null; then
      P=$(pgrep -f "^node ${CMD#node }" | head -1)
      [ -n "$P" ] && { kill "$P"; echo "(hung at the close after its last line: stopped)" >> "$O"; }
    fi
  fi
done
wait $G; echo "rc $?" >> "$O"
