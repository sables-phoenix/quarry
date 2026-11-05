---
name: verify-quarry-browser
description: Prove the browser state graph, delta summaries, replay, and formal model still work. Use before shipping any change to browser/, browser-probe/, or formal/.
---

run `scripts/verify-browser-ssg.sh`. it covers the shipped package and the tla+ model.

the shipped package check proves:

1. stable node ids survive reordering
2. a live region value change is a change, not a new node
3. bulk removals are summarized below 40 tokens
4. projection returns matches and reports misses
5. 19 fixture flows pass first run and replay
6. a wrong assertion fails with a witness that names the changed value

the research check proves the delta ladder token counts and runs tlc on both replay configurations.

set `CHROME` when the browser binary is not `chrome-headless-shell` on `path`.
