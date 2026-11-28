#!/bin/bash
# v0.8.0: the push test for tools/push.sh, the game and its data as two repositories.
#   bash games/flight-sim/tests/v080-pushtest.sh /tmp/flight-sim/v080/pushtest > pushtest.log 2>&1
# Builds a small copy of the game's layout under the folder given (which must be under /tmp/; it is
# emptied first), with two local bare repositories as the remotes, and runs the new push.sh in the copy
# as Shane would. git runs ONLY inside that folder: never in GameDump. Each command is printed before it
# runs. The four cases (briefs/V0-8-0.md, part 1's Check):
#   1. the split: data/ its own repository, all of it in its first commit, titled with the version; the
#      game's commit takes data/ out of its index while the files stay on disk;
#   2. a version with no data change: no data commit;
#   3. a version with a data change: one data commit;
#   4. a data push that fails (a bad remote): no game commit, push.sh exits non-zero (on a later run,
#      and on a first run, where data/ must also still be in the game's index).
# The last line is `pushtest: N of 4 cases pass`.
set -u
GAME="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:-}"
case "$ROOT" in
  /tmp/?*|/private/tmp/?*) ;;
  *) echo "pushtest: give a folder under /tmp/ (got '$ROOT'); nothing run"; exit 2 ;;
esac
case "$ROOT" in *..*) echo "pushtest: no '..' in the folder; nothing run"; exit 2 ;; esac
case "$(cd "$GAME" && pwd -P)/" in "$(mkdir -p "$ROOT" && cd "$ROOT" && pwd -P)"/*) echo "pushtest: the folder is the game's own"; exit 2 ;; esac

# git sees nothing of the Mac's own configuration (no hooks, signing or credential helpers), finds no
# repository above the test's folder, and commits as a test identity.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CEILING_DIRECTORIES="$(dirname "$ROOT")"
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid
unset FS_GAME_REMOTE FS_DATA_REMOTE

run() { printf '+ %s\n' "$*"; "$@"; local rc=$?; [ $rc -ne 0 ] && echo "  (exit $rc)"; return $rc; }
PASS=0
FAILS=()
check() {   # check <case> <what> <command…>: one assertion
  local c="$1" what="$2"; shift 2
  if "$@" >/dev/null 2>&1; then echo "  ok   [$c] $what"; else echo "  FAIL [$c] $what"; FAILS+=("$c"); fi
}
case_done() { local c="$1" f; for f in "${FAILS[@]:-}"; do [ "$f" = "$c" ] && { echo "case $c: FAIL"; return; }; done; PASS=$((PASS + 1)); echo "case $c: pass"; }
count() { git -C "$1" rev-list --count main 2>/dev/null || echo 0; }
title() { git -C "$1" log -1 --format=%s main 2>/dev/null; }
eq() { [ "$1" = "$2" ]; }

echo "pushtest: $(date '+%Y-%m-%d %H:%M:%S %Z'), git $(git --version | cut -d' ' -f3), the game at $GAME"
run rm -rf "$ROOT"
run mkdir -p "$ROOT/remotes" "$ROOT/work"
run git init -q --bare -b main "$ROOT/remotes/flight-sim.git"
run git init -q --bare -b main "$ROOT/remotes/flight-sim-data.git"

# The layout: a few real files of the game's under src/ and data/, v0.7.9's .gitignore first.
make_copy() {   # make_copy <folder> <game remote>: the game as pushed at v0.7.9, one commit, in its own repository
  local W="$1" R="$2"
  run mkdir -p "$W/src/world" "$W/tools" "$W/data/airports" "$W/data/europe"
  run cp "$GAME/src/version.js" "$W/src/version.js"
  run cp "$GAME/src/world/regions.js" "$W/src/world/regions.js"
  run cp "$GAME/data/STARS-CREDIT.md" "$W/data/STARS-CREDIT.md"
  run cp "$GAME/data/magvar.json" "$W/data/magvar.json"
  run cp "$GAME/data/europe/magvar.json" "$W/data/europe/magvar.json"
  printf '{"icao":"TEST","runways":[]}\n' > "$W/data/airports/TEST.json"; echo "+ (wrote $W/data/airports/TEST.json)"
  printf 'finder\n' > "$W/data/.DS_Store"; echo "+ (wrote $W/data/.DS_Store, as Finder leaves one)"
  # v0.7.9's .gitignore: the new one without its last two lines
  grep -v -e '^/data/$' -e 'its own repository (github.com/NuclearPlane787/flight-sim-data)' "$GAME/.gitignore" > "$W/.gitignore"
  echo "+ (wrote $W/.gitignore as v0.7.9's)"
  run git -C "$W" init -q -b main
  run git -C "$W" config user.name Test
  run git -C "$W" config user.email test@example.invalid
  run git -C "$W" remote add origin "$R"
  run git -C "$W" add -A
  run git -C "$W" commit -q -m v0.7.9
  run git -C "$W" push -q -u origin main
  # then v0.8.0's working tree: the new push.sh, .gitignore and data/README.md
  run cp "$GAME/tools/push.sh" "$W/tools/push.sh"
  run cp "$GAME/.gitignore" "$W/.gitignore"
  run cp "$GAME/data/README.md" "$W/data/README.md"
}

W="$ROOT/work/flight-sim"
G="$ROOT/remotes/flight-sim.git"
D="$ROOT/remotes/flight-sim-data.git"
make_copy "$W" "$G"
export FS_GAME_REMOTE="$G" FS_DATA_REMOTE="$D"
run git -C "$W" log --oneline --stat -1

echo
echo "=== case 1: the split (sh tools/push.sh v0.8.0)"
(cd "$W" && run sh tools/push.sh v0.8.0); rc=$?
run git -C "$D" log --format='%h %s' main
run git -C "$D" ls-tree -r --name-only main
run git -C "$G" log --format='%h %s' main
run git -C "$G" ls-tree -r --name-only main
run git -C "$W" status --short --ignored
check 1 "push.sh exits 0" eq "$rc" 0
check 1 "the data's remote has one commit" eq "$(count "$D")" 1
check 1 "titled v0.8.0" eq "$(title "$D")" v0.8.0
check 1 "every data file in it (README.md, STARS-CREDIT.md, magvar.json, europe/magvar.json, airports/TEST.json)" \
  eq "$(git -C "$D" ls-tree -r --name-only main | sort | tr '\n' ' ')" "README.md STARS-CREDIT.md airports/TEST.json europe/magvar.json magvar.json "
check 1 "no .DS_Store in the data's repository" eq "$(git -C "$D" ls-tree -r --name-only main | grep -c DS_Store)" 0
check 1 "the game's remote: v0.7.9 then v0.8.0" eq "$(git -C "$G" log --format=%s main | tr '\n' ' ')" "v0.8.0 v0.7.9 "
check 1 "v0.8.0's tree has no data/" eq "$(git -C "$G" ls-tree -r --name-only main | grep -c '^data/')" 0
check 1 "v0.7.9's tree still has its four data files (the history keeps them)" eq "$(git -C "$G" ls-tree -r --name-only main~1 | grep -c '^data/')" 4
check 1 "v0.8.0's .gitignore has /data/" sh -c "git -C '$G' show main:.gitignore | grep -qx /data/"
check 1 "the game's index tracks nothing under data/" eq "$(git -C "$W" ls-files data | wc -l | tr -d ' ')" 0
check 1 "the files still on disk" test -f "$W/data/magvar.json" -a -f "$W/data/europe/magvar.json" -a -f "$W/data/airports/TEST.json" -a -f "$W/data/README.md"
check 1 "the game's working tree clean" eq "$(git -C "$W" status --porcelain | wc -l | tr -d ' ')" 0
check 1 "the data's working tree clean (.DS_Store excluded)" eq "$(git -C "$W/data" status --porcelain | wc -l | tr -d ' ')" 0
case_done 1

echo
echo "=== case 2: a version with no data change (sh tools/push.sh v0.8.1)"
echo "// v0.8.1" >> "$W/src/version.js"; echo "+ (appended a line to $W/src/version.js)"
(cd "$W" && run sh tools/push.sh v0.8.1); rc=$?
run git -C "$D" log --format='%h %s' main
run git -C "$G" log --format='%h %s' main
check 2 "push.sh exits 0" eq "$rc" 0
check 2 "no data commit (still one)" eq "$(count "$D")" 1
check 2 "the game's commit v0.8.1" eq "$(title "$G")" v0.8.1
check 2 "the game's remote has three commits" eq "$(count "$G")" 3
case_done 2

echo
echo "=== case 3: a version with a data change (sh tools/push.sh v0.8.2)"
printf '{"icao":"TES2","runways":[]}\n' > "$W/data/airports/TES2.json"; echo "+ (wrote $W/data/airports/TES2.json)"
echo "// v0.8.2" >> "$W/src/version.js"; echo "+ (appended a line to $W/src/version.js)"
(cd "$W" && run sh tools/push.sh v0.8.2); rc=$?
run git -C "$D" log --format='%h %s' --stat main
run git -C "$G" log --format='%h %s' main
check 3 "push.sh exits 0" eq "$rc" 0
check 3 "one data commit more (two)" eq "$(count "$D")" 2
check 3 "titled v0.8.2" eq "$(title "$D")" v0.8.2
check 3 "it holds the new file only" eq "$(git -C "$D" diff --name-only main~1 main | tr '\n' ' ')" "airports/TES2.json "
check 3 "the game's commit v0.8.2, with no data/ in it" sh -c "[ \"\$(git -C '$G' log -1 --format=%s main)\" = v0.8.2 ] && [ \$(git -C '$G' ls-tree -r --name-only main | grep -c '^data/') -eq 0 ]"
case_done 3

echo
echo "=== case 4a: a data push that fails on a later run (the data's remote moved away)"
printf '{"icao":"TES3","runways":[]}\n' > "$W/data/airports/TES3.json"; echo "+ (wrote $W/data/airports/TES3.json)"
echo "// v0.8.3" >> "$W/src/version.js"; echo "+ (appended a line to $W/src/version.js)"
run git -C "$W/data" remote set-url origin "$ROOT/remotes/missing.git"
gbefore="$(git -C "$W" rev-parse main)"
(cd "$W" && run sh tools/push.sh v0.8.3); rc=$?
run git -C "$W" log --format='%h %s' -2
check 4 "push.sh exits non-zero" test "$rc" -ne 0
check 4 "no game commit (the local main unchanged)" eq "$(git -C "$W" rev-parse main)" "$gbefore"
check 4 "nothing pushed to the game's remote (still v0.8.2)" eq "$(title "$G")" v0.8.2
check 4 "the data's remote unchanged (two commits)" eq "$(count "$D")" 2
run git -C "$W/data" remote set-url origin "$D"
(cd "$W" && run sh tools/push.sh v0.8.3); rc=$?
check 4 "run again with the remote mended: both v0.8.3" sh -c "[ $rc -eq 0 ] && [ \"\$(git -C '$D' log -1 --format=%s main)\" = v0.8.3 ] && [ \"\$(git -C '$G' log -1 --format=%s main)\" = v0.8.3 ]"

echo
echo "=== case 4b: a data push that fails on the first run (a bad remote at the split)"
run git init -q --bare -b main "$ROOT/remotes/flight-sim-b.git"
W2="$ROOT/work-b/flight-sim"
G2="$ROOT/remotes/flight-sim-b.git"
make_copy "$W2" "$G2"
ntracked="$(git -C "$W2" ls-files data | wc -l | tr -d ' ')"
(cd "$W2" && FS_GAME_REMOTE="$G2" FS_DATA_REMOTE="$ROOT/remotes/missing.git" run sh tools/push.sh v0.8.0); rc=$?
run git -C "$W2" log --format='%h %s'
run git -C "$W2" status --short
check 4 "push.sh exits non-zero" test "$rc" -ne 0
check 4 "no game commit (v0.7.9 alone)" eq "$(git -C "$W2" log --format=%s | tr '\n' ' ')" "v0.7.9 "
check 4 "data/ still in the game's index (no git rm --cached)" sh -c "[ $ntracked -eq 4 ] && [ \$(git -C '$W2' ls-files data | wc -l) -eq $ntracked ]"
check 4 "the game's remote still v0.7.9 alone" eq "$(git -C "$G2" log --format=%s main | tr '\n' ' ')" "v0.7.9 "
check 4 "the data's repository made and committed locally, for the next run" eq "$(git -C "$W2/data" log --format=%s | tr '\n' ' ')" "v0.8.0 "
run git init -q --bare -b main "$ROOT/remotes/flight-sim-data-b.git"
run git -C "$W2/data" remote set-url origin "$ROOT/remotes/flight-sim-data-b.git"
(cd "$W2" && FS_GAME_REMOTE="$G2" run sh tools/push.sh v0.8.0); rc=$?
check 4 "run again with the remote mended: the split goes through" sh -c "[ $rc -eq 0 ] && [ \"\$(git -C '$G2' log --format=%s main | tr '\n' ' ')\" = 'v0.8.0 v0.7.9 ' ] && [ \$(git -C '$W2' ls-files data | wc -l) -eq 0 ] && [ \"\$(git -C '$ROOT/remotes/flight-sim-data-b.git' log --format=%s main)\" = v0.8.0 ]"
case_done 4

echo
echo "=== the folder a later run would refuse: data/ missing, or no /data/ in .gitignore"
W3="$ROOT/work-c"; run mkdir -p "$W3/tools"; run cp "$GAME/tools/push.sh" "$W3/tools/push.sh"; cp "$GAME/.gitignore" "$W3/.gitignore"
(cd "$W3" && run sh tools/push.sh v0.8.0); echo "  (expected non-zero, and no .git made: $( [ -d "$W3/.git" ] && echo MADE || echo none ))"

echo
[ ${#FAILS[@]} -gt 0 ] && echo "failed checks in cases: ${FAILS[*]}"
echo "pushtest: $PASS of 4 cases pass"
