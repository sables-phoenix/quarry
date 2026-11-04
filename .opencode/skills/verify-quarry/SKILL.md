---
name: verify-quarry
description: Drive the quarry binary and mcp server the way an agent does, and prove fetch, cache, batch, research, ssrf guard, and the benchmark gate still work. Use before any release or after changing src/.
---

run `scripts/verify.sh` from the repo root. it builds nothing, so run `cargo build --release` first when src changed.

the script proves, in order:

1. a cold fetch returns cache=miss and a second fetch returns cache=hit with the same text
2. `http://127.0.0.1:8080/` is refused with the private address error
3. batch mode returns two extracted docs
4. the mcp server answers initialize, lists exactly four tools, and a tools/call returns text plus structured content
5. cache stats and cache clear work
6. unit tests pass
7. the benchmark gate passes: at least 15 pages measured and a median text ratio of 2.0 or better

if a step fails, reproduce it by hand with the same command the script prints. do not edit the assertion to match the output.
