#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHROME="${CHROME:-$HOME/chrome-headless-shell}"
node --test browser/test/state.test.mjs
node --test browser/test/flows.test.mjs
