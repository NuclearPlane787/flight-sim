#!/bin/sh
# Send the game and its data to their two public GitHub repositories:
#   sh tools/push.sh v0.8.0
# from the game's folder (games/flight-sim). Since v0.8.0 data/ is a repository of its own
# (github.com/NuclearPlane787/flight-sim-data) inside the game's folder, and the game's repository
# (github.com/NuclearPlane787/flight-sim) ignores it (`/data/` in .gitignore).
#
# Each run, the data first:
#   1. data/: commits whatever changed, titled with the version alone, and pushes. If the data didn't
#      change, there's no data commit. If its push fails, the script stops there: nothing is committed
#      or pushed in the game's repository.
#   2. the game: commits everything that changed, titled with the version alone (what's in it goes in
#      Updates.md), and pushes, as before v0.8.0.
#
# The first run after v0.7.9 (no data/.git yet) also makes data/ its repository, connects it to
# flight-sim-data (the GitHub repository must be empty) and pushes all of it, about 527 MB, so it takes
# a while. Only once that push has gone through does it take data/ out of the game's index
# (`git rm -r --cached`, once): the files stay on disk, and the game's history keeps them up to v0.7.9.
# With no .git in the game's folder either, it makes the game's repository too, as before.
#
# Shane runs it; the agents never run git here, data/ included. The two remotes can be overridden with
# FS_GAME_REMOTE and FS_DATA_REMOTE (tests/v080-pushtest.sh does, with local repositories in /tmp).
DATA_REMOTE="${FS_DATA_REMOTE:-https://github.com/NuclearPlane787/flight-sim-data.git}"
GAME_REMOTE="${FS_GAME_REMOTE:-https://github.com/NuclearPlane787/flight-sim.git}"

cd "$(dirname "$0")/.." || exit 1
if [ -z "$1" ]; then
  echo "Give the version, for example: sh tools/push.sh v0.8.0"
  exit 1
fi
if [ ! -d data ]; then
  echo "There's no data/ folder here, so nothing was pushed. Clone it first:"
  echo "  git clone $DATA_REMOTE data"
  exit 1
fi
if ! grep -qx '/data/' .gitignore 2>/dev/null; then
  echo "The game's .gitignore has no /data/ line, so nothing was pushed (the game's repository would take data/ in again)."
  exit 1
fi

# ---- 1. The data.
first=no
if [ ! -d data/.git ]; then
  first=yes
  echo "First run: making data/ a repository of its own ($DATA_REMOTE)."
  git -C data init -q -b main || exit 1
fi
if ! git -C data remote get-url origin >/dev/null 2>&1; then
  git -C data remote add origin "$DATA_REMOTE" || exit 1
fi
# Finder's .DS_Store files stay out of the data's repository (local to it: no file is added to data/).
grep -qx '.DS_Store' data/.git/info/exclude 2>/dev/null || echo '.DS_Store' >> data/.git/info/exclude
git -C data add -A || exit 1
if git -C data diff --cached --quiet; then
  echo "data: nothing changed, no data commit."
else
  if [ "$first" = yes ]; then
    echo "data: committing all of data/ as $1 ($(git -C data ls-files | wc -l | tr -d ' ') files)."
  else
    echo "data: committing the changes as $1."
  fi
  git -C data commit -q -m "$1" || exit 1
fi
if git -C data rev-parse -q --verify HEAD >/dev/null; then
  if [ "$first" = yes ]; then
    echo "data: pushing to $(git -C data remote get-url origin). This first push uploads about 527 MB, so it takes a while."
  else
    echo "data: pushing to $(git -C data remote get-url origin)."
  fi
  if ! git -C data push -u origin main; then
    echo "The data's push failed, so the game's commit was not made and nothing of the game was pushed."
    echo "Check the connection or the remote, then run sh tools/push.sh $1 again."
    echo "(If git said \"RPC failed\" on the first, big push: git -C data config http.postBuffer 524288000, then run it again.)"
    exit 1
  fi
fi

# ---- 2. The game.
if [ ! -d .git ]; then
  echo "Making the game's repository ($GAME_REMOTE)."
  git init -q -b main || exit 1
  git remote add origin "$GAME_REMOTE" || exit 1
fi
if [ -n "$(git ls-files data | head -n 1)" ]; then
  echo "game: taking data/ out of the game's repository (the files stay on disk; its history keeps them)."
  git rm -r -q --cached data || exit 1
fi
git add -A || exit 1
if git diff --cached --quiet; then
  echo "game: nothing new to commit."
else
  echo "game: committing as $1."
  git commit -q -m "$1" || exit 1
fi
echo "game: pushing to $(git remote get-url origin)."
if ! git push -u origin main; then
  echo "The game's push failed (the data's went through). Run sh tools/push.sh $1 again."
  exit 1
fi
echo "Done: $1."
