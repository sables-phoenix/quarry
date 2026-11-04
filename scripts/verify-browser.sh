#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHROME="${CHROME:-$HOME/chrome-headless-shell}"
cd "$(dirname "$0")/.."
if [ ! -f formal/tla2tools.jar ]; then
  curl -sSL -o formal/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if ! curl -s -o /dev/null http://127.0.0.1:8899/index.html; then
  (cd fixtures/site && python3 -m http.server 8899 >/dev/null 2>&1 &)
  sleep 1
fi

echo "1. browser flow benchmark"
node browser-probe/bench-flow.mjs > "$WORK/flows.json"
python3 scripts/check-browser.py "$WORK/flows.json"

echo "2. formal model"
cd formal
java -cp tla2tools.jar tlc2.TLC -config Replay.cfg -deadlock Replay.tla > "$WORK/tla.log" 2>&1
grep -q "No error has been found" "$WORK/tla.log"
java -cp tla2tools.jar tlc2.TLC -config ReplayFail.cfg -deadlock Replay.tla > "$WORK/tlafail.log" 2>&1
grep -q "No error has been found" "$WORK/tlafail.log"
echo "ok: tlc both configs"

echo "all browser checks passed"
