# quarry playbook memory loop

## pass condition

The task passes only when `scripts/verify-playbook.sh` exits 0. The script runs these checks in order:

1. `cargo test` exits 0.
2. `npm --prefix browser run build` exits 0.
3. `npm --prefix browser test` exits 0.
4. `npx tsx bench/playbook.ts` writes `bench/playbook.json` with 40/40 replays and 1 token per replay.
5. `npx tsx bench/check-docs.ts` exits 0.
6. `npx tsx bench/livingbrain-check.ts` exits 0 after a measured hosted run with at least 9/10 exact step matches and search top 3 at 0.9 or better.
7. `git diff --check` is clean.

Exit 2 means blocked, not passed. A blocked check never counts as a pass.

## units

| unit | job | input | output | failure state | check | result |
| --- | --- | --- | --- | --- | --- | --- |
| U0 | verify Living Brain auth | API key, subject, brain id | brain id `c79b9588...` | 401, 404, or 402 | list brains, one capture | auth 200, capture 402, blocked |
| U1 | local playbook store | site, goal, url, steps | JSON playbook, id | corrupt or missing file | `browser/test/playbook.test.ts` | pass, attempt 1 |
| U2 | Living Brain adapter | local playbook, fake API | pointer page, search result | bad status, bad pointer | `browser/test/livingbrain.test.ts` | pass, attempt 1 |
| U3 | local end to end | fixture site, store | replay pass, success count 1 | replay fail | `browser/test/playbook.e2e.test.ts` | pass, attempt 1 |
| U4 | MCP tools | save, find, run | tool responses | wrong tool list, browser launch on save | `browser/test/mcp-playbook.test.ts` | first fail, fixed, pass |
| U5 | hosted fidelity | 10 captures, 30 searches | `bench/livingbrain.json` | 402, merged pages, lost steps | `bench/livingbrain-check.ts` | blocked, exit 2 |

## keep and revert

| attempt | change | check | result | decision |
| --- | --- | --- | --- | --- |
| A | controls appended after every action | 5 open Klawva runs | 2/5, three timeouts | reverted |
| B | stronger label ranking | 3 open Klawva runs | 0/3, all timeouts | reverted |
| C | stable in-page ids | 3 open Klawva runs | 0/3, all timeouts | reverted |
| D | playbook store and adapter | 16 browser tests | 16/16 pass | kept |
| E | playbook MCP wiring | MCP save and find | pass after lazy session fix | kept |
| F | hosted fidelity | capture with balance | 402 insufficient balance | blocked |

## stop

Stopped because the paid unit is blocked. One capture attempt returned 402. I did not retry and did not top up. The next approval is a balance top-up of at least $5.
