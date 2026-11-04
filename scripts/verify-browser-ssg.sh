#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHROME="${CHROME:-$HOME/chrome-headless-shell}"
cd browser
if [ -f package-lock.json ]; then npm ci --silent; else npm install --silent; fi
npm run build
npm test
cd ..
if [ ! -f formal/tla2tools.jar ]; then
  curl -sSL -o formal/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
fi
java -cp formal/tla2tools.jar tlc2.TLC -config formal/Replay.cfg -deadlock formal/Replay.tla > /tmp/quarry-tlc.log 2>&1
grep -q "No error has been found" /tmp/quarry-tlc.log
java -cp formal/tla2tools.jar tlc2.TLC -config formal/ReplayFail.cfg -deadlock formal/Replay.tla > /tmp/quarry-tlcfail.log 2>&1
grep -q "No error has been found" /tmp/quarry-tlcfail.log
echo "formal model ok"
