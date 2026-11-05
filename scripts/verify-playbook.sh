#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${CHROME:-}" ]; then
  for candidate in /home/opencode/chrome-headless-shell /usr/bin/google-chrome /usr/bin/chromium; do
    if [ -x "$candidate" ]; then export CHROME="$candidate"; break; fi
  done
fi
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --quiet || exit 1
npm --prefix browser run build || exit 1
npm --prefix browser test || exit 1
npx tsx bench/playbook.ts > /tmp/quarry-playbook.log 2>&1 || { cat /tmp/quarry-playbook.log; exit 1; }
npx tsx bench/check-docs.ts || exit 1
git diff --check || exit 1
exit 0
