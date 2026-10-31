#!/bin/sh
# Send the game to its public GitHub repository (github.com/NuclearPlane787/flight-sim):
#   sh tools/push.sh v0.1.0
# from the game's folder (games/flight-sim). It commits everything that changed, with the version
# number alone as the commit title (what's in it goes in Updates.md), and pushes. The first run
# also creates the local repository and connects it to GitHub; the GitHub repository must be empty.
# Shane runs it; the agents never run git here.
cd "$(dirname "$0")/.." || exit 1
if [ -z "$1" ]; then
  echo "Give the version, for example: sh tools/push.sh v0.1.0"
  exit 1
fi
if [ ! -d .git ]; then
  git init -q -b main || exit 1
  git remote add origin https://github.com/NuclearPlane787/flight-sim.git || exit 1
fi
git add -A || exit 1
if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -q -m "$1" || exit 1
fi
git push -u origin main
