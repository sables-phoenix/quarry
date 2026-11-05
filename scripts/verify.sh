#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PATH="$HOME/.cargo/bin:$PATH"
BIN=target/release/quarry
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "ok: $1"; }

[ -x "$BIN" ] || fail "release binary missing, run cargo build --release"

echo "1. fetch cold then warm"
COLD=$("$BIN" --cache-dir "$WORK/cache" fetch https://docs.rs/serde/latest/serde/ --json)
WARM=$("$BIN" --cache-dir "$WORK/cache" fetch https://docs.rs/serde/latest/serde/ --json)
echo "$COLD" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["cache"]=="miss", d["cache"]; assert d["chars"]>1000, d["chars"]'
echo "$WARM" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["cache"]=="hit", d["cache"]; assert d["chars"]>1000'
pass "cache miss then hit"

echo "2. private address is refused"
if "$BIN" fetch http://127.0.0.1:8080/ >/dev/null 2>"$WORK/err"; then fail "loopback fetch was allowed"; fi
grep -q "private or loopback" "$WORK/err" || fail "unexpected loopback error: $(cat "$WORK/err")"
pass "ssrf guard"

echo "3. batch fetch"
"$BIN" --cache-dir "$WORK/cache" batch https://docs.rs/serde/latest/serde/ https://www.rust-lang.org/ --json > "$WORK/batch.json"
python3 - "$WORK/batch.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert len(d["docs"])==2, d
assert all(x["chars"]>200 for x in d["docs"])
PY
pass "batch returns two docs"

echo "4. mcp handshake and tools"
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_fetch","arguments":{"url":"https://docs.rs/serde/latest/serde/","max_chars":4000}}}'
} | "$BIN" --cache-dir "$WORK/cache" mcp > "$WORK/mcp.jsonl"
python3 - "$WORK/mcp.jsonl" <<'PY'
import json,sys
lines=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
assert len(lines)==3, lines
names=[t["name"] for t in lines[1]["result"]["tools"]]
expected={"web_search","web_fetch","web_batch","web_outline","web_section","web_ask","web_research"}
assert set(names)==expected, names
text=lines[2]["result"]["content"][0]["text"]
assert "serde" in text.lower(), text[:200]
assert lines[2]["result"]["structuredContent"]["chars"]>500
PY
pass "mcp initialize, list, call"

echo "5. cache stats and clear"
"$BIN" --cache-dir "$WORK/cache" cache stats | grep -q "entries" || fail "cache stats"
"$BIN" --cache-dir "$WORK/cache" cache clear | grep -q "cleared" || fail "cache clear"
pass "cache control"

echo "6. unit tests"
cargo test -q 2>&1 | tail -3
pass "cargo test"

echo "7. benchmark gates"
[ -d node_modules ] || npm install --silent
npx tsx bench/text.ts > "$WORK/bench.log" 2>&1 || fail "bench failed: $(tail -5 "$WORK/bench.log")"
npx tsx bench/check.ts text || fail "bench gate"
npx tsx bench/select.ts > "$WORK/select.log" 2>&1 || fail "selection bench failed: $(tail -5 "$WORK/select.log")"
npx tsx bench/check.ts select || fail "selection gate"
npx tsx bench/summary.ts || fail "summary"
npx tsx bench/check-docs.ts || fail "docs drift"
pass "benchmark gates"

echo "all checks passed"
